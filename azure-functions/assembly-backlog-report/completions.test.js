'use strict';
// Run: node --test assembly-backlog-report/completions.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildAssemblyDoneSet } = require('./completions');

test('buildAssemblyDoneSet keys completed Assembly rows as Assembly|all|wk|prep|rep', () => {
  const rows = [
    { week: 'WK 25', prep: '1', rep: 'REP 1000002', sub_team: null, is_complete: true },
    { week: 'WK 25', prep: 'express', rep: 'REP 1000009', sub_team: null, is_complete: true },
    { week: 'WK 25', prep: '2', rep: 'REP 1000003', sub_team: null, is_complete: false }, // not complete → skipped
    { week: '', prep: '1', rep: 'REP 1', sub_team: null, is_complete: true },             // no week → skipped
  ];
  const set = buildAssemblyDoneSet(rows);
  assert.ok(set.has('Assembly|all|WK 25|1|REP 1000002'));
  assert.ok(set.has('Assembly|all|WK 25|express|REP 1000009'));
  assert.strictEqual(set.size, 2);
});
