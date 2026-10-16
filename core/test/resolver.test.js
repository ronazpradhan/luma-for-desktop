import assert from "node:assert/strict";
import { test } from "node:test";
import { createResolver } from "../resolver.js";

const track = { id: "V-uIp-WuD60", title: "Patient Zero", artist: "Taylor Swift", duration: 226 };
const saavnSong = { id: "s1", title: "Patient Zero", artists: ["Taylor Swift"], duration: 225, url: "https://aac.saavncdn.com/x_320.mp4" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeYt(delay) {
  const calls = { started: 0, aborted: 0 };
  return {
    calls,
    audio: async (_id, { signal } = {}) => {
      calls.started++;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal?.addEventListener("abort", () => { clearTimeout(t); calls.aborted++; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
      });
      return { url: "https://rr1.googlevideo.com/videoplayback?expire=9999999999", codec: "opus", kbps: 160, size: 1 };
    },
  };
}

test("a quick JioSaavn answer never starts YouTube", async () => {
  const ytdlp = fakeYt(50);
  const r = createResolver({ saavn: { search: async () => [saavnSong] }, ytdlp });
  assert.equal((await r.resolve(track)).source, "jiosaavn");
  await wait(800);
  assert.equal(ytdlp.calls.started, 0);
});

test("a slow JioSaavn hit stops the YouTube lookup it overlapped", async () => {
  const ytdlp = fakeYt(5_000);
  const r = createResolver({ saavn: { search: async () => { await wait(900); return [saavnSong]; } }, ytdlp });
  assert.equal((await r.resolve(track)).source, "jiosaavn");
  assert.equal(ytdlp.calls.started, 1);
  assert.equal(ytdlp.calls.aborted, 1);
});

test("a slow JioSaavn miss lets the already-running YouTube lookup finish", async () => {
  const ytdlp = fakeYt(300);
  const t0 = Date.now();
  const r = createResolver({ saavn: { search: async () => { await wait(1_200); return []; } }, ytdlp });
  assert.equal((await r.resolve(track)).source, "youtube");
  // YouTube began at 0.7 s and took 0.3 s, so it was ready when JioSaavn gave up at 1.2 s.
  assert.ok(Date.now() - t0 < 1_500, `took ${Date.now() - t0} ms`);
  assert.equal(ytdlp.calls.started, 1);
});

test("the fast lane serves a song JioSaavn lacks, without starting yt-dlp", async () => {
  const ytdlp = fakeYt(50);
  const innertube = { audio: async () => ({ url: "https://rr2.googlevideo.com/videoplayback?expire=9999999999", codec: "opus", kbps: 140, size: 10, userAgent: "ua" }) };
  const r = createResolver({ saavn: { search: async () => [] }, ytdlp, innertube });
  const s = await r.resolve(track);
  assert.equal(s.source, "youtube");
  assert.equal(s.userAgent, "ua");
  await wait(900);
  assert.equal(ytdlp.calls.started, 0);
});

test("a hover lookup never starts yt-dlp, and the click then does", async () => {
  const ytdlp = fakeYt(50);
  const r = createResolver({ saavn: { search: async () => [] }, ytdlp, innertube: { audio: async () => null } });
  assert.equal(await r.resolve(track, { light: true }), null);
  await wait(900);
  assert.equal(ytdlp.calls.started, 0);
  assert.equal((await r.resolve(track)).source, "youtube");
  assert.equal(ytdlp.calls.started, 1);
});

test("a click during a hover lookup takes its answer instead of starting again", async () => {
  let searches = 0;
  const r = createResolver({ saavn: { search: async () => { searches++; await wait(200); return [saavnSong]; } }, ytdlp: fakeYt(50) });
  const hover = r.resolve(track, { light: true });
  const click = r.resolve(track);
  assert.equal((await click).source, "jiosaavn");
  assert.equal((await hover).source, "jiosaavn");
  assert.equal(searches, 1);
});

test("a stream that won't play is swapped for AAC, then yt-dlp's, and remembered", async () => {
  const asked = [];
  const innertube = { audio: async (_id, { aac }) => { asked.push(`fast ${aac ? "aac" : "opus"}`); return { url: `https://rr2.googlevideo.com/videoplayback?expire=9999999999&c=${aac ? "aac" : "opus"}`, codec: aac ? "aac" : "opus", size: 10 }; } };
  const ytdlp = { audio: async (_id, { aac }) => { asked.push(`yt-dlp ${aac ? "aac" : "opus"}`); return { url: "https://rr3.googlevideo.com/videoplayback?expire=9999999999", codec: aac ? "aac" : "opus", size: 10 }; } };
  const remembered = {};
  const r = createResolver({ saavn: { search: async () => [] }, ytdlp, innertube, onBroken: (id, b) => (remembered[id] = b) });
  assert.equal((await r.resolve(track)).codec, "opus");
  // Asked again (the player's retry), never the same link.
  const second = await r.retry(track);
  assert.equal(second.codec, "aac");
  assert.match(second.url, /c=aac/);
  const third = await r.retry(track);
  assert.match(third.url, /rr3/);
  assert.deepEqual(asked, ["fast opus", "fast aac", "yt-dlp aac"]);
  assert.equal(remembered[track.id].strikes, 2);
  // After a restart the song goes straight to the file that plays.
  const again = createResolver({ saavn: { search: async () => [] }, ytdlp, innertube, brokenStreams: { [track.id]: { strikes: 1, noSaavn: false } } });
  assert.equal((await again.resolve(track)).codec, "aac");
});

test("a JioSaavn file that won't play falls back to YouTube", async () => {
  const innertube = { audio: async () => ({ url: "https://rr2.googlevideo.com/videoplayback?expire=9999999999", codec: "opus", size: 10 }) };
  const r = createResolver({ saavn: { search: async () => [saavnSong] }, ytdlp: fakeYt(50), innertube });
  assert.equal((await r.resolve(track)).source, "jiosaavn");
  const next = await r.retry(track);
  assert.equal(next.source, "youtube");
  assert.equal(next.codec, "opus");
});
