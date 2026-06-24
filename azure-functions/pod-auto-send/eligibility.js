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
  // SC inspection must be explicitly Completed (date_completed is set when the
  // inspector taps Complete). Signatures on the form are NOT required —
  // signing usually happens on paper, so the SC record may not capture them.
  if (!ad.date_completed) return { eligible: false, reason: 'not complete' };
  return { eligible: true };
}

// Multi-REP: a single POD inspection can cover multiple chairs. Verified
// example: audit_706967680b68449c8f897df60f57051e has REPs 2616091 + 2616092.
// Walk every text-bearing field, gather all 7-digit serials, return as
// "REP NNNNNNN" strings in order of first appearance.
function extractAllRepSerials(audit) {
  const seen = new Set();
  const walk = (items) => {
    for (const it of items || []) {
      const r = it.responses || {};
      const text = [
        r.text, r.value,
        (r.selected || []).map(s => s.label || s.value).join(' '),
        it.label,
      ].filter(Boolean).join(' ');
      for (const m of text.matchAll(/(?<!\d)(\d{7})(?!\d)/g)) seen.add(m[1]);
      if (Array.isArray(it.children)) walk(it.children);
    }
  };
  walk(audit.header_items);
  walk(audit.items);
  const ad = audit.audit_data || {};
  for (const k of ['document_no', 'name', 'audit_title']) {
    for (const m of String(ad[k] || '').matchAll(/(?<!\d)(\d{7})(?!\d)/g)) seen.add(m[1]);
  }
  return [...seen].map(d => `REP ${d}`);
}

// Back-compat: returns the FIRST REP found, or null.
function extractRepSerial(audit) {
  return extractAllRepSerials(audit)[0] || null;
}

module.exports = {
  isAuditEligible,
  extractRepSerial,
  extractAllRepSerials,
  // exported for direct testing
  findItemByLabel,
  hasSignature,
};
