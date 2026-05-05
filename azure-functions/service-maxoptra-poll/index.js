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
  if (!Array.isArray(jobs) || jobs.length === 0) {
    // Surface a hint so the user can compare against the real API shape after Step 2.1 discovery.
    log.warn(`[maxoptra] response had 0 jobs or unexpected shape · top-level keys: ${Object.keys(data || {}).join(', ') || '(none)'}`);
  }
  log(`[maxoptra] retrieved ${Array.isArray(jobs) ? jobs.length : 0} active collection job(s)`);
  return Array.isArray(jobs) ? jobs : [];
}

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

module.exports = async function (context, myTimer) {
  const log = context.log;
  const started = new Date();
  log(`[service-maxoptra-poll] start ${started.toISOString()} · env=${MAXOPTRA_ENV}`);

  if (!MAXOPTRA_API_KEY) {
    log.warn('MAXOPTRA_API_KEY missing — skipping.');
    return;
  }

  // Phase 1 of plan: just retrieve and log Maxoptra jobs to verify auth.
  let jobs;
  try {
    jobs = await getMaxoptraJobs(log);
  } catch (e) {
    log.error('Maxoptra fetch failed:', e.message);
    return;
  }
  log(`[service-maxoptra-poll] sample jobs: ${JSON.stringify(jobs.slice(0, 2), null, 2)}`);

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

  const duration = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  if (IS_PROD) {
    log(`[service-maxoptra-poll] complete · matched=${matched} updated=${updated} skipped=${skipped} waiting=${waitingMarked} returnedFilled=${returnedToFactoryFilled} orphans=${orphans} · ${duration}s`);
  } else {
    log(`[service-maxoptra-poll] complete · DRY-RUN (env=${MAXOPTRA_ENV}) · matched=${matched} wouldUpdate=${wouldUpdate} skipped=${skipped} orphans=${orphans} · no writes performed · ${duration}s`);
  }
};
