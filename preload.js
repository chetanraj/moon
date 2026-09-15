const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledge", {
  get: () => ipcRenderer.invoke("usage:get"),
  refresh: () => ipcRenderer.invoke("usage:refresh"),
  onUsage: (fn) => ipcRenderer.on("usage", (_e, data) => fn(data)),
  mouse: (over) => ipcRenderer.send("mouse", over),
  menu: () => ipcRenderer.send("menu"),
  quit: () => ipcRenderer.send("quit"),
  open: (url) => ipcRenderer.send("open", url),
  prefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (patch) => ipcRenderer.invoke("prefs:set", patch),
  providers: () => ipcRenderer.invoke("providers:list"),
});
