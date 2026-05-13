import { describe, it, expect } from 'vitest';
import {
  isoNoMs,
  sanitiseFileName,
  extOf,
  safeJson,
  emptyApprovalState,
  isFullyApproved,
  isRejected,
  mapRevItem,
  docsDueLabel,
  docsCounts,
  resolveDocApprovers,
  isMyTurnToApprove,
  parseCPARDate,
  appendCPARHistory,
  parseCPARHistory,
  detectRepeat,
  effCheckDueDate,
  isEffCheckDue,
  isEffCheckOverdue,
  workingDaysBetween,
  capaFieldsFromSP,
  capaFieldsToSP,
  capaDayDiff,
  capaDueClass,
  capaIsOverdue,
  capaIsClosedRecent,
  appendCAPAHistory,
  localDateKey,
  ddmmyyyy,
  isoWeekNumber,
  isoWeekYear,
  addWorkdays,
  workingPrepNumber,
  prepDayLabel,
  normaliseTeam,
  distributeIntoPreps,
  parseDdmmyyyy,
  statsRefDate,
  statsInPeriod,
  statsCountByTeam,
  statsCountByPerson,
  mtAddDays,
  mtEnumerateDays,
  mtFreqDays,
  mtComputeYearlyStatus,
  mtComputeTeamStatusToday,
  serviceTicketMatches,
  serviceTicketCounts,
  computeServiceSlaRisk,
  computeServiceOverdueCount,
  computeServiceKpis,
  cpParseDmy,
  cpDayDiff,
  cpInitials,
  cpInvestigatorRole,
  cpCategoryClass,
  cpSlaBand,
  cpKpiAgg,
} from './repnet-helpers.mjs';

describe('isoNoMs', () => {
  it('strips milliseconds from a Date', () => {
    expect(isoNoMs(new Date('2026-05-12T14:23:45.678Z'))).toBe('2026-05-12T14:23:45Z');
  });

  it('formats a Date with no ms component the same way', () => {
    expect(isoNoMs(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00Z');
  });

  it('uses current time when called with no arg', () => {
    expect(isoNoMs()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('uses current time when called with null', () => {
    expect(isoNoMs(null)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('uses current time when called with undefined', () => {
    expect(isoNoMs(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('sanitiseFileName', () => {
  it('replaces SharePoint-illegal characters with hyphens', () => {
    expect(sanitiseFileName('foo:bar')).toBe('foo-bar');
    expect(sanitiseFileName('a/b\\c')).toBe('a-b-c');
    expect(sanitiseFileName('a#b%c&d')).toBe('a-b-c-d');
    expect(sanitiseFileName('a*b?c<d>e')).toBe('a-b-c-d-e');
    expect(sanitiseFileName('a{b|c}d~e')).toBe('a-b-c-d-e');
    expect(sanitiseFileName('a"b')).toBe('a-b');
  });

  it('collapses consecutive hyphens into one', () => {
    expect(sanitiseFileName('a::b')).toBe('a-b');
    expect(sanitiseFileName('a---b')).toBe('a-b');
    expect(sanitiseFileName('a-/-b')).toBe('a-b');
  });

  it('collapses runs of whitespace into a single space', () => {
    expect(sanitiseFileName('foo   bar')).toBe('foo bar');
    expect(sanitiseFileName('foo\t\nbar')).toBe('foo bar');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitiseFileName('  foo  ')).toBe('foo');
  });

  it('handles null, undefined, and non-strings gracefully', () => {
    expect(sanitiseFileName(null)).toBe('');
    expect(sanitiseFileName(undefined)).toBe('');
    expect(sanitiseFileName(123)).toBe('123');
  });

  it('preserves normal alphanumerics and safe punctuation', () => {
    expect(sanitiseFileName('PHCF-203 - Engineering Change')).toBe('PHCF-203 - Engineering Change');
    expect(sanitiseFileName('REPO_Q027.docx')).toBe('REPO_Q027.docx');
  });
});

describe('extOf', () => {
  it('returns the extension including the dot', () => {
    expect(extOf('foo.docx')).toBe('.docx');
    expect(extOf('archive.tar.gz')).toBe('.gz');
    expect(extOf('UPPER.PDF')).toBe('.PDF');
  });

  it('returns empty string when there is no dot', () => {
    expect(extOf('README')).toBe('');
    expect(extOf('')).toBe('');
  });

  it('handles paths with dots in directories', () => {
    expect(extOf('folder.v2/file.docx')).toBe('.docx');
  });

  it('handles null and undefined safely', () => {
    expect(extOf(null)).toBe('');
    expect(extOf(undefined)).toBe('');
  });
});

describe('safeJson', () => {
  it('parses valid JSON', () => {
    expect(safeJson('{"a":1}', null)).toEqual({ a: 1 });
    expect(safeJson('[1,2,3]', null)).toEqual([1, 2, 3]);
    expect(safeJson('"hello"', null)).toBe('hello');
  });

  it('returns the fallback on malformed JSON', () => {
    expect(safeJson('{not json}', { default: true })).toEqual({ default: true });
    expect(safeJson('undefined', 'fb')).toBe('fb');
  });

  it('passes null through (JSON.parse(null) returns null, no throw)', () => {
    // Documents the SharePoint quirk: fields stored as JSON strings come
    // back null when never written, and the caller code (ApprovalState etc.)
    // already handles null with `?? emptyApprovalState()` upstream.
    expect(safeJson(null, 'fb')).toBe(null);
  });

  it('returns the fallback when input is undefined (JSON.parse(undefined) throws)', () => {
    expect(safeJson(undefined, [])).toEqual([]);
  });

  it('treats the empty string as malformed and returns fallback', () => {
    expect(safeJson('', 0)).toBe(0);
  });
});

describe('emptyApprovalState', () => {
  it('returns the expected empty shape', () => {
    expect(emptyApprovalState()).toEqual({
      approved: [],
      rejected: [],
      submittedAt: null,
      submittedBy: null,
    });
  });

  it('returns a fresh object each call (no aliasing)', () => {
    const a = emptyApprovalState();
    const b = emptyApprovalState();
    a.approved.push('someone@example.com');
    expect(b.approved).toEqual([]);
  });
});

describe('isFullyApproved', () => {
  it('returns true when there are no required approvers (solo QHSE)', () => {
    expect(isFullyApproved({ approverEmails: [] })).toBe(true);
    expect(isFullyApproved({})).toBe(true);
  });

  it('returns true when every required approver is in approved[]', () => {
    expect(isFullyApproved({
      approverEmails: ['a@x.com', 'b@x.com'],
      approvalState: { approved: ['a@x.com', 'b@x.com'], rejected: [] },
    })).toBe(true);
  });

  it('returns false when at least one required approver has not approved', () => {
    expect(isFullyApproved({
      approverEmails: ['a@x.com', 'b@x.com'],
      approvalState: { approved: ['a@x.com'], rejected: [] },
    })).toBe(false);
  });

  it('is case-insensitive on email comparisons', () => {
    expect(isFullyApproved({
      approverEmails: ['Foo@Bar.com'],
      approvalState: { approved: ['foo@bar.com'], rejected: [] },
    })).toBe(true);
  });

  it('handles missing approvalState gracefully', () => {
    expect(isFullyApproved({ approverEmails: ['a@x.com'] })).toBe(false);
  });
});

describe('isRejected', () => {
  it('returns false when rejected[] is empty', () => {
    expect(isRejected({ approvalState: { approved: [], rejected: [] } })).toBe(false);
  });

  it('returns true when any approver has rejected', () => {
    expect(isRejected({ approvalState: { approved: [], rejected: ['a@x.com'] } })).toBe(true);
  });

  it('handles missing approvalState gracefully', () => {
    expect(isRejected({})).toBe(false);
    expect(isRejected(null)).toBe(false);
  });
});

// ── Document Control register helpers ────────────────────────────────────

describe('mapRevItem', () => {
  it('returns sensible defaults when fields are absent', () => {
    const out = mapRevItem({ id: '7', fields: {} });
    expect(out).toEqual({
      id: '7',
      docNumber: '',
      revision: 0,
      issueDate: null,
      approvedByEmails: [],
      approvalTimestamps: [],
      reasonForRevision: '',
      triggeredBy: '',
      fileVersionId: '',
      fileLink: '',
      changedFromRev: null,
    });
  });

  it('maps a fully-populated SharePoint revision item', () => {
    const out = mapRevItem({
      id: '42',
      fields: {
        Title: 'REPO-Q027',
        Revision: 3,
        IssueDate: '2026-05-01',
        ApprovedBy: [{ Email: 'a@x.com' }, { Email: 'b@x.com' }],
        ApprovalTimestamps: '[{"email":"a@x.com","at":"2026-05-01T09:00:00Z"}]',
        ReasonForRevision: 'updated foam grade',
        TriggeredBy: 'jonas.simonaitis@reposefurniture.co.uk',
        FileVersionId: '4.0',
        FileLink: { Url: 'https://x/file.docx', Description: 'file.docx' },
        ChangedFromRev: 2,
      },
    });
    expect(out.docNumber).toBe('REPO-Q027');
    expect(out.revision).toBe(3);
    expect(out.issueDate).toBe('2026-05-01');
    expect(out.approvedByEmails).toEqual(['a@x.com', 'b@x.com']);
    expect(out.approvalTimestamps).toEqual([{ email: 'a@x.com', at: '2026-05-01T09:00:00Z' }]);
    expect(out.fileLink).toBe('https://x/file.docx');
    expect(out.changedFromRev).toBe(2);
  });

  it('filters entries with empty Email', () => {
    const out = mapRevItem({ id: '1', fields: { ApprovedBy: [{ Email: 'a@x.com' }, { Email: '' }] } });
    expect(out.approvedByEmails).toEqual(['a@x.com']);
  });

  it('returns [] when ApprovedBy is not an array', () => {
    expect(mapRevItem({ id: '1', fields: { ApprovedBy: null } }).approvedByEmails).toEqual([]);
    expect(mapRevItem({ id: '1', fields: { ApprovedBy: 'a@x.com' } }).approvedByEmails).toEqual([]);
  });

  it('falls back to [] on malformed ApprovalTimestamps JSON', () => {
    const out = mapRevItem({ id: '1', fields: { ApprovalTimestamps: '{not json' } });
    expect(out.approvalTimestamps).toEqual([]);
  });

  it('accepts FileLink as a bare string', () => {
    const out = mapRevItem({ id: '1', fields: { FileLink: 'https://x/y.pdf' } });
    expect(out.fileLink).toBe('https://x/y.pdf');
  });

  it('coerces Revision to a number even when stored as a string', () => {
    const out = mapRevItem({ id: '1', fields: { Revision: '5' } });
    expect(out.revision).toBe(5);
  });

  it('preserves null vs 0 for ChangedFromRev', () => {
    expect(mapRevItem({ id: '1', fields: { ChangedFromRev: 0 } }).changedFromRev).toBe(0);
    expect(mapRevItem({ id: '1', fields: {} }).changedFromRev).toBe(null);
  });
});

describe('docsDueLabel', () => {
  const today = new Date('2026-05-12T00:00:00Z');

  it("returns '—' for null/empty", () => {
    expect(docsDueLabel(null, today)).toEqual({ cls: '', text: '—' });
    expect(docsDueLabel('', today)).toEqual({ cls: '', text: '—' });
  });

  it('marks past dates as overdue', () => {
    const out = docsDueLabel('2026-05-10', today);
    expect(out.cls).toBe('over');
    expect(out.text).toBe('2026-05-10 · overdue');
  });

  it('marks today as warn with 0 days', () => {
    expect(docsDueLabel('2026-05-12', today)).toEqual({ cls: 'warn', text: '2026-05-12 · 0 days' });
  });

  it('marks dates within 30 days as warn', () => {
    expect(docsDueLabel('2026-05-15', today)).toEqual({ cls: 'warn', text: '2026-05-15 · 3 days' });
    expect(docsDueLabel('2026-06-11', today)).toEqual({ cls: 'warn', text: '2026-06-11 · 30 days' });
  });

  it('marks dates beyond 30 days with no class', () => {
    expect(docsDueLabel('2026-06-12', today)).toEqual({ cls: '', text: '2026-06-12' });
    expect(docsDueLabel('2027-05-12', today)).toEqual({ cls: '', text: '2027-05-12' });
  });

  it('only renders the date portion (no time) in the label', () => {
    const out = docsDueLabel('2026-06-30T14:23:45Z', today);
    expect(out.text).toBe('2026-06-30');
  });
});

describe('docsCounts', () => {
  const now = new Date('2026-05-12T00:00:00Z');

  it('returns all zeros for an empty list', () => {
    expect(docsCounts([], now)).toEqual({
      active: 0, dueReview: 0, pending: 0, obsolete: 0,
      byCat: {}, byLvl: {}, byDept: {}, byStatus: {},
    });
  });

  it('handles null / undefined input safely', () => {
    expect(docsCounts(null, now).active).toBe(0);
    expect(docsCounts(undefined, now).pending).toBe(0);
  });

  it('counts active / pending / obsolete by status', () => {
    const c = docsCounts([
      { status: 'Published',   category: 'Procedure', level: 'A', departments: ['Sewing'] },
      { status: 'Published',   category: 'Procedure', level: 'A', departments: ['QC'] },
      { status: 'In Approval', category: 'Form',      level: 'B', departments: ['Sewing'] },
      { status: 'Obsolete',    category: 'Form',      level: 'B', departments: [] },
    ], now);
    expect(c.active).toBe(2);
    expect(c.pending).toBe(1);
    expect(c.obsolete).toBe(1);
  });

  it('counts dueReview only for Published docs within 30 future days', () => {
    const c = docsCounts([
      { status: 'Published',   nextReviewDate: '2026-05-25' },  // 13 days → in
      { status: 'Published',   nextReviewDate: '2026-06-11' },  // 30 days → in (boundary)
      { status: 'Published',   nextReviewDate: '2026-06-12' },  // 31 days → out
      { status: 'Published',   nextReviewDate: '2026-05-01' },  // past → out (overdue, not "due soon")
      { status: 'In Approval', nextReviewDate: '2026-05-20' },  // not Published → out
      { status: 'Published' },                                   // no date → out
    ], now);
    expect(c.dueReview).toBe(2);
  });

  it('aggregates by category, level and status', () => {
    const c = docsCounts([
      { status: 'Published', category: 'Procedure', level: 'A', departments: ['Sewing'] },
      { status: 'Published', category: 'Procedure', level: 'B', departments: ['QC'] },
      { status: 'Obsolete',  category: 'Form',      level: 'A', departments: ['Sewing'] },
    ], now);
    expect(c.byCat).toEqual({ Procedure: 2, Form: 1 });
    expect(c.byLvl).toEqual({ A: 2, B: 1 });
    expect(c.byStatus).toEqual({ Published: 2, Obsolete: 1 });
  });

  it('counts a doc against every department it applies to', () => {
    const c = docsCounts([
      { status: 'Published', category: 'P', level: 'A', departments: ['Sewing', 'QC', 'Assembly'] },
      { status: 'Published', category: 'P', level: 'A', departments: ['Sewing'] },
    ], now);
    expect(c.byDept).toEqual({ Sewing: 2, QC: 1, Assembly: 1 });
  });
});

describe('resolveDocApprovers', () => {
  const deptList = [
    { id: 'Cutting',    label: 'Cutting',    emails: ['cut@x.com'] },
    { id: 'Sewing',     label: 'Sewing',     emails: ['sew@x.com'] },
    { id: 'SeniorMgmt', label: 'Senior Mgmt', emails: ['boss1@x.com', 'boss2@x.com'] },
  ];

  it('returns [] when nothing is selected', () => {
    expect(resolveDocApprovers([], '', 'me@x.com', deptList)).toEqual([]);
    expect(resolveDocApprovers(null, null, 'me@x.com', deptList)).toEqual([]);
  });

  it('resolves a single department to its lead email', () => {
    expect(resolveDocApprovers(['Sewing'], '', 'me@x.com', deptList)).toEqual(['sew@x.com']);
  });

  it('resolves a multi-email department (e.g. SeniorMgmt) into both', () => {
    expect(resolveDocApprovers(['SeniorMgmt'], '', 'me@x.com', deptList))
      .toEqual(['boss1@x.com', 'boss2@x.com']);
  });

  it('parses comma-separated free-text emails and trims whitespace', () => {
    expect(resolveDocApprovers([], '  a@x.com , b@x.com,  ,c@x.com', 'me@x.com', deptList))
      .toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('dedupes when the same address appears in both a dept and free-text', () => {
    expect(resolveDocApprovers(['Sewing'], 'sew@x.com, extra@x.com', 'me@x.com', deptList))
      .toEqual(['sew@x.com', 'extra@x.com']);
  });

  it("excludes the submitter's own email from both sources", () => {
    expect(resolveDocApprovers(['Sewing'], 'sew@x.com, me@x.com', 'me@x.com', deptList))
      .toEqual(['sew@x.com']);
  });

  it('compares self case-insensitively', () => {
    expect(resolveDocApprovers([], 'Foo@X.com,me@x.com', 'ME@X.COM', deptList))
      .toEqual(['foo@x.com']);
  });

  it('lowercases all output addresses', () => {
    expect(resolveDocApprovers([], 'Foo@X.com', 'me@x.com', deptList))
      .toEqual(['foo@x.com']);
  });

  it('silently ignores unknown department IDs', () => {
    expect(resolveDocApprovers(['NoSuchDept', 'Sewing'], '', 'me@x.com', deptList))
      .toEqual(['sew@x.com']);
  });

  it('handles a missing deptList (defaults to empty registry)', () => {
    expect(resolveDocApprovers(['Sewing'], 'a@x.com', 'me@x.com')).toEqual(['a@x.com']);
  });
});

describe('isMyTurnToApprove', () => {
  const baseDoc = {
    status: 'In Approval',
    approverEmails: ['a@x.com', 'b@x.com'],
    approvalState: { approved: [], rejected: [], submittedAt: null, submittedBy: null },
  };

  it('returns false when the doc is not in approval', () => {
    expect(isMyTurnToApprove({ ...baseDoc, status: 'Published' }, 'a@x.com')).toBe(false);
    expect(isMyTurnToApprove({ ...baseDoc, status: 'Draft' }, 'a@x.com')).toBe(false);
  });

  it('returns false when no user identity is provided', () => {
    expect(isMyTurnToApprove(baseDoc, null)).toBe(false);
    expect(isMyTurnToApprove(baseDoc, '')).toBe(false);
    expect(isMyTurnToApprove(baseDoc, undefined)).toBe(false);
  });

  it('returns false when the user is not a required approver', () => {
    expect(isMyTurnToApprove(baseDoc, 'stranger@x.com')).toBe(false);
  });

  it('returns false when the user has already approved this revision', () => {
    const doc = { ...baseDoc, approvalState: { approved: ['a@x.com'], rejected: [] } };
    expect(isMyTurnToApprove(doc, 'a@x.com')).toBe(false);
  });

  it('returns false when the user has already rejected this revision', () => {
    const doc = { ...baseDoc, approvalState: { approved: [], rejected: ['a@x.com'] } };
    expect(isMyTurnToApprove(doc, 'a@x.com')).toBe(false);
  });

  it('returns true when the user is a required approver and has not yet acted', () => {
    expect(isMyTurnToApprove(baseDoc, 'a@x.com')).toBe(true);
    expect(isMyTurnToApprove(baseDoc, 'b@x.com')).toBe(true);
  });

  it('is case-insensitive on email comparisons', () => {
    const doc = { ...baseDoc, approverEmails: ['Foo@Bar.com'] };
    expect(isMyTurnToApprove(doc, 'foo@bar.com')).toBe(true);
    expect(isMyTurnToApprove(doc, 'FOO@bar.com')).toBe(true);
  });

  it('handles a missing approvalState (treats as fresh, no prior action)', () => {
    const doc = { status: 'In Approval', approverEmails: ['a@x.com'] };
    expect(isMyTurnToApprove(doc, 'a@x.com')).toBe(true);
  });

  it('returns false for a null/undefined doc', () => {
    expect(isMyTurnToApprove(null, 'a@x.com')).toBe(false);
    expect(isMyTurnToApprove(undefined, 'a@x.com')).toBe(false);
  });
});

// ── Quality tab (CPAR / Internal NCR) helpers ────────────────────────────

describe('parseCPARDate', () => {
  it('returns the epoch (Date(0)) for falsy input', () => {
    expect(parseCPARDate('').getTime()).toBe(0);
    expect(parseCPARDate(null).getTime()).toBe(0);
    expect(parseCPARDate(undefined).getTime()).toBe(0);
  });

  it('parses bare ISO dates as local midnight (avoids BST off-by-one)', () => {
    const d = parseCPARDate('2026-05-12');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(0);
  });

  it('parses ISO date-times via the native parser (UTC zulu)', () => {
    const d = parseCPARDate('2026-05-12T14:30:00Z');
    expect(d.toISOString()).toBe('2026-05-12T14:30:00.000Z');
  });

  it('returns epoch for an ISO-shaped but unparseable string', () => {
    expect(parseCPARDate('2026-99-99T00:00:00Z').getTime()).toBe(0);
  });

  it('parses the app-internal DD/MM/YYYY HH:MM format', () => {
    const d = parseCPARDate('15/01/2026 14:30');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });

  it('defaults time to 00:00 when DD/MM/YYYY has no time portion', () => {
    const d = parseCPARDate('15/01/2026');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it('returns epoch for garbage with no year part', () => {
    expect(parseCPARDate('not a date').getTime()).toBe(0);
    expect(parseCPARDate('15').getTime()).toBe(0);
  });
});

describe('appendCPARHistory + parseCPARHistory', () => {
  it('appends to empty history without a leading newline', () => {
    const out = appendCPARHistory('', { by: 'a@x.com', ev: 'raised' });
    expect(out.includes('\n')).toBe(false);
    expect(JSON.parse(out).ev).toBe('raised');
  });

  it('appends to existing history with a newline separator', () => {
    const first = appendCPARHistory('', { by: 'a@x.com', ev: 'raised' });
    const both  = appendCPARHistory(first, { by: 'a@x.com', ev: 'closed-out' });
    expect(both.split('\n').length).toBe(2);
  });

  it('always overwrites the caller-supplied `t` with the current time', () => {
    const out = appendCPARHistory('', { by: 'a@x.com', ev: 'raised', t: '1999-01-01' });
    const parsed = JSON.parse(out);
    expect(parsed.t).not.toBe('1999-01-01');
    expect(parsed.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('round-trips through parseCPARHistory in order', () => {
    let h = appendCPARHistory('', { ev: 'raised' });
    h = appendCPARHistory(h, { ev: 'pe-submitted' });
    h = appendCPARHistory(h, { ev: 'closed-out' });
    const parsed = parseCPARHistory(h);
    expect(parsed.map(e => e.ev)).toEqual(['raised', 'pe-submitted', 'closed-out']);
  });

  it('returns [] for empty/null history', () => {
    expect(parseCPARHistory('')).toEqual([]);
    expect(parseCPARHistory(null)).toEqual([]);
  });

  it('preserves malformed lines as parse-error stubs (audit trail never silently drops)', () => {
    const text = '{"ev":"good"}\n{not json}\n{"ev":"also good"}';
    const parsed = parseCPARHistory(text);
    expect(parsed.length).toBe(3);
    expect(parsed[0].ev).toBe('good');
    expect(parsed[1]).toEqual({ t: '?', ev: 'parse-error', raw: '{not json}' });
    expect(parsed[2].ev).toBe('also good');
  });

  it('filters empty lines (e.g. trailing newline)', () => {
    const parsed = parseCPARHistory('{"ev":"x"}\n\n');
    expect(parsed.length).toBe(1);
  });
});

describe('detectRepeat', () => {
  const now = new Date('2026-04-27T10:00:00Z');
  const make = (ref, model, cause, daysAgo) => ({
    fields: {
      Title: ref,
      PrimaryModel: model,
      CauseCode: cause,
      LoggedAt: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
    },
  });
  const items = [
    make('RP-1', 'Scroll Arm', 'Human Error', 5),
    make('RP-2', 'Scroll Arm', 'Human Error', 12),
    make('RP-3', 'Mocara',     'Human Error', 2),
    make('RP-4', 'Scroll Arm', 'Material Defect', 3),
    make('RP-5', 'Scroll Arm', 'Human Error', 45), // outside 30-day window
  ];

  it('flags a 3rd occurrence (candidate + 2 priors) as a repeat', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'Scroll Arm', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.isRepeat).toBe(true);
    expect(r.linkedRefs.sort()).toEqual(['RP-1', 'RP-2']);
  });

  it('does NOT flag a 2nd occurrence (candidate + 1 prior) as a repeat', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'Mocara', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.isRepeat).toBe(false);
  });

  it('returns isRepeat:false when model is empty', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: '', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.isRepeat).toBe(false);
    expect(r.linkedRefs).toEqual([]);
  });

  it('returns isRepeat:false when cause is empty', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'Scroll Arm', CauseCode: '' },
      items, now,
    );
    expect(r.isRepeat).toBe(false);
  });

  it('excludes priors older than the 30-day window', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'Scroll Arm', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.linkedRefs).not.toContain('RP-5');
  });

  it('excludes the candidate itself when it matches by Title', () => {
    const r = detectRepeat(
      { Title: 'RP-1', PrimaryModel: 'Scroll Arm', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.linkedRefs).not.toContain('RP-1');
  });

  it('compares model case-insensitively', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'SCROLL ARM', CauseCode: 'Human Error' },
      items, now,
    );
    expect(r.linkedRefs.sort()).toEqual(['RP-1', 'RP-2']);
  });

  it('handles a null/undefined item list', () => {
    const r = detectRepeat(
      { Title: 'RP-NEW', PrimaryModel: 'Scroll Arm', CauseCode: 'Human Error' },
      null, now,
    );
    expect(r.isRepeat).toBe(false);
  });
});

describe('effCheckDueDate / isEffCheckDue / isEffCheckOverdue', () => {
  it('returns null when closedAt is missing or unparseable', () => {
    expect(effCheckDueDate('')).toBe(null);
    expect(effCheckDueDate(null)).toBe(null);
    expect(effCheckDueDate('not a date')).toBe(null);
  });

  it('returns a date exactly 30 days after closure', () => {
    const due = effCheckDueDate('2026-04-01T10:00:00Z');
    expect(due.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('isEffCheckDue returns false before the 30-day mark', () => {
    const closed = '2026-04-01T10:00:00Z';
    expect(isEffCheckDue(closed, new Date('2026-04-15T10:00:00Z'))).toBe(false);
  });

  it('isEffCheckDue returns true at or after the 30-day mark', () => {
    const closed = '2026-04-01T10:00:00Z';
    expect(isEffCheckDue(closed, new Date('2026-05-01T10:00:00Z'))).toBe(true);
    expect(isEffCheckDue(closed, new Date('2026-05-02T10:00:00Z'))).toBe(true);
  });

  it('isEffCheckDue returns false when closedAt is missing', () => {
    expect(isEffCheckDue('', new Date())).toBe(false);
  });

  it('isEffCheckOverdue returns false within 7 days of the due date', () => {
    const closed = '2026-04-01T10:00:00Z';
    expect(isEffCheckOverdue(closed, new Date('2026-05-04T10:00:00Z'))).toBe(false); // 33 days
    expect(isEffCheckOverdue(closed, new Date('2026-05-08T10:00:00Z'))).toBe(false); // 37 days exactly
  });

  it('isEffCheckOverdue returns true more than 7 days past due', () => {
    const closed = '2026-04-01T10:00:00Z';
    expect(isEffCheckOverdue(closed, new Date('2026-05-09T10:00:00Z'))).toBe(true); // 38 days
  });

  it('isEffCheckOverdue returns false when closedAt is missing', () => {
    expect(isEffCheckOverdue('', new Date())).toBe(false);
  });
});

describe('workingDaysBetween', () => {
  it('returns 0 when end <= start', () => {
    expect(workingDaysBetween(new Date('2026-05-12'), new Date('2026-05-12'))).toBe(0);
    expect(workingDaysBetween(new Date('2026-05-12'), new Date('2026-05-10'))).toBe(0);
  });

  it('counts Mon→Mon as 5 working days', () => {
    expect(workingDaysBetween(
      new Date('2026-04-27T00:00:00Z'), // Monday
      new Date('2026-05-04T00:00:00Z'), // Monday
    )).toBe(5);
  });

  it('counts Mon→Tue as 1 working day', () => {
    expect(workingDaysBetween(
      new Date('2026-04-27T00:00:00Z'),
      new Date('2026-04-28T00:00:00Z'),
    )).toBe(1);
  });

  it('skips the weekend (Fri→Mon = 1)', () => {
    expect(workingDaysBetween(
      new Date('2026-05-01T00:00:00Z'), // Friday
      new Date('2026-05-04T00:00:00Z'), // Monday
    )).toBe(1);
  });

  it('survives the BST→GMT autumn rollback', () => {
    // 2026-10-25 is the last Sunday of October. Span the boundary; the
    // count should not gain or lose a day.
    expect(workingDaysBetween(
      new Date('2026-10-23T00:00:00Z'), // Friday before fallback
      new Date('2026-10-26T00:00:00Z'), // Monday after fallback
    )).toBe(1);
  });

  it('survives the GMT→BST spring-forward', () => {
    // 2026-03-29 spring forward. Mon→Mon should still be 5.
    expect(workingDaysBetween(
      new Date('2026-03-23T00:00:00Z'),
      new Date('2026-03-30T00:00:00Z'),
    )).toBe(5);
  });
});

// ── CAPA (Corrective & Preventive Actions) helpers ───────────────────────

describe('capaFieldsFromSP', () => {
  it('returns the input as-is for null/undefined', () => {
    expect(capaFieldsFromSP(null)).toBe(null);
    expect(capaFieldsFromSP(undefined)).toBe(undefined);
  });

  it('returns an empty object for {}', () => {
    expect(capaFieldsFromSP({})).toEqual({});
  });

  it('adds JS-cased aliases for known SP-cased columns', () => {
    const out = capaFieldsFromSP({ Owneremail: 'a@x.com', Duedate: '2026-06-01' });
    expect(out.OwnerEmail).toBe('a@x.com');
    expect(out.DueDate).toBe('2026-06-01');
  });

  it('RETAINS the original SP-cased keys alongside the JS aliases', () => {
    const out = capaFieldsFromSP({ Owneremail: 'a@x.com' });
    expect(out.Owneremail).toBe('a@x.com');
    expect(out.OwnerEmail).toBe('a@x.com');
  });

  it('passes unmapped columns through unchanged', () => {
    const out = capaFieldsFromSP({ Title: 'CAPA-26-001', Status: 'Open', Area: 'Quality' });
    expect(out).toEqual({ Title: 'CAPA-26-001', Status: 'Open', Area: 'Quality' });
  });

  it('does not mutate the input object', () => {
    const input = { Owneremail: 'a@x.com' };
    capaFieldsFromSP(input);
    expect(input).toEqual({ Owneremail: 'a@x.com' });
  });
});

describe('capaFieldsToSP', () => {
  it('returns {} for null/undefined input', () => {
    expect(capaFieldsToSP(null)).toEqual({});
    expect(capaFieldsToSP(undefined)).toEqual({});
  });

  it('renames JS-side keys to SP-internal names', () => {
    expect(capaFieldsToSP({ OwnerEmail: 'a@x.com', DueDate: '2026-06-01' }))
      .toEqual({ Owneremail: 'a@x.com', Duedate: '2026-06-01' });
  });

  it('passes unmapped keys (Title, Status, Area) through unchanged', () => {
    expect(capaFieldsToSP({ Title: 'CAPA-26-001', Status: 'Open' }))
      .toEqual({ Title: 'CAPA-26-001', Status: 'Open' });
  });

  it('round-trips with capaFieldsFromSP for the JS-cased subset', () => {
    const js = { OwnerEmail: 'a@x.com', DueDate: '2026-06-01', Title: 'CAPA-26-001' };
    const sp = capaFieldsToSP(js);
    const back = capaFieldsFromSP(sp);
    expect(back.OwnerEmail).toBe('a@x.com');
    expect(back.DueDate).toBe('2026-06-01');
    expect(back.Title).toBe('CAPA-26-001');
  });
});

describe('capaDayDiff', () => {
  it('returns 0 for the same date', () => {
    expect(capaDayDiff('2026-05-12', '2026-05-12')).toBe(0);
  });

  it('returns a positive count when A is later than B', () => {
    expect(capaDayDiff('2026-05-15', '2026-05-12')).toBe(3);
  });

  it('returns a negative count when A is earlier than B', () => {
    expect(capaDayDiff('2026-05-10', '2026-05-12')).toBe(-2);
  });

  it('zeroes out the time component (23:59 → 00:01 next day = 1 day)', () => {
    expect(capaDayDiff('2026-05-13T00:01:00', '2026-05-12T23:59:00')).toBe(1);
  });

  it('accepts Date objects on either side', () => {
    expect(capaDayDiff(new Date('2026-05-15'), new Date('2026-05-12'))).toBe(3);
  });
});

describe('capaDueClass', () => {
  const now = new Date('2026-05-12T12:00:00');

  it("returns 'green' for any Closed CAPA, even if past due", () => {
    expect(capaDueClass('2026-04-01', 'Closed', now)).toBe('green');
    expect(capaDueClass(null, 'Closed', now)).toBe('green');
  });

  it("returns '' for Awaiting Verify (owner has handed off)", () => {
    expect(capaDueClass('2026-04-01', 'Awaiting Verify', now)).toBe('');
  });

  it("returns '' when DueDate is missing on an open CAPA", () => {
    expect(capaDueClass(null, 'Open', now)).toBe('');
    expect(capaDueClass('', 'In Progress', now)).toBe('');
  });

  it("returns 'red' when past due on an open CAPA", () => {
    expect(capaDueClass('2026-05-10', 'Open', now)).toBe('red');
  });

  it("returns 'amber' within 3 days of due (boundary inclusive)", () => {
    expect(capaDueClass('2026-05-12', 'Open', now)).toBe('amber'); // today
    expect(capaDueClass('2026-05-15', 'Open', now)).toBe('amber'); // 3 days
  });

  it("returns 'green' when more than 3 days away", () => {
    expect(capaDueClass('2026-05-16', 'Open', now)).toBe('green');
    expect(capaDueClass('2026-06-12', 'Open', now)).toBe('green');
  });
});

describe('capaIsOverdue', () => {
  const now = new Date('2026-05-12T12:00:00');

  it('returns false for a Closed CAPA, even with a past DueDate', () => {
    expect(capaIsOverdue({ fields: { Status: 'Closed', DueDate: '2026-04-01' } }, now)).toBe(false);
  });

  it('returns false for an Awaiting Verify CAPA (owner has handed off)', () => {
    expect(capaIsOverdue({ fields: { Status: 'Awaiting Verify', DueDate: '2026-04-01' } }, now)).toBe(false);
  });

  it('returns false when DueDate is missing', () => {
    expect(capaIsOverdue({ fields: { Status: 'Open' } }, now)).toBe(false);
  });

  it('returns true when an open CAPA is past its DueDate', () => {
    expect(capaIsOverdue({ fields: { Status: 'Open', DueDate: '2026-05-10' } }, now)).toBe(true);
    expect(capaIsOverdue({ fields: { Status: 'In Progress', DueDate: '2026-05-11' } }, now)).toBe(true);
  });

  it('returns false when an open CAPA is due today or in the future', () => {
    expect(capaIsOverdue({ fields: { Status: 'Open', DueDate: '2026-05-12' } }, now)).toBe(false);
    expect(capaIsOverdue({ fields: { Status: 'Open', DueDate: '2026-05-20' } }, now)).toBe(false);
  });

  it('handles a null/undefined item without throwing', () => {
    expect(capaIsOverdue(null, now)).toBe(false);
    expect(capaIsOverdue(undefined, now)).toBe(false);
    expect(capaIsOverdue({}, now)).toBe(false);
  });
});

describe('capaIsClosedRecent', () => {
  const now = new Date('2026-05-12T12:00:00Z');

  it('returns false when status is not Closed', () => {
    expect(capaIsClosedRecent({ fields: { Status: 'Open', VerifiedAt: '2026-05-01T10:00:00Z' } }, 30, now)).toBe(false);
    expect(capaIsClosedRecent({ fields: { Status: 'Awaiting Verify', VerifiedAt: '2026-05-01T10:00:00Z' } }, 30, now)).toBe(false);
  });

  it('returns false when there is no usable date', () => {
    expect(capaIsClosedRecent({ fields: { Status: 'Closed' } }, 30, now)).toBe(false);
    expect(capaIsClosedRecent({ fields: { Status: 'Closed', VerifiedAt: 'not a date' } }, 30, now)).toBe(false);
  });

  it('returns true when VerifiedAt is within the window', () => {
    expect(capaIsClosedRecent({ fields: { Status: 'Closed', VerifiedAt: '2026-05-01T10:00:00Z' } }, 30, now)).toBe(true);
  });

  it('falls back to DoneAt when VerifiedAt is missing', () => {
    expect(capaIsClosedRecent({ fields: { Status: 'Closed', DoneAt: '2026-05-01T10:00:00Z' } }, 30, now)).toBe(true);
  });

  it('returns false when the closure is older than the window', () => {
    expect(capaIsClosedRecent({ fields: { Status: 'Closed', VerifiedAt: '2026-03-01T10:00:00Z' } }, 30, now)).toBe(false);
  });

  it('honours a non-default window size', () => {
    // 60 days back; default 30 says no, 90 says yes
    const item = { fields: { Status: 'Closed', VerifiedAt: '2026-03-13T12:00:00Z' } };
    expect(capaIsClosedRecent(item, 30, now)).toBe(false);
    expect(capaIsClosedRecent(item, 90, now)).toBe(true);
  });

  it('handles a null/undefined item without throwing', () => {
    expect(capaIsClosedRecent(null, 30, now)).toBe(false);
    expect(capaIsClosedRecent({}, 30, now)).toBe(false);
  });
});

describe('appendCAPAHistory', () => {
  it('starts a new JSON array for empty/null existing history', () => {
    const out = appendCAPAHistory('', { by: 'a@x.com', ev: 'created' });
    const arr = JSON.parse(out);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);
    expect(arr[0].ev).toBe('created');
  });

  it('appends to an existing array (not JSON-lines like CPAR)', () => {
    const first = appendCAPAHistory('', { ev: 'created' });
    const both  = appendCAPAHistory(first, { ev: 'done' });
    const arr = JSON.parse(both);
    expect(arr.length).toBe(2);
    expect(arr.map(e => e.ev)).toEqual(['created', 'done']);
  });

  it('always overwrites the caller-supplied `at` with the current time', () => {
    const out = appendCAPAHistory('', { ev: 'created', at: '1999-01-01' });
    const arr = JSON.parse(out);
    expect(arr[0].at).not.toBe('1999-01-01');
    expect(arr[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('recovers when existing is malformed JSON (treats as empty)', () => {
    const out = appendCAPAHistory('{not json}', { ev: 'created' });
    const arr = JSON.parse(out);
    expect(arr.length).toBe(1);
  });

  it('recovers when existing is valid JSON but not an array', () => {
    // Rare manual SP edit — guard at line 19049 in index.html.
    const out = appendCAPAHistory('{"ev":"single object"}', { ev: 'created' });
    const arr = JSON.parse(out);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);
    expect(arr[0].ev).toBe('created');
  });
});

// ── Team Views (production tracking) helpers ─────────────────────────────

describe('localDateKey', () => {
  it('formats a Date as local yyyy-mm-dd with zero-padding', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses local components, not UTC (no toISOString shift)', () => {
    // 1am local time on a date — local says today, UTC says yesterday in summer (BST).
    expect(localDateKey(new Date(2026, 5, 15, 1, 0, 0))).toBe('2026-06-15');
  });
});

describe('ddmmyyyy', () => {
  it('formats a Date as DD/MM/YYYY with zero-padding', () => {
    expect(ddmmyyyy(new Date(2026, 0, 5))).toBe('05/01/2026');
    expect(ddmmyyyy(new Date(2026, 11, 31))).toBe('31/12/2026');
  });
});

describe('isoWeekNumber / isoWeekYear', () => {
  it('returns week 1 for a Monday inside week 1', () => {
    expect(isoWeekNumber(new Date(2026, 0, 5))).toBe(2); // 2026-01-05 is Mon of week 2
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1); // 2026-01-01 (Thu) is in week 1
  });

  it('handles the ISO 53/1 boundary at year-end', () => {
    // 2025-12-29 is Mon of week 1 of 2026 (ISO 8601 rule: week 1 contains first Thursday)
    expect(isoWeekNumber(new Date(2025, 11, 29))).toBe(1);
    expect(isoWeekYear(new Date(2025, 11, 29))).toBe(2026);
  });

  it('handles the ISO 1/52 boundary at year-start', () => {
    // 2027-01-01 is a Friday → still in week 53 of 2026
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekYear(new Date(2027, 0, 1))).toBe(2026);
  });

  it('agrees on week-year for a mid-year date', () => {
    expect(isoWeekYear(new Date(2026, 5, 15))).toBe(2026);
  });
});

describe('addWorkdays', () => {
  it('returns the same date when n is 0', () => {
    const d = new Date(2026, 4, 12); // Tue
    expect(localDateKey(addWorkdays(d, 0))).toBe('2026-05-12');
  });

  it('skips Saturday and Sunday (Fri + 1 = Mon when no bank holiday)', () => {
    const fri = new Date(2026, 4, 8); // Fri 08/05/2026, no holiday following
    expect(localDateKey(addWorkdays(fri, 1))).toBe('2026-05-11'); // Mon
  });

  it('skips bank holidays as well as weekends (Fri 01/05/2026 + 1 → Tue 05/05/2026)', () => {
    // Fri 01/05 + 1 working day jumps OVER both the weekend AND Mon 04/05 (May Day BH).
    const fri = new Date(2026, 4, 1);
    expect(localDateKey(addWorkdays(fri, 1))).toBe('2026-05-05');
  });

  it('accepts negative n to walk backwards', () => {
    const tue = new Date(2026, 4, 5);
    expect(localDateKey(addWorkdays(tue, -1))).toBe('2026-05-01'); // back over BH Mon to Fri
  });

  it('does not mutate the input date', () => {
    const d = new Date(2026, 4, 12);
    const before = d.getTime();
    addWorkdays(d, 5);
    expect(d.getTime()).toBe(before);
  });

  it('respects a custom holiday set', () => {
    const customHolidays = new Set(['2026-05-12']); // a Tuesday
    const mon = new Date(2026, 4, 11);
    expect(localDateKey(addWorkdays(mon, 1, customHolidays))).toBe('2026-05-13');
  });
});

describe('workingPrepNumber', () => {
  it('returns 1 for a normal Monday', () => {
    expect(workingPrepNumber(new Date(2026, 4, 11))).toBe(1); // Mon 11/05/2026
  });

  it('returns 5 for a normal Friday', () => {
    expect(workingPrepNumber(new Date(2026, 4, 15))).toBe(5);
  });

  it('returns 0 for Saturday and Sunday', () => {
    expect(workingPrepNumber(new Date(2026, 4, 16))).toBe(0); // Sat
    expect(workingPrepNumber(new Date(2026, 4, 17))).toBe(0); // Sun
  });

  it('returns 0 for a bank-holiday Monday (May Day 04/05/2026)', () => {
    expect(workingPrepNumber(new Date(2026, 4, 4))).toBe(0);
  });

  it('the Tuesday after a bank-holiday Monday is prep 1, not prep 2', () => {
    expect(workingPrepNumber(new Date(2026, 4, 5))).toBe(1); // Tue 05/05/2026
    expect(workingPrepNumber(new Date(2026, 4, 6))).toBe(2); // Wed
    expect(workingPrepNumber(new Date(2026, 4, 8))).toBe(4); // Fri (4 working days in this week)
  });

  it('respects a custom holiday set', () => {
    const customHolidays = new Set(['2026-05-11']); // make Mon a holiday
    expect(workingPrepNumber(new Date(2026, 4, 12), customHolidays)).toBe(1); // Tue becomes prep 1
  });
});

describe('prepDayLabel', () => {
  it('returns the day-of-week label for normal preps', () => {
    expect(prepDayLabel('11/05/2026', 1)).toBe('Mon');
    expect(prepDayLabel('11/05/2026', 3)).toBe('Wed');
    expect(prepDayLabel('11/05/2026', 5)).toBe('Fri');
  });

  it('shifts labels around a bank-holiday Monday (wc 04/05/2026)', () => {
    // Mon 04/05 = bank holiday → prep 1 falls on Tue, prep 4 on Fri
    expect(prepDayLabel('04/05/2026', 1)).toBe('Tue');
    expect(prepDayLabel('04/05/2026', 2)).toBe('Wed');
    expect(prepDayLabel('04/05/2026', 3)).toBe('Thu');
    expect(prepDayLabel('04/05/2026', 4)).toBe('Fri');
  });

  it('returns "—" when the prep does not fit a 4-day bank-holiday week', () => {
    // wc 04/05/2026 only has 4 working days, so prep 5 has nowhere to go.
    expect(prepDayLabel('04/05/2026', 5)).toBe('—');
  });

  it('falls back to the static PREP_DAYS list when wc is malformed', () => {
    expect(prepDayLabel('', 1)).toBe('Mon');
    expect(prepDayLabel('not-a-date', 3)).toBe('Wed');
    expect(prepDayLabel(null, 5)).toBe('Fri');
  });

  it('returns "" when prepNum is missing or invalid', () => {
    expect(prepDayLabel('11/05/2026', 0)).toBe('');
    expect(prepDayLabel('11/05/2026', null)).toBe('');
  });
});

describe('normaliseTeam', () => {
  it('canonicalises lowercased input', () => {
    expect(normaliseTeam('woodmill')).toBe('Woodmill');
    expect(normaliseTeam('sewing room')).toBe('Sewing');
    expect(normaliseTeam('quality control')).toBe('QC');
  });

  it('handles whitespace and mixed case', () => {
    expect(normaliseTeam('  Cutting Room  ')).toBe('Cutting');
    expect(normaliseTeam('FOAM')).toBe('Foam');
  });

  it('canonicalises the Upholstery sub-teams separately', () => {
    expect(normaliseTeam('Upholstery Arms')).toBe('Upholstery Arms');
    expect(normaliseTeam('upholstery seats')).toBe('Upholstery Seats');
  });

  it('falls back to trimmed input when no mapping matches', () => {
    expect(normaliseTeam('  Unknown Team  ')).toBe('Unknown Team');
  });

  it('handles null and undefined safely', () => {
    expect(normaliseTeam(null)).toBe('');
    expect(normaliseTeam(undefined)).toBe('');
    expect(normaliseTeam('')).toBe('');
  });

  it('respects a custom team map', () => {
    const customMap = { 'odd team': 'OddTeamCanonical' };
    expect(normaliseTeam('Odd Team', customMap)).toBe('OddTeamCanonical');
  });
});

describe('distributeIntoPreps', () => {
  it('returns 6 empty buckets for an empty input', () => {
    const out = distributeIntoPreps([]);
    expect(Object.keys(out).sort()).toEqual(['1', '2', '3', '4', '5', 'express']);
    expect(out.express).toEqual([]);
    expect(out[1]).toEqual([]);
  });

  it('handles null/undefined input safely', () => {
    expect(distributeIntoPreps(null).express).toEqual([]);
    expect(distributeIntoPreps(undefined)[3]).toEqual([]);
  });

  it('always routes express jobs to the express bucket', () => {
    const out = distributeIntoPreps([
      { itemNo: 1, rep: 'R1', spec: 'A', prep: 'express', expressType: 'rush' },
      { itemNo: 2, rep: 'R2', spec: 'B', prep: 1 },
    ]);
    expect(out.express.length).toBe(1);
    expect(out.express[0].expressType).toBe('rush');
    expect(out[1].length).toBe(1);
  });

  it('honours explicit numeric preps when any job has one', () => {
    const out = distributeIntoPreps([
      { rep: 'R1', prep: 1 },
      { rep: 'R2', prep: 1 },
      { rep: 'R3', prep: 3 },
      { rep: 'R4', prep: 5 },
    ]);
    expect(out[1].map(j => j.rep)).toEqual(['R1', 'R2']);
    expect(out[3].map(j => j.rep)).toEqual(['R3']);
    expect(out[5].map(j => j.rep)).toEqual(['R4']);
    expect(out[2]).toEqual([]);
  });

  it('skips jobs with null prep when other jobs have numeric preps', () => {
    const out = distributeIntoPreps([
      { rep: 'R1', prep: 1 },
      { rep: 'R2', prep: null },
    ]);
    const totalNonExpress = out[1].length + out[2].length + out[3].length + out[4].length + out[5].length;
    expect(totalNonExpress).toBe(1);
    expect(out[1][0].rep).toBe('R1');
  });

  it('spreads jobs evenly across preps 1-5 when none have numeric preps', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({ rep: `R${i}`, prep: null }));
    const out = distributeIntoPreps(jobs);
    // 10 jobs across 5 preps → 2 per prep
    expect(out[1].length).toBe(2);
    expect(out[2].length).toBe(2);
    expect(out[3].length).toBe(2);
    expect(out[4].length).toBe(2);
    expect(out[5].length).toBe(2);
  });

  it('preserves itemNo / rep / spec / isService on output', () => {
    const out = distributeIntoPreps([
      { itemNo: 7, rep: 'R7', spec: 'specX', prep: 2, isService: true },
    ]);
    expect(out[2][0]).toEqual({
      itemNo: 7, rep: 'R7', spec: 'specX', expressType: null, isService: true,
    });
  });
});

// ── Stats tab (KPI dashboard) helpers ────────────────────────────────────

describe('parseDdmmyyyy', () => {
  it('parses a valid DD/MM/YYYY string', () => {
    const d = parseDdmmyyyy('15/05/2026');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(15);
  });

  it('accepts a trailing time portion and ignores it', () => {
    const d = parseDdmmyyyy('15/05/2026 14:30');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0); // time portion ignored, midnight
  });

  it('returns null for empty/null/undefined', () => {
    expect(parseDdmmyyyy('')).toBe(null);
    expect(parseDdmmyyyy(null)).toBe(null);
    expect(parseDdmmyyyy(undefined)).toBe(null);
  });

  it('returns null for malformed shapes (wrong separator count)', () => {
    expect(parseDdmmyyyy('2026-05-15')).toBe(null);
    expect(parseDdmmyyyy('15/5')).toBe(null);
    expect(parseDdmmyyyy('15/05/2026/extra')).toBe(null);
  });

  it('returns null for non-numeric parts', () => {
    expect(parseDdmmyyyy('aa/05/2026')).toBe(null);
    expect(parseDdmmyyyy('15/bb/2026')).toBe(null);
    expect(parseDdmmyyyy('15/05/cccc')).toBe(null);
  });

  it('returns null for out-of-range values', () => {
    expect(parseDdmmyyyy('0/05/2026')).toBe(null);    // day 0
    expect(parseDdmmyyyy('32/05/2026')).toBe(null);   // day 32
    expect(parseDdmmyyyy('15/00/2026')).toBe(null);   // month 0
    expect(parseDdmmyyyy('15/13/2026')).toBe(null);   // month 13
    expect(parseDdmmyyyy('15/05/1899')).toBe(null);   // year too old
    expect(parseDdmmyyyy('15/05/2201')).toBe(null);   // year too far
  });

  it('rejects rollover anomalies (31/02 would silently become 03/03)', () => {
    expect(parseDdmmyyyy('31/02/2026')).toBe(null);
    expect(parseDdmmyyyy('31/04/2026')).toBe(null); // April has 30 days
    expect(parseDdmmyyyy('29/02/2025')).toBe(null); // 2025 not a leap year
  });

  it('accepts leap-day on a leap year (29/02/2024)', () => {
    const d = parseDdmmyyyy('29/02/2024');
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(1);
  });
});

describe('statsRefDate', () => {
  const today = new Date(2026, 4, 12); // Tue 12 May 2026

  it('today ignores offset and returns the input today', () => {
    expect(statsRefDate('today', 0, today).getDate()).toBe(12);
    expect(statsRefDate('today', -5, today).getDate()).toBe(12);
  });

  it('yesterday returns today - 1, ignoring offset', () => {
    expect(statsRefDate('yesterday', 0, today).getDate()).toBe(11);
    expect(statsRefDate('yesterday', -5, today).getDate()).toBe(11);
  });

  it('week steps in 7-day chunks', () => {
    expect(statsRefDate('week', 0, today).getDate()).toBe(12);
    expect(statsRefDate('week', -1, today).getDate()).toBe(5);    // 1 week back
    expect(statsRefDate('week', -2, today).getDate()).toBe(28);   // 2 weeks back → 28 Apr
  });

  it('month returns the 1st of the offset calendar month', () => {
    const ref0 = statsRefDate('month', 0, today);
    expect(ref0.getMonth()).toBe(4);
    expect(ref0.getDate()).toBe(1);
    const refMinus1 = statsRefDate('month', -1, today);
    expect(refMinus1.getMonth()).toBe(3);
    expect(refMinus1.getDate()).toBe(1);
  });

  it('day steps in 1-day chunks', () => {
    expect(statsRefDate('day', 0, today).getDate()).toBe(12);
    expect(statsRefDate('day', -5, today).getDate()).toBe(7);
    expect(statsRefDate('day', -10, today).getDate()).toBe(2);
  });

  it('year (fallback) returns Jan 1 of (year + offset)', () => {
    const ref0 = statsRefDate('year', 0, today);
    expect(ref0.getFullYear()).toBe(2026);
    expect(ref0.getMonth()).toBe(0);
    expect(ref0.getDate()).toBe(1);
    expect(statsRefDate('year', -1, today).getFullYear()).toBe(2025);
  });

  it('does not mutate the supplied today', () => {
    const before = today.getTime();
    statsRefDate('week', -3, today);
    expect(today.getTime()).toBe(before);
  });
});

describe('statsInPeriod', () => {
  // A ref object as the inline _statsRefCache would build it.
  const dayRef = {
    period: 'day',
    day: 12, month: 4, year: 2026,
    isoWk: 20, isoYr: 2026,
  };

  it("matches an exact day for 'today' / 'yesterday' / 'day' periods", () => {
    expect(statsInPeriod('12/05/2026', dayRef)).toBe(true);
    expect(statsInPeriod('11/05/2026', dayRef)).toBe(false);
    expect(statsInPeriod('12/05/2026', { ...dayRef, period: 'today' })).toBe(true);
    expect(statsInPeriod('12/05/2026', { ...dayRef, period: 'yesterday' })).toBe(true);
  });

  it('week matches any date inside the same ISO week+year', () => {
    const weekRef = { period: 'week', day: 12, month: 4, year: 2026, isoWk: 20, isoYr: 2026 };
    expect(statsInPeriod('11/05/2026', weekRef)).toBe(true);  // Mon
    expect(statsInPeriod('15/05/2026', weekRef)).toBe(true);  // Fri
    expect(statsInPeriod('18/05/2026', weekRef)).toBe(false); // next Mon = wk 21
  });

  it('month matches any date in the same calendar month and year', () => {
    const monthRef = { period: 'month', day: 12, month: 4, year: 2026, isoWk: 20, isoYr: 2026 };
    expect(statsInPeriod('01/05/2026', monthRef)).toBe(true);
    expect(statsInPeriod('31/05/2026', monthRef)).toBe(true);
    expect(statsInPeriod('30/04/2026', monthRef)).toBe(false);
    expect(statsInPeriod('01/06/2026', monthRef)).toBe(false);
  });

  it('year (fallback) matches any date in the same calendar year', () => {
    const yearRef = { period: 'year', day: 12, month: 4, year: 2026, isoWk: 20, isoYr: 2026 };
    expect(statsInPeriod('01/01/2026', yearRef)).toBe(true);
    expect(statsInPeriod('31/12/2026', yearRef)).toBe(true);
    expect(statsInPeriod('31/12/2025', yearRef)).toBe(false);
  });

  it('returns false for an unparseable date string', () => {
    expect(statsInPeriod('not a date', dayRef)).toBe(false);
    expect(statsInPeriod('', dayRef)).toBe(false);
    expect(statsInPeriod('31/02/2026', dayRef)).toBe(false); // rollover rejected
  });
});

describe('statsCountByTeam', () => {
  it('tallies completions per team', () => {
    expect(statsCountByTeam([
      { fields: { Team: 'Sewing' } },
      { fields: { Team: 'Sewing' } },
      { fields: { Team: 'Assembly' } },
    ])).toEqual({ Sewing: 2, Assembly: 1 });
  });

  it("buckets missing or blank teams under 'Unknown'", () => {
    expect(statsCountByTeam([
      { fields: {} },
      { fields: { Team: null } },
      { fields: { Team: '' } },
      { fields: { Team: 'Sewing' } },
    ])).toEqual({ Unknown: 3, Sewing: 1 });
  });

  it('returns {} for an empty / null / undefined input', () => {
    expect(statsCountByTeam([])).toEqual({});
    expect(statsCountByTeam(null)).toEqual({});
    expect(statsCountByTeam(undefined)).toEqual({});
  });

  it('handles items with missing fields gracefully', () => {
    expect(statsCountByTeam([
      {},
      { fields: { Team: 'QC' } },
    ])).toEqual({ Unknown: 1, QC: 1 });
  });
});

describe('statsCountByPerson', () => {
  const operators = {
    Sewing:   { AB: 'Alice Brown', CD: 'Carol Davies' },
    Assembly: { EF: 'Edward Frost' },
  };

  it('tallies completions per (team, initials) pair', () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Sewing',   Initials: 'AB' } },
      { fields: { Team: 'Sewing',   Initials: 'AB' } },
      { fields: { Team: 'Sewing',   Initials: 'CD' } },
      { fields: { Team: 'Assembly', Initials: 'EF' } },
    ], { operators });
    expect(out.length).toBe(3);
    expect(out.find(r => r.initials === 'AB').count).toBe(2);
    expect(out.find(r => r.initials === 'CD').count).toBe(1);
    expect(out.find(r => r.initials === 'EF').count).toBe(1);
  });

  it("treats the same initials on different teams as separate rows", () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Sewing',   Initials: 'AB' } },
      { fields: { Team: 'Assembly', Initials: 'AB' } },
    ]);
    expect(out.length).toBe(2);
  });

  it('skips teams listed in noPerPerson', () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Woodmill', Initials: 'XX' } },
      { fields: { Team: 'QC',       Initials: 'YY' } },
      { fields: { Team: 'Sewing',   Initials: 'AB' } },
    ], { noPerPerson: ['Woodmill', 'QC'], operators });
    expect(out.length).toBe(1);
    expect(out[0].team).toBe('Sewing');
  });

  it('resolves initials → full name via operators lookup', () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Sewing', Initials: 'AB' } },
    ], { operators });
    expect(out[0].name).toBe('Alice Brown');
  });

  it('falls back to initials when no name match exists', () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Sewing', Initials: 'ZZ' } },
    ], { operators });
    expect(out[0].name).toBe('ZZ');
  });

  it('sorts output by count descending', () => {
    const out = statsCountByPerson([
      { fields: { Team: 'Sewing', Initials: 'AB' } },
      { fields: { Team: 'Sewing', Initials: 'CD' } },
      { fields: { Team: 'Sewing', Initials: 'CD' } },
      { fields: { Team: 'Sewing', Initials: 'CD' } },
    ]);
    expect(out[0].initials).toBe('CD');
    expect(out[0].count).toBe(3);
    expect(out[1].initials).toBe('AB');
    expect(out[1].count).toBe(1);
  });

  it('handles empty / null / undefined inputs safely', () => {
    expect(statsCountByPerson([])).toEqual([]);
    expect(statsCountByPerson(null)).toEqual([]);
    expect(statsCountByPerson(undefined)).toEqual([]);
  });
});

// ── Maintenance dashboard helpers ────────────────────────────────────────

describe('mtAddDays', () => {
  it('adds N days within the same month', () => {
    expect(mtAddDays('2026-05-12', 3)).toBe('2026-05-15');
    expect(mtAddDays('2026-05-12', 0)).toBe('2026-05-12');
  });

  it('rolls over to the next month', () => {
    expect(mtAddDays('2026-05-30', 3)).toBe('2026-06-02');
  });

  it('rolls over to the next year', () => {
    expect(mtAddDays('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('handles negative offsets', () => {
    expect(mtAddDays('2026-05-12', -1)).toBe('2026-05-11');
    expect(mtAddDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('survives the BST→GMT autumn transition without skipping a day', () => {
    // Last Sun of October 2026 = 25/10. UK clocks fall back.
    expect(mtAddDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('survives the GMT→BST spring transition without losing a day', () => {
    // Last Sun of March 2026 = 29/03. UK clocks spring forward.
    expect(mtAddDays('2026-03-28', 2)).toBe('2026-03-30');
  });
});

describe('mtEnumerateDays', () => {
  it('returns a single day when from === to', () => {
    expect(mtEnumerateDays('2026-05-12', '2026-05-12')).toEqual(['2026-05-12']);
  });

  it('returns the inclusive range', () => {
    expect(mtEnumerateDays('2026-05-12', '2026-05-15'))
      .toEqual(['2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']);
  });

  it('returns [] when to < from', () => {
    expect(mtEnumerateDays('2026-05-15', '2026-05-12')).toEqual([]);
  });

  it('crosses month boundaries', () => {
    expect(mtEnumerateDays('2026-04-30', '2026-05-02'))
      .toEqual(['2026-04-30', '2026-05-01', '2026-05-02']);
  });
});

describe('mtFreqDays', () => {
  it('maps standard frequencies', () => {
    expect(mtFreqDays({ Frequency: 'Annual' })).toBe(365);
    expect(mtFreqDays({ Frequency: '6-Monthly' })).toBe(183);
    expect(mtFreqDays({ Frequency: 'Quarterly' })).toBe(91);
    expect(mtFreqDays({ Frequency: 'Monthly' })).toBe(30);
  });

  it('is case-insensitive on the label', () => {
    expect(mtFreqDays({ Frequency: 'MONTHLY' })).toBe(30);
    expect(mtFreqDays({ Frequency: 'quarterly' })).toBe(91);
  });

  it('honours FrequencyDays for custom', () => {
    expect(mtFreqDays({ Frequency: 'Custom', FrequencyDays: 14 })).toBe(14);
  });

  it('falls back to 365 when custom has no FrequencyDays', () => {
    expect(mtFreqDays({ Frequency: 'Custom' })).toBe(365);
    expect(mtFreqDays({ Frequency: 'Custom', FrequencyDays: 0 })).toBe(365);
  });

  it('defaults to 365 for unknown / missing / null', () => {
    expect(mtFreqDays({})).toBe(365);
    expect(mtFreqDays({ Frequency: 'WhatsThis' })).toBe(365);
    expect(mtFreqDays(null)).toBe(365);
    expect(mtFreqDays(undefined)).toBe(365);
  });
});

describe('mtComputeYearlyStatus', () => {
  const today = '2026-05-12';

  it("returns 'OK' for a future due date beyond 90 days", () => {
    const s = mtComputeYearlyStatus({ LastDone: '2026-01-01', Frequency: 'Annual' }, today);
    expect(s.cls).toBe('ok');
    expect(s.label).toBe('OK');
    expect(s.daysUntil).toBeGreaterThan(90);
  });

  it("returns 'Due Soon' inside the 90-day window", () => {
    // LastDone 2025-07-01 + Annual (365d) → next due 2026-07-01 ≈ 50 days from today
    const s = mtComputeYearlyStatus({ LastDone: '2025-07-01', Frequency: 'Annual' }, today);
    expect(s.cls).toBe('due');
    expect(s.label).toBe('Due Soon');
    expect(s.daysUntil).toBeGreaterThanOrEqual(0);
    expect(s.daysUntil).toBeLessThanOrEqual(90);
  });

  it("returns 'Overdue' for a past due date", () => {
    const s = mtComputeYearlyStatus({ LastDone: '2025-01-01', Frequency: 'Annual' }, today);
    expect(s.cls).toBe('overdue');
    expect(s.daysUntil).toBeLessThan(0);
  });

  it("ScheduledFor (manual override) wins over LastDone + Frequency", () => {
    const s = mtComputeYearlyStatus({
      LastDone: '2026-01-01',         // would compute to ~Jan 2027 normally
      Frequency: 'Annual',
      ScheduledFor: '2026-06-01',     // manual override → due in ~3 weeks
    }, today);
    expect(s.manuallyScheduled).toBe(true);
    expect(s.nextDueIso).toBe('2026-06-01');
    expect(s.cls).toBe('due');
  });

  it('falls back to "Overdue today" when both ScheduledFor and LastDone are missing/malformed', () => {
    const s = mtComputeYearlyStatus({}, today);
    expect(s.cls).toBe('overdue');
    expect(s.firstTime).toBe(true);
    expect(s.nextDueIso).toBe(today);
  });

  it('respects Custom frequency days', () => {
    const s = mtComputeYearlyStatus({
      LastDone: '2026-05-01',
      Frequency: 'Custom',
      FrequencyDays: 10,
    }, today);
    // LastDone + 10 days = 11 May (yesterday) → overdue
    expect(s.cls).toBe('overdue');
  });
});

describe('mtComputeTeamStatusToday', () => {
  const today = '2026-05-12';
  const teamFoam = {
    id: 'foam',
    machines: [{ id: 'press1', name: 'Press 1' }, { id: 'press2', name: 'Press 2' }, { id: 'press3', name: 'Press 3' }],
  };

  it("returns 'No machines' for an empty team", () => {
    const out = mtComputeTeamStatusToday({ id: 'empty', machines: [] }, { todayUkStr: today });
    expect(out.cls).toBe('warn');
    expect(out.label).toBe('No machines');
    expect(out.total).toBe(0);
  });

  it("returns 'Pending' when no inspections have happened", () => {
    const out = mtComputeTeamStatusToday(teamFoam, { todayUkStr: today, records: [], downtime: {} });
    expect(out.cls).toBe('warn');
    expect(out.label).toBe('Pending');
    expect(out.checked).toBe(0);
    expect(out.total).toBe(3);
  });

  it("returns 'Pass' when all machines checked and none failed", () => {
    const out = mtComputeTeamStatusToday(teamFoam, {
      todayUkStr: today,
      records: [
        { machineId: 'press1', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:00:00Z' },
        { machineId: 'press2', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:30:00Z' },
        { machineId: 'press3', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T10:00:00Z' },
      ],
    });
    expect(out.cls).toBe('pass');
    expect(out.label).toBe('Pass');
    expect(out.checked).toBe(3);
    expect(out.fails).toBe(0);
    expect(out.lastIso).toBe('2026-05-12T10:00:00Z');
  });

  it("returns 'Fail' if any machine has any failing tool row", () => {
    // press2 has two tool rows (pass + fail) — bench-style submission. Should fail.
    const out = mtComputeTeamStatusToday(teamFoam, {
      todayUkStr: today,
      records: [
        { machineId: 'press1', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:00:00Z' },
        { machineId: 'press2', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:30:00Z' },
        { machineId: 'press2', dateStr: today, status: 'fail', inspectedAt: '2026-05-12T09:35:00Z' },
        { machineId: 'press3', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T10:00:00Z' },
      ],
    });
    expect(out.cls).toBe('fail');
    expect(out.fails).toBe(1);
  });

  it('treats a machine on downtime as satisfied without an inspection', () => {
    const out = mtComputeTeamStatusToday(teamFoam, {
      todayUkStr: today,
      records: [
        { machineId: 'press1', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:00:00Z' },
        { machineId: 'press2', dateStr: today, status: 'pass', inspectedAt: '2026-05-12T09:30:00Z' },
      ],
      downtime: { 'press3|2026-05-12': true },
    });
    expect(out.cls).toBe('pass');
    expect(out.checked).toBe(3);
  });

  it("ignores records from other days", () => {
    const out = mtComputeTeamStatusToday(teamFoam, {
      todayUkStr: today,
      records: [
        { machineId: 'press1', dateStr: '2026-05-11', status: 'pass', inspectedAt: '2026-05-11T09:00:00Z' },
      ],
    });
    expect(out.checked).toBe(0);
    expect(out.cls).toBe('warn');
  });
});

// ── Service dashboard helpers ────────────────────────────────────────────

describe('serviceTicketMatches', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const mkAge = days => new Date(now.getTime() - days * 86400000);

  const baseTicket = {
    ticketNo: 'SRV-001', customer: 'Smith', repNo: 'R-100',
    description: 'frame creak', faultCode: 'FRM', subFault: '',
    openClosed: 'OPEN', openDate: mkAge(10),
    period30: 'Inside 30 days', warrantyChargeable: 'WARRANTY',
  };

  it('returns false for closed tickets regardless of other filters', () => {
    expect(serviceTicketMatches({ ...baseTicket, openClosed: 'CLOSED' }, {}, now)).toBe(false);
  });

  it('with no filters set, an open ticket matches', () => {
    expect(serviceTicketMatches(baseTicket, {}, now)).toBe(true);
  });

  it('overdueOnly filter: keeps tickets older than 30 days', () => {
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(35) }, { overdueOnly: true }, now)).toBe(true);
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(20) }, { overdueOnly: true }, now)).toBe(false);
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(30) }, { overdueOnly: true }, now)).toBe(false);
  });

  it('slaRiskOnly filter: keeps tickets aged 15-30 days', () => {
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(20) }, { slaRiskOnly: true }, now)).toBe(true);
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(10) }, { slaRiskOnly: true }, now)).toBe(false);
    expect(serviceTicketMatches({ ...baseTicket, openDate: mkAge(35) }, { slaRiskOnly: true }, now)).toBe(false);
  });

  it('period filter narrows by period30 prefix', () => {
    expect(serviceTicketMatches({ ...baseTicket, period30: 'Inside 30 days' }, { period: 'in30'  }, now)).toBe(true);
    expect(serviceTicketMatches({ ...baseTicket, period30: 'Outside 30 days' }, { period: 'in30'  }, now)).toBe(false);
    expect(serviceTicketMatches({ ...baseTicket, period30: 'Outside 30 days' }, { period: 'out30' }, now)).toBe(true);
  });

  it('wc filter narrows by warrantyChargeable bucket', () => {
    expect(serviceTicketMatches({ ...baseTicket, warrantyChargeable: 'WARRANTY' },   { wc: 'WARRANTY'   }, now)).toBe(true);
    expect(serviceTicketMatches({ ...baseTicket, warrantyChargeable: 'CHARGEABLE' }, { wc: 'WARRANTY'   }, now)).toBe(false);
    expect(serviceTicketMatches({ ...baseTicket, warrantyChargeable: 'CHARGEABLE' }, { wc: 'CHARGEABLE' }, now)).toBe(true);
  });

  it('q filter substring-matches across many fields, case-insensitive', () => {
    expect(serviceTicketMatches(baseTicket, { q: 'SMITH' }, now)).toBe(true);
    expect(serviceTicketMatches(baseTicket, { q: 'r-100' }, now)).toBe(true);
    expect(serviceTicketMatches(baseTicket, { q: 'creak' }, now)).toBe(true);
    expect(serviceTicketMatches(baseTicket, { q: 'nothing-here' }, now)).toBe(false);
  });

  it('combines multiple filters with AND semantics', () => {
    expect(serviceTicketMatches(
      { ...baseTicket, openDate: mkAge(35), warrantyChargeable: 'WARRANTY' },
      { overdueOnly: true, wc: 'WARRANTY' }, now,
    )).toBe(true);
    expect(serviceTicketMatches(
      { ...baseTicket, openDate: mkAge(35), warrantyChargeable: 'CHARGEABLE' },
      { overdueOnly: true, wc: 'WARRANTY' }, now,
    )).toBe(false);
  });
});

describe('serviceTicketCounts', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const mkAge = days => new Date(now.getTime() - days * 86400000);

  it('returns zeros for an empty list', () => {
    expect(serviceTicketCounts([], now)).toEqual({
      open: 0, overdue: 0, slaRisk: 0, in30: 0, out30: 0,
      warranty: 0, chargeable: 0, observation: 0,
    });
  });

  it('counts only open tickets', () => {
    const counts = serviceTicketCounts([
      { openClosed: 'OPEN',   openDate: mkAge(10), warrantyChargeable: 'WARRANTY',   period30: 'Inside 30 days' },
      { openClosed: 'CLOSED', openDate: mkAge(5),  warrantyChargeable: 'CHARGEABLE', period30: 'Inside 30 days' },
    ], now);
    expect(counts.open).toBe(1);
    expect(counts.warranty).toBe(1);
    expect(counts.chargeable).toBe(0);
  });

  it('overdue=age>30, slaRisk=age 15-30', () => {
    const counts = serviceTicketCounts([
      { openClosed: 'OPEN', openDate: mkAge(35), warrantyChargeable: 'W', period30: 'Inside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(20), warrantyChargeable: 'W', period30: 'Inside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(10), warrantyChargeable: 'W', period30: 'Inside 30 days' },
    ], now);
    expect(counts.overdue).toBe(1);
    expect(counts.slaRisk).toBe(1);
  });

  it('groups by inside30 / outside30 from period30 prefix', () => {
    const counts = serviceTicketCounts([
      { openClosed: 'OPEN', openDate: mkAge(5), warrantyChargeable: 'W', period30: 'Inside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(5), warrantyChargeable: 'W', period30: 'Outside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(5), warrantyChargeable: 'W', period30: 'Outside 30 days' },
    ], now);
    expect(counts.in30).toBe(1);
    expect(counts.out30).toBe(2);
  });
});

describe('computeServiceSlaRisk', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const days = n => n * 86400000;

  it('returns [] for an empty list', () => {
    expect(computeServiceSlaRisk([], { now })).toEqual([]);
  });

  it('returns tickets with elapsed% >= threshold', () => {
    // open 10 days ago, closes in 1 day → 10/11 elapsed = 90.9% → at risk @ 80%
    const ticket = {
      openClosed: 'OPEN',
      openDate: new Date(now.getTime() - days(10)),
      proposedCloseDate: new Date(now.getTime() + days(1)),
    };
    const out = computeServiceSlaRisk([ticket], { now });
    expect(out.length).toBe(1);
    expect(out[0].pct).toBeGreaterThanOrEqual(80);
  });

  it('excludes tickets already past proposedCloseDate (overdue, not at-risk)', () => {
    const ticket = {
      openClosed: 'OPEN',
      openDate: new Date(now.getTime() - days(10)),
      proposedCloseDate: new Date(now.getTime() - days(1)),
    };
    expect(computeServiceSlaRisk([ticket], { now })).toEqual([]);
  });

  it('excludes closed tickets', () => {
    const ticket = {
      openClosed: 'CLOSED',
      openDate: new Date(now.getTime() - days(10)),
      proposedCloseDate: new Date(now.getTime() + days(1)),
    };
    expect(computeServiceSlaRisk([ticket], { now })).toEqual([]);
  });

  it('sorts by pct descending and respects limit', () => {
    const mk = (open, close) => ({
      openClosed: 'OPEN',
      openDate: new Date(now.getTime() - days(open)),
      proposedCloseDate: new Date(now.getTime() + days(close)),
    });
    const out = computeServiceSlaRisk([
      mk(9, 1),   // 90%
      mk(8, 2),   // 80%
      mk(7, 3),   // 70% — below default threshold
      mk(19, 1),  // 95%
    ], { now });
    expect(out.length).toBe(3);
    expect(out[0].pct).toBeGreaterThanOrEqual(out[1].pct);
    expect(out[1].pct).toBeGreaterThanOrEqual(out[2].pct);

    const limited = computeServiceSlaRisk([mk(9, 1), mk(19, 1), mk(8, 2)], { now, limit: 2 });
    expect(limited.length).toBe(2);
  });

  it('respects a custom threshold', () => {
    const ticket = {
      openClosed: 'OPEN',
      openDate: new Date(now.getTime() - days(5)),
      proposedCloseDate: new Date(now.getTime() + days(5)),
    };
    // 50% elapsed
    expect(computeServiceSlaRisk([ticket], { now, threshold: 0.40 }).length).toBe(1);
    expect(computeServiceSlaRisk([ticket], { now, threshold: 0.80 }).length).toBe(0);
  });
});

describe('computeServiceOverdueCount', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const mkAge = days => new Date(now.getTime() - days * 86400000);

  it('returns 0 for an empty list', () => {
    expect(computeServiceOverdueCount([], now)).toBe(0);
  });

  it('counts open tickets older than 30 days', () => {
    expect(computeServiceOverdueCount([
      { openClosed: 'OPEN', openDate: mkAge(35) },
      { openClosed: 'OPEN', openDate: mkAge(31) },
      { openClosed: 'OPEN', openDate: mkAge(30) },
      { openClosed: 'OPEN', openDate: mkAge(10) },
    ], now)).toBe(2);
  });

  it('ignores closed tickets and missing openDate', () => {
    expect(computeServiceOverdueCount([
      { openClosed: 'CLOSED', openDate: mkAge(100) },
      { openClosed: 'OPEN' },
      { openClosed: 'OPEN', openDate: mkAge(35) },
    ], now)).toBe(1);
  });
});

describe('computeServiceKpis', () => {
  const now = new Date('2026-05-12T12:00:00Z');
  const mkAge = days => new Date(now.getTime() - days * 86400000);

  it('returns a zero KPI suite for empty tickets + parts', () => {
    const k = computeServiceKpis([], [], { now });
    expect(k.open).toBe(0);
    expect(k.overdue).toBe(0);
    expect(k.avgDaysClose).toBe(0);
    expect(k.partsInTransit).toBe(0);
    expect(k.withinTarget).toBe(0);
    expect(k.topFault).toBe('—');
  });

  it('counts open/openIn30/openOut30/overdue', () => {
    const k = computeServiceKpis([
      { openClosed: 'OPEN', openDate: mkAge(5),  period30: 'Inside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(40), period30: 'Outside 30 days' },
      { openClosed: 'OPEN', openDate: mkAge(35), period30: 'Inside 30 days' },
    ], [], { now });
    expect(k.open).toBe(3);
    expect(k.openIn30).toBe(2);
    expect(k.openOut30).toBe(1);
    expect(k.overdue).toBe(2);
  });

  it('avgDaysClose averages closed tickets within the 12-month window with daysToComplete > 0', () => {
    const k = computeServiceKpis([
      { openClosed: 'CLOSED', closeDate: mkAge(30), daysToComplete: 10, warrantyChargeable: 'WARRANTY' },
      { openClosed: 'CLOSED', closeDate: mkAge(60), daysToComplete: 20, warrantyChargeable: 'CHARGEABLE' },
      { openClosed: 'CLOSED', closeDate: mkAge(90), daysToComplete: 0,  warrantyChargeable: 'WARRANTY' }, // excluded (0 days)
    ], [], { now });
    expect(k.avgDaysClose).toBe(15);
    expect(k.avgWarrantyClose).toBe(10);
    expect(k.avgChargeableClose).toBe(20);
  });

  it('withinTarget is the % of closed tickets with daysToComplete <= 30', () => {
    const k = computeServiceKpis([
      { openClosed: 'CLOSED', closeDate: mkAge(10), daysToComplete: 10 },
      { openClosed: 'CLOSED', closeDate: mkAge(20), daysToComplete: 25 },
      { openClosed: 'CLOSED', closeDate: mkAge(30), daysToComplete: 45 }, // out of target
      { openClosed: 'CLOSED', closeDate: mkAge(40), daysToComplete: 60 }, // out of target
    ], [], { now });
    expect(k.withinTarget).toBe(50);
  });

  it('partsInTransit vs partsDelivered counts', () => {
    const k = computeServiceKpis([], [
      { isDelivered: false },
      { isDelivered: false },
      { isDelivered: true },
    ], { now });
    expect(k.partsInTransit).toBe(2);
    expect(k.partsDelivered).toBe(1);
  });

  it('topFault is the most common fault among tickets opened this month', () => {
    const k = computeServiceKpis([
      { openClosed: 'OPEN', openDate: mkAge(5),  faultCode: 'FOAM' },
      { openClosed: 'OPEN', openDate: mkAge(2),  faultCode: 'FOAM' },
      { openClosed: 'OPEN', openDate: mkAge(1),  faultCode: 'FRAME' },
    ], [], { now });
    expect(k.topFault).toBe('FOAM');
  });
});

// ── Complaints helpers ───────────────────────────────────────────────────

describe('cpParseDmy', () => {
  it('parses D/M/YYYY and DD/MM/YYYY', () => {
    expect(cpParseDmy('5/3/2026').getDate()).toBe(5);
    expect(cpParseDmy('15/05/2026').getMonth()).toBe(4);
  });

  it('ignores anything after the date portion', () => {
    expect(cpParseDmy('15/05/2026 14:30').getDate()).toBe(15);
  });

  it('returns null for null/empty/malformed', () => {
    expect(cpParseDmy(null)).toBe(null);
    expect(cpParseDmy('')).toBe(null);
    expect(cpParseDmy('not a date')).toBe(null);
    expect(cpParseDmy('2026-05-15')).toBe(null); // wrong shape
  });

  it("does NOT reject rollovers (unlike parseDdmmyyyy — looser parser)", () => {
    // cpParseDmy is the laxer Excel-source parser; 31/02 silently rolls to 03/03.
    const d = cpParseDmy('31/02/2026');
    expect(d).not.toBe(null);
    expect(d.getMonth()).toBe(2); // March, not February — documented quirk
  });
});

describe('cpDayDiff', () => {
  it('returns whole days, floored', () => {
    expect(cpDayDiff(new Date('2026-05-12'), new Date('2026-05-15'))).toBe(3);
  });

  it('returns 0 for the same day', () => {
    const d = new Date('2026-05-12');
    expect(cpDayDiff(d, d)).toBe(0);
  });

  it('returns negative when d2 < d1', () => {
    expect(cpDayDiff(new Date('2026-05-15'), new Date('2026-05-12'))).toBe(-3);
  });

  it('floors fractional-day differences', () => {
    expect(cpDayDiff(
      new Date('2026-05-12T00:00:00Z'),
      new Date('2026-05-13T22:00:00Z'),
    )).toBe(1); // 1.91 days → 1
  });
});

describe('cpInitials', () => {
  it('returns first initial + last initial uppercased', () => {
    expect(cpInitials('Alice Brown')).toBe('AB');
    expect(cpInitials('jonas simonaitis')).toBe('JS');
  });

  it('handles single-word names', () => {
    expect(cpInitials('Madonna')).toBe('M');
  });

  it("uses the first two words when more than two are given", () => {
    expect(cpInitials('Mary Anne Jenkins')).toBe('MA');
  });

  it("collapses runs of whitespace and trims", () => {
    expect(cpInitials('  Alice    Brown  ')).toBe('AB');
  });

  it("returns '?' for null / undefined / empty", () => {
    expect(cpInitials(null)).toBe('?');
    expect(cpInitials(undefined)).toBe('?');
    expect(cpInitials('')).toBe('?');
    expect(cpInitials('   ')).toBe('?');
  });
});

describe('cpInvestigatorRole', () => {
  const roleMap = {
    'jonas.simonaitis@reposefurniture.co.uk': 'QHSE Manager',
    'richard.semmens@reposefurniture.co.uk':  'Operations',
  };

  it('returns the mapped role for a known email', () => {
    expect(cpInvestigatorRole('jonas.simonaitis@reposefurniture.co.uk', roleMap)).toBe('QHSE Manager');
  });

  it('is case-insensitive on the lookup key', () => {
    expect(cpInvestigatorRole('JONAS.SIMONAITIS@reposefurniture.co.uk', roleMap)).toBe('QHSE Manager');
  });

  it("falls back to 'Investigator' for unmapped emails", () => {
    expect(cpInvestigatorRole('someone@other.com', roleMap)).toBe('Investigator');
  });

  it("falls back to 'Investigator' for null/empty email", () => {
    expect(cpInvestigatorRole(null, roleMap)).toBe('Investigator');
    expect(cpInvestigatorRole('', roleMap)).toBe('Investigator');
  });
});

describe('cpCategoryClass', () => {
  it('classifies mechanism keywords', () => {
    expect(cpCategoryClass('Motor not working').cls).toBe('mech');
    expect(cpCategoryClass('Recline issue').label).toBe('Mechanism');
    expect(cpCategoryClass('Handset fault').cls).toBe('mech');
  });

  it('classifies fabric keywords', () => {
    expect(cpCategoryClass('Cover ripped').cls).toBe('fab');
    expect(cpCategoryClass('Leather scuff').label).toBe('Fabric');
  });

  it('classifies frame keywords', () => {
    expect(cpCategoryClass('Wooden rail cracked').cls).toBe('frame');
    expect(cpCategoryClass('Joint loose').label).toBe('Frame');
  });

  it('classifies foam, stitching, delivery keywords', () => {
    expect(cpCategoryClass('Foam compressed').cls).toBe('foam');
    expect(cpCategoryClass('Seam stitch failed').cls).toBe('stitch');
    expect(cpCategoryClass('Damaged in delivery').cls).toBe('deliv');
  });

  it("returns 'other' with the original category as label when nothing matches", () => {
    expect(cpCategoryClass('Mystery complaint')).toEqual({ cls: 'other', label: 'Mystery complaint' });
  });

  it("returns 'Other' label for empty / null input", () => {
    expect(cpCategoryClass('')).toEqual({ cls: 'other', label: 'Other' });
    expect(cpCategoryClass(null)).toEqual({ cls: 'other', label: 'Other' });
  });
});

describe('cpSlaBand', () => {
  const now = new Date('2026-05-12T12:00:00');

  it("flags an Open complaint as 'bad' once unassigned >3 days", () => {
    const out = cpSlaBand({ status: 'Open', OpenDate: '01/05/2026' }, now);
    expect(out.band).toBe('bad');
    expect(out.isOverdue).toBe(true);
    expect(out.label).toContain('Unassigned');
  });

  it("keeps an Open complaint 'ok' while unassigned <=3 days", () => {
    const out = cpSlaBand({ status: 'Open', OpenDate: '10/05/2026' }, now);
    expect(out.band).toBe('ok');
    expect(out.isOverdue).toBe(false);
  });

  it("InProgress: ok <=21d, warn 22-35d, bad >35d", () => {
    expect(cpSlaBand({ status: 'InProgress', OpenDate: '01/05/2026' }, now).band).toBe('ok');   // 11d
    expect(cpSlaBand({ status: 'InProgress', OpenDate: '15/04/2026' }, now).band).toBe('warn'); // 27d
    expect(cpSlaBand({ status: 'InProgress', OpenDate: '01/04/2026' }, now).band).toBe('bad');  // 41d
  });

  it("PendingClosure: warns when >7 days since investigator signed", () => {
    const out = cpSlaBand({
      status: 'PendingClosure', OpenDate: '15/04/2026',
      inv: { InvestigatorSignedDate: '01/05/2026 14:30' },
    }, now);
    expect(out.band).toBe('warn'); // 11d since signed
  });

  it("Closed: returns elapsed days neutrally", () => {
    const out = cpSlaBand({
      status: 'Closed', OpenDate: '01/05/2026',
      inv: { ClosedDate: '10/05/2026' },
    }, now);
    expect(out.band).toBe('neutral');
    expect(out.days).toBe(9);
    expect(out.label).toBe('Closed · 9d');
  });

  it("returns neutral '—' when OpenDate is missing or unparseable", () => {
    expect(cpSlaBand({ status: 'Open' }, now).label).toBe('—');
    expect(cpSlaBand({ status: 'Open', OpenDate: 'garbage' }, now).label).toBe('—');
  });

  it("handles null / undefined complaint safely", () => {
    expect(cpSlaBand(null).band).toBe('neutral');
    expect(cpSlaBand(undefined).label).toBe('—');
  });
});

describe('cpKpiAgg', () => {
  const now = new Date('2026-05-12T12:00:00');

  it('returns zero-state for empty input', () => {
    expect(cpKpiAgg([], now)).toEqual({
      openUnassigned: 0, inProgress: 0, overdue: 0, closed30: 0, avgRes: '—',
    });
  });

  it('counts open/inProgress and overdues', () => {
    const k = cpKpiAgg([
      { status: 'Open',       OpenDate: '01/05/2026' },   // overdue (>3d unassigned)
      { status: 'Open',       OpenDate: '10/05/2026' },   // not yet overdue
      { status: 'InProgress', OpenDate: '01/04/2026' },   // overdue (>35d)
      { status: 'InProgress', OpenDate: '05/05/2026' },
    ], now);
    expect(k.openUnassigned).toBe(2);
    expect(k.inProgress).toBe(2);
    expect(k.overdue).toBe(2);
  });

  it('closed30 counts complaints closed within the last 30 days', () => {
    const k = cpKpiAgg([
      { status: 'Closed', OpenDate: '01/04/2026', inv: { ClosedDate: '01/05/2026' } },   // in window
      { status: 'Closed', OpenDate: '01/03/2026', inv: { ClosedDate: '01/04/2026' } },   // >30d ago — out
      { status: 'Closed', OpenDate: '01/05/2026', inv: { ClosedDate: '10/05/2026' } },   // in window
    ], now);
    expect(k.closed30).toBe(2);
  });

  it('avgRes averages resolution days for all closed complaints (one decimal)', () => {
    const k = cpKpiAgg([
      { status: 'Closed', OpenDate: '01/05/2026', inv: { ClosedDate: '06/05/2026' } }, // 5d
      { status: 'Closed', OpenDate: '01/05/2026', inv: { ClosedDate: '11/05/2026' } }, // 10d
    ], now);
    expect(k.avgRes).toBe('7.5');
  });

  it('handles null entries in the list safely', () => {
    const k = cpKpiAgg([null, { status: 'Open', OpenDate: '01/05/2026' }, undefined], now);
    expect(k.openUnassigned).toBe(1);
  });
});
