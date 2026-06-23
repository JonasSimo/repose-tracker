import { test } from 'node:test'
import assert from 'node:assert/strict'
import pkg from './emailBody.js'
const { buildAlertEmail } = pkg

test('subject names the flag count', () => {
  const { subject } = buildAlertEmail({
    operator_name: 'Dave Mason', submitted_at: '2026-06-23T09:14:00Z', flag_count: 2,
    results: [{ machine: 'Bandsaw', checks: [{ label: 'Hoses secure', result: 'attention', note: 'split' }] }],
  })
  assert.match(subject, /Woodmill extraction/i)
  assert.match(subject, /2 items/i)
})

test('html lists only flagged items with their machine and note', () => {
  const { html } = buildAlertEmail({
    operator_name: 'Dave Mason', submitted_at: '2026-06-23T09:14:00Z', flag_count: 1,
    results: [
      { machine: 'AXYZ CNC', checks: [{ label: 'Hoods clear', result: 'clean', note: '' }] },
      { machine: 'Bandsaw', checks: [
        { label: 'Hoods clear', result: 'clean', note: '' },
        { label: 'Hoses secure', result: 'attention', note: 'hose split near junction' },
      ] },
    ],
  })
  assert.match(html, /Bandsaw/)
  assert.match(html, /Hoses secure/)
  assert.match(html, /hose split near junction/)
  assert.doesNotMatch(html, /AXYZ CNC/) // no flags on that machine
})

test('singular subject for a single flag', () => {
  const { subject } = buildAlertEmail({
    operator_name: 'Jo', submitted_at: '2026-06-23T09:14:00Z', flag_count: 1, results: [],
  })
  assert.match(subject, /1 item need/i)
})
