'use strict';
// Run: node --test assembly-backlog-report/working-days.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isWorkingDay, workingPrepNumber, isoWeekOfDateUTC, UK_BANK_HOLIDAYS } = require('./working-days');

test('isWorkingDay: weekends and bank holidays are non-working', () => {
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 17)), true);   // Wed 17 Jun 2026
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 20)), false);  // Sat
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 21)), false);  // Sun
  assert.strictEqual(isWorkingDay(new Date(2026, 4, 25)), false);  // 2026-05-25 spring BH
  assert.ok(UK_BANK_HOLIDAYS.has('2026-12-25'));
});

test('workingPrepNumber: 1-based working-day index within the week, 0 on non-working', () => {
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 15)), 1); // Mon
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 17)), 3); // Wed
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 20)), 0); // Sat
  // Bank-holiday Monday 2026-05-25 → Tue is prep 1
  assert.strictEqual(workingPrepNumber(new Date(2026, 4, 26)), 1);
});

test('isoWeekOfDateUTC matches ISO week numbering', () => {
  assert.strictEqual(isoWeekOfDateUTC(new Date(2026, 0, 1)), 1);
  assert.strictEqual(isoWeekOfDateUTC(new Date(2026, 5, 17)), 25);
});
