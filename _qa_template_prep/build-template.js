// Builds qa-meeting-template.pptx from the wk 18 master.
// Strategy: read .pptx, replace specific full-text strings inside <a:t>...</a:t>
// runs with {{TOKEN}} markers, then write back.
//
// For V1 we mark:
//   - Title slide (S1)
//   - "Wk.NN" / "Week NN" banners on slides 5..12
//   - S5 Customer Complaints actions table (2 rows)
//   - S6 Warranty Returns actions table (1 row)
//
// Markers use {{NAME}} so they're easy to find/replace in the browser.

const fs    = require('fs');
const path  = require('path');
const JSZip = require('jszip');

const SRC = 'C:/Users/jonas.simonaitis/OneDrive - Repose Furniture/Desktop/Quality meetings/Repose QA Team Meeting 2026 wk 18.pptx';
const OUT = 'C:/Users/jonas.simonaitis/.local/bin/qa-meeting-template.pptx';

// ─── per-slide patch list ─────────────────────────────────────────────
// Each patch is { slide: N, find: string, replace: string }.
// `find` is the EXACT inner text of an <a:t> element (case-sensitive).
// We replace `<a:t...>find</a:t>` → `<a:t...>replace</a:t>` (preserving attrs).

const patches = [
  // ── S1: title slide ──
  { slide: 1, find: 'Week Commencing:  0',           replace: 'Week Commencing:  {{WC_DAY1}}' },
  { slide: 1, find: '6/04/2026',                     replace: '{{WC_DAY2}}/{{WC_MONTH}}/{{WC_YEAR}}' },
  { slide: 1, find: '09',                            replace: '{{MEET_DAY}}' },
  { slide: 1, find: '/04/2026',                      replace: '/{{MEET_MONTH}}/{{MEET_YEAR}}' },

  // ── S5: complaints title banner + actions rows ──
  { slide: 5, find: 'NA: Wk.18 Customer Complaints Performance Update',
              replace: 'NA: Wk.{{WK_NUM}} Customer Complaints Performance Update' },
  // Row 1 (Liability "Y" is too common to safely replace by text — leave as default Y)
  { slide: 5, find: 'TICKET1282',                                                replace: '{{S5R1_TKT}}' },
  { slide: 5, find: 'ORDERERROR - PROCESSING ERROR',                              replace: '{{S5R1_RC}}' },
  { slide: 5, find: 'Order Processing Error, wrong castor processed by Sales team ',
                                                                                  replace: '{{S5R1_ACTION}}' },
  // Row 2
  { slide: 5, find: 'TICKET1288',                                                replace: '{{S5R2_TKT}}' },
  { slide: 5, find: 'MISSINGITEM - VELCRO',                                       replace: '{{S5R2_RC}}' },
  { slide: 5, find: 'Missing Velcro on RHS arm, have checked safety culture and you can see that the Velcro is missing. ',
                                                                                  replace: '{{S5R2_ACTION}}' },

  // ── S6: warranty title banner + 1 row ──
  { slide: 6, find: 'NA: Wk.18 Warranty Returns Performance Update',
              replace: 'NA: Wk.{{WK_NUM}} Warranty Returns Performance Update' },
  { slide: 6, find: 'TICKET1287',                                                replace: '{{S6R1_TKT}}' },
  { slide: 6, find: 'ELECTRICS - HANDSET',                                        replace: '{{S6R1_RC}}' },
  { slide: 6, find: 'Handset not working, replacement sent out of warranty.',     replace: '{{S6R1_ACTION}}' },

  // ── Slide title banners on S7..S12 (wk numbers) ──
  // These will show stale data but at least the week number updates.
  { slide: 7, find: 'NA: Wk.18 Internal Performance Update',
              replace: 'NA: Wk.{{WK_NUM}} Internal Performance Update' },
  { slide: 8, find: 'NA: Wk.17 Concessions Performance Update',
              replace: 'NA: Wk.{{WK_NUM_PREV}} Concessions Performance Update' },
  { slide: 9, find: 'NA: Wk.17 Supplier Performance',
              replace: 'NA: Wk.{{WK_NUM_PREV}} Supplier Performance' },
  { slide: 11, find: 'Site: Bi-Weekly Ops – Compliance Performance Update – ',
              replace: 'Site: Bi-Weekly Ops – Compliance Performance Update – ' },
  { slide: 11, find: ' 17',                          replace: ' {{WK_NUM_PREV}}' },
  { slide: 12, find: 'NA: Wk.17 Scrap Performance Update',
              replace: 'NA: Wk.{{WK_NUM_PREV}} Scrap Performance Update' },
];

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

(async()=>{
  const buf = fs.readFileSync(SRC);
  const zip = await JSZip.loadAsync(buf);

  let totalApplied = 0, totalMissed = 0;
  const grouped = {};
  for (const p of patches){
    (grouped[p.slide] ||= []).push(p);
  }

  for (const slideNum of Object.keys(grouped).map(Number).sort((a,b)=>a-b)){
    const filename = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(filename);
    if (!file){ console.error(`MISSING: ${filename}`); continue; }
    let xml = await file.async('string');
    let applied = 0, missed = [];
    for (const p of grouped[slideNum]){
      // Match <a:t...>EXACT_TEXT</a:t> (text-only, no nested tags)
      const re = new RegExp(`(<a:t(?:\\s+xml:space="preserve")?\\s*>)${escapeRegex(p.find)}(</a:t>)`);
      const before = xml;
      xml = xml.replace(re, (_,open,close)=>open + p.replace + close);
      if (xml === before){ missed.push(p.find); }
      else { applied++; }
    }
    zip.file(filename, xml);
    console.log(`slide${slideNum}: ${applied}/${grouped[slideNum].length} applied`);
    if (missed.length){
      console.log(`  MISSED: ${missed.map(m=>JSON.stringify(m.slice(0,60))).join('; ')}`);
      totalMissed += missed.length;
    }
    totalApplied += applied;
  }

  const outBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  fs.writeFileSync(OUT, outBuf);
  console.log(`\nWrote ${OUT}`);
  console.log(`Applied ${totalApplied} patches; missed ${totalMissed}`);
  if (totalMissed) process.exitCode = 1;
})();
