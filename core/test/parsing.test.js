import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLrc } from "../lyrics.js";
import { mediaUrl } from "../saavn.js";
import { cleanTrack } from "../store.js";
import { bestThumb, parseSongRow, toSeconds } from "../ytmusic.js";
import des from "des.js";

test("LRC lines come back in time order", () => {
  const lines = parseLrc("[00:12.50]second\n[00:01.00]first\n[01:02.00][01:30.00]twice");
  assert.deepEqual(lines.map((l) => l.time), [1, 12.5, 62, 90]);
  assert.equal(lines[0].text, "first");
});

test("JioSaavn links decrypt to the 320 kbps CDN file, and nothing else is accepted", () => {
  const enc = (s) => {
    const c = des.DES.create({ type: "encrypt", key: Buffer.from("38346591") });
    return Buffer.from(c.update(Buffer.from(s)).concat(c.final())).toString("base64");
  };
  assert.equal(mediaUrl(enc("https://aac.saavncdn.com/925/abc_96.mp4"), true), "https://aac.saavncdn.com/925/abc_320.mp4");
  assert.equal(mediaUrl(enc("https://aac.saavncdn.com/925/abc_96.mp4"), false), "https://aac.saavncdn.com/925/abc_160.mp4");
  assert.equal(mediaUrl(enc("https://evil.example/abc_96.mp4"), true), null);
  assert.equal(mediaUrl("not base64 at all", true), null);
});

test("the library keeps only clean track fields", () => {
  assert.equal(cleanTrack({ id: "../../etc", title: "x" }), null);
  const t = cleanTrack({ id: "V-uIp-WuD60", title: "Patient Zero", artist: "Taylor Swift", art: "javascript:alert(1)", extra: "dropped", duration: 225.7 });
  assert.equal(t.art, null);
  assert.equal(t.duration, 226);
  assert.equal("extra" in t, false);
});

test("durations and thumbnails", () => {
  assert.equal(toSeconds("3:46"), 226);
  assert.equal(toSeconds("1:02:03"), 3723);
  assert.equal(toSeconds("42M plays"), null);
  assert.equal(bestThumb([{ url: "https://yt3.googleusercontent.com/a=w120-h120-l90-rj" }]), "https://yt3.googleusercontent.com/a=w544-h544-l90-rj");
});

test("album rows take the album's artist, not the play count", () => {
  const row = {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: "ko70cExuzZM" },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "The Fate of Ophelia" }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "839M plays" }] } } },
      ],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: "3:47" }] } } }],
    },
  };
  const t = parseSongRow(row, { artist: "Taylor Swift" });
  assert.equal(t.artist, "Taylor Swift");
  assert.equal(t.duration, 227);
});

test("YouTube library: one Liked music, no Liked videos, no repeats", async () => {
  const { libraryTiles } = await import("../ytmusic.js");
  const pl = (id, title) => ({ kind: "playlist", id, title, subtitle: "", art: null });
  const out = libraryTiles([pl("LL", "Liked videos"), pl("LM", "Liked music"), pl("PL1", "Mine"), pl("PL1", "Mine"), { kind: "album", id: "MPRE1", title: "x" }]);
  assert.deepEqual(out.map((t) => t.id), ["LM", "PL1"]);
});
