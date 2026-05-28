'use strict';

// ─────────────────────────────────────────────────────────────────────────
// find-template-id.js
//
// Helper: searches your SafetyCulture account for templates whose name
// contains the given substring, and prints { id, name, modified_at }.
//
// Run locally before deploying the safetyculture-sync function:
//
//   $env:SAFETYCULTURE_API_TOKEN = "<paste your token>"
//   $env:SAFETYCULTURE_REGION    = "global"   # or "au" / "eu" / "us"
//   node find-template-id.js "service"
//
// Copy the template_id into Function App settings as
// SAFETYCULTURE_TEMPLATE_ID before the timer-triggered sync runs.
// ─────────────────────────────────────────────────────────────────────────

const fetch = require('node-fetch');

const TOKEN   = process.env.SAFETYCULTURE_API_TOKEN;
const REGION  = (process.env.SAFETYCULTURE_REGION || 'global').toLowerCase();
const NEEDLE  = (process.argv[2] || '').toLowerCase().trim();

if (!TOKEN) {
  console.error('SAFETYCULTURE_API_TOKEN env var is required');
  process.exit(1);
}
if (!NEEDLE) {
  console.error('Usage: node find-template-id.js <substring of template name>');
  process.exit(1);
}

const BASE = REGION === 'au' ? 'https://api.au.safetyculture.io'
           : REGION === 'eu' ? 'https://api.eu.safetyculture.io'
           : REGION === 'us' ? 'https://api.us.safetyculture.io'
           : 'https://api.safetyculture.io';

(async () => {
  let offset = 0;
  const pageSize = 100;
  let total = 0;
  const matches = [];

  while (true) {
    const url = `${BASE}/templates/search?field=template_id&field=name&field=modified_at&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      console.error(`Templates search failed (${res.status}): ${await res.text()}`);
      process.exit(1);
    }
    const data = await res.json();
    const items = data.templates || data.items || data.data || [];
    if (!items.length) break;
    total += items.length;
    for (const t of items) {
      const name = String(t.name || t.template_name || '');
      if (name.toLowerCase().includes(NEEDLE)) {
        matches.push({
          template_id: t.template_id || t.id,
          name,
          modified_at: t.modified_at || t.date_modified || null
        });
      }
    }
    if (items.length < pageSize) break;
    offset += pageSize;
    if (offset > 5000) {
      console.error('Stopping at 5000 templates — refine your needle.');
      break;
    }
  }

  console.log(`Scanned ${total} templates · ${matches.length} matched "${NEEDLE}":`);
  for (const m of matches) {
    console.log(`  ${m.template_id}\t${m.name}${m.modified_at ? `  (modified ${m.modified_at})` : ''}`);
  }
  if (!matches.length) {
    console.log('No matches. Try a shorter / different substring.');
  }
})().catch(err => {
  console.error('find-template-id failed:', err.message);
  process.exit(1);
});
