'use strict';

// SafetyCulture API client for pod-auto-send.
//
// SC has one global API hostname; routing is by token, not by region.
// Audit search uses cursor pagination via modified_after — `offset` returns 400
// (see feedback_safetyculture_api.md).
//
// PDF export uses the documented /inspection/v1/export endpoint. The export is
// "single synchronous request" with a 60-sec server-side timeout; the caller
// retries the SAME POST body until `status === STATUS_DONE` and a signed `url`
// appears in the response. There is no separate poll-by-messageId endpoint.
// (See https://developer.safetyculture.com/reference/reportsservice_startinspectionexport)

const fetch = require('node-fetch');

const SC_BASE = 'https://api.safetyculture.io';
const SC_TOKEN = process.env.SAFETYCULTURE_API_TOKEN;

function withTimeout(options = {}, ms = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { options: { ...options, signal: controller.signal }, cleanup: () => clearTimeout(timer) };
}

async function scFetch(path, init = {}, ms = 30000) {
  const url = path.startsWith('http') ? path : `${SC_BASE}${path}`;
  const { options, cleanup } = withTimeout({
    ...init,
    headers: {
      Authorization: `Bearer ${SC_TOKEN}`,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  }, ms);
  try {
    const res = await fetch(url, options);
    return res;
  } finally {
    cleanup();
  }
}

async function scGet(path) {
  const res = await scFetch(path);
  if (!res.ok) throw new Error(`SC GET ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function scPostJson(path, body, ms = 70000) {
  // SC export endpoint can hold the connection up to ~60s before timing out
  // server-side and returning STATUS_IN_PROGRESS, so give the client a slightly
  // longer abort budget than the documented server timeout.
  const res = await scFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, ms);
  if (!res.ok) throw new Error(`SC POST ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Stream-friendly fetch for binary payloads (PDF download URL).
//
// SC's PDF export returns an S3 presigned URL. S3 rejects requests that carry
// an extra Authorization header (the URL itself is the signature) with
// HTTP 400 "InvalidRequest: Only one auth mechanism allowed", so don't route
// through scFetch — do a plain fetch with just an AbortController for timeout.
async function scFetchBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`SC binary GET ${res.status} on ${url}: ${body}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// Cursor-paginated search. Returns { auditIds: [...], newestModifiedAt }.
// Walks forward by advancing the cursor to the newest modified_at seen on
// each page; seenIds guards against double-counting boundary rows.
async function searchAuditsByTemplate(templateId, modifiedAfter, log) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const auditIds = [];
  const seenIds = new Set();
  let cursor = modifiedAfter;
  let newestSeen = modifiedAfter;
  let pages = 0;

  while (pages < MAX_PAGES) {
    pages++;
    const qs = new URLSearchParams({
      template: templateId,
      modified_after: cursor,
      limit: String(PAGE_SIZE),
      order: 'asc',
    }).toString();
    const page = await scGet(`/audits/search?${qs}`);
    const items = page.audits || page.data || [];
    let newOnThisPage = 0;
    for (const a of items) {
      const id = a.audit_id;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      auditIds.push(id);
      newOnThisPage++;
      const m = a.modified_at || a.date_modified;
      if (m && m > newestSeen) newestSeen = m;
    }
    if (items.length < PAGE_SIZE || newOnThisPage === 0) break;
    cursor = newestSeen;
  }
  if (pages >= MAX_PAGES) log?.warn?.(`[pod-auto-send] hit ${MAX_PAGES}-page cap for template ${templateId}`);
  return { auditIds, newestModifiedAt: newestSeen };
}

async function getAudit(auditId) {
  return scGet(`/audits/${encodeURIComponent(auditId)}`);
}

// SC inspection export — documented endpoint:
//   POST /inspection/v1/export
//   body: { export_data: [{ inspection_id }], type: "DOCUMENT_TYPE_PDF" }
//   response: { status, url, version, info[] }
//
// status values: STATUS_IN_PROGRESS / STATUS_DONE / STATUS_FAILED.
// On STATUS_DONE the response includes a signed `url` (S3 link) to download
// the PDF. There is no separate poll-by-messageId endpoint; instead retry the
// exact same POST until status is DONE or FAILED.
//
// We keep `requestPdfExport` / `pollPdfExport` as separate functions to
// preserve the module.exports shape, but they share a single request body
// (the inspection ID) — `requestPdfExport` returns that body so the poller
// can replay it.

function buildExportBody(auditId) {
  return {
    export_data: [{ inspection_id: auditId }],
    type: 'DOCUMENT_TYPE_PDF',
  };
}

async function postExport(auditId) {
  return scPostJson('/inspection/v1/export', buildExportBody(auditId));
}

// Returns the signed download URL if the export response says DONE, else null.
// Single source of truth for done-detection across requestPdfExport and pollPdfExport.
function extractDoneUrl(res) {
  const status = (res.status || '').toUpperCase();
  if (status === 'STATUS_DONE' || status === 'SUCCESS' || status === 'COMPLETE' || status === 'COMPLETED') {
    return res.url || res.download_url || res.location || null;
  }
  return null;
}

// Issues the first export POST and returns a handle the poller can use to
// drive subsequent requests. The handle is { auditId, url }, where `url` is
// the signed S3 URL iff SC returned STATUS_DONE on this first call —
// otherwise null and the caller must poll. SC's modern export endpoint has
// no separate messageId; the inspection_id is the idempotency key, so
// `pollPdfExport` simply replays the same POST.
async function requestPdfExport(auditId) {
  const res = await postExport(auditId);
  const url = extractDoneUrl(res);
  return { auditId, url };
}

async function pollPdfExport(auditId, handle, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  // Fast-path: requestPdfExport may have already completed in one call.
  if (handle && handle.url) return handle.url;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await postExport(auditId);
    const doneUrl = extractDoneUrl(res);
    if (doneUrl) return doneUrl;
    const status = (res.status || '').toUpperCase();
    if (status === 'STATUS_DONE' || status === 'SUCCESS' || status === 'COMPLETE' || status === 'COMPLETED') {
      // status said DONE but no URL in payload — surface as error rather than loop forever.
      throw new Error(`SC PDF export for ${auditId} reported DONE but no URL in response`);
    }
    if (status === 'STATUS_FAILED' || status === 'FAILED' || status === 'ERROR') {
      const info = Array.isArray(res.info) && res.info.length ? JSON.stringify(res.info).slice(0, 300) : (res.error || res.message || 'unknown');
      throw new Error(`SC PDF export for ${auditId} failed: ${info}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`SC PDF export for ${auditId} timed out after ${timeoutMs}ms`);
}

async function fetchPodPdf(auditId, log) {
  log?.(`[pod-auto-send] requesting PDF export for ${auditId}`);
  const handle = await requestPdfExport(auditId);
  const url = await pollPdfExport(auditId, handle);
  log?.(`[pod-auto-send] downloading PDF from ${url.slice(0, 80)}...`);
  return scFetchBinary(url);
}

module.exports = {
  scGet,
  searchAuditsByTemplate,
  getAudit,
  fetchPodPdf,
  // exported for the dry-run script
  requestPdfExport,
  pollPdfExport,
};
