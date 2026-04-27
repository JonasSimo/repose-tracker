# Maintenance Dashboard — Design Spec

**Date:** 2026-04-27
**Author:** Jonas Simonaitis (QHSE Manager) with Claude
**Status:** Approved — ready for implementation plan

## 1. Purpose

Replace the existing **Woodmill** and **Cutting Checks** tabs with a single unified **Maintenance** tab covering:

1. **Daily Pre-use Checks** for every team that operates machinery (Woodmill, Cutting, Sewing, Foam, Upholstery, Assembly, Development).
2. **Yearly / Statutory inspections** for the site (LOLER, PAT, F-gas, fire alarm, fire risk assessment, insurance inspections, annual servicing, etc.) with links to certificates stored in SharePoint.

Primary use cases:

- **Floor/manager glance** — at-a-glance status of today's pre-use checks across all teams.
- **Audit** — pull historical pre-use check data filtered by team, machine, and custom date range, and export an auditor-ready PDF + Excel report.
- **Statutory compliance** — visual 12-month timeline of upcoming/overdue inspections, with full history of past completions and direct links to saved certs.

## 2. Decisions log

| Topic | Decision |
|---|---|
| Visual style | Direction A — light, soft, modern "Operations Hub" (light cards on subtle gradient, navy hero strip, soft progress bars, status pills). Uses existing Repose palette (`--repose-blue` `#14a1e9`, `--repose-navy` `#0e023a`, `--repose-grey` `#706f6f`). Static mockup at `maintenance-dashboard-mockup.html` is the visual reference. |
| Tab structure | One top-level **Maintenance** tab replaces the current Woodmill + Cutting Checks tabs in `NAV_LABELS` / `_VALID_TABS`. |
| Sub-tabs | **Daily Pre-use** and **Yearly / Statutory**, lazily rendered. |
| Scope (daily) | All 7 teams: Woodmill, Cutting, Sewing, Foam, Upholstery, Assembly, Development. v1 launches with Woodmill + Cutting + Development. Other teams added as their machine lists + check items are confirmed. |
| Operator submit (Cutting) | Existing team-view "Daily Pre-use Check" button (`ccOpenSubmitModal()`) stays unchanged. |
| Operator submit (other teams) | Submit via QR codes (existing `qr-codes.html` workflow) — no team-view button. |
| Drill-in | Filter by team / machine / custom date range; renders a machine × date matrix; click cell → record modal. |
| Audit report | **PDF + Excel** export, manager-gated. Contents: Repose logo + doc number + date range + filter summary; one row per check (date, time, machine, operator, pass/fail, comments); summary stats; expanded failures with specific failed check items + comments; signature line; missed-days list. |
| Yearly view | Register table **plus** mini 12-month calendar strip (option D from the Q6 options). |
| Yearly data source | New SharePoint Lists `MaintenanceYearly` (register) + `MaintenanceYearlyHistory` (one row per completed inspection). In-app manager edit UI (gear icon, side-drawer) writes to both. |
| Permissions | Hybrid. View public; **only the QHSE Managers Entra ID group** can edit yearly items, mark complete, and export audit reports. |
| Architecture | Approach 3 — adapter layer over per-team SharePoint Lists. Zero migration. |

## 3. Architecture

### 3.1 Top-level

A single new view in `index.html`, `view-maintenance`, registered in:

- `NAV_LABELS` — `'maintenance':'Maintenance'`
- `_VALID_TABS` — add `'maintenance'`
- The two `_validViews` sets at lines 6194 and 6686 — add `'maintenance'`
- A new nav button replacing the existing Woodmill nav button

`view-woodmill` and `view-cutting-checks` are removed from nav and their `<div>`s deleted from HTML. Their submit/render code (`wmRender*`, `ccRender*`, `wmLoadData`, `ccLoadData`) is removed. The Cutting team-view button at line 3585 (`ccOpenSubmitModal()`) is **kept**.

### 3.2 Module layout (vanilla JS, no framework)

A single namespace at the top of the maintenance code block:

```js
const Maintenance = {};      // namespace, optional — can also be flat mt* fns

// State
let mtState = {
  subTab: 'daily',                       // 'daily' | 'yearly'
  filters: { teamIds:[], machineIds:[], dateFrom:null, dateTo:null },
  records: [],                           // normalised daily records in current range
  yearlyItems: [],                       // MaintenanceYearly list rows
  yearlyHistory: [],                     // MaintenanceYearlyHistory list rows
  loaded: { daily:false, yearly:false },
  isManager: false,                      // mirrors QHSE Managers group membership
};

// Adapter (Section 4)
async function mtAdapterLoadRange(teamIds, dateFrom, dateTo) { ... }
async function mtAdapterLoadYearly() { ... }
async function mtAdapterWriteYearlyItem(payload) { ... }
async function mtAdapterCompleteYearly(itemId, completionPayload) { ... }

// Render
function mtRender() { ... }              // top-level — picks sub-tab
function mtRenderDailyLanding() { ... }
function mtRenderDailyDrillIn() { ... }
function mtRenderYearly() { ... }
function mtRenderYearlyEditDrawer() { ... }

// Actions
function mtExportPdf() { ... }
function mtExportCsv() { ... }
function mtOnOpen(forceRefresh=false) { ... }
```

### 3.3 `MT_TEAMS` registry

Single source of truth for what teams the dashboard knows about:

```js
const MT_TEAMS = [
  { id:'woodmill',    name:'Woodmill',    icon:'🪵', listName:'WMInspections',  downtimeList:'WMDowntime',  machines: WM_MACHINES,  siteResolver: wmGetSiteId },
  { id:'cutting',     name:'Cutting',     icon:'✂️', listName:'CCInspections',  downtimeList:null,           machines: CC_MACHINES,  siteResolver: ccGetSiteId },
  { id:'development', name:'Development', icon:'🧪', listName:'DEVInspections', downtimeList:'DEVDowntime', machines: DEV_MACHINES, siteResolver: mtGetDefaultSiteId },
  // sewing, foam, upholstery, assembly added later
];
```

Adding a future team is one new `MACHINES` constant + one new SharePoint List + one entry in `MT_TEAMS`. Zero changes elsewhere.

## 4. Data model & adapter

### 4.1 SharePoint Lists

| List | Status | Used for |
|---|---|---|
| `WMInspections` | existing | Woodmill daily checks |
| `WMDowntime` | existing | Woodmill not-in-use markings |
| `CCInspections` | existing | Cutting daily checks |
| `DEVInspections` | new | Development daily checks |
| `DEVDowntime` | new | Development not-in-use markings |
| `MaintenanceYearly` | new | Yearly register — one row per inspection item |
| `MaintenanceYearlyHistory` | new | One row per completed yearly inspection |

`MaintenanceYearly` columns: `Title` (text, the SP-default Title field), `Category` (choice: Statutory / Annual Servicing / Legal Surveys / Insurance / Other), `Frequency` (choice: Annual / 6-monthly / Quarterly / Monthly / Custom), `FrequencyDays` (number — only used when Frequency = Custom), `LastDone` (date), `DocLink` (text — SharePoint URL of latest cert), `Notes` (multi-line text).

`MaintenanceYearlyHistory` columns: `Title` (text — defaults to `{ItemTitle} {YYYY-MM-DD}` for grep-ability), `ItemId` (number — FK into `MaintenanceYearly` `Id`), `CompletedOn` (date/datetime), `DocLink` (text — SharePoint URL), `Contractor` (text), `Cost` (number, optional), `Notes` (multi-line text), `CompletedBy` (text — display name).

### 4.2 Normalised record shape

The adapter emits one shape regardless of which team's list it came from:

```js
{
  teamId:      'woodmill',
  machineId:   'bandsaw',
  machineName: 'Bandsaw',
  dateStr:     '2026-04-27',           // local UK date YYYY-MM-DD via wmDateStr()
  inspectedAt: '2026-04-27T08:42:00Z', // raw ISO from SharePoint, UTC
  status:      'pass' | 'fail' | 'na' | 'downtime' | 'none',
  operator:    'J. Doe',
  items:       [{ label:'…', result:'pass' | 'fail' | 'na' }],
  comment:     '…',
  raw:         { ...spListItemFields },
}
```

### 4.3 Reads

`mtAdapterLoadRange(teamIds, dateFrom, dateTo)` fans out one Graph query per team's list, server-side filtered by `InspectedAt ge … and InspectedAt le …` (UTC ISO range derived from UK day boundaries — see §4.5), normalises, returns one merged sorted array. Site/list IDs cached via the existing `_idCache` localStorage pattern.

`mtAdapterLoadYearly()` loads `MaintenanceYearly` and `MaintenanceYearlyHistory` in parallel; they're keyed by `ItemId` for lookup.

### 4.4 Writes

- Daily-check writes: untouched. Cutting button → `CCInspections`; QR codes → respective per-team list. Dashboard never writes daily-check data.
- Yearly writes (manager-only):
  - Add item → POST `MaintenanceYearly`
  - Edit item → PATCH `MaintenanceYearly/items/{id}`
  - Mark complete → POST `MaintenanceYearlyHistory` **then** PATCH `MaintenanceYearly/items/{id}` to update `LastDone` + `DocLink` to the latest values
  - Delete item → DELETE `MaintenanceYearly/items/{id}` (history rows kept for audit trail; orphaned `ItemId` is fine)

### 4.5 Timezone invariants

UK BST/GMT bites if you don't pin it. Codified rules:

- **Storage** — every `InspectedAt` / `CompletedOn` written is `new Date().toISOString()` (UTC). SharePoint stores DateTime in UTC. Never write a local-time string.
- **Reading** — always `new Date(f.InspectedAt)`; never substring-parse the ISO.
- **Day grouping** — always via `wmDateStr(new Date(f.InspectedAt))` (existing function, uses local components, BST/GMT-safe).
- **Time-of-day display** — `toLocaleTimeString('en-GB', { timeZone:'Europe/London', hour:'2-digit', minute:'2-digit' })`. Pinning timezone explicitly means BST/GMT auto-handled and a manager on a non-UK device still sees UK floor time.
- **Date-input → range** — `<input type="date">` returns `YYYY-MM-DD` in local components; treat as UK day boundaries and convert to UTC range (`00:00 Europe/London → 23:59 Europe/London`) before sending to Graph.
- **Audit report timestamps** — converted to `Europe/London` before formatting.

## 5. Daily Pre-use sub-tab

### 5.1 Landing screen (Direction A)

- Hero strip — gradient navy background, "Today · {date}" eyebrow, "X / Y checks complete" headline, sub-line "N outstanding · M failures flagged", three small stats on the right (Pass / Fail / Pending counts).
- Sub-tab toggle — pill-style "Daily Pre-use" (active) / "Yearly / Statutory".
- Team tile grid (2-column on desktop, 1-column on tablet portrait) — one tile per team in `MT_TEAMS`. Each tile: icon, team name, soft progress bar (checked-vs-expected machines for today), tiny meta line ("16/16 checked · Last 08:42"), status pill (Pass / Fail / Pending) on the right. Tile hover: lift, blue border. Tile click: drill-in.
- Empty state per tile if a team has no machines defined: "No machines registered — pending machine list" (no action; machines are defined in code as `*_MACHINES` constants and added by the developer once Jonas confirms them).

### 5.2 Drill-in

- Header: team name + back arrow.
- Filter bar (sticky):
  - Team selector (multi-select, default this team)
  - Machine selector (multi-select, default All; options scoped to selected teams)
  - Date range — From / To `<input type="date">`, default last 7 days
  - Reset · Refresh buttons
- Stats strip: total checks, % pass, # fails, # not-in-use days, # missed days (these feed the report's summary block).
- Body: machine × date matrix. Rows = machines, columns = dates in selected range.
  - Cells: green ✓ / red ✗ / grey "—" (not in use) / blank (missed)
  - Cell click → modal showing the full record (date, time, operator, every check item with pass/fail, any comments). For blank cells, the modal shows "No record" plus — for managers — a **Mark not in use** / **Clear not in use** toggle that writes to the team's downtime list (`WMDowntime`, `DEVDowntime`, etc.) using the existing `Title = "{machineId}|{dateStr}"` convention; non-Cutting teams without an explicit downtime list still display correctly (status falls back to blank).
- Actions bar (top-right of header): **Export PDF** + **Export Excel/CSV** — hidden for non-managers.
- Loading skeleton on the matrix; empty state if range has zero records ("No checks in this range — try widening the dates"); error toast on Graph 429/5xx with retry.

## 6. Yearly / Statutory sub-tab

### 6.1 Layout (top to bottom)

1. **Mini 12-month calendar strip** — horizontal band starting from current month. Each register item shows as a coloured marker on its `NextDue` month: red = overdue, amber = due in next 90 days, green = OK. Hover tooltip; click jumps to the register row.
2. **Filter chips** — All · Statutory · Annual Servicing · Legal Surveys · Insurance · Overdue · Due Soon · multi-select.
3. **Register table** — columns: Title · Category · Frequency · Last Done · Next Due · Status · Cert · Actions
   - Status: coloured pill (Overdue / Due Soon / OK)
   - Cert: 📎 link icon → opens `DocLink` in new tab
   - History expander (📂) on each row → loads/filters `MaintenanceYearlyHistory` for `ItemId`, sorted newest-first; each history row shows CompletedOn, Contractor, Cost (if any), and a clickable cert link
   - Actions (manager-only): ✏️ Edit · ✓ Mark complete · 🗑 Delete

### 6.2 Status logic (computed, not stored)

```
nextDue   = lastDone + frequencyDays
daysUntil = nextDue - today  (UK day boundary)
status    = 'overdue'   if daysUntil < 0
          : 'due_soon'  if 0 <= daysUntil <= 90
          : 'ok'        otherwise
```

If `LastDone` is null (item just created, never inspected): `status = 'overdue'` and the calendar marker is placed at the current month with a "Never inspected" tooltip.

### 6.3 Manager edit drawer

Gear icon top-right of the sub-tab; visible only when `mtState.isManager` is true.

Side-drawer with two segmented tabs:

- **Add new item** — form: Title, Category, Frequency, FrequencyDays (only when Frequency = Custom), Last Done (date — optional), Doc Link (URL paste), Notes (textarea). Save → POST `MaintenanceYearly`.
- **Manage items** — list of all register items, each with Edit / Delete inline.

A separate **Mark complete** modal opens from the register row's ✓ button:

- Fields: Completion date (default today), Doc link (URL paste — required for audit), Contractor, Cost (optional), Notes.
- Save → POST `MaintenanceYearlyHistory` + PATCH `MaintenanceYearly` with the new `LastDone` and `DocLink`.
- The register row updates in place (no full reload); calendar strip re-renders.

### 6.4 Empty state

Until items are added: friendly card "Add your first inspection item" with a button that opens the edit drawer (if manager) or instructions to ask the QHSE Manager (if not).

## 7. Audit report (PDF + Excel)

Triggered from the drill-in actions bar, manager-only.

### 7.1 Shared content

- **Repose logo bar** — reuse the existing `cp-print-logo-bar` print pattern (logo at left, "QHSE — Maintenance Audit Report" at right, navy bottom border).
- **Doc number** — `REPO-MAINT-AUDIT-{YYYYMMDD-HHMMSS}` generated at export time.
- **Filter summary** — Team(s), Machine(s), Date range (UK local), Generated at (UK local).
- **Summary stats** — Total checks, % pass, # fails, # not-in-use days, # missed days.
- **Per-row checks** — Date · Time · Team · Machine · Operator · Status · Comment.
- **Expanded failures** — for each `fail` row, list the specific check items that failed (`items[].result === 'fail'`) with their labels and any inline comments.
- **Missed days** — for each (machine, day) tuple in range where no record exists and the machine isn't marked downtime: a row "Missed: {date} — {machine}".
- **Signature block** — `Reviewed by: ____________________   Date: __________` at the bottom.

### 7.2 PDF specifics

- Print-only HTML via the existing `@media print` pattern. Generated via `window.print()` against a temporary `view-maint-print` overlay populated from `mtState.records`.
- A4 portrait, 14mm/12mm margins (matches existing complaint export).
- Single document; sections page-break-avoid.
- All times converted to `Europe/London` before printing.

### 7.3 Excel/CSV specifics

- CSV format (zero deps, opens in Excel; auditors filter/sort natively). UTF-8 BOM so Excel recognises non-ASCII characters.
- One file with three logical sections separated by blank rows: filter summary, per-row checks, expanded failures, missed days. Each row CSV-escaped for embedded commas/quotes/newlines.
- Filename: `repose-maintenance-audit-{teamSlug}-{from}_to_{to}.csv`.

## 8. Permissions

- `mtState.isManager` is set the same way `wmIsManager` and the Stats password gate are set today — Entra ID group check on load (group: **QHSE Managers**), with the same fallback Stats already uses.
- **Public (no gate):** Maintenance tab visibility, Daily landing, Daily drill-in matrix, Yearly register read view, Yearly calendar strip, Yearly cert link clicks, Yearly history expander.
- **QHSE Manager only:** Daily audit export buttons (PDF + Excel), Daily Mark/Clear "not in use" toggle in the cell modal (writes to per-team downtime list), Yearly gear icon and edit drawer, Yearly Mark complete / Edit / Delete row actions, all writes to `MaintenanceYearly` + `MaintenanceYearlyHistory`.
- Defence-in-depth: UI hides the buttons; Graph write functions also check `mtState.isManager`. The real backstop is SharePoint List-level permissions — `MaintenanceYearly` and `MaintenanceYearlyHistory` are configured so only the QHSE Managers AAD group has Contribute; everyone else has Read.

## 9. Migration & rollout

Zero data migration. Existing lists (`WMInspections`, `CCInspections`, `WMDowntime`) are read by the adapter as-is.

**Removed:**

- Nav entries for `'woodmill'` and `'cutting-checks'` in `NAV_LABELS` and both `_validViews` sets and `_VALID_TABS`.
- `<div id="view-woodmill">` and `<div id="view-cutting-checks">` and the modals scoped only to those views (the Cutting **submit** modal stays, since Cutting team-view button still calls `ccOpenSubmitModal()`).
- `wmRender*`, `ccRender*` (dashboard-only render code), `wmOnOpen`, `ccOnOpen` registrations in the `navTo` switch.

**Kept:**

- `WM_MACHINES`, `CC_MACHINES` constants — referenced by `MT_TEAMS`.
- Cutting team-view button at line 3585 — `ccOpenSubmitModal()` flow unchanged, still writes to `CCInspections`.
- All existing Power Automate flows and the Azure Function daily report (which reads from the same lists at lines 11576 / 11581 / 11828 / 11850).
- Existing `_idCache` mechanism — extended with maintenance-related cache keys.

**Added:**

- `view-maintenance` div, `MT_TEAMS`, `mtState`, `mtAdapter*`, `mtRender*`, `mtExport*`.
- `DEV_MACHINES` constant — populated once Jonas confirms Development's machines + check items.
- SharePoint Lists: `DEVInspections`, `DEVDowntime`, `MaintenanceYearly`, `MaintenanceYearlyHistory` (created manually in SharePoint by Jonas, then surfaced in the registry).

**Build order (informs the implementation plan):**

1. Create the four new SharePoint Lists (manual step).
2. Add `MT_TEAMS` registry + `mtAdapter` (read-only, normalised shape).
3. Add `view-maintenance` shell + sub-tab routing + Daily landing screen (team tiles + hero).
4. Add Daily drill-in (filter bar, matrix, cell modal).
5. Add audit export (PDF + CSV, manager-gated).
6. Add Yearly sub-tab (register table + calendar strip + history expander).
7. Add Yearly manager edit drawer (gear icon, manager-gated, writes to both lists).
8. Add Development team — `DEV_MACHINES` + registry entry — once Jonas confirms machines.
9. Remove old tabs from nav, delete the `view-woodmill` + `view-cutting-checks` divs and dashboard-only render code.
10. Smoke test (see §10).

## 10. Test scenarios

These go into the implementation plan as a verification gate before merge.

- **Cutting submit unchanged** — operator on Cutting team view clicks "Daily Pre-use Check" → CCInspections row created → appears in Maintenance dashboard immediately.
- **BST → GMT switchover** — submit a check at 23:30 BST on the last Saturday of October → it appears under that day's column in the matrix, not the next day's.
- **GMT → BST switchover** — submit a check at 00:30 BST on the last Sunday of March → it appears under that day's column.
- **Daily report flow** — existing Azure Function daily report still pulls from WMInspections + CCInspections and reports today's outcomes correctly (no regression in lines 11576 / 11581).
- **Drill-in filters** — picking team Cutting + machine Pathfinder 2 + range 1 Mar–31 Mar returns only Pathfinder 2 records in March.
- **Audit PDF** — export with above filters produces a single-page (or multi-page paginated) PDF with the Repose logo, filter summary, summary stats, per-row table, expanded failures section listing the failed check items with comments, missed-days list, and signature line.
- **Audit CSV** — opens in Excel with no encoding issues; rows match the PDF; embedded commas/quotes in operator names or comments are properly escaped.
- **Yearly mark complete** — user adds an item with `LastDone = 2025-04-27`, frequency Annual; `NextDue = 2026-04-27`, status = "Due Soon" today (zero days). Manager clicks Mark complete with today's date + cert link → register `LastDone` updates to today, `DocLink` updates, `MaintenanceYearlyHistory` has new row, calendar strip re-renders.
- **Yearly history expander** — register row 📎 expander shows every past completion sorted newest-first, each with a clickable cert link.
- **Yearly never inspected** — item created with no `LastDone` shows status Overdue and "Never inspected" tooltip in calendar.
- **Permissions — non-manager** — loads Maintenance tab → tile grid, drill-in matrix, register table, calendar strip all visible. No gear icon, no export buttons, no edit/complete/delete actions.
- **Permissions — defence-in-depth** — non-manager attempts a direct call to `mtAdapterWriteYearlyItem(...)` from devtools → adapter rejects via `mtState.isManager` check; SharePoint List permissions also reject.
- **New team plug-in** — adding `{id:'sewing', …}` to `MT_TEAMS` (with a `SEW_MACHINES` constant + `SewingInspections` list) makes the team tile, drill-in, and exports work without any other code changes.
- **Empty range** — drill-in with a date range containing zero records → empty state on matrix; export still produces a valid (mostly-empty) PDF + CSV with the correct filter summary.
- **Downtime marking** — manager opens cell modal on a blank cell, clicks "Mark not in use" → row added to the team's downtime list with `Title = "{machineId}|{dateStr}"` → cell renders as grey "—" without a page reload; clicking again offers "Clear not in use" which deletes the row.

## 11. Out of scope (deferred)

- Mobile/QR submit UI changes — operator submit flows for non-Cutting teams stay on the existing QR + `qr-codes.html` workflow.
- Migration of historical data into a unified list — adapter pattern means we don't need to.
- Sewing / Foam / Upholstery / Assembly daily-check support — added when Jonas confirms each team's machine list and check items. The architecture supports them with no code changes beyond `MT_TEAMS` + a `*_MACHINES` constant + a SharePoint List.
- Email/Teams alerts on overdue yearly items — possible future enhancement; for v1, the dashboard's calendar strip + status pills are the surfacing mechanism.
- Automatic PAT/LOLER scheduling integration with external systems — not in scope; certs are linked manually via paste-in URL.

## 12. Visual reference

Static mockup of the Daily Pre-use landing screen (Direction A, the chosen style) lives at `maintenance-dashboard-mockup.html` in the project root. Use as the visual reference for tile layout, hero strip, palette, and pill style during implementation.
