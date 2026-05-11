'use strict';
/**
 * Near Miss reminder emails
 * ─────────────────────────────────────────────────────────────────────────
 * Runs daily at 07:00 UTC. For every still-open near miss in the SharePoint
 * NMS Tracker list, computes how many whole days have passed since it was
 * raised. If the count matches one of the reminder bands (7 / 14 / 21 / 26),
 * sends a tailored email to the action owner for that location.
 *
 * Day 26 (= 2 days before the 28-day overdue limit) also CCs the QHSE
 * managers as a critical escalation.
 *
 * Idempotency note
 *   No state is stored — the function relies on running daily and matching
 *   the day count exactly. If it misses a day, an item that would have hit
 *   day 14 today instead gets caught at day 21. Acceptable trade-off; can
 *   be hardened later by adding a `LastReminderDay` column to the list.
 *
 * Env vars required (already configured on the Function App)
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, REPNET_URL
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const { BANDS, buildReminder } = require('./email');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const NMS_SITE_PATH = '/sites/ReposeFurniture-HealthandSafety';
const NMS_LIST_ID   = '8481E1E4-8C93-4CCD-A38A-9736011EFEAB';

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
async function getSiteId(t, sitePath) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${sitePath}`, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('site lookup ' + r.status);
  return (await r.json()).id;
}
async function fetchAll(t, url) {
  const out = []; let next = url;
  while (next) {
    const r = await fetch(next, { headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok) throw new Error('fetchAll ' + r.status);
    const j = await r.json();
    out.push(...(j.value || []));
    next = j['@odata.nextLink'];
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
  const t = await token();
  const siteId = await getSiteId(t, NMS_SITE_PATH);
  const items = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${NMS_LIST_ID}/items?$expand=fields&$top=999&$orderby=createdDateTime desc`
  );
  log(`Fetched ${items.length} NMS items`);

  const now = new Date();
  const today = items.filter(i => !i.fields?.NearMissclosedout_x003f_).map(i => {
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

