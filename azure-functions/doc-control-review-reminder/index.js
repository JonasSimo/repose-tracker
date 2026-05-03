'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config (Azure App Settings) ──────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const QMS_SITE_PATH     = '/sites/ReposeFurniture-Quality';
const QMS_REGISTER_LIST = 'MasterDocumentRegister';

// Reminder window — emails fire when NextReviewDate is between 0 and N days away.
const REMINDER_WINDOW_DAYS = 30;

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
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
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

// ─── Main ──────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[review-reminder] starting at', new Date().toISOString());

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[review-reminder] missing env vars; aborting');
    return;
  }

  let token;
  try {
    token = await getAppToken();
  } catch (e) {
    context.log.error('[review-reminder] auth failed:', e.message);
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
    context.log.error('[review-reminder] site/list resolution failed:', e.message);
    return;
  }

  // Fetch all docs (only the columns we need)
  let docs;
  try {
    docs = await graphGetAll(
      token,
      `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields($select=DocNumber,Title,Status,Owner,NextReviewDate,CurrentRevision)&$top=999`
    );
  } catch (e) {
    context.log.error('[review-reminder] register fetch failed:', e.message);
    return;
  }

  context.log(`[review-reminder] fetched ${docs.length} docs`);

  // Filter to docs needing reminders
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = [];
  const overdue = [];
  for (const item of docs) {
    const f = item.fields || {};
    if (f.Status !== 'Published') continue; // only chase live docs
    if (!f.NextReviewDate) continue;
    if (!f.Owner) continue;
    const next = new Date(f.NextReviewDate);
    if (isNaN(next)) continue;
    const daysUntil = Math.round((next - todayMidnight) / 86400000);
    if (daysUntil < 0) {
      overdue.push({ ...f, daysUntil });
    } else if (daysUntil <= REMINDER_WINDOW_DAYS) {
      due.push({ ...f, daysUntil });
    }
  }

  context.log(`[review-reminder] ${due.length} due in next ${REMINDER_WINDOW_DAYS}d, ${overdue.length} overdue`);

  if (due.length === 0 && overdue.length === 0) {
    context.log('[review-reminder] nothing to send today');
    return;
  }

  // Group by Owner so each owner gets one email summarising their queue
  const byOwner = new Map();
  for (const d of [...overdue, ...due]) {
    const owner = (d.Owner || '').trim().toLowerCase();
    if (!owner.includes('@')) continue; // skip rows where Owner isn't a recognisable email
    if (!byOwner.has(owner)) byOwner.set(owner, { overdue: [], due: [] });
    if (d.daysUntil < 0) byOwner.get(owner).overdue.push(d);
    else byOwner.get(owner).due.push(d);
  }

  context.log(`[review-reminder] ${byOwner.size} unique owner(s) to notify`);

  let sent = 0, failed = 0;
  for (const [owner, queue] of byOwner.entries()) {
    const overdueRows = queue.overdue.sort((a, b) => a.daysUntil - b.daysUntil);
    const dueRows = queue.due.sort((a, b) => a.daysUntil - b.daysUntil);
    const totalCount = overdueRows.length + dueRows.length;
    const subject = `RepNet · ${totalCount} controlled document${totalCount === 1 ? '' : 's'} due for review`;

    const rowToHtml = (d) => {
      const dateStr = String(d.NextReviewDate || '').slice(0, 10);
      const colour = d.daysUntil < 0 ? '#dc2626' : (d.daysUntil <= 7 ? '#d97706' : '#0e023a');
      const status = d.daysUntil < 0
        ? `${Math.abs(d.daysUntil)} days OVERDUE`
        : `${d.daysUntil} day${d.daysUntil === 1 ? '' : 's'}`;
      return `<tr><td style="padding:6px 12px;border:1px solid #e1e6eb;font-family:monospace;font-weight:700">${htmlEscape(d.DocNumber)}</td><td style="padding:6px 12px;border:1px solid #e1e6eb">${htmlEscape(d.Title)}</td><td style="padding:6px 12px;border:1px solid #e1e6eb">${dateStr}</td><td style="padding:6px 12px;border:1px solid #e1e6eb;color:${colour};font-weight:700">${status}</td></tr>`;
    };

    const allRows = [...overdueRows, ...dueRows].map(rowToHtml).join('');
    const html = emailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">${overdueRows.length > 0 ? '⚠ Reviews overdue' : '⏰ Reviews due'}</h2>
      <p style="font-size:14px;line-height:1.55">You're listed as the Owner of <b>${totalCount} controlled document${totalCount === 1 ? '' : 's'}</b> ${overdueRows.length > 0 ? `<b>(${overdueRows.length} overdue)</b>` : ''} due for review in the next ${REMINDER_WINDOW_DAYS} days.</p>
      <p style="font-size:13px;color:#706f6f">Open RepNet → Documents to either confirm each is still valid (resets the clock for another cycle) or revise it.</p>
      <table style="width:100%;font-size:12.5px;border-collapse:collapse;margin:18px 0">
        <tr style="background:#f8fafb"><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Doc No.</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Title</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Next review</th><th style="padding:8px 12px;border:1px solid #e1e6eb;text-align:left">Status</th></tr>
        ${allRows}
      </table>
      <p style="font-size:12px;color:#706f6f;line-height:1.5">This reminder is sent weekly while documents remain due or overdue. Open RepNet → Documents → click the doc → Edit metadata to update the review cycle, or use New revision to publish updated content.</p>
    `);

    try {
      await sendMail(token, owner, subject, html);
      context.log(`[review-reminder] sent to ${owner} (${totalCount} doc(s))`);
      sent++;
    } catch (e) {
      context.log.error(`[review-reminder] sendMail to ${owner} failed: ${e.message}`);
      failed++;
    }
  }

  context.log(`[review-reminder] done. sent=${sent} failed=${failed}`);
};
