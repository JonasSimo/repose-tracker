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
async function scFetchBinary(url) {
  const res = await scFetch(url, {}, 60000);
  if (!res.ok) throw new Error(`SC binary GET ${res.status} on ${url}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
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

// Returns the "handle" used to drive polling. SC's modern export endpoint
// doesn't issue a separate messageId — the inspection_id itself is the
// idempotency key (same POST body = same export job), so we return the
// auditId. Kept as a function for compatibility with the planned interface.
async function requestPdfExport(auditId) {
  const res = await postExport(auditId);
  const status = (res.status || '').toUpperCase();
  if (status === 'STATUS_DONE' || status === 'SUCCESS' || status === 'COMPLETE' || status === 'COMPLETED') {
    // Already done on the first call — stash url so the poller can short-circuit.
    requestPdfExport._lastResult = { auditId, url: res.url || res.download_url || res.location };
  } else {
    requestPdfExport._lastResult = null;
  }
  return auditId;
}

async function pollPdfExport(auditId, _messageId, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  // Fast-path: requestPdfExport may have already completed in one call.
  if (requestPdfExport._lastResult && requestPdfExport._lastResult.auditId === auditId && requestPdfExport._lastResult.url) {
    const url = requestPdfExport._lastResult.url;
    requestPdfExport._lastResult = null;
    return url;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await postExport(auditId);
    const status = (res.status || '').toUpperCase();
    if (status === 'STATUS_DONE' || status === 'SUCCESS' || status === 'COMPLETE' || status === 'COMPLETED') {
      const url = res.url || res.download_url || res.location;
      if (!url) throw new Error(`SC PDF export for ${auditId} reported DONE but no URL in response`);
      return url;
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
  const messageId = await requestPdfExport(auditId);
  const url = await pollPdfExport(auditId, messageId);
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
