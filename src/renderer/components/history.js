'use strict';
/* Nexora v2 — History Panel */

function renderHistory() {
  const items = window.nexora.getHistory();
  const el    = document.getElementById('history-list');
  if (!el) return;

  if (!items.length) {
    el.innerHTML = '<p style="padding:32px 0;text-align:center;color:var(--on-s3);font-size:14px">Nessuna cronologia.</p>';
    return;
  }

  // Group by day
  const groups = {};
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);

  for (const item of items) {
    const d = new Date(item.ts); d.setHours(0,0,0,0);
    let label;
    if (+d === +today)     label = 'Oggi';
    else if (+d === +yesterday) label = 'Ieri';
    else label = d.toLocaleDateString('it-IT', { weekday:'long', day:'numeric', month:'long' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }

  let html = '';
  for (const [label, group] of Object.entries(groups)) {
    html += `<div class="history-group-label">${label}</div>`;
    for (const item of group) {
      const time = new Date(item.ts).toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
      const host = tryHost(item.url);
      html += `
      <div class="history-item" data-ts="${item.ts}" data-url="${esc(item.url)}">
        <img class="history-favicon" src="https://www.google.com/s2/favicons?sz=32&domain=${host}" onerror="this.style.display='none'"/>
        <div class="history-info">
          <div class="history-title">${esc(item.title || item.url)}</div>
          <div class="history-url">${esc(item.url)}</div>
        </div>
        <div class="history-time">${time}</div>
        <button class="history-del" title="Rimuovi" data-ts="${item.ts}">
          <svg viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    }
  }
  el.innerHTML = html;

  // Events
  el.querySelectorAll('.history-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.history-del')) return;
      window.nexora.navigate(row.dataset.url);
    });
  });
  el.querySelectorAll('.history-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      window.nexora.removeHistoryItem(+btn.dataset.ts);
      btn.closest('.history-item').remove();
    });
  });
}

function tryHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.renderHistory = renderHistory;
