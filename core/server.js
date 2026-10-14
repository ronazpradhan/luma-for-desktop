// LUMA's engine: a small HTTP server the window talks to. It listens on this
// PC only (127.0.0.1), answers only requests carrying the per-launch key, and
// refuses any Host or Origin that isn't LUMA itself, so no website and no
// other device can drive it.

import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { timingSafeEqual } from "node:crypto";

import { createLyrics } from "./lyrics.js";
import { createResolver } from "./resolver.js";
import { createSaavn } from "./saavn.js";
import { cleanTrack, openStore } from "./store.js";
import { createYtDlp } from "./ytdlp.js";
import { createYtMusic } from "./ytmusic.js";
import { isSignedInJar, openYouTubeAuth, parseNetscape, sessionHeaders } from "./youtube-auth.js";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const BROWSE_ID = /^[A-Za-z0-9_-]{2,80}$/;
const IMAGE_HOSTS = [/^yt3\.googleusercontent\.com$/, /^lh\d\.googleusercontent\.com$/, /^yt\d\.ggpht\.com$/, /^i\d?\.ytimg\.com$/, /^c\.saavncdn\.com$/];
const MAX_BODY = 1_000_000;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function startServer({ port = 0, key, dataDir, musicDir, staticDir = null, devOrigins = [], version = "0.1.0", vault = null, log = console.log }) {
  if (!key || key.length < 32) throw new Error("LUMA needs a long random key");
  const keyBuf = Buffer.from(key);
  const store = await openStore(dataDir);

  const saavn = createSaavn();
  const ytdlp = createYtDlp({ binDir: path.join(dataDir, "bin"), log });
  const youtubeAuth = await openYouTubeAuth({ dataDir, vault });
  const ytmusic = createYtMusic({ auth: () => youtubeAuth.headers() });
  let accountCache = null; // { at, account }
  async function account() {
    if (!youtubeAuth.signedIn()) return null;
    if (accountCache && Date.now() - accountCache.at < 10 * 60_000) return accountCache.account;
    const a = await ytmusic.account().catch(() => null);
    accountCache = { at: Date.now(), account: a };
    return a;
  }
  const resolver = createResolver({ saavn, ytdlp, youtubeAuth, tmpDir: path.join(dataDir, "bin"), log });
  const lyrics = createLyrics({ ytmusic, version });
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
      playlists: d.playlists.map((p) => ({ ...p, art: p.tracks.find((t) => t.art)?.art ?? null })),
      history: d.history.slice(0, 60),
      downloads: Object.fromEntries(Object.entries(d.downloads).map(([id, e]) => [id, { track: e.track, at: e.at, size: e.size }])),
      settings: d.settings,
    };
  }

  async function forYou() {
    const recent = store.snapshot().history.slice(0, 15).map((h) => h.track);
    if (!recent.length) {
      const home = await ytmusic.home();
      const songs = home.flatMap((s) => s.items.filter((i) => i.kind === "song"));
      return { basedOn: null, songs: shuffle(songs).slice(0, 20) };
    }
    const seeds = shuffle(recent).slice(0, 3);
    const radios = await Promise.all(seeds.map((s) => ytmusic.radio(s.id).catch(() => [])));
    const played = new Set(recent.map((t) => t.id));
    const mixed = [];
    const iters = radios.map((r) => shuffle(r.filter((t) => !played.has(t.id) && t.artist))[Symbol.iterator]());
    for (let more = true; more;) {
      more = false;
      for (const it of iters) {
        const n = it.next();
        if (!n.done) { mixed.push(n.value); more = true; }
      }
    }
    const seen = new Set();
    return { basedOn: seeds[0].title, songs: mixed.filter((t) => !seen.has(t.id) && seen.add(t.id)).slice(0, 24) };
  }

  // ---- audio ------------------------------------------------------------

  async function streamTo(req, res, id) {
    const local = store.download(id);
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
        stream = await resolver.resolve(meta);
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
      await writeFile(file, Buffer.concat(chunks));
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
      const up = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
      const type = up.headers.get("content-type") ?? "";
      if (!up.ok || !type.startsWith("image/")) throw new HttpError(502, "image unavailable");
      hit = { type, body: Buffer.from(await up.arrayBuffer()) };
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
      return streamTo(req, res, id);
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
        return send(res, 200, { version, ytdlp: await ytdlp.version().catch((e) => `unavailable: ${e.message}`), youtube: { signedIn: youtubeAuth.signedIn(), canSignIn: !!vault, account: await account() } });
      case "GET home":
        return send(res, 200, { shelves: await ytmusic.home() });
      case "GET foryou":
        return send(res, 200, await forYou());
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
      case "GET youtube":
        if (id === "account") return send(res, 200, { account: await account() });
        if (id === "library") return send(res, 200, { playlists: await ytmusic.libraryPlaylists() });
        throw new HttpError(404, "not found");
      case "GET radio":
        return send(res, 200, await ytmusic.radio(needId(VIDEO_ID)));
      case "POST lyrics":
        return send(res, 200, await lyrics.get(track((await body(req)).track)));
      case "POST resolve": {
        const t = track((await body(req)).track);
        const local = store.download(t.id);
        if (local) return send(res, 200, { source: "download", codec: local.type === "audio/webm" ? "opus" : "aac" });
        const s = await resolver.resolve(t).catch((e) => {
          const err = new HttpError(502, e.code ? e.message : `Couldn't find this song (${e.message})`);
          err.code = e.code;
          throw err;
        });
        return send(res, 200, { source: s.source, codec: s.codec, kbps: s.kbps });
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
        const t = track((await body(req)).track);
        download(t);
        return send(res, 202, { ok: true });
      }
      case "GET downloads":
        return send(res, 200, Object.fromEntries(downloads));
      case "DELETE download": {
        const entry = store.download(needId(VIDEO_ID));
        if (entry) {
          await rm(entry.path, { force: true });
          store.setDownload(id, null);
        }
        downloads.delete(id);
        return send(res, 200, libraryView());
      }
      case "PATCH settings": {
        const b = await body(req);
        const patch = {};
        if (typeof b.autoplay === "boolean") patch.autoplay = b.autoplay;
        if (Number.isFinite(b.volume)) patch.volume = Math.min(1, Math.max(0, b.volume));
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

