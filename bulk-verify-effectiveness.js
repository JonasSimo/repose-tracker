'use strict';
/**
 * bulk-verify-effectiveness.js
 * ─────────────────────────────────────────────────────────────────────
 * Marks every CPAR currently at Status = 'Awaiting Effectiveness Check'
 * as verified-effective and moves it to Archived. Same PATCH the in-app
 * effVerify(true) flow uses (index.html line ~17064), wrapped in a CLI
 * with a dry-run preview + confirmation prompt + Graph $batch (20-per-
 * request) for speed across ~3000 items.
 *
 * HOW TO RUN
 *   1. Open a terminal in this repo's root.
 *   2. Install deps once:           npm install --no-save @azure/msal-node node-fetch@2
 *      (node-fetch v2 because v3 is ESM-only; the existing Azure Functions
 *      use v2 too — see azure-functions/package.json.)
 *   3. Set the same four env vars the Function App uses. From PowerShell:
 *        $env:TENANT_ID     = '<your tenant guid>'
 *        $env:CLIENT_ID     = '<RepNet AAD app client id>'
 *        $env:CLIENT_SECRET = '<RepNet AAD app client secret>'
 *        $env:VERIFIED_BY   = 'jonas.simonaitis@reposefurniture.co.uk'
 *   4. Run:                          node bulk-verify-effectiveness.js
 *   5. The script will:
 *        a. Fetch every Awaiting-Effectiveness-Check CPAR
 *        b. Print the count + 10-item preview
 *        c. Prompt 'Type YES to apply, anything else to cancel:'
 *        d. On YES: batch-PATCH in groups of 20, print progress
 *        e. Write bulk-verify-effectiveness.log.csv (timestamped) so
 *           you have an audit trail of every Title/id touched.
 *
 * SAFETY
 *   - Dry-run first. Nothing writes until you type YES.
 *   - Per-item History entry: 'bulk-effectiveness-verified' so the audit
 *     trail shows this was a sweep, not a manual sign-off per item.
 *   - Failures are logged but don't stop the run; you get a final
 *     success/failure tally and the CSV log lets you retry the failures.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Module resolution ────────────────────────────────────────────────
// Try the local node_modules first; fall back to azure-functions/node_modules
// so the script Just Works if the user installed deps there.
function tryRequire(name) {
  try { return require(name); }
  catch { try { return require(path.join(__dirname, 'azure-functions', 'node_modules', name)); } catch (e) { return null; } }
}
const msal  = tryRequire('@azure/msal-node');
const fetch = tryRequire('node-fetch');
if (!msal || !fetch) {
  console.error('Missing deps. Run:');
  console.error('  npm install --no-save @azure/msal-node node-fetch@2');
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const VERIFIED_BY   = process.env.VERIFIED_BY || 'jonas.simonaitis@reposefurniture.co.uk';

const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const SP_SITE_PATH  = '/sites/ReposeFurniture-PlanningRepose';
const SP_CPAR_LIST  = 'CPARLog';

const TARGET_STATUS = 'Awaiting Effectiveness Check';
const ARCHIVED      = 'Archived';
const BATCH_SIZE    = 20;          // Graph $batch limit
const PAUSE_BETWEEN_BATCHES_MS = 250;  // gentle on throttling

if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing env: TENANT_ID / CLIENT_ID / CLIENT_SECRET required.');
  process.exit(1);
}

// ── Graph plumbing ───────────────────────────────────────────────────
const cca = new msal.ConfidentialClientApplication({
  auth: {
    clientId:     CLIENT_ID,
    authority:    `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
  },
});
async function getToken() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}
async function graphGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`GET ${r.status}: ${await r.text()}`);
  return r.json();
}
async function graphGetAll(token, url) {
  const out = [];
  let next = url;
  while (next) {
    const j = await graphGet(token, next);
    out.push(...(j.value || []));
    next = j['@odata.nextLink'];
  }
  return out;
}
async function graphBatch(token, requests) {
  const r = await fetch('https://graph.microsoft.com/v1.0/$batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!r.ok) throw new Error(`BATCH ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.responses || [];
}

// ── History append (mirror of appendCPARHistory in index.html) ───────
function appendCPARHistory(currentHistory, event) {
  const line = JSON.stringify({ ...event, t: new Date().toISOString() });
  return currentHistory ? currentHistory + '\n' + line : line;
}

// ── Prompt helper ────────────────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
}

// ── Main ─────────────────────────────────────────────────────────────
(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Bulk effectiveness-verify sweep');
  console.log(`  Target list: ${SP_HOST}${SP_SITE_PATH} / ${SP_CPAR_LIST}`);
  console.log(`  Marking as verified-by: ${VERIFIED_BY}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('Authenticating…');
  const token = await getToken();

  console.log('Resolving site + list IDs…');
  const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`);
  const list = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${SP_CPAR_LIST}`);

  console.log(`Fetching all ${TARGET_STATUS} CPARs…`);
  const all = await graphGetAll(
    token,
    `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${list.id}/items` +
    `?$expand=fields($select=Title,Status,History,ClosedAt)&$top=999&$filter=fields/Status eq '${encodeURIComponent(TARGET_STATUS)}'`
  );
  // Defensive client-side filter — $filter can rarely return cross-state stragglers
  // on lists past the SP indexer threshold.
  const candidates = all.filter(i => i.fields && i.fields.Status === TARGET_STATUS);

  console.log('');
  console.log(`Found ${candidates.length} CPAR(s) at status "${TARGET_STATUS}".`);
  if (candidates.length === 0) {
    console.log('Nothing to do — exiting.');
    return;
  }

  // Preview (first 10)
  console.log('');
  console.log('First 10 to be archived:');
  for (const c of candidates.slice(0, 10)) {
    console.log(`  - ${(c.fields.Title || '?').padEnd(12)}  closed ${(c.fields.ClosedAt || '').slice(0, 10)}`);
  }
  if (candidates.length > 10) console.log(`  … and ${candidates.length - 10} more`);

  // Confirm
  console.log('');
  const answer = await ask(`Type YES to mark all ${candidates.length} as verified-effective + archive, anything else to cancel: `);
  if (answer.trim() !== 'YES') {
    console.log('Cancelled — no writes made.');
    return;
  }

  // Apply
  const nowIso = new Date().toISOString();
  const logRows = [['Title', 'ItemId', 'Result', 'Detail']];
  let ok = 0, fail = 0;
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const slice = candidates.slice(i, i + BATCH_SIZE);
    const requests = slice.map((c, idx) => ({
      id: String(idx + 1),
      method: 'PATCH',
      url: `/sites/${site.id}/lists/${list.id}/items/${c.id}/fields`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        Status:                  ARCHIVED,
        EffectivenessVerified:   true,
        EffectivenessVerifiedAt: nowIso,
        EffectivenessVerifiedBy: VERIFIED_BY,
        History: appendCPARHistory(c.fields && c.fields.History || '', {
          by: VERIFIED_BY, ev: 'bulk-effectiveness-verified', verified: true,
        }),
      },
    }));
    try {
      const responses = await graphBatch(token, requests);
      for (const resp of responses) {
        const idx = parseInt(resp.id, 10) - 1;
        const c = slice[idx];
        if (resp.status >= 200 && resp.status < 300) {
          ok++;
          logRows.push([c.fields.Title || '?', c.id, 'OK', '']);
        } else {
          fail++;
          const detail = (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body || {})).slice(0, 200);
          logRows.push([c.fields.Title || '?', c.id, `FAIL ${resp.status}`, detail]);
        }
      }
    } catch (e) {
      // Whole batch failed (likely auth / throttle). Log every item as failed.
      for (const c of slice) {
        fail++;
        logRows.push([c.fields.Title || '?', c.id, 'BATCH-ERROR', (e.message || '').slice(0, 200)]);
      }
    }
    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}   (ok=${ok}, fail=${fail})`);
    if (i + BATCH_SIZE < candidates.length) await new Promise(r => setTimeout(r, PAUSE_BETWEEN_BATCHES_MS));
  }
  console.log('');

  // Write audit CSV
  const stamp = nowIso.replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(__dirname, `bulk-verify-effectiveness.${stamp}.log.csv`);
  fs.writeFileSync(logPath, logRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Done.  ${ok} archived,  ${fail} failed.`);
  console.log(`  Audit log:  ${logPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
})().catch(e => {
  console.error('FATAL:', e.message || e);
  process.exit(1);
});
