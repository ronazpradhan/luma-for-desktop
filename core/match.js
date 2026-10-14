// Is this JioSaavn song the recording the listener picked on YouTube Music?
// The same rules as LUMA for Android (JioSaavnMatcher), trimmed: the version
// must agree (a remix is not the original), title and artist must be close,
// and the length within a few seconds.

const VERSION_MARKERS = [
  "live", "remix", "acoustic", "instrumental", "karaoke", "cover", "sped up", "slowed",
  "reverb", "lofi", "lo fi", "unplugged", "demo", "edit", "extended", "mashup", "reprise",
];

const MIN_TITLE = 0.5;
const MIN_ARTIST = 0.34;
const MIN_SCORE = 0.62;
const MIN_MARGIN = 0.04;

export function normalize(value, { keepFeaturing = false } = {}) {
  let s = value.normalize("NFKC").toLowerCase();
  if (!keepFeaturing) s = s.replace(/\b(feat\.?|ft\.?|featuring)\b.*/u, " ");
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function coreTitle(value) {
  return normalize(value.replace(/[([][^)\]]*[)\]]/g, " ").replace(/\s-\s.*$/, " "));
}

function versionSignature(value) {
  const n = ` ${normalize(value, { keepFeaturing: true })} `;
  return VERSION_MARKERS.filter((m) => n.includes(` ${m} `)).sort().join("|");
}

function tokens(s) {
  return new Set(s.split(" ").filter(Boolean));
}

export function similarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const t of left) if (right.has(t)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Best overlap between any artist the listener sees and any JioSaavn credits. */
function artistSimilarity(wanted, candidates) {
  const want = normalize(wanted);
  const all = normalize(candidates.join(" "));
  let best = similarity(want, all);
  for (const part of wanted.split(/,|&| and | x /i)) {
    const p = normalize(part);
    if (!p) continue;
    for (const c of candidates) best = Math.max(best, similarity(p, normalize(c)));
  }
  return best;
}

function durationScore(wantSec, gotSec) {
  if (!wantSec || !gotSec) return 1;
  const tolerance = Math.max(8, wantSec * 0.03);
  const diff = Math.abs(wantSec - gotSec);
  return diff > tolerance ? null : 1 - diff / tolerance;
}

/** The JioSaavn song that is [track] (title, artist, duration in seconds), or null when unsure. */
export function bestMatch(track, songs) {
  const ranked = [];
  for (const song of songs) {
    if (versionSignature(track.title) !== versionSignature(song.title)) continue;
    const title = similarity(coreTitle(track.title), coreTitle(song.title));
    const artist = artistSimilarity(track.artist ?? "", song.artists);
    if (title < MIN_TITLE || artist < MIN_ARTIST) continue;
    const duration = durationScore(track.duration, song.duration);
    if (duration == null) continue;
    const score = title * 0.45 + artist * 0.35 + duration * 0.2;
    if (score >= MIN_SCORE) ranked.push({ song, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  const [top, runnerUp] = ranked;
  if (!top) return null;
  // Copies of one recording on several compilations score alike: those are not rivals.
  const sameRecording = runnerUp && normalize(runnerUp.song.title) === normalize(top.song.title) &&
    Math.abs((runnerUp.song.duration ?? 0) - (top.song.duration ?? 0)) <= 3;
  if (runnerUp && !sameRecording && top.score - runnerUp.score < MIN_MARGIN) return null;
  return top.song;
}
