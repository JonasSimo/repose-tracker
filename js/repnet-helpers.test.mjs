import { describe, it, expect } from 'vitest';
import {
  isoNoMs,
  sanitiseFileName,
  extOf,
  safeJson,
  emptyApprovalState,
  isFullyApproved,
  isRejected,
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
