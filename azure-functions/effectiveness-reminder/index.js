'use strict';
/**
 * Effectiveness re-check reminder — Mondays 07:00 to QHSE.
 *
 * Repointed SP CPARLog → Supabase `cpars` (2026-06-07, post-cutover). The
 * SharePoint list stopped receiving writes when RepNet swapped to Supabase,
 * so this used to silently send empty digests every Monday.
 *
 * Required app settings:
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, REPNET_URL,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

let LOGO_DATAURL = '';
try {
  const buf = fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png'));
  LOGO_DATAURL = 'data:image/png;base64,' + buf.toString('base64');
} catch(e) { /* fall back to text wordmark */ }

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = (process.env.REPNET_URL || 'https://ashy-river-0a41a9410.7.azurestaticapps.net/').replace(/\/?$/, '/');
const ACTIONS_URL   = REPNET_URL + 'actions';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const cca = new ConfidentialClientApplication({
  auth:{ clientId: CLIENT_ID, authority:`https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET }
});
async function token() {
  const r = await cca.acquireTokenByClientCredential({ scopes:['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}

// ─── Supabase REST ────────────────────────────────────────────────────────
async function fetchCparsForEffectiveness() {
  // status = 'Awaiting Effectiveness Check' OR (status = 'Closed' AND closed_at >= now-60d)
  // PostgREST: top-level or= with nested and(...) clause. status value has spaces -> quote.
  const cutoff60d = new Date(Date.now() - 60 * 86400000).toISOString();
  const select = encodeURIComponent('ref,status,closed_at,primary_model,cause_code');
  const or = encodeURIComponent(`(status.eq."Awaiting Effectiveness Check",and(status.eq.Closed,closed_at.gte.${cutoff60d}))`);
  const qs = `?select=${select}&or=${or}&order=closed_at.asc.nullslast&limit=999`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cpars${qs}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase fetch ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function escHtml(s){
  return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
async function sendMailCc(t, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method:'POST', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
    body: JSON.stringify({ message:{
      subject, body:{ contentType:'HTML', content:html },
      toRecipients: to.map(e => ({ emailAddress:{ address:e }})),
      ccRecipients: cc.map(e => ({ emailAddress:{ address:e }})),
    }})
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`sendMailCc failed: ${r.status} ${errText.slice(0,200)}`);
  }
}

const QHSE_PRIMARY = ['jonas.simonaitis@reposefurniture.co.uk'];
const QHSE_CC      = ['mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];
const EFF_DAYS     = 30;

module.exports = async function (context, myTimer) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      context.log.error('[effectiveness-reminder] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; aborting'); return;
    }
    const rows = await fetchCparsForEffectiveness();
    context.log(`[effectiveness-reminder] fetched ${rows.length} candidate CPAR(s) from Supabase`);

    const now = Date.now();
    const due = [], overdue = [];
    for (const r of rows) {
      if (!r.closed_at) continue;
      const closed = new Date(r.closed_at);
      if (isNaN(closed.getTime())) continue;
      const dueDate = new Date(closed); dueDate.setDate(dueDate.getDate() + EFF_DAYS);
      const diffDays = (now - dueDate.getTime()) / 86400000;
      if (r.status === 'Awaiting Effectiveness Check') {
        if (diffDays > 7) overdue.push(r);
        else due.push(r);
      } else if (diffDays >= 0) {
        // Status is Closed but the 30-day window has elapsed — flag for QHSE
        // to move it onto Awaiting Effectiveness Check.
        due.push(r);
      }
    }

    if (!due.length && !overdue.length) {
      context.log('[effectiveness-reminder] no eff checks due');
      return;
    }

    const t = await token();
    const html = buildReminder(due, overdue);
    const subject = `Effectiveness re-checks due — ${due.length + overdue.length}`;
    await sendMailCc(t, QHSE_PRIMARY, QHSE_CC, subject, html);
    context.log(`[effectiveness-reminder] sent: due=${due.length} overdue=${overdue.length}`);
  } catch (e) {
    context.log.error('[effectiveness-reminder] failed:', e && e.message || e);
    throw e;
  }
};

function buildReminder(due, overdue) {
  const row = r => `<tr><td style="padding:6px 8px;font-family:monospace;font-weight:700">${escHtml(r.ref)}</td>
      <td style="padding:6px 8px">${escHtml(r.primary_model || '')}</td>
      <td style="padding:6px 8px">${escHtml(r.cause_code || '')}</td>
      <td style="padding:6px 8px">${escHtml((r.closed_at || '').slice(0,10))}</td></tr>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <div style="background:#d97706;padding:18px 24px;color:#fff">
        ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:22px;width:auto;display:block;margin-bottom:8px">` : `<div style="font-size:14px;font-weight:900;color:#14a1e9;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`}
        <div style="font-size:18px;font-weight:700">Internal Non-Conformance — Effectiveness Re-Check Reminder</div>
        <div style="opacity:.85;font-size:12px;margin-top:4px">Weekly Monday digest — ISO 9001 §10.2.1 e</div>
      </div>
      <div style="padding:20px 24px">
        <p style="margin:0 0 14px;font-size:14px;color:#374151">
          ${overdue.length > 0 ? `<strong style="color:#dc2626">${overdue.length} overdue</strong> + ` : ''}
          <strong>${due.length}</strong> due for effectiveness re-check this week.
        </p>
        ${overdue.length ? `<h3 style="color:#dc2626;font-size:14px;margin:16px 0 8px">Overdue (>7 days past due) — ${overdue.length}</h3>
          <table style="width:100%;border-collapse:collapse;border:1px solid #fca5a5;border-radius:6px;overflow:hidden;font-size:12px">
            <thead><tr style="background:#fff1f1"><th style="padding:7px 8px;text-align:left;color:#991b1b">Ref</th><th style="padding:7px 8px;text-align:left;color:#991b1b">Model</th><th style="padding:7px 8px;text-align:left;color:#991b1b">Cause</th><th style="padding:7px 8px;text-align:left;color:#991b1b">Closed</th></tr></thead>
            <tbody>${overdue.map(row).join('')}</tbody>
          </table>` : ''}
        ${due.length ? `<h3 style="font-size:14px;margin:16px 0 8px;color:#374151">Due this week — ${due.length}</h3>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;font-size:12px">
            <thead><tr style="background:#f0f4f8"><th style="padding:7px 8px;text-align:left;color:#6b7280">Ref</th><th style="padding:7px 8px;text-align:left;color:#6b7280">Model</th><th style="padding:7px 8px;text-align:left;color:#6b7280">Cause</th><th style="padding:7px 8px;text-align:left;color:#6b7280">Closed</th></tr></thead>
            <tbody>${due.map(row).join('')}</tbody>
          </table>` : ''}
        <div style="margin-top:18px;padding:14px;background:#f0f4f8;border-left:4px solid #d97706;border-radius:4px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">What to do:</p>
          <ol style="font-size:12px;color:#374151;line-height:1.5;padding-left:18px;margin:0">
            <li>Open RepNet → <strong>Quality</strong> → <strong>QHSE Review</strong></li>
            <li>Click the <strong>Eff. Check</strong> tile to filter to those due</li>
            <li>For each: confirm with the team that the corrective action stuck</li>
            <li>Click <em>✓ Still effective</em> (archives) or <em>✗ Recurred</em> (creates a new linked CPAR)</li>
          </ol>
          <p style="margin:12px 0 0">
            <a href="${escHtml(ACTIONS_URL)}" style="display:inline-block;padding:9px 18px;background:#d97706;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet · Actions →</a>
          </p>
        </div>
      </div>
      <div style="background:#f0f4f8;padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e2e8f0">
        Repose Furniture · QMS — automated reminder · Mondays 07:00 · Do not reply.
      </div>
    </div>
  </body></html>`;
}
