/* ═══════════════════════════════════════════════════════════════
   RepNet Skin v4 — feature-flag JS
   Activates the new sidebar, team-logo SVGs, and Delivery TV View
   button when the URL has ?ui=v4. Default (no flag) = old UI.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 0. Flag detection ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const flag = params.get('ui');
  // Future: flip the default by changing this line to `flag !== 'old'`
  const NEW_UI = flag === 'v4';
  if (!NEW_UI) return;

  document.documentElement.classList.add('ui-v4');

  // ── 1. SVG sprite (team logos) ────────────────────────────────
  const sprite = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
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
    <!-- Stats bar-chart for sidebar nav -->
    <symbol id="v4-stats-icon" viewBox="0 0 16 16">
      <rect x="2" y="9" width="2.5" height="5" rx="0.4" fill="currentColor"/>
      <rect x="6.75" y="6" width="2.5" height="8" rx="0.4" fill="currentColor"/>
      <rect x="11.5" y="3" width="2.5" height="11" rx="0.4" fill="currentColor"/>
    </symbol>
  </defs>
</svg>`;
  document.body.insertAdjacentHTML('afterbegin', sprite);

  // ── 2. Sidebar markup ─────────────────────────────────────────
  // data-view values match navTo() targets in the existing app
  const NAV = [
    { h: 'Production' },
    { v: 'team-select',  g: '▤',     l: 'Team View' },
    { v: 'overview',     g: '⊞',     l: 'Load Plan' },
    { v: 'loadsheet',    g: '↗',     l: 'Delivery' },
    { v: 'production',   g: '▣',     l: 'Production Plan' },
    { h: 'Quality / QHSE' },
    { v: 'stats',        g: 'STATS', l: 'Stats' }, // special: SVG icon
    { v: 'issues',       g: '⚑',     l: 'Internal NCRs' },
    { v: 'quality',      g: '✓',     l: 'Quality' },
    { v: 'safety',       g: '⚠',     l: 'Near Misses' },
    { v: 'complaints',   g: '✉',     l: 'Complaints' },
    { h: 'Operations' },
    { v: 'maintenance',  g: '⚒',     l: 'Maintenance' },
    { v: 'timing',       g: '⏱',     l: 'Job Timing' },
    { v: 'innovation',   g: '✦',     l: 'Innovation' },
  ];

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
      <span class="av" id="v4-avatar">JS</span>
      <div style="flex:1;min-width:0;">
        <div class="nm" id="v4-username">Sign in</div>
        <div class="role">Operator</div>
      </div>
      <span id="v4-presence" style="width:8px;height:8px;border-radius:999px;background:#a8a8a8;"></span>
    </div>
    <button class="v4-nms" onclick="if(typeof openNmsModal==='function')openNmsModal()">⚠ Raise NMS</button>
    <div class="v4-repose">
      <img src="./Repose_RGB_logo_Colour_with_strapline_1500pxW.png" alt="Repose" onerror="this.style.display='none'">
      <span>Repose Furniture</span>
    </div>
    <a href="?ui=old" class="v4-rollback">Switch to old UI →</a>
  </div>
</aside>`;
  document.body.insertAdjacentHTML('beforeend', sideHtml);

  // ── 3. Wire nav clicks to existing navTo() ────────────────────
  function syncActive(viewId) {
    document.querySelectorAll('#ui-v4-side a[data-view]').forEach(a => {
      a.classList.toggle('on', a.dataset.view === viewId);
    });
  }
  document.querySelectorAll('#ui-v4-side a[data-view]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      if (typeof window.navTo === 'function') window.navTo(a.dataset.view);
      syncActive(a.dataset.view);
    });
  });
  // Monkey-patch navTo so old dropdown also keeps sidebar in sync
  if (typeof window.navTo === 'function') {
    const _origNavTo = window.navTo;
    window.navTo = function (view) {
      const r = _origNavTo.apply(this, arguments);
      syncActive(view);
      return r;
    };
  }
  // Set initial active item from current view if discoverable
  const initial = (document.querySelector('.nav-item.active')?.dataset.view) || 'team-select';
  syncActive(initial);

  // ── 4. Team logo SVG injection (Team View sidebar + Team Select cards)
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

  function svgFor(spriteId) {
    return `<svg class="team-svg-icon" viewBox="0 0 24 24" width="22" height="22"><use href="#${spriteId}"/></svg>`;
  }

  function applyTeamLogos() {
    // Team Select cards
    document.querySelectorAll('.team-card').forEach(card => {
      const nameEl = card.querySelector('.tc-name');
      if (!nameEl) return;
      const name = nameEl.textContent.replace(/\s+/g, ' ').trim();
      const key = Object.keys(TEAM_TO_SPRITE).find(k =>
        name === k || name.toLowerCase().includes(k.toLowerCase())
      );
      if (!key) return;
      const iconBox = card.querySelector('.tc-icon');
      if (iconBox && !iconBox.querySelector('.team-svg-icon')) {
        iconBox.innerHTML = svgFor(TEAM_TO_SPRITE[key]).replace('width="22"', 'width="48"').replace('height="22"', 'height="48"').replace('class="team-svg-icon"', 'class="tc-icon-svg"');
      }
      if (key === 'Gluing') card.classList.add('gluing-card');
    });
    // Tracker team-sidebar entries (rendered by existing JS — class names may vary)
    document.querySelectorAll('.team-sidebar .team-btn, .team-sidebar .team-item').forEach(btn => {
      const nameEl = btn.querySelector('.team-name, .tname');
      if (!nameEl) return;
      const name = nameEl.textContent.replace(/\s+/g, ' ').trim();
      const key = Object.keys(TEAM_TO_SPRITE).find(k =>
        name === k || name.toLowerCase().includes(k.toLowerCase())
      );
      if (!key) return;
      const iconBox = btn.querySelector('.team-icon, .ticon');
      if (iconBox && !iconBox.querySelector('.team-svg-icon')) {
        iconBox.innerHTML = svgFor(TEAM_TO_SPRITE[key]);
      }
      if (key === 'Gluing') btn.classList.add('gluing-team');
    });
  }
  applyTeamLogos();
  // Re-apply if the team list re-renders (it's vanilla JS innerHTML)
  const teamObs = new MutationObserver(applyTeamLogos);
  teamObs.observe(document.body, { childList: true, subtree: true });

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
  injectTvButton();
  const tvObs = new MutationObserver(injectTvButton);
  tvObs.observe(document.body, { childList: true, subtree: true });

  // Esc / fullscreen exit clears TV mode
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) document.documentElement.classList.remove('tv-mode');
  });

  // ── 6. Sync user info (best-effort) ───────────────────────────
  function syncUser() {
    const nameEl = document.querySelector('#v4-username');
    const avEl = document.querySelector('#v4-avatar');
    const presence = document.querySelector('#v4-presence');
    const authName = document.querySelector('.auth-badge .auth-name');
    const authDot = document.querySelector('.auth-badge .auth-dot');
    if (nameEl && authName) nameEl.textContent = authName.textContent || 'Sign in';
    if (avEl && authName) {
      const initials = (authName.textContent || '?')
        .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
      avEl.textContent = initials || '?';
    }
    if (presence && authDot) {
      const on = !authDot.classList.contains('off');
      presence.style.background = on ? '#4ade80' : '#a8a8a8';
      presence.style.boxShadow = on ? '0 0 0 4px rgba(74,222,128,0.18)' : 'none';
    }
  }
  syncUser();
  const userObs = new MutationObserver(syncUser);
  const authBadge = document.querySelector('.auth-badge');
  if (authBadge) userObs.observe(authBadge, { childList: true, subtree: true, characterData: true });

})();
