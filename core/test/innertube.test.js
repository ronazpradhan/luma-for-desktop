import assert from "node:assert/strict";
import { test } from "node:test";
import { bestAudio, createInnerTube } from "../innertube.js";

test("opus is preferred and ciphered formats are skipped", () => {
  const f = bestAudio([
    { mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, url: "https://a/140" },
    { mimeType: 'audio/webm; codecs="opus"', bitrate: 120000, url: "https://a/251" },
    { mimeType: 'audio/webm; codecs="opus"', bitrate: 160000, signatureCipher: "s=..." },
    { mimeType: 'video/mp4; codecs="avc1"', bitrate: 900000, url: "https://a/video" },
  ]);
  assert.equal(f.url, "https://a/251");
});

test("a link that stops before the end is refused, and a flagged connection is left alone for a while", async () => {
  let players = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("/player")) {
      players++;
      return new Response(JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
    }
    return new Response(null, { status: 403 });
  };
  const it = createInnerTube({ fetchImpl });
  assert.equal(await it.audio("V-uIp-WuD60"), null);
  assert.equal(players, 4);
  assert.equal(await it.audio("V-uIp-WuD60"), null);
  assert.equal(players, 4, "asked again right after every client was turned away");
});

test("the client that served goes first next time", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("/player")) {
      const name = JSON.parse(init.body).context.client.clientName;
      seen.push(name);
      if (name !== "VISIONOS") return new Response(JSON.stringify({ playabilityStatus: { status: "UNPLAYABLE" } }));
      return new Response(JSON.stringify({ playabilityStatus: { status: "OK" }, streamingData: { adaptiveFormats: [{ mimeType: 'audio/webm; codecs="opus"', bitrate: 1, contentLength: "100", url: "https://rr.googlevideo.com/x?expire=1" }] } }));
    }
    return new Response("x", { status: 206 });
  };
  const it = createInnerTube({ fetchImpl });
  assert.ok(await it.audio("V-uIp-WuD60"));
  seen.length = 0;
  assert.ok(await it.audio("TUVcZfQe-Kw"));
  assert.deepEqual(seen, ["VISIONOS"]);
});

test("AAC first when a song's Opus file won't play", async () => {
  const formats = [
    { url: "https://x/251", mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000 },
    { url: "https://x/140", mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130_000 },
  ];
  assert.match(bestAudio(formats).url, /251/);
  assert.match(bestAudio(formats, true).url, /140/);
});
