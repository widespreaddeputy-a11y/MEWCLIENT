const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mew', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),
  getVersions: () => ipcRenderer.invoke('versions:get'),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  launch: (cfg) => ipcRenderer.invoke('game:launch', cfg),

  onLog: (cb) => ipcRenderer.on('launch:log', (_e, d) => cb(d)),
  onClose: (cb) => ipcRenderer.on('launch:close', (_e, d) => cb(d)),

  // Настройки и система
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  pickFolder: () => ipcRenderer.invoke('shell:pickFolder'),
  pickJava: () => ipcRenderer.invoke('shell:pickJava'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  pickBgImage: () => ipcRenderer.invoke('bg:pick'),

  // Магазин Modrinth
  searchMods: (q) => ipcRenderer.invoke('mods:search', q),
  downloadMod: (id, ver, loader) => ipcRenderer.invoke('mods:download', { projectId: id, version: ver, loader }),

  // Сервера и скриншоты
  pingServer: (ip) => ipcRenderer.invoke('server:ping', ip),
  getScreenshots: () => ipcRenderer.invoke('screenshots:list'),

  // Моды
  modsList: () => ipcRenderer.invoke('mods:list'),
  modsRemove: (f) => ipcRenderer.invoke('mods:remove', f),
  modsDrop: (paths) => ipcRenderer.invoke('mods:drop', paths)
});