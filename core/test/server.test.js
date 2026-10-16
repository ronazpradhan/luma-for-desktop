import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startServer } from "../server.js";

const key = "k".repeat(64);
let server;
let dir;
let base;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "luma-test-"));
  server = await startServer({ port: 0, key, dataDir: dir, musicDir: path.join(dir, "music"), warmUp: false, log: () => {} });
  base = `http://127.0.0.1:${server.port}`;
});
after(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test("no key, no answer", async () => {
  assert.equal((await fetch(`${base}/api/library`)).status, 401);
  assert.equal((await fetch(`${base}/api/library`, { headers: { "x-luma-key": "wrong" } })).status, 401);
});

test("websites can't use the engine", async () => {
  const res = await fetch(`${base}/api/library`, { headers: { "x-luma-key": key, Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
});

test("only LUMA's own host name is answered", async () => {
  // fetch won't set Host, so speak HTTP directly.
  const net = await import("node:net");
  const reply = await new Promise((resolve) => {
    const s = net.connect(server.port, "127.0.0.1", () => s.end(`GET /api/library HTTP/1.1\r\nHost: evil.example\r\nx-luma-key: ${key}\r\n\r\n`));
    let out = "";
    s.on("data", (d) => (out += d));
    s.on("end", () => resolve(out));
  });
  assert.match(reply, /^HTTP\/1\.1 421/);
});

test("images only from the music services' image hosts", async () => {
  const res = await fetch(`${base}/img?k=${key}&u=${encodeURIComponent("https://evil.example/x.png")}`);
  assert.equal(res.status, 403);
  const local = await fetch(`${base}/img?k=${key}&u=${encodeURIComponent("http://127.0.0.1:22/")}`);
  assert.equal(local.status, 403);
});

test("likes and playlists round-trip", async () => {
  const h = { "x-luma-key": key, "Content-Type": "application/json" };
  const track = { id: "V-uIp-WuD60", title: "Patient Zero", artist: "Taylor Swift" };
  let lib = await (await fetch(`${base}/api/like`, { method: "POST", headers: h, body: JSON.stringify({ track, liked: true }) })).json();
  assert.equal(lib.likes[0].id, track.id);
  const made = await (await fetch(`${base}/api/playlists`, { method: "POST", headers: h, body: JSON.stringify({ name: "Night drive", tracks: [track] }) })).json();
  assert.equal(made.created.tracks.length, 1);
  lib = await (await fetch(`${base}/api/playlists/${made.created.id}/tracks/${track.id}`, { method: "DELETE", headers: h })).json();
  assert.equal(lib.playlists[0].tracks.length, 0);
});

test("bad ids and bodies are refused", async () => {
  const h = { "x-luma-key": key, "Content-Type": "application/json" };
  assert.equal((await fetch(`${base}/api/radio/..%2F..%2Fetc`, { headers: h })).status, 400);
  assert.equal((await fetch(`${base}/api/like`, { method: "POST", headers: h, body: "{not json" })).status, 400);
  assert.equal((await fetch(`${base}/api/like`, { method: "POST", headers: { "x-luma-key": key }, body: "{}" })).status, 415);
  assert.equal((await fetch(`${base}/stream/not-an-id?k=${key}`)).status, 400);
});

test("cover art is asked for at a sharp size", async () => {
  const { sharperArt } = await import("../server.js");
  assert.equal(sharperArt("https://lh3.googleusercontent.com/abc=w60-h60-l90-rj"), "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj");
  assert.equal(sharperArt("https://yt3.ggpht.com/xyz=s120"), "https://yt3.ggpht.com/xyz=w544-h544-l90-rj");
  assert.equal(sharperArt("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg?sqp=abc"), "https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg");
  assert.equal(sharperArt("https://c.saavncdn.com/123/Song-English-2024-150x150.jpg"), "https://c.saavncdn.com/123/Song-English-2024-500x500.jpg");
  assert.equal(sharperArt("https://i.scdn.co/image/ab67"), "https://i.scdn.co/image/ab67");
});

test("downloads are recognised as audio by their first bytes", async () => {
  const { looksLikeAudio } = await import("../server.js");
  assert.ok(looksLikeAudio(Buffer.from("1a45dfa3a34286810142f7810142f2", "hex")));
  assert.ok(looksLikeAudio(Buffer.from("00000020667479704d344120", "hex")));
  assert.ok(!looksLikeAudio(Buffer.from("<html><body>nope</body></html>")));
  assert.ok(!looksLikeAudio(Buffer.alloc(0)));
});

test("a damaged download is dropped instead of played", async () => {
  const { mkdir, writeFile, stat } = await import("node:fs/promises");
  const d = await mkdtemp(path.join(tmpdir(), "luma-test-"));
  const music = path.join(d, "music");
  await mkdir(music);
  const track = { id: "FJX0JPXD2nM", title: "we fell in love in october", artist: "girl in red", duration: 184 };
  const cut = path.join(music, "cut.webm");
  // A real WebM header, then a few KB: the rest never arrived.
  await writeFile(cut, Buffer.concat([Buffer.from("1a45dfa3a34286810142f7810142f2", "hex"), Buffer.alloc(8000)]));
  const good = path.join(music, "good.m4a");
  await writeFile(good, Buffer.concat([Buffer.from("00000020667479704d344120", "hex"), Buffer.alloc(184 * 6000)]));
  const goodTrack = { id: "V-uIp-WuD60", title: "Patient Zero", artist: "Taylor Swift", duration: 184 };
  await writeFile(path.join(d, "library.json"), JSON.stringify({
    downloads: {
      [track.id]: { path: cut, type: "audio/webm", size: 8015, track, at: 1 },
      [goodTrack.id]: { path: good, type: "audio/mp4", size: 184 * 6000 + 12, track: goodTrack, at: 2 },
    },
  }));
  const s = await startServer({ port: 0, key, dataDir: d, musicDir: music, warmUp: false, log: () => {} });
  try {
    const at = `http://127.0.0.1:${s.port}`;
    const h = { "x-luma-key": key, "Content-Type": "application/json" };
    const ok = await (await fetch(`${at}/api/resolve`, { method: "POST", headers: h, body: JSON.stringify({ track: goodTrack }) })).json();
    assert.equal(ok.source, "download");
    // The cut one streams (or fails to here, offline) but is never served from disk again.
    const res = await fetch(`${at}/api/resolve`, { method: "POST", headers: h, body: JSON.stringify({ track }) });
    if (res.ok) assert.notEqual((await res.json()).source, "download");
    const lib = await (await fetch(`${at}/api/library`, { headers: h })).json();
    assert.ok(!lib.downloads[track.id]);
    assert.ok(lib.downloads[goodTrack.id]);
    assert.equal(await stat(cut).catch(() => null), null);
  } finally {
    await s.close();
    await rm(d, { recursive: true, force: true });
  }
});
