// LUMA's engine: a small HTTP server the window talks to. It listens on this
// PC only (127.0.0.1), answers only requests carrying the per-launch key, and
// refuses any Host or Origin that isn't LUMA itself, so no website and no
// other device can drive it.

import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";

import { createInnerTube } from "./innertube.js";
import { createYtJs } from "./ytjs.js";
import { cleanSpDc, createSpotify, spDcFromJar } from "./spotify.js";
import { bestMatch } from "./match.js";
import { createLyrics } from "./lyrics.js";
import { artistScores, mixQuickPicks, pickReleases, pickSeeds, songScores } from "./taste.js";
import { createResolver } from "./resolver.js";
import { createSaavn } from "./saavn.js";
import { cleanTrack, openStore } from "./store.js";
import { createYtDlp } from "./ytdlp.js";
import { createYtMusic } from "./ytmusic.js";
import { isSignedInJar, openYouTubeAuth, parseNetscape, sessionHeaders } from "./youtube-auth.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const BROWSE_ID = /^[A-Za-z0-9_-]{2,80}$/;
const IMAGE_HOSTS = [/^yt3\.googleusercontent\.com$/, /^lh\d\.googleusercontent\.com$/, /^yt\d\.ggpht\.com$/, /^i\d?\.ytimg\.com$/, /^c\.saavncdn\.com$/, /^(i|mosaic|image-cdn-[a-z]+)\.scdn\.co$/];
const MAX_BODY = 1_000_000;
/** 32 kbps: below anything either source serves, so a file this thin is cut short. */
const MIN_BYTES_PER_SECOND = 4000;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function startServer({ port = 0, key, dataDir, musicDir, staticDir = null, devOrigins = [], version = "0.1.0", vault = null, warmUp = true, log = console.log }) {
  if (!key || key.length < 32) throw new Error("LUMA needs a long random key");
  const keyBuf = Buffer.from(key);
  const store = await openStore(dataDir);

  const saavn = createSaavn();
  const ytdlp = createYtDlp({ binDir: path.join(dataDir, "bin"), log });
  const youtubeAuth = await openYouTubeAuth({ dataDir, vault });
  const ytmusic = createYtMusic({ auth: () => youtubeAuth.headers() });
  // yt-dlp's version runs a program: asked once an hour, not on every visit to Settings.
  let ytdlpCache = null; // { at, value }
  async function ytdlpVersion() {
    if (ytdlpCache && Date.now() - ytdlpCache.at < 3_600_000) return ytdlpCache.value;
    const value = await ytdlp.version().catch((e) => `unavailable: ${e.message}`);
    ytdlpCache = { at: Date.now(), value };
    return value;
  }

  let accountCache = null; // { at, account }
  async function account() {
    if (!youtubeAuth.signedIn()) return null;
    // Signed in, the account is remembered for the session (signing in or out refreshes it).
    if (accountCache?.account) return accountCache.account;
    if (accountCache && Date.now() - accountCache.at < 10 * 60_000) return accountCache.account;
    const a = await ytmusic.account().catch(() => null);
    accountCache = { at: Date.now(), account: a };
    return a;
  }
  const mobileWeb = createYtJs({ log });
  const resolver = createResolver({ saavn, ytdlp, innertube: createInnerTube({ log }), mobileWeb, youtubeAuth, tmpDir: path.join(dataDir, "bin"), log });
  const lyrics = createLyrics({ ytmusic, version, dataDir, log, server: () => store.snapshot().settings.lyricsServer || null });

  // ---- Spotify: the session is kept like YouTube's, encrypted with Windows' protection.
  const spotify = createSpotify({ log });
  const spotifyFile = path.join(dataDir, "spotify-session.bin");
  const matchFile = path.join(dataDir, "spotify-matches.json");
  if (vault) {
    try {
      spotify.setSession(JSON.parse(vault.decrypt(await readFile(spotifyFile))).spDc);
    } catch { /* not connected */ }
  }
  let spotifyAccount = null;
  let importState = { state: "idle" };
  let matches = {};
  try {
    // Only found songs are remembered: a song not found is looked for again next import.
    matches = Object.fromEntries(Object.entries(JSON.parse(await readFile(matchFile, "utf8"))).filter(([, v]) => v));
  } catch { /* first import */ }

  /** The YouTube Music recording of a Spotify track, or null when unsure. */
  async function matchOnYouTube(t) {
    if (t.spotifyId in matches) return matches[t.spotifyId];
    const first = t.artist.split(",")[0];
    // A failed search throws (and isn't remembered); only "no such song" is a null.
    const res = await ytmusic.search(`${t.title} ${first}`);
    const songs = res?.songs ?? [];
    const pick = bestMatch(
      { title: t.title, artist: t.artist, duration: t.duration },
      songs.map((s) => ({ ...s, artists: s.artist.split(/,\s*|\s&\s/) })),
    );
    const hit = pick ? cleanTrack({ ...pick, art: pick.art ?? t.art }) : null;
    if (hit) matches[t.spotifyId] = hit;
    return hit;
  }

  async function importSpotify() {
    if (importState.state === "running") return;
    importState = { state: "running", done: 0, total: 0, phase: "Reading your Spotify library" };
    try {
      const liked = await spotify.likedSongs();
      log(`spotify: ${liked.length} liked songs`);
      const lists = await spotify.playlists();
      const sets = [{ source: "spotify:liked", name: "Liked Songs (Spotify)", art: null, tracks: liked }];
      const unread = [];
      for (const p of lists) {
        importState.phase = `Reading "${p.name}"`;
        let tracks = [];
        try {
          tracks = await spotify.playlistTracks(p.id);
          log(`spotify: "${p.name}" has ${tracks.length} songs`);
        } catch (e) {
          // One playlist that won't read shouldn't stop the rest; it keeps what it had.
          log(`spotify: couldn't read "${p.name}": ${e.message}`);
          unread.push(p.name);
        }
        sets.push({ source: `spotify:${p.id}`, name: p.name, art: p.art, tracks, unread: unread.includes(p.name) });
      }
      const all = new Map();
      for (const s of sets) for (const t of s.tracks) all.set(t.spotifyId, t);
      importState = { state: "running", done: 0, total: all.size, phase: "Finding your songs on YouTube Music" };
      const queue = [...all.values()];
      let unmatched = 0;
      let failed = 0;
      let lastError = null;
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          try {
            if (!(await matchOnYouTube(t))) unmatched++;
          } catch (e) {
            failed++;
            lastError = e.message;
          }
          importState.done++;
        }
      }));
      await writeFile(matchFile, JSON.stringify(matches));
      if (failed) log(`spotify: ${failed} YouTube Music searches failed (last: ${lastError})`);
      if (all.size && failed === all.size) throw new Error(`Couldn't reach YouTube Music to find your songs (${lastError}). Nothing was changed; try again.`);
      for (const s of sets) {
        if (s.unread) continue;
        const tracks = s.tracks.map((t) => matches[t.spotifyId]).filter(Boolean);
        const seen = new Set();
        store.upsertImported(s.source, s.name, tracks.filter((t) => !seen.has(t.id) && seen.add(t.id)), s.art);
      }
      const found = all.size - unmatched - failed;
      importState = { state: "done", at: Date.now(), playlists: sets.length, songs: all.size, found, unmatched: unmatched + failed, unread: unread.length };
      log(`spotify: imported ${sets.length} playlists, ${all.size} songs: ${found} found on YouTube Music, ${unmatched} not found, ${failed} searches failed, ${unread.length} playlists unreadable`);
    } catch (e) {
      log(`spotify import failed: ${e.message}`);
      importState = { state: "failed", error: e.message, code: e.code };
    }
  }
  const downloads = new Map(); // id -> { state, progress, error }
  const images = new Map(); // url -> { type, body } (small LRU)
  let actualPort = port;

  const hostOk = (host) => host === `127.0.0.1:${actualPort}` || host === `localhost:${actualPort}`;
  const keyOk = (given) => {
    if (typeof given !== "string") return false;
    const b = Buffer.from(given);
    return b.length === keyBuf.length && timingSafeEqual(b, keyBuf);
  };

  async function body(req) {
    if (!/^application\/json/.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "JSON only");
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(413, "too large");
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      throw new HttpError(400, "bad JSON");
    }
  }

  function track(value) {
    const t = cleanTrack(value);
    if (!t) throw new HttpError(400, "not a track");
    return t;
  }

  function send(res, status, data) {
    const json = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(json);
  }

  // ---- library views ----------------------------------------------------

  function libraryView() {
    const d = store.snapshot();
    return {
      likes: d.likes,
      playlists: d.playlists.map((p) => ({ ...p, art: p.coverArt ?? p.tracks.find((t) => t.art)?.art ?? null })),
      history: d.history.slice(0, 60),
      downloads: Object.fromEntries(Object.entries(d.downloads).map(([id, e]) => [id, { track: e.track, at: e.at, size: e.size }])),
      settings: d.settings,
    };
  }

  // ---- suggestions from your listening (core/taste.js) ----------------------

  const day = () => new Date().toISOString().slice(0, 10);
  let picks = null; // { seed, at, data }

  /** Quick picks: your most-played songs mixed with songs like them, new each day ([fresh]: new now). */
  async function forYou(fresh = false) {
    const d = store.snapshot();
    // Your current vibe: what you've played lately weighs far more than old phases.
    const songs = songScores(d.plays, d.likes, Date.now(), 4);
    if (!songs.length) {
      const home = await ytmusic.home();
      const list = home.flatMap((s) => s.items.filter((i) => i.kind === "song"));
      return { basedOn: null, songs: shuffle(list).slice(0, 24) };
    }
    const seed = fresh ? `${day()}:${Date.now()}` : day();
    if (!fresh && picks && picks.seed === seed && Date.now() - picks.at < 6 * 3_600_000) return picks.data;
    const seeds = pickSeeds(songs, 3, seed);
    const radios = await Promise.all(seeds.map((t) => ytmusic.radio(t.id).catch(() => [])));
    const similar = [];
    for (let i = 0; radios.some((r) => r.length > i); i++) for (const r of radios) if (r[i]?.artist) similar.push(r[i]);
    const recentIds = new Set(d.history.slice(0, 25).map((h) => h.track.id));
    const data = {
      basedOn: [...new Set(seeds.map((t) => (t.artist ?? "").split(",")[0].trim()).filter(Boolean))].join(", ") || null,
      songs: mixQuickPicks({ favourites: songs.map((s) => s.track), similar, recentIds, seed }),
    };
    if (data.songs.length) picks = { seed, at: Date.now(), data };
    return data;
  }

  const artistPages = new Map(); // artist id -> { at, page }
  const artistIds = new Map(); // lower-case name -> id (or null)

  async function artistPage(id) {
    const hit = artistPages.get(id);
    if (hit && Date.now() - hit.at < 12 * 3_600_000) return hit.page;
    const page = await ytmusic.artist(id);
    artistPages.set(id, { at: Date.now(), page });
    return page;
  }

  /** An artist's YouTube Music id from their name, when a played song didn't carry it. */
  async function artistIdFor(name) {
    const key = name.toLowerCase();
    if (artistIds.has(key)) return artistIds.get(key);
    const res = await ytmusic.search(name).catch(() => null);
    const found = (res?.artists ?? []).find((a) => a.title?.toLowerCase() === key) ?? res?.artists?.[0];
    artistIds.set(key, found?.id ?? null);
    return found?.id ?? null;
  }

  /** New releases from the artists you play most. */
  async function newReleases() {
    const d = store.snapshot();
    const artists = artistScores(songScores(d.plays, d.likes)).slice(0, 10);
    let lookups = 0;
    for (const a of artists) if (!a.id && lookups++ < 4) a.id = await artistIdFor(a.name);
    const withId = artists.filter((a) => a.id).slice(0, 8);
    const pages = await Promise.all(withId.map(async (artist) => ({ artist, page: await artistPage(artist.id).catch(() => null) })));
    return pickReleases(pages);
  }

  /** YouTube Music's home, with its generic quick picks and new releases swapped for yours. */
  async function home() {
    const [feed, releases] = await Promise.all([ytmusic.home(), newReleases().catch((e) => { log(`new releases: ${e.message}`); return []; })]);
    const generic = /quick picks|new release/i;
    const mine = releases.length >= 3;
    const rest = feed.filter((s) => !/quick picks/i.test(s.title) && !(mine && generic.test(s.title)));
    return mine ? [{ title: "New releases from your artists", items: releases }, ...rest] : rest;
  }

  // ---- audio ------------------------------------------------------------

  async function streamTo(req, res, id, online = false) {
    const local = online ? null : store.download(id);
    if (local && (await stat(local.path).catch(() => null))) return sendFile(req, res, local.path, local.type);
    let stream = resolver.cached(id);
    if (!stream) throw new HttpError(409, "resolve this song first");
    for (let attempt = 0; attempt < 2; attempt++) {
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const headers = { "User-Agent": stream.userAgent ?? "Mozilla/5.0" };
      if (req.headers.range) headers.Range = req.headers.range;
      const up = await fetch(stream.url, { headers, signal: ac.signal, redirect: "follow" });
      if ((up.status === 403 || up.status === 410) && attempt === 0) {
        // The link died: look the song up again once.
        await up.body?.cancel();
        const meta = store.snapshot().history.find((h) => h.track.id === id)?.track;
        resolver.forget(id);
        if (!meta) throw new HttpError(410, "stream expired");
        const was = stream;
        stream = await resolver.resolve(meta);
        // Mid-song, the bytes must come from the very same file: another source
        // or format there would feed the player garbage, and it would jump to the
        // end. The player looks the song up again and resumes at the same spot.
        const midSong = !/bytes=0-/.test(req.headers.range ?? "bytes=0-");
        if (midSong && (stream.source !== was.source || stream.codec !== was.codec || stream.size !== was.size)) {
          log(`stream for ${id} died mid-song and the new one is a different file (${was.source} ${was.codec} -> ${stream.source} ${stream.codec})`);
          throw new HttpError(410, "stream changed");
        }
        continue;
      }
      const out = { "Accept-Ranges": "bytes", "Content-Type": up.headers.get("content-type") ?? "audio/mp4", "Cache-Control": "no-store" };
      for (const h of ["content-length", "content-range"]) if (up.headers.get(h)) out[h] = up.headers.get(h);
      res.writeHead(up.status, out);
      if (!up.body) return res.end();
      Readable.fromWeb(up.body).on("error", () => res.destroy()).pipe(res);
      return;
    }
  }

  async function sendFile(req, res, file, type) {
    const { size } = await stat(file);
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (m) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
      createReadStream(file).pipe(res);
    }
  }

  /** Why a downloaded file can't be trusted, or null when it looks whole. */
  async function damaged(entry, t) {
    const info = await stat(entry.path).catch(() => null);
    if (!info) return "file missing";
    if (entry.size && info.size < entry.size) return `file shrank to ${info.size} of ${entry.size} bytes`;
    const head = await readHead(entry.path).catch(() => null);
    if (!head || !looksLikeAudio(head)) return "not an audio file";
    // Well under the lowest bitrate either source uses: most of the song never arrived.
    const seconds = t?.duration ?? entry.track?.duration;
    if (seconds && info.size < seconds * MIN_BYTES_PER_SECOND) return `only ${info.size} bytes for ${Math.round(seconds)} s`;
    return null;
  }

  async function forgetDownload(id) {
    const entry = store.download(id);
    if (entry) {
      await rm(entry.path, { force: true });
      store.setDownload(id, null);
    }
    downloads.delete(id);
  }

  async function download(t) {
    if (downloads.get(t.id)?.state === "running") return;
    downloads.set(t.id, { state: "running", progress: 0 });
    try {
      const stream = await resolver.resolve(t);
      const ext = stream.source === "jiosaavn" ? "m4a" : stream.codec === "opus" ? "webm" : "m4a";
      const type = ext === "m4a" ? "audio/mp4" : "audio/webm";
      await mkdir(musicDir, { recursive: true });
      const file = path.join(musicDir, `${safeName(`${t.artist} - ${t.title}`)}.${ext}`);
      // Fetched in pieces: YouTube slows one long request to a crawl.
      const chunks = [];
      let got = 0;
      let total = stream.size ?? null;
      const STEP = 4 * 1024 * 1024;
      for (;;) {
        const up = await fetch(stream.url, { headers: { "User-Agent": stream.userAgent ?? "Mozilla/5.0", Range: `bytes=${got}-${got + STEP - 1}` }, signal: AbortSignal.timeout(60_000) });
        if (up.status !== 206 && up.status !== 200) throw new Error(`download answered ${up.status}`);
        const buf = Buffer.from(await up.arrayBuffer());
        chunks.push(buf);
        got += buf.length;
        const range = up.headers.get("content-range");
        if (range) total = Number(range.split("/")[1]) || total;
        downloads.set(t.id, { state: "running", progress: total ? got / total : 0 });
        if (up.status === 200 || !buf.length || (total && got >= total)) break;
      }
      // A cut-off download plays as a song that ends the moment it starts.
      if (total && got < total) throw new Error(`incomplete: ${got} of ${total} bytes`);
      const whole = Buffer.concat(chunks);
      if (!looksLikeAudio(whole)) throw new Error("not an audio file");
      if (t.duration && got < t.duration * MIN_BYTES_PER_SECOND) throw new Error(`only ${got} bytes for ${Math.round(t.duration)} s`);
      await writeFile(file, whole);
      store.setDownload(t.id, { path: file, type, size: got, track: t, at: Date.now() });
      downloads.set(t.id, { state: "done", progress: 1 });
    } catch (e) {
      log(`download failed for ${t.id}: ${e.message}`);
      downloads.set(t.id, { state: "failed", progress: 0, error: e.message });
    }
  }

  async function image(res, raw) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new HttpError(400, "bad image url");
    }
    if (url.protocol !== "https:" || !IMAGE_HOSTS.some((h) => h.test(url.hostname))) throw new HttpError(403, "image host not allowed");
    let hit = images.get(url.href);
    if (!hit) {
      // The sharpest version the host has; the original when that doesn't exist.
      for (const candidate of [...new Set([sharperArt(url.href), url.href])]) {
        const up = await fetch(candidate, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
        const type = up?.headers.get("content-type") ?? "";
        if (!up?.ok || !type.startsWith("image/")) { await up?.body?.cancel().catch(() => {}); continue; }
        hit = { type, body: Buffer.from(await up.arrayBuffer()) };
        break;
      }
      if (!hit) throw new HttpError(502, "image unavailable");
      images.set(url.href, hit);
      if (images.size > 400) images.delete(images.keys().next().value);
    }
    res.writeHead(200, { "Content-Type": hit.type, "Cache-Control": "private, max-age=86400", "Content-Length": hit.body.length });
    res.end(hit.body);
  }

  async function serveStatic(req, res, pathname) {
    const root = path.resolve(staticDir);
    let file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(root + path.sep) && file !== root) throw new HttpError(403, "outside the app");
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      file = path.join(root, "index.html");
      info = await stat(file);
    }
    const type = MIME[path.extname(file)] ?? "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" };
    if (file.endsWith("index.html")) Object.assign(headers, SECURITY_HEADERS);
    res.writeHead(200, headers);
    res.end(await readFile(file));
  }

  // ---- routing ----------------------------------------------------------

  async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    const m = req.method;

    if (!hostOk(req.headers.host)) throw new HttpError(421, "wrong host");
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${actualPort}` && origin !== `http://localhost:${actualPort}` && !devOrigins.includes(origin)) {
      throw new HttpError(403, "wrong origin");
    }

    const isApi = p.startsWith("/api/") || p.startsWith("/stream/") || p === "/img";
    if (!isApi) {
      if (!staticDir || m !== "GET") throw new HttpError(404, "not found");
      return serveStatic(req, res, p);
    }
    if (!keyOk(req.headers["x-luma-key"] ?? url.searchParams.get("k"))) throw new HttpError(401, "missing key");

    if (m === "GET" && p.startsWith("/stream/")) {
      const id = p.slice(8);
      if (!VIDEO_ID.test(id)) throw new HttpError(400, "bad id");
      return streamTo(req, res, id, url.searchParams.get("online") === "1");
    }
    if (m === "GET" && p === "/img") return image(res, url.searchParams.get("u") ?? "");

    const seg = p.slice(5).split("/"); // after /api/
    const id = seg[1];
    const needId = (re = BROWSE_ID) => {
      if (!id || !re.test(id)) throw new HttpError(400, "bad id");
      return id;
    };

    switch (`${m} ${seg[0]}${seg.length > 2 ? `/${seg[2]}` : ""}`) {
      case "GET status":
        return send(res, 200, { version, ytdlp: await ytdlpVersion(), youtube: { signedIn: youtubeAuth.signedIn(), canSignIn: !!vault, account: await account() } });
      case "GET home":
        return send(res, 200, { shelves: await home() });
      case "GET foryou":
        return send(res, 200, await forYou(url.searchParams.get("fresh") === "1"));
      case "GET search": {
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
        if (!q) throw new HttpError(400, "empty search");
        return send(res, 200, await ytmusic.search(q));
      }
      case "GET suggest": {
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
        return send(res, 200, q ? await ytmusic.suggestions(q) : []);
      }
      case "GET album":
        return send(res, 200, await ytmusic.album(needId()));
      case "GET artist":
        return send(res, 200, await ytmusic.artist(needId()));
      case "GET ytplaylist":
        return send(res, 200, await ytmusic.playlist(needId()));
      case "GET spotify":
        if (spotify.connected() && !spotifyAccount) spotifyAccount = await spotify.account().catch(() => null);
        return send(res, 200, { connected: spotify.connected(), canConnect: !!vault, account: spotifyAccount, import: importState });
      case "POST spotify":
        if (id !== "import") throw new HttpError(404, "not found");
        if (!spotify.connected()) throw new HttpError(409, "Connect Spotify first.");
        importSpotify();
        return send(res, 202, { import: importState });
      case "GET youtube":
        if (id === "account") return send(res, 200, { account: await account() });
        if (id === "library") return send(res, 200, { playlists: await ytmusic.libraryPlaylists() });
        throw new HttpError(404, "not found");
      case "GET radio":
        return send(res, 200, await ytmusic.radio(needId(VIDEO_ID)));
      case "POST lyrics":
        return send(res, 200, await lyrics.get(track((await body(req)).track)));
      case "POST resolve": {
        const b = await body(req);
        const t = track(b.track);
        log(`play "${t.title}" by ${t.artist} (${t.id})${b.online ? " online" : ""}`);
        const local = b.online ? null : store.download(t.id);
        let redownload = false;
        if (local) {
          const why = await damaged(local, t);
          if (!why) return send(res, 200, { source: "download", codec: local.type === "audio/webm" ? "opus" : "aac" });
          // Streamed instead; the app downloads it again.
          log(`download of "${t.title}" (${t.id}) is damaged (${why}); streaming it`);
          await forgetDownload(t.id);
          redownload = true;
        }
        const s = await resolver.resolve(t).catch((e) => {
          log(`could not play "${t.title}" (${t.id}): ${e.code ?? ""} ${e.message}`);
          const err = new HttpError(502, e.code ? e.message : `Couldn't find this song (${e.message})`);
          err.code = e.code;
          throw err;
        });
        return send(res, 200, { source: s.source, codec: s.codec, kbps: s.kbps, ...(redownload && { redownload }) });
      }
      case "POST prefetch": {
        // Hovering a song: the cheap sources only, so the click finds it ready.
        const t = track((await body(req)).track);
        if (store.download(t.id)) return send(res, 200, { ready: true });
        const s = await resolver.resolve(t, { light: true }).catch(() => null);
        return send(res, 200, { ready: !!s });
      }
      case "POST log": {
        const b = await body(req);
        log(`window: ${String(b.message ?? "").slice(0, 300)}`);
        return send(res, 200, { ok: true });
      }
      case "GET library":
        return send(res, 200, libraryView());
      case "POST like": {
        const b = await body(req);
        store.setLiked(track(b.track), !!b.liked);
        return send(res, 200, libraryView());
      }
      case "POST history":
        store.recordPlay(track((await body(req)).track));
        return send(res, 200, { ok: true });
      case "POST playlists": {
        const b = await body(req);
        const tracks = Array.isArray(b.tracks) ? b.tracks.map(cleanTrack).filter(Boolean) : [];
        const created = store.createPlaylist(String(b.name ?? "").trim(), tracks);
        return send(res, 200, { created, library: libraryView() });
      }
      case "PATCH playlists":
        store.renamePlaylist(needId(), String((await body(req)).name ?? "").trim());
        return send(res, 200, libraryView());
      case "DELETE playlists":
        store.deletePlaylist(needId());
        return send(res, 200, libraryView());
      case "POST playlists/tracks": {
        const tracks = ((await body(req)).tracks ?? []).map(cleanTrack).filter(Boolean);
        if (!store.addToPlaylist(needId(), tracks)) throw new HttpError(404, "no such playlist");
        return send(res, 200, libraryView());
      }
      case "DELETE playlists/tracks": {
        const trackId = seg[3];
        if (!VIDEO_ID.test(trackId ?? "")) throw new HttpError(400, "bad id");
        store.removeFromPlaylist(needId(), trackId);
        return send(res, 200, libraryView());
      }
      case "POST download": {
        const b = await body(req);
        const t = track(b.track);
        // Again: the copy on disk broke.
        if (b.again) {
          log(`downloading "${t.title}" (${t.id}) again`);
          await forgetDownload(t.id);
        }
        download(t);
        return send(res, 202, { ok: true });
      }
      case "GET downloads":
        return send(res, 200, Object.fromEntries(downloads));
      case "DELETE download": {
        await forgetDownload(needId(VIDEO_ID));
        return send(res, 200, libraryView());
      }
      case "PATCH settings": {
        const b = await body(req);
        const patch = {};
        if (typeof b.autoplay === "boolean") patch.autoplay = b.autoplay;
        if (Number.isFinite(b.volume)) patch.volume = Math.min(1, Math.max(0, b.volume));
        // A LyricsPlus server of the listener's own (empty: YouLy+'s public ones).
        if (typeof b.lyricsServer === "string") {
          const v = b.lyricsServer.trim();
          if (v && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(v)) throw new HttpError(400, "The lyrics server must be an https:// address.");
          patch.lyricsServer = v.slice(0, 300);
        }
        // YouTube Music playlists the listener removed from LUMA (their account is untouched).
        if (Array.isArray(b.hiddenYouTube)) patch.hiddenYouTube = [...new Set(b.hiddenYouTube.filter((x) => typeof x === "string" && /^[\w-]{1,80}$/.test(x)))].slice(0, 500);
        return send(res, 200, store.setSettings(patch));
      }
      default:
        throw new HttpError(404, "not found");
    }
  }

  /**
   * Keeps [cookies] only if YouTube itself says who they belong to: an old or
   * signed-out jar (a profile left by an uninstalled browser, say) is turned
   * down, and whatever was connected before stays connected.
   */
  async function adoptJar(cookies, notSignedIn) {
    if (!isSignedInJar(cookies)) throw new Error(notSignedIn);
    const probe = createYtMusic({ auth: () => sessionHeaders(cookies) });
    let who = await probe.account().catch(() => null);
    if (!who?.name) {
      // Whatever the account menu looks like this week, a session that opens your
      // own playlists is signed in.
      const mine = await probe.libraryPlaylists().catch(() => []);
      if (mine.length > 1) who = { name: null, handle: null, photo: null };
    }
    if (!who) {
      throw new Error("YouTube doesn't accept that sign-in any more. Sign in again at music.youtube.com in that browser, then try again.");
    }
    await youtubeAuth.set(cookies);
    accountCache = { at: Date.now(), account: who };
    resolver.forgetYouTube();
    return who;
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 502;
      if (!(e instanceof HttpError)) log(`${req.method} ${req.url?.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, status, { error: e.message, code: e.code });
      else res.destroy();
    });
  });
  server.headersTimeout = 15_000;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  actualPort = server.address().port;
  log(`LUMA engine on http://127.0.0.1:${actualPort}`);
  // Install or update yt-dlp now, not during the first song that needs YouTube.
  if (warmUp) {
    ytdlp.version().catch((e) => log(`yt-dlp not ready: ${e.message}`));
    mobileWeb.warmUp();
  }

  return {
    port: actualPort,
    /**
     * Takes the YouTube session from the listener's own browser (asked for by
     * the app, never over HTTP). Only YouTube's and Google's cookies are kept.
     */
    async importYouTubeFromBrowser(browser) {
      const tmp = path.join(dataDir, "bin", `jar-${Date.now()}.txt`);
      await mkdir(path.dirname(tmp), { recursive: true });
      try {
        await ytdlp.exportBrowserCookies(browser, tmp);
        const text = await readFile(tmp, "utf8").catch(() => "");
        return await adoptJar(parseNetscape(text), "That browser isn't signed in to YouTube. Sign in at music.youtube.com there first.");
      } finally {
        await rm(tmp, { force: true });
      }
    },
    async importYouTubeFromFile(file) {
      const info = await stat(file);
      if (info.size > 5_000_000) throw new Error("That file is too big to be a cookies file.");
      return adoptJar(parseNetscape(await readFile(file, "utf8")), "That file has no signed-in YouTube session in it.");
    },
    /**
     * Spotify's sign-in comes from the listener's own browser, like YouTube's:
     * Firefox's jar, a cookies file, or the sp_dc value pasted from Chrome or
     * Edge. Asked for by the app, never over HTTP. Only sp_dc is kept.
     */
    async importSpotifyFromBrowser(browser) {
      const tmp = path.join(dataDir, "bin", `jar-${Date.now()}.txt`);
      await mkdir(path.dirname(tmp), { recursive: true });
      try {
        await ytdlp.exportBrowserCookies(browser, tmp);
        const spDc = spDcFromJar(parseNetscape(await readFile(tmp, "utf8").catch(() => "")));
        if (!spDc) throw new Error("That browser isn't signed in to Spotify. Sign in at open.spotify.com there first.");
        return await this.connectSpotify(spDc);
      } finally {
        await rm(tmp, { force: true });
      }
    },
    async importSpotifyFromFile(file) {
      const info = await stat(file);
      if (info.size > 5_000_000) throw new Error("That file is too big to be a cookies file.");
      const spDc = spDcFromJar(parseNetscape(await readFile(file, "utf8")));
      if (!spDc) throw new Error("That file has no signed-in Spotify session in it. Export it from open.spotify.com while signed in.");
      return this.connectSpotify(spDc);
    },
    async importSpotifyFromText(text) {
      const spDc = cleanSpDc(text);
      if (!spDc) throw new Error("That doesn't look like an sp_dc value. Copy the whole Value of the sp_dc cookie.");
      return this.connectSpotify(spDc);
    },
    async connectSpotify(spDc) {
      const probe = createSpotify({ log });
      probe.setSession(spDc);
      const who = await probe.account();
      spotify.setSession(spDc);
      spotifyAccount = who;
      if (vault) await writeFile(spotifyFile, vault.encrypt(JSON.stringify({ spDc })));
      importSpotify();
      return who;
    },
    async disconnectSpotify() {
      spotify.setSession(null);
      spotifyAccount = null;
      importState = { state: "idle" };
      await rm(spotifyFile, { force: true });
    },
    async signOutYouTube() {
      await youtubeAuth.clear();
      resolver.forgetYouTube();
      accountCache = null;
    },
    async close() {
      await store.flush().catch(() => {});
      await new Promise((r) => server.close(r));
    },
  };
}

/**
 * Cover art at a size that stays sharp on large screens: Google's image
 * server resized to 544 px, a YouTube video's largest thumbnail, JioSaavn's
 * 500 px file. Anything else is left as it is.
 */
/** WebM (EBML) or MP4 (`ftyp` box): what downloads are saved as. */
export function looksLikeAudio(head) {
  if (!head || head.length < 12) return false;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  return head.toString("latin1", 4, 8) === "ftyp";
}

async function readHead(file) {
  const fh = await open(file, "r");
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(12), 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function sharperArt(href) {
  if (/(googleusercontent|ggpht)\.com/.test(href)) {
    return /=(w\d+-h\d+|s\d+)[^/]*$/.test(href) ? href.replace(/=(w\d+-h\d+|s\d+)[^/]*$/, "=w544-h544-l90-rj") : href;
  }
  const yt = /^https:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\/[a-z]*default\.(?:jpg|webp)/.exec(href);
  if (yt) return `https://i.ytimg.com/vi/${yt[1]}/maxresdefault.jpg`;
  if (/saavncdn\.com/.test(href)) return href.replace(/-(50x50|150x150)\./, "-500x500.");
  return href;
}

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeName(s) {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || "song";
}

