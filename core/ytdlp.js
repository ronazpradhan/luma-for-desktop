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

  return {
    /** A playable audio URL for [videoId], with its codec and size. */
    async audio(videoId) {
      if (!VIDEO_ID.test(videoId)) throw new Error("not a YouTube video id");
      await ensure();
      const out = await run([
        "-f", "251/250/140/bestaudio",
        "--no-playlist", "--no-download", "--no-warnings",
        "--js-runtimes", `node:${process.execPath}`,
        "--print", "%(url)s",
        "--print", "%(acodec)s|%(abr)s|%(filesize,filesize_approx)s|%(ext)s",
        `https://music.youtube.com/watch?v=${videoId}`,
      ], 45_000);
      const [url, meta = ""] = out.trim().split("\n");
      if (!url?.startsWith("https://")) throw new Error("yt-dlp gave no audio URL");
      const [acodec, abr, size, ext] = meta.split("|");
      return { url, codec: acodec?.startsWith("opus") ? "opus" : (acodec || "audio"), kbps: Math.round(Number(abr)) || null, size: Number(size) || null, ext: ext || "webm" };
    },

    async version() {
      await ensure();
      return (await run(["--version"], 15_000)).trim();
    },
  };
}

