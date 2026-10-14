// Where a song's audio comes from: a downloaded file first, then JioSaavn
// (fast, no bot check) and YouTube's player API directly (LUMA for Android's
// fast lane), both at once; yt-dlp only when neither has it. One lookup per
// song at a time; answers are remembered until their links expire.

import { bestMatch } from "./match.js";

const SAAVN_TTL_MS = 6 * 3_600_000;
const YT_FALLBACK_TTL_MS = 5 * 3_600_000;
/** yt-dlp never starts before this, so a JioSaavn answer (0.2-0.6 s) can still win. */
const HEDGE_MS = 700;

export function createResolver({ saavn, ytdlp, innertube = null, youtubeAuth = null, tmpDir = null, log = () => {} }) {
  const cache = new Map(); // video id -> { stream, expiresAt }
  const inFlight = new Map(); // video id -> { light, job }

  function cached(id) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.stream;
    cache.delete(id);
    return null;
  }

  async function viaSaavn(track) {
    const artist = (track.artist ?? "").split(",")[0];
    const query = `${track.title.replace(/\((feat|ft|with)[^)]*\)/i, "")} ${artist}`.trim();
    const songs = await saavn.search(query, 10);
    const song = bestMatch(track, songs);
    if (!song) return null;
    return {
      source: "jiosaavn",
      url: song.url,
      codec: "aac",
      kbps: song.url.includes("_320") ? 320 : 160,
      expiresAt: Date.now() + SAAVN_TTL_MS,
    };
  }

  function youTubeStream(a) {
    const expire = Number(new URL(a.url).searchParams.get("expire")) * 1000;
    return { source: "youtube", url: a.url, codec: a.codec, kbps: a.kbps, size: a.size, userAgent: a.userAgent, expiresAt: expire || Date.now() + YT_FALLBACK_TTL_MS };
  }

  async function viaFastLane(track, signal) {
    if (!innertube) return null;
    const a = await innertube.audio(track.id, { signal });
    return a ? youTubeStream(a) : null;
  }

  async function viaYtDlp(track, signal) {
    const run = (cookieFile) => ytdlp.audio(track.id, { cookieFile, signal });
    return youTubeStream(youtubeAuth ? await youtubeAuth.withCookieFile(tmpDir, run) : await run(null));
  }

  /**
   * JioSaavn and the fast lane race from the start; JioSaavn is preferred when
   * both answer (AAC 320, no expiry). yt-dlp starts once the fast lane has
   * missed and JioSaavn still has nothing, but not before HEDGE_MS. [light]
   * lookups (hovering a song) never start yt-dlp.
   */
  async function lookUp(track, light) {
    const t0 = Date.now();
    const stop = new AbortController();
    let saavnSettled = false;
    let ytdlpJob = null;
    const startYtDlp = () => {
      if (light || saavnSettled === "hit") return null;
      return (ytdlpJob ??= viaYtDlp(track, stop.signal));
    };
    const saavnJob = viaSaavn(track)
      .catch((e) => {
        log(`jiosaavn failed for ${track.id}: ${e.message}`);
        return null;
      })
      .then((s) => {
        saavnSettled = s ? "hit" : "miss";
        return s;
      });
    const fastJob = viaFastLane(track, stop.signal).catch((e) => {
      if (!stop.signal.aborted) log(`fast lane failed for ${track.id}: ${e.message}`);
      return null;
    });
    // The moment the fast lane misses, yt-dlp may begin (from HEDGE_MS on).
    fastJob.then((f) => {
      if (f || light) return;
      const wait = Math.max(0, HEDGE_MS - (Date.now() - t0));
      setTimeout(() => saavnSettled !== "hit" && startYtDlp()?.catch(() => {}), wait);
    });

    let stream = await saavnJob;
    if (!stream) stream = await fastJob;
    if (stream) {
      stop.abort();
      ytdlpJob?.catch(() => {});
    } else if (light) {
      return null;
    } else {
      stream = await startYtDlp();
    }
    log(`${stream.source} served "${track.title}" in ${Date.now() - t0} ms${light ? " (ahead of a click)" : ""}`);
    cache.set(track.id, { stream, expiresAt: stream.expiresAt });
    return stream;
  }

  return {
    cached,

    /**
     * The stream for [track] ({ id, title, artist, duration }). Throws when no
     * source has it; a [light] lookup returns null instead.
     */
    async resolve(track, { light = false } = {}) {
      const hit = cached(track.id);
      if (hit) return hit;
      const running = inFlight.get(track.id);
      if (running && (light || !running.light)) return running.job;
      if (running) {
        // A hover lookup is already on it: its answer may be all we need.
        const early = await running.job.catch(() => null);
        if (early) return early;
      }
      const job = lookUp(track, light).finally(() => {
        if (inFlight.get(track.id)?.job === job) inFlight.delete(track.id);
      });
      inFlight.set(track.id, { light, job });
      return job;
    },

    /** Drops a link that stopped working, so the next play looks again. */
    forget(id) {
      cache.delete(id);
    },

    /** After signing in or out, YouTube links from the other state are stale. */
    forgetYouTube() {
      for (const [id, hit] of cache) if (hit.stream.source === "youtube") cache.delete(id);
    },
  };
}
