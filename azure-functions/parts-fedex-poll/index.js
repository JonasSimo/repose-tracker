'use strict';

// ─────────────────────────────────────────────────────────────────────────
// parts-fedex-poll
//
// Hourly timer (cron `0 7 * * * *` = every hour at HH:07). For each row in
// the PARTS TRACKER `DataTable` Excel Table where Delivered is blank and a
// FedEx tracking number is present, calls the FedEx Track API and — if
// FedEx reports the parcel as delivered — writes the delivery timestamp
// back to the Delivered cell in the format "DD.MM.YY @ HH.mm" (matching
// the existing manual format the team types).
//
// Required app settings:
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET           — Microsoft Graph app-only
//   FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET          — FedEx Developer API
//   FEDEX_ENV                                      — 'sandbox' | 'production'
//   PARTS_TRACKER_SHARING_URL (optional)          — defaults to known prod URL
//
// Free-tier maths: 1 batched API call/hour × 24 = 24 calls/day, well under
// the 250/day free-tier ceiling. Multiple parcels share a single batch call.
// ─────────────────────────────────────────────────────────────────────────

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config ───────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const FEDEX_CLIENT_ID     = process.env.FEDEX_CLIENT_ID;
const FEDEX_CLIENT_SECRET = process.env.FEDEX_CLIENT_SECRET;
const FEDEX_ENV           = (process.env.FEDEX_ENV || 'sandbox').toLowerCase();

const FEDEX_BASE = FEDEX_ENV === 'production'
  ? 'https://apis.fedex.com'
  : 'https://apis-sandbox.fedex.com';

const PARTS_TRACKER_SHARING_URL = process.env.PARTS_TRACKER_SHARING_URL ||
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Service/IQCb6Q6m7hA6S5LcvSWJWbFFAbzvzuai9duzFYgaQNRc24E?e=XMOqRu';

const PARTS_SHEET = 'Part Tracker';
const PARTS_TABLE = 'DataTable';

// ─── Microsoft Graph auth + helpers ──────────────────────────────────────
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

async function graphPatch(token, url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Graph PATCH ${res.status}: ${await res.text()}`);
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

// ─── FedEx auth ──────────────────────────────────────────────────────────
async function getFedexToken() {
  if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET) {
    throw new Error('FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET app settings missing.');
  }
  const url = `${FEDEX_BASE}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: FEDEX_CLIENT_ID,
    client_secret: FEDEX_CLIENT_SECRET
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`FedEx OAuth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

// ─── FedEx tracking ──────────────────────────────────────────────────────
// Batch up to 30 tracking numbers per request (FedEx limit). Returns the
// flattened completeTrackResults array across all batches.
async function trackParcels(fedexToken, trackingNumbers, log) {
  const url = `${FEDEX_BASE}/track/v1/trackingnumbers`;
  const results = [];
  for (let i = 0; i < trackingNumbers.length; i += 30) {
    const batch = trackingNumbers.slice(i, i + 30);
    const body = {
      includeDetailedScans: false,
      trackingInfo: batch.map(tn => ({
        trackingNumberInfo: { trackingNumber: tn.replace(/\s+/g, '') }
      }))
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fedexToken}`,
        'Content-Type': 'application/json',
        // FedEx accepts X-locale (with hyphen) and Accept-Language; sending
        // both forces English status text regardless of which one the API
        // server respects (we saw 'Excepción de entrega' when only X-locale
        // was set, suggesting the server fell back to a default Spanish locale).
        'X-locale': 'en_GB',
        'x-locale': 'en_GB',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      log.warn(`FedEx Track batch ${i}-${i + batch.length} returned ${res.status}: ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    if (data.output && Array.isArray(data.output.completeTrackResults)) {
      results.push(...data.output.completeTrackResults);
    }
  }
  return results;
}

// Normalise one FedEx response entry into our internal shape.
function parseTrackingResult(result) {
  const trackingNumber = (result.trackingNumber || '').replace(/\s+/g, '');
  const r = (result.trackResults && result.trackResults[0]) || {};
  const status = r.latestStatusDetail || {};
  const code = status.code || status.derivedCode || '';
  const isDelivered = code === 'DL';
  let deliveredAt = null;
  let signedBy = null;
  if (isDelivered) {
    const dt = (r.dateAndTimes || []).find(d => d.type === 'ACTUAL_DELIVERY');
    if (dt && dt.dateTime) deliveredAt = new Date(dt.dateTime);
    if (r.deliveryDetails) {
      signedBy = r.deliveryDetails.receivedByName || r.deliveryDetails.signedByName || null;
    }
  }
  // Pick the most relevant timestamp for the latest event. ACTUAL_PICKUP is
  // the cleanest signal for PU; otherwise fall back to SHIP / ESTIMATED_DELIVERY.
  let eventAt = null;
  const dates = r.dateAndTimes || [];
  const pick = (t) => dates.find(d => d.type === t);
  const hit = pick('ACTUAL_PICKUP') || pick('SHIP') || pick('APPOINTMENT_DELIVERY');
  if (hit && hit.dateTime) eventAt = new Date(hit.dateTime);
  return {
    trackingNumber,
    isDelivered,
    deliveredAt,
    signedBy,
    eventCode: code,
    eventLabel: status.description || status.statusByLocale || code || 'Unknown',
    eventAt,
    currentStatus: status.description || status.statusByLocale || code || 'Unknown'
  };
}

// Friendly one-word label per FedEx event code. The UI uses the code (left of
// the pipe) to pick the progress-bar stage; the label is shown in tooltips /
// the parcel row hint. Anything not in this map is left as-is.
const FEDEX_CODE_LABELS = {
  OC: 'Label printed',
  PU: 'Picked up',
  IT: 'In transit',
  AR: 'Arrived at depot',
  DP: 'Departed depot',
  OD: 'Out for delivery',
  DE: 'Delivery exception',
  SE: 'Shipment exception',
  HL: 'Hold at location',
  CA: 'Cancelled'
};

// Format a Date as "DD.MM.YY @ HH.mm" — the team's existing manual format.
function fmtDeliveredText(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} @ ${pad(d.getHours())}.${pad(d.getMinutes())}`;
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

// ─── Main entry ──────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  const log = context.log;
  const started = new Date();
  log(`[parts-fedex-poll] start ${started.toISOString()} · env=${FEDEX_ENV}`);

  if (!FEDEX_CLIENT_ID || !FEDEX_CLIENT_SECRET) {
    log.warn('FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET missing — skipping.');
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
    ({ driveId, itemId } = await resolveDriveItem(graphToken, PARTS_TRACKER_SHARING_URL));
  } catch (e) {
    log.error('Could not resolve PARTS TRACKER:', e.message);
    return;
  }

  // Read the worksheet's usedRange. The first row is the header; data
  // follows. We locate the columns we need by header-name match — no need
  // for a separate tables/columns endpoint.
  let values;
  try {
    const range = await graphGet(graphToken,
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(PARTS_SHEET)}')/usedRange?$select=values`
    );
    values = range.values || [];
  } catch (e) {
    log.error('Could not read Part Tracker usedRange:', e.message);
    return;
  }
  if (values.length < 2) {
    log.warn('Part Tracker has no data rows.');
    return;
  }
  const columnNames = values[0].map(h => String(h || '').trim());

  // Locate the columns we need by name (case-insensitive trim match).
  const norm = s => String(s || '').trim().toLowerCase();
  const findCol = name => columnNames.findIndex(c => norm(c) === norm(name));
  const trackingIdx = findCol('Fedex Tracking');
  const deliveredIdx = findCol('Delivered');
  const customerIdx = findCol('Customer');
  const dateIdx = findCol('Date');
  // FedEx Status column is OPTIONAL. When present, the poll writes the latest
  // non-delivered event code + label + timestamp into it (format:
  // 'CODE|Human label @ DD.MM.YY HH.mm') so the RepNet UI can show accurate
  // pickup / in-transit / OFD progress instead of guessing from elapsed days.
  // If the column doesn't exist, this whole branch is skipped — backward
  // compatible with workbooks that haven't been updated yet.
  const fedexStatusIdx = findCol('FedEx Status');
  if (trackingIdx < 0 || deliveredIdx < 0) {
    log.error(`Required columns not found. Got: ${columnNames.join(', ')}`);
    return;
  }
  if (fedexStatusIdx < 0) {
    log.warn('Optional FedEx Status column not found — pickup/in-transit events will not be persisted. Add a column titled "FedEx Status" to enable accurate progress bar.');
  }

  // Cap how far back we look. Anything older than 12 months has either
  // arrived ages ago (filled-in manually somewhere or simply forgotten) or
  // is stale data we don't want to keep re-querying every hour. FedEx Track
  // also rejects very old tracking numbers as not-found which fills the log
  // with noise.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);

  // Detect a valid FedEx tracking number. FedEx tracking IDs are purely
  // numeric, 12 digits and up (your sample data shows 12-digit numbers like
  // '8876 9467 7089'). The Tracking column on PARTS TRACKER is also used
  // for free-text notes ('ROYAL MAIL - LO407…', 'send with Tooles on Wed',
  // 'ship with Accessories order…') — those have no chance of resolving and
  // should be skipped.
  function _looksLikeFedexTracking(s) {
    const digitsOnly = String(s || '').replace(/\s+/g, '');
    return /^\d{12,}$/.test(digitsOnly);
  }

  // Excel can return either a serial number or a string for the Date column.
  function _parseDateCell(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
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

  // Find every in-transit row — Delivered blank, valid FedEx tracking, dispatched
  // within the cutoff window. Header is row 0 of the values array, so data starts at index 1.
  let totalCandidates = 0;
  let skippedNonFedex = 0;
  let skippedStale = 0;
  const inTransit = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const tn = String(row[trackingIdx] || '').trim();
    const delivered = String(row[deliveredIdx] || '').trim();
    if (!tn || delivered) continue;
    totalCandidates++;
    if (!_looksLikeFedexTracking(tn)) {
      skippedNonFedex++;
      continue;
    }
    if (dateIdx >= 0) {
      const d = _parseDateCell(row[dateIdx]);
      if (d && d < cutoff) { skippedStale++; continue; }
    }
    inTransit.push({
      rowIdx: i - 1,
      sheetRow: i + 1,
      trackingNumber: tn,
      customer: customerIdx >= 0 ? String(row[customerIdx] || '').trim() : '',
      currentFedexStatus: fedexStatusIdx >= 0 ? String(row[fedexStatusIdx] || '').trim() : ''
    });
  }
  log(`[parts-fedex-poll] ${inTransit.length} pollable parcels (skipped: ${skippedNonFedex} non-FedEx, ${skippedStale} older than 12 months) of ${totalCandidates} blank-Delivered rows total`);
  if (inTransit.length === 0) return;

  // Get FedEx token
  let fedexToken;
  try {
    fedexToken = await getFedexToken();
  } catch (e) {
    log.error('FedEx auth failed:', e.message);
    return;
  }

  // Track all in transit
  let results;
  try {
    results = await trackParcels(fedexToken, inTransit.map(p => p.trackingNumber), log);
  } catch (e) {
    log.error('FedEx tracking failed:', e.message);
    return;
  }

  // Map results by normalised tracking number
  const byTracking = {};
  for (const r of results) {
    const parsed = parseTrackingResult(r);
    if (parsed.trackingNumber) byTracking[parsed.trackingNumber] = parsed;
  }

  // For each delivered parcel, PATCH the Delivered cell with the formatted timestamp.
  // SAFETY: in sandbox the FedEx API returns canned mock data (e.g. fake "delivered"
  // for tracking numbers it doesn't recognise), so writes are gated to production-only.
  // Sandbox runs are dry-run: every would-be update is logged but no PATCH is sent.
  const isProd = FEDEX_ENV === 'production';
  let updated = 0;
  let wouldUpdate = 0;
  let statusUpdated = 0;
  let statusWouldUpdate = 0;
  for (const p of inTransit) {
    const key = p.trackingNumber.replace(/\s+/g, '');
    const r = byTracking[key];
    if (!r) {
      log(`· ${p.trackingNumber} (${p.customer}) — no FedEx response`);
      continue;
    }
    if (!r.isDelivered) {
      // Non-delivered event — persist to the optional FedEx Status column so
      // the UI can render an accurate progress bar (Picked up / In transit /
      // Out for delivery). Skip the write if the column is missing or the
      // encoded value hasn't changed since last poll (cheap dedupe).
      log(`· ${p.trackingNumber} (${p.customer}) — ${r.currentStatus}`);
      if (fedexStatusIdx < 0 || !r.eventCode) continue;
      const label = FEDEX_CODE_LABELS[r.eventCode] || r.eventLabel || r.eventCode;
      const ts = fmtDeliveredText(r.eventAt || new Date());
      // Separator is " · " (middle dot) — NOT " @ " — because fmtDeliveredText
      // already contains " @ " for the time, which would otherwise create an
      // awkward double-@ string ("OC|Label printed @ 11.05.26 @ 15.07").
      const encoded = `${r.eventCode}|${label} · ${ts}`;
      // Only the bit before " · " matters for change detection — the timestamp
      // updates every poll. Compare the code+label prefix to skip no-ops.
      const prefix = encoded.split(' · ')[0];
      const currentPrefix = (p.currentFedexStatus || '').split(' · ')[0];
      if (prefix === currentPrefix) continue;
      const statusColLetter = colIdxToLetter(fedexStatusIdx);
      const statusAddr = `${statusColLetter}${p.sheetRow}`;
      if (!isProd) {
        statusWouldUpdate++;
        log(`  [DRY-RUN] ${p.trackingNumber} status → ${encoded} (sandbox; not written)`);
        continue;
      }
      try {
        await graphPatch(graphToken,
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(PARTS_SHEET)}')/range(address='${statusAddr}')`,
          { values: [[encoded]] }
        );
        statusUpdated++;
        log(`  ✓ ${p.trackingNumber} status → ${encoded}`);
      } catch (e) {
        log.warn(`  ✗ Failed to update status for ${p.trackingNumber} at ${statusAddr}: ${e.message}`);
      }
      continue;
    }
    const text = fmtDeliveredText(r.deliveredAt);
    if (!text) {
      log.warn(`· ${p.trackingNumber} marked delivered but no timestamp`);
      continue;
    }
    const colLetter = colIdxToLetter(deliveredIdx);
    // sheetRow is already 1-based Excel row (i+1 in the values-loop, where
    // values[0] is the header). Adding another +1 here was a leftover from
    // the old tables/range(valuesOnly=true) world (values[0] = first data
    // row) and caused every Delivered timestamp to be written to the row
    // BELOW the matching tracking number — leaving the real row stuck as
    // "in transit". See commit 1d93fc6 for the index-convention change.
    const cellAddr = `${colLetter}${p.sheetRow}`;
    if (!isProd) {
      wouldUpdate++;
      log(`[DRY-RUN] ${p.trackingNumber} (${p.customer}) → ${text}${r.signedBy ? ` · signed by ${r.signedBy}` : ''} (sandbox; not written)`);
      continue;
    }
    try {
      await graphPatch(graphToken,
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(PARTS_SHEET)}')/range(address='${cellAddr}')`,
        { values: [[text]] }
      );
      updated++;
      log(`✓ ${p.trackingNumber} (${p.customer}) → ${text}${r.signedBy ? ` · signed by ${r.signedBy}` : ''}`);
    } catch (e) {
      log.warn(`✗ Failed to update ${p.trackingNumber} at ${cellAddr}: ${e.message}`);
    }
  }

  const duration = ((Date.now() - started.getTime()) / 1000).toFixed(1);
  if (isProd) {
    log(`[parts-fedex-poll] complete · ${updated}/${inTransit.length} delivered, ${statusUpdated} status updates · ${duration}s`);
  } else {
    log(`[parts-fedex-poll] complete · DRY-RUN (env=${FEDEX_ENV}) · ${wouldUpdate}/${inTransit.length} would-deliver, ${statusWouldUpdate} would-status · no writes performed · ${duration}s`);
  }
};
