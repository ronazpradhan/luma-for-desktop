// Lyrics from several providers, best first, all turned into one shape:
//   { synced, wordSynced, source, lines: [{ time, end, text, words?, part }], parts: [{ name }] }
// Times are seconds; `part` indexes `parts`, the song's sections (Verse,
// Chorus, …). Providers that name sections (LyricsPlus, Apple-style TTML) keep
// their names; otherwise stanzas come from blank lines and pauses, and the
// stanza that keeps coming back is marked as the chorus.
//
// Providers, in order of preference:
//   LyricsPlus (YouLy+'s backend): word timing and named sections
//   Unison (Better Lyrics' crowdsourced library), by YouTube video id
//   SimpMusic Lyrics, by YouTube video id
//   LRCLIB
//   KuGou (ported from LUMA for Android)
//   YouTube Music's own text (untimed), last
// Answers are cached on this PC so each song is asked for once.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const LRCLIB = "https://lrclib.net/api";
const UNISON = "https://unison.betterlyrics.org/lyrics";
const SIMPMUSIC = "https://api-lyrics.simpmusic.org/v1";
const KUGOU_SEARCH = "https://mobileservice.kugou.com/api/v3/search/song";
const KUGOU_LYRICS = "https://lyrics.kugou.com";
// YouLy+'s public LyricsPlus servers. Listeners can name their own in Settings.
export const LYRICSPLUS_SERVERS = ["https://lyricsplus.prjktla.workers.dev", "https://lyricsplus.binimum.org"];
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const CACHE_MAX = 1500;
const MISS_TTL_MS = 24 * 3_600_000;

export function createLyrics({ ytmusic, fetchImpl = fetch, version = "0.1.0", dataDir = null, server = () => null, log = () => {} }) {
  const UA = `LUMA Desktop ${version} (https://github.com/ronazpradhan/luma-for-desktop)`;
  const cacheFile = dataDir ? path.join(dataDir, "lyrics-cache.json") : null;
  let cache = null; // id -> { at, result }
  let saving = null;

  async function loadCache() {
    if (cache) return cache;
    cache = new Map();
    if (!cacheFile) return cache;
    try {
      for (const [k, v] of Object.entries(JSON.parse(await readFile(cacheFile, "utf8")))) cache.set(k, v);
    } catch { /* first run */ }
    return cache;
  }
  function saveCache() {
    if (!cacheFile || saving) return;
    saving = setTimeout(async () => {
      saving = null;
      const entries = [...cache.entries()].slice(-CACHE_MAX);
      await writeFile(cacheFile, JSON.stringify(Object.fromEntries(entries))).catch(() => {});
    }, 2_000);
  }

  async function json(url, { headers = {}, timeout = 8_000 } = {}) {
    const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeout) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    return res.json();
  }

  const artistOf = (t) => (t.artist ?? "").split(",")[0].trim();

  const providers = {
    async lyricsplus(t) {
      const own = server();
      for (const base of own ? [own] : LYRICSPLUS_SERVERS) {
        const q = new URLSearchParams({ title: t.title, artist: artistOf(t) });
        if (t.album) q.set("album", t.album);
        if (t.duration) q.set("duration", String(t.duration));
        const data = await json(`${base.replace(/\/$/, "")}/v2/lyrics/get?${q}`).catch((e) => { log(`lyricsplus ${base}: ${e.message}`); return undefined; });
        if (data === undefined) continue; // that server failed: try the next
        return data ? fromLyricsPlus(data) : null;
      }
      throw new Error("no LyricsPlus server answered");
    },

    async unison(t) {
      if (!/^[\w-]{11}$/.test(t.id)) return null;
      const q = new URLSearchParams({ v: t.id, song: t.title, artist: artistOf(t) });
      if (t.duration) q.set("duration", String(Math.round(t.duration)));
      if (t.album) q.set("album", t.album);
      const data = (await json(`${UNISON}?${q}`))?.data;
      if (!data?.lyrics) return null;
      const r = data.format === "ttml" ? parseTtml(data.lyrics) : data.format === "lrc" ? fromLrc(data.lyrics) : fromPlain(data.lyrics);
      return r && { ...r, source: "Unison (Better Lyrics)" };
    },

    async simpmusic(t) {
      if (!/^[\w-]{11}$/.test(t.id)) return null;
      const data = await json(`${SIMPMUSIC}/${t.id}`);
      const hit = Array.isArray(data?.data) ? data.data[0] : data?.data;
      if (!hit) return null;
      const r = (hit.richSyncLyrics && fromLrc(hit.richSyncLyrics)) || (hit.syncedLyrics && fromLrc(hit.syncedLyrics)) || (hit.plainLyric && fromPlain(hit.plainLyric));
      return r && { ...r, source: "SimpMusic Lyrics" };
    },

    async lrclib(t) {
      const ask = (p, params) => {
        const url = new URL(`${LRCLIB}/${p}`);
        Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
        return json(url);
      };
      const exact = await ask("get", { track_name: t.title, artist_name: artistOf(t), album_name: t.album, duration: t.duration }).catch(() => null);
      let hit = exact?.syncedLyrics || exact?.plainLyrics ? exact : null;
      if (!hit) {
        const found = await ask("search", { track_name: t.title, artist_name: artistOf(t) });
        hit = (found ?? []).find((r) => r.syncedLyrics && (!t.duration || Math.abs(r.duration - t.duration) <= 4)) ?? null;
      }
      const r = (hit?.syncedLyrics && fromLrc(hit.syncedLyrics)) || (hit?.plainLyrics && fromPlain(hit.plainLyrics));
      return r && { ...r, source: "LRCLIB" };
    },

    async kugou(t) {
      const kw = kugouKeyword(t.title, t.artist ?? "");
      const headers = { "User-Agent": BROWSER_UA };
      const songs = (await json(`${KUGOU_SEARCH}?${new URLSearchParams({ version: "9108", plat: "0", pagesize: "8", showtype: "0", keyword: kw })}`, { headers }))?.data?.info ?? [];
      const candidatesFor = async (params) => {
        const r = await json(`${KUGOU_LYRICS}/search?${new URLSearchParams({ ver: "1", man: "yes", client: "pc", ...params })}`, { headers });
        return (r?.candidates ?? []).sort((a, b) => (b.product_from === "官方推荐歌词") - (a.product_from === "官方推荐歌词"));
      };
      let pick = null;
      for (const s of songs) {
        if (t.duration && Math.abs((s.duration ?? 0) - t.duration) > 8) continue;
        pick = (await candidatesFor({ hash: s.hash }))[0];
        if (pick) break;
      }
      pick ??= (await candidatesFor({ keyword: kw, ...(t.duration ? { duration: String(t.duration * 1000) } : {}) }))[0];
      if (!pick) return null;
      const dl = await json(`${KUGOU_LYRICS}/download?${new URLSearchParams({ fmt: "lrc", charset: "utf8", client: "pc", ver: "1", id: String(pick.id), accesskey: pick.accesskey ?? "" })}`, { headers });
      const lrc = dl?.content ? kugouClean(Buffer.from(dl.content, "base64").toString("utf8")) : "";
      const r = lrc && fromLrc(lrc);
      return r && { ...r, source: "KuGou" };
    },

    async youtube(t) {
      const ref = await ytmusic.lyricsRef(t.id).catch(() => null);
      const text = ref ? await ytmusic.plainLyrics(ref).catch(() => null) : null;
      const r = text && fromPlain(text);
      return r && { ...r, source: "YouTube Music" };
    },
  };

  /**
   * The first timed answer in preference order; else the first untimed one.
   * `failed` counts providers that couldn't be asked (as opposed to "no lyrics"),
   * so a network hiccup is never remembered as a song without lyrics.
   */
  async function find(track) {
    let failed = 0;
    const ask = (name) => providers[name](track).catch((e) => { failed++; log(`lyrics ${name}: ${e.message}`); return null; });
    const settled = await Promise.all(["lyricsplus", "unison", "simpmusic", "lrclib"].map(ask));
    let best = settled.find((r) => r?.synced) ?? null;
    if (!best) best = (await ask("kugou")) ?? null;
    if (!best?.synced) best = settled.find(Boolean) ?? best ?? (await ask("youtube"));
    if (!best) return { result: null, failed };
    const grouped = group(best);
    return { result: { ...grouped, lines: grouped.lines.filter((l) => l.text) }, failed };
  }

  return {
    async get(track) {
      const c = await loadCache();
      const hit = c.get(track.id);
      if (hit && (hit.result || Date.now() - hit.at < MISS_TTL_MS)) return hit.result;
      const { result, failed } = await find(track);
      if (result || !failed) {
        c.delete(track.id);
        c.set(track.id, { at: Date.now(), result });
        saveCache();
      }
      log(`lyrics for "${track.title}": ${result ? `${result.source}, ${result.wordSynced ? "word-synced" : result.synced ? "line-synced" : "untimed"}, ${result.parts.length} sections` : "none found"}`);
      return result;
    },
  };
}

// ---- provider formats -----------------------------------------------------------

/** LyricsPlus v2: lines with syllables, and named song parts. */
export function fromLyricsPlus(data) {
  if (!Array.isArray(data?.lyrics) || !data.lyrics.length || data.type === "None") return null;
  const parts = (data.metadata?.songParts ?? []).map((p) => ({ name: partName(p.name) }));
  const word = data.type === "Word";
  const lines = data.lyrics
    .map((l) => {
      const time = Number(l.time) / 1000;
      const end = (Number(l.time) + Number(l.duration ?? 0)) / 1000;
      // Background vocals stay out of the main line.
      const sylls = Array.isArray(l.syllabus) ? l.syllabus.filter((s) => !s.isBackground) : [];
      const words = word && sylls.length ? mergeSyllables(sylls.map((s) => ({ text: s.text, time: s.time / 1000, end: (s.time + s.duration) / 1000 }))) : undefined;
      const text = (words ? words.map((w) => w.text).join(" ") : l.text ?? "").trim();
      const part = Number.isInteger(l.element?.songPartIndex) && parts[l.element.songPartIndex] ? l.element.songPartIndex : undefined;
      return { time, end: end > time ? end : undefined, text, words, part };
    })
    .filter((l) => l.text);
  if (!lines.length) return null;
  return { synced: true, wordSynced: !!word, source: `LyricsPlus${data.metadata?.source ? ` (${data.metadata.source})` : ""}`, lines, parts: parts.length ? parts : [] };
}

/** Syllables run together until one ends with a space: words for the sweep. */
function mergeSyllables(sylls) {
  const words = [];
  let cur = null;
  for (const s of sylls) {
    const ends = /\s$/.test(s.text);
    const text = s.text.trim();
    if (!cur) cur = { text: "", time: s.time, end: s.end };
    cur.text += text;
    cur.end = s.end;
    if (ends) { if (cur.text) words.push(cur); cur = null; }
  }
  if (cur?.text) words.push(cur);
  return words;
}

/** Apple-style TTML: <div itunes:songPart="Chorus"> holding <p begin end> lines, with <span> words when word-timed. */
export function parseTtml(xml) {
  const parts = [];
  const lines = [];
  let wordSynced = false;
  const divs = [...xml.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div>/g)];
  const blocks = divs.length ? divs : [[null, "", xml]];
  for (const [, attrs, body] of blocks) {
    const name = attr(attrs ?? "", "itunes:songPart") ?? attr(attrs ?? "", "songPart");
    const partIndex = parts.push({ name: name ? partName(name) : null }) - 1;
    for (const [, pAttrs, inner] of body.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const time = ttmlTime(attr(pAttrs, "begin"));
      if (time == null) continue;
      const end = ttmlTime(attr(pAttrs, "end"));
      // Background vocals (x-bg) are kept out of the main line.
      const main = inner.replace(/<span[^>]*ttm:role="x-bg"[^>]*>[\s\S]*?<\/span>\s*<\/span>|<span[^>]*ttm:role="x-bg"[^>]*>[\s\S]*?<\/span>/g, "");
      const spans = [...main.matchAll(/<span\b([^>]*)>([^<]*)<\/span>(\s*)/g)].filter((m) => attr(m[1], "begin"));
      let words;
      if (spans.length) {
        wordSynced = true;
        words = mergeSyllables(spans.map((m) => ({ text: decode(m[2]) + (m[3] ? " " : ""), time: ttmlTime(attr(m[1], "begin")), end: ttmlTime(attr(m[1], "end")) })));
      }
      const text = (words ? words.map((w) => w.text).join(" ") : decode(main.replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
      if (text) lines.push({ time, end: end ?? undefined, text, words, part: partIndex });
    }
  }
  if (!lines.length) return null;
  const named = parts.some((p) => p.name);
  return { synced: true, wordSynced, source: "TTML", lines: named ? lines : lines.map(({ part, ...l }) => l), parts: named ? parts : [] };
}

function attr(attrs, name) {
  return new RegExp(`${name.replace(":", "\\:")}="([^"]*)"`).exec(attrs)?.[1] ?? null;
}

/** "1:02.5", "00:01:02.500", "62.5s", "62.5" -> seconds. */
export function ttmlTime(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/s$/.test(s)) return Number(s.slice(0, -1));
  const bits = s.split(":").map(Number);
  if (bits.some((n) => !Number.isFinite(n))) return null;
  return bits.reduce((acc, n) => acc * 60 + n, 0);
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

/** Plain timed lines, as older code and tests expect. */
export function parseLrc(lrc) {
  return (fromLrc(lrc)?.lines ?? []).map(({ time, text }) => ({ time, text }));
}

/** LRC, including enhanced LRC with <mm:ss.xx> word stamps. Blank timed lines become stanza breaks. */
export function fromLrc(lrc) {
  const lines = [];
  let wordSynced = false;
  for (const raw of String(lrc).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const body = raw.replace(/\[[^\]]*\]/g, "");
    const wordMarks = [...body.matchAll(/<(\d+):(\d+(?:[.:]\d+)?)>([^<]*)/g)];
    let words;
    if (wordMarks.length) {
      wordSynced = true;
      const ws = wordMarks.map((m) => ({ time: Number(m[1]) * 60 + Number(m[2].replace(":", ".")), text: m[3] }));
      words = ws.map((w, i) => ({ text: w.text.trim(), time: w.time, end: ws[i + 1]?.time ?? w.time + 0.6 })).filter((w) => w.text);
    }
    const text = body.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    for (const m of stamps) lines.push({ time: Number(m[1]) * 60 + Number(m[2].replace(":", ".")), text, words });
  }
  lines.sort((a, b) => a.time - b.time);
  if (!lines.some((l) => l.text)) return null;
  return { synced: true, wordSynced, source: "LRC", lines, parts: [] };
}

/** Untimed text: blank lines are stanza breaks; [Chorus]-style headers name them. */
export function fromPlain(text) {
  const lines = String(text).split(/\r?\n/).map((t) => ({ time: null, text: t.trim() }));
  if (!lines.some((l) => l.text)) return null;
  return { synced: false, wordSynced: false, source: "Text", lines, parts: [] };
}

// ---- sections -----------------------------------------------------------------

const PART_NAMES = { verse: "Verse", chorus: "Chorus", prechorus: "Pre-chorus", "pre-chorus": "Pre-chorus", bridge: "Bridge", intro: "Intro", outro: "Outro", hook: "Hook", refrain: "Refrain", postchorus: "Post-chorus", "post-chorus": "Post-chorus", interlude: "Interlude", breakdown: "Breakdown", instrumental: "Instrumental", rap: "Rap" };

export function partName(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().replace(/[\s_]+/g, "").replace(/\d+$/, "");
  return PART_NAMES[key] ?? String(name).replace(/([a-z])([A-Z])/g, "$1-$2");
}

const HEADER = /^\[?\(?\s*(verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|intro|outro|hook|refrain|interlude|breakdown|rap)\b[^\]\)]*\]?\)?:?$/i;

/**
 * Gives every line a section. Provider sections are kept (verses numbered);
 * otherwise stanzas split at blank lines, [Chorus]-style headers and long
 * pauses, and the stanza that repeats most is the chorus.
 */
export function group(result) {
  if (result.parts?.length && result.lines.some((l) => l.part != null)) return numberVerses(result);

  const stanzas = [];
  let cur = null;
  const median = medianGap(result.lines);
  let prev = null;
  for (const l of result.lines) {
    const header = HEADER.exec(l.text);
    if (!l.text || header) {
      if (cur?.lines.length) stanzas.push(cur);
      cur = header ? { name: partName(header[1]), lines: [] } : null;
      continue;
    }
    // A pause much longer than this song's usual line-to-line gap starts a new stanza.
    if (cur?.lines.length && l.time != null && prev?.time != null && median && l.time - prev.time > Math.max(5, median * 2.2)) {
      stanzas.push(cur);
      cur = null;
    }
    cur ??= { name: null, lines: [] };
    cur.lines.push(l);
    prev = l;
  }
  if (cur?.lines.length) stanzas.push(cur);
  if (!stanzas.length) return { ...result, parts: [] };

  // The chorus: the stanza whose lines come back most often.
  if (!stanzas.some((s) => s.name)) {
    const keys = stanzas.map((s) => new Set(s.lines.map((l) => norm(l.text))));
    const counts = keys.map((k) => keys.filter((o) => k.size >= 2 && jaccard(k, o) >= 0.6).length);
    const top = Math.max(...counts);
    if (top >= 2) counts.forEach((c, i) => { if (c === top) stanzas[i].name = "Chorus"; });
  }

  const parts = [];
  const lines = [];
  stanzas.forEach((s) => {
    const part = parts.push({ name: s.name }) - 1;
    s.lines.forEach((l) => lines.push({ ...l, part }));
  });
  return numberVerses({ ...result, lines, parts });
}

/** "Verse", "Verse", "Verse" -> "Verse 1", "Verse 2", "Verse 3" (only when there's more than one). */
function numberVerses(result) {
  const verses = result.parts.filter((p) => p.name === "Verse").length;
  if (verses < 2) return result;
  let n = 0;
  return { ...result, parts: result.parts.map((p) => (p.name === "Verse" ? { name: `Verse ${++n}` } : p)) };
}

function medianGap(lines) {
  const t = lines.filter((l) => l.time != null && l.text).map((l) => l.time);
  const gaps = t.slice(1).map((x, i) => x - t[i]).filter((g) => g > 0).sort((a, b) => a - b);
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
function jaccard(a, b) {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared || 1);
}

// ---- KuGou helpers (LUMA for Android's KugouLyricsSource) ------------------------

export function kugouKeyword(title, artist) {
  const t = title.replace(/\(.*?\)|（.*?）|「.*?」|『.*?』|<.*?>|《.*?》|〈.*?〉|＜.*?＞|\[.*?\]/g, "").replace(/\s+/g, " ").trim();
  const a = artist.replace(/, /g, "、").replace(/ & /g, "、").replace(/\./g, "").replace(/\(.*?\)|（.*?）/g, "").replace(/\s+/g, " ").trim();
  return `${t} - ${a}`;
}

const CREDIT = /^\[\d\d:\d\d\.\d{2,3}\]\s*(?:[\p{Script=Han}\p{Script=Hangul}]{1,6}|(?:lyrics?|lyricist|words|music|composer|composed|written|producer|produced|arranger|arranged|arrangement|mix|mixed|mixing|master|mastered|mastering|vocals?|guitars?|bass|drums|keys|keyboards?|piano|strings|engineer|engineered|recorded|recording|artist|album|title|song|feat|ft|op|sp)(?:\s+by)?)\s*[:：].+/iu;

/** Timed lines only, credit lines (作词: …, Lyrics by: …) cut from the head and tail. */
export function kugouClean(raw) {
  const lines = raw.replace(/&apos;/g, "'").split(/\r?\n/).filter((l) => /^\[\d\d:\d\d\.\d{2,3}\]/.test(l));
  if (!lines.length) return "";
  const region = Math.min(30, Math.floor(lines.length / 2));
  let head = 0;
  for (let i = region - 1; i >= 0; i--) if (CREDIT.test(lines[i])) { head = i + 1; break; }
  let tail = 0;
  for (let i = region - 1; i >= 0; i--) if (CREDIT.test(lines[lines.length - 1 - i])) { tail = i + 1; break; }
  return lines.slice(head, lines.length - tail).join("\n");
}
