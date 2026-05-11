'use strict';

// ── doc-control-approval-reminder ──────────────────────────────────────────
// Daily weekday nudger for outstanding doc-control approvals.
//
// 1. Pulls every row from MasterDocumentRegister where Status === 'In Approval'
// 2. For each doc, computes pending approvers = Approvers (csv) MINUS approvalState.approved
// 3. Groups pending approvals by approver → one digest email per approver
// 4. Skips approvers nudged less than NUDGE_QUIET_DAYS apart (avoid daily spam)
// 5. Sends a separate "stale approvals" chase digest to QHSE for docs pending > STALE_DAYS
//
// Mirrors auth + emailShell pattern from doc-control-review-reminder.

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config (Azure App Settings) ──────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const QHSE_CHASE_TO = process.env.QHSE_CHASE_TO || 'jonas.simonaitis@reposefurniture.co.uk';

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// Approver behaviour knobs.
//   FIRST_NUDGE_AFTER_DAYS: how long after submission before the first nudge
//     (0 = nudge on the next weekday morning even for same-day submissions).
//   NUDGE_QUIET_DAYS: skip if we've nudged this approver within the last N days
//     (read from approvalState.lastNudgedAt[email]). Default 2 = nudge every
//     other weekday.
//   STALE_DAYS: trigger the QHSE chase digest for any doc still pending after
//     this many days.
const FIRST_NUDGE_AFTER_DAYS = 1;
const NUDGE_QUIET_DAYS = 2;
const STALE_DAYS = 7;

// Base URL of RepNet for deep-links in emails (env override for staging).
const REPNET_URL = process.env.REPNET_URL
  || 'https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality/SitePages/RepNet.aspx';

// ─── App-only Graph auth (client credential flow) ─────────────────────────
async function getAppToken() {
  const cca = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET
    }
  });
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

async function graphGet(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function graphGetAll(token, url) {
  const all = [];
  let next = url;
  while (next) {
    const r = await graphGet(token, next);
    if (Array.isArray(r.value)) all.push(...r.value);
    next = r['@odata.nextLink'] || null;
  }
  return all;
}

async function graphPatchFields(token, siteId, listId, itemId, fields) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${itemId}/fields`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    }
  );
  if (!res.ok) throw new Error(`PATCH ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function sendMail(token, to, subject, htmlBody) {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SEND_FROM)}/sendMail`;
  const body = {
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlBody },
      toRecipients: (Array.isArray(to) ? to : [to]).map(addr => ({ emailAddress: { address: addr } }))
    },
    saveToSentItems: true
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`sendMail ${res.status}: ${await res.text()}`);
}

// ─── Email body shell ─────────────────────────────────────────────────────
function emailShell(innerHtml) {
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:620px;margin:0 auto;padding:32px 16px">
  <div style="background:#0e023a;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:4px">RepNet · Document Control</div>
    <div style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em">Repose Production Tracker</div>
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-top:none;border-radius:0 0 14px 14px">
    ${innerHtml}
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">This is an automated message from RepNet. Please do not reply to this email.</div>
</div>
</body></html>`;
}

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function safeJson(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function daysBetween(iso, now) {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t)) return null;
  return Math.floor((now - t) / 86400000);
}

// ─── Main ──────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[approval-reminder] starting at', new Date().toISOString());

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[approval-reminder] missing env vars (TENANT_ID/CLIENT_ID/CLIENT_SECRET/SEND_FROM); aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
  } catch (e) {
    context.log.error('[approval-reminder] auth failed:', e.message);
    return;
  }

  // Resolve site + list IDs
  let siteId, listId;
  try {
    const siteResp = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${QMS_SITE_PATH}`);
    siteId = siteResp.id;
    const listResp = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${QMS_REGISTER_LIST}`);
    listId = listResp.id;
  } catch (e) {
    context.log.error('[approval-reminder] site/list resolution failed:', e.message);
    return;
  }

  // Fetch all 'In Approval' docs (use $filter to keep payload small)
  let docs;
  try {
    docs = await graphGetAll(
      token,
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items` +
      `?$expand=fields($select=DocNumber,Title,Status,Owner,Approvers,ApprovalState,CurrentRevision)` +
      `&$top=999`
    );
  } catch (e) {
    context.log.error('[approval-reminder] register fetch failed:', e.message);
    return;
  }

  context.log(`[approval-reminder] fetched ${docs.length} register rows`);

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 19) + 'Z';
  const inApprovalDocs = [];
  for (const item of docs) {
    const f = item.fields || {};
    if (f.Status !== 'In Approval') continue;
    const required = String(f.Approvers || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (required.length === 0) continue; // safety: status In Approval with empty approver list = nothing to chase
    const state = safeJson(f.ApprovalState, { approved: [], rejected: [], submittedAt: null, submittedBy: null, lastNudgedAt: {} });
    const approved = (state.approved || []).map(e => String(e).toLowerCase());
    const rejected = (state.rejected || []).map(e => String(e).toLowerCase());
    const pending = required.filter(e => !approved.includes(e) && !rejected.includes(e));
    if (pending.length === 0) continue; // fully voted already — workflow will close on next user action
    const daysPending = daysBetween(state.submittedAt, now);
    if (daysPending == null) continue; // missing submittedAt — skip safely
    inApprovalDocs.push({
      itemId: item.id,
      docNumber: f.DocNumber || '',
      title: f.Title || '',
      revision: Number(f.CurrentRevision || 1),
      owner: f.Owner || '',
      submittedAt: state.submittedAt,
      submittedBy: state.submittedBy || '',
      daysPending,
      pending,
      approved,
      required,
      lastNudgedAt: state.lastNudgedAt && typeof state.lastNudgedAt === 'object' ? state.lastNudgedAt : {},
      state
    });
  }

  context.log(`[approval-reminder] ${inApprovalDocs.length} doc(s) currently pending approval`);

  if (inApprovalDocs.length === 0) {
    context.log('[approval-reminder] nothing to nudge');
    return;
  }

  // ── Group pending items by approver, applying quiet-period logic ────────
  const byApprover = new Map(); // email → [{doc, daysPending, daysSinceLastNudge}]
  const nudgedThisRun = new Map(); // itemId → { lastNudgedAt: {...}, state }
  for (const d of inApprovalDocs) {
    if (d.daysPending < FIRST_NUDGE_AFTER_DAYS) continue;
    for (const approver of d.pending) {
      const lastNudgedIso = d.lastNudgedAt[approver];
      const daysSinceLastNudge = lastNudgedIso ? daysBetween(lastNudgedIso, now) : 999;
      if (daysSinceLastNudge < NUDGE_QUIET_DAYS) continue;
      if (!byApprover.has(approver)) byApprover.set(approver, []);
      byApprover.get(approver).push(d);
      // Record that we'll nudge this approver on this doc — used to PATCH lastNudgedAt afterwards
      if (!nudgedThisRun.has(d.itemId)) nudgedThisRun.set(d.itemId, { state: d.state, touched: new Set() });
      nudgedThisRun.get(d.itemId).touched.add(approver);
    }
  }

  context.log(`[approval-reminder] ${byApprover.size} unique approver(s) to nudge`);

  // ── Send approver digests ───────────────────────────────────────────────
  let sent = 0, failed = 0;
  for (const [approver, items] of byApprover.entries()) {
    items.sort((a, b) => b.daysPending - a.daysPending); // oldest first
    const totalCount = items.length;
    const oldest = items[0].daysPending;
    const subject = totalCount === 1
      ? `RepNet · Approval still needed for ${items[0].docNumber} Rev ${items[0].revision} (${oldest}d pending)`
      : `RepNet · ${totalCount} controlled documents waiting for your approval`;

    const rowToHtml = (it) => {
      const colour = it.daysPending >= STALE_DAYS ? '#dc2626' : (it.daysPending >= 4 ? '#d97706' : '#0e023a');
      const docUrl = `${REPNET_URL}?ui=v4#doc:${encodeURIComponent(it.docNumber)}`;
      const submittedStr = it.submittedAt ? String(it.submittedAt).slice(0, 10) : '—';
      return `<tr>
        <td style="padding:6px 12px;border:1px solid #e1e6eb;font-family:monospace;font-weight:700"><a href="${docUrl}" style="color:#0e023a;text-decoration:none">${htmlEscape(it.docNumber)}</a></td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb">${htmlEscape(it.title)} <span style="color:#706f6f">· Rev ${it.revision}</span></td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb">${submittedStr}</td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb;color:${colour};font-weight:700">${it.daysPending} day${it.daysPending === 1 ? '' : 's'}</td>
      </tr>`;
    };

    const allRows = items.map(rowToHtml).join('');
    const html = emailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">⏰ Your approval is still needed</h2>
      <p style="font-size:14px;line-height:1.55">You're listed as an approver on <b>${totalCount} controlled document${totalCount === 1 ? '' : 's'}</b> that ${totalCount === 1 ? 'has' : 'have'} been waiting for your review. The oldest has been pending <b>${oldest} day${oldest === 1 ? '' : 's'}</b>.</p>
      <p style="font-size:13px;color:#706f6f;line-height:1.55">Open RepNet → Doc Approvals (the bell icon shows the count) and click ✓ Approve or ✗ Reject on each card. Rejecting sends the doc back to QHSE with your reason.</p>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;margin:18px 0">
        <tr style="background:#f8fafb">
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Doc No.</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Title / Revision</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Submitted</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Pending</th>
        </tr>
        ${allRows}
      </table>
      <p style="font-size:14px"><a href="${REPNET_URL}?ui=v4#documents" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open RepNet Doc Approvals</a></p>
      <p style="font-size:12px;color:#706f6f;line-height:1.5">You'll get this nudge every ${NUDGE_QUIET_DAYS} weekday${NUDGE_QUIET_DAYS === 1 ? '' : 's'} until you've actioned each doc. After ${STALE_DAYS} days the QHSE Manager is alerted and may chase you directly.</p>
    `);

    try {
      await sendMail(token, approver, subject, html);
      context.log(`[approval-reminder] sent to ${approver} (${totalCount} doc(s))`);
      sent++;
    } catch (e) {
      context.log.error(`[approval-reminder] sendMail to ${approver} failed: ${e.message}`);
      failed++;
      // If sending fails, don't update lastNudgedAt for any of this approver's docs
      for (const it of items) {
        const entry = nudgedThisRun.get(it.itemId);
        if (entry) entry.touched.delete(approver);
      }
    }
  }

  // ── PATCH ApprovalState with new lastNudgedAt timestamps ────────────────
  // We only update docs where at least one approver got nudged. The full
  // approvalState object is preserved (approved/rejected lists untouched).
  for (const [itemId, info] of nudgedThisRun.entries()) {
    if (info.touched.size === 0) continue;
    const newState = {
      approved: info.state.approved || [],
      rejected: info.state.rejected || [],
      submittedAt: info.state.submittedAt,
      submittedBy: info.state.submittedBy,
      lastNudgedAt: { ...(info.state.lastNudgedAt || {}) }
    };
    for (const approver of info.touched) {
      newState.lastNudgedAt[approver] = todayIso;
    }
    try {
      await graphPatchFields(token, siteId, listId, itemId, { ApprovalState: JSON.stringify(newState) });
    } catch (e) {
      context.log.error(`[approval-reminder] failed to patch lastNudgedAt for item ${itemId}: ${e.message}`);
    }
  }

  // ── QHSE chase digest (stale items) ─────────────────────────────────────
  const stale = inApprovalDocs.filter(d => d.daysPending >= STALE_DAYS);
  if (stale.length > 0 && QHSE_CHASE_TO) {
    stale.sort((a, b) => b.daysPending - a.daysPending);
    const subject = `RepNet · ${stale.length} doc-control approval${stale.length === 1 ? '' : 's'} stale (>${STALE_DAYS}d)`;
    const rows = stale.map(d => {
      const docUrl = `${REPNET_URL}?ui=v4#doc:${encodeURIComponent(d.docNumber)}`;
      return `<tr>
        <td style="padding:6px 12px;border:1px solid #e1e6eb;font-family:monospace;font-weight:700"><a href="${docUrl}" style="color:#0e023a;text-decoration:none">${htmlEscape(d.docNumber)}</a></td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb">${htmlEscape(d.title)} <span style="color:#706f6f">· Rev ${d.revision}</span></td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb;color:#dc2626;font-weight:700">${d.daysPending}d</td>
        <td style="padding:6px 12px;border:1px solid #e1e6eb">${d.pending.map(htmlEscape).join('<br>') || '—'}</td>
      </tr>`;
    }).join('');
    const html = emailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">⚠ Stale approvals — chase needed</h2>
      <p style="font-size:14px;line-height:1.55">The following controlled document${stale.length === 1 ? ' has' : 's have'} been in approval for longer than <b>${STALE_DAYS} days</b>. Approvers continue to receive automated nudges, but a personal chase from the QHSE Manager is often what unblocks them.</p>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;margin:18px 0">
        <tr style="background:#f8fafb">
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Doc No.</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Title / Revision</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Pending</th>
          <th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Awaiting</th>
        </tr>
        ${rows}
      </table>
      <p style="font-size:14px"><a href="${REPNET_URL}?ui=v4#documents" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open RepNet Documents</a></p>
    `);
    try {
      await sendMail(token, QHSE_CHASE_TO, subject, html);
      context.log(`[approval-reminder] QHSE chase digest sent to ${QHSE_CHASE_TO} (${stale.length} stale doc(s))`);
      sent++;
    } catch (e) {
      context.log.error(`[approval-reminder] QHSE chase send failed: ${e.message}`);
      failed++;
    }
  }

  context.log(`[approval-reminder] done. sent=${sent} failed=${failed}`);
};
