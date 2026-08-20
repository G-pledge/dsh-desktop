const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  onStatus(callback) {
    ipcRenderer.on("status", (_event, text) => callback(text));
  },
  onLog(callback) {
    ipcRenderer.on("log", (_event, text) => callback(text));
  },
});
