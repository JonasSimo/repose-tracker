'use strict';
// Run: node --test assembly-backlog-report/qc.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseQcRows } = require('./qc');

test('parseQcRows extracts 7-digit REPs from column A, ignoring jammed prefixes', () => {
  const rows = [
    ['REP 1234567', '2026-06-16 09:00', 'Sarah J', 'New Chair'],
    ['7654321', '2026-06-16 10:00', 'Tom', 'Service'],
    ['REP25211071', 'x', 'y', 'z'],   // 8 digits jammed → no 7-digit match
    ['header', '', '', ''],
  ];
  const set = parseQcRows(rows);
  assert.ok(set.has('1234567'));
  assert.ok(set.has('7654321'));
  assert.strictEqual(set.size, 2);
});
