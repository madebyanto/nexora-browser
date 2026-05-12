'use strict';
/**
 * Nexora Browser v2 — Renderer App
 * Orchestratore principale: gestisce UI, tab, pagine interne, IPC
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATO
// ─────────────────────────────────────────────────────────────────────────────
let settings    = {};
let currentUrl  = '';
let isLoading   = false;
let omniboxFocus = false;
let tabBar;

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  settings = window.nexora.getSettings();

  // Applica tema e colore accento immediatamente
  applyTheme(settings.theme);
  applyAccent(settings.accentColor);

  // Tab bar
  tabBar = new TabBar(document.getElementById('tabs-list'));

  // Bootstrap
  initChrome();
  initOmnibox();
  initIPC();
  initKeyboard();

  // Richiedi stato iniziale
  window.nexora.getTabs();
  window.nexora.getNavState();
});

// ─────────────────────────────────────────────────────────────────────────────
// CHROME CONTROLS
// ─────────────────────────────────────────────────────────────────────────────
function initChrome() {
  // Nav buttons
  ge('btn-back')   .addEventListener('click', ()  => window.nexora.goBack());
  ge('btn-forward').addEventListener('click', ()  => window.nexora.goForward());
  ge('btn-reload') .addEventListener('click', ()  => window.nexora.reload());
  ge('btn-home')   .addEventListener('click', ()  => window.nexora.goHome());
  ge('btn-new-tab').addEventListener('click', ()  => window.nexora.newTab());

  // Bookmark
  ge('btn-bookmark').addEventListener('click', () => {
    const btn = ge('btn-bookmark');
    if (btn.classList.contains('bookmarked')) return; // già salvato
    window.nexora.addBookmark({ url: currentUrl, title: document.title || currentUrl });
    btn.classList.add('bookmarked');
    btn.title = 'Già nei segnalibri';
  });

  // Menu
  ge('btn-menu').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    window.nexora.showAppMenu(Math.round(rect.left), Math.round(rect.bottom + 4));
  });

  // Window controls
  ge('btn-min').addEventListener('click', () => window.nexora.minimize());
  ge('btn-max').addEventListener('click', () => window.nexora.maximize());
  ge('btn-cls').addEventListener('click', () => window.nexora.closeWindow());
}

// ─────────────────────────────────────────────────────────────────────────────
// OMNIBOX
// ─────────────────────────────────────────────────────────────────────────────
function initOmnibox() {
  const omni = ge('omnibox');

  omni.addEventListener('focus', () => {
    omniboxFocus = true;
    omni.select();
  });

  omni.addEventListener('blur', () => {
    omniboxFocus = false;
    // Ripristina URL corrente
    if (!omni.value.trim()) setOmnibox(currentUrl);
  });

  omni.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = omni.value.trim();
      if (val) { window.nexora.navigate(val); omni.blur(); }
    }
    if (e.key === 'Escape') {
      setOmnibox(currentUrl);
      omni.blur();
    }
  });
}

function setOmnibox(url) {
  if (!omniboxFocus) ge('omnibox').value = url || '';
}

function setLoading(loading) {
  isLoading = loading;
  const btn      = ge('btn-reload');
  const refresh  = btn.querySelector('.ico-refresh');
  const stop     = btn.querySelector('.ico-stop');
  const wrap     = ge('omnibox-wrap');

  btn.classList.toggle('loading', loading);
  refresh.style.display = loading ? 'none' : '';
  stop.style.display    = loading ? ''     : 'none';
  wrap.classList.toggle('loading', loading);
}

function setNavState(canGoBack, canGoForward) {
  ge('btn-back').disabled    = !canGoBack;
  ge('btn-forward').disabled = !canGoForward;
}

function applyTheme(theme) {
  const resolved = (theme === 'system') 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

function applyAccent(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--accent', color);
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC LISTENERS
// ─────────────────────────────────────────────────────────────────────────────
function initIPC() {
  // Full tabs list refresh
  window.nexora.on('tabs-list', (tabs) => {
    tabBar.sync(tabs);
  });

  // Single tab updated
  window.nexora.on('tab-updated', (info) => {
    tabBar.sync(tabBar.data.has(info.id)
      ? Array.from(tabBar.data.values()).map(t => t.id === info.id ? info : t)
      : [...Array.from(tabBar.data.values()), info]
    );
    if (info.isActive) {
      setLoading(info.isLoading);
      setNavState(info.canGoBack, info.canGoForward);
    }
  });

  // Tab activated
  window.nexora.on('tab-activated', (data) => {
    tabBar.setActive(data.tabId);
    currentUrl = data.url || '';
    setOmnibox(currentUrl);
    setNavState(data.canGoBack, data.canGoForward);
    setLoading(data.isLoading || false); // Questo è ancora rilevante per l'icona di ricarica
    updateBookmarkBtn(currentUrl);
  });

  // URL changed (navigation within active tab)
  window.nexora.on('url-changed', (data) => {
    currentUrl = data.url || '';
    setOmnibox(currentUrl); // Aggiorna la barra degli indirizzi
    updateBookmarkBtn(currentUrl);
  });

  // Settings updated
  window.nexora.on('settings-updated', (data) => {
    settings = data.settings;
    applyTheme(data.theme);
    applyAccent(settings.accentColor);
  });

  // History cleared
  window.nexora.on('history-cleared', () => { /* Il renderer principale non renderizza direttamente la cronologia */ });

  // Downloads
  window.nexora.on('downloads-list', (list) => {
    dlStore.clear();
    list.forEach(d => dlStore.set(d.id, d));
    renderDownloads();
  });

  window.nexora.on('download-started', (d) => { // Questo evento è per il toast, che è nel renderer principale
    dlStore.set(d.id, d);
    showDlToast(d);
    // renderDownloads(); // Rimosso: Il renderer principale non renderizza la pagina dei download
  });

  window.nexora.on('download-progress', (d) => { // Questo evento è per il toast, che è nel renderer principale
    dlStore.set(d.id, d);
    showDlToast(d);
    // Rimosso: Il renderer principale non renderizza la pagina dei download
    // const pgEl = ge('page-downloads');
    // if (pgEl && pgEl.style.display !== 'none') renderDownloads();
  });

  window.nexora.on('download-done', (d) => {
    dlStore.set(d.id, d);
    showDlToast(d);
    // Rimosso: Il renderer principale non renderizza la pagina dei download
    // const pgEl = ge('page-downloads');
    // if (pgEl && pgEl.style.display !== 'none') renderDownloads();
  });

  window.nexora.on('fullscreen', (isFs) => {
    document.body.classList.toggle('fullscreen', isFs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 't')         { e.preventDefault(); window.nexora.newTab(); }
    if (ctrl && e.key === 'w')         { e.preventDefault(); /* close active tab */ closeCurrent(); }
    if (ctrl && e.key === 'l')         { e.preventDefault(); ge('omnibox').focus(); ge('omnibox').select(); }
    if (ctrl && e.key === ',')         { e.preventDefault(); window.nexora.navigate('nexora://settings'); }
    if (ctrl && e.key === 'h')         { e.preventDefault(); window.nexora.navigate('nexora://history'); }
    if (ctrl && e.key === 'j')         { e.preventDefault(); window.nexora.navigate('nexora://downloads'); }
    if (e.key  === 'F5')              { e.preventDefault(); window.nexora.reload(); }
    if (e.key  === 'F11')             { e.preventDefault(); window.nexora.fullscreen(); }
    if (e.altKey && e.key==='ArrowLeft')  { e.preventDefault(); window.nexora.goBack(); }
    if (e.altKey && e.key==='ArrowRight') { e.preventDefault(); window.nexora.goForward(); }
    if (ctrl && e.key === 'Tab')       { e.preventDefault(); cycleTabs(e.shiftKey?-1:1); }
    // Ctrl+1..9 seleziona tab
    if (ctrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const ids = Array.from(tabBar.data.keys());
      const idx = +e.key - 1;
      if (ids[idx]) window.nexora.activateTab(ids[idx]);
    }
  });
}

function closeCurrent() {
  const active = Array.from(tabBar.data.values()).find(t => t.isActive);
  if (active) window.nexora.closeTab(active.id);
}

function cycleTabs(dir) {
  const ids = Array.from(tabBar.data.keys());
  if (ids.length < 2) return;
  const active = Array.from(tabBar.data.values()).find(t => t.isActive);
  const idx = active ? ids.indexOf(active.id) : 0;
  const next = ids[(idx + dir + ids.length) % ids.length];
  window.nexora.activateTab(next);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK BUTTON STATE
// ─────────────────────────────────────────────────────────────────────────────
function updateBookmarkBtn(url) {
  const btn = ge('btn-bookmark');
  if (!btn) return;
  const isInternal = !url || url.startsWith('nexora://') || url.startsWith('file://');
  btn.disabled = isInternal;
  if (isInternal) { btn.classList.remove('bookmarked'); return; }
  const already = (settings.bookmarks||[]).some(b => b.url === url);
  btn.classList.toggle('bookmarked', already);
  btn.title = already ? 'Già nei segnalibri' : 'Salva segnalibro';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
function ge(id) { return document.getElementById(id); }

function tryHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
