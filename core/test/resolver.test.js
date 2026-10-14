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
