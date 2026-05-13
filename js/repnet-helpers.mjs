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

// ── CAPA (Corrective & Preventive Actions) helpers ────────────────────
// Mirrors the inline _capa* helpers in index.html. CAPA's list-on-Quality-
// site sits next to CPAR, but the helpers diverge from CPAR's: history is
// stored as a JSON *array* (not JSON-lines), date diffs zero out the time
// component, and SP column names are camelCased differently to JS-side
// names due to a SharePoint "Internal Name" normalisation quirk on first
// list creation.

// Status enum matching the inline `CAPA_STATUS` object.
const CAPA_STATUS = { OPEN: 'Open', PROGRESS: 'In Progress', VERIFY: 'Awaiting Verify', CLOSED: 'Closed' };

// SP internal column names diverge from the JS-side names. When a display
// name had a space ("Owner email"), SP normalised it to one word with the
// second word lowercased ("Owneremail"). Translate at the wire boundary.
const CAPA_SP_TO_JS = {
  Owneremail:    'OwnerEmail',
  Ownername:     'OwnerName',
  Ownerteam:     'OwnerTeam',
  Duedate:       'DueDate',
  Effectiveness: 'EffectivenessYN',
  Raisedby:      'RaisedBy',
  Raisedat:      'RaisedAt',
  Doneby:        'DoneBy',
  Doneat:        'DoneAt',
  Verifiedby:    'VerifiedBy',
  Verifiedat:    'VerifiedAt',
  Actionstaken:  'ActionsTaken',
};
const CAPA_JS_TO_SP = Object.fromEntries(
  Object.entries(CAPA_SP_TO_JS).map(([sp, js]) => [js, sp])
);

// Returns spFields with JS-friendly aliases added. NOTE: the original SP-
// cased keys are RETAINED alongside the new JS-cased aliases — callers
// rely on this; don't "clean up" by deleting the SP keys.
export function capaFieldsFromSP(spFields) {
  if (!spFields) return spFields;
  const out = { ...spFields };
  for (const [sp, js] of Object.entries(CAPA_SP_TO_JS)) {
    if (sp in out) out[js] = out[sp];
  }
  return out;
}

// Renames JS-side keys to their SP-internal equivalents. Unmapped keys
// (e.g. Title, Status, Area) pass through unchanged.
export function capaFieldsToSP(jsFields) {
  const out = {};
  for (const [k, v] of Object.entries(jsFields || {})) {
    out[CAPA_JS_TO_SP[k] || k] = v;
  }
  return out;
}

// Days between two dates ignoring the time component (so 23:59 Mon → 00:01
// Tue counts as 1 day, not 0).
export function capaDayDiff(a, b) {
  const A = new Date(a); A.setHours(0, 0, 0, 0);
  const B = new Date(b); B.setHours(0, 0, 0, 0);
  return Math.round((A.getTime() - B.getTime()) / 86400000);
}

// CSS class for the due-date cell colour in the CAPA table:
//   Closed              → 'green'
//   Awaiting Verify     → '' (owner has handed off — due no longer applies)
//   No DueDate          → ''
//   Past due            → 'red'
//   Within 3 days       → 'amber'
//   Else                → 'green'
export function capaDueClass(dueIso, status, now = new Date()) {
  if (status === CAPA_STATUS.CLOSED) return 'green';
  if (status === CAPA_STATUS.VERIFY) return '';
  if (!dueIso) return '';
  const diff = capaDayDiff(dueIso, now);
  if (diff < 0) return 'red';
  if (diff <= 3) return 'amber';
  return 'green';
}

// True iff the CAPA is past its DueDate AND still actionable by the owner
// (i.e. not Closed and not yet handed off to QHSE for verification).
export function capaIsOverdue(item, now = new Date()) {
  const f = (item && item.fields) || {};
  if (f.Status === CAPA_STATUS.CLOSED) return false;
  if (f.Status === CAPA_STATUS.VERIFY) return false;
  if (!f.DueDate) return false;
  return capaDayDiff(f.DueDate, now) < 0;
}

// True iff the CAPA was Closed within the last `days` days. Uses the
// VerifiedAt timestamp when present, falls back to DoneAt. Both are
// parsed via parseCPARDate to handle all three CPAR-list date shapes.
export function capaIsClosedRecent(item, days = 30, now = new Date()) {
  const f = (item && item.fields) || {};
  if (f.Status !== CAPA_STATUS.CLOSED) return false;
  const at = parseCPARDate(f.VerifiedAt || f.DoneAt);
  if (!at.getTime()) return false;
  return (now.getTime() - at.getTime()) <= days * 86400000;
}

// Appends an entry to CAPA's History column. Unlike CPAR (JSON-lines),
// CAPA stores history as a JSON-stringified array. Always overwrites
// `at` with the current time so callers can't backdate entries. Resilient
// to non-array existing values (rare manual SP edits).
export function appendCAPAHistory(existing, entry) {
  let arr = [];
  try { arr = existing ? JSON.parse(existing) : []; } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  arr.push({ ...entry, at: new Date().toISOString() });
  return JSON.stringify(arr);
}

// ── Team Views (production tracking) helpers ──────────────────────────
// Pure helpers from the team-view code path. Bank-holiday-aware helpers
// take an optional `holidays` set so tests can supply fixtures; defaults
// match the inline constants and current real-world list.

// UK bank-holiday list — must stay in sync with the inline copy in
// index.html. Format: `yyyy-mm-dd` local date strings.
const UK_BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

const PREP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TEAM_NAME_MAP = {
  'woodmill': 'Woodmill', 'wood mill': 'Woodmill',
  'cutting': 'Cutting', 'cutting room': 'Cutting',
  'sewing': 'Sewing', 'sewing room': 'Sewing',
  'upholstery': 'Upholstery', 'upholstery room': 'Upholstery',
  'upholstery arms': 'Upholstery Arms', 'upholstery backs': 'Upholstery Backs', 'upholstery seats': 'Upholstery Seats',
  'assembly': 'Assembly', 'assembly room': 'Assembly',
  'foam': 'Foam', 'foam room': 'Foam',
  'stores': 'Stores', 'stores room': 'Stores',
  'qc': 'QC', 'quality control': 'QC',
  'development': 'Development',
  'admin': 'Admin',
};

// Local yyyy-mm-dd key. Uses local date components so a BST-1am Date
// doesn't shift to the previous day under UTC.
export function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// DD/MM/YYYY string — the wc (week-commencing) format used throughout the
// production sheet wire format.
export function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ISO 8601 week number for a date. Thursday-of-the-week algorithm so the
// year boundary lands on weeks 52/53/1 correctly.
export function isoWeekNumber(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}

// ISO 8601 week-year — the year that the *ISO week* belongs to, which
// can differ from the calendar year around 01-Jan and 31-Dec.
export function isoWeekYear(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  return tmp.getUTCFullYear();
}

// Add/subtract N working days, skipping weekends and bank holidays.
// Returns a new Date — does not mutate the input.
export function addWorkdays(d, n, holidays = UK_BANK_HOLIDAYS) {
  const r = new Date(d);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    r.setDate(r.getDate() + step);
    if (r.getDay() !== 0 && r.getDay() !== 6 && !holidays.has(localDateKey(r))) remaining--;
  }
  return r;
}

// Working-day prep number for a date: 1-based count of working days from
// Monday-of-week through `d` inclusive, skipping weekends and bank
// holidays. Returns 0 if `d` is itself a non-working day.
//   Mon (normal)                   → 1
//   Tue (after bank-holiday Mon)   → 1
//   Wed (after bank-holiday Mon)   → 2
export function workingPrepNumber(d, holidays = UK_BANK_HOLIDAYS) {
  const dow = d.getDay();
  if (dow < 1 || dow > 5) return 0;
  if (holidays.has(localDateKey(d))) return 0;
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  let count = 0;
  for (let cur = new Date(mon); cur.getTime() <= d.getTime(); cur.setDate(cur.getDate() + 1)) {
    const cdow = cur.getDay();
    if (cdow >= 1 && cdow <= 5 && !holidays.has(localDateKey(cur))) count++;
  }
  return count;
}

// Day-of-week label ('Mon'..'Fri') for a given prep number in a given
// week, accounting for UK bank holidays. On wc 04/05/2026 (Mon = bank
// holiday) prep 1 → 'Tue', prep 2 → 'Wed', etc. Returns '—' when the
// prep doesn't fit a 4-day bank-holiday week. Falls back to the static
// PREP_DAYS list when the wc string is malformed.
export function prepDayLabel(wcDDMMYYYY, prepNum, holidays = UK_BANK_HOLIDAYS, prepDays = PREP_DAYS) {
  if (!wcDDMMYYYY || !/^\d{2}\/\d{2}\/\d{4}$/.test(wcDDMMYYYY) || !prepNum) {
    return prepDays[Number(prepNum) - 1] || '';
  }
  const [dd, mm, yyyy] = wcDDMMYYYY.split('/');
  const mon = new Date(+yyyy, +mm - 1, +dd);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const dow = d.getDay();
    if (dow < 1 || dow > 5) continue;
    if (holidays.has(localDateKey(d))) continue;
    count++;
    if (count === Number(prepNum)) return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][dow - 1];
  }
  return '—';
}

// Canonicalises a team name string into the in-app canonical form. Falls
// back to the trimmed input when no mapping matches (so unknown teams
// pass through rather than disappearing).
export function normaliseTeam(raw, teamMap = TEAM_NAME_MAP) {
  return teamMap[(raw || '').toLowerCase().trim()] || (raw || '').trim();
}

// Buckets jobs into prep day groups + an express bucket. If any normal
// job has a numeric `prep` field, those values are honoured exactly
// (null preps are skipped). If none do, the jobs are spread evenly
// across prep days 1-5 in array order.
export function distributeIntoPreps(jobs) {
  const preps = { 1: [], 2: [], 3: [], 4: [], 5: [], express: [] };
  const jo = j => ({ itemNo: j.itemNo, rep: j.rep, spec: j.spec, expressType: j.expressType || null, isService: j.isService || false });
  (jobs || []).filter(j => j.prep === 'express').forEach(j => preps.express.push(jo(j)));
  const normalJobs = (jobs || []).filter(j => j.prep !== 'express');
  const hasNumericPrep = normalJobs.some(j => typeof j.prep === 'number');
  if (hasNumericPrep) {
    normalJobs.forEach(j => {
      if (j.prep !== null && j.prep !== undefined) preps[j.prep].push(jo(j));
    });
  } else {
    const n = normalJobs.length;
    normalJobs.forEach((j, i) => {
      const p = n === 0 ? 1 : Math.min(5, Math.floor(i * 5 / n) + 1);
      preps[p].push(jo(j));
    });
  }
  return preps;
}

// ── Stats tab (KPI dashboard) helpers ─────────────────────────────────
// Pure helpers from the Stats tab code path. The inline copies read the
// module-level state vars (statsPeriod, statsNavOffset, STATS_OPERATORS,
// STATS_NO_PER_PERSON) directly; the module versions take those as
// explicit parameters so tests can drive them.

// DD/MM/YYYY → Date with strict validation. Rejects rollover anomalies
// (e.g. "31/02/2026" which JS would otherwise parse as 03/03/2026) and
// out-of-range numbers. Returns null on any unparseable input.
export function parseDdmmyyyy(str) {
  if (!str) return null;
  const parts = String(str).split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2200) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

// Computes the reference Date for a stats-tab period selection. Today
// and Yesterday ignore `offset`; week/day use 7-day or 1-day chunks;
// month uses calendar month; the default (unknown period) is the
// year-branch — Jan 1 of (year + offset).
export function statsRefDate(period, offset = 0, today = new Date()) {
  if (period === 'today') return new Date(today);
  if (period === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d; }
  if (period === 'week')  { const d = new Date(today); d.setDate(d.getDate() + offset * 7); return d; }
  if (period === 'month') return new Date(today.getFullYear(), today.getMonth() + offset, 1);
  if (period === 'day')   { const d = new Date(today); d.setDate(d.getDate() + offset); return d; }
  return new Date(today.getFullYear() + offset, 0, 1);
}

// True when the DD/MM/YYYY string `dateStr` falls inside the current
// stats period. `ref` is the prebuilt reference object — caller supplies
// `{ period, day, month, year, isoWk, isoYr }` (the inline copy caches
// this in `_statsRefCache` to avoid recomputing per-call across 30k+
// completions). Returns false for unparseable dates.
export function statsInPeriod(dateStr, ref) {
  const d = parseDdmmyyyy(dateStr);
  if (!d) return false;
  if (ref.period === 'today' || ref.period === 'yesterday' || ref.period === 'day') {
    return d.getDate() === ref.day && d.getMonth() === ref.month && d.getFullYear() === ref.year;
  }
  if (ref.period === 'week')  return isoWeekNumber(d) === ref.isoWk && isoWeekYear(d) === ref.isoYr;
  if (ref.period === 'month') return d.getMonth() === ref.month && d.getFullYear() === ref.year;
  return d.getFullYear() === ref.year;
}

// Tallies completions per team. Unknown / blank team falls under 'Unknown'.
export function statsCountByTeam(completions) {
  return (completions || []).reduce((acc, c) => {
    const t = (c && c.fields && c.fields.Team) || 'Unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
}

// Tallies completions per person, scoped per team (so 'AB' on Sewing
// and 'AB' on Assembly are separate rows). Teams in `noPerPerson` are
// skipped entirely — Woodmill and QC aren't tracked per-operator. The
// optional `operators` lookup resolves initials → full name; falls back
// to the initials themselves when no match. Output sorted by count desc.
export function statsCountByPerson(completions, options = {}) {
  const noPerPerson = options.noPerPerson || [];
  const operators   = options.operators   || {};
  const map = {};
  (completions || []).forEach(c => {
    const f = (c && c.fields) || {};
    if (noPerPerson.includes(f.Team)) return;
    const key = `${f.Team}__${f.Initials}`;
    if (!map[key]) map[key] = { team: f.Team, initials: f.Initials, count: 0 };
    map[key].count++;
  });
  return Object.values(map)
    .map(r => ({ ...r, name: (operators[r.team] && operators[r.team][r.initials]) || r.initials }))
    .sort((a, b) => b.count - a.count);
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
