'use strict';

// ─────────────────────────────────────────────────────────────────────────
// pod-auto-send (Phase 1 — trial mode)
//
// Timer every 15 min. For each POD template in
// SAFETYCULTURE_POD_TEMPLATE_IDS (comma-sep):
//   1. Read watermark from pod_send_sync_state
//   2. Cursor-page /audits/search since watermark
//   3. For each new audit:
//        a. fetch full audit, check eligibility (complete + both signatures)
//        b. claim audit_id by inserting a 'claimed' placeholder in pod_send_log
//           (PK conflict = already handled; safe across parallel runs)
//        c. fetch PDF from SC's async export endpoint
//        d. send via Graph to POD_TRIAL_RECIPIENT (Phase 2 will resolve to customer)
//        e. update pod_send_log row to 'sent' (or 'failed' + error)
//   4. Advance watermark
//
// Required env vars:
//   SAFETYCULTURE_API_TOKEN         — Bearer token
//   SAFETYCULTURE_POD_TEMPLATE_IDS  — comma-sep template IDs (Office / Home variants)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM   (Graph mail, shared mailbox)
//   POD_SEND_MODE                   — TRIAL (only value supported in Phase 1)
//   POD_TRIAL_RECIPIENT             — Jonas's email
// Optional:
//   POD_DRY_RUN                     — '1' to log decisions but skip mail + log writes
// ─────────────────────────────────────────────────────────────────────────

const sc          = require('./sc');
const graph       = require('./graph');
const supa        = require('./supa');
const eligibility = require('./eligibility');

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

function buildSubject({ repNumber, orderNo }) {
  const tail = [orderNo, repNumber].filter(Boolean).join(' · ');
  return `Repose POD — ${tail || 'Delivery confirmation'}`;
}

function buildBody({ repNumber, orderNo, trialNote }) {
  const lines = [
    'Hello,',
    '',
    'Please find your delivery confirmation (Proof of Delivery) attached.',
    '',
    repNumber ? `REP serial: ${repNumber}` : null,
    orderNo   ? `Order number: ${orderNo}`  : null,
    '',
    'Kind regards,',
    'Repose Furniture',
  ].filter(l => l !== null);
  if (trialNote) lines.push('', `---`, `[TRIAL — original customer would have been: ${trialNote}]`);
  return lines.join('\n');
}

async function processAudit({ auditId, templateId, context, forceSend = false }) {
  const log = (...a) => context.log('[pod-auto-send]', ...a);
  const warn = (...a) => context.log.warn('[pod-auto-send]', ...a);
  const SEND_MODE = process.env.POD_SEND_MODE || 'TRIAL';
  const TRIAL_TO  = process.env.POD_TRIAL_RECIPIENT;
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

  const repNumber = eligibility.extractRepSerial(audit);
  const completedAt = audit.audit_data?.date_completed || null;
  const orderItem = eligibility.findItemByLabel(audit, ['Customer order number', 'Order number', 'Customer order']);
  const orderNo = orderItem?.responses?.text || null;

  if (DRY_RUN) {
    log(`DRY_RUN ${auditId} would send: rep=${repNumber} order=${orderNo} to=${TRIAL_TO}`);
    return { sent: false, dryRun: true };
  }

  // Atomically claim the audit before doing expensive work.
  const claimed = await claimAuditForSend({
    auditId,
    templateId,
    repNumber,
    completedAt,
    sendTo: TRIAL_TO,
    sendMode: SEND_MODE,
  });
  if (!claimed) {
    log(`already processed ${auditId} — skipping`);
    return { sent: false, alreadyDone: true };
  }

  try {
    const pdfBuffer = await sc.fetchPodPdf(auditId, log);
    const filename = `Repose-POD-${(repNumber || auditId).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    await graph.sendMailWithPdf({
      to: TRIAL_TO,
      subject: buildSubject({ repNumber, orderNo }),
      bodyText: buildBody({ repNumber, orderNo, trialNote: '(real customer lookup not enabled yet)' }),
      pdfBuffer,
      pdfFilename: filename,
    });
    await markSent({ auditId, graphMessageId: null });
    log(`sent ${auditId} rep=${repNumber} order=${orderNo}`);
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

  try {
    requireEnv([
      'SAFETYCULTURE_API_TOKEN',
      'SAFETYCULTURE_POD_TEMPLATE_IDS',
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
      'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM',
      'POD_TRIAL_RECIPIENT',
    ]);
  } catch (e) {
    context.log.error(`[pod-auto-send] ${e.message}`);
    return;
  }

  const templateIds = parseTemplateIds();
  log(`start · templates=${templateIds.length} · mode=${process.env.POD_SEND_MODE || 'TRIAL'}`);

  for (const templateId of templateIds) {
    let summary = { attempted: 0, sent: 0, failed: 0, error: null };
    let newWatermark;
    try {
      const watermark = await readWatermark(templateId);
      log(`template ${templateId} watermark=${watermark}`);
      const { auditIds, newestModifiedAt } = await sc.searchAuditsByTemplate(templateId, watermark, context.log);
      newWatermark = newestModifiedAt;
      log(`template ${templateId} found ${auditIds.length} new audit(s)`);
      for (const auditId of auditIds) {
        try {
          const r = await processAudit({ auditId, templateId, context });
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
