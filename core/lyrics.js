// Lyrics: time-synced from LRCLIB when it has them, else YouTube Music's plain text.

const LRCLIB = "https://lrclib.net/api";

export function createLyrics({ ytmusic, fetchImpl = fetch, version = "0.1.0" }) {
  async function lrclib(path, params) {
    const url = new URL(`${LRCLIB}/${path}`);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
    const res = await fetchImpl(url, {
      headers: { "User-Agent": `LUMA Desktop ${version} (https://github.com/ronazpradhan/LUMA)` },
      signal: AbortSignal.timeout(6_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB answered ${res.status}`);
    return res.json();
  }

  return {
    async get(track) {
      const artist = (track.artist ?? "").split(",")[0].trim();
      const exact = await lrclib("get", { track_name: track.title, artist_name: artist, album_name: track.album, duration: track.duration }).catch(() => null);
      let hit = exact?.syncedLyrics || exact?.plainLyrics ? exact : null;
      if (!hit) {
        const found = await lrclib("search", { track_name: track.title, artist_name: artist }).catch(() => null);
        hit = (found ?? []).find((r) => r.syncedLyrics && (!track.duration || Math.abs(r.duration - track.duration) <= 4)) ?? null;
      }
      if (hit?.syncedLyrics) return { synced: true, lines: parseLrc(hit.syncedLyrics) };
      if (hit?.plainLyrics) return { synced: false, lines: plainLines(hit.plainLyrics) };
      const ref = await ytmusic.lyricsRef(track.id).catch(() => null);
      const text = ref ? await ytmusic.plainLyrics(ref).catch(() => null) : null;
      return text ? { synced: false, lines: plainLines(text) } : null;
    },
  };
}

export function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split("\n")) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function plainLines(text) {
  return text.split("\n").map((t) => ({ time: null, text: t.trim() }));
}
