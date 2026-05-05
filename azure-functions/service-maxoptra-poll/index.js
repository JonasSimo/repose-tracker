'use strict';

// ─────────────────────────────────────────────────────────────────────────
// service-maxoptra-poll
//
// 30-min timer (cron `0 */30 * * * *`). Polls Maxoptra for active collection
// jobs whose Reference field contains a RepNet REP Number, and writes the
// derived status back to TICKET LOG (Maxoptra Job ID, Maxoptra Status,
// Maxoptra Updated). When Maxoptra reports a job complete, also fills the
// existing Returned to Factory date column.
//
// Required app settings:
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET   — Microsoft Graph app-only (existing)
//   TICKETS_SHARING_URL                    — TICKET LOG SharePoint sharing URL (existing)
//   MAXOPTRA_API_KEY                       — Maxoptra production API key
//   MAXOPTRA_BASE_URL                      — e.g. https://api.maxoptra.com
//   MAXOPTRA_ENV                           — 'sandbox' | 'production'
//   MAXOPTRA_ACCOUNT_ID                    — (if Maxoptra requires a tenant param)
//
// SAFETY: in sandbox, all PATCH calls are dry-run logged but not executed.
// ─────────────────────────────────────────────────────────────────────────

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const MAXOPTRA_API_KEY    = process.env.MAXOPTRA_API_KEY;
const MAXOPTRA_BASE_URL   = (process.env.MAXOPTRA_BASE_URL || 'https://api.maxoptra.com').replace(/\/$/, '');
const MAXOPTRA_ACCOUNT_ID = process.env.MAXOPTRA_ACCOUNT_ID || '';
const MAXOPTRA_ENV        = (process.env.MAXOPTRA_ENV || 'sandbox').toLowerCase();
const IS_PROD             = MAXOPTRA_ENV === 'production';

const TICKETS_SHARING_URL = process.env.TICKETS_SHARING_URL || '';
const TICKET_TABLE = 'TicketLog';

// ─── Maxoptra API ────────────────────────────────────────────────────────
async function getMaxoptraJobs(log) {
  // Filter to active pickup/collection jobs only — exclude terminal states.
  // ADJUST the URL + status filter based on Step 2.1 discovery output.
  const url = `${MAXOPTRA_BASE_URL}/orders?type=Pickup&status=Planned,InProgress,Scheduled,PickedUp`;
  const headers = {
    'Authorization': `Bearer ${MAXOPTRA_API_KEY}`,
    'Accept': 'application/json'
  };
  if (MAXOPTRA_ACCOUNT_ID) headers['X-Account-Id'] = MAXOPTRA_ACCOUNT_ID;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Maxoptra GET ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  // ADJUST 'data.orders' below if the response uses a different envelope key.
  const jobs = Array.isArray(data) ? data : (data.orders || data.items || data.data || []);
  if (!Array.isArray(jobs) || jobs.length === 0) {
    // Surface a hint so the user can compare against the real API shape after Step 2.1 discovery.
    log.warn(`[maxoptra] response had 0 jobs or unexpected shape · top-level keys: ${Object.keys(data || {}).join(', ') || '(none)'}`);
  }
  log(`[maxoptra] retrieved ${Array.isArray(jobs) ? jobs.length : 0} active collection job(s)`);
  return Array.isArray(jobs) ? jobs : [];
}

module.exports = async function (context, myTimer) {
  const log = context.log;
  const started = new Date();
  log(`[service-maxoptra-poll] start ${started.toISOString()} · env=${MAXOPTRA_ENV}`);

  if (!MAXOPTRA_API_KEY) {
    log.warn('MAXOPTRA_API_KEY missing — skipping.');
    return;
  }

  // Phase 1 of plan: just retrieve and log Maxoptra jobs to verify auth.
  let jobs;
  try {
    jobs = await getMaxoptraJobs(log);
  } catch (e) {
    log.error('Maxoptra fetch failed:', e.message);
    return;
  }
  log(`[service-maxoptra-poll] sample jobs: ${JSON.stringify(jobs.slice(0, 2), null, 2)}`);
  log(`[service-maxoptra-poll] complete (Task 2 only) · ${((Date.now() - started.getTime()) / 1000).toFixed(1)}s`);
};
