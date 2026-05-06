'use strict';
/**
 * HTTP test endpoint for NMS reminders
 * ─────────────────────────────────────────────────────────────────────────
 * Sends all 4 reminder mock emails (week1 / week2 / week3 / critical) to
 * a target address using the SAME Graph send path and SAME email HTML the
 * scheduled function uses — so a successful run proves end-to-end
 * deliverability and rendering.
 *
 * Usage
 *   GET  /api/nms-reminders-test?to=jonas.simonaitis@reposefurniture.co.uk&code=<func-key>
 *   POST /api/nms-reminders-test?code=<func-key>   { "to": "you@x.co.uk" }
 *
 * Defaults to jonas.simonaitis@reposefurniture.co.uk if `to` is omitted.
 * Subjects are prefixed [MOCK · day N] so the test emails are easy to spot
 * and delete afterwards.
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const { BANDS, buildReminder } = require('../nms-reminders/email');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const DEFAULT_TARGET = 'jonas.simonaitis@reposefurniture.co.uk';

const cca = new ConfidentialClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET }
});
async function token() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}
async function sendMail(t, to, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      subject, body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
    }})
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`HTTP ${r.status} — ${errText.slice(0, 300)}`);
  }
}

// Sample item — same record across all 4 emails so you can compare side-by-side
const SAMPLE_ITEM = {
  id: 'mock-142',
  createdDateTime: '2026-04-10T08:32:00Z',
  fields: {
    ReferenceNumber:        'PHC-260042',
    Title:                  'PHC-260042',
    Locationofissue:        'Repose - Sewing',
    Whatistheissue_x003f_:  'Frayed extension lead trailing under sewing bench at Station 6 — operator noticed sparking when foot pedal pressed. Lead removed from circulation pending PAT replacement.',
    RaisedBy_x003a_:        'Julie Underhill',
    NearMissCategory:       'At-Risk Condition',
    ObservationCategory:    'Electrical Hazards',
    StepsTakenToKeepSafe:   'Lead removed from use, station taped off, signage placed.',
  }
};

module.exports = async function (context, req) {
  const log = (...a) => context.log(...a);
  const target = (req.query?.to) || (req.body?.to) || DEFAULT_TARGET;

  if (!CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.res = { status: 500, body: 'Missing TENANT_ID / CLIENT_ID / CLIENT_SECRET / SEND_FROM env vars' };
    return;
  }

  log(`Sending 4 mock reminder emails to ${target}…`);
  let t;
  try { t = await token(); }
  catch (e) {
    log(`Token error: ${e.message}`);
    context.res = { status: 500, body: `Token acquire failed: ${e.message}` };
    return;
  }

  const results = [];
  for (const band of BANDS) {
    const html = buildReminder(SAMPLE_ITEM, band.day, band);
    const subject = `[MOCK · day ${band.day}] ${band.subject} · PHC-260042`;
    try {
      await sendMail(t, target, subject, html);
      log(`  ✓ ${band.kind} sent`);
      results.push({ band: band.kind, day: band.day, subject, ok: true });
    } catch (e) {
      log(`  ✗ ${band.kind} failed: ${e.message}`);
      results.push({ band: band.kind, day: band.day, subject, ok: false, error: e.message });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  const okCount = results.filter(r => r.ok).length;
  context.res = {
    status: okCount === BANDS.length ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: { sentTo: target, ok: okCount, failed: BANDS.length - okCount, results }
  };
};
