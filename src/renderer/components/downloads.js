'use strict';
/* Nexora v2 — Downloads Panel & Toast */

const dlStore = new Map(); // id → info

function renderDownloads() {
  const el = document.getElementById('downloads-list');
  if (!el) return;
  if (!dlStore.size) {
    el.innerHTML = '<p style="padding:32px 0;text-align:center;color:var(--on-s3);font-size:14px">Nessun download.</p>';
    return;
  }
  el.innerHTML = Array.from(dlStore.values()).reverse().map(d => {
    const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes/d.totalBytes*100) : 0;
    const sizeStr = d.totalBytes > 0 ? `${fmtBytes(d.receivedBytes)} / ${fmtBytes(d.totalBytes)}` : fmtBytes(d.receivedBytes);
    const ext = extIcon(d.filename);
    let statusHtml = '';
    if (d.state === 'completed') {
      statusHtml = `<span class="dl-status-done">✓ Completato</span>`;
    } else if (d.state === 'cancelled' || d.state === 'interrupted') {
      statusHtml = `<span class="dl-status-err">✗ Errore</span>`;
    }
    return `
    <div class="dl-item" data-id="${d.id}">
      <div class="dl-icon">${ext}</div>
      <div class="dl-info">
        <div class="dl-name">${esc(d.filename)}</div>
        <div class="dl-meta">${sizeStr}${d.state==='progressing'?' — '+pct+'%':''}</div>
        ${d.state==='progressing' ? `<div class="dl-bar-wrap"><div class="dl-bar" style="width:${pct}%"></div></div>` : ''}
      </div>
      ${statusHtml}
      <div class="dl-actions">
        ${d.state==='completed' ? `<button data-action="open" data-id="${d.id}">Apri</button><button data-action="show" data-id="${d.id}">Mostra</button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = +btn.dataset.id;
      btn.dataset.action === 'open' ? window.nexora.openDownload(id) : window.nexora.showDownload(id);
    });
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────

const toastMap = new Map(); // id → toastEl

function showDlToast(d) {
  const area = document.getElementById('dl-toast-area');
  if (!area) return;

  let toast = toastMap.get(d.id);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'dl-toast';
    toast.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="dl-toast-name">${esc(d.filename)}</div>
        <div class="dl-toast-bar"><div class="dl-toast-bar-fill" style="width:0%"></div></div>
        <div class="dl-toast-prog">In corso...</div>
      </div>`;
    area.appendChild(toast);
    toastMap.set(d.id, toast);
  }

  const bar  = toast.querySelector('.dl-toast-bar-fill');
  const prog = toast.querySelector('.dl-toast-prog');

  if (d.state === 'progressing') {
    const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes/d.totalBytes*100) : 0;
    if (bar)  bar.style.width  = pct + '%';
    if (prog) prog.textContent = d.totalBytes > 0 ? `${fmtBytes(d.receivedBytes)} / ${fmtBytes(d.totalBytes)} — ${pct}%` : fmtBytes(d.receivedBytes);
  } else if (d.state === 'completed') {
    if (bar)  bar.style.width  = '100%';
    if (prog) prog.textContent = `✓ ${fmtBytes(d.totalBytes||d.receivedBytes)} — Completato`;
    toast.style.borderColor = 'var(--accent)';
    setTimeout(() => {
      toast.style.transition = 'opacity .4s, transform .4s';
      toast.style.opacity    = '0';
      toast.style.transform  = 'translateY(20px)';
      setTimeout(() => { toast.remove(); toastMap.delete(d.id); }, 420);
    }, 3000);
  } else {
    if (prog) prog.textContent = '✗ Annullato';
    setTimeout(() => { toast.remove(); toastMap.delete(d.id); }, 2000);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return '0 B';
  const k=1024, units=['B','KB','MB','GB'];
  const i=Math.floor(Math.log(b)/Math.log(k));
  return (b/Math.pow(k,i)).toFixed(i?1:0)+' '+units[i];
}

function extIcon(name) {
  const ext = (name||'').split('.').pop().toLowerCase();
  const map = { pdf:'📄', zip:'🗜️', rar:'🗜️', '7z':'🗜️', tar:'🗜️', gz:'🗜️',
                mp4:'🎬', mkv:'🎬', avi:'🎬', mov:'🎬', webm:'🎬',
                mp3:'🎵', flac:'🎵', wav:'🎵', ogg:'🎵',
                jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️',
                exe:'⚙️', dmg:'⚙️', deb:'⚙️', appimage:'⚙️',
                doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📑', pptx:'📑',
                txt:'📃', csv:'📃', json:'📃', xml:'📃' };
  return map[ext] || '📥';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.dlStore       = dlStore;
window.renderDownloads = renderDownloads;
window.showDlToast   = showDlToast;
