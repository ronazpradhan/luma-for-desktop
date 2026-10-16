// Suggestions from what you actually listen to.
//   Quick picks: songs you play most, mixed with songs like them, new each day.
//   New releases: the latest singles and albums from the artists you play most.

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 21;

/** How much a song is "yours": plays, fading over weeks, plus a lift for liked songs. */
export function songScores(plays, likes, now = Date.now()) {
  const scores = new Map();
  for (const [id, p] of Object.entries(plays ?? {})) {
    const age = Math.max(0, (now - p.last) / DAY);
    scores.set(id, { track: p.track, score: p.n * 0.5 ** (age / HALF_LIFE_DAYS) });
  }
  for (const t of likes ?? []) {
    const s = scores.get(t.id);
    if (s) s.score += 1.5;
    else scores.set(t.id, { track: t, score: 1 });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/** Artists by the scores of their songs. Keyed by artist id when known, else by name. */
export function artistScores(songs) {
  const out = new Map();
  for (const { track, score } of songs) {
    const name = (track.artist ?? "").split(/,\s*|\s&\s/)[0].trim();
    if (!name) continue;
    const key = track.artistId || `name:${name.toLowerCase()}`;
    const a = out.get(key) ?? { id: track.artistId ?? null, name, score: 0 };
    a.score += score;
    if (!a.id && track.artistId) a.id = track.artistId;
    out.set(key, a);
  }
  return [...out.values()].sort((a, b) => b.score - a.score);
}

/** A repeatable random source: the same seed gives the same numbers (a day's picks hold still). */
export function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seeded(list, seed) {
  const rand = rng(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Seeds for "songs like these": drawn from your top songs, favourites more likely, different each day. */
export function pickSeeds(songs, count, seed) {
  const rand = rng(`seeds:${seed}`);
  const pool = songs.slice(0, 15).map((s) => ({ ...s }));
  const out = [];
  while (out.length < count && pool.length) {
    const total = pool.reduce((n, s) => n + s.score, 0);
    let r = rand() * total;
    const i = Math.max(0, pool.findIndex((s) => (r -= s.score) <= 0));
    out.push(pool.splice(i, 1)[0].track);
  }
  return out;
}

/**
 * Quick picks: about one in three is a song you play often, the rest are
 * similar songs you haven't played lately, interleaved.
 */
export function mixQuickPicks({ favourites, similar, recentIds, size = 24, seed }) {
  const fav = seeded(favourites.slice(0, 12), seed).slice(0, Math.round(size / 3));
  const seen = new Set(fav.map((t) => t.id));
  const fresh = [];
  for (const t of similar) {
    if (seen.has(t.id) || recentIds.has(t.id)) continue;
    seen.add(t.id);
    fresh.push(t);
  }
  const out = [];
  let f = 0;
  let s = 0;
  while (out.length < size && (f < fav.length || s < fresh.length)) {
    // Two new, one familiar.
    if (s < fresh.length) out.push(fresh[s++]);
    if (out.length < size && s < fresh.length) out.push(fresh[s++]);
    if (out.length < size && f < fav.length) out.push(fav[f++]);
  }
  return out;
}

/** The year in a tile's subtitle ("Single • 2026"), or null. */
export function yearOf(subtitle) {
  const m = /\b(19|20)\d{2}\b/.exec(subtitle ?? "");
  return m ? Number(m[0]) : null;
}

/**
 * New releases from your artists: their albums and singles from this year or
 * last, newest first, no artist taking more than two places in a row.
 */
export function pickReleases(pages, { year = new Date().getFullYear(), size = 16 } = {}) {
  const byArtist = pages.map(({ artist, page }) => {
    const items = (page?.shelves ?? [])
      .filter((s) => /album|single|ep\b|release/i.test(s.title))
      .flatMap((s) => s.items)
      .filter((i) => i.kind === "album")
      .map((i) => ({ ...i, year: yearOf(i.subtitle), artistName: artist.name }))
      .filter((i) => i.year && i.year >= year - 1);
    const seen = new Set();
    return items.filter((i) => !seen.has(i.id) && seen.add(i.id)).sort((a, b) => b.year - a.year);
  });
  // Round-robin across artists (already in order of how much you play them).
  const out = [];
  const ids = new Set();
  for (let round = 0; out.length < size && byArtist.some((l) => l.length > round); round++) {
    for (const list of byArtist) {
      const it = list[round];
      if (it && !ids.has(it.id) && out.length < size) {
        ids.add(it.id);
        out.push({ ...it, subtitle: `${it.artistName} · ${it.year}` });
      }
    }
  }
  return out.sort((a, b) => b.year - a.year);
}
