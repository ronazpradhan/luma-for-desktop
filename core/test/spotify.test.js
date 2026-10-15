import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { extractClientVersion, parseTrack, totp } from "../spotify.js";
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
    await store.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
