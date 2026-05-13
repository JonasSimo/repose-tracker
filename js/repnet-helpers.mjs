// RepNet pure-function helpers — single source of truth for tests.
//
// These mirror the inline definitions in index.html. The inline copies stay
// for now because index.html has sync-loaded inline scripts that reference
// these helpers at parse time, and an ES module is deferred (would race the
// inline use). When we ship a proper bundle step, the inline copies become
// `window.X = X` mirrors of this module and the drift risk disappears.
//
// Until then: KEEP IN SYNC with the matching `function name(...)` definitions
// in index.html — every helper here has a sibling there. The vitest suite
// in `repnet-helpers.test.mjs` is the canonical behavioural spec; treat any
// disagreement between the inline copy and the module as a bug in the inline
// copy.

// SharePoint Date columns reject the millisecond component on writes when
// "Include time = No" is set. Trim ISO down to seconds. Default arg makes
// `isoNoMs()` (no args) safe.
export function isoNoMs(d) {
  const date = d instanceof Date ? d : new Date();
  return date.toISOString().slice(0, 19) + 'Z';
}

// SharePoint Online rejects file names containing these chars: ~ " # % & * : < > ? / \ { | }
// We replace each with a hyphen, collapse consecutive hyphens and runs of whitespace.
// Applied to the user-entered title before it's interpolated into the upload safeName.
export function sanitiseFileName(s) {
  return String(s == null ? '' : s)
    .replace(/[~"#%&*:<>?\/\\{|}]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Return the file extension (including dot), or '' if no dot present.
// Used when building rev-numbered upload filenames.
export function extOf(name) {
  const s = String(name == null ? '' : name);
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(i) : '';
}

// JSON.parse with a fallback. Used for fields stored as JSON strings in
// SharePoint (ApprovalState, ApprovalTimestamps, History). Never throws.
export function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// Empty approval-state shape used by Document Control. Kept as a factory
// (not a const) so callers always get a fresh, mutable object — otherwise
// in-place mutations would leak between docs.
export function emptyApprovalState() {
  return { approved: [], rejected: [], submittedAt: null, submittedBy: null };
}

// True if every email in the doc's Approvers list has approved this revision.
// Solo-QHSE docs (no Approvers) are always considered fully approved — they
// don't enter the multi-approver workflow at all.
export function isFullyApproved(doc) {
  const required = (doc?.approverEmails || []).map(e => String(e).toLowerCase());
  if (required.length === 0) return true;
  const approved = ((doc?.approvalState && doc.approvalState.approved) || [])
    .map(e => String(e).toLowerCase());
  return required.every(r => approved.includes(r));
}

// True if any approver has rejected this revision. Even a single rejection
// blocks promotion to Published and parks the doc in In Approval / In Review
// until QHSE resolves it.
export function isRejected(doc) {
  const rejected = ((doc?.approvalState && doc.approvalState.rejected) || [])
    .map(e => String(e).toLowerCase());
  return rejected.length > 0;
}

// ── Document Control helpers ──────────────────────────────────────────
// These five mirror the inline definitions in index.html for the Documents
// register. The inline copies read globals (current date, graphAccount,
// DOC_APPROVAL_DEPTS) directly so they stay 1-arg / no-arg for existing
// callers; the module exports take those as explicit parameters so vitest
// can drive them without DOM. Sync rule for these specifically: logic must
// match, signatures may differ — tests are the behavioural spec either way.
// They are intentionally NOT mirrored onto window (see block at the bottom):
// some — like isMyTurnToApprove — would mask the inline copy's global-read
// behaviour with an undefined `me` parameter and silently return false.

// Maps a SharePoint revision item to the internal shape used by the
// Document Control register. ApprovedBy is a Person field that comes back
// expanded as an array of objects with `.Email`. FileLink may be a
// hyperlink {Url, Description} or a bare string. Mirrors _mapRevItem in
// index.html; if you harden one (e.g. add string-array fallback for
// ApprovedBy), update both.
export function mapRevItem(item) {
  const f = (item && item.fields) || {};
  return {
    id: item ? item.id : undefined,
    docNumber: f.Title || '',
    revision: Number(f.Revision || 0),
    issueDate: f.IssueDate || null,
    approvedByEmails: Array.isArray(f.ApprovedBy) ? f.ApprovedBy.map(a => a.Email).filter(Boolean) : [],
    approvalTimestamps: f.ApprovalTimestamps ? safeJson(f.ApprovalTimestamps, []) : [],
    reasonForRevision: f.ReasonForRevision || '',
    triggeredBy: f.TriggeredBy || '',
    fileVersionId: f.FileVersionId || '',
    fileLink: (f.FileLink && f.FileLink.Url) || f.FileLink || '',
    changedFromRev: f.ChangedFromRev != null ? Number(f.ChangedFromRev) : null,
  };
}

// Builds the due-date label for a doc row in the register:
//   { cls: 'over' | 'warn' | '', text }
// `now` is injectable so tests can pick a deterministic frame of reference.
export function docsDueLabel(iso, now = new Date()) {
  if (!iso) return { cls: '', text: '—' };
  const days = Math.round((new Date(iso) - now) / 86400000);
  if (days < 0) return { cls: 'over', text: `${iso.slice(0, 10)} · overdue` };
  if (days <= 30) return { cls: 'warn', text: `${iso.slice(0, 10)} · ${days} days` };
  return { cls: '', text: iso.slice(0, 10) };
}

// Aggregates per-doc counts for the Documents KPI tiles. Returned shape:
//   { active, dueReview, pending, obsolete, byCat, byLvl, byDept, byStatus }
// dueReview only includes docs that are Published AND have a nextReviewDate
// within 0..30 days inclusive (future, not past — past-due is shown via the
// docsDueLabel "overdue" branch, not the dueReview tile).
export function docsCounts(docs, now = new Date()) {
  const counts = { active: 0, dueReview: 0, pending: 0, obsolete: 0, byCat: {}, byLvl: {}, byDept: {}, byStatus: {} };
  for (const d of (docs || [])) {
    counts.byCat[d.category] = (counts.byCat[d.category] || 0) + 1;
    counts.byLvl[d.level] = (counts.byLvl[d.level] || 0) + 1;
    counts.byStatus[d.status] = (counts.byStatus[d.status] || 0) + 1;
    for (const dp of (d.departments || [])) counts.byDept[dp] = (counts.byDept[dp] || 0) + 1;
    if (d.status === 'Published') counts.active++;
    if (d.status === 'In Approval') counts.pending++;
    if (d.status === 'Obsolete') counts.obsolete++;
    if (d.status === 'Published' && d.nextReviewDate) {
      const days = Math.round((new Date(d.nextReviewDate) - now) / 86400000);
      if (days >= 0 && days <= 30) counts.dueReview++;
    }
  }
  return counts;
}

// Merges department-based approvers + free-text individual emails into a
// deduped, lowercased list with the submitter themselves removed. `deptList`
// is the canonical dept → emails registry (DOC_APPROVAL_DEPTS in the app;
// fixtures in tests).
export function resolveDocApprovers(deptIds, freeTextEmails, selfEmail, deptList) {
  const list = deptList || [];
  const out = new Set();
  const self = String(selfEmail || '').toLowerCase();
  for (const id of (deptIds || [])) {
    const dep = list.find(d => d.id === id);
    if (!dep) continue;
    for (const e of (dep.emails || [])) {
      const v = String(e || '').trim().toLowerCase();
      if (v && v !== self) out.add(v);
    }
  }
  for (const raw of String(freeTextEmails || '').split(',')) {
    const v = raw.trim().toLowerCase();
    if (v && v !== self) out.add(v);
  }
  return Array.from(out);
}

// True when the signed-in user is one of a doc's required approvers and
// has neither approved nor rejected the current revision. `meEmail` is the
// caller-supplied identity — pass null/undefined to mean "no one signed in"
// and the function returns false (matches the inline copy when graphAccount
// is null).
export function isMyTurnToApprove(doc, meEmail) {
  if (!doc || doc.status !== 'In Approval') return false;
  const me = String(meEmail || '').toLowerCase();
  if (!me) return false;
  const required = (doc.approverEmails || []).map(e => String(e).toLowerCase());
  if (!required.includes(me)) return false;
  const state = doc.approvalState || emptyApprovalState();
  const approved = (state.approved || []).map(e => String(e).toLowerCase());
  const rejected = (state.rejected || []).map(e => String(e).toLowerCase());
  return !approved.includes(me) && !rejected.includes(me);
}

// ── Quality tab (CPAR / Internal NCR) helpers ─────────────────────────
// Mirrors of the CPAR pure helpers in index.html. The inline copies have
// `console.assert` self-tests that run at module load; these vitest tests
// supersede them but the inline assertions are left in place per the
// "keep parallel copies" pattern. As before: logic must match, signatures
// may differ for testability. These constants match the inline values:
const CPAR_REPEAT_WINDOW_DAYS = 30;
const CPAR_REPEAT_THRESHOLD = 3;   // 3rd or later occurrence triggers repeat flag
const CPAR_EFF_CHECK_DAYS = 30;

// Parses the three date string shapes used by the CPAR list. Returns
// `new Date(0)` (epoch) for falsy/unparseable input — callers test
// `.getTime() === 0` to detect "no date".
//   - "2024-01-15"            → local midnight (avoids BST off-by-one)
//   - "2024-01-15T10:00:00Z"  → native UTC parse
//   - "15/01/2024 14:30"      → local time (app-internal format)
//   - "15/01/2024"            → local midnight (time defaults to "00:00")
export function parseCPARDate(str) {
  if (!str) return new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    return isNaN(d) ? new Date(0) : d;
  }
  const [datePart, timePart = '00:00'] = String(str).split(' ');
  const [d, m, y] = datePart.split('/');
  if (!y) return new Date(0);
  return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart}:00`);
}

// Appends one event to the JSON-lines history string stored in CPAR's
// History column. Always overwrites `t` with the current time so callers
// can't backdate entries.
export function appendCPARHistory(currentHistory, event) {
  const line = JSON.stringify({ ...event, t: new Date().toISOString() });
  return currentHistory ? currentHistory + '\n' + line : line;
}

// Reads the JSON-lines history string back into an array. Unparseable
// lines become `{ t:'?', ev:'parse-error', raw: <line> }` so the audit
// trail never silently drops content.
export function parseCPARHistory(historyText) {
  if (!historyText) return [];
  return historyText.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return { t: '?', ev: 'parse-error', raw: l }; }
  });
}

// Detects a repeat issue: same PrimaryModel + CauseCode appearing
// CPAR_REPEAT_THRESHOLD times within CPAR_REPEAT_WINDOW_DAYS days. The
// candidate excludes itself from the count. Returns `{ isRepeat, linkedRefs }`.
export function detectRepeat(candidate, allItems, now = new Date()) {
  const model = (candidate.PrimaryModel || '').trim().toLowerCase();
  const cause = (candidate.CauseCode || '').trim();
  if (!model || !cause) return { isRepeat: false, linkedRefs: [] };
  const cutoff = new Date(now.getTime() - CPAR_REPEAT_WINDOW_DAYS * 86400000);
  const matches = (allItems || []).filter(i => {
    const f = i.fields || {};
    if (f.Title === candidate.Title) return false;
    if ((f.PrimaryModel || '').trim().toLowerCase() !== model) return false;
    if ((f.CauseCode || '').trim() !== cause) return false;
    const d = parseCPARDate(f.LoggedAt);
    return d.getTime() && d >= cutoff;
  });
  const isRepeat = matches.length >= (CPAR_REPEAT_THRESHOLD - 1);
  const linkedRefs = matches.map(i => i.fields.Title).filter(Boolean);
  return { isRepeat, linkedRefs };
}

// Effectiveness re-check is due CPAR_EFF_CHECK_DAYS after the CPAR was
// closed. Returns null when the closure date is missing/unparseable.
export function effCheckDueDate(closedAt) {
  const d = parseCPARDate(closedAt);
  if (!d.getTime()) return null;
  const due = new Date(d);
  due.setDate(due.getDate() + CPAR_EFF_CHECK_DAYS);
  return due;
}

// True once we're at or past the effectiveness re-check due date.
export function isEffCheckDue(closedAt, now = new Date()) {
  const due = effCheckDueDate(closedAt);
  return !!(due && due <= now);
}

// True more than a week past the effectiveness re-check due date.
export function isEffCheckOverdue(closedAt, now = new Date()) {
  const due = effCheckDueDate(closedAt);
  if (!due) return false;
  return (now - due) > 7 * 86400000;
}

// Working days (Mon-Fri) between two dates. Uses UTC arithmetic to avoid
// a +1 drift across BST/GMT transitions (the previous local-time loop
// returned 6 instead of 5 for Mon→Mon if it spanned spring-forward).
export function workingDaysBetween(start, end) {
  if (end <= start) return 0;
  let days = 0;
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const endUtc = new Date(end);
  endUtc.setUTCHours(0, 0, 0, 0);
  while (cur < endUtc) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) days++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Browser-global mirror so index.html inline scripts can reach these names
// once the module finishes loading. No-op in Node/vitest. Names match the
// existing inline conventions (_isoNoMs etc.) so callers stay unchanged.
// The five Document Control helpers above are intentionally NOT mirrored —
// see their block comment.
if (typeof window !== 'undefined') {
  window._isoNoMs = isoNoMs;
  window._sanitiseFileName = sanitiseFileName;
  window._extOf = extOf;
  window._safeJson = safeJson;
  window._emptyApprovalState = emptyApprovalState;
  window._isFullyApproved = isFullyApproved;
  window._isRejected = isRejected;
}
