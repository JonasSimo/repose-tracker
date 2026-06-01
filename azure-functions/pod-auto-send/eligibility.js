'use strict';

// Pure functions for deciding which POD audits to send.
//
// Eligibility for trial send:
//   1. status flips to Complete in SC (ad.date_completed is set)
//   2. Both signatures are present:
//        - "Installed By (Signature)" item has a signature response
//        - "Chair accepted by (Signature)" item has a signature response
//   3. Not already in pod_send_log (handled by caller via PK conflict)
//
// REP extraction: POD has its own "REP Serial number" question that holds the
// 7-digit serial (no REP prefix). Reuses the safe lookbehind regex from
// feedback_word_boundary_regex — `\b` would mis-handle "REP2521107".

function normLabel(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function walkItems(audit) {
  const out = [];
  const walk = (items) => {
    for (const it of items || []) {
      out.push(it);
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.header_items || []);
  walk(audit.items || []);
  return out;
}

function findItemByLabel(audit, labelCandidates) {
  const targets = labelCandidates.map(normLabel);
  for (const it of walkItems(audit)) {
    const got = normLabel(it.label);
    if (!got) continue;
    if (targets.includes(got)) return it;
    for (const t of targets) {
      if ((got.startsWith(t) || t.startsWith(got)) && Math.abs(got.length - t.length) <= 2) return it;
    }
  }
  return null;
}

// True when a SC item of type "Signature" has a captured signature.
// Signature responses commonly look like:
//   { responses: { image: { media_id: "...", href: "..." } } }
// or { responses: { signature: { ... } } }. Be liberal — non-empty media
// object is good enough for trial mode.
function hasSignature(item) {
  if (!item) return false;
  const r = item.responses || {};
  if (r.image && (r.image.media_id || r.image.href)) return true;
  if (r.signature && (r.signature.media_id || r.signature.href)) return true;
  // Some signature questions also expose `media` at the item level
  if (Array.isArray(item.media) && item.media.length) return true;
  return false;
}

function isAuditEligible(audit) {
  const ad = audit.audit_data || {};
  if (audit.archived) return { eligible: false, reason: 'archived' };
  if (!ad.date_completed) return { eligible: false, reason: 'not complete' };

  const installed = findItemByLabel(audit, [
    'Installed By Signature', 'Installed By', 'Installed By:',
  ]);
  const accepted = findItemByLabel(audit, [
    'Chair accepted by Signature', 'Chair accepted by', 'Customer signature',
  ]);
  if (!hasSignature(installed)) return { eligible: false, reason: 'no installer signature' };
  if (!hasSignature(accepted))  return { eligible: false, reason: 'no customer signature' };
  return { eligible: true };
}

// Extract the 7-digit REP serial from the POD. Order:
//   1. Item labelled "REP Serial number" (or close variants)
//   2. ad.document_no
//   3. ad.name / audit_title
// Use lookbehind/lookahead to avoid matching jammed-prefix variants like
// "REP2621118" splitting wrong — we want the 7 digits regardless.
function extractRepSerial(audit) {
  const candidates = [];

  const item = findItemByLabel(audit, [
    'REP Serial number', 'Rep Serial number', 'REP Serial', 'Rep Serial', 'Serial number',
  ]);
  if (item?.responses) {
    const r = item.responses;
    if (typeof r.text === 'string') candidates.push(r.text);
    if (r.value != null) candidates.push(String(r.value));
  }

  const ad = audit.audit_data || {};
  if (ad.document_no) candidates.push(String(ad.document_no));
  if (ad.name) candidates.push(String(ad.name));
  if (ad.audit_title) candidates.push(String(ad.audit_title));

  for (const raw of candidates) {
    const m = String(raw).match(/(?<!\d)(\d{7})(?!\d)/);
    if (m) return `REP ${m[1]}`;
  }
  return null;
}

module.exports = {
  isAuditEligible,
  extractRepSerial,
  // exported for direct testing
  findItemByLabel,
  hasSignature,
};
