const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('companion', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  checkTools: () => ipcRenderer.invoke('tools:check'),
  stackStatus: () => ipcRenderer.invoke('stack:status'),
  install: () => ipcRenderer.invoke('stack:install'),
  start: () => ipcRenderer.invoke('stack:start'),
  stop: () => ipcRenderer.invoke('stack:stop'),
  installMirror: (payload) => ipcRenderer.invoke('mirror:install', payload),
  openApp: () => ipcRenderer.invoke('open:app'),
  pickDir: () => ipcRenderer.invoke('pick:dir'),
  onLog: (fn) => ipcRenderer.on('log', (_e, m) => fn(m)),
})
