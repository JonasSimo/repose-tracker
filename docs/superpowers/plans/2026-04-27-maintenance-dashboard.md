# Maintenance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing Woodmill and Cutting Checks tabs with a single unified **Maintenance** tab covering daily pre-use checks across all production teams plus a yearly/statutory inspection register, all written into the existing single-file `index.html`.

**Architecture:** All new code is appended into `index.html` (no new files). New CSS at the end of the existing `<style>` block. New HTML is one `<div id="view-maintenance" class="view">` added near other views. New JS appended to the existing `<script>` block. The Maintenance code is organised around an `MT_TEAMS` registry and a thin `mtAdapter` layer that reads each team's per-team SharePoint List into one normalised record shape. Two sub-tabs (Daily Pre-use / Yearly) lazily render. Existing per-team SharePoint Lists (`WMInspections`, `CCInspections`, `WMDowntime`) are read as-is — zero data migration. Cutting team-view "Daily Pre-use Check" button stays unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS · Microsoft Graph API · MSAL.js v3 (already in app) · SharePoint Lists · No new libraries.

**Spec:** `docs/superpowers/specs/2026-04-27-maintenance-dashboard-design.md`

**Visual reference:** `maintenance-dashboard-mockup.html` (Direction A — Operations Hub)

**Verification convention for this codebase:** there is no test runner. Each task verifies via (a) browser console assertions where pure-function logic exists, and (b) visual smoke test in the running app (Azure Static Web App preview or local `python -m http.server` against the project root). The plan calls these out per task.

---

## File map

| File | Change |
|---|---|
| `index.html` (CSS, end of `<style>` block, after the existing `Pre-use checks dashboard` rules ~line 2240) | Append all `mt-*` CSS for Maintenance |
| `index.html` (nav buttons, ~line 2416) | Add Maintenance nav button; remove Woodmill + Cutting Checks nav buttons (Task 14) |
| `index.html` (HTML, after `view-cutting-checks` div, ~line 12970) | Add `<div id="view-maintenance" class="view">` shell + sub-tab containers |
| `index.html` (JS `NAV_LABELS` ~line 3404) | Add `'maintenance':'Maintenance'`; remove `'woodmill'` and `'cutting-checks'` (Task 14) |
| `index.html` (JS `navTo` switch ~line 3428) | Add `if (name === 'maintenance') { mtOnOpen(); }`; remove woodmill / cutting-checks branches (Task 14) |
| `index.html` (JS `_VALID_TABS` ~line 6194 and `_validViews` sets ~lines 6194 + 6686) | Add `'maintenance'`; remove `'woodmill'` and `'cutting-checks'` (Task 14) |
| `index.html` (JS, after `wmIsManager` assignment ~line 6718) | Add `mtIsManager = TIMING_ALLOWED.has(...)` mirror |
| `index.html` (JS, end of `<script>` block) | Append all `MT_*` constants, `mtState`, `mtAdapter*`, `mt*` render/export functions |
| `index.html` (HTML `view-woodmill` div ~line 2894) | Delete entirely (Task 14) |
| `index.html` (HTML `view-cutting-checks` div ~line 12802) | Delete the dashboard portion only — keep the **submit modal** that is opened by `ccOpenSubmitModal()` from the Cutting team-view button (Task 14) |
| `index.html` (JS `wmRender*` ~line 14326+ and `ccRenderDashboard`/`ccRenderWeek`/`ccRenderMonth` ~line 14743+) | Delete the dashboard render code (Task 14). Keep `ccOpenSubmitModal`, `ccLoadData`, `ccGetSiteId`, `ccGetListId`, and the submit/save flow — they're still called by the Cutting team button |

**Manual SharePoint setup** (Task 0, performed by Jonas before Task 1): create four lists.

---

## Task 0: SharePoint Lists setup (manual — Jonas)

This is a manual step performed by the QHSE Manager before any code is written. Tasks 4 onward depend on these existing.

**On the SharePoint site `https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-PlanningRepose`** (same site as `WMInspections` — confirm by checking that list is there):

- [ ] **Step 1: Create list `DEVInspections`**

Columns (all single line of text unless noted):
- `Title` (default — used for `MachineId` fallback)
- `MachineId` (single line of text)
- `InspectedAt` (Date and time)
- `InspectorName` (single line of text)
- `Status` (Choice — values: `pass`, `fail`, `na`)
- `ItemsJson` (Multiple lines of text — stores per-check breakdown as JSON)
- `Comment` (Multiple lines of text)

Match the column names of the existing `WMInspections` list as closely as possible (open `WMInspections` settings to compare). Permissions: same as `WMInspections` (everyone in the tenant can Contribute, since QR-code submissions write here).

- [ ] **Step 2: Create list `DEVDowntime`**

Columns:
- `Title` (default — stores `"machineId|YYYY-MM-DD"` per the existing `WMDowntime` pattern)

Permissions: only QHSE Managers AAD group has Contribute; everyone has Read. (Match `WMDowntime` permissions.)

- [ ] **Step 3: Create list `MaintenanceYearly`**

Columns:
- `Title` (default — the inspection item name, e.g., "Forklift LOLER")
- `Category` (Choice — values: `Statutory`, `Annual Servicing`, `Legal Surveys`, `Insurance`, `Other`)
- `Frequency` (Choice — values: `Annual`, `6-monthly`, `Quarterly`, `Monthly`, `Custom`)
- `FrequencyDays` (Number — only used when `Frequency = Custom`)
- `LastDone` (Date only)
- `DocLink` (Single line of text — SharePoint URL of latest cert)
- `Notes` (Multiple lines of text)

Permissions: only QHSE Managers AAD group has Contribute; everyone has Read.

- [ ] **Step 4: Create list `MaintenanceYearlyHistory`**

Columns:
- `Title` (default — for grep-ability, format `"{ItemTitle} {YYYY-MM-DD}"`)
- `ItemId` (Number — FK to `MaintenanceYearly.Id`)
- `CompletedOn` (Date and time)
- `DocLink` (Single line of text — SharePoint URL)
- `Contractor` (Single line of text)
- `Cost` (Number, optional)
- `Notes` (Multiple lines of text)
- `CompletedBy` (Single line of text — display name)

Permissions: only QHSE Managers AAD group has Contribute; everyone has Read.

- [ ] **Step 5: Add a single test row to `MaintenanceYearly`** for use during dev — Title `"Forklift LOLER (test)"`, Category `Statutory`, Frequency `Annual`, LastDone today's date, Notes `"Test row — delete after dev"`.

- [ ] **Step 6: Tell Claude when ready** — paste the new lists' GUIDs (visible in list settings URL) here:
  - `DEVInspections`: `<paste-guid>`
  - `DEVDowntime`: `<paste-guid>`
  - `MaintenanceYearly`: `<paste-guid>`
  - `MaintenanceYearlyHistory`: `<paste-guid>`

(GUIDs aren't strictly required — `getListIdByNameOnSite()` resolves by name and caches — but having them is useful for debugging.)

---

## Task 1: CSS — Maintenance dashboard styles

**Files:**
- Modify: `index.html` — append at end of existing `<style>` block, after the existing `Pre-use checks dashboard` rules (~line 2240, before the `Submit modal footer` block)

- [ ] **Step 1: Append the Maintenance CSS block**

Find the line `/* Submit modal footer */` (~line 2242) and insert the following block immediately **before** it:

```css
/* ─── MAINTENANCE DASHBOARD (Direction A — Operations Hub) ─── */
.mt-body              { padding: 16px 20px 32px; background: linear-gradient(180deg, var(--bg3) 0%, var(--bg2) 220px); min-height: 100%; }

/* sub-tab pill toggle */
.mt-subtabs           { display: inline-flex; gap: 4px; background: #eef2f6; padding: 4px; border-radius: 10px; margin-bottom: 18px; }
.mt-subtab            { padding: 8px 16px; font-size: 13px; font-weight: 600; color: var(--text2); border-radius: 7px; cursor: pointer; border: none; background: transparent; font-family: inherit; }
.mt-subtab.on         { background: #fff; color: var(--repose-navy); box-shadow: 0 1px 3px rgba(14,2,58,.08); }

/* hero */
.mt-hero              { background: linear-gradient(135deg, var(--repose-navy) 0%, #1a1656 100%); color: #fff; border-radius: 14px; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
.mt-hero-l            { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mt-hero-eyebrow      { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .7; }
.mt-hero-num          { font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
.mt-hero-num span     { color: var(--repose-blue); margin: 0 2px; }
.mt-hero-sub          { font-size: 12px; opacity: .8; }
.mt-hero-r            { display: flex; gap: 16px; }
.mt-stat              { text-align: right; }
.mt-stat-num          { font-size: 18px; font-weight: 700; line-height: 1; }
.mt-stat-num.pass     { color: #4ade80; }
.mt-stat-num.fail     { color: #fca5a5; }
.mt-stat-num.warn     { color: #fbbf24; }
.mt-stat-lab          { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; opacity: .7; margin-top: 2px; }

/* team tile grid */
.mt-grid              { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.mt-tile              { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; transition: all .15s; cursor: pointer; }
.mt-tile:hover        { border-color: var(--repose-blue); box-shadow: 0 6px 20px rgba(20,161,233,.12); transform: translateY(-1px); }
.mt-icon              { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; background: #f0f4f8; flex-shrink: 0; }
.mt-tile.pass .mt-icon{ background: #dcfce7; }
.mt-tile.fail .mt-icon{ background: #fee2e2; }
.mt-tile.warn .mt-icon{ background: #fed7aa; }
.mt-mid               { flex: 1; min-width: 0; }
.mt-team              { font-size: 14px; font-weight: 700; color: var(--repose-navy); margin-bottom: 4px; }
.mt-progress          { height: 6px; background: #eef2f6; border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
.mt-bar               { height: 100%; background: #16a34a; border-radius: 3px; }
.mt-tile.fail .mt-bar { background: #dc2626; }
.mt-tile.warn .mt-bar { background: #d97706; }
.mt-meta              { font-size: 11px; color: var(--text2); display: flex; gap: 8px; }
.mt-meta b            { color: var(--text); }
.mt-pill              { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.mt-pill.pass         { background: #dcfce7; color: #16a34a; }
.mt-pill.fail         { background: #fee2e2; color: #dc2626; }
.mt-pill.warn         { background: #fed7aa; color: #d97706; }

/* drill-in */
.mt-drill-head        { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.mt-back              { background: transparent; border: 1.5px solid var(--border2); color: var(--text2); padding: 6px 12px; font-size: 13px; border-radius: 8px; cursor: pointer; font-family: inherit; }
.mt-back:hover        { border-color: var(--repose-blue); color: var(--repose-blue); }
.mt-drill-title       { font-size: 18px; font-weight: 700; color: var(--repose-navy); flex: 1; }
.mt-actions           { display: flex; gap: 8px; }
.mt-btn               { font-family: inherit; font-size: 12px; font-weight: 700; padding: 8px 14px; border-radius: 8px; border: 1.5px solid var(--repose-blue); background: #fff; color: var(--repose-blue); cursor: pointer; }
.mt-btn:hover         { background: var(--repose-blue); color: #fff; }

.mt-filters           { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; padding: 12px 14px; background: #fff; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px; }
.mt-filter            { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }
.mt-filter label      { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text3); }
.mt-filter select,
.mt-filter input      { font-family: inherit; font-size: 13px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border2); background: #fff; color: var(--text); }
.mt-filter-actions    { display: flex; gap: 6px; margin-left: auto; }

.mt-stats-strip       { display: flex; gap: 18px; padding: 12px 14px; background: #fff; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px; }
.mt-strip-stat        { display: flex; flex-direction: column; gap: 2px; }
.mt-strip-num         { font-size: 18px; font-weight: 700; color: var(--repose-navy); line-height: 1; }
.mt-strip-num.pass    { color: #16a34a; }
.mt-strip-num.fail    { color: #dc2626; }
.mt-strip-num.warn    { color: #d97706; }
.mt-strip-lab         { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text3); }

.mt-matrix-wrap       { background: #fff; border: 1px solid var(--border); border-radius: 12px; overflow: auto; max-height: 70vh; }
.mt-matrix            { border-collapse: separate; border-spacing: 0; font-size: 12px; }
.mt-matrix th,
.mt-matrix td         { padding: 8px 10px; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); text-align: center; min-width: 56px; }
.mt-matrix thead th   { position: sticky; top: 0; background: var(--bg3); z-index: 1; font-size: 11px; font-weight: 700; color: var(--text2); }
.mt-matrix tbody th   { position: sticky; left: 0; background: #fff; z-index: 0; text-align: left; font-weight: 600; color: var(--repose-navy); white-space: nowrap; min-width: 160px; }
.mt-cell              { cursor: pointer; }
.mt-cell.pass         { background: #dcfce7; color: #16a34a; }
.mt-cell.fail         { background: #fee2e2; color: #dc2626; font-weight: 700; }
.mt-cell.dt           { background: #f3f4f6; color: var(--text3); }
.mt-cell.miss         { background: #fff; color: var(--text3); }
.mt-cell:hover        { outline: 2px solid var(--repose-blue); outline-offset: -2px; }

/* yearly */
.mt-cal-strip         { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; padding: 14px; background: #fff; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px; }
.mt-cal-month         { display: flex; flex-direction: column; gap: 4px; padding: 8px 4px; border-radius: 6px; min-height: 80px; background: var(--bg3); }
.mt-cal-mlabel        { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text3); text-align: center; }
.mt-cal-marker        { font-size: 10px; padding: 2px 4px; border-radius: 3px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mt-cal-marker.overdue{ background: #fee2e2; color: #dc2626; }
.mt-cal-marker.due    { background: #fed7aa; color: #d97706; }
.mt-cal-marker.ok     { background: #dcfce7; color: #16a34a; }

.mt-chips             { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.mt-chip              { padding: 6px 12px; border-radius: 999px; border: 1.5px solid var(--border2); background: #fff; font-size: 12px; font-weight: 600; color: var(--text2); cursor: pointer; font-family: inherit; }
.mt-chip.on           { border-color: var(--repose-blue); background: var(--repose-blue); color: #fff; }

.mt-table             { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); font-size: 13px; }
.mt-table th,
.mt-table td          { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
.mt-table th          { background: var(--bg3); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text2); }
.mt-table tr:last-child td { border-bottom: 0; }
.mt-row-actions       { display: flex; gap: 4px; }
.mt-icon-btn          { background: transparent; border: none; cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 14px; }
.mt-icon-btn:hover    { background: var(--bg3); }

.mt-history-row       { background: var(--bg3); }
.mt-history-list      { padding: 8px 12px; }
.mt-history-item      { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
.mt-history-item:last-child { border-bottom: 0; }

/* manager edit drawer */
.mt-drawer-bg         { position: fixed; inset: 0; background: rgba(14,2,58,.45); z-index: 100; display: none; }
.mt-drawer-bg.on      { display: block; }
.mt-drawer            { position: fixed; top: 0; right: 0; width: min(480px, 92vw); height: 100%; background: #fff; box-shadow: -8px 0 30px rgba(14,2,58,.2); z-index: 101; transform: translateX(100%); transition: transform .25s; display: flex; flex-direction: column; }
.mt-drawer.on         { transform: translateX(0); }
.mt-drawer-head       { padding: 14px 18px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.mt-drawer-title      { font-size: 16px; font-weight: 700; color: var(--repose-navy); }
.mt-drawer-body       { flex: 1; overflow: auto; padding: 16px 18px; }
.mt-drawer-foot       { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
.mt-form-group        { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.mt-form-group label  { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text3); }
.mt-form-group input,
.mt-form-group select,
.mt-form-group textarea { font-family: inherit; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border2); background: #fff; color: var(--text); }

.mt-empty             { text-align: center; padding: 48px 16px; color: var(--text2); font-size: 13px; }
.mt-loading           { text-align: center; padding: 32px; color: var(--text2); font-size: 13px; }

/* print overrides for audit PDF — handled in Task 11 */
```

- [ ] **Step 2: Visual smoke check**

Open `index.html` in your browser. Confirm the page still renders (CSS doesn't break anything) and DevTools shows zero CSS parse errors. The new selectors are unused at this point — that's expected.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): add CSS for Direction A dashboard"
```

---

## Task 2: View shell HTML — `view-maintenance` div

**Files:**
- Modify: `index.html` — insert after the closing `</div>` of `view-cutting-checks` (~line 12970, find by searching for `id="view-cutting-checks"` and counting through to the matching `</div>`)

- [ ] **Step 1: Insert the maintenance view shell**

Locate the closing `</div>` of `<div class="view" id="view-cutting-checks">`. Immediately after that closing `</div>`, insert:

```html
<!-- ════════════════════════════════════════════════════
     VIEW: MAINTENANCE
════════════════════════════════════════════════════ -->
<div class="view" id="view-maintenance">
  <div class="mt-body">
    <!-- sub-tab toggle -->
    <div class="mt-subtabs" id="mt-subtabs">
      <button class="mt-subtab on" data-sub="daily" onclick="mtSwitchSub('daily')">Daily Pre-use</button>
      <button class="mt-subtab" data-sub="yearly" onclick="mtSwitchSub('yearly')">Yearly / Statutory</button>
    </div>
    <!-- where rendered content goes -->
    <div id="mt-content"><div class="mt-loading">Loading…</div></div>
  </div>
</div>

<!-- Maintenance: cell modal (filled by mt code) -->
<div id="mt-cell-modal" class="modal-bg" style="display:none" onclick="if(event.target===this)mtCloseCellModal()">
  <div class="modal" style="max-width:520px"><div id="mt-cell-modal-body"></div></div>
</div>

<!-- Maintenance: yearly mark-complete modal -->
<div id="mt-complete-modal" class="modal-bg" style="display:none" onclick="if(event.target===this)mtCloseCompleteModal()">
  <div class="modal" style="max-width:520px"><div id="mt-complete-modal-body"></div></div>
</div>

<!-- Maintenance: yearly manager edit drawer -->
<div id="mt-drawer-bg" class="mt-drawer-bg" onclick="mtCloseDrawer()"></div>
<aside id="mt-drawer" class="mt-drawer">
  <div class="mt-drawer-head">
    <div class="mt-drawer-title" id="mt-drawer-title">Manage yearly items</div>
    <button class="mt-icon-btn" onclick="mtCloseDrawer()" aria-label="Close">✕</button>
  </div>
  <div class="mt-drawer-body" id="mt-drawer-body"></div>
  <div class="mt-drawer-foot" id="mt-drawer-foot"></div>
</aside>
```

- [ ] **Step 2: Visual smoke check**

Reload `index.html` in browser. The page renders normally. Devtools Elements shows the new `view-maintenance` div present in DOM but `display:none` (the `.view` class hides it until `nav` activates it). Modal/drawer divs exist but are hidden.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): add view-maintenance shell + modal containers"
```

---

## Task 3: Constants, registry, and state

**Files:**
- Modify: `index.html` — append at end of `<script>` block (after the existing `ccRender` etc., near line 15110+ or wherever the script currently ends — search for `// CUTTING CHECKS` to find the cutting block and insert after the last `}` before `</script>`)

- [ ] **Step 1: Append the Maintenance constants and state**

```js
// ═══════════════════════════════════════════════════
// MAINTENANCE DASHBOARD
// ═══════════════════════════════════════════════════

const MT_SITE_PATH      = '/sites/ReposeFurniture-PlanningRepose';   // same site as WMInspections
const MT_YEARLY_LIST    = 'MaintenanceYearly';
const MT_YEARLY_HISTORY = 'MaintenanceYearlyHistory';

// Per-team registry — single source of truth for what teams the dashboard knows about.
// To add a new team: define MACHINES constant + create SP list + add entry below.
const MT_TEAMS = [
  { id:'woodmill',    name:'Woodmill',    icon:'🪵', listName:'WMInspections',  downtimeList:'WMDowntime',  machines: WM_MACHINES },
  { id:'cutting',     name:'Cutting',     icon:'✂️', listName:'CCInspections',  downtimeList: null,         machines: CC_MACHINES },
  // Development added in Task 12 once DEV_MACHINES is defined
];

// State (single object, easy to inspect from devtools)
let mtState = {
  subTab:        'daily',                // 'daily' | 'yearly'
  page:          'landing',              // 'landing' | 'drill'
  drillTeamId:   null,                   // when on drill-in
  filters:       { teamIds: [], machineIds: [], dateFrom: null, dateTo: null },
  records:       [],                     // normalised daily records in current range
  yearlyItems:   [],
  yearlyHistory: [],
  loaded:        { daily: false, yearly: false },
  isManager:     false,
};
let mtIsManager = false;                 // mirror; set in the auth callback (Task 4)

// Convenience lookup
function mtGetTeam(teamId)    { return MT_TEAMS.find(t => t.id === teamId) || null; }
function mtGetMachine(teamId, machineId) {
  const t = mtGetTeam(teamId);
  return t ? (t.machines.find(m => m.id === machineId) || null) : null;
}
```

- [ ] **Step 2: Verify in console**

Reload `index.html`. In DevTools console:

```js
console.assert(MT_TEAMS.length === 2, 'two teams initially');
console.assert(mtGetTeam('woodmill').machines.length === WM_MACHINES.length, 'wm machine count');
console.assert(mtGetTeam('cutting').machines.length === CC_MACHINES.length, 'cc machine count');
console.assert(mtGetMachine('woodmill','bandsaw').name === 'Bandsaw', 'wm lookup');
console.assert(mtGetMachine('cutting','lectra').name === 'Lectra Vector', 'cc lookup');
console.log('Task 3 OK');
```

Expected: `Task 3 OK` and no assertion errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): add MT_TEAMS registry + mtState"
```

---

## Task 4: Manager flag wiring

**Files:**
- Modify: `index.html` — line ~6718 where `wmIsManager` is set

- [ ] **Step 1: Add `mtIsManager` mirror immediately after the existing `wmIsManager` line**

Find:

```js
wmIsManager = TIMING_ALLOWED.has(graphAccount.username.toLowerCase());
```

Insert directly after it:

```js
mtIsManager = wmIsManager; // QHSE Managers gate — same set as Stats / Woodmill manager actions
mtState.isManager = mtIsManager;
```

- [ ] **Step 2: Verify in console**

Reload `index.html`, sign in. In DevTools console:

```js
console.log('mtIsManager =', mtIsManager, 'mtState.isManager =', mtState.isManager);
```

Expected: both `true` for Jonas's account, both `false` if signed in as a non-manager.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): wire mtIsManager to TIMING_ALLOWED"
```

---

## Task 5: Adapter — date helpers and UTC range

**Files:**
- Modify: `index.html` — append after the constants from Task 3

- [ ] **Step 1: Append date helper functions**

```js
// ── Maintenance — date helpers ─────────────────────────────────────────────
// Reuse existing wmDateStr() (defined in woodmill section) for local YYYY-MM-DD.
// Add UK-pinned time-of-day formatter and a UK day → UTC range converter.
function mtFormatTimeUK(dateLike) {
  if (!dateLike) return '';
  return new Date(dateLike).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit'
  });
}
function mtFormatDateUK(dateLike) {
  if (!dateLike) return '';
  return new Date(dateLike).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric'
  });
}
// Convert a YYYY-MM-DD string (representing a UK calendar day) to a UTC ISO range.
// Returns { fromIso, toIso } where fromIso is 00:00 UK and toIso is 23:59:59.999 UK,
// each rendered in UTC for Graph $filter ge/le clauses.
function mtUkDayToUtcRange(ukDayStr) {
  // Build a "midnight UK" Date by checking what offset Europe/London has on that date.
  // We use the trick of creating an Intl-formatted timestamp and converting back.
  const [y, m, d] = ukDayStr.split('-').map(Number);
  const probe     = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));     // noon UTC on the same calendar day
  const tzOffsetMin = mtTzOffsetMinutes(probe, 'Europe/London');   // +60 in BST, 0 in GMT
  const fromUtcMs   = Date.UTC(y, m - 1, d, 0, 0, 0)   - tzOffsetMin * 60 * 1000;
  const toUtcMs     = Date.UTC(y, m - 1, d, 23, 59, 59, 999) - tzOffsetMin * 60 * 1000;
  return { fromIso: new Date(fromUtcMs).toISOString(), toIso: new Date(toUtcMs).toISOString() };
}
function mtTzOffsetMinutes(date, tz) {
  // Returns the offset in minutes that `tz` is ahead of UTC at `date` (positive in BST = +60).
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour12: false, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const asUtcMs = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtcMs - date.getTime()) / 60000);
}
function mtTodayUkStr() {
  // Current UK date as YYYY-MM-DD
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function mtAddDays(ukDayStr, n) {
  const [y, m, d] = ukDayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function mtEnumerateDays(fromUkStr, toUkStr) {
  const out = []; let cur = fromUkStr;
  while (cur <= toUkStr) { out.push(cur); cur = mtAddDays(cur, 1); }
  return out;
}
```

- [ ] **Step 2: Verify in console**

```js
// BST window — Aug 15 2026 (BST = UTC+1)
let r = mtUkDayToUtcRange('2026-08-15');
console.assert(r.fromIso === '2026-08-14T23:00:00.000Z', 'BST from'); // 00:00 BST = 23:00 UTC prev day
console.assert(r.toIso.startsWith('2026-08-15T22:59:59'), 'BST to');

// GMT window — Jan 15 2026 (GMT = UTC)
r = mtUkDayToUtcRange('2026-01-15');
console.assert(r.fromIso === '2026-01-15T00:00:00.000Z', 'GMT from');
console.assert(r.toIso.startsWith('2026-01-15T23:59:59'), 'GMT to');

// BST/GMT switchover — Sun 25 Oct 2026 02:00 BST → 01:00 GMT (clocks go back)
console.assert(mtTzOffsetMinutes(new Date('2026-10-25T00:00:00Z'), 'Europe/London') === 60, '01:00 UTC still BST');
console.assert(mtTzOffsetMinutes(new Date('2026-10-25T02:00:00Z'), 'Europe/London') === 0,  '02:00 UTC now GMT');

// Day enumerator
console.assert(mtEnumerateDays('2026-04-27','2026-04-29').join() === '2026-04-27,2026-04-28,2026-04-29', 'enumerate');
console.log('Task 5 OK');
```

Expected: `Task 5 OK`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): UK date helpers + UTC range converter"
```

---

## Task 6: Adapter — read functions

**Files:**
- Modify: `index.html` — append after Task 5 helpers

- [ ] **Step 1: Append the adapter read functions**

```js
// ── Maintenance — adapter (reads) ─────────────────────────────────────────
async function mtAdapterGetSiteId() {
  if (_idCache.mtSiteId) return _idCache.mtSiteId;
  const res = await graphGet(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${MT_SITE_PATH}`);
  _idCache.mtSiteId = res.id; _saveIdCache();
  return _idCache.mtSiteId;
}

// Normalise one SharePoint item from any team's inspections list into the unified shape.
function mtNormaliseInspection(team, fields) {
  const machineId = (fields.MachineId || fields.machineId || fields.Title || '').trim();
  const machine   = team.machines.find(m => m.id === machineId);
  const dateStr   = fields.InspectedAt ? wmDateStr(new Date(fields.InspectedAt)) : '';
  const status    = (fields.Status || '').toLowerCase();   // 'pass' | 'fail' | 'na'
  let items       = [];
  try { if (fields.ItemsJson) items = JSON.parse(fields.ItemsJson); } catch {}
  return {
    teamId:      team.id,
    machineId,
    machineName: machine ? machine.name : machineId,
    dateStr,
    inspectedAt: fields.InspectedAt || null,
    status:      ['pass','fail','na'].includes(status) ? status : 'none',
    operator:    fields.InspectorName || '',
    items,
    comment:     fields.Comment || '',
    raw:         fields,
  };
}

// Load all check records across the given teams in [dateFromUk, dateToUk] (inclusive UK days).
async function mtAdapterLoadRange(teamIds, dateFromUk, dateToUk) {
  const fromRange = mtUkDayToUtcRange(dateFromUk);
  const toRange   = mtUkDayToUtcRange(dateToUk);
  const fromIso   = fromRange.fromIso;
  const toIso     = toRange.toIso;
  const siteId    = await mtAdapterGetSiteId();
  const teams     = teamIds.length ? MT_TEAMS.filter(t => teamIds.includes(t.id)) : MT_TEAMS;
  const out       = [];
  await Promise.all(teams.map(async team => {
    try {
      const listId = await getListIdByNameOnSite(siteId, team.listName);
      const filter = encodeURIComponent(`fields/InspectedAt ge '${fromIso}' and fields/InspectedAt le '${toIso}'`);
      const url    = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$filter=${filter}`;
      const items  = await graphGetAll(url);
      for (const it of items) out.push(mtNormaliseInspection(team, it.fields || {}));
    } catch (e) {
      console.warn('[mtAdapter] team', team.id, e.message);
    }
  }));
  // Sort newest first
  out.sort((a, b) => (b.inspectedAt || '').localeCompare(a.inspectedAt || ''));
  return out;
}

// Load downtime markings for one team, keyed `${machineId}|${dateStr}` → spItemId.
async function mtAdapterLoadDowntime(team) {
  if (!team.downtimeList) return {};
  const siteId = await mtAdapterGetSiteId();
  try {
    const listId = await getListIdByNameOnSite(siteId, team.downtimeList);
    const items  = await graphGetAll(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`
    );
    const out = {};
    for (const it of items) {
      const t = (it.fields?.Title || '').trim();
      if (t.includes('|')) out[t] = it.id;
    }
    return out;
  } catch (e) {
    console.warn('[mtAdapter] downtime', team.id, e.message);
    return {};
  }
}

// Yearly
async function mtAdapterLoadYearly() {
  const siteId = await mtAdapterGetSiteId();
  const [items, history] = await Promise.all([
    (async () => {
      try {
        const id = await getListIdByNameOnSite(siteId, MT_YEARLY_LIST);
        return await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${id}/items?$expand=fields&$top=999`);
      } catch { return []; }
    })(),
    (async () => {
      try {
        const id = await getListIdByNameOnSite(siteId, MT_YEARLY_HISTORY);
        return await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${id}/items?$expand=fields&$top=999`);
      } catch { return []; }
    })(),
  ]);
  return {
    items: items.map(it => ({ id: it.id, ...(it.fields || {}) })),
    history: history.map(it => ({ id: it.id, ...(it.fields || {}) })),
  };
}
```

- [ ] **Step 2: Verify against live SharePoint**

Sign in to the app. In DevTools console:

```js
const recs = await mtAdapterLoadRange([], '2026-04-20', '2026-04-27');
console.log('records found:', recs.length);
console.log('sample:', recs[0]);
console.assert(recs.every(r => r.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(r.dateStr)), 'all dateStr valid');
const yr = await mtAdapterLoadYearly();
console.log('yearly items:', yr.items.length, 'history:', yr.history.length);
```

Expected: prints a non-zero record count (Woodmill/Cutting have data); `sample` shows the normalised shape with `teamId`, `machineId`, `dateStr`, `status`. Yearly should print the test row added in Task 0.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): adapter read functions (range + yearly)"
```

---

## Task 7: Routing — register Maintenance tab in nav

**Files:**
- Modify: `index.html` lines around 2416 (nav buttons), 3404 (`NAV_LABELS`), 3428 (`navTo`), 6194 (`_VALID_TABS`), 6194 + 6686 (`_validViews`)

Note: this task **adds** the Maintenance tab without yet removing Woodmill/Cutting Checks tabs (they coexist for now; removal is Task 14 once the new view is verified).

- [ ] **Step 1: Add nav button**

Find the line with `cc-tab-btn` in the nav (~line 2416):

```html
<button class="nav-item" data-view="cutting-checks" id="cc-tab-btn" onclick="navTo('cutting-checks')" style="display:none">Cutting Checks</button>
```

Insert directly after it:

```html
<button class="nav-item" data-view="maintenance" id="mt-tab-btn" onclick="navTo('maintenance')">Maintenance</button>
```

- [ ] **Step 2: Add to `NAV_LABELS`**

Find (~line 3404):

```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View',...,'cutting-checks':'Cutting Checks' };
```

Add `'maintenance':'Maintenance'` to the object.

- [ ] **Step 3: Add to `_VALID_TABS` (line ~6194) and both `_validViews` sets (lines ~6194 and ~6686)**

In each of those three Sets, add `'maintenance'` alongside the existing entries.

- [ ] **Step 4: Add `navTo` dispatch**

Find (~line 3428):

```js
if (name === 'cutting-checks') { ccOnOpen(); }
```

Insert directly after it:

```js
if (name === 'maintenance')    { mtOnOpen(); }
```

- [ ] **Step 5: Add a stub `mtOnOpen` so navigation doesn't error**

Append to the script block (we'll flesh this out in Task 8):

```js
async function mtOnOpen(forceRefresh = false) {
  // Filled in Task 8
  document.getElementById('mt-content').innerHTML = '<div class="mt-empty">Maintenance dashboard — coming up next.</div>';
}
function mtSwitchSub(/* sub */) { /* Filled in Task 8 */ }
```

- [ ] **Step 6: Visual smoke check**

Reload, sign in. Click the new "Maintenance" tab in nav. The view activates and shows the placeholder text. The existing Woodmill and Cutting Checks tabs still work unchanged.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): register navigation + stub mtOnOpen"
```

---

## Task 8: Daily landing screen — hero + team tiles

**Files:**
- Modify: `index.html` — replace the stub `mtOnOpen`/`mtSwitchSub` with the real implementations, and add `mtRender*` functions

- [ ] **Step 1: Replace the stubs with full landing renderers**

Find the stubs added in Task 7 step 5 and replace with:

```js
async function mtOnOpen(forceRefresh = false) {
  if (forceRefresh) mtState.loaded.daily = mtState.loaded.yearly = false;
  if (!mtState.loaded.daily && mtState.subTab === 'daily')   await mtLoadDaily();
  if (!mtState.loaded.yearly && mtState.subTab === 'yearly') await mtLoadYearly();
  mtRender();
}

function mtSwitchSub(sub) {
  if (mtState.subTab === sub) return;
  mtState.subTab = sub;
  mtState.page = 'landing';
  for (const el of document.querySelectorAll('.mt-subtab')) el.classList.toggle('on', el.dataset.sub === sub);
  mtOnOpen();
}

async function mtLoadDaily() {
  document.getElementById('mt-content').innerHTML = '<div class="mt-loading">Loading checks…</div>';
  const today    = mtTodayUkStr();
  // Default range for the landing screen: today only (per-team status). Drill-in extends.
  mtState.records = await mtAdapterLoadRange([], today, today);
  // Also load downtime for any team that has it, so 'not in use' renders correctly today
  mtState._downtimeByTeam = {};
  await Promise.all(MT_TEAMS.filter(t => t.downtimeList).map(async t => {
    mtState._downtimeByTeam[t.id] = await mtAdapterLoadDowntime(t);
  }));
  mtState.loaded.daily = true;
}

function mtRender() {
  if (mtState.subTab === 'daily') {
    if (mtState.page === 'landing') mtRenderDailyLanding();
    else if (mtState.page === 'drill') mtRenderDailyDrillIn();
  } else {
    mtRenderYearly();
  }
}

// Compute today's status per team: pass / fail / pending / no-machines
function mtComputeTeamStatusToday(team) {
  const today = mtTodayUkStr();
  const teamRecs = mtState.records.filter(r => r.teamId === team.id && r.dateStr === today);
  const dt = mtState._downtimeByTeam?.[team.id] || {};
  // Latest record per machine
  const latestByMachine = {};
  for (const r of teamRecs) {
    if (!latestByMachine[r.machineId] ||
        (r.inspectedAt || '') > (latestByMachine[r.machineId].inspectedAt || '')) {
      latestByMachine[r.machineId] = r;
    }
  }
  const total = team.machines.length;
  let checked = 0, fails = 0, lastIso = '';
  for (const m of team.machines) {
    const isDt = !!dt[`${m.id}|${today}`];
    if (isDt) { checked++; continue; }
    const r = latestByMachine[m.id];
    if (r) {
      checked++;
      if (r.status === 'fail') fails++;
      if ((r.inspectedAt || '') > lastIso) lastIso = r.inspectedAt;
    }
  }
  let cls = 'warn', label = 'Pending';
  if (total === 0) { cls = 'warn'; label = 'No machines'; }
  else if (fails > 0) { cls = 'fail'; label = 'Fail'; }
  else if (checked === total) { cls = 'pass'; label = 'Pass'; }
  return { cls, label, checked, total, fails, lastIso };
}

function mtRenderDailyLanding() {
  const today = mtTodayUkStr();
  // Aggregate hero stats
  let totalExpected = 0, totalChecked = 0, pass = 0, fail = 0;
  const tilesHtml = MT_TEAMS.map(team => {
    const s = mtComputeTeamStatusToday(team);
    totalExpected += s.total;
    totalChecked  += s.checked;
    fail          += s.fails;
    pass          += Math.max(0, s.checked - s.fails);
    const pct = s.total ? Math.round((s.checked / s.total) * 100) : 0;
    return `
      <div class="mt-tile ${s.cls}" onclick="mtOpenDrill('${team.id}')" role="button">
        <div class="mt-icon">${team.icon}</div>
        <div class="mt-mid">
          <div class="mt-team">${team.name}</div>
          <div class="mt-progress"><div class="mt-bar" style="width:${pct}%"></div></div>
          <div class="mt-meta"><b>${s.checked}/${s.total}</b> machines${s.lastIso ? ` · Last ${mtFormatTimeUK(s.lastIso)}` : ''}</div>
        </div>
        <span class="mt-pill ${s.cls}">${s.label}</span>
      </div>`;
  }).join('');
  const pending = Math.max(0, totalExpected - totalChecked);
  const heroHtml = `
    <div class="mt-hero">
      <div class="mt-hero-l">
        <div class="mt-hero-eyebrow">Today · ${mtFormatDateUK(new Date())}</div>
        <div class="mt-hero-num">${totalChecked}<span>/</span>${totalExpected} checks complete</div>
        <div class="mt-hero-sub">${pending} outstanding · ${fail} failure${fail === 1 ? '' : 's'} flagged</div>
      </div>
      <div class="mt-hero-r">
        <div class="mt-stat"><div class="mt-stat-num pass">${pass}</div><div class="mt-stat-lab">Pass</div></div>
        <div class="mt-stat"><div class="mt-stat-num fail">${fail}</div><div class="mt-stat-lab">Fail</div></div>
        <div class="mt-stat"><div class="mt-stat-num warn">${pending}</div><div class="mt-stat-lab">Pending</div></div>
      </div>
    </div>`;
  document.getElementById('mt-content').innerHTML = heroHtml + `<div class="mt-grid">${tilesHtml}</div>`;
}

function mtOpenDrill(teamId) {
  mtState.page = 'drill';
  mtState.drillTeamId = teamId;
  // Default filter window: last 7 UK days
  const today = mtTodayUkStr();
  mtState.filters = {
    teamIds:    [teamId],
    machineIds: [],
    dateFrom:   mtAddDays(today, -6),
    dateTo:     today,
  };
  mtRenderDailyDrillIn(); // shell first
  mtLoadDrill();          // then fetch
}

async function mtLoadDrill() {
  const f = mtState.filters;
  document.getElementById('mt-matrix-host')?.replaceChildren(
    Object.assign(document.createElement('div'), { className: 'mt-loading', textContent: 'Loading…' })
  );
  mtState.records = await mtAdapterLoadRange(f.teamIds, f.dateFrom, f.dateTo);
  // Refresh downtime for the active teams (range-independent — the lists are tiny)
  mtState._downtimeByTeam = {};
  await Promise.all(MT_TEAMS.filter(t => f.teamIds.includes(t.id) && t.downtimeList).map(async t => {
    mtState._downtimeByTeam[t.id] = await mtAdapterLoadDowntime(t);
  }));
  mtRenderDailyDrillIn();
}

function mtRenderDailyDrillIn() {
  // Filled in Task 9 — leave a stub for now so Task 8 verifies cleanly
  document.getElementById('mt-content').innerHTML = `
    <div class="mt-drill-head">
      <button class="mt-back" onclick="mtBackToLanding()">← Back</button>
      <div class="mt-drill-title">${mtGetTeam(mtState.drillTeamId)?.name || ''} drill-in</div>
    </div>
    <div id="mt-matrix-host"><div class="mt-loading">Drill-in coming in Task 9.</div></div>`;
}

function mtBackToLanding() {
  mtState.page = 'landing';
  mtState.drillTeamId = null;
  mtRender();
}
```

- [ ] **Step 2: Visual smoke check**

Reload, click Maintenance tab, sign-in. Expected: hero strip shows today's date + counts; team tiles render for Woodmill + Cutting with their current status. Click a tile → navigates to a placeholder drill-in. Click Back → returns to landing.

If `MT_TEAMS` is empty (e.g., constants weren't loaded), the grid is empty — that's a Task 3 regression, fix there.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): daily landing — hero + team tiles"
```

---

## Task 9: Daily drill-in — filter bar + matrix

**Files:**
- Modify: `index.html` — replace the stub `mtRenderDailyDrillIn` from Task 8 with the full implementation

- [ ] **Step 1: Replace the stub `mtRenderDailyDrillIn`**

```js
function mtRenderDailyDrillIn() {
  const team    = mtGetTeam(mtState.drillTeamId);
  const f       = mtState.filters;
  const days    = mtEnumerateDays(f.dateFrom, f.dateTo);
  const machines = team ? team.machines.filter(m => !f.machineIds.length || f.machineIds.includes(m.id)) : [];
  const dt      = mtState._downtimeByTeam?.[team?.id] || {};

  // Index records by `${machineId}|${dateStr}` — keep latest per cell
  const byCell = {};
  for (const r of mtState.records.filter(r => r.teamId === team?.id)) {
    const k = `${r.machineId}|${r.dateStr}`;
    if (!byCell[k] || (r.inspectedAt || '') > (byCell[k].inspectedAt || '')) byCell[k] = r;
  }

  // Stats strip
  let total = 0, pass = 0, fail = 0, dtCount = 0, missed = 0;
  for (const m of machines) for (const d of days) {
    const k = `${m.id}|${d}`;
    if (dt[k]) { dtCount++; total++; continue; }
    const r = byCell[k];
    if (r && (r.status === 'pass' || r.status === 'na')) { pass++; total++; }
    else if (r && r.status === 'fail') { fail++; total++; }
    else { missed++; }
  }
  const pct = total ? Math.round(((pass + dtCount) / (total)) * 100) : 0;

  // Filter bar
  const teamOpts = MT_TEAMS.map(t => `<option value="${t.id}" ${f.teamIds.includes(t.id) ? 'selected' : ''}>${t.name}</option>`).join('');
  const machineOpts = team ? team.machines.map(m => `<option value="${m.id}" ${f.machineIds.includes(m.id) ? 'selected' : ''}>${m.name}</option>`).join('') : '';
  const exportBtns = mtIsManager ? `
    <button class="mt-btn" onclick="mtExportPdf()">Export PDF</button>
    <button class="mt-btn" onclick="mtExportCsv()">Export Excel/CSV</button>` : '';

  // Matrix table
  const headDays = days.map(d => `<th>${mtFormatDateUK(d).replace(',', '')}</th>`).join('');
  const rows = machines.map(m => {
    const cells = days.map(d => {
      const k = `${m.id}|${d}`;
      if (dt[k]) return `<td class="mt-cell dt" data-machine="${m.id}" data-date="${d}" onclick="mtOpenCellModal('${m.id}','${d}')">—</td>`;
      const r = byCell[k];
      if (!r) return `<td class="mt-cell miss" data-machine="${m.id}" data-date="${d}" onclick="mtOpenCellModal('${m.id}','${d}')"></td>`;
      const sym = r.status === 'fail' ? '✗' : r.status === 'na' ? 'N/A' : '✓';
      return `<td class="mt-cell ${r.status}" data-machine="${m.id}" data-date="${d}" onclick="mtOpenCellModal('${m.id}','${d}')">${sym}</td>`;
    }).join('');
    return `<tr><th>${m.name}</th>${cells}</tr>`;
  }).join('');

  document.getElementById('mt-content').innerHTML = `
    <div class="mt-drill-head">
      <button class="mt-back" onclick="mtBackToLanding()">← Back</button>
      <div class="mt-drill-title">${team ? team.name : 'Drill-in'}</div>
      <div class="mt-actions">${exportBtns}</div>
    </div>
    <div class="mt-filters">
      <div class="mt-filter">
        <label>Team</label>
        <select id="mt-f-team" multiple size="3" onchange="mtOnFilterChange()">${teamOpts}</select>
      </div>
      <div class="mt-filter">
        <label>Machine</label>
        <select id="mt-f-machine" multiple size="3" onchange="mtOnFilterChange()">${machineOpts}</select>
      </div>
      <div class="mt-filter">
        <label>From</label>
        <input id="mt-f-from" type="date" value="${f.dateFrom}" onchange="mtOnFilterChange()">
      </div>
      <div class="mt-filter">
        <label>To</label>
        <input id="mt-f-to" type="date" value="${f.dateTo}" onchange="mtOnFilterChange()">
      </div>
      <div class="mt-filter-actions">
        <button class="mt-btn" onclick="mtResetFilters()">Reset</button>
        <button class="mt-btn" onclick="mtLoadDrill()">Refresh</button>
      </div>
    </div>
    <div class="mt-stats-strip">
      <div class="mt-strip-stat"><div class="mt-strip-num">${total}</div><div class="mt-strip-lab">Slots</div></div>
      <div class="mt-strip-stat"><div class="mt-strip-num pass">${pass}</div><div class="mt-strip-lab">Pass</div></div>
      <div class="mt-strip-stat"><div class="mt-strip-num fail">${fail}</div><div class="mt-strip-lab">Fail</div></div>
      <div class="mt-strip-stat"><div class="mt-strip-num">${dtCount}</div><div class="mt-strip-lab">Not in use</div></div>
      <div class="mt-strip-stat"><div class="mt-strip-num warn">${missed}</div><div class="mt-strip-lab">Missed</div></div>
      <div class="mt-strip-stat"><div class="mt-strip-num">${pct}%</div><div class="mt-strip-lab">Compliance</div></div>
    </div>
    <div id="mt-matrix-host" class="mt-matrix-wrap">
      ${machines.length === 0
        ? '<div class="mt-empty">No machines in selection.</div>'
        : `<table class="mt-matrix"><thead><tr><th>Machine</th>${headDays}</tr></thead><tbody>${rows}</tbody></table>`}
    </div>`;
}

function mtOnFilterChange() {
  const teamSel    = document.getElementById('mt-f-team');
  const machineSel = document.getElementById('mt-f-machine');
  const from       = document.getElementById('mt-f-from').value;
  const to         = document.getElementById('mt-f-to').value;
  if (!from || !to || from > to) return;          // ignore invalid windows
  mtState.filters.teamIds    = Array.from(teamSel.selectedOptions).map(o => o.value);
  mtState.filters.machineIds = Array.from(machineSel.selectedOptions).map(o => o.value);
  mtState.filters.dateFrom   = from;
  mtState.filters.dateTo     = to;
  // If team selection changed away from drillTeamId, repoint the drill
  if (mtState.filters.teamIds.length === 1) mtState.drillTeamId = mtState.filters.teamIds[0];
  mtLoadDrill();
}

function mtResetFilters() {
  const today = mtTodayUkStr();
  mtState.filters = {
    teamIds:    [mtState.drillTeamId],
    machineIds: [],
    dateFrom:   mtAddDays(today, -6),
    dateTo:     today,
  };
  mtLoadDrill();
}

// Stub for Task 10 — replaced there
function mtOpenCellModal(/* machineId, dateStr */) {
  toast('Cell modal coming in Task 10', 'i');
}
```

- [ ] **Step 2: Visual smoke check**

Reload, sign in, click Maintenance, click Woodmill tile. Expected:
- Filter bar shows Team (Woodmill selected), Machine (none — implies all), From = today-6, To = today.
- Stats strip shows the right counts (verify a couple by hand against the live SharePoint).
- Matrix renders with 16 machine rows (Woodmill) × 7 day columns. Cells: green ✓ where checked, red ✗ where failed, blank where missed, grey "—" where downtime-marked.

Try changing dates to a wider range (e.g., last 30 days), confirm matrix repaints. Switch Team to Cutting → Pathfinder/Lectra rows.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): drill-in filter bar + machine × date matrix"
```

---

## Task 10: Cell modal — record view + downtime toggle

**Files:**
- Modify: `index.html` — replace the stub `mtOpenCellModal`, add `mtCloseCellModal` and `mtToggleDowntime`

- [ ] **Step 1: Replace the stub with full cell-modal logic**

```js
function mtOpenCellModal(machineId, dateStr) {
  const team   = mtGetTeam(mtState.drillTeamId);
  if (!team) return;
  const machine = mtGetMachine(team.id, machineId);
  const dt      = mtState._downtimeByTeam?.[team.id] || {};
  const isDt    = !!dt[`${machineId}|${dateStr}`];
  // Find latest record for that cell
  const recs = mtState.records.filter(r => r.teamId === team.id && r.machineId === machineId && r.dateStr === dateStr);
  recs.sort((a, b) => (b.inspectedAt || '').localeCompare(a.inspectedAt || ''));
  const r = recs[0] || null;

  const itemsHtml = (r && Array.isArray(r.items) && r.items.length)
    ? `<div style="margin-top:10px;font-size:12px">
         <div style="font-weight:700;margin-bottom:4px">Check items</div>
         <ul style="margin:0;padding-left:18px">
           ${r.items.map(it => {
             const cls = it.result === 'pass' ? '#16a34a' : it.result === 'fail' ? '#dc2626' : 'var(--text3)';
             return `<li style="color:${cls}">${(it.result || '').toUpperCase()} — ${it.label || ''}</li>`;
           }).join('')}
         </ul>
       </div>`
    : '';

  const dtToggleHtml = mtIsManager
    ? `<button class="mt-btn" style="margin-top:10px" onclick="mtToggleDowntime('${machineId}','${dateStr}')">${isDt ? 'Clear ' : 'Mark '}not in use</button>`
    : '';

  const body = `
    <div style="padding:18px 20px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">${team.name} · ${mtFormatDateUK(dateStr)}</div>
      <div style="font-size:18px;font-weight:700;color:var(--repose-navy);margin:4px 0 12px">${machine ? machine.name : machineId}</div>
      ${r ? `
        <div style="font-size:13px;color:var(--text)">
          <div><b>Status:</b> <span style="color:${r.status==='fail'?'#dc2626':r.status==='pass'?'#16a34a':'var(--text2)'}">${r.status.toUpperCase()}</span></div>
          <div><b>Operator:</b> ${r.operator || '—'}</div>
          <div><b>Time:</b> ${mtFormatTimeUK(r.inspectedAt)} (UK)</div>
          ${r.comment ? `<div style="margin-top:6px"><b>Comment:</b> ${r.comment}</div>` : ''}
          ${itemsHtml}
        </div>` : `
        <div style="color:var(--text2);font-size:13px">${isDt ? 'Marked not in use.' : 'No record for this day.'}</div>`}
      <div style="display:flex;gap:8px;margin-top:14px">
        ${dtToggleHtml}
        <button class="mt-btn" onclick="mtCloseCellModal()" style="margin-left:auto">Close</button>
      </div>
    </div>`;
  document.getElementById('mt-cell-modal-body').innerHTML = body;
  document.getElementById('mt-cell-modal').style.display = 'flex';
}

function mtCloseCellModal() {
  document.getElementById('mt-cell-modal').style.display = 'none';
}

async function mtToggleDowntime(machineId, dateStr) {
  if (!mtIsManager) return;
  const team = mtGetTeam(mtState.drillTeamId);
  if (!team || !team.downtimeList) {
    toast('No downtime list configured for this team', 'u');
    return;
  }
  const dt = mtState._downtimeByTeam?.[team.id] || {};
  const key = `${machineId}|${dateStr}`;
  const existingId = dt[key];
  try {
    const siteId = await mtAdapterGetSiteId();
    const listId = await getListIdByNameOnSite(siteId, team.downtimeList);
    if (existingId) {
      await graphDelete(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${existingId}`);
      delete dt[key];
      toast('Cleared not-in-use', 's');
    } else {
      const res = await graphPost(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`,
        { fields: { Title: key } }
      );
      dt[key] = res.id;
      toast('Marked not-in-use', 's');
    }
    mtState._downtimeByTeam[team.id] = dt;
    mtCloseCellModal();
    mtRenderDailyDrillIn(); // repaint matrix
  } catch (e) {
    toast('Failed: ' + (e.message || 'unknown'), 'u');
  }
}
```

- [ ] **Step 2: Visual smoke check**

Reload, drill into Woodmill. Click a green ✓ cell → modal shows the operator, time, status, and check items. Click a blank cell → modal shows "No record for this day" plus (as manager) a "Mark not in use" button. Click that → cell turns grey "—". Click the cell again → modal shows "Marked not in use" and "Clear not in use" button. Click → cell goes blank.

If you're a non-manager, no "Mark/Clear" button is visible.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): cell modal + downtime toggle (manager-only)"
```

---

## Task 11: Audit export — PDF

**Files:**
- Modify: `index.html` — append `mtExportPdf` function and add print-only CSS

- [ ] **Step 1: Add print CSS at the very end of the existing `<style>` block (after the existing `@media print` blocks)**

```css
@media print {
  body.mt-printing > *:not(#mt-print-overlay) { display: none !important; }
  #mt-print-overlay { display: block !important; position: static !important; padding: 0 !important; }
  @page { size: A4 portrait; margin: 14mm 12mm; }
  .mt-print-bar    { display:flex !important; align-items:center; justify-content:space-between; border-bottom:2pt solid #14a1e9; padding-bottom:7pt; margin-bottom:10pt; }
  .mt-print-bar img{ height:32pt; width:auto; }
  .mt-print-bar span{ color:#0e023a; font-size:9.5pt; font-weight:700; letter-spacing:.04em; }
  .mt-print-h1     { font-size:14pt; color:#0e023a; margin:0 0 4pt; }
  .mt-print-meta   { font-size:9pt; color:#444; margin-bottom:8pt; }
  .mt-print-summary{ display:flex; gap:14pt; margin:6pt 0 10pt; font-size:9pt; }
  .mt-print-summary div b { color:#0e023a; }
  .mt-print-table  { width:100%; border-collapse:collapse; font-size:8pt; margin-bottom:8pt; }
  .mt-print-table th,
  .mt-print-table td { border:0.5pt solid #999; padding:2pt 4pt; vertical-align:top; }
  .mt-print-table th { background:#f0f4f8; -webkit-print-color-adjust:exact; print-color-adjust:exact; font-size:7.5pt; }
  .mt-print-section{ font-size:11pt; font-weight:700; color:#0e023a; margin:10pt 0 4pt; }
  .mt-print-sig    { margin-top:14pt; font-size:9pt; }
  * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
}
#mt-print-overlay { display:none; }
```

- [ ] **Step 2: Append `mtExportPdf` to the script block**

```js
function mtExportPdf() {
  if (!mtIsManager) return;
  const team = mtGetTeam(mtState.drillTeamId);
  if (!team) return;
  const f    = mtState.filters;
  const days = mtEnumerateDays(f.dateFrom, f.dateTo);
  const dt   = mtState._downtimeByTeam?.[team.id] || {};
  const machines = team.machines.filter(m => !f.machineIds.length || f.machineIds.includes(m.id));

  const recsForTeam = mtState.records.filter(r => r.teamId === team.id);
  // Latest per (machine, date)
  const byCell = {};
  for (const r of recsForTeam) {
    const k = `${r.machineId}|${r.dateStr}`;
    if (!byCell[k] || (r.inspectedAt || '') > (byCell[k].inspectedAt || '')) byCell[k] = r;
  }

  // Summary stats
  let total = 0, pass = 0, fail = 0, dtCount = 0, missed = 0;
  for (const m of machines) for (const d of days) {
    const k = `${m.id}|${d}`;
    if (dt[k]) { dtCount++; total++; continue; }
    const r = byCell[k];
    if (r && (r.status === 'pass' || r.status === 'na')) { pass++; total++; }
    else if (r && r.status === 'fail') { fail++; total++; }
    else { missed++; }
  }
  const pct = total ? Math.round(((pass + dtCount) / total) * 100) : 0;
  const docNo = `REPO-MAINT-AUDIT-${new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)}`;

  // Per-row table
  const rows = recsForTeam
    .filter(r => days.includes(r.dateStr) && (!f.machineIds.length || f.machineIds.includes(r.machineId)))
    .sort((a, b) => (a.inspectedAt || '').localeCompare(b.inspectedAt || ''))
    .map(r => `<tr>
        <td>${mtFormatDateUK(r.dateStr).replace(',', '')}</td>
        <td>${mtFormatTimeUK(r.inspectedAt)}</td>
        <td>${team.name}</td>
        <td>${r.machineName}</td>
        <td>${r.operator || ''}</td>
        <td>${r.status.toUpperCase()}</td>
        <td>${(r.comment || '').replace(/</g,'&lt;')}</td>
      </tr>`).join('');

  // Expanded failures
  const fails = recsForTeam
    .filter(r => r.status === 'fail' && days.includes(r.dateStr) && (!f.machineIds.length || f.machineIds.includes(r.machineId)));
  const failsHtml = fails.length ? `
    <div class="mt-print-section">Expanded failures</div>
    <table class="mt-print-table">
      <thead><tr><th>Date</th><th>Machine</th><th>Failed item(s)</th><th>Comment</th></tr></thead>
      <tbody>
        ${fails.map(r => {
          const failed = (r.items || []).filter(i => i.result === 'fail').map(i => i.label).join('; ') || '(no breakdown)';
          return `<tr>
            <td>${mtFormatDateUK(r.dateStr).replace(',', '')}</td>
            <td>${r.machineName}</td>
            <td>${failed}</td>
            <td>${(r.comment || '').replace(/</g,'&lt;')}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : '';

  // Missed days
  const missedRows = [];
  for (const m of machines) for (const d of days) {
    const k = `${m.id}|${d}`;
    if (dt[k]) continue;
    if (!byCell[k]) missedRows.push({ machine: m.name, date: d });
  }
  const missedHtml = missedRows.length ? `
    <div class="mt-print-section">Missed days</div>
    <table class="mt-print-table">
      <thead><tr><th>Date</th><th>Machine</th></tr></thead>
      <tbody>${missedRows.map(r => `<tr><td>${mtFormatDateUK(r.date).replace(',', '')}</td><td>${r.machine}</td></tr>`).join('')}</tbody>
    </table>` : '';

  const html = `
    <div id="mt-print-overlay">
      <div class="mt-print-bar">
        <img src="./Repose_RGB_logo_Colour_with_strapline_1500pxW.png" alt="Repose">
        <span>QHSE — MAINTENANCE AUDIT REPORT</span>
      </div>
      <h1 class="mt-print-h1">${team.name} — Daily Pre-use Audit</h1>
      <div class="mt-print-meta">
        <div><b>Doc:</b> ${docNo}</div>
        <div><b>Range:</b> ${mtFormatDateUK(f.dateFrom)} → ${mtFormatDateUK(f.dateTo)}</div>
        <div><b>Machines:</b> ${f.machineIds.length ? machines.map(m => m.name).join(', ') : 'All'}</div>
        <div><b>Generated:</b> ${mtFormatDateUK(new Date())} ${mtFormatTimeUK(new Date())} (UK)</div>
      </div>
      <div class="mt-print-summary">
        <div><b>Total slots:</b> ${total}</div>
        <div><b>Pass:</b> ${pass}</div>
        <div><b>Fail:</b> ${fail}</div>
        <div><b>Not in use:</b> ${dtCount}</div>
        <div><b>Missed:</b> ${missed}</div>
        <div><b>Compliance:</b> ${pct}%</div>
      </div>
      <div class="mt-print-section">Records</div>
      <table class="mt-print-table">
        <thead><tr><th>Date</th><th>Time (UK)</th><th>Team</th><th>Machine</th><th>Operator</th><th>Status</th><th>Comment</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#888">No records in range.</td></tr>'}</tbody>
      </table>
      ${failsHtml}
      ${missedHtml}
      <div class="mt-print-sig">
        Reviewed by: ____________________________ &nbsp;&nbsp; Date: __________________
      </div>
    </div>`;

  // Inject, print, clean up
  let host = document.getElementById('mt-print-overlay');
  if (host) host.remove();
  document.body.insertAdjacentHTML('beforeend', html);
  document.body.classList.add('mt-printing');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('mt-printing');
      document.getElementById('mt-print-overlay')?.remove();
    }, 600);
  }, 50);
}
```

- [ ] **Step 3: Visual smoke check**

Drill into Woodmill, click Export PDF. Print preview opens with the Repose logo bar, doc number, range, summary stats, records table, expanded failures (if any), missed days, and a signature line. Save as PDF; open the PDF — confirms it's auditor-ready (no UI chrome, page-paginated).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): audit PDF export (print overlay + branded layout)"
```

---

## Task 12: Audit export — CSV

**Files:**
- Modify: `index.html` — append `mtExportCsv` after `mtExportPdf`

- [ ] **Step 1: Append `mtExportCsv`**

```js
function mtExportCsv() {
  if (!mtIsManager) return;
  const team = mtGetTeam(mtState.drillTeamId);
  if (!team) return;
  const f = mtState.filters;
  const days = mtEnumerateDays(f.dateFrom, f.dateTo);
  const dt   = mtState._downtimeByTeam?.[team.id] || {};
  const machines = team.machines.filter(m => !f.machineIds.length || f.machineIds.includes(m.id));
  const recsForTeam = mtState.records.filter(r => r.teamId === team.id);
  const byCell = {};
  for (const r of recsForTeam) {
    const k = `${r.machineId}|${r.dateStr}`;
    if (!byCell[k] || (r.inspectedAt || '') > (byCell[k].inspectedAt || '')) byCell[k] = r;
  }

  // CSV escape
  const esc = v => {
    const s = (v == null ? '' : String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const row = arr => arr.map(esc).join(',');

  const lines = [];
  lines.push('# Repose — Maintenance Audit Report');
  lines.push(`# Team: ${team.name}`);
  lines.push(`# Range: ${f.dateFrom} to ${f.dateTo}`);
  lines.push(`# Machines: ${f.machineIds.length ? machines.map(m => m.name).join('; ') : 'All'}`);
  lines.push(`# Generated: ${new Date().toISOString()} (UTC)`);
  lines.push('');
  lines.push('# Section: Records');
  lines.push(row(['Date','Time (UK)','Team','Machine','Operator','Status','Comment']));
  recsForTeam
    .filter(r => days.includes(r.dateStr) && (!f.machineIds.length || f.machineIds.includes(r.machineId)))
    .sort((a, b) => (a.inspectedAt || '').localeCompare(b.inspectedAt || ''))
    .forEach(r => lines.push(row([
      r.dateStr, mtFormatTimeUK(r.inspectedAt), team.name, r.machineName,
      r.operator || '', r.status.toUpperCase(), r.comment || '',
    ])));

  lines.push('');
  lines.push('# Section: Expanded failures');
  lines.push(row(['Date','Machine','Failed item(s)','Comment']));
  recsForTeam
    .filter(r => r.status === 'fail' && days.includes(r.dateStr) && (!f.machineIds.length || f.machineIds.includes(r.machineId)))
    .forEach(r => {
      const failed = (r.items || []).filter(i => i.result === 'fail').map(i => i.label).join('; ');
      lines.push(row([r.dateStr, r.machineName, failed, r.comment || '']));
    });

  lines.push('');
  lines.push('# Section: Missed days');
  lines.push(row(['Date','Machine']));
  for (const m of machines) for (const d of days) {
    if (dt[`${m.id}|${d}`]) continue;
    if (!byCell[`${m.id}|${d}`]) lines.push(row([d, m.name]));
  }

  // UTF-8 BOM so Excel renders unicode correctly
  const BOM = '﻿';
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `repose-maintenance-audit-${team.id}-${f.dateFrom}_to_${f.dateTo}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: Visual smoke check**

Click Export Excel/CSV in the drill-in. A CSV downloads. Open in Excel → renders as a structured report with three sections (Records / Expanded failures / Missed days). Embedded commas in operator names or comments are properly quoted. Special characters render correctly (BOM works).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): audit CSV export"
```

---

## Task 13: Yearly sub-tab — calendar strip + register table + history

**Files:**
- Modify: `index.html` — append `mtLoadYearly`, `mtRenderYearly`, `mtToggleHistory`, plus a small helper for next-due computation

- [ ] **Step 1: Append yearly load + status math**

```js
async function mtLoadYearly() {
  document.getElementById('mt-content').innerHTML = '<div class="mt-loading">Loading yearly inspections…</div>';
  const y = await mtAdapterLoadYearly();
  mtState.yearlyItems   = y.items;
  mtState.yearlyHistory = y.history;
  mtState.loaded.yearly = true;
}

function mtFreqDays(item) {
  const f = (item.Frequency || '').toLowerCase();
  if (f === 'annual')    return 365;
  if (f === '6-monthly') return 183;
  if (f === 'quarterly') return 91;
  if (f === 'monthly')   return 30;
  if (f === 'custom')    return Number(item.FrequencyDays || 0) || 365;
  return 365;
}

function mtComputeYearlyStatus(item) {
  const today = new Date(mtTodayUkStr() + 'T00:00:00Z').getTime();
  const last  = item.LastDone ? new Date(item.LastDone).getTime() : null;
  const days  = mtFreqDays(item);
  if (!last) return { nextDueIso: mtTodayUkStr(), daysUntil: -1, cls: 'overdue', label: 'Overdue', firstTime: true };
  const next  = last + days * 86400000;
  const daysUntil = Math.round((next - today) / 86400000);
  if (daysUntil < 0)  return { nextDueIso: new Date(next).toISOString().slice(0,10), daysUntil, cls: 'overdue', label: 'Overdue' };
  if (daysUntil <= 90) return { nextDueIso: new Date(next).toISOString().slice(0,10), daysUntil, cls: 'due',     label: 'Due Soon' };
  return                  { nextDueIso: new Date(next).toISOString().slice(0,10), daysUntil, cls: 'ok',      label: 'OK' };
}
```

- [ ] **Step 2: Append `mtRenderYearly`**

```js
let mtYearlyChips = ['All']; // category filter (multi-select)

function mtRenderYearly() {
  const items = mtState.yearlyItems.map(i => ({ ...i, _s: mtComputeYearlyStatus(i) }));

  // Calendar strip — 12 months from current
  const now = new Date(mtTodayUkStr() + 'T00:00:00Z');
  const months = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    return { ymKey: `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`, label: d.toLocaleDateString('en-GB',{ month:'short', year:'2-digit' }) };
  });
  const markersByMonth = {};
  for (const it of items) {
    const ym = it._s.nextDueIso.slice(0,7);
    if (!markersByMonth[ym]) markersByMonth[ym] = [];
    markersByMonth[ym].push(it);
  }
  const calHtml = `<div class="mt-cal-strip">${months.map(m => {
    const list = markersByMonth[m.ymKey] || [];
    const marks = list.map(it => `<span class="mt-cal-marker ${it._s.cls}" title="${(it.Title||'').replace(/"/g,'')} — ${it._s.label}" onclick="mtScrollToYearlyRow(${it.id})">${(it.Title||'').slice(0,18)}</span>`).join('');
    return `<div class="mt-cal-month"><div class="mt-cal-mlabel">${m.label}</div>${marks}</div>`;
  }).join('')}</div>`;

  // Filter chips
  const cats = ['All','Statutory','Annual Servicing','Legal Surveys','Insurance','Other','Overdue','Due Soon'];
  const chipsHtml = `<div class="mt-chips">${cats.map(c => `
    <button class="mt-chip ${mtYearlyChips.includes(c) ? 'on' : ''}" onclick="mtToggleChip('${c.replace(/'/g,"\\'")}')">${c}</button>
  `).join('')}</div>`;

  // Filter items by chips
  const filtered = items.filter(it => {
    if (mtYearlyChips.includes('All')) return true;
    if (mtYearlyChips.includes(it.Category)) return true;
    if (mtYearlyChips.includes('Overdue')   && it._s.cls === 'overdue') return true;
    if (mtYearlyChips.includes('Due Soon')  && it._s.cls === 'due')     return true;
    return false;
  });

  // Register table
  const headerActions = mtIsManager ? `<button class="mt-btn" onclick="mtOpenDrawer('add')">⚙ Manage</button>` : '';
  const rows = filtered.length ? filtered.map(it => `
    <tr id="mt-yr-row-${it.id}">
      <td><b>${it.Title || ''}</b></td>
      <td>${it.Category || ''}</td>
      <td>${it.Frequency || ''}${(it.Frequency||'').toLowerCase()==='custom' ? ` (${it.FrequencyDays||0}d)` : ''}</td>
      <td>${it.LastDone ? mtFormatDateUK(it.LastDone).replace(',', '') : '—'}</td>
      <td>${mtFormatDateUK(it._s.nextDueIso).replace(',', '')}</td>
      <td><span class="mt-pill ${it._s.cls === 'overdue' ? 'fail' : it._s.cls === 'due' ? 'warn' : 'pass'}">${it._s.label}</span></td>
      <td>${it.DocLink ? `<a href="${it.DocLink}" target="_blank" rel="noopener" title="Open latest cert">📎</a>` : ''}</td>
      <td>
        <div class="mt-row-actions">
          <button class="mt-icon-btn" title="History" onclick="mtToggleHistory(${it.id})">📂</button>
          ${mtIsManager ? `
            <button class="mt-icon-btn" title="Mark complete" onclick="mtOpenCompleteModal(${it.id})">✓</button>
            <button class="mt-icon-btn" title="Edit" onclick="mtOpenDrawer('edit',${it.id})">✏️</button>
            <button class="mt-icon-btn" title="Delete" onclick="mtDeleteYearly(${it.id})">🗑</button>` : ''}
        </div>
      </td>
    </tr>
    <tr class="mt-history-row" id="mt-yr-hist-${it.id}" style="display:none">
      <td colspan="8"><div class="mt-history-list" id="mt-yr-hist-body-${it.id}">Loading…</div></td>
    </tr>
  `).join('') : `<tr><td colspan="8"><div class="mt-empty">${mtState.yearlyItems.length === 0 ? 'No inspection items yet — click ⚙ Manage to add the first one.' : 'No items match the current filter.'}</div></td></tr>`;

  document.getElementById('mt-content').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">Yearly · 12-month outlook</div>
      ${headerActions}
    </div>
    ${calHtml}
    ${chipsHtml}
    <table class="mt-table">
      <thead>
        <tr><th>Title</th><th>Category</th><th>Frequency</th><th>Last Done</th><th>Next Due</th><th>Status</th><th>Cert</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function mtToggleChip(c) {
  if (c === 'All') { mtYearlyChips = ['All']; mtRenderYearly(); return; }
  if (mtYearlyChips.includes('All')) mtYearlyChips = mtYearlyChips.filter(x => x !== 'All');
  mtYearlyChips = mtYearlyChips.includes(c) ? mtYearlyChips.filter(x => x !== c) : [...mtYearlyChips, c];
  if (!mtYearlyChips.length) mtYearlyChips = ['All'];
  mtRenderYearly();
}

function mtScrollToYearlyRow(id) {
  document.getElementById(`mt-yr-row-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function mtToggleHistory(itemId) {
  const row = document.getElementById(`mt-yr-hist-${itemId}`);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  if (isOpen) { row.style.display = 'none'; return; }
  const body = document.getElementById(`mt-yr-hist-body-${itemId}`);
  const hist = mtState.yearlyHistory
    .filter(h => Number(h.ItemId) === Number(itemId))
    .sort((a, b) => (b.CompletedOn || '').localeCompare(a.CompletedOn || ''));
  body.innerHTML = hist.length ? hist.map(h => `
    <div class="mt-history-item">
      <div style="min-width:90px"><b>${mtFormatDateUK(h.CompletedOn).replace(',', '')}</b></div>
      <div style="flex:1">${h.Contractor || ''}${h.Cost ? ` · £${h.Cost}` : ''}${h.Notes ? ` · ${h.Notes}` : ''}</div>
      <div>${h.DocLink ? `<a href="${h.DocLink}" target="_blank" rel="noopener">📎 cert</a>` : ''}</div>
    </div>`).join('') : '<div class="mt-empty" style="padding:14px">No completion history yet.</div>';
  row.style.display = '';
}

// Close handlers — final implementations (used by Tasks 14 + 15 too)
function mtCloseDrawer()        { document.getElementById('mt-drawer').classList.remove('on'); document.getElementById('mt-drawer-bg').classList.remove('on'); }
function mtCloseCompleteModal() { document.getElementById('mt-complete-modal').style.display = 'none'; }

// Stubs — replaced in Tasks 14 (Open/Save/Delete) and 15 (Complete)
function mtOpenDrawer(/* mode, id */)  { toast('Drawer comes in Task 14', 'i'); }
function mtOpenCompleteModal(/* id */) { toast('Mark-complete comes in Task 15', 'i'); }
function mtDeleteYearly(/* id */)      { toast('Delete comes in Task 14', 'i'); }
```

- [ ] **Step 3: Visual smoke check**

Reload, sign in, click Maintenance → Yearly sub-tab. Expected:
- 12-month calendar strip from current month, with the test row from Task 0 shown as a marker (status depends on its `LastDone`).
- Filter chips render (All highlighted).
- Register table shows the test row with Title / Category / Frequency / LastDone / NextDue / Status pill / cert link (none yet) / action icons.
- Click 📂 (history) → expands and shows "No completion history yet."
- Click a calendar marker → scrolls to that row.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): yearly sub-tab — calendar strip + register + history"
```

---

## Task 14: Yearly manager edit drawer (add / edit / delete)

**Files:**
- Modify: `index.html` — replace the stubs from Task 13 (`mtOpenDrawer`, `mtDeleteYearly`)

- [ ] **Step 1: Replace `mtOpenDrawer` with the full implementation**

```js
function mtOpenDrawer(mode, id) {
  if (!mtIsManager) return;
  const drawer = document.getElementById('mt-drawer');
  const bg     = document.getElementById('mt-drawer-bg');
  const body   = document.getElementById('mt-drawer-body');
  const foot   = document.getElementById('mt-drawer-foot');
  const title  = document.getElementById('mt-drawer-title');

  const isEdit = mode === 'edit';
  const item   = isEdit ? mtState.yearlyItems.find(i => Number(i.id) === Number(id)) : null;
  title.textContent = isEdit ? 'Edit yearly item' : 'Manage yearly items';

  if (isEdit && item) {
    body.innerHTML = mtRenderYearlyForm(item);
    foot.innerHTML = `
      <button class="mt-btn" onclick="mtCloseDrawer()">Cancel</button>
      <button class="mt-btn" onclick="mtSaveYearly(${item.id})" style="background:var(--repose-blue);color:#fff">Save</button>`;
  } else {
    // Manage mode — show "Add new" form on top, then list of existing items
    const listHtml = mtState.yearlyItems.map(i => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span><b>${i.Title || ''}</b> <span style="color:var(--text3)">· ${i.Category || ''}</span></span>
        <span>
          <button class="mt-icon-btn" onclick="mtOpenDrawer('edit',${i.id})">✏️</button>
          <button class="mt-icon-btn" onclick="mtDeleteYearly(${i.id})">🗑</button>
        </span>
      </div>`).join('');
    body.innerHTML = `
      <div class="mt-drawer-title" style="font-size:13px;margin-bottom:6px">Add new item</div>
      ${mtRenderYearlyForm({})}
      <div class="mt-drawer-title" style="font-size:13px;margin-top:18px;margin-bottom:6px">Existing items</div>
      ${listHtml || '<div class="mt-empty" style="padding:8px">None yet.</div>'}`;
    foot.innerHTML = `
      <button class="mt-btn" onclick="mtCloseDrawer()">Close</button>
      <button class="mt-btn" onclick="mtSaveYearly(null)" style="background:var(--repose-blue);color:#fff">Save new</button>`;
  }
  drawer.classList.add('on');
  bg.classList.add('on');
}

function mtRenderYearlyForm(item) {
  const cats = ['Statutory','Annual Servicing','Legal Surveys','Insurance','Other'];
  const freqs = ['Annual','6-monthly','Quarterly','Monthly','Custom'];
  return `
    <div class="mt-form-group"><label>Title</label><input id="mt-fy-title" value="${(item.Title || '').replace(/"/g,'&quot;')}"></div>
    <div class="mt-form-group"><label>Category</label>
      <select id="mt-fy-cat">${cats.map(c => `<option ${item.Category===c?'selected':''}>${c}</option>`).join('')}</select>
    </div>
    <div class="mt-form-group"><label>Frequency</label>
      <select id="mt-fy-freq" onchange="document.getElementById('mt-fy-freq-row').style.display = this.value==='Custom' ? '' : 'none'">${freqs.map(f => `<option ${item.Frequency===f?'selected':''}>${f}</option>`).join('')}</select>
    </div>
    <div class="mt-form-group" id="mt-fy-freq-row" style="${(item.Frequency||'').toLowerCase()==='custom'?'':'display:none'}">
      <label>Frequency days</label><input id="mt-fy-fd" type="number" min="1" value="${item.FrequencyDays || ''}">
    </div>
    <div class="mt-form-group"><label>Last done</label><input id="mt-fy-last" type="date" value="${(item.LastDone || '').slice(0,10)}"></div>
    <div class="mt-form-group"><label>Doc link (SharePoint URL)</label><input id="mt-fy-doc" value="${(item.DocLink || '').replace(/"/g,'&quot;')}" placeholder="https://reposefurniturelimited.sharepoint.com/..."></div>
    <div class="mt-form-group"><label>Notes</label><textarea id="mt-fy-notes" rows="3">${item.Notes || ''}</textarea></div>`;
}

async function mtSaveYearly(id) {
  if (!mtIsManager) return;
  const title = document.getElementById('mt-fy-title').value.trim();
  if (!title) { toast('Title is required', 'u'); return; }
  const fields = {
    Title:         title,
    Category:      document.getElementById('mt-fy-cat').value,
    Frequency:     document.getElementById('mt-fy-freq').value,
    FrequencyDays: Number(document.getElementById('mt-fy-fd').value || 0) || null,
    LastDone:      document.getElementById('mt-fy-last').value || null,
    DocLink:       document.getElementById('mt-fy-doc').value.trim() || null,
    Notes:         document.getElementById('mt-fy-notes').value || null,
  };
  try {
    const siteId = await mtAdapterGetSiteId();
    const listId = await getListIdByNameOnSite(siteId, MT_YEARLY_LIST);
    if (id) {
      await graphPatch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${id}/fields`, fields);
      toast('Item updated', 's');
    } else {
      await graphPost(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`, { fields });
      toast('Item added', 's');
    }
    await mtLoadYearly();
    mtCloseDrawer();
    mtRenderYearly();
  } catch (e) {
    toast('Save failed: ' + (e.message || ''), 'u');
  }
}

async function mtDeleteYearly(id) {
  if (!mtIsManager) return;
  if (!confirm('Delete this item? History rows will be kept for audit.')) return;
  try {
    const siteId = await mtAdapterGetSiteId();
    const listId = await getListIdByNameOnSite(siteId, MT_YEARLY_LIST);
    await graphDelete(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${id}`);
    await mtLoadYearly();
    mtRenderYearly();
    toast('Item deleted', 's');
  } catch (e) {
    toast('Delete failed: ' + (e.message || ''), 'u');
  }
}
```

- [ ] **Step 2: Verify `graphPatch` exists**

In DevTools console:

```js
console.log(typeof graphPatch);
```

Expected: `'function'`. (We saw it referenced in the codebase earlier; confirm it's defined.) If it prints `'undefined'`, find any other PATCH call in the file (e.g., search `method: 'PATCH'`) — there should be a helper. If not, add this small helper alongside `graphPost` (~line 6417):

```js
async function graphPatch(url, body) {
  const token = await getGraphToken();
  if (!token) throw new Error('Not authenticated');
  const r = await _graphFetchWithRetry(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Graph ${r.status}: ${await r.text()}`);
  return r.json();
}
```

- [ ] **Step 3: Visual smoke check**

As a manager: click ⚙ Manage → drawer slides in. Add a new item ("Test Annual Service" / Annual Servicing / Annual / LastDone today / DocLink any URL / Notes "smoke test"). Save → item appears in the register and on the calendar strip. Click ✏️ → drawer pre-fills, edit a field, Save → updates. Click 🗑 on the test item → confirm → item disappears.

As a non-manager: ⚙ Manage button isn't visible.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): yearly manager edit drawer (add/edit/delete)"
```

---

## Task 15: Yearly mark-complete modal

**Files:**
- Modify: `index.html` — replace the stub `mtOpenCompleteModal` from Task 13

- [ ] **Step 1: Replace the stub**

```js
function mtOpenCompleteModal(itemId) {
  if (!mtIsManager) return;
  const item = mtState.yearlyItems.find(i => Number(i.id) === Number(itemId));
  if (!item) return;
  const me = (typeof graphAccount !== 'undefined' && graphAccount?.username) || '';
  const today = mtTodayUkStr();
  const body = `
    <div style="padding:18px 20px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">Mark complete</div>
      <div style="font-size:18px;font-weight:700;color:var(--repose-navy);margin:4px 0 12px">${item.Title || ''}</div>
      <div class="mt-form-group"><label>Completion date</label><input id="mt-fc-date" type="date" value="${today}"></div>
      <div class="mt-form-group"><label>Cert link (SharePoint URL) — required</label><input id="mt-fc-doc" placeholder="https://reposefurniturelimited.sharepoint.com/..."></div>
      <div class="mt-form-group"><label>Contractor</label><input id="mt-fc-contr"></div>
      <div class="mt-form-group"><label>Cost (£) — optional</label><input id="mt-fc-cost" type="number" step="0.01" min="0"></div>
      <div class="mt-form-group"><label>Notes</label><textarea id="mt-fc-notes" rows="3"></textarea></div>
      <input id="mt-fc-by" type="hidden" value="${me}">
      <div style="display:flex;gap:8px;margin-top:6px;justify-content:flex-end">
        <button class="mt-btn" onclick="mtCloseCompleteModal()">Cancel</button>
        <button class="mt-btn" style="background:var(--repose-blue);color:#fff" onclick="mtSaveComplete(${item.id})">Save</button>
      </div>
    </div>`;
  document.getElementById('mt-complete-modal-body').innerHTML = body;
  document.getElementById('mt-complete-modal').style.display = 'flex';
}

async function mtSaveComplete(itemId) {
  if (!mtIsManager) return;
  const item = mtState.yearlyItems.find(i => Number(i.id) === Number(itemId));
  if (!item) return;
  const date  = document.getElementById('mt-fc-date').value;
  const doc   = document.getElementById('mt-fc-doc').value.trim();
  const contr = document.getElementById('mt-fc-contr').value.trim();
  const cost  = Number(document.getElementById('mt-fc-cost').value) || null;
  const notes = document.getElementById('mt-fc-notes').value;
  const by    = document.getElementById('mt-fc-by').value;
  if (!date) { toast('Completion date is required', 'u'); return; }
  if (!doc)  { toast('Cert link is required for audit', 'u'); return; }

  try {
    const siteId = await mtAdapterGetSiteId();
    const histListId = await getListIdByNameOnSite(siteId, MT_YEARLY_HISTORY);
    const yrListId   = await getListIdByNameOnSite(siteId, MT_YEARLY_LIST);

    // 1) Add history row
    await graphPost(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${histListId}/items`, {
      fields: {
        Title:       `${item.Title || ''} ${date}`,
        ItemId:      Number(item.id),
        CompletedOn: new Date(`${date}T12:00:00Z`).toISOString(), // noon UTC to avoid TZ day-shift
        DocLink:     doc,
        Contractor:  contr || null,
        Cost:        cost,
        Notes:       notes || null,
        CompletedBy: by || null,
      }
    });
    // 2) Update master row
    await graphPatch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${yrListId}/items/${item.id}/fields`, {
      LastDone: date,
      DocLink:  doc,
    });
    toast('Completion saved', 's');
    await mtLoadYearly();
    mtCloseCompleteModal();
    mtRenderYearly();
  } catch (e) {
    toast('Save failed: ' + (e.message || ''), 'u');
  }
}
```

- [ ] **Step 2: Visual smoke check**

On the test row, click ✓ Mark complete. Modal opens. Try saving with no doc link → error toast. Fill in: date today, doc link `https://reposefurniturelimited.sharepoint.com/test.pdf`, contractor "Test Co", cost 250, notes "smoke test" → Save. Toast confirms. Register row's `LastDone` updates to today, `Status` recomputes to "OK", calendar marker re-positions. Click 📂 history → new row appears with the cert link clickable.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): yearly mark-complete modal"
```

---

## Task 16: Add Development team

**Prerequisite from Jonas:** the `DEV_MACHINES` list with each machine's `id`, `name`, `group`, and the `checks` array. Until that's confirmed, this task stays pending.

**Files:**
- Modify: `index.html` — add `DEV_MACHINES` constant near `WM_MACHINES` (~line 14162); add registry entry to `MT_TEAMS`

- [ ] **Step 1: Add `DEV_MACHINES` constant**

Insert directly after `WM_MACHINES` definition (~line 14179):

```js
// Development workshop machines — confirm with Jonas before changing
const DEV_MACHINES = [
  // example shape until confirmed:
  // { id:'dev-bandsaw', name:'Dev Bandsaw',  group:'Saws',     checks:['…','…'] },
  // { id:'dev-drill',   name:'Dev Drill',    group:'Machines', checks:['…','…'] },
];
```

- [ ] **Step 2: Add Development to `MT_TEAMS`**

Edit the registry array from Task 3:

```js
const MT_TEAMS = [
  { id:'woodmill',    name:'Woodmill',    icon:'🪵', listName:'WMInspections',  downtimeList:'WMDowntime',  machines: WM_MACHINES },
  { id:'cutting',     name:'Cutting',     icon:'✂️', listName:'CCInspections',  downtimeList: null,         machines: CC_MACHINES },
  { id:'development', name:'Development', icon:'🧪', listName:'DEVInspections', downtimeList:'DEVDowntime', machines: DEV_MACHINES },
];
```

- [ ] **Step 3: Visual smoke check**

Reload Maintenance landing. The Development tile renders. If `DEV_MACHINES` is empty, the tile shows "0/0 machines" with the "No machines" pill (per the empty-state spec rule). Once Jonas provides the machine list and you populate `DEV_MACHINES`, the tile populates correctly. Drill into Development → matrix renders the configured machines.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): add Development team to registry"
```

---

## Task 17: Remove old Woodmill + Cutting Checks tabs

This task is the final cutover — only run it after Tasks 1–15 are merged and the new dashboard has been smoke-tested in production for at least one full day.

**Files:**
- Modify: `index.html` — multiple regions

- [ ] **Step 1: Remove the nav buttons**

Remove these two lines from the nav HTML (~line 2416 area):

```html
<button class="nav-item" data-view="woodmill" id="woodmill-tab-btn" onclick="navTo('woodmill')" style="display:none">Woodmill</button>
<button class="nav-item" data-view="cutting-checks" id="cc-tab-btn" onclick="navTo('cutting-checks')" style="display:none">Cutting Checks</button>
```

(Leave the `Maintenance` button in place.)

- [ ] **Step 2: Remove from `NAV_LABELS`**

Delete `'woodmill':'Woodmill'` and `'cutting-checks':'Cutting Checks'` keys from the object at ~line 3404.

- [ ] **Step 3: Remove from `_VALID_TABS` and both `_validViews` sets**

In the three Sets at lines ~6194, ~6194, ~6686, remove `'woodmill'` and `'cutting-checks'` from each.

- [ ] **Step 4: Remove the `navTo` branches**

Find at ~line 3428:

```js
if (name === 'cutting-checks') { ccOnOpen(); }
```

Find the matching woodmill branch above it (search for `wmOnOpen` or `name === 'woodmill'`) and remove both lines.

- [ ] **Step 5: Delete the `view-woodmill` div**

Find `<div class="view" id="view-woodmill">` (~line 2894) and delete the whole block up to and including its matching closing `</div>`. Use Editor folding or careful counting — the block is several hundred lines.

- [ ] **Step 6: Delete the `view-cutting-checks` *dashboard* div**

Find `<div class="view" id="view-cutting-checks">` (~line 12802). Delete that view div **only**. **Do NOT delete the Cutting submit modal** (`<div id="cc-submit-modal">` or however it's named — it's the modal opened by `ccOpenSubmitModal()` from line 3585's button). Confirm the submit modal is still referenced by `ccOpenSubmitModal()` after the edit.

- [ ] **Step 7: Delete the dashboard-only render code**

Delete these functions (search by name):

- `wmRender`, `wmRenderWeek`, `wmRenderMonth`
- `ccRender` (the dashboard one), `ccRenderDashboard`, `ccRenderWeek`, `ccRenderMonth`

**Keep:** `ccLoadData`, `ccGetSiteId`, `ccGetListId`, `ccOpenSubmitModal`, `ccRenderSubmitForm`, the cutting submit save flow (search for "Pre-use check submitted" to confirm the function name in your file). `wmLoadData` becomes unreferenced once `wmRender*` is gone — safe to leave in place for now and clean up in a follow-up PR (out of scope for this plan to keep this commit's diff focused).

- [ ] **Step 8: Remove the manager-button gating that pointed at the now-deleted nav buttons**

In the auth callback (~line 6713 onwards):

```js
const woodmillBtn = document.getElementById('woodmill-tab-btn');
if (woodmillBtn) woodmillBtn.style.display = WOODMILL_ALLOWED.has(...) ? '' : 'none';
const ccTabBtn = document.getElementById('cc-tab-btn');
if (ccTabBtn) ccTabBtn.style.display = CC_TAB_ALLOWED.has(...) ? '' : 'none';
```

These elements no longer exist. The lookups will return `null`, the `if` guards short-circuit, and the lines become dead code. Remove them for cleanliness.

Likewise the `WOODMILL_ALLOWED` and `CC_TAB_ALLOWED` sets become unreferenced — remove those declarations.

- [ ] **Step 9: Visual smoke check**

Reload, sign in. Expected:
- Nav shows Maintenance but no longer shows Woodmill / Cutting Checks.
- Click Maintenance → dashboard works as before.
- Switch to Cutting team in the team selector → the Daily Pre-use Check button still appears (it's on the team view, not in the deleted Cutting Checks tab) and clicking it still opens the submit modal and saves a record.
- Existing Power Automate daily report (the Azure Function one) continues to work — verify by checking the next-morning email or by manually triggering the function and confirming it pulls from `WMInspections` + `CCInspections` correctly.
- No console errors on tab switches.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat(maintenance): remove standalone Woodmill + Cutting Checks tabs"
```

---

## Task 18: End-to-end smoke + sign-off

This is a non-coding verification task. Run through every scenario from §10 of the spec.

**Files:**
- Modify: `OPEN_ITEMS.md` — add a sign-off line

- [ ] **Step 1: Run each spec scenario and tick if pass / note if fail**

Open the running app, signed in as Jonas:

- [ ] **Cutting submit unchanged** — switch to Cutting team, click "Daily Pre-use Check", submit a check on Pathfinder 1 → `CCInspections` row created → row appears immediately in the Maintenance dashboard's drill-in matrix for today.
- [ ] **BST-day boundary** — in DevTools console, manually POST a test record to a non-prod machine with `InspectedAt = '2026-08-15T22:30:00Z'` (which is 23:30 BST). Refresh the drill-in for 15–16 Aug → the cell appears under **15 Aug**, not 16 Aug. Delete the test record after.
- [ ] **Drill-in filters** — Cutting team, Pathfinder 2 only, range 1 Mar 2026 → 31 Mar 2026 → matrix has only that one machine row, only March columns, only Pathfinder 2 records.
- [ ] **PDF export** — manager-only. PDF opens with logo, doc number, range, summary stats, records table, expanded failures (if any), missed days, signature line. Times displayed in UK local.
- [ ] **CSV export** — manager-only. Opens cleanly in Excel; non-ASCII chars render; embedded commas in operator names quoted correctly.
- [ ] **Yearly add-edit-delete** — drawer flow works; calendar strip + register stay in sync.
- [ ] **Yearly mark complete** — saves history row + updates master `LastDone` and `DocLink`. History expander shows the new row sorted newest-first with a clickable cert link.
- [ ] **Yearly never-inspected** — add a fresh item with no `LastDone` → status = Overdue, calendar marker on current month, tooltip says "Overdue".
- [ ] **Permissions — non-manager** — sign in as a non-manager test account (or use a private window with a non-manager AAD account). Maintenance tab is visible; tile grid + drill-in matrix + register read-only; no gear icon, no export buttons, no Mark/Edit/Delete actions, no Mark not in use button in the cell modal.
- [ ] **Permissions — defence-in-depth** — as non-manager, in DevTools console run `mtState.isManager = true; mtIsManager = true; mtSaveYearly(null)` (after filling form fields). The Graph PATCH/POST should still fail with 403 because the SharePoint List permissions reject non-QHSE accounts.
- [ ] **New team plug-in** — after Task 16's Development team has machines, the team tile, drill-in, and exports work without touching anything else.
- [ ] **Empty range** — drill-in 1 Jan 2024 → 2 Jan 2024 (no data) → empty state on matrix; PDF + CSV still produce valid (mostly-empty) reports.
- [ ] **Downtime marking** — manager opens cell modal on a blank cell, clicks "Mark not in use" → cell turns grey "—" without page reload. Click again → "Clear not in use" → cell goes blank.
- [ ] **GMT/BST switchover (last Sunday October 2026)** — run the BST boundary test again with `InspectedAt` straddling 02:00 BST = 01:00 GMT. Cell lands on the right UK day.

- [ ] **Step 2: Update `OPEN_ITEMS.md`**

Open `OPEN_ITEMS.md`. Add a brief entry under whatever the most recent section is:

```markdown
## 2026-04-?? — Maintenance dashboard

- Replaces Woodmill + Cutting Checks tabs.
- New SharePoint Lists: `DEVInspections`, `DEVDowntime`, `MaintenanceYearly`, `MaintenanceYearlyHistory`.
- Manager-gated: yearly edits, downtime marking, audit exports.
- Spec: `docs/superpowers/specs/2026-04-27-maintenance-dashboard-design.md`
- Plan: `docs/superpowers/plans/2026-04-27-maintenance-dashboard.md`
- Outstanding: Sewing / Foam / Upholstery / Assembly machine lists pending Jonas's confirmation.
```

- [ ] **Step 3: Commit**

```bash
git add OPEN_ITEMS.md
git commit -m "docs: maintenance dashboard sign-off + open items entry"
```

---

## Self-review against the spec

Run a final check against `docs/superpowers/specs/2026-04-27-maintenance-dashboard-design.md`. Every section should map to at least one task here:

| Spec section | Covered by |
|---|---|
| §3 Architecture | Tasks 2, 3, 7 |
| §4 Data model & adapter | Tasks 0, 3, 5, 6 |
| §4.5 Timezone invariants | Task 5 (helpers) and Task 18 (boundary tests) |
| §5 Daily Pre-use sub-tab | Tasks 8, 9, 10 |
| §6 Yearly sub-tab | Tasks 13, 14, 15 |
| §7 Audit report | Tasks 11, 12 |
| §8 Permissions | Task 4 (flag wiring); manager checks throughout Tasks 10, 11, 12, 14, 15 |
| §9 Migration & rollout | Tasks 0 (manual SP setup), 16 (Development team), 17 (cut-over) |
| §10 Test scenarios | Task 18 |
| §11 Out of scope | n/a — explicitly excluded |
| §12 Visual reference | `maintenance-dashboard-mockup.html` already in repo (committed in spec commit) |

No gaps. No placeholders. Ready to execute.
