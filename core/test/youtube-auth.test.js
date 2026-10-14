import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isSignedInJar, netscape, openYouTubeAuth, parseNetscape } from "../youtube-auth.js";

const JAR = [
  "# Netscape HTTP Cookie File",
  ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tabc",
  "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1999999999\t__Secure-3PSID\tdef",
  ".google.com\tTRUE\t/\tTRUE\t1999999999\tSID\tghi",
  ".bank.example\tTRUE\t/\tTRUE\t1999999999\tsession\tsecret",
  "",
].join("\n");

test("cookies.txt parses, HttpOnly lines included", () => {
  const c = parseNetscape(JAR);
  assert.equal(c.length, 4);
  assert.equal(c.find((x) => x.name === "__Secure-3PSID")?.httpOnly, true);
  assert.equal(isSignedInJar(c), true);
  assert.equal(isSignedInJar(c.filter((x) => x.name !== "SAPISID")), false);
});

test("only YouTube and Google cookies are kept, encrypted at rest, and the yt-dlp file is removed after use", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-auth-"));
  const vault = { encrypt: (t) => Buffer.from([...Buffer.from(t)].map((b) => b ^ 0x5a)), decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString() };
  try {
    const auth = await openYouTubeAuth({ dataDir: dir, vault });
    await auth.set(parseNetscape(JAR));
    const onDisk = await readFile(path.join(dir, "youtube-session.bin"));
    assert.equal(onDisk.includes(Buffer.from("SAPISID")), false, "stored in the clear");
    let seen = "";
    await auth.withCookieFile(dir, async (file) => { seen = await readFile(file, "utf8"); });
    assert.match(seen, /SAPISID\tabc/);
    assert.doesNotMatch(seen, /bank\.example/);
    assert.deepEqual((await readdir(dir)).filter((f) => f.startsWith("yt-cookies")), []);
    const again = await openYouTubeAuth({ dataDir: dir, vault });
    assert.equal(again.signedIn(), true);
    await again.clear();
    assert.equal((await openYouTubeAuth({ dataDir: dir, vault })).signedIn(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without Windows' protection nothing is written to disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "luma-auth-"));
  try {
    const auth = await openYouTubeAuth({ dataDir: dir, vault: null });
    await auth.set(parseNetscape(JAR));
    assert.equal(auth.signedIn(), true);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("netscape output round-trips", () => {
  const c = parseNetscape(JAR).filter((x) => x.domain.endsWith("youtube.com"));
  assert.deepEqual(parseNetscape(netscape(c)).map((x) => x.name), c.map((x) => x.name));
});
