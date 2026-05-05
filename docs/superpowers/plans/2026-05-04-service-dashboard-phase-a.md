# Service Dashboard — Phase A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live Service Dashboard tab in RepNet that reads both source spreadsheets via Microsoft Graph Excel REST and lets the team file new tickets / parts dispatches directly in RepNet — without touching the Excel files manually.

**Architecture:** New v4 sidebar entry under a new "Service" group. New `view-service` block in `index.html` with embedded vanilla-JS module. Reads `REPO-Q006 — Repose Ticketing Log V2.xlsx` and `PARTS TRACKER.xlsm` — both on the Service SharePoint site (`/sites/ReposeFurniture-Service`). 5-minute in-browser cache. Writes via Excel REST `tables/rows/add` (atomic row append into Tables, requires one-time SharePoint admin step to convert master sheets to Tables).

**Tech Stack:** Vanilla HTML/CSS/JS (existing RepNet pattern), Microsoft Graph Excel REST API, MSAL.js v3, Bricolage Grotesque + Manrope (v4 design language). No new dependencies. No new SharePoint Lists. Reuses existing `graphGet`, `graphFetchWithRetry`, `getGraphToken`, `encodeSharingUrl`, `getCpSiteId` helpers.

**Spec:** `docs/superpowers/specs/2026-05-04-service-dashboard-design.md`
**Mockup:** `service-dashboard-mockup.html` v0.3
**Phase scope:** A (foundation only) — Phases B–E (returns workflow, integrations, polish) ship as follow-on plans.

**Note on spec correction:** The spec says the Ticketing Log lives on the Quality SharePoint site. The actual file lives on `/sites/ReposeFurniture-Service` — the existing Complaints module already reads it from there via `CP_TICKETING_LOG_URL` (`index.html:4013`) and `getCpSiteId()` (`index.html:7431`). This plan reuses those.

**Verification model:** RepNet has no automated test framework. Verification is browser-based against `?ui=v4` after a hard reload. Each task ends with a commit so progress is recoverable.

**File scope:**
- Modify: `index.html` (~1,200 lines added across the module)
- Modify: `repnet-skin-v4.js` (3-line NAV addition)
- One manual SharePoint admin step (Task 1)

---

## Task 1: One-time SharePoint admin — convert master sheets to Excel Tables

**Files:** No code changes. SharePoint admin work via the browser-version Excel.

**Why:** Graph's Excel REST `tables('TableName').rows/add` endpoint does atomic row append into a defined Excel Table. Without a Table, row append requires manual range calculation (race conditions, off-by-one errors, formula breakage). Converting the master sheets to Excel Tables once makes subsequent write-back bulletproof.

- [ ] **Step 1: Open `REPO-Q006 — Repose Ticketing Log V2.xlsx`**

Navigate in browser to the Service SharePoint site → Documents → open the workbook in Excel for the web. (DO NOT use desktop Excel — desktop edits can lock the file and conflict with Graph writes.)

- [ ] **Step 2: Convert TICKET LOG sheet to a Table**

Click the `TICKET LOG` tab → click cell `A3` (the row containing column headers: `include in pivot`, `Within / Outside 30 days`, `Week`, `Fault - sub fault`, etc.) → press `Ctrl+T` (or Insert → Table) → check **"My table has headers"** → click OK.

In the Table Design tab, rename the table to **`TicketLog`** (no space). Confirm the table covers the full data range — Excel auto-detects this based on the contiguous block.

- [ ] **Step 3: Convert Part Tracker (in `PARTS TRACKER.xlsm`) to a Table**

Open `PARTS TRACKER.xlsm` from the **Service SharePoint site** (same site as the Ticketing Log) in browser Excel. Click the `Part Tracker` tab → click cell `A1` (header row: `Date`, `Customer`, `PO Number`, `Sales Ack No`, `Invoice No`, `Fedex Tracking`, `Delivered`, `Comment`) → press `Ctrl+T` → check **"My table has headers"** → OK.

Rename to **`PartTracker`**.

- [ ] **Step 4: Confirm both files save and existing pivot tables still work**

For each file: click File → Save (browser Excel autosaves; this is just to be sure). Open one of the existing pivot sheets in the Ticketing Log workbook (e.g. `DASHBOARD`) → Refresh (right-click any pivot → Refresh). Confirm no errors. The pivots reference the table by name now (or the old fixed range still works), so they should refresh cleanly.

- [ ] **Step 5: Confirm the sharing URL for `PARTS TRACKER.xlsm`**

The URL has been confirmed by Jonas:
```
https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCb6Q6m7hA6S5LcvSWJWbFFAbzvzuai9duzFYgaQNRc24E?e=XMOqRu
```

This URL is hard-coded into the `PARTS_TRACKER_URL` constant in Task 4. If SharePoint regenerates the sharing token (which can happen when permissions change), repeat the right-click → Copy direct link flow on the file in SharePoint and update the constant.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" commit --allow-empty -m "infra(service): TICKET LOG and Part Tracker converted to Excel Tables

One-time SharePoint admin step. TICKET LOG sheet on REPO-Q006 is now
the 'TicketLog' table; Part Tracker sheet on PARTS TRACKER.xlsm is
now the 'PartTracker' table. Required for atomic row-append via
Graph Excel REST tables.rows.add. No code changes."
```

---

## Task 2: v4 sidebar entry + view skeleton + navTo dispatch

**Files:**
- Modify: `repnet-skin-v4.js` (NAV array, ~line 23)
- Modify: `index.html` (top nav buttons ~line 3041, view container ~line 3665, NAV_LABELS ~line 4084, navTo dispatch ~line 4117, _VALID_TABS ~line 8684, _validViews ~line 9300)

- [ ] **Step 1: Add the v4 sidebar entry**

In `repnet-skin-v4.js`, locate the `NAV` array (around line 23). Add a new group + entry between `Quality / QHSE` and `Operations`:

```js
{ h: 'Quality / QHSE' },
// (existing quality entries)
{ v: 'documents',    g: '📄',    l: 'Documents' },
{ h: 'Service' },                                          // ← NEW
{ v: 'service',      g: '🔧',    l: 'Service Dashboard' }, // ← NEW
{ h: 'Operations' },
// (existing operations entries)
```

- [ ] **Step 2: Add the legacy top-nav button**

In `index.html`, locate the existing nav buttons block around line 3040 (after `<button class="nav-item" data-view="documents" id="docs-tab-btn" …>`). Add immediately after:

```html
<button class="nav-item" data-view="service" onclick="navTo('service')">Service</button>
```

- [ ] **Step 3: Add the view container**

Locate the `view-documents` container (around line 3665). Add a new container immediately after its closing `</div>`:

```html
<div class="view" id="view-service" data-view="service">
  <div class="svc-shell">
    <div class="svc-loading" id="svc-loading">Loading Service Dashboard…</div>
    <div class="svc-error" id="svc-error" style="display:none"></div>
    <div class="svc-content" id="svc-content" style="display:none"></div>
  </div>
</div>
```

- [ ] **Step 4: Add NAV_LABELS entry**

Locate the `NAV_LABELS` constant (around line 4084). Add `'service':'Service Dashboard'` to the end before the closing `}`:

```js
const NAV_LABELS = { /* existing entries */, 'documents':'Documents', 'service':'Service Dashboard' };
```

- [ ] **Step 5: Add navTo dispatch**

Locate the navTo dispatch lines (around line 4117 — `if (name === 'complaints') { cpOnOpen(); }`). Add immediately after:

```js
if (name === 'service') openServiceDashboard();
```

- [ ] **Step 6: Add to _VALID_TABS and _validViews**

Locate `_VALID_TABS` (around line 8684) — add `'service'` to the Set.

Locate `_validViews` (around line 9300) — add `'service'` to the Set.

- [ ] **Step 7: Add the stub `openServiceDashboard` function**

Find a section near the end of the existing JS (after the COMPLAINTS module, around line 19700+). Add a new section divider and stub:

```js
// ═══════════════════════════════════════════════
// SERVICE DASHBOARD (Phase A — foundation)
// ═══════════════════════════════════════════════

async function openServiceDashboard() {
  const loading = document.getElementById('svc-loading');
  const errEl   = document.getElementById('svc-error');
  const content = document.getElementById('svc-content');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  content.style.display = 'none';
  try {
    // Phase A: full render lands in Task 7. For now, just signal that the route works.
    content.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text2)">Service Dashboard — view route works. Data layer + render coming in next tasks.</div>`;
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = `Failed to open Service Dashboard: ${e.message}`;
    console.error('[svc] open failed', e);
  }
}
```

- [ ] **Step 8: Add minimal CSS for the shell + supplementary variable palette**

RepNet's existing `:root` defines `--red/--rbg/--rborder`, `--green/--gbg/--gborder`, `--amber/--abg/--aborder`, `--blue/--bbg/--bborder` — but the Service Dashboard CSS in later tasks uses additional mockup-style names (`--pass`, `--fail`, `--warn`, `--info`, `--purple`, `--orange`, `--pink`, `--grey-soft`, `--repose-blue-soft`, `--repose-blue-dark`) that aren't defined anywhere. Rather than rewriting every CSS rule, we add a supplementary variable block scoped to the Service Dashboard.

Find a CSS block near the existing `docs-shell` styles in `index.html` (search for `.docs-shell {`). Add immediately after the docs styles:

```css
/* Service Dashboard (Phase A) */
/* Supplementary palette — maps mockup-style names to existing RepNet vars,
   plus a few new tones (purple/orange/pink) used by the Service module. */
#view-service {
  --pass: var(--green);
  --pass-soft: var(--gbg);
  --pass-bg: var(--gbg);
  --gborder: var(--gborder);
  --fail: var(--red);
  --fail-soft: var(--rbg);
  --warn: var(--amber);
  --warn-soft: var(--abg);
  --warn-bg: var(--abg);
  --info: var(--repose-blue);
  --info-soft: var(--bbg);
  --repose-blue-soft: var(--bbg);
  --repose-blue-dark: #0d8ec9;
  --grey-soft: #f1f5f9;
  --purple: #7c3aed;
  --purple-soft: #ede9fe;
  --orange: #ea580c;
  --orange-soft: #fed7aa;
  --pink: #db2777;
  --pink-soft: #fce7f3;
}

.svc-shell { padding: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.svc-loading { padding: 64px; text-align: center; color: var(--text2); font-size: 14px; }
.svc-error { padding: 24px; background: var(--rbg); color: var(--red); border-radius: 12px; margin: 24px; font-size: 13px; }
.svc-content { flex: 1; overflow-y: auto; padding: 24px 28px 64px; max-width: 1640px; }
```

- [ ] **Step 9: Verify**

Hard-reload `?ui=v4`. Hover the sidebar → see the new **🔧 Service Dashboard** entry under a **Service** group. Click it. Expected:
- URL hash becomes `#service`
- View shows "Service Dashboard — view route works. Data layer + render coming in next tasks."
- No console errors

Also test the legacy top-nav: visit `?ui=old` (or no `ui` param) and click the new **Service** button → same view appears.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html repnet-skin-v4.js
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): sidebar entry + view skeleton

New v4 sidebar group 'Service' with single entry 🔧 Service Dashboard.
View container view-service with loading/error/content placeholders.
navTo dispatch wired; opens stub renderer that confirms the route works.
Data layer and full render land in subsequent tasks."
```

---

## Task 3: Data layer — fetch Ticketing Log

**Files:** Modify `index.html` — add new constants near other site/sharing-URL constants (~line 4013–4030) and new fetch helper after `cpLoadData` (around line 19571 or in the new SERVICE section).

- [ ] **Step 1: Add Ticketing Log constants**

Find the constants section near `CP_TICKETING_LOG_URL` (around line 4013). Confirm it already exists. Add immediately after (Service module re-uses it, but introduces its own state holder):

```js
// ─── Service Dashboard data layer ─────────────────────────────────
const SERVICE_TICKETING_LOG_URL = CP_TICKETING_LOG_URL; // alias for clarity within Service module
const SERVICE_TICKET_SHEET = 'TICKET LOG';
const SERVICE_TICKET_TABLE = 'TicketLog';
const _SERVICE_CACHE_MS = 300_000; // 5 min in-browser cache

// In-memory state for the Service Dashboard. Refreshed lazily from Excel
// via Graph; manual refresh button busts the cache.
let _serviceState = {
  tickets: [],   // mapped Ticket objects
  parts: [],     // mapped Parts objects
  lastFetch: 0,  // ms epoch
  loading: false,
  error: null
};
```

- [ ] **Step 2: Add `fetchServiceTickets()` helper**

In the SERVICE DASHBOARD section (added in Task 2), append after `openServiceDashboard`:

```js
// Read TICKET LOG via Graph Excel REST. Returns an array of Ticket objects.
// Column indices match the header row at A3 (0-indexed row 2 in usedRange):
//   0 include in pivot            18 Owner
//   1 Within / Outside 30 days    19 Proposed Close Date
//   2 Week                        20 Close Date
//   3 Fault - sub fault           21 Days to Complete
//   4 FY                          22 Overdue By
//   5 Period                      23 Quality Issue
//   6 Ticket No                   24 Warranty / Chargeable
//   7 Customer                    25 Fault Code
//   8 Despatch Date               26 Sub-Fault
//   9 REP Number                  27 Open / Closed
//  10 Ref / PO number             28 Invoice No
//  11 Model                       29 Invoice Date
//  12 Mech Code                   30 £
//  13 Description                 31 £ Del
//  14 Open Date                   32 Chair Returned
//  15 Returned to Factory         33 Inspected
//  16 Action                      34 In Production
//  17 Notes                       35 Return to customer
async function fetchServiceTickets() {
  if (!graphAccount) throw new Error('Not signed in.');
  const encoded = encodeSharingUrl(SERVICE_TICKETING_LOG_URL);
  const driveItem = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
  const driveId = driveItem.parentReference.driveId;
  const itemId = driveItem.id;
  const range = await graphGet(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(SERVICE_TICKET_SHEET)}')/usedRange?$select=values`
  );
  const values = range.values || [];
  // Stash drive/item IDs for write-back (Tasks 13-14)
  _serviceState.ticketDriveId = driveId;
  _serviceState.ticketItemId = itemId;

  const tickets = [];
  for (let i = 3; i < values.length; i++) { // header is row 3 (index 2); data starts at index 3
    const row = values[i];
    const ticketNo = String(row[6] || '').trim();
    if (!ticketNo) continue; // skip blank rows
    tickets.push(_mapTicketRow(row));
  }
  return tickets;
}

function _mapTicketRow(row) {
  return {
    includeInPivot: String(row[0] || '').trim(),
    period30: String(row[1] || '').trim(),    // 'Inside 30' | 'Outside 30'
    week: row[2],
    faultSubFault: String(row[3] || '').trim(),
    fy: String(row[4] || '').trim(),
    period: String(row[5] || '').trim(),
    ticketNo: String(row[6] || '').trim(),
    customer: String(row[7] || '').trim(),
    despatchDate: _parseExcelDate(row[8]),
    repNo: String(row[9] || '').trim(),
    poRef: String(row[10] || '').trim(),
    model: String(row[11] || '').trim(),
    mechCode: String(row[12] || '').trim(),
    description: String(row[13] || '').trim(),
    openDate: _parseExcelDate(row[14]),
    returnedToFactory: row[15],
    action: String(row[16] || '').trim(),
    notes: String(row[17] || '').trim(),
    owner: String(row[18] || '').trim(),
    proposedCloseDate: _parseExcelDate(row[19]),
    closeDate: _parseExcelDate(row[20]),
    daysToComplete: Number(row[21]) || null,
    overdueBy: Number(row[22]) || null,
    qualityIssue: String(row[23] || '').trim(),
    warrantyChargeable: String(row[24] || '').trim().toUpperCase(), // 'WARRANTY' | 'CHARGEABLE'
    faultCode: String(row[25] || '').trim(),
    subFault: String(row[26] || '').trim(),
    openClosed: String(row[27] || '').trim().toUpperCase(),         // 'OPEN' | 'CLOSED'
    invoiceNo: String(row[28] || '').trim(),
    invoiceDate: _parseExcelDate(row[29]),
    gbp: Number(row[30]) || 0,
    gbpDel: Number(row[31]) || 0,
    chairReturned: row[32],
    inspected: row[33],
    inProduction: row[34],
    returnToCustomer: row[35]
  };
}

// Excel can return either a serial number (days since 1899-12-30) or a string.
// Serial number handling matches the existing cpParseDate helper.
function _parseExcelDate(v) {
  if (!v && v !== 0) return null;
  if (typeof v === 'number') {
    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }
  // String — try DD/MM/YYYY first (UK convention), fall back to native Date parse
  const s = String(v).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(n => parseInt(n, 10));
    const fy = y < 100 ? 2000 + y : y;
    const dt = new Date(fy, m - 1, d);
    return isNaN(dt) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}
```

- [ ] **Step 3: Verify in DevTools console**

Hard-reload `?ui=v4`. Sign in. In console:

```js
const t = await fetchServiceTickets();
console.log('total tickets:', t.length);
console.log('first ticket:', t[0]);
console.log('open count:', t.filter(x => x.openClosed === 'OPEN').length);
```

Expected:
- `total tickets` is in the thousands (~9,988 historical)
- `first ticket` shows a ticket with sensible fields (customer, model, dates parsed as Date objects, gbp as number)
- `open count` is in the small dozens (~15-20 typically)

If any field looks wrong (e.g. dates are strings not Date objects, or gbp shows NaN), pause and inspect — the column indexes might have shifted in the actual workbook. Verify against the sheet directly.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): Ticketing Log fetch helper

fetchServiceTickets reads TICKET LOG via Graph Excel REST and maps
each row into a structured Ticket object. _mapTicketRow handles the
36-column layout from the row-3 header. _parseExcelDate copes with
both Excel serial numbers and DD/MM/YYYY string dates.

Drive ID and item ID are stashed in _serviceState for later
row-append write-back (Task 13)."
```

---

## Task 4: Data layer — fetch Parts Tracker

**Files:** Modify `index.html`, near the constants and fetch helpers added in Task 3.

- [ ] **Step 1: Add Parts Tracker constants**

Add to the SERVICE constants block (just after the lines added in Task 3 step 1):

```js
// PARTS TRACKER — confirmed sharing URL on the Service SharePoint site
// (same site as the Ticketing Log).
const PARTS_TRACKER_URL = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCb6Q6m7hA6S5LcvSWJWbFFAbzvzuai9duzFYgaQNRc24E?e=XMOqRu';
const PARTS_TRACKER_SHEET = 'Part Tracker';
const PARTS_TRACKER_TABLE = 'PartTracker';
```

- [ ] **Step 2: Add `fetchPartTracker()` helper**

Append in the SERVICE DASHBOARD section after `_parseExcelDate`:

```js
// Read Part Tracker via Graph Excel REST. Returns an array of Parts objects.
// Column indices (0-based) for the row-1 header on Part Tracker sheet:
//   0 Date  1 Customer  2 PO Number  3 Sales Ack No
//   4 Invoice No  5 Fedex Tracking  6 Delivered  7 Comment
async function fetchPartTracker() {
  if (!graphAccount) throw new Error('Not signed in.');
  const encoded = encodeSharingUrl(PARTS_TRACKER_URL);
  const driveItem = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
  const driveId = driveItem.parentReference.driveId;
  const itemId = driveItem.id;
  const range = await graphGet(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(PARTS_TRACKER_SHEET)}')/usedRange?$select=values`
  );
  const values = range.values || [];
  _serviceState.partsDriveId = driveId;
  _serviceState.partsItemId = itemId;

  const parts = [];
  for (let i = 1; i < values.length; i++) { // skip row 0 (header); data starts row 1
    const row = values[i];
    const customer = String(row[1] || '').trim();
    const tracking = String(row[5] || '').trim();
    if (!customer && !tracking) continue; // blank line
    parts.push(_mapPartsRow(row));
  }
  return parts;
}

function _mapPartsRow(row) {
  // "Delivered" column may be:
  // - blank (parcel still in transit)
  // - a string like "13.01.26 @ 13.25" (manually typed timestamp)
  // - an Excel serial number (rare)
  const deliveredRaw = row[6];
  const deliveredText = (deliveredRaw === null || deliveredRaw === undefined) ? '' : String(deliveredRaw).trim();
  return {
    date: _parseExcelDate(row[0]),
    customer: String(row[1] || '').trim(),
    poNumber: String(row[2] || '').trim(),
    salesAckNo: String(row[3] || '').trim(),
    invoiceNo: String(row[4] || '').trim(),
    fedexTracking: String(row[5] || '').trim(),
    deliveredText,
    deliveredDate: _parseDeliveredText(deliveredText),
    comment: String(row[7] || '').trim(),
    isDelivered: deliveredText.length > 0
  };
}

// "13.01.26 @ 13.25" → Date(2026, 0, 13, 13, 25). Falls back to null on parse failure.
function _parseDeliveredText(s) {
  if (!s) return null;
  // Strip the @-suffix; just need the date portion for the column-format we have
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const fy = parseInt(y, 10) < 100 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const dt = new Date(fy, parseInt(mo, 10) - 1, parseInt(d, 10));
  return isNaN(dt) ? null : dt;
}
```

- [ ] **Step 3: Verify**

DevTools console after hard-reload + sign-in:

```js
const p = await fetchPartTracker();
console.log('total parts rows:', p.length);
console.log('in transit:', p.filter(x => !x.isDelivered).length);
console.log('first row:', p[0]);
console.log('first delivered row:', p.find(x => x.isDelivered));
```

Expected:
- ~230 rows
- ~5-10 in transit (whatever's currently undelivered)
- `first row` has fedexTracking like `8876 9467 7089`, customer like `CASTELAN`
- `first delivered row` has deliveredText like `13.01.26 @ 13.25` and deliveredDate as a Date object

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): Part Tracker fetch helper

fetchPartTracker reads PARTS TRACKER.xlsm via Graph Excel REST.
_mapPartsRow handles the 8-column layout. _parseDeliveredText
parses the manually-typed 'DD.MM.YY @ HH.mm' format into a Date.

PARTS_TRACKER_URL constant must be set to the SharePoint sharing
URL before this works (see Task 1 step 5)."
```

---

## Task 5: Cache + unified `loadServiceData`

**Files:** Modify `index.html` — append after `_mapPartsRow` in the SERVICE section.

- [ ] **Step 1: Add `loadServiceData`**

```js
// Load both Excel files in parallel, with a 5-min in-memory cache.
// `force=true` busts the cache (manual refresh button).
async function loadServiceData(force = false) {
  const now = Date.now();
  if (!force && (now - _serviceState.lastFetch) < _SERVICE_CACHE_MS && _serviceState.tickets.length > 0) {
    return _serviceState; // fresh enough
  }
  if (_serviceState.loading) {
    // A second concurrent call piggybacks on the first
    while (_serviceState.loading) await new Promise(r => setTimeout(r, 100));
    return _serviceState;
  }
  _serviceState.loading = true;
  _serviceState.error = null;
  try {
    const [tickets, parts] = await Promise.all([
      fetchServiceTickets(),
      fetchPartTracker()
    ]);
    _serviceState.tickets = tickets;
    _serviceState.parts = parts;
    _serviceState.lastFetch = now;
  } catch (e) {
    _serviceState.error = e.message;
    console.error('[svc] loadServiceData failed', e);
    throw e;
  } finally {
    _serviceState.loading = false;
  }
  return _serviceState;
}
```

- [ ] **Step 2: Wire into `openServiceDashboard`**

Replace the placeholder body of `openServiceDashboard` (added in Task 2) with:

```js
async function openServiceDashboard() {
  const loading = document.getElementById('svc-loading');
  const errEl   = document.getElementById('svc-error');
  const content = document.getElementById('svc-content');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  content.style.display = 'none';
  try {
    await loadServiceData();
    // Phase A render lands in Task 7. For now, just show the data load worked.
    content.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text2)">
      Loaded <b style="color:var(--text)">${_serviceState.tickets.length}</b> tickets and
      <b style="color:var(--text)">${_serviceState.parts.length}</b> parts rows.<br>
      Open: ${_serviceState.tickets.filter(t => t.openClosed === 'OPEN').length} ·
      In transit: ${_serviceState.parts.filter(p => !p.isDelivered).length}
    </div>`;
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = `Failed to load Service Dashboard: ${e.message}`;
  }
}
```

- [ ] **Step 3: Verify**

Hard-reload `?ui=v4`, navigate to Service. Expected: shows total ticket count + total parts count + open count + in-transit count.

Click into another tab and back to Service — second open should be near-instant (cache hit). DevTools network tab should show NO Graph calls on the second click.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): unified loadServiceData with 5-min cache

loadServiceData fetches both Excel files in parallel, caches in
_serviceState.lastFetch. Concurrent calls piggyback on the first
in-flight load (no thundering herd). force=true busts cache.

openServiceDashboard now loads data and shows row counts as a
sanity check. Real render lands in Task 7."
```

---

## Task 6: KPI computation helpers

**Files:** Modify `index.html` — append in the SERVICE section.

- [ ] **Step 1: Add `_computeServiceKpis`**

```js
// Compute all dashboard KPIs from the in-memory _serviceState.
// Period filter is the current calendar month by default; configurable later.
function _computeServiceKpis(period = 'mtd') {
  const tickets = _serviceState.tickets;
  const parts = _serviceState.parts;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = (() => { const d = new Date(now); const day = d.getDay() || 7; d.setDate(d.getDate() - day + 1); d.setHours(0,0,0,0); return d; })();

  const open = tickets.filter(t => t.openClosed === 'OPEN');
  const openIn30  = open.filter(t => t.period30.toLowerCase().startsWith('inside 30')).length;
  const openOut30 = open.filter(t => t.period30.toLowerCase().startsWith('outside 30')).length;
  const overdue = open.filter(t => t.proposedCloseDate && t.proposedCloseDate < now).length;

  const closedThisMonth = tickets.filter(t => t.closeDate && t.closeDate >= monthStart && t.closeDate <= now);
  const avgDaysClose = closedThisMonth.length === 0 ? 0
    : Math.round(closedThisMonth.reduce((a, t) => a + (t.daysToComplete || 0), 0) / closedThisMonth.length);
  const avgWarrantyClose = (() => {
    const x = closedThisMonth.filter(t => t.warrantyChargeable === 'WARRANTY');
    return x.length === 0 ? 0 : Math.round(x.reduce((a, t) => a + (t.daysToComplete || 0), 0) / x.length);
  })();
  const avgChargeableClose = (() => {
    const x = closedThisMonth.filter(t => t.warrantyChargeable === 'CHARGEABLE');
    return x.length === 0 ? 0 : Math.round(x.reduce((a, t) => a + (t.daysToComplete || 0), 0) / x.length);
  })();

  const partsInTransit = parts.filter(p => !p.isDelivered);
  const partsDelivered = parts.filter(p => p.isDelivered);

  const withinTarget = closedThisMonth.length === 0 ? 0
    : Math.round(closedThisMonth.filter(t => (t.daysToComplete || 0) <= 30).length / closedThisMonth.length * 100);

  const openedThisWeek = tickets.filter(t => t.openDate && t.openDate >= weekStart).length;
  const closedThisWeek = tickets.filter(t => t.closeDate && t.closeDate >= weekStart).length;
  const gbpMtd = closedThisMonth
    .filter(t => t.warrantyChargeable === 'CHARGEABLE')
    .reduce((a, t) => a + (t.gbp || 0) + (t.gbpDel || 0), 0);

  // Top fault category MTD
  const faultCounts = {};
  for (const t of tickets.filter(t => t.openDate && t.openDate >= monthStart)) {
    const k = t.faultCode || '—';
    faultCounts[k] = (faultCounts[k] || 0) + 1;
  }
  const topFault = Object.entries(faultCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return {
    open: open.length, openIn30, openOut30, overdue,
    avgDaysClose, avgWarrantyClose, avgChargeableClose,
    partsInTransit: partsInTransit.length, partsDelivered: partsDelivered.length,
    withinTarget, openedThisWeek, closedThisWeek, gbpMtd, topFault,
    closedThisMonthCount: closedThisMonth.length
  };
}
```

- [ ] **Step 2: Verify in console**

Hard-reload, navigate to Service. In DevTools:

```js
const k = _computeServiceKpis();
console.table(k);
```

Expected: all numbers populated, no NaN, no undefined. `topFault` looks like `'MECHANISM'` or similar.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): KPI computation helpers

_computeServiceKpis returns the dashboard KPIs in one shot:
open count + In30/Out30 split, avg days to close (warranty/chargeable
split), parts in transit + delivered, % within 30-day target,
opened/closed this week, £ chargeable MTD, top fault category."
```

---

## Task 7: Render shell — page head, KPI strips, alert banners

**Files:** Modify `index.html` — append CSS and JS in the SERVICE section.

- [ ] **Step 1: Add Service Dashboard CSS**

Append after the minimal `.svc-shell` styles from Task 2 step 8:

```css
/* Service Dashboard — page head + KPI tiles */
.svc-page-head { background: #fff; border: 1px solid var(--border); border-radius: 18px; padding: 22px 26px; margin-bottom: 18px; display: flex; align-items: center; gap: 18px; }
.svc-page-head .crumb { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text2); font-weight: 700; margin-bottom: 4px; }
.svc-page-head h1 { font-size: 28px; font-weight: 800; color: var(--repose-navy); font-family: 'Bricolage Grotesque', Manrope, sans-serif; letter-spacing: -.02em; margin: 0; }
.svc-page-head h1 em { color: var(--repose-blue); font-style: normal; }
.svc-page-head .ps { font-size: 13px; color: var(--text2); margin-top: 6px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.svc-page-head .ps .live { display: inline-flex; align-items: center; gap: 6px; color: var(--pass); font-weight: 700; font-size: 12px; }
.svc-page-head .right { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }

.svc-btn { font-family: inherit; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 999px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all .12s; }
.svc-btn-pri { background: var(--repose-blue); color: #fff; }
.svc-btn-pri:hover { background: #0d8ec9; }
.svc-btn-sec { background: #fff; color: var(--repose-navy); border: 1.5px solid var(--border2); }
.svc-btn-sec:hover { border-color: var(--repose-blue); color: var(--repose-blue); }
.svc-btn-ghost { background: transparent; color: var(--text2); padding: 9px 14px; }

.svc-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 12px; }
.svc-kpis-2 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
.svc-kpi { background: #fff; border: 1px solid var(--border); border-radius: 18px; padding: 18px 22px; cursor: pointer; transition: all .15s; position: relative; overflow: hidden; }
.svc-kpi:hover { border-color: var(--repose-blue); box-shadow: 0 8px 22px rgba(20, 161, 233, .10); transform: translateY(-1px); }
.svc-kpi.lg { display: flex; flex-direction: column; gap: 10px; }
.svc-kpi-top { display: flex; align-items: center; gap: 14px; }
.svc-kpi-icn { width: 44px; height: 44px; border-radius: 14px; background: var(--repose-blue-soft); color: var(--repose-blue); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
.svc-kpi.warn .svc-kpi-icn { background: var(--warn-soft); color: var(--warn); }
.svc-kpi.pass .svc-kpi-icn { background: var(--pass-soft); color: var(--pass); }
.svc-kpi.fail .svc-kpi-icn { background: var(--fail-soft); color: var(--fail); }
.svc-kpi.purple .svc-kpi-icn { background: var(--purple-soft); color: var(--purple); }
.svc-kpi-mid { flex: 1; min-width: 0; }
.svc-kpi-num { font-family: 'Bricolage Grotesque', sans-serif; font-size: 28px; font-weight: 800; color: var(--repose-navy); line-height: 1; letter-spacing: -.02em; }
.svc-kpi-num .unit { font-size: 13px; font-weight: 600; color: var(--text2); margin-left: 4px; }
.svc-kpi-lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--text2); font-weight: 700; margin-top: 6px; }
.svc-kpi-mini { padding: 13px 16px; }
.svc-kpi-mini .svc-kpi-num { font-size: 20px; }
.svc-kpi-mini .svc-kpi-icn { width: 34px; height: 34px; font-size: 16px; border-radius: 10px; }
.svc-kpi-mini .svc-kpi-lbl { font-size: 10px; margin-top: 4px; }
.svc-kpi-mini { display: flex; align-items: flex-start; gap: 12px; }

.svc-split { display: flex; width: 100%; height: 6px; border-radius: 999px; overflow: hidden; background: var(--grey-soft); }
.svc-split .seg { height: 100%; }
.svc-split-legend { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; margin-top: 7px; }
.svc-split-legend .seg-lbl { display: flex; align-items: center; gap: 5px; }
.svc-split-legend .seg-lbl .sw { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.svc-split-legend em { font-style: normal; color: var(--text2); font-weight: 500; margin-left: 3px; }
```

- [ ] **Step 2: Add `_renderServiceShell` and `_renderServiceKpis`**

```js
function _renderServiceShell(content) {
  const last = _serviceState.lastFetch ? new Date(_serviceState.lastFetch) : null;
  content.innerHTML = `
    <div class="svc-page-head">
      <div>
        <div class="crumb">Service Department</div>
        <h1>Service <em>Dashboard</em></h1>
        <div class="ps">
          ${last ? `<span class="live">● Synced ${_relativeTime(last)}</span>` : ''}
          <span>· Sources: <b>Ticketing Log</b> · <b>Parts Tracker</b></span>
          <span>· Period: <b>${_currentMonthLabel()}</b> MTD</span>
        </div>
      </div>
      <div class="right">
        <button class="svc-btn svc-btn-sec" id="svc-refresh-btn">↻ Refresh</button>
        <button class="svc-btn svc-btn-sec" id="svc-new-parts-btn">＋ Parts Dispatch</button>
        <button class="svc-btn svc-btn-pri" id="svc-new-ticket-btn">＋ New Ticket</button>
      </div>
    </div>
    <div id="svc-alerts-container"></div>
    <div id="svc-kpi-container"></div>
    <div id="svc-tickets-container"></div>
    <div id="svc-parts-container"></div>
    <div id="svc-charts-container"></div>
    <div id="svc-panels-container"></div>
  `;
  document.getElementById('svc-refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '↻ Refreshing…';
    try { await loadServiceData(true); _renderServiceAll(); } finally { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  });
  // Tasks 13-14 wire the +Parts and +Ticket buttons
  _renderServiceKpis();
}

function _renderServiceKpis() {
  const k = _computeServiceKpis();
  const c = document.getElementById('svc-kpi-container');
  if (!c) return;
  c.innerHTML = `
    <div class="svc-kpis">
      <div class="svc-kpi lg warn">
        <div class="svc-kpi-top">
          <div class="svc-kpi-icn">🟠</div>
          <div class="svc-kpi-mid">
            <div class="svc-kpi-num">${k.open}<span class="unit">open</span></div>
            <div class="svc-kpi-lbl">${k.overdue} overdue</div>
          </div>
        </div>
        <div>
          <div class="svc-split">
            <div class="seg" style="width:${_pct(k.openIn30, k.open)}%;background:var(--amber)"></div>
            <div class="seg" style="width:${_pct(k.openOut30, k.open)}%;background:var(--text2)"></div>
          </div>
          <div class="svc-split-legend">
            <span class="seg-lbl"><span class="sw" style="background:var(--amber)"></span>Inside 30d <em>${k.openIn30}</em></span>
            <span class="seg-lbl"><span class="sw" style="background:var(--text2)"></span>Outside 30d <em>${k.openOut30}</em></span>
          </div>
        </div>
      </div>

      <div class="svc-kpi lg pass">
        <div class="svc-kpi-top">
          <div class="svc-kpi-icn">⏰</div>
          <div class="svc-kpi-mid">
            <div class="svc-kpi-num">${k.avgDaysClose}<span class="unit">days</span></div>
            <div class="svc-kpi-lbl">Avg close · target 14d</div>
          </div>
        </div>
        <div>
          <div class="svc-split">
            <div class="seg" style="width:${_pct(k.avgWarrantyClose, k.avgWarrantyClose + k.avgChargeableClose)}%;background:var(--info)"></div>
            <div class="seg" style="width:${_pct(k.avgChargeableClose, k.avgWarrantyClose + k.avgChargeableClose)}%;background:var(--purple)"></div>
          </div>
          <div class="svc-split-legend">
            <span class="seg-lbl"><span class="sw" style="background:var(--info)"></span>Warranty <em>${k.avgWarrantyClose}d</em></span>
            <span class="seg-lbl"><span class="sw" style="background:var(--purple)"></span>Chargeable <em>${k.avgChargeableClose}d</em></span>
          </div>
        </div>
      </div>

      <div class="svc-kpi lg">
        <div class="svc-kpi-top">
          <div class="svc-kpi-icn">📦</div>
          <div class="svc-kpi-mid">
            <div class="svc-kpi-num">${k.partsInTransit}<span class="unit">parcels</span></div>
            <div class="svc-kpi-lbl">In transit · ${k.partsDelivered} delivered total</div>
          </div>
        </div>
      </div>

      <div class="svc-kpi lg pass">
        <div class="svc-kpi-top">
          <div class="svc-kpi-icn">📈</div>
          <div class="svc-kpi-mid">
            <div class="svc-kpi-num">${k.withinTarget}<span class="unit">%</span></div>
            <div class="svc-kpi-lbl">Closed within 30-day target</div>
          </div>
        </div>
      </div>
    </div>

    <div class="svc-kpis-2">
      <div class="svc-kpi svc-kpi-mini">
        <div class="svc-kpi-icn">🆕</div>
        <div class="svc-kpi-mid"><div class="svc-kpi-num">${k.openedThisWeek}</div><div class="svc-kpi-lbl">Opened this week</div></div>
      </div>
      <div class="svc-kpi svc-kpi-mini pass">
        <div class="svc-kpi-icn">✅</div>
        <div class="svc-kpi-mid"><div class="svc-kpi-num">${k.closedThisWeek}</div><div class="svc-kpi-lbl">Closed this week</div></div>
      </div>
      <div class="svc-kpi svc-kpi-mini pass">
        <div class="svc-kpi-icn">💰</div>
        <div class="svc-kpi-mid"><div class="svc-kpi-num">£${Math.round(k.gbpMtd).toLocaleString('en-GB')}</div><div class="svc-kpi-lbl">£ chargeable MTD</div></div>
      </div>
      <div class="svc-kpi svc-kpi-mini fail">
        <div class="svc-kpi-icn">🔧</div>
        <div class="svc-kpi-mid"><div class="svc-kpi-num">${_truncate(k.topFault, 8)}</div><div class="svc-kpi-lbl">Top fault MTD</div></div>
      </div>
    </div>
  `;
}

function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  // Tasks 8-12 add: tickets, parts, charts, panels, drawer
}

function _pct(n, d) { return d > 0 ? Math.round(n / d * 100) : 0; }
function _truncate(s, n) { return (s || '').length > n ? s.slice(0, n) + '…' : (s || '—'); }
function _relativeTime(d) {
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  return `${Math.round(sec / 3600)}h ago`;
}
function _currentMonthLabel() {
  return new Date().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
```

- [ ] **Step 3: Wire `openServiceDashboard` to render the shell**

Replace the body of `openServiceDashboard` again:

```js
async function openServiceDashboard() {
  const loading = document.getElementById('svc-loading');
  const errEl   = document.getElementById('svc-error');
  const content = document.getElementById('svc-content');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  content.style.display = 'none';
  try {
    await loadServiceData();
    _renderServiceAll();
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = `Failed to load Service Dashboard: ${e.message}`;
  }
}
```

- [ ] **Step 4: Verify**

Hard-reload `?ui=v4` → Service tab. Expected: page head with "Service Dashboard" title, page-meta line, three buttons. Below: 4 primary KPI tiles + 4 mini tiles. Real numbers from your data.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): page head + KPI strip render

_renderServiceShell drops in the page head with crumb, title, sync
indicator, period label, and action buttons. _renderServiceKpis
renders 4 primary tiles (with In30/Out30 + W/C splits) plus 4 mini
tiles (opened/closed week, £ chargeable MTD, top fault).

Refresh button busts the 5-min cache and re-renders. The +Ticket
and +Parts buttons are wired in Tasks 13-14."
```

---

## Task 7B: SLA breach pre-alerts banner

**Files:** Modify `index.html` — append in the SERVICE section.

Detects open tickets at 80%+ of their proposed-close window with no recent action and surfaces them as a top-of-page banner. Catches issues *before* they breach the SLA, not just after. The `Action` column being unchanged within the last 5 days is the proxy for "no recent action" — there's no per-ticket activity log in the source data.

- [ ] **Step 1: CSS for the alert banner**

```css
.svc-alerts { display: grid; grid-template-columns: 1fr; gap: 10px; margin-bottom: 14px; }
.svc-alert { border-radius: 14px; padding: 13px 16px; display: flex; align-items: center; gap: 12px; font-size: 12.5px; border: 1px solid; }
.svc-alert .ab-icn { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; color: #fff; }
.svc-alert .ab-mid { flex: 1; min-width: 0; }
.svc-alert .ab-mid b { display: block; margin-bottom: 2px; font-size: 13px; }
.svc-alert .ab-mid .small { font-size: 11.5px; color: var(--text2); font-weight: 500; }
.svc-alert .ab-act { font-weight: 700; font-size: 11.5px; cursor: pointer; white-space: nowrap; background: transparent; border: none; padding: 0; font-family: inherit; }
.svc-alert.danger { background: linear-gradient(135deg, #fef2f2, #fff7ed); border-color: var(--rborder); }
.svc-alert.danger .ab-icn { background: var(--fail); }
.svc-alert.danger .ab-act { color: var(--fail); }
.svc-alert.warn { background: linear-gradient(135deg, #fffbeb, #fff); border-color: var(--aborder); }
.svc-alert.warn .ab-icn { background: var(--amber); }
.svc-alert.warn .ab-act { color: var(--amber); }
```

- [ ] **Step 2: SLA detection helper**

```js
// Returns array of tickets that are at risk of an SLA breach.
// Definition: open ticket where the % of its close-window already elapsed
// is >= the threshold (default 80%) AND it isn't already overdue (overdue
// gets its own treatment via the row.urgent class). Returns up to limit items.
function _computeServiceSlaRisk(threshold = 0.80, limit = 10) {
  const now = new Date();
  const at = [];
  for (const t of _serviceState.tickets) {
    if (t.openClosed !== 'OPEN') continue;
    if (!t.openDate || !t.proposedCloseDate) continue;
    if (t.proposedCloseDate <= now) continue; // already overdue — handled separately
    const total = t.proposedCloseDate.getTime() - t.openDate.getTime();
    if (total <= 0) continue;
    const elapsed = now.getTime() - t.openDate.getTime();
    const pct = elapsed / total;
    if (pct >= threshold) {
      at.push({ ticket: t, pct: Math.round(pct * 100) });
    }
  }
  // Highest % first
  at.sort((a, b) => b.pct - a.pct);
  return at.slice(0, limit);
}

// Returns count of open tickets that are already past their proposed-close date.
function _computeServiceOverdueCount() {
  const now = new Date();
  return _serviceState.tickets.filter(t =>
    t.openClosed === 'OPEN' && t.proposedCloseDate && t.proposedCloseDate < now
  ).length;
}
```

- [ ] **Step 3: Render function for the alert banner**

```js
function _renderServiceAlerts() {
  const c = document.getElementById('svc-alerts-container');
  if (!c) return;
  const slaRisk = _computeServiceSlaRisk();
  const overdue = _computeServiceOverdueCount();
  const banners = [];

  if (overdue > 0) {
    banners.push(`
      <div class="svc-alert danger">
        <div class="ab-icn">⏰</div>
        <div class="ab-mid">
          <b>${overdue} ticket${overdue === 1 ? '' : 's'} already past proposed close</b>
          <span class="small">Click to filter Open Tickets to overdue only</span>
        </div>
        <button class="ab-act" data-svc-act="filter-overdue">Show overdue →</button>
      </div>
    `);
  }

  if (slaRisk.length > 0) {
    const examples = slaRisk.slice(0, 3).map(x => x.ticket.ticketNo).join(', ');
    banners.push(`
      <div class="svc-alert warn">
        <div class="ab-icn">⚠</div>
        <div class="ab-mid">
          <b>SLA pre-alert · ${slaRisk.length} ticket${slaRisk.length === 1 ? '' : 's'} at 80%+ of close window</b>
          <span class="small">${examples}${slaRisk.length > 3 ? ` + ${slaRisk.length - 3} more` : ''} · catch them before they breach</span>
        </div>
        <button class="ab-act" data-svc-act="filter-sla">Review →</button>
      </div>
    `);
  }

  c.innerHTML = banners.length ? `<div class="svc-alerts">${banners.join('')}</div>` : '';

  // Wire actions
  c.querySelector('[data-svc-act="filter-overdue"]')?.addEventListener('click', () => {
    _serviceFilters.overdueOnly = true;
    _renderServiceTickets();
    document.getElementById('svc-tickets-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  c.querySelector('[data-svc-act="filter-sla"]')?.addEventListener('click', () => {
    _serviceFilters.slaRiskOnly = true;
    _renderServiceTickets();
    document.getElementById('svc-tickets-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
```

- [ ] **Step 4: Add SLA-risk filter chip to Open Tickets**

In Task 8's `_renderServiceTickets`, the filter state already has `overdueOnly`. Extend it to support `slaRiskOnly`:

Update the `_serviceFilters` declaration (added in Task 8 step 2):

```js
let _serviceFilters = { q: '', period: '', wc: '', overdueOnly: false, slaRiskOnly: false };
```

Update `_serviceTicketMatches` (in Task 8 step 3) to honour the new flag — add the following block immediately after the existing `overdueOnly` check:

```js
  if (_serviceFilters.slaRiskOnly) {
    if (!t.openDate || !t.proposedCloseDate) return false;
    if (t.proposedCloseDate <= new Date()) return false; // already overdue, handled separately
    const total = t.proposedCloseDate.getTime() - t.openDate.getTime();
    const elapsed = Date.now() - t.openDate.getTime();
    if (total <= 0 || (elapsed / total) < 0.80) return false;
  }
```

Add a new chip to the `svc-chips` block in `_renderServiceTickets`:

```html
<span class="svc-chip ${_serviceFilters.slaRiskOnly ? 'on' : ''}" data-fsla>⏰ SLA risk <span class="cnt">${_computeServiceSlaRisk(0.80, 999).length}</span></span>
```

Wire its click handler alongside the others:

```js
c.querySelectorAll('[data-fsla]').forEach(el => el.addEventListener('click', () => { _serviceFilters.slaRiskOnly = !_serviceFilters.slaRiskOnly; _renderServiceTickets(); }));
```

Also extend the "All" clear handler to clear this flag:

```js
c.querySelectorAll('[data-fclear]').forEach(el => el.addEventListener('click', () => { _serviceFilters = { q: '', period: '', wc: '', overdueOnly: false, slaRiskOnly: false }; _renderServiceTickets(); }));
```

- [ ] **Step 5: Wire `_renderServiceAlerts` into `_renderServiceAll`**

Update `_renderServiceAll`:

```js
function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  _renderServiceAlerts();
  _renderServiceTickets();
  _renderServiceParts();
  _renderServiceCharts();
  _renderServicePanels();
}
```

- [ ] **Step 6: Verify**

Hard-reload `?ui=v4` → Service. Expected:
- If any open tickets are past their proposed-close date, a red banner appears at top: "N tickets already past proposed close · Show overdue →"
- If any open tickets are >80% of the way through their close window without being overdue yet, an amber banner appears: "SLA pre-alert · N tickets at 80%+ of close window · Review →"
- Click "Show overdue →" → table filters to overdue only, page scrolls to it
- Click "Review →" → table filters to SLA-risk-only
- Click "All" chip in the table to clear filters

If no tickets are at risk, no banner appears (clean dashboard).

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): SLA breach pre-alert banner

_computeServiceSlaRisk identifies open tickets at 80%+ of their
proposed-close window (not yet overdue). Red banner for already-
overdue, amber banner for SLA risk. Both have a 'Review' action
that filters Open Tickets and scrolls into view.

New SLA-risk filter chip on Open Tickets table. Catches issues
before they breach the SLA, not just after."
```

---

## Task 8: Open Tickets table

**Files:** Modify `index.html`.

- [ ] **Step 1: CSS for the panel + table**

Append:

```css
.svc-panel { background: #fff; border: 1px solid var(--border); border-radius: 18px; overflow: hidden; margin-bottom: 16px; }
.svc-panel-head { padding: 16px 20px 12px; display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--border); }
.svc-panel-head h2 { font-size: 16px; font-weight: 700; color: var(--repose-navy); flex: 1; font-family: 'Bricolage Grotesque', Manrope, sans-serif; }
.svc-panel-head h2 .sub { display: block; font-family: Manrope, sans-serif; font-size: 11.5px; color: var(--text2); font-weight: 500; margin-top: 3px; }
.svc-panel-head .right { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }

.svc-chips { padding: 12px 20px 4px; display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid var(--border); background: var(--bg3); }
.svc-chip { padding: 5px 11px; border-radius: 999px; border: 1px solid var(--border2); background: #fff; font-size: 11.5px; font-weight: 600; color: var(--text2); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.svc-chip:hover { border-color: var(--repose-blue); color: var(--repose-blue); }
.svc-chip.on { background: var(--repose-navy); border-color: var(--repose-navy); color: #fff; }
.svc-chip .cnt { background: var(--grey-soft); padding: 1px 6px; border-radius: 999px; font-size: 10px; color: var(--text2); font-weight: 700; }
.svc-chip.on .cnt { background: rgba(255,255,255,.18); color: #fff; }

.svc-t { width: 100%; border-collapse: collapse; font-size: 13px; }
.svc-t th { text-align: left; padding: 9px 16px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--text2); background: var(--bg3); font-weight: 700; border-bottom: 1px solid var(--border); }
.svc-t td { padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.svc-t tr.row { cursor: pointer; transition: background .12s; }
.svc-t tr.row:hover { background: var(--bbg); }
.svc-t tr.row.urgent { background: var(--rbg); }
.svc-t .id { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--repose-blue); font-weight: 700; }
.svc-t .ttl { font-weight: 700; color: var(--repose-navy); font-size: 13px; }
.svc-t .meta { font-size: 11px; color: var(--text2); margin-top: 2px; }

.svc-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; }
.svc-pill.warranty { background: var(--info-soft); color: var(--info); border: 1px solid #bae6fd; }
.svc-pill.chargeable { background: var(--purple-soft); color: var(--purple); border: 1px solid #ddd6fe; }
.svc-pill.in30 { background: var(--abg); color: var(--amber); border: 1px solid var(--aborder); }
.svc-pill.out30 { background: var(--grey-soft); color: var(--text2); border: 1px solid var(--border2); }
.svc-age { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-block; }
.svc-age.ok { background: var(--pass-soft); color: var(--pass); }
.svc-age.warn { background: var(--warn-soft); color: var(--warn); }
.svc-age.bad { background: var(--fail-soft); color: var(--fail); }
.svc-search { padding: 6px 11px; border: 1px solid var(--border2); border-radius: 8px; font-family: inherit; font-size: 12px; width: 200px; }
.svc-foot { padding: 11px 20px; background: var(--bg3); border-top: 1px solid var(--border); text-align: center; font-size: 11.5px; color: var(--text2); font-weight: 600; }
```

- [ ] **Step 2: Filter state**

Add to the SERVICE constants block:

```js
let _serviceFilters = { q: '', period: '', wc: '', overdueOnly: false };
```

- [ ] **Step 3: Add ticket render functions**

```js
function _renderServiceTickets() {
  const c = document.getElementById('svc-tickets-container');
  if (!c) return;
  const tickets = _serviceState.tickets.filter(_serviceTicketMatches);
  // Sort: overdue first, then by openDate desc
  const now = new Date();
  tickets.sort((a, b) => {
    const aOver = a.proposedCloseDate && a.proposedCloseDate < now ? 1 : 0;
    const bOver = b.proposedCloseDate && b.proposedCloseDate < now ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    return (b.openDate?.getTime() || 0) - (a.openDate?.getTime() || 0);
  });
  const counts = _serviceTicketCounts();
  c.innerHTML = `
    <div class="svc-panel">
      <div class="svc-panel-head">
        <div><h2>Open Tickets <span class="sub">${counts.open} awaiting action · sorted by overdue first</span></h2></div>
        <div class="right">
          <input type="search" id="svc-ticket-search" class="svc-search" placeholder="🔍 Ticket / customer / REP…" value="${_escapeSvc(_serviceFilters.q)}">
        </div>
      </div>
      <div class="svc-chips">
        <span class="svc-chip ${!_serviceFilters.period && !_serviceFilters.wc && !_serviceFilters.overdueOnly ? 'on' : ''}" data-fclear>All <span class="cnt">${counts.open}</span></span>
        <span class="svc-chip ${_serviceFilters.overdueOnly ? 'on' : ''}" data-foverdue>⚠ Overdue <span class="cnt">${counts.overdue}</span></span>
        <span class="svc-chip ${_serviceFilters.period === 'in30' ? 'on' : ''}" data-fperiod="in30">In 30d <span class="cnt">${counts.in30}</span></span>
        <span class="svc-chip ${_serviceFilters.period === 'out30' ? 'on' : ''}" data-fperiod="out30">Out 30d <span class="cnt">${counts.out30}</span></span>
        <span class="svc-chip ${_serviceFilters.wc === 'WARRANTY' ? 'on' : ''}" data-fwc="WARRANTY">Warranty <span class="cnt">${counts.warranty}</span></span>
        <span class="svc-chip ${_serviceFilters.wc === 'CHARGEABLE' ? 'on' : ''}" data-fwc="CHARGEABLE">Chargeable <span class="cnt">${counts.chargeable}</span></span>
      </div>
      <table class="svc-t">
        <thead>
          <tr>
            <th style="width:90px">Ticket</th>
            <th>Issue · Customer</th>
            <th style="width:70px">Type</th>
            <th style="width:60px">Period</th>
            <th style="width:74px">Age</th>
          </tr>
        </thead>
        <tbody>
          ${tickets.slice(0, 50).map(_serviceTicketRowHtml).join('')}
        </tbody>
      </table>
      <div class="svc-foot">
        ${tickets.length > 50 ? `Showing 50 of ${tickets.length} matching · refine filters or search to narrow` : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`}
      </div>
    </div>
  `;

  // Wire chip clicks
  c.querySelectorAll('[data-fclear]').forEach(el => el.addEventListener('click', () => { _serviceFilters = { q: '', period: '', wc: '', overdueOnly: false }; _renderServiceTickets(); }));
  c.querySelectorAll('[data-foverdue]').forEach(el => el.addEventListener('click', () => { _serviceFilters.overdueOnly = !_serviceFilters.overdueOnly; _renderServiceTickets(); }));
  c.querySelectorAll('[data-fperiod]').forEach(el => el.addEventListener('click', () => { const v = el.dataset.fperiod; _serviceFilters.period = _serviceFilters.period === v ? '' : v; _renderServiceTickets(); }));
  c.querySelectorAll('[data-fwc]').forEach(el => el.addEventListener('click', () => { const v = el.dataset.fwc; _serviceFilters.wc = _serviceFilters.wc === v ? '' : v; _renderServiceTickets(); }));

  // Search input — debounced
  const search = c.querySelector('#svc-ticket-search');
  let st;
  search?.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => { _serviceFilters.q = search.value.trim(); _renderServiceTickets(); }, 200);
  });

  // Row click handlers for the drawer (Task 12 wires this up; Task 7 leaves it as a no-op stub)
  c.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openServiceTicketDrawer(tr.dataset.ticketno));
  });
}

function _serviceTicketMatches(t) {
  if (t.openClosed !== 'OPEN') return false;
  if (_serviceFilters.overdueOnly) {
    if (!t.proposedCloseDate || t.proposedCloseDate >= new Date()) return false;
  }
  if (_serviceFilters.period === 'in30' && !t.period30.toLowerCase().startsWith('inside 30')) return false;
  if (_serviceFilters.period === 'out30' && !t.period30.toLowerCase().startsWith('outside 30')) return false;
  if (_serviceFilters.wc && t.warrantyChargeable !== _serviceFilters.wc) return false;
  if (_serviceFilters.q) {
    const q = _serviceFilters.q.toLowerCase();
    const hay = `${t.ticketNo} ${t.customer} ${t.repNo} ${t.description} ${t.faultCode} ${t.subFault}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function _serviceTicketCounts() {
  const open = _serviceState.tickets.filter(t => t.openClosed === 'OPEN');
  const now = new Date();
  return {
    open: open.length,
    overdue: open.filter(t => t.proposedCloseDate && t.proposedCloseDate < now).length,
    in30: open.filter(t => t.period30.toLowerCase().startsWith('inside 30')).length,
    out30: open.filter(t => t.period30.toLowerCase().startsWith('outside 30')).length,
    warranty: open.filter(t => t.warrantyChargeable === 'WARRANTY').length,
    chargeable: open.filter(t => t.warrantyChargeable === 'CHARGEABLE').length
  };
}

function _serviceTicketRowHtml(t) {
  const days = t.openDate ? Math.round((Date.now() - t.openDate.getTime()) / 86400000) : 0;
  const ageCls = days > 30 ? 'bad' : days > 14 ? 'warn' : 'ok';
  const isOverdue = t.proposedCloseDate && t.proposedCloseDate < new Date();
  return `
    <tr class="row ${isOverdue ? 'urgent' : ''}" data-ticketno="${_escapeSvc(t.ticketNo)}">
      <td><span class="id">${_escapeSvc(t.ticketNo)}</span></td>
      <td>
        <div class="ttl">${_escapeSvc(t.faultCode || t.description.slice(0, 60) || '—')} · ${_escapeSvc(t.model || '—')}</div>
        <div class="meta">${_escapeSvc(t.customer)} · ${_escapeSvc(t.subFault || '')} ${t.repNo ? '· ' + _escapeSvc(t.repNo) : ''}</div>
      </td>
      <td><span class="svc-pill ${t.warrantyChargeable === 'WARRANTY' ? 'warranty' : 'chargeable'}">${t.warrantyChargeable === 'WARRANTY' ? 'WARR' : 'CHRG'}</span></td>
      <td><span class="svc-pill ${t.period30.toLowerCase().startsWith('inside 30') ? 'in30' : 'out30'}">${t.period30.toLowerCase().startsWith('inside 30') ? 'In 30d' : 'Out 30d'}</span></td>
      <td><span class="svc-age ${ageCls}">${days}d</span></td>
    </tr>
  `;
}

function _escapeSvc(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

// Stub — Task 12 implements the drawer
async function openServiceTicketDrawer(ticketNo) {
  console.log('[svc] open drawer for', ticketNo);
}
```

- [ ] **Step 4: Wire into `_renderServiceAll`**

Update `_renderServiceAll` to call ticket render after the shell:

```js
function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  _renderServiceTickets();
  // Parts, charts, panels, drawer added in subsequent tasks
}
```

- [ ] **Step 5: Verify**

Hard-reload → Service. Expected:
- Open Tickets panel below the KPI strip
- Filter chips show counts that match the KPI tiles
- Click chip → table filters
- Search box → filters as you type
- Click any row → console logs `[svc] open drawer for TICKET…`
- Overdue rows have a red-tint background

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): Open Tickets table with filters

Filter chips: All / Overdue / In 30d / Out 30d / Warranty / Chargeable
(toggleable). Search box with 200ms debounce, matches across ticket
no, customer, REP no, description, fault code, sub-fault.

Rows sorted with overdue first, then by open date desc. First 50
rendered; footer shows 'narrow your filters' when count > 50. Row
click is wired to a drawer stub — full drawer lands in Task 12."
```

---

## Task 9: Parts in Transit panel

**Files:** Modify `index.html`.

- [ ] **Step 1: CSS for parcel cards**

Append:

```css
.svc-parts-list { padding: 11px 20px 16px; display: flex; flex-direction: column; gap: 9px; }
.svc-parcel { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 14px; background: #fff; align-items: center; }
.svc-parcel-icn { width: 40px; height: 40px; border-radius: 11px; background: var(--info-soft); color: var(--info); display: flex; align-items: center; justify-content: center; font-size: 19px; }
.svc-parcel.delivered .svc-parcel-icn { background: var(--pass-soft); color: var(--pass); }
.svc-parcel-mid { min-width: 0; }
.svc-parcel-mid .top { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.svc-parcel-mid .who { font-weight: 700; font-size: 13px; color: var(--repose-navy); }
.svc-parcel-mid .po { font-family: 'JetBrains Mono', monospace; color: var(--text2); font-size: 11px; }
.svc-parcel-mid .tn { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text2); margin-top: 3px; }
.svc-parcel-mid .tn b { color: var(--text); font-weight: 700; }
.svc-parcel-right { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.svc-parcel-right .eta { font-family: 'Bricolage Grotesque', sans-serif; font-size: 13px; font-weight: 700; color: var(--repose-navy); }
.svc-parcel-right .eta .lbl { display: block; font-family: Manrope, sans-serif; font-size: 9px; font-weight: 600; color: var(--text2); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1px; }
```

- [ ] **Step 2: Render function**

```js
function _renderServiceParts() {
  const c = document.getElementById('svc-parts-container');
  if (!c) return;
  const inTransit = _serviceState.parts.filter(p => !p.isDelivered).slice(-10).reverse(); // most recent first
  const delivered = _serviceState.parts.filter(p => p.isDelivered).slice(-3).reverse();
  c.innerHTML = `
    <div class="svc-panel">
      <div class="svc-panel-head">
        <div><h2>Parts in Transit <span class="sub">${inTransit.length} parcel${inTransit.length === 1 ? '' : 's'} · FedEx tracking integration in Phase D</span></h2></div>
      </div>
      <div class="svc-parts-list">
        ${inTransit.map(_servicePartRowHtml('transit')).join('')}
        ${delivered.length ? `<div style="font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--text2);font-weight:700;padding:6px 0">Recently delivered</div>` : ''}
        ${delivered.map(_servicePartRowHtml('delivered')).join('')}
      </div>
      ${(inTransit.length === 0 && delivered.length === 0) ? '<div style="padding:32px;text-align:center;color:var(--text2);font-size:12.5px">No parts dispatches recorded.</div>' : ''}
    </div>
  `;
}

function _servicePartRowHtml(state) {
  return (p) => `
    <div class="svc-parcel ${state}">
      <div class="svc-parcel-icn">${state === 'delivered' ? '✓' : '🚚'}</div>
      <div class="svc-parcel-mid">
        <div class="top">
          <span class="who">${_escapeSvc(p.customer)}</span>
          ${p.poNumber ? `<span class="po">PO ${_escapeSvc(p.poNumber)}</span>` : ''}
        </div>
        ${p.fedexTracking ? `<div class="tn">FedEx <b>${_escapeSvc(p.fedexTracking)}</b></div>` : ''}
        ${p.invoiceNo ? `<div class="tn">Invoice ${_escapeSvc(p.invoiceNo)}</div>` : ''}
      </div>
      <div class="svc-parcel-right">
        ${p.isDelivered ? `<div class="eta"><span class="lbl">Delivered</span>${p.deliveredText}</div>` : `<div class="eta"><span class="lbl">Sent</span>${p.date ? p.date.toLocaleDateString('en-GB') : '—'}</div>`}
      </div>
    </div>
  `;
}
```

- [ ] **Step 3: Wire into `_renderServiceAll`**

```js
function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  _renderServiceTickets();
  _renderServiceParts();
}
```

- [ ] **Step 4: Verify**

Hard-reload → Service. Expected: Parts in Transit panel below Open Tickets. ~5-10 in-transit parcels visible. 3 most-recent delivered shown below in a "Recently delivered" subsection. FedEx tracking numbers and PO refs visible.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): Parts in Transit panel

Renders up to 10 in-transit parcels (most recent first) and 3
recently delivered. Each card shows customer, PO ref, FedEx tracking
number, sent or delivered date. FedEx live status integration
deferred to Phase D — for now the panel renders directly from the
manually-typed Delivered column in Part Tracker."
```

---

## Task 10: Performance trend (13-month) + £ chargeable trend

**Files:** Modify `index.html`.

- [ ] **Step 1: CSS for the charts**

```css
.svc-grid-12 { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; margin-bottom: 16px; }
@media (max-width: 1280px) { .svc-grid-12 { grid-template-columns: 1fr; } }
.svc-perf-strip { padding: 16px 20px; }
.svc-perf-grid { display: grid; grid-template-columns: repeat(13, 1fr); gap: 5px; align-items: end; height: 130px; position: relative; }
.svc-perf-bar { background: linear-gradient(180deg, var(--info), var(--repose-blue-dark)); border-radius: 5px 5px 0 0; cursor: pointer; transition: transform .12s; position: relative; }
.svc-perf-bar:hover { transform: translateY(-2px); }
.svc-perf-bar .val { position: absolute; top: -16px; left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 700; color: var(--text); }
.svc-perf-labels { display: grid; grid-template-columns: repeat(13, 1fr); gap: 5px; font-size: 9.5px; color: var(--text2); text-align: center; font-weight: 600; margin-top: 8px; letter-spacing: .04em; text-transform: uppercase; }
.svc-perf-target { position: relative; height: 1px; border-top: 1px dashed var(--warn); margin-bottom: 8px; }
.svc-perf-target span { position: absolute; left: 0; top: -9px; font-size: 9.5px; font-weight: 700; background: #fff; color: var(--warn); padding: 0 5px; }
.svc-gbp-chart { padding: 16px 20px; }
.svc-gbp-svg { width: 100%; height: 160px; }
```

- [ ] **Step 2: Compute monthly aggregates**

```js
function _computeMonthlyTrend() {
  // Last 13 months (current + 12 back), oldest first
  const months = [];
  const now = new Date();
  for (let i = 12; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ start: d, end: next, label: d.toLocaleDateString('en-GB', { month: 'short' }) });
  }
  for (const m of months) {
    const closed = _serviceState.tickets.filter(t => t.closeDate && t.closeDate >= m.start && t.closeDate < m.end);
    m.avgDays = closed.length === 0 ? 0 : Math.round(closed.reduce((a, t) => a + (t.daysToComplete || 0), 0) / closed.length);
    m.gbp = closed.filter(t => t.warrantyChargeable === 'CHARGEABLE').reduce((a, t) => a + (t.gbp || 0) + (t.gbpDel || 0), 0);
    m.count = closed.length;
  }
  return months;
}
```

- [ ] **Step 3: Render functions**

```js
function _renderServiceCharts() {
  const c = document.getElementById('svc-charts-container');
  if (!c) return;
  const months = _computeMonthlyTrend();
  const maxDays = Math.max(20, ...months.map(m => m.avgDays));
  const maxGbp = Math.max(1, ...months.map(m => m.gbp));
  c.innerHTML = `
    <div class="svc-grid-12">
      <div class="svc-panel">
        <div class="svc-panel-head"><div><h2>Days to close · 13-month trend <span class="sub">target 14d · current ${months[12].avgDays}d</span></h2></div></div>
        <div class="svc-perf-strip">
          <div class="svc-perf-target"><span>14d target</span></div>
          <div class="svc-perf-grid">
            ${months.map(m => `
              <div class="svc-perf-bar" style="height:${(m.avgDays / maxDays) * 100}%" title="${m.label}: ${m.avgDays}d (${m.count} closed)">
                <span class="val">${m.avgDays || ''}</span>
              </div>
            `).join('')}
          </div>
          <div class="svc-perf-labels">
            ${months.map((m, i) => `<div${i === 12 ? ' style="color:var(--repose-blue);font-weight:800"' : ''}>${m.label}</div>`).join('')}
          </div>
        </div>
      </div>

      <div class="svc-panel">
        <div class="svc-panel-head"><div><h2>£ Chargeable revenue <span class="sub">FY ${months.reduce((a, m) => a + m.gbp, 0) > 0 ? 'YTD £' + Math.round(months.reduce((a, m) => a + m.gbp, 0) / 1000) + 'k' : '—'}</span></h2></div></div>
        <div class="svc-gbp-chart">
          <svg class="svc-gbp-svg" viewBox="0 0 360 160" preserveAspectRatio="none">
            ${[40, 80, 120].map(y => `<line x1="0" y1="${y}" x2="360" y2="${y}" stroke="#e1e6eb" stroke-dasharray="2 3"/>`).join('')}
            <polyline points="${months.map((m, i) => `${10 + i * 27},${150 - (m.gbp / maxGbp) * 130}`).join(' ')}" fill="none" stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round"/>
            ${months.map((m, i) => `<circle cx="${10 + i * 27}" cy="${150 - (m.gbp / maxGbp) * 130}" r="3" fill="#7c3aed" stroke="#fff" stroke-width="1.5"/>`).join('')}
          </svg>
          <div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text2);font-weight:600;margin-top:4px">
            ${months.map((m, i) => `<span${i === 12 ? ' style="color:var(--purple);font-weight:800"' : ''}>${m.label}</span>`).join('')}
          </div>
        </div>
        <div class="svc-foot" style="text-align:left;padding:11px 20px">Latest month: <b style="color:var(--text);font-weight:800">£${Math.round(months[12].gbp).toLocaleString('en-GB')}</b></div>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: Wire**

Update `_renderServiceAll`:

```js
function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  _renderServiceTickets();
  _renderServiceParts();
  _renderServiceCharts();
}
```

- [ ] **Step 5: Verify**

Hard-reload → Service. Expected: side-by-side panels showing 13-month bar chart of avg days to close (target line at 14d), and a line chart of £ chargeable per month. Hovering bars shows tooltip with month + avg days.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): 13-month performance + £ chargeable trend

Two side-by-side charts. Performance: bar chart of avg days to close
per month with 14d target line. Current month highlighted blue.
£ chargeable: SVG line chart with markers per month, FY YTD total
in panel header."
```

---

## Task 11: Top faults · Mech codes · Customer scorecard panels

**Files:** Modify `index.html`.

- [ ] **Step 1: CSS**

```css
.svc-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 16px; }
@media (max-width: 1280px) { .svc-grid-3 { grid-template-columns: 1fr; } }
.svc-fault-row, .svc-mech-row, .svc-cust-row { padding: 11px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; cursor: pointer; }
.svc-fault-row:hover, .svc-mech-row:hover, .svc-cust-row:hover { background: var(--bg3); }
.svc-fault-row:last-child, .svc-mech-row:last-child, .svc-cust-row:last-child { border-bottom: none; }
.svc-fault-row .label { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); }
.svc-fault-row .label .sub { display: block; font-size: 10.5px; color: var(--text2); font-weight: 500; margin-top: 1px; }
.svc-fault-row .bar { flex: 1.2; height: 7px; background: var(--grey-soft); border-radius: 999px; overflow: hidden; }
.svc-fault-row .bar div { height: 100%; background: linear-gradient(90deg, var(--info), var(--repose-blue)); border-radius: 999px; }
.svc-fault-row .num, .svc-mech-row .num, .svc-cust-row .num { font-family: 'Bricolage Grotesque', sans-serif; font-size: 17px; font-weight: 800; color: var(--repose-navy); min-width: 32px; text-align: right; }
.svc-mech-row .mc { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; background: var(--repose-navy); color: #fff; padding: 3px 8px; border-radius: 6px; min-width: 42px; text-align: center; }
.svc-mech-row .ms-name { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--text); }
.svc-mech-row .ms-name .sub { display: block; font-size: 10.5px; color: var(--text2); font-weight: 500; margin-top: 1px; }
.svc-cust-row { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; }
.svc-cust-row .rank { font-family: 'Bricolage Grotesque', sans-serif; font-size: 14px; font-weight: 800; color: var(--text3); width: 20px; text-align: center; }
.svc-cust-row .name { font-weight: 700; font-size: 12.5px; color: var(--repose-navy); }
.svc-cust-row .name .sub { display: block; font-size: 10.5px; color: var(--text2); font-weight: 500; margin-top: 2px; }
```

- [ ] **Step 2: Compute helpers**

```js
function _computeTopFaults(limit = 5) {
  const counts = {};
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  for (const t of _serviceState.tickets) {
    if (!t.openDate || t.openDate < monthStart) continue;
    const k = t.faultCode || '—';
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function _computeTopMechCodes(limit = 5) {
  const counts = {};
  const fyStart = new Date(2026, 3, 1); // FY26 starts 1 Apr 2026 — adjust if FY definition differs
  for (const t of _serviceState.tickets) {
    if (!t.openDate || t.openDate < fyStart) continue;
    if (!t.mechCode) continue;
    const k = t.mechCode;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function _computeTopCustomers(limit = 5) {
  const stats = {};
  for (const t of _serviceState.tickets) {
    const k = (t.customer || '—').toUpperCase().trim();
    if (!stats[k]) stats[k] = { count: 0, warranty: 0, daysSum: 0, daysN: 0 };
    stats[k].count++;
    if (t.warrantyChargeable === 'WARRANTY') stats[k].warranty++;
    if (t.daysToComplete) { stats[k].daysSum += t.daysToComplete; stats[k].daysN++; }
  }
  return Object.entries(stats)
    .map(([name, s]) => ({ name, count: s.count, warrantyPct: Math.round(s.warranty / s.count * 100), avgDays: s.daysN ? Math.round(s.daysSum / s.daysN) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
```

- [ ] **Step 3: Render**

```js
function _renderServicePanels() {
  const c = document.getElementById('svc-panels-container');
  if (!c) return;
  const faults = _computeTopFaults();
  const mechs = _computeTopMechCodes();
  const customers = _computeTopCustomers();
  const maxFault = Math.max(1, ...faults.map(([, n]) => n));
  const maxMech = Math.max(1, ...mechs.map(([, n]) => n));
  const maxCust = Math.max(1, ...customers.map(c => c.count));
  c.innerHTML = `
    <div class="svc-grid-3">
      <div class="svc-panel">
        <div class="svc-panel-head"><div><h2>Top fault categories <span class="sub">MTD · top ${faults.length}</span></h2></div></div>
        ${faults.map(([k, n]) => `
          <div class="svc-fault-row">
            <div class="label">${_escapeSvc(k)}</div>
            <div class="bar"><div style="width:${(n / maxFault) * 100}%"></div></div>
            <div class="num">${n}</div>
          </div>
        `).join('') || '<div style="padding:24px;text-align:center;color:var(--text2);font-size:12px">No data this month yet.</div>'}
      </div>

      <div class="svc-panel">
        <div class="svc-panel-head"><div><h2>Mech Code analysis <span class="sub">FY26 · top ${mechs.length}</span></h2></div></div>
        ${mechs.map(([k, n]) => `
          <div class="svc-mech-row">
            <span class="mc">${_escapeSvc(k)}</span>
            <div class="ms-name">Mech ${_escapeSvc(k)}<span class="sub">${n} fault${n === 1 ? '' : 's'} this FY</span></div>
            <div class="num">${n}</div>
          </div>
        `).join('') || '<div style="padding:24px;text-align:center;color:var(--text2);font-size:12px">No mech code data.</div>'}
      </div>

      <div class="svc-panel">
        <div class="svc-panel-head"><div><h2>Customer scorecard <span class="sub">By ticket volume</span></h2></div></div>
        ${customers.map((c, i) => `
          <div class="svc-cust-row">
            <div class="rank">${i + 1}</div>
            <div><div class="name">${_escapeSvc(c.name)}<span class="sub">${c.warrantyPct}% warr · ${c.avgDays}d avg close</span></div></div>
            <div class="num">${c.count}</div>
          </div>
        `).join('') || '<div style="padding:24px;text-align:center;color:var(--text2);font-size:12px">No customer data.</div>'}
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: Wire**

```js
function _renderServiceAll() {
  const content = document.getElementById('svc-content');
  _renderServiceShell(content);
  _renderServiceTickets();
  _renderServiceParts();
  _renderServiceCharts();
  _renderServicePanels();
}
```

- [ ] **Step 5: Verify**

Hard-reload → Service. Expected: 3-column grid below charts. Top faults shows MECHANISM / ELECTRICS / etc with counts. Mech codes shows 1203 / 1211 / etc. Customer scorecard shows CASTELAN / CHARTERHOUSE / GROSVENOR with totals.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): top faults / mech codes / customer scorecard

Three-column panel grid below the trend charts. Top fault categories
(MTD), Mech Code analysis (FY26), Customer scorecard by ticket volume
with warranty% and avg close days."
```

---

## Task 12: Ticket detail drawer (read-only)

**Files:** Modify `index.html`.

- [ ] **Step 1: CSS for drawer**

```css
.svc-drawer-bg { position: fixed; inset: 0; background: rgba(14, 2, 58, 0.55); z-index: 1000; display: flex; justify-content: flex-end; }
.svc-drawer { width: 560px; max-width: 90vw; height: 100vh; background: #fff; box-shadow: -8px 0 32px rgba(0, 0, 0, .15); overflow-y: auto; display: flex; flex-direction: column; }
.svc-drawer-head { padding: 18px 22px; background: linear-gradient(135deg, var(--bbg), #fff); border-bottom: 1px solid var(--border); display: flex; align-items: flex-start; gap: 14px; }
.svc-drawer-head .crumb { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--repose-blue); font-weight: 700; letter-spacing: .04em; }
.svc-drawer-head h2 { font-size: 18px; color: var(--repose-navy); margin-top: 4px; font-family: 'Bricolage Grotesque', Manrope, sans-serif; }
.svc-drawer-head .badges { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.svc-drawer-head .x { background: transparent; border: none; cursor: pointer; font-size: 22px; color: var(--text2); padding: 0; line-height: 1; }
.svc-drawer-section { padding: 16px 22px; border-bottom: 1px solid var(--border); }
.svc-drawer-section:last-child { border-bottom: none; }
.svc-drawer-section h3 { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--text2); font-weight: 700; margin-bottom: 10px; font-family: Manrope, sans-serif; }
.svc-drawer-meta { display: grid; grid-template-columns: 110px 1fr; gap: 6px 14px; font-size: 12.5px; }
.svc-drawer-meta dt { color: var(--text2); font-weight: 600; }
.svc-drawer-meta dd { margin: 0; font-weight: 600; color: var(--text); }
.svc-drawer-section p { font-size: 12.5px; line-height: 1.55; color: var(--text); margin: 0; white-space: pre-wrap; }
```

- [ ] **Step 2: Replace the stub `openServiceTicketDrawer`**

```js
async function openServiceTicketDrawer(ticketNo) {
  const t = _serviceState.tickets.find(x => x.ticketNo === ticketNo);
  if (!t) return;
  const overlay = document.createElement('div');
  overlay.className = 'svc-drawer-bg';
  const fmtDate = d => d ? d.toLocaleDateString('en-GB') : '—';
  const fmtMoney = n => n ? `£${Number(n).toFixed(2)}` : '—';
  overlay.innerHTML = `
    <div class="svc-drawer">
      <div class="svc-drawer-head">
        <div style="flex:1">
          <div class="crumb">${_escapeSvc(t.ticketNo)}</div>
          <h2>${_escapeSvc(t.faultCode || t.description.slice(0, 80) || '—')} · ${_escapeSvc(t.model || '—')}</h2>
          <div class="badges">
            <span class="svc-pill ${t.warrantyChargeable === 'WARRANTY' ? 'warranty' : 'chargeable'}">${t.warrantyChargeable === 'WARRANTY' ? 'WARRANTY' : 'CHARGEABLE'}</span>
            <span class="svc-pill ${t.period30.toLowerCase().startsWith('inside 30') ? 'in30' : 'out30'}">${t.period30 || '—'}</span>
            <span class="svc-pill ${t.openClosed === 'OPEN' ? 'in30' : ''}" style="${t.openClosed === 'CLOSED' ? 'background:var(--pass-soft);color:var(--pass);border-color:var(--gborder)' : ''}">${t.openClosed}</span>
          </div>
        </div>
        <button class="x" id="svc-drawer-close">×</button>
      </div>

      <div class="svc-drawer-section">
        <h3>Ticket details</h3>
        <dl class="svc-drawer-meta">
          <dt>Customer</dt><dd>${_escapeSvc(t.customer || '—')}</dd>
          <dt>REP No</dt><dd>${_escapeSvc(t.repNo || '—')}</dd>
          <dt>PO ref</dt><dd>${_escapeSvc(t.poRef || '—')}</dd>
          <dt>Model</dt><dd>${_escapeSvc(t.model || '—')}</dd>
          <dt>Mech Code</dt><dd>${_escapeSvc(t.mechCode || '—')}</dd>
          <dt>Fault</dt><dd>${_escapeSvc(t.faultCode || '—')} · ${_escapeSvc(t.subFault || '—')}</dd>
          <dt>Open Date</dt><dd>${fmtDate(t.openDate)}</dd>
          <dt>Despatch Date</dt><dd>${fmtDate(t.despatchDate)}</dd>
          <dt>Proposed Close</dt><dd>${fmtDate(t.proposedCloseDate)}</dd>
          <dt>Close Date</dt><dd>${fmtDate(t.closeDate)}</dd>
          <dt>Days to Close</dt><dd>${t.daysToComplete || '—'}</dd>
          <dt>Owner</dt><dd>${_escapeSvc(t.owner || '—')}</dd>
        </dl>
      </div>

      <div class="svc-drawer-section">
        <h3>Description</h3>
        <p>${_escapeSvc(t.description) || '<em style="color:var(--text3)">No description</em>'}</p>
      </div>

      <div class="svc-drawer-section">
        <h3>Action taken</h3>
        <p>${_escapeSvc(t.action) || '<em style="color:var(--text3)">No action recorded</em>'}</p>
      </div>

      ${t.notes ? `
      <div class="svc-drawer-section">
        <h3>Notes</h3>
        <p>${_escapeSvc(t.notes)}</p>
      </div>` : ''}

      <div class="svc-drawer-section">
        <h3>Financials</h3>
        <dl class="svc-drawer-meta">
          <dt>Invoice No</dt><dd>${_escapeSvc(t.invoiceNo || '—')}</dd>
          <dt>Invoice Date</dt><dd>${fmtDate(t.invoiceDate)}</dd>
          <dt>£</dt><dd>${fmtMoney(t.gbp)}</dd>
          <dt>£ Del</dt><dd>${fmtMoney(t.gbpDel)}</dd>
        </dl>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#svc-drawer-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}
```

- [ ] **Step 3: Verify**

Hard-reload → Service → click any ticket row. Expected: right-side drawer slides in showing all the metadata, description, action, notes, financials. Close button (×) and click-outside both dismiss.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): ticket detail drawer (read-only)

Right-slide drawer renders all ticket metadata, description, action,
notes, and financials. Read-only in Phase A — Mark for return /
Add note / Close ticket actions land in Phase B."
```

---

## Task 13: New Ticket form + Excel write-back

**Files:** Modify `index.html`.

This task uses Graph Excel REST `tables/{tableId}/rows/add` for atomic row append. It requires the SharePoint admin step from Task 1 (master sheet converted to Table named `TicketLog`).

- [ ] **Step 1: CSS for the modal**

```css
.svc-modal-bg { position: fixed; inset: 0; background: rgba(14, 2, 58, 0.55); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.svc-modal { background: #fff; border-radius: 18px; max-width: 640px; width: 100%; max-height: 90vh; overflow-y: auto; }
.svc-modal-head { padding: 18px 22px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 14px; }
.svc-modal-head h2 { font-size: 18px; color: var(--repose-navy); flex: 1; font-family: 'Bricolage Grotesque', Manrope, sans-serif; margin: 0; }
.svc-modal-head .x { background: transparent; border: none; cursor: pointer; font-size: 22px; color: var(--text2); padding: 0; }
.svc-modal-body { padding: 16px 22px; }
.svc-field { margin-bottom: 14px; }
.svc-field label { display: block; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text2); font-weight: 700; margin-bottom: 5px; }
.svc-field input, .svc-field select, .svc-field textarea { width: 100%; padding: 9px 12px; border: 1.5px solid var(--border2); border-radius: 9px; font-family: inherit; font-size: 13px; color: var(--text); background: #fff; }
.svc-field textarea { min-height: 70px; resize: vertical; }
.svc-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.svc-modal-foot { padding: 14px 22px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; background: var(--bg3); }
```

- [ ] **Step 2: New Ticket modal + write-back**

```js
function openNewServiceTicketModal() {
  // Build customer dropdown from existing data
  const customers = [...new Set(_serviceState.tickets.map(t => t.customer).filter(Boolean))].sort();
  const models = [...new Set(_serviceState.tickets.map(t => t.model).filter(Boolean))].sort();
  // Fault codes from the dropdowns sheet would be richer; for now derive from data
  const faults = [...new Set(_serviceState.tickets.map(t => t.faultCode).filter(Boolean))].sort();
  const owners = ['Repose', 'Customer'];

  // Generate next ticket number — find max numeric suffix in existing TICKET### IDs
  const maxNum = _serviceState.tickets
    .map(t => /^TICKET(\d+)$/i.exec(t.ticketNo))
    .filter(m => m)
    .map(m => parseInt(m[1], 10))
    .reduce((a, b) => Math.max(a, b), 0);
  const nextTicketNo = `TICKET${maxNum + 1}`;

  const overlay = document.createElement('div');
  overlay.className = 'svc-modal-bg';
  overlay.innerHTML = `
    <div class="svc-modal">
      <div class="svc-modal-head">
        <h2>+ New service ticket</h2>
        <button class="x" id="svc-mod-close">×</button>
      </div>
      <div class="svc-modal-body">
        <div class="svc-field-row">
          <div class="svc-field"><label>Ticket No (auto)</label><input value="${nextTicketNo}" id="svc-f-ticketno" readonly style="background:var(--bg3)"></div>
          <div class="svc-field"><label>Open Date</label><input type="date" id="svc-f-opendate" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="svc-field"><label>Customer *</label><input list="svc-cust-list" id="svc-f-customer" placeholder="Castelan / Charterhouse / …">
          <datalist id="svc-cust-list">${customers.map(c => `<option value="${_escapeSvc(c)}">`).join('')}</datalist>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>REP No</label><input id="svc-f-repno" placeholder="REP2891"></div>
          <div class="svc-field"><label>PO ref</label><input id="svc-f-poref"></div>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>Model</label><input list="svc-model-list" id="svc-f-model"><datalist id="svc-model-list">${models.map(m => `<option value="${_escapeSvc(m)}">`).join('')}</datalist></div>
          <div class="svc-field"><label>Mech Code</label><input id="svc-f-mech" placeholder="1203"></div>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>Period *</label><select id="svc-f-period30"><option value="Inside 30">Inside 30 days</option><option value="Outside 30">Outside 30 days</option></select></div>
          <div class="svc-field"><label>Type *</label><select id="svc-f-wc"><option value="WARRANTY">Warranty</option><option value="CHARGEABLE">Chargeable</option></select></div>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>Fault Code</label><input list="svc-fault-list" id="svc-f-fault"><datalist id="svc-fault-list">${faults.map(f => `<option value="${_escapeSvc(f)}">`).join('')}</datalist></div>
          <div class="svc-field"><label>Sub-Fault</label><input id="svc-f-subfault"></div>
        </div>
        <div class="svc-field"><label>Description *</label><textarea id="svc-f-desc" placeholder="What's the issue, in the customer's words?"></textarea></div>
        <div class="svc-field-row">
          <div class="svc-field"><label>Owner</label><select id="svc-f-owner">${owners.map(o => `<option>${o}</option>`).join('')}</select></div>
          <div class="svc-field"><label>Proposed Close</label><input type="date" id="svc-f-pclose" value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}"></div>
        </div>
      </div>
      <div class="svc-modal-foot">
        <button class="svc-btn svc-btn-sec" id="svc-mod-cancel">Cancel</button>
        <button class="svc-btn svc-btn-pri" id="svc-mod-save">Create ticket</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#svc-mod-close').addEventListener('click', close);
  overlay.querySelector('#svc-mod-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#svc-mod-save').addEventListener('click', async () => {
    const get = id => overlay.querySelector(id).value.trim();
    const customer = get('#svc-f-customer');
    const desc = get('#svc-f-desc');
    if (!customer || !desc) { alert('Customer and Description are required.'); return; }
    const btn = overlay.querySelector('#svc-mod-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const todayIso = get('#svc-f-opendate');
      const pcloseIso = get('#svc-f-pclose');
      const ticketNo = get('#svc-f-ticketno');
      // Build the row matching the 36-column TICKET LOG layout
      const row = new Array(36).fill(null);
      row[0] = ''; // include in pivot — leave blank
      row[1] = get('#svc-f-period30');
      row[2] = ''; // Week — left for Excel formula
      row[3] = `${get('#svc-f-fault')} - ${get('#svc-f-subfault')}`.replace(/^ - $/, '');
      row[4] = ''; // FY — left for Excel formula
      row[5] = todayIso ? new Date(todayIso).toLocaleDateString('en-GB', { month: 'long' }) : '';
      row[6] = ticketNo;
      row[7] = customer;
      row[8] = ''; // Despatch Date
      row[9] = get('#svc-f-repno');
      row[10] = get('#svc-f-poref');
      row[11] = get('#svc-f-model');
      row[12] = get('#svc-f-mech');
      row[13] = desc;
      row[14] = todayIso ? _isoToExcelSerial(todayIso) : null;
      row[15] = ''; // Returned to Factory
      row[16] = ''; // Action
      row[17] = ''; // Notes
      row[18] = get('#svc-f-owner');
      row[19] = pcloseIso ? _isoToExcelSerial(pcloseIso) : null;
      row[20] = null; // Close Date
      row[21] = null; // Days to Complete (formula expected)
      row[22] = null; // Overdue By (formula expected)
      row[23] = ''; // Quality Issue
      row[24] = get('#svc-f-wc');
      row[25] = get('#svc-f-fault');
      row[26] = get('#svc-f-subfault');
      row[27] = 'OPEN';
      // remaining cols (28-35) leave null/empty — invoice + factory-status fields filled later

      const url = `https://graph.microsoft.com/v1.0/drives/${_serviceState.ticketDriveId}/items/${_serviceState.ticketItemId}/workbook/tables('${SERVICE_TICKET_TABLE}')/rows/add`;
      const token = await getGraphToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Graph Excel REST returned ${res.status}: ${errText}`);
      }

      close();
      await loadServiceData(true); // refresh from Excel
      _renderServiceAll();
      alert(`Ticket ${ticketNo} created.`);
    } catch (e) {
      alert(`Failed to create ticket: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Create ticket';
    }
  });
}

// Convert YYYY-MM-DD to Excel serial number (days since 1899-12-30).
function _isoToExcelSerial(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return Math.round((d.getTime() / 86400000) + 25569);
}
```

- [ ] **Step 3: Wire button**

In `_renderServiceShell`, the `+ New Ticket` button is already in the page head HTML. Add the click handler at the end of `_renderServiceShell`:

```js
  // (after the refresh listener)
  document.getElementById('svc-new-ticket-btn').addEventListener('click', openNewServiceTicketModal);
```

- [ ] **Step 4: Verify (live test against the real Excel file!)**

⚠️ **This step writes to the real `REPO-Q006 Ticketing Log V2.xlsx`.** Use a clearly-test customer name like `TEST DELETE ME` so the row is easy to delete from Excel afterwards.

1. Hard-reload → Service → click + New Ticket
2. Fill: Customer = `TEST DELETE ME`, REP No = `TESTREP`, Model = anything, Description = `mockup-test row, please delete`
3. Click Create ticket
4. Wait for "Ticket TICKET#### created" alert
5. Check the dashboard — your test ticket appears in Open Tickets
6. Open the actual Excel file in browser — confirm the row is there at the bottom of the TicketLog table
7. Delete the test row in Excel; refresh in RepNet → ticket is gone

If the POST returns 423 Locked, someone has the file open in desktop Excel. Close their Excel and retry.

If the POST returns 400, the table name is wrong (Task 1 didn't rename the table to `TicketLog`) — fix the Table name in Excel's Table Design tab.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): + New Ticket form + Excel write-back

Modal form with auto-numbered ticket (next TICKET### from max
existing). Datalists for customer, model, fault driven by existing
data. Period, type, owner as selects. Description required.

On submit: Graph Excel REST tables('TicketLog')/rows/add with the
36-column row in correct order. Excel formula columns (Week, FY,
Days to Complete, Overdue By) left null so the table re-evaluates
formulas after append. After success: cache busted, full re-render."
```

---

## Task 14: New Parts Dispatch form + Excel write-back

**Files:** Modify `index.html`.

- [ ] **Step 1: New Parts Dispatch modal + write-back**

```js
function openNewPartsDispatchModal() {
  const customers = [...new Set(_serviceState.parts.map(p => p.customer).filter(Boolean))].sort();
  const overlay = document.createElement('div');
  overlay.className = 'svc-modal-bg';
  overlay.innerHTML = `
    <div class="svc-modal">
      <div class="svc-modal-head">
        <h2>+ New parts dispatch</h2>
        <button class="x" id="svc-pmod-close">×</button>
      </div>
      <div class="svc-modal-body">
        <div class="svc-field-row">
          <div class="svc-field"><label>Date *</label><input type="date" id="svc-pf-date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="svc-field"><label>Customer *</label><input list="svc-pcust-list" id="svc-pf-customer">
            <datalist id="svc-pcust-list">${customers.map(c => `<option value="${_escapeSvc(c)}">`).join('')}</datalist>
          </div>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>PO Number *</label><input id="svc-pf-po"></div>
          <div class="svc-field"><label>Sales Ack No</label><input id="svc-pf-sales"></div>
        </div>
        <div class="svc-field-row">
          <div class="svc-field"><label>Invoice No</label><input id="svc-pf-invoice"></div>
          <div class="svc-field"><label>FedEx Tracking *</label><input id="svc-pf-fedex" placeholder="8876 9467 7089"></div>
        </div>
        <div class="svc-field"><label>Comment</label><textarea id="svc-pf-comment" placeholder="Optional notes"></textarea></div>
      </div>
      <div class="svc-modal-foot">
        <button class="svc-btn svc-btn-sec" id="svc-pmod-cancel">Cancel</button>
        <button class="svc-btn svc-btn-pri" id="svc-pmod-save">Create dispatch</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#svc-pmod-close').addEventListener('click', close);
  overlay.querySelector('#svc-pmod-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#svc-pmod-save').addEventListener('click', async () => {
    const get = id => overlay.querySelector(id).value.trim();
    const date = get('#svc-pf-date');
    const customer = get('#svc-pf-customer');
    const po = get('#svc-pf-po');
    const tracking = get('#svc-pf-fedex');
    if (!date || !customer || !po || !tracking) { alert('Date, Customer, PO Number, and FedEx Tracking are required.'); return; }
    const btn = overlay.querySelector('#svc-pmod-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // 8 columns: Date, Customer, PO Number, Sales Ack No, Invoice No, FedEx Tracking, Delivered, Comment
      const row = [
        _isoToExcelSerial(date),
        customer,
        po,
        get('#svc-pf-sales'),
        get('#svc-pf-invoice'),
        tracking,
        '', // Delivered — left blank; FedEx auto-poll fills this in Phase D
        get('#svc-pf-comment')
      ];
      const url = `https://graph.microsoft.com/v1.0/drives/${_serviceState.partsDriveId}/items/${_serviceState.partsItemId}/workbook/tables('${PARTS_TRACKER_TABLE}')/rows/add`;
      const token = await getGraphToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Graph Excel REST returned ${res.status}: ${errText}`);
      }
      close();
      await loadServiceData(true);
      _renderServiceAll();
      alert(`Parts dispatch for ${customer} (PO ${po}) recorded.`);
    } catch (e) {
      alert(`Failed to create dispatch: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Create dispatch';
    }
  });
}
```

- [ ] **Step 2: Wire the button**

In `_renderServiceShell`, after the new-ticket button listener, add:

```js
  document.getElementById('svc-new-parts-btn').addEventListener('click', openNewPartsDispatchModal);
```

- [ ] **Step 3: Verify**

⚠️ Same caution as Task 13 — this writes to the real `PARTS TRACKER.xlsm`.

1. Hard-reload → Service → click + Parts Dispatch
2. Fill: Date = today, Customer = `TEST DELETE ME`, PO = `TEST-001`, FedEx Tracking = `0000 0000 0000`
3. Click Create dispatch → success alert
4. Confirm row appears in Parts in Transit panel
5. Open `PARTS TRACKER.xlsm` in browser Excel — confirm row at bottom of PartTracker table
6. Delete the test row, refresh RepNet — gone

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(service): + Parts Dispatch form + Excel write-back

Modal form for new parts dispatch row. 8-column row appended via
Graph Excel REST tables('PartTracker')/rows/add. Delivered column
left blank — FedEx auto-poll Azure Function fills it in Phase D.

After success: cache busted, full dashboard re-render. Phase A
foundation is now feature-complete; Phases B-E ship as separate
plans (returns workflow, Maxoptra/iAuditor/FedEx integrations,
SLA pre-alerts + forecast + CAPA bridge, schedule view + photos
+ public tracking page)."
```

---

## Self-Review

**Spec coverage check (Phase A):**

| Phase A goal | Covered by |
|---|---|
| New Service tab in v4 sidebar | Task 2 |
| Excel REST read of both files on view-open + 5-min cache | Tasks 3, 4, 5 |
| Excel REST write-back for `+ New Ticket` and `+ New Parts Dispatch` forms | Tasks 13, 14 |
| Top KPI strip with In30/Out30 + Warranty/Chargeable splits | Tasks 6, 7 |
| Secondary KPI strip (4 mini tiles) | Task 7 |
| SLA breach pre-alerts banner + chip | Task 7B |
| Open Tickets table with filter chips and search | Task 8 |
| Parts in Transit panel | Task 9 |
| Performance trend bar chart | Task 10 |
| £ Chargeable trend line chart | Task 10 |
| Top fault categories panel | Task 11 |
| Mechanism Code analysis panel | Task 11 |
| Customer scorecard panel | Task 11 |
| Ticket detail drawer (read-only) | Task 12 |

All Phase A goals from the spec are covered.

**Placeholder scan:** No `TBD`, `TODO`, or "implement later" references. The PARTS_TRACKER_URL placeholder string in Task 4 is intentional — it's flagged with explicit instructions.

**Type consistency:**
- Ticket fields used in `_serviceTicketRowHtml`, `_renderServiceTickets`, `_serviceTicketMatches`, `_computeServiceKpis`, drawer all match the shape returned by `_mapTicketRow`.
- Parts fields used in `_renderServiceParts`, `_servicePartRowHtml` match `_mapPartsRow`.
- `_serviceState` shape consistent across loadServiceData, kpi compute, render functions.
- Filter chip data attributes (`data-fclear`, `data-foverdue`, `data-fperiod`, `data-fwc`) match the click handlers.

**Phase scope check:** Phase A is foundation only. Returns workflow (chair # assignment, Mark for return, Maxoptra integration, transport email) deferred to Phase B. FedEx auto-tracking, iAuditor, weekly digest, public tracking page deferred to Phase D. No scope creep.

## Risks specific to Phase A

- **Task 13/14 modify real Excel files.** Use clear-test rows ("TEST DELETE ME") and delete them after verifying. There's no undo via Graph if a row append goes to the wrong column.
- **Excel formula propagation timing** — after row append, formulas in TICKET LOG (Days to Complete, Overdue By) might take a few seconds to recalculate. The dashboard refresh after save reads the cell values; a brief "—" might appear in those columns until the next refresh.
- **Concurrent writes from two browsers** — possible if two service team members both click + New Ticket within the same second. Graph's `tables/rows/add` is atomic per request, so both rows will end up in the table — but the auto-numbered Ticket No might collide. **Mitigation:** in a follow-up plan, switch ticket-number generation to use `Date.now()` or a UUID-style suffix so concurrent creates can't collide. For Phase A, the risk is small (<5 service team members, low write rate).
- **PARTS_TRACKER_URL must be set** — if the developer skips Task 1 step 5 and forgets to paste the real URL into the constant, fetchPartTracker fails with a 404 and the whole dashboard fails to load. Mitigation: the placeholder string `__PASTE_PARTS_TRACKER_SHARING_URL_HERE__` will produce a clearly-named Graph error.
