'use strict';

// Run: node --test service-maxoptra-poll/status-map.test.js

const test = require('node:test');
const assert = require('node:assert');
const { mapMaxoptraStatus } = require('./status-map');

const SCHED = '2026-04-24T09:00:00Z';

test('known statuses map as before', () => {
  assert.match(mapMaxoptraStatus('cancelled', null, null), /^❌ Collection cancelled/);
  assert.match(mapMaxoptraStatus('completed', null, SCHED), /^✅ In factory/);
  assert.strictEqual(mapMaxoptraStatus('inprogress', null, null), '🚚 On way to customer');
  assert.strictEqual(mapMaxoptraStatus('pickedup', null, null), '🚚 Collected · returning to factory');
  assert.match(mapMaxoptraStatus('scheduled', SCHED, null), /^📅 Scheduled · /);
  assert.strictEqual(mapMaxoptraStatus('unallocated', null, null), '🗓️ Awaiting collection planning');
});

test('"accepted" with a planned collection time shows Scheduled · date', () => {
  assert.match(mapMaxoptraStatus('accepted', SCHED, null), /^📅 Scheduled · /);
});

test('"accepted" with no planned time shows Awaiting collection planning', () => {
  assert.strictEqual(mapMaxoptraStatus('accepted', null, null), '🗓️ Awaiting collection planning');
});

test('any other unmapped status is inferred from the planned time, never shown raw', () => {
  assert.match(mapMaxoptraStatus('some_future_status', SCHED, null), /^📅 Scheduled · /);
  assert.strictEqual(mapMaxoptraStatus('some_future_status', null, null), '🗓️ Awaiting collection planning');
  // never the cryptic raw-word pill
  assert.doesNotMatch(mapMaxoptraStatus('accepted', null, null), /❓/);
});
