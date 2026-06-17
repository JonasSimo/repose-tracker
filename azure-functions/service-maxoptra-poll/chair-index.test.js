'use strict';

// Run: node --test service-maxoptra-poll/chair-index.test.js
// (Node 18+ built-in test runner — no devDependencies on this project.)

const test = require('node:test');
const assert = require('node:assert');
const { parseRepList, parseChairId, returnChairsInCell, buildTicketIndex } = require('./chair-index');

test('parseRepList splits, trims, uppercases, de-dupes', () => {
  assert.deepStrictEqual(
    parseRepList('REP100-R1, rep100-r1 , REP200-R2'),
    ['REP100-R1', 'REP200-R2'],
  );
  assert.deepStrictEqual(parseRepList('REP2891'), ['REP2891']);
  assert.deepStrictEqual(parseRepList(''), []);
  assert.deepStrictEqual(parseRepList(null), []);
  assert.deepStrictEqual(parseRepList(undefined), []);
});

test('parseChairId parses the -R suffix', () => {
  assert.deepStrictEqual(
    parseChairId('REP100-R2'),
    { rep: 'REP100', returnNo: 2, isReturn: true, label: 'REP100-R2' },
  );
  assert.strictEqual(parseChairId('REP100').isReturn, false);
  assert.strictEqual(parseChairId(''), null);
});

test('returnChairsInCell returns only -R chairs from a multi-REP cell', () => {
  assert.deepStrictEqual(
    returnChairsInCell('REP100-R1, REP200-R1').map((c) => c.label),
    ['REP100-R1', 'REP200-R1'],
  );
  // mixed: only the -R chairs are collection candidates
  assert.deepStrictEqual(
    returnChairsInCell('REP300, REP400-R1').map((c) => c.label),
    ['REP400-R1'],
  );
  // single legacy chair still works (regression)
  assert.deepStrictEqual(
    returnChairsInCell('REP2533081-R1').map((c) => c.label),
    ['REP2533081-R1'],
  );
  // no -R chair → empty (row skipped, as before)
  assert.deepStrictEqual(returnChairsInCell('REP500'), []);
});

test('buildTicketIndex: multi-chair row indexed under every chair, same row', () => {
  // header + one multi-chair return row. repNoIdx=0, openDate absent.
  const values = [
    ['REP Number'],
    ['REP100-R1, REP200-R1'],
  ];
  const { ticketsByLabel, ticketsByRep } = buildTicketIndex(values, {
    repNoIdx: 0, openDateIdx: -1, tableRowIndex: 0,
  });

  // both chair labels resolve...
  assert.ok(ticketsByLabel.has('REP100-R1'));
  assert.ok(ticketsByLabel.has('REP200-R1'));
  // ...to the SAME ticket row (rowIdx 0)
  assert.strictEqual(ticketsByLabel.get('REP100-R1').rowIdx, 0);
  assert.strictEqual(ticketsByLabel.get('REP200-R1').rowIdx, 0);
  // base-REP fallback index populated for each chair
  assert.strictEqual(ticketsByRep.get('REP100').length, 1);
  assert.strictEqual(ticketsByRep.get('REP200').length, 1);
});

test('buildTicketIndex: legacy single-REP return row still indexes (regression)', () => {
  const values = [
    ['REP Number'],
    ['REP2533081-R1'],
    ['REP900'],          // no -R → skipped
  ];
  const { ticketsByLabel } = buildTicketIndex(values, { repNoIdx: 0 });
  assert.strictEqual(ticketsByLabel.size, 1);
  assert.ok(ticketsByLabel.has('REP2533081-R1'));
});

test('buildTicketIndex: sheetRow honours the table offset', () => {
  // table header at sheet row 7 (tableRowIndex 6) → first data row is sheet row 8.
  const values = [
    ['REP Number'],
    ['REP100-R1'],
  ];
  const { ticketsByLabel } = buildTicketIndex(values, { repNoIdx: 0, tableRowIndex: 6 });
  assert.strictEqual(ticketsByLabel.get('REP100-R1').sheetRow, 8);
});
