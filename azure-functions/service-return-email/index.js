'use strict';

// service-return-email — timer (every 30 min).
//
// When the Service Engineer marks a service (S##) repair complete in RepNet,
// the chair is ready to go back to the customer. This function spots those new
// completions in Supabase `production_completions` and emails transport to plan
// the return delivery in Maxoptra — the auto half of the Service dashboard
// repair loop (Sub-project B).
//
// Dedup: a row is claimed in `service_return_email_log` (unique on
// rep+job_no+completed_date) BEFORE sending, so two timer runs — or a re-run —
// can never double-send. If that table is missing (migration 0092 not yet
// applied) the claim throws and we safely skip sending rather than spam.
//
// Reuses the proven supa.js (pod-auto-send) + graph.js (assembly-backlog-report)
// helpers — same SUPABASE_* / TENANT_ID / CLIENT_* / SEND_FROM env vars.

const supa = require('../pod-auto-send/supa');
const { sendMailWithAttachment } = require('../assembly-backlog-report/graph');

// Confirmed transport recipients — same pair the Mark-for-Return flow emails.
// Overridable via env (comma-separated) without a code change.
const RECIPIENTS = (process.env.SE_RETURN_RECIPIENTS
  || 'john.bradnick@reposefurniture.co.uk,transport@reposefurniture.co.uk')
  .split(',').map((s) => s.trim()).filter(Boolean);

// How far back to look for completed repairs (days). Bounds the query; the
// dedup table makes anything already emailed a no-op anyway.
const LOOKBACK_DAYS = Number(process.env.SE_RETURN_LOOKBACK_DAYS || 21);

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(row) {
  const rep = esc(row.rep);
  const job = esc(row.job_no);
  const model = esc(row.model || '—');
  const by = esc(row.completed_by_initials || '—');
  const date = esc(row.completed_date || '');
  return `<!DOCTYPE html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0e023a;font-size:14px;line-height:1.5">
    <p>The service repair for the chair below has been <b>completed by the Service Engineer</b> and is ready to go back to the customer.</p>
    <table style="border-collapse:collapse;margin:14px 0">
      <tr><td style="padding:4px 14px 4px 0;color:#706f6f">REP</td><td style="font-weight:700;font-family:Consolas,monospace">${rep}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#706f6f">Service job</td><td style="font-weight:700">${job}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#706f6f">Model</td><td>${model}</td></tr>
      <tr><td style="padding:4px 14px 4px 0;color:#706f6f">Completed</td><td>${date} · ${by}</td></tr>
    </table>
    <p style="font-weight:700;color:#4f46e5">Please plan the return delivery to the customer in Maxoptra.</p>
    <p style="color:#a8a8a8;font-size:12px;margin-top:18px">Sent automatically by RepNet when the Service Engineer marks a repair complete.</p>
  </body></html>`;
}

module.exports = async function (context) {
  // Env guard — do nothing (cleanly) if the function app isn't configured.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    context.log.warn('[service-return-email] Supabase env missing — skipping.');
    return;
  }

  const cutoff = isoDaysAgo(LOOKBACK_DAYS);
  // PostgREST: encode values ("Service Engineer" has a space). job_no like S%
  // catches service codes; we also confirm sub_team=Services.
  const qs = [
    'select=rep,job_no,model,completed_date,completed_by_initials,week',
    `team=eq.${encodeURIComponent('Service Engineer')}`,
    `sub_team=eq.${encodeURIComponent('Services')}`,
    'is_complete=is.true',
    `completed_date=gte.${cutoff}`,
    `job_no=like.${encodeURIComponent('S%')}`,
  ].join('&');

  let rows;
  try {
    rows = await supa.supaSelectMany('production_completions', qs);
  } catch (e) {
    context.log.error('[service-return-email] query failed:', e.message);
    return;
  }

  let attempted = 0, sent = 0, failed = 0, skipped = 0;
  for (const row of rows) {
    if (!row.rep || !row.job_no || !row.completed_date) continue;

    // Claim before sending. null → already emailed (or table missing → throw).
    let claimed;
    try {
      claimed = await supa.supaInsertIgnoreConflict('service_return_email_log', {
        rep: row.rep,
        job_no: row.job_no,
        completed_date: row.completed_date,
        status: 'sending',
        sent_to: RECIPIENTS.join(','),
      });
    } catch (e) {
      // Table missing or DB error — do NOT send without a dedup claim.
      context.log.error('[service-return-email] claim failed (skipping send):', e.message);
      skipped++;
      continue;
    }
    if (!claimed) { skipped++; continue; } // already handled on a prior run

    attempted++;
    try {
      await sendMailWithAttachment({
        to: RECIPIENTS,
        subject: `🔁 Plan return delivery — ${row.rep} repair complete (${row.model || row.job_no})`,
        html: buildHtml(row),
      });
      await supa.supaUpdate(
        'service_return_email_log',
        `rep=eq.${encodeURIComponent(row.rep)}&job_no=eq.${encodeURIComponent(row.job_no)}&completed_date=eq.${row.completed_date}`,
        { status: 'sent', sent_at: new Date().toISOString() },
      );
      sent++;
    } catch (e) {
      failed++;
      context.log.error(`[service-return-email] send failed for ${row.rep} ${row.job_no}:`, e.message);
      // Release the claim so a transient send failure retries next run rather
      // than permanently blocking this repair's email.
      try {
        await supa.supaDelete(
          'service_return_email_log',
          `rep=eq.${encodeURIComponent(row.rep)}&job_no=eq.${encodeURIComponent(row.job_no)}&completed_date=eq.${row.completed_date}&status=eq.sending`,
        );
      } catch { /* best-effort */ }
    }
  }

  context.log(`[service-return-email] scanned=${rows.length} attempted=${attempted} sent=${sent} failed=${failed} skipped=${skipped}`);
};
