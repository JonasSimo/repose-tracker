// One-time import: REPO-HS000.xlsx → MasterDocumentRegister + DocumentRevisions
//
// Usage:
//   node import-master-doc-list.js "C:/path/to/REPO-HS000.xlsx" "<bearer-token>"
//
// To get the bearer token:
//   1. Open RepNet in browser, hard-reload `?ui=v4`, sign in
//   2. Open DevTools → Console
//   3. Paste:  const t = await getGraphToken(); copy(t);
//   4. The token is now on your clipboard. Paste as the second arg.
//
// What it does:
//   - Reads each non-empty row from the spreadsheet (header at row 4)
//   - For each: writes a MasterDocumentRegister entry + a Rev-N DocumentRevisions row
//   - Skips rows whose DocNumber already exists (idempotent — safe to re-run)
//   - Defaults Category from DocNumber prefix (REPO-HS → H&S, REPO-Q → Quality, PHCF/PMUKF/PRISM → Group)
//   - Other defaults: Level=Form, Departments=All / Site-wide, ReviewCycle=12, Status=Published
//   - FileLink uses the existing sharing URL from the Excel cell's hyperlink
//     (so files stay in their current legacy folder; only metadata is in RepNet)
//   - TriggeredBy = "Migration-import" so the audit trail starts cleanly
//
// Phase 1 limitations to fix manually after running:
//   - Level — most rows will land as "Form"; ~5 procedures need updating to "Procedure"
//   - Departments — defaults to "All / Site-wide"; pick the right area for forms that aren't site-wide
//   - 9 PHCF group docs may want Approvers populated as a comment

const xlsx = require('xlsx');

const SP_HOST = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';
const QMS_REVISIONS_LIST = 'DocumentRevisions';

const QHSE_OWNER_EMAIL = 'jonas.simonaitis@reposefurniture.co.uk';

async function main() {
  const [,, xlsxPath, token] = process.argv;
  if (!xlsxPath || !token) {
    console.error('Usage: node import-master-doc-list.js <path-to-xlsx> <bearer-token>');
    process.exit(1);
  }

  // Read the workbook with cell metadata (so we can grab hyperlinks from the Link column)
  const wb = xlsx.readFile(xlsxPath, { cellNF: false, cellHTML: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = xlsx.utils.decode_range(ws['!ref']);

  // Excel layout: header in row 4 (0-indexed row 3); data from row 5 (0-indexed 4) onward.
  // Columns:
  //   A (0) #
  //   B (1) Document Number
  //   C (2) Document Type           ← used as Title
  //   D (3) Link                    ← cell text "Link To Document" + hyperlink URL in cell.l.Target
  //   E (4) Issue Date              ← Excel date serial number
  //   F (5) Date Revised
  //   G (6) Description
  //   H (7) Revision Number
  //   I (8) Next Revision Date
  const HEADER_ROW = 3;

  // Walk every data row, extract values + hyperlink target into a flat shape
  const docs = [];
  for (let R = HEADER_ROW + 1; R <= range.e.r; R++) {
    const docNumberCell = ws[xlsx.utils.encode_cell({ c: 1, r: R })];
    if (!docNumberCell || !docNumberCell.v) continue;
    const docNumber = String(docNumberCell.v).trim();
    if (!docNumber) continue;

    const titleCell    = ws[xlsx.utils.encode_cell({ c: 2, r: R })];
    const linkCell     = ws[xlsx.utils.encode_cell({ c: 3, r: R })];
    const issueCell    = ws[xlsx.utils.encode_cell({ c: 4, r: R })];
    const revisedCell  = ws[xlsx.utils.encode_cell({ c: 5, r: R })];
    const descCell     = ws[xlsx.utils.encode_cell({ c: 6, r: R })];
    const revNumCell   = ws[xlsx.utils.encode_cell({ c: 7, r: R })];

    docs.push({
      docNumber,
      title:        titleCell ? String(titleCell.v || '').trim() : '',
      linkUrl:      (linkCell && linkCell.l && linkCell.l.Target) ? linkCell.l.Target : '',
      issueSerial:  issueCell ? issueCell.v : null,
      revisedSerial:revisedCell ? revisedCell.v : null,
      description:  descCell ? String(descCell.v || '').trim() : '',
      revNum:       parseInt((revNumCell && revNumCell.v) || 1, 10) || 1,
    });
  }
  console.log(`Found ${docs.length} non-empty document rows in spreadsheet.`);

  // Resolve site + list IDs once
  const siteId = (await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`)).id;
  const regListId = (await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REGISTER_LIST}`)).id;
  const revListId = (await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REVISIONS_LIST}`)).id;

  let imported = 0, skipped = 0, failed = 0;
  for (const d of docs) {
    try {
      // Idempotency: skip if already in register
      const existing = await graphGet(
        token,
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${regListId}/items?$expand=fields&$filter=${encodeURIComponent(`fields/DocNumber eq '${d.docNumber.replace(/'/g, "''")}'`)}&$top=2`
      );
      if (existing.value && existing.value.length > 0) {
        console.log(`  ⊘ ${d.docNumber} — already in register, skipped`);
        skipped++;
        continue;
      }

      const issueIso = serialToIsoNoMs(d.issueSerial);
      const revisedIso = serialToIsoNoMs(d.revisedSerial) || issueIso;
      const nextReviewIso = addMonthsIso(revisedIso || issueIso, 12);

      // Heuristic: Category from DocNumber prefix
      const category =
        d.docNumber.startsWith('REPO-HS') ? 'H&S' :
        d.docNumber.startsWith('REPO-Q')  ? 'Quality' :
        (d.docNumber.startsWith('PHCF') || d.docNumber.startsWith('PMUKF') || d.docNumber.startsWith('PRISM')) ? 'Group' :
        'Quality';

      // Register row
      const registerFields = {
        DocNumber: d.docNumber,
        Title: d.title || d.docNumber,
        Category: category,
        Level: 'Form',
        Departments: 'All / Site-wide',  // single-select choice → plain string
        Status: 'Published',
        CurrentRevision: d.revNum,
        ReviewCycleMonths: 12,
        Owner: QHSE_OWNER_EMAIL,
        Description: d.description || '(imported from legacy MDL)'
      };
      if (issueIso)        registerFields.IssueDate = issueIso;
      if (revisedIso)      registerFields.LastRevisedDate = revisedIso;
      if (nextReviewIso)   registerFields.NextReviewDate = nextReviewIso;
      if (d.linkUrl)       registerFields.FileLink = d.linkUrl;  // plain text URL after column conversion

      await graphPost(
        token,
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${regListId}/items`,
        { fields: registerFields }
      );

      // DocumentRevisions row — Title (not DocNumber); FileLink as plain string
      const revisionFields = {
        Title: d.docNumber,
        Revision: d.revNum,
        IssueDate: (revisedIso || issueIso || new Date().toISOString().slice(0,19) + 'Z'),
        ReasonForRevision: d.description || '(imported from legacy MDL)',
        TriggeredBy: 'Migration-import',
        ChangedFromRev: d.revNum > 1 ? d.revNum - 1 : null
      };
      if (d.linkUrl) revisionFields.FileLink = d.linkUrl;

      await graphPost(
        token,
        `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${revListId}/items`,
        { fields: revisionFields }
      );

      imported++;
      console.log(`  ✓ ${d.docNumber.padEnd(14)} — ${d.title}`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${d.docNumber} — FAILED: ${e.message}`);
    }
  }
  console.log('');
  console.log(`Done. Imported: ${imported}. Skipped (already present): ${skipped}. Failed: ${failed}.`);
  if (failed > 0) {
    console.log('Re-run the script — idempotency means imported rows will be skipped, only failures will retry.');
  }
}

// Excel date serial number → ISO 8601 with time component, no milliseconds.
// Matches the format we use elsewhere in the RepNet codebase (see _isoNoMs in index.html).
function serialToIsoNoMs(serial) {
  if (serial == null || serial === '') return null;
  if (typeof serial === 'string') {
    // Already a string — best-effort parse
    const d = new Date(serial);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0,19) + 'Z';
  }
  // Excel stores dates as days since 1899-12-30 (with a 1900 leap-year bug)
  const utcDays = Math.floor(Number(serial) - 25569);
  const utcMs = utcDays * 86400 * 1000;
  return new Date(utcMs).toISOString().slice(0,19) + 'Z';
}

function addMonthsIso(iso, months) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0,19) + 'Z';
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphPost(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${res.status}: ${await res.text()}`);
  return await res.json();
}

main().catch(e => { console.error('Import script failed:', e); process.exit(1); });
