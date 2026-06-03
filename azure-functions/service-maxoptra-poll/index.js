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
// Verified shape (live9.maxoptra.com 2026-06-03):
//
//   GET /api/v6/orders?limit=200
//     ↳ { data: [stubs], offset, _links: { next, prev } }
//     ↳ Returns a STUB — consignmentReference, customFields, status, etc.
//        are always null on the list endpoint. Only useful for harvesting
//        referenceNumber + task to drive subsequent detail fetches.
//
//   GET /api/v6/orders/{referenceNumber}
//     ↳ { data: { ...full order } }
//     ↳ customFields lives here (e.g. reposefurniture_batchNums = "REP2533081-R1"
//        or just "2533081-R1" — both formats observed).
//
//   GET /api/v6/orders/{referenceNumber}/execution
//     ↳ { data: { status, assignedDriverName, plannedArrivalTime, eta,
//                  factArrivalTimeGPS, factCompletionTimeReported, ... } }
//     ↳ status drives the Service tab pill.
//
// Pagination: follow _links.next; server-side filters (sort, status, createdAfter)
// were all probed and ignored — only `limit` is honoured (max ~200/page).
async function getMaxoptraJobs(log) {
  const startPath = '/api/v6/orders?limit=200';
  const allJobs = [];
  let nextPath = startPath;
  let pageCount = 0;
  let firstPageKeys = null;
  const maxPages = 25; // ~5000 orders before we hit the cap (limit=200 per page)

  while (nextPath && pageCount < maxPages) {
    pageCount++;
    const fullUrl = nextPath.startsWith('http') ? nextPath : `${MAXOPTRA_BASE_URL}${nextPath}`;
    const data = await maxoptraGetJson(fullUrl);
    if (firstPageKeys === null) firstPageKeys = Object.keys(data || {}).join(', ');
    const jobs = Array.isArray(data) ? data : (data.data || []);
    if (Array.isArray(jobs)) allJobs.push(...jobs);
    nextPath = (data && data._links && typeof data._links.next === 'string') ? data._links.next : null;
  }

  if (pageCount >= maxPages) log.warn(`[maxoptra] hit max page limit (${maxPages}) — there may be more orders`);
  if (allJobs.length === 0) log.warn(`[maxoptra] 0 orders returned · top-level keys on first page: ${firstPageKeys || '(none)'}`);

  // Filter to anything that could be a return-collection. Maxoptra v6 has
  // two task types — COLLECTION (standalone pickup-only stops) and DELIVERY
  // (everything else). Repose's actual return workflow uses DELIVERY because
  // the truck visits the customer to drop a loan chair AND collect the
  // broken one in a single trip; the route reference always carries a "SERV
  // RET"/"RETURN" tag (verified against 84 such orders on 2026-06-03).
  // Anything without that tag is a plain outbound delivery and gets dropped
  // to keep per-tick detail fetches bounded.
  const RETURN_PATTERN = /return|\bret\b/i;
  const candidates = allJobs.filter(o => {
    if (!o) return false;
    const t = String(o.task || '').toUpperCase();
    if (t === 'COLLECTION' || t === 'PICKUP') return true;
    if (t === 'DELIVERY' && RETURN_PATTERN.test(String(o.referenceNumber || ''))) return true;
    return false;
  });
  const collCount = candidates.filter(o => String(o.task).toUpperCase() === 'COLLECTION' || String(o.task).toUpperCase() === 'PICKUP').length;
  const retDelCount = candidates.length - collCount;
  log(`[maxoptra] fetched ${allJobs.length} order(s) across ${pageCount} page(s) — ${collCount} collections + ${retDelCount} return-deliveries (DELIVERY w/ RETURN ref)`);
  return candidates;
}

// Shared GET helper for the Maxoptra v6 API. 30s per-call timeout (route through
// the existing withTimeout wrapper).
async function maxoptraGetJson(url) {
  const headers = {
    'Authorization': `Bearer ${MAXOPTRA_API_KEY}`,
    'Accept': 'application/json'
  };
  if (MAXOPTRA_ACCOUNT_ID) headers['X-Account-Id'] = MAXOPTRA_ACCOUNT_ID;
  const { options: timedOpts, cleanup } = withTimeout({ headers }, 30000);
  try {
    const res = await fetch(url, timedOpts);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Maxoptra GET ${res.status} on ${url}: ${body}`);
    }
    return await res.json();
  } finally {
    cleanup();
  }
}

// Fetch the full order detail (customFields, orderItems, etc.) for one referenceNumber.
// Returns the inner `data` object, or null on any error so the caller can skip and continue.
async function getMaxoptraOrderDetail(log, referenceNumber) {
  const url = `${MAXOPTRA_BASE_URL}/api/v6/orders/${encodeURIComponent(referenceNumber)}`;
  try {
    const json = await maxoptraGetJson(url);
    return (json && json.data) || null;
  } catch (e) {
    log.warn(`[maxoptra] detail fetch failed for ${referenceNumber}: ${e.message}`);
    return null;
  }
}

// Fetch the execution sub-resource (status, driver, planned times) for one referenceNumber.
// Returns the inner `data` object, or null on any error (404 expected for unplanned orders).
async function getMaxoptraExecution(log, referenceNumber) {
  const url = `${MAXOPTRA_BASE_URL}/api/v6/orders/${encodeURIComponent(referenceNumber)}/execution`;
  try {
    const json = await maxoptraGetJson(url);
    return (json && json.data) || null;
  } catch (e) {
    // 404 is normal for orders not yet allocated to a route — log at info level only.
    log(`[maxoptra] execution unavailable for ${referenceNumber}: ${e.message}`);
    return null;
  }
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

// Fallback when transport types the REP into a "Batch numbers" custom field
// instead of the standard Reference. Maxoptra v6 `customFields` shape isn't
// guaranteed (null | object | array-of-{name,value}), so probe defensively.
// Returns candidate strings split on common separators; matching is left to
// the caller.
function extractCustomFieldRefs(customFields) {
  if (!customFields) return [];
  const out = [];
  const isBatchKey = (k) => /batch/i.test(String(k || ''));
  const push = (v) => {
    if (v === null || v === undefined) return;
    String(v)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.push(s));
  };
  if (Array.isArray(customFields)) {
    for (const entry of customFields) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.name ?? entry.key ?? entry.label ?? '';
      if (!isBatchKey(name)) continue;
      const v = entry.value ?? entry.text ?? entry.values;
      if (Array.isArray(v)) v.forEach(push); else push(v);
    }
  } else if (typeof customFields === 'object') {
    for (const [k, v] of Object.entries(customFields)) {
      if (!isBatchKey(k)) continue;
      if (Array.isArray(v)) v.forEach(push); else push(v);
    }
  }
  return out;
}

// Excel serial date → JS Date (UTC midnight of that day). Excel stores dates
// as days since 1899-12-30; 25569 is the offset to the Unix epoch (1970-01-01).
// Returns null for empty, non-numeric, or NaN inputs.
function parseExcelDateSerial(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}

// Return the first arg that parses to a valid Date, otherwise null. Used to
// pick the most informative timestamp from a Maxoptra order/execution for
// the temporal gate.
function pickFirstDate(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const d = c instanceof Date ? c : new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Resolve one candidate label against the indexed ticket maps. Tolerates the
// two formats transport actually types: full REP label ("REP2533081-R1") or
// bare-digit form ("2533081-R1"). When multiple `-R` variants share the same
// base REP, picks the row with the latest Open Date and calls onAmbiguous.
function lookupTicket(label, ticketsByLabel, ticketsByRep, openDateIdx, onAmbiguous) {
  if (!label) return undefined;

  const bareDigits = /^(\d+)(-R\d+)?$/i.exec(label);
  const candidates = [label];
  if (bareDigits) {
    candidates.push(`REP${bareDigits[1]}${bareDigits[2] || ''}`);
  }
  for (const c of candidates) {
    const t = ticketsByLabel.get(c);
    if (t) return t;
  }

  let repBase = null;
  const repPrefixed = /^(REP\d+)/i.exec(label);
  if (repPrefixed) repBase = repPrefixed[1].toUpperCase();
  else if (bareDigits) repBase = `REP${bareDigits[1]}`;
  if (!repBase) return undefined;

  const rows = ticketsByRep.get(repBase) || [];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1 && openDateIdx >= 0) {
    rows.sort((a, b) => (Number(b.raw[openDateIdx]) || 0) - (Number(a.raw[openDateIdx]) || 0));
    if (onAmbiguous) onAmbiguous(label, rows.length, rows[0].sheetRow);
    return rows[0];
  }
  return undefined;
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
      s === 'enroute'    || s === 'en_route'    || s === 'moving'      ||
      s === 'onway'      || s === 'on_way'      || s === 'on way') {
    return `🚚 On way to customer`;
  }
  if (s === 'arrived' || s === 'atcustomer' || s === 'at_customer' || s === 'at customer') {
    return `🚚 At customer · collecting`;
  }
  if (s === 'departed' || s === 'pickedup' || s === 'picked_up' || s === 'picked up') {
    return `🚚 Collected · returning to factory`;
  }
  if (s === 'planned' || s === 'scheduled' || s === 'assigned' || s === 'locked') {
    const when = fmtDateLocal(sched);
    return when ? `📅 Scheduled · ${when}` : `📅 Scheduled`;
  }
  // Maxoptra terms for "booked but not yet in a planned route".
  if (s === 'unallocated' || s === 'unscheduled' || s === 'created') {
    return `🗓️ Awaiting collection planning`;
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
  // openDate is captured per-row and later used as a temporal gate when matching to a
  // Maxoptra order — a return-collection order's effective date cannot precede the date
  // the return ticket was opened (a chair that came back to factory in Jan cannot be the
  // current return that was only logged in May).
  const ticketsByLabel = new Map();
  const ticketsByRep = new Map();
  for (let i = 1; i < values.length; i++) {
    const cid = parseChairId(values[i][repNoIdx]);
    if (!cid || !cid.isReturn) continue; // only -R suffix rows are candidates
    // sheetRow (1-based) accounts for the table possibly starting below row 1.
    // tableRowIndex is 0-based and points at the header — first data row sits
    // at tableRowIndex + 1 (0-based) = tableRowIndex + 2 in 1-based addressing,
    // and any subsequent row is + (i - 1) more.
    const ticketOpenDate = openDateIdx >= 0 ? parseExcelDateSerial(values[i][openDateIdx]) : null;
    const entry = { rowIdx: i - 1, sheetRow: tableRowIndex + i + 1, raw: values[i], openDate: ticketOpenDate };
    ticketsByLabel.set(cid.label, entry);
    if (!ticketsByRep.has(cid.rep)) ticketsByRep.set(cid.rep, []);
    ticketsByRep.get(cid.rep).push({ ...entry, returnNo: cid.returnNo });
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

  const onAmbiguous = (label, n, row) =>
    log.warn(`[ambiguous] ref="${label}" matched ${n} -R variants — picking latest Open Date (row ${row})`);
  const lookup = (label) => lookupTicket(label, ticketsByLabel, ticketsByRep, openDateIdx, onAmbiguous);

  let detailFetched = 0;
  let detailFailed = 0;
  let executionFetched = 0;

  for (const job of jobs) {
    const stubRef = String(job.referenceNumber || '');
    // Stage 1: try the list stub first. consignmentReference is always null in
    // practice on Maxoptra v6 but kept for forward-compat — if Maxoptra ever
    // starts populating it, we skip the detail fetch.
    const listRef = String(job.consignmentReference || '').trim().toUpperCase();
    let ticket = listRef ? lookup(listRef) : undefined;
    let matchVia = ticket ? 'consignmentReference(stub)' : null;
    let matchedLabel = ticket ? listRef : null;

    // Stage 2: detail fetch — this is where customFields.reposefurniture_batchNums
    // actually lives. Without this the function can never match return-collections.
    let detail = null;
    if (!ticket) {
      detail = await getMaxoptraOrderDetail(log, stubRef);
      if (detail) {
        detailFetched++;
        // Try consignmentReference on detail first (still typically null, but cheap).
        const detailListRef = String(detail.consignmentReference || '').trim().toUpperCase();
        if (detailListRef) {
          ticket = lookup(detailListRef);
          if (ticket) { matchVia = 'consignmentReference'; matchedLabel = detailListRef; }
        }
        // Then customFields — the actual data path.
        if (!ticket) {
          for (const raw of extractCustomFieldRefs(detail.customFields)) {
            const candidate = lookup(raw.toUpperCase());
            if (candidate) {
              ticket = candidate;
              matchVia = `customField "${raw}"`;
              matchedLabel = raw;
              break;
            }
          }
        }
      } else {
        detailFailed++;
      }
    }

    if (!ticket) {
      orphans++;
      const cfKeys = detail && detail.customFields ? Object.keys(detail.customFields).join(',') : '(none)';
      log.warn(`[orphan] order ${stubRef} client="${job.clientName || ''}" customFieldKeys=${cfKeys} — no matching ticket`);
      continue;
    }

    // Stage 3: execution fetch — where status, plannedArrivalTime, and
    // completion times live. 404 is expected for orders not yet allocated.
    const execution = await getMaxoptraExecution(log, stubRef);
    if (execution) executionFetched++;

    const rawStatus = execution && execution.status ? execution.status : null;
    const scheduledTime = execution && execution.plannedArrivalTime ? execution.plannedArrivalTime : null;
    const completedTime = execution && (execution.factCompletionTimeReported || execution.factCompletionTimeGPS || execution.plannedCompletionTime) || null;

    // Temporal gate: a return-collection cannot have been planned/completed
    // BEFORE the ticket was opened. Without this check, an old Maxoptra order
    // from a prior repair cycle (or the original delivery, if transport reuses
    // batchNums for both) wrongly matches the current return ticket — the
    // chair "arrived at factory" in January when the return was only logged
    // in May. Effective time falls back through several Maxoptra timestamps;
    // skip the gate only when we have nothing to compare against.
    const orderEffectiveTime = pickFirstDate(
      completedTime,
      scheduledTime,
      execution && execution.factArrivalTimeReported,
      execution && execution.factArrivalTimeGPS,
      detail && Array.isArray(detail.timeWindows) && detail.timeWindows[0] && detail.timeWindows[0].start,
      detail && detail.orderDate
    );
    if (ticket.openDate && orderEffectiveTime && orderEffectiveTime < ticket.openDate) {
      log.warn(`[stale-skip] order ${stubRef} effective=${orderEffectiveTime.toISOString().slice(0,10)} predates ticket ${matchedLabel} openDate=${ticket.openDate.toISOString().slice(0,10)} (matched via ${matchVia}) — treating as orphan`);
      orphans++;
      continue;
    }

    matched++;

    // If we have a ticket but no execution data yet, leave as "waiting" — the
    // standalone sweep below will set that pill if nothing else has.
    if (!rawStatus) {
      log(`[match-no-execution] order ${stubRef} matched ticket ${matchedLabel} via ${matchVia} but execution status is null — leaving for waiting sweep`);
      continue;
    }

    const pill = mapMaxoptraStatus(rawStatus, scheduledTime, completedTime);
    const currentPill = mxStatusIdx >= 0 ? String(ticket.raw[mxStatusIdx] || '').trim() : '';
    const currentJobId = mxJobIdx >= 0 ? String(ticket.raw[mxJobIdx] || '').trim() : '';

    if (pill === currentPill && currentJobId === stubRef) {
      skipped++;
      continue;
    }

    const updates = {
      'Maxoptra Job ID': stubRef,
      'Maxoptra Status': pill,
      'Maxoptra Updated': todayIso
    };

    const isCompleted = pill.startsWith('✅');
    if (isCompleted && returnedIdx >= 0 && completedTime) {
      const currentReturned = String(ticket.raw[returnedIdx] || '').trim();
      if (!currentReturned) {
        const completedAt = new Date(completedTime);
        if (!isNaN(completedAt.getTime())) {
          const tzOffsetMs = completedAt.getTimezoneOffset() * 60000;
          updates['Returned to Factory'] = Math.round(((completedAt.getTime() - tzOffsetMs) / 86400000) + 25569);
        }
      }
    }

    if (!isProdRun) {
      wouldUpdate++;
      if (updates['Returned to Factory'] !== undefined) wouldFillReturned++;
      log(`[DRY-RUN] ${matchedLabel} row ${ticket.sheetRow} → ${pill} via ${matchVia}${updates['Returned to Factory'] !== undefined ? ' (+ Returned to Factory)' : ''} (sandbox; not written)`);
      continue;
    }

    try {
      await patchTicketRow(graphToken, driveId, itemId, ticket.rowIdx, headerRow, updates, TICKET_SHEET, tableRowIndex);
      updated++;
      if (updates['Returned to Factory'] !== undefined) returnedToFactoryFilled++;
      log(`✓ ${matchedLabel} → ${pill} via ${matchVia}${updates['Returned to Factory'] !== undefined ? ' (Returned to Factory filled)' : ''}`);
    } catch (e) {
      log.warn(`✗ Failed to update ${matchedLabel} at row ${ticket.sheetRow}: ${e.message}`);
    }
  }

  log(`[service-maxoptra-poll] detail fetches: ${detailFetched} ok, ${detailFailed} failed · execution fetches: ${executionFetched}`);

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
