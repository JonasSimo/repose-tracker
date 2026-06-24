'use strict';
/**
 * Near Miss reminder emails
 * ─────────────────────────────────────────────────────────────────────────
 * Runs daily at 07:00 UTC. For every still-open near miss in the Supabase
 * `near_misses` table, computes how many whole days have passed since it was
 * raised. If the count matches one of the reminder bands (7 / 14 / 21 / 26),
 * sends a tailored email to the action owner for that location.
 *
 * Day 26 (= 2 days before the 28-day overdue limit) also CCs the QHSE
 * managers as a critical escalation.
 *
 * Data source — Supabase, NOT SharePoint
 *   Supabase `near_misses` has been the source of truth since the 2026-06-09
 *   bridge cutover. The old SharePoint "NMS Tracker" list is retired and no
 *   longer written by either intake path (RepNet "Raise NMS" + MS Forms QR
 *   flow both insert straight into Supabase). This function used to read that
 *   SP list, which meant after the cutover it chased a frozen snapshot:
 *   near misses raised after 2026-06-09 got no reminders, and rows closed in
 *   Supabase still looked open in SP. Repointed to Supabase 2026-06-17.
 *
 * Idempotency note
 *   No state is stored — the function relies on running daily and matching
 *   the day count exactly. If it misses a day, an item that would have hit
 *   day 14 today instead gets caught at day 21. Acceptable trade-off; can
 *   be hardened later by adding a `last_reminder_day` column.
 *
 * Env vars required (already configured on the Function App)
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, REPNET_URL — Graph send
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY                     — data source
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const { BANDS, buildReminder } = require('./email');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Columns mirror src/features/nms/loader.ts in the repnet repo. Open rows are
// the ones we chase; `is_closed=false` is the Supabase equivalent of the old
// SP `NearMissclosedout_x003f_` flag.
const NMS_COLS =
  'id,reference_number,submitter_name,raised_by_email,issue_description,' +
  'location,category_parent,category_child,is_closed,raised_at';

const QHSE_PRIMARY  = ['jonas.simonaitis@reposefurniture.co.uk'];
const QHSE_CC       = ['mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];

// ── Location → action-owner email lookup ─────────────────────────────────
// Mirrors the ActionOwners sheet in Near Miss Log.xlsx. Keep in sync if HR
// reassigns area ownership. Locations are matched case-insensitively against
// the Locationofissue field on the SharePoint item.
const OWNER_EMAIL_BY_LOCATION = {
  // Repose
  'repose - assembly':        'daniel.seymour@reposefurniture.co.uk',
  'repose - care hub':        'julie.underhill@reposefurniture.co.uk',
  'repose - cutting':         'mark@reposefurniture.co.uk',
  'repose - development':     'ryan.evans@reposefurniture.co.uk',
  'repose - foam':            'mitch@reposefurniture.co.uk',
  'repose - goods in':        'stores@reposefurniture.co.uk',
  'repose - mechanism area':  'daniel.seymour@reposefurniture.co.uk',
  'repose - offices':         'jody.tilley@reposefurniture.co.uk',
  'repose - qc':              'weronika.hathaway@reposefurniture.co.uk',
  'repose - sewing':          'sewingroom@reposefurniture.co.uk',
  'repose - service area':    'blake@reposefurniture.co.uk',
  'repose - transport':       'john.bradnick@reposefurniture.co.uk',
  'repose - upholstery':      'daniel.seymour@reposefurniture.co.uk',
  'repose - wellbeing areas': 'jonas.simonaitis@reposefurniture.co.uk',
  'repose - wood mill':       'paul.jenkins@reposefurniture.co.uk',
  'repose - yard':            'mitch@reposefurniture.co.uk',
  // Prism Rhyl
  'prism - rhyl - customer service': 'linda.price@prismmedical.co.uk',
  'prism - rhyl - quality':          'ian.morris@prismhealthcare.co.uk',
  'prism - rhyl - purchasing':       'rachel.leighton@prismmedical.co.uk',
  'prism - rhyl - r&d and test':     'alwyn.haycock@prismmedical.co.uk',
  'prism - rhyl - goods in':         'william.bellis@prismmedical.co.uk',
  'prism - rhyl - despatch':         'william.bellis@prismmedical.co.uk',
  'prism - rhyl - cth':              'lee.campion@prismmedical.co.uk',
  'prism - rhyl - mobiles':          'brad.sparrow@prismmedical.co.uk',
  'prism - rhyl - bathing':          'brad.sparrow@prismmedical.co.uk',
  'prism - rhyl - engineering':      'billy.walton@prismmedical.co.uk',
  'prism - rhyl - prep':             'andy.cairns@prismmedical.co.uk',
  'prism - rhyl - robot welding':    'andy.cairns@prismmedical.co.uk',
  'prism - rhyl - manual welding':   'mike.hodge@prismmedical.co.uk',
  'prism - rhyl - weld inspection':  'will.obrien@prismmedical.co.uk',
  'prism - rhyl - coating':          'will.obrien@prismmedical.co.uk',
  'prism - rhyl - seats':            'mel.hughes@prismmedical.co.uk',
  'prism - rhyl - vinyl':            'mel.hughes@prismmedical.co.uk',
  'prism - rhyl - car park/yard':    'william.bellis@prismmedical.co.uk',
  // Harvest
  'harvest - field engineers':       'trevor.palmer@harvesthealthcare.co.uk',
  'harvest - warehouse':             'matthew.gregory@harvesthealthcare.co.uk',
  'harvest - despatch':              'matthew.gregory@harvesthealthcare.co.uk',
  'harvest - bed build':             'matthew.gregory@harvesthealthcare.co.uk',
  'harvest - yard':                  'matthew.gregory@harvesthealthcare.co.uk',
  'harvest - mattress production':   'jonathan.revill@harvesthealthcare.co.uk',
  'harvest - mattress build':        'lisa.jefferson@harvesthealthcare.co.uk',
  'harvest - sewing room':           'lisa.jefferson@harvesthealthcare.co.uk',
  'harvest - office':                'michael.hargreaves@harvesthealthcare.co.uk',
  'harvest - field sales':           'kerry.high@harvesthealthcare.co.uk',
  // Evolution
  'evolution - office':              'gerard.oneill@prismhealthcare.co.uk',
  'evolution - warehouse':           'gerard.oneill@prismhealthcare.co.uk',
  'evolution - field':               'gerard.oneill@prismhealthcare.co.uk',
  // Oxford (some unowned)
  'oxford - production':             'tim.constantinidis@oxfordhealthcare.co.uk',
  'oxford - warehouse':              'tim.constantinidis@oxfordhealthcare.co.uk',
  'oxford - quality office':         'chris.wassell@oxfordhealthcare.co.uk',
  'oxford - test area':              'chris.wassell@oxfordhealthcare.co.uk',
};

// ── Graph plumbing (same patterns as other functions in this app) ────────
const cca = new ConfidentialClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET }
});
async function token() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}

// Pull every still-open near miss from Supabase and reshape each row into the
// SP-style { id, createdDateTime, fields } object the email builder + owner
// lookup were written against — so email.js stays untouched. PostgREST caps a
// page at 1000 rows, so page through with Range headers.
async function fetchOpenNearMisses() {
  const out = [];
  let from = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/near_misses?is_closed=eq.false&select=${NMS_COLS}&order=raised_at.desc`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Accept: 'application/json',
        Range: `${from}-${from + 999}`,
      },
    });
    if (!r.ok) throw new Error(`Supabase near_misses ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    for (const row of rows) {
      out.push({
        id: row.reference_number || row.id,
        createdDateTime: row.raised_at,
        fields: {
          ReferenceNumber:        row.reference_number || undefined,
          Title:                  row.submitter_name || undefined,
          Whatistheissue_x003f_:  row.issue_description || undefined,
          Locationofissue:        row.location || undefined,
          RaisedBy_x003a_:        row.submitter_name || row.raised_by_email || undefined,
          NearMissCategory:       row.category_parent || undefined,
          ObservationCategory:    row.category_child || undefined,
        },
      });
    }
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}
async function sendMailCc(t, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      subject, body: { contentType: 'HTML', content: html },
      toRecipients: to.map(e => ({ emailAddress: { address: e } })),
      ccRecipients: cc.map(e => ({ emailAddress: { address: e } })),
    }})
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`sendMail failed: ${r.status} ${errText.slice(0,200)}`);
  }
}

// ── Days-open helper ─────────────────────────────────────────────────────
function daysOpen(createdIso, now) {
  if (!createdIso) return 0;
  const created = new Date(createdIso);
  if (isNaN(created)) return 0;
  // Use whole-day diff at midnight UTC so DST flips don't move the boundary.
  const c = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((n - c) / 86400000);
}

function ownerForLocation(locationOfIssue) {
  if (!locationOfIssue) return null;
  return OWNER_EMAIL_BY_LOCATION[locationOfIssue.trim().toLowerCase()] || null;
}

// ── Main ─────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  const log = (...a) => context.log(...a);
  try {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY app settings');
  }
  const t = await token();
  const items = await fetchOpenNearMisses();
  log(`Fetched ${items.length} open NMS items from Supabase`);

  const now = new Date();
  const today = items.map(i => {
    const d = daysOpen(i.createdDateTime, now);
    const band = BANDS.find(b => b.day === d) || null;
    return { item: i, daysOpen: d, band };
  }).filter(x => x.band);

  log(`${today.length} open items match a reminder band today`);
  if (!today.length) return;

  // Group by band so the "critical" CC list only kicks in once
  let sent = 0, failed = 0, missingOwner = 0;
  for (const { item, daysOpen: d, band } of today) {
    const f = item.fields || {};
    const ownerEmail = ownerForLocation(f.Locationofissue);
    if (!ownerEmail) {
      log(`  ⚠ No owner email for location "${f.Locationofissue}" (item ${item.id}) — sending to QHSE only`);
      missingOwner++;
    }

    const to = ownerEmail ? [ownerEmail] : QHSE_PRIMARY;
    const cc = (band.kind === 'critical')
      ? [...QHSE_PRIMARY.filter(e => e !== ownerEmail?.toLowerCase()), ...QHSE_CC]
      : (ownerEmail ? QHSE_PRIMARY.filter(e => e !== ownerEmail.toLowerCase()) : []);

    const html = buildReminder(item, d, band);
    const subject = `${band.subject} · ${f.ReferenceNumber || f.Title || item.id}`;

    try {
      await sendMailCc(t, to, cc, subject, html);
      sent++;
      log(`  ✓ Sent ${band.kind} for ${f.ReferenceNumber || item.id} → ${to.join(',')}`);
    } catch(e) {
      failed++;
      log(`  ✗ Failed ${band.kind} for ${f.ReferenceNumber || item.id}: ${e.message}`);
    }
  }

  log(`Done — sent ${sent}, failed ${failed}, missing owner ${missingOwner}`);
  } catch (e) {
    // Surface unhandled errors with app context so the Azure crash log shows
    // *why* reminders didn't go out — managers can otherwise lose a day of
    // reminders to a transient Graph 503 with no signal.
    context.log.error('[nms-reminders] failed:', e && e.message ? e.message : e);
    throw e;
  }
};

