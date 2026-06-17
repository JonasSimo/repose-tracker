'use strict';

// assembly-backlog-report — timer fn, 07:00 Mon-Fri. Recomputes the website's
// Assembly "Backlog" CSV (plan Excel + Supabase completions + QC sheet) and
// emails it to Richard Semmens from systemapp@ with the CSV attached.

const fs = require('fs');
const path = require('path');
const { loadProductionWeeks } = require('./plan-weeks');
const { loadAssemblyDoneSet } = require('./completions');
const { loadQcPassedReps } = require('./qc');
const { getAssemblyBacklogRows, backlogCsvWithBom, backlogFilename } = require('./assembly-backlog');
const { buildSummaryHtml } = require('./email');
const { sendMailWithAttachment } = require('./graph');

let LOGO_DATAURL = '';
try {
  LOGO_DATAURL = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png')).toString('base64');
} catch { /* falls back to text wordmark */ }

const DEFAULT_RECIPIENT = 'richard.semmens@reposefurniture.co.uk';
const DEFAULT_REPNET_URL = 'https://ashy-river-0a41a9410.7.azurestaticapps.net/';

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

async function runBacklogReport(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : console.log(...a));
  requireEnv(['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

  const recipient = process.env.BACKLOG_REPORT_RECIPIENT || DEFAULT_RECIPIENT;
  const repnetUrl = process.env.REPNET_URL || DEFAULT_REPNET_URL;
  const dryRun = process.env.BACKLOG_REPORT_DRY_RUN === '1';
  const now = new Date();

  info('[backlog] loading production plan…');
  const weeks = await loadProductionWeeks(info);
  const weekLabels = weeks.map((w) => w.wk);

  info('[backlog] loading completions + QC…');
  const [doneSet, qcSet] = await Promise.all([
    loadAssemblyDoneSet(weekLabels, info),
    loadQcPassedReps(info),
  ]);

  const rows = getAssemblyBacklogRows(weeks, doneSet, qcSet, now);
  info(`[backlog] ${rows.length} overdue Assembly chairs`);

  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const html = buildSummaryHtml({ rows, dateStr, repnetUrl, logoDataUrl: LOGO_DATAURL });
  const subject = rows.length
    ? `RepNet — Assembly Backlog — ${dateStr}`
    : `RepNet — Assembly Backlog — ${dateStr} — All clear`;
  const attachment = rows.length
    ? { name: backlogFilename(now), contentType: 'text/csv', contentBytes: Buffer.from(backlogCsvWithBom(rows), 'utf8').toString('base64') }
    : undefined;

  if (dryRun) {
    info(`[backlog] DRY_RUN — would send to ${recipient}: "${subject}" (${rows.length} rows, attachment=${!!attachment})`);
    return { rows: rows.length, sent: false };
  }

  await sendMailWithAttachment({ to: recipient, subject, html, attachment });
  info(`[backlog] sent to ${recipient} (${rows.length} rows)`);
  return { rows: rows.length, sent: true };
}

module.exports = async function (context) {
  try {
    await runBacklogReport((...a) => context.log(...a));
  } catch (e) {
    context.log.error('[backlog] failed:', e && e.message || e);
    throw e; // surface for Azure retry + alerting
  }
};
module.exports.runBacklogReport = runBacklogReport;
