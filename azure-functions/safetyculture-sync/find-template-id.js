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
const NEEDLE  = (process.argv[2] || '').toLowerCase().trim();

if (!TOKEN) {
  console.error('SAFETYCULTURE_API_TOKEN env var is required');
  process.exit(1);
}
if (!NEEDLE) {
  console.error('Usage: node find-template-id.js <substring of template name>');
  process.exit(1);
}

// SafetyCulture has one global API hostname; routing is by token, not by region.
const BASE = 'https://api.safetyculture.io';

(async () => {
  // SC's /templates/search uses cursor-style pagination via modified_after,
  // not offset. Walk forward until a page returns fewer than `limit` items.
  const pageSize = 1000;
  let modifiedAfter = '1970-01-01T00:00:00.000Z';
  let total = 0;
  let pages = 0;
  const matches = [];
  const seenIds = new Set();

  while (pages < 20) {
    pages++;
    const qs = new URLSearchParams({
      field: 'template_id',
      order: 'asc',
      limit: String(pageSize),
      modified_after: modifiedAfter
    });
    // Multi-value `field` param — URLSearchParams encodes one value, append manually
    qs.append('field', 'name');
    qs.append('field', 'modified_at');
    const url = `${BASE}/templates/search?${qs.toString()}`;
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
    let newestSeenAt = modifiedAfter;
    let newItemsOnThisPage = 0;
    for (const t of items) {
      const id = t.template_id || t.id;
      if (id && seenIds.has(id)) continue;
      seenIds.add(id);
      newItemsOnThisPage++;
      const name = String(t.name || t.template_name || '');
      const m_at = t.modified_at || t.date_modified || null;
      if (m_at && m_at > newestSeenAt) newestSeenAt = m_at;
      if (name.toLowerCase().includes(NEEDLE)) {
        matches.push({ template_id: id, name, modified_at: m_at });
      }
    }
    total += newItemsOnThisPage;
    if (items.length < pageSize || newItemsOnThisPage === 0) break;
    modifiedAfter = newestSeenAt;
  }

  console.log(`Scanned ${total} templates across ${pages} page(s) · ${matches.length} matched "${NEEDLE}":`);
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
