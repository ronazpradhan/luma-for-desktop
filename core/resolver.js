// Where a song's audio comes from: a downloaded file first, then JioSaavn
// (fast, no bot check) and YouTube's player API directly (LUMA for Android's
// fast lane), both at once; yt-dlp only when neither has it. One lookup per
// song at a time; answers are remembered until their links expire.

import { bestMatch } from "./match.js";

const SAAVN_TTL_MS = 6 * 3_600_000;
const YT_FALLBACK_TTL_MS = 5 * 3_600_000;
/** yt-dlp never starts before this, so a JioSaavn answer (0.2-0.6 s) can still win. */
const HEDGE_MS = 700;
/** How long a ready YouTube link waits for a JioSaavn answer still on its way. */
const SAAVN_GRACE_MS = 250;

export function createResolver({ saavn, ytdlp, innertube = null, mobileWeb = null, youtubeAuth = null, tmpDir = null, log = () => {}, brokenStreams = {}, onBroken = () => {} }) {
  const cache = new Map(); // video id -> { stream, expiresAt }
  const inFlight = new Map(); // video id -> { light, job }
  // Songs whose stream wouldn't play: video id -> { strikes, noSaavn }. The next
  // lookup takes another file: AAC instead of Opus, then yt-dlp's link.
  const broken = new Map(Object.entries(brokenStreams).map(([id, b]) => [id, { ...b }]));

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

  /** YouTube's app clients first (Android's fast lane), then its mobile website (Spotube's way). */
  const preferAac = (track) => (broken.get(track.id)?.strikes ?? 0) >= 1;

  async function viaFastLane(track, signal) {
    if ((broken.get(track.id)?.strikes ?? 0) >= 2) return null;
    const aac = preferAac(track);
    // Both at once: the app clients' Opus is preferred, but the mobile website
    // doesn't wait for them to be turned away.
    const quiet = (job) => job.catch((e) => {
      if (signal?.aborted) throw e;
      return null;
    });
    const apps = innertube ? quiet(innertube.audio(track.id, { signal, aac })) : Promise.resolve(null);
    const web = mobileWeb ? quiet(mobileWeb.audio(track.id, { signal, aac })) : Promise.resolve(null);
    const first = await Promise.race([apps.then((a) => ({ from: "apps", a })), web.then((a) => ({ from: "web", a }))]);
    let pick;
    if (first.from === "apps") pick = first.a ?? (await web);
    else pick = (await Promise.race([apps, new Promise((r) => setTimeout(() => r(undefined), 150))])) || first.a || (await apps);
    return pick ? youTubeStream(pick) : null;
  }

  async function viaYtDlp(track, signal) {
    const run = (cookieFile) => ytdlp.audio(track.id, { cookieFile, signal, aac: preferAac(track) });
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
    const saavnJob = (broken.get(track.id)?.noSaavn ? Promise.resolve(null) : viaSaavn(track))
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

    // Whichever answers first; a ready YouTube link waits only SAAVN_GRACE_MS for
    // JioSaavn (as on Android), which is preferred when it does answer in time.
    const first = await Promise.race([saavnJob.then((s) => ({ from: "saavn", s })), fastJob.then((s) => ({ from: "fast", s }))]);
    let stream;
    if (first.from === "saavn") {
      stream = first.s ?? (await fastJob);
    } else if (first.s) {
      const late = await Promise.race([saavnJob, new Promise((r) => setTimeout(() => r(null), SAAVN_GRACE_MS))]);
      stream = late ?? first.s;
    } else {
      stream = (await saavnJob) ?? null;
    }
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

    /**
     * The player couldn't play [track]'s stream (it jumped to the end or
     * errored): looks it up again for a different file, never the same link.
     */
    async retry(track) {
      const was = cache.get(track.id)?.stream;
      cache.delete(track.id);
      const b = broken.get(track.id) ?? { strikes: 0, noSaavn: false };
      if (was?.source === "jiosaavn") b.noSaavn = true;
      else b.strikes++;
      broken.set(track.id, b);
      onBroken(track.id, { ...b });
      log(`retrying "${track.title}" (${track.id}) after ${was ? `${was.source} ${was.codec}` : "a broken stream"} failed: ${b.strikes >= 2 ? "yt-dlp, AAC" : b.strikes ? "AAC" : "YouTube"}`);
      await inFlight.get(track.id)?.job.catch(() => null);
      cache.delete(track.id);
      return this.resolve(track);
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
