// The fast lane, as LUMA for Android has it: ask YouTube's player API directly,
// as YouTube's own VR, iPhone, Vision Pro and iPad apps. One request (~0.4 s)
// instead of a yt-dlp run (~3 s). These clients get plain audio links with no
// cipher to solve; a link only counts once its last bytes download, because
// YouTube sometimes hands out links that stop after ~1 MB.
//
// On connections YouTube is strict with it says "sign in to confirm you're not
// a bot" to all of them, and the resolver falls back to yt-dlp.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Kept in step with LUMA for Android's InnerTubeVariant. */
export const CLIENTS = {
  ANDROID_VR: {
    nameId: "28",
    context: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceMake: "Oculus", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32 },
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220705.001.B1) gzip",
  },
  IOS: {
    nameId: "5",
    context: { clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" },
    userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  VISIONOS: {
    nameId: "101",
    context: { clientName: "VISIONOS", clientVersion: "0.1", deviceMake: "Apple", deviceModel: "RealityDevice14,1", osName: "visionOS", osVersion: "1.3.21O771" },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  },
  IPADOS: {
    nameId: "5",
    context: { clientName: "IOS", clientVersion: "19.22.3", deviceMake: "Apple", deviceModel: "iPad7,6", osName: "iPadOS", osVersion: "17.7.10.21H450" },
    userAgent: "com.google.ios.youtube/19.22.3 (iPad7,6; U; CPU iPadOS 17_7_10 like Mac OS X; en-US)",
  },
};
const ORDER = ["ANDROID_VR", "IOS", "VISIONOS", "IPADOS"];

export function createInnerTube({ fetchImpl = fetch, log = () => {} } = {}) {
  let winner = null;
  // When every client was just turned away, the connection is flagged: don't
  // spend four requests on each song until it has had a rest.
  let blockedUntil = 0;
  let missesInARow = 0;

  async function player(videoId, name, signal) {
    const c = CLIENTS[name];
    const res = await fetchImpl("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": c.userAgent,
        "X-YouTube-Client-Name": c.nameId,
        "X-YouTube-Client-Version": c.context.clientVersion,
        Origin: "https://www.youtube.com",
      },
      body: JSON.stringify({ videoId, contentCheckOk: true, racyCheckOk: true, context: { client: { ...c.context, hl: "en", gl: "US" } } }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000),
    });
    if (!res.ok) throw new Error(`${name} answered ${res.status}`);
    return res.json();
  }

  return {
    /** A whole-file audio link for [videoId], or null when no client gives one. */
    async audio(videoId, { signal, aac = false } = {}) {
      if (!VIDEO_ID.test(videoId) || Date.now() < blockedUntil) return null;
      const order = winner ? [winner, ...ORDER.filter((n) => n !== winner)] : ORDER;
      let botWalls = 0;
      for (const name of order) {
        signal?.throwIfAborted();
        try {
          const json = await player(videoId, name, signal);
          const status = json.playabilityStatus?.status;
          if (status !== "OK") {
            if (status === "LOGIN_REQUIRED") botWalls++;
            continue;
          }
          const format = bestAudio(json.streamingData?.adaptiveFormats ?? [], aac);
          if (!format) continue;
          const a = {
            url: format.url,
            codec: format.mimeType.includes("opus") ? "opus" : "aac",
            kbps: Math.round((format.averageBitrate ?? format.bitrate ?? 0) / 1000) || null,
            size: Number(format.contentLength) || null,
            userAgent: CLIENTS[name].userAgent,
          };
          if (!(await servesWholeFile(a, signal, fetchImpl))) continue;
          winner = name;
          missesInARow = 0;
          return a;
        } catch (e) {
          if (signal?.aborted) throw e;
          log(`innertube ${name}: ${e.message}`);
        }
      }
      // Every client failing on two songs running (bot walls, cut-off links) means a
      // connection YouTube is strict with: rest the lane for ten minutes.
      missesInARow++;
      if (botWalls >= ORDER.length - 1 || missesInARow >= 2) {
        blockedUntil = Date.now() + 10 * 60_000;
        missesInARow = 0;
      }
      return null;
    },
  };
}

/**
 * Opus 251/250 before AAC ([aac]: the other way round, for songs whose Opus
 * file won't play); direct links only (no cipher to solve).
 */
export function bestAudio(formats, aac = false) {
  const audio = formats.filter((f) => typeof f.url === "string" && f.mimeType?.startsWith("audio/"));
  const rank = (f) => (f.mimeType.includes("opus") !== aac ? 1_000_000 : 0) + (f.bitrate ?? 0);
  return audio.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

/** True when the end of the file downloads too. */
export async function servesWholeFile(a, signal, fetchImpl = fetch) {
  const headers = { "User-Agent": a.userAgent ?? "Mozilla/5.0" };
  headers.Range = a.size ? `bytes=${Math.max(0, a.size - 4096)}-${a.size - 1}` : "bytes=0-4095";
  try {
    const res = await fetchImpl(a.url, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6_000)]) : AbortSignal.timeout(6_000) });
    await res.body?.cancel();
    return res.status === 206 || res.status === 200;
  } catch (e) {
    if (signal?.aborted) throw e;
    return false;
  }
}
