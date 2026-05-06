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
const fs    = require('fs');
const path  = require('path');

let LOGO_DATAURL = '';
try {
  const buf = fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png'));
  LOGO_DATAURL = 'data:image/png;base64,' + buf.toString('base64');
} catch(e) { /* falls back to text wordmark */ }

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = process.env.REPNET_URL || 'https://brave-island-06ef03810.1.azurestaticapps.net/';

const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const NMS_SITE_PATH = '/sites/ReposeFurniture-HealthandSafety';
const NMS_LIST_ID   = '8481E1E4-8C93-4CCD-A38A-9736011EFEAB';

const QHSE_PRIMARY  = ['jonas.simonaitis@reposefurniture.co.uk'];
const QHSE_CC       = ['mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];

const OVERDUE_LIMIT_DAYS = 28;

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

// ── Reminder bands ───────────────────────────────────────────────────────
const BANDS = [
  { day:  7, kind: 'week1',   tone: 'gentle',  accent: '#14a1e9', tag: '1 week reminder',   subject: 'Near miss reminder — open 1 week' },
  { day: 14, kind: 'week2',   tone: 'firmer',  accent: '#d97706', tag: '2 week reminder',   subject: 'Near miss still open — 2 weeks' },
  { day: 21, kind: 'week3',   tone: 'urgent',  accent: '#ea580c', tag: '3 week reminder',   subject: 'Near miss still open — 3 weeks · approaching limit' },
  { day: 26, kind: 'critical', tone: 'critical', accent: '#dc2626', tag: 'Critical · 2 days to overdue', subject: '⚠ CRITICAL — Near miss will be overdue in 2 days' },
];

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
function escHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
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
};

// ── Email body ───────────────────────────────────────────────────────────
function buildReminder(item, days, band) {
  const f = item.fields || {};
  const ref      = f.ReferenceNumber || f.Title || ('NMS-' + item.id.slice(0,6));
  const raisedOn = item.createdDateTime ? item.createdDateTime.slice(0,10) : '';
  const daysLeft = OVERDUE_LIMIT_DAYS - days;
  const isCritical = band.kind === 'critical';

  const callToAction = isCritical
    ? `<p style="margin:0 0 8px;font-size:14px;color:#7f1d1d;font-weight:700">⚠ This near miss will be marked overdue in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> if it isn't closed out.</p>`
    : `<p style="margin:0 0 8px;font-size:13px;color:#374151">It's been ${days} days since this near miss was raised — the 28-day close-out limit is in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.</p>`;

  const tone = {
    gentle:   'Just a friendly nudge — nothing urgent yet, but please put eyes on it this week.',
    firmer:   'Two weeks is half the close-out limit. Please prioritise closing this out, or escalate if you need help.',
    urgent:   'Three weeks open — only 7 days left to close. If there\'s a blocker, flag it to QHSE today.',
    critical: 'This must be closed out within the next 2 working days or it will breach the 28-day SLA. If you can\'t complete the action, escalate to QHSE immediately so we can re-route.',
  }[band.tone] || '';

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <div style="background:${band.accent};padding:18px 24px;color:#fff">
        ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:22px;width:auto;display:block;margin-bottom:8px">` : `<div style="font-size:14px;font-weight:900;color:#fff;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`}
        <div style="font-size:18px;font-weight:700">${escHtml(band.tag)}</div>
        <div style="opacity:.85;font-size:12px;margin-top:4px">Near Miss · ${escHtml(ref)} · open ${days} day${days === 1 ? '' : 's'}</div>
      </div>
      <div style="padding:22px 24px">
        ${callToAction}
        <p style="margin:0 0 14px;font-size:13px;color:#374151;line-height:1.5">${escHtml(tone)}</p>

        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px">
          <tr><td style="padding:7px 0;color:#6b7280;width:130px;vertical-align:top">Reference</td><td style="padding:7px 0;font-family:'Courier New',monospace;font-weight:700;color:#111">${escHtml(ref)}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Raised on</td><td style="padding:7px 0;color:#111">${escHtml(raisedOn)} · ${days} days ago</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Location</td><td style="padding:7px 0;color:#111;font-weight:600">${escHtml(f.Locationofissue || '—')}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Raised by</td><td style="padding:7px 0;color:#111">${escHtml(f.RaisedBy_x003a_ || '—')}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top;border-bottom:1px solid #e2e8f0">Issue</td><td style="padding:7px 0;color:#111;border-bottom:1px solid #e2e8f0">${escHtml(f.Whatistheissue_x003f_ || '—')}</td></tr>
          ${f.NearMissCategory   ? `<tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Category</td><td style="padding:7px 0;color:#111">${escHtml(f.NearMissCategory)} · ${escHtml(f.ObservationCategory || '—')}</td></tr>` : ''}
          ${f.StepsTakenToKeepSafe ? `<tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Steps already taken</td><td style="padding:7px 0;color:#111">${escHtml(f.StepsTakenToKeepSafe)}</td></tr>` : ''}
        </table>

        <div style="margin-top:18px;padding:14px;background:#f0f4f8;border-left:4px solid ${band.accent};border-radius:4px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">How to close out:</p>
          <ol style="font-size:12px;color:#374151;line-height:1.5;padding-left:18px;margin:0">
            <li>Open RepNet → <strong>Safety</strong> tab</li>
            <li>Find <strong>${escHtml(ref)}</strong> in the open list</li>
            <li>Click <em>→ Close out</em> on the card</li>
            <li>Describe the actions taken to resolve and click <em>Mark Closed</em></li>
          </ol>
          <p style="margin:14px 0 0">
            <a href="${escHtml(REPNET_URL)}" style="display:inline-block;padding:10px 20px;background:${band.accent};color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:700">Open RepNet · Safety tab →</a>
          </p>
        </div>

        <p style="margin:18px 0 0;font-size:12px;color:#6b7280">If this near miss is no longer relevant or has been resolved another way, please still close it in RepNet so the record is up to date.</p>
      </div>
      <div style="background:#f0f4f8;padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e2e8f0">
        Repose Furniture · QHSE — automated near-miss reminder · daily 07:00 · do not reply.
      </div>
    </div>
  </body></html>`;
}
