'use strict';
/**
 * Nexora Browser v2 — Preload
 * Bridge sicuro tra renderer e main tramite contextBridge
 */
const { contextBridge, ipcRenderer } = require('electron');

// Helper per registrare un listener IPC una sola volta
function on(ch, cb) { ipcRenderer.on(ch, (_, data) => cb(data)); }

contextBridge.exposeInMainWorld('nexora', {
  // ── Navigazione ────────────────────────────────────────────────────────────
  navigate:   (url)        => ipcRenderer.send('navigate',   { url }),
  goBack:     ()           => ipcRenderer.send('go-back'),
  goForward:  ()           => ipcRenderer.send('go-forward'),
  reload:     ()           => ipcRenderer.send('reload'),
  goHome:     ()           => ipcRenderer.send('go-home'),

  // ── Tab ────────────────────────────────────────────────────────────────────
  newTab:      (url)       => ipcRenderer.send('new-tab',      { url }),
  activateTab: (tabId)     => ipcRenderer.send('activate-tab', { tabId }),
  closeTab:    (tabId)     => ipcRenderer.send('close-tab',    { tabId }),
  getTabs:     ()          => ipcRenderer.send('get-tabs'),
  getNavState: ()          => ipcRenderer.send('get-nav-state'),

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings:     ()      => ipcRenderer.sendSync('get-settings'),
  saveSettings:    (s)     => ipcRenderer.send('save-settings', s),
  pickDownloadDir: ()      => ipcRenderer.sendSync('pick-download-dir'),

  // ── Bookmarks ──────────────────────────────────────────────────────────────
  addBookmark:    (bm)     => ipcRenderer.send('add-bookmark',    bm),
  removeBookmark: (id)     => ipcRenderer.send('remove-bookmark', { id }),

  // ── History ────────────────────────────────────────────────────────────────
  getHistory:         ()   => ipcRenderer.sendSync('get-history'),
  clearHistory:       ()   => ipcRenderer.send('clear-history'),
  removeHistoryItem:  (ts) => ipcRenderer.send('remove-history-item', { ts }),

  // ── Downloads ──────────────────────────────────────────────────────────────
  getDownloads:    ()      => ipcRenderer.send('get-downloads'),
  openDownload:    (id)    => ipcRenderer.send('open-download',  { id }),
  showDownload:    (id)    => ipcRenderer.send('show-download',  { id }),
  clearDownloads:  ()      => ipcRenderer.send('clear-downloads'),

  // ── Window ─────────────────────────────────────────────────────────────────
  minimize:    () => ipcRenderer.send('window-minimize'),
  maximize:    () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  fullscreen:  () => ipcRenderer.send('window-fullscreen'),
  showAppMenu: (x, y) => ipcRenderer.send('show-app-menu', { x, y }),

  // ── Event listeners ────────────────────────────────────────────────────────
  on,
  off: (ch, cb) => ipcRenderer.removeListener(ch, cb),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch),
});
