import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openCache } from "../cache.js";

const song = (n) => Buffer.alloc(n, 1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("played songs are kept up to the limit, the longest-unplayed going first", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-cache-"));
  let limit = 2500;
  try {
    const c = await openCache({ dir, limit: () => limit });
    await c.add("aaaaaaaaaaa", song(1000), "m4a", "audio/mp4", { id: "aaaaaaaaaaa" });
    await wait(5);
    await c.add("bbbbbbbbbbb", song(1000), "webm", "audio/webm", { id: "bbbbbbbbbbb" });
    await wait(5);
    c.get("aaaaaaaaaaa"); // played again: now the freshest
    await wait(5);
    await c.add("ccccccccccc", song(1000), "m4a", "audio/mp4", { id: "ccccccccccc" });
    assert.ok(c.has("aaaaaaaaaaa"));
    assert.ok(!c.has("bbbbbbbbbbb"));
    assert.deepEqual(c.usage(), { bytes: 2000, songs: 2 });
    assert.equal(path.basename(c.get("ccccccccccc").path), "ccccccccccc.m4a");

    // The index survives a restart.
    await wait(400);
    const again = await openCache({ dir, limit: () => limit });
    assert.equal(again.usage().songs, 2);

    // A smaller limit trims at once; clearing removes the files too.
    limit = 1000;
    await again.trim();
    assert.equal(again.usage().songs, 1);
    await again.clear();
    await wait(400);
    assert.deepEqual((await readdir(dir)).filter((f) => !f.startsWith("index")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("nothing is kept when the cache is off", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-cache-"));
  try {
    const c = await openCache({ dir, limit: () => 0 });
    await c.add("aaaaaaaaaaa", song(10), "m4a", "audio/mp4", {});
    assert.equal(c.usage().songs, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
