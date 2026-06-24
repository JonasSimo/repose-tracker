'use strict';

// Ported verbatim from repnet/src/shared/workingDays.ts (isWorkingDay,
// workingPrepNumber, localDateKey, UK_BANK_HOLIDAYS) and the UTC isoWeekOfDate
// from repnet/src/shared/dates.ts. Keep UK_BANK_HOLIDAYS in sync with the app.

const UK_BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWorkingDay(d, holidays = UK_BANK_HOLIDAYS) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(localDateKey(d));
}

function workingPrepNumber(d, holidays = UK_BANK_HOLIDAYS) {
  if (!isWorkingDay(d, holidays)) return 0;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  let count = 0;
  for (let cur = new Date(mon); cur.getTime() <= d.getTime(); cur.setDate(cur.getDate() + 1)) {
    if (isWorkingDay(cur, holidays)) count++;
  }
  return count;
}

// UTC variant — repnet/src/shared/dates.ts isoWeekOfDate. Used by the backlog
// calc for `WK ${isoWeekOfDateUTC(today)}`. DO NOT replace with the local-time
// variant used in plan-weeks.js.
function isoWeekOfDateUTC(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

module.exports = { UK_BANK_HOLIDAYS, localDateKey, isWorkingDay, workingPrepNumber, isoWeekOfDateUTC };
