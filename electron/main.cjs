// LUMA for Windows: starts the engine on 127.0.0.1 with a fresh key, then opens
// one locked-down window onto it. The page gets no Node, no file access, and
// can't navigate anywhere but LUMA itself; links open in the real browser.

const { app, BrowserWindow, Menu, ipcMain, session, shell } = require("electron");
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
    log: (m) => console.log(m),
  });
  origin = `http://127.0.0.1:${engine.port}`;

  // The page needs no camera, microphone, notifications or anything else.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // The key goes only to LUMA's own page, asked for by its preload.
  ipcMain.on("luma:key", (event) => {
    const url = event.senderFrame?.url ?? "";
    event.returnValue = url.startsWith(`${origin}/`) ? key : null;
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

let quitting = false;
app.on("before-quit", (e) => {
  if (quitting || !engine) return;
  // Let the library finish writing before the process goes.
  e.preventDefault();
  quitting = true;
  engine.close().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
