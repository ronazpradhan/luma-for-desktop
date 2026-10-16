// Songs you've played, kept on this PC so they start at once and play offline.
// Up to a size the listener picks in Settings; past it, the songs played
// longest ago go first. Downloads (Music\LUMA) are separate and never removed.

import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function openCache({ dir, limit, log = () => {} }) {
  const indexFile = path.join(dir, "index.json");
  let index = {}; // video id -> { file, type, size, at, track }
  try {
    index = JSON.parse(await readFile(indexFile, "utf8"));
  } catch { /* first run */ }
  let saving = null;

  function save() {
    saving ??= new Promise((r) => setTimeout(r, 300)).then(async () => {
      saving = null;
      await mkdir(dir, { recursive: true });
      const tmp = `${indexFile}.tmp`;
      await writeFile(tmp, JSON.stringify(index));
      await rename(tmp, indexFile);
    }).catch((e) => log(`cache index not saved: ${e.message}`));
    return saving;
  }

  const used = () => Object.values(index).reduce((n, e) => n + (e.size ?? 0), 0);

  /** Down to the limit, the songs played longest ago first. */
  async function trim() {
    const max = limit();
    let total = used();
    if (total <= max) return;
    for (const [id, e] of Object.entries(index).sort((a, b) => a[1].at - b[1].at)) {
      if (total <= max) break;
      await rm(path.join(dir, e.file), { force: true });
      delete index[id];
      total -= e.size ?? 0;
    }
    save();
  }

  return {
    /** The cached song as { path, type, size, track }, or null. Counts as a play for keeping. */
    get(id) {
      const e = index[id];
      if (!e) return null;
      e.at = Date.now();
      save();
      return { ...e, path: path.join(dir, e.file) };
    },

    has: (id) => id in index,

    async add(id, data, ext, type, track) {
      if (!VIDEO_ID.test(id) || data.length > limit()) return;
      await mkdir(dir, { recursive: true });
      const file = `${id}.${ext}`;
      await writeFile(path.join(dir, file), data);
      index[id] = { file, type, size: data.length, at: Date.now(), track };
      await trim();
      await save();
    },

    async drop(id) {
      const e = index[id];
      if (!e) return;
      delete index[id];
      await rm(path.join(dir, e.file), { force: true });
      await save();
    },

    async clear() {
      for (const e of Object.values(index)) await rm(path.join(dir, e.file), { force: true });
      index = {};
      await save();
    },

    trim,

    usage: () => ({ bytes: used(), songs: Object.keys(index).length }),

    /** Files the index lost track of (a crash mid-write) aren't counted; drop entries whose file is gone. */
    async check() {
      for (const [id, e] of Object.entries(index)) {
        if (!(await stat(path.join(dir, e.file)).catch(() => null))) delete index[id];
      }
      await save();
    },
  };
}
