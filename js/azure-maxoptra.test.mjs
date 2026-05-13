// Unit tests for the Azure Function `service-maxoptra-poll`.
//
// Pure helpers private to azure-functions/service-maxoptra-poll/index.js,
// mirrored here verbatim. KEEP IN SYNC if you touch the originals.
// fmtDateLocal / fmtDateOnly are intentionally skipped — they depend on
// Node's ICU data for Europe/London output formatting and would be
// flaky across CI vs. local runners.
import { describe, it, expect } from 'vitest';

// ── Mirrors from azure-functions/service-maxoptra-poll/index.js ─────────

function _norm(s) { return String(s || '').trim().toLowerCase(); }

function findColIdx(headerRow, name) {
  const target = _norm(name);
  return headerRow.findIndex(h => _norm(h) === target);
}

function parseChairId(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const m = /^(REP\d+)(?:-R(\d+))?$/i.exec(v);
  if (!m) return { rep: v, returnNo: 0, isReturn: false, label: v };
  return { rep: m[1].toUpperCase(), returnNo: m[2] ? parseInt(m[2], 10) : 0, isReturn: !!m[2], label: v.toUpperCase() };
}

// Mock fmtDate helpers (replaced with deterministic strings — the real
// helpers return locale-formatted strings that we don't assert against
// in tests here).
const fmtDateOnly = d => (d && !isNaN(d.getTime()) ? '<date>' : '');
const fmtDateLocal = d => (d && !isNaN(d.getTime()) ? '<datetime>' : '');

function mapMaxoptraStatus(rawStatus, scheduledTime, completedAt) {
  const s = String(rawStatus || '').trim().toLowerCase();
  const sched = scheduledTime ? new Date(scheduledTime) : null;
  const done  = completedAt ? new Date(completedAt) : null;
  if (s === 'cancelled' || s === 'canceled' || s === 'failed' || s === 'rejected') {
    return `❌ Collection ${s} · please rebook`;
  }
  if (s === 'completed' || s === 'delivered' || s === 'finished') {
    const when = fmtDateOnly(done || sched);
    return when ? `✅ In factory · ${when}` : `✅ In factory`;
  }
  if (s === 'inprogress' || s === 'in_progress' || s === 'in progress' ||
      s === 'pickedup'   || s === 'picked_up'   || s === 'picked up'   ||
      s === 'onway'      || s === 'on_way'      || s === 'on way') {
    return `🚚 Collected · returning to factory`;
  }
  if (s === 'planned' || s === 'scheduled' || s === 'assigned') {
    const when = fmtDateLocal(sched);
    return when ? `📅 Scheduled · ${when}` : `📅 Scheduled`;
  }
  return `❓ ${rawStatus || 'unknown'}`;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('_norm', () => {
  it('trims and lowercases input', () => {
    expect(_norm('  FOO  ')).toBe('foo');
    expect(_norm('Bar')).toBe('bar');
  });

  it('coerces non-strings safely', () => {
    expect(_norm(null)).toBe('');
    expect(_norm(undefined)).toBe('');
    expect(_norm(123)).toBe('123');
  });
});

describe('findColIdx', () => {
  const header = ['Chair ID', 'Customer', 'Scheduled', 'Status'];

  it('finds a header case-insensitively, trimming whitespace', () => {
    expect(findColIdx(header, 'Customer')).toBe(1);
    expect(findColIdx(header, 'customer')).toBe(1);
    expect(findColIdx(header, '  CUSTOMER  ')).toBe(1);
    expect(findColIdx(header, 'STATUS')).toBe(3);
  });

  it('returns -1 when not found', () => {
    expect(findColIdx(header, 'no such column')).toBe(-1);
  });

  it('does not partial-match (requires exact normalised equality)', () => {
    expect(findColIdx(header, 'Chair')).toBe(-1);
    expect(findColIdx(header, 'Chair ID Extra')).toBe(-1);
  });
});

describe('parseChairId', () => {
  it('returns null for empty input', () => {
    expect(parseChairId('')).toBe(null);
    expect(parseChairId(null)).toBe(null);
    expect(parseChairId(undefined)).toBe(null);
    expect(parseChairId('   ')).toBe(null);
  });

  it('parses a plain REP id', () => {
    expect(parseChairId('REP1234567')).toEqual({
      rep: 'REP1234567', returnNo: 0, isReturn: false, label: 'REP1234567',
    });
  });

  it('uppercases lowercase REP ids on output', () => {
    expect(parseChairId('rep1234567').rep).toBe('REP1234567');
    expect(parseChairId('rep1234567').label).toBe('REP1234567');
  });

  it('parses a return chair with -R suffix', () => {
    expect(parseChairId('REP1234567-R2')).toEqual({
      rep: 'REP1234567', returnNo: 2, isReturn: true, label: 'REP1234567-R2',
    });
  });

  it('treats non-matching strings as a label-only fallback (rep=label, isReturn=false)', () => {
    // The fallback branch — used for chair IDs that don't follow the
    // REPnnnnnnn[-Rn] convention (e.g. legacy IDs, manual edits).
    const out = parseChairId('CUSTOM-123');
    expect(out.rep).toBe('CUSTOM-123');
    expect(out.label).toBe('CUSTOM-123');
    expect(out.isReturn).toBe(false);
    expect(out.returnNo).toBe(0);
  });

  it('trims whitespace before matching', () => {
    expect(parseChairId('  REP1234567  ').rep).toBe('REP1234567');
  });
});

describe('mapMaxoptraStatus', () => {
  it('maps cancelled / canceled / failed / rejected to "please rebook"', () => {
    expect(mapMaxoptraStatus('cancelled', null, null)).toBe('❌ Collection cancelled · please rebook');
    expect(mapMaxoptraStatus('canceled', null, null)).toBe('❌ Collection canceled · please rebook');
    expect(mapMaxoptraStatus('failed', null, null)).toBe('❌ Collection failed · please rebook');
    expect(mapMaxoptraStatus('rejected', null, null)).toBe('❌ Collection rejected · please rebook');
  });

  it('maps completed / delivered / finished to "in factory" with a date', () => {
    expect(mapMaxoptraStatus('completed', '2026-05-12T14:00:00Z', '2026-05-12T16:30:00Z'))
      .toBe('✅ In factory · <date>');
    expect(mapMaxoptraStatus('delivered', null, '2026-05-12T16:30:00Z'))
      .toBe('✅ In factory · <date>');
    expect(mapMaxoptraStatus('finished', '2026-05-12T14:00:00Z', null))
      .toBe('✅ In factory · <date>');
  });

  it('falls back to "in factory" without date when neither completedAt nor scheduledTime is provided', () => {
    expect(mapMaxoptraStatus('completed', null, null)).toBe('✅ In factory');
  });

  it('groups all "in transit" variants into the truck pill', () => {
    const expected = '🚚 Collected · returning to factory';
    expect(mapMaxoptraStatus('inprogress', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('in_progress', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('in progress', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('pickedup', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('picked_up', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('picked up', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('onway', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('on_way', null, null)).toBe(expected);
    expect(mapMaxoptraStatus('on way', null, null)).toBe(expected);
  });

  it('maps planned / scheduled / assigned to the scheduled pill', () => {
    expect(mapMaxoptraStatus('planned', '2026-05-12T14:00:00Z', null))
      .toBe('📅 Scheduled · <datetime>');
    expect(mapMaxoptraStatus('scheduled', '2026-05-12T14:00:00Z', null))
      .toBe('📅 Scheduled · <datetime>');
    expect(mapMaxoptraStatus('assigned', null, null))
      .toBe('📅 Scheduled');
  });

  it('is case-insensitive across all input statuses', () => {
    expect(mapMaxoptraStatus('CANCELLED', null, null)).toBe('❌ Collection cancelled · please rebook');
    expect(mapMaxoptraStatus('PlAnNeD', null, null)).toBe('📅 Scheduled');
  });

  it('falls through to the "❓" pill with the raw status surfaced', () => {
    expect(mapMaxoptraStatus('mystery_state', null, null)).toBe('❓ mystery_state');
    expect(mapMaxoptraStatus('', null, null)).toBe('❓ unknown');
    expect(mapMaxoptraStatus(null, null, null)).toBe('❓ unknown');
  });
});
