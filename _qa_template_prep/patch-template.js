// Patches the EXISTING qa-meeting-template.pptx in place to add
// S7 / S10 / S12 tokens. Run when the data-bearing slides need new markers
// without re-deriving the entire template from the wk 18 master.
//
// Idempotent: re-running after the patches are already in place is a no-op
// because the original strings have already been replaced.

const fs    = require('fs');
const path  = require('path');
const JSZip = require('jszip');

const TARGET = path.join(__dirname, '..', 'qa-meeting-template.pptx');

// Each patch is { slide: N, find: string, replace: string }. We replace
// the FIRST <a:t...>find</a:t> match per regex, so order matters when the
// same text appears multiple times on a slide (e.g. S10 'Total £0').
const patches = [
  // ── S7 Internal Errors: row 1 + row 2 — tokenise IRP # and RC code,
  //    blank the Action column (user fills in during the meeting),
  //    keep Owner template default.
  { slide: 7, find: 'CPAR completion rate 100% with the introduction of new system',
              replace: '{{S7R1_ACTION}}' },
  { slide: 7, find: 'Full transfer on a new system should be finalised end of next week.',
              replace: '{{S7R2_ACTION}}' },
  // Row 1: replace the first two '-' placeholders
  { slide: 7, find: '-', replace: '{{S7R1_TKT}}' },
  { slide: 7, find: '-', replace: '{{S7R1_RC}}' },
  // Row 2: next two '-' placeholders
  { slide: 7, find: '-', replace: '{{S7R2_TKT}}' },
  { slide: 7, find: '-', replace: '{{S7R2_RC}}' },

  // ── S10 CoPQ totals — 3 sections (scrap → rework → concession),
  //    weekly + monthly each. Sequential single-replace handles duplicates.
  // Scrap (appears first in XML)
  { slide: 10, find: 'Total £0',                       replace: 'Total £{{S10_SCRAP_WK_GBP}}' },
  { slide: 10, find: 'Monthly Actual to date = £ 0',   replace: 'Monthly Actual to date = £{{S10_SCRAP_MO_GBP}}' },
  // Rework (middle — unique values 99.5 from wk 18 master)
  { slide: 10, find: 'Total £99.5',                    replace: 'Total £{{S10_REWORK_WK_GBP}}' },
  { slide: 10, find: 'Monthly Actual to date = £ 99.5',replace: 'Monthly Actual to date = £{{S10_REWORK_MO_GBP}}' },
  // Concession (last — has space before 0 distinguishing it from scrap)
  { slide: 10, find: 'Total £ 0',                      replace: 'Total £{{S10_CONC_WK_GBP}}' },
  { slide: 10, find: 'Monthly Actual to date = £ 0',   replace: 'Monthly Actual to date = £{{S10_CONC_MO_GBP}}' },

  // ── S12 Scrap banner — full banner text becomes tokens.
  { slide: 12, find: '2 Scrap instances in week 16',
              replace: '{{S12_SCRAP_COUNT}} Scrap instance(s) in week {{WK_NUM_PREV}}' },
];

function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

(async()=>{
  if (!fs.existsSync(TARGET)){
    console.error(`Template not found: ${TARGET}`);
    process.exit(2);
  }
  const buf = fs.readFileSync(TARGET);
  const zip = await JSZip.loadAsync(buf);

  let totalApplied = 0, totalMissed = 0;
  const grouped = {};
  for (const p of patches) (grouped[p.slide] ||= []).push(p);

  for (const slideNum of Object.keys(grouped).map(Number).sort((a,b)=>a-b)){
    const filename = `ppt/slides/slide${slideNum}.xml`;
    const file = zip.file(filename);
    if (!file){ console.error(`MISSING: ${filename}`); continue; }
    let xml = await file.async('string');
    let applied = 0; const missed = [];
    for (const p of grouped[slideNum]){
      const re = new RegExp(`(<a:t(?:\\s+xml:space="preserve")?\\s*>)${escapeRegex(p.find)}(</a:t>)`);
      const before = xml;
      xml = xml.replace(re, (_,open,close)=>open + p.replace + close);
      if (xml === before){ missed.push(p.find); } else { applied++; }
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
  fs.writeFileSync(TARGET, outBuf);
  console.log(`\nWrote ${TARGET}`);
  console.log(`Applied ${totalApplied} patches; missed ${totalMissed}`);
})();
