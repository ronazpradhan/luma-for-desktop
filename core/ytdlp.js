// The YouTube fallback: the official yt-dlp, fetched from yt-dlp's GitHub
// releases the first time a song needs it and checked against the release's
// published SHA-256 before it is ever run. YouTube's player challenges are
// solved with the JavaScript runtime LUMA already ships (Electron's Node).
//
// The folder build (yt-dlp_win.zip) is used, not the single .exe: the single
// file unpacks itself on every run, about a second per song.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const ARCHIVE = "yt-dlp_win.zip";
const UPDATE_EVERY_MS = 3 * 86_400_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const BROWSERS = ["firefox"];

export function createYtDlp({ binDir, fetchImpl = fetch, log = () => {} }) {
  const dir = path.join(binDir, "yt-dlp");
  const bin = path.join(dir, "yt-dlp.exe");
  // Unpacked files keep the release's own dates, so freshness comes from this stamp.
  const stamp = path.join(dir, ".installed");
  let installing = null;
  // The client that last served first, as LUMA for Android does: on a connection
  // YouTube is strict with, the one that fails every time costs ~4 s a song.
  const winner = { signedIn: null, signedOut: null };

  async function download() {
    await mkdir(binDir, { recursive: true });
    log("yt-dlp: downloading the latest release");
    const [sums, zip] = await Promise.all([
      fetchImpl(`${RELEASE}/SHA2-256SUMS`, { signal: AbortSignal.timeout(30_000) }).then((r) => {
        if (!r.ok) throw new Error(`checksum list answered ${r.status}`);
        return r.text();
      }),
      fetchImpl(`${RELEASE}/${ARCHIVE}`, { signal: AbortSignal.timeout(240_000) }).then(async (r) => {
        if (!r.ok) throw new Error(`yt-dlp download answered ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    ]);
    const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name?.replace(/^\*/, "") === ARCHIVE)?.[0];
    const actual = createHash("sha256").update(zip).digest("hex");
    if (!expected || expected.toLowerCase() !== actual) throw new Error("yt-dlp download failed its checksum; not using it");
    const zipFile = path.join(binDir, `${ARCHIVE}.part`);
    const staging = path.join(binDir, "yt-dlp.new");
    await writeFile(zipFile, zip);
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    // Windows' own tar (bsdtar) unpacks zip archives; named in full so another
    // tar on PATH (Git's, which can't read zips) is never picked up.
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    await new Promise((resolve, reject) =>
      execFile(tar, ["-xf", zipFile, "-C", staging], { windowsHide: true, timeout: 120_000 }, (e) => (e ? reject(new Error(`couldn't unpack yt-dlp (${e.message})`)) : resolve())));
    await rm(zipFile, { force: true });
    await stat(path.join(staging, "yt-dlp.exe"));
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
    await writeFile(stamp, new Date().toISOString());
    // The single-file build from earlier versions isn't needed any more.
    await rm(path.join(binDir, "yt-dlp.exe"), { force: true });
    log("yt-dlp: installed and verified");
  }

  async function ensure() {
    const info = await stat(bin).catch(() => null) && (await stat(stamp).catch(() => null));
    if (info && Date.now() - info.mtimeMs < UPDATE_EVERY_MS) return bin;
    if (!installing) {
      installing = download()
        .catch(async (e) => {
          // An older verified copy beats none.
          if (info) {
            log(`yt-dlp: update failed (${e.message}); keeping the installed copy`);
            return;
          }
          throw e;
        })
        .finally(() => { installing = null; });
    }
    await installing;
    return bin;
  }

  function run(args, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, {
        timeout: timeoutMs,
        signal,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }, (err, stdout, stderr) => {
        if (err) {
          if (err.name === "AbortError") return reject(err);
          const why = String(stderr).split("\n").find((l) => l.startsWith("ERROR")) ?? err.message;
          reject(new Error(why.trim()));
        } else resolve(String(stdout));
      });
    });
  }

  async function once(videoId, client, cookieFile, signal) {
    const args = [
      "-f", "251/250/140/bestaudio",
      "--no-playlist", "--no-download", "--no-warnings",
      "--js-runtimes", `node:${process.execPath}`,
      "--print", "%(url)s",
      "--print", "%(acodec)s|%(abr)s|%(filesize,filesize_approx)s|%(ext)s",
      "--print", "%(http_headers.User-Agent)s",
    ];
    if (client) args.push("--extractor-args", `youtube:player_client=${client}`);
    if (cookieFile) args.push("--cookies", cookieFile);
    args.push(`https://music.youtube.com/watch?v=${videoId}`);
    const out = await run(args, 45_000, signal);
    const [url, meta = "", userAgent] = out.trim().split(/\r?\n/);
    if (!url?.startsWith("https://")) throw new Error("yt-dlp gave no audio URL");
    const [acodec, abr, size, ext] = meta.split("|");
    return {
      url,
      codec: acodec?.startsWith("opus") ? "opus" : (acodec || "audio"),
      kbps: Math.round(Number(abr)) || null,
      size: Number(size) || null,
      ext: ext || "webm",
      userAgent: userAgent && userAgent !== "NA" ? userAgent : null,
    };
  }

  return {
    /**
     * A playable audio URL for [videoId]. Like LUMA for Android, clients are
     * tried in turn (last winner first) and a URL only counts once its last
     * bytes download: YouTube hands some PCs links that refuse to play (403).
     * [cookieFile] is the signed-in session, when there is one; [signal]
     * stops the lookup (yt-dlp is ended) when the song is found elsewhere.
     */
    async audio(videoId, { cookieFile = null, signal } = {}) {
      if (!VIDEO_ID.test(videoId)) throw new Error("not a YouTube video id");
      await ensure();
      const key = cookieFile ? "signedIn" : "signedOut";
      // Signed in, yt-dlp's own client choice uses the session; signed out,
      // android_vr needs no token and is the fastest when YouTube allows it.
      const base = cookieFile ? [null, "tv"] : ["android_vr", null];
      const plan = winner[key] !== null && base.includes(winner[key]) ? [winner[key], ...base.filter((c) => c !== winner[key])] : base;
      let lastError = null;
      for (const client of plan) {
        signal?.throwIfAborted();
        try {
          const a = await once(videoId, client, cookieFile, signal);
          if (await servesWholeFile(a, signal)) {
            winner[key] = client;
            return a;
          }
          lastError = new Error("YouTube gave a link that doesn't play");
          log(`yt-dlp: ${client ?? "default"} link for ${videoId} failed the end-of-file check`);
        } catch (e) {
          if (e.name === "AbortError") throw e;
          lastError = e;
        }
      }
      throw signInHint(lastError, !!cookieFile);
    },

    /**
     * Copies [browser]'s cookie jar to [outFile] (Netscape format) through
     * yt-dlp's own reader. yt-dlp writes the jar on exit, even when the
     * lookup itself is turned away. Only Firefox: Chrome, Edge and Brave lock
     * their cookies to themselves.
     */
    async exportBrowserCookies(browser, outFile) {
      if (!BROWSERS.includes(browser)) throw new Error("unknown browser");
      await ensure();
      try {
        await run([
          "--cookies-from-browser", browser, "--cookies", outFile,
          "--skip-download", "--no-warnings", "--no-playlist",
          "https://music.youtube.com/watch?v=jNQXAC9IVRw",
        ], 60_000);
      } catch (e) {
        if (/could not (copy|find|decrypt)|failed to decrypt|permission|locked|DPAPI|app.?bound/i.test(e.message)) {
          throw new Error(`Couldn't read Firefox's sign-in (${e.message}). Close Firefox and try again, or use a cookies file.`);
        }
        // Any other failure (YouTube's bot check, say) still leaves the jar written.
      }
    },

    async version() {
      await ensure();
      return (await run(["--version"], 15_000)).trim();
    },
  };
}

/** True when the end of the file downloads too: a gated link fails right here, not mid-song. */
async function servesWholeFile(a, signal, fetchImpl = fetch) {
  const headers = { "User-Agent": a.userAgent ?? "Mozilla/5.0" };
  headers.Range = a.size ? `bytes=${Math.max(0, a.size - 4096)}-${a.size - 1}` : "bytes=0-4095";
  try {
    const res = await fetchImpl(a.url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000) });
    await res.body?.cancel();
    return res.status === 206 || res.status === 200;
  } catch (e) {
    if (signal?.aborted) throw e;
    return false;
  }
}

/** YouTube's bot check becomes a message the window can act on. */
function signInHint(error, signedIn) {
  const msg = error?.message ?? "YouTube didn't answer";
  if (/not a bot|sign in|403|doesn't play|page needs to be reloaded/i.test(msg)) {
    const e = new Error(signedIn
      ? "YouTube is refusing this PC right now, even signed in. Try again in a while."
      : "YouTube wants you signed in to play this song on this PC.");
    e.code = signedIn ? "YOUTUBE_BLOCKED" : "YOUTUBE_SIGNIN";
    return e;
  }
  return error;
}
