// Unit tests for the Azure Function `morning-team-digest`.
//
// The handler's pure helpers are private to index.js (the module export
// IS the handler). Mirrored verbatim here with KEEP IN SYNC comments,
// same pattern as the nms-reminders test file and the repnet-helpers
// mirrors of index.html.
import { describe, it, expect } from 'vitest';

// ── Mirrors from azure-functions/morning-team-digest/index.js ─────────

// Mirror of parseCPARDate (line ~26 of index.js — identical to the
// index.html / repnet-helpers version; kept local because the function
// handler doesn't export it).
function parseCPARDate(str) {
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
  return new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${timePart}:00`);
}

// Mirror of _normaliseLoggedAtDay (line ~38). Normalises a LoggedAt
// string into YYYY-MM-DD regardless of source format. Returns '' on
// unparseable input.
function _normaliseLoggedAtDay(la) {
  if (!la) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(la)) return la.slice(0, 10);
  const [d, m, y] = String(la).split(/[/ ]/);
  return y ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}

// Mirror of lastWorkingDay (line ~126). "Yesterday" but skips back to
// Friday from a Mon/Sat/Sun input. Takes `now` for testability.
function lastWorkingDay(d = new Date()) {
  const x = new Date(d); x.setDate(x.getDate() - 1);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1);
  return x;
}

// Mirror of daysOpen (line ~131). Note: returns '?' (string) on
// unparseable, unlike nms-reminders' daysOpen which returns 0. Caller
// renders it directly into HTML so a sentinel string is fine.
function daysOpen(loggedAt, now = new Date()) {
  const d = parseCPARDate(loggedAt);
  if (!d.getTime()) return '?';
  return Math.floor((now.getTime() - d) / 86400000);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('_normaliseLoggedAtDay', () => {
  it('passes through an ISO date as-is (first 10 chars)', () => {
    expect(_normaliseLoggedAtDay('2026-05-12')).toBe('2026-05-12');
    expect(_normaliseLoggedAtDay('2026-05-12T14:30:00Z')).toBe('2026-05-12');
  });

  it('converts DD/MM/YYYY to YYYY-MM-DD with zero-padding', () => {
    expect(_normaliseLoggedAtDay('5/3/2026')).toBe('2026-03-05');
    expect(_normaliseLoggedAtDay('15/05/2026')).toBe('2026-05-15');
  });

  it('handles a trailing time portion on DD/MM/YYYY (splits on space too)', () => {
    expect(_normaliseLoggedAtDay('15/05/2026 14:30')).toBe('2026-05-15');
  });

  it("returns '' for null / empty input", () => {
    expect(_normaliseLoggedAtDay(null)).toBe('');
    expect(_normaliseLoggedAtDay('')).toBe('');
  });

  it("returns '' when the split produces fewer than 3 parts", () => {
    // No '/' or ' ' → split returns single-element array → y is undefined
    // → guard kicks in.
    expect(_normaliseLoggedAtDay('not')).toBe('');
    expect(_normaliseLoggedAtDay('123')).toBe('');
  });

  // ── KNOWN BUG flagged by this test ──────────────────────────────────────
  // `_normaliseLoggedAtDay('not a date')` does NOT return ''. The split on
  // `/` and ` ` produces ['not','a','date'], the third part is truthy, so
  // the function happily templates them back as `date-0a-not`. It should
  // validate that d/m/y are numeric before formatting. The downstream
  // consumer (a SharePoint filter clause) silently filters nothing in
  // this case, so the bug has been masked in production. Fix on the
  // production side; this test pins the current behaviour to prevent
  // accidental "fix" while QHSE decides the right shape.
  it('[KNOWN BUG] templates garbage when split produces 3 non-numeric parts', () => {
    expect(_normaliseLoggedAtDay('not a date')).toBe('date-0a-not');
  });
});

describe('lastWorkingDay', () => {
  it('returns yesterday on a Tuesday', () => {
    const tue = new Date(2026, 4, 12); // Tue 12 May 2026
    const out = lastWorkingDay(tue);
    expect(out.getDate()).toBe(11);
    expect(out.getDay()).toBe(1); // Mon
  });

  it('skips back to Friday from a Monday', () => {
    const mon = new Date(2026, 4, 11);
    const out = lastWorkingDay(mon);
    expect(out.getDay()).toBe(5); // Fri
    expect(out.getDate()).toBe(8);
  });

  it('skips back to Friday from a Saturday', () => {
    const sat = new Date(2026, 4, 16);
    expect(lastWorkingDay(sat).getDay()).toBe(5);
  });

  it('skips back to Friday from a Sunday', () => {
    const sun = new Date(2026, 4, 17);
    expect(lastWorkingDay(sun).getDay()).toBe(5);
  });

  it('does not mutate the input', () => {
    const tue = new Date(2026, 4, 12);
    const before = tue.getTime();
    lastWorkingDay(tue);
    expect(tue.getTime()).toBe(before);
  });
});

describe('daysOpen (morning-team-digest variant)', () => {
  const now = new Date('2026-05-12T08:00:00Z');

  it('returns the integer day count for valid ISO input', () => {
    expect(daysOpen('2026-05-05T08:00:00Z', now)).toBe(7);
    expect(daysOpen('2026-05-12T08:00:00Z', now)).toBe(0);
  });

  it('accepts the DD/MM/YYYY HH:MM legacy format', () => {
    expect(daysOpen('05/05/2026 08:00', now)).toBe(7);
  });

  it("returns the sentinel '?' for empty / null / unparseable input", () => {
    expect(daysOpen('', now)).toBe('?');
    expect(daysOpen(null, now)).toBe('?');
    expect(daysOpen('not a date', now)).toBe('?');
  });

  it('floors fractional days', () => {
    // 6.5 days → 6, not 7
    expect(daysOpen('2026-05-05T20:00:00Z', now)).toBe(6);
  });
});
