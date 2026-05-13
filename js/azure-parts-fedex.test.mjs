// Unit tests for the Azure Function `parts-fedex-poll`.
//
// Pure helpers private to azure-functions/parts-fedex-poll/index.js,
// mirrored here verbatim. KEEP IN SYNC if you touch the originals.
// Same pattern as the other Azure-function test files in this folder.
import { describe, it, expect } from 'vitest';

// ── Mirrors from azure-functions/parts-fedex-poll/index.js ───────────────

// Mirror of parseTrackingResult (line ~150). Normalises one entry of a
// FedEx /track/v1/trackingnumbers response into our internal shape.
function parseTrackingResult(result) {
  const trackingNumber = (result.trackingNumber || '').replace(/\s+/g, '');
  const r = (result.trackResults && result.trackResults[0]) || {};
  const status = r.latestStatusDetail || {};
  const code = status.code || status.derivedCode || '';
  const isDelivered = code === 'DL';
  let deliveredAt = null;
  let signedBy = null;
  if (isDelivered) {
    const dt = (r.dateAndTimes || []).find(d => d.type === 'ACTUAL_DELIVERY');
    if (dt && dt.dateTime) deliveredAt = new Date(dt.dateTime);
    if (r.deliveryDetails) {
      signedBy = r.deliveryDetails.receivedByName || r.deliveryDetails.signedByName || null;
    }
  }
  let eventAt = null;
  const dates = r.dateAndTimes || [];
  const pick = (t) => dates.find(d => d.type === t);
  const hit = pick('ACTUAL_PICKUP') || pick('SHIP') || pick('APPOINTMENT_DELIVERY');
  if (hit && hit.dateTime) eventAt = new Date(hit.dateTime);
  return {
    trackingNumber,
    isDelivered,
    deliveredAt,
    signedBy,
    eventCode: code,
    eventLabel: status.description || status.statusByLocale || code || 'Unknown',
    eventAt,
    currentStatus: status.description || status.statusByLocale || code || 'Unknown',
  };
}

// Mirror of fmtDeliveredText (line ~201).
function fmtDeliveredText(d) {
  if (!d || isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} @ ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

// Mirror of colIdxToLetter (line ~208). 0-based index → Excel column letter.
function colIdxToLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

// Mirror of the nested _parseDateCell helper (line ~306). Handles Excel
// serial numbers, DD/MM/YY[YY], or free-form date strings.
function _parseDateCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  const s = String(v).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [d, m, y] = s.split('/').map(n => parseInt(n, 10));
    const fy = y < 100 ? 2000 + y : y;
    const dt = new Date(fy, m - 1, d);
    return isNaN(dt) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt) ? null : dt;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('parseTrackingResult', () => {
  it('strips whitespace from the tracking number', () => {
    const out = parseTrackingResult({ trackingNumber: '123 456 789' });
    expect(out.trackingNumber).toBe('123456789');
  });

  it('returns an Unknown shape when trackResults is missing', () => {
    const out = parseTrackingResult({ trackingNumber: '1234' });
    expect(out.isDelivered).toBe(false);
    expect(out.deliveredAt).toBe(null);
    expect(out.eventCode).toBe('');
    expect(out.eventLabel).toBe('Unknown');
    expect(out.currentStatus).toBe('Unknown');
  });

  it('detects DL (delivered) and captures deliveredAt + signedBy', () => {
    const out = parseTrackingResult({
      trackingNumber: '999',
      trackResults: [{
        latestStatusDetail: { code: 'DL', description: 'Delivered' },
        dateAndTimes: [
          { type: 'ACTUAL_PICKUP',   dateTime: '2026-05-01T10:00:00Z' },
          { type: 'ACTUAL_DELIVERY', dateTime: '2026-05-05T14:30:00Z' },
        ],
        deliveryDetails: { receivedByName: 'J. Smith' },
      }],
    });
    expect(out.isDelivered).toBe(true);
    expect(out.deliveredAt.toISOString()).toBe('2026-05-05T14:30:00.000Z');
    expect(out.signedBy).toBe('J. Smith');
    expect(out.eventLabel).toBe('Delivered');
  });

  it('falls back to signedByName when receivedByName is missing', () => {
    const out = parseTrackingResult({
      trackingNumber: '999',
      trackResults: [{
        latestStatusDetail: { code: 'DL' },
        dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-05-05T14:30:00Z' }],
        deliveryDetails: { signedByName: 'Mr Doe' },
      }],
    });
    expect(out.signedBy).toBe('Mr Doe');
  });

  it('does not set deliveredAt when ACTUAL_DELIVERY is missing even with DL code', () => {
    const out = parseTrackingResult({
      trackingNumber: '999',
      trackResults: [{ latestStatusDetail: { code: 'DL' }, dateAndTimes: [] }],
    });
    expect(out.isDelivered).toBe(true);
    expect(out.deliveredAt).toBe(null);
  });

  it('picks eventAt with fallback order ACTUAL_PICKUP → SHIP → APPOINTMENT_DELIVERY', () => {
    const a = parseTrackingResult({
      trackingNumber: '1', trackResults: [{
        latestStatusDetail: { code: 'PU' },
        dateAndTimes: [
          { type: 'SHIP',                dateTime: '2026-05-01T00:00:00Z' },
          { type: 'ACTUAL_PICKUP',       dateTime: '2026-05-02T10:00:00Z' },
          { type: 'APPOINTMENT_DELIVERY', dateTime: '2026-05-04T00:00:00Z' },
        ],
      }],
    });
    // ACTUAL_PICKUP wins
    expect(a.eventAt.toISOString()).toBe('2026-05-02T10:00:00.000Z');

    const b = parseTrackingResult({
      trackingNumber: '2', trackResults: [{
        latestStatusDetail: { code: 'IT' },
        dateAndTimes: [{ type: 'SHIP', dateTime: '2026-05-01T00:00:00Z' }],
      }],
    });
    expect(b.eventAt.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('falls through derivedCode when code is missing', () => {
    const out = parseTrackingResult({
      trackingNumber: '1',
      trackResults: [{ latestStatusDetail: { derivedCode: 'IT' } }],
    });
    expect(out.eventCode).toBe('IT');
  });

  it('uses statusByLocale when description is missing', () => {
    const out = parseTrackingResult({
      trackingNumber: '1',
      trackResults: [{ latestStatusDetail: { code: 'IT', statusByLocale: 'In transit' } }],
    });
    expect(out.eventLabel).toBe('In transit');
  });
});

describe('fmtDeliveredText', () => {
  it('formats a Date in DD.MM.YY @ HH.mm', () => {
    expect(fmtDeliveredText(new Date(2026, 4, 5, 14, 30))).toBe('05.05.26 @ 14.30');
    expect(fmtDeliveredText(new Date(2026, 11, 31, 9, 5))).toBe('31.12.26 @ 09.05');
  });

  it('returns "" for null / undefined / Invalid Date', () => {
    expect(fmtDeliveredText(null)).toBe('');
    expect(fmtDeliveredText(undefined)).toBe('');
    expect(fmtDeliveredText(new Date('not a date'))).toBe('');
  });
});

describe('colIdxToLetter', () => {
  it('handles the single-letter column range (0..25 → A..Z)', () => {
    expect(colIdxToLetter(0)).toBe('A');
    expect(colIdxToLetter(1)).toBe('B');
    expect(colIdxToLetter(25)).toBe('Z');
  });

  it('rolls over correctly at 26 → AA (the classic off-by-one)', () => {
    expect(colIdxToLetter(26)).toBe('AA');
    expect(colIdxToLetter(27)).toBe('AB');
    expect(colIdxToLetter(51)).toBe('AZ');
    expect(colIdxToLetter(52)).toBe('BA');
  });

  it('handles ZZ → AAA at index 702', () => {
    expect(colIdxToLetter(701)).toBe('ZZ');
    expect(colIdxToLetter(702)).toBe('AAA');
  });
});

describe('_parseDateCell', () => {
  it('returns null for null / undefined / empty', () => {
    expect(_parseDateCell(null)).toBe(null);
    expect(_parseDateCell(undefined)).toBe(null);
    expect(_parseDateCell('')).toBe(null);
  });

  it('converts an Excel serial number to a Date (epoch 1900-01-01 = 1)', () => {
    // Excel serial 44927 = 1 Jan 2023
    const d = _parseDateCell(44927);
    expect(d.getUTCFullYear()).toBe(2023);
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it('parses DD/MM/YYYY', () => {
    const d = _parseDateCell('15/05/2026');
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(4);
    expect(d.getFullYear()).toBe(2026);
  });

  it('expands 2-digit years as 20YY', () => {
    const d = _parseDateCell('15/05/26');
    expect(d.getFullYear()).toBe(2026);
  });

  it('falls back to native Date for free-form strings', () => {
    const d = _parseDateCell('2026-05-15T10:00:00Z');
    expect(d.toISOString()).toBe('2026-05-15T10:00:00.000Z');
  });

  it('returns null for unparseable input', () => {
    expect(_parseDateCell('not a date')).toBe(null);
  });

  it('returns null for malformed DD/MM with non-numeric (parseInt → NaN guard)', () => {
    // parseInt('aa', 10) = NaN → new Date(NaN, ...) is Invalid Date → isNaN → null
    expect(_parseDateCell('aa/bb/26')).toBe(null);
  });
});
