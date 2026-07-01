const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  close: () => ipcRenderer.send('window-close'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  getSession: () => ipcRenderer.invoke('session-get'),
  saveSession: (token, user) => ipcRenderer.send('session-save', token, user),
  clearSession: () => ipcRenderer.send('session-clear'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  openDownload: (url) => ipcRenderer.send('open-download', url),
});
