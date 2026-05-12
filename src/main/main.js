'use strict';
/**
 * Nexora Browser v3 — Main Process
 * Fix critico: le pagine interne (newtab, settings, ecc.) vengono caricate
 * come file HTML autonomi nel BrowserView, NON nel renderer principale.
 * Questo risolve il doppio-chrome e il flash nero.
 */

const {
  app, BrowserWindow, BrowserView,
  ipcMain, session, dialog, shell, Menu, nativeTheme, protocol, net
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL } = require('url');

// ─────────────────────────────────────────────────────────────────────────────
// COSTANTI
// ─────────────────────────────────────────────────────────────────────────────
const CHROME_HEIGHT = 88; // px: tab-strip(36) + nav-bar(52)
const INTERNAL_PAGES = new Set(['newtab','settings','history','downloads','extensions','nyra']);

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENZA
// ─────────────────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(app.getPath('userData'), 'nexora-data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE  = path.join(DATA_DIR, 'history.json');
const BOOKMARKS_FILE= path.join(DATA_DIR, 'bookmarks.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); } catch(e) { console.error(e); }
}

const DEFAULT_SETTINGS = {
  theme:           'system',  // 'light' | 'dark' | 'system'
  accentColor:     '#1A73E8',
  homepage:        'nexora://newtab',
  searchEngine:    'https://duckduckgo.com/?q=',
  downloadPath:    '',
  askDownloadPath: false,
  fontSize:        16,
  nyraApiUrl:      'https://nyra.api.aurastudioitalia.it',
};

let settings  = { ...DEFAULT_SETTINGS };
let history   = [];
let bookmarks = [];
let downloads = new Map();
let dlCounter = 0;

// Helper per trovare il webContents di una pagina interna specifica
function findInternalPageWebContents(pageName) {
  for (const [, tab] of tabs) {
    // Controlla se è una tab interna e il suo URL corrisponde al pageName
    if (tab.internal && getInternalPage(tab.url) === pageName) {
      return tab.view.webContents;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATO GLOBALE TAB
// ─────────────────────────────────────────────────────────────────────────────
let mainWindow  = null;
const tabs      = new Map();
let activeTabId = null;
let tabCounter  = 0;

// ─────────────────────────────────────────────────────────────────────────────
// URL PARSING
// ─────────────────────────────────────────────────────────────────────────────
function parseInput(raw) {
  const s = (raw || '').trim();
  if (!s) return getHomepage();
  // Pagine interne
  if (s.startsWith('nexora://')) return s;
  // Schema esplicito
  if (/^(https?|ftp):\/\//i.test(s)) return s;
  // Nessuno spazio → potenziale dominio
  if (!s.includes(' ')) {
    if (/^localhost(:\d+)?(\/.*)?$/.test(s)) return `http://${s}`;
    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return `http://${s}`;
    if (/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(s))
      return `https://${s}`;
  }
  return `${settings.searchEngine}${encodeURIComponent(s)}`;
}

function getHomepage() {
  return settings.homepage || 'nexora://newtab';
}

function isInternal(url) {
  return (url || '').startsWith('nexora://');
}

function getInternalPage(url) {
  if (!isInternal(url)) return null;
  return url.replace('nexora://', '').split('?')[0];
}

function internalToFile(url) {
  const page = getInternalPage(url);
  if (!page) return null;
  const p = INTERNAL_PAGES.has(page) ? page : 'newtab'; // Assicurati che 'newtab' sia il fallback
  return path.join(__dirname, `../renderer/pages/${p}.html`);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOUNDS
// ─────────────────────────────────────────────────────────────────────────────
function getViewBounds() {
  if (!mainWindow) return { x:0, y:0, width:800, height:600 };
  const [w, h] = mainWindow.getContentSize();
  // Se siamo in fullscreen, la vista deve occupare tutto lo spazio (offset y=0)
  const offset = mainWindow.isFullScreen() ? 0 : CHROME_HEIGHT;
  return { x: 0, y: offset, width: w, height: Math.max(0, h - offset) };
}

// ─────────────────────────────────────────────────────────────────────────────
// USER AGENT
// ─────────────────────────────────────────────────────────────────────────────
function buildUA() {
  const cv = process.versions.chrome || '124.0.0.0';
  const plat = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${plat}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv} Safari/537.36`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEMA DINAMICO
// ─────────────────────────────────────────────────────────────────────────────
function resolveTheme() {
  if (settings.theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return settings.theme;
}

nativeTheme.on('updated', () => {
  if (settings.theme === 'system') emit('theme-changed', resolveTheme());
});

// ─────────────────────────────────────────────────────────────────────────────
// TAB: CREA
// ─────────────────────────────────────────────────────────────────────────────
function createTab(url) {
  const tabId  = ++tabCounter;
  const target = parseInput(url || getHomepage());
  const internal = isInternal(target);

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload:          path.join(__dirname, '../preload/page-preload.js'),
    }
  });

  view.webContents.setUserAgent(buildUA());

  tabs.set(tabId, {
    id: tabId, view,
    url: target, title: internal ? pageTitleFor(target) : 'Nuova Tab',
    isLoading: false, favicon: null, internal,
    zoom: 1.0,
  });

  // Aggiungi invisibile
  mainWindow.addBrowserView(view);
  view.setAutoResize({ width: true, height: true });
  view.setBounds({ x:0, y:0, width:0, height:0 });

  // ── Events ──────────────────────────────────────────────────────────────
  const wc = view.webContents;

  wc.on('did-start-loading', () => {
    setTabData(tabId, { isLoading: true });
    emitTabUpdate(tabId);
  });

  wc.on('did-stop-loading', () => {
    setTabData(tabId, { isLoading: false });
    emitTabUpdate(tabId);
    if (tabId === activeTabId) emitNavState();
  });

  wc.on('did-navigate', (_, navUrl) => {
    const isInt = isInternal(navUrl) || navUrl.startsWith('file://');
    const title = isInt ? pageTitleFor(navUrl) : (tabs.get(tabId)?.title || 'Nexora');
    setTabData(tabId, { url: navUrl, internal: isInt, title });
    emitTabUpdate(tabId);
    if (tabId === activeTabId) {
      emit('url-changed', { url: navUrl, title });
      emitNavState();
    }
    if (!isInt && navUrl !== 'about:blank') addHistory(navUrl, tabs.get(tabId)?.title || navUrl);
  });

  wc.on('did-navigate-in-page', (_, navUrl) => {
    setTabData(tabId, { url: navUrl });
    if (tabId === activeTabId) emit('url-changed', { url: navUrl });
  });

  wc.on('page-title-updated', (_, title) => {
    const t = title || 'Senza titolo';
    setTabData(tabId, { title: t });
    emitTabUpdate(tabId);
    const td = tabs.get(tabId);
    if (td && !td.internal) addHistory(td.url, t);
  });

  wc.on('page-favicon-updated', (_, favicons) => {
    if (favicons?.length) {
      setTabData(tabId, { favicon: favicons[0] });
      emitTabUpdate(tabId);
    }
  });

  wc.on('did-fail-load', (_, code, desc, url, isMain) => {
    if (code === -3 || !isMain) return;
    setTabData(tabId, { isLoading: false, title: 'Errore' });
    emitTabUpdate(tabId);
    wc.loadFile(path.join(__dirname, '../renderer/pages/error.html'), {
      query: { code: String(code), desc, url: url || '' }
    });
  });

  wc.setWindowOpenHandler(({ url: newUrl }) => {
    createAndActivate(newUrl);
    return { action: 'deny' };
  });

  // ── Carica ───────────────────────────────────────────────────────────────
  loadInView(view, target);
  return tabId;
}

function loadInView(view, url) {
  // Usiamo sempre loadURL: se è nexora:// interviene il protocol.handle
  // Se è un sito esterno, carica normalmente.
  view.webContents.loadURL(url).catch(()=>{});
}

function createAndActivate(url) {
  const id = createTab(url);
  activateTab(id);
  emit('tabs-list', allTabsInfo());
}

function pageTitleFor(url) {
  const map = {
    'nexora://newtab':    'Nuova Tab',
    'nexora://settings':  'Impostazioni',
    'nexora://history':   'Cronologia',
    'nexora://downloads': 'Download',
    'nexora://extensions':'Estensioni',
    'nexora://nyra':      'Nyra AI',
  };
  return map[url] || 'Nexora';
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: UTILS
// ─────────────────────────────────────────────────────────────────────────────
function setTabData(tabId, data) {
  const t = tabs.get(tabId);
  if (t) Object.assign(t, data);
}

function tabInfo(tabId) {
  const t = tabs.get(tabId);
  if (!t) return null;
  const wc = t.view.webContents;
  return {
    id: t.id, url: t.url, title: t.title,
    isLoading: t.isLoading, favicon: t.favicon,
    isActive: tabId === activeTabId, internal: t.internal,
    canGoBack:    wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    zoom: t.zoom,
  };
}

function allTabsInfo() {
  return Array.from(tabs.keys()).map(id => tabInfo(id));
}

function emitTabUpdate(tabId) {
  emit('tab-updated', tabInfo(tabId));
}

function emitNavState() {
  const t = tabs.get(activeTabId);
  if (!t) return;
  const wc = t.view.webContents;
  emit('nav-state', {
    canGoBack:    wc.canGoBack(),
    canGoForward: wc.canGoForward(),
    isLoading:    t.isLoading,
    url:          t.url,
    zoom:         t.zoom,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: ATTIVA
// ─────────────────────────────────────────────────────────────────────────────
function activateTab(tabId) {
  if (!tabs.has(tabId)) return;

  // Nascondi tutte
  for (const [, t] of tabs) {
    t.view.setBounds({ x:0, y:0, width:0, height:0 });
  }

  const t = tabs.get(tabId);
  t.view.setBounds(getViewBounds());
  mainWindow.setTopBrowserView(t.view);
  activeTabId = tabId;

  emit('tab-activated', {
    tabId, url: t.url, title: t.title,
    canGoBack:    t.view.webContents.canGoBack(),
    canGoForward: t.view.webContents.canGoForward(),
    isLoading:    t.isLoading,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: CHIUDI
// ─────────────────────────────────────────────────────────────────────────────
function closeTab(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;

  if (tabs.size === 1) {
    loadInView(t.view, getHomepage());
    setTabData(tabId, { url: getHomepage(), title: pageTitleFor(getHomepage()), favicon: null });
    emit('tabs-list', allTabsInfo());
    emit('tab-activated', { tabId, url: getHomepage(), title: pageTitleFor(getHomepage()), canGoBack: false, canGoForward: false, isLoading: false });
    return;
  }

  const ids   = Array.from(tabs.keys());
  const idx   = ids.indexOf(tabId);
  const nextId = idx > 0 ? ids[idx - 1] : ids[idx + 1];

  t.view.setBounds({ x:0, y:0, width:0, height:0 });
  mainWindow.removeBrowserView(t.view);
  try { t.view.webContents.destroy(); } catch {}
  tabs.delete(tabId);

  if (tabId === activeTabId) activateTab(nextId);
  emit('tabs-list', allTabsInfo());
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────────────────────
function addHistory(url, title) {
  if (!url || url === 'about:blank' || url.startsWith('file://')) return;
  // Evita duplicati consecutivi
  if (history[0]?.url === url) { history[0].title = title; history[0].ts = Date.now(); saveJSON(HISTORY_FILE, history); return; }
  history.unshift({ url, title, ts: Date.now() });
  if (history.length > 1000) history = history.slice(0, 1000);
  saveJSON(HISTORY_FILE, history);
}

// ─────────────────────────────────────────────────────────────────────────────
// FINESTRA PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────
function createMainWindow() {
  const isDark = resolveTheme() === 'dark';

  mainWindow = new BrowserWindow({
    width: 1300, height: 840,
    minWidth: 700, minHeight: 500,
    frame: false,
    backgroundColor: isDark ? '#1C1B1F' : '#FFFBFE',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload:          path.join(__dirname, '../preload/preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    const firstId = createTab(getHomepage());
    activateTab(firstId);
    emit('init', {
      tabs: allTabsInfo(),
      settings,
      theme: resolveTheme(),
    });
  });

  mainWindow.on('resize', () => {
    if (activeTabId && tabs.has(activeTabId)) {
      tabs.get(activeTabId).view.setBounds(getViewBounds());
    }
  });

  mainWindow.on('maximize',   () => emit('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => emit('window-state', 'normal'));
  mainWindow.on('enter-full-screen', () => {
    emit('fullscreen', true); // Nome evento corretto per il renderer
    if (activeTabId && tabs.has(activeTabId)) tabs.get(activeTabId).view.setBounds(getViewBounds());
  });
  mainWindow.on('leave-full-screen', () => {
    emit('fullscreen', false);
    if (activeTabId && tabs.has(activeTabId)) tabs.get(activeTabId).view.setBounds(getViewBounds());
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC EMIT
// ─────────────────────────────────────────────────────────────────────────────
function emit(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// Navigazione
ipcMain.on('navigate', (_, { url }) => {
  const t = tabs.get(activeTabId);
  if (!t) return;
  const parsed = parseInput(url);
  setTabData(activeTabId, { url: parsed, internal: isInternal(parsed), title: isInternal(parsed) ? pageTitleFor(parsed) : t.title });
  loadInView(t.view, parsed);
  emit('url-changed', { url: parsed });
});

ipcMain.on('go-back', () => {
  const t = tabs.get(activeTabId);
  if (t?.view.webContents.canGoBack()) t.view.webContents.goBack();
});
ipcMain.on('go-forward', () => {
  const t = tabs.get(activeTabId);
  if (t?.view.webContents.canGoForward()) t.view.webContents.goForward();
});
ipcMain.on('reload', () => {
  const t = tabs.get(activeTabId);
  if (!t) return;
  t.isLoading ? t.view.webContents.stop() : t.view.webContents.reload();
});
ipcMain.on('hard-reload', () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.reloadIgnoringCache();
});
ipcMain.on('go-home', () => {
  const t = tabs.get(activeTabId);
  if (!t) return;
  const hp = getHomepage();
  setTabData(activeTabId, { url: hp });
  loadInView(t.view, hp);
});

// Zoom
ipcMain.on('zoom-in',    () => setZoom(activeTabId, +0.1));
ipcMain.on('zoom-out',   () => setZoom(activeTabId, -0.1));
ipcMain.on('zoom-reset', () => {
  const t = tabs.get(activeTabId);
  if (!t) return;
  t.view.webContents.setZoomFactor(1);
  setTabData(activeTabId, { zoom: 1 });
  emit('zoom-changed', { zoom: 1 });
});

function setZoom(tabId, delta) {
  const t = tabs.get(tabId);
  if (!t) return;
  const cur = t.view.webContents.getZoomFactor();
  const next = Math.min(5, Math.max(0.25, Math.round((cur + delta) * 10) / 10));
  t.view.webContents.setZoomFactor(next);
  setTabData(tabId, { zoom: next });
  emit('zoom-changed', { zoom: next });
}

// Tab
ipcMain.on('new-tab',      (_, { url } = {}) => createAndActivate(url || getHomepage()));
ipcMain.on('activate-tab', (_, { tabId }) => { activateTab(tabId); emit('tabs-list', allTabsInfo()); });
ipcMain.on('close-tab',    (_, { tabId }) => closeTab(tabId));
ipcMain.on('get-tabs',     () => emit('tabs-list', allTabsInfo()));
ipcMain.on('get-nav-state',() => emitNavState());

ipcMain.on('move-tab', (_, { tabId, toIndex }) => {
  const ids = Array.from(tabs.keys());
  const fromIndex = ids.indexOf(tabId);
  if (fromIndex === -1) return;
  ids.splice(fromIndex, 1);
  ids.splice(toIndex, 0, tabId);
  // Riordina la Map
  const newMap = new Map();
  for (const id of ids) if (tabs.has(id)) newMap.set(id, tabs.get(id));
  tabs.clear();
  for (const [k, v] of newMap) tabs.set(k, v);
  emit('tabs-list', allTabsInfo());
});

// DevTools
ipcMain.on('devtools', () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.toggleDevTools();
});

// Settings
ipcMain.on('get-settings', (e) => { e.returnValue = { settings, theme: resolveTheme() }; });
ipcMain.on('save-settings', (_, s) => {
  // Unisci le impostazioni predefinite con quelle salvate e le nuove
  settings = { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_FILE, {}), ...s };
  if (!settings.downloadPath) settings.downloadPath = app.getPath('downloads');
  saveJSON(SETTINGS_FILE, settings);
  emit('settings-updated', { settings, theme: resolveTheme() });
  emit('theme-changed', resolveTheme());
  // Ricarica le pagine interne aperte
  const settingsWebContents = findInternalPageWebContents('settings');
  if (settingsWebContents) {
    settingsWebContents.send('settings-updated', { settings, theme: resolveTheme() });
  }
  for (const [, t] of tabs) {
    // Se la tab è una pagina interna, ricaricala per applicare le nuove impostazioni
    if (t.internal) {
      loadInView(t.view, t.url);
    }
  }
});
ipcMain.on('pick-download-dir', (e) => {
  // showOpenDialogSync è sincrono, quindi e.returnValue è appropriato
  const r = dialog.showOpenDialogSync(mainWindow, { title:'Cartella download', properties:['openDirectory'] });
  e.returnValue = r?.[0] || null;
});

// Bookmarks
ipcMain.on('get-bookmarks', (e) => { e.returnValue = bookmarks; });
ipcMain.on('add-bookmark',  (_, bm) => {
  if (!bookmarks.find(b => b.url === bm.url)) {
    bookmarks.push({ ...bm, id: Date.now() });
    saveJSON(BOOKMARKS_FILE, bookmarks);
    emit('bookmarks-updated', bookmarks);
  }
});
ipcMain.on('remove-bookmark', (_, { id }) => {
  bookmarks = bookmarks.filter(b => b.id !== id);
  saveJSON(BOOKMARKS_FILE, bookmarks);
  emit('bookmarks-updated', bookmarks);
});

// History
ipcMain.on('get-history',          (e) => { e.returnValue = history; }); // get-history è una chiamata sincrona, e.returnValue è corretto
ipcMain.on('clear-history',        () => {
  history = [];
  saveJSON(HISTORY_FILE, history);
  findInternalPageWebContents('history')?.send('history-updated', []); // Invia l'aggiornamento solo alla BrowserView della cronologia
});
ipcMain.on('remove-history-item',  (_, { ts }) => {
  history = history.filter(h => h.ts !== ts);
  saveJSON(HISTORY_FILE, history);
  findInternalPageWebContents('history')?.send('history-updated', history); // Invia l'aggiornamento solo alla BrowserView della cronologia
});

// Downloads
ipcMain.on('get-downloads',    (event) => {
  // get-downloads è una richiesta, rispondi direttamente al mittente
  event.sender.send('downloads-list', Array.from(downloads.values()));
});
ipcMain.on('open-download',    (_, { id }) => { const d=downloads.get(id); if(d?.savePath) shell.openPath(d.savePath); });
ipcMain.on('show-in-folder',   (_, { id }) => { const d=downloads.get(id); if(d?.savePath) shell.showItemInFolder(d.savePath); });
ipcMain.on('clear-downloads',  () => {
  downloads.clear();
  findInternalPageWebContents('downloads')?.send('downloads-list', []); // Invia l'aggiornamento solo alla BrowserView dei download
});
ipcMain.on('cancel-download',  (_, { id }) => { const d=downloads.get(id); if(d?.item) d.item.cancel(); });

// Window
ipcMain.on('window-minimize',  () => mainWindow?.minimize());
ipcMain.on('window-maximize',  () => { if(!mainWindow) return; mainWindow.isMaximized()?mainWindow.unmaximize():mainWindow.maximize(); });
ipcMain.on('window-close',     () => mainWindow?.close());
ipcMain.on('window-fullscreen',() => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));

// Find in page
ipcMain.on('find-start', (_, { text }) => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.findInPage(text, { findNext: false });
});
ipcMain.on('find-next',  (_, { text }) => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.findInPage(text, { findNext: true });
});
ipcMain.on('find-prev',  (_, { text }) => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.findInPage(text, { findNext: true, forward: false });
});
ipcMain.on('find-stop',  () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.stopFindInPage('clearSelection');
});

// Print
ipcMain.on('print-page', () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.print({}, (success, err) => {
    if (!success && err !== 'cancelled') console.error('Print error:', err);
  });
});
ipcMain.on('save-page', async () => {
  const t = tabs.get(activeTabId);
  if (!t) return;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), 'pagina.html'),
    filters:[{name:'Pagina HTML',extensions:['html']}]
  });
  if (filePath) t.view.webContents.savePage(filePath, 'HTMLComplete').catch(console.error);
});

// Page context menu (right click in BrowserView)
ipcMain.on('show-page-context-menu', (_, { x, y, params }) => {
  buildPageContextMenu(params).popup({ window: mainWindow, x, y });
});

// App menu
ipcMain.on('show-app-menu', (_, { x, y }) => {
  buildAppMenu().popup({ window: mainWindow, x, y });
});

// Nyra AI proxy (evita CORS nel renderer)
ipcMain.handle('nyra-chat', async (_, { messages, model }) => {
  try {
    const resp = await fetch(`${settings.nyraApiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'nyra-1', messages, stream: false })
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('nyra-models', async () => {
  try {
    const resp = await fetch(`${settings.nyraApiUrl}/v1/models`);
    if (!resp.ok) return { models: [] };
    return await resp.json();
  } catch { return { models: [] }; }
});

// ─────────────────────────────────────────────────────────────────────────────
// MENUS
// ─────────────────────────────────────────────────────────────────────────────
function buildAppMenu() {
  const sep = { type: 'separator' };
  return Menu.buildFromTemplate([
    { label: 'Nuova tab',           icon: undefined, accelerator:'CmdOrCtrl+T',  click: ()=>createAndActivate(getHomepage()) },
    { 
      label: 'Nuova finestra privata', 
      accelerator:'CmdOrCtrl+Shift+N', 
      click: () => {
        // Semplice implementazione per aprire una nuova istanza (andrebbe rifinito con sessioni separate)
        const win = new BrowserWindow({ width: 1200, height: 800 });
        win.setMenu(null);
        win.loadURL('https://duckduckgo.com');
      }
    },
    sep,
    { label: 'Cronologia',          accelerator:'CmdOrCtrl+H', click:()=>createAndActivate('nexora://history') },
    { label: 'Download',            accelerator:'CmdOrCtrl+J', click:()=>createAndActivate('nexora://downloads') },
    { label: 'Estensioni',          click:()=>createAndActivate('nexora://extensions') },
    { label: 'Nyra AI',             click:()=>createAndActivate('nexora://nyra') },
    sep,
    { label: 'Cerca nella pagina…', accelerator:'CmdOrCtrl+F',  click:()=>emit('toggle-find', null) },
    { label: 'Salva pagina come…',  accelerator:'CmdOrCtrl+S',  click:()=>ipcMain.emit('save-page') },
    { label: 'Stampa…',             accelerator:'CmdOrCtrl+P',  click:()=>ipcMain.emit('print-page') },
    sep,
    { label: 'Zoom +',              accelerator:'CmdOrCtrl+=',  click:()=>setZoom(activeTabId,+0.1) },
    { label: 'Zoom −',              accelerator:'CmdOrCtrl+-',  click:()=>setZoom(activeTabId,-0.1) },
    { label: 'Reimposta zoom',       accelerator:'CmdOrCtrl+0', click:()=>ipcMain.emit('zoom-reset') },
    sep,
    { label: 'Schermo intero',       accelerator:'F11',   click:()=>mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
    { label: 'Strumenti sviluppatore',accelerator:'F12',  click:()=>{ const t=tabs.get(activeTabId); if(t) t.view.webContents.toggleDevTools(); } },
    sep,
    { label: 'Impostazioni',         accelerator:'CmdOrCtrl+,', click:()=>createAndActivate('nexora://settings') },
    sep,
    { label: 'Esci',                 role:'quit' },
  ]);
}

function buildPageContextMenu(params) {
  const items = [];
  if (params.linkURL) {
    items.push(
      { label:'Apri link in nuova tab',   click:()=>createAndActivate(params.linkURL) },
      { label:'Copia link',               click:()=>require('electron').clipboard.writeText(params.linkURL) },
      { type:'separator' }
    );
  }
  if (params.hasImageContents) {
    items.push(
      { label:'Apri immagine in nuova tab', click:()=>createAndActivate(params.srcURL) },
      { label:'Copia URL immagine',          click:()=>require('electron').clipboard.writeText(params.srcURL) },
      { type:'separator' }
    );
  }
  if (params.selectionText) {
    const q = params.selectionText.trim().slice(0,120);
    items.push(
      { label:'Cerca "'+q+'"', click:()=>createAndActivate(settings.searchEngine+encodeURIComponent(q)) },
      { label:'Copia',          role:'copy' },
      { type:'separator' }
    );
  }
  if (params.isEditable) {
    items.push(
      { label:'Taglia',  role:'cut' },
      { label:'Copia',   role:'copy' },
      { label:'Incolla', role:'paste' },
      { type:'separator' }
    );
  }
  items.push(
    { label:'Indietro',  enabled:tabs.get(activeTabId)?.view.webContents.canGoBack(),    click:()=>ipcMain.emit('go-back') },
    { label:'Avanti',    enabled:tabs.get(activeTabId)?.view.webContents.canGoForward(), click:()=>ipcMain.emit('go-forward') },
    { label:'Aggiorna',  click:()=>ipcMain.emit('reload') },
    { type:'separator' },
    { label:'Salva pagina…', click:()=>ipcMain.emit('save-page') },
    { label:'Stampa…',       click:()=>ipcMain.emit('print-page') },
    { type:'separator' },
    { label:'Strumenti sviluppatore', click:()=>{ const t=tabs.get(activeTabId); if(t) t.view.webContents.toggleDevTools(); } }
  );
  return Menu.buildFromTemplate(items);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD HANDLER
// ─────────────────────────────────────────────────────────────────────────────
function setupDownloads() {
  session.defaultSession.on('will-download', async (_, item) => {
    const id   = ++dlCounter;
    const fname = item.getFilename();
    let saveTo  = path.join(settings.downloadPath || app.getPath('downloads'), fname);

    if (settings.askDownloadPath) {
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: saveTo, title: 'Salva file'
      });
      if (!filePath) { item.cancel(); return; }
      saveTo = filePath;
    }

    item.setSavePath(saveTo);

    const info = { id, filename: fname, url: item.getURL(), savePath: saveTo,
                   totalBytes: item.getTotalBytes(), receivedBytes: 0,
                   state: 'progressing', startTime: Date.now(), item };
    downloads.set(id, info);
    emit('download-started', sanitizeDl(info));
    // Invia l'aggiornamento alla BrowserView dei download se aperta
    findInternalPageWebContents('downloads')?.send('download-updated', sanitizeDl(info));

    item.on('updated', (_, state) => {
      info.receivedBytes = item.getReceivedBytes();
      info.totalBytes    = item.getTotalBytes();
      info.state         = state;
      emit('download-updated', sanitizeDl(info));
      // Invia l'aggiornamento alla BrowserView dei download se aperta
      findInternalPageWebContents('downloads')?.send('download-updated', sanitizeDl(info));
    });

    item.once('done', (_, state) => {
      info.state         = state;
      info.receivedBytes = item.getReceivedBytes();
      delete info.item;
      emit('download-done', sanitizeDl(info));
      // Invia l'aggiornamento alla BrowserView dei download se aperta
      findInternalPageWebContents('downloads')?.send('download-done', sanitizeDl(info));
    });
  });
}

function sanitizeDl(d) {
  const { item: _, ...rest } = d;
  return rest;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER FILTER
// ─────────────────────────────────────────────────────────────────────────────
function setupHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const h = {};
    for (const [k,v] of Object.entries(details.responseHeaders||{})) h[k.toLowerCase()]=v;
    delete h['x-frame-options'];
    delete h['content-security-policy'];
    delete h['content-security-policy-report-only'];
    cb({ responseHeaders: h });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU per BrowserView (right-click)
// ─────────────────────────────────────────────────────────────────────────────
function setupContextMenu() {
  app.on('web-contents-created', (_, wc) => {
    wc.on('context-menu', (e, params) => {
      // Solo per le BrowserView (non il renderer principale)
      if (wc.id === mainWindow?.webContents.id) return;
      buildPageContextMenu(params).popup({ window: mainWindow });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
Menu.setApplicationMenu(null);

function registerNexoraProtocol() {
  protocol.handle('nexora', (request) => {
    try {
      const url = new URL(request.url);
      const host = url.host; 
      let pathname = url.pathname;
      if (pathname.startsWith('/')) pathname = pathname.slice(1); // Rimuove lo slash iniziale

      let targetPath;

      // Prioritizza la risoluzione di asset comuni (CSS, JS) basandosi sul pathname
      if (pathname.startsWith('styles/')) {
        // Esempio: nexora://newtab/styles/tokens.css -> src/renderer/styles/tokens.css
        // Esempio: nexora://styles/tokens.css -> src/renderer/styles/tokens.css
        targetPath = path.resolve(__dirname, '..', 'renderer', 'styles', pathname.substring('styles/'.length));
      } else if (pathname.startsWith('components/')) {
        // Esempio: nexora://history/components/history.js -> src/renderer/components/history.js
        // Esempio: nexora://components/history.js -> src/renderer/components/history.js
        targetPath = path.resolve(__dirname, '..', 'renderer', 'components', pathname.substring('components/'.length));
      } else if (INTERNAL_PAGES.has(host) && (pathname === '' || pathname === 'index.html')) {
        // Carica la pagina HTML principale di una pagina interna (es. nexora://newtab -> src/renderer/pages/newtab.html)
        targetPath = path.resolve(__dirname, '..', 'renderer', 'pages', `${host}.html`);
      } else if (INTERNAL_PAGES.has(host)) {
        // Carica altri asset specifici di una pagina interna (es. nexora://newtab/logo.png -> src/renderer/pages/logo.png)
        targetPath = path.resolve(__dirname, '..', 'renderer', 'pages', pathname);
      } else {
        // Fallback per altri tipi di richieste nexora://host/path
        targetPath = path.resolve(__dirname, '..', 'renderer', host, pathname);
      }
      return net.fetch(pathToFileURL(targetPath).toString());
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });
}

// Registrazione dello schema nexora prima che l'app sia pronta
protocol.registerSchemesAsPrivileged([
  { scheme: 'nexora', privileges: { standard: true, secure: true, allowServiceWorkers: true, supportFetchAPI: true } }
]);

app.whenReady().then(() => {
  ensureDataDir();
  settings  = { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_FILE, {}) };
  if (!settings.downloadPath) settings.downloadPath = app.getPath('downloads');
  history   = loadJSON(HISTORY_FILE,   []);
  bookmarks = loadJSON(BOOKMARKS_FILE, []);

  // Gestione protocollo personalizzato (Electron 25+)
  if (protocol.handle) {
    registerNexoraProtocol();
  }

  setupHeaders();
  setupDownloads();
  setupContextMenu();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
