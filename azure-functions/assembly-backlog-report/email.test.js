'use strict';
// Run: node --test assembly-backlog-report/email.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildSummaryHtml } = require('./email');

const BASE = { dateStr: 'Wednesday 17 June 2026', repnetUrl: 'https://ashy-river-0a41a9410.7.azurestaticapps.net/', logoDataUrl: '' };

test('buildSummaryHtml renders count, a row, and the stats link when rows exist', () => {
  const rows = [{ rep: 'REP 1000001', week: 'WK 25', wc: '15/06/2026', prepLbl: 'Mon', itemNo: '10', daysLate: 2, express: false }];
  const html = buildSummaryHtml({ ...BASE, rows });
  assert.match(html, /1 overdue Assembly chair/);
  assert.match(html, /REP 1000001/);
  assert.match(html, /stats\/team\/assembly/);
});

test('buildSummaryHtml renders the all-clear body when rows is empty', () => {
  const html = buildSummaryHtml({ ...BASE, rows: [] });
  assert.match(html, /No overdue Assembly chairs/i);
});

test('buildSummaryHtml escapes HTML in cell values', () => {
  const rows = [{ rep: 'REP <b>x</b>', week: 'WK 25', wc: '15/06/2026', prepLbl: 'Mon', itemNo: '10', daysLate: 0, express: false }];
  const html = buildSummaryHtml({ ...BASE, rows });
  assert.match(html, /REP &lt;b&gt;x&lt;\/b&gt;/);
});
