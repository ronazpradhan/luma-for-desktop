// The only bridge between LUMA's page and the app: the engine key, the
// platform, and YouTube sign-in (from the listener's browser or a file).
const { contextBridge, ipcRenderer } = require("electron");

const key = ipcRenderer.sendSync("luma:key");
if (key) {
  contextBridge.exposeInMainWorld("luma", Object.freeze({
    key,
    platform: process.platform,
    youtubeBrowsers: () => ipcRenderer.invoke("luma:youtube-browsers"),
    youtubeFromBrowser: (browser) => ipcRenderer.invoke("luma:youtube-from-browser", browser),
    youtubeFromFile: () => ipcRenderer.invoke("luma:youtube-from-file"),
    youtubeSignOut: () => ipcRenderer.invoke("luma:youtube-sign-out"),
  }));
}
