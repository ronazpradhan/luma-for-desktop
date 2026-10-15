import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { cleanSpDc, extractClientVersion, libraryItem, parseTrack, spDcFromJar, totp } from "../spotify.js";
import { parseNetscape } from "../youtube-auth.js";
import { openStore } from "../store.js";

test("the web player's TOTP (checked against an independent implementation)", () => {
  assert.equal(totp(1792000000), "215796");
  assert.equal(totp(1700000000), "371599");
});

test("a Spotify track keeps what's needed to find it on YouTube Music", () => {
  const t = parseTrack({
    uri: "spotify:track:abc",
    name: "Patient Zero",
    artists: { items: [{ profile: { name: "Taylor Swift" } }] },
    trackDuration: { totalMilliseconds: 225_900 },
    albumOfTrack: { name: "The Life of a Showgirl", coverArt: { sources: [{ url: "https://i.scdn.co/image/x" }] } },
  });
  assert.deepEqual(t, { spotifyId: "abc", title: "Patient Zero", artist: "Taylor Swift", album: "The Life of a Showgirl", duration: 226, art: "https://i.scdn.co/image/x" });
  assert.equal(parseTrack({ uri: "spotify:episode:1", name: "x", artists: { items: [{ profile: { name: "y" } }] } }), null);
});

test("the client version comes from the page or its base64 config", () => {
  assert.equal(extractClientVersion('<script>{"clientVersion":"1.2.99.1.gabc"}</script>'), "1.2.99.1.gabc");
  const b64 = Buffer.from('{"clientVersion":"1.2.100.5.gdef"}').toString("base64");
  assert.equal(extractClientVersion(`<script id="appServerConfig" type="text/plain">${b64}</script>`), "1.2.100.5.gdef");
});

test("an imported playlist is replaced in place, not duplicated", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-store-"));
  try {
    const store = await openStore(dir);
    const a = store.upsertImported("spotify:liked", "Liked Songs (Spotify)", [{ id: "V-uIp-WuD60", title: "Patient Zero" }]);
    const b = store.upsertImported("spotify:liked", "Liked Songs (Spotify)", []);
    assert.equal(a.id, b.id);
    assert.equal(store.snapshot().playlists.length, 1);
    assert.equal(store.snapshot().playlists[0].tracks.length, 0);
    // Deleted by the listener: the next import leaves it deleted.
    store.deletePlaylist(a.id);
    assert.equal(store.upsertImported("spotify:liked", "Liked Songs (Spotify)", [{ id: "V-uIp-WuD60", title: "Patient Zero" }]), null);
    assert.equal(store.snapshot().playlists.length, 0);
    await store.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const SP_DC = "AQBx3kZ_9fLm-2QwErTyUiOpAsDfGhJkLzXcVbNm1234567890abcdefGHIJ";

test("a pasted sp_dc is accepted bare, as name=value, or inside a Cookie header", () => {
  assert.equal(cleanSpDc(SP_DC), SP_DC);
  assert.equal(cleanSpDc(`  "${SP_DC}"\n`), SP_DC);
  assert.equal(cleanSpDc(`sp_dc=${SP_DC}`), SP_DC);
  assert.equal(cleanSpDc(`sp_t=abc; sp_dc=${SP_DC}; sp_key=x`), SP_DC);
  assert.equal(cleanSpDc("sp_t=abc; sp_key=x"), null);
  assert.equal(cleanSpDc("hello"), null);
  assert.equal(cleanSpDc(""), null);
});

test("sp_dc is found in a cookies file, and only Spotify's counts", () => {
  const jar = parseNetscape([
    "# Netscape HTTP Cookie File",
    `.youtube.com\tTRUE\t/\tTRUE\t0\tsp_dc\tnot-this-one`,
    `#HttpOnly_.spotify.com\tTRUE\t/\tTRUE\t1893456000\tsp_dc\t${SP_DC}`,
  ].join("\n"));
  assert.equal(spDcFromJar(jar), SP_DC);
  assert.equal(spDcFromJar(parseNetscape(".spotify.com\tTRUE\t/\tTRUE\t0\tsp_t\tx")), null);
});

test("a Liked Songs item whose uri is only on the wrapper still counts (as on Android)", () => {
  const t = libraryItem({
    addedAt: { isoString: "2026-10-01T10:00:00Z" },
    track: {
      _uri: "spotify:track:oct",
      data: { name: "we fell in love in october", artists: { items: [{ profile: { name: "girl in red" } }] }, trackDuration: { totalMilliseconds: 184_000 } },
    },
  });
  assert.equal(t?.spotifyId, "oct");
  assert.equal(t?.title, "we fell in love in october");
  assert.equal(libraryItem({ track: { _uri: "spotify:episode:1", data: { name: "x", artists: { items: [{ profile: { name: "y" } }] } } } }), null);
});
