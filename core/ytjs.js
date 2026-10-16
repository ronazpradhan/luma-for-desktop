// The mobile-web lane, the way Spotube's YouTube plugin works (YoutubeExplode
// there, YouTube.js here): ask YouTube as its mobile website (MWEB), solve the
// player's link puzzle in-process, and keep the session warm, so a lookup is
// one ~0.3 s request instead of a ~8 s yt-dlp run. It works signed out on
// connections where YouTube turns its app clients away.
//
// YouTube's player code runs in a bare V8 context (node:vm): no require,
// process, fetch or file access, and at most two seconds.

import vm from "node:vm";
import { Innertube, Platform, UniversalCache } from "youtubei.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SESSION_TTL_MS = 6 * 3_600_000; // YouTube ships a new player a few times a day
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

Platform.shim.eval = async (data, env) => {
  const parts = [];
  if (env.n) parts.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) parts.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  const code = `(function () {\n${data.output}\nreturn { ${parts.join(", ")} };\n})()`;
  return vm.runInNewContext(code, Object.create(null), { timeout: 2000, microtaskMode: "afterEvaluate" });
};

export function createYtJs({ log = () => {}, fetchImpl = fetch } = {}) {
  let session = null; // { yt, at }

  async function client() {
    if (session && Date.now() - session.at < SESSION_TTL_MS) return session.yt;
    const job = Innertube.create({ retrieve_player: true, generate_session_locally: true, cache: new UniversalCache(false) });
    session = { yt: job, at: Date.now() };
    try {
      session.yt = await job;
      return session.yt;
    } catch (e) {
      session = null;
      throw e;
    }
  }

  return {
    /** Starts the session ahead of the first song. */
    warmUp: () => client().then(() => true, (e) => { log(`mobile web lane not ready: ${e.message}`); return false; }),

    /**
     * A whole-file audio link for [videoId]: the best audio-only stream when
     * YouTube lets it play to the end, else the small combined file (itag 18,
     * AAC ~96 kbps) that it serves without a sign-in. Null when neither plays.
     */
    async audio(videoId, { signal, aac = false } = {}) {
      if (!VIDEO_ID.test(videoId)) return null;
      const yt = await client();
      signal?.throwIfAborted();
      const info = await yt.getBasicInfo(videoId, { client: "MWEB" });
      if (info.playability_status?.status !== "OK") return null;
      const all = [...(info.streaming_data?.adaptive_formats ?? []), ...(info.streaming_data?.formats ?? [])];
      const audioOnly = all.filter((f) => f.has_audio && !f.has_video).sort((a, b) => rank(b, aac) - rank(a, aac));
      const combined = all.find((f) => f.itag === 18);
      // Both candidates are checked at once; the audio-only stream wins when it plays to the end.
      const checks = [audioOnly[0], combined].filter(Boolean).map(async (f) => {
        let url;
        try {
          url = await f.decipher(yt.session.player);
        } catch (e) {
          log(`mobile web lane couldn't unlock itag ${f.itag}: ${e.message}`);
          return null;
        }
        const size = await wholeFileSize(url, Number(f.content_length) || null, signal, fetchImpl);
        if (!size) return null;
        return {
          url,
          codec: f.mime_type?.includes("opus") ? "opus" : "aac",
          kbps: f.has_video ? 96 : Math.round((f.average_bitrate ?? f.bitrate ?? 0) / 1000) || null,
          size,
          userAgent: UA,
        };
      });
      for (const result of await Promise.all(checks)) if (result) return result;
      return null;
    },
  };
}

function rank(f, aac) {
  return (Boolean(f.mime_type?.includes("opus")) !== aac ? 1_000_000 : 0) + (f.bitrate ?? 0);
}

/**
 * The file's real size if its last bytes download, else null. YouTube's listed
 * size is sometimes off, so the first byte's Content-Range gives the truth.
 */
async function wholeFileSize(url, listed, signal, fetchImpl) {
  const opts = (range) => ({ headers: { Range: range, "User-Agent": UA }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000) });
  try {
    let size = listed;
    if (!size) {
      const head = await fetchImpl(url, opts("bytes=0-0"));
      await head.body?.cancel();
      if (head.status !== 206) return null;
      size = Number(head.headers.get("content-range")?.split("/")[1]) || null;
      if (!size) return null;
    }
    const tail = await fetchImpl(url, opts(`bytes=${Math.max(0, size - 4096)}-${size - 1}`));
    await tail.body?.cancel();
    if (tail.status === 206) return size;
    if (tail.status === 416 && listed) return wholeFileSize(url, null, signal, fetchImpl);
    return null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}
