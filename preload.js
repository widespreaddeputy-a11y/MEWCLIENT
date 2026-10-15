const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mew', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  getVersions: () => ipcRenderer.invoke('versions:get'),

  launch: (cfg) => ipcRenderer.invoke('game:launch', cfg),
  onLog: (cb) => ipcRenderer.on('launch:log', (_e, d) => cb(d)),
  onProgress: (cb) => ipcRenderer.on('launch:progress', (_e, d) => cb(d)),
  onClose: (cb) => ipcRenderer.on('launch:close', (_e, d) => cb(d)),

  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  pickFolder: () => ipcRenderer.invoke('shell:pickFolder'),
  pickJava: () => ipcRenderer.invoke('shell:pickJava'),
  detectJava: () => ipcRenderer.invoke('java:detect'),

  appInfo: () => ipcRenderer.invoke('app:info')
});