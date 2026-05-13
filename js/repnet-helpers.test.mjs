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
