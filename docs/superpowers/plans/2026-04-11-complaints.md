# Customer Complaint Investigation System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Complaints tab to RepNet that surfaces "Inside 30 Day" entries from the REPO-Q006 SharePoint Excel, lets Jonas assign investigators, lets investigators fill in a digital PHCIRP-0038 form with wet-style canvas signatures, and exports a PDF for auditors.

**Architecture:** Single-file vanilla JS app (`index.html`). All new code follows the existing pattern: view HTML added as a `.view` div, CSS added in the `<style>` block, JS added before the closing `</script>`. Data comes from two sources: the REPO-Q006 Excel file (read via Graph API workbook endpoint using a sharing URL) and a new SharePoint list `ComplaintInvestigations` (read/written via the existing `getSpSiteId()` + `graphGet/graphPost/PATCH` helpers). Both are joined in the browser by TicketNo. A canvas-based signature pad (vanilla JS, no library) captures wet-style signatures as base64 PNG. PDF export uses `window.print()` with a `@media print` stylesheet.

**Tech Stack:** Vanilla JS, Microsoft Graph API (Excel REST + SharePoint Lists), `@media print` CSS, HTML Canvas for signatures.

---

## Prerequisites (implementer must verify before starting code)

Before writing any code, confirm these are in place with Jonas:

**1. SharePoint list `ComplaintInvestigations` must exist on the Planning site** (`/sites/ReposeFurniture-PlanningRepose`). It needs these columns (create in SharePoint → Site Contents → New List → Blank):

| Column name | Type |
|---|---|
| TicketNo | Single line of text |
| Status | Single line of text |
| InvestigatorName | Single line of text |
| InvestigatorEmail | Single line of text |
| AssignedDate | Single line of text |
| ConcernType | Single line of text |
| ReportedBy | Single line of text |
| Section1 | Multiple lines of text (Plain text) |
| Section2 | Multiple lines of text (Plain text) |
| Section3 | Multiple lines of text (Plain text) |
| Section4 | Multiple lines of text (Plain text) |
| Section5 | Multiple lines of text (Plain text) |
| Section6 | Multiple lines of text (Plain text) |
| Section7 | Multiple lines of text (Plain text) |
| FiveWhys | Multiple lines of text (Plain text) |
| ActionsLog | Multiple lines of text (Plain text) |
| InvestigatorSignature | Multiple lines of text (Plain text) |
| InvestigatorSignedDate | Single line of text |
| ManagerSignature | Multiple lines of text (Plain text) |
| ManagerSignedDate | Single line of text |
| ClosedDate | Single line of text |

**2. The ticketing log URL** (already confirmed):
```
https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCQUvM2uD-pQKc9xRkYAfPvAbOaZl0j9liSrWaggTqF60Y?e=6x2dNE
```

---

## File Map

Only one file is modified: `C:\Users\jonas.simonaitis\.local\bin\index.html`

| What | Where in file | Task |
|---|---|---|
| `CP_TICKETING_LOG_URL` constant + state vars | Near line 2589 (after `OV_LOAD_PLAN_URL`) | 1 |
| `cpIsManager` set in `updateAuthBadge()` | Near line 5545 | 1 |
| Nav button (after Near Misses, line 1842) | Line 1843 | 1 |
| NAV_LABELS + showView hook | Lines 2651, 2672 | 1 |
| `.cp-*` CSS + `@media print` | Before `</style>` at line 1792 | 3 |
| `<div class="view" id="view-complaints">` | After line 2271 (end of view-timing) | 2 |
| Assign investigator modal | After view-complaints div | 2 |
| `cpLoadData()` | Before `</script>` at line 10959 | 4 |
| `cpOnOpen()`, `cpSetFilter()`, `cpRenderList()` helpers | Before `</script>` | 5 |
| `cpOpenAssignModal()`, `cpCloseAssignModal()`, `cpAssignInvestigator()` | Before `</script>` | 6 |
| `cpOpenInvestigation()`, `cpBackToList()`, `cpRenderForm()`, `cpRenderFiveWhys()`, `cpActionsRow()`, `cpAddActionsRow()`, `cpRemoveActionsRow()`, `cpRenderSignatureBlocks()` | Before `</script>` | 7 |
| `cpSaveForm()` | Before `</script>` | 8 |
| `cpInitSignaturePad()`, `cpClearCanvas()`, `cpIsCanvasEmpty()`, `cpSubmitInvestigatorSignature()`, `cpSubmitManagerSignature()` | Before `</script>` | 9 |
| `cpExportPdf()` | Before `</script>` | 10 |

---

## Task 1: Constants, state, nav button, routing

**Files:**
- Modify: `index.html` (lines ~1842, ~2589, ~2651, ~2672, ~5545)

- [ ] **Step 1: Add the ticketing log URL constant and module-level state**

Find this line (~2589):
```js
const OV_LOAD_PLAN_URL   = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQD9dpVpE09LQZxBDPGSZhjTAacK5LMWwZgyKBDfcUOJ2vM?e=8iqRn3';
```

Insert **after** it:
```js
const CP_TICKETING_LOG_URL = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCQUvM2uD-pQKc9xRkYAfPvAbOaZl0j9liSrWaggTqF60Y?e=6x2dNE';
const COMPLAINTS_MANAGERS  = new Set(['jonas.simonaitis@reposefurniture.co.uk']);

let cpComplaints    = [];       // joined Excel + SharePoint data, populated by cpLoadData()
let cpActiveFilter  = 'all';   // 'all' | 'open' | 'inprogress' | 'pending' | 'closed'
let cpActiveTicket  = null;    // TicketNo of currently open investigation form
let cpIsManager     = false;   // true when signed-in user is in COMPLAINTS_MANAGERS
```

- [ ] **Step 2: Set cpIsManager in updateAuthBadge()**

Find these lines (~5545) inside `updateAuthBadge()`:
```js
    const TIMING_ALLOWED = new Set(['jonas.simonaitis@reposefurniture.co.uk','richard.semmens@reposefurniture.co.uk']);
    const timingBtn = document.getElementById('timing-tab-btn');
    if (timingBtn) timingBtn.style.display = TIMING_ALLOWED.has(graphAccount.username.toLowerCase()) ? '' : 'none';
```

Insert **after** those three lines:
```js
    cpIsManager = COMPLAINTS_MANAGERS.has(graphAccount.username.toLowerCase());
```

- [ ] **Step 3: Add Complaints nav button**

Find this line (~1842):
```html
        <button class="nav-item" data-view="safety" onclick="navTo('safety')">Near Misses</button>
```

Insert **after** it:
```html
        <button class="nav-item" data-view="complaints" onclick="navTo('complaints')">Complaints</button>
```

- [ ] **Step 4: Add to NAV_LABELS and showView()**

Find the NAV_LABELS object (~2651):
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues','safety':'Safety','ordercheck':'Order Check','timing':'Job Timing' };
```

Replace it with (add `'complaints':'Complaints'`):
```js
const NAV_LABELS = { 'team-select':'Team View','tracker':'Team View','overview':'Load Plan','loadsheet':'Delivery','production':'Production Plan','stats':'Stats','issues':'Issues','safety':'Safety','ordercheck':'Order Check','timing':'Job Timing','complaints':'Complaints' };
```

Then find this line (~2672):
```js
  if (name === 'timing')      { tmOnOpen(); }
```

Insert **after** it:
```js
  if (name === 'complaints')  { cpOnOpen(); }
```

- [ ] **Step 5: Verify nav wiring**

Open `index.html` in a browser, sign in, click Complaints. Expected: the page tries to navigate but crashes with `cpOnOpen is not defined` (function not written yet — this confirms routing is wired correctly). If the nav button does not appear or clicking it does nothing, recheck steps 3 and 4.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: wire Complaints nav, constants, state"
```

---

## Task 2: View HTML — list view, form container, assign modal

**Files:**
- Modify: `index.html` (after line 2271, before `<div class="toasts"`)

- [ ] **Step 1: Add view-complaints div and assign modal**

Find this exact line (~2273):
```html
<div class="toasts" id="toasts"></div>
```

Insert **before** it:
```html
<!-- ═══════════════════════════════════════════════
     VIEW: COMPLAINTS
════════════════════════════════════════════════ -->
<div class="view" id="view-complaints">
  <!-- LIST SUBVIEW -->
  <div id="cp-list-view" class="cp-list-wrap">
    <div class="cp-list-header">
      <div class="cp-title">Customer Complaints</div>
      <div class="cp-chips" id="cp-filter-chips">
        <button class="cp-chip active" onclick="cpSetFilter(this,'all')">All</button>
        <button class="cp-chip" onclick="cpSetFilter(this,'open')">Open</button>
        <button class="cp-chip" onclick="cpSetFilter(this,'inprogress')">In Progress</button>
        <button class="cp-chip" onclick="cpSetFilter(this,'pending')">Pending</button>
        <button class="cp-chip" onclick="cpSetFilter(this,'closed')">Closed</button>
        <button class="cp-refresh-btn" onclick="cpOnOpen()" title="Refresh">↻</button>
      </div>
    </div>
    <div class="cp-table-wrap">
      <table class="cp-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Customer</th>
            <th>Model</th>
            <th>Opened</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="cp-tbody"></tbody>
      </table>
    </div>
  </div>
  <!-- FORM SUBVIEW -->
  <div id="cp-form-view" class="cp-form-wrap" style="display:none">
    <div id="cp-form-inner"></div>
  </div>
</div>

<!-- Assign investigator modal -->
<div id="cp-assign-modal" class="cp-modal-overlay" style="display:none" onclick="if(event.target===this)cpCloseAssignModal()">
  <div class="cp-modal-box">
    <div class="cp-modal-title">Assign Investigator — <span id="cp-assign-ticket"></span></div>
    <div class="cp-modal-field">
      <label class="cp-modal-label">Investigator Name</label>
      <input id="cp-assign-name" class="cp-modal-input" type="text" placeholder="Full name">
    </div>
    <div class="cp-modal-field">
      <label class="cp-modal-label">Investigator Email</label>
      <input id="cp-assign-email" class="cp-modal-input" type="email" placeholder="email@reposefurniture.co.uk">
    </div>
    <div class="cp-modal-actions">
      <button class="cp-modal-cancel" onclick="cpCloseAssignModal()">Cancel</button>
      <button class="cp-modal-confirm" onclick="cpAssignInvestigator()">Assign</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Verify HTML renders**

Open in browser, click Complaints. Expected: view appears with empty table skeleton (no crash). If `view-complaints` is missing, check the insertion point.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Complaints view HTML and assign modal"
```

---

## Task 3: CSS — screen styles and print styles

**Files:**
- Modify: `index.html` (`<style>` block, before `</style>` at line 1792)

- [ ] **Step 1: Add all .cp-* screen CSS**

Find `</style>` (~line 1792) and insert **before** it:

```css
/* ─── COMPLAINTS ─────────────────────────────── */
.cp-list-wrap       { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.cp-list-header     { background:var(--bg2); border-bottom:1px solid var(--border); padding:10px 14px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
.cp-title           { font-size:15px; font-weight:700; color:var(--text1); }
.cp-chips           { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.cp-chip            { font-family:inherit; font-size:12px; font-weight:600; padding:5px 12px; border-radius:20px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.cp-chip:hover      { background:var(--bg4,#2a2a3a); color:var(--text1); }
.cp-chip.active     { background:var(--repose-blue); color:#fff; border-color:var(--repose-blue); }
.cp-refresh-btn     { margin-left:auto; font-family:inherit; font-size:14px; padding:4px 10px; border-radius:7px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.cp-table-wrap      { flex:1; overflow-y:auto; padding:0 14px 14px; }
.cp-table           { width:100%; border-collapse:collapse; margin-top:8px; }
.cp-table th        { font-size:11px; font-weight:700; color:var(--text2); text-transform:uppercase; letter-spacing:.05em; padding:6px 8px; border-bottom:1.5px solid var(--border); text-align:left; }
.cp-table td        { font-size:13px; color:var(--text1); padding:8px 8px; border-bottom:1px solid var(--border); }
.cp-table tbody tr:hover { background:var(--bg2); }
.cp-empty           { text-align:center; padding:32px; font-size:14px; color:var(--text2); }
.cp-badge           { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; }
.cp-badge-open      { background:#1e3a5f; color:#60a5fa; }
.cp-badge-inprogress{ background:#3b2a00; color:#f59e0b; }
.cp-badge-pending   { background:#2d1a00; color:#fb923c; }
.cp-badge-closed    { background:#0a2e1a; color:#4ade80; }
.cp-action-btn      { font-family:inherit; font-size:12px; font-weight:600; padding:4px 10px; border-radius:6px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text1); cursor:pointer; white-space:nowrap; }
.cp-action-btn:hover{ background:var(--bg4,#2a2a3a); }
.cp-action-btn-green{ background:#059669; color:#fff; border-color:#059669; }
.cp-action-btn-green:hover { background:#047857; }

/* Form view */
.cp-form-wrap       { height:100%; overflow-y:auto; padding:16px 20px 40px; }
.cp-form-back-row   { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
.cp-back-btn        { font-family:inherit; font-size:13px; padding:6px 12px; border-radius:7px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.cp-back-btn:hover  { color:var(--text1); }
.cp-save-btn        { font-family:inherit; font-size:13px; font-weight:600; padding:6px 14px; border-radius:7px; border:none; background:var(--repose-blue); color:#fff; cursor:pointer; }
.cp-pdf-btn         { font-family:inherit; font-size:13px; padding:6px 12px; border-radius:7px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; margin-left:auto; }
.cp-form-title      { font-size:16px; font-weight:700; color:var(--text1); margin-bottom:12px; padding-bottom:8px; border-bottom:2px solid var(--repose-blue); }
.cp-form-meta       { display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; margin-bottom:16px; }
.cp-meta-row        { display:flex; align-items:center; gap:6px; }
.cp-meta-row.cp-meta-desc { grid-column:1/-1; align-items:flex-start; }
.cp-meta-label      { font-size:11px; font-weight:700; color:var(--text2); text-transform:uppercase; min-width:90px; flex-shrink:0; }
.cp-meta-input      { font-family:inherit; font-size:13px; color:var(--text1); background:var(--bg3); border:1px solid var(--border2); border-radius:5px; padding:3px 7px; flex:1; }
.cp-meta-input[readonly] { background:transparent; border-color:transparent; cursor:default; }
.cp-section         { margin-bottom:16px; }
.cp-section-title   { font-size:13px; font-weight:700; color:var(--repose-blue); margin-bottom:6px; }
.cp-section-ta      { width:100%; min-height:80px; font-family:inherit; font-size:13px; color:var(--text1); background:var(--bg3); border:1px solid var(--border2); border-radius:6px; padding:8px; resize:vertical; box-sizing:border-box; }
.cp-section-ta[readonly] { background:var(--bg2); border-color:var(--border); }

/* 5 Whys */
.cp-whys            { margin-top:10px; }
.cp-whys-title      { font-size:12px; font-weight:700; color:var(--text2); text-transform:uppercase; margin-bottom:6px; }
.cp-whys-table      { width:100%; border-collapse:collapse; }
.cp-whys-table th   { font-size:11px; font-weight:700; color:var(--text2); padding:4px 6px; border:1px solid var(--border); background:var(--bg2); text-align:left; }
.cp-whys-table td   { padding:3px; border:1px solid var(--border); }
.cp-why-input,.cp-why-cause { width:100%; font-family:inherit; font-size:12px; color:var(--text1); background:var(--bg3); border:none; padding:4px 6px; border-radius:4px; box-sizing:border-box; }
.cp-why-input[readonly],.cp-why-cause[readonly] { background:transparent; }

/* Actions Log */
.cp-actions-table   { width:100%; border-collapse:collapse; margin-bottom:8px; }
.cp-actions-table th{ font-size:11px; font-weight:700; color:var(--text2); padding:4px 6px; border:1px solid var(--border); background:var(--bg2); text-align:left; }
.cp-actions-table td{ padding:3px; border:1px solid var(--border); }
.cp-act-input       { width:100%; font-family:inherit; font-size:12px; color:var(--text1); background:var(--bg3); border:none; padding:4px 6px; border-radius:4px; box-sizing:border-box; }
.cp-act-input[readonly] { background:transparent; }
.cp-add-row-btn     { font-family:inherit; font-size:12px; padding:4px 10px; border-radius:6px; border:1.5px dashed var(--border2); background:transparent; color:var(--text2); cursor:pointer; }
.cp-rm-row-btn      { font-family:inherit; font-size:11px; padding:2px 6px; border-radius:4px; border:none; background:transparent; color:var(--text2); cursor:pointer; }
.cp-rm-row-btn:hover{ color:#ef4444; }

/* Signatures */
.cp-sig-section     { border-top:1.5px solid var(--border); padding-top:16px; margin-top:8px; }
.cp-sig-block       { margin-bottom:16px; }
.cp-sig-label       { font-size:12px; font-weight:700; color:var(--text2); margin-bottom:6px; }
.cp-sig-canvas      { display:block; border:1.5px solid var(--border2); border-radius:6px; background:#fff; cursor:crosshair; width:100%; max-width:400px; }
.cp-sig-img         { display:block; max-width:400px; border:1px solid var(--border); border-radius:4px; background:#fff; }
.cp-sig-date        { font-size:11px; color:var(--text2); margin-top:4px; }
.cp-sig-btns        { display:flex; gap:8px; margin-top:8px; }
.cp-sig-clear       { font-family:inherit; font-size:12px; padding:5px 12px; border-radius:6px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.cp-sig-submit      { font-family:inherit; font-size:12px; font-weight:600; padding:5px 14px; border-radius:6px; border:none; background:var(--repose-blue); color:#fff; cursor:pointer; }
.cp-sig-close       { background:#059669; }
.cp-sig-pending     { font-size:12px; color:var(--text2); font-style:italic; }

/* Assign modal */
.cp-modal-overlay   { position:fixed; inset:0; background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; z-index:999; }
.cp-modal-box       { background:var(--bg2); border:1.5px solid var(--border); border-radius:12px; padding:24px; width:320px; max-width:90vw; }
.cp-modal-title     { font-size:15px; font-weight:700; color:var(--text1); margin-bottom:16px; }
.cp-modal-field     { margin-bottom:12px; }
.cp-modal-label     { display:block; font-size:11px; font-weight:700; color:var(--text2); text-transform:uppercase; margin-bottom:4px; }
.cp-modal-input     { width:100%; font-family:inherit; font-size:13px; color:var(--text1); background:var(--bg3); border:1.5px solid var(--border2); border-radius:7px; padding:7px 10px; box-sizing:border-box; }
.cp-modal-actions   { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; }
.cp-modal-cancel    { font-family:inherit; font-size:13px; padding:6px 14px; border-radius:7px; border:1.5px solid var(--border2); background:var(--bg3); color:var(--text2); cursor:pointer; }
.cp-modal-confirm   { font-family:inherit; font-size:13px; font-weight:600; padding:6px 16px; border-radius:7px; border:none; background:var(--repose-blue); color:#fff; cursor:pointer; }
```

- [ ] **Step 2: Add @media print rules**

Immediately after the CSS above (still before `</style>`):

```css
/* ─── PRINT (PDF EXPORT) ─────────────────────── */
@media print {
  @page { size:A4; margin:15mm; }
  body * { visibility:hidden; }
  #view-complaints, #view-complaints * { visibility:visible; }
  #view-complaints { position:fixed; left:0; top:0; width:100%; background:#fff; color:#000; }
  #cp-list-view { display:none !important; }
  #cp-form-view { display:block !important; overflow:visible; }
  .cp-back-btn, .cp-save-btn, .cp-pdf-btn, .cp-refresh-btn,
  .cp-chip, .cp-add-row-btn, .cp-rm-row-btn,
  .cp-sig-btns, #cp-filter-chips { display:none !important; }
  .cp-form-title::before {
    content:'REPOSE FURNITURE\A';
    white-space:pre;
    display:block;
    font-size:14pt;
    font-weight:700;
    margin-bottom:4pt;
  }
  .cp-section-ta { border:1px solid #ccc; min-height:40px; }
  .cp-sig-canvas { display:none; }
  .cp-sig-img    { max-width:200px; }
}
```

- [ ] **Step 3: Verify CSS loads without errors**

Open browser dev tools (F12) → Console. Reload page. Confirm no CSS errors. Click Complaints — list header and empty table should be styled (dark chips, correct layout).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add Complaints CSS and print styles"
```

---

## Task 4: cpLoadData() — read Excel + SharePoint list + join

**Files:**
- Modify: `index.html` (before `</script>` at the end of the file)

- [ ] **Step 1: Add the cpLoadData() function**

Find the very end of the `<script>` block — the last line is `}` closing `tmRender()`, then `</script>`. Insert **before** `</script>`:

```js
// ═══════════════════════════════════════════════
// COMPLAINTS
// ═══════════════════════════════════════════════

// Fetches all "Inside 30" rows from REPO-Q006 Excel (from 01/04/2026) and all
// ComplaintInvestigations SharePoint list items, then joins them by TicketNo.
// Result is stored in cpComplaints — each entry: { TicketNo, Customer, RepNo,
// Model, Description, OpenDate, status, inv } where inv is the SharePoint record or null.
async function cpLoadData() {
  if (!graphAccount) return;
  cpComplaints = [];

  // ── 1. Read Excel via Graph API ───────────────
  const encoded    = encodeSharingUrl(CP_TICKETING_LOG_URL);
  const driveItem  = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
  const driveId    = driveItem.parentReference.driveId;
  const itemId     = driveItem.id;
  const wsName     = encodeURIComponent('TICKET LOG');
  const range      = await graphGet(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${wsName}')/usedRange?$select=values`
  );
  const values = range.values || [];

  // Column indices (0-based): B=1, G=6, H=7, J=9, L=11, N=13, O=14
  const cutoff = new Date(2026, 3, 1); // 2026-04-01
  const excelRows = [];
  for (let i = 0; i < values.length; i++) {
    const row      = values[i];
    const ticketNo = String(row[6] || '').trim();
    if (!ticketNo) continue; // skip header/empty rows
    const colB = String(row[1] || '').trim().toLowerCase();
    if (colB !== 'inside 30') continue;
    const openDate = parseDdmmyyyy(String(row[14] || ''));
    if (!openDate || openDate < cutoff) continue;
    excelRows.push({
      TicketNo:    ticketNo,
      Customer:    String(row[7]  || '').trim(),
      RepNo:       String(row[9]  || '').trim(),
      Model:       String(row[11] || '').trim(),
      Description: String(row[13] || '').trim(),
      OpenDate:    String(row[14] || '').trim(),
    });
  }

  // ── 2. Read ComplaintInvestigations list ──────
  const siteId = await getSpSiteId();
  const listId = await getListIdByName('ComplaintInvestigations');
  const items  = await graphGetAll(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`
  );

  // Build lookup by TicketNo
  const invMap = {};
  for (const item of items) {
    const f = item.fields;
    invMap[String(f.TicketNo || '').trim()] = { _id: item.id, ...f };
  }

  // ── 3. Join ───────────────────────────────────
  cpComplaints = excelRows.map(row => {
    const inv = invMap[row.TicketNo] || null;
    return { ...row, inv, status: inv?.Status || 'Open' };
  });
}
```

- [ ] **Step 2: Test cpLoadData() in the browser console**

Open the browser, sign in, then open DevTools console and run:
```js
await cpLoadData(); console.log(cpComplaints);
```
Expected: array of complaint objects with `TicketNo`, `Customer`, `status` fields. If empty, confirm the Excel has "Inside 30" entries from April 2026 with a value in column G (TicketNo). If an error fires, read the error message — common cause is the sheet name having different casing: try `'Ticket Log'` if `'TICKET LOG'` fails.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add cpLoadData - Excel + SharePoint join"
```

---

## Task 5: cpOnOpen(), cpSetFilter(), cpRenderList() and helpers

**Files:**
- Modify: `index.html` (after `cpLoadData()`)

- [ ] **Step 1: Add cpStatusBadge() and cpActionBtn() helpers**

Insert after `cpLoadData()`:

```js
function cpStatusBadge(status) {
  const map    = { Open:'cp-badge-open', InProgress:'cp-badge-inprogress', PendingClosure:'cp-badge-pending', Closed:'cp-badge-closed' };
  const labels = { Open:'Open', InProgress:'In Progress', PendingClosure:'Pending Sign-off', Closed:'Closed' };
  return `<span class="cp-badge ${map[status]||''}">${labels[status]||status}</span>`;
}

function cpActionBtn(c) {
  if (c.status === 'Open' && cpIsManager)
    return `<button class="cp-action-btn" onclick="cpOpenAssignModal('${escHtml(c.TicketNo)}')">Investigate</button>`;
  if (c.status === 'InProgress')
    return `<button class="cp-action-btn" onclick="cpOpenInvestigation('${escHtml(c.TicketNo)}')">Open</button>`;
  if (c.status === 'PendingClosure' && cpIsManager)
    return `<button class="cp-action-btn cp-action-btn-green" onclick="cpOpenInvestigation('${escHtml(c.TicketNo)}')">Sign Off</button>`;
  if (c.status === 'PendingClosure' || c.status === 'Closed')
    return `<button class="cp-action-btn" onclick="cpOpenInvestigation('${escHtml(c.TicketNo)}')">View</button>`;
  return '';
}
```

- [ ] **Step 2: Add cpRenderList()**

```js
function cpRenderList() {
  const me = (graphAccount?.username || '').toLowerCase();
  let data  = cpComplaints.filter(c => {
    if (cpActiveFilter === 'open')       return c.status === 'Open';
    if (cpActiveFilter === 'inprogress') return c.status === 'InProgress';
    if (cpActiveFilter === 'pending')    return c.status === 'PendingClosure';
    if (cpActiveFilter === 'closed')     return c.status === 'Closed';
    return true; // 'all'
  });
  // Non-managers see only their assigned investigations
  if (!cpIsManager) {
    data = data.filter(c => (c.inv?.InvestigatorEmail || '').toLowerCase() === me);
  }

  const tbody = document.getElementById('cp-tbody');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="cp-empty">No complaints found</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(c => `
    <tr>
      <td>${escHtml(c.TicketNo)}</td>
      <td>${escHtml(c.Customer)}</td>
      <td>${escHtml(c.Model)}</td>
      <td>${escHtml(c.OpenDate)}</td>
      <td>${cpStatusBadge(c.status)}</td>
      <td>${cpActionBtn(c)}</td>
    </tr>`).join('');
}
```

- [ ] **Step 3: Add cpSetFilter() and cpOnOpen()**

```js
function cpSetFilter(btn, filter) {
  document.querySelectorAll('#cp-filter-chips .cp-chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  cpActiveFilter = filter;
  cpRenderList();
}

async function cpOnOpen() {
  // Always show list view when tab opens / refreshes
  document.getElementById('cp-list-view').style.display  = '';
  document.getElementById('cp-form-view').style.display  = 'none';
  cpActiveTicket = null;
  document.getElementById('cp-tbody').innerHTML =
    '<tr><td colspan="6" class="cp-empty">Loading…</td></tr>';
  try {
    await cpLoadData();
  } catch (e) {
    toast('Failed to load complaints: ' + e.message, 'e');
    document.getElementById('cp-tbody').innerHTML =
      `<tr><td colspan="6" class="cp-empty">Error loading data</td></tr>`;
    return;
  }
  cpRenderList();
}
```

- [ ] **Step 4: Verify list renders**

Open RepNet → Complaints. Expected: "Loading…" briefly, then the complaints table renders. Status badges and action buttons should be visible. Clicking a chip filters the list. If the table is empty, check cpComplaints in the console — if populated, the filter chips might be hiding everything; try clicking "All".

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add cpRenderList, cpOnOpen, cpSetFilter"
```

---

## Task 6: Assign investigator modal

**Files:**
- Modify: `index.html` (after `cpOnOpen()`)

- [ ] **Step 1: Add cpOpenAssignModal(), cpCloseAssignModal(), cpAssignInvestigator()**

```js
function cpOpenAssignModal(ticketNo) {
  cpActiveTicket = ticketNo;
  document.getElementById('cp-assign-ticket').textContent = ticketNo;
  document.getElementById('cp-assign-name').value  = '';
  document.getElementById('cp-assign-email').value = '';
  document.getElementById('cp-assign-modal').style.display = '';
}

function cpCloseAssignModal() {
  document.getElementById('cp-assign-modal').style.display = 'none';
  cpActiveTicket = null;
}

async function cpAssignInvestigator() {
  const name  = document.getElementById('cp-assign-name').value.trim();
  const email = document.getElementById('cp-assign-email').value.trim().toLowerCase();
  if (!name)  { toast('Investigator name is required', 'e'); return; }
  if (!email) { toast('Investigator email is required', 'e'); return; }
  if (!cpActiveTicket) return;

  const today  = new Date();
  const dd     = String(today.getDate()).padStart(2, '0');
  const mm     = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy   = today.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;

  try {
    const siteId = await getSpSiteId();
    const listId = await getListIdByName('ComplaintInvestigations');
    await graphPost(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`, {
      fields: {
        TicketNo:              cpActiveTicket,
        Status:                'InProgress',
        InvestigatorName:      name,
        InvestigatorEmail:     email,
        AssignedDate:          dateStr,
        ConcernType:           '',
        ReportedBy:            '',
        Section1:              '', Section2: '', Section3: '', Section4: '',
        Section5:              '', Section6: '', Section7: '',
        FiveWhys:              JSON.stringify({
          why1:'', why2:'', why3:'', why4:'', why5:'',
          causes:[['','','',''],['','','',''],['','','',''],['','','',''],['','','','']]
        }),
        ActionsLog:            JSON.stringify([]),
        InvestigatorSignature: '', InvestigatorSignedDate: '',
        ManagerSignature:      '', ManagerSignedDate:      '',
        ClosedDate:            '',
      }
    });
    toast('Investigator assigned');
    cpCloseAssignModal();
    await cpOnOpen(); // reload list
  } catch (e) {
    toast('Error assigning investigator: ' + e.message, 'e');
  }
}
```

- [ ] **Step 2: Verify assign flow**

As Jonas: click "Investigate" on an Open complaint → modal appears → fill name + email → click Assign. Expected: modal closes, list reloads, row now shows "In Progress" badge with "Open" button. Check the ComplaintInvestigations list in SharePoint to confirm the record was created.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add assign investigator modal and POST flow"
```

---

## Task 7: Investigation form rendering

**Files:**
- Modify: `index.html` (after `cpAssignInvestigator()`)

- [ ] **Step 1: Add cpRenderFiveWhys() helper**

```js
function cpRenderFiveWhys(fw, editable) {
  const ro = editable ? '' : ' readonly';
  const rows = [1,2,3,4,5].map(i => {
    const causes = (fw.causes?.[i-1] || ['','','','']).map((cv, j) =>
      `<td><input class="cp-why-cause" id="cp-why${i}-cause${j+1}" value="${escHtml(cv)}"${ro}></td>`
    ).join('');
    return `<tr>
      <td><input class="cp-why-input" id="cp-why${i}" value="${escHtml(fw['why'+i]||'')}"${ro}></td>
      ${causes}
    </tr>`;
  }).join('');
  return `
    <div class="cp-whys">
      <div class="cp-whys-title">5 Whys Analysis</div>
      <table class="cp-whys-table">
        <thead><tr>
          <th>Why</th>
          <th>Probable Cause 1</th>
          <th>Probable Cause 2</th>
          <th>Probable Cause 3</th>
          <th>Probable Cause 4</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
```

- [ ] **Step 2: Add cpActionsRow() helper**

```js
function cpActionsRow(row, i, editable) {
  const ro  = editable ? '' : ' readonly';
  const rmBtn = editable
    ? `<td><button class="cp-rm-row-btn" onclick="cpRemoveActionsRow(this)">✕</button></td>`
    : '';
  return `<tr data-row="${i}">
    <td><input class="cp-act-input" name="initiative"     value="${escHtml(row.initiative||'')}"    ${ro}></td>
    <td><input class="cp-act-input" name="owner"          value="${escHtml(row.owner||'')}"          ${ro}></td>
    <td><input class="cp-act-input" name="targetDate"     value="${escHtml(row.targetDate||'')}"     ${ro}></td>
    <td><input class="cp-act-input" name="completionDate" value="${escHtml(row.completionDate||'')}" ${ro}></td>
    <td><input class="cp-act-input" name="status"         value="${escHtml(row.status||'')}"         ${ro}></td>
    ${rmBtn}
  </tr>`;
}

function cpAddActionsRow() {
  const tbody = document.getElementById('cp-actions-body');
  const i     = tbody.rows.length;
  const tr    = document.createElement('tr');
  tr.dataset.row = i;
  tr.innerHTML = `
    <td><input class="cp-act-input" name="initiative"     value=""></td>
    <td><input class="cp-act-input" name="owner"          value=""></td>
    <td><input class="cp-act-input" name="targetDate"     value=""></td>
    <td><input class="cp-act-input" name="completionDate" value=""></td>
    <td><input class="cp-act-input" name="status"         value=""></td>
    <td><button class="cp-rm-row-btn" onclick="cpRemoveActionsRow(this)">✕</button></td>`;
  tbody.appendChild(tr);
}

function cpRemoveActionsRow(btn) {
  btn.closest('tr').remove();
}
```

- [ ] **Step 3: Add cpRenderSignatureBlocks() helper**

```js
function cpRenderSignatureBlocks(c, inv, me) {
  const isMyInv = (inv.InvestigatorEmail || '').toLowerCase() === me;

  // Investigator block
  let invBlock;
  if (inv.InvestigatorSignature) {
    invBlock = `
      <div class="cp-sig-block">
        <div class="cp-sig-label">Investigator: ${escHtml(inv.InvestigatorName||'')}</div>
        <img class="cp-sig-img" src="${escHtml(inv.InvestigatorSignature)}" alt="Signature">
        <div class="cp-sig-date">Signed: ${escHtml(inv.InvestigatorSignedDate||'')}</div>
      </div>`;
  } else if (c.status === 'InProgress' && isMyInv) {
    invBlock = `
      <div class="cp-sig-block">
        <div class="cp-sig-label">Draw your signature below then click Submit</div>
        <canvas id="cp-inv-sig-canvas" class="cp-sig-canvas" width="600" height="150"></canvas>
        <div class="cp-sig-btns">
          <button class="cp-sig-clear"  onclick="cpClearCanvas('cp-inv-sig-canvas')">Clear</button>
          <button class="cp-sig-submit" onclick="cpSubmitInvestigatorSignature()">Submit Investigation</button>
        </div>
      </div>`;
  } else {
    invBlock = `<div class="cp-sig-pending">Investigator signature: Pending</div>`;
  }

  // Manager block
  let mgrBlock = '';
  if (inv.ManagerSignature) {
    mgrBlock = `
      <div class="cp-sig-block">
        <div class="cp-sig-label">Approved by: Jonas Simonaitis</div>
        <img class="cp-sig-img" src="${escHtml(inv.ManagerSignature)}" alt="Signature">
        <div class="cp-sig-date">Signed: ${escHtml(inv.ManagerSignedDate||'')}</div>
      </div>`;
  } else if (c.status === 'PendingClosure' && cpIsManager) {
    mgrBlock = `
      <div class="cp-sig-block">
        <div class="cp-sig-label">Manager sign-off</div>
        <canvas id="cp-mgr-sig-canvas" class="cp-sig-canvas" width="600" height="150"></canvas>
        <div class="cp-sig-btns">
          <button class="cp-sig-clear"                    onclick="cpClearCanvas('cp-mgr-sig-canvas')">Clear</button>
          <button class="cp-sig-submit cp-sig-close"      onclick="cpSubmitManagerSignature()">Sign &amp; Close</button>
        </div>
      </div>`;
  } else if (c.status !== 'Closed') {
    mgrBlock = `<div class="cp-sig-pending">Manager sign-off: Pending investigator submission</div>`;
  }

  return `
    <div class="cp-section cp-sig-section">
      <div class="cp-section-title">Signatures</div>
      ${invBlock}
      ${mgrBlock}
    </div>`;
}
```

- [ ] **Step 4: Add cpRenderForm(), cpOpenInvestigation(), cpBackToList()**

```js
function cpRenderForm(c) {
  const inv      = c.inv || {};
  const locked   = c.status === 'PendingClosure' || c.status === 'Closed';
  const me       = (graphAccount?.username || '').toLowerCase();
  const isMyInv  = (inv.InvestigatorEmail || '').toLowerCase() === me;
  const editable = !locked && isMyInv;
  const ro       = editable ? '' : ' readonly';

  // Parse stored JSON blobs
  let fiveWhys = { why1:'',why2:'',why3:'',why4:'',why5:'',
    causes:[['','','',''],['','','',''],['','','',''],['','','',''],['','','','']] };
  try { Object.assign(fiveWhys, JSON.parse(inv.FiveWhys || 'null') || {}); } catch(e) {}

  let actionsLog = [];
  try { actionsLog = JSON.parse(inv.ActionsLog || '[]') || []; } catch(e) {}

  const SECTION_LABELS = [
    '', // index 0 unused
    'Problem Description',
    'Immediate Response / Disposition',
    'Containment Actions',
    'Root Cause Analysis',
    'Escape Points',
    'Corrective Actions',
    'Preventative Actions',
  ];

  const sectionsHtml = [1,2,3,4,5,6,7].map(n => `
    <div class="cp-section">
      <div class="cp-section-title">${n}. ${SECTION_LABELS[n]}</div>
      <textarea class="cp-section-ta" id="cp-f-s${n}"${ro}>${escHtml(inv['Section'+n]||'')}</textarea>
      ${n === 4 ? cpRenderFiveWhys(fiveWhys, editable) : ''}
    </div>`).join('');

  const actionsColspan = editable ? '6' : '5';
  const actionsHeader  = editable
    ? '<th>Initiative</th><th>Owner</th><th>Target Date</th><th>Completion Date</th><th>Status</th><th></th>'
    : '<th>Initiative</th><th>Owner</th><th>Target Date</th><th>Completion Date</th><th>Status</th>';

  document.getElementById('cp-form-inner').innerHTML = `
    <div class="cp-form-back-row">
      <button class="cp-back-btn" onclick="cpBackToList()">← Back</button>
      ${editable ? `<button class="cp-save-btn" onclick="cpSaveForm()">💾 Save</button>` : ''}
      <button class="cp-pdf-btn" onclick="cpExportPdf()">⬇ Export PDF</button>
    </div>
    <div class="cp-form-title">Issue Resolution Process — PHCIRP</div>
    <div class="cp-form-meta">
      <div class="cp-meta-row"><span class="cp-meta-label">IRP No</span><span>${escHtml(c.TicketNo)}</span></div>
      <div class="cp-meta-row"><span class="cp-meta-label">Date Opened</span><span>${escHtml(c.OpenDate)}</span></div>
      <div class="cp-meta-row"><span class="cp-meta-label">Customer</span><span>${escHtml(c.Customer)}</span></div>
      <div class="cp-meta-row"><span class="cp-meta-label">REP No</span><span>${escHtml(c.RepNo)}</span></div>
      <div class="cp-meta-row"><span class="cp-meta-label">Model</span><span>${escHtml(c.Model)}</span></div>
      <div class="cp-meta-row"><span class="cp-meta-label">Concern Type</span>
        <input class="cp-meta-input" id="cp-f-concern" value="${escHtml(inv.ConcernType||'')}"${ro}></div>
      <div class="cp-meta-row"><span class="cp-meta-label">Reported By</span>
        <input class="cp-meta-input" id="cp-f-reported-by" value="${escHtml(inv.ReportedBy||'')}"${ro}></div>
      <div class="cp-meta-row cp-meta-desc"><span class="cp-meta-label">Description</span>
        <span>${escHtml(c.Description)}</span></div>
    </div>

    ${sectionsHtml}

    <div class="cp-section">
      <div class="cp-section-title">Actions Log</div>
      <table class="cp-actions-table">
        <thead><tr>${actionsHeader}</tr></thead>
        <tbody id="cp-actions-body">
          ${actionsLog.map((row, i) => cpActionsRow(row, i, editable)).join('')}
        </tbody>
      </table>
      ${editable ? `<button class="cp-add-row-btn" onclick="cpAddActionsRow()">+ Add Row</button>` : ''}
    </div>

    ${cpRenderSignatureBlocks(c, inv, me)}
  `;

  // Initialise signature canvas pads after DOM is ready
  if (editable)                                cpInitSignaturePad('cp-inv-sig-canvas');
  if (cpIsManager && c.status === 'PendingClosure') cpInitSignaturePad('cp-mgr-sig-canvas');
}

function cpOpenInvestigation(ticketNo) {
  const c = cpComplaints.find(x => x.TicketNo === ticketNo);
  if (!c) return;
  cpActiveTicket = ticketNo;
  document.getElementById('cp-list-view').style.display = 'none';
  document.getElementById('cp-form-view').style.display = '';
  cpRenderForm(c);
}

function cpBackToList() {
  document.getElementById('cp-list-view').style.display = '';
  document.getElementById('cp-form-view').style.display = 'none';
  cpActiveTicket = null;
}
```

- [ ] **Step 5: Verify form renders**

Click "Open" on an In Progress investigation. Expected: form view appears with all 7 section textareas, 5 Whys grid, empty Actions Log, and signature block at the bottom. Sections should be editable if signed in as the investigator. If form is blank, add `console.log(c, inv)` inside `cpRenderForm` to debug.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add investigation form rendering"
```

---

## Task 8: cpSaveForm()

**Files:**
- Modify: `index.html` (after `cpBackToList()`)

- [ ] **Step 1: Add cpSaveForm()**

```js
async function cpSaveForm() {
  const c = cpComplaints.find(x => x.TicketNo === cpActiveTicket);
  if (!c || !c.inv) { toast('No active investigation', 'e'); return; }

  // Collect 5 Whys
  const fiveWhys = {
    why1: document.getElementById('cp-why1')?.value || '',
    why2: document.getElementById('cp-why2')?.value || '',
    why3: document.getElementById('cp-why3')?.value || '',
    why4: document.getElementById('cp-why4')?.value || '',
    why5: document.getElementById('cp-why5')?.value || '',
    causes: [1,2,3,4,5].map(i =>
      [1,2,3,4].map(j => document.getElementById(`cp-why${i}-cause${j}`)?.value || '')
    ),
  };

  // Collect Actions Log rows
  const actionsLog = Array.from(
    document.getElementById('cp-actions-body')?.rows || []
  ).map(tr => ({
    initiative:     tr.querySelector('[name=initiative]')?.value     || '',
    owner:          tr.querySelector('[name=owner]')?.value          || '',
    targetDate:     tr.querySelector('[name=targetDate]')?.value     || '',
    completionDate: tr.querySelector('[name=completionDate]')?.value || '',
    status:         tr.querySelector('[name=status]')?.value         || '',
  }));

  const fields = {
    Section1:    document.getElementById('cp-f-s1')?.value         || '',
    Section2:    document.getElementById('cp-f-s2')?.value         || '',
    Section3:    document.getElementById('cp-f-s3')?.value         || '',
    Section4:    document.getElementById('cp-f-s4')?.value         || '',
    Section5:    document.getElementById('cp-f-s5')?.value         || '',
    Section6:    document.getElementById('cp-f-s6')?.value         || '',
    Section7:    document.getElementById('cp-f-s7')?.value         || '',
    ConcernType: document.getElementById('cp-f-concern')?.value    || '',
    ReportedBy:  document.getElementById('cp-f-reported-by')?.value|| '',
    FiveWhys:    JSON.stringify(fiveWhys),
    ActionsLog:  JSON.stringify(actionsLog),
  };

  try {
    const siteId = await getSpSiteId();
    const listId = await getListIdByName('ComplaintInvestigations');
    const token  = await getGraphToken();
    await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${c.inv._id}/fields`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      }
    );
    // Update local cache so re-render doesn't lose edits
    Object.assign(c.inv, fields);
    toast('Saved');
  } catch (e) {
    toast('Save failed: ' + e.message, 'e');
  }
}
```

- [ ] **Step 2: Verify save**

Open an In Progress investigation, type into Section 1, click Save. Expected: "Saved" toast. Reload the page, open the same complaint — the text should still be there (confirm by checking the SharePoint list). If PATCH returns 403, check that the signed-in user has Contribute access to the ComplaintInvestigations list.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add cpSaveForm with PATCH to SharePoint"
```

---

## Task 9: Canvas signature pad and signature submission

**Files:**
- Modify: `index.html` (after `cpSaveForm()`)

- [ ] **Step 1: Add cpInitSignaturePad() and cpClearCanvas() and cpIsCanvasEmpty()**

```js
// Attaches mouse + touch drawing listeners to a canvas element.
// Must be called after the canvas is in the DOM.
function cpInitSignaturePad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  ctx.strokeStyle = '#000080'; // dark navy — visible on white print background
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  function getPos(e) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const src    = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('mousedown',  e => { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('mousemove',  e => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  canvas.addEventListener('mouseup',    () => { drawing = false; });
  canvas.addEventListener('mouseleave', () => { drawing = false; });
  canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); }, { passive:false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive:false });
  canvas.addEventListener('touchend',   () => { drawing = false; });
}

function cpClearCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// Returns true if the canvas has no drawn pixels (all alpha=0)
function cpIsCanvasEmpty(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}
```

- [ ] **Step 2: Add cpSubmitInvestigatorSignature()**

```js
async function cpSubmitInvestigatorSignature() {
  const canvas = document.getElementById('cp-inv-sig-canvas');
  if (!canvas || cpIsCanvasEmpty(canvas)) {
    toast('Please draw your signature first', 'e');
    return;
  }

  const c = cpComplaints.find(x => x.TicketNo === cpActiveTicket);
  if (!c || !c.inv) return;

  const sigData = canvas.toDataURL('image/png');
  const now     = new Date();
  const sigDate = [
    String(now.getDate()).padStart(2,'0'),
    String(now.getMonth()+1).padStart(2,'0'),
    now.getFullYear(),
  ].join('/') + ' ' + [
    String(now.getHours()).padStart(2,'0'),
    String(now.getMinutes()).padStart(2,'0'),
  ].join(':');

  try {
    // Save form content first so nothing is lost
    await cpSaveForm();
    const siteId = await getSpSiteId();
    const listId = await getListIdByName('ComplaintInvestigations');
    const token  = await getGraphToken();
    await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${c.inv._id}/fields`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Status:'PendingClosure', InvestigatorSignature:sigData, InvestigatorSignedDate:sigDate }),
      }
    );
    Object.assign(c.inv, { Status:'PendingClosure', InvestigatorSignature:sigData, InvestigatorSignedDate:sigDate });
    c.status = 'PendingClosure';
    toast('Investigation submitted — awaiting manager sign-off');
    cpRenderForm(c); // re-render: form locks, manager slot appears
  } catch (e) {
    toast('Submit failed: ' + e.message, 'e');
  }
}
```

- [ ] **Step 3: Add cpSubmitManagerSignature()**

```js
async function cpSubmitManagerSignature() {
  const canvas = document.getElementById('cp-mgr-sig-canvas');
  if (!canvas || cpIsCanvasEmpty(canvas)) {
    toast('Please draw your signature first', 'e');
    return;
  }

  const c = cpComplaints.find(x => x.TicketNo === cpActiveTicket);
  if (!c || !c.inv) return;

  const sigData    = canvas.toDataURL('image/png');
  const now        = new Date();
  const sigDate    = [
    String(now.getDate()).padStart(2,'0'),
    String(now.getMonth()+1).padStart(2,'0'),
    now.getFullYear(),
  ].join('/') + ' ' + [
    String(now.getHours()).padStart(2,'0'),
    String(now.getMinutes()).padStart(2,'0'),
  ].join(':');
  const closedDate = [
    String(now.getDate()).padStart(2,'0'),
    String(now.getMonth()+1).padStart(2,'0'),
    now.getFullYear(),
  ].join('/');

  try {
    const siteId = await getSpSiteId();
    const listId = await getListIdByName('ComplaintInvestigations');
    const token  = await getGraphToken();
    await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${c.inv._id}/fields`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Status:'Closed', ManagerSignature:sigData, ManagerSignedDate:sigDate, ClosedDate:closedDate }),
      }
    );
    Object.assign(c.inv, { Status:'Closed', ManagerSignature:sigData, ManagerSignedDate:sigDate, ClosedDate:closedDate });
    c.status = 'Closed';
    toast('Complaint closed');
    cpRenderForm(c); // re-render: both signatures now show as images
  } catch (e) {
    toast('Sign-off failed: ' + e.message, 'e');
  }
}
```

- [ ] **Step 4: Verify investigator signature flow**

Sign in as the investigator → open an In Progress investigation → draw on the signature canvas → click "Submit Investigation". Expected:
- "Saved" toast fires first
- "Investigation submitted" toast fires
- Form re-renders: textareas become read-only, investigator signature appears as an image, manager slot shows "Pending manager sign-off"
- Status in SharePoint list is now `PendingClosure`

- [ ] **Step 5: Verify manager signature flow**

Sign in as Jonas → open the Pending complaint → manager signature canvas appears → draw → click "Sign & Close". Expected:
- "Complaint closed" toast
- Both signatures render as images
- Status in SharePoint is `Closed`

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: canvas signature pad and submission flows"
```

---

## Task 10: PDF export

**Files:**
- Modify: `index.html` (after `cpSubmitManagerSignature()`)

- [ ] **Step 1: Add cpExportPdf()**

```js
function cpExportPdf() {
  window.print();
}
```

- [ ] **Step 2: Verify print output**

Open a complaint form (any status) and click "Export PDF". Expected:
- Browser print dialog opens
- Only the form content is visible on A4 — no nav, no chips, no back/save/PDF buttons
- "REPOSE FURNITURE" appears above "Issue Resolution Process — PHCIRP" (from the CSS `::before` pseudo-element)
- All sections are visible, actions log rows show
- Signature images appear (or "Pending" text if not yet signed)

If the nav bar is still visible in print preview, verify `@media print` rules are in the `<style>` block (not inside a `.view` rule).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add cpExportPdf - window.print PDF export"
```

---

## Self-Review Checklist

Before declaring done, verify each spec section has a corresponding task:

| Spec section | Covered by |
|---|---|
| Access control — manager sees all, others see own | Task 5 (cpRenderList) |
| Status flow Open→InProgress→PendingClosure→Closed | Tasks 6, 9 |
| Excel read — Inside 30, from 01/04/2026 | Task 4 |
| SharePoint list ComplaintInvestigations | Prerequisite + Tasks 6, 8, 9 |
| Complaints nav button, visible to all | Task 1 |
| List view with filter chips | Tasks 2, 5 |
| Assign investigator modal | Task 6 |
| Investigation form — all 7 sections | Task 7 |
| 5 Whys grid | Task 7 |
| Actions Log + add/remove rows | Task 7, 8 |
| Signature pad (investigator) | Task 9 |
| Signature pad (manager) | Task 9 |
| PDF export, A4, print CSS | Tasks 3, 10 |
