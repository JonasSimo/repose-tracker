'use strict';

// ─────────────────────────────────────────────────────────────────────────
// pod-auto-send (Phase 2 — LIVE routing)
//
// Timer every 15 min. For each POD template in
// SAFETYCULTURE_POD_TEMPLATE_IDS (comma-sep):
//   1. Read watermark from pod_send_sync_state
//   2. Cursor-page /audits/search since watermark
//   3. If any new audits, lazily build a Map<repDigits, clientName> from the
//      Repose production plan workbook on SharePoint (one fetch per tick).
//   4. For each new audit:
//        a. fetch full audit, check eligibility (complete inspection)
//        b. extract ALL REP serials (a single POD can cover multiple chairs)
//        c. look up each REP in the plan map → client name (col D) + trade
//           account (col R). Col D holds the END USER on dropship orders, so
//           both columns feed the matcher.
//        d. resolveTradeCustomer(clients) → CHARTERHOUSE | GROSVENOR | null
//             - LIVE  : if null, skip — manual workflow continues for non-trade
//                       customers (residential / OSKA / BRISTOL MAID / etc).
//             - TRIAL : always send to POD_TRIAL_RECIPIENT; body annotates
//                       what LIVE would have done.
//        e. claim audit_id by inserting a 'claimed' placeholder in pod_send_log
//        f. fetch PDF from SC's async export endpoint, send via Graph
//        g. update pod_send_log row to 'sent' (or 'failed' + error)
//   5. Advance watermark
//
// Trade customers in scope for Phase 2 LIVE:
//   - Charterhouse Mobility (POD_CUSTOMER_CHARTERHOUSE_EMAIL)
//   - Grosvenor Mobility    (POD_CUSTOMER_GROSVENOR_EMAIL)
//
// Required env vars (always):
//   SAFETYCULTURE_API_TOKEN         — Bearer token
//   SAFETYCULTURE_POD_TEMPLATE_IDS  — comma-sep template IDs (Office / Home variants)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM   (Graph mail, shared mailbox)
//   POD_SEND_MODE                   — 'TRIAL' or 'LIVE'
// Required when POD_SEND_MODE=TRIAL:
//   POD_TRIAL_RECIPIENT             — Jonas's email
// Required when POD_SEND_MODE=LIVE:
//   POD_CUSTOMER_CHARTERHOUSE_EMAIL
//   POD_CUSTOMER_GROSVENOR_EMAIL
// Optional:
//   POD_DRY_RUN                     — '1' to log decisions but skip mail + log writes
// ─────────────────────────────────────────────────────────────────────────

const sc          = require('./sc');
const graph       = require('./graph');
const supa        = require('./supa');
const eligibility = require('./eligibility');
const prodPlan    = require('./prod-plan');
const routing     = require('./routing');

const EPOCH = '1970-01-01T00:00:00.000Z';

function requireEnv(names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

function parseTemplateIds() {
  return (process.env.SAFETYCULTURE_POD_TEMPLATE_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function readWatermark(templateId) {
  const row = await supa.supaSelectOne(
    'pod_send_sync_state',
    `template_id=eq.${encodeURIComponent(templateId)}`
  );
  return row?.last_modified_after || EPOCH;
}

async function writeWatermark(templateId, watermark, summary) {
  await supa.supaUpsert('pod_send_sync_state', [{
    template_id: templateId,
    last_modified_after: watermark,
    last_run_at: new Date().toISOString(),
    last_run_attempted: summary.attempted || 0,
    last_run_sent: summary.sent || 0,
    last_run_failed: summary.failed || 0,
    last_run_error: summary.error || null,
  }], 'template_id');
}

// Insert a placeholder row to atomically claim this audit_id. Returns true if
// we claimed it (caller proceeds), false if another run already has the row.
async function claimAuditForSend({ auditId, templateId, repNumber, completedAt, sendTo, sendMode }) {
  const claimed = await supa.supaInsertIgnoreConflict('pod_send_log', {
    audit_id: auditId,
    template_id: templateId,
    rep_number: repNumber,
    inspection_completed_at: completedAt,
    sent_to: sendTo,
    send_mode: sendMode,
    status: 'claimed',
    // sent_at gets a default of now() — we'll PATCH it on success
  });
  return claimed != null;
}

async function markSent({ auditId, graphMessageId }) {
  await supa.supaUpdate(
    'pod_send_log',
    `audit_id=eq.${encodeURIComponent(auditId)}`,
    { status: 'sent', graph_message_id: graphMessageId, sent_at: new Date().toISOString() }
  );
}

async function markFailed({ auditId, errorMessage }) {
  await supa.supaUpdate(
    'pod_send_log',
    `audit_id=eq.${encodeURIComponent(auditId)}`,
    { status: 'failed', error_message: errorMessage }
  );
}

function buildSubject({ reps, orderNo, trade }) {
  const repPart = reps && reps.length ? reps.join(' + ') : '';
  const tail = [orderNo, repPart].filter(Boolean).join(' · ');
  const customerPart = trade ? ` [${trade.label}]` : '';
  return `Repose POD${customerPart} — ${tail || 'Delivery confirmation'}`;
}

function buildBody({ reps, orderNo, trade, clients, sendMode, recipient }) {
  const lines = [
    'Hello,',
    '',
    'Please find your delivery confirmation (Proof of Delivery) attached.',
    '',
    reps && reps.length ? `REP serial(s): ${reps.join(', ')}` : null,
    orderNo ? `Order number: ${orderNo}` : null,
    '',
    'Kind regards,',
    'Repose Furniture',
  ].filter(l => l !== null);

  if (sendMode === 'TRIAL') {
    lines.push('', '---');
    lines.push(`[TRIAL — sent to ${recipient} (POD_TRIAL_RECIPIENT)]`);
    if (trade) {
      lines.push(`[LIVE would have sent to: ${trade.label} <${trade.email || '(env not set)'}>]`);
    } else {
      lines.push(`[LIVE would have SKIPPED — not a trade customer. Plan clients: ${clients.join(' / ') || 'none'}]`);
    }
  }
  return lines.join('\n');
}

async function processAudit({ auditId, templateId, planMap, context, forceSend = false }) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);
  const SEND_MODE = process.env.POD_SEND_MODE || 'TRIAL';
  const DRY_RUN   = process.env.POD_DRY_RUN === '1';

  const audit = await sc.getAudit(auditId);
  const elig = eligibility.isAuditEligible(audit);
  if (!elig.eligible && !forceSend) {
    log(`skip ${auditId}: ${elig.reason}`);
    return { sent: false, skipped: true };
  }
  if (!elig.eligible && forceSend) {
    warn(`audit ${auditId} not eligible (${elig.reason}); processing anyway (forceSend=true)`);
  }

  const reps = eligibility.extractAllRepSerials(audit);
  const repDigits = reps.map(r => r.replace(/\D/g, ''));
  // Each plan entry carries column D (client — the end user on dropship
  // orders) AND column R (trade-account attribution). Match on both, else
  // white-glove dropship PODs (end-user name in col D) never route.
  const planEntries = repDigits.map(d => planMap.get(d)).filter(Boolean);
  const clients = planEntries.flatMap(e => [e.client, e.account].filter(Boolean));
  const trade = routing.resolveTradeCustomer(clients);

  if (SEND_MODE === 'LIVE' && !trade) {
    log(`skip ${auditId}: not a trade customer (reps=${reps.join(',')}; clients=${clients.join(' / ') || 'none'})`);
    return { sent: false, skipped: true, reason: 'not a trade customer' };
  }

  const recipient = (SEND_MODE === 'LIVE') ? trade.email : process.env.POD_TRIAL_RECIPIENT;
  const completedAt = audit.audit_data?.date_completed || null;
  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number', 'Customer order']);
  const orderNo = orderItem?.responses?.text || null;

  if (DRY_RUN) {
    log(`DRY_RUN ${auditId}: reps=${reps.join(',')} clients=[${clients.join('/')}] trade=${trade?.customer || '-'} → would send to ${recipient}`);
    return { sent: false, dryRun: true };
  }

  // Atomically claim the audit before doing expensive work.
  const claimed = await claimAuditForSend({
    auditId,
    templateId,
    repNumber: reps[0] || null,   // primary REP for the log row (we still only have one column)
    completedAt,
    sendTo: recipient,
    sendMode: SEND_MODE,
  });
  if (!claimed) {
    log(`already processed ${auditId} — skipping`);
    return { sent: false, alreadyDone: true };
  }

  try {
    const pdfBuffer = await sc.fetchPodPdf(auditId, log);
    const filename = `Repose-POD-${(reps[0] || auditId).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    await graph.sendMailWithPdf({
      to: recipient,
      subject: buildSubject({ reps, orderNo, trade }),
      bodyText: buildBody({ reps, orderNo, trade, clients, sendMode: SEND_MODE, recipient }),
      pdfBuffer,
      pdfFilename: filename,
    });
    await markSent({ auditId, graphMessageId: null });
    log(`sent ${auditId} reps=${reps.join(',')} trade=${trade?.customer || '-'} → ${recipient}`);
    return { sent: true };
  } catch (e) {
    warn(`failed ${auditId}: ${e.message}`);
    await markFailed({ auditId, errorMessage: e.message.slice(0, 500) });
    return { sent: false, failed: true };
  }
}

module.exports = async function (context, myTimer) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);

  const mode = process.env.POD_SEND_MODE || 'TRIAL';
  if (!['TRIAL','LIVE'].includes(mode)) {
    context.log.error(`[pod-auto-send] Invalid POD_SEND_MODE=${mode}. Must be TRIAL or LIVE.`);
    return;
  }

  const baseEnv = [
    'SAFETYCULTURE_API_TOKEN',
    'SAFETYCULTURE_POD_TEMPLATE_IDS',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM',
  ];
  const modeEnv = (mode === 'LIVE')
    ? ['POD_CUSTOMER_CHARTERHOUSE_EMAIL', 'POD_CUSTOMER_GROSVENOR_EMAIL']
    : ['POD_TRIAL_RECIPIENT'];

  try {
    requireEnv([...baseEnv, ...modeEnv]);
  } catch (e) {
    context.log.error(`[pod-auto-send] ${e.message}`);
    return;
  }

  const templateIds = parseTemplateIds();
  log(`start · templates=${templateIds.length} · mode=${mode}`);

  // Lazy production plan loader — only paid for on ticks that found new audits.
  let planMap = null;
  async function getPlanMap() {
    if (!planMap) planMap = await prodPlan.loadRepClientMap(context.log);
    return planMap;
  }

  for (const templateId of templateIds) {
    let summary = { attempted: 0, sent: 0, failed: 0, error: null };
    let newWatermark;
    try {
      const watermark = await readWatermark(templateId);
      log(`template ${templateId} watermark=${watermark}`);
      const { auditIds, newestModifiedAt } = await sc.searchAuditsByTemplate(templateId, watermark, context.log);
      newWatermark = newestModifiedAt;
      log(`template ${templateId} found ${auditIds.length} new audit(s)`);
      if (auditIds.length > 0) {
        // Build plan map once per tick, only if there's work. If this throws
        // (Graph 401 etc), the outer try/catch advances no watermark.
        await getPlanMap();
      }
      for (const auditId of auditIds) {
        try {
          const r = await processAudit({ auditId, templateId, planMap, context });
          if (r.sent) summary.sent++;
          if (r.failed) summary.failed++;
          if (!r.skipped && !r.alreadyDone && !r.dryRun) summary.attempted++;
        } catch (e) {
          warn(`audit ${auditId} unhandled error: ${e.message}`);
          summary.failed++;
          // Best-effort: record the failure so the audit isn't silently lost when the
          // watermark advances past it. If THIS insert also fails (e.g. Supabase down)
          // we swallow — at least the warn() line is in the function log.
          try {
            await supa.supaInsertIgnoreConflict('pod_send_log', {
              audit_id: auditId,
              template_id: templateId,
              sent_to: process.env.POD_TRIAL_RECIPIENT || 'unknown',
              send_mode: process.env.POD_SEND_MODE || 'TRIAL',
              status: 'failed',
              error_message: `pre-claim error: ${e.message.slice(0, 400)}`,
            });
          } catch (logErr) {
            warn(`audit ${auditId} also failed to log pre-claim failure: ${logErr.message}`);
          }
        }
      }
    } catch (e) {
      warn(`template ${templateId} run aborted: ${e.message}`);
      summary.error = e.message.slice(0, 500);
    } finally {
      if (newWatermark) await writeWatermark(templateId, newWatermark, summary);
      log(`template ${templateId} summary sent=${summary.sent} failed=${summary.failed}`);
    }
  }
};

// Exported for the send-one.js CLI test script. The Function App runtime
// only consumes module.exports as a function; extra properties are inert.
module.exports.processAudit = processAudit;
