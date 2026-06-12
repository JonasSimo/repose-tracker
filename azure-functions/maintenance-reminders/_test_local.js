'use strict';
// Local TEST run: env from local.settings.json, TEST_MODE on (all mail → Jonas,
// no audit-log writes). Re-runnable.
const settings = require('../local.settings.json').Values;
for (const [k, v] of Object.entries(settings)) {
  if (typeof v === 'string' && process.env[k] === undefined) process.env[k] = v;
}
process.env.MT_REMINDERS_TEST_MODE = 'true';

const fn = require('./index');
const logFn = (...a) => console.log(...a);
logFn.warn = (...a) => console.warn('WARN', ...a);
logFn.error = (...a) => console.error('ERROR', ...a);

fn({ log: logFn }).then(() => console.log('--- run complete ---'))
  .catch(e => { console.error('FATAL', e); process.exit(1); });
