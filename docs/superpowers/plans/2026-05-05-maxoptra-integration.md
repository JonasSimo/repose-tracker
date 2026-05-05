# Maxoptra Integration — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Maxoptra collection-job status on RepNet tickets via a 30-min Azure Function poll, plus auto-email transport when a chair is marked for return.

**Architecture:** New Azure Function `service-maxoptra-poll` (timer trigger, mirrors `parts-fedex-poll` shape) writes Maxoptra-derived status into 3 new TICKET LOG columns. The browser-side "Mark for return" handler in `index.html` stops auto-filling `Returned to Factory` and instead sends a transport email via the existing `_sendDocsEmail` Graph helper. The dashboard renders the `Maxoptra Status` column verbatim as a colored pill in 3 locations.

**Tech Stack:** Azure Functions (Node.js 22), `@azure/msal-node`, `node-fetch`, Microsoft Graph API, vanilla JS browser code.

**Spec:** `docs/superpowers/specs/2026-05-05-maxoptra-integration-design.md` is the source of truth. Each task references the relevant section.

---

## File Structure

**To create:**
- `azure-functions/service-maxoptra-poll/function.json` — timer binding
- `azure-functions/service-maxoptra-poll/index.js` — function logic (~280 lines)

**To modify:**
- `azure-functions/local.settings.json.example` — add new env vars
- `index.html` — Mark for return handler, pill CSS + rendering, modal text update

**Manual / operational (not code):**
- TICKET LOG (SharePoint Excel) — add 3 columns
- Azure Function App settings — add 4 env vars
- Maxoptra portal — verify Reference field convention with transport

**Pattern reference:** `azure-functions/parts-fedex-poll/index.js` is the architectural twin. Match its style.

---

## Task 1: Azure Function scaffold

**Files:**
- Create: `azure-functions/service-maxoptra-poll/function.json`
- Create: `azure-functions/service-maxoptra-poll/index.js` (skeleton)

- [ ] **Step 1.1: Create the timer binding**

Write `azure-functions/service-maxoptra-poll/function.json`:

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 */30 * * * *"
    }
  ]
}
```

Schedule cron `0 */30 * * * *` = every 30 minutes on the hour and half-hour.

- [ ] **Step 1.2: Create the index.js skeleton**

Write `azure-functions/service-maxoptra-poll/index.js`:

```js
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// service-maxoptra-poll
//
// 30-min timer (cron `0 */30 * * * *`). Polls Maxoptra for active collection
// jobs whose Reference field contains a RepNet REP Number, and writes the
// derived status back to TICKET LOG (Maxoptra Job ID, Maxoptra Status,
// Maxoptra Updated). When Maxoptra reports a job complete, also fills the
// existing Returned to Factory date column.
//
// Required app settings:
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET   — Microsoft Graph app-only (existing)
//   TICKETS_SHARING_URL                    — TICKET LOG SharePoint sharing URL (existing)
//   MAXOPTRA_API_KEY                       — Maxoptra production API key
//   MAXOPTRA_BASE_URL                      — e.g. https://api.maxoptra.com
//   MAXOPTRA_ENV                           — 'sandbox' | 'production'
//   MAXOPTRA_ACCOUNT_ID                    — (if Maxoptra requires a tenant param)
//
// SAFETY: in sandbox, all PATCH calls are dry-run logged but not executed.
// ─────────────────────────────────────────────────────────────────────────

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const MAXOPTRA_API_KEY    = process.env.MAXOPTRA_API_KEY;
const MAXOPTRA_BASE_URL   = (process.env.MAXOPTRA_BASE_URL || 'https://api.maxoptra.com').replace(/\/$/, '');
const MAXOPTRA_ACCOUNT_ID = process.env.MAXOPTRA_ACCOUNT_ID || '';
const MAXOPTRA_ENV        = (process.env.MAXOPTRA_ENV || 'sandbox').toLowerCase();
const IS_PROD             = MAXOPTRA_ENV === 'production';

const TICKETS_SHARING_URL = process.env.TICKETS_SHARING_URL || '';
const TICKET_TABLE = 'TicketLog';

module.exports = async function (context, myTimer) {
  const log = context.log;
  const started = new Date();
  log(`[service-maxoptra-poll] start ${started.toISOString()} · env=${MAXOPTRA_ENV}`);

  if (!MAXOPTRA_API_KEY) {
    log.warn('MAXOPTRA_API_KEY missing — skipping.');
    return;
  }

  // TODO: subsequent tasks fill in this body
  log(`[service-maxoptra-poll] complete · skeleton only · ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
};
```

- [ ] **Step 1.3: Verify the function is registered**

Run from `azure-functions/`:

```bash
cd azure-functions && npx func start --typescript=false
```

Expected: console output lists `service-maxoptra-poll: timerTrigger` alongside the other functions, with no syntax errors. Ctrl+C to stop.

- [ ] **Step 1.4: Commit**

```bash
git add azure-functions/service-maxoptra-poll/
git commit -m "feat(azure): scaffold service-maxoptra-poll function"
```

---

## Task 2: Maxoptra auth + API discovery

**Files:**
- Modify: `azure-functions/service-maxoptra-poll/index.js`

This task includes a **manual API exploration step** before writing code, because Maxoptra's exact response shape is not pre-validated in the spec. The output of the discovery becomes the basis for the parsing code.

- [ ] **Step 2.1: Discover the actual API shape (manual)**

Using a real production Maxoptra API key (the rotated one), run a single curl call to discover the response shape. Record the raw output.

```bash
curl -X GET "https://api.maxoptra.com/orders?status=Planned,InProgress&limit=5" \
  -H "Authorization: Bearer YOUR_KEY_HERE" \
  -H "Accept: application/json"
```

If that endpoint shape doesn't work, try variants:
- `/v1/orders`, `/api/orders`, `/api/v2/orders`
- `?type=Pickup` instead of `status=` filter
- `Authorization: ApiKey YOUR_KEY_HERE` instead of `Bearer`
- Add account header: `X-Account-Id: YOUR_ACCOUNT_ID`

Consult the Maxoptra API reference at https://docs.maxoptra.com/ if needed.

**Capture:** the working URL, headers, and a sample JSON response body. Save to a scratch file (e.g. `azure-functions/service-maxoptra-poll/_api-shape.txt`, gitignored — do NOT commit the response since it contains real customer data).

- [ ] **Step 2.2: Implement `getMaxoptraJobs` based on the discovered shape**

In `index.js`, add the auth + fetch helpers AFTER the constants block:

```js
// ─── Maxoptra API ────────────────────────────────────────────────────────
async function getMaxoptraJobs(log) {
  // Filter to active pickup/collection jobs only — exclude terminal states.
  // ADJUST the URL + status filter based on Step 2.1 discovery output.
  const url = `${MAXOPTRA_BASE_URL}/orders?type=Pickup&status=Planned,InProgress,Scheduled,PickedUp`;
  const headers = {
    'Authorization': `Bearer ${MAXOPTRA_API_KEY}`,
    'Accept': 'application/json'
  };
  if (MAXOPTRA_ACCOUNT_ID) headers['X-Account-Id'] = MAXOPTRA_ACCOUNT_ID;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Maxoptra GET ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  // ADJUST 'data.orders' below if the response uses a different envelope key.
  const jobs = Array.isArray(data) ? data : (data.orders || data.items || data.data || []);
  log(`[maxoptra] retrieved ${jobs.length} active collection job(s)`);
  return jobs;
}
```

- [ ] **Step 2.3: Wire it into the main entry to verify auth works**

Replace the `// TODO: subsequent tasks` block in `module.exports` with:

```js
  // Phase 1 of plan: just retrieve and log Maxoptra jobs to verify auth.
  let jobs;
  try {
    jobs = await getMaxoptraJobs(log);
  } catch (e) {
    log.error('Maxoptra fetch failed:', e.message);
    return;
  }
  log(`[service-maxoptra-poll] sample jobs: ${JSON.stringify(jobs.slice(0, 2), null, 2)}`);
  log(`[service-maxoptra-poll] complete (Task 2 only) · ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
```

- [ ] **Step 2.4: Local smoke test against sandbox or production Maxoptra**

In `azure-functions/local.settings.json`, set:
```
"MAXOPTRA_API_KEY": "the-rotated-key",
"MAXOPTRA_BASE_URL": "https://api.maxoptra.com",
"MAXOPTRA_ENV": "sandbox"
```

Run:
```bash
cd azure-functions && npx func start
```

In a second terminal, trigger manually:
```bash
curl -X POST http://localhost:7071/admin/functions/service-maxoptra-poll \
  -H "Content-Type: application/json" -d '{"input":""}'
```

Expected: function logs `retrieved N active collection job(s)` followed by 2 sample job objects in JSON. If 0 jobs, that's also OK — auth works. If auth fails, fix the URL/headers per Step 2.1 findings before continuing.

- [ ] **Step 2.5: Commit**

```bash
git add azure-functions/service-maxoptra-poll/index.js
git commit -m "feat(azure): service-maxoptra-poll Maxoptra auth + GET orders"
```

---

## Task 3: Microsoft Graph + TICKET LOG read

**Files:**
- Modify: `azure-functions/service-maxoptra-poll/index.js`

Same Graph helpers as `parts-fedex-poll`. Reuse the exact pattern so failure modes are familiar.

- [ ] **Step 3.1: Add Graph auth + helpers**

In `index.js`, AFTER the Maxoptra section, add:

```js
// ─── Microsoft Graph ─────────────────────────────────────────────────────
async function getGraphToken() {
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
  if (!res.ok) throw new Error(`Graph GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

function encodeSharingUrl(url) {
  const b64 = Buffer.from(url).toString('base64');
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

async function resolveDriveItem(token, sharingUrl) {
  const encoded = encodeSharingUrl(sharingUrl);
  const item = await graphGet(token, `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
  return { driveId: item.parentReference.driveId, itemId: item.id };
}

async function readTicketLog(token, driveId, itemId) {
  // Use the table's range to get header + values in one call.
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/tables('${TICKET_TABLE}')/range(valuesOnly=false)?$select=values`;
  const range = await graphGet(token, url);
  return range.values || [];
}
```

- [ ] **Step 3.2: Wire it into the main entry**

Insert these lines AFTER the `getMaxoptraJobs` call (replacing the temporary "complete (Task 2 only)" log line):

```js
  if (!TICKETS_SHARING_URL) {
    log.warn('TICKETS_SHARING_URL missing — cannot continue.');
    return;
  }

  let graphToken;
  try {
    graphToken = await getGraphToken();
  } catch (e) {
    log.error('Graph auth failed:', e.message);
    return;
  }

  let driveId, itemId;
  try {
    ({ driveId, itemId } = await resolveDriveItem(graphToken, TICKETS_SHARING_URL));
  } catch (e) {
    log.error('Could not resolve TICKET LOG:', e.message);
    return;
  }

  let values;
  try {
    values = await readTicketLog(graphToken, driveId, itemId);
  } catch (e) {
    log.error('Could not read TicketLog:', e.message);
    return;
  }
  if (values.length < 2) {
    log.warn('TicketLog has no data rows.');
    return;
  }
  log(`[service-maxoptra-poll] read TicketLog · ${values.length - 1} data rows`);
```

- [ ] **Step 3.3: Local smoke test**

Set `TICKETS_SHARING_URL` in `local.settings.json` (copy from your daily-report function settings — same workbook). Run + trigger as in 2.4.

Expected: log line `read TicketLog · N data rows` where N matches the rough TICKET LOG size.

- [ ] **Step 3.4: Commit**

```bash
git add azure-functions/service-maxoptra-poll/index.js
git commit -m "feat(azure): service-maxoptra-poll Graph TICKET LOG read"
```

---

## Task 4: REP No matching + status mapping

**Files:**
- Modify: `azure-functions/service-maxoptra-poll/index.js`

- [ ] **Step 4.1: Add column-locator + chair-id helpers**

After the Graph section, add:

```js
// ─── Helpers ─────────────────────────────────────────────────────────────
function _norm(s) { return String(s || '').trim().toLowerCase(); }

function findColIdx(headerRow, name) {
  const target = _norm(name);
  return headerRow.findIndex(h => _norm(h) === target);
}

// Match index.html's _parseChairId — keeps the REP-No semantics consistent.
function parseChairId(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const m = /^(REP\d+)(?:-R(\d+))?$/i.exec(v);
  if (!m) return { rep: v, returnNo: 0, isReturn: false, label: v };
  return { rep: m[1].toUpperCase(), returnNo: m[2] ? parseInt(m[2], 10) : 0, isReturn: !!m[2], label: v.toUpperCase() };
}

function fmtDateLocal(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateOnly(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${d.toLocaleString('en-GB', { month: 'short' })}`;
}
```

- [ ] **Step 4.2: Add the status mapping function**

```js
// Translate a Maxoptra job's raw status into the friendly pill text we
// store in TICKET LOG. Unknown statuses fall through to a "❓" pill that
// surfaces the raw value so we can extend this mapping fast.
function mapMaxoptraStatus(rawStatus, scheduledTime, completedAt) {
  const s = String(rawStatus || '').trim().toLowerCase();
  const sched = scheduledTime ? new Date(scheduledTime) : null;
  const done  = completedAt ? new Date(completedAt) : null;

  if (s === 'completed' || s === 'delivered' || s === 'finished') {
    return `✅ In factory · ${fmtDateOnly(done || sched || new Date())}`;
  }
  if (s === 'inprogress' || s === 'in_progress' || s === 'in progress' ||
      s === 'pickedup'   || s === 'picked_up'   || s === 'picked up'   ||
      s === 'onway'      || s === 'on_way'      || s === 'on way') {
    return `🚚 Collected · returning to factory`;
  }
  if (s === 'planned' || s === 'scheduled' || s === 'assigned') {
    const when = fmtDateLocal(sched);
    return when ? `📅 Scheduled · ${when}` : `📅 Scheduled`;
  }
  // Unmapped — surface raw value so the engineer adds it next pass.
  return `❓ ${rawStatus || 'unknown'}`;
}
```

- [ ] **Step 4.3: Build the REP-No → row map**

After the `readTicketLog` call, add:

```js
  const headerRow = values[0];
  const repNoIdx     = findColIdx(headerRow, 'REP Number');
  const ticketNoIdx  = findColIdx(headerRow, 'Ticket No');
  const customerIdx  = findColIdx(headerRow, 'Customer');
  const returnedIdx  = findColIdx(headerRow, 'Returned to Factory');
  const mxJobIdx     = findColIdx(headerRow, 'Maxoptra Job ID');
  const mxStatusIdx  = findColIdx(headerRow, 'Maxoptra Status');
  const mxUpdatedIdx = findColIdx(headerRow, 'Maxoptra Updated');

  if (repNoIdx < 0) {
    log.error(`TicketLog missing "REP Number" column. Headers: ${headerRow.join(', ')}`);
    return;
  }
  if (mxJobIdx < 0 || mxStatusIdx < 0 || mxUpdatedIdx < 0) {
    log.error(`TicketLog missing Maxoptra columns. Add them per Task 5 of the plan before this function will write anything.`);
    // Don't return — let it continue read-only so we can see what the function would do.
  }

  // Build map: full chair label (e.g. "REP2284-R1") → { rowIdx (0-based data), values reference }
  const ticketsByLabel = new Map();
  for (let i = 1; i < values.length; i++) {
    const cid = parseChairId(values[i][repNoIdx]);
    if (!cid || !cid.isReturn) continue; // only -R suffix rows are candidates
    ticketsByLabel.set(cid.label, { rowIdx: i - 1, sheetRow: i + 1, raw: values[i] });
  }
  log(`[service-maxoptra-poll] indexed ${ticketsByLabel.size} ticket rows with -R suffix`);
```

- [ ] **Step 4.4: Match Maxoptra jobs → tickets and log (no writes yet)**

Add after the indexing:

```js
  let matched = 0;
  let orphans = 0;
  for (const job of jobs) {
    // ADJUST these field paths to match what Step 2.1 discovery showed.
    const ref = String(job.reference || job.externalId || '').trim().toUpperCase();
    if (!ref) { orphans++; continue; }
    const ticket = ticketsByLabel.get(ref);
    if (!ticket) {
      orphans++;
      log.warn(`[orphan] Maxoptra job ${job.id || '?'} reference="${ref}" — no matching ticket`);
      continue;
    }
    matched++;
    const pill = mapMaxoptraStatus(job.status, job.scheduledTime, job.completedAt);
    log(`[match] ${ref} (ticket row ${ticket.sheetRow}) → ${pill}`);
  }
  log(`[service-maxoptra-poll] complete (Task 4 readonly) · matched=${matched} orphans=${orphans} · ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
```

- [ ] **Step 4.5: Local smoke test**

Run + trigger. Expected output:
- `indexed N ticket rows with -R suffix` where N matches your real returns count
- One `[match]` or `[orphan]` line per Maxoptra job
- Pill text looks reasonable; any `❓` lines flag mapping gaps for Task 10

- [ ] **Step 4.6: Commit**

```bash
git add azure-functions/service-maxoptra-poll/index.js
git commit -m "feat(azure): service-maxoptra-poll match jobs to tickets + status mapping"
```

---

## Task 5: TICKET LOG schema migration (manual)

**Files:** None — operational change to SharePoint Excel workbook.

- [ ] **Step 5.1: Open TICKET LOG in Excel**

In SharePoint, open the workbook that backs TICKET LOG. Ensure no one else has it open.

- [ ] **Step 5.2: Add three columns at the right end of the TicketLog table**

Right of the rightmost existing column, add these three column headers (case-sensitive — must match the function's `findColIdx` calls):

| Column header | Format |
|---|---|
| `Maxoptra Job ID` | Text |
| `Maxoptra Status` | Text |
| `Maxoptra Updated` | Short Date |

Make sure each one is added INSIDE the existing `TicketLog` Excel Table, not as a separate range. (Easiest way: type the header in the cell immediately to the right of the current last header — Excel will auto-extend the table.)

- [ ] **Step 5.3: Verify the function sees the new columns**

Re-run the local function (no code change needed — `findColIdx` looks up by name at runtime).

Expected: the `mxJobIdx`, `mxStatusIdx`, `mxUpdatedIdx` lookups all succeed (no error log about missing columns).

- [ ] **Step 5.4: No commit**

This is an operational change. Note in your QHSE handover that the schema was extended on YYYY-MM-DD.

---

## Task 6: TICKET LOG writes with sandbox guard + 504 retry

**Files:**
- Modify: `azure-functions/service-maxoptra-poll/index.js`

- [ ] **Step 6.1: Add the 504 retry helper**

Same shape as the one we just added to `index.html`. Insert after the `graphGet` helper:

```js
// Microsoft Graph's Excel REST sometimes returns 504 MaxRequestDurationExceeded
// when the workbook is large and the cold-open recalc exceeds the gateway's
// 30s timeout. Retry once after a brief delay — the second attempt benefits
// from a warm session and almost always succeeds.
async function graphFetchWithRetry(url, options) {
  const res = await fetch(url, options);
  if (res.status !== 504 && res.status !== 503 && res.status !== 408) return res;
  await new Promise(r => setTimeout(r, 1500));
  return await fetch(url, options);
}
```

- [ ] **Step 6.2: Add the row-PATCH helper**

```js
async function patchTicketRow(token, driveId, itemId, dataRowIdx, headerRow, updates) {
  // updates is an object keyed by column name (case-insensitive).
  const colCount = headerRow.length;
  const patchRow = new Array(colCount).fill(null);
  for (const [k, v] of Object.entries(updates)) {
    const idx = findColIdx(headerRow, k);
    if (idx < 0) continue;
    patchRow[idx] = v;
  }
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/tables('${TICKET_TABLE}')/rows/itemAt(index=${dataRowIdx})`;
  const res = await graphFetchWithRetry(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [patchRow] })
  });
  if (!res.ok) throw new Error(`PATCH ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 6.3: Replace the read-only match loop with write logic**

Replace the entire body of the `for (const job of jobs)` loop with:

```js
  let matched = 0;
  let orphans = 0;
  let updated = 0;
  let skipped = 0;
  let wouldUpdate = 0;
  let returnedToFactoryFilled = 0;

  const todayIso = new Date().toISOString();

  for (const job of jobs) {
    const ref = String(job.reference || job.externalId || '').trim().toUpperCase();
    if (!ref) { orphans++; continue; }
    const ticket = ticketsByLabel.get(ref);
    if (!ticket) {
      orphans++;
      log.warn(`[orphan] Maxoptra job ${job.id || '?'} reference="${ref}" — no matching ticket`);
      continue;
    }
    matched++;
    const pill = mapMaxoptraStatus(job.status, job.scheduledTime, job.completedAt);
    const currentPill = mxStatusIdx >= 0 ? String(ticket.raw[mxStatusIdx] || '').trim() : '';
    const currentJobId = mxJobIdx >= 0 ? String(ticket.raw[mxJobIdx] || '').trim() : '';

    // Idempotent skip: same pill + same job id = no-op
    if (pill === currentPill && currentJobId === String(job.id || '')) {
      skipped++;
      continue;
    }

    const updates = {
      'Maxoptra Job ID': String(job.id || ''),
      'Maxoptra Status': pill,
      'Maxoptra Updated': todayIso
    };

    // Auto-fill Returned to Factory on completion if not already filled
    const isCompleted = pill.startsWith('✅');
    if (isCompleted && returnedIdx >= 0) {
      const currentReturned = String(ticket.raw[returnedIdx] || '').trim();
      if (!currentReturned) {
        const completedAt = job.completedAt ? new Date(job.completedAt) : new Date();
        // Excel date serial
        updates['Returned to Factory'] = Math.round((completedAt.getTime() / 86400000) + 25569);
        returnedToFactoryFilled++;
      }
    }

    if (!IS_PROD) {
      wouldUpdate++;
      log(`[DRY-RUN] ${ref} row ${ticket.sheetRow} → ${pill} (sandbox; not written)`);
      continue;
    }

    try {
      await patchTicketRow(graphToken, driveId, itemId, ticket.rowIdx, headerRow, updates);
      updated++;
      log(`✓ ${ref} → ${pill}${updates['Returned to Factory'] ? ' (Returned to Factory filled)' : ''}`);
    } catch (e) {
      log.warn(`✗ Failed to update ${ref} at row ${ticket.sheetRow}: ${e.message}`);
    }
  }
```

- [ ] **Step 6.4: Add the stuck-waiting pass**

After the for-loop above, add:

```js
  // Mark "stuck waiting" tickets: -R suffix REP No, no Maxoptra Job ID,
  // no current Maxoptra Status (or current ≠ waiting). Idempotent.
  let waitingMarked = 0;
  if (mxJobIdx >= 0 && mxStatusIdx >= 0) {
    const waitingPill = '⏳ Waiting for collection booking';
    for (const [label, ticket] of ticketsByLabel.entries()) {
      const currentJobId = String(ticket.raw[mxJobIdx] || '').trim();
      const currentPill  = String(ticket.raw[mxStatusIdx] || '').trim();
      if (currentJobId) continue;             // has Maxoptra job — covered by main loop
      if (currentPill === waitingPill) continue; // already waiting — skip

      const updates = {
        'Maxoptra Status': waitingPill,
        'Maxoptra Updated': todayIso
      };
      if (!IS_PROD) {
        log(`[DRY-RUN] ${label} row ${ticket.sheetRow} → ${waitingPill} (sandbox; not written)`);
        continue;
      }
      try {
        await patchTicketRow(graphToken, driveId, itemId, ticket.rowIdx, headerRow, updates);
        waitingMarked++;
        log(`⏳ ${label} → ${waitingPill}`);
      } catch (e) {
        log.warn(`✗ Failed to mark ${label} waiting at row ${ticket.sheetRow}: ${e.message}`);
      }
    }
  }
```

- [ ] **Step 6.5: Update the final summary log**

Replace the previous `complete (Task 4 readonly)` line with:

```js
  const duration = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  if (IS_PROD) {
    log(`[service-maxoptra-poll] complete · matched=${matched} updated=${updated} skipped=${skipped} waiting=${waitingMarked} returnedFilled=${returnedToFactoryFilled} orphans=${orphans} · ${duration}s`);
  } else {
    log(`[service-maxoptra-poll] complete · DRY-RUN (env=${MAXOPTRA_ENV}) · matched=${matched} wouldUpdate=${wouldUpdate} skipped=${skipped} orphans=${orphans} · no writes performed · ${duration}s`);
  }
```

- [ ] **Step 6.6: Local smoke test (sandbox)**

With `MAXOPTRA_ENV=sandbox` in `local.settings.json`, run + trigger. Expected:
- All output prefixed `[DRY-RUN]` for matched jobs
- Final summary line ends `no writes performed`
- TICKET LOG remains untouched (verify in browser)

- [ ] **Step 6.7: Commit**

```bash
git add azure-functions/service-maxoptra-poll/index.js
git commit -m "feat(azure): service-maxoptra-poll write logic with sandbox guard + 504 retry"
```

---

## Task 7: Browser — Mark for return: stop auto-fill + transport email + modal text

**Files:**
- Modify: `index.html` (around lines 21383, 21441-21442, 21455-21460)

- [ ] **Step 7.1: Update the modal warning text**

Find the modal text in `index.html` near line 21383:

```html
<p style="font-size:11.5px;color:var(--text2);margin-top:14px;line-height:1.5">This will write today's date to the ticket's <b>Returned to Factory</b> column and update the REP Number to the new chair ID. Maxoptra collection booking + transport email will be added in Phase D — for now this records intent only.</p>
```

Replace with:

```html
<p style="font-size:11.5px;color:var(--text2);margin-top:14px;line-height:1.5">This will update the REP Number to <b>${_escapeSvc(nextChairId)}</b> and email transport@ + John to book collection in Maxoptra. The status will track here automatically once the job is created.</p>
```

- [ ] **Step 7.2: Stop auto-filling Returned to Factory on Mark for return click**

Find this block in `index.html` near line 21440:

```js
      // PATCH the specific row using the rows/itemAt(index=N) endpoint
      const patchRow = new Array(cols.length).fill(null);
      patchRow[returnedColIdx] = _isoToExcelSerial(new Date().toISOString().slice(0, 10));
      if (repNoColIdx >= 0) patchRow[repNoColIdx] = nextChairId;
```

Replace with:

```js
      // PATCH the specific row. Note: we no longer auto-fill Returned to Factory
      // here — that column now means "actual factory arrival date" and is filled
      // by the service-maxoptra-poll Azure Function when Maxoptra reports the
      // collection complete. The Mark-for-return action now only updates REP No
      // (and triggers the transport email below).
      const patchRow = new Array(cols.length).fill(null);
      if (repNoColIdx >= 0) patchRow[repNoColIdx] = nextChairId;
```

- [ ] **Step 7.3: Add transport email after successful PATCH**

Find this block near line 21455 (right after the successful PATCH and before the close + reload):

```js
      console.log('[svc] marked for return — ticket:', t.ticketNo, '→ chair:', nextChairId);
      close();
      drawerOverlay?.remove();
      await loadServiceData(true);
      _renderServiceAll();
      alert(`${t.ticketNo} marked for return. Chair is now ${nextChairId}.`);
```

Replace with:

```js
      console.log('[svc] marked for return — ticket:', t.ticketNo, '→ chair:', nextChairId);

      // Email transport + John to book the collection in Maxoptra. Non-blocking:
      // if the email fails, we still proceed (the row is saved) and surface a
      // toast so the user notifies transport manually.
      let emailFailed = false;
      try {
        const subject = `Collection needed: ${nextChairId} (${t.customer || 'customer'})`;
        const userName = (typeof account === 'object' && account?.name) ? account.name :
                         (typeof account === 'object' && account?.username) ? account.username : 'RepNet user';
        const customerLine = t.customer ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Customer:</td><td style="padding:4px 0">${_escapeSvc(t.customer)}</td></tr>` : '';
        const faultLine = (t.faultCode || t.subFault) ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Fault:</td><td style="padding:4px 0">${_escapeSvc(t.faultCode || '')}${t.subFault ? ' — ' + _escapeSvc(t.subFault) : ''}</td></tr>` : '';
        const htmlBody = `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <h2 style="font-size:18px;margin:0 0 16px">Collection needed</h2>
  <p style="font-size:14px;margin:0 0 16px">${_escapeSvc(t.customer || 'A customer')} have a chair that needs to come back to the factory.</p>
  <table style="font-size:13px;border-collapse:collapse;margin:0 0 16px">
    <tr><td style="padding:4px 12px 4px 0;color:#666">Chair:</td><td style="padding:4px 0;font-family:'JetBrains Mono',monospace;font-weight:700;color:#ea580c">${_escapeSvc(nextChairId)}</td></tr>
    ${customerLine}
    ${faultLine}
    <tr><td style="padding:4px 12px 4px 0;color:#666">Marked for return by:</td><td style="padding:4px 0">${_escapeSvc(userName)} on ${new Date().toLocaleDateString('en-GB')}</td></tr>
  </table>
  <p style="font-size:13px;margin:0 0 16px"><b>Please book the collection in Maxoptra against reference ${_escapeSvc(nextChairId)}.</b><br>The status will update automatically on RepNet once the job is in Maxoptra.</p>
  <p style="font-size:11px;color:#666;margin:24px 0 0">— RepNet (auto-generated)</p>
</div></body></html>`;

        await _sendDocsEmail({
          to: ['john.bradnick@reposefurniture.co.uk', 'transport@reposefurniture.co.uk'],
          subject,
          htmlBody
        });
      } catch (mailErr) {
        emailFailed = true;
        console.warn('[svc] transport email failed:', mailErr.message);
      }

      close();
      drawerOverlay?.remove();
      await loadServiceData(true);
      _renderServiceAll();
      if (emailFailed) {
        alert(`${t.ticketNo} marked for return (chair: ${nextChairId}). Transport email FAILED — please notify John & transport manually.`);
      } else {
        alert(`${t.ticketNo} marked for return. Chair is now ${nextChairId}. Transport has been emailed.`);
      }
```

- [ ] **Step 7.4: Local browser test**

Open RepNet locally. Click "Mark for return" on a test ticket. Verify:
- Modal text reflects new wording (no "Phase D" mention)
- After clicking Confirm: alert says "Transport has been emailed"
- TICKET LOG row: REP No has -R suffix, `Returned to Factory` is **empty** (not today's date)
- Sent Items in Outlook: email to John + transport@ exists

- [ ] **Step 7.5: Commit**

```bash
git add index.html
git commit -m "feat(service): Mark for return sends transport email; stop auto-fill Returned to Factory"
```

---

## Task 8: Browser — Maxoptra Status pill rendering

**Files:**
- Modify: `index.html` (CSS block + 3 render locations)

- [ ] **Step 8.1: Add the CSS classes**

In `index.html`, find the existing `.svc-chair-pill` CSS block near line 3097. Add these new classes immediately after:

```css
.svc-mx-pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; line-height: 1.4; }
.svc-mx-pill.waiting    { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
.svc-mx-pill.scheduled  { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.svc-mx-pill.collected  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.svc-mx-pill.in-factory { background: #f0fdf4; color: #14532d; border: 1px solid #86efac; }
.svc-mx-pill.unknown    { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
```

- [ ] **Step 8.2: Add the pill-html helper**

Find the existing `_chairPillHtml` function near line 21281. Add this immediately after it:

```js
// Render the Maxoptra Status pill from the column text. CSS class derived from
// the leading emoji which is unambiguous in our mapping (⏳/📅/🚚/✅/❓).
function _maxoptraPillHtml(statusText) {
  const t = String(statusText || '').trim();
  if (!t) return '';
  let cls = 'unknown';
  if (t.startsWith('⏳')) cls = 'waiting';
  else if (t.startsWith('📅')) cls = 'scheduled';
  else if (t.startsWith('🚚')) cls = 'collected';
  else if (t.startsWith('✅')) cls = 'in-factory';
  return `<span class="svc-mx-pill ${cls}">${_escapeSvc(t)}</span>`;
}
```

- [ ] **Step 8.3: Read the new column from the loaded data**

Find the place where ticket fields are mapped from the spreadsheet rows (search for `returnedToFactory` or other ticket fields — likely near where the ticket object is built from the row). Add a `maxoptraStatus` field alongside.

Locate this region — you'll find it where the row → ticket object mapping is done. Add (or merge with existing similar block):

```js
// Within the ticket-from-row mapping function, add:
maxoptraStatus: getCell('Maxoptra Status'),
maxoptraJobId: getCell('Maxoptra Job ID'),
maxoptraUpdated: getCell('Maxoptra Updated'),
```

(If the existing code uses `findCol` / direct index access rather than a `getCell` helper, follow the existing pattern — the goal is just to surface `maxoptraStatus` on the ticket object.)

- [ ] **Step 8.4: Render in open tickets table meta line**

Find the line near 21231 that renders the ticket row meta:

```js
<div class="meta">${_escapeSvc(t.customer)} · ${_escapeSvc(t.subFault || '')} ${_chairPillHtml(t) ? ' · ' + _chairPillHtml(t) : ''}</div>
```

Replace with:

```js
<div class="meta">${_escapeSvc(t.customer)} · ${_escapeSvc(t.subFault || '')} ${_chairPillHtml(t) ? ' · ' + _chairPillHtml(t) : ''}${_maxoptraPillHtml(t.maxoptraStatus) ? ' · ' + _maxoptraPillHtml(t.maxoptraStatus) : ''}</div>
```

- [ ] **Step 8.5: Render in ticket drawer**

Find the ticket drawer render function (search for `svc-drawer-mark-return` to locate it — near line 21306). Just above the field grid, add:

```js
${t.maxoptraStatus ? `<div style="margin:8px 0 14px">${_maxoptraPillHtml(t.maxoptraStatus)}</div>` : ''}
```

- [ ] **Step 8.6: Render in Returns Pipeline kanban**

Find the kanban "Awaiting collection" column rendering near line 21853. Locate where each card subtitle is built and append the Maxoptra pill:

Search for existing card-rendering code in that block. After the main card content, append:

```js
${t.maxoptraStatus ? `<div style="margin-top:6px">${_maxoptraPillHtml(t.maxoptraStatus)}</div>` : ''}
```

(Apply this once per card — same one-line addition in each of the 3 kanban columns where ticket cards are rendered, so the pill follows the ticket regardless of which column it lands in.)

- [ ] **Step 8.7: Local browser test**

Open RepNet. Manually paste a value into a TICKET LOG row's Maxoptra Status column (e.g. `📅 Scheduled · Tue 12 May 14:00`), then refresh the dashboard. Verify the blue "Scheduled" pill appears in:
1. The Open Tickets table row
2. The drawer when you open that ticket
3. The Returns Pipeline "Awaiting collection" card (if it's there)

- [ ] **Step 8.8: Commit**

```bash
git add index.html
git commit -m "feat(service): render Maxoptra Status pill on ticket card, drawer, and kanban"
```

---

## Task 9: Configure Azure + deploy in sandbox

**Files:**
- Modify: `azure-functions/local.settings.json.example`

- [ ] **Step 9.1: Document the new env vars in the example file**

Edit `azure-functions/local.settings.json.example`. Add these keys to the `Values` block:

```json
    "MAXOPTRA_API_KEY": "<paste-rotated-key-here>",
    "MAXOPTRA_BASE_URL": "https://api.maxoptra.com",
    "MAXOPTRA_ENV": "sandbox",
    "MAXOPTRA_ACCOUNT_ID": "",
    "TICKETS_SHARING_URL": "<paste-the-ticketlog-sharing-url-from-portal>"
```

- [ ] **Step 9.2: Commit the example file change**

```bash
git add azure-functions/local.settings.json.example
git commit -m "chore(azure): document Maxoptra env vars in local.settings example"
```

- [ ] **Step 9.3: Configure the live Function App (manual)**

In Azure Portal → your Function App (where parts-fedex-poll lives) → Settings → Environment variables → add:

| Name | Value |
|---|---|
| `MAXOPTRA_API_KEY` | the rotated production key |
| `MAXOPTRA_BASE_URL` | `https://api.maxoptra.com` (or sandbox URL if Maxoptra has one) |
| `MAXOPTRA_ENV` | `sandbox` (this is the safety gate — start in sandbox) |
| `MAXOPTRA_ACCOUNT_ID` | (set if Maxoptra requires it, otherwise leave unset) |

If `TICKETS_SHARING_URL` is not already set (it should be, used by other functions), add that too. Click **Apply** → **Confirm** restart.

- [ ] **Step 9.4: Deploy the function**

Whichever method you've been using to deploy `parts-fedex-poll` (VS Code "Deploy to Function App", `func azure functionapp publish`, or GitHub Action) — push the new function. Wait for deployment to complete.

- [ ] **Step 9.5: Verify it's running**

Azure Portal → Function App → Functions → confirm `service-maxoptra-poll` appears in the list with status **Enabled**.

- [ ] **Step 9.6: Manual trigger to confirm sandbox dry-run**

Open `service-maxoptra-poll` → **Code + Test** → click **Test/Run** → click green **Run**. Inspect the log pane. Expect:

- First line: `start ... · env=sandbox`
- Maxoptra retrieved N jobs
- TICKET LOG read N data rows
- One `[DRY-RUN]` line per matched job, OR `[orphan]` line for unmatched
- Final line: `complete · DRY-RUN (env=sandbox) · ... · no writes performed`

TICKET LOG should remain unchanged — open it and verify the new Maxoptra columns are still empty.

---

## Task 10: Tune mapping with real responses, then production switch

**Files:**
- Possibly modify: `azure-functions/service-maxoptra-poll/index.js` (mapping table only)

- [ ] **Step 10.1: Inspect sandbox logs for unmapped statuses**

Azure Portal → Function App → Application Insights → Logs (or the function's own Logs tab). Run a query (or just scroll the latest invocation):

Look for any `❓` lines — these are Maxoptra status strings that hit the unmapped fallback. Note each unique raw status value.

- [ ] **Step 10.2: Extend the mapping table if needed**

In `mapMaxoptraStatus()` in `index.js`, add cases for any unmapped statuses found. Example, if Maxoptra returned `Acknowledged`:

```js
  if (s === 'planned' || s === 'scheduled' || s === 'assigned' || s === 'acknowledged') {
```

Redeploy. Re-run the manual trigger. Confirm no more `❓` lines.

- [ ] **Step 10.3: Commit any mapping tweaks**

```bash
git add azure-functions/service-maxoptra-poll/index.js
git commit -m "fix(azure): service-maxoptra-poll status mapping covers <Maxoptra-specific-status>"
```

(Skip this step if no changes were needed.)

- [ ] **Step 10.4: Sanity-check what production WILL write**

In sandbox, the dry-run logs show the exact `Maxoptra Status` text and `Returned to Factory` date that the function would have written. Spot-check 2-3 of these against:
- The current Maxoptra job (do dates and statuses match what you see in Maxoptra?)
- The current TICKET LOG row state (are we about to overwrite anything we shouldn't?)

If anything looks wrong, debug before flipping to production.

- [ ] **Step 10.5: Flip MAXOPTRA_ENV to production**

Azure Portal → Function App → Environment variables → change `MAXOPTRA_ENV` from `sandbox` to `production` → Apply → Confirm restart.

- [ ] **Step 10.6: Watch the next run**

Wait for the next 30-min cron (or trigger manually). In logs:

- First line should say `env=production`
- For each matched job: `✓ {ref} → {pill}` (✓ instead of `[DRY-RUN]`)
- Final summary line should NOT have `DRY-RUN` suffix
- Open TICKET LOG and verify the 3 Maxoptra columns are populated for matched rows
- For any chair Maxoptra reports as Completed, verify `Returned to Factory` got a date

- [ ] **Step 10.7: Verify the dashboard end-to-end**

Refresh RepNet → Service Dashboard. The Maxoptra Status pills should appear on tickets matching the function's logged updates. Click into one — drawer should also show the pill.

- [ ] **Step 10.8: 24-hour observation**

Note today's date. Over the next 24 hours, watch for:

- Any unexpected error logs (auth failures, repeat 504s, schema mismatches)
- Tickets stuck in `⏳ Waiting for collection booking` — if any are >24h, flag to John
- Tickets with `❓ unmapped` pills — extend mapping

---

## Self-review

**Spec coverage:**
- ✅ Architecture (spec § Architecture) → Tasks 1-6
- ✅ Schema additions (spec § Schema changes) → Task 5
- ✅ Status mapping (spec § Status mapping) → Tasks 4 + 10
- ✅ Polling cron (spec § Polling cron) → Task 1.1
- ✅ Error handling (spec § Error handling) → Tasks 6.1 (504), 6.3 (orphan, idempotent skip), 6.3 (already-filled guard)
- ✅ Sandbox guard (spec § Sandbox / dry-run guard) → Tasks 6.3, 6.4, 9.6, 10.5
- ✅ Email notification (spec § Email notification) → Task 7.3
- ✅ UI changes — pill (spec § UI changes / Status pill) → Task 8
- ✅ UI changes — modal text (spec § UI changes / Mark for return modal text) → Task 7.1
- ✅ UI changes — Returned to Factory semantic shift → Task 7.2
- ✅ Configuration (spec § Configuration) → Task 9
- ✅ Maxoptra prep (spec § Maxoptra-side prep) → mentioned in Task 2 (verify Reference field, rotate key)

**Placeholder scan:** No TBD/TODO. The "ADJUST per Step 2.1" notes in Tasks 2.2 and 4.4 are intentional — they reflect a real unknown (Maxoptra's exact response shape) that has to be resolved against the live API, not invented in the plan. Step 2.1 itself is the resolution mechanism.

**Type / name consistency:**
- `parseChairId` (function) — same shape as `_parseChairId` in `index.html`
- `mapMaxoptraStatus` — referenced consistently across Tasks 4.2, 6.3, 10.2
- `findColIdx` — used in Tasks 3.1, 4.3, 6.2, 6.3, 6.4
- Column names: `Maxoptra Job ID`, `Maxoptra Status`, `Maxoptra Updated`, `Returned to Factory`, `REP Number` — exact strings match across function code (Task 4.3) and schema migration (Task 5.2)
- Pill emoji prefixes: `⏳`, `📅`, `🚚`, `✅`, `❓` — match exactly between function (Task 4.2) and CSS class derivation (Task 8.2)

**Risks called out in plan:**
- Maxoptra response field names are assumed and will need adjusting at Step 2.1
- Maxoptra status strings will need extending at Step 10.2
- TICKET LOG schema must exist before Task 6 writes succeed — Task 5 ordering is critical
