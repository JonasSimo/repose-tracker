'use strict';

// ─────────────────────────────────────────────────────────────────────────
// safetyculture-sync
//
// 15-min timer. Pulls service inspections from SafetyCulture, extracts the
// REP number from each, and upserts into the Supabase service_inspections
// table. Same script runs the historical backfill — set
// SAFETYCULTURE_BACKFILL=1 in app settings (or run locally) to ignore the
// watermark and pull every inspection since epoch.
//
// Required app settings:
//   SAFETYCULTURE_API_TOKEN     — bearer token (Settings → Integrations → API)
//   SAFETYCULTURE_TEMPLATE_ID   — template ID to sync (see find-template-id.js)
//   SUPABASE_URL                — e.g. https://xxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — service role key (bypasses RLS)
//   SAFETYCULTURE_BACKFILL      — optional; '1' to ignore the watermark
// ─────────────────────────────────────────────────────────────────────────

const fetch = require('node-fetch');

const SC_TOKEN       = process.env.SAFETYCULTURE_API_TOKEN;
const SC_TEMPLATE_ID = process.env.SAFETYCULTURE_TEMPLATE_ID;
const SC_BACKFILL    = process.env.SAFETYCULTURE_BACKFILL === '1';

const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// SafetyCulture has one global API hostname; routing is by token, not by region.
const SC_BASE = 'https://api.safetyculture.io';

const EPOCH = '1970-01-01T00:00:00.000Z';
const PAGE_SIZE = 100;

// ─── helpers ─────────────────────────────────────────────────────────────
function withTimeout(options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    options: { ...options, signal: controller.signal },
    cleanup: () => clearTimeout(timer)
  };
}

async function scGet(path, log) {
  const url = path.startsWith('http') ? path : `${SC_BASE}${path}`;
  const { options, cleanup } = withTimeout({
    headers: {
      'Authorization': `Bearer ${SC_TOKEN}`,
      'Accept': 'application/json'
    }
  }, 30000);
  let res;
  try {
    res = await fetch(url, options);
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SC ${res.status} on ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// PostgREST upsert — Prefer: resolution=merge-duplicates merges on the
// primary key. Returns the upserted row(s).
async function supaUpsert(table, rows, onConflict, log) {
  if (!rows.length) return [];
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs}`;
  const { options, cleanup } = withTimeout({
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  }, 30000);
  let res;
  try {
    res = await fetch(url, options);
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert ${res.status} on ${table}: ${body.slice(0, 500)}`);
  }
  return rows;
}

async function supaSelectOne(table, qs, log) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`;
  const { options, cleanup } = withTimeout({
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept': 'application/json'
    }
  }, 15000);
  let res;
  try {
    res = await fetch(url, options);
  } finally {
    cleanup();
  }
  if (!res.ok) {
    throw new Error(`Supabase select ${res.status}: ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0] || null;
}

// ─── REP-number extraction ────────────────────────────────────────────────
// Strategy:
//   1. audit_data.document_no  — SC's built-in Doc Number header (which the
//      service template renames to "Rep Number:")
//   2. Scan header_items for label containing "rep" + "no"/"number"
//   3. Fall back to scanning the audit title
// Always normalise to canonical `REP NNNNNNN` if a 7-digit number is found.
function extractRepNumber(audit) {
  const ad = audit.audit_data || {};

  const candidates = [];
  if (ad.document_no) candidates.push(String(ad.document_no));

  for (const item of audit.header_items || []) {
    const label = String(item.label || '').toLowerCase();
    if (label.includes('rep') && (label.includes('no') || label.includes('number'))) {
      const text = item?.responses?.text
        ?? item?.responses?.selected?.[0]?.label
        ?? '';
      if (text) candidates.push(String(text));
    }
  }

  if (ad.name)         candidates.push(String(ad.name));
  if (ad.audit_title)  candidates.push(String(ad.audit_title));

  for (const raw of candidates) {
    const m = raw.match(/\b(\d{7})\b/);
    if (m) return `REP ${m[1]}`;
  }
  return null;
}

function extractPhotos(audit) {
  const out = [];
  const walk = items => {
    for (const it of items || []) {
      const media = it.media || [];
      for (const m of media) {
        const url = m.href || m.url;
        if (!url) continue;
        out.push({
          url,
          label: it.label || null,
          caption: m.caption || null,
          media_type: m.media_type || null,
          media_id: m.media_id || null
        });
      }
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.header_items || []);
  walk(audit.items || []);
  return out;
}

// Failed-item count: items whose response is flagged failed=true, or whose
// selected response option has colour "red" / "fail" semantics. SC marks
// `responses.failed = true` for question types that support pass/fail.
function countFailed(audit) {
  let n = 0;
  const walk = items => {
    for (const it of items || []) {
      if (it?.responses?.failed === true) n++;
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.items || []);
  return n;
}

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

// ─── main ────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  const log = (...a) => context.log(...a);
  const warn = (...a) => context.log.warn(...a);
  const error = (...a) => context.log.error(...a);

  const missing = [];
  if (!SC_TOKEN)        missing.push('SAFETYCULTURE_API_TOKEN');
  if (!SC_TEMPLATE_ID)  missing.push('SAFETYCULTURE_TEMPLATE_ID');
  if (!SUPABASE_URL)    missing.push('SUPABASE_URL');
  if (!SUPABASE_KEY)    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    error(`[sc-sync] missing required env vars: ${missing.join(', ')}`);
    return;
  }

  log(`[sc-sync] start · template=${SC_TEMPLATE_ID} · backfill=${SC_BACKFILL}`);

  // 1. Read watermark
  let modifiedAfter = EPOCH;
  if (!SC_BACKFILL) {
    try {
      const state = await supaSelectOne(
        'service_inspection_sync_state',
        `template_id=eq.${encodeURIComponent(SC_TEMPLATE_ID)}`,
        log
      );
      if (state?.last_modified_after) modifiedAfter = state.last_modified_after;
    } catch (e) {
      warn(`[sc-sync] could not read watermark — defaulting to epoch: ${e.message}`);
    }
  }
  log(`[sc-sync] modified_after=${modifiedAfter}`);

  // 2. Page through audits/search to collect IDs.
  // SC uses cursor pagination via modified_after — `offset` returns HTTP 400.
  // Walk forward by advancing the cursor to the newest modified_at seen on
  // each page; a seenIds set guards against double-counting boundary rows
  // (multiple audits with the same modified_at would otherwise re-appear).
  const auditIds = [];
  const seenIds = new Set();
  let cursor = modifiedAfter;
  let pages = 0;
  const maxPages = 50; // hard cap so a runaway template can't exhaust the budget
  while (pages < maxPages) {
    pages++;
    const qs = new URLSearchParams({
      template: SC_TEMPLATE_ID,
      modified_after: cursor,
      limit: String(PAGE_SIZE),
      order: 'asc'
    }).toString();
    let page;
    try {
      page = await scGet(`/audits/search?${qs}`, log);
    } catch (e) {
      error(`[sc-sync] audits/search failed page ${pages}: ${e.message}`);
      await writeSyncState(modifiedAfter, 0, 0, e.message, log);
      return;
    }
    const items = page.audits || page.data || [];
    let newOnThisPage = 0;
    let newestSeen = cursor;
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
  if (pages >= maxPages) warn(`[sc-sync] hit max page limit (${maxPages}) — there may be more inspections`);
  log(`[sc-sync] discovered ${auditIds.length} audit(s) across ${pages} page(s)`);

  if (auditIds.length === 0) {
    await writeSyncState(modifiedAfter, 0, 0, null, log);
    log('[sc-sync] nothing to sync — watermark unchanged');
    return;
  }

  // 3. Fetch each audit and build upsert rows
  const rows = [];
  let newestModifiedAt = modifiedAfter;
  let failures = 0;
  for (const id of auditIds) {
    let audit;
    try {
      audit = await scGet(`/audits/${encodeURIComponent(id)}`, log);
    } catch (e) {
      failures++;
      warn(`[sc-sync] fetch ${id} failed: ${e.message}`);
      continue;
    }
    const ad = audit.audit_data || {};
    const authorship = ad.authorship || {};
    const rep = extractRepNumber(audit);
    const modifiedAt = audit.modified_at || ad.date_modified || null;
    if (modifiedAt && modifiedAt > newestModifiedAt) newestModifiedAt = modifiedAt;

    rows.push({
      audit_id:         audit.audit_id || id,
      site_id:          'repose',
      template_id:      audit.template_id || SC_TEMPLATE_ID,
      template_name:    ad.template_name || null,
      rep_number:       rep,
      title:            ad.name || ad.audit_title || null,
      status:           audit.archived ? 'archived' : (ad.date_completed ? 'complete' : 'incomplete'),
      inspector_name:   authorship.author || authorship.owner || null,
      inspector_id:     authorship.author_id || authorship.owner_id || null,
      conducted_at:     isoOrNull(ad.date_started),
      completed_at:     isoOrNull(ad.date_completed),
      modified_at:      isoOrNull(modifiedAt) || isoOrNull(ad.date_modified) || new Date().toISOString(),
      score:            (ad.score != null ? Number(ad.score) : null),
      score_max:        (ad.total_score != null ? Number(ad.total_score) : null),
      score_percentage: (ad.score_percentage != null ? Number(ad.score_percentage) : null),
      failed_items:     countFailed(audit),
      audit_data:       audit,
      photos:           extractPhotos(audit),
      weblink:          (audit.weblink_url || `https://app.safetyculture.com/audits/${audit.audit_id || id}`),
      last_synced_at:   new Date().toISOString()
    });
  }

  // 4. Upsert in batches of 50 to keep request bodies sane
  let inserted = 0;
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    try {
      await supaUpsert('service_inspections', slice, 'audit_id', log);
      inserted += slice.length;
    } catch (e) {
      error(`[sc-sync] upsert batch ${i / BATCH + 1} failed: ${e.message}`);
      await writeSyncState(modifiedAfter, inserted, failures, e.message, log);
      return;
    }
  }

  await writeSyncState(newestModifiedAt, inserted, failures, null, log);
  log(`[sc-sync] done · upserted=${inserted} · fetch-failures=${failures} · watermark→${newestModifiedAt}`);
};

async function writeSyncState(watermark, inserted, failures, errMsg, log) {
  try {
    await supaUpsert('service_inspection_sync_state', [{
      template_id:         SC_TEMPLATE_ID,
      last_modified_after: watermark,
      last_run_at:         new Date().toISOString(),
      last_run_inserted:   inserted,
      last_run_updated:    failures,
      last_run_error:      errMsg
    }], 'template_id', log);
  } catch (e) {
    log.warn?.(`[sc-sync] failed to write sync state: ${e.message}`);
  }
}
