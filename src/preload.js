const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  onStatus: (fn) => ipcRenderer.on("status", (_e, t) => fn(t)),
  onLog: (fn) => ipcRenderer.on("log", (_e, t) => fn(t)),
});
