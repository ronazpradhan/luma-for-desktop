// LUMA for Windows: starts the engine on 127.0.0.1 with a fresh key, then opens
// one locked-down window onto it. The page gets no Node, no file access, and
// can't navigate anywhere but LUMA itself; links open in the real browser.

const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const key = crypto.randomBytes(32).toString("hex");
let engine = null;
let win = null;
let origin = "";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start).catch((e) => {
    console.error(e);
    app.quit();
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("com.luma.desktop");
  const { startServer } = await import(pathToFileURL(path.join(__dirname, "..", "core", "server.js")).href);
  engine = await startServer({
    port: 0,
    key,
    dataDir: app.getPath("userData"),
    musicDir: path.join(app.getPath("music"), "LUMA"),
    staticDir: path.join(__dirname, "..", "dist"),
    version: app.getVersion(),
    // Windows' data protection (DPAPI) keeps the YouTube session unreadable to other accounts.
    vault: safeStorage.isEncryptionAvailable()
      ? { encrypt: (text) => safeStorage.encryptString(text), decrypt: (buf) => safeStorage.decryptString(buf) }
      : null,
    log: writeLog,
  });
  origin = `http://127.0.0.1:${engine.port}`;

  // The page needs no camera, microphone, notifications or anything else.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // The key goes only to LUMA's own page, asked for by its preload.
  const fromLuma = (event) => (event.senderFrame?.url ?? "").startsWith(`${origin}/`);
  ipcMain.on("luma:key", (event) => {
    event.returnValue = fromLuma(event) ? key : null;
  });
  // YouTube sign-in comes from the listener's own browser (Google won't let
  // anyone sign in inside an app window), or from a cookies file they pick.
  ipcMain.handle("luma:youtube-browsers", (event) => (fromLuma(event) ? installedBrowsers() : []));
  ipcMain.handle("luma:youtube-from-browser", (event, browser) =>
    fromLuma(event) ? outcome(engine.importYouTubeFromBrowser(String(browser))) : refused());
  ipcMain.handle("luma:youtube-from-file", async (event) => {
    if (!fromLuma(event)) return refused();
    const pick = await dialog.showOpenDialog(win, {
      title: "Choose a YouTube cookies file",
      properties: ["openFile"],
      filters: [{ name: "Cookies file", extensions: ["txt"] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true };
    return outcome(engine.importYouTubeFromFile(pick.filePaths[0]));
  });
  ipcMain.handle("luma:spotify-sign-in", (event) => (fromLuma(event) ? spotifySignIn() : refused()));
  ipcMain.handle("luma:spotify-sign-out", async (event) => {
    if (!fromLuma(event)) return false;
    await session.fromPartition(SPOTIFY_PARTITION).clearStorageData();
    await engine.disconnectSpotify();
    return true;
  });
  ipcMain.handle("luma:youtube-sign-out", async (event) => {
    if (!fromLuma(event)) return false;
    await engine.signOutYouTube();
    return true;
  });

  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: "#0e0d13",
    title: "LUMA",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#f1e8d6", height: 44 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`${origin}/`)) {
      e.preventDefault();
      if (url.startsWith("https://")) shell.openExternal(url);
    }
  });
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { win = null; });
  await win.loadURL(`${origin}/`);
}

// ---- YouTube sign-in --------------------------------------------------------

// A browser counts only when it is installed: a profile folder left behind by
// an uninstalled one holds an old sign-in, maybe someone else's.
// Only Firefox: Chrome, Edge and Brave now lock their sign-ins with encryption
// only the browser itself can open, so no other program can read them.
const BROWSER_EXES = {
  firefox: ["Mozilla Firefox", "firefox.exe"],
};

function installedBrowsers() {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA, "C:/Program Files", "C:/Program Files (x86)"].filter(Boolean);
  return Object.entries(BROWSER_EXES)
    .filter(([, parts]) => roots.some((root) => fs.existsSync(path.join(root, ...parts))))
    .map(([id]) => id);
}

// ---- Spotify sign-in --------------------------------------------------------
// Spotify's own login page in a window with its own cookie jar. LUMA never
// sees the password: once open.spotify.com has a signed-in session, its sp_dc
// cookie goes to the engine and the window closes.

const SPOTIFY_PARTITION = "persist:spotify-signin";
const SPOTIFY_LOGIN = "https://accounts.spotify.com/login?continue=" + encodeURIComponent("https://open.spotify.com/");
const SPOTIFY_HOSTS = /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com|recaptcha\.net|gstatic\.com|google\.com|facebook\.com|apple\.com)$/;
let spotifyWindow = null;

function spotifySignIn() {
  if (spotifyWindow) {
    spotifyWindow.focus();
    return Promise.resolve({ ok: false, cancelled: true });
  }
  const ses = session.fromPartition(SPOTIFY_PARTITION);
  ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, "").replace(/\s?(LUMA|luma-desktop)\/\S+/, ""));
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  return new Promise((resolve) => {
    let done = false;
    spotifyWindow = new BrowserWindow({
      parent: win ?? undefined,
      width: 480,
      height: 760,
      title: "Sign in to Spotify",
      backgroundColor: "#121212",
      autoHideMenuBar: true,
      webPreferences: { partition: SPOTIFY_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
    });
    const wc = spotifyWindow.webContents;
    const allowed = (url) => {
      try {
        const u = new URL(url);
        return u.protocol === "https:" && SPOTIFY_HOSTS.test(u.hostname);
      } catch {
        return false;
      }
    };
    wc.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) wc.loadURL(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (e, url) => { if (!allowed(url)) e.preventDefault(); });
    const check = async () => {
      if (done) return;
      const [cookie] = await ses.cookies.get({ name: "sp_dc" });
      if (!cookie?.value) return;
      done = true;
      try {
        const account = await engine.connectSpotify(cookie.value);
        resolve({ ok: account ?? { name: null } });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
      spotifyWindow?.close();
    };
    wc.on("did-navigate", check);
    wc.on("did-navigate-in-page", check);
    wc.on("did-finish-load", check);
    spotifyWindow.on("closed", () => {
      spotifyWindow = null;
      if (!done) resolve({ ok: false, cancelled: true });
    });
    spotifyWindow.loadURL(SPOTIFY_LOGIN);
  });
}

async function outcome(job) {
  try {
    return { ok: await job };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function refused() {
  return { ok: false, error: "Not allowed" };
}

// ---- log ----------------------------------------------------------------------
// What happened to each song, in luma.log in LUMA's data folder (kept under
// ~1 MB; the previous one is luma.old.log). No cookies or keys are written.

function writeLog(message) {
  console.log(message);
  try {
    const file = path.join(app.getPath("userData"), "luma.log");
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size > 1_000_000) fs.renameSync(file, path.join(app.getPath("userData"), "luma.old.log"));
    fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break playback.
  }
}

let quitting = false;
app.on("before-quit", (e) => {
  if (quitting || !engine) return;
  // Let the library finish writing before the process goes.
  e.preventDefault();
  quitting = true;
  engine.close().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
