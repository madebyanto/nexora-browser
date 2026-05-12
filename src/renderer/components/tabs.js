'use strict';
/* Nexora v2 — Tab Component */

class TabBar {
  constructor(listEl) {
    this.el   = listEl;
    this.data = new Map(); // id → info
  }

  sync(tabsArray) {
    const incoming = new Set(tabsArray.map(t => t.id));
    // remove stale
    for (const [id] of this.data) {
      if (!incoming.has(id)) this._remove(id);
    }
    // add/update
    for (const t of tabsArray) {
      this.data.has(t.id) ? this._update(t) : this._add(t);
      this.data.set(t.id, t);
    }
  }

  setActive(tabId) {
    this.el.querySelectorAll('.tab').forEach(el => {
      el.classList.toggle('active', +el.dataset.id === tabId);
    });
  }

  _el(tabId) { return this.el.querySelector(`[data-id="${tabId}"]`); }

  _add(t) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.isActive ? ' active' : '');
    el.dataset.id = t.id;
    el.innerHTML  = this._html(t);
    el.addEventListener('click', e => {
      if (!e.target.closest('.tab-close')) window.nexora.activateTab(t.id);
    });
    el.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      el.style.transition = 'opacity .15s, transform .15s, max-width .18s, min-width .18s, padding .18s';
      el.style.opacity = '0';
      el.style.transform = 'scale(.88)';
      el.style.maxWidth  = '0';
      el.style.minWidth  = '0';
      el.style.padding   = '0';
      setTimeout(() => window.nexora.closeTab(t.id), 190);
    });
    this.el.appendChild(el);
  }

  _update(t) {
    const el = this._el(t.id);
    if (!el) return this._add(t);
    // icon area
    const icon = el.querySelector('.tab-icon');
    if (icon) icon.innerHTML = this._iconHTML(t);
    // title
    const title = el.querySelector('.tab-title');
    if (title) { title.textContent = t.title || 'Nuova Tab'; title.title = t.title || ''; }
    // active
    el.classList.toggle('active', t.isActive);
    this.data.set(t.id, t);
  }

  _remove(tabId) {
    const el = this._el(tabId);
    if (el) { el.style.opacity='0'; el.style.transform='scaleX(.8)'; setTimeout(()=>el.remove(),150); }
    this.data.delete(tabId);
  }

  _html(t) {
    return `
      <span class="tab-icon">${this._iconHTML(t)}</span>
      <span class="tab-title" title="${esc(t.title||'Nuova Tab')}">${esc(t.title||'Nuova Tab')}</span>
      <button class="tab-close" tabindex="-1">
        <svg viewBox="0 0 10 10" fill="none">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>`;
  }

  _iconHTML(t) {
    if (t.isLoading) return '<div class="tab-spinner"></div>';
    if (t.favicon) return `<img class="tab-favicon" src="${t.favicon}" onerror="this.style.display='none'"/>`;
    return `<svg viewBox="0 0 14 14" fill="none" width="13" height="13"><rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 5.5h11M5.5 1.5v4" stroke="currentColor" stroke-width="1.2"/></svg>`;
  }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.TabBar = TabBar;
