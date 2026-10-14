// The only bridge between LUMA's page and the app: the engine key and the platform.
const { contextBridge, ipcRenderer } = require("electron");

const key = ipcRenderer.sendSync("luma:key");
if (key) contextBridge.exposeInMainWorld("luma", Object.freeze({ key, platform: process.platform }));
