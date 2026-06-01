# POD Auto-Send (Trial Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect completed POD ("White Glove Check List") inspections in SafetyCulture, fetch the SC-generated PDF, and email it via Graph. Phase 1 sends to Jonas only (trial); Phase 2 (separate plan) routes to the real customer.

**Architecture:** New timer-triggered Azure Function `pod-auto-send` runs every 15 min. Uses the same watermark pattern as `safetyculture-sync` (cursor-paginated `/audits/search` by `modified_after`). For each new audit that is **status=Complete with both signatures present** and not in `pod_send_log`: kick off an SC async PDF export, poll until ready, fetch the PDF bytes, send via Graph `/users/{SEND_FROM}/sendMail` to `POD_TRIAL_RECIPIENT`, and log the result. Idempotency lives in the `pod_send_log.audit_id` unique constraint.

**Tech Stack:**
- Azure Functions Node 18 (timer trigger, same runtime as siblings)
- `node-fetch`, `@azure/msal-node` (already in `azure-functions/package.json`)
- Supabase REST (PostgREST) for state + log, service-role key
- Microsoft Graph (Mail.Send already authorised — daily-report ships)
- SafetyCulture API (Bearer token, single global host `api.safetyculture.io`)

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `repnet/supabase/migrations/0038_pod_auto_send.sql` | Create | `pod_send_sync_state` (watermark per template) + `pod_send_log` (one row per audit_id) |
| `bin/azure-functions/pod-auto-send/function.json` | Create | Timer trigger `0 */15 * * * *` |
| `bin/azure-functions/pod-auto-send/index.js` | Create | Main timer handler — orchestrates poll → eligibility → PDF fetch → mail send → log |
| `bin/azure-functions/pod-auto-send/sc.js` | Create | SC client: `scGet`, `searchAudits`, `getAudit`, `requestPdfExport`, `pollPdfExport` |
| `bin/azure-functions/pod-auto-send/graph.js` | Create | Graph client: `getToken`, `sendMailWithPdf` (reuses the daily-report MSAL pattern) |
| `bin/azure-functions/pod-auto-send/supa.js` | Create | Supabase REST helpers: `supaUpsert`, `supaSelectOne`, `supaInsertSkipOnConflict` |
| `bin/azure-functions/pod-auto-send/eligibility.js` | Create | Pure functions: `isAuditEligible(audit)`, `extractRepSerial(audit)` |
| `bin/azure-functions/pod-auto-send/dry-run.js` | Create | Local CLI: run end-to-end against ONE audit ID without sending the mail (writes the PDF to disk for inspection) |
| `bin/azure-functions/pod-auto-send/find-pod-template.js` | Create | One-shot helper to look up the POD template ID by name substring |
| `bin/POD_AUTO_SEND.md` | Create | Runbook — env vars, trial/live modes, idempotency, common failures |

**Why split into 4 small modules instead of one file like `safetyculture-sync/index.js`:** the existing sync is one file (~450 lines) and it's already at the point where modules would help. The POD function carries a new responsibility (PDF export + binary mail attachment) so we start clean rather than copying the monolith. `index.js` stays a thin orchestrator.

---

## Phase 1 — Trial Mode (this plan)

### Task 1: Find the POD template ID

**Files:**
- Create: `bin/azure-functions/pod-auto-send/find-pod-template.js`

- [ ] **Step 1: Copy the existing template finder verbatim** — `find-template-id.js` in `safetyculture-sync/` already does this. Copy it to the new function directory unchanged, renaming the file:

```bash
cp bin/azure-functions/safetyculture-sync/find-template-id.js bin/azure-functions/pod-auto-send/find-pod-template.js
```

- [ ] **Step 2: Run it locally to find the POD template**

```powershell
cd C:\Users\jonas.simonaitis\.local\bin\azure-functions
$env:SAFETYCULTURE_API_TOKEN = "<paste your SC API token>"
node pod-auto-send\find-pod-template.js "white glove"
```

Expected output: one or more lines like `template_aBcDeF12345  White Glove Check List - Office  (modified ...)`. The POD PDF we already looked at was titled "White Glove Check List - Office" — if there's also a Home variant the function will need to watch multiple template IDs (see Step 3 below).

- [ ] **Step 3: Record the template IDs** — capture them in a scratch file (do NOT commit secrets / IDs to the runbook yet). If there are multiple (Office + Home variants) note that the function will accept a comma-separated `SAFETYCULTURE_POD_TEMPLATE_IDS` env var rather than a single ID.

- [ ] **Step 4: Commit the helper script** (not the IDs)

```bash
git add bin/azure-functions/pod-auto-send/find-pod-template.js
git commit -m "feat(pod-auto-send): add template lookup helper"
```

---

### Task 2: Supabase migration — sync state + send log

**Files:**
- Create: `repnet/supabase/migrations/0038_pod_auto_send.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0038 — POD auto-send state + log
--
-- Two tables for the pod-auto-send Azure Function:
--   • pod_send_sync_state — one row per POD template ID, holds the cursor
--     watermark (last modified_at we processed). Pattern mirrors
--     service_inspection_sync_state from 0033.
--   • pod_send_log — one row per audit_id that we have attempted to send.
--     Unique on (audit_id) so the function is idempotent across retries and
--     reruns. Status tracks success/failure for the daily digest.
--
-- Note: NOT adding the trigger audit_log/audit_trigger_fn here. The shared
-- audit trigger from migration 0001 reads NEW.id + NEW.site_id which neither
-- of these tables uses (see feedback_supabase_audit_trigger_id.md).
--
-- Service role only — no RLS policies because nothing on the user-facing
-- side reads these yet. When the RepNet admin UI lands in Phase 2 we'll
-- add SELECT policies for senior managers.

create table if not exists pod_send_sync_state (
  template_id          text primary key,
  last_modified_after  timestamptz not null default '1970-01-01T00:00:00Z',
  last_run_at          timestamptz,
  last_run_eligible    int default 0,
  last_run_sent        int default 0,
  last_run_failed      int default 0,
  last_run_error       text
);

create table if not exists pod_send_log (
  audit_id      text primary key,                     -- SC audit_id, idempotency key
  template_id   text not null,
  rep_number    text,                                 -- "REP NNNNNNN" or null
  inspection_completed_at  timestamptz,
  sent_to       text not null,                        -- envelope recipient (trial = Jonas)
  send_mode     text not null check (send_mode in ('TRIAL','LIVE')),
  status        text not null check (status in ('sent','failed','skipped')),
  graph_message_id  text,
  error_message text,
  sent_at       timestamptz not null default now()
);

create index if not exists pod_send_log_rep_idx
  on pod_send_log (rep_number);

create index if not exists pod_send_log_sent_at_idx
  on pod_send_log (sent_at desc);

-- Service role bypasses RLS. Enable RLS anyway so we don't accidentally
-- expose these via the anon key.
alter table pod_send_sync_state enable row level security;
alter table pod_send_log        enable row level security;
```

- [ ] **Step 2: Apply the migration**

```powershell
cd C:\Users\jonas.simonaitis\.local\repnet
supabase db push
```

Expected: `Applying migration 0038_pod_auto_send.sql... done.` and `\d pod_send_log` should show the columns.

- [ ] **Step 3: Smoke-check from psql/Studio** — insert one row by hand, confirm the unique constraint blocks a duplicate, then delete:

```sql
insert into pod_send_log (audit_id, template_id, sent_to, send_mode, status)
  values ('audit_test_001','template_test','jonas@test','TRIAL','sent');
-- expect: duplicate key error
insert into pod_send_log (audit_id, template_id, sent_to, send_mode, status)
  values ('audit_test_001','template_test','jonas@test','TRIAL','sent');
delete from pod_send_log where audit_id = 'audit_test_001';
```

- [ ] **Step 4: Commit**

```bash
git add repnet/supabase/migrations/0038_pod_auto_send.sql
git commit -m "feat(pod-auto-send): add sync state + send log tables"
```

---

### Task 3: Function skeleton — function.json + supa.js

**Files:**
- Create: `bin/azure-functions/pod-auto-send/function.json`
- Create: `bin/azure-functions/pod-auto-send/supa.js`

- [ ] **Step 1: Write `function.json` (timer every 15 min, same cadence as sc-sync)**

```json
{
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 */15 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Write `supa.js` — Supabase REST helpers**

```javascript
'use strict';

// PostgREST helpers for pod-auto-send. Service-role key bypasses RLS.

const fetch = require('node-fetch');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function authHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
}

async function supaSelectOne(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`;
  const res = await fetch(url, { headers: { ...authHeaders(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Supabase select ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function supaSelectMany(table, qs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}`;
  const res = await fetch(url, { headers: { ...authHeaders(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Supabase select ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supaUpsert(table, rows, onConflict) {
  if (!rows.length) return;
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${res.status} on ${table}: ${await res.text()}`);
}

// INSERT that returns null on PK conflict instead of throwing. Used to claim
// an audit_id in pod_send_log before doing the (expensive) PDF + mail work,
// so two parallel timer runs can never double-send.
async function supaInsertIgnoreConflict(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Supabase insert ${res.status} on ${table}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null; // null = row already existed (duplicate)
}

async function supaUpdate(table, qs, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${res.status} on ${table}: ${await res.text()}`);
}

module.exports = {
  supaSelectOne,
  supaSelectMany,
  supaUpsert,
  supaInsertIgnoreConflict,
  supaUpdate,
};
```

- [ ] **Step 3: Commit**

```bash
git add bin/azure-functions/pod-auto-send/function.json bin/azure-functions/pod-auto-send/supa.js
git commit -m "feat(pod-auto-send): timer binding + Supabase REST helpers"
```

---

### Task 4: SC client — sc.js

**Files:**
- Create: `bin/azure-functions/pod-auto-send/sc.js`

- [ ] **Step 1: Write `sc.js`**

```javascript
'use strict';

// SafetyCulture API client for pod-auto-send.
//
// SC has one global API hostname; routing is by token, not by region.
// Audit search uses cursor pagination via modified_after — `offset` returns 400
// (see feedback_safetyculture_api.md).

const fetch = require('node-fetch');

const SC_BASE = 'https://api.safetyculture.io';
const SC_TOKEN = process.env.SAFETYCULTURE_API_TOKEN;

function withTimeout(options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { options: { ...options, signal: controller.signal }, cleanup: () => clearTimeout(timer) };
}

async function scFetch(path, init = {}, ms = 30000) {
  const url = path.startsWith('http') ? path : `${SC_BASE}${path}`;
  const { options, cleanup } = withTimeout({
    ...init,
    headers: {
      Authorization: `Bearer ${SC_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  }, ms);
  try {
    const res = await fetch(url, options);
    return res;
  } finally {
    cleanup();
  }
}

async function scGet(path) {
  const res = await scFetch(path);
  if (!res.ok) throw new Error(`SC GET ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function scPostJson(path, body) {
  const res = await scFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SC POST ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Stream-friendly fetch for binary payloads (PDF download URL).
async function scFetchBinary(url) {
  const res = await scFetch(url, {}, 60000);
  if (!res.ok) throw new Error(`SC binary GET ${res.status} on ${url}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Cursor-paginated search. Returns { auditIds: [...], newestModifiedAt }.
// Walks forward by advancing the cursor to the newest modified_at seen on
// each page; seenIds guards against double-counting boundary rows.
async function searchAuditsByTemplate(templateId, modifiedAfter, log) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const auditIds = [];
  const seenIds = new Set();
  let cursor = modifiedAfter;
  let newestSeen = modifiedAfter;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const qs = new URLSearchParams({
      template: templateId,
      modified_after: cursor,
      limit: String(PAGE_SIZE),
      order: 'asc',
    }).toString();
    const page = await scGet(`/audits/search?${qs}`);
    const items = page.audits || page.data || [];
    let newOnThisPage = 0;
    for (const a of items) {
      const id = a.audit_id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      auditIds.push(id);
      newOnThisPage++;
      const m = a.modified_at || a.date_modified;
      if (m && m > newestSeen) newestSeen = m;
    }
    if (items.length < PAGE_SIZE || newOnThisPage === 0) break;
    cursor = newestSeen;
  }
  if (pages >= MAX_PAGES) log?.warn?.(`[pod-auto-send] hit ${MAX_PAGES}-page cap for template ${templateId}`);
  return { auditIds, newestModifiedAt: newestSeen };
}

async function getAudit(auditId) {
  return scGet(`/audits/${encodeURIComponent(auditId)}`);
}

// SC async PDF export — POST kicks off, GET polls until ready.
//   POST /audits/{id}/report  body: { format: "PDF" }      → { messageId }
//   GET  /audits/{id}/report/{messageId}                    → { status, url? }
//
// status values observed in the wild: IN_PROGRESS / SUCCESS / FAILED.
// On SUCCESS the response includes a signed `url` to download the PDF.
async function requestPdfExport(auditId) {
  const res = await scPostJson(`/audits/${encodeURIComponent(auditId)}/report`, { format: 'PDF' });
  return res.messageId || res.message_id || res.id;
}

async function pollPdfExport(auditId, messageId, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await scGet(`/audits/${encodeURIComponent(auditId)}/report/${encodeURIComponent(messageId)}`);
    const status = (res.status || '').toUpperCase();
    if (status === 'SUCCESS' || status === 'COMPLETE' || status === 'COMPLETED') {
      const url = res.url || res.download_url || res.location;
      if (!url) throw new Error(`SC PDF export ${messageId} succeeded but no URL in response`);
      return url;
    }
    if (status === 'FAILED' || status === 'ERROR') {
      throw new Error(`SC PDF export ${messageId} failed: ${res.error || res.message || 'unknown'}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`SC PDF export ${messageId} timed out after ${timeoutMs}ms`);
}

async function fetchPodPdf(auditId, log) {
  log?.(`[pod-auto-send] requesting PDF export for ${auditId}`);
  const messageId = await requestPdfExport(auditId);
  const url = await pollPdfExport(auditId, messageId);
  log?.(`[pod-auto-send] downloading PDF from ${url.slice(0, 80)}...`);
  return scFetchBinary(url);
}

module.exports = {
  scGet,
  searchAuditsByTemplate,
  getAudit,
  fetchPodPdf,
  // exported for the dry-run script
  requestPdfExport,
  pollPdfExport,
};
```

- [ ] **Step 2: Verify the SC PDF export endpoint shape against the docs** — open https://developer.safetyculture.com/reference/inspection_service_exportreport or equivalent. If the path or polling shape differs (e.g. response is `state` not `status`, or status values are lowercase), adjust `requestPdfExport` / `pollPdfExport` accordingly. The function signatures and the consumer (`fetchPodPdf`) don't change.

- [ ] **Step 3: Commit**

```bash
git add bin/azure-functions/pod-auto-send/sc.js
git commit -m "feat(pod-auto-send): SC client with cursor search + async PDF export"
```

---

### Task 5: Eligibility + REP extraction — eligibility.js

**Files:**
- Create: `bin/azure-functions/pod-auto-send/eligibility.js`

- [ ] **Step 1: Write `eligibility.js`**

```javascript
'use strict';

// Pure functions for deciding which POD audits to send.
//
// Eligibility for trial send:
//   1. status flips to Complete in SC (ad.date_completed is set)
//   2. Both signatures are present:
//        - "Installed By (Signature)" item has a signature response
//        - "Chair accepted by (Signature)" item has a signature response
//   3. Not already in pod_send_log (handled by caller via PK conflict)
//
// REP extraction: POD has its own "REP Serial number" question that holds the
// 7-digit serial (no REP prefix). Reuses the safe lookbehind regex from
// feedback_word_boundary_regex — `\b` would mis-handle "REP2521107".

function normLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function walkItems(audit) {
  const out = [];
  const walk = (items) => {
    for (const it of items || []) {
      out.push(it);
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.header_items || []);
  walk(audit.items || []);
  return out;
}

function findItemByLabel(audit, labelCandidates) {
  const targets = labelCandidates.map(normLabel);
  for (const it of walkItems(audit)) {
    const got = normLabel(it.label);
    if (!got) continue;
    if (targets.includes(got)) return it;
    for (const t of targets) {
      if ((got.startsWith(t) || t.startsWith(got)) && Math.abs(got.length - t.length) <= 2) return it;
    }
  }
  return null;
}

// True when a SC item of type "Signature" has a captured signature.
// Signature responses commonly look like:
//   { responses: { image: { media_id: "...", href: "..." } } }
// or { responses: { signature: { ... } } }. Be liberal — non-empty media
// object is good enough for trial mode.
function hasSignature(item) {
  if (!item) return false;
  const r = item.responses || {};
  if (r.image && (r.image.media_id || r.image.href)) return true;
  if (r.signature && (r.signature.media_id || r.signature.href)) return true;
  // Some signature questions also expose `media` at the item level
  if (Array.isArray(item.media) && item.media.length) return true;
  return false;
}

function isAuditEligible(audit) {
  const ad = audit.audit_data || {};
  if (audit.archived) return { eligible: false, reason: 'archived' };
  if (!ad.date_completed) return { eligible: false, reason: 'not complete' };

  const installed = findItemByLabel(audit, [
    'Installed By Signature', 'Installed By', 'Installed By:',
  ]);
  const accepted = findItemByLabel(audit, [
    'Chair accepted by Signature', 'Chair accepted by', 'Customer signature',
  ]);
  if (!hasSignature(installed)) return { eligible: false, reason: 'no installer signature' };
  if (!hasSignature(accepted))  return { eligible: false, reason: 'no customer signature' };
  return { eligible: true };
}

// Extract the 7-digit REP serial from the POD. Order:
//   1. Item labelled "REP Serial number" (or close variants)
//   2. ad.document_no
//   3. ad.name / audit_title
// Use lookbehind/lookahead to avoid matching jammed-prefix variants like
// "REP2621118" splitting wrong — we want the 7 digits regardless.
function extractRepSerial(audit) {
  const candidates = [];

  const item = findItemByLabel(audit, [
    'REP Serial number', 'Rep Serial number', 'REP Serial', 'Rep Serial', 'Serial number',
  ]);
  if (item?.responses) {
    const r = item.responses;
    if (typeof r.text === 'string') candidates.push(r.text);
    if (r.value != null) candidates.push(String(r.value));
  }

  const ad = audit.audit_data || {};
  if (ad.document_no) candidates.push(String(ad.document_no));
  if (ad.name) candidates.push(String(ad.name));
  if (ad.audit_title) candidates.push(String(ad.audit_title));

  for (const raw of candidates) {
    const m = String(raw).match(/(?<!\d)(\d{7})(?!\d)/);
    if (m) return `REP ${m[1]}`;
  }
  return null;
}

module.exports = {
  isAuditEligible,
  extractRepSerial,
  // exported for direct testing
  findItemByLabel,
  hasSignature,
};
```

- [ ] **Step 2: Commit** — no automated tests yet; helpers will be exercised end-to-end by the dry-run script in Task 8.

```bash
git add bin/azure-functions/pod-auto-send/eligibility.js
git commit -m "feat(pod-auto-send): POD eligibility + REP serial extraction"
```

---

### Task 6: Graph client — graph.js (mail send with PDF attachment)

**Files:**
- Create: `bin/azure-functions/pod-auto-send/graph.js`

- [ ] **Step 1: Write `graph.js`**

```javascript
'use strict';

// Microsoft Graph client for pod-auto-send. Mirrors the MSAL +
// /users/{SEND_FROM}/sendMail pattern from azure-functions/daily-report
// (which is already in production — Mail.Send admin consent is granted).

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

let _msal = null;
let _token = null;
let _tokenExpiry = 0;

function getMsalApp() {
  if (_msal) return _msal;
  _msal = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET,
    },
  });
  return _msal;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  _token = result.accessToken;
  _tokenExpiry = result.expiresOn?.getTime() || (Date.now() + 3600000);
  return _token;
}

// Send a mail with a single PDF attachment. Returns the Graph message id when
// available (Graph's POST /sendMail returns 202 with no body, so message_id
// will usually be null — we log "sent" anyway).
async function sendMailWithPdf({ to, cc = [], subject, bodyText, pdfBuffer, pdfFilename }) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`;

  const message = {
    subject,
    body: { contentType: 'Text', content: bodyText },
    toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } })),
    ccRecipients: cc.map(addr => ({ emailAddress: { address: addr } })),
    attachments: [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: pdfFilename,
      contentType: 'application/pdf',
      contentBytes: pdfBuffer.toString('base64'),
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  // 202 Accepted, no body
  return null;
}

module.exports = { getToken, sendMailWithPdf };
```

- [ ] **Step 2: Commit**

```bash
git add bin/azure-functions/pod-auto-send/graph.js
git commit -m "feat(pod-auto-send): Graph mail client with PDF attachment"
```

---

### Task 7: Main timer entry point — index.js

**Files:**
- Create: `bin/azure-functions/pod-auto-send/index.js`

- [ ] **Step 1: Write `index.js`**

```javascript
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// pod-auto-send (Phase 1 — trial mode)
//
// Timer every 15 min. For each POD template in
// SAFETYCULTURE_POD_TEMPLATE_IDS (comma-sep):
//   1. Read watermark from pod_send_sync_state
//   2. Cursor-page /audits/search since watermark
//   3. For each new audit:
//        a. fetch full audit, check eligibility (complete + both signatures)
//        b. claim audit_id by inserting a 'skipped' placeholder in pod_send_log
//           (PK conflict = already handled; safe across parallel runs)
//        c. fetch PDF from SC's async export endpoint
//        d. send via Graph to POD_TRIAL_RECIPIENT (Phase 2 will resolve to customer)
//        e. update pod_send_log row to 'sent' (or 'failed' + error)
//   4. Advance watermark
//
// Required env vars:
//   SAFETYCULTURE_API_TOKEN         — Bearer token
//   SAFETYCULTURE_POD_TEMPLATE_IDS  — comma-sep template IDs (Office / Home variants)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM   (Graph mail, shared mailbox)
//   POD_SEND_MODE                   — TRIAL (only value supported in Phase 1)
//   POD_TRIAL_RECIPIENT             — Jonas's email
// Optional:
//   POD_DRY_RUN                     — '1' to log decisions but skip mail + log writes
// ─────────────────────────────────────────────────────────────────────────

const sc          = require('./sc');
const graph       = require('./graph');
const supa        = require('./supa');
const eligibility = require('./eligibility');

const EPOCH = '1970-01-01T00:00:00.000Z';

function requireEnv(names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

function parseTemplateIds() {
  return (process.env.SAFETYCULTURE_POD_TEMPLATE_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function readWatermark(templateId) {
  const row = await supa.supaSelectOne(
    'pod_send_sync_state',
    `template_id=eq.${encodeURIComponent(templateId)}`
  );
  return row?.last_modified_after || EPOCH;
}

async function writeWatermark(templateId, watermark, summary) {
  await supa.supaUpsert('pod_send_sync_state', [{
    template_id: templateId,
    last_modified_after: watermark,
    last_run_at: new Date().toISOString(),
    last_run_eligible: summary.eligible || 0,
    last_run_sent: summary.sent || 0,
    last_run_failed: summary.failed || 0,
    last_run_error: summary.error || null,
  }], 'template_id');
}

// Insert a placeholder row to atomically claim this audit_id. Returns true if
// we claimed it (caller proceeds), false if another run already has the row.
async function claimAuditForSend({ auditId, templateId, repNumber, completedAt, sendTo, sendMode }) {
  const claimed = await supa.supaInsertIgnoreConflict('pod_send_log', {
    audit_id: auditId,
    template_id: templateId,
    rep_number: repNumber,
    inspection_completed_at: completedAt,
    sent_to: sendTo,
    send_mode: sendMode,
    status: 'skipped',
    // sent_at gets a default of now() — we'll PATCH it on success
  });
  return claimed != null;
}

async function markSent({ auditId, graphMessageId }) {
  await supa.supaUpdate(
    'pod_send_log',
    `audit_id=eq.${encodeURIComponent(auditId)}`,
    { status: 'sent', graph_message_id: graphMessageId, sent_at: new Date().toISOString() }
  );
}

async function markFailed({ auditId, errorMessage }) {
  await supa.supaUpdate(
    'pod_send_log',
    `audit_id=eq.${encodeURIComponent(auditId)}`,
    { status: 'failed', error_message: errorMessage }
  );
}

function buildSubject({ repNumber, orderNo }) {
  const tail = [orderNo, repNumber].filter(Boolean).join(' · ');
  return `Repose POD — ${tail || 'Delivery confirmation'}`;
}

function buildBody({ repNumber, orderNo, trialNote }) {
  const lines = [
    'Hello,',
    '',
    'Please find your delivery confirmation (Proof of Delivery) attached.',
    '',
    repNumber ? `REP serial: ${repNumber}` : null,
    orderNo   ? `Order number: ${orderNo}`  : null,
    '',
    'Kind regards,',
    'Repose Furniture',
  ].filter(l => l !== null);
  if (trialNote) lines.push('', `---`, `[TRIAL — original customer would have been: ${trialNote}]`);
  return lines.join('\n');
}

async function processAudit({ auditId, templateId, context }) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);
  const SEND_MODE = process.env.POD_SEND_MODE || 'TRIAL';
  const TRIAL_TO  = process.env.POD_TRIAL_RECIPIENT;
  const DRY_RUN   = process.env.POD_DRY_RUN === '1';

  const audit = await sc.getAudit(auditId);
  const elig = eligibility.isAuditEligible(audit);
  if (!elig.eligible) {
    log(`skip ${auditId}: ${elig.reason}`);
    return { sent: false, skipped: true };
  }

  const repNumber = eligibility.extractRepSerial(audit);
  const completedAt = audit.audit_data?.date_completed || null;
  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number', 'Customer order']);
  const orderNo = orderItem?.responses?.text || null;

  if (DRY_RUN) {
    log(`DRY_RUN ${auditId} would send: rep=${repNumber} order=${orderNo} to=${TRIAL_TO}`);
    return { sent: false, dryRun: true };
  }

  // Atomically claim the audit before doing expensive work.
  const claimed = await claimAuditForSend({
    auditId,
    templateId,
    repNumber,
    completedAt,
    sendTo: TRIAL_TO,
    sendMode: SEND_MODE,
  });
  if (!claimed) {
    log(`already processed ${auditId} — skipping`);
    return { sent: false, alreadyDone: true };
  }

  try {
    const pdfBuffer = await sc.fetchPodPdf(auditId, log);
    const filename = `Repose-POD-${(repNumber || auditId).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    await graph.sendMailWithPdf({
      to: TRIAL_TO,
      subject: buildSubject({ repNumber, orderNo }),
      bodyText: buildBody({ repNumber, orderNo, trialNote: '(real customer lookup not enabled yet)' }),
      pdfBuffer,
      pdfFilename: filename,
    });
    await markSent({ auditId, graphMessageId: null });
    log(`sent ${auditId} rep=${repNumber} order=${orderNo}`);
    return { sent: true };
  } catch (e) {
    warn(`failed ${auditId}: ${e.message}`);
    await markFailed({ auditId, errorMessage: e.message.slice(0, 500) });
    return { sent: false, failed: true };
  }
}

module.exports = async function (context, myTimer) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);

  try {
    requireEnv([
      'SAFETYCULTURE_API_TOKEN',
      'SAFETYCULTURE_POD_TEMPLATE_IDS',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
      'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM',
      'POD_TRIAL_RECIPIENT',
    ]);
  } catch (e) {
    context.log.error(`[pod-auto-send] ${e.message}`);
    return;
  }

  const templateIds = parseTemplateIds();
  log(`start · templates=${templateIds.length} · mode=${process.env.POD_SEND_MODE || 'TRIAL'}`);

  for (const templateId of templateIds) {
    let summary = { eligible: 0, sent: 0, failed: 0, error: null };
    let newWatermark;
    try {
      const watermark = await readWatermark(templateId);
      log(`template ${templateId} watermark=${watermark}`);
      const { auditIds, newestModifiedAt } = await sc.searchAuditsByTemplate(templateId, watermark, context.log);
      newWatermark = newestModifiedAt;
      log(`template ${templateId} found ${auditIds.length} new audit(s)`);
      for (const auditId of auditIds) {
        const r = await processAudit({ auditId, templateId, context });
        if (r.sent) summary.sent++;
        if (r.failed) summary.failed++;
        if (!r.skipped && !r.alreadyDone && !r.dryRun) summary.eligible++;
      }
    } catch (e) {
      warn(`template ${templateId} run aborted: ${e.message}`);
      summary.error = e.message.slice(0, 500);
    } finally {
      if (newWatermark) await writeWatermark(templateId, newWatermark, summary);
      log(`template ${templateId} summary sent=${summary.sent} failed=${summary.failed}`);
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add bin/azure-functions/pod-auto-send/index.js
git commit -m "feat(pod-auto-send): main timer handler — trial mode"
```

---

### Task 8: Local dry-run script — dry-run.js

**Files:**
- Create: `bin/azure-functions/pod-auto-send/dry-run.js`

Goal: run the full pipeline against one specific audit ID without touching Supabase or Graph. Writes the SC-exported PDF to the current directory so you can eyeball it.

- [ ] **Step 1: Write `dry-run.js`**

```javascript
'use strict';

// Usage:
//   cd bin/azure-functions
//   $env:SAFETYCULTURE_API_TOKEN = "<token>"
//   node pod-auto-send/dry-run.js <audit_id>
//
// Writes ./pod-<audit_id>.pdf and prints the eligibility verdict + extracted
// REP / order number. Does NOT call Graph or Supabase.

const fs = require('fs');
const path = require('path');
const sc = require('./sc');
const eligibility = require('./eligibility');

(async () => {
  const auditId = process.argv[2];
  if (!auditId) {
    console.error('Usage: node dry-run.js <audit_id>');
    process.exit(1);
  }
  if (!process.env.SAFETYCULTURE_API_TOKEN) {
    console.error('SAFETYCULTURE_API_TOKEN required');
    process.exit(1);
  }

  console.log(`Fetching audit ${auditId}...`);
  const audit = await sc.getAudit(auditId);

  const elig = eligibility.isAuditEligible(audit);
  console.log('Eligibility:', elig);

  const rep = eligibility.extractRepSerial(audit);
  console.log('REP serial:', rep);

  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number']);
  console.log('Customer order number:', orderItem?.responses?.text || null);

  console.log('Requesting PDF export...');
  const pdf = await sc.fetchPodPdf(auditId, (...a) => console.log(...a));
  const out = path.resolve(`pod-${auditId}.pdf`);
  fs.writeFileSync(out, pdf);
  console.log(`PDF written to ${out} (${pdf.length} bytes)`);
})().catch(e => {
  console.error('dry-run failed:', e.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against a real completed POD audit**

Pick a known-complete POD audit from SC (open one in the SC web UI — the URL has the audit_id). Run:

```powershell
cd C:\Users\jonas.simonaitis\.local\bin\azure-functions
$env:SAFETYCULTURE_API_TOKEN = "<token>"
node pod-auto-send\dry-run.js audit_<known_id>
```

Expected:
- `Eligibility: { eligible: true }` for a complete signed POD
- `REP serial: REP 2621118` (or matching the audit)
- `PDF written to ...pod-audit_<id>.pdf (NNNNNN bytes)`

Open the PDF — confirm it matches what you'd manually download from SC.

- [ ] **Step 3: Commit**

```bash
git add bin/azure-functions/pod-auto-send/dry-run.js
git commit -m "feat(pod-auto-send): local dry-run script for one audit"
```

---

### Task 9: Deploy + smoke test

Prerequisites: Tasks 1-8 committed and pushed. The Function App build pipeline (existing GH Actions or VS Code Azure Functions deploy) picks up the new function directory automatically — no separate registration step.

- [ ] **Step 1: Add app settings on the RepNet Function App**

In Azure Portal → RepNet Function App → Configuration → Application settings, add:

| Name | Value |
| --- | --- |
| `SAFETYCULTURE_POD_TEMPLATE_IDS` | template IDs from Task 1 (comma-sep if multiple) |
| `POD_SEND_MODE` | `TRIAL` |
| `POD_TRIAL_RECIPIENT` | `jonas.simonaitis@reposefurniture.co.uk` |

`SAFETYCULTURE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SEND_FROM` should already exist from sc-sync + daily-report.

Save the configuration (the Function App restarts).

- [ ] **Step 2: Trigger the function manually**

Portal → Function App → Functions → `pod-auto-send` → Code + Test → Test/Run → Run. Watch the Invocation logs.

Expected logs:
- `[pod-auto-send] start · templates=N · mode=TRIAL`
- For each template: `watermark=...`, `found X new audit(s)`, and either `sent <id> rep=...` or `skip <id>: <reason>`

- [ ] **Step 3: Confirm an email landed in your inbox**

Subject: `Repose POD — <order> · REP NNNNNNN`. Body has the trial note. Attachment opens as the same PDF the dry-run script produced.

- [ ] **Step 4: Confirm idempotency**

Trigger the function again. Expected: every audit logs `already processed` and zero new emails are sent. Verify in Supabase:

```sql
select audit_id, status, rep_number, sent_at from pod_send_log order by sent_at desc limit 10;
select * from pod_send_sync_state;
```

- [ ] **Step 5: Stuck-worker check** — if a deploy lands and nothing happens at the next tick, hit `/admin/host/status` on the Function App. If a worker is wedged, run `az functionapp restart -g <rg> -n <fnapp>` (see `feedback_function_app_stuck_worker.md`).

---

### Task 10: Runbook — POD_AUTO_SEND.md

**Files:**
- Create: `bin/POD_AUTO_SEND.md`

- [ ] **Step 1: Write the runbook**

```markdown
# POD auto-send

Watches SafetyCulture for completed "White Glove Check List" inspections (PODs)
and emails the SC-exported PDF to a configured recipient. Phase 1 is **trial
mode** — sends to a single trial recipient. Phase 2 (separate plan) will route
to the actual customer.

## Pieces

| Piece | Path |
| --- | --- |
| Supabase migration | `repnet/supabase/migrations/0038_pod_auto_send.sql` |
| Azure Function | `bin/azure-functions/pod-auto-send/` |
| Template-ID helper | `bin/azure-functions/pod-auto-send/find-pod-template.js` |
| Local dry-run | `bin/azure-functions/pod-auto-send/dry-run.js` |

## Setup

1. Apply migration 0038.
2. Find the POD template IDs:
   ```powershell
   $env:SAFETYCULTURE_API_TOKEN = "<token>"
   node pod-auto-send\find-pod-template.js "white glove"
   ```
3. Add Function App settings (Configuration → Application settings):
   | Setting | Value |
   | --- | --- |
   | `SAFETYCULTURE_POD_TEMPLATE_IDS` | comma-sep template IDs |
   | `POD_SEND_MODE` | `TRIAL` |
   | `POD_TRIAL_RECIPIENT` | trial inbox |

   The SC token, Supabase keys, and Graph credentials are shared with the
   other functions.
4. Deploy. The 15-min timer fires on its own; or trigger manually from the
   portal.

## Eligibility

An audit is sent when:
- `audit_data.date_completed` is set
- The "Installed By" signature item has a captured signature
- The "Chair accepted by" signature item has a captured signature
- The `audit_id` is not yet in `pod_send_log`

REP serial is extracted from the "REP Serial number" question (falling back to
`document_no` / audit title) using `(?<!\d)(\d{7})(?!\d)` to avoid the
word-boundary trap on jammed prefixes (see
`feedback_word_boundary_regex.md`).

## Idempotency

`pod_send_log.audit_id` is the primary key. Before doing PDF export + mail
send, the function inserts a `status='skipped'` placeholder with
`Prefer: resolution=ignore-duplicates`. Duplicate insert returns null → the
function knows another run already has this audit and skips. On successful
send the row is patched to `status='sent'` (or `'failed'` with `error_message`).

## Switching to LIVE mode

Phase 2. Do not set `POD_SEND_MODE=LIVE` until the customer-lookup work (next
plan) lands, otherwise the function will refuse to start.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Missing required env vars: ...` | App settings not saved or App not restarted | Save and restart the Function App |
| `SC POST 400 on /audits/.../report` | Bad template ID or audit ID expired | Re-check template; confirm audit is not archived |
| `Graph sendMail 403` | Mail.Send admin consent revoked / SEND_FROM not mailbox-enabled | Re-grant Mail.Send in Entra; confirm SEND_FROM has a mailbox |
| `Supabase upsert 401` | Service role key rotated | Refresh `SUPABASE_SERVICE_ROLE_KEY` in app settings |
| Nothing happens after deploy | Stuck Node worker | `/admin/host/status`, then `az functionapp restart` |
```

- [ ] **Step 2: Commit**

```bash
git add bin/POD_AUTO_SEND.md
git commit -m "docs(pod-auto-send): runbook for trial mode"
```

---

## Phase 2 — Live customer send (separate plan, NOT in this build)

Sketch only — do not start until Phase 1 is running cleanly for at least one POD cycle. A new plan file will be written when we're ready, covering:

1. **Migration 0039:** `customers` table (`name_normalised`, `postcode_normalised`, `email`, `hold`, `notes`, unique index on `(name_normalised, postcode_normalised)`).
2. **Bulk import:** one-off CLI that accepts a CSV from Jonas and seeds `customers`.
3. **Production plan reader:** extract the existing Excel-via-Graph code from `daily-report/index.js` into `shared/prod-plan.js`, expose `getCustomerByRep(rep) → { name, postcode } | null`.
4. **Customer resolver:** chain `production plan → customers table → email`. Normalisation: strip titles ("MR"/"MRS"), uppercase, collapse whitespace; postcode strip spaces + uppercase.
5. **LIVE switch:** `POD_SEND_MODE=LIVE` + recipient = resolved email; trial recipient becomes BCC. Hold flag (`customers.hold` OR a row in a new `pod_holds` table keyed by REP) suppresses the send.
6. **Daily digest:** new function `pod-send-digest` runs once daily, queries `pod_send_log` + a "completed PODs not yet in pod_send_log" join (i.e. lookups that failed), emails Jonas the summary.
7. **RepNet admin UI:** `/customers` page (senior-manager-only) for editing the directory plus a "POD send log" tab so non-engineers can see sends and re-trigger.

---

## Self-review

**Spec coverage:**
- Detect completed POD → Task 4 (cursor search) + Task 5 (eligibility incl. signatures).
- Fetch PDF from SC → Task 4 (`fetchPodPdf` with async export poll).
- Send via Graph with attachment → Task 6.
- Trial to Jonas → Task 7 (`POD_TRIAL_RECIPIENT` env var).
- Idempotency → Task 2 unique PK + Task 7 `claimAuditForSend`.
- Audit trail → `pod_send_log` (Task 2) + write paths in Task 7.
- Customer lookup → explicitly Phase 2.

**Placeholder scan:** No "TBD", "add appropriate error handling", or "similar to Task N". The one remaining uncertainty — exact SC PDF-export response shape — is called out as a verification step inside Task 4 Step 2 rather than left vague.

**Type consistency:** `claimAuditForSend`, `markSent`, `markFailed`, `processAudit` all use `auditId` as the parameter name. `pdfBuffer` / `pdfFilename` are consistent between `sendMailWithPdf` (Task 6) and the caller in `processAudit` (Task 7). `findItemByLabel` is exported from `eligibility.js` (Task 5) and used by `dry-run.js` (Task 8) and `index.js` (Task 7).
