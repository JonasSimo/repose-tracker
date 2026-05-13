/* ═══════════════════════════════════════════════════════════════
   RepNet Feedback admin tab — Jonas-only triage UI
   ───────────────────────────────────────────────────────────────
   Self-contained IIFE. Side-effects only when isAdmin() == true.
   Depends ONLY on globals already exposed by index.html:
     window.getCurrentUser, window.getGraphToken,
     window.getQmsSiteId, window.getListIdByNameOnSite,
     window._graphFetchWithRetry, window.toast, window.navTo
   Wrapped in try/catch at every event boundary so any failure here
   cannot leave the rest of the app in a broken state.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  if (window.__feedbackAdminLoaded) return;
  window.__feedbackAdminLoaded = true;

  // ── Config ─────────────────────────────────────────────────
  const FEEDBACK_ADMINS = [
    'jonas.simonaitis@reposefurniture.co.uk',
  ];
  const LIST_NAME = 'RepNet_Feedback';
  const POLL_MS  = 60_000;   // 60s auto-refresh while tab active
  const CACHE_MS = 30_000;   // 30s GET cache to absorb tab-flipping
  const NOTES_DEBOUNCE_MS = 350;

  const STATUSES = ['New', 'Triaged', 'In Progress', 'Done', 'Wontfix'];
  const STATUS_CLASS = {
    'New':         's-new',
    'Triaged':     's-triaged',
    'In Progress': 's-in-progress',
    'Done':        's-done',
    'Wontfix':     's-wontfix',
  };
  const TYPE_EMOJI = { Bug: '🐞', Idea: '💡', Question: '❓' };

  // ── State ──────────────────────────────────────────────────
  let items = [];           // full list, sorted by createdDateTime desc
  let cachedAt = 0;
  let activeFilter = 'New'; // 'All' | one of STATUSES
  let expandedId = null;    // SP item id of the expanded row
  let pollHandle = null;
  let notesSaveTimer = null;
  let notesSaveTargetId = null;
  let installed = false;

  // ── Helpers ────────────────────────────────────────────────
  function isAdmin() {
    try {
      const u = (typeof window.getCurrentUser === 'function') ? window.getCurrentUser() : null;
      const email = (u && u.username || '').toLowerCase();
      return !!email && FEEDBACK_ADMINS.includes(email);
    } catch { return false; }
  }
  function depsReady() {
    return typeof window.getGraphToken === 'function'
        && typeof window.getQmsSiteId === 'function'
        && typeof window.getListIdByNameOnSite === 'function';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function relativeTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const d = Math.floor(hr / 24);
    if (d < 7) return d + 'd ago';
    const wk = Math.floor(d / 7);
    if (wk < 5) return wk + 'w ago';
    return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }
  function emailToShortName(email) {
    if (!email) return '';
    return String(email).split('@')[0].replace(/[._-]+/g, ' ');
  }

  // ── Graph CRUD ─────────────────────────────────────────────
  async function listItems(force) {
    if (!force && Date.now() - cachedAt < CACHE_MS && items.length) return items;
    if (!depsReady()) throw new Error('Graph helpers not ready');
    const siteId = await window.getQmsSiteId();
    const listId = await window.getListIdByNameOnSite(siteId, LIST_NAME);
    const token  = await window.getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`
              + `?$expand=fields&$orderby=createdDateTime desc&$top=200`;
    const fetcher = window._graphFetchWithRetry || fetch;
    const res = await fetcher(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Graph ' + res.status);
    const data = await res.json();
    items = (data.value || []).map(row => ({
      id: row.id,
      createdDateTime: row.createdDateTime,
      title:         (row.fields && row.fields.Title) || '(no title)',
      type:          (row.fields && row.fields.FeedbackType) || 'Bug',
      description:   (row.fields && row.fields.Description) || '',
      pageUrl:       (row.fields && row.fields.PageUrl) || '',
      pageLabel:     (row.fields && row.fields.PageLabel) || '',
      submitter:     (row.fields && row.fields.Submitter) || '',
      submitterName: (row.fields && row.fields.SubmitterName) || '',
      status:        (row.fields && row.fields.Status) || 'New',
      triageNotes:   (row.fields && row.fields.TriageNotes) || '',
    }));
    cachedAt = Date.now();
    return items;
  }

  async function patchFields(itemId, fields) {
    if (!depsReady()) throw new Error('Graph helpers not ready');
    const siteId = await window.getQmsSiteId();
    const listId = await window.getListIdByNameOnSite(siteId, LIST_NAME);
    const token  = await window.getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${itemId}/fields`;
    const fetcher = window._graphFetchWithRetry || fetch;
    const res = await fetcher(url, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) throw new Error('Graph ' + res.status);
    return res.json();
  }

  async function deleteOne(itemId) {
    if (!depsReady()) throw new Error('Graph helpers not ready');
    const siteId = await window.getQmsSiteId();
    const listId = await window.getListIdByNameOnSite(siteId, LIST_NAME);
    const token  = await window.getGraphToken();
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${itemId}`;
    const fetcher = window._graphFetchWithRetry || fetch;
    const res = await fetcher(url, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok && res.status !== 204) throw new Error('Graph ' + res.status);
  }

  // ── DOM injection ──────────────────────────────────────────
  function ensureViewContainer() {
    if (document.getElementById('view-feedback-admin')) return;
    const view = document.createElement('div');
    view.className = 'view';
    view.id = 'view-feedback-admin';
    view.innerHTML = `
      <div class="fb-admin-head">
        <h1 class="fb-admin-title">Feedback</h1>
        <div class="fb-admin-actions">
          <button type="button" class="fb-admin-refresh" id="fb-admin-refresh" title="Refresh now">
            <span class="fb-admin-refresh-icon">↻</span> Refresh
          </button>
        </div>
      </div>
      <div class="fb-admin-filters" id="fb-admin-filters"></div>
      <div class="fb-admin-table" id="fb-admin-table">
        <div class="fb-admin-loading">Loading…</div>
      </div>
    `;
    document.body.appendChild(view);

    const refreshBtn = view.querySelector('#fb-admin-refresh');
    refreshBtn.addEventListener('click', () => {
      cachedAt = 0;
      load(true);
    });
  }

  function ensureNavItem() {
    const navArea = document.querySelector('#ui-v4-side .v4-nav-area');
    if (!navArea) return false;
    if (navArea.querySelector('a[data-view="feedback-admin"]')) return true;

    // Append a header label + the nav link at the bottom so it lives
    // visually separated from the operational tabs.
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="v4-h"><span class="v4-lbl">Admin</span></div>
      <a href="#feedback-admin" data-view="feedback-admin" title="Feedback" id="fb-admin-nav">
        <span class="v4-gly" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </span>
        <span class="v4-lbl">Feedback</span>
      </a>
    `;
    while (wrap.firstChild) navArea.appendChild(wrap.firstChild);

    const link = navArea.querySelector('#fb-admin-nav');
    if (link) {
      link.addEventListener('click', (e) => {
        try {
          e.preventDefault();
          if (typeof window.navTo === 'function') {
            window.navTo('feedback-admin');
          }
          // Sync v4 sidebar active state — matches the existing pattern.
          document.querySelectorAll('#ui-v4-side a[data-view]')
            .forEach(a => a.classList.toggle('on', a.dataset.view === 'feedback-admin'));
        } catch (err) { console.error('[fb-admin] nav click:', err); }
      });
    }
    return true;
  }

  // ── Render ─────────────────────────────────────────────────
  function counts() {
    const c = { All: items.length, New: 0, Triaged: 0, 'In Progress': 0, Done: 0, Wontfix: 0 };
    for (const it of items) { if (c[it.status] != null) c[it.status]++; }
    return c;
  }
  function renderFilters() {
    const root = document.getElementById('fb-admin-filters');
    if (!root) return;
    const c = counts();
    const pills = ['All', 'New', 'Triaged', 'In Progress', 'Done', 'Wontfix'].map(name => {
      const on = activeFilter === name;
      return `<button type="button" class="fb-admin-pill${on ? ' on' : ''}" data-filter="${escapeHtml(name)}">
        ${escapeHtml(name)} <span class="fb-admin-pill-count">${c[name] || 0}</span>
      </button>`;
    }).join('');
    root.innerHTML = pills;
    root.querySelectorAll('.fb-admin-pill').forEach(b => {
      b.addEventListener('click', () => {
        activeFilter = b.dataset.filter;
        expandedId = null;
        renderFilters();
        renderTable();
      });
    });
  }
  function filteredItems() {
    if (activeFilter === 'All') return items;
    return items.filter(i => i.status === activeFilter);
  }
  function rowHtml(it) {
    return `
      <div class="fb-admin-row" data-id="${escapeHtml(it.id)}">
        <div class="fb-admin-cell-id">#${escapeHtml(it.id)}</div>
        <div class="fb-admin-cell-type" title="${escapeHtml(it.type)}">${TYPE_EMOJI[it.type] || '•'}</div>
        <div class="fb-admin-cell-title">${escapeHtml(it.title)}</div>
        <div class="fb-admin-cell-sub" title="${escapeHtml(it.submitter)}">${escapeHtml(emailToShortName(it.submitter) || '—')}</div>
        <div class="fb-admin-cell-page" title="${escapeHtml(it.pageLabel)}">${escapeHtml(it.pageLabel || '—')}</div>
        <div class="fb-admin-cell-time">${escapeHtml(relativeTime(it.createdDateTime))}</div>
        <div><span class="fb-admin-status ${STATUS_CLASS[it.status] || 's-new'}">${escapeHtml(it.status)}</span></div>
      </div>
    `;
  }
  function panelHtml(it) {
    const actions = STATUSES.filter(s => s !== it.status).map(s =>
      `<button type="button" class="fb-admin-action" data-status="${escapeHtml(s)}">${escapeHtml(s)}</button>`
    ).join('');
    const pageLink = it.pageUrl
      ? `<a href="${escapeHtml(it.pageUrl)}" target="_blank" rel="noopener">Open page →</a>`
      : '<span style="opacity:.6">no page captured</span>';
    return `
      <div class="fb-admin-panel" data-panel-for="${escapeHtml(it.id)}">
        <div>
          <div class="fb-admin-panel-label">Full description</div>
          <div class="fb-admin-panel-desc">${escapeHtml(it.description)}</div>
        </div>
        <div class="fb-admin-panel-pageline">
          <span class="fb-admin-panel-label" style="margin-bottom:0">Page:</span>
          <b>${escapeHtml(it.pageLabel || '—')}</b>
          ${pageLink}
          <span style="opacity:.6">·</span>
          <span>${escapeHtml(it.submitter || 'anonymous')}</span>
          <span style="opacity:.6">·</span>
          <span>${escapeHtml(relativeTime(it.createdDateTime))}</span>
        </div>
        <div>
          <div class="fb-admin-panel-label">Triage notes (private)</div>
          <textarea class="fb-admin-notes" data-notes-for="${escapeHtml(it.id)}" placeholder="Anything you want to remember about this one — saves when you click away.">${escapeHtml(it.triageNotes)}</textarea>
          <div class="fb-admin-notes-status" data-notes-status-for="${escapeHtml(it.id)}"></div>
        </div>
        <div class="fb-admin-panel-actions">
          <button type="button" class="fb-admin-action current" disabled>${escapeHtml(it.status)}</button>
          ${actions}
          <button type="button" class="fb-admin-action fb-admin-action-delete" data-action="delete">🗑 Delete</button>
        </div>
      </div>
    `;
  }
  function renderTable() {
    const root = document.getElementById('fb-admin-table');
    if (!root) return;
    const list = filteredItems();
    if (!list.length) {
      root.innerHTML = `
        <div class="fb-admin-empty">
          <div class="fb-admin-empty-icon">✓</div>
          Nothing to triage in this bucket — nice.
        </div>`;
      return;
    }
    const head = `
      <div class="fb-admin-row head">
        <div>ID</div>
        <div>Type</div>
        <div>Title</div>
        <div class="fb-admin-cell-sub">From</div>
        <div class="fb-admin-cell-page">Page</div>
        <div class="fb-admin-cell-time">When</div>
        <div>Status</div>
      </div>`;
    const body = list.map(it => {
      const row = rowHtml(it).replace('class="fb-admin-row"', `class="fb-admin-row${it.id === expandedId ? ' expanded' : ''}"`);
      return it.id === expandedId ? row + panelHtml(it) : row;
    }).join('');
    root.innerHTML = head + body;

    // Row clicks → toggle expand
    root.querySelectorAll('.fb-admin-row:not(.head)').forEach(r => {
      r.addEventListener('click', (e) => {
        // Ignore clicks bubbling from inside the panel
        if (e.target.closest('.fb-admin-panel')) return;
        const id = r.dataset.id;
        expandedId = (expandedId === id) ? null : id;
        renderTable();
      });
    });

    // Status action buttons
    root.querySelectorAll('.fb-admin-action[data-status]').forEach(b => {
      b.addEventListener('click', (e) => {
        try {
          e.stopPropagation();
          const id = b.closest('.fb-admin-panel').dataset.panelFor;
          const newStatus = b.dataset.status;
          changeStatus(id, newStatus, b);
        } catch (err) { console.error('[fb-admin] status click:', err); }
      });
    });

    // Delete button
    root.querySelectorAll('.fb-admin-action[data-action="delete"]').forEach(b => {
      b.addEventListener('click', (e) => {
        try {
          e.stopPropagation();
          const id = b.closest('.fb-admin-panel').dataset.panelFor;
          if (confirm('Delete this feedback item? This cannot be undone.')) {
            removeItem(id, b);
          }
        } catch (err) { console.error('[fb-admin] delete click:', err); }
      });
    });

    // Notes textarea — debounced save on blur or after typing pause
    root.querySelectorAll('.fb-admin-notes').forEach(t => {
      const id = t.dataset.notesFor;
      const flush = () => scheduleNotesSave(id, t.value);
      t.addEventListener('blur', () => {
        if (notesSaveTimer) { clearTimeout(notesSaveTimer); notesSaveTimer = null; }
        commitNotesSave(id, t.value);
      });
      t.addEventListener('input', flush);
      // Stop click propagation so typing/clicking in the textarea doesn't collapse the row
      t.addEventListener('click', e => e.stopPropagation());
    });
  }

  // ── Mutations ──────────────────────────────────────────────
  async function changeStatus(id, newStatus, btn) {
    const it = items.find(i => i.id === id);
    if (!it) return;
    const prev = it.status;
    if (prev === newStatus) return;
    // Optimistic
    it.status = newStatus;
    if (btn) btn.disabled = true;
    renderFilters();
    renderTable();
    try {
      await patchFields(id, { Status: newStatus });
      if (typeof window.toast === 'function') window.toast(`Status → ${newStatus}`, 's');
    } catch (err) {
      console.error('[fb-admin] patch status:', err);
      it.status = prev; // revert
      renderFilters();
      renderTable();
      if (typeof window.toast === 'function') window.toast('Could not update status — try again', 'u');
    }
  }
  function scheduleNotesSave(id, value) {
    if (notesSaveTimer) clearTimeout(notesSaveTimer);
    notesSaveTargetId = id;
    notesSaveTimer = setTimeout(() => commitNotesSave(id, value), NOTES_DEBOUNCE_MS * 2);
  }
  async function commitNotesSave(id, value) {
    const it = items.find(i => i.id === id);
    if (!it) return;
    if ((it.triageNotes || '') === (value || '')) return; // no-op
    const statusEl = document.querySelector(`[data-notes-status-for="${id}"]`);
    if (statusEl) { statusEl.className = 'fb-admin-notes-status'; statusEl.textContent = 'Saving…'; }
    try {
      await patchFields(id, { TriageNotes: value });
      it.triageNotes = value;
      if (statusEl) { statusEl.classList.add('saved'); statusEl.textContent = 'Saved.'; }
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 1500);
    } catch (err) {
      console.error('[fb-admin] patch notes:', err);
      if (statusEl) { statusEl.classList.add('error'); statusEl.textContent = 'Save failed — keep textbox open and try again.'; }
    }
  }
  async function removeItem(id, btn) {
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return;
    if (btn) btn.disabled = true;
    const removed = items.splice(idx, 1)[0];
    if (expandedId === id) expandedId = null;
    renderFilters();
    renderTable();
    try {
      await deleteOne(id);
      if (typeof window.toast === 'function') window.toast('Feedback item deleted', 's');
    } catch (err) {
      console.error('[fb-admin] delete:', err);
      items.splice(idx, 0, removed); // revert
      renderFilters();
      renderTable();
      if (typeof window.toast === 'function') window.toast('Could not delete — try again', 'u');
    }
  }

  // ── Load + poll ────────────────────────────────────────────
  async function load(force) {
    const refreshBtn = document.getElementById('fb-admin-refresh');
    if (refreshBtn) refreshBtn.classList.add('loading');
    try {
      await listItems(force);
      renderFilters();
      renderTable();
    } catch (err) {
      console.error('[fb-admin] load:', err);
      const root = document.getElementById('fb-admin-table');
      if (root) {
        root.innerHTML = `<div class="fb-admin-empty"><div class="fb-admin-empty-icon">⚠</div>Couldn't load feedback — ${escapeHtml(err && err.message ? err.message : 'unknown error')}. Click ↻ to retry.</div>`;
      }
    } finally {
      if (refreshBtn) refreshBtn.classList.remove('loading');
    }
  }
  function startPoll() {
    if (pollHandle) return;
    pollHandle = setInterval(() => {
      if (document.hidden) return;
      if (!isViewActive()) { stopPoll(); return; }
      load(true).catch(e => console.warn('[fb-admin] poll:', e.message));
    }, POLL_MS);
  }
  function stopPoll() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }
  function isViewActive() {
    const view = document.getElementById('view-feedback-admin');
    return !!(view && view.classList.contains('active'));
  }

  // Observer that watches the view container for .active toggles —
  // triggers load + poll on enter, stops poll on leave.
  function observeViewActivation() {
    const view = document.getElementById('view-feedback-admin');
    if (!view) return;
    const mo = new MutationObserver(() => {
      if (isViewActive()) {
        load(false);
        startPoll();
      } else {
        stopPoll();
      }
    });
    mo.observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  // Pause poll on tab hidden, resume + immediate refresh on visible.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPoll();
    } else if (isViewActive() && installed) {
      load(true).catch(() => {});
      startPoll();
    }
  });

  // ── Install (poll for sidebar + admin status) ──────────────
  function tryInstall() {
    if (installed) return true;
    if (!isAdmin()) return false;
    const navOk = ensureNavItem();
    if (!navOk) return false; // sidebar not injected yet
    ensureViewContainer();
    observeViewActivation();
    installed = true;
    return true;
  }
  function startInstallLoop() {
    if (tryInstall()) return;
    let tries = 0;
    const iv = setInterval(() => {
      if (tryInstall() || ++tries > 60) clearInterval(iv);
    }, 1000);
  }

  if (document.readyState !== 'loading') startInstallLoop();
  else document.addEventListener('DOMContentLoaded', startInstallLoop, { once: true });
})();
