/* ═══════════════════════════════════════════════════════════════
   RepNet Skin v4 — feature-flag JS  (hotfix: no subtree observers)
   Activates the new sidebar, team-logo SVGs, and Delivery TV View
   button when the URL has ?ui=v4. Default (no flag) = old UI.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 0. Flag detection ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const flag = params.get('ui');
  const NEW_UI = flag === 'v4';
  if (!NEW_UI) return;

  document.documentElement.classList.add('ui-v4');

  // Constants must be declared BEFORE ready(init) — `defer` fires init
  // synchronously, so a const declared further down would be in the TDZ.
  const NAV = [
    { h: 'Production' },
    { v: 'team-select',  g: '▤',     l: 'Team View' },
    { v: 'overview',     g: '⊞',     l: 'Load Plan' },
    { v: 'loadsheet',    g: '↗',     l: 'Delivery' },
    { v: 'production',   g: '▣',     l: 'Production Plan' },
    { h: 'Quality / QHSE' },
    { v: 'stats',        g: 'STATS', l: 'Stats' },
    { v: 'issues',       g: '⚑',     l: 'Internal NCRs' },
    { v: 'quality',      g: '✓',     l: 'Quality' },
    { v: 'safety',       g: '⚠',     l: 'Near Misses' },
    { v: 'complaints',   g: '✉',     l: 'Complaints' },
    { h: 'Operations' },
    { v: 'maintenance',  g: '⚒',     l: 'Maintenance' },
    { v: 'timing',       g: '⏱',     l: 'Job Timing' },
    { v: 'innovation',   g: '✦',     l: 'Innovation' },
  ];

  const TEAM_TO_SPRITE = {
    'Woodmill': 'v4-team-woodmill',
    'Foam': 'v4-team-foam',
    'Cutting': 'v4-team-cutting',
    'Sewing': 'v4-team-sewing',
    'Upholstery': 'v4-team-upholstery',
    'Assembly': 'v4-team-assembly',
    'QC': 'v4-team-qc',
    'Gluing': 'v4-team-gluing',
  };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function init() {
    try {
      injectSprite();
      injectSidebar();
      wireNav();
      patchNavTo();
      applyAll();
      setInterval(applyAll, 2500);
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) document.documentElement.classList.remove('tv-mode');
      });
      console.log('[skin-v4] activated. body padding-left:',
        getComputedStyle(document.body).paddingLeft,
        '· flex-direction:',
        getComputedStyle(document.body).flexDirection);
    } catch (e) {
      console.error('[skin-v4] init failed:', e);
    }
  }

  ready(init);

  function applyAll() {
    try { applyTeamLogos(); } catch (e) { console.warn('[skin-v4] applyTeamLogos:', e); }
    try { injectTvButton(); } catch (e) { console.warn('[skin-v4] injectTvButton:', e); }
    try { syncUser(); } catch (e) { console.warn('[skin-v4] syncUser:', e); }
  }

  // ── 1. SVG sprite ─────────────────────────────────────────────
  function injectSprite() {
    if (document.getElementById('v4-sprite-root')) return;
    const sprite = `
<svg id="v4-sprite-root" width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="v4-team-woodmill" viewBox="0 0 24 24">
      <path d="M6 6 Q3 6 3 10 Q3 14 6 14 L9 14 L9 6 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <line x1="5" y1="8.5" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
      <line x1="5" y1="11.5" x2="7" y2="11.5" stroke="currentColor" stroke-width="1.2" opacity="0.6"/>
      <path d="M9 8 L21 9.5 L21 11 L9 12 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M10 12 L11 14 L12 12 L13 14 L14 12 L15 14 L16 12 L17 14 L18 12 L19 14 L20 12" fill="currentColor"/>
    </symbol>
    <symbol id="v4-team-foam" viewBox="0 0 24 24">
      <rect x="3" y="6" width="18" height="12" rx="3" ry="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M5 9 Q7 7 9 9 M11 9 Q13 7 15 9 M17 9 Q19 7 21 9" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.7"/>
      <path d="M3 15 Q12 13 21 15" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.7"/>
    </symbol>
    <symbol id="v4-team-cutting" viewBox="0 0 24 24">
      <circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <circle cx="18" cy="18" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <line x1="8" y1="16" x2="20" y2="4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="16" y1="16" x2="4" y2="4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </symbol>
    <symbol id="v4-team-sewing" viewBox="0 0 24 24">
      <line x1="4" y1="20" x2="19" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="4.5" cy="19.5" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <path d="M19 5 Q15 7 13 11 Q11 15 7 17" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.8" opacity="0.8"/>
    </symbol>
    <symbol id="v4-team-upholstery" viewBox="0 0 24 24">
      <path d="M5 18 V11 Q5 9 7 9 H17 Q19 9 19 11 V18" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <line x1="3" y1="14" x2="21" y2="14" stroke="currentColor" stroke-width="1.6"/>
      <line x1="6" y1="18" x2="6" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <line x1="18" y1="18" x2="18" y2="21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="v4-team-assembly" viewBox="0 0 24 24">
      <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </symbol>
    <symbol id="v4-team-qc" viewBox="0 0 24 24">
      <path d="M12 3 L20 6 V13 Q20 18 12 21 Q4 18 4 13 V6 Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M8 12 L11 15 L16 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="v4-team-gluing" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
        <path d="M3 8 L14 8 L14 6 L18 6 L18 11 L14 11 L14 9 L9 9 L9 13 Q9 15 11 15 L11 19 L4 19 L4 15 Q4 11 3 11 Z"/>
      </g>
      <circle cx="20" cy="6.5" r="0.7" fill="currentColor" opacity="0.55"/>
      <circle cx="21" cy="8.5" r="0.8" fill="currentColor" opacity="0.7"/>
      <circle cx="20" cy="10.5" r="0.7" fill="currentColor" opacity="0.55"/>
      <circle cx="22" cy="6.5" r="0.5" fill="currentColor" opacity="0.4"/>
      <circle cx="22" cy="10.5" r="0.5" fill="currentColor" opacity="0.4"/>
    </symbol>
    <symbol id="v4-stats-icon" viewBox="0 0 16 16">
      <rect x="2" y="9" width="2.5" height="5" rx="0.4" fill="currentColor"/>
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.4" fill="currentColor"/>
      <rect x="11.5" y="3" width="2.5" height="11" rx="0.4" fill="currentColor"/>
    </symbol>
  </defs>
</svg>`;
    document.body.insertAdjacentHTML('afterbegin', sprite);
  }

  // ── 2. Sidebar markup ─────────────────────────────────────────
  function injectSidebar() {
    if (document.getElementById('ui-v4-side')) return;
    const navHtml = NAV.map(item => {
      if (item.h) return `<div class="v4-h">${item.h}</div>`;
      const glyHtml = item.g === 'STATS'
        ? `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><use href="#v4-stats-icon"/></svg>`
        : item.g;
      return `<a href="#${item.v}" data-view="${item.v}"><span class="v4-gly">${glyHtml}</span> ${item.l}</a>`;
    }).join('');

    const sideHtml = `
<aside class="ui-v4-side" id="ui-v4-side">
  <div class="v4-brand">
    <img src="./repnet-logo-white.png" alt="RepNet" onerror="this.style.display='none'">
  </div>
  ${navHtml}
  <div class="v4-foot">
    <div class="v4-user">
      <span class="av" id="v4-avatar">?</span>
      <div style="flex:1;min-width:0;">
        <div class="nm" id="v4-username">Sign in</div>
        <div class="role">Operator</div>
      </div>
      <span id="v4-presence" style="width:8px;height:8px;border-radius:999px;background:#a8a8a8;"></span>
    </div>
    <button type="button" class="v4-nms" id="v4-nms-btn">⚠ Raise NMS</button>
    <div class="v4-repose">
      <img src="./Repose_RGB_logo_Colour_with_strapline_1500pxW.png" alt="Repose" onerror="this.style.display='none'">
      <span>Repose Furniture</span>
    </div>
    <a href="?ui=old" class="v4-rollback">Switch to old UI →</a>
  </div>
</aside>`;
    document.body.insertAdjacentHTML('beforeend', sideHtml);

    const nmsBtn = document.getElementById('v4-nms-btn');
    if (nmsBtn) {
      nmsBtn.addEventListener('click', () => {
        if (typeof window.openNmsModal === 'function') window.openNmsModal();
      });
    }
  }

  // ── 3. Wire nav ───────────────────────────────────────────────
  function syncActive(viewId) {
    const links = document.querySelectorAll('#ui-v4-side a[data-view]');
    for (const a of links) a.classList.toggle('on', a.dataset.view === viewId);
  }
  function wireNav() {
    const links = document.querySelectorAll('#ui-v4-side a[data-view]');
    for (const a of links) {
      a.addEventListener('click', e => {
        e.preventDefault();
        if (typeof window.navTo === 'function') window.navTo(a.dataset.view);
        syncActive(a.dataset.view);
      });
    }
    const initial = document.querySelector('.nav-item.active')?.dataset.view || 'team-select';
    syncActive(initial);
  }
  function patchNavTo() {
    if (typeof window.navTo !== 'function' || window.__v4NavToPatched) return;
    const _orig = window.navTo;
    window.navTo = function (view) {
      const r = _orig.apply(this, arguments);
      try { syncActive(view); } catch (e) { console.warn('[skin-v4] syncActive:', e); }
      return r;
    };
    window.__v4NavToPatched = true;
  }

  // ── 4. Team logos ─────────────────────────────────────────────
  function findKey(text) {
    if (!text) return null;
    const t = text.replace(/\s+/g, ' ').trim();
    for (const k of Object.keys(TEAM_TO_SPRITE)) {
      if (t === k || t.toLowerCase().includes(k.toLowerCase())) return k;
    }
    return null;
  }
  function applyTeamLogos() {
    const cards = document.querySelectorAll('.team-card');
    for (const card of cards) {
      const nameEl = card.querySelector('.tc-name');
      if (!nameEl) continue;
      const key = findKey(nameEl.textContent);
      if (!key) continue;
      const iconBox = card.querySelector('.tc-icon');
      if (iconBox && !iconBox.querySelector('.tc-icon-svg')) {
        iconBox.innerHTML = `<svg class="tc-icon-svg" viewBox="0 0 24 24" width="48" height="48"><use href="#${TEAM_TO_SPRITE[key]}"/></svg>`;
      }
      if (key === 'Gluing' && !card.classList.contains('gluing-card')) card.classList.add('gluing-card');
    }
    // Tracker team-sidebar entries — real markup has emoji INSIDE .team-name text
    const btns = document.querySelectorAll('.team-sidebar .team-btn, #teamList .team-btn');
    for (const btn of btns) {
      if (btn.querySelector('.team-svg-icon')) continue; // already done
      const nameEl = btn.querySelector('.team-name');
      if (!nameEl) continue;
      const key = findKey(nameEl.textContent);
      if (!key) continue;
      // Strip leading emoji + space, prepend SVG, keep the team name
      const cleaned = nameEl.textContent.replace(/^\s*\S+\s+/, '').trim();
      nameEl.innerHTML =
        `<span class="team-svg-icon" style="display:inline-flex;vertical-align:-4px;margin-right:6px;color:inherit;">` +
        `<svg viewBox="0 0 24 24" width="18" height="18"><use href="#${TEAM_TO_SPRITE[key]}"/></svg>` +
        `</span>` +
        cleaned;
      if (key === 'Gluing' && !btn.classList.contains('gluing-team')) btn.classList.add('gluing-team');
    }
  }

  // ── 5. Delivery TV View button ────────────────────────────────
  function injectTvButton() {
    const bar = document.querySelector('#view-loadsheet .ls-titlebar');
    if (!bar || bar.querySelector('.ui-v4-tv-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-v4-tv-btn';
    btn.innerHTML = '⛶ TV View';
    btn.title = 'Open Delivery in fullscreen TV mode';
    btn.addEventListener('click', () => {
      const target = document.documentElement;
      if (target.requestFullscreen) target.requestFullscreen();
      document.documentElement.classList.add('tv-mode');
    });
    bar.appendChild(btn);
  }

  // ── 6. User sync ──────────────────────────────────────────────
  function syncUser() {
    const nameEl = document.getElementById('v4-username');
    const avEl = document.getElementById('v4-avatar');
    const presence = document.getElementById('v4-presence');
    const authName = document.querySelector('.auth-badge .auth-name');
    const authDot = document.querySelector('.auth-badge .auth-dot');
    if (!nameEl || !authName) return;
    const t = (authName.textContent || 'Sign in').trim();
    if (nameEl.textContent !== t) nameEl.textContent = t;
    if (avEl) {
      const initials = t.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
      if (avEl.textContent !== initials) avEl.textContent = initials;
    }
    if (presence && authDot) {
      const on = !authDot.classList.contains('off');
      presence.style.background = on ? '#4ade80' : '#a8a8a8';
      presence.style.boxShadow = on ? '0 0 0 4px rgba(74,222,128,0.18)' : 'none';
    }
  }
})();
