'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const xlsx = require('xlsx');

// ─── Config ───────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Where to write the rebuilt REPO-HS000.xlsx. Set in Azure App Settings.
// Format: '/sites/{site-path}/{document-library}/{path}/REPO-HS000.xlsx'
// Example: '/sites/ReposeFurniture-HealthandSafety/Shared Documents/Master Documents/REPO-HS000.xlsx'
const QMS_LEGACY_MDL_PATH = process.env.QMS_LEGACY_MDL_PATH || '';

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// ─── Auth + Graph ─────────────────────────────────────────────────────────
async function getAppToken() {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET
    }
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphGetAll(token, url) {
  const all = [];
  let next = url;
  while (next) {
    const r = await graphGet(token, next);
    if (Array.isArray(r.value)) all.push(...r.value);
    next = r['@odata.nextLink'] || null;
  }
  return all;
}

async function uploadFile(token, sitePath, libraryOrPath, restPath, buffer) {
  // Resolve site → drive (specific library by name OR default drive) → upload
  // via PUT to the path-relative endpoint.
  //
  // sitePath: '/sites/ReposeFurniture-HealthandSafety'
  // libraryOrPath: either the library display name (e.g. 'QMS-Documents'),
  //   in which case we look up its drive by name, OR an empty string to use
  //   the site's default drive (Documents).
  // restPath: leading '/' + the path relative to the resolved drive root.
  const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${sitePath}`);
  let driveId;
  if (libraryOrPath) {
    // List the site's drives, find the one whose displayName matches the library name.
    const drives = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/drives`);
    const match = (drives.value || []).find(d => d.name === libraryOrPath);
    if (!match) throw new Error(`Library '${libraryOrPath}' not found on site ${sitePath}. Available: ${(drives.value || []).map(d => d.name).join(', ')}`);
    driveId = match.id;
  } else {
    const drive = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/drive`);
    driveId = drive.id;
  }
  // Encode each path segment so spaces become %20 (keep '/' literal as separator)
  const encoded = restPath.split('/').map(s => encodeURIComponent(s)).join('/');
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${encoded}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buffer
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Parse a QMS_LEGACY_MDL_PATH env-var value into {sitePath, libraryName, restPath}.
// Recognised libraries on the Quality site are matched by name; anything else
// falls back to the default drive (Documents) of the site.
function parseLegacyMdlPath(value) {
  // Match '/sites/<site-name>/<rest>'
  const m = value.match(/^(\/sites\/[^/]+)\/(.+)$/);
  if (!m) return null;
  const sitePath = m[1];
  const rest = m[2];
  // The first segment of `rest` may be a library display name. Known libraries:
  const KNOWN_LIBRARIES = ['QMS-Documents'];
  const firstSlash = rest.indexOf('/');
  const firstSeg = firstSlash > 0 ? rest.slice(0, firstSlash) : rest;
  if (KNOWN_LIBRARIES.includes(firstSeg)) {
    return { sitePath, libraryName: firstSeg, restPath: '/' + rest.slice(firstSlash + 1) };
  }
  // Otherwise treat everything after /sites/{site} as a path inside the default drive
  return { sitePath, libraryName: '', restPath: '/' + rest };
}

// ─── XLSX builder ─────────────────────────────────────────────────────────
// Mirrors the legacy REPO-HS000.xlsx layout:
// header row at row 4: # | Document Number | Document Type | Link | Issue Date | Date Revised | Description | Revision Number | Next Revision Date
function buildWorkbook(items) {
  const wb = xlsx.utils.book_new();
  const aoa = [];
  // Title rows (rows 1-3 in legacy file are blank or branding; mirror with empty + a banner)
  aoa.push(['Master Document Register']);
  aoa.push([`Auto-generated from RepNet · ${new Date().toISOString().slice(0,10)}`]);
  aoa.push([]);
  // Header row 4
  aoa.push(['#', 'Document Number', 'Document Type', 'Link', 'Issue Date', 'Date Revised', 'Description', 'Revision Number', 'Next Revision Date']);

  // Sort items by DocNumber for deterministic output (matches legacy sort)
  const sorted = items.slice().sort((a, b) => {
    const an = (a.fields && a.fields.DocNumber) || '';
    const bn = (b.fields && b.fields.DocNumber) || '';
    return an.localeCompare(bn, 'en', { numeric: true });
  });

  let n = 0;
  for (const item of sorted) {
    const f = item.fields || {};
    if (!f.DocNumber) continue;
    n++;
    aoa.push([
      n,
      f.DocNumber || '',
      f.Title || '',
      f.FileLink || '',
      f.IssueDate ? String(f.IssueDate).slice(0, 10) : '',
      f.LastRevisedDate ? String(f.LastRevisedDate).slice(0, 10) : '',
      f.Description || '',
      f.CurrentRevision != null ? f.CurrentRevision : '',
      f.NextReviewDate ? String(f.NextReviewDate).slice(0, 10) : ''
    ]);
  }

  const ws = xlsx.utils.aoa_to_sheet(aoa);
  // Column widths approximating the legacy file
  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 18 },  // Document Number
    { wch: 40 },  // Document Type / Title
    { wch: 18 },  // Link
    { wch: 12 },  // Issue Date
    { wch: 12 },  // Date Revised
    { wch: 40 },  // Description
    { wch: 9 },   // Revision Number
    { wch: 14 }   // Next Revision Date
  ];
  xlsx.utils.book_append_sheet(wb, ws, 'Document Register');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Main ─────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[mdl-export] starting at', new Date().toISOString());

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    context.log.error('[mdl-export] missing core env vars; aborting');
    return;
  }
  if (!QMS_LEGACY_MDL_PATH) {
    context.log.error('[mdl-export] QMS_LEGACY_MDL_PATH not set in App Settings; aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
  } catch (e) {
    context.log.error('[mdl-export] auth failed:', e.message);
    return;
  }

  // Fetch all docs from MasterDocumentRegister
  let items;
  try {
    const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`);
    const list = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${QMS_REGISTER_LIST}`);
    items = await graphGetAll(
      token,
      `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=999`
    );
  } catch (e) {
    context.log.error('[mdl-export] register fetch failed:', e.message);
    return;
  }

  context.log(`[mdl-export] fetched ${items.length} register rows`);

  // Build the xlsx
  let buffer;
  try {
    buffer = buildWorkbook(items);
    context.log(`[mdl-export] xlsx built, ${buffer.length} bytes`);
  } catch (e) {
    context.log.error('[mdl-export] xlsx build failed:', e.message);
    return;
  }

  // Parse the legacy path: '/sites/{site}/[library/]{rest-of-path}'
  const parsed = parseLegacyMdlPath(QMS_LEGACY_MDL_PATH);
  if (!parsed) {
    context.log.error(`[mdl-export] QMS_LEGACY_MDL_PATH must start with '/sites/<site>/...' — got ${QMS_LEGACY_MDL_PATH}`);
    return;
  }
  context.log(`[mdl-export] target: site=${parsed.sitePath} library=${parsed.libraryName || '(default Documents)'} path=${parsed.restPath}`);

  // Upload via Graph
  try {
    const result = await uploadFile(token, parsed.sitePath, parsed.libraryName, parsed.restPath, buffer);
    context.log(`[mdl-export] uploaded to ${result.webUrl}`);
  } catch (e) {
    context.log.error('[mdl-export] upload failed:', e.message);
    return;
  }

  context.log('[mdl-export] done');
};
