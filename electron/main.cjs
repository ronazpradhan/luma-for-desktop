// LUMA for Windows: starts the engine on 127.0.0.1 with a fresh key, then opens
// one locked-down window onto it. The page gets no Node, no file access, and
// can't navigate anywhere but LUMA itself; links open in the real browser.

const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

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
  // Spotify's sign-in also comes from the listener's own browser: Spotify's
  // login page refuses to be trusted inside an app window.
  ipcMain.handle("luma:spotify-from-browser", (event, browser) =>
    fromLuma(event) ? outcome(engine.importSpotifyFromBrowser(String(browser))) : refused());
  ipcMain.handle("luma:spotify-from-file", async (event) => {
    if (!fromLuma(event)) return refused();
    const pick = await dialog.showOpenDialog(win, {
      title: "Choose a Spotify cookies file",
      properties: ["openFile"],
      filters: [{ name: "Cookies file", extensions: ["txt"] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true };
    return outcome(engine.importSpotifyFromFile(pick.filePaths[0]));
  });
  ipcMain.handle("luma:spotify-from-text", (event, text) =>
    fromLuma(event) ? outcome(engine.importSpotifyFromText(String(text).slice(0, 8_000))) : refused());
  ipcMain.handle("luma:spotify-sign-out", async (event) => {
    if (!fromLuma(event)) return false;
    await engine.disconnectSpotify();
    return true;
  });
  ipcMain.handle("luma:update-state", (event) => (fromLuma(event) ? update : null));
  ipcMain.handle("luma:update-check", (event) => (fromLuma(event) ? checkForUpdates() : null));
  ipcMain.handle("luma:update-install", (event) => {
    if (!fromLuma(event) || update.state !== "ready") return false;
    // Silent install, then LUMA opens again on the new version.
    autoUpdater?.quitAndInstall(true, true);
    return true;
  });
  ipcMain.handle("luma:can-uninstall", (event) => fromLuma(event) && !!uninstaller());
  ipcMain.handle("luma:uninstall", (event) => {
    const exe = fromLuma(event) && uninstaller();
    if (!exe) return false;
    // The uninstaller waits for LUMA to close, then asks about the library.
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 300);
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
  startUpdates();
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

// ---- uninstall -----------------------------------------------------------------

/** Windows' uninstaller for this copy of LUMA, next to LUMA.exe; null when running from source. */
function uninstaller() {
  if (!app.isPackaged || process.platform !== "win32") return null;
  const exe = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
  return fs.existsSync(exe) ? exe : null;
}

// ---- updates ------------------------------------------------------------------
// New versions come from this project's GitHub Releases (latest.yml, written
// by electron-builder). They download in the background and install when LUMA
// quits, or straight away when the listener chooses Restart in the window.

let autoUpdater = null;
let update = { state: "idle", version: null, progress: 0, error: null };
const UPDATE_EVERY_MS = 6 * 3_600_000;

function setUpdate(patch) {
  update = { ...update, ...patch };
  win?.webContents.send("luma:update", update);
}

function startUpdates() {
  // A development run (npm run app) has nothing to update.
  if (!app.isPackaged) return setUpdate({ state: "unsupported" });
  ({ autoUpdater } = require("electron-updater"));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m) => writeLog(`update: ${m}`), warn: (m) => writeLog(`update: ${m}`), error: (m) => writeLog(`update error: ${m}`), debug() {} };
  autoUpdater.on("checking-for-update", () => setUpdate({ state: "checking", error: null }));
  autoUpdater.on("update-not-available", () => setUpdate({ state: "current" }));
  autoUpdater.on("update-available", (i) => setUpdate({ state: "downloading", version: i.version, progress: 0 }));
  autoUpdater.on("download-progress", (p) => setUpdate({ state: "downloading", progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => setUpdate({ state: "ready", version: i.version, progress: 100 }));
  autoUpdater.on("error", (e) => setUpdate({ state: update.state === "ready" ? "ready" : "error", error: String(e?.message ?? e).split("\n")[0] }));
  setTimeout(checkForUpdates, 8_000);
  setInterval(checkForUpdates, UPDATE_EVERY_MS);
}

function checkForUpdates() {
  if (!autoUpdater || update.state === "downloading" || update.state === "ready") return update;
  autoUpdater.checkForUpdates().catch(() => {});
  return update;
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
