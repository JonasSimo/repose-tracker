/**
 * sewing-machine-alert — timer-triggered poller (every 15 min).
 *
 * Polls sewing_machine_checks for rows that have a flagged item
 * (any_flag = true) and have not yet been alerted (alerted_at is null),
 * emails QHSE + the maintenance owner via Graph (from systemapp@, the
 * SEND_FROM app setting), then stamps alerted_at so each check alerts once.
 *
 * Graph plumbing (token + sendMailCc) is copied verbatim from nms-reminders /
 * woodmill-extraction-alert.
 *
 * Env (shared with nms-reminders): TENANT_ID, CLIENT_ID, CLIENT_SECRET,
 * SEND_FROM, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const { buildAlertEmail } = require('./emailBody');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Flagged sewing checks go to the sewing room; QHSE is CC'd for oversight.
const ALERT_TO = ['sewingroom@reposefurniture.co.uk'];
const ALERT_CC = ['jonas.simonaitis@reposefurniture.co.uk'];

// ── Graph plumbing (same patterns as nms-reminders) ──────────────────────
const cca = new ConfidentialClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET }
});
async function token() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
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
    throw new Error(`sendMail failed: ${r.status} ${errText.slice(0, 200)}`);
  }
}

// ── Supabase REST helpers (service role → bypasses RLS) ───────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Supabase GET ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

module.exports = async function (context) {
  const rows = await sbGet(
    'sewing_machine_checks?any_flag=eq.true&alerted_at=is.null' +
    '&select=id,station,operator_name,submitted_at,flag_count,results&order=submitted_at.asc',
  );
  if (!rows.length) { context.log('sewing-machine-alert: nothing to alert.'); return; }

  const t = await token();
  for (const check of rows) {
    const { subject, html } = buildAlertEmail(check);
    await sendMailCc(t, ALERT_TO, ALERT_CC, subject, html);
    await sbPatch(`sewing_machine_checks?id=eq.${check.id}`, { alerted_at: new Date().toISOString() });
    context.log(`sewing-machine-alert: emailed for station ${check.station} check ${check.id} (${check.flag_count} flagged).`);
  }
};
