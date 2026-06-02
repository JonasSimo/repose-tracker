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

function lookupTicket(label, ticketsByLabel, ticketsByRep, openDateIdx, onAmbiguous) {
  if (!label) return undefined;

  const bareDigits = /^(\d+)(-R\d+)?$/i.exec(label);
  const candidates = [label];
  if (bareDigits) {
    candidates.push(`REP${bareDigits[1]}${bareDigits[2] || ''}`);
  }
  for (const c of candidates) {
    const t = ticketsByLabel.get(c);
    if (t) return t;
  }

  let repBase = null;
  const repPrefixed = /^(REP\d+)/i.exec(label);
  if (repPrefixed) repBase = repPrefixed[1].toUpperCase();
  else if (bareDigits) repBase = `REP${bareDigits[1]}`;
  if (!repBase) return undefined;

  const rows = ticketsByRep.get(repBase) || [];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1 && openDateIdx >= 0) {
    rows.sort((a, b) => (Number(b.raw[openDateIdx]) || 0) - (Number(a.raw[openDateIdx]) || 0));
    if (onAmbiguous) onAmbiguous(label, rows.length, rows[0].sheetRow);
    return rows[0];
  }
  return undefined;
}

function extractCustomFieldRefs(customFields) {
  if (!customFields) return [];
  const out = [];
  const isBatchKey = (k) => /batch/i.test(String(k || ''));
  const push = (v) => {
    if (v === null || v === undefined) return;
    String(v)
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => out.push(s));
  };
  if (Array.isArray(customFields)) {
    for (const entry of customFields) {
      if (!entry || typeof entry !== 'object') continue;
      const name = entry.name ?? entry.key ?? entry.label ?? '';
      if (!isBatchKey(name)) continue;
      const v = entry.value ?? entry.text ?? entry.values;
      if (Array.isArray(v)) v.forEach(push); else push(v);
    }
  } else if (typeof customFields === 'object') {
    for (const [k, v] of Object.entries(customFields)) {
      if (!isBatchKey(k)) continue;
      if (Array.isArray(v)) v.forEach(push); else push(v);
    }
  }
  return out;
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

describe('lookupTicket', () => {
  // Build the indexed maps the way the production loop does, given a list of
  // { label, openDate? } pairs. label is what sits in the REP Number column;
  // openDate is the Excel serial used to break ambiguity ties.
  function buildMaps(rows) {
    const ticketsByLabel = new Map();
    const ticketsByRep = new Map();
    rows.forEach((r, i) => {
      const entry = { rowIdx: i, sheetRow: i + 7, raw: [r.openDate ?? 0] };
      ticketsByLabel.set(r.label, entry);
      const repBase = /^(REP\d+)/i.exec(r.label)?.[1].toUpperCase();
      if (repBase) {
        if (!ticketsByRep.has(repBase)) ticketsByRep.set(repBase, []);
        ticketsByRep.get(repBase).push(entry);
      }
    });
    return { ticketsByLabel, ticketsByRep, openDateIdx: 0 };
  }

  it('matches the exact label when transport types the full REP-prefixed form', () => {
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('REP2533081-R1', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)?.sheetRow).toBe(7);
  });

  it('matches a bare-digit label by REP-prefixing the digits', () => {
    // The reported case — transport sometimes types "2533081-R1" instead of "REP2533081-R1".
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('2533081-R1', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)?.sheetRow).toBe(7);
  });

  it('matches a REP-prefixed label without -R suffix to the single -R variant', () => {
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('REP2533081', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)?.sheetRow).toBe(7);
  });

  it('matches a bare-digit label without -R suffix to the single -R variant', () => {
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('2533081', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)?.sheetRow).toBe(7);
  });

  it('picks the latest Open Date when multiple -R variants share the base REP', () => {
    const m = buildMaps([
      { label: 'REP2533081-R1', openDate: 45000 },
      { label: 'REP2533081-R2', openDate: 46000 },
    ]);
    let ambiguous = null;
    const result = lookupTicket('REP2533081', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx, (...a) => { ambiguous = a; });
    expect(result?.sheetRow).toBe(8); // -R2 was second row (sheetRow 8), latest Open Date
    expect(ambiguous).toEqual(['REP2533081', 2, 8]);
  });

  it('returns undefined for an unknown label', () => {
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('REP9999-R1', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)).toBeUndefined();
    expect(lookupTicket('9999-R1', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)).toBeUndefined();
  });

  it('returns undefined for an empty / non-matching label', () => {
    const m = buildMaps([{ label: 'REP2533081-R1' }]);
    expect(lookupTicket('', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)).toBeUndefined();
    expect(lookupTicket('NOTHING-MATCHES', m.ticketsByLabel, m.ticketsByRep, m.openDateIdx)).toBeUndefined();
  });
});

describe('extractCustomFieldRefs', () => {
  it('returns [] when customFields is missing or empty', () => {
    expect(extractCustomFieldRefs(null)).toEqual([]);
    expect(extractCustomFieldRefs(undefined)).toEqual([]);
    expect(extractCustomFieldRefs({})).toEqual([]);
    expect(extractCustomFieldRefs([])).toEqual([]);
  });

  it('extracts from a plain object map (the documented v6 shape)', () => {
    expect(extractCustomFieldRefs({ 'Batch numbers': 'REP2284-R1' })).toEqual(['REP2284-R1']);
  });

  it('matches the "batch" key substring case-insensitively', () => {
    expect(extractCustomFieldRefs({ BatchNumbers: 'REP2284-R1' })).toEqual(['REP2284-R1']);
    expect(extractCustomFieldRefs({ 'BATCH NUMBERS': 'REP2284-R1' })).toEqual(['REP2284-R1']);
    expect(extractCustomFieldRefs({ batch: 'REP2284-R1' })).toEqual(['REP2284-R1']);
  });

  it('ignores keys that do not contain "batch"', () => {
    expect(extractCustomFieldRefs({ Notes: 'REP2284-R1', SealNumber: 'X' })).toEqual([]);
  });

  it('splits multi-value strings on commas, semicolons, and whitespace', () => {
    expect(extractCustomFieldRefs({ 'Batch numbers': 'REP2284-R1, REP2285-R1' }))
      .toEqual(['REP2284-R1', 'REP2285-R1']);
    expect(extractCustomFieldRefs({ 'Batch numbers': 'REP2284-R1;REP2285-R1' }))
      .toEqual(['REP2284-R1', 'REP2285-R1']);
  });

  it('handles an array value under a batch key', () => {
    expect(extractCustomFieldRefs({ 'Batch numbers': ['REP2284-R1', 'REP2285-R1'] }))
      .toEqual(['REP2284-R1', 'REP2285-R1']);
  });

  it('handles the array-of-{name,value} shape', () => {
    expect(extractCustomFieldRefs([
      { name: 'Seal number', value: 'X' },
      { name: 'Batch numbers', value: 'REP2284-R1' },
    ])).toEqual(['REP2284-R1']);
  });

  it('also accepts `key` and `label` as field-name aliases', () => {
    expect(extractCustomFieldRefs([{ key: 'Batch numbers', value: 'REP2284-R1' }]))
      .toEqual(['REP2284-R1']);
    expect(extractCustomFieldRefs([{ label: 'Batch numbers', text: 'REP2284-R1' }]))
      .toEqual(['REP2284-R1']);
  });

  it('preserves the user-typed REP value verbatim — does not REP-prefix or uppercase', () => {
    // Caller uppercases when matching against the indexed labels.
    expect(extractCustomFieldRefs({ 'Batch numbers': '2533081-R1' })).toEqual(['2533081-R1']);
    expect(extractCustomFieldRefs({ 'Batch numbers': 'rep2284-r1' })).toEqual(['rep2284-r1']);
  });

  it('skips null / undefined / empty entries', () => {
    expect(extractCustomFieldRefs({ 'Batch numbers': null })).toEqual([]);
    expect(extractCustomFieldRefs({ 'Batch numbers': '' })).toEqual([]);
    expect(extractCustomFieldRefs({ 'Batch numbers': '   ' })).toEqual([]);
  });
});
