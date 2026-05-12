'use strict';
/* Nexora v2 — Settings Panel */

const ACCENT_PRESETS = ['#7C4DFF','#1976D2','#00897B','#E91E63','#FF6D00','#43A047','#F4511E'];

function initSettings(settings) {
  // populate fields
  const $ = id => document.getElementById(id);

  $('cfg-homepage').value = settings.homepage || 'nexora://newtab';

  // engine
  const engines = ['https://duckduckgo.com/?q=','https://www.google.com/search?q=','https://www.bing.com/search?q=','https://search.brave.com/search?q='];
  const engSel = $('cfg-engine');
  if (engines.includes(settings.searchEngine)) {
    engSel.value = settings.searchEngine;
  } else {
    engSel.value = 'custom';
    $('row-custom-engine').style.display = '';
    $('cfg-custom-engine').value = settings.searchEngine;
  }
  engSel.addEventListener('change', () => {
    $('row-custom-engine').style.display = engSel.value === 'custom' ? '' : 'none';
  });

  $('cfg-theme').value = settings.theme || 'dark';
  $('cfg-accent').value = settings.accentColor || '#7C4DFF';
  $('cfg-ask-dl').checked = !!settings.askDownloadPath;

  const lblDl = $('lbl-dl-path');
  if (lblDl) lblDl.textContent = settings.downloadPath || '—';

  // color presets
  const presetsEl = $('color-presets');
  if (presetsEl) {
    presetsEl.innerHTML = ACCENT_PRESETS.map(c =>
      `<div class="color-dot${c===settings.accentColor?' selected':''}" data-color="${c}" style="background:${c}" title="${c}"></div>`
    ).join('');
    presetsEl.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        presetsEl.querySelectorAll('.color-dot').forEach(d=>d.classList.remove('selected'));
        dot.classList.add('selected');
        $('cfg-accent').value = dot.dataset.color;
        applyAccent(dot.dataset.color);
      });
    });
  }

  $('cfg-accent').addEventListener('input', e => applyAccent(e.target.value));

  // pick download dir
  const btnPick = $('btn-pick-dl');
  if (btnPick) {
    btnPick.addEventListener('click', () => {
      const dir = window.nexora.pickDownloadDir();
      if (dir) { $('lbl-dl-path').textContent = dir; btnPick.dataset.dir = dir; }
    });
  }

  // save
  $('btn-save-settings').addEventListener('click', () => {
    const engineVal = engSel.value === 'custom'
      ? ($('cfg-custom-engine').value.trim() || 'https://duckduckgo.com/?q=')
      : engSel.value;

    const newSettings = {
      homepage:       $('cfg-homepage').value.trim() || 'nexora://newtab',
      searchEngine:   engineVal,
      theme:          $('cfg-theme').value,
      accentColor:    $('cfg-accent').value,
      downloadPath:   btnPick?.dataset?.dir || settings.downloadPath,
      askDownloadPath:$('cfg-ask-dl').checked,
      bookmarks:      settings.bookmarks || []
    };

    window.nexora.saveSettings(newSettings);
    applyTheme(newSettings.theme);
    applyAccent(newSettings.accentColor);

    const msg = $('settings-saved-msg');
    msg.style.display = 'inline';
    setTimeout(()=>{ msg.style.display='none'; }, 2000);
  });

  renderSettingsBookmarks(settings.bookmarks || []);
}

function renderSettingsBookmarks(bookmarks) {
  const el = document.getElementById('settings-bookmarks-list');
  if (!el) return;
  if (!bookmarks.length) {
    el.innerHTML = '<p style="padding:14px 20px;font-size:13px;color:var(--on-s3)">Nessun segnalibro salvato.</p>';
    return;
  }
  el.innerHTML = bookmarks.map(bm => `
    <div class="bm-item">
      <span class="bm-item-title">${esc(bm.title||bm.url)}</span>
      <span class="bm-item-url">${esc(bm.url)}</span>
      <button class="bm-remove" data-id="${bm.id}" title="Rimuovi">
        <svg viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>`).join('');
  el.querySelectorAll('.bm-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      window.nexora.removeBookmark(+btn.dataset.id);
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'dark');
}

function applyAccent(color) {
  if (!color) return;
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  // compute dim (darken ~15%)
  root.style.setProperty('--accent-dim', shadeHex(color, -20));
  root.style.setProperty('--accent-soft', hexToRgba(color, .15));
  root.style.setProperty('--accent-glow', hexToRgba(color, .30));
}

function shadeHex(hex, amt) {
  let n = parseInt(hex.slice(1), 16);
  let r = Math.min(255, Math.max(0, (n>>16) + amt));
  let g = Math.min(255, Math.max(0, ((n>>8)&0xff) + amt));
  let b = Math.min(255, Math.max(0, (n&0xff) + amt));
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n>>16},${(n>>8)&0xff},${n&0xff},${a})`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.initSettings = initSettings;
window.applyTheme   = applyTheme;
window.applyAccent  = applyAccent;
window.renderSettingsBookmarks = renderSettingsBookmarks;
