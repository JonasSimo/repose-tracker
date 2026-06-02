'use strict';

// Test harness for the future LIVE-mode routing logic.
//
// Usage:
//   cd bin/azure-functions
//   node pod-auto-send/test-routing.js [grosvenor|charterhouse] [--all]
//
// What it does:
//   1. Reads the production plan (column D = Client Name, column L = REP)
//      and builds a REP -> Client Name map across all weekly sheets.
//   2. Scans archived SC POD audits (no date_completed required) and looks
//      up each one's REP(s) against the plan map.
//   3. Picks the LATEST audit whose plan-client matches the requested
//      trade customer (default: GROSVENOR MOBILITY).
//   4. Fetches the PDF via SC export and emails it to POD_TRIAL_RECIPIENT
//      with a clear [TEST] tag in the subject.
//   5. DOES NOT write to pod_send_log — fully repeatable.
//
// Use --all to also list every match found (not just the most recent).
//
// This is a TEST harness, not the production timer function. It bypasses
// eligibility (no date_completed required) so it works against Repose's
// current paper workflow where archived Grosvenor PODs have null
// date_completed. Once the workflow change lands (inspector taps
// Complete in SC), the production function will use the natural path.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Load local.settings.json BEFORE requiring sc/graph/prod-plan (they snapshot env)
(function loadLocalSettings() {
  const candidates = [
    path.resolve(__dirname, '..', 'local.settings.json'),
    path.resolve(__dirname, 'local.settings.json'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const values = raw.Values || raw;
    for (const [k, v] of Object.entries(values)) {
      if (typeof v === 'string' && !process.env[k]) process.env[k] = v;
    }
    console.log(`Loaded env from ${path.basename(file)}`);
    return;
  }
})();

const sc = require('./sc');
const graph = require('./graph');
const eligibility = require('./eligibility');
const prodPlan = require('./prod-plan');
const routing = require('./routing');

const TEMPLATE_ID = process.env.SAFETYCULTURE_POD_TEMPLATE_IDS
  ? process.env.SAFETYCULTURE_POD_TEMPLATE_IDS.split(',')[0].trim()
  : 'template_60590bb63dcd4633bcfc6586069a1bf0'; // White Glove Check List - Office

async function searchArchivedAudits(templateId, since) {
  const ids = [];
  const seen = new Set();
  let cursor = since;
  for (let p = 0; p < 60; p++) {
    const qs = `template=${templateId}&archived=true&modified_after=${encodeURIComponent(cursor)}&limit=100&order=asc`;
    const r = await fetch(`https://api.safetyculture.io/audits/search?${qs}`, {
      headers: { Authorization: `Bearer ${process.env.SAFETYCULTURE_API_TOKEN}` },
    });
    if (!r.ok) throw new Error(`SC archived search ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    const items = data.audits || data.data || [];
    let newest = cursor;
    let nNew = 0;
    for (const a of items) {
      if (seen.has(a.audit_id)) continue;
      seen.add(a.audit_id);
      ids.push({ id: a.audit_id, modified_at: a.modified_at });
      nNew++;
      if (a.modified_at && a.modified_at > newest) newest = a.modified_at;
    }
    if (items.length < 100 || nNew === 0) break;
    cursor = newest;
  }
  return ids;
}

(async () => {
  const args = process.argv.slice(2);
  const wantAll = args.includes('--all');
  const customer = (args.find(a => !a.startsWith('--')) || 'grosvenor').toUpperCase();
  const recipient = process.env.POD_TRIAL_RECIPIENT;
  if (!recipient) { console.error('POD_TRIAL_RECIPIENT not set'); process.exit(1); }

  console.log(`Looking for latest archived POD where plan column D matches "${customer}"...`);
  console.log();

  console.log('Building production plan REP -> client map...');
  const planMap = await prodPlan.loadRepClientMap(console.log);
  console.log(`Plan entries: ${planMap.size}`);

  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`Scanning archived SC PODs since ${since.slice(0, 10)}...`);
  const audits = await searchArchivedAudits(TEMPLATE_ID, since);
  console.log(`Archived audits: ${audits.length}`);
  audits.sort((a, b) => (b.modified_at || '').localeCompare(a.modified_at || ''));

  // Walk newest-first, find all matches.
  // Shared eligibility.extractAllRepSerials returns "REP NNNNNNN" strings; the
  // plan map is keyed on the 7 digits alone, so strip the prefix before lookup.
  const matches = [];
  for (const meta of audits) {
    const a = await sc.getAudit(meta.id);
    const reps = eligibility.extractAllRepSerials(a).map(r => r.replace(/^REP\s*/, ''));
    const clientHits = reps
      .map(r => {
        const client = planMap.get(r);
        return client ? { rep: r, client } : null;
      })
      .filter(Boolean);
    const isMatch = clientHits.some(h => routing.matchTradeCustomer(h.client) === customer);
    if (isMatch) {
      const ad = a.audit_data || {};
      matches.push({
        id: meta.id,
        modified_at: meta.modified_at,
        completed_at: ad.date_completed,
        reps,
        clientHits,
        audit: a,
        name: ad.name,
      });
      if (matches.length >= (wantAll ? 50 : 1)) break;
    }
  }
  console.log(`Matches found: ${matches.length}`);
  if (matches.length === 0) {
    console.log(`No archived ${customer} PODs found in the last 180 days.`);
    process.exit(2);
  }

  // Print summary of all matches if --all
  if (wantAll) {
    console.log();
    console.log('All matches (newest first):');
    for (const m of matches) {
      console.log(`  ${m.id} | modified ${m.modified_at} | reps ${m.reps.join(',')} | clients ${m.clientHits.map(h => h.client).join(' / ')}`);
    }
  }

  const pick = matches[0];
  console.log();
  console.log('Sending the most recent match:');
  console.log(`  audit_id: ${pick.id}`);
  console.log(`  modified: ${pick.modified_at}`);
  console.log(`  completed: ${pick.completed_at || '(not completed in SC — paper workflow)'}`);
  console.log(`  REPs: ${pick.reps.join(', ')}`);
  console.log(`  Plan clients: ${pick.clientHits.map(h => `${h.rep}->${h.client}`).join(' / ')}`);

  console.log();
  console.log('Fetching PDF from SC...');
  const pdf = await sc.fetchPodPdf(pick.id, console.log);
  console.log(`PDF: ${pdf.length} bytes`);

  const subject = `[TEST] Detected ${customer} POD — ${pick.reps.join(',')} (audit ${pick.id.slice(0, 14)}...)`;
  const body = [
    `This is a TEST run of the POD auto-send routing logic.`,
    ``,
    `Detected customer: ${pick.clientHits.map(h => h.client).join(' / ')}`,
    `Detection source: production plan column D, matched on REP serial ${pick.reps.join(',')}`,
    `SC audit ID: ${pick.id}`,
    `SC modified: ${pick.modified_at}`,
    `SC completed: ${pick.completed_at || '(not completed in SC)'}`,
    `Audit name: ${pick.name || '(none)'}`,
    ``,
    `In LIVE mode this PDF would have been routed to the customer's email.`,
    `In trial mode you receive it instead.`,
    ``,
    `If the PDF looks sparse, that's because this archived audit was never `,
    `completed in SC — the inspector filed it without tapping Complete. The `,
    `routing logic itself is what's being tested here, not the PDF content.`,
    ``,
    `Test script: bin/azure-functions/pod-auto-send/test-routing.js`,
    `No pod_send_log row was written — this run can be repeated.`,
  ].join('\n');

  const filename = `Repose-POD-TEST-${pick.reps.join('_').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
  await graph.sendMailWithPdf({
    to: recipient,
    subject,
    bodyText: body,
    pdfBuffer: pdf,
    pdfFilename: filename,
  });
  console.log();
  console.log(`Sent to ${recipient}. No state written. Subject: ${subject}`);
})().catch(e => {
  console.error('test-routing failed:', e.message);
  process.exit(99);
});
