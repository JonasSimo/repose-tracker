'use strict';

// ─────────────────────────────────────────────────────────────────────────
// aftership-poll
//
// Replaces aftership-webhook on the free AfterShip tier (webhooks are
// paid-only). Runs every 15 min. Calls AfterShip GET /trackings to fetch
// the latest status for every active (non-delivered) tracking we've
// registered, diffs against Supabase parts_trackings, and upserts changes
// in the same shape the webhook receiver would have written.
//
// Required app settings:
//   AFTERSHIP_API_KEY           — Basic API key from admin.aftership.com → Settings → API
//   SUPABASE_URL                — e.g. https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (bypasses RLS)
//
// Free-tier maths: 4 calls/hour × 24h × 30 days = 2,880 API calls/month.
// AfterShip's free tier limits *tracked parcels* (50/month), not API calls.
// One paged response covers all active trackings.
// ─────────────────────────────────────────────────────────────────────────

const fetch = require('node-fetch');

const AFTERSHIP_API_KEY = process.env.AFTERSHIP_API_KEY;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// AfterShip Tracking API v2024-04. Auth is the `as-api-key` header.
const AS_BASE = 'https://api.aftership.com/tracking/2024-04';

// Non-delivered tag values we want to poll. Once a tracking transitions to
// Delivered AfterShip stops updating it, so we exclude it from the next
// poll cycle.
const ACTIVE_TAGS = [
  'Pending',
  'InfoReceived',
  'InTransit',
  'OutForDelivery',
  'AttemptFail',
  'Exception',
  'AvailableForPickup',
  'Expired',
];

function withTimeout(options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    options: { ...options, signal: controller.signal },
    cleanup: () => clearTimeout(timer),
  };
}

async function asGet(path, log) {
  const url = path.startsWith('http') ? path : `${AS_BASE}${path}`;
  const { options, cleanup } = withTimeout({
    headers: {
      'as-api-key': AFTERSHIP_API_KEY,
      'Accept': 'application/json',
    },
  }, 30000);
  let res;
  try {
    res = await fetch(url, options);
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AfterShip GET ${path} → ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function supaPost(table, rows, onConflict) {
  if (!rows.length) return;
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: onConflict ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PostgREST ${res.status} on ${table}: ${text.slice(0, 400)}`);
  }
}

// Fetch every active tracking from AfterShip in a paginated loop.
async function fetchActiveTrackings(log) {
  const all = [];
  // AfterShip's list endpoint pagination is by `page` + `limit` (max 200).
  // We filter by tag so Delivered trackings don't waste paged reads.
  const tagFilter = ACTIVE_TAGS.join(',');
  let page = 1;
  for (;;) {
    const data = await asGet(`/trackings?page=${page}&limit=200&tag=${tagFilter}`, log);
    const trackings = (data && data.data && data.data.trackings) || [];
    all.push(...trackings);
    if (trackings.length < 200) break;
    page++;
    if (page > 20) {
      log.warn('[aftership-poll] paginated > 20 pages; bailing — likely a filter bug.');
      break;
    }
  }
  return all;
}

async function processTracking(t, log) {
  const tn = t.tracking_number;
  if (!tn) return null;

  const checkpoints = Array.isArray(t.checkpoints) ? t.checkpoints : [];
  const lastCp = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;

  await supaPost('parts_trackings', [{
    tracking_number: tn,
    carrier_slug: t.slug || null,
    aftership_id: t.id || null,
    tag: t.tag || null,
    subtag: t.subtag || null,
    subtag_message: t.subtag_message || null,
    expected_delivery: t.expected_delivery || null,
    shipment_delivery_date: t.shipment_delivery_date || null,
    last_checkpoint_time: lastCp ? lastCp.checkpoint_time : null,
    last_checkpoint_message: lastCp ? lastCp.message : null,
    checkpoints,
    dispatch_po_ref: t.order_id || null,
    payload_data: t,
  }], 'tracking_number');

  if (checkpoints.length > 0) {
    await supaPost('parts_tracking_checkpoints', checkpoints.map((c) => ({
      tracking_number: tn,
      tag: c.tag || null,
      subtag: c.subtag || null,
      message: c.message || null,
      location: c.location || null,
      city: c.city || null,
      country_iso3: c.country_iso3 || null,
      checkpoint_time: c.checkpoint_time || null,
      webhook_event_id: null,                    // polled, not received via webhook
    })), 'tracking_number,tag,subtag,checkpoint_time');
  }

  return tn;
}

module.exports = async function (context, _myTimer) {
  const log = context.log;
  const start = Date.now();
  log('[aftership-poll] start');

  if (!AFTERSHIP_API_KEY) {
    log.error('[aftership-poll] AFTERSHIP_API_KEY not set — aborting.');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log.error('[aftership-poll] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — aborting.');
    return;
  }

  let trackings;
  try {
    trackings = await fetchActiveTrackings(log);
  } catch (err) {
    log.error('[aftership-poll] AfterShip list failed:', err.message || err);
    return;
  }

  log(`[aftership-poll] AfterShip returned ${trackings.length} active tracking(s)`);

  let upserted = 0;
  let failed = 0;
  for (const t of trackings) {
    try {
      const tn = await processTracking(t, log);
      if (tn) upserted++;
    } catch (err) {
      failed++;
      log.warn(`[aftership-poll] failed for ${t && t.tracking_number}: ${(err && err.message) || err}`);
    }
  }

  const ms = Date.now() - start;
  log(`[aftership-poll] done · upserted=${upserted} · failed=${failed} · ${ms}ms`);
};
