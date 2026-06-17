'use strict';
// Run: node --test assembly-backlog-report/plan-weeks.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseSheetValues, distributeIntoPreps } = require('./plan-weeks');

// Build a values grid. Header row 0 has 'Item' in col 10 (K) → startRow = 1.
// Columns used by the parser: 10=item code (K), 11=REP cell (L), 60=prep (BI).
function rowWith(item, repCell, prepCell) {
  const r = new Array(61).fill('');
  r[10] = item; r[11] = repCell; r[60] = prepCell;
  return r;
}

test('parseSheetValues extracts REP, itemNo, prep from K/L/BI', () => {
  const header = new Array(61).fill(''); header[10] = 'Item No';
  const values = [
    header,
    rowWith('10', 'REP 1234567', 'PREP 1'),
    rowWith('11', 'something REP 7654321 x', 'PREP 3'),
    rowWith('EXP1', 'REP 2222222', 'EXP'),
    rowWith('5', 'no rep here', 'PREP 2'),     // dropped: no REP
  ];
  const jobs = parseSheetValues(values);
  assert.strictEqual(jobs.length, 3);
  assert.deepStrictEqual(
    jobs.map((j) => [j.rep, j.prep, j.expressType]),
    [['REP 1234567', 1, null], ['REP 7654321', 3, null], ['REP 2222222', 'express', 'EXP']],
  );
});

test('distributeIntoPreps buckets by numeric prep and express', () => {
  const header = new Array(61).fill(''); header[10] = 'Item No';
  const jobs = parseSheetValues([
    header,
    rowWith('10', 'REP 1000001', 'PREP 1'),
    rowWith('11', 'REP 1000002', 'PREP 1'),
    rowWith('12', 'REP 1000003', 'PREP 5'),
    rowWith('EXP1', 'REP 1000004', 'EXP'),
  ]);
  const preps = distributeIntoPreps(jobs);
  assert.strictEqual(preps[1].length, 2);
  assert.strictEqual(preps[5].length, 1);
  assert.strictEqual(preps.express.length, 1);
  assert.strictEqual(preps[1][0].rep, 'REP 1000001');
});
