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
  server = await startServer({ port: 0, key, dataDir: dir, musicDir: path.join(dir, "music"), log: () => {} });
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
