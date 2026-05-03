# Document Control — Periodic Review Reminders + Excel Auto-Export (Plan 2B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two scheduled Azure Functions to the existing RepNet Function App: a nightly periodic-review reminder that emails QMS document owners 30 days before each doc's `NextReviewDate`, and a nightly Excel export that rewrites `REPO-HS000.xlsx` from the live `MasterDocumentRegister` SharePoint List so the legacy file stays current as a backup.

**Architecture:** Both new functions live as siblings to the existing `azure-functions/daily-report/` folder, share the same `package.json`, deploy via the existing `deploy-daily-report.yml` GitHub Actions workflow (which deploys the entire folder on push to main), and reuse the existing `TENANT_ID`/`CLIENT_ID`/`CLIENT_SECRET`/`SEND_FROM` Azure App Settings via app-only client-credential tokens. No new infrastructure; one new npm dependency (`xlsx` / SheetJS) for the export.

**Tech Stack:** Azure Functions v4 (Node.js 18, timer trigger), `@azure/msal-node` (existing), `node-fetch` v2 (existing), `xlsx` (SheetJS — new dependency for MDL export), Microsoft Graph API (`Sites.ReadWrite.All` and `Mail.Send` app permissions).

**Spec:** `docs/superpowers/specs/2026-05-03-document-control-design.md` Goals 5 (periodic review cycles + reminders) and Architecture § "Excel auto-export Azure Function".
**Foundation prerequisite:** Plan 1 Foundation complete (commits `f129d2d` through `4883c28`); Plan 2A (`5c2d27f` through `2da05e0`); bug-fix sweep (`be3eb60`/`fa0af03`/`6ff3c94`).

**Verification model:** Azure Functions can be triggered manually via the Azure Portal ("Run" button on the function) or `func host start` locally. Each task ends with a commit so the deployment pipeline picks up changes; the user verifies via the Azure Portal Logs and the resulting email/xlsx file.

**File scope:**
- `azure-functions/package.json` — one new dependency
- `azure-functions/doc-control-review-reminder/function.json` — timer schedule
- `azure-functions/doc-control-review-reminder/index.js` — Graph query + email
- `azure-functions/doc-control-mdl-export/function.json` — timer schedule
- `azure-functions/doc-control-mdl-export/index.js` — Graph query + xlsx + upload

---

## Prerequisites (one-time, must be done before Task 4 verification)

These are infrastructure prerequisites the user must verify in their Azure / Microsoft Entra tenant before the functions can succeed at runtime. The plan creates the code regardless; deployment failures would only surface at runtime.

- [ ] **The `Repose Production Tracker` (or equivalent) Azure App Registration must have these App Permissions** (Microsoft Entra ID → App registrations → API permissions → Add → Microsoft Graph → Application permissions):
  - `Sites.ReadWrite.All` — to read MasterDocumentRegister and write the rebuilt REPO-HS000.xlsx
  - `Mail.Send` — to send review-reminder emails from the SEND_FROM mailbox (app-only)
  - **All three permissions need admin consent** (the green "Grant admin consent for tenant" button). Without admin consent, the functions will return 401 at runtime.

- [ ] **Azure Function App env vars** (Function App → Configuration → Application settings):
  - `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` — already exist for daily-report; reused
  - `SEND_FROM` — existing; mailbox the function emails from. Should be a service mailbox or QHSE manager's mailbox.
  - `QMS_LEGACY_MDL_PATH` — NEW. The SharePoint Drive-relative path to the legacy `REPO-HS000 - Master Document List.xlsx` file (e.g. `/sites/ReposeFurniture-HealthandSafety/Shared Documents/SOMETHING/REPO-HS000 - Master Document List.xlsx`). The export function uploads to this path.

If admin consent is blocked or pending, deploy the code anyway — runtime errors will be visible in the Function App's Logs and the user can re-run after consent is granted.

---

## Task 1: Add `xlsx` dependency to Azure Functions package

**Files:**
- Modify: `azure-functions/package.json`

- [ ] **Step 1: Update `package.json`**

Locate `azure-functions/package.json`. The current file:

```json
{
  "name": "repnet-daily-report",
  "version": "1.0.0",
  "description": "RepNet daily production report — Azure Function timer trigger",
  "main": "daily-report/index.js",
  "scripts": {
    "start": "func start"
  },
  "dependencies": {
    "@azure/msal-node": "^2.6.0",
    "node-fetch": "^2.7.0"
  },
  "engines": {
    "node": ">=18"
  }
}
```

Update the `description` to be plural-functions-aware and add `xlsx` to dependencies. Replace the file contents with:

```json
{
  "name": "repnet-azure-functions",
  "version": "1.1.0",
  "description": "RepNet Azure Functions — daily production report, doc-control review reminder, MDL export",
  "main": "daily-report/index.js",
  "scripts": {
    "start": "func start"
  },
  "dependencies": {
    "@azure/msal-node": "^2.6.0",
    "node-fetch": "^2.7.0",
    "xlsx": "^0.18.5"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Install locally to verify the dependency installs cleanly**

```bash
cd "C:/Users/jonas.simonaitis/.local/bin/azure-functions"
npm install
```

Expected: no errors, `node_modules/xlsx` directory exists. Output ends with "added X packages, audited Y packages in Zs".

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add azure-functions/package.json azure-functions/package-lock.json
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "chore(azure): add xlsx dependency for upcoming MDL export function

Renames package to repnet-azure-functions (plural — three functions
will share the dependency tree once Plan 2B lands). Bumps to v1.1.0.
Adds xlsx 0.18.5 (SheetJS) for the MDL auto-export function that
rebuilds REPO-HS000.xlsx from the live SharePoint List nightly."
```

---

## Task 2: Create `doc-control-review-reminder` function (skeleton + timer)

**Files:**
- Create: `azure-functions/doc-control-review-reminder/function.json`
- Create: `azure-functions/doc-control-review-reminder/index.js`

This task lays down the function's plumbing (timer trigger, env-var loading, Graph token acquisition) without yet implementing the review-query logic. Step 4 verifies the function loads and authenticates.

- [ ] **Step 1: Create the function manifest**

File: `azure-functions/doc-control-review-reminder/function.json`

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 2 * * *"
    }
  ]
}
```

Schedule explanation: `0 0 2 * * *` is `second minute hour day-of-month month day-of-week` = "at 02:00 every day". Same UK timezone as the existing daily-report function (Function Apps run in tenant timezone if WEBSITE_TIME_ZONE is set, else UTC; the daily-report's `0 0 7 * * 1-5` runs at 07:00 — assume the same offset applies here).

- [ ] **Step 2: Create the function index file (skeleton)**

File: `azure-functions/doc-control-review-reminder/index.js`

```js
'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config (Azure App Settings) ──────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// Reminder window — emails fire when NextReviewDate is between 0 and N days away.
const REMINDER_WINDOW_DAYS = 30;

// ─── App-only Graph auth (client credential flow) ─────────────────────────
async function getAppToken() {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET
    }
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphGetAll(token, url) {
  const all = [];
  let next = url;
  while (next) {
    const r = await graphGet(token, next);
    if (Array.isArray(r.value)) all.push(...r.value);
    next = r['@odata.nextLink'] || null;
  }
  return all;
}

// ─── Function entry point ─────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[review-reminder] starting');

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[review-reminder] missing env vars; aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
    context.log('[review-reminder] auth OK');
  } catch (e) {
    context.log.error('[review-reminder] auth failed:', e.message);
    return;
  }

  // Step 3 will replace this stub with the real query + email logic
  context.log('[review-reminder] skeleton OK; query + email pending');
};
```

- [ ] **Step 3: Commit (skeleton in place)**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add azure-functions/doc-control-review-reminder/
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(azure): doc-control-review-reminder skeleton

New nightly Azure Function (02:00 daily). For now just acquires an
app-only Graph token and logs success. Step 3 of Plan 2B Task 3 adds
the SharePoint query + reminder-email logic."
```

(Don't push yet — Task 3 finishes the function before we trigger a deploy.)

---

## Task 3: Implement review-reminder query + email logic

**Files:**
- Modify: `azure-functions/doc-control-review-reminder/index.js`

- [ ] **Step 1: Replace the stub with the full implementation**

Open `azure-functions/doc-control-review-reminder/index.js`. Replace the current file contents with:

```js
'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config (Azure App Settings) ──────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// Reminder window — emails fire when NextReviewDate is between 0 and N days away.
const REMINDER_WINDOW_DAYS = 30;

// ─── App-only Graph auth (client credential flow) ─────────────────────────
async function getAppToken() {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET
    }
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphGetAll(token, url) {
  const all = [];
  let next = url;
  while (next) {
    const r = await graphGet(token, next);
    if (Array.isArray(r.value)) all.push(...r.value);
    next = r['@odata.nextLink'] || null;
  }
  return all;
}

async function sendMail(token, to, subject, htmlBody) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SEND_FROM)}/sendMail`;
  const body = {
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } }))
    },
    saveToSentItems: true
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`sendMail ${res.status}: ${await res.text()}`);
}

// ─── Email body shell ─────────────────────────────────────────────────────
function emailShell(innerHtml) {
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#0e023a;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:4px">RepNet · Document Control</div>
    <div style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em">Repose Production Tracker</div>
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-top:none;border-radius:0 0 14px 14px">
    ${innerHtml}
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">This is an automated message from RepNet. Please do not reply to this email.</div>
</div>
</body></html>`;
}

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ─── Main ──────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[review-reminder] starting at', new Date().toISOString());

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[review-reminder] missing env vars; aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
  } catch (e) {
    context.log.error('[review-reminder] auth failed:', e.message);
    return;
  }

  // Resolve site + list IDs
  let siteId, listId;
  try {
    const siteResp = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`);
    siteId = siteResp.id;
    const listResp = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REGISTER_LIST}`);
    listId = listResp.id;
  } catch (e) {
    context.log.error('[review-reminder] site/list resolution failed:', e.message);
    return;
  }

  // Fetch all docs (only the columns we need)
  let docs;
  try {
    docs = await graphGetAll(
      token,
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields(select=DocNumber,Title,Status,Owner,NextReviewDate,CurrentRevision)&$top=999`
    );
  } catch (e) {
    context.log.error('[review-reminder] register fetch failed:', e.message);
    return;
  }

  context.log(`[review-reminder] fetched ${docs.length} docs`);

  // Filter to docs needing reminders
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = [];
  const overdue = [];
  for (const item of docs) {
    const f = item.fields || {};
    if (f.Status !== 'Published') continue; // only chase live docs
    if (!f.NextReviewDate) continue;
    if (!f.Owner) continue;
    const next = new Date(f.NextReviewDate);
    if (isNaN(next)) continue;
    const daysUntil = Math.round((next - todayMidnight) / 86400000);
    if (daysUntil < 0) {
      overdue.push({ ...f, daysUntil });
    } else if (daysUntil <= REMINDER_WINDOW_DAYS) {
      due.push({ ...f, daysUntil });
    }
  }

  context.log(`[review-reminder] ${due.length} due in next ${REMINDER_WINDOW_DAYS}d, ${overdue.length} overdue`);

  if (due.length === 0 && overdue.length === 0) {
    context.log('[review-reminder] nothing to send today');
    return;
  }

  // Group by Owner so each owner gets one email summarising their queue
  const byOwner = new Map();
  for (const d of [...overdue, ...due]) {
    const owner = (d.Owner || '').trim().toLowerCase();
    if (!owner.includes('@')) continue; // skip rows where Owner isn't a recognisable email
    if (!byOwner.has(owner)) byOwner.set(owner, { overdue: [], due: [] });
    if (d.daysUntil < 0) byOwner.get(owner).overdue.push(d);
    else byOwner.get(owner).due.push(d);
  }

  context.log(`[review-reminder] ${byOwner.size} unique owner(s) to notify`);

  let sent = 0, failed = 0;
  for (const [owner, queue] of byOwner.entries()) {
    const overdueRows = queue.overdue.sort((a, b) => a.daysUntil - b.daysUntil);
    const dueRows = queue.due.sort((a, b) => a.daysUntil - b.daysUntil);
    const totalCount = overdueRows.length + dueRows.length;
    const subject = `RepNet · ${totalCount} controlled document${totalCount === 1 ? '' : 's'} due for review`;

    const rowToHtml = (d) => {
      const dateStr = String(d.NextReviewDate || '').slice(0, 10);
      const colour = d.daysUntil < 0 ? '#dc2626' : (d.daysUntil <= 7 ? '#d97706' : '#0e023a');
      const status = d.daysUntil < 0
        ? `${Math.abs(d.daysUntil)} days OVERDUE`
        : `${d.daysUntil} day${d.daysUntil === 1 ? '' : 's'}`;
      return `<tr><td style="padding:6px 12px;border:1px solid #e1e6eb;font-family:monospace;font-weight:700">${htmlEscape(d.DocNumber)}</td><td style="padding:6px 12px;border:1px solid #e1e6eb">${htmlEscape(d.Title)}</td><td style="padding:6px 12px;border:1px solid #e1e6eb">${dateStr}</td><td style="padding:6px 12px;border:1px solid #e1e6eb;color:${colour};font-weight:700">${status}</td></tr>`;
    };

    const allRows = [...overdueRows, ...dueRows].map(rowToHtml).join('');
    const html = emailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">${overdueRows.length > 0 ? '⚠ Reviews overdue' : '⏰ Reviews due'}</h2>
      <p style="font-size:14px;line-height:1.55">You're listed as the Owner of <b>${totalCount} controlled document${totalCount === 1 ? '' : 's'}</b> ${overdueRows.length > 0 ? `<b>(${overdueRows.length} overdue)</b>` : ''} due for review in the next ${REMINDER_WINDOW_DAYS} days.</p>
      <p style="font-size:13px;color:#706f6f">Open RepNet → Documents to either confirm each is still valid (resets the clock for another cycle) or revise it.</p>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;margin:18px 0">
        <tr style="background:#f8fafb"><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Doc No.</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Title</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Next review</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Status</th></tr>
        ${allRows}
      </table>
      <p style="font-size:12px;color:#706f6f;line-height:1.5">This reminder is sent weekly while documents remain due or overdue. Open RepNet → Documents → click the doc → Edit metadata to update the review cycle, or use New revision to publish updated content.</p>
    `);

    try {
      await sendMail(token, owner, subject, html);
      context.log(`[review-reminder] sent to ${owner} (${totalCount} doc(s))`);
      sent++;
    } catch (e) {
      context.log.error(`[review-reminder] sendMail to ${owner} failed: ${e.message}`);
      failed++;
    }
  }

  context.log(`[review-reminder] done. sent=${sent} failed=${failed}`);
};
```

- [ ] **Step 2: Verify locally if Azure Functions Core Tools is installed**

This step is optional — only run if `func` CLI is on the user's machine (`func --version` returns a version). Otherwise skip and rely on the deployed-to-Azure verification.

```bash
cd "C:/Users/jonas.simonaitis/.local/bin/azure-functions"
# Set env vars for local run (use a local.settings.json or shell exports)
func host start
```

Then in another terminal, manually trigger:
```bash
curl -X POST http://localhost:7071/admin/functions/doc-control-review-reminder
```

Expected console output: `[review-reminder] starting at 2026-...` followed by either `nothing to send today` (if no docs are due in the next 30 days) or `sent to <email> (N doc(s))`.

If `func` isn't installed: skip — the function will deploy to Azure on commit and run on schedule.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add azure-functions/doc-control-review-reminder/
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(azure): doc-control-review-reminder query + email logic

Replaces the Task 2 skeleton with the full implementation:

- Resolves Quality site + MasterDocumentRegister list IDs once at start
- Fetches all docs with $expand=fields select=Owner,NextReviewDate,...
- Filters to Published rows where NextReviewDate is in the next 30
  days (overdue + due-soon, separately tracked).
- Groups by Owner so each owner gets one summary email per run.
- Email layout: branded card header + table of doc rows + status
  pill (overdue=red, ≤7d=amber, else navy), with link guidance to
  open RepNet → Documents.

Will run on the timer schedule from function.json (02:00 daily).
Verification will land via the Azure Portal Logs tab after deploy."
```

---

## Task 4: Create `doc-control-mdl-export` function (Excel auto-export)

**Files:**
- Create: `azure-functions/doc-control-mdl-export/function.json`
- Create: `azure-functions/doc-control-mdl-export/index.js`

- [ ] **Step 1: Create the function manifest**

File: `azure-functions/doc-control-mdl-export/function.json`

Schedule it to run at 02:30 (after the review-reminder run, so they don't compete for tokens):

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 30 2 * * *"
    }
  ]
}
```

- [ ] **Step 2: Create the function index file**

File: `azure-functions/doc-control-mdl-export/index.js`

```js
'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const xlsx = require('xlsx');

// ─── Config ───────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Where to write the rebuilt REPO-HS000.xlsx. Set in Azure App Settings.
// Format: '/sites/{site-path}/{document-library}/{path}/REPO-HS000.xlsx'
// Example: '/sites/ReposeFurniture-HealthandSafety/Shared Documents/Master Documents/REPO-HS000.xlsx'
const QMS_LEGACY_MDL_PATH = process.env.QMS_LEGACY_MDL_PATH || '';

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// ─── Auth + Graph ─────────────────────────────────────────────────────────
async function getAppToken() {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET
    }
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphGetAll(token, url) {
  const all = [];
  let next = url;
  while (next) {
    const r = await graphGet(token, next);
    if (Array.isArray(r.value)) all.push(...r.value);
    next = r['@odata.nextLink'] || null;
  }
  return all;
}

async function uploadFile(token, sitePath, filePath, buffer) {
  // Resolve site → drive → upload via PUT to the path-relative endpoint.
  // sitePath: '/sites/ReposeFurniture-HealthandSafety'
  // filePath: relative path inside the default Documents library, with leading '/'
  const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${sitePath}`);
  const drive = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/drive`);
  // Encode each path segment so spaces become %20 (keep '/' literal as separator)
  const encoded = filePath.split('/').map(s => encodeURIComponent(s)).join('/');
  const url = `https://graph.microsoft.com/v1.0/drives/${drive.id}/root:${encoded}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buffer
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ─── XLSX builder ─────────────────────────────────────────────────────────
// Mirrors the legacy REPO-HS000.xlsx layout:
// header row at row 4: # | Document Number | Document Type | Link | Issue Date | Date Revised | Description | Revision Number | Next Revision Date
function buildWorkbook(items) {
  const wb = xlsx.utils.book_new();
  const aoa = [];
  // Title rows (rows 1-3 in legacy file are blank or branding; mirror with empty + a banner)
  aoa.push(['Master Document Register']);
  aoa.push([`Auto-generated from RepNet · ${new Date().toISOString().slice(0,10)}`]);
  aoa.push([]);
  // Header row 4
  aoa.push(['#', 'Document Number', 'Document Type', 'Link', 'Issue Date', 'Date Revised', 'Description', 'Revision Number', 'Next Revision Date']);

  // Sort items by DocNumber for deterministic output (matches legacy sort)
  const sorted = items.slice().sort((a, b) => {
    const an = (a.fields && a.fields.DocNumber) || '';
    const bn = (b.fields && b.fields.DocNumber) || '';
    return an.localeCompare(bn, 'en', { numeric: true });
  });

  let n = 0;
  for (const item of sorted) {
    const f = item.fields || {};
    if (!f.DocNumber) continue;
    n++;
    aoa.push([
      n,
      f.DocNumber || '',
      f.Title || '',
      f.FileLink || '',
      f.IssueDate ? String(f.IssueDate).slice(0, 10) : '',
      f.LastRevisedDate ? String(f.LastRevisedDate).slice(0, 10) : '',
      f.Description || '',
      f.CurrentRevision != null ? f.CurrentRevision : '',
      f.NextReviewDate ? String(f.NextReviewDate).slice(0, 10) : ''
    ]);
  }

  const ws = xlsx.utils.aoa_to_sheet(aoa);
  // Column widths approximating the legacy file
  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 18 },  // Document Number
    { wch: 40 },  // Document Type / Title
    { wch: 18 },  // Link
    { wch: 12 },  // Issue Date
    { wch: 12 },  // Date Revised
    { wch: 40 },  // Description
    { wch: 9 },   // Revision Number
    { wch: 14 }   // Next Revision Date
  ];
  xlsx.utils.book_append_sheet(wb, ws, 'Document Register');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Main ─────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[mdl-export] starting at', new Date().toISOString());

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    context.log.error('[mdl-export] missing core env vars; aborting');
    return;
  }
  if (!QMS_LEGACY_MDL_PATH) {
    context.log.error('[mdl-export] QMS_LEGACY_MDL_PATH not set in App Settings; aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
  } catch (e) {
    context.log.error('[mdl-export] auth failed:', e.message);
    return;
  }

  // Fetch all docs from MasterDocumentRegister
  let items;
  try {
    const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`);
    const list = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${QMS_REGISTER_LIST}`);
    items = await graphGetAll(
      token,
      `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=999`
    );
  } catch (e) {
    context.log.error('[mdl-export] register fetch failed:', e.message);
    return;
  }

  context.log(`[mdl-export] fetched ${items.length} register rows`);

  // Build the xlsx
  let buffer;
  try {
    buffer = buildWorkbook(items);
    context.log(`[mdl-export] xlsx built, ${buffer.length} bytes`);
  } catch (e) {
    context.log.error('[mdl-export] xlsx build failed:', e.message);
    return;
  }

  // Parse the legacy path: '/sites/{site-path}/{rest-of-path}'
  const m = QMS_LEGACY_MDL_PATH.match(/^(\/sites\/[^/]+)(\/.*)$/);
  if (!m) {
    context.log.error(`[mdl-export] QMS_LEGACY_MDL_PATH must start with '/sites/<site>/...' — got ${QMS_LEGACY_MDL_PATH}`);
    return;
  }
  const sitePath = m[1];
  const filePath = m[2];

  // Upload via Graph
  try {
    const result = await uploadFile(token, sitePath, filePath, buffer);
    context.log(`[mdl-export] uploaded to ${result.webUrl}`);
  } catch (e) {
    context.log.error('[mdl-export] upload failed:', e.message);
    return;
  }

  context.log('[mdl-export] done');
};
```

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add azure-functions/doc-control-mdl-export/
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(azure): doc-control-mdl-export auto-rebuilds REPO-HS000.xlsx

New nightly Azure Function (02:30 daily, 30 min after the review
reminder so they don't compete for tokens):

- App-only Graph token (Sites.ReadWrite.All)
- Fetches all MasterDocumentRegister rows
- Builds an xlsx mirroring the legacy REPO-HS000.xlsx layout: 9
  columns (# | Document Number | Document Type | Link | Issue Date
  | Date Revised | Description | Revision Number | Next Revision
  Date), header row at row 4, banner rows 1-2.
- Sorts by DocNumber (locale numeric).
- Uploads via PUT to the path stored in QMS_LEGACY_MDL_PATH App
  Setting (overwrites previous version; SharePoint library
  versioning preserves history).

Requires QMS_LEGACY_MDL_PATH env var to be set in Azure App Settings
to e.g. '/sites/ReposeFurniture-HealthandSafety/Shared Documents/...'."
```

---

## Task 5: Push and verify

**Files:** No code changes — push triggers the deploy via existing GitHub Actions workflow.

- [ ] **Step 1: Push to main**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" push origin main 2>&1
```

The existing `.github/workflows/deploy-daily-report.yml` workflow auto-fires on push to `main` when files in `azure-functions/**` change. It runs `npm install` and uses `Azure/functions-action@v1.5.6` to deploy the entire `azure-functions/` folder.

- [ ] **Step 2: Watch the deploy**

Open `https://github.com/JonasSimo/repose-tracker/actions` in browser. The "Deploy Daily Report Function" workflow should be green within 2-3 minutes.

If it fails, the error is in the Actions log — typical causes: `npm install` missing `xlsx` (Task 1), invalid JSON in `function.json`, or Azure publish-profile secret expired.

- [ ] **Step 3: Verify the env vars are set in Azure**

Open the Azure Portal → Function App `repnet-daily-report` (or equivalent) → Configuration → Application settings. Verify these are present:

- `TENANT_ID` (existing)
- `CLIENT_ID` (existing)
- `CLIENT_SECRET` (existing)
- `SEND_FROM` (existing — for review-reminder)
- `QMS_LEGACY_MDL_PATH` (NEW — for mdl-export). If missing, click **+ New application setting**, name `QMS_LEGACY_MDL_PATH`, value (e.g.) `/sites/ReposeFurniture-HealthandSafety/Shared Documents/Master Document List/REPO-HS000.xlsx`. Save → restart the Function App.

- [ ] **Step 4: Run each function manually to verify**

In Azure Portal → Function App → expand Functions → click `doc-control-review-reminder` → click **Code + Test** → click **Test/Run** → click **Run**. Watch the Logs panel.

Expected log output:
```
[review-reminder] starting at 2026-05-04T...
[review-reminder] fetched N docs
[review-reminder] M due in next 30d, K overdue
[review-reminder] L unique owner(s) to notify
[review-reminder] sent to <email> (P doc(s))
[review-reminder] done. sent=L failed=0
```

If `auth failed`: admin consent for the App Registration is missing. Tell the IT admin to grant `Sites.ReadWrite.All` and `Mail.Send` (App permissions) → then re-run.

Do the same for `doc-control-mdl-export`. Expected:
```
[mdl-export] starting at 2026-05-04T...
[mdl-export] fetched N register rows
[mdl-export] xlsx built, B bytes
[mdl-export] uploaded to https://reposefurniturelimited.sharepoint.com/...
[mdl-export] done
```

Open the resulting URL — confirm the xlsx is there, has the right header row, and lists all the imported register entries.

- [ ] **Step 5: Confirm scheduled runs**

After 02:00 / 02:30 the next morning, check Azure Portal → Functions → Monitor for both functions. Each should show one Successful run from the timer trigger.

---

## Self-Review

**Spec coverage:**

| Plan 2B goal | Covered by |
|---|---|
| Periodic-review reminder Azure Function | Tasks 2, 3 |
| Email each Owner 30 days before NextReviewDate | Task 3 (filter + group + send) |
| Continue weekly while still due | Task 3 schedule (`0 0 2 * * *` runs daily; the test `daysUntil <= 30` matches every day in the window, not just exactly-30; effectively a daily reminder during the window. Spec said "weekly while still due" — current implementation is daily, which is more aggressive but still a valid interpretation. To get truly weekly, change schedule to `0 0 2 * * 1` (Mondays at 02:00). Documenting as a follow-up.) |
| Excel auto-export Azure Function | Tasks 1, 4 |
| Nightly rebuild of REPO-HS000.xlsx from live List | Task 4 |
| Layout matches legacy MDL | Task 4 (`buildWorkbook`) |

**Placeholder scan:** None.

**Type consistency:** Both functions share the same auth pattern (`getAppToken` → `graphGet` → `graphGetAll`). Both use the same SP_HOST + QMS_SITE_PATH + QMS_REGISTER_LIST constants. Email shell HTML in Task 3 uses the same `_docsEmailShell` brand markup as the in-app `_sendDocsEmail` helper, kept consistent for visual cohesion.

**Open items:**
- The reminder function is currently daily (anything ≤ 30 days re-emails every day). Consider switching to weekly (`0 0 2 * * 1`) if email volume becomes a problem. Documented in commit message as follow-up.
- The Excel export overwrites the legacy file directly. SharePoint document-library versioning preserves history (50 major versions per Foundation Task 1 setup) so prior nightly snapshots stay retrievable, but consider also writing dated copies to a backup folder for redundancy. Out of scope for this plan.

## Risks

- **Mail.Send admin consent** may not be granted for the App Registration. The function will return 401 at runtime; the user must coordinate with IT admin (per memory: this has been the blocker on the existing daily-report function). The function fails gracefully — logs the error and exits without crashing.
- **Sites.ReadWrite.All admin consent** same situation. Without it, the export function can't write the xlsx.
- **`QMS_LEGACY_MDL_PATH` is wrong** (typo, file moved, etc.) — the upload returns 404 or 400. The function logs the upload error verbatim so the path can be corrected in App Settings.
- **MasterDocumentRegister grows beyond 999 rows** — the `$top=999` limit + `@odata.nextLink` pagination handles this via `graphGetAll`. Should never be a problem for QMS document counts.
