# Document Control — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QHSE-facing Document Control module in RepNet — register view, doc detail, new-document/new-revision/mark-obsolete flows — so Jonas can manage the full document lifecycle inside RepNet, with the SharePoint List as system of record. Foundation only; the email/automation/tablet/Azure-Function pieces ship in a follow-up plan.

**Architecture:** New SharePoint List `MasterDocumentRegister` + companion list `DocumentRevisions` + document library `/QMS-Documents` on the Quality SharePoint site. New view in `index.html` reachable from the v4 sidebar. Vanilla JS, no framework, follows existing RepNet Graph-API + MSAL patterns. Mockup file `document-control-mockup.html` is the visual reference (drawn in v3 styling — must be retheme'd to v4 during Task 4).

**Tech Stack:** Vanilla HTML/CSS/JS in `index.html`, MSAL.js v3, Microsoft Graph API for SharePoint Lists + Drive items, `repnet-skin-v4.js` for sidebar nav injection, Bricolage Grotesque + Manrope fonts.

**Spec:** `docs/superpowers/specs/2026-05-03-document-control-design.md`
**Mockup:** `document-control-mockup.html`

**Verification model:** RepNet has no automated test framework. "Verify" steps are manual browser checks against `?ui=v4` after a hard reload. Each task ends with a commit so progress is recoverable.

**Conventions used in this plan:**
- Site host constant `SP_HOST` and existing site path pattern (`SP_SITE_PATH`, `NMS_SITE_PATH`) live near line 5789 in `index.html`. New constant added in Task 2.
- Helper `getListIdByNameOnSite(siteId, name)` already exists — reused throughout.
- Graph helpers `graphGet`, `graphFetchWithRetry` exist; reused.
- All new code goes inside `index.html` unless explicitly noted. Single-file deploy is intentional (RepNet pattern).

---

## Task 1: Provision SharePoint Lists and Document Library (manual SharePoint admin)

**Files:**
- No code changes. SharePoint admin work via `https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality`.

This task is the only manual-SharePoint step. Do it once and the rest of the plan is code-only.

- [ ] **Step 1: Open the Quality site**

Navigate to: `https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality`
Expected: Quality site lands. Confirm you're on the right site by checking the URL.

- [ ] **Step 2: Create the document library `QMS-Documents`**

Site contents → New → Document library → Name: `QMS-Documents`
Description: `Controlled QMS documents — managed by RepNet Document Control. Do not edit directly.`
Inside the library: Settings → Library settings → Versioning settings:
- Document Version History: **Create major versions**
- Number of major versions to retain: **50**
- Require check out: **No**
- Require content approval: **No**

Create three folders inside the library: `HS`, `Quality`, `Group`.

- [ ] **Step 3: Create the `MasterDocumentRegister` SharePoint List**

Site contents → New → List → Blank list → Name: `MasterDocumentRegister`
Add columns (Settings → List settings → Create column):

| Column name | Type | Required | Notes |
|---|---|---|---|
| `DocNumber` | Single line of text | Yes | Indexed; unique |
| `Title` | Single line of text | Yes | Rename built-in `Title` to `Title` (keep) |
| `Category` | Choice | Yes | Choices: `H&S`, `Quality`, `Group` |
| `Level` | Choice | Yes | Choices: `Policy`, `Procedure`, `Work Instruction`, `Form` |
| `Departments` | Choice (multi) | No | Choices: `Cutting`, `Sewing`, `Upholstery`, `Woodmill`, `Foam`, `Assembly`, `QC`, `Maintenance`, `All / Site-wide` |
| `Status` | Choice | Yes | Choices: `Draft`, `In Review`, `In Approval`, `Published`, `Obsolete`. Default: `Draft` |
| `CurrentRevision` | Number (integer) | Yes | Default: `1` |
| `IssueDate` | Date | No | |
| `LastRevisedDate` | Date | No | |
| `ReviewCycleMonths` | Number (integer) | Yes | Default: `12` |
| `NextReviewDate` | Date | No | Set by code, not by user |
| `Owner` | Person or Group | Yes | Single person |
| `Approvers` | Person or Group | No | Multi-person |
| `FileLink` | Hyperlink | No | URL to the published PDF in `QMS-Documents` |
| `References` | Single line of text | No | Comma-separated DocNumbers (e.g. `REPO-HS022,PHCF-29`) — kept as text in v1 to avoid lookup-list circular-reference complexity |
| `SupersededBy` | Single line of text | No | Either a DocNumber or a free-text URL/feature reference |
| `LinkedMaintenanceTemplate` | Single line of text | No | Maintenance-tab template ID, optional |
| `LinkedRecordsListName` | Single line of text | No | Name of SharePoint list where filled records live |
| `Description` | Multiple lines of text | No | Plain text (not enhanced rich text) |

Settings → Versioning settings → **Create a version each time you edit an item in this list: Yes**, **Keep the following number of versions: 50**.

- [ ] **Step 4: Create the `DocumentRevisions` SharePoint List**

Site contents → New → List → Blank list → Name: `DocumentRevisions`

| Column name | Type | Required |
|---|---|---|
| `DocNumber` | Single line of text | Yes (rename built-in `Title` to `DocNumber`) |
| `Revision` | Number (integer) | Yes |
| `IssueDate` | Date and Time | Yes |
| `ApprovedBy` | Person or Group (multi) | No |
| `ApprovalTimestamps` | Multiple lines of text | No (will store JSON) |
| `ReasonForRevision` | Multiple lines of text | Yes |
| `TriggeredBy` | Single line of text | No |
| `FileVersionId` | Single line of text | No |
| `FileLink` | Hyperlink | No |
| `ChangedFromRev` | Number (integer) | No |

Versioning: leave default (versions enabled, 50 retained).

- [ ] **Step 5: Set list and library permissions**

For both `MasterDocumentRegister` and `DocumentRevisions` and the `QMS-Documents` library:
- Settings → Permissions for this list → Stop inheriting permissions
- Grant `Repose - QHSE` group: **Edit** (or Full Control for QHSE manager account)
- Grant `Repose - All Staff` group: **Read**
- Remove any other groups that auto-inherited

- [ ] **Step 6: Verify**

Open the lists in browser. Confirm columns appear in the order above. Try adding one test row to `MasterDocumentRegister` (e.g. `DocNumber=TEST-001`, `Title=Test`, `Category=Quality`, `Level=Form`, `Status=Draft`, `CurrentRevision=1`, `Owner=jonas.simonaitis@…`). Confirm save works. Delete the test row.

- [ ] **Step 7: Commit**

```bash
git commit --allow-empty -m "infra(docs): SharePoint Lists and library provisioned

Created MasterDocumentRegister, DocumentRevisions and /QMS-Documents
library on the ReposeFurniture-Quality site, with versioning enabled
and QHSE/All-Staff permissions in place. No code changes."
```

---

## Task 2: Add Quality-site constant and Documents view shell

**Files:**
- Modify: `index.html` near line 5789 (site path constants)
- Modify: `index.html` near line 2937 (top nav — add hidden tab as fallback for non-v4 users)
- Modify: `index.html` (add new `<div data-view="documents">` block in the views section)
- Modify: `repnet-skin-v4.js` — `NAV` array (add Documents entry)

- [ ] **Step 1: Add the QMS site path constant + helper**

Find the existing site-id helper cluster in `index.html` (around lines 5860-5920 — `getNmsSiteId`, `cpGetSiteId`, `getSpSiteId` all live here, alongside the `_idCache` / `_saveIdCache()` localStorage pattern). Add the new QMS block **inside that cluster** (immediately after `getNmsSiteId` is the natural spot), so it inherits the same caching convention:

```js
// ── QMS (Quality Management System) — Document Control ───────────
const QMS_SITE_PATH       = '/sites/ReposeFurniture-Quality';
const QMS_DOC_LIB_NAME    = 'QMS-Documents';
const QMS_REGISTER_LIST   = 'MasterDocumentRegister';
const QMS_REVISIONS_LIST  = 'DocumentRevisions';

async function getQmsSiteId() {
  if (_idCache.qmsSiteId) return _idCache.qmsSiteId;
  const res = await graphGet(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`);
  _idCache.qmsSiteId = res.id; _saveIdCache();
  return _idCache.qmsSiteId;
}
```

Why `_idCache` and not a one-off `_qmsSiteIdCache let`: the existing four site/list helpers all share a single localStorage-backed `_idCache` so the lookup survives page reloads. A one-off `let` would silently re-fetch from Graph on every reload and drift from the convention. Match the neighbours.

- [ ] **Step 2: Add the Documents view container**

Find the last `<div data-view="...">` block in `index.html` (likely the `innovation` view block near the other view containers). Add immediately after it:

```html
<div data-view="documents" id="documents-view" style="display:none">
  <div class="docs-shell">
    <div class="docs-loading" id="docs-loading">Loading register…</div>
    <div class="docs-error" id="docs-error" style="display:none"></div>
    <div class="docs-content" id="docs-content" style="display:none"></div>
  </div>
</div>
```

- [ ] **Step 3: Add the legacy top-nav button (hidden by default; v4 sidebar replaces this)**

Find the top-nav block around line 2935. Add this line immediately after the Complaints button:

```html
<button class="nav-item" data-view="documents" id="docs-tab-btn" onclick="navTo('documents')" style="display:none">Documents</button>
```

The `display:none` keeps it hidden in the legacy UI; the v4 sidebar (next step) renders its own entry.

- [ ] **Step 4: Add Documents to the v4 sidebar NAV**

Edit `repnet-skin-v4.js`. Find the `NAV` array around line 23. Insert the Documents entry inside the `Quality / QHSE` group, immediately after Complaints:

```js
{ v: 'complaints',   g: '✉',     l: 'Complaints' },
{ v: 'documents',    g: '📄',    l: 'Documents' },
```

- [ ] **Step 5: Add the Documents view router hook**

Find the function or block that handles per-view setup on `navTo('quality')` (around line 3994 — `if (name === 'quality') openQualityView();`). Add immediately after that line:

```js
if (name === 'documents') openDocumentsView();
```

Then add a stub function near the bottom of the script section (somewhere appropriate alongside `openQualityView`):

```js
async function openDocumentsView() {
  const loading = document.getElementById('docs-loading');
  const errEl   = document.getElementById('docs-error');
  const content = document.getElementById('docs-content');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  content.style.display = 'none';
  try {
    await renderDocumentsRegister(); // implemented in Task 4
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = `Failed to load Documents: ${e.message}`;
    console.error('[docs] open failed', e);
  }
}

async function renderDocumentsRegister() {
  // Filled in Task 4
  const content = document.getElementById('docs-content');
  content.innerHTML = '<p>Documents view — under construction.</p>';
}
```

Also add `'documents': 'Documents'` to the `NAV_LABELS` map around line 3967:

```js
const NAV_LABELS = { 'team-select':'Team View', /*…*/, 'innovation':'Innovation Station', 'maintenance':'Maintenance', 'documents':'Documents' };
```

- [ ] **Step 6: Verify in browser**

```bash
# Hard reload the deployed RepNet (or local server) with the v4 flag:
# https://repnet.../?ui=v4
```

Expected:
- Sidebar shows a "Documents" entry under the Quality / QHSE group with the 📄 glyph.
- Clicking it switches the main area to a "Documents view — under construction." message.
- No console errors.

- [ ] **Step 7: Commit**

```bash
git add index.html repnet-skin-v4.js
git commit -m "feat(docs): add Documents view shell and v4 sidebar entry

Provisions the QMS site path constant, the documents view container,
and routes navTo('documents') to a stub openDocumentsView. Confirmed
the Quality SharePoint site responds to the site-id lookup."
```

---

## Task 3: Add Graph helpers for the document register lists

**Files:**
- Modify: `index.html` — add new helpers in the SharePoint helpers section (around line 5900 after the existing `getListIdByNameOnSite`)

- [ ] **Step 1: Write the fetch helpers**

Add this block immediately after the existing `getListIdByNameOnSite` definition:

```js
// ── Document Control: SharePoint helpers ──────────────────────────
async function fetchAllDocs() {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REGISTER_LIST);
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`;
  const items = await graphGetAll(url);
  return items.map(_mapDocItem);
}

async function fetchDocByNumber(docNumber) {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REGISTER_LIST);
  const safe = String(docNumber).replace(/'/g, "''");
  const filter = encodeURIComponent(`fields/DocNumber eq '${safe}'`);
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$filter=${filter}&$top=2`;
  const res = await graphGet(url);
  if (!res.value || res.value.length === 0) return null;
  return _mapDocItem(res.value[0]);
}

async function fetchRevisionsForDoc(docNumber) {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REVISIONS_LIST);
  const safe = String(docNumber).replace(/'/g, "''");
  const filter = encodeURIComponent(`fields/DocNumber eq '${safe}'`);
  const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$filter=${filter}&$orderby=fields/Revision desc&$top=999`;
  const items = await graphGetAll(url);
  return items.map(_mapRevItem);
}

async function createDoc(payload) {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REGISTER_LIST);
  const token = await getGraphToken();
  const res = await _graphFetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: payload })
  });
  if (!res.ok) throw new Error(`createDoc failed: ${res.status} ${await res.text()}`);
  return _mapDocItem(await res.json());
}

async function updateDoc(itemId, fields, etag) {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REGISTER_LIST);
  const token = await getGraphToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (etag) headers['If-Match'] = etag;
  const res = await _graphFetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(fields)
  });
  if (res.status === 412) throw new Error('Document was modified by someone else — please reload.');
  if (!res.ok) throw new Error(`updateDoc failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function createRevision(payload) {
  const siteId = await getQmsSiteId();
  const listId = await getListIdByNameOnSite(siteId, QMS_REVISIONS_LIST);
  const token = await getGraphToken();
  const res = await _graphFetchWithRetry(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: payload })
  });
  if (!res.ok) throw new Error(`createRevision failed: ${res.status} ${await res.text()}`);
  return _mapRevItem(await res.json());
}

async function uploadDocFile(category, fileName, fileBlob) {
  // category = 'HS' | 'Quality' | 'Group'
  const siteId = await getQmsSiteId();
  const driveResp = await graphGet(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive`);
  const driveId = driveResp.id;
  const token = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(category)}/${encodeURIComponent(fileName)}:/content`;
  const res = await _graphFetchWithRetry(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: fileBlob
  });
  if (!res.ok) throw new Error(`uploadDocFile failed: ${res.status} ${await res.text()}`);
  const item = await res.json();
  return { id: item.id, webUrl: item.webUrl, downloadUrl: item['@microsoft.graph.downloadUrl'] };
}

// ── Mappers — flatten the SharePoint $expand=fields shape ──────────
function _mapDocItem(item) {
  const f = item.fields || {};
  return {
    id: item.id,
    etag: item['@odata.etag'] || null,
    docNumber: f.DocNumber || '',
    title: f.Title || '',
    category: f.Category || '',
    level: f.Level || '',
    departments: Array.isArray(f.Departments) ? f.Departments : (f.Departments ? [f.Departments] : []),
    status: f.Status || 'Draft',
    currentRevision: Number(f.CurrentRevision || 1),
    issueDate: f.IssueDate || null,
    lastRevisedDate: f.LastRevisedDate || null,
    reviewCycleMonths: Number(f.ReviewCycleMonths || 12),
    nextReviewDate: f.NextReviewDate || null,
    ownerEmail: (f.Owner && f.Owner.Email) || f.OwnerLookupId || '',
    approverEmails: Array.isArray(f.Approvers) ? f.Approvers.map(a => a.Email).filter(Boolean) : [],
    fileLink: (f.FileLink && f.FileLink.Url) || f.FileLink || '',
    references: (f.References || '').split(',').map(s => s.trim()).filter(Boolean),
    supersededBy: f.SupersededBy || '',
    linkedMaintenanceTemplate: f.LinkedMaintenanceTemplate || '',
    linkedRecordsListName: f.LinkedRecordsListName || '',
    description: f.Description || ''
  };
}

function _mapRevItem(item) {
  const f = item.fields || {};
  return {
    id: item.id,
    docNumber: f.DocNumber || '',
    revision: Number(f.Revision || 0),
    issueDate: f.IssueDate || null,
    approvedByEmails: Array.isArray(f.ApprovedBy) ? f.ApprovedBy.map(a => a.Email).filter(Boolean) : [],
    approvalTimestamps: f.ApprovalTimestamps ? _safeJson(f.ApprovalTimestamps, []) : [],
    reasonForRevision: f.ReasonForRevision || '',
    triggeredBy: f.TriggeredBy || '',
    fileVersionId: f.FileVersionId || '',
    fileLink: (f.FileLink && f.FileLink.Url) || f.FileLink || '',
    changedFromRev: f.ChangedFromRev != null ? Number(f.ChangedFromRev) : null
  };
}

function _safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
```

- [ ] **Step 2: Verify by calling fetchAllDocs from the console**

In `openDocumentsView`, temporarily replace the stub with:

```js
async function renderDocumentsRegister() {
  const docs = await fetchAllDocs();
  console.log('[docs] fetched', docs.length, 'documents', docs);
  const content = document.getElementById('docs-content');
  content.innerHTML = `<pre>Fetched ${docs.length} documents. See console for details.</pre>`;
}
```

Hard reload `?ui=v4`. Click Documents. Expected: console logs an array (empty if no rows yet, or 1 if you left a test row in Task 1). No error in either case.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(docs): Graph API helpers for register and revisions

Adds fetchAllDocs, fetchDocByNumber, fetchRevisionsForDoc, createDoc,
updateDoc (with ETag concurrency), createRevision and uploadDocFile.
Verified read path returns the test row from MasterDocumentRegister."
```

---

## Task 4: Render the register view (read-only)

**Files:**
- Modify: `index.html` — replace the `renderDocumentsRegister` stub from Task 3
- Modify: `index.html` — add CSS in the existing `<style>` block, near the v4 styles

This is the largest task. Splitting steps fine.

- [ ] **Step 1: Add the CSS for the register view (v4 styling)**

**Pre-requisite:** the `:root` block in the main `<style>` declares `--display`, `--body`, `--mono` variables. Add them if missing — see the Task 4 Review Revisions commit (`refactor(docs): code-quality fixes on Task 4 register view`) for reference. Without these definitions, the unwrapped `var(--display)` / `var(--mono)` selectors below silently fall back to the inherited body font.

Find the end of the v4 stylesheet block in `index.html` (search for `--repose-blue` definitions, then scroll to the closing `</style>` for the main app). Add this block before the closing `</style>`:

```css
/* ── Document Control · v4 ──────────────────────────────────── */
.docs-shell { padding: 24px 28px; max-width: 1480px; margin: 0 auto; font-family: var(--body, "Manrope", system-ui, sans-serif); }
.docs-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 22px; }
.docs-head h1 { font-family: var(--display, "Bricolage Grotesque", system-ui, sans-serif); font-weight: 800; font-size: 38px; letter-spacing: -.025em; color: var(--repose-navy); margin: 0; line-height: 1.05; }
.docs-head h1 em { font-style: italic; color: var(--repose-blue); font-weight: 600; }
.docs-head .sub { font-family: var(--mono, "JetBrains Mono", ui-monospace, monospace); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--text2); margin-top: 6px; }
.docs-head .actions { display: flex; gap: 8px; }
.docs-btn { font-family: var(--body); font-size: 13px; font-weight: 700; padding: 10px 18px; border-radius: 999px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
.docs-btn-pri { background: var(--repose-blue); color: #fff; }
.docs-btn-sec { background: #fff; color: var(--repose-navy); border: 1.5px solid var(--border2); }

.docs-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 22px; }
.docs-kpi { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; display: flex; gap: 14px; align-items: center; }
.docs-kpi-icn { width: 42px; height: 42px; border-radius: 999px; background: var(--bbg); color: var(--repose-blue); display: flex; align-items: center; justify-content: center; font-size: 18px; }
.docs-kpi.warn .docs-kpi-icn { background: var(--abg); color: var(--amber); }
.docs-kpi.fail .docs-kpi-icn { background: var(--rbg); color: var(--red); }
.docs-kpi.purple .docs-kpi-icn { background: #ede9fe; color: #7c3aed; }
.docs-kpi-num { font-family: var(--display); font-size: 26px; font-weight: 800; color: var(--repose-navy); line-height: 1; letter-spacing: -.01em; }
.docs-kpi-lbl { font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--text2); margin-top: 5px; }

.docs-main { display: grid; grid-template-columns: 240px 1fr; gap: 18px; align-items: start; }
.docs-side { background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 18px; position: sticky; top: 20px; }
.docs-side h4 { font-family: var(--mono); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text2); margin: 0 0 10px; font-weight: 700; }
.docs-side h4:not(:first-child) { margin-top: 18px; }
.docs-side input[type=search] { width: 100%; padding: 9px 12px; font-family: inherit; font-size: 13px; border: 1.5px solid var(--border2); border-radius: 999px; background: var(--bg3); margin-bottom: 12px; }
.docs-side label { display: flex; gap: 8px; align-items: center; font-size: 13px; padding: 4px 0; cursor: pointer; }
.docs-side label .cnt { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--text3); }

.docs-table-wrap { background: #fff; border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
.docs-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.docs-table thead th { background: var(--bg3); padding: 11px 14px; font-family: var(--mono); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--text2); font-weight: 700; text-align: left; border-bottom: 1px solid var(--border); }
.docs-table tbody td { padding: 13px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.docs-table tbody tr { cursor: pointer; }
.docs-table tbody tr:hover { background: var(--bg3); }
.docs-table tbody tr.expanded { background: var(--bbg); }
.docs-num { font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--repose-navy); }
.docs-lvl { display: inline-block; font-size: 9.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; margin-right: 6px; vertical-align: middle; }
.docs-lvl.policy { background: #fef3c7; color: #92400e; }
.docs-lvl.proc { background: #dbeafe; color: #1e40af; }
.docs-lvl.wi { background: #e0e7ff; color: #4338ca; }
.docs-lvl.form { background: #f1f5f9; color: #475569; }
.docs-dept { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: var(--bbg); color: var(--repose-blue); margin-right: 4px; margin-top: 4px; }
.docs-dept.all { background: #ede9fe; color: #7c3aed; }
.docs-rev { font-family: var(--mono); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--bg3); color: var(--repose-navy); }
.docs-badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.docs-badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.docs-badge.pub { background: var(--gbg); color: var(--green); }
.docs-badge.draft { background: var(--bg3); color: var(--text2); }
.docs-badge.review { background: var(--abg); color: var(--amber); }
.docs-badge.appr { background: var(--bbg); color: var(--repose-blue); }
.docs-badge.obs { background: var(--rbg); color: var(--red); }
.docs-due.warn { color: var(--amber); font-weight: 700; }
.docs-due.over { color: var(--red); font-weight: 800; }

.docs-empty { padding: 36px; text-align: center; color: var(--text2); }
.docs-error { padding: 24px; background: var(--rbg); border: 1px solid var(--rborder); color: var(--red); border-radius: 12px; }
.docs-loading { padding: 36px; text-align: center; color: var(--text2); }
```

- [ ] **Step 2: Replace the renderDocumentsRegister stub**

Replace the stub with:

```js
let _docsState = { all: [], filters: { q: '', categories: new Set(), levels: new Set(), depts: new Set(), statuses: new Set(['Published','In Approval','In Review','Draft']) } };

async function renderDocumentsRegister() {
  const content = document.getElementById('docs-content');
  _docsState.all = await fetchAllDocs();
  _renderDocsShell(content);
  _renderDocsTable();
  _bindDocsFilters();
}

function _renderDocsShell(root) {
  const counts = _docsCounts(_docsState.all);
  root.innerHTML = `
    <div class="docs-head">
      <div>
        <h1>Document <em>Control</em></h1>
        <div class="sub">${_docsState.all.length} controlled documents · QMS register</div>
      </div>
      <div class="actions">
        <button class="docs-btn docs-btn-sec" id="docs-export-btn">⬇ Export to Excel</button>
        <button class="docs-btn docs-btn-pri" id="docs-new-btn">＋ New document</button>
      </div>
    </div>

    <div class="docs-kpis">
      <div class="docs-kpi"><div class="docs-kpi-icn">📄</div><div><div class="docs-kpi-num">${counts.active}</div><div class="docs-kpi-lbl">Active</div></div></div>
      <div class="docs-kpi warn"><div class="docs-kpi-icn">⏰</div><div><div class="docs-kpi-num">${counts.dueReview}</div><div class="docs-kpi-lbl">Due for review · 30 days</div></div></div>
      <div class="docs-kpi purple"><div class="docs-kpi-icn">✓</div><div><div class="docs-kpi-num">${counts.pending}</div><div class="docs-kpi-lbl">Pending approval</div></div></div>
      <div class="docs-kpi fail"><div class="docs-kpi-icn">⌀</div><div><div class="docs-kpi-num">${counts.obsolete}</div><div class="docs-kpi-lbl">Obsolete</div></div></div>
    </div>

    <div class="docs-main">
      <aside class="docs-side">
        <h4>Search</h4>
        <input type="search" id="docs-search" placeholder="REPO-Q…" value="${_escape(_docsState.filters.q)}">

        <h4>Category</h4>
        ${['H&S','Quality','Group'].map(c => `<label><input type="checkbox" data-fcat="${c}" ${_docsState.filters.categories.size===0||_docsState.filters.categories.has(c)?'checked':''}> ${c} <span class="cnt">${counts.byCat[c]||0}</span></label>`).join('')}

        <h4>Level</h4>
        ${[['Policy','policy'],['Procedure','proc'],['Work Instruction','wi'],['Form','form']].map(([l,k]) => `<label><input type="checkbox" data-flvl="${l}" ${_docsState.filters.levels.size===0||_docsState.filters.levels.has(l)?'checked':''}> <span class="docs-lvl ${k}">${l.replace('Work Instruction','Work Instr.')}</span> <span class="cnt">${counts.byLvl[l]||0}</span></label>`).join('')}

        <h4>Department</h4>
        ${['Cutting','Sewing','Upholstery','Woodmill','Foam','Assembly','QC','Maintenance','All / Site-wide'].map(d => `<label><input type="checkbox" data-fdpt="${d}" ${_docsState.filters.depts.size===0||_docsState.filters.depts.has(d)?'checked':''}> ${d} <span class="cnt">${counts.byDept[d]||0}</span></label>`).join('')}

        <h4>Status</h4>
        ${['Published','In Approval','In Review','Draft','Obsolete'].map(s => `<label><input type="checkbox" data-fst="${s}" ${_docsState.filters.statuses.has(s)?'checked':''}> ${s} <span class="cnt">${counts.byStatus[s]||0}</span></label>`).join('')}
      </aside>

      <div class="docs-table-wrap" id="docs-table-wrap">
        <!-- table injected by _renderDocsTable -->
      </div>
    </div>
  `;
}

function _renderDocsTable() {
  const wrap = document.getElementById('docs-table-wrap');
  const filtered = _docsState.all.filter(_docsRowMatchesFilters);
  filtered.sort((a,b) => a.docNumber.localeCompare(b.docNumber, 'en', { numeric: true }));

  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="docs-empty">No documents match your filters.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="docs-table">
      <thead>
        <tr>
          <th style="width:128px">Doc No.</th>
          <th>Title · Department</th>
          <th style="width:60px">Cat.</th>
          <th style="width:62px">Rev</th>
          <th style="width:108px">Status</th>
          <th style="width:122px">Next review</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(_docsRowHtml).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => openDocumentDetail(tr.dataset.docnumber));
  });
}

function _docsRowHtml(d) {
  const lvlClass = ({'Policy':'policy','Procedure':'proc','Work Instruction':'wi','Form':'form'})[d.level] || 'form';
  const lvlLabel = d.level === 'Work Instruction' ? 'WI' : (d.level || 'Form');
  const due = _docsDueLabel(d.nextReviewDate);
  const statusClass = ({'Published':'pub','Draft':'draft','In Review':'review','In Approval':'appr','Obsolete':'obs'})[d.status] || 'draft';
  const depts = (d.departments || []).map(dp => `<span class="docs-dept ${dp==='All / Site-wide'?'all':''}">${_escape(dp)}</span>`).join('');
  return `
    <tr data-docnumber="${_escape(d.docNumber)}">
      <td><span class="docs-num">${_escape(d.docNumber)}</span></td>
      <td><span class="docs-lvl ${lvlClass}">${lvlLabel}</span>${_escape(d.title)}<div>${depts}</div></td>
      <td>${_escape(d.category)}</td>
      <td><span class="docs-rev">Rev ${d.currentRevision}</span></td>
      <td><span class="docs-badge ${statusClass}">${_escape(d.status)}</span></td>
      <td><span class="docs-due ${due.cls}">${due.text}</span></td>
    </tr>
  `;
}

function _docsDueLabel(iso) {
  if (!iso) return { cls: '', text: '—' };
  const today = new Date();
  const d = new Date(iso);
  const days = Math.round((d - today) / 86400000);
  if (days < 0) return { cls: 'over', text: `${iso.slice(0,10)} · overdue` };
  if (days <= 30) return { cls: 'warn', text: `${iso.slice(0,10)} · ${days} days` };
  return { cls: '', text: iso.slice(0,10) };
}

function _docsRowMatchesFilters(d) {
  const f = _docsState.filters;
  if (f.q && !(`${d.docNumber} ${d.title}`.toLowerCase().includes(f.q.toLowerCase()))) return false;
  if (f.statuses.size > 0 && !f.statuses.has(d.status)) return false;
  if (f.categories.size > 0 && !f.categories.has(d.category)) return false;
  if (f.levels.size > 0 && !f.levels.has(d.level)) return false;
  if (f.depts.size > 0) {
    const overlap = (d.departments || []).some(dp => f.depts.has(dp));
    if (!overlap) return false;
  }
  return true;
}

function _docsCounts(docs) {
  const today = new Date();
  const counts = { active: 0, dueReview: 0, pending: 0, obsolete: 0, byCat: {}, byLvl: {}, byDept: {}, byStatus: {} };
  for (const d of docs) {
    counts.byCat[d.category] = (counts.byCat[d.category] || 0) + 1;
    counts.byLvl[d.level] = (counts.byLvl[d.level] || 0) + 1;
    counts.byStatus[d.status] = (counts.byStatus[d.status] || 0) + 1;
    for (const dp of (d.departments || [])) counts.byDept[dp] = (counts.byDept[dp] || 0) + 1;
    if (d.status === 'Published') counts.active++;
    if (d.status === 'In Approval') counts.pending++;
    if (d.status === 'Obsolete') counts.obsolete++;
    if (d.status === 'Published' && d.nextReviewDate) {
      const days = Math.round((new Date(d.nextReviewDate) - today) / 86400000);
      if (days <= 30) counts.dueReview++;
    }
  }
  return counts;
}

function _bindDocsFilters() {
  const root = document.getElementById('docs-content');
  root.querySelector('#docs-search').addEventListener('input', e => { _docsState.filters.q = e.target.value; _renderDocsTable(); });
  root.querySelectorAll('input[data-fcat]').forEach(el => el.addEventListener('change', () => _toggleSetFilter('categories', 'fcat')));
  root.querySelectorAll('input[data-flvl]').forEach(el => el.addEventListener('change', () => _toggleSetFilter('levels', 'flvl')));
  root.querySelectorAll('input[data-fdpt]').forEach(el => el.addEventListener('change', () => _toggleSetFilter('depts', 'fdpt')));
  root.querySelectorAll('input[data-fst]').forEach(el => el.addEventListener('change', () => _toggleSetFilter('statuses', 'fst')));
  root.querySelector('#docs-new-btn').addEventListener('click', () => openNewDocumentModal()); // Task 6
  root.querySelector('#docs-export-btn').addEventListener('click', () => alert('Excel export ships in the follow-up plan.'));
}

function _toggleSetFilter(stateKey, attr) {
  const set = _docsState.filters[stateKey] = new Set();
  document.querySelectorAll(`input[data-${attr}]:checked`).forEach(el => set.add(el.dataset[attr]));
  _renderDocsTable();
}

function _escape(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Stub; implemented in Task 5
function openDocumentDetail(docNumber) { console.log('[docs] detail for', docNumber); }
// Stub; implemented in Task 6
function openNewDocumentModal() { console.log('[docs] new doc modal — not yet implemented'); }
```

- [ ] **Step 3: Verify in browser**

Hard reload `?ui=v4` → click Documents.
Expected:
- Documents header with italic *Control* in blue.
- 4 KPI tiles (zeros if no data yet, or accurate counts after import).
- Sidebar with Category / Level / Department / Status filter sections.
- Empty-state "No documents match your filters." OR a table if you have rows.
- Toggling a checkbox re-renders the table.
- Clicking the search box and typing filters in real time.
- Clicking a row logs the docNumber to console (stub).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(docs): register view with KPI tiles and filters

Implements renderDocumentsRegister with KPI tiles, sidebar filters
(Category/Level/Department/Status/Search), and a sortable register
table styled to v4. Detail and new-document buttons are stubbed."
```

---

## Task 5: Document detail drawer

**Files:**
- Modify: `index.html` — replace the `openDocumentDetail` stub
- Modify: `index.html` — add CSS for the drawer

- [ ] **Step 1: Add CSS for the detail drawer**

Append to the document-control CSS block from Task 4:

```css
.docs-drawer-bg { position: fixed; inset: 0; background: rgba(14,2,58,.4); z-index: 1500; display: flex; justify-content: flex-end; }
.docs-drawer { width: 760px; max-width: 100%; height: 100%; background: var(--bg); overflow-y: auto; box-shadow: -10px 0 40px rgba(14,2,58,.25); }
.docs-drawer-head { padding: 18px 24px; background: var(--repose-navy); color: #fff; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 1; }
.docs-drawer-head .crumb { font-family: var(--mono); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; opacity: .6; margin-bottom: 4px; }
.docs-drawer-head h2 { font-family: var(--display); font-weight: 800; font-size: 22px; margin: 0; letter-spacing: -.01em; }
.docs-drawer-head .x { width: 32px; height: 32px; border-radius: 999px; background: rgba(255,255,255,.1); border: none; color: #fff; cursor: pointer; font-size: 18px; }
.docs-drawer-body { padding: 22px 24px; }
.docs-card { background: #fff; border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; margin-bottom: 14px; }
.docs-card h3 { font-family: var(--mono); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--text2); font-weight: 800; margin: 0 0 10px; }
.docs-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 18px; font-size: 13px; }
.docs-meta dt { font-family: var(--mono); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--text2); margin-bottom: 2px; }
.docs-meta dd { margin: 0; color: var(--text); font-weight: 600; }
.docs-tl { padding: 10px 0; border-bottom: 1px dashed var(--border); display: flex; gap: 12px; }
.docs-tl:last-child { border-bottom: none; }
.docs-tl-pill { font-family: var(--mono); font-size: 10px; font-weight: 800; padding: 4px 9px; border-radius: 999px; background: var(--bbg); color: var(--repose-blue); height: fit-content; }
.docs-tl-body { flex: 1; }
.docs-tl-top { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 600; margin-bottom: 3px; }
.docs-tl-when { font-family: var(--mono); color: var(--text2); font-weight: 500; }
.docs-tl-note { font-size: 12px; color: var(--text2); }
.docs-actions-row { display: flex; gap: 10px; margin-top: 16px; }
.docs-xref { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.docs-xref h4 { font-family: var(--mono); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text2); font-weight: 800; margin: 0 0 8px; }
.docs-xref-item { padding: 7px 10px; background: var(--bg3); border: 1px solid var(--border); border-radius: 999px; font-size: 12px; margin-bottom: 4px; cursor: pointer; }
.docs-xref-item:hover { border-color: var(--repose-blue); background: #fff; }
```

- [ ] **Step 2: Replace the openDocumentDetail stub**

```js
async function openDocumentDetail(docNumber) {
  const doc = _docsState.all.find(d => d.docNumber === docNumber);
  if (!doc) return;
  const overlay = document.createElement('div');
  overlay.className = 'docs-drawer-bg';
  overlay.innerHTML = `
    <div class="docs-drawer" id="docs-drawer">
      <div class="docs-drawer-head">
        <div>
          <div class="crumb">${_escape(doc.category)} · ${_escape(doc.level)}</div>
          <h2>${_escape(doc.docNumber)} — ${_escape(doc.title)}</h2>
        </div>
        <button class="x" id="docs-drawer-close">×</button>
      </div>
      <div class="docs-drawer-body">
        <div class="docs-card">
          <h3>Document metadata</h3>
          <dl class="docs-meta">
            <div><dt>Status</dt><dd>${_escape(doc.status)} (Rev ${doc.currentRevision})</dd></div>
            <div><dt>Owner</dt><dd>${_escape(doc.ownerEmail || '—')}</dd></div>
            <div><dt>Approvers</dt><dd>${(doc.approverEmails||[]).map(_escape).join(', ') || '—'}</dd></div>
            <div><dt>Departments</dt><dd>${(doc.departments||[]).map(_escape).join(', ') || '—'}</dd></div>
            <div><dt>Issue date</dt><dd>${doc.issueDate ? doc.issueDate.slice(0,10) : '—'}</dd></div>
            <div><dt>Last revised</dt><dd>${doc.lastRevisedDate ? doc.lastRevisedDate.slice(0,10) : '—'}</dd></div>
            <div><dt>Review cycle</dt><dd>${doc.reviewCycleMonths} months</dd></div>
            <div><dt>Next review</dt><dd>${doc.nextReviewDate ? doc.nextReviewDate.slice(0,10) : '—'}</dd></div>
          </dl>
          <div class="docs-actions-row">
            ${doc.fileLink ? `<a class="docs-btn docs-btn-sec" href="${_escape(doc.fileLink)}" target="_blank">↗ Open current file</a>` : ''}
            ${doc.status !== 'Obsolete' ? `<button class="docs-btn docs-btn-pri" id="docs-revise-btn">＋ New revision</button>` : ''}
            ${doc.status !== 'Obsolete' ? `<button class="docs-btn docs-btn-sec" id="docs-obsolete-btn">⌀ Mark obsolete</button>` : ''}
          </div>
        </div>

        <div class="docs-card">
          <h3>Cross-references · impact analysis</h3>
          <div class="docs-xref">
            <div>
              <h4>This doc references</h4>
              <div id="docs-refs-out">${(doc.references||[]).map(r => `<div class="docs-xref-item" data-jump="${_escape(r)}">${_escape(r)} →</div>`).join('') || '<em style="color:var(--text3)">none</em>'}</div>
            </div>
            <div>
              <h4>Referenced by</h4>
              <div id="docs-refs-in">${_referencedByHtml(doc.docNumber)}</div>
            </div>
          </div>
        </div>

        <div class="docs-card" id="docs-rev-card">
          <h3>Revision history</h3>
          <div id="docs-rev-list">Loading…</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#docs-drawer-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const reviseBtn = overlay.querySelector('#docs-revise-btn');
  if (reviseBtn) reviseBtn.addEventListener('click', () => openReviseDocumentModal(doc)); // Task 7
  const obsoleteBtn = overlay.querySelector('#docs-obsolete-btn');
  if (obsoleteBtn) obsoleteBtn.addEventListener('click', () => markDocumentObsolete(doc)); // Task 8
  overlay.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => {
    const target = el.dataset.jump;
    overlay.remove();
    openDocumentDetail(target);
  }));

  // Async: load revisions
  fetchRevisionsForDoc(docNumber).then(revs => {
    const list = overlay.querySelector('#docs-rev-list');
    if (revs.length === 0) { list.innerHTML = '<em style="color:var(--text3)">No revision history yet.</em>'; return; }
    list.innerHTML = revs.map(r => `
      <div class="docs-tl">
        <div class="docs-tl-pill">Rev ${r.revision}</div>
        <div class="docs-tl-body">
          <div class="docs-tl-top">
            <span>${_escape(r.reasonForRevision || 'Initial issue')}${r.triggeredBy ? ` · <em style="color:#7c3aed">${_escape(r.triggeredBy)}</em>` : ''}</span>
            <span class="docs-tl-when">${r.issueDate ? r.issueDate.slice(0,10) : '—'}</span>
          </div>
          <div class="docs-tl-note">Approved by: ${(r.approvedByEmails||[]).map(_escape).join(', ') || '—'}${r.fileLink ? ` · <a href="${_escape(r.fileLink)}" target="_blank">↓ PDF</a>` : ''}</div>
        </div>
      </div>
    `).join('');
  }).catch(err => {
    overlay.querySelector('#docs-rev-list').innerHTML = `<div class="docs-error">Failed to load revisions: ${_escape(err.message)}</div>`;
  });
}

function _referencedByHtml(docNumber) {
  const incoming = _docsState.all.filter(d => (d.references || []).includes(docNumber));
  if (incoming.length === 0) return '<em style="color:var(--text3)">none</em>';
  return incoming.map(d => `<div class="docs-xref-item" data-jump="${_escape(d.docNumber)}">${_escape(d.docNumber)} — ${_escape(d.title)} →</div>`).join('');
}

// Stubs; replaced in Task 7 and Task 8
function openReviseDocumentModal(doc) { alert(`Revise ${doc.docNumber} — implemented in Task 7`); }
async function markDocumentObsolete(doc) { alert(`Mark ${doc.docNumber} obsolete — implemented in Task 8`); }
```

- [ ] **Step 3: Verify**

Hard reload, click a document row.
Expected: drawer slides in from the right; header shows DocNumber + Title in white on navy; metadata grid renders; revision history loads asynchronously (or shows "No revision history yet" if the row has none); clicking ✕ or the backdrop closes the drawer; clicking a referenced DocNumber jumps to that doc's drawer.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(docs): document detail drawer with metadata, refs, revisions

Right-anchored slide-in drawer shows the document metadata,
cross-references (with referenced-by computed from in-memory state),
and revision history fetched from DocumentRevisions list. Revise and
Mark Obsolete buttons are stubbed."
```

---

## Task 6: New document modal (create flow)

**Files:**
- Modify: `index.html` — replace the `openNewDocumentModal` stub
- Modify: `index.html` — add modal CSS

- [ ] **Step 1: Add CSS for the modal**

Append to the document-control CSS block:

```css
.docs-modal-bg { position: fixed; inset: 0; background: rgba(14,2,58,.5); z-index: 1600; display: flex; align-items: center; justify-content: center; }
.docs-modal { background: #fff; width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto; border-radius: 14px; box-shadow: 0 30px 80px rgba(14,2,58,.3); }
.docs-modal-head { padding: 18px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.docs-modal-head h2 { font-family: var(--display); font-weight: 800; font-size: 18px; color: var(--repose-navy); margin: 0; }
.docs-modal-body { padding: 22px 24px; }
.docs-modal-foot { padding: 14px 24px; border-top: 1px solid var(--border); background: var(--bg3); display: flex; gap: 8px; justify-content: flex-end; }
.docs-field { margin-bottom: 14px; }
.docs-field label { display: block; font-family: var(--mono); font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; color: var(--text2); font-weight: 700; margin-bottom: 6px; }
.docs-field input, .docs-field select, .docs-field textarea { width: 100%; padding: 10px 12px; font-family: inherit; font-size: 13.5px; border: 1.5px solid var(--border); border-radius: 8px; }
.docs-field textarea { resize: vertical; min-height: 60px; }
.docs-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.docs-upload { border: 2px dashed var(--border2); border-radius: 10px; padding: 22px; text-align: center; color: var(--text2); cursor: pointer; }
.docs-upload.has-file { border-style: solid; border-color: var(--green); background: var(--gbg); color: var(--green); text-align: left; }
.docs-upload b { color: var(--repose-navy); display: block; }
.docs-checkbox-row { display: flex; flex-wrap: wrap; gap: 8px; }
.docs-checkbox-row label { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 999px; cursor: pointer; }
.docs-checkbox-row label input { accent-color: var(--repose-blue); }
.docs-checkbox-row label.on { background: var(--bbg); border-color: var(--bborder); color: var(--repose-blue); }
```

- [ ] **Step 2: Replace the openNewDocumentModal stub**

```js
function openNewDocumentModal() {
  const overlay = document.createElement('div');
  overlay.className = 'docs-modal-bg';
  overlay.innerHTML = `
    <div class="docs-modal">
      <div class="docs-modal-head">
        <h2>New document</h2>
        <button class="docs-btn docs-btn-sec" id="docs-modal-close">×</button>
      </div>
      <div class="docs-modal-body">
        <div class="docs-field-row">
          <div class="docs-field">
            <label>Document Number *</label>
            <input id="f-docnum" placeholder="REPO-Q027">
          </div>
          <div class="docs-field">
            <label>Title *</label>
            <input id="f-title" placeholder="">
          </div>
        </div>

        <div class="docs-field-row">
          <div class="docs-field">
            <label>Category *</label>
            <select id="f-cat"><option>H&amp;S</option><option>Quality</option><option>Group</option></select>
          </div>
          <div class="docs-field">
            <label>Level *</label>
            <select id="f-lvl"><option>Form</option><option>Work Instruction</option><option>Procedure</option><option>Policy</option></select>
          </div>
        </div>

        <div class="docs-field">
          <label>Departments (pick all that apply)</label>
          <div class="docs-checkbox-row" id="f-depts">
            ${['Cutting','Sewing','Upholstery','Woodmill','Foam','Assembly','QC','Maintenance','All / Site-wide'].map(d => `<label><input type="checkbox" value="${d}"> ${d}</label>`).join('')}
          </div>
        </div>

        <div class="docs-field-row">
          <div class="docs-field">
            <label>Review cycle (months) *</label>
            <input id="f-cycle" type="number" min="1" max="60" value="12">
          </div>
          <div class="docs-field">
            <label>Owner email *</label>
            <input id="f-owner" type="email" value="jonas.simonaitis@reposefurniture.co.uk">
          </div>
        </div>

        <div class="docs-field">
          <label>Additional approver emails (comma-separated, blank = QHSE solo approval)</label>
          <input id="f-approvers" placeholder="manager@reposefurniture.co.uk">
        </div>

        <div class="docs-field">
          <label>References — comma-separated DocNumbers (optional)</label>
          <input id="f-refs" placeholder="REPO-Q008, REPO-HS022">
        </div>

        <div class="docs-field">
          <label>Description / Reason for revision *</label>
          <textarea id="f-desc" placeholder="New document — initial issue."></textarea>
        </div>

        <div class="docs-field">
          <label>Source file (PDF or DOCX) *</label>
          <input id="f-file" type="file" accept=".pdf,.docx,.xlsx" style="display:none">
          <div class="docs-upload" id="f-upload-zone">📎 Click to choose a file</div>
        </div>
      </div>

      <div class="docs-modal-foot">
        <button class="docs-btn docs-btn-sec" id="docs-modal-cancel">Cancel</button>
        <button class="docs-btn docs-btn-pri" id="docs-modal-save">Save &amp; publish</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // File-picker UX
  const fileInput = overlay.querySelector('#f-file');
  const zone = overlay.querySelector('#f-upload-zone');
  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      zone.classList.add('has-file');
      zone.innerHTML = `<b>${_escape(fileInput.files[0].name)}</b> · ${Math.round(fileInput.files[0].size/1024)} KB`;
    }
  });

  // Department chip toggling
  overlay.querySelectorAll('#f-depts label').forEach(lab => {
    lab.querySelector('input').addEventListener('change', e => lab.classList.toggle('on', e.target.checked));
  });

  // Close
  const close = () => overlay.remove();
  overlay.querySelector('#docs-modal-close').addEventListener('click', close);
  overlay.querySelector('#docs-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Save
  overlay.querySelector('#docs-modal-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#docs-modal-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await _saveNewDocument(overlay);
      close();
      await renderDocumentsRegister();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Save & publish';
    }
  });
}

async function _saveNewDocument(overlay) {
  const docNumber = overlay.querySelector('#f-docnum').value.trim().toUpperCase();
  const title = overlay.querySelector('#f-title').value.trim();
  const category = overlay.querySelector('#f-cat').value;
  const level = overlay.querySelector('#f-lvl').value;
  const cycle = parseInt(overlay.querySelector('#f-cycle').value, 10);
  const owner = overlay.querySelector('#f-owner').value.trim();
  const approversRaw = overlay.querySelector('#f-approvers').value.trim();
  const refs = overlay.querySelector('#f-refs').value.trim();
  const description = overlay.querySelector('#f-desc').value.trim();
  const file = overlay.querySelector('#f-file').files[0];
  const depts = Array.from(overlay.querySelectorAll('#f-depts input:checked')).map(i => i.value);

  if (!docNumber || !title || !owner || !description) throw new Error('Doc Number, Title, Owner and Description are required.');
  if (!file) throw new Error('A source file is required.');

  // Validate uniqueness
  const existing = await fetchDocByNumber(docNumber);
  if (existing) throw new Error(`Doc ${docNumber} already exists in the register.`);

  // Upload file
  const safeName = `${docNumber} - ${title} - Rev1${_extOf(file.name)}`;
  const folder = ({'H&S':'HS','Quality':'Quality','Group':'Group'})[category];
  const uploaded = await uploadDocFile(folder, safeName, file);

  // Calculate next review date
  const today = new Date();
  const next = new Date(today); next.setMonth(next.getMonth() + cycle);

  // Create register row (Status starts Published — Phase 1 single-step solo approve flow per spec, plus matches Task-7 multi-approver flow)
  const created = await createDoc({
    DocNumber: docNumber,
    Title: title,
    Category: category,
    Level: level,
    Departments: depts.length ? depts : null,
    Status: 'Published',
    CurrentRevision: 1,
    IssueDate: today.toISOString().slice(0,10),
    LastRevisedDate: today.toISOString().slice(0,10),
    ReviewCycleMonths: cycle,
    NextReviewDate: next.toISOString().slice(0,10),
    Owner: owner,
    Approvers: approversRaw ? approversRaw.split(',').map(s => s.trim()).filter(Boolean) : null,
    FileLink: uploaded.webUrl,
    References: refs,
    Description: description
  });

  // Create the Rev-1 row in DocumentRevisions
  await createRevision({
    DocNumber: docNumber,
    Revision: 1,
    IssueDate: new Date().toISOString(),
    ReasonForRevision: description,
    TriggeredBy: 'Initial issue',
    FileLink: uploaded.webUrl,
    FileVersionId: uploaded.id
  });

  return created;
}

function _extOf(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i) : ''; }
```

- [ ] **Step 3: Verify**

Hard reload, click "+ New document" in the register header.
Expected:
- Modal opens.
- Fill in all fields, attach a small PDF, click "Save & publish".
- Modal closes; register reloads; new row appears with Status `Published`, Rev 1, today's IssueDate.
- Click the new row → drawer opens; revision history shows Rev 1 with "Initial issue".
- File visible in `/QMS-Documents/{folder}/` in SharePoint.

If the save fails: check browser console; common errors are missing required SharePoint columns or auth issues. Fix and retry — the test data should be deletable from the register list and the file from the library.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(docs): new-document create flow with file upload

Modal collects metadata, uploads source file to /QMS-Documents/{cat}/,
creates the MasterDocumentRegister row at Status=Published Rev 1, and
writes the Rev-1 row to DocumentRevisions with TriggeredBy=\"Initial issue\".
Validates DocNumber uniqueness against the register before saving."
```

---

## Task 7: Revise existing document flow

**Files:**
- Modify: `index.html` — replace the `openReviseDocumentModal` stub

- [ ] **Step 1: Replace the stub**

```js
function openReviseDocumentModal(doc) {
  const overlay = document.createElement('div');
  overlay.className = 'docs-modal-bg';
  overlay.innerHTML = `
    <div class="docs-modal">
      <div class="docs-modal-head">
        <h2>${_escape(doc.docNumber)} — new revision (Rev ${doc.currentRevision} → Rev ${doc.currentRevision + 1})</h2>
        <button class="docs-btn docs-btn-sec" id="docs-modal-close">×</button>
      </div>
      <div class="docs-modal-body">

        <div class="docs-field">
          <label>Upload revised file *</label>
          <input id="r-file" type="file" accept=".pdf,.docx,.xlsx" style="display:none">
          <div class="docs-upload" id="r-upload-zone">📎 Click to choose a file</div>
        </div>

        <div class="docs-field">
          <label>Reason for revision * — auditor reads this</label>
          <textarea id="r-reason"></textarea>
        </div>

        <div class="docs-field-row">
          <div class="docs-field">
            <label>Triggered by (optional)</label>
            <select id="r-trig">
              <option value="">— none —</option>
              <option>Periodic-Review</option>
              <option>CAPA</option>
              <option>NCR</option>
              <option>Internal-Audit</option>
              <option>Group-Update</option>
              <option>Customer-Feedback</option>
              <option>Other</option>
            </select>
          </div>
          <div class="docs-field">
            <label>Triggered-by reference (e.g. CAPA-2026-012)</label>
            <input id="r-trig-ref" placeholder="">
          </div>
        </div>

        <div class="docs-field-row">
          <div class="docs-field">
            <label>Review cycle (months) — keep or change</label>
            <input id="r-cycle" type="number" min="1" max="60" value="${doc.reviewCycleMonths}">
          </div>
          <div class="docs-field">
            <label>Approvers (comma-separated; blank = QHSE solo)</label>
            <input id="r-approvers" value="${(doc.approverEmails||[]).join(', ')}">
          </div>
        </div>

      </div>
      <div class="docs-modal-foot">
        <button class="docs-btn docs-btn-sec" id="docs-modal-cancel">Cancel</button>
        <button class="docs-btn docs-btn-pri" id="docs-modal-save">Approve &amp; publish</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // File picker (same pattern as Task 6)
  const fileInput = overlay.querySelector('#r-file');
  const zone = overlay.querySelector('#r-upload-zone');
  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) {
      zone.classList.add('has-file');
      zone.innerHTML = `<b>${_escape(fileInput.files[0].name)}</b> · ${Math.round(fileInput.files[0].size/1024)} KB`;
    }
  });

  const close = () => overlay.remove();
  overlay.querySelector('#docs-modal-close').addEventListener('click', close);
  overlay.querySelector('#docs-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#docs-modal-save').addEventListener('click', async () => {
    const btn = overlay.querySelector('#docs-modal-save');
    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
      await _saveRevision(doc, overlay);
      close();
      // Close any open drawer
      document.querySelectorAll('.docs-drawer-bg').forEach(el => el.remove());
      await renderDocumentsRegister();
    } catch (e) {
      alert(`Publish failed: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Approve & publish';
    }
  });
}

async function _saveRevision(doc, overlay) {
  const file = overlay.querySelector('#r-file').files[0];
  const reason = overlay.querySelector('#r-reason').value.trim();
  const trigKind = overlay.querySelector('#r-trig').value;
  const trigRef = overlay.querySelector('#r-trig-ref').value.trim();
  const cycle = parseInt(overlay.querySelector('#r-cycle').value, 10);
  const approversRaw = overlay.querySelector('#r-approvers').value.trim();

  if (!file) throw new Error('A revised file is required.');
  if (!reason) throw new Error('Reason for revision is required.');

  const newRev = doc.currentRevision + 1;
  const folder = ({'H&S':'HS','Quality':'Quality','Group':'Group'})[doc.category];
  const safeName = `${doc.docNumber} - ${doc.title} - Rev${newRev}${_extOf(file.name)}`;
  const uploaded = await uploadDocFile(folder, safeName, file);

  const today = new Date();
  const next = new Date(today); next.setMonth(next.getMonth() + cycle);

  // Update the register row
  await updateDoc(doc.id, {
    CurrentRevision: newRev,
    Status: 'Published',
    LastRevisedDate: today.toISOString().slice(0,10),
    NextReviewDate: next.toISOString().slice(0,10),
    ReviewCycleMonths: cycle,
    Approvers: approversRaw ? approversRaw.split(',').map(s => s.trim()).filter(Boolean) : null,
    FileLink: uploaded.webUrl,
    Description: reason
  });

  // Append a row to DocumentRevisions
  await createRevision({
    DocNumber: doc.docNumber,
    Revision: newRev,
    IssueDate: today.toISOString(),
    ReasonForRevision: reason,
    TriggeredBy: trigKind ? (trigRef ? `${trigKind}:${trigRef}` : trigKind) : '',
    FileLink: uploaded.webUrl,
    FileVersionId: uploaded.id,
    ChangedFromRev: doc.currentRevision
  });
}
```

- [ ] **Step 2: Verify**

Hard reload. Open a published doc → click "+ New revision". Upload a different file, fill in reason, pick `CAPA` as Triggered by, ref `CAPA-2026-012`, click "Approve & publish".
Expected:
- Modal closes; drawer closes; register reloads.
- The doc shows Rev 2 in the register.
- Re-open detail → revision history shows two entries: Rev 1 (Initial issue) and Rev 2 (your reason · CAPA:CAPA-2026-012 in purple).
- The old Rev 1 file is still retrievable via SharePoint document library version history.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(docs): revise-document flow with TriggeredBy traceability

Reusable revise modal collects file + reason + TriggeredBy choice
and reference, uploads under {DocNumber} - {Title} - Rev{N}.{ext},
patches the register row (CurrentRevision/LastRevisedDate/NextReview)
and appends a new DocumentRevisions row with ChangedFromRev pointing
to the previous revision."
```

---

## Task 8: Mark obsolete flow

**Files:**
- Modify: `index.html` — replace the `markDocumentObsolete` stub

- [ ] **Step 1: Replace the stub**

```js
async function markDocumentObsolete(doc) {
  // Build a simple modal inline (no need for the bigger modal harness)
  const overlay = document.createElement('div');
  overlay.className = 'docs-modal-bg';
  overlay.innerHTML = `
    <div class="docs-modal">
      <div class="docs-modal-head">
        <h2>Mark obsolete — ${_escape(doc.docNumber)}</h2>
        <button class="docs-btn docs-btn-sec" id="docs-modal-close">×</button>
      </div>
      <div class="docs-modal-body">
        <p style="margin-top:0;color:var(--text2);font-size:13px">This will move the document to Obsolete status. It will be hidden from staff/manager views but kept in the register and the document library for audit. There is no undo from RepNet — only by editing the SharePoint List directly.</p>

        <div class="docs-field">
          <label>Replaced by *</label>
          <input id="o-supby" placeholder="REPO-Q020, or https://… / RepNet feature URL">
        </div>

        <div class="docs-field">
          <label>Reason *</label>
          <textarea id="o-reason" placeholder="Why is this being retired?"></textarea>
        </div>
      </div>
      <div class="docs-modal-foot">
        <button class="docs-btn docs-btn-sec" id="docs-modal-cancel">Cancel</button>
        <button class="docs-btn docs-btn-pri" id="docs-modal-save" style="background:var(--red)">Mark obsolete</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#docs-modal-close').addEventListener('click', close);
  overlay.querySelector('#docs-modal-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#docs-modal-save').addEventListener('click', async () => {
    const supby = overlay.querySelector('#o-supby').value.trim();
    const reason = overlay.querySelector('#o-reason').value.trim();
    if (!supby || !reason) { alert('Replaced by and Reason are both required.'); return; }
    const btn = overlay.querySelector('#docs-modal-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await updateDoc(doc.id, { Status: 'Obsolete', SupersededBy: supby, Description: `OBSOLETE: ${reason}` });
      // Audit row in DocumentRevisions
      await createRevision({
        DocNumber: doc.docNumber,
        Revision: doc.currentRevision,
        IssueDate: new Date().toISOString(),
        ReasonForRevision: `Marked Obsolete. Replaced by: ${supby}. Reason: ${reason}`,
        TriggeredBy: 'Obsolete',
        ChangedFromRev: doc.currentRevision
      });
      close();
      document.querySelectorAll('.docs-drawer-bg').forEach(el => el.remove());
      await renderDocumentsRegister();
    } catch (e) {
      alert(`Failed: ${e.message}`);
      btn.disabled = false; btn.textContent = 'Mark obsolete';
    }
  });
}
```

- [ ] **Step 2: Verify**

Hard reload. Open a published doc → click "⌀ Mark obsolete". Fill in Replaced-by and Reason. Click confirm.
Expected:
- Modal closes; drawer closes; register reloads.
- The doc now shows Status `Obsolete` (red badge).
- It disappears from the default filter (which excludes Obsolete by default — confirm by toggling the Obsolete filter on).
- Re-open detail → no Revise / Mark Obsolete buttons visible (because status is Obsolete).
- Revision history shows the Obsolete audit row at the top.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(docs): mark-obsolete flow with structured SupersededBy

Required Replaced-by + Reason. Updates Status to Obsolete and writes
an audit row to DocumentRevisions with TriggeredBy=\"Obsolete\".
No delete button anywhere in the UI per cl. 7.5.3.2."
```

---

## Task 9: One-time import from REPO-HS000.xlsx

**Files:**
- Create: `import-master-doc-list.js` (Node.js script — runs once, locally)
- Create: `package.json` (only if not present in the repo root for this script)

This task is the one-shot migration. It runs once and is then archived; do not invoke it again in production.

- [ ] **Step 1: Add the import script**

Create `import-master-doc-list.js` in the repo root:

```js
// One-time import: REPO-HS000.xlsx → MasterDocumentRegister + DocumentRevisions
// Usage: node import-master-doc-list.js <path-to-xlsx> <bearer-token>
// Get the bearer token by opening RepNet, F12 console, run:
//   const t = await getGraphToken(); copy(t);
// Then paste as the second arg.

const xlsx = require('xlsx');
const fs = require('fs');

const SP_HOST = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';
const QMS_REVISIONS_LIST = 'DocumentRevisions';

async function main() {
  const [,, xlsxPath, token] = process.argv;
  if (!xlsxPath || !token) { console.error('Usage: node import-master-doc-list.js <xlsx> <token>'); process.exit(1); }

  const wb = xlsx.readFile(xlsxPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  // The Excel header is in row 4 (1-indexed). Read everything from row 5 onward.
  const rows = xlsx.utils.sheet_to_json(ws, { range: 3, defval: '' });

  console.log(`Read ${rows.length} candidate rows. Filtering empty…`);
  const docs = rows.filter(r => r['Document Number'] && String(r['Document Number']).trim());
  console.log(`Importing ${docs.length} documents.`);

  // Resolve site + list IDs
  const siteId = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`).then(r => r.id);
  const regListId = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REGISTER_LIST}`).then(r => r.id);
  const revListId = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REVISIONS_LIST}`).then(r => r.id);

  let imported = 0, skipped = 0;
  for (const r of docs) {
    const docNumber = String(r['Document Number']).trim();
    const title     = String(r['Document Type'] || '').trim();
    const issueSer  = r['Issue Date'];
    const revisedSer= r['Date Revised'];
    const description=String(r['Description'] || '').trim();
    const revNum    = parseInt(r['Revision Number'] || 1, 10) || 1;

    // Idempotency: skip if already in register
    const existing = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${regListId}/items?$expand=fields&$filter=fields/DocNumber eq '${encodeURIComponent(docNumber)}'&$top=2`);
    if (existing.value && existing.value.length > 0) { skipped++; continue; }

    const issueDate = serialToISO(issueSer);
    const revisedDate = serialToISO(revisedSer) || issueDate;

    // Heuristic: H&S vs Quality vs Group based on prefix
    const category =
      docNumber.startsWith('REPO-HS') ? 'H&S' :
      docNumber.startsWith('REPO-Q')  ? 'Quality' :
      docNumber.startsWith('PHCF') || docNumber.startsWith('PMUKF') || docNumber.startsWith('PRISM') ? 'Group' : 'Quality';

    // Conservative defaults: Form / All / Site-wide / 12-month review
    const fields = {
      DocNumber: docNumber,
      Title: title,
      Category: category,
      Level: 'Form',
      Departments: ['All / Site-wide'],
      Status: 'Published',
      CurrentRevision: revNum,
      IssueDate: issueDate,
      LastRevisedDate: revisedDate,
      ReviewCycleMonths: 12,
      NextReviewDate: addMonths(revisedDate || issueDate, 12),
      Owner: 'jonas.simonaitis@reposefurniture.co.uk',
      Description: description || '(imported)'
    };

    await graphPost(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${regListId}/items`, { fields });
    await graphPost(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${revListId}/items`, {
      fields: {
        DocNumber: docNumber,
        Revision: revNum,
        IssueDate: (revisedDate || issueDate || new Date().toISOString().slice(0,10)) + 'T00:00:00Z',
        ReasonForRevision: description || '(imported from legacy MDL)',
        TriggeredBy: 'Migration-import',
        ChangedFromRev: revNum > 1 ? revNum - 1 : null
      }
    });
    imported++;
    console.log(`  ✓ ${docNumber} — ${title}`);
  }
  console.log(`Done. Imported ${imported}. Skipped (already present) ${skipped}.`);
}

function serialToISO(serial) {
  if (!serial) return null;
  if (typeof serial === 'string') return serial.slice(0,10);
  // Excel serial → JS Date
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  return new Date(utcMs).toISOString().slice(0,10);
}
function addMonths(iso, months) {
  if (!iso) return null;
  const d = new Date(iso); d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0,10);
}
async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return await res.json();
}
async function graphPost(token, url, body) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${await res.text()}`);
  return await res.json();
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Get the bearer token**

In RepNet (`?ui=v4`), open DevTools console, run:

```js
const t = await getGraphToken(); copy(t);
```

The token is now on your clipboard.

- [ ] **Step 3: Run the import**

```bash
cd C:/Users/jonas.simonaitis/.local/bin
npm install xlsx --no-save
node import-master-doc-list.js "C:/Users/jonas.simonaitis/Downloads/REPO-HS000 - Master Document List.xlsx" "<paste-token-here>"
```

Expected output:
```
Read 97 candidate rows. Filtering empty…
Importing 65 documents.
  ✓ REPO-HS000 — Master Document Register
  ✓ REPO-HS002 — Health & Safety Dashboard
  …
Done. Imported 65. Skipped (already present) 0.
```

If a token expires partway: re-run; idempotency will skip the rows already in.

- [ ] **Step 4: Verify in RepNet**

Hard reload `?ui=v4` → Documents.
Expected: register shows ~65 rows. Open one — Rev shown matches Excel; revision history has one row labelled `Migration-import`. Cross-references will be empty (the import doesn't infer them; QHSE adds these manually post-import as docs get touched).

- [ ] **Step 5: Commit (script kept in repo for audit; flagged as one-shot)**

```bash
git add import-master-doc-list.js
git commit -m "chore(docs): one-shot importer for legacy REPO-HS000.xlsx

Reads the legacy master list, skips already-present rows for
idempotency, defaults Category by prefix (REPO-HS/REPO-Q/PHCF),
Level=Form, Departments=[All/Site-wide], 12-month review cycle.
Writes a Migration-import row to DocumentRevisions per imported doc."
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| Goal 1 — Documents tab in RepNet | Tasks 2 + 4 |
| Goal 2 — SharePoint List as system of record | Task 1 + Task 3 |
| Goal 3 — Controlled doc library with versioning | Task 1 |
| Goal 4 — Configurable per-document approver routing | Task 6 + Task 7 (data model only; manager-side approval queue is in the follow-up plan) |
| Goal 5 — Periodic review cycles | Data model in Task 1 + 6; reminder Azure Function deferred to follow-up plan |
| Goal 6 — Auto-stamped PDF headers | Deferred to follow-up plan (called out below) |
| Goal 7 — Document hierarchy + dept tags | Tasks 1, 4, 5, 6 |
| Goal 8 — Cross-references + impact analysis | Tasks 5 + 6 |
| Goal 9 — CAPA/NCR → Revision traceability | Task 7 |
| Goal 10 — Structured SupersededBy | Task 8 |
| Goal 11 — Tablet read-view | Deferred to follow-up plan |
| Goal 12 — Linked records card | Partially — Task 5 includes references-out + referenced-by; Maintenance/CAPA-record live counts deferred to follow-up plan |
| Migration / cutover | Task 9 |

**Deferred to the follow-up plan (`document-control-automation.md`, to be written next):**
1. Manager approval queue view + email notifications
2. Periodic review nightly Azure Function reminder
3. Tablet read-view (`#documents-read` route)
4. PDF auto-stamping Azure Function
5. Excel auto-export Azure Function
6. Maintenance/CAPA live record counts on doc detail
7. Mockup retheme to v4 (the v4 styling in this plan's CSS replaces it for the live module)

**Placeholder scan:** None. All steps contain concrete code or commands.

**Type consistency check:** `_mapDocItem` shape matches what `_renderDocsTable`, `openDocumentDetail`, `_saveNewDocument`, `_saveRevision`, and `markDocumentObsolete` consume. `createDoc` field names match the SharePoint columns from Task 1. `_mapRevItem` shape matches what the revision-history rendering consumes. `getGraphToken`, `graphGet`, `graphGetAll`, `getListIdByNameOnSite` are existing helpers — verified to exist by the index.html grep at plan-time.

**Risk to flag for the executor:** The CSS selectors in Tasks 4-8 assume RepNet's v4 stylesheet variables (`--repose-blue`, `--repose-navy`, `--bbg`, `--abg`, `--rbg`, `--gbg`, `--green`, `--red`, `--amber`, `--mono`, `--display`, `--body`) are present. If the live `index.html` doesn't have all of these, the executor must either add the missing tokens to the v4 :root block or fall back to literal hex values. Verify with `grep '--bbg' index.html` before Task 4 Step 1.
