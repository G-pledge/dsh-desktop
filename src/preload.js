const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDesktop", {
  webview: true,
  onStatus: (fn) => ipcRenderer.on("status", (_e, t) => fn(t)),
  onLog: (fn) => ipcRenderer.on("log", (_e, t) => fn(t)),
  onDownload: (fn) => {
    const handler = (_e, item) => fn(item);
    ipcRenderer.on("dsh-download", handler);
    return () => ipcRenderer.removeListener("dsh-download", handler);
  },
  cancelDownload: (id) => ipcRenderer.send("dsh-download-cancel", id),
  openDownload: (filePath) => ipcRenderer.send("dsh-download-show", filePath),
  openDownloadsFolder: () => ipcRenderer.send("dsh-download-folder"),
  openGuestDevtools: (id, mode) => ipcRenderer.invoke("dsh-webview-devtools", { id, mode }),
  attachGuestDevtools: (pageId, box) => ipcRenderer.invoke("dsh-webview-devtools-attach", { pageId, box }),
  moveGuestDevtools: (box) => ipcRenderer.send("dsh-webview-devtools-move", box),
  closeGuestDevtools: (pageId) => ipcRenderer.invoke("dsh-webview-devtools-close", { pageId }),
  clearBrowserData: (partition, kind) => ipcRenderer.invoke("dsh-browser-clear", { partition, kind }),
  setBrowserProxy: (partition, config) => ipcRenderer.invoke("dsh-browser-proxy", { partition, config }),
});
