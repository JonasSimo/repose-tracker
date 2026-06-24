'use strict';

// QC-passed REP set. Port of repnet/src/features/production/qcAutoSync.ts,
// reduced to the Set<rep7> the backlog calc needs. Sessionless chunked reads.

const { graphGet, encodeSharingUrl } = require('./graph');

const QC_SHEET_SHARING_URL =
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Quality/IQBkNajahlhzTZcypUVLsTM7AW-gHMSu-C2cd2MMLj5npe0?e=8BfsBL';
const QC_SHEET_NAME = 'Data';

function parseQcRows(rows) {
  const out = new Set();
  for (const row of rows ?? []) {
    const repCell = String(row?.[0] ?? '').trim();
    const m = repCell.match(/(?<!\d)(\d{7})(?!\d)/);
    if (m) out.add(m[1]);
  }
  return out;
}

async function resolveQcDriveItem() {
  const di = await graphGet(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(QC_SHEET_SHARING_URL)}/driveItem`,
  );
  return { driveId: di.parentReference.driveId, itemId: di.id };
}

async function loadQcPassedReps(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  const { driveId, itemId } = await resolveQcDriveItem();
  const base = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
    `/workbook/worksheets('${encodeURIComponent(QC_SHEET_NAME)}')`;

  const dims = await graphGet(`${base}/usedRange?$select=rowCount`);
  const lastRow = dims.rowCount ?? 1;
  const CHUNK = 10000;

  const all = new Set();
  for (let r = 1; r <= lastRow; r += CHUNK) {
    const end = Math.min(r + CHUNK - 1, lastRow);
    const range = await graphGet(`${base}/range(address='A${r}:D${end}')?$select=values`);
    for (const rep of parseQcRows(range.values ?? [])) all.add(rep);
  }
  info(`[qc] ${all.size} QC-passed REPs (rowCount ${lastRow})`);
  return all;
}

module.exports = { parseQcRows, loadQcPassedReps };
