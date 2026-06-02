'use strict';

// Usage:
//   cd bin/azure-functions
//   Set env vars (same as the Function App needs):
//     SAFETYCULTURE_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//     TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, POD_TRIAL_RECIPIENT
//   Then:
//     node pod-auto-send/send-one.js <audit_id>
//
// Runs the FULL send pipeline for ONE audit_id you choose:
//   - fetches the audit from SC
//   - checks eligibility (complete + both signatures); aborts with reason if not
//   - claims the audit in pod_send_log (skips with "already sent" if a row exists)
//   - fetches the PDF via SC's async export
//   - emails the PDF to POD_TRIAL_RECIPIENT via Graph (real send)
//   - updates the pod_send_log row to 'sent' (or 'failed' + error)
//
// Same idempotency as the timer: if you re-run with the same audit_id, the
// PK conflict on pod_send_log.audit_id will block a re-send unless you
// manually DELETE the row from Supabase first.

// Auto-load Azure Functions local.settings.json if present. Values from there
// populate process.env (only for keys not already set). Standard pattern —
// `func start` does the same thing, we just do it manually for `node` runs.
//
// MUST run BEFORE requiring sc/graph/supa — those modules snapshot
// process.env at module load time, so any require() before this happens
// captures empty env values.
function loadLocalSettings() {
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.resolve(__dirname, '..', 'local.settings.json'),       // azure-functions/local.settings.json
    path.resolve(__dirname, 'local.settings.json'),              // pod-auto-send/local.settings.json
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const values = raw.Values || raw;
      let loaded = 0;
      for (const [k, v] of Object.entries(values)) {
        if (typeof v !== 'string') continue;
        if (process.env[k] === undefined || process.env[k] === '') {
          process.env[k] = v;
          loaded++;
        }
      }
      console.log(`Loaded ${loaded} env var(s) from ${file}`);
      return;
    } catch (e) {
      console.warn(`Could not parse ${file}: ${e.message}`);
    }
  }
}
loadLocalSettings();

const sc = require('./sc');
const { processAudit } = require('./index');

const REQUIRED = [
  'SAFETYCULTURE_API_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TENANT_ID',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'SEND_FROM',
  'POD_TRIAL_RECIPIENT',
];

(async () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const auditId = args.find(a => !a.startsWith('--'));
  if (!auditId) {
    console.error('Usage: node send-one.js <audit_id> [--force]');
    console.error('  --force: bypass ALL eligibility checks (archived, not complete, etc.) — testing only');
    process.exit(1);
  }
  const missing = REQUIRED.filter(n => !process.env[n]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (process.env.POD_SEND_MODE && process.env.POD_SEND_MODE !== 'TRIAL') {
    console.error(`Refusing to run with POD_SEND_MODE=${process.env.POD_SEND_MODE}. Only TRIAL supported.`);
    process.exit(1);
  }

  // Build a thin Azure-Functions-like context so processAudit can call
  // context.log() and context.log.warn().
  const consoleLog = (...args) => console.log(...args);
  consoleLog.warn = (...args) => console.warn(...args);
  consoleLog.error = (...args) => console.error(...args);
  const context = { log: consoleLog };

  // Look up the audit's template_id (we need it for the pod_send_log row).
  console.log(`Fetching audit ${auditId} to discover template_id...`);
  const audit = await sc.getAudit(auditId);
  const templateId = audit.template_id || audit.audit_data?.template_id;
  if (!templateId) {
    console.error('Could not determine template_id from audit payload');
    process.exit(1);
  }
  console.log(`template_id=${templateId}`);

  console.log(`Running processAudit for ${auditId}...${force ? ' (--force: bypassing all eligibility checks)' : ''}`);
  const result = await processAudit({ auditId, templateId, context, forceSend: force });
  console.log('Result:', result);

  if (result.sent) {
    console.log(`Sent. Check ${process.env.POD_TRIAL_RECIPIENT} inbox.`);
    process.exit(0);
  }
  if (result.failed) {
    console.error('Failed. See pod_send_log.error_message in Supabase for details.');
    process.exit(2);
  }
  if (result.skipped) {
    console.error('Skipped — audit was not eligible (see "skip" line above for reason).');
    process.exit(3);
  }
  if (result.alreadyDone) {
    console.error('Already processed. Delete the pod_send_log row in Supabase to re-test.');
    process.exit(4);
  }
  if (result.dryRun) {
    console.error('Dry-run mode active (unset POD_DRY_RUN to send for real).');
    process.exit(5);
  }
  console.error('Unknown result shape:', result);
  process.exit(6);
})().catch(e => {
  console.error('send-one failed:', e.message);
  process.exit(99);
});
