// The only bridge between LUMA's page and the app: the engine key, the
// platform, sign-ins (from the listener's browser or a file), and updates.
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
    spotifyFromBrowser: (browser) => ipcRenderer.invoke("luma:spotify-from-browser", browser),
    spotifyFromFile: () => ipcRenderer.invoke("luma:spotify-from-file"),
    spotifyFromText: (text) => ipcRenderer.invoke("luma:spotify-from-text", text),
    spotifySignOut: () => ipcRenderer.invoke("luma:spotify-sign-out"),
    canUninstall: () => ipcRenderer.invoke("luma:can-uninstall"),
    uninstall: () => ipcRenderer.invoke("luma:uninstall"),
    updateState: () => ipcRenderer.invoke("luma:update-state"),
    checkForUpdates: () => ipcRenderer.invoke("luma:update-check"),
    installUpdate: () => ipcRenderer.invoke("luma:update-install"),
    onUpdate: (fn) => {
      const listener = (_e, state) => fn(state);
      ipcRenderer.on("luma:update", listener);
      return () => ipcRenderer.removeListener("luma:update", listener);
    },
  }));
}
