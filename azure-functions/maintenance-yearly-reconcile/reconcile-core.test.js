'use strict';

// Run: node --test maintenance-yearly-reconcile/reconcile-core.test.js
// (Node 18+ built-in test runner — no devDependencies on this project.)

const test = require('node:test');
const assert = require('node:assert');
const { computeReconciliation, normDate } = require('./reconcile-core');

test('normDate slices datetimes, passes dates, rejects junk', () => {
  assert.strictEqual(normDate('2025-09-22T07:00:00Z'), '2025-09-22');
  assert.strictEqual(normDate('2025-09-22'), '2025-09-22');
  assert.strictEqual(normDate(''), null);
  assert.strictEqual(normDate(null), null);
  assert.strictEqual(normDate(undefined), null);
  assert.strictEqual(normDate('not-a-date'), null);
});

test('in-sync items produce no changes', () => {
  const sp = [{ sp_item_id: '25', title: 'Bandsaw', last_done: '2025-09-16T07:00:00Z', scheduled_for: '2026-09-01T07:00:00Z' }];
  const sb = [{ sp_item_id: '25', title: 'Bandsaw', last_done: '2025-09-16', scheduled_for: '2026-09-01' }];
  const r = computeReconciliation(sp, sb);
  assert.deepStrictEqual(r, { updates: [], inserts: [], conflicts: [] });
});

test('SharePoint has a date, Supabase is null → fill it (the silent-mirror bug)', () => {
  const sp = [{ sp_item_id: '22', title: 'Panel Saw 2', last_done: '2025-09-22T07:00:00Z', scheduled_for: '2026-09-01T07:00:00Z' }];
  const sb = [{ sp_item_id: '22', title: 'Panel Saw 2', last_done: null, scheduled_for: '2026-09-01' }];
  const r = computeReconciliation(sp, sb);
  assert.strictEqual(r.inserts.length, 0);
  assert.strictEqual(r.conflicts.length, 0);
  assert.deepStrictEqual(r.updates, [
    { sp_item_id: '22', title: 'Panel Saw 2', changes: { last_done: { from: null, to: '2025-09-22' } } },
  ]);
});

test('both non-null but differ → SharePoint wins (PAT Testing case)', () => {
  const sp = [{ sp_item_id: '10', title: 'PAT Testing', last_done: '2026-02-17T07:00:00Z', scheduled_for: null }];
  const sb = [{ sp_item_id: '10', title: 'PAT Testing', last_done: '2026-05-07', scheduled_for: null }];
  const r = computeReconciliation(sp, sb);
  assert.deepStrictEqual(r.updates, [
    { sp_item_id: '10', title: 'PAT Testing', changes: { last_done: { from: '2026-05-07', to: '2026-02-17' } } },
  ]);
});

test('SharePoint null but Supabase non-null → conflict, never overwrite (no data loss)', () => {
  const sp = [{ sp_item_id: '30', title: 'Widget', last_done: null, scheduled_for: null }];
  const sb = [{ sp_item_id: '30', title: 'Widget', last_done: '2026-01-01', scheduled_for: null }];
  const r = computeReconciliation(sp, sb);
  assert.strictEqual(r.updates.length, 0);
  assert.deepStrictEqual(r.conflicts, [
    { sp_item_id: '30', title: 'Widget', field: 'last_done', sp: null, supabase: '2026-01-01' },
  ]);
});

test('SharePoint item missing from Supabase → insert (create-side mirror drop)', () => {
  const sp = [{ sp_item_id: '99', title: 'New Item', category: 'Statutory', frequency: 'Annual', last_done: '2026-03-01', scheduled_for: null }];
  const sb = [];
  const r = computeReconciliation(sp, sb);
  assert.strictEqual(r.updates.length, 0);
  assert.strictEqual(r.inserts.length, 1);
  assert.strictEqual(r.inserts[0].sp_item_id, '99');
  assert.strictEqual(r.inserts[0].last_done, '2026-03-01');
});

test('extra Supabase rows not present in SharePoint are left untouched', () => {
  const sp = [{ sp_item_id: '1', title: 'A', last_done: '2026-01-01', scheduled_for: null }];
  const sb = [
    { sp_item_id: '1', title: 'A', last_done: '2026-01-01', scheduled_for: null },
    { sp_item_id: '2', title: 'Orphan', last_done: '2026-02-02', scheduled_for: null },
  ];
  const r = computeReconciliation(sp, sb);
  assert.deepStrictEqual(r, { updates: [], inserts: [], conflicts: [] });
});

test('scheduled_for drift is reconciled the same way as last_done', () => {
  const sp = [{ sp_item_id: '5', title: 'X', last_done: '2026-01-01', scheduled_for: '2026-12-01T07:00:00Z' }];
  const sb = [{ sp_item_id: '5', title: 'X', last_done: '2026-01-01', scheduled_for: null }];
  const r = computeReconciliation(sp, sb);
  assert.deepStrictEqual(r.updates, [
    { sp_item_id: '5', title: 'X', changes: { scheduled_for: { from: null, to: '2026-12-01' } } },
  ]);
});

test('items with no sp_item_id are skipped on both sides', () => {
  const sp = [{ sp_item_id: null, title: 'ghost', last_done: '2026-01-01' }];
  const r = computeReconciliation(sp, []);
  assert.deepStrictEqual(r, { updates: [], inserts: [], conflicts: [] });
});
