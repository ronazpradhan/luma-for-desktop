// The YouTube fallback: the official yt-dlp.exe, fetched from yt-dlp's GitHub
// releases the first time a song needs it and checked against the release's
// published SHA-256 before it is ever run. YouTube's player challenges are
// solved with the JavaScript runtime LUMA already ships (Electron's Node).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
const BINARY = "yt-dlp.exe";
const UPDATE_EVERY_MS = 3 * 86_400_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const BROWSERS = ["firefox", "edge", "chrome", "brave"];
const label = (b) => ({ firefox: "Firefox", edge: "Edge", chrome: "Chrome", brave: "Brave" })[b] ?? b;

export function createYtDlp({ binDir, fetchImpl = fetch, log = () => {} }) {
  const bin = path.join(binDir, BINARY);
  let installing = null;

  async function download() {
    await mkdir(binDir, { recursive: true });
    log("yt-dlp: downloading the latest release");
    const [sums, exe] = await Promise.all([
      fetchImpl(`${RELEASE}/SHA2-256SUMS`, { signal: AbortSignal.timeout(30_000) }).then((r) => {
        if (!r.ok) throw new Error(`checksum list answered ${r.status}`);
        return r.text();
      }),
      fetchImpl(`${RELEASE}/${BINARY}`, { signal: AbortSignal.timeout(180_000) }).then(async (r) => {
        if (!r.ok) throw new Error(`yt-dlp download answered ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
      }),
    ]);
    const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, name]) => name === BINARY)?.[0];
    const actual = createHash("sha256").update(exe).digest("hex");
    if (!expected || expected.toLowerCase() !== actual) throw new Error("yt-dlp download failed its checksum; not using it");
    const tmp = `${bin}.part`;
    await writeFile(tmp, exe);
    await rename(tmp, bin);
    log("yt-dlp: installed and verified");
  }

  async function ensure() {
    const info = await stat(bin).catch(() => null);
    if (info && Date.now() - info.mtimeMs < UPDATE_EVERY_MS) return bin;
    if (!installing) {
      installing = download()
        .catch(async (e) => {
          // An older verified copy beats none.
          if (info) {
            log(`yt-dlp: update failed (${e.message}); keeping the installed copy`);
            return;
          }
          await rm(`${bin}.part`, { force: true });
          throw e;
        })
        .finally(() => { installing = null; });
    }
    await installing;
    return bin;
  }

  function run(args, timeoutMs) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }, (err, stdout, stderr) => {
        if (err) {
          const why = String(stderr).split("\n").find((l) => l.startsWith("ERROR")) ?? err.message;
          reject(new Error(why.trim()));
        } else resolve(String(stdout));
      });
    });
  }

  async function once(videoId, client, cookieFile) {
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
    const out = await run(args, 45_000);
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
     * tried in turn and a URL only counts once its last bytes download:
     * YouTube hands signed-out PCs links that refuse to play (403).
     * [cookieFile] is the signed-in session, when there is one.
     */
    async audio(videoId, { cookieFile = null } = {}) {
      if (!VIDEO_ID.test(videoId)) throw new Error("not a YouTube video id");
      await ensure();
      // Signed in, yt-dlp's own client choice uses the session; signed out,
      // android_vr needs no token and is the fastest when YouTube allows it.
      const plan = cookieFile ? [null, "tv"] : ["android_vr", null];
      let lastError = null;
      for (const client of plan) {
        try {
          const a = await once(videoId, client, cookieFile);
          if (await servesWholeFile(a)) return a;
          lastError = new Error("YouTube gave a link that doesn't play");
          log(`yt-dlp: ${client ?? "default"} link for ${videoId} failed the end-of-file check`);
        } catch (e) {
          lastError = e;
        }
      }
      throw signInHint(lastError, !!cookieFile);
    },

    /**
     * Copies [browser]'s cookie jar to [outFile] (Netscape format) through
     * yt-dlp's own reader. yt-dlp writes the jar on exit, even when the
     * lookup itself is turned away.
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
          throw new Error(browser === "chrome" || browser === "brave"
            ? `${label(browser)} keeps its sign-ins locked to itself. Try Firefox or Edge, or close ${label(browser)} and try again.`
            : `Couldn't read ${label(browser)}'s sign-in (${e.message}). Close ${label(browser)} and try again.`);
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
async function servesWholeFile(a, fetchImpl = fetch) {
  const headers = { "User-Agent": a.userAgent ?? "Mozilla/5.0" };
  headers.Range = a.size ? `bytes=${Math.max(0, a.size - 4096)}-${a.size - 1}` : "bytes=0-4095";
  try {
    const res = await fetchImpl(a.url, { headers, signal: AbortSignal.timeout(8_000) });
    await res.body?.cancel();
    return res.status === 206 || res.status === 200;
  } catch {
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
