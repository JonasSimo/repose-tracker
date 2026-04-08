# Order Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Order Check" view to RepNet that validates a selected production week's orders against all historical order data and flags field-level issues.

**Architecture:** Single new view added to `index.html` following the existing pattern (HTML block + CSS section + JS functions). No new files. Three data sources: the 52 WK sheets in `Production 2026 Dec-Nov.xlsx` (already resolved), a reference sheet in the same file, and a separate historical orders ledger Excel on SharePoint. History is built once per session into an in-memory `ocKnownValues` index.

**Tech Stack:** Vanilla HTML/CSS/JS, Microsoft Graph API (`graphGet`, `encodeSharingUrl` already in place), MSAL auth (no new scopes needed — `Files.Read.All` covers both files).

---

## File Map

| File | Change |
|---|---|
| `index.html:1630-1636` | Add nav item for Order Check |
| `index.html:2320` | Add `'ordercheck'` to `NAV_LABELS` |
| `index.html:2338` | Add `showView` hook for `'ordercheck'` |
| `index.html:~1895` | Add `<div id="view-ordercheck">` HTML block |
| `index.html:~1500` | Add CSS for `.oc-*` classes |
| `index.html:~4748` | Add `HIST_LEDGER_SHARING_URL` constant |
| `index.html:~8600` | Add all new JS functions (bottom of script) |

---

## Task 1: HTML skeleton + nav entry

**Files:**
- Modify: `index.html` — nav dropdown, NAV_LABELS, showView hook, view div

- [ ] **Step 1: Add nav item**

Find line 1636 (the Issues nav button):
```html
        <button class="nav-item" data-view="issues" id="issues-tab-btn" onclick="navTo('issues')">Issues</button>
```
Add immediately after it:
```html
        <button class="nav-item" data-view="ordercheck" onclick="navTo('ordercheck')">Order Check</button>
```

- [ ] **Step 2: Add to NAV_LABELS**

Find the `NAV_LABELS` constant (line ~2320):
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues' };
```
Replace with:
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues','ordercheck':'Order Check' };
```

- [ ] **Step 3: Add showView hook**

Find in `showView()` (line ~2338):
```js
  if (name === 'issues')      { openIssuesView(); }
```
Add immediately after:
```js
  if (name === 'ordercheck')  { ocOnOpen(); }
```

- [ ] **Step 4: Add view HTML block**

Find the comment block immediately before `<div class="view" id="view-issues">` (line ~1895). Add a new view block after the closing `</div>` of `view-issues`:
```html

<!-- ═══════════════════════════════════════════════
     VIEW: ORDER CHECK
════════════════════════════════════════════════ -->
<div class="view" id="view-ordercheck">
  <div class="oc-wrap">
    <div class="oc-toolbar">
      <div class="oc-controls">
        <label class="oc-label">Week</label>
        <select id="oc-week-select" class="oc-select"></select>
        <button class="oc-btn oc-btn-primary" id="oc-run-btn" onclick="ocRunCheck()">Load &amp; Check</button>
      </div>
      <div class="oc-hist-row">
        <span id="oc-hist-status" class="oc-hist-status not-loaded">● History not loaded</span>
        <button class="oc-btn" id="oc-build-btn" onclick="ocBuildHistory()">Build History</button>
      </div>
    </div>
    <div id="oc-results" class="oc-results"></div>
    <div id="oc-summary" class="oc-summary"></div>
  </div>
</div>
```

- [ ] **Step 5: Verify in browser**

Open `index.html` in Chrome. Sign in. Open the nav dropdown — "Order Check" should appear. Click it — should navigate to a blank view with no errors in the console.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Order Check view skeleton and nav entry"
```

---

## Task 2: CSS styles

**Files:**
- Modify: `index.html` — CSS section (around line 1500, near other tablet-mode media queries)

- [ ] **Step 1: Add CSS**

Find the end of the `<style>` block (search for `</style>` after the last CSS rule, before `</head>`). Insert these styles just before `</style>`:

```css
/* ── ORDER CHECK ─────────────────────────────── */
.oc-wrap        { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.oc-toolbar     { background:var(--bg2); border-bottom:1px solid var(--border); padding:10px 14px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
.oc-controls    { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.oc-label       { font-size:12px; color:var(--text2); font-weight:600; }
.oc-select      { font-family:inherit; font-size:13px; padding:6px 10px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text1); cursor:pointer; }
.oc-btn         { font-family:inherit; font-size:13px; font-weight:600; padding:7px 14px; border-radius:8px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text1); cursor:pointer; }
.oc-btn:hover   { background:var(--bg4,#2a2a3a); }
.oc-btn:disabled{ opacity:.5; cursor:default; }
.oc-btn-primary { background:var(--repose-blue); color:#fff; border-color:var(--repose-blue); }
.oc-btn-primary:hover { background:#1190d0; }
.oc-hist-row    { display:flex; align-items:center; gap:10px; }
.oc-hist-status { font-size:12px; color:var(--text2); }
.oc-hist-status.not-loaded { color:var(--text3,#888); }
.oc-hist-status.loaded      { color:var(--green); }
.oc-results     { flex:1; overflow-y:auto; padding:10px 14px; display:flex; flex-direction:column; gap:6px; }
.oc-summary     { flex-shrink:0; padding:8px 14px; font-size:12px; color:var(--text2); border-top:1px solid var(--border); background:var(--bg2); }
.oc-empty,.oc-error,.oc-loading { padding:24px; text-align:center; font-size:14px; color:var(--text2); }
.oc-error       { color:#ef4444; }

/* Order Check cards */
.oc-card        { border-radius:10px; border:1.5px solid var(--border); background:var(--bg2); overflow:hidden; cursor:pointer; }
.oc-card-header { display:flex; align-items:center; gap:10px; padding:10px 12px; }
.oc-rep         { font-family:'JetBrains Mono',monospace; font-size:13px; font-weight:600; color:var(--text1); }
.oc-job         { font-size:12px; color:var(--text2); }
.oc-status-badge{ margin-left:auto; font-size:12px; font-weight:700; padding:3px 8px; border-radius:6px; }
.oc-chevron     { font-size:11px; color:var(--text2); transition:transform .2s; }
.oc-card.open .oc-chevron { transform:rotate(180deg); }
.oc-card-body   { display:none; padding:8px 12px 12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:6px; }
.oc-card.open .oc-card-body { display:flex; }

/* Card states */
.oc-card.oc-ok   { border-color:var(--green); }
.oc-card.oc-warn { border-color:#d97706; }
.oc-card.oc-block{ border-color:#ef4444; }
.oc-status-badge.oc-ok    { background:rgba(5,150,105,.12);  color:var(--green); }
.oc-status-badge.oc-warn  { background:rgba(217,119,6,.12);  color:#d97706; }
.oc-status-badge.oc-block { background:rgba(239,68,68,.12);  color:#ef4444; }

/* Flag rows inside expanded card */
.oc-flag        { font-size:12px; padding:6px 8px; border-radius:6px; display:flex; flex-wrap:wrap; gap:4px; align-items:baseline; }
.oc-flag-block  { background:rgba(239,68,68,.08); }
.oc-flag-warn   { background:rgba(217,119,6,.08); }
.oc-flag-field  { font-weight:700; color:var(--text1); }
.oc-flag-val    { font-family:'JetBrains Mono',monospace; font-size:11px; }
.oc-flag-reason { color:var(--text2); }
```

- [ ] **Step 2: Verify in browser**

Navigate to Order Check. The toolbar should be styled correctly with the blue "Load & Check" button and grey "Build History" button. No console errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Order Check CSS styles"
```

---

## Task 3: Constants + `ocOnOpen()`

**Files:**
- Modify: `index.html` — constants block (~line 4748) and bottom of script

- [ ] **Step 1: Add constants**

Find the `PROD_SHARING_URL` constant (line ~4748):
```js
const PROD_SHARING_URL = 'https://reposefurniturelimited.sharepoint.com/...';
```
Add immediately after it:
```js
// Historical orders ledger — separate SharePoint Excel
const HIST_LEDGER_SHARING_URL = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBu5mtfNIDIQLW5_7aeZvLzAT6jp8kJGVjvrUr9g7PqA4M?e=d8xK0F';

// In-memory history index — built by ocBuildHistory(), null until built
let ocKnownValues = null;
```

- [ ] **Step 2: Add `ocOnOpen()`**

Scroll to the very end of the `<script>` block (just before `</script>`). Add:

```js
// ═══════════════════════════════════════════════
// ORDER CHECK
// ═══════════════════════════════════════════════

const OC_SET_FIELDS = ['model','fabric','coverCode','backDesign','mechanism1','mechanism2','seatOption','castor1','castor2'];
const OC_NUM_FIELDS = ['seatHeight','seatWidth','seatDepth','backHeight','armHeight'];
const OC_FIELD_LABELS = {
  model:'Model', fabric:'Fabric', coverCode:'Cover Code', backDesign:'Back Design',
  mechanism1:'Mechanism 1', mechanism2:'Mechanism 2', seatHeight:'Seat Height',
  seatWidth:'Seat Width', seatDepth:'Seat Depth', backHeight:'Back Height',
  armHeight:'Arm Height', seatOption:'Seat Option', castor1:'Castor 1', castor2:'Castor 2'
};

function ocOnOpen() {
  const sel = document.getElementById('oc-week-select');
  if (sel.options.length > 0) return; // already populated
  const now = currentISOWeek();
  for (let wn = 1; wn <= 52; wn++) {
    const opt = document.createElement('option');
    opt.value = `WK ${wn}`;
    opt.textContent = `WK ${wn}`;
    if (wn === now) opt.selected = true;
    sel.appendChild(opt);
  }
}
```

- [ ] **Step 3: Verify in browser**

Navigate to Order Check. The week dropdown should be populated with WK 1–52, defaulting to the current ISO week. No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: Order Check constants, week dropdown, and onOpen hook"
```

---

## Task 4: `ocIngestJobs()` + `validateSpec()`

**Files:**
- Modify: `index.html` — bottom of script, inside the Order Check section

- [ ] **Step 1: Add `ocIngestJobs()`**

Append immediately after `ocOnOpen()`:

```js
function ocMakeKV() {
  const kv = { global: {}, byModel: {} };
  OC_SET_FIELDS.forEach(f => kv.global[f] = new Set());
  OC_NUM_FIELDS.forEach(f => kv.global[f] = { min: null, max: null });
  return kv;
}

function ocIngestJobs(jobs, kv) {
  for (const job of jobs) {
    const s = job.spec;
    if (!s) continue;
    const modelKey = s.model?.trim().toLowerCase();

    if (modelKey && !kv.byModel[modelKey]) {
      kv.byModel[modelKey] = {};
      OC_SET_FIELDS.forEach(f => kv.byModel[modelKey][f] = new Set());
      OC_NUM_FIELDS.forEach(f => kv.byModel[modelKey][f] = { min: null, max: null });
    }

    for (const f of OC_SET_FIELDS) {
      const val = s[f]?.trim().toLowerCase();
      if (!val) continue;
      kv.global[f].add(val);
      if (modelKey) kv.byModel[modelKey][f].add(val);
    }

    for (const f of OC_NUM_FIELDS) {
      const num = parseFloat(s[f]?.trim());
      if (!Number.isFinite(num)) continue;
      const g = kv.global[f];
      if (g.min === null || num < g.min) g.min = num;
      if (g.max === null || num > g.max) g.max = num;
      if (modelKey) {
        const m = kv.byModel[modelKey][f];
        if (m.min === null || num < m.min) m.min = num;
        if (m.max === null || num > m.max) m.max = num;
      }
    }
  }
}
```

- [ ] **Step 2: Add `validateSpec()`**

Append immediately after `ocIngestJobs()`:

```js
function validateSpec(spec, kv) {
  const blocks = [];
  const warnings = [];
  const modelKey = spec.model?.trim().toLowerCase();
  const modelLabel = spec.model?.trim();
  const byModel = modelKey && kv.byModel[modelKey] ? kv.byModel[modelKey] : null;

  for (const f of OC_SET_FIELDS) {
    const val = spec[f]?.trim();
    if (!val) continue;
    const valKey = val.toLowerCase();

    if (!kv.global[f].has(valKey)) {
      blocks.push({ field: f, value: val, reason: `"${val}" has never appeared in any historical order` });
    } else if (f !== 'model' && byModel && !byModel[f].has(valKey)) {
      warnings.push({ field: f, value: val, reason: `"${val}" has never been used with ${modelLabel}` });
    }
  }

  for (const f of OC_NUM_FIELDS) {
    const raw = spec[f]?.trim();
    if (!raw) continue;
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;

    const g = kv.global[f];
    if (g.min !== null && (num < g.min || num > g.max)) {
      blocks.push({ field: f, value: raw, reason: `${num} is outside the global range seen in history (${g.min}–${g.max})` });
    } else if (byModel) {
      const m = byModel[f];
      if (m.min !== null && (num < m.min || num > m.max)) {
        warnings.push({ field: f, value: raw, reason: `${num} is outside the normal range for ${modelLabel} (${m.min}–${m.max})` });
      }
    }
  }

  return { blocks, warnings };
}
```

- [ ] **Step 3: Quick console test**

Open browser console while on the Order Check view. Paste and run:
```js
const kv = ocMakeKV();
ocIngestJobs([{spec:{model:'Test Chair',fabric:'Velvet Blue',seatHeight:'45'}}], kv);
console.log([...kv.global.model]);          // ['test chair']
console.log([...kv.global.fabric]);         // ['velvet blue']
console.log(kv.global.seatHeight);          // {min:45,max:45}
console.log(validateSpec({model:'Test Chair',fabric:'Velvet Blue',seatHeight:'45'}, kv)); // {blocks:[],warnings:[]}
console.log(validateSpec({model:'Unknown Model'}, kv));  // blocks contains model flag
console.log(validateSpec({model:'Test Chair',fabric:'New Fabric'}, kv)); // blocks contains fabric flag
```
All three `console.log` results should match the comments.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: Order Check - ocIngestJobs and validateSpec logic"
```

---

## Task 5: `ocBuildHistory()` + `ocLoadHistLedger()`

**Files:**
- Modify: `index.html` — bottom of script, Order Check section

- [ ] **Step 1: Add `ocLoadHistLedger()`**

Append after `validateSpec()`:

```js
async function ocLoadHistLedger(kv) {
  const encoded = encodeSharingUrl(HIST_LEDGER_SHARING_URL);
  const driveItem = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
  const ledgerDriveId = driveItem.parentReference.driveId;
  const ledgerItemId  = driveItem.id;

  // Discover sheets and use the first one
  const sheetsRes = await graphGet(
    `https://graph.microsoft.com/v1.0/drives/${ledgerDriveId}/items/${ledgerItemId}/workbook/worksheets`
  );
  console.log('[OrderCheck] Ledger sheets:', sheetsRes.value.map(s => s.name));
  const sheetName = sheetsRes.value[0].name;

  const range = await graphGet(
    `https://graph.microsoft.com/v1.0/drives/${ledgerDriveId}/items/${ledgerItemId}` +
    `/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange`
  );

  const rows = range.values || [];
  if (!rows.length) return;

  // Map header names → spec field names
  const HEADER_MAP = {
    'model':                'model',
    'back design':          'backDesign',
    'cover code/ supplier': 'coverCode',
    'cover code/supplier':  'coverCode',
    'fabric description':   'fabric',
    'mechanism - 1':        'mechanism1',
    'mechanism - 2':        'mechanism2',
    'seat height':          'seatHeight',
    'seat width':           'seatWidth',
    'seat depth':           'seatDepth',
    'back height':          'backHeight',
    'arm height':           'armHeight',
    'seat option':          'seatOption',
    'castor - 1':           'castor1',
    'castor - 2':           'castor2',
  };

  // Find the header row (first row containing a cell equal to "model")
  let headerRowIdx = -1;
  const colMap = {}; // specField → column index
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const hasModel = rows[i].some(c => String(c || '').toLowerCase().trim() === 'model');
    if (hasModel) {
      headerRowIdx = i;
      rows[i].forEach((cell, idx) => {
        const key = String(cell || '').toLowerCase().trim();
        if (HEADER_MAP[key]) colMap[HEADER_MAP[key]] = idx;
      });
      break;
    }
  }
  if (headerRowIdx < 0) { console.warn('[OrderCheck] Ledger header row not found'); return; }

  const jobs = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const spec = {};
    Object.entries(colMap).forEach(([field, idx]) => {
      spec[field] = String(row[idx] ?? '').trim();
    });
    jobs.push({ spec });
  }

  console.log(`[OrderCheck] Ledger: ${jobs.length} historical orders loaded`);
  ocIngestJobs(jobs, kv);
}
```

- [ ] **Step 2: Add `ocBuildHistory()`**

Append after `ocLoadHistLedger()`:

```js
async function ocBuildHistory() {
  const btn    = document.getElementById('oc-build-btn');
  const status = document.getElementById('oc-hist-status');
  btn.disabled = true;
  status.className = 'oc-hist-status';
  status.textContent = '● Building…';

  const kv = ocMakeKV();

  // Ensure Production 2026 drive/item IDs are resolved
  if (!PROD_DRIVE_ID || !PROD_ITEM_ID) {
    status.textContent = '● Resolving file…';
    const driveItem = await graphGet(
      `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`
    );
    PROD_DRIVE_ID = driveItem.parentReference.driveId;
    PROD_ITEM_ID  = driveItem.id;
  }

  const base = `https://graph.microsoft.com/v1.0/drives/${PROD_DRIVE_ID}/items/${PROD_ITEM_ID}/workbook/worksheets`;

  // Load all 52 WK sheets
  for (let wn = 1; wn <= 52; wn++) {
    const sheetName = `WK ${wn}`;
    status.textContent = `● Loading ${sheetName}/52…`;
    try {
      const range = await graphGet(`${base}('${encodeURIComponent(sheetName)}')/usedRange`);
      const jobs  = parseSheetValues(range.values || []);
      ocIngestJobs(jobs, kv);
    } catch(e) {
      // Sheet not yet created — skip silently
    }
  }

  // Load historical ledger
  status.textContent = '● Loading historical ledger…';
  try {
    await ocLoadHistLedger(kv);
  } catch(e) {
    console.warn('[OrderCheck] Ledger load failed:', e.message);
  }

  ocKnownValues = kv;
  const modelCount = Object.keys(kv.byModel).length;
  status.className = 'oc-hist-status loaded';
  status.textContent = `✓ History loaded — ${modelCount} models known`;
  btn.disabled = false;
}
```

- [ ] **Step 3: Verify in browser**

Navigate to Order Check. Sign in. Click **Build History**. Observe:
- Status updates through each WK sheet ("Loading WK 3/52…")
- Console logs the ledger sheet name(s) — note the sheet name for Step 4
- Final status shows "✓ History loaded — N models known" with N > 0

In the console run:
```js
console.log(Object.keys(ocKnownValues.byModel).slice(0,5));
```
Should print a list of real model names from the production data.

- [ ] **Step 4: Update ledger sheet name if needed**

If the console logged a sheet name that isn't `Sheet1`, note it. It's logged automatically and the function already uses it dynamically — no constant change needed. The `console.log` in `ocLoadHistLedger` will always show the correct sheet name used.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Order Check - build history from WK sheets and historical ledger"
```

---

## Task 6: `ocRunCheck()` + `renderOcResults()`

**Files:**
- Modify: `index.html` — bottom of script, Order Check section

- [ ] **Step 1: Add `renderOcResults()`**

Append after `ocBuildHistory()`:

```js
function renderOcResults(results) {
  const resultsEl = document.getElementById('oc-results');
  const summaryEl = document.getElementById('oc-summary');

  if (!results.length) {
    resultsEl.innerHTML = '<div class="oc-empty">No jobs found in this week</div>';
    summaryEl.textContent = '';
    return;
  }

  let totalBlocks = 0;
  let totalWarnings = 0;

  const html = results.map(r => {
    const { blocks, warnings } = r.validation;
    totalBlocks   += blocks.length;
    totalWarnings += warnings.length;

    let stateClass, icon, label;
    if (blocks.length) {
      stateClass = 'oc-block';
      icon  = '✖';
      label = `${blocks.length} issue${blocks.length > 1 ? 's' : ''}`;
    } else if (warnings.length) {
      stateClass = 'oc-warn';
      icon  = '⚠';
      label = `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`;
    } else {
      stateClass = 'oc-ok';
      icon  = '✓';
      label = 'All OK';
    }

    const hasFlags = blocks.length + warnings.length > 0;

    const flagRows = [
      ...blocks.map(f => `
        <div class="oc-flag oc-flag-block">
          <span class="oc-flag-field">${OC_FIELD_LABELS[f.field] || f.field}:</span>
          <span class="oc-flag-val">"${f.value}"</span>
          <span class="oc-flag-reason">— ${f.reason}</span>
        </div>`),
      ...warnings.map(f => `
        <div class="oc-flag oc-flag-warn">
          <span class="oc-flag-field">${OC_FIELD_LABELS[f.field] || f.field}:</span>
          <span class="oc-flag-val">"${f.value}"</span>
          <span class="oc-flag-reason">— ${f.reason}</span>
        </div>`),
    ].join('');

    return `
      <div class="oc-card ${stateClass}" onclick="this.classList.toggle('open')">
        <div class="oc-card-header">
          <span class="oc-rep">${r.rep}</span>
          <span class="oc-job">Job ${r.itemNo}</span>
          <span class="oc-status-badge ${stateClass}">${icon} ${label}</span>
          ${hasFlags ? '<span class="oc-chevron">▾</span>' : ''}
        </div>
        ${hasFlags ? `<div class="oc-card-body">${flagRows}</div>` : ''}
      </div>`;
  }).join('');

  resultsEl.innerHTML = html;

  const bWord = totalBlocks   === 1 ? 'issue'   : 'issues';
  const wWord = totalWarnings === 1 ? 'warning' : 'warnings';
  summaryEl.textContent = `${results.length} orders checked · ${totalBlocks} ${bWord} · ${totalWarnings} ${wWord}`;
}
```

- [ ] **Step 2: Add `ocRunCheck()`**

Append after `renderOcResults()`:

```js
async function ocRunCheck() {
  if (!ocKnownValues) {
    alert('Please click "Build History" first before running a check.');
    return;
  }

  const weekName  = document.getElementById('oc-week-select').value;
  const resultsEl = document.getElementById('oc-results');
  const summaryEl = document.getElementById('oc-summary');

  resultsEl.innerHTML = `<div class="oc-loading">Loading ${weekName}…</div>`;
  summaryEl.textContent = '';

  try {
    if (!PROD_DRIVE_ID || !PROD_ITEM_ID) {
      const driveItem = await graphGet(
        `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`
      );
      PROD_DRIVE_ID = driveItem.parentReference.driveId;
      PROD_ITEM_ID  = driveItem.id;
    }

    const range = await graphGet(
      `https://graph.microsoft.com/v1.0/drives/${PROD_DRIVE_ID}/items/${PROD_ITEM_ID}` +
      `/workbook/worksheets('${encodeURIComponent(weekName)}')/usedRange`
    );

    const jobs    = parseSheetValues(range.values || []);
    const results = jobs.map(job => ({ ...job, validation: validateSpec(job.spec, ocKnownValues) }));
    renderOcResults(results);
  } catch(e) {
    resultsEl.innerHTML = `<div class="oc-error">Failed to load ${weekName}: ${e.message}</div>`;
    summaryEl.textContent = '';
  }
}
```

- [ ] **Step 3: Verify in browser — end-to-end test**

1. Navigate to Order Check
2. Click **Build History** — wait for "✓ History loaded — N models known"
3. Select the current week from the dropdown
4. Click **Load & Check**
5. Verify:
   - Each order appears as a card
   - Cards with no issues show green "✓ All OK"
   - Cards with warnings show amber "⚠ N warnings", expanding reveals field-level messages
   - Cards with blocks show red "✖ N issues", expanding reveals field-level messages
   - Summary bar at bottom shows correct counts
   - Clicking a card toggles it open/closed

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: Order Check - run check, validate orders, render results"
```

---

## Task 7: CSS fix — card body display

**Files:**
- Modify: `index.html` — CSS section

**Note:** The `.oc-card-body` rule sets `display:none` and `display:flex` in the same declaration. Browsers apply the last one, so the body is always visible. This task fixes that.

- [ ] **Step 1: Fix the card body CSS**

Find in the CSS (added in Task 2):
```css
.oc-card-body   { display:none; padding:8px 12px 12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:6px; }
.oc-card.open .oc-card-body { display:flex; }
```
Replace with:
```css
.oc-card-body   { display:none; padding:8px 12px 12px; border-top:1px solid var(--border); flex-direction:column; gap:6px; }
.oc-card.open .oc-card-body { display:flex; }
```

- [ ] **Step 2: Verify in browser**

Run a check on any week. Cards with flags should be collapsed by default. Clicking expands them to show the flag rows. Clicking again collapses.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: Order Check card body hidden by default, expands on click"
```
