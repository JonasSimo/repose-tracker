// Unit tests for the Azure Function `nms-reminders`.
//
// Two parts:
//   1. The cleanly-exported `email.js` (BANDS, buildReminder, OVERDUE_LIMIT_DAYS)
//      is imported directly via vitest's CJS interop.
//   2. The two pure helpers inside `index.js` (`daysOpen`, `ownerForLocation`)
//      are private to the handler module — they're MIRRORED here verbatim
//      from index.js with a drift-risk comment. Same pattern as the
//      repnet-helpers module mirrors of index.html.
import { describe, it, expect } from 'vitest';
import nmsEmail from '../azure-functions/nms-reminders/email.js';
const { BANDS, buildReminder, OVERDUE_LIMIT_DAYS } = nmsEmail;

// ── Mirrors of the private helpers in azure-functions/nms-reminders/index.js ──
// KEEP IN SYNC with `daysOpen` (line ~143) and `ownerForLocation` (line ~153).
// If these diverge in the production handler, fix it there too.

function daysOpen(createdIso, now) {
  if (!createdIso) return 0;
  const created = new Date(createdIso);
  if (isNaN(created)) return 0;
  const c = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((n - c) / 86400000);
}

const TEST_OWNERS = {
  'repose - assembly':       'daniel.seymour@reposefurniture.co.uk',
  'repose - cutting':        'mark@reposefurniture.co.uk',
  'repose - foam':           'mitch@reposefurniture.co.uk',
  'prism - rhyl - quality':  'ian.morris@prismhealthcare.co.uk',
};

function ownerForLocation(locationOfIssue, table = TEST_OWNERS) {
  if (!locationOfIssue) return null;
  return table[locationOfIssue.trim().toLowerCase()] || null;
}

// ── BANDS constant ──────────────────────────────────────────────────────

describe('email.js — BANDS', () => {
  it('declares the four reminder days: 7, 14, 21, 26', () => {
    expect(BANDS.map(b => b.day)).toEqual([7, 14, 21, 26]);
  });

  it('each band carries kind, tone, accent, tag, subject', () => {
    for (const b of BANDS) {
      expect(typeof b.day).toBe('number');
      expect(typeof b.kind).toBe('string');
      expect(typeof b.tone).toBe('string');
      expect(typeof b.accent).toBe('string');
      expect(typeof b.tag).toBe('string');
      expect(typeof b.subject).toBe('string');
    }
  });

  it('only the day-26 band is critical', () => {
    const critical = BANDS.filter(b => b.kind === 'critical');
    expect(critical.length).toBe(1);
    expect(critical[0].day).toBe(26);
  });

  it('OVERDUE_LIMIT_DAYS is 28 (matches the SLA referenced in the email copy)', () => {
    expect(OVERDUE_LIMIT_DAYS).toBe(28);
  });

  it('all band days fall before the overdue limit', () => {
    for (const b of BANDS) expect(b.day).toBeLessThan(OVERDUE_LIMIT_DAYS);
  });
});

// ── buildReminder smoke tests ───────────────────────────────────────────

describe('email.js — buildReminder', () => {
  const baseItem = {
    id: '42',
    createdDateTime: '2026-04-15T09:00:00Z',
    fields: {
      ReferenceNumber: 'NMS-2026-042',
      Locationofissue: 'Repose - Cutting',
      RaisedBy_x003a_: 'Tom Malia',
      Whatistheissue_x003f_: 'Loose cable across walkway',
    },
  };
  const day14Band = BANDS.find(b => b.day === 14);

  it('returns an HTML document', () => {
    const out = buildReminder(baseItem, 14, day14Band);
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('</html>');
  });

  it('includes the reference number, location and issue text', () => {
    const out = buildReminder(baseItem, 14, day14Band);
    expect(out).toContain('NMS-2026-042');
    expect(out).toContain('Repose - Cutting');
    expect(out).toContain('Tom Malia');
    expect(out).toContain('Loose cable across walkway');
  });

  it('renders the days-open count in the body copy', () => {
    const out = buildReminder(baseItem, 14, day14Band);
    expect(out).toContain('14 days');
    expect(out).toContain('14 day'); // covers '14 days ago' table cell
  });

  it("the critical band's copy includes the 'will be marked overdue' callout", () => {
    const critBand = BANDS.find(b => b.kind === 'critical');
    const out = buildReminder(baseItem, 26, critBand);
    expect(out).toContain('will be marked overdue');
    expect(out).toContain('2 day');
  });

  it("non-critical bands use the gentler 'days since this near miss was raised' copy", () => {
    const out = buildReminder(baseItem, 7, BANDS[0]);
    expect(out).toContain('days since this near miss was raised');
  });

  it('falls back to Title then synthetic id when ReferenceNumber is missing', () => {
    const noRef = { ...baseItem, fields: { ...baseItem.fields, ReferenceNumber: '', Title: 'NMS-FALLBACK' } };
    expect(buildReminder(noRef, 14, day14Band)).toContain('NMS-FALLBACK');

    const noRefNoTitle = { id: 'abc123def456', createdDateTime: '2026-04-15', fields: {} };
    expect(buildReminder(noRefNoTitle, 14, day14Band)).toContain('NMS-abc123');
  });

  it('HTML-escapes potentially-hostile field content', () => {
    const evil = { ...baseItem, fields: { ...baseItem.fields, Whatistheissue_x003f_: '<script>alert(1)</script>' } };
    const out = buildReminder(evil, 14, day14Band);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('renders the band tag and the band accent colour into the header', () => {
    const out = buildReminder(baseItem, 14, day14Band);
    expect(out).toContain(day14Band.tag);
    expect(out).toContain(day14Band.accent);
  });
});

// ── daysOpen (mirrored from index.js) ───────────────────────────────────

describe('daysOpen', () => {
  const now = new Date('2026-05-12T08:00:00Z');

  it('returns 0 for null / empty / undefined createdIso', () => {
    expect(daysOpen(null, now)).toBe(0);
    expect(daysOpen('', now)).toBe(0);
    expect(daysOpen(undefined, now)).toBe(0);
  });

  it('returns 0 for an unparseable date string', () => {
    expect(daysOpen('not a date', now)).toBe(0);
  });

  it('returns whole days at UTC midnight (DST-safe)', () => {
    expect(daysOpen('2026-05-12T08:00:00Z', now)).toBe(0);  // same UTC day
    expect(daysOpen('2026-05-05T23:59:00Z', now)).toBe(7);
    expect(daysOpen('2026-04-28T00:00:00Z', now)).toBe(14);
  });

  it('does not double-count when the time crosses a DST boundary', () => {
    // 2026-03-29 is BST spring-forward in the UK. A simple local-time loop
    // would gain or lose an hour here; UTC arithmetic keeps the day count
    // stable.
    const before = new Date('2026-03-28T00:00:00Z');
    const after  = new Date('2026-03-30T00:00:00Z');
    expect(daysOpen(before.toISOString(), after)).toBe(2);
  });

  it('matches a 7-day-old createdAt to the day-7 reminder band', () => {
    const d = daysOpen('2026-05-05T08:00:00Z', now);
    expect(d).toBe(7);
    expect(BANDS.find(b => b.day === d)).toBeTruthy();
  });
});

// ── ownerForLocation (mirrored from index.js) ───────────────────────────

describe('ownerForLocation', () => {
  it('returns the mapped email for a known location', () => {
    expect(ownerForLocation('Repose - Cutting')).toBe('mark@reposefurniture.co.uk');
  });

  it('is case-insensitive on the lookup', () => {
    expect(ownerForLocation('REPOSE - CUTTING')).toBe('mark@reposefurniture.co.uk');
    expect(ownerForLocation('Repose - cutting')).toBe('mark@reposefurniture.co.uk');
  });

  it('trims whitespace around the location string', () => {
    expect(ownerForLocation('  Repose - Cutting  ')).toBe('mark@reposefurniture.co.uk');
  });

  it('handles cross-tenant Prism locations', () => {
    expect(ownerForLocation('Prism - Rhyl - Quality')).toBe('ian.morris@prismhealthcare.co.uk');
  });

  it('returns null for unknown locations (caller falls back to QHSE)', () => {
    expect(ownerForLocation('Mars - Olympus Mons')).toBe(null);
  });

  it('returns null for falsy input', () => {
    expect(ownerForLocation('')).toBe(null);
    expect(ownerForLocation(null)).toBe(null);
    expect(ownerForLocation(undefined)).toBe(null);
  });
});
