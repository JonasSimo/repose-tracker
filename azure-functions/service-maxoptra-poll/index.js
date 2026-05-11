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
const MAXOPTRA_BASE_URL   = (process.env.MAXOPTRA_BASE_URL || 'https://live9.maxoptra.com').replace(/\/$/, '');
const MAXOPTRA_ACCOUNT_ID = process.env.MAXOPTRA_ACCOUNT_ID || '';
const MAXOPTRA_ENV        = (process.env.MAXOPTRA_ENV || 'sandbox').toLowerCase();
const IS_PROD             = MAXOPTRA_ENV === 'production';

// TICKET LOG sharing URL — same workbook the browser-side Service Dashboard reads
// (CP_TICKETING_LOG_URL in index.html:4312). NOT the production planning workbook
// that daily-report uses (which is a different file entirely). Overridable via env.
const TICKETS_SHARING_URL = process.env.TICKETS_SHARING_URL ||
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCQUvM2uD-pQKc9xRkYAfPvAbOaZl0j9liSrWaggTqF60Y?e=6x2dNE';
const TICKET_TABLE = 'TicketLog';
const TICKET_SHEET = 'TICKET LOG'; // worksheet name as it appears in Excel (space, caps)

// Adds an AbortController-based timeout to a fetch options bag.
function withTimeout(options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    options: { ...options, signal: controller.signal },
    cleanup: () => clearTimeout(timer)
  };
}

// ─── Maxoptra API ────────────────────────────────────────────────────────
// Confirmed shape (live9.maxoptra.com 2026-05-05):
//   GET /api/v6/orders            — returns { data: [orders], offset, _links: { next, prev } }
//   Auth: Authorization: Bearer <key>
//   Pagination: follow _links.next (relative URL, ~20/page)
//   Server-side ?task=PICKUP filter is IGNORED, so we filter in code.
//
// Per-order shape:
//   {
//     referenceNumber:        string  — Maxoptra-internal order ID (e.g. "0000079638")
//     consignmentReference:   string  — external/customer reference (where transport types REP No)
//     task:                   "DELIVERY" | "PICKUP"
//     priority:               "NORMAL" | ...
//     clientName:             string  — customer name (free text)
//     contactPerson:          string
//     customerLocation:       { name, address, latitude, longitude, ... }
//     status:                 string | null  — e.g. PLANNED, IN_PROGRESS, COMPLETED (filled once dispatched)
//     statusLastUpdated:      ISO timestamp | null
//     widgetTrackingDetails:  null | object  — likely contains driver/ETA when scheduled
//     customFields:           null | object
//   }
async function getMaxoptraJobs(log) {
  const startPath = '/api/v6/orders';
  const headers = {
    'Authorization': `Bearer ${MAXOPTRA_API_KEY}`,
    'Accept': 'application/json'
  };
  if (MAXOPTRA_ACCOUNT_ID) headers['X-Account-Id'] = MAXOPTRA_ACCOUNT_ID;

  const allJobs = [];
  let nextPath = startPath;
  let pageCount = 0;
  let firstPageKeys = null;
  const maxPages = 25; // ~500 orders before we hit the cap

  while (nextPath && pageCount < maxPages) {
    pageCount++;
    const fullUrl = nextPath.startsWith('http') ? nextPath : `${MAXOPTRA_BASE_URL}${nextPath}`;
    const { options: timedOpts, cleanup } = withTimeout({ headers }, 30000);
    let res;
    try {
      res = await fetch(fullUrl, timedOpts);
    } finally {
      cleanup();
    }
    if (!res.ok) throw new Error(`Maxoptra GET ${res.status} on ${fullUrl}: ${await res.text()}`);
    const data = await res.json();
    if (firstPageKeys === null) firstPageKeys = Object.keys(data || {}).join(', ');
    const jobs = Array.isArray(data) ? data : (data.data || []);
    if (Array.isArray(jobs)) allJobs.push(...jobs);
    nextPath = (data && data._links && typeof data._links.next === 'string') ? data._links.next : null;
  }

  if (pageCount >= maxPages) log.warn(`[maxoptra] hit max page limit (${maxPages}) — there may be more orders`);
  if (allJobs.length === 0) log.warn(`[maxoptra] 0 orders returned · top-level keys on first page: ${firstPageKeys || '(none)'}`);

  // Filter to PICKUP tasks only (server-side filter is ignored). Terminal states
  // we don't care about: COMPLETED is interesting (so we mark Returned to Factory),
  // CANCELLED/FAILED also relevant. Skip any DELIVERY orders entirely.
  const pickups = allJobs.filter(o => o && String(o.task || '').toUpperCase() === 'PICKUP');
  log(`[maxoptra] fetched ${allJobs.length} order(s) across ${pageCount} page(s) — ${pickups.length} are PICKUP`);
  return pickups;
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
  const res = await graphFetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Microsoft Graph's Excel REST sometimes returns 504 MaxRequestDurationExceeded
// when the workbook is large and the cold-open recalc exceeds the gateway's
// 30s timeout. Retry once after a brief delay — the second attempt benefits
// from a warm session and almost always succeeds.
async function graphFetchWithRetry(url, options) {
  let res = await fetch(url, options);
  // Graph 429 throttle: honour Retry-After (seconds) and retry once.
  // Workbook PATCH bursts (one per cell × dozens of tickets per run)
  // can trip the per-second cap on busy days; without this the cell
  // writes silently 429-dropped and the pill text never updated.
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After'), 10);
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000;
    await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));
    res = await fetch(url, options);
  }
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
  // Microsoft Graph: a table's `/range` endpoint returns the full range INCLUDING
  // the header as values[0]. NOTE: do NOT add `(valuesOnly=...)` here — that's
  // a parameter on `usedRange` (worksheet-level), not `range`. Graph 400s if
  // we try it on `range`.
  // We MUST fetch rowIndex too — the table may not start at sheet row 1
  // (TICKET LOG actually starts at A7 because the workbook has merged headers /
  // banners above). Without this offset, per-cell PATCH would write to the wrong
  // sheet rows and corrupt data above the table.
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/tables('${TICKET_TABLE}')/range?$select=values,rowIndex,address`;
  const range = await graphGet(token, url);
  return {
    values: range.values || [],
    tableRowIndex: typeof range.rowIndex === 'number' ? range.rowIndex : 0,
    address: range.address || ''
  };
}

async function patchTicketRow(token, driveId, itemId, dataRowIdx, headerRow, updates, sheetName, tableRowIndex) {
  // Sheet row (1-based) = tableRowIndex (0-based, points at header) + 1 for the
  // header itself + dataRowIdx (0-based, 0 = first data row) + 1 to convert to
  // 1-based sheet addressing. Equivalently: tableRowIndex + dataRowIdx + 2.
  // CRITICAL: do not use `dataRowIdx + 2` (assumes table starts at sheet row 1)
  // — TICKET LOG actually starts at sheet row 7, so without this offset writes
  // would corrupt cells above the table.
  const sheetRow = (tableRowIndex || 0) + dataRowIdx + 2;
  const errors = [];
  for (const [colName, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    const colIdx = findColIdx(headerRow, colName);
    if (colIdx < 0) continue;
    const cellAddr = `${colIdxToLetter(colIdx)}${sheetRow}`;
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/range(address='${cellAddr}')`;
    try {
      const res = await graphFetchWithRetry(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[value]] })
      });
      if (!res.ok) errors.push(`${cellAddr} → ${res.status}: ${await res.text()}`);
    } catch (e) {
      errors.push(`${cellAddr} → ${e.message}`);
    }
  }
  if (errors.length) throw new Error(`PATCH errors: ${errors.join('; ')}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function _norm(s) { return String(s || '').trim().toLowerCase(); }

function findColIdx(headerRow, name) {
  const target = _norm(name);
  return headerRow.findIndex(h => _norm(h) === target);
}

// 0-based column index → Excel column letter ('A', 'B', ..., 'Z', 'AA', ...)
function colIdxToLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
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
  // Force Europe/London timezone regardless of server locale (Azure default is UTC).
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', '');
}

function fmtDateOnly(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short'
  });
}

// Translate a Maxoptra job's raw status into the friendly pill text we
// store in TICKET LOG. Unknown statuses fall through to a "❓" pill that
// surfaces the raw value so we can extend this mapping fast.
function mapMaxoptraStatus(rawStatus, scheduledTime, completedAt) {
  const s = String(rawStatus || '').trim().toLowerCase();
  const sched = scheduledTime ? new Date(scheduledTime) : null;
  const done  = completedAt ? new Date(completedAt) : null;

  if (s === 'cancelled' || s === 'canceled' || s === 'failed' || s === 'rejected') {
    return `❌ Collection ${s} · please rebook`;
  }
  if (s === 'completed' || s === 'delivered' || s === 'finished') {
    const when = fmtDateOnly(done || sched);
    return when ? `✅ In factory · ${when}` : `✅ In factory`;
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
  // Sample log: just identifying fields, not full payloads (avoids 50KB log lines)
  log(`[service-maxoptra-poll] sample jobs: ${JSON.stringify(jobs.slice(0, 3).map(j => ({
    referenceNumber: j.referenceNumber,
    consignmentReference: j.consignmentReference,
    task: j.task,
    status: j.status,
    statusLastUpdated: j.statusLastUpdated,
    clientName: j.clientName
  })), null, 2)}`);

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

  let values, tableRowIndex, tableAddress;
  try {
    ({ values, tableRowIndex, address: tableAddress } = await readTicketLog(graphToken, driveId, itemId));
  } catch (e) {
    log.error('Could not read TicketLog:', e.message);
    return;
  }
  if (values.length < 2) {
    log.warn('TicketLog has no data rows.');
    return;
  }
  log(`[service-maxoptra-poll] read TicketLog · ${values.length - 1} data rows · table at ${tableAddress} (rowIndex=${tableRowIndex})`);

  const headerRow = values[0];
  const repNoIdx     = findColIdx(headerRow, 'REP Number');
  const ticketNoIdx  = findColIdx(headerRow, 'Ticket No');
  const customerIdx  = findColIdx(headerRow, 'Customer');
  const returnedIdx  = findColIdx(headerRow, 'Returned to Factory');
  const openDateIdx  = findColIdx(headerRow, 'Open Date');
  const mxJobIdx     = findColIdx(headerRow, 'Maxoptra Job ID');
  const mxStatusIdx  = findColIdx(headerRow, 'Maxoptra Status');
  const mxUpdatedIdx = findColIdx(headerRow, 'Maxoptra Updated');

  if (repNoIdx < 0) {
    log.error(`TicketLog missing "REP Number" column. Headers: ${headerRow.join(', ')}`);
    return;
  }
  let isProdRun = IS_PROD;
  if (mxJobIdx < 0 || mxStatusIdx < 0 || mxUpdatedIdx < 0) {
    log.error(`TicketLog missing one or more Maxoptra columns (Job ID=${mxJobIdx}, Status=${mxStatusIdx}, Updated=${mxUpdatedIdx}). Add them per Task 5 of the plan. Forcing dry-run for this invocation.`);
    isProdRun = false;
  }

  // Build map: full chair label (e.g. "REP2284-R1") → { rowIdx (0-based data), values reference }
  // Also maintain a secondary map keyed by bare REP No (e.g. "REP2284") → array of all
  // matching tickets so we can fall back when transport types just the REP without -R suffix.
  const ticketsByLabel = new Map();
  const ticketsByRep = new Map();
  for (let i = 1; i < values.length; i++) {
    const cid = parseChairId(values[i][repNoIdx]);
    if (!cid || !cid.isReturn) continue; // only -R suffix rows are candidates
    // sheetRow (1-based) accounts for the table possibly starting below row 1.
    // tableRowIndex is 0-based and points at the header — first data row sits
    // at tableRowIndex + 1 (0-based) = tableRowIndex + 2 in 1-based addressing,
    // and any subsequent row is + (i - 1) more.
    ticketsByLabel.set(cid.label, { rowIdx: i - 1, sheetRow: tableRowIndex + i + 1, raw: values[i] });
    if (!ticketsByRep.has(cid.rep)) ticketsByRep.set(cid.rep, []);
    ticketsByRep.get(cid.rep).push({ rowIdx: i - 1, sheetRow: tableRowIndex + i + 1, raw: values[i], returnNo: cid.returnNo });
  }
  log(`[service-maxoptra-poll] indexed ${ticketsByLabel.size} ticket rows with -R suffix`);

  let matched = 0;
  let orphans = 0;
  let updated = 0;
  let skipped = 0;
  let wouldUpdate = 0;
  let wouldFillReturned = 0;
  let returnedToFactoryFilled = 0;

  const todayIso = new Date().toISOString();

  for (const job of jobs) {
    // Maxoptra v6: external/customer reference is `consignmentReference`. The Maxoptra-internal
    // order id is `referenceNumber`. Status changes are timestamped in `statusLastUpdated`.
    const ref = String(job.consignmentReference || '').trim().toUpperCase();
    if (!ref) { orphans++; continue; }
    let ticket = ticketsByLabel.get(ref);
    if (!ticket) {
      // Fallback: try matching bare REP No (transport may have typed e.g. "REP2284" not "REP2284-R1")
      const bareMatch = /^(REP\d+)/i.exec(ref);
      if (bareMatch) {
        const candidates = ticketsByRep.get(bareMatch[1].toUpperCase()) || [];
        if (candidates.length === 1) {
          ticket = candidates[0];
        } else if (candidates.length > 1 && openDateIdx >= 0) {
          // Pick the latest by Open Date (Excel serial; bigger = newer)
          candidates.sort((a, b) => {
            const ad = Number(a.raw[openDateIdx]) || 0;
            const bd = Number(b.raw[openDateIdx]) || 0;
            return bd - ad;
          });
          ticket = candidates[0];
          log.warn(`[ambiguous] Maxoptra ref="${ref}" matched ${candidates.length} -R variants — picking latest Open Date (row ${ticket.sheetRow})`);
        }
      }
    }
    if (!ticket) {
      orphans++;
      log.warn(`[orphan] Maxoptra order ${job.referenceNumber || '?'} consignmentReference="${ref}" raw="${job.consignmentReference}" client="${job.clientName || ''}" — no matching ticket`);
      continue;
    }
    matched++;
    // Maxoptra status timestamps: only `statusLastUpdated` is consistently available.
    // Use it both as the "scheduled" time hint for in-flight pills and as the
    // completion timestamp for the ✅ branch.
    const tsHint = job.statusLastUpdated || null;
    const pill = mapMaxoptraStatus(job.status, tsHint, tsHint);
    const currentPill = mxStatusIdx >= 0 ? String(ticket.raw[mxStatusIdx] || '').trim() : '';
    const currentJobId = mxJobIdx >= 0 ? String(ticket.raw[mxJobIdx] || '').trim() : '';

    // Idempotent skip: same pill + same job id = no-op
    if (pill === currentPill && currentJobId === String(job.referenceNumber || '')) {
      skipped++;
      continue;
    }

    const updates = {
      'Maxoptra Job ID': String(job.referenceNumber || ''),
      'Maxoptra Status': pill,
      'Maxoptra Updated': todayIso
    };

    // Auto-fill Returned to Factory on completion if not already filled.
    // Only fill when Maxoptra actually provided a completion timestamp — never synthesise "today".
    const isCompleted = pill.startsWith('✅');
    if (isCompleted && returnedIdx >= 0 && tsHint) {
      const currentReturned = String(ticket.raw[returnedIdx] || '').trim();
      if (!currentReturned) {
        const completedAt = new Date(tsHint);
        if (!isNaN(completedAt.getTime())) {
          // Adjust for local timezone so the Excel serial maps to the local-day, not UTC-day.
          // (Excel interprets serials in workbook local time, but JS getTime() is UTC ms.)
          const tzOffsetMs = completedAt.getTimezoneOffset() * 60000;
          updates['Returned to Factory'] = Math.round(((completedAt.getTime() - tzOffsetMs) / 86400000) + 25569);
        }
      }
    }

    if (!isProdRun) {
      wouldUpdate++;
      if (updates['Returned to Factory'] !== undefined) wouldFillReturned++;
      log(`[DRY-RUN] ${ref} row ${ticket.sheetRow} → ${pill}${updates['Returned to Factory'] !== undefined ? ' (+ Returned to Factory)' : ''} (sandbox; not written)`);
      continue;
    }

    try {
      await patchTicketRow(graphToken, driveId, itemId, ticket.rowIdx, headerRow, updates, TICKET_SHEET, tableRowIndex);
      updated++;
      if (updates['Returned to Factory'] !== undefined) returnedToFactoryFilled++;
      log(`✓ ${ref} → ${pill}${updates['Returned to Factory'] !== undefined ? ' (Returned to Factory filled)' : ''}`);
    } catch (e) {
      log.warn(`✗ Failed to update ${ref} at row ${ticket.sheetRow}: ${e.message}`);
    }
  }

  // Mark "stuck waiting" tickets: -R suffix REP No, no Maxoptra Job ID,
  // and no current Maxoptra Status (any value already present — waiting,
  // legacy, or manual edit — is left alone). Idempotent.
  let waitingMarked = 0;
  let wouldMarkWaiting = 0;
  if (mxJobIdx >= 0 && mxStatusIdx >= 0) {
    const waitingPill = '⏳ Waiting for collection booking';
    for (const [label, ticket] of ticketsByLabel.entries()) {
      const currentJobId = String(ticket.raw[mxJobIdx] || '').trim();
      const currentPill  = String(ticket.raw[mxStatusIdx] || '').trim();
      if (currentJobId) continue;  // has Maxoptra job — covered by main loop
      if (currentPill) continue;   // anything already in Maxoptra Status (waiting, legacy, manual edit) — skip

      const updates = {
        'Maxoptra Status': waitingPill,
        'Maxoptra Updated': todayIso
      };
      if (!isProdRun) {
        wouldMarkWaiting++;
        log(`[DRY-RUN] ${label} row ${ticket.sheetRow} → ${waitingPill} (sandbox; not written)`);
        continue;
      }
      try {
        await patchTicketRow(graphToken, driveId, itemId, ticket.rowIdx, headerRow, updates, TICKET_SHEET, tableRowIndex);
        waitingMarked++;
        log(`⏳ ${label} → ${waitingPill}`);
      } catch (e) {
        log.warn(`✗ Failed to mark ${label} waiting at row ${ticket.sheetRow}: ${e.message}`);
      }
    }
  }

  const duration = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  if (isProdRun) {
    log(`[service-maxoptra-poll] complete · matched=${matched} updated=${updated} skipped=${skipped} waiting=${waitingMarked} returnedFilled=${returnedToFactoryFilled} orphans=${orphans} · ${duration}s`);
  } else {
    log(`[service-maxoptra-poll] complete · DRY-RUN (env=${MAXOPTRA_ENV}) · matched=${matched} wouldUpdate=${wouldUpdate} wouldFillReturned=${wouldFillReturned} wouldMarkWaiting=${wouldMarkWaiting} skipped=${skipped} orphans=${orphans} · no writes performed · ${duration}s`);
  }
};
