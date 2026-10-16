import assert from "node:assert/strict";
import { test } from "node:test";
import { fromLrc, fromLyricsPlus, fromPlain, group, kugouClean, kugouKeyword, parseTtml, partName, ttmlTime } from "../lyrics.js";

test("LyricsPlus keeps its named sections and joins syllables into words", () => {
  const r = fromLyricsPlus({
    type: "Word",
    metadata: { source: "Apple", songParts: [{ name: "Verse", time: 0 }, { name: "Chorus", time: 4000 }] },
    lyrics: [
      { time: 1000, duration: 2000, text: "Hello world", syllabus: [{ time: 1000, duration: 400, text: "Hel" }, { time: 1400, duration: 400, text: "lo " }, { time: 1800, duration: 600, text: "world" }, { time: 2500, duration: 300, text: "(ooh)", isBackground: true }], element: { songPartIndex: 0 } },
      { time: 4000, duration: 2000, text: "Sing it", syllabus: [{ time: 4000, duration: 500, text: "Sing " }, { time: 4500, duration: 500, text: "it" }], element: { songPartIndex: 1 } },
    ],
  });
  assert.equal(r.wordSynced, true);
  assert.deepEqual(r.parts.map((p) => p.name), ["Verse", "Chorus"]);
  assert.deepEqual(r.lines[0].words.map((w) => w.text), ["Hello", "world"]);
  assert.equal(r.lines[0].text, "Hello world");
  assert.equal(r.lines[0].words[0].time, 1);
  assert.equal(r.lines[0].words[0].end, 1.8);
  assert.equal(r.lines[1].part, 1);
  assert.equal(fromLyricsPlus({ type: "None", lyrics: [] }), null);
});

test("Apple-style TTML: song parts, word spans, background vocals left out", () => {
  const xml = `<tt><body>
    <div itunes:songPart="Verse"><p begin="0:01.000" end="0:03.000"><span begin="0:01.000" end="0:01.500">Hel</span><span begin="0:01.500" end="0:02.000">lo</span> <span begin="0:02.000" end="0:03.000">there</span><span ttm:role="x-bg"><span begin="0:02.5" end="0:03">(hey)</span></span></p></div>
    <div itunes:songPart="Chorus"><p begin="10.5s" end="12s">We &amp; you</p></div>
  </body></tt>`;
  const r = parseTtml(xml);
  assert.deepEqual(r.parts.map((p) => p.name), ["Verse", "Chorus"]);
  assert.deepEqual(r.lines[0].words.map((w) => w.text), ["Hello", "there"]);
  assert.equal(r.lines[0].text, "Hello there");
  assert.equal(r.lines[1].text, "We & you");
  assert.equal(r.lines[1].time, 10.5);
  assert.equal(ttmlTime("00:01:02.5"), 62.5);
});

test("Enhanced LRC gives word timings; blank timed lines are stanza breaks", () => {
  const r = fromLrc("[00:01.00]<00:01.00>Hey <00:01.50>you\n[00:03.00]\n[00:04.00]Plain line");
  assert.equal(r.wordSynced, true);
  assert.deepEqual(r.lines[0].words.map((w) => w.text), ["Hey", "you"]);
  assert.equal(r.lines[0].text, "Hey you");
  const g = group(r);
  assert.equal(g.parts.length, 2);
});

test("Without named sections, the stanza that keeps coming back is the chorus", () => {
  const lrc = [
    "[00:01.00]walking down the road", "[00:04.00]sun is on my face", "[00:07.00]", // verse
    "[00:10.00]oh we fell in love", "[00:13.00]in october skies", "[00:16.00]", // chorus
    "[00:20.00]leaves are turning red", "[00:23.00]you are on my mind", "[00:26.00]", // verse
    "[00:30.00]oh we fell in love", "[00:33.00]in october skies", // chorus
  ].join("\n");
  const g = group(fromLrc(lrc));
  assert.deepEqual(g.parts.map((p) => p.name), [null, "Chorus", null, "Chorus"]);
  assert.equal(g.lines.find((l) => l.text === "in october skies").part, 1);
});

test("A long pause starts a new stanza even without blank lines", () => {
  const lrc = ["[00:01.00]a", "[00:03.00]b", "[00:05.00]c", "[00:20.00]d", "[00:22.00]e"].join("\n");
  assert.equal(group(fromLrc(lrc)).parts.length, 2);
});

test("Plain text: [Chorus] headers name stanzas and verses get numbers", () => {
  const g = group(fromPlain("[Verse]\nOne\nTwo\n\n[Chorus]\nLa la\nLa la la\n\n[Verse]\nThree\nFour"));
  assert.deepEqual(g.parts.map((p) => p.name), ["Verse 1", "Chorus", "Verse 2"]);
  assert.ok(!g.lines.some((l) => /\[/.test(l.text)));
});

test("Section names read well", () => {
  assert.equal(partName("PreChorus"), "Pre-chorus");
  assert.equal(partName("chorus"), "Chorus");
  assert.equal(partName("Verse2"), "Verse");
});

test("KuGou: keyword cleaned, credits cut, lyrics kept", () => {
  assert.equal(kugouKeyword("Those Eyes (Official Audio)", "New West, Someone"), "Those Eyes - New West、Someone");
  const raw = ["[00:00.00]作词：Someone", "[00:01.00]Lyrics by: X", "[00:05.00]real line one", "[00:08.00]She said: hello", "[00:11.00]real line three", "[00:14.00]real line four"].join("\n");
  const out = kugouClean(raw).split("\n");
  assert.equal(out[0], "[00:05.00]real line one");
  assert.ok(out.includes("[00:08.00]She said: hello"));
});

test("A network failure isn't remembered as 'no lyrics'", async () => {
  const { createLyrics } = await import("../lyrics.js");
  let calls = 0;
  const down = async () => { calls++; throw new Error("fetch failed"); };
  const l = createLyrics({ ytmusic: { lyricsRef: async () => null }, fetchImpl: down });
  const t = { id: "abcdefghijk", title: "x", artist: "y", duration: 100 };
  assert.equal(await l.get(t), null);
  const before = calls;
  await l.get(t);
  assert.ok(calls > before, "asked again after a failure");
});
