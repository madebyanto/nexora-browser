'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexora', {
  navigate: (url) => ipcRenderer.send('navigate', { url }),
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  saveSettings: (s) => ipcRenderer.send('save-settings', s),
  clearHistory: () => ipcRenderer.send('clear-history'),
  clearDownloads: () => ipcRenderer.send('clear-downloads'),
  pickDownloadDir: () => ipcRenderer.sendSync('pick-download-dir'),
  on: (ch, cb) => {
    ipcRenderer.on(ch, (_, data) => cb(data));
  }
});