# Job Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Timing" tab to RepNet (visible only to Jonas and Richard Semmens) showing average job duration per furniture model, broken down by team (Sewing, Assembly, Cutting, Upholstery), with a Today / This Week / This Month / All Time period filter.

**Architecture:** All changes go into the single `index.html` file, following the existing pattern. Data is captured by adding two fields (`StartTime`, `Model`) to the completion save function. The tab is gated by checking the signed-in Microsoft account email in `updateAuthBadge()`. Timing stats are computed client-side from `STATS_COMPLETIONS` (already loaded by the Stats tab). Duration is calculated in working minutes using the factory schedule (Mon–Thu 07:00–16:00, Fri 07:00–12:00) to handle cross-day jobs correctly.

**Tech Stack:** Vanilla HTML/CSS/JS · Microsoft Graph API (no new scopes) · MSAL.js (already in app)

**Spec:** `docs/superpowers/specs/2026-04-11-job-timing-design.md`

---

## File Map

| File | Change |
|---|---|
| `index.html:1823` | Add Timing nav button (hidden by default, `id="timing-tab-btn"`) after CPARs button |
| `index.html:2594` | Add `'timing':'Job Timing'` to `NAV_LABELS` |
| `index.html:2614` | Add `showView` hook: `if (name === 'timing') { tmOnOpen(); }` |
| `index.html:4660–4672` | Add `StartTime` and `Model` fields to `saveCompletionToList()` payload |
| `index.html:5485–5487` | Add Timing button show/hide in `updateAuthBadge()` |
| `index.html:~2230` | Add `<div id="view-timing">` HTML block after `view-ordercheck` |
| `index.html:<style>` | Add `.tm-*` CSS classes |
| `index.html:10483` | Add all new JS before `</script>` |

---

## Task 1: Capture `StartTime` and `Model` on completion

**Files:**
- Modify: `index.html:4660–4672` — `saveCompletionToList()` fields payload

- [ ] **Step 1: Add fields to the payload**

Find the `fields` object in `saveCompletionToList()` (line ~4660). The current object ends with:
```js
      IsComplete:    true,
      ...(team === 'Assembly' ? { MechSerial: MECH_SERIALS.get(`${job.rep}__${wk}__${prep}`) || '' } : {}),
```

Replace with:
```js
      IsComplete:    true,
      StartTime:     s.startedAt || '',
      Model:         job.spec?.model?.trim() || '',
      ...(team === 'Assembly' ? { MechSerial: MECH_SERIALS.get(`${job.rep}__${wk}__${prep}`) || '' } : {}),
```

- [ ] **Step 2: Verify in browser console**

Open RepNet, sign in. Open the team view for Sewing or Assembly. Tap Start on a job, then tap Done. In the browser console run:

```js
const siteId = await getSpSiteId();
const listId = await getSpListId();
const items  = await graphGetAll(
  `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=10&$orderby=createdDateTime desc`
);
console.table(items.map(i => ({
  REP: i.fields.REP,
  StartTime: i.fields.StartTime,
  CompletedTime: i.fields.CompletedTime,
  Model: i.fields.Model,
  IsComplete: i.fields.IsComplete,
})));
```

Expected: The most recent record shows `StartTime` = the time you tapped Start, `CompletedTime` = the time you tapped Done, `Model` = the furniture model name.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: capture StartTime and Model in completion records"
```

---

## Task 2: Nav button + routing

**Files:**
- Modify: `index.html:1823` — nav dropdown HTML
- Modify: `index.html:2594` — `NAV_LABELS` constant
- Modify: `index.html:2614` — `showView()` function

- [ ] **Step 1: Add nav button (hidden by default)**

Find line 1823:
```html
        <button class="nav-item" data-view="issues" id="issues-tab-btn" onclick="navTo('issues')">CPARs</button>
```

Add immediately after it:
```html
        <button class="nav-item" data-view="timing" id="timing-tab-btn" onclick="navTo('timing')" style="display:none">Job Timing</button>
```

- [ ] **Step 2: Add to NAV_LABELS**

Find line 2594:
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues','safety':'Safety','ordercheck':'Order Check' };
```

Replace with:
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues','safety':'Safety','ordercheck':'Order Check','timing':'Job Timing' };
```

- [ ] **Step 3: Add showView hook**

Find line 2614:
```js
  if (name === 'ordercheck')  { ocOnOpen(); }
```

Add immediately after:
```js
  if (name === 'timing')      { tmOnOpen(); }
```

- [ ] **Step 4: Show/hide button based on signed-in user**

Find in `updateAuthBadge()` (line ~5485):
```js
    const isJonas = graphAccount.username.toLowerCase() === 'jonas.simonaitis@reposefurniture.co.uk';
    const emailBtn = document.getElementById('cpar-email-btn');
    if (emailBtn) emailBtn.style.display = isJonas ? 'inline-flex' : 'none';
```

Add immediately after:
```js
    const TIMING_ALLOWED = new Set(['jonas.simonaitis@reposefurniture.co.uk','richard.semmens@reposefurniture.co.uk']);
    const timingBtn = document.getElementById('timing-tab-btn');
    if (timingBtn) timingBtn.style.display = TIMING_ALLOWED.has(graphAccount.username.toLowerCase()) ? '' : 'none';
```

- [ ] **Step 5: Verify in browser**

Sign in as Jonas. Open the nav menu — "Job Timing" should appear. Sign in as a different account — it should be absent. (If you can't test two accounts, confirm the button appears for Jonas.)

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Job Timing nav button, routing, access control by email"
```

---

## Task 3: View HTML

**Files:**
- Modify: `index.html` — add `<div id="view-timing">` after `view-ordercheck`

- [ ] **Step 1: Add view HTML block**

Find the closing `</div>` of `view-ordercheck` (search for `id="view-ordercheck"` and find its closing tag). Add a new view block immediately after it:

```html

<!-- ═══════════════════════════════════════════════
     VIEW: JOB TIMING
════════════════════════════════════════════════ -->
<div class="view" id="view-timing">
  <div class="tm-wrap">
    <div class="tm-toolbar">
      <div class="tm-chips" id="tm-team-chips">
        <button class="tm-chip active" data-team="Sewing"      onclick="tmSetTeam(this,'Sewing')">Sewing</button>
        <button class="tm-chip"        data-team="Assembly"    onclick="tmSetTeam(this,'Assembly')">Assembly</button>
        <button class="tm-chip"        data-team="Cutting"     onclick="tmSetTeam(this,'Cutting')">Cutting</button>
        <button class="tm-chip"        data-team="Upholstery"  onclick="tmSetTeam(this,'Upholstery')">Upholstery</button>
      </div>
      <div class="tm-chips" id="tm-period-chips">
        <button class="tm-chip"        data-period="today" onclick="tmSetPeriod(this,'today')">Today</button>
        <button class="tm-chip active" data-period="week"  onclick="tmSetPeriod(this,'week')">This Week</button>
        <button class="tm-chip"        data-period="month" onclick="tmSetPeriod(this,'month')">This Month</button>
        <button class="tm-chip"        data-period="all"   onclick="tmSetPeriod(this,'all')">All Time</button>
      </div>
    </div>
    <div class="tm-table-wrap">
      <table class="tm-table" id="tm-table">
        <thead>
          <tr>
            <th class="tm-th-model">Model</th>
            <th class="tm-th-num">Jobs</th>
            <th class="tm-th-num">Avg</th>
            <th class="tm-th-num">Min</th>
            <th class="tm-th-num">Max</th>
          </tr>
        </thead>
        <tbody id="tm-tbody"></tbody>
      </table>
      <div id="tm-empty" class="tm-empty" style="display:none">No timed completions yet</div>
      <div id="tm-loading" class="tm-loading" style="display:none">Loading…</div>
    </div>
    <div id="tm-footer" class="tm-footer"></div>
  </div>
</div>
```

- [ ] **Step 2: Verify in browser**

Navigate to Job Timing (sign in as Jonas). The view should render with toolbar and an empty table. No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Job Timing view HTML skeleton"
```

---

## Task 4: CSS

**Files:**
- Modify: `index.html` — append `.tm-*` CSS to end of `<style>` block

- [ ] **Step 1: Add CSS**

Find the closing `</style>` tag (the one before the main `<script>` tag, around line 1786). Insert immediately before it:

```css
/* ── JOB TIMING ──────────────────────────────── */
.tm-wrap          { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.tm-toolbar       { background:var(--bg2); border-bottom:1px solid var(--border); padding:10px 14px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
.tm-chips         { display:flex; gap:6px; flex-wrap:wrap; }
.tm-chip          { font-family:inherit; font-size:12px; font-weight:600; padding:5px 12px; border-radius:20px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.tm-chip:hover    { background:var(--bg4,#2a2a3a); color:var(--text1); }
.tm-chip.active   { background:var(--repose-blue); color:#fff; border-color:var(--repose-blue); }
.tm-table-wrap    { flex:1; overflow-y:auto; padding:10px 14px; }
.tm-table         { width:100%; border-collapse:collapse; }
.tm-table th      { font-size:11px; font-weight:700; color:var(--text2); text-transform:uppercase; letter-spacing:.05em; padding:6px 8px; border-bottom:1.5px solid var(--border); text-align:left; }
.tm-th-num        { text-align:right; }
.tm-table td      { font-size:13px; color:var(--text1); padding:8px 8px; border-bottom:1px solid var(--border); }
.tm-table td.num  { text-align:right; font-family:'JetBrains Mono',monospace; font-size:12px; }
.tm-table tbody tr:hover { background:var(--bg2); }
.tm-empty         { padding:32px; text-align:center; font-size:14px; color:var(--text2); }
.tm-loading       { padding:32px; text-align:center; font-size:14px; color:var(--text2); }
.tm-footer        { flex-shrink:0; padding:8px 14px; font-size:12px; color:var(--text2); border-top:1px solid var(--border); background:var(--bg2); }
```

- [ ] **Step 2: Verify in browser**

Navigate to Job Timing. The toolbar should show two rows of styled chips (Sewing/Assembly/Cutting/Upholstery and Today/This Week/This Month/All Time). Table header row visible. No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Job Timing CSS styles"
```

---

## Task 5: JS — helper functions

**Files:**
- Modify: `index.html:10483` — append before closing `</script>`

These are pure functions with no dependencies on DOM or state. Add them first so Task 6 can call them.

- [ ] **Step 1: Add constants and helpers**

Find the closing `</script>` (line 10483). Insert immediately before it:

```js
// ═══════════════════════════════════════════════
// JOB TIMING
// ═══════════════════════════════════════════════

const TIMING_TEAMS = ['Sewing','Assembly','Cutting','Upholstery'];

let tmActiveTeam   = 'Sewing';
let tmActivePeriod = 'week'; // 'today' | 'week' | 'month' | 'all'

// Returns total working minutes in a given Date (Mon-Thu=540, Fri=300, Sat/Sun=0)
function tmWorkDayMins(date) {
  const dow = date.getDay(); // 0=Sun,1=Mon,...,6=Sat
  if (dow === 0 || dow === 6) return 0;
  return dow === 5 ? 300 : 540;
}

// Returns end-of-working-day in minutes from midnight (Fri=720, else=960)
function tmWorkDayEndMin(date) {
  return date.getDay() === 5 ? 720 : 960;
}

// Steps back from a Date to the previous Mon-Fri working day
function tmPrevWorkingDay(date) {
  const d = new Date(date);
  do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

// Returns true if record CompletedDate falls within the active timing period
function tmInPeriod(dateStr) {
  const d = parseDdmmyyyy(dateStr);
  if (!d) return false;
  const now = new Date();
  if (tmActivePeriod === 'today') {
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  if (tmActivePeriod === 'week') {
    return isoWeekNumber(d) === isoWeekNumber(now) && isoWeekYear(d) === isoWeekYear(now);
  }
  if (tmActivePeriod === 'month') {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  return true; // 'all'
}

// Parses 'HH:MM' → integer minutes from midnight. Returns null on bad input.
function tmParseTime(str) {
  if (!str || typeof str !== 'string') return null;
  const [h, m] = str.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Calculates working-hours duration in minutes between StartTime and CompletedTime.
// completedDateStr is DD/MM/YYYY. Returns null if inputs are invalid or result is implausible.
function tmCalcDuration(startTimeStr, completedTimeStr, completedDateStr) {
  const startMin = tmParseTime(startTimeStr);
  const doneMin  = tmParseTime(completedTimeStr);
  const doneDate = parseDdmmyyyy(completedDateStr);
  if (startMin === null || doneMin === null || !doneDate) return null;

  let duration;
  if (doneMin >= startMin) {
    // Same day
    duration = doneMin - startMin;
  } else {
    // Cross-day: started previous working day
    const startDate = tmPrevWorkingDay(doneDate);
    // Remaining working minutes on start day (from startMin to end of that day)
    const startDayEnd = tmWorkDayEndMin(startDate);
    let total = startDayEnd - startMin;
    // Full working days in between
    const d = new Date(startDate);
    d.setDate(d.getDate() + 1);
    while (d.getTime() < doneDate.getTime()) {
      total += tmWorkDayMins(d);
      d.setDate(d.getDate() + 1);
    }
    // Minutes into completion day from 07:00
    total += doneMin - 420; // 420 = 7*60
    duration = total;
  }

  // Discard implausible durations
  if (duration < 1 || duration > 1440) return null;
  return duration;
}

// Formats integer minutes as '43m' or '1h 12m'
function tmFormatDuration(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
```

- [ ] **Step 2: Verify helpers in console**

Open the browser console on the Timing view and paste these assertions:

```js
// Same-day: 09:00 → 10:30 = 90 min
console.assert(tmCalcDuration('09:00','10:30','11/04/2026') === 90, 'same-day 90');

// Cross-day: started Mon 15:45, done Tue 08:20
// Mon remaining: 960-945=15min; Tue: 420→500=80min; total=95
console.assert(tmCalcDuration('15:45','08:20','14/04/2026') === 95, 'cross-day 95');

// Cross-day spanning Fri→Mon: started Fri 11:00, done Mon 08:00
// Fri remaining: 720-660=60; Sat=0, Sun=0, Mon: 420→480=60; total=120
console.assert(tmCalcDuration('11:00','08:00','13/04/2026') === 120, 'fri-mon 120');

// Implausible: >1440 → null
console.assert(tmCalcDuration('07:00','06:59','14/04/2026') === null || tmCalcDuration('07:00','06:59','14/04/2026') > 1440, 'implausible null');

// Format
console.assert(tmFormatDuration(43) === '43m', '43m');
console.assert(tmFormatDuration(72) === '1h 12m', '1h 12m');
console.assert(tmFormatDuration(60) === '1h', '1h');
console.log('All timing assertions passed');
```

Expected: `All timing assertions passed` with no assertion errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: Job Timing helper functions — duration calc, period filter, formatters"
```

---

## Task 6: JS — `tmOnOpen()`, `tmRender()`, chip handlers

**Files:**
- Modify: `index.html:10483` — append after the helpers added in Task 5, before `</script>`

- [ ] **Step 1: Add `tmOnOpen()`, chip handlers, and `tmRender()`**

Append immediately after the helper functions from Task 5 (still before `</script>`):

```js
function tmSetTeam(btn, team) {
  document.querySelectorAll('#tm-team-chips .tm-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  tmActiveTeam = team;
  tmRender();
}

function tmSetPeriod(btn, period) {
  document.querySelectorAll('#tm-period-chips .tm-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  tmActivePeriod = period;
  tmRender();
}

async function tmOnOpen() {
  if (!STATS_COMPLETIONS.length) {
    document.getElementById('tm-loading').style.display = '';
    document.getElementById('tm-empty').style.display   = 'none';
    document.getElementById('tm-tbody').innerHTML        = '';
    document.getElementById('tm-footer').textContent     = '';
    await loadStatsData();
    document.getElementById('tm-loading').style.display = 'none';
  }
  tmRender();
}

function tmRender() {
  const tbody   = document.getElementById('tm-tbody');
  const empty   = document.getElementById('tm-empty');
  const footer  = document.getElementById('tm-footer');

  // Filter completions: correct team, correct period, has StartTime and Model, IsComplete
  const records = STATS_COMPLETIONS.filter(c => {
    const f = c.fields;
    if (!f.IsComplete) return false;
    if (!f.StartTime || !f.Model) return false;
    // For Upholstery combine all sub-teams: Team field is 'Upholstery'
    if (tmActiveTeam === 'Upholstery') {
      if (f.Team !== 'Upholstery') return false;
    } else {
      if (f.Team !== tmActiveTeam) return false;
    }
    return tmInPeriod(f.CompletedDate);
  });

  // Compute duration per record, discard nulls
  const timed = [];
  for (const c of records) {
    const f   = c.fields;
    const dur = tmCalcDuration(f.StartTime, f.CompletedTime, f.CompletedDate);
    if (dur === null) continue;
    timed.push({ model: f.Model.trim(), dur });
  }

  if (!timed.length) {
    tbody.innerHTML = '';
    empty.style.display  = '';
    footer.textContent   = '';
    return;
  }
  empty.style.display = 'none';

  // Group by model
  const byModel = {};
  for (const { model, dur } of timed) {
    if (!byModel[model]) byModel[model] = [];
    byModel[model].push(dur);
  }

  // Build rows sorted by job count descending
  const rows = Object.entries(byModel)
    .map(([model, durs]) => {
      const avg = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
      const min = Math.min(...durs);
      const max = Math.max(...durs);
      return { model, count: durs.length, avg, min, max };
    })
    .sort((a, b) => b.count - a.count);

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escHtml(r.model)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${tmFormatDuration(r.avg)}</td>
      <td class="num">${tmFormatDuration(r.min)}</td>
      <td class="num">${tmFormatDuration(r.max)}</td>
    </tr>`).join('');

  footer.textContent = `Based on ${timed.length} timed completion${timed.length === 1 ? '' : 's'}`;
}
```

- [ ] **Step 2: Verify end-to-end in browser**

1. Sign in as Jonas and navigate to Job Timing.
2. If no `StartTime` data yet (Task 1 was just done): complete a job via Start → Done on Sewing, then reload Stats (to refresh `STATS_COMPLETIONS`), then navigate to Timing. The model should appear in the table.
3. Confirm chip switching (team and period) re-renders without errors.
4. Confirm empty state shows "No timed completions yet" when no matching records exist.
5. Open console — no errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: Job Timing — tmOnOpen, tmRender, chip handlers"
```

---

## Task 7: Reload after Stats data refresh

**Files:**
- Modify: `index.html` — `loadStatsData()` area (~line 6420–6430)

When the user clicks "Refresh" on the Stats tab, `STATS_COMPLETIONS` is cleared and reloaded. If the Timing tab is currently active when this happens, it should re-render with the fresh data.

- [ ] **Step 1: Add Timing re-render after stats reload**

Find `refreshStatsData()` at line ~6423:
```js
async function refreshStatsData() {
  STATS_COMPLETIONS = [];
  STATS_ALERTS      = [];
  STATS_SCRAP       = [];
  STATS_QC          = [];
  STATS_CPARS       = [];
  await loadStatsData();
}
```

Replace with:
```js
async function refreshStatsData() {
  STATS_COMPLETIONS = [];
  STATS_ALERTS      = [];
  STATS_SCRAP       = [];
  STATS_QC          = [];
  STATS_CPARS       = [];
  await loadStatsData();
  if (document.getElementById('view-timing')?.classList.contains('active')) tmRender();
}
```

- [ ] **Step 3: Verify in browser**

Open Stats tab, then switch to Timing. Switch back to Stats, click Refresh. Switch back to Timing — the table should reflect updated data without needing to re-open the tab.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: re-render Job Timing after Stats data refresh"
```
