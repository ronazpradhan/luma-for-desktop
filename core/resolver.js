// Where a song's audio comes from: a downloaded file first, then JioSaavn
// (fast, no bot check), then YouTube through yt-dlp. One lookup per song at a
// time; answers are remembered until their links expire.

import { bestMatch } from "./match.js";

const SAAVN_TTL_MS = 6 * 3_600_000;
const YT_FALLBACK_TTL_MS = 5 * 3_600_000;

export function createResolver({ saavn, ytdlp, youtubeAuth = null, tmpDir = null, log = () => {} }) {
  const cache = new Map(); // video id -> { stream, expiresAt }
  const inFlight = new Map();

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

  async function viaYouTube(track) {
    const run = (cookieFile) => ytdlp.audio(track.id, { cookieFile });
    const a = youtubeAuth ? await youtubeAuth.withCookieFile(tmpDir, run) : await run(null);
    const expire = Number(new URL(a.url).searchParams.get("expire")) * 1000;
    return { source: "youtube", url: a.url, codec: a.codec, kbps: a.kbps, size: a.size, userAgent: a.userAgent, expiresAt: expire || Date.now() + YT_FALLBACK_TTL_MS };
  }

  async function lookUp(track) {
    const t0 = Date.now();
    const fromSaavn = await viaSaavn(track).catch((e) => {
      log(`jiosaavn failed for ${track.id}: ${e.message}`);
      return null;
    });
    const stream = fromSaavn ?? (await viaYouTube(track));
    log(`${stream.source} served "${track.title}" in ${Date.now() - t0} ms`);
    cache.set(track.id, { stream, expiresAt: stream.expiresAt });
    return stream;
  }

  return {
    cached,

    /** The stream for [track] ({ id, title, artist, duration }); throws when no source has it. */
    async resolve(track) {
      const hit = cached(track.id);
      if (hit) return hit;
      let job = inFlight.get(track.id);
      if (!job) {
        job = lookUp(track).finally(() => inFlight.delete(track.id));
        inFlight.set(track.id, job);
      }
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
