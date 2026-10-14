import assert from "node:assert/strict";
import { test } from "node:test";
import { bestMatch } from "../match.js";

const song = (title, artists, duration, extra = {}) => ({ id: title, title, artists, duration, url: "https://aac.saavncdn.com/x_320.mp4", ...extra });

test("picks the same recording", () => {
  const hit = bestMatch({ title: "Patient Zero", artist: "Taylor Swift", duration: 226 }, [
    song("Patient Zero", ["Taylor Swift"], 225),
    song("Patient Zero", ["Gull Hart"], 166),
  ]);
  assert.equal(hit?.artists[0], "Taylor Swift");
});

test("a remix is not the original", () => {
  assert.equal(bestMatch({ title: "Levitating", artist: "Dua Lipa", duration: 203 }, [song("Levitating (Remix)", ["Dua Lipa"], 203)]), null);
});

test("a different length is a different recording", () => {
  assert.equal(bestMatch({ title: "Tum Hi Ho", artist: "Arijit Singh", duration: 262 }, [song("Tum Hi Ho", ["Arijit Singh"], 330)]), null);
});

test("credits with several artists still match one of them", () => {
  const hit = bestMatch({ title: "Tum Hi Ho", artist: "Arijit Singh", duration: 262 }, [song("Tum Hi Ho", ["Mithoon", "Arijit Singh"], 262)]);
  assert.ok(hit);
});

test("the wrong artist is refused", () => {
  assert.equal(bestMatch({ title: "Runaway", artist: "AURORA", duration: 251 }, [song("Runaway", ["Kanye West"], 251)]), null);
});

test("film-song decorations don't hide a match", () => {
  const hit = bestMatch({ title: "Apna Bana Le (From \"Bhediya\")", artist: "Arijit Singh", duration: 264 }, [song("Apna Bana Le", ["Sachin-Jigar", "Arijit Singh"], 264)]);
  assert.ok(hit);
});
