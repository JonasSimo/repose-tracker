'use strict';
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = process.env.REPNET_URL || 'https://reposefurniture-repnet.azurestaticapps.net';

const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const SP_SITE_PATH  = '/sites/ReposeFurniture-PlanningRepose';
const SP_CPAR_LIST  = 'CPARLog';

// Mirror of index.html parseCPARDate — handles ISO and DD/MM/YYYY HH:MM legacy formats.
function parseCPARDate(str) {
  if (!str) return new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) { const d = new Date(str); return isNaN(d) ? new Date(0) : d; }
  const [datePart, timePart='00:00'] = String(str).split(' ');
  const [d, m, y] = datePart.split('/');
  if (!y) return new Date(0);
  return new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${timePart}:00`);
}

const cca = new ConfidentialClientApplication({
  auth:{ clientId: CLIENT_ID, authority:`https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET }
});
async function token() {
  const r = await cca.acquireTokenByClientCredential({ scopes:['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}
async function getSiteId(t) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_SITE_PATH}`, { headers:{ Authorization:'Bearer '+t }});
  if (!r.ok) throw new Error('site lookup '+r.status);
  return (await r.json()).id;
}
async function getListId(t, siteId) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$filter=displayName eq '${SP_CPAR_LIST}'`, { headers:{ Authorization:'Bearer '+t }});
  if (!r.ok) throw new Error('list lookup '+r.status);
  const j = await r.json();
  return j.value[0].id;
}
async function fetchAll(t, url) {
  const out = [];
  let next = url;
  while (next) {
    const r = await fetch(next, { headers:{ Authorization:'Bearer '+t }});
    if (!r.ok) throw new Error('fetchAll '+r.status);
    const j = await r.json();
    out.push(...(j.value||[]));
    next = j['@odata.nextLink'];
  }
  return out;
}
function escHtml(s){
  return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
async function sendMail(t, recipients, subject, html) {
  await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method:'POST', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
    body: JSON.stringify({ message:{
      subject, body:{ contentType:'HTML', content:html },
      toRecipients: recipients.map(e => ({ emailAddress:{ address:e }}))
    }})
  });
}

const QHSE_REVIEWERS = ['jonas.simonaitis@reposefurniture.co.uk'];
const EFF_DAYS = 30;

module.exports = async function (context, myTimer) {
  const t = await token();
  const siteId = await getSiteId(t);
  const listId = await getListId(t, siteId);
  const cutoff = new Date(Date.now() - 60*86400000).toISOString();
  const items = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$filter=(fields/Status eq 'Awaiting Effectiveness Check') or (fields/Status eq 'Closed' and fields/Created ge '${cutoff}')`
  );
  const now = Date.now();
  const due = [], overdue = [];
  for (const i of items) {
    const closed = i.fields?.ClosedAt ? parseCPARDate(i.fields.ClosedAt) : null;
    if (!closed || !closed.getTime()) continue;
    const dueDate = new Date(closed); dueDate.setDate(dueDate.getDate() + EFF_DAYS);
    const diffDays = (now - dueDate.getTime()) / 86400000;
    if (i.fields?.Status === 'Awaiting Effectiveness Check') {
      if (diffDays > 7) overdue.push(i);
      else due.push(i);
    } else if (diffDays >= 0) {
      due.push(i);
    }
  }
  if (!due.length && !overdue.length) { context.log('no eff checks due'); return; }
  const html = buildReminder(due, overdue);
  await sendMail(t, QHSE_REVIEWERS, `Effectiveness re-checks due — ${due.length+overdue.length}`, html);
};

function buildReminder(due, overdue) {
  const row = i => {
    const f = i.fields||{};
    return `<tr><td style="padding:6px 8px;font-family:monospace;font-weight:700">${escHtml(f.Title)}</td>
      <td style="padding:6px 8px">${escHtml(f.PrimaryModel||'')}</td>
      <td style="padding:6px 8px">${escHtml(f.CauseCode||'')}</td>
      <td style="padding:6px 8px">${escHtml((f.ClosedAt||'').slice(0,10))}</td></tr>`;
  };
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <div style="background:#d97706;padding:18px 24px;color:#fff">
        <div style="font-size:18px;font-weight:700">CPAR Effectiveness Re-Check Reminder</div>
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
            <a href="${escHtml(REPNET_URL)}" style="display:inline-block;padding:9px 18px;background:#d97706;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet →</a>
          </p>
        </div>
      </div>
      <div style="background:#f0f4f8;padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e2e8f0">
        Repose Furniture · QMS — automated reminder · Mondays 07:00 · Do not reply.
      </div>
    </div>
  </body></html>`;
}
