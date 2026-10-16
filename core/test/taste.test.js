import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openStore } from "../store.js";
import { artistScores, mixQuickPicks, pickReleases, pickSeeds, seeded, songScores, yearOf } from "../taste.js";

const DAY = 86_400_000;
const now = Date.parse("2026-10-16T12:00:00Z");
const t = (id, artist, artistId) => ({ id, title: id, artist, artistId });

test("songs you play often and lately rank first; likes count too", () => {
  const plays = {
    often: { n: 20, last: now - 2 * DAY, track: t("often", "girl in red", "A1") },
    stale: { n: 20, last: now - 120 * DAY, track: t("stale", "Old Band", "A2") },
    once: { n: 1, last: now, track: t("once", "Djo", "A3") },
  };
  const s = songScores(plays, [t("liked", "Mitski", "A4")], now);
  assert.equal(s[0].track.id, "often");
  assert.ok(s.findIndex((x) => x.track.id === "stale") > s.findIndex((x) => x.track.id === "once") - 1);
  assert.ok(s.some((x) => x.track.id === "liked"));
});

test("artists add up their songs, keyed by id or name", () => {
  const a = artistScores([
    { track: t("a", "girl in red", "A1"), score: 5 },
    { track: t("b", "girl in red, Someone", "A1"), score: 3 },
    { track: t("c", "Djo"), score: 4 },
  ]);
  assert.equal(a[0].name, "girl in red");
  assert.equal(a[0].score, 8);
  assert.equal(a[1].id, null);
});

test("the same day gives the same picks; another day gives others", () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(seeded(list, "2026-10-16"), seeded(list, "2026-10-16"));
  assert.notDeepEqual(seeded(list, "2026-10-16"), seeded(list, "2026-10-17"));
  const songs = Array.from({ length: 20 }, (_, i) => ({ track: t(`s${i}`, "x"), score: 20 - i }));
  assert.equal(pickSeeds(songs, 3, "d").length, 3);
  assert.equal(new Set(pickSeeds(songs, 3, "d").map((x) => x.id)).size, 3);
});

test("quick picks: one familiar song in three, nothing you just heard", () => {
  const favourites = Array.from({ length: 12 }, (_, i) => t(`fav${i}`, "x"));
  const similar = [t("recent", "y"), ...Array.from({ length: 30 }, (_, i) => t(`new${i}`, "y"))];
  const picks = mixQuickPicks({ favourites, similar, recentIds: new Set(["recent"]), size: 24, seed: "d" });
  assert.equal(picks.length, 24);
  assert.equal(picks.filter((p) => p.id.startsWith("fav")).length, 8);
  assert.ok(!picks.some((p) => p.id === "recent"));
  assert.equal(new Set(picks.map((p) => p.id)).size, 24);
});

test("new releases: this year and last, newest first, artists take turns", () => {
  assert.equal(yearOf("Single • 2026"), 2026);
  const page = (items) => ({ shelves: [{ title: "Singles & EPs", items }, { title: "Videos", items: [{ kind: "video", id: "v" }] }] });
  const r = pickReleases([
    { artist: { name: "girl in red" }, page: page([{ kind: "album", id: "g1", title: "New", subtitle: "Single • 2026" }, { kind: "album", id: "g2", title: "Old", subtitle: "Album • 2019" }, { kind: "album", id: "g3", title: "Last year", subtitle: "EP • 2025" }]) },
    { artist: { name: "Djo" }, page: page([{ kind: "album", id: "d1", title: "Djo new", subtitle: "Single • 2026" }]) },
  ], { year: 2026 });
  assert.deepEqual(r.map((i) => i.id), ["g1", "d1", "g3"]);
  assert.equal(r[0].subtitle, "girl in red · 2026");
});

test("plays are counted, and old libraries start from their history", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-taste-"));
  try {
    await writeFile(path.join(dir, "library.json"), JSON.stringify({ history: [{ track: t("h1", "x"), at: now }] }));
    const store = await openStore(dir);
    assert.equal(store.snapshot().plays.h1.n, 1);
    store.recordPlay(t("h1", "x"));
    store.recordPlay(t("h1", "x"));
    assert.equal(store.snapshot().plays.h1.n, 3);
    await store.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
