/* ═══════════════════════════════════════════════════════════════
   RepNet Skin v4 — now the default UI.
   Activates the new sidebar, team-logo SVGs, and Delivery TV View
   button on every load. Append ?ui=legacy to fall back to the old
   design (escape hatch for regressions).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 0. Flag detection ─────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const flag = params.get('ui');
  const LEGACY = flag === 'legacy' || flag === 'old';
  if (LEGACY) return;

  // Shop-floor tablet kiosk mode: the host adds html.tablet-team when
  // ?team= or ?tab= is in the URL (and via sessionStorage on PWA reload).
  // These tablets land directly on a single team's job-tick view; the
  // v4 chrome (sidebar, home card grid, goHome()) would clobber that
  // and leave operators stranded. Skip the skin entirely in kiosk mode.
  if (document.documentElement.classList.contains('tablet-team')) return;

  document.documentElement.classList.add('ui-v4');

  // ALL `let`/`const` declarations must come BEFORE ready(init) — `defer`
  // fires init synchronously, so anything further down would be in the TDZ.

  // Chart instance state (referenced by removeTeamChart/injectTeamChart)
  let _v4ChartInstance = null;

  const NAV = [
    { h: 'Production' },
    { v: 'home',         g: '⌂',     l: 'Home' },
    { v: 'team-select',  g: '▤',     l: 'Team View' },
    { v: 'overview',     g: '⊞',     l: 'Load Plan' },
    { v: 'loadsheet',    g: '↗',     l: 'Delivery' },
    { v: 'production',   g: '▣',     l: 'Production Plan' },
    { h: 'Quality / QHSE' },
    { v: 'stats',        g: 'STATS', l: 'Stats' },
    { v: 'quality',      g: '✓',     l: 'Quality' },
    { v: 'actions',      g: '⊕',     l: 'CAPA' },
    { v: 'safety',       g: '⚠',     l: 'Near Misses' },
    { v: 'complaints',   g: '✉',     l: 'Complaints' },
    { v: 'documents',    g: '📄',    l: 'Documents' },
    { h: 'Service' },
    { v: 'service',      g: '🔧',    l: 'Service Dashboard' },
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
    'Development': 'v4-team-development',
  };

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function init() {
    // Each step wraps its own try/catch so a single failure (e.g.
    // injectSidebar can't find .topbar) doesn't leave the skin in
    // a half-painted state where some chrome is injected but later
    // steps — including the setInterval that drives applyAll — never
    // run. Previously a throw in step 3 would also skip goHome AND
    // the interval registration, stranding users on a partially-
    // converted view with no nav.
    try { injectSprite();    } catch (e) { console.error('[skin-v4] injectSprite:',    e); }
    try { injectHomeView();  } catch (e) { console.error('[skin-v4] injectHomeView:',  e); }
    try { injectSidebar();   } catch (e) { console.error('[skin-v4] injectSidebar:',   e); }
    try { injectFeedback();  } catch (e) { console.error('[skin-v4] injectFeedback:',  e); }
    try { wireNav();         } catch (e) { console.error('[skin-v4] wireNav:',         e); }
    try { patchNavTo();      } catch (e) { console.error('[skin-v4] patchNavTo:',      e); }
    // Don't goHome() if the host has already activated a view (e.g.
    // deep-link from email reminder, ?view=, ?tab=, fragment handler).
    // Previously goHome stripped .active off every view unconditionally,
    // overriding any prior navigation and dropping the user on the home
    // card grid even when they'd clicked a specific Documents link.
    try {
      const alreadyOnAView = document.querySelector('.view.active');
      const hasDeepLink = /\b(view|tab|team)=/.test(location.search) || location.hash;
      if (!alreadyOnAView && !hasDeepLink) goHome();
    } catch (e) { console.error('[skin-v4] goHome:', e); }
    try { applyAll(); } catch (e) { console.error('[skin-v4] applyAll:', e); }
    // Previously this re-ran applyAll() every 2.5s regardless of whether
    // anything had changed — on a shop-floor tablet open all shift that's
    // ~12,000 ticks of DOM walking even when the page is idle.
    //
    // Now driven by two cheaper signals:
    //   1. MutationObserver on <body> — fires only when something actually
    //      mutates (new view rendered, sidebar refreshed). Debounced 250ms
    //      so a burst of host renders coalesces into one applyAll() call.
    //   2. A 10s safety-net interval — catches anything the observer might
    //      miss (e.g. innerHTML replacement that swaps in cached strings
    //      identical to the previous DOM). Still gated on !document.hidden.
    let _v4ApplyTimer = null;
    function _scheduleApply() {
      if (_v4ApplyTimer) return;
      _v4ApplyTimer = setTimeout(() => {
        _v4ApplyTimer = null;
        if (!document.hidden) {
          try { applyAll(); } catch (e) { console.warn('[skin-v4] applyAll (observer):', e); }
        }
      }, 250);
    }
    try {
      const mo = new MutationObserver(_scheduleApply);
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { console.warn('[skin-v4] MutationObserver:', e); }
    setInterval(() => { if (!document.hidden) applyAll(); }, 10000);
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) document.documentElement.classList.remove('tv-mode');
    });
    console.log('[skin-v4] activated');
  }

  ready(init);

  function applyAll() {
    try { applyTeamLogos(); } catch (e) { console.warn('[skin-v4] applyTeamLogos:', e); }
    try { injectTvButton(); } catch (e) { console.warn('[skin-v4] injectTvButton:', e); }
    try { syncUser(); } catch (e) { console.warn('[skin-v4] syncUser:', e); }
    try { injectTeamChart(); } catch (e) { console.warn('[skin-v4] injectTeamChart:', e); }
  }

  // ── 7. Team Planned-vs-Done chart on Stats team detail ────────
  function injectTeamChart() {
    const detail = document.getElementById('stats-detail');
    if (!detail || detail.style.display === 'none') {
      removeTeamChart();
      return;
    }
    const view = detail.dataset.view;

    // Only show on team detail view
    if (view !== 'team') {
      removeTeamChart();
      return;
    }

    // Read team from the detail title element. The host renders the team
    // name as the title text when view==='team'. (Don't rely on
    // window.statsTeamFilter — it's `let`-declared so not on window.)
    const titleEl = document.getElementById('stats-detail-title');
    const team = titleEl ? titleEl.textContent.trim() : '';
    if (!team) { removeTeamChart(); return; }

    // Period: read from the active period button rendered by the host.
    // Falls back to 'week' if it can't be determined.
    let period = readTeamPeriodFromDOM();
    if (!period) period = 'week';

    const body = document.getElementById('stats-detail-body');
    if (!body) return;

    // If chart already up-to-date for this team+period, skip
    const existing = document.getElementById('v4-team-chart');
    if (existing &&
        existing.dataset.team === team &&
        existing.dataset.period === period) return;

    removeTeamChart();

    // Build data
    const data = buildTeamChartData(team, period);
    if (!data || !data.labels.length) return;

    // Wrapper
    const wrap = document.createElement('div');
    wrap.id = 'v4-team-chart';
    wrap.dataset.team = team;
    wrap.dataset.period = period;
    wrap.className = 'v4-team-chart-panel';
    wrap.innerHTML = `
      <div class="v4-team-chart-head">
        <div class="v4-team-chart-title">Planned vs Done — <em>${escHtml(team)}</em></div>
        <div class="v4-team-chart-sub">${escHtml(data.subtitle || '')}</div>
      </div>
      <div class="v4-team-chart-canvas-wrap"><canvas id="v4-team-chart-canvas"></canvas></div>
      <div class="v4-team-chart-foot">
        <span class="v4-legend"><i style="background:#0e023a"></i>Planned</span>
        <span class="v4-legend"><i style="background:#14a1e9"></i>Done</span>
        <span class="v4-team-chart-totals">${data.totalPlanned} planned · ${data.totalDone} done</span>
      </div>
    `;
    body.insertBefore(wrap, body.firstChild);

    // Render Chart.js
    const ctx = document.getElementById('v4-team-chart-canvas');
    if (window.Chart && ctx) {
      _v4ChartInstance = new window.Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: 'Planned',
              data: data.planned,
              borderColor: '#0e023a',
              backgroundColor: 'rgba(14,2,58,0.08)',
              borderWidth: 2.4,
              tension: 0.32,
              fill: true,
              pointRadius: 3.5,
              pointHoverRadius: 6,
              pointBackgroundColor: '#0e023a',
              pointBorderColor: '#fff',
              pointBorderWidth: 1.4,
            },
            {
              label: 'Done',
              data: data.done,
              borderColor: '#14a1e9',
              backgroundColor: 'rgba(20,161,233,0.10)',
              borderWidth: 2.6,
              tension: 0.32,
              fill: true,
              pointRadius: 3.5,
              pointHoverRadius: 6,
              pointBackgroundColor: '#14a1e9',
              pointBorderColor: '#fff',
              pointBorderWidth: 1.4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { family: 'JetBrains Mono', size: 11 } } },
            y: { beginAtZero: true, ticks: { precision: 0, font: { family: 'JetBrains Mono', size: 11 } }, grid: { color: 'rgba(14,2,58,0.06)' } },
          },
        },
      });
    }
  }

  // The team-detail period buttons are rendered inline with font-weight:700
  // when active. They use onclick="teamTokenPeriod='<p>';..." — read the
  // period from the active button's onclick attr.
  function readTeamPeriodFromDOM() {
    const body = document.getElementById('stats-detail-body');
    if (!body) return '';
    const buttons = body.querySelectorAll('button[onclick]');
    for (const b of buttons) {
      const oc = b.getAttribute('onclick') || '';
      const m = oc.match(/teamTokenPeriod\s*=\s*['"]([^'"]+)['"]/);
      if (!m) continue;
      // Active button uses font-weight 700 (per host inline styling)
      if ((b.style.fontWeight || '') === '700' || b.classList.contains('active')) {
        return m[1];
      }
    }
    return '';
  }

  function removeTeamChart() {
    if (_v4ChartInstance) { try { _v4ChartInstance.destroy(); } catch (e) {} _v4ChartInstance = null; }
    const existing = document.getElementById('v4-team-chart');
    if (existing) existing.remove();
  }

  // Build planned vs done data for a team given the current period.
  // Sources:
  //   - PROD[wc][prep]      for planned counts per prep day
  //   - STATS_COMPLETIONS   for actual completions
  //   - statsRefDate()      reference date for the current period
  function buildTeamChartData(team, period) {
    const PROD = window.PROD || {};
    const COMPS = window.STATS_COMPLETIONS || [];
    const refDate = (typeof window.statsRefDate === 'function') ? window.statsRefDate() : new Date();
    refDate.setHours(0, 0, 0, 0);

    // Helper: parse a SharePoint CompletedDate (dd/mm/yyyy or ISO)
    function parseDate(raw) {
      if (!raw) return null;
      let d;
      if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) {
        const [dd, mm, yyyy] = raw.split('/');
        d = new Date(+yyyy, +mm - 1, +dd);
      } else {
        d = new Date(raw);
      }
      return isNaN(d) ? null : d;
    }
    function sameDay(a, b) {
      return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
    }
    function ddmmyyyy(d) {
      return d.toLocaleDateString('en-GB');
    }

    // Find the PROD key whose .wc Monday matches the start-of-week of refDate.
    function mondayOf(d) {
      const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0,0,0,0);
      return x;
    }
    // UK bank-holiday awareness (uses globals defined in index.html — falls
    // back to no-op if the bundle hasn't loaded yet).
    const BANK = (typeof window !== 'undefined' && window.UK_BANK_HOLIDAYS) || new Set();
    const dateKey = (typeof window !== 'undefined' && window.localDateKey)
      || function(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
    function isBankHoliday(d) { return BANK.has(dateKey(d)); }
    function plannedFor(date) {
      const dow = date.getDay();              // 0=Sun, 1=Mon … 5=Fri, 6=Sat
      if (dow < 1 || dow > 5) return 0;       // weekend
      if (isBankHoliday(date)) return 0;      // closed — no work expected
      // Prep number = nth working day of the week (skipping bank holidays).
      // On a bank-holiday Monday week, Tuesday becomes Prep 1, Wed = Prep 2, etc.
      const targetMon = mondayOf(date);
      let prep = 0;
      const cur = new Date(targetMon);
      while (cur.getTime() <= date.getTime()) {
        const cdow = cur.getDay();
        if (cdow >= 1 && cdow <= 5 && !isBankHoliday(cur)) prep++;
        cur.setDate(cur.getDate() + 1);
      }
      if (prep < 1) return 0;
      const targetStr = ddmmyyyy(targetMon);
      const wcKey = Object.keys(PROD).find(k => PROD[k] && PROD[k].wc === targetStr);
      if (!wcKey) return 0;
      const jobs = (PROD[wcKey] && PROD[wcKey][prep]) || [];
      return jobs.length;
    }
    function doneFor(date) {
      const want = ddmmyyyy(date);
      const dayComps = COMPS.filter(c => c.fields && c.fields.Team === team && c.fields.CompletedDate === want);
      // Woodmill and Upholstery write one completion record per sub-part
      // (Arms / Backs / Seats), so a raw count is ~3× the effective job
      // count and won't match the "Total jobs" shown on the main stats
      // dashboard token. Reduce to job count instead:
      //   Woodmill   → (arms + backs) / 2  (matches main-token formula)
      //   Upholstery → (arms + backs + seats) / 3  (3-part average)
      if (team === 'Woodmill' || team === 'Upholstery') {
        const arms  = dayComps.filter(c => c.fields.SubTeam === 'Arms').length;
        const backs = dayComps.filter(c => c.fields.SubTeam === 'Backs').length;
        const seats = dayComps.filter(c => c.fields.SubTeam === 'Seats').length;
        if (team === 'Woodmill')   return Math.floor((arms + backs) / 2);
        if (team === 'Upholstery') return Math.floor((arms + backs + seats) / 3);
      }
      return dayComps.length;
    }
    // Was-anything-completed check used for Saturday-overtime detection.
    // Uses the raw record count (not the part-aggregated one) so that even
    // a partial Woodmill day on Saturday triggers the Sat token.
    function hasCompletions(date) {
      const want = ddmmyyyy(date);
      return COMPS.some(c => c.fields && c.fields.Team === team && c.fields.CompletedDate === want);
    }

    const labels = [], planned = [], done = [];
    let subtitle = '';

    if (period === 'today' || period === 'yesterday') {
      // Walk back 10 working days ending on today. Mon–Fri always; Saturday
      // counts as a "working day" only when there were any completions
      // (overtime). Sunday excluded entirely. Today is the rightmost token.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const days = [];
      const cur = new Date(today);
      while (days.length < 10) {
        const dow = cur.getDay();
        if (dow >= 1 && dow <= 5) {
          days.push(new Date(cur));
        } else if (dow === 6 && hasCompletions(cur)) {
          days.push(new Date(cur));
        }
        cur.setDate(cur.getDate() - 1);
      }
      days.reverse(); // oldest first → today last
      const fmt = { weekday: 'short', day: 'numeric', month: 'short' };
      days.forEach(d => {
        const isToday = d.getTime() === today.getTime();
        labels.push(isToday ? 'Today' : d.toLocaleDateString('en-GB', fmt));
        planned.push(plannedFor(d));
        done.push(doneFor(d));
      });
      const start = days[0];
      subtitle = `Last 10 working days · ${start.toLocaleDateString('en-GB', { day:'numeric', month:'short' })} → today`;
    } else if (period === 'week' || !period) {
      const mon = mondayOf(refDate);
      const dayNames = ['Mon','Tue','Wed','Thu','Fri'];
      for (let i = 0; i < 5; i++) {
        const d = new Date(mon); d.setDate(mon.getDate() + i); d.setHours(0,0,0,0);
        labels.push(dayNames[i]);
        planned.push(plannedFor(d));
        done.push(doneFor(d));
      }
      // Saturday overtime token — only show when something was actually
      // completed on Saturday. Planned stays 0 (no prep day), so the bar
      // visually flags "we worked Saturday to clear N jobs".
      const sat = new Date(mon); sat.setDate(mon.getDate() + 5); sat.setHours(0,0,0,0);
      if (hasCompletions(sat)) {
        labels.push('Sat');
        planned.push(plannedFor(sat)); // always 0
        done.push(doneFor(sat));
      }
      subtitle = 'Week of ' + mon.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
    } else if (period === 'month') {
      // Group by week within the month — include Saturdays in the inner
      // loop so overtime completions roll into the weekly bar (planned is
      // 0 on Sat so totals only gain on the done side).
      const ref = new Date(refDate);
      const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
      const last  = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      const monStart = mondayOf(first);
      let cursor = new Date(monStart);
      while (cursor <= last) {
        const wkLabel = 'W' + (typeof window.isoWeekNumber === 'function' ? window.isoWeekNumber(cursor) : '?');
        let wkPlanned = 0, wkDone = 0;
        for (let i = 0; i < 6; i++) { // Mon..Sat
          const d = new Date(cursor); d.setDate(cursor.getDate() + i); d.setHours(0,0,0,0);
          if (d.getMonth() === ref.getMonth()) {
            wkPlanned += plannedFor(d);
            wkDone    += doneFor(d);
          }
        }
        labels.push(wkLabel);
        planned.push(wkPlanned);
        done.push(wkDone);
        cursor.setDate(cursor.getDate() + 7);
      }
      subtitle = ref.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
    } else if (period === 'year') {
      const ref = new Date(refDate);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      for (let m = 0; m < 12; m++) {
        const first = new Date(ref.getFullYear(), m, 1);
        const last  = new Date(ref.getFullYear(), m + 1, 0);
        let mPlanned = 0, mDone = 0;
        for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
          const dow = (d.getDay() + 6) % 7;
          if (dow <= 5) { // Mon..Sat (Sat collects overtime done; planned is 0 there)
            mPlanned += plannedFor(d);
            mDone    += doneFor(d);
          }
        }
        labels.push(months[m]);
        planned.push(mPlanned);
        done.push(mDone);
      }
      subtitle = '' + ref.getFullYear();
    }

    const totalPlanned = planned.reduce((a,b)=>a+b,0);
    const totalDone    = done.reduce((a,b)=>a+b,0);
    return { labels, planned, done, totalPlanned, totalDone, subtitle };
  }

  // Local escape for chart strings
  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── 1. SVG sprite ─────────────────────────────────────────────
  function injectSprite() {
    if (document.getElementById('v4-sprite-root')) return;
    const sprite = `
<svg id="v4-sprite-root" width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <!-- Woodmill — circular saw blade (12 teeth + arbor hole) -->
    <symbol id="v4-team-woodmill" viewBox="0 0 24 24">
      <polygon points="12,3 13.81,5.24 16.5,4.21 16.95,7.05 19.79,7.5 18.76,10.19 21,12 18.76,13.81 19.79,16.5 16.95,16.95 16.5,19.79 13.81,18.76 12,21 10.19,18.76 7.5,19.79 7.05,16.95 4.21,16.5 5.24,13.81 3,12 5.24,10.19 4.21,7.5 7.05,7.05 7.5,4.21 10.19,5.24"
        fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <circle cx="12" cy="12" r="0.7" fill="currentColor"/>
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
    <!-- Sewing — needle with prominent oval eye + thread looping through -->
    <symbol id="v4-team-sewing" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <!-- Long needle shaft from eye end to sharp tip -->
        <line x1="12" y1="10.5" x2="13" y2="22" stroke-width="2.2"/>
        <!-- Big visible eye (oval hole), distinctly bigger than a pin head -->
        <ellipse cx="11.5" cy="6.5" rx="2.4" ry="3.8" stroke-width="1.7"/>
        <!-- Thread clearly weaving through the eye, both tails visible -->
        <path d="M4 4 Q8 5 11.5 6.5 Q15 8 19 6" stroke-width="1.5"/>
        <!-- Trailing tail end -->
        <path d="M19 6 Q21 5 19 2.5" stroke-width="1.3" opacity="0.75"/>
      </g>
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
    <!-- Development — flask -->
    <symbol id="v4-team-development" viewBox="0 0 24 24">
      <g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">
        <path d="M9 3 L15 3"/>
        <path d="M10 3 L10 9 L4.5 18 Q3.5 21 6.5 21 L17.5 21 Q20.5 21 19.5 18 L14 9 L14 3"/>
      </g>
      <path d="M7.5 15 L16.5 15" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>
      <circle cx="10" cy="18" r="0.9" fill="currentColor" opacity="0.55"/>
      <circle cx="13.5" cy="19" r="0.7" fill="currentColor" opacity="0.45"/>
      <circle cx="11.5" cy="17" r="0.5" fill="currentColor" opacity="0.4"/>
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

  // ── 1b. Home view (only exists with ?ui=v4) ───────────────────
  function injectHomeView() {
    if (document.getElementById('view-home')) return;
    const html = `
<div class="view" id="view-home">
  <div class="v4-home">
    <div class="v4-home-eyebrow">
      <span>Repose</span>
      <i></i>
      <span>powered by</span>
      <img src="./repnet-logo-white.png" alt="RepNet" class="v4-home-mark" onerror="this.style.display='none'">
    </div>

    <h1 class="v4-home-title">
      The factory, <em>in real time.</em>
    </h1>
    <p class="v4-home-sub">
      Every team. Every job. From cut to delivery — all on one screen.
    </p>

    <div class="v4-home-grid">
      <button type="button" class="v4-home-card" data-jump="team-select">
        <span class="v4-home-card-ico">▤</span>
        <span class="v4-home-card-title">Team View</span>
        <span class="v4-home-card-desc">Pick your team and tick off jobs as you go.</span>
        <span class="v4-home-card-cta">Open →</span>
      </button>

      <button type="button" class="v4-home-card" data-jump="quality">
        <span class="v4-home-card-ico">✓</span>
        <span class="v4-home-card-title">Quality</span>
        <span class="v4-home-card-desc">Internal NCRs, QHSE review, supplier registers.</span>
        <span class="v4-home-card-cta">Open →</span>
      </button>

      <button type="button" class="v4-home-card" data-jump="loadsheet">
        <span class="v4-home-card-ico">↗</span>
        <span class="v4-home-card-title">Delivery</span>
        <span class="v4-home-card-desc">Weekly load sheet. Vans, customers, ready-to-ship.</span>
        <span class="v4-home-card-cta">Open →</span>
      </button>

      <button type="button" class="v4-home-card" data-jump="stats">
        <span class="v4-home-card-ico">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <use href="#v4-stats-icon"/>
          </svg>
        </span>
        <span class="v4-home-card-title">Stats</span>
        <span class="v4-home-card-desc">Production numbers, QC, scrap and trends.</span>
        <span class="v4-home-card-cta">Open →</span>
      </button>
    </div>

    <div class="v4-home-foot">
      <span class="v4-home-tag">RepNet · QHSE production tracker</span>
      <span class="v4-home-tag">Repose Furniture · 2026</span>
    </div>
  </div>
</div>`;
    // Insert as a sibling of the existing views (after the topbar)
    const topbar = document.querySelector('.topbar');
    if (topbar && topbar.parentElement) {
      topbar.insertAdjacentHTML('afterend', html);
    } else {
      document.body.insertAdjacentHTML('afterbegin', html);
    }

    // Card click → route to the underlying view via existing navTo
    document.querySelectorAll('.v4-home-card[data-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.jump;
        if (typeof window.navTo === 'function') window.navTo(target);
        else showHostView(target);
        syncActive(target);
      });
    });
  }

  // Show a host view by id ('team-select', 'overview', etc.) without navTo
  function showHostView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');
  }

  // Show our home view, hiding all host views
  function goHome() {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const home = document.getElementById('view-home');
    if (home) home.classList.add('active');
  }

  // ── 2. Sidebar markup ─────────────────────────────────────────
  function injectSidebar() {
    if (document.getElementById('ui-v4-side')) return;
    const navHtml = NAV.map(item => {
      if (item.h) return `<div class="v4-h"><span class="v4-lbl">${item.h}</span></div>`;
      const glyHtml = item.g === 'STATS'
        ? `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><use href="#v4-stats-icon"/></svg>`
        : item.g;
      return `<a href="#${item.v}" data-view="${item.v}" title="${item.l}"><span class="v4-gly">${glyHtml}</span><span class="v4-lbl">${item.l}</span></a>`;
    }).join('');

    const sideHtml = `
<aside class="ui-v4-side" id="ui-v4-side">
  <div class="v4-brand">
    <img src="./repnet-logo-white.png" alt="RepNet" onerror="this.style.display='none'">
  </div>
  <div class="v4-nav-area">
    ${navHtml}
  </div>
  <div class="v4-foot">
    <button type="button" class="v4-user" id="v4-user-btn" title="Sign in">
      <span class="av" id="v4-avatar">→</span>
      <div class="v4-user-info">
        <div class="nm" id="v4-username">Sign in</div>
        <div class="role" id="v4-userrole">Tap to sign in</div>
      </div>
      <span id="v4-presence"></span>
    </button>
    <button type="button" class="v4-nms" id="v4-nms-btn" title="Raise Near Miss"><span class="v4-nms-icon">⚠</span><span class="v4-lbl">Raise NMS</span></button>
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

    // User box: delegate to whatever the auth-badge's current onclick is.
    // updateAuthBadge() sets it to graphSignIn when signed-out and to
    // graphSignOutConfirm when signed-in. Calling badge.onclick() runs the
    // right handler for the current state.
    const userBtn = document.getElementById('v4-user-btn');
    if (userBtn) {
      userBtn.addEventListener('click', () => {
        const badge = document.getElementById('auth-badge');
        if (badge && typeof badge.onclick === 'function') {
          badge.onclick();
        } else if (typeof window.graphSignIn === 'function') {
          window.graphSignIn();
        }
      });
    }
  }

  // ── 2b. Feedback widget (FAB + modal) ─────────────────────────
  // Writes to SharePoint list `RepNet_Feedback` on the Quality site
  // (ReposeFurniture-Quality — same site as the QMS doc-control lists,
  // so list-level permissions can be managed by Jonas as site owner).
  // Required list columns (see docs/superpowers/specs):
  //   Title (text), Type (choice), Description (multi-line text),
  //   PageUrl (text), Submitter (text), SubmitterName (text),
  //   UserAgent (text), Status (choice, default 'New').
  function injectFeedback() {
    if (document.getElementById('fb-fab')) return;

    const html = `
<button type="button" id="fb-fab" title="Send feedback" aria-label="Send feedback">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </svg>
</button>
<div id="fb-backdrop" role="presentation">
  <div id="fb-modal" role="dialog" aria-modal="true" aria-labelledby="fb-title">
    <div class="fb-head">
      <div>
        <h2 id="fb-title">Send feedback</h2>
        <div class="fb-sub">help us fix &amp; improve repnet</div>
      </div>
      <button type="button" class="fb-close" id="fb-close" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="fb-body">
      <div class="fb-label">What's this about?</div>
      <div class="fb-types" id="fb-types" role="radiogroup" aria-label="Feedback type">
        <button type="button" class="fb-type on" data-t="Bug"      role="radio" aria-checked="true"><span class="fb-ico">🐞</span>Bug</button>
        <button type="button" class="fb-type"    data-t="Idea"     role="radio" aria-checked="false"><span class="fb-ico">💡</span>Idea</button>
        <button type="button" class="fb-type"    data-t="Question" role="radio" aria-checked="false"><span class="fb-ico">❓</span>Question</button>
      </div>
      <div class="fb-label">Tell us what happened</div>
      <textarea id="fb-note" placeholder="e.g. When I press 'Complete' on a ticket the screen flashes and the row disappears before the timer saves." maxlength="4000"></textarea>
      <div class="fb-context">
        <div class="fb-ctx-ic" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2l9 4-9 4-9-4 9-4zM3 10l9 4 9-4M3 14l9 4 9-4"/></svg>
        </div>
        <div class="fb-ctx-txt" id="fb-context-text">Auto-attached on send</div>
      </div>
    </div>
    <div class="fb-foot">
      <div class="fb-hint">Ctrl/⌘ + Enter to send</div>
      <div class="fb-btns">
        <button type="button" class="fb-btn ghost" id="fb-cancel">Cancel</button>
        <button type="button" class="fb-btn primary" id="fb-send">Send feedback</button>
      </div>
    </div>
  </div>
</div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    const fab     = document.getElementById('fb-fab');
    const bd      = document.getElementById('fb-backdrop');
    const closeB  = document.getElementById('fb-close');
    const cancelB = document.getElementById('fb-cancel');
    const sendB   = document.getElementById('fb-send');
    const note    = document.getElementById('fb-note');
    const ctx     = document.getElementById('fb-context-text');
    const typeRow = document.getElementById('fb-types');
    let selectedType = 'Bug';
    let lastFocus = null;

    function pageLabel() {
      // Prefer the active view's <h2> title; fall back to the data-view name; finally URL.
      const active = document.querySelector('.view.active');
      if (active) {
        const h = active.querySelector('h1, h2, h3');
        if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 80);
        if (active.id) return active.id.replace(/^view-/, '');
      }
      return location.pathname + location.hash;
    }
    function currentUserAccount() {
      try { return (typeof window.getCurrentUser === 'function') ? window.getCurrentUser() : null; } catch { return null; }
    }
    function currentUserEmail() {
      const a = currentUserAccount();
      return (a && a.username) || '';
    }
    function currentUserName() {
      const a = currentUserAccount();
      return (a && (a.name || a.username)) || '';
    }
    function refreshContextLine() {
      const who = currentUserEmail() || '(not signed in)';
      const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
      ctx.innerHTML = `Auto-attached: <b>${escapeHtml(pageLabel())}</b> · user <b>${escapeHtml(who)}</b> · ${escapeHtml(when)}`;
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function open() {
      lastFocus = document.activeElement;
      refreshContextLine();
      bd.classList.add('open');
      // Defer focus so animation can start before the cursor jumps
      setTimeout(() => note.focus(), 30);
    }
    function close() {
      bd.classList.remove('open');
      sendB.disabled = false;
      sendB.textContent = 'Send feedback';
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    fab.addEventListener('click', open);
    closeB.addEventListener('click', close);
    cancelB.addEventListener('click', close);
    bd.addEventListener('click', e => { if (e.target === bd) close(); });

    typeRow.addEventListener('click', e => {
      const b = e.target.closest('.fb-type'); if (!b) return;
      selectedType = b.dataset.t || 'Bug';
      typeRow.querySelectorAll('.fb-type').forEach(p => {
        const on = (p === b);
        p.classList.toggle('on', on);
        p.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });

    document.addEventListener('keydown', e => {
      if (!bd.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendB.click(); }
    });

    sendB.addEventListener('click', async () => {
      const body = (note.value || '').trim();
      if (!body) { note.focus(); return; }
      sendB.disabled = true;
      sendB.textContent = 'Sending…';
      try {
        await submitFeedback({
          type: selectedType,
          description: body,
          pageLabel: pageLabel(),
          pageUrl: location.href,
          email: currentUserEmail(),
          name: currentUserName(),
        });
        note.value = '';
        close();
        if (typeof window.toast === 'function') {
          window.toast('Feedback sent — thanks!', 's');
        }
      } catch (err) {
        console.error('[feedback] submit failed:', err);
        sendB.disabled = false;
        sendB.textContent = 'Send feedback';
        if (typeof window.toast === 'function') {
          window.toast('Could not send — ' + (err && err.message ? err.message : 'try again'), 'u');
        }
      }
    });
  }

  // Resolves the RepNet_Feedback list id on the Quality site. Tries the
  // cheap display-name lookup first; if that 404s (common when SharePoint's
  // display name diverges from the URL slug — e.g. UI rename creates
  // "RepNet Feedback" with a space while the slug stays underscored),
  // falls back to enumerating site lists and matching by either the SP
  // `name` field (URL slug) or `displayName`, case-insensitive, also
  // tolerating the space-vs-underscore variant. Cached in-module so we
  // only enumerate once per session.
  let _cachedFbListId = null;
  async function resolveFeedbackListId(siteId) {
    if (_cachedFbListId) return _cachedFbListId;
    if (typeof window.getListIdByNameOnSite === 'function') {
      try {
        _cachedFbListId = await window.getListIdByNameOnSite(siteId, 'RepNet_Feedback');
        return _cachedFbListId;
      } catch (e) { /* fall through to enumeration */ }
    }
    const token = await window.getGraphToken();
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$select=id,name,displayName&$top=200`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!r.ok) throw new Error(`feedback list lookup failed — Graph ${r.status}`);
    const data = await r.json();
    const hit = (data.value || []).find(l => {
      const nm = String(l.name || '').toLowerCase();
      const dn = String(l.displayName || '').toLowerCase();
      return nm === 'repnet_feedback' || nm === 'repnet feedback'
          || dn === 'repnet_feedback' || dn === 'repnet feedback';
    });
    if (!hit) throw new Error('feedback list not set up yet — ask Jonas');
    _cachedFbListId = hit.id;
    return _cachedFbListId;
  }

  async function submitFeedback(input) {
    if (typeof window.getGraphToken !== 'function' || typeof window.getQmsSiteId !== 'function') {
      throw new Error('not ready — try again in a moment');
    }
    const siteId = await window.getQmsSiteId();
    let listId;
    try {
      listId = await resolveFeedbackListId(siteId);
    } catch (e) {
      throw new Error(e.message || 'feedback list not set up yet — ask Jonas');
    }
    const token = await window.getGraphToken();
    // Title: first line of description, trimmed to 80 chars — keeps SP list scannable
    const firstLine = input.description.split(/\r?\n/)[0].trim();
    const title = (firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine) || `${input.type} report`;
    const fields = {
      Title: title,
      FeedbackType: input.type,   // 'Type' is a reserved SP internal name on lists, so we use FeedbackType
      Description: input.description,
      PageUrl: input.pageUrl,
      PageLabel: input.pageLabel,
      Submitter: input.email || '(anonymous)',
      SubmitterName: input.name || '',
      UserAgent: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 255) : '',
      Status: 'New',
    };
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;
    const fetcher = (typeof window._graphFetchWithRetry === 'function')
      ? window._graphFetchWithRetry
      : fetch;
    const res = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Graph ${res.status}${txt ? ': ' + txt.slice(0, 120) : ''}`);
    }
    return res.json();
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
        const view = a.dataset.view;
        if (view === 'home') {
          goHome();
        } else if (typeof window.navTo === 'function') {
          window.navTo(view);
        }
        syncActive(view);
      });
    }
    syncActive('home');
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

    // Maintenance team tiles (.mt-tile .mt-icon)
    const mtTiles = document.querySelectorAll('.mt-tile');
    for (const tile of mtTiles) {
      const nameEl = tile.querySelector('.mt-team');
      if (!nameEl) continue;
      const key = findKey(nameEl.textContent);
      if (!key) continue;
      const iconBox = tile.querySelector('.mt-icon');
      if (iconBox && !iconBox.querySelector('.team-svg-icon')) {
        iconBox.innerHTML =
          `<svg class="team-svg-icon" viewBox="0 0 24 24" width="32" height="32" style="color:var(--repose-navy);">` +
          `<use href="#${TEAM_TO_SPRITE[key]}"/></svg>`;
      }
    }

    // Production Plan team highlight buttons (.pp-team-btn)
    // Markup: `${t.icon} ${t.lbl}` where lbl is an abbreviation (WM/FM/CT/SW/UH/AS/QC).
    const PP_LBL_TO_TEAM = {
      'WM': 'Woodmill', 'FM': 'Foam', 'CT': 'Cutting',
      'SW': 'Sewing', 'UH': 'Upholstery', 'AS': 'Assembly', 'QC': 'QC',
    };
    const ppBtns = document.querySelectorAll('.pp-team-btn');
    for (const btn of ppBtns) {
      if (btn.querySelector('.team-svg-icon')) continue;
      const txt = btn.textContent.replace(/\s+/g, ' ').trim();
      const m = txt.match(/(?:^|\s)([A-Z]{2})$/);
      const lbl = m ? m[1] : null;
      const key = lbl && PP_LBL_TO_TEAM[lbl];
      if (!key || !TEAM_TO_SPRITE[key]) continue;
      btn.innerHTML =
        `<span class="team-svg-icon" style="display:inline-flex;vertical-align:-3px;margin-right:4px;color:inherit;">` +
        `<svg viewBox="0 0 24 24" width="14" height="14"><use href="#${TEAM_TO_SPRITE[key]}"/></svg>` +
        `</span>` + lbl;
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
      // When signed in: initials. When signed out: a clear "sign-in" arrow.
      const isSignedOut = t === 'Sign in' || !t;
      const next = isSignedOut
        ? '→'
        : (t.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '→');
      if (avEl.textContent !== next) avEl.textContent = next;
      avEl.classList.toggle('signed-out', isSignedOut);
    }
    if (presence && authDot) {
      const on = !authDot.classList.contains('off');
      presence.style.background = on ? '#4ade80' : '#a8a8a8';
      presence.style.boxShadow = on ? '0 0 0 4px rgba(74,222,128,0.18)' : 'none';
    }
  }
})();
