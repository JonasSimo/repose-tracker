/**
 * NMS one-shot backfill — paste into RepNet DevTools console
 * ─────────────────────────────────────────────────────────────────────────
 * What it does
 *   For every existing Near Miss item in SharePoint that does NOT yet have
 *   NearMissCategory + ObservationCategory populated, runs the classifier
 *   and PATCHes the categories back. Only auto-applies when confidence
 *   ≥ minConfidence (defaults to 0.85). Lower-confidence rows are skipped
 *   and reported so you can review them in the QHSE Classification Review
 *   panel at the bottom of the Safety tab.
 *
 * Prerequisites
 *   1. You're signed into RepNet (Jonas) so getGraphToken() / NMS_LIST_ID
 *      / classify-near-miss.js are all loaded.
 *   2. SharePoint list has the new columns: NearMissCategory + ObservationCategory.
 *      (If it doesn't, the PATCH calls will return 400 and the script halts.)
 *
 * How to run
 *   1. Open RepNet, sign in as Jonas, navigate to the Safety tab so NMS_ITEMS is loaded.
 *   2. Open browser DevTools (F12) → Console tab.
 *   3. Paste this whole file and hit Enter.
 *   4. It dry-runs by default (no PATCH). To actually write, call:
 *        nmsBackfill({ apply: true })
 *   5. Optional flags:
 *        nmsBackfill({ apply: true, minConfidence: 0.85, throttleMs: 200 })
 *
 * Safety
 *   - Skips rows that already have BOTH categories set.
 *   - Skips rows where confidence < minConfidence.
 *   - Throttles to one PATCH every throttleMs (default 200ms) so we don't
 *     blow the Microsoft Graph rate limit.
 */

window.nmsBackfill = async function(opts = {}) {
  const { apply = false, minConfidence = 0.85, throttleMs = 200 } = opts;
  if (!window.classifyNearMiss) { console.error('classify-near-miss.js not loaded'); return; }
  if (!Array.isArray(NMS_ITEMS) || !NMS_ITEMS.length) { console.error('Open the Safety tab first so NMS_ITEMS is populated.'); return; }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const candidates = NMS_ITEMS.filter(i => {
    const f = i.fields || {};
    return !(f.NearMissCategory && f.ObservationCategory);
  });
  console.log(`Total NMS_ITEMS: ${NMS_ITEMS.length}`);
  console.log(`Candidates (missing categories): ${candidates.length}`);

  const buckets = { high: [], low: [], unmatched: [] };
  for (const item of candidates) {
    const issue = item.fields?.Whatistheissue_x003f_ || '';
    const cls = window.classifyNearMiss(issue);
    const row = { id: item.id, ref: item.fields?.ReferenceNumber || item.fields?.Title || item.id, issue: issue.slice(0, 80), ...cls };
    if (cls.confidence === 0)               buckets.unmatched.push(row);
    else if (cls.confidence >= minConfidence) buckets.high.push(row);
    else                                    buckets.low.push(row);
  }

  console.log(`High confidence (will ${apply ? 'PATCH' : 'PATCH if you re-run with apply:true'}): ${buckets.high.length}`);
  console.log(`Low confidence (skipped — review in QHSE panel):                                 ${buckets.low.length}`);
  console.log(`Unmatched (skipped — needs manual category):                                    ${buckets.unmatched.length}`);

  if (!apply) {
    console.log('\nDRY RUN — no PATCH calls made. Sample of high-confidence rows:');
    console.table(buckets.high.slice(0, 10));
    console.log('\nSample of low-confidence rows:');
    console.table(buckets.low.slice(0, 10));
    console.log('\nTo apply, run: nmsBackfill({ apply: true })');
    return buckets;
  }

  // Apply mode — PATCH each high-confidence row
  const siteId = await getNmsSiteId();
  const token  = await getGraphToken();
  let ok = 0, fail = 0;
  for (const row of buckets.high) {
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${NMS_LIST_ID}/items/${row.id}`,
        { method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ fields: { NearMissCategory: row.nearMissCategory, ObservationCategory: row.observationCategory } }) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ok++;
      if (ok % 10 === 0) console.log(`  …${ok}/${buckets.high.length} done`);
      // Reflect into local cache
      const idx = NMS_ITEMS.findIndex(i => i.id === row.id);
      if (idx >= 0) {
        NMS_ITEMS[idx].fields.NearMissCategory    = row.nearMissCategory;
        NMS_ITEMS[idx].fields.ObservationCategory = row.observationCategory;
      }
    } catch(e) {
      fail++;
      console.warn(`Failed ${row.ref}: ${e.message}`);
    }
    await sleep(throttleMs);
  }
  console.log(`\nDone — applied ${ok} · failed ${fail}.`);
  if (typeof renderNearMisses === 'function') renderNearMisses();
  return { ok, fail, ...buckets };
};

console.log('%cnmsBackfill is ready', 'color:#14a1e9;font-weight:700');
console.log('Run nmsBackfill() for a dry run; nmsBackfill({ apply: true }) to actually PATCH.');
