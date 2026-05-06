/**
 * NMS Excel ↔ SharePoint list — categories sync (paste into RepNet DevTools)
 * ─────────────────────────────────────────────────────────────────────────
 * What it does
 *   Reads `Near Miss Log.xlsx` (Source sheet) AND the SharePoint NMS list,
 *   matches rows by Reference Number (PHC-XXXXXX), then fills in any blank
 *   category cells from the other side.
 *
 *   • Excel has categories, SharePoint doesn't  → PATCH SharePoint
 *   • SharePoint has categories, Excel doesn't  → PATCH Excel
 *   • Both have categories AND they differ      → reported as a conflict,
 *                                                 NOT touched (you decide)
 *   • Both blank                                 → left alone
 *
 *   This is safe to run repeatedly — each run only fills blanks.
 *
 * Prerequisites
 *   1. Signed into RepNet as Jonas (so getGraphToken / getNmsSiteId / NMS_ITEMS
 *      are available).
 *   2. SharePoint NMS list has the new NearMissCategory + ObservationCategory
 *      columns (Step 1 of the implementation plan).
 *   3. Excel `Near Miss Log.xlsx` Source sheet has the existing Near Miss
 *      Category + Observation Category columns (it does — those are the
 *      ones HS reps fill manually).
 *
 * How to run
 *   1. Open RepNet, sign in, navigate to Safety tab so NMS_ITEMS loads.
 *   2. Open DevTools (F12) → Console.
 *   3. Paste this whole file → Enter.
 *   4. Dry run:        nmsSync()
 *   5. Apply for real: nmsSync({ apply: true })
 *   6. Optional flags: nmsSync({ apply: true, direction: 'excel-to-list' })
 *                       or               direction: 'list-to-excel'
 *                       or               direction: 'both'  (default)
 *
 * Notes
 *   - Excel writes use a persistent workbook session, so changes save to the
 *     file (not just an in-memory throwaway session).
 *   - Throttled to 200ms between PATCH calls — well under Graph's rate limits.
 *   - If you've recently typed in Excel from the desktop app, give the cloud
 *     copy ~30 seconds to flush before running list-to-excel.
 */

window.nmsSync = async function(opts = {}) {
  const {
    apply       = false,
    direction   = 'both',           // 'excel-to-list' | 'list-to-excel' | 'both'
    throttleMs  = 200,
  } = opts;

  if (!Array.isArray(NMS_ITEMS) || !NMS_ITEMS.length) {
    console.error('Open the Safety tab first so NMS_ITEMS is populated.');
    return;
  }

  // From the existing Power Automate flow definition — these are stable.
  // (Drive IDs and file IDs don't change unless someone moves the workbook.)
  const EXCEL = {
    siteId:    'reposefurniturelimited.sharepoint.com,8274c855-0610-486e-9f28-d9e7b4b1755a,dafff0e0-bfac-4926-b7a6-670902a22095',
    driveId:   'b!Vch0ghAGbkifKNnntLF1WuDw_9qsvyZJt6ZnCQKiIJUPX6BHdxrLTL4MPtlL514y',
    itemId:    '013WK3BPK3PS446HFRHZGYPQS6WB5NHCX4',
    sheet:     'Source',
    refColIdx:    0,  // column A = Reference Number
    parentColIdx: 4,  // column E = Near Miss Category
    childColIdx:  7,  // column H = Observation Category
    parentColLetter: 'E',
    childColLetter:  'H',
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const token = await getGraphToken();
  const xlBase = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(EXCEL.siteId)}/drives/${EXCEL.driveId}/items/${EXCEL.itemId}/workbook`;

  // ── 1. Read Excel Source sheet ──────────────────────────────────────
  console.log('Reading Excel Source sheet…');
  const xlRes = await fetch(`${xlBase}/worksheets('${EXCEL.sheet}')/usedRange?$select=values`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!xlRes.ok) {
    console.error(`Excel read failed: HTTP ${xlRes.status}. The hardcoded file IDs may be wrong — try opening the workbook in the browser and check the URL.`);
    return;
  }
  const xlData = await xlRes.json();
  const rows = xlData.values || [];

  const refRe = /^[A-Z]{2,}-\d+$/;
  const excelByRef = {};
  let dataRowCount = 0;
  rows.forEach((r, i) => {
    const ref = String(r[EXCEL.refColIdx] || '').trim();
    if (!refRe.test(ref)) return;
    excelByRef[ref] = {
      ref,
      parent: String(r[EXCEL.parentColIdx] || '').trim(),
      child:  String(r[EXCEL.childColIdx]  || '').trim(),
      excelRowNum: i + 1,    // Excel rows are 1-indexed
    };
    dataRowCount++;
  });
  console.log(`Excel: ${dataRowCount} rows with valid reference numbers.`);

  // ── 2. Build SharePoint list map ────────────────────────────────────
  const listByRef = {};
  let listRowCount = 0;
  NMS_ITEMS.forEach(i => {
    const f = i.fields || {};
    const ref = String(f.ReferenceNumber || f.Title || '').trim();
    if (!ref) return;
    listByRef[ref] = {
      ref,
      itemId: i.id,
      parent: String(f.NearMissCategory || '').trim(),
      child:  String(f.ObservationCategory || '').trim(),
    };
    listRowCount++;
  });
  console.log(`SharePoint list: ${listRowCount} items with reference numbers.`);

  // ── 3. Compute diffs ────────────────────────────────────────────────
  const allRefs = new Set([...Object.keys(excelByRef), ...Object.keys(listByRef)]);
  const toList    = [];   // copy Excel → SharePoint
  const toExcel   = [];   // copy SharePoint → Excel
  const conflicts = [];   // both populated, different
  const onlyExcel = [];   // ref in Excel but not list (orphan)
  const onlyList  = [];   // ref in list but not Excel (orphan)

  for (const ref of allRefs) {
    const e = excelByRef[ref];
    const l = listByRef[ref];
    if (!e) { onlyList.push(ref); continue; }
    if (!l) { onlyExcel.push(ref); continue; }

    const eHas = !!(e.parent && e.child);
    const lHas = !!(l.parent && l.child);

    if (eHas && !lHas) {
      toList.push({ ref, itemId: l.itemId, parent: e.parent, child: e.child });
    } else if (lHas && !eHas) {
      toExcel.push({ ref, rowNum: e.excelRowNum, parent: l.parent, child: l.child });
    } else if (eHas && lHas && (e.parent !== l.parent || e.child !== l.child)) {
      conflicts.push({ ref, excel: { p: e.parent, c: e.child }, list: { p: l.parent, c: l.child } });
    }
  }

  console.log('');
  console.log(`Excel → SharePoint list (fill blanks):  ${toList.length}`);
  console.log(`SharePoint list → Excel (fill blanks):  ${toExcel.length}`);
  console.log(`Conflicts (both filled, differ):        ${conflicts.length}`);
  console.log(`Orphan in Excel only (no list match):   ${onlyExcel.length}`);
  console.log(`Orphan in list only (no Excel match):   ${onlyList.length}`);

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Sample previews:');
    if (toList.length) { console.log('Excel → SharePoint sample:'); console.table(toList.slice(0, 8)); }
    if (toExcel.length) { console.log('SharePoint → Excel sample:'); console.table(toExcel.slice(0, 8)); }
    if (conflicts.length) { console.log('Conflicts (manual review needed):'); console.table(conflicts.slice(0, 12)); }
    console.log('\nTo apply, run: nmsSync({ apply: true })');
    return { toList, toExcel, conflicts, onlyExcel, onlyList };
  }

  // ── 4. Apply ────────────────────────────────────────────────────────
  let listOk = 0, listFail = 0, excelOk = 0, excelFail = 0;

  // 4a. Excel → SharePoint
  if (direction !== 'list-to-excel' && toList.length) {
    console.log(`\nPatching ${toList.length} SharePoint items…`);
    const siteId = await getNmsSiteId();
    for (const r of toList) {
      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${NMS_LIST_ID}/items/${r.itemId}`,
          { method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ fields: { NearMissCategory: r.parent, ObservationCategory: r.child } }) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        listOk++;
        const idx = NMS_ITEMS.findIndex(i => i.id === r.itemId);
        if (idx >= 0) {
          NMS_ITEMS[idx].fields.NearMissCategory    = r.parent;
          NMS_ITEMS[idx].fields.ObservationCategory = r.child;
        }
        if (listOk % 10 === 0) console.log(`  …${listOk}/${toList.length} done`);
      } catch(e) {
        listFail++;
        console.warn(`Failed list ${r.ref}: ${e.message}`);
      }
      await sleep(throttleMs);
    }
  }

  // 4b. SharePoint → Excel
  if (direction !== 'excel-to-list' && toExcel.length) {
    console.log(`\nPatching ${toExcel.length} Excel rows (using persistent session)…`);

    // Create a persistent session so writes save to the file
    const sessRes = await fetch(`${xlBase}/createSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ persistChanges: true })
    });
    if (!sessRes.ok) {
      console.error(`Excel session create failed: HTTP ${sessRes.status}. Aborting Excel writes.`);
    } else {
      const session = await sessRes.json();
      const sessHdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'workbook-session-id': session.id };

      for (const r of toExcel) {
        try {
          const eUrl = `${xlBase}/worksheets('${EXCEL.sheet}')/range(address='${EXCEL.parentColLetter}${r.rowNum}')`;
          const hUrl = `${xlBase}/worksheets('${EXCEL.sheet}')/range(address='${EXCEL.childColLetter}${r.rowNum}')`;
          const [resE, resH] = await Promise.all([
            fetch(eUrl, { method:'PATCH', headers:sessHdr, body: JSON.stringify({ values: [[r.parent]] }) }),
            fetch(hUrl, { method:'PATCH', headers:sessHdr, body: JSON.stringify({ values: [[r.child]]  }) }),
          ]);
          if (!resE.ok || !resH.ok) throw new Error(`HTTP ${resE.status}/${resH.status}`);
          excelOk++;
          if (excelOk % 10 === 0) console.log(`  …${excelOk}/${toExcel.length} done`);
        } catch(e) {
          excelFail++;
          console.warn(`Failed Excel ${r.ref} (row ${r.rowNum}): ${e.message}`);
        }
        await sleep(throttleMs);
      }

      // Close the session — this flushes pending changes to disk
      await fetch(`${xlBase}/closeSession`, { method:'POST', headers: sessHdr });
    }
  }

  console.log(`\nDone — list: ${listOk}/${toList.length}${listFail ? ` (${listFail} failed)` : ''} · excel: ${excelOk}/${toExcel.length}${excelFail ? ` (${excelFail} failed)` : ''}`);
  if (typeof renderNearMisses === 'function') renderNearMisses();
  return { listOk, listFail, excelOk, excelFail, conflicts, onlyExcel, onlyList };
};

console.log('%cnmsSync is ready', 'color:#14a1e9;font-weight:700');
console.log('Run nmsSync() for a dry run; nmsSync({ apply: true }) to actually write.');
console.log('Direction options: { direction: "excel-to-list" | "list-to-excel" | "both" }');
