// JioSaavn: the first place LUMA looks for a song's audio. Its CDN serves plain
// AAC (320 kbps when the song has it) with no bot check, unlike YouTube.

import des from "des.js";

const API = "https://www.jiosaavn.com/api.php";
const CDN_HOST = "aac.saavncdn.com";
// JioSaavn's well-known web-player key for its encrypted media links.
const KEY = Buffer.from("38346591", "utf8");

export function createSaavn({ fetchImpl = fetch } = {}) {
  return {
    async search(query, limit = 10) {
      const url = new URL(API);
      Object.entries({ __call: "search.getResults", _format: "json", _marker: "0", ctx: "web6dot0", n: String(limit), p: "1", q: query })
        .forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.jiosaavn.com/" },
        redirect: "error",
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`JioSaavn search answered ${res.status}`);
      const json = await res.json();
      return (json.results ?? []).map(normalize).filter(Boolean);
    },
  };
}

// Search answers come flat (song, primary_artists, ... at the top) or nested
// under more_info, depending on the endpoint's mood; both are read.
function normalize(raw) {
  const info = { ...raw, ...(raw.more_info ?? {}) };
  const mapped = (info.artistMap?.primary_artists ?? []).map((a) => a.name ?? "");
  const listed = typeof info.primary_artists === "string" ? info.primary_artists.split(",") : [];
  const artists = (mapped.length ? mapped : listed).map((a) => decodeEntities(a).trim()).filter(Boolean);
  const url = mediaUrl(info.encrypted_media_url, String(info["320kbps"]) === "true");
  const title = decodeEntities(raw.song ?? raw.title ?? "");
  if (!raw.id || !title || !artists.length || !url) return null;
  return {
    id: raw.id,
    title,
    artists,
    album: decodeEntities(typeof info.album === "string" ? info.album : ""),
    duration: Number(info.duration) || null,
    language: raw.language ?? null,
    explicit: raw.explicit_content === "1",
    url,
  };
}

/** The CDN link from JioSaavn's DES-encrypted one, at 320 kbps when offered (else 160). */
export function mediaUrl(encrypted, has320) {
  if (!encrypted) return null;
  try {
    const cipher = des.DES.create({ type: "decrypt", key: KEY });
    const bytes = Buffer.from(cipher.update(Buffer.from(encrypted, "base64")).concat(cipher.final()));
    const template = bytes.toString("utf8");
    if (!template.includes("_96")) return null;
    const url = new URL(template.replace("_96", has320 ? "_320" : "_160"));
    return url.protocol === "https:" && url.host === CDN_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isSaavnMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === CDN_HOST;
  } catch {
    return false;
  }
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
