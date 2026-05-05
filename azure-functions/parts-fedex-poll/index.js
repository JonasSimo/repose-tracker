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
        'X-locale': 'en_GB'
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
  const isDelivered = status.code === 'DL' || status.derivedCode === 'DL';
  let deliveredAt = null;
  let signedBy = null;
  if (isDelivered) {
    const dt = (r.dateAndTimes || []).find(d => d.type === 'ACTUAL_DELIVERY');
    if (dt && dt.dateTime) deliveredAt = new Date(dt.dateTime);
    if (r.deliveryDetails) {
      signedBy = r.deliveryDetails.receivedByName || r.deliveryDetails.signedByName || null;
    }
  }
  return {
    trackingNumber,
    isDelivered,
    deliveredAt,
    signedBy,
    currentStatus: status.description || status.statusByLocale || status.code || 'Unknown'
  };
}

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
  if (trackingIdx < 0 || deliveredIdx < 0) {
    log.error(`Required columns not found. Got: ${columnNames.join(', ')}`);
    return;
  }

  // Find every in-transit row — Delivered blank AND tracking number present.
  // Header is row 0 of the values array, so data starts at index 1.
  const inTransit = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const tn = String(row[trackingIdx] || '').trim();
    const delivered = String(row[deliveredIdx] || '').trim();
    if (!tn || delivered) continue;
    inTransit.push({
      rowIdx: i - 1,
      sheetRow: i + 1, // table starts at sheet row 1; values row 0 = header at sheet row 1; data row 0 = sheet row 2
      trackingNumber: tn,
      customer: customerIdx >= 0 ? String(row[customerIdx] || '').trim() : ''
    });
  }
  log(`[parts-fedex-poll] ${inTransit.length} parcels in transit`);
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

  // For each delivered parcel, PATCH the Delivered cell with the formatted timestamp
  let updated = 0;
  for (const p of inTransit) {
    const key = p.trackingNumber.replace(/\s+/g, '');
    const r = byTracking[key];
    if (!r) {
      log(`· ${p.trackingNumber} (${p.customer}) — no FedEx response`);
      continue;
    }
    if (!r.isDelivered) {
      log(`· ${p.trackingNumber} (${p.customer}) — ${r.currentStatus}`);
      continue;
    }
    const text = fmtDeliveredText(r.deliveredAt);
    if (!text) {
      log.warn(`· ${p.trackingNumber} marked delivered but no timestamp`);
      continue;
    }
    const colLetter = colIdxToLetter(deliveredIdx);
    const cellAddr = `${colLetter}${p.sheetRow + 1}`; // +1 because data row 0 = sheet row 2
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
  log(`[parts-fedex-poll] complete · ${updated}/${inTransit.length} parcels marked delivered · ${duration}s`);
};
