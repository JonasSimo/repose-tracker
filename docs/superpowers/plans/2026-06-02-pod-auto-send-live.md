# POD Auto-Send Phase 2 (LIVE routing) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute task-by-task.

**Goal:** Move from trial-mode (all sends to Jonas) to LIVE routing: detect each POD's customer via production plan column D, send to Charterhouse / Grosvenor when matched, skip otherwise. Ready for Friday 2026-06-05 launch.

**Architecture:** Add a small production-plan reader module that builds a `REP → ClientName` map from the Excel workbook. In `processAudit`, after eligibility passes, look up ALL extracted REPs against the map, decide:
- All matched REPs are Charterhouse → send to Charterhouse email
- All matched REPs are Grosvenor → send to Grosvenor email
- Mixed or unmatched → skip (log reason)

In TRIAL mode all sends still go to Jonas, but the body shows which customer email WOULD have been used in LIVE — gives a shadow-validation pass.

**Tech Stack:** Same as Phase 1 (Node Azure Functions, MSAL Graph, Supabase REST, SafetyCulture).

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `bin/azure-functions/pod-auto-send/eligibility.js` | Modify | Add `extractAllRepSerials(audit) → string[]` |
| `bin/azure-functions/pod-auto-send/prod-plan.js` | Create | `loadRepClientMap()` returns `Map<rep7digits, clientName>` via Graph |
| `bin/azure-functions/pod-auto-send/routing.js` | Create | `resolveTradeCustomer(clients) → { customer, email } \| null` |
| `bin/azure-functions/pod-auto-send/index.js` | Modify | Lazy-build plan map per template-tick; pass clients into processAudit; LIVE routing |
| `bin/azure-functions/pod-auto-send/test-routing.js` | Modify | Use the new modules instead of inline copies |
| `bin/POD_AUTO_SEND.md` | Modify | Document LIVE mode, env vars, customer mapping |

---

## Task 1 — `extractAllRepSerials`

**Files:**
- Modify: `bin/azure-functions/pod-auto-send/eligibility.js`

Replace `extractRepSerial` body so it returns an array, then add a back-compat `extractRepSerial` that returns the first element of the array.

```javascript
function extractAllRepSerials(audit) {
  const seen = new Set();
  const walk = (items) => {
    for (const it of items || []) {
      const r = it.responses || {};
      const text = [
        r.text, r.value,
        (r.selected || []).map(s => s.label || s.value).join(' '),
        it.label,
      ].filter(Boolean).join(' ');
      for (const m of text.matchAll(/(?<!\d)(\d{7})(?!\d)/g)) seen.add(m[1]);
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.header_items);
  walk(audit.items);
  const ad = audit.audit_data || {};
  for (const k of ['document_no', 'name', 'audit_title']) {
    for (const m of String(ad[k] || '').matchAll(/(?<!\d)(\d{7})(?!\d)/g)) seen.add(m[1]);
  }
  return [...seen].map(d => `REP ${d}`);
}

function extractRepSerial(audit) {
  return extractAllRepSerials(audit)[0] || null;
}
```

Add `extractAllRepSerials` to `module.exports`. Commit.

## Task 2 — `prod-plan.js`

**Files:**
- Create: `bin/azure-functions/pod-auto-send/prod-plan.js`

Lifts the production-plan reading code already proven in `test-routing.js` and `daily-report/index.js`.

```javascript
'use strict';

// Reads the Repose production plan workbook on SharePoint and returns a
// Map<repDigits, clientName> sourced from column L (REP NNNNNNN) and
// column D (Client Name).
//
// One workbook fetch builds a 10k+ row map; ~30s per call. Caller should
// build per timer tick (not per audit) — see index.js.

const fetch = require('node-fetch');
const { ConfidentialClientApplication } = require('@azure/msal-node');

const PROD_SHARING_URL = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBLf67iYnbQSq2O8UU_zQihARfBedzZcW-CmO0q3v5zC3o?e=nfze02';

let _msal = null;
function getMsalApp() {
  if (_msal) return _msal;
  _msal = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
      clientSecret: process.env.CLIENT_SECRET,
    },
  });
  return _msal;
}

function encodeSharingUrl(link) {
  return 'u!' + Buffer.from(link).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function loadRepClientMap(log) {
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  const token = result.accessToken;
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const item = await (await fetch(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`,
    { headers: auth }
  )).json();
  const driveId = item.parentReference.driveId;
  const itemId = item.id;

  const sheets = await (await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
    { headers: auth }
  )).json();
  const wkSheets = (sheets.value || []).filter(s => /^WK\s*\d+/.test(s.name));

  const repMap = new Map();
  for (const s of wkSheets) {
    let r;
    try {
      r = await (await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(s.name)}')/usedRange?$select=values`,
        { headers: auth }
      )).json();
    } catch (e) {
      log?.warn?.(`[pod-auto-send] failed to read sheet ${s.name}: ${e.message}`);
      continue;
    }
    for (const row of r.values || []) {
      const client = String(row[3] || '').trim();   // column D
      const m = String(row[11] || '').match(/(?<!\d)(\d{7})(?!\d)/); // column L
      if (m && !repMap.has(m[1])) repMap.set(m[1], client);
    }
  }
  log?.(`[pod-auto-send] production plan loaded: ${repMap.size} REP entries across ${wkSheets.length} sheets`);
  return repMap;
}

module.exports = { loadRepClientMap };
```

Commit.

## Task 3 — `routing.js`

**Files:**
- Create: `bin/azure-functions/pod-auto-send/routing.js`

```javascript
'use strict';

// Decides which (if any) trade customer a POD belongs to, based on the
// client names looked up from the production plan for its REPs.
//
// Phase 1 LIVE scope is exactly two trade customers — Charterhouse and
// Grosvenor. All other plan-client values mean "don't auto-send"
// (residential / OSKA / BRISTOL MAID / etc — manual workflow continues).

function getCustomerMap() {
  return {
    CHARTERHOUSE: {
      label: 'Charterhouse Mobility',
      email: process.env.POD_CUSTOMER_CHARTERHOUSE_EMAIL || '',
    },
    GROSVENOR: {
      label: 'Grosvenor Mobility',
      email: process.env.POD_CUSTOMER_GROSVENOR_EMAIL || '',
    },
  };
}

function matchTradeCustomer(clientName) {
  const u = String(clientName || '').toUpperCase();
  if (u.includes('CHARTERHOUSE')) return 'CHARTERHOUSE';
  if (u.includes('GROSVENOR'))    return 'GROSVENOR';
  return null;
}

// Given an array of client-name strings looked up from the plan, returns
//   { customer: 'CHARTERHOUSE'|'GROSVENOR', label, email } when ALL matched
//     plan-clients resolve to the same trade customer.
//   null when no plan-client is a trade customer, or the POD spans
//     multiple different trade customers (which would be ambiguous).
function resolveTradeCustomer(clientNames) {
  const matched = clientNames.map(matchTradeCustomer).filter(Boolean);
  if (matched.length === 0) return null;
  const unique = [...new Set(matched)];
  if (unique.length > 1) return null;   // mixed Charterhouse + Grosvenor — ambiguous, skip
  const customer = unique[0];
  const map = getCustomerMap();
  return { customer, label: map[customer].label, email: map[customer].email };
}

module.exports = { resolveTradeCustomer, matchTradeCustomer, getCustomerMap };
```

Commit.

## Task 4 — wire routing into `index.js`

**Files:**
- Modify: `bin/azure-functions/pod-auto-send/index.js`

Changes:

1. Require `prod-plan.js` and `routing.js`.
2. In the main timer handler, **after** `searchAuditsByTemplate` returns non-empty `auditIds`, build the plan map once via `loadRepClientMap(context.log)`. Pass that map into each `processAudit` call.
3. Update `processAudit` signature: add `planMap` param. After eligibility passes, extract all REPs, look up each one in `planMap`, collect the matched client names.
4. Add routing decision:
   - `trade = resolveTradeCustomer(clientNames)`
   - If `trade == null` → skip with reason `'not a trade customer'` (LIVE mode) or proceed with note "(no trade match)" (TRIAL mode).
   - If `trade != null` → recipient is `trade.email` in LIVE, `POD_TRIAL_RECIPIENT` in TRIAL (with body indicating the LIVE recipient).
5. Update `claimAuditForSend` arg: include the resolved customer label in `sent_to` (in TRIAL, this is the trial recipient; in LIVE it's the trade customer's email).
6. Update body builder to include "Detected customer: {label}" and "Plan REPs: {clients}".
7. Validate `POD_SEND_MODE` against `['TRIAL', 'LIVE']`. Refuse to start on unknown values.
8. Add `POD_CUSTOMER_CHARTERHOUSE_EMAIL` and `POD_CUSTOMER_GROSVENOR_EMAIL` to required env vars when `POD_SEND_MODE === 'LIVE'`.

Sketch of the new processAudit body (focus on the routing part):

```javascript
async function processAudit({ auditId, templateId, planMap, context, forceSend = false }) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);
  const SEND_MODE = process.env.POD_SEND_MODE || 'TRIAL';
  const TRIAL_TO  = process.env.POD_TRIAL_RECIPIENT;
  const DRY_RUN   = process.env.POD_DRY_RUN === '1';

  const audit = await sc.getAudit(auditId);
  const elig = eligibility.isAuditEligible(audit);
  if (!elig.eligible && !forceSend) {
    log(`skip ${auditId}: ${elig.reason}`);
    return { sent: false, skipped: true, reason: elig.reason };
  }
  if (!elig.eligible && forceSend) {
    warn(`audit ${auditId} not eligible (${elig.reason}); processing anyway (forceSend=true)`);
  }

  const reps = eligibility.extractAllRepSerials(audit);                // array
  const clients = reps.map(r => planMap.get(r.replace(/\D/g, ''))).filter(Boolean);
  const trade = routing.resolveTradeCustomer(clients);

  if (SEND_MODE === 'LIVE' && !trade) {
    log(`skip ${auditId}: not a trade customer (clients=${clients.join(' / ') || 'none'})`);
    return { sent: false, skipped: true, reason: 'not a trade customer' };
  }

  const recipient = (SEND_MODE === 'LIVE') ? trade.email : TRIAL_TO;
  const completedAt = audit.audit_data?.date_completed || null;
  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number', 'Customer order']);
  const orderNo = orderItem?.responses?.text || null;

  if (DRY_RUN) {
    log(`DRY_RUN ${auditId}: reps=${reps.join(',')} clients=${clients.join('/')} trade=${trade?.customer || '-'} → would send to ${recipient}`);
    return { sent: false, dryRun: true };
  }

  const claimed = await claimAuditForSend({
    auditId, templateId,
    repNumber: reps[0] || null,
    completedAt,
    sendTo: recipient,
    sendMode: SEND_MODE,
  });
  if (!claimed) { log(`already processed ${auditId}`); return { sent: false, alreadyDone: true }; }

  try {
    const pdfBuffer = await sc.fetchPodPdf(auditId, log);
    const filename = `Repose-POD-${(reps[0] || auditId).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    await graph.sendMailWithPdf({
      to: recipient,
      subject: buildSubject({ reps, orderNo, trade }),
      bodyText: buildBody({ reps, orderNo, trade, sendMode: SEND_MODE, recipient, clients }),
      pdfBuffer, pdfFilename: filename,
    });
    await markSent({ auditId, graphMessageId: null });
    log(`sent ${auditId} reps=${reps.join(',')} trade=${trade?.customer || '-'} → ${recipient}`);
    return { sent: true };
  } catch (e) {
    warn(`failed ${auditId}: ${e.message}`);
    await markFailed({ auditId, errorMessage: e.message.slice(0, 500) });
    return { sent: false, failed: true };
  }
}
```

And in the main module-export timer handler:

```javascript
// existing env validation extended:
const baseEnv = [
  'SAFETYCULTURE_API_TOKEN', 'SAFETYCULTURE_POD_TEMPLATE_IDS',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM',
];
const mode = process.env.POD_SEND_MODE || 'TRIAL';
if (!['TRIAL','LIVE'].includes(mode)) throw new Error(`Invalid POD_SEND_MODE=${mode}`);
const liveEnv = (mode === 'LIVE')
  ? ['POD_CUSTOMER_CHARTERHOUSE_EMAIL', 'POD_CUSTOMER_GROSVENOR_EMAIL']
  : ['POD_TRIAL_RECIPIENT'];
requireEnv([...baseEnv, ...liveEnv]);
```

Build the plan map once per timer tick, only if at least one template has new audits:

```javascript
let planMap = null;
async function getPlanMap() {
  if (!planMap) planMap = await prodPlan.loadRepClientMap(context.log);
  return planMap;
}

for (const templateId of templateIds) {
  // ... existing read watermark + search ...
  if (auditIds.length > 0) await getPlanMap();
  for (const auditId of auditIds) {
    try {
      const r = await processAudit({ auditId, templateId, planMap, context });
      // ...
    } catch (e) { /* existing handling */ }
  }
}
```

Commit.

## Task 5 — `test-routing.js` cleanup

**Files:**
- Modify: `bin/azure-functions/pod-auto-send/test-routing.js`

Replace the inline `buildPlanRepMap` and `extractAllRepSerials` and the inline matching with the new shared modules. Keep the rest of the script (CLI args, archived search, [TEST] subject, no-state-write) identical.

This is purely a refactor — the script's behaviour must not change. After the change, run it once for Grosvenor and once for Charterhouse to verify it still works.

Commit.

## Task 6 — runbook update

**Files:**
- Modify: `bin/POD_AUTO_SEND.md`

Add/update sections:

- **Modes:** TRIAL = all sends to POD_TRIAL_RECIPIENT, body indicates resolved trade customer. LIVE = sends to trade-customer email, skips non-trade.
- **Required env vars in LIVE mode:** `POD_CUSTOMER_CHARTERHOUSE_EMAIL=operations@charterhousemobility.com`, `POD_CUSTOMER_GROSVENOR_EMAIL=delivery.photos@grosvenormobility.com`.
- **Customer detection:** production plan column D = Client Name, column L = REP serial. Match is case-insensitive substring on the words "CHARTERHOUSE" or "GROSVENOR". Multi-REP PODs require ALL matched plan-clients to resolve to the same trade customer (mixed → skip).
- **Common failures additions:**
  - "skipped: not a trade customer" — POD's REP(s) didn't resolve to Charterhouse/Grosvenor; expected for residential deliveries.
  - "production plan failed" — Graph 401/403 on the workbook; check service principal still has Files.Read.All consent.

Commit.

## Task 7 — Function App settings + deploy

Manual (Jonas). Before flipping to LIVE:

1. Add new app settings:
   - `POD_CUSTOMER_CHARTERHOUSE_EMAIL` = `operations@charterhousemobility.com`
   - `POD_CUSTOMER_GROSVENOR_EMAIL`    = `delivery.photos@grosvenormobility.com`
   - `SAFETYCULTURE_POD_TEMPLATE_IDS`  = `template_60590bb63dcd4633bcfc6586069a1bf0` (we already discovered this — White Glove Check List - Office)
   - `POD_SEND_MODE` = `TRIAL` (still — keep until Friday validation passes)
   - `POD_TRIAL_RECIPIENT` = `jonas.simonaitis@reposefurniture.co.uk`
2. Deploy (merge `pod-auto-send-trial` → `main` in bin/ repo; GitHub Actions deploys the Function App).
3. Manually trigger the function; watch logs. Expect to see "production plan loaded: 11k entries" and then per-audit routing decisions.
4. Verify emails arrive to Jonas with body showing "Detected customer: Grosvenor Mobility / would send to delivery.photos@... in LIVE mode" for any Grosvenor PODs the timer picks up.
5. Friday morning: flip `POD_SEND_MODE` to `LIVE`, restart Function App, watch the next tick.

---

## Self-review

- Multi-REP per POD: handled in extractAllRepSerials + plan-lookup-all-clients + resolveTradeCustomer-with-uniqueness-check.
- Mixed Charterhouse+Grosvenor on one POD: resolveTradeCustomer returns null (skip) rather than guessing.
- Production plan failure: bubbles up to the per-template catch block (already in place), watermark doesn't advance.
- LIVE mode safety: explicit POD_SEND_MODE check; required env vars different per mode; refuse to start if mode is unknown.
- Idempotency: unchanged — `pod_send_log.audit_id` PK + claim-before-work.
- Sending to wrong customer: guarded by (a) plan-client must contain CHARTERHOUSE or GROSVENOR exactly, (b) all matched plan-clients must be the same trade customer.
