// The library on this PC: likes, playlists, play history, downloads and
// settings, in one JSON file. Writes are batched and atomic (temp file, then
// rename), so a crash mid-write never leaves a half-written library.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const HISTORY_CAP = 500;
const FIELDS = ["id", "title", "artist", "artistId", "album", "albumId", "duration", "art"];

const EMPTY = () => ({ version: 1, likes: [], playlists: [], history: [], plays: {}, downloads: {}, settings: { autoplay: true, volume: 0.8, hiddenYouTube: [] } });
const PLAYS_CAP = 3000;

/** A track reduced to what the library keeps, or null if it isn't one. */
export function cleanTrack(t) {
  if (!t || typeof t !== "object" || !/^[A-Za-z0-9_-]{11}$/.test(t.id ?? "") || typeof t.title !== "string") return null;
  const out = {};
  for (const f of FIELDS) {
    const v = t[f];
    if (v == null) out[f] = null;
    else if (f === "duration") out[f] = Number.isFinite(v) ? Math.round(v) : null;
    else out[f] = String(v).slice(0, 500);
  }
  if (out.art && !/^https:\/\//.test(out.art)) out.art = null;
  return out;
}

export async function openStore(dir) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "library.json");
  let data;
  try {
    data = { ...EMPTY(), ...JSON.parse(await readFile(file, "utf8")) };
    // Libraries from before play counts: start them from the history.
    if (!Object.keys(data.plays ?? {}).length && data.history.length) {
      data.plays = Object.fromEntries(data.history.map((h) => [h.track.id, { n: 1, last: h.at, track: h.track }]));
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      // Unreadable: keep it aside rather than overwrite what might be recovered.
      await rename(file, `${file}.broken-${Date.now()}`).catch(() => {});
    }
    data = EMPTY();
  }

  let timer = null;
  let writing = Promise.resolve();
  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      writing = writing.then(async () => {
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(data));
        await rename(tmp, file);
      }).catch(() => {});
    }, 250);
  }

  return {
    snapshot: () => data,

    async flush() {
      clearTimeout(timer);
      const tmp = `${file}.tmp`;
      await writing;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
    },

    isLiked: (id) => data.likes.some((t) => t.id === id),

    setLiked(track, liked) {
      data.likes = data.likes.filter((t) => t.id !== track.id);
      if (liked) data.likes.unshift(track);
      save();
    },

    recordPlay(track) {
      const now = Date.now();
      data.history = [{ track, at: now }, ...data.history.filter((h) => h.track.id !== track.id)].slice(0, HISTORY_CAP);
      // How often each song is played, for suggestions built from your taste.
      data.plays ??= {};
      const p = data.plays[track.id];
      data.plays[track.id] = { n: (p?.n ?? 0) + 1, last: now, track };
      const ids = Object.keys(data.plays);
      if (ids.length > PLAYS_CAP) {
        ids.sort((a, b) => data.plays[a].last - data.plays[b].last).slice(0, ids.length - PLAYS_CAP).forEach((id) => delete data.plays[id]);
      }
      save();
    },

    /** An imported playlist ([source] like "spotify:<id>"), replaced in place on each import. */
    /** Creates or refreshes the playlist imported from [source]; null when the listener deleted it. */
    upsertImported(source, name, tracks, art = null) {
      if (data.removedImports?.includes(source)) return null;
      let p = data.playlists.find((x) => x.source === source);
      if (p) {
        p.name = name.slice(0, 120) || p.name;
        p.tracks = tracks;
      } else {
        p = { id: randomUUID(), name: name.slice(0, 120) || "Imported playlist", tracks, createdAt: Date.now(), source };
        data.playlists.push(p);
      }
      if (art) p.coverArt = art;
      save();
      return p;
    },

    createPlaylist(name, tracks = []) {
      const p = { id: randomUUID(), name: name.slice(0, 120) || "New playlist", tracks, createdAt: Date.now() };
      data.playlists.unshift(p);
      save();
      return p;
    },

    playlist: (id) => data.playlists.find((p) => p.id === id) ?? null,

    renamePlaylist(id, name) {
      const p = data.playlists.find((x) => x.id === id);
      if (p) { p.name = name.slice(0, 120) || p.name; save(); }
      return p ?? null;
    },

    deletePlaylist(id) {
      const gone = data.playlists.find((p) => p.id === id);
      data.playlists = data.playlists.filter((p) => p.id !== id);
      // A deleted import stays deleted: importing again doesn't bring it back.
      if (gone?.source) data.removedImports = [...new Set([...(data.removedImports ?? []), gone.source])];
      save();
    },

    addToPlaylist(id, tracks) {
      const p = data.playlists.find((x) => x.id === id);
      if (!p) return null;
      const have = new Set(p.tracks.map((t) => t.id));
      p.tracks.push(...tracks.filter((t) => !have.has(t.id)));
      save();
      return p;
    },

    removeFromPlaylist(id, trackId) {
      const p = data.playlists.find((x) => x.id === id);
      if (!p) return null;
      p.tracks = p.tracks.filter((t) => t.id !== trackId);
      save();
      return p;
    },

    download: (id) => data.downloads[id] ?? null,

    /** Songs whose usual stream won't play: video id -> { strikes, noSaavn }. */
    brokenStreams: () => data.brokenStreams ?? {},

    setBrokenStream(id, entry) {
      data.brokenStreams = { ...(data.brokenStreams ?? {}), [id]: entry };
      // Only the latest few hundred matter.
      const ids = Object.keys(data.brokenStreams);
      for (const old of ids.slice(0, Math.max(0, ids.length - 500))) delete data.brokenStreams[old];
      save();
    },

    setDownload(id, entry) {
      if (entry) data.downloads[id] = entry;
      else delete data.downloads[id];
      save();
    },

    setSettings(patch) {
      data.settings = { ...data.settings, ...patch };
      save();
      return data.settings;
    },
  };
}
