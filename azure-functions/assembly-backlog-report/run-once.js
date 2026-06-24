'use strict';

// Local one-off runner. Loads local.settings.json Values into process.env,
// then runs the backlog report once. Usage:
//   BACKLOG_REPORT_DRY_RUN=1 node assembly-backlog-report/run-once.js   # compute only
//   node assembly-backlog-report/run-once.js                            # real send
const fs = require('fs');
const path = require('path');

try {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));
  for (const [k, v] of Object.entries(settings.Values || {})) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
} catch (e) {
  console.warn('Could not load local.settings.json — relying on ambient env:', e.message);
}

const { runBacklogReport } = require('./index.js');
runBacklogReport(console.log)
  .then((r) => { console.log('DONE', r); process.exit(0); })
  .catch((e) => { console.error('FAILED', e); process.exit(1); });
