import { test } from 'node:test'
import assert from 'node:assert/strict'
import pkg from './emailBody.js'
const { buildAlertEmail } = pkg

test('subject names the station and flag count', () => {
  const { subject } = buildAlertEmail({
    station: 12, operator_name: 'Dave Mason', submitted_at: '2026-06-23T09:14:00Z', flag_count: 2,
    results: [{ id: 'needle', label: 'Needle checked', result: 'attention', note: 'bent' }],
  })
  assert.match(subject, /Sewing machine/i)
  assert.match(subject, /Station 12/)
  assert.match(subject, /2 items/i)
})

test('html lists only flagged items with their note', () => {
  const { html } = buildAlertEmail({
    station: 5, operator_name: 'Dave Mason', submitted_at: '2026-06-23T09:14:00Z', flag_count: 1,
    results: [
      { id: 'cleaned', label: 'Cleaned', result: 'done', note: '' },
      { id: 'oiled', label: 'Oiled — reservoir', result: 'attention', note: 'reservoir empty' },
    ],
  })
  assert.match(html, /Station 5/)
  assert.match(html, /Oiled/)
  assert.match(html, /reservoir empty/)
  assert.doesNotMatch(html, />Cleaned</) // no flag on that item → not listed
})

test('singular subject for a single flag', () => {
  const { subject } = buildAlertEmail({
    station: 1, operator_name: 'Jo', submitted_at: '2026-06-23T09:14:00Z', flag_count: 1, results: [],
  })
  assert.match(subject, /1 item need/i)
})
