'use strict';
// Run: node --test assembly-backlog-report/assembly-backlog.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  getAssemblyBacklogRows, backlogRowsToCsv, backlogCsvWithBom, backlogFilename,
} = require('./assembly-backlog');

// Wed 17 Jun 2026 is WK 25; Mon of WK 25 is 15/06/2026. Build a current-week
// plan with one overdue Monday job, one done Monday job, one QC-passed Monday
// job, and one future (today/Wed) job that must NOT be in the backlog.
function fixture() {
  const weeks = [{
    wk: 'WK 25', wc: '15/06/2026',
    preps: {
      1: [
        { rep: 'REP 1000001', itemNo: 10, expressType: null }, // overdue → in backlog
        { rep: 'REP 1000002', itemNo: 11, expressType: null }, // done → excluded
        { rep: 'REP 1000003', itemNo: 12, expressType: null }, // QC passed → excluded
      ],
      2: [], 3: [
        { rep: 'REP 1000004', itemNo: 13, expressType: null }, // Wed (today) → not past → excluded
      ], 4: [], 5: [], express: [],
    },
  }];
  const doneSet = new Set(['Assembly|all|WK 25|1|REP 1000002']);
  const qc = new Set(['1000003']);
  return { weeks, doneSet, qc };
}

test('getAssemblyBacklogRows includes only overdue, not-done, not-QC jobs', () => {
  const { weeks, doneSet, qc } = fixture();
  const rows = getAssemblyBacklogRows(weeks, doneSet, qc, new Date(2026, 5, 17)); // Wed
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].rep, 'REP 1000001');
  assert.strictEqual(rows[0].prepLbl, 'Mon');
  assert.strictEqual(rows[0].itemNo, '10');
  assert.strictEqual(rows[0].daysLate, 2); // Tue + Wed working days after Mon due
});

test('backlogRowsToCsv emits the exact header and quoted rows with CRLF', () => {
  const { weeks, doneSet, qc } = fixture();
  const rows = getAssemblyBacklogRows(weeks, doneSet, qc, new Date(2026, 5, 17));
  const csv = backlogRowsToCsv(rows);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines[0], '"REP","Week","W/C Date","Prep Day","Item No","Days Late","Express?"');
  assert.strictEqual(lines[1], '"REP 1000001","WK 25","15/06/2026","Mon","10","2",""');
});

test('backlogCsvWithBom prepends the UTF-8 BOM; filename uses local date', () => {
  const csv = backlogCsvWithBom([]);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  assert.strictEqual(backlogFilename(new Date(2026, 5, 17)), 'repose-assembly-backlog-2026-06-17.csv');
});
