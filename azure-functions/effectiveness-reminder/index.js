'use strict';
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const SP_SITE_PATH  = '/sites/ReposeFurniture-PlanningRepose';
const SP_CPAR_LIST  = 'CPARLog';

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
  const items = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$filter=fields/Status eq 'Awaiting Effectiveness Check' or fields/Status eq 'Closed'`
  );
  const now = Date.now();
  const due = [], overdue = [];
  for (const i of items) {
    const closed = i.fields?.ClosedAt ? new Date(i.fields.ClosedAt) : null;
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
    return `<tr><td style="padding:6px;font-family:monospace;font-weight:700">${escHtml(f.Title)}</td>
      <td style="padding:6px">${escHtml(f.PrimaryModel||'')}</td>
      <td style="padding:6px">${escHtml(f.CauseCode||'')}</td>
      <td style="padding:6px">${escHtml((f.ClosedAt||'').slice(0,10))}</td></tr>`;
  };
  return `<!DOCTYPE html><html><body style="font-family:Arial">
    <h2>Effectiveness re-checks</h2>
    ${overdue.length ? `<h3 style="color:#dc2626">Overdue (>7 days past due) — ${overdue.length}</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Ref</th><th>Model</th><th>Cause</th><th>Closed</th></tr>${overdue.map(row).join('')}</table>` : ''}
    ${due.length ? `<h3>Due — ${due.length}</h3>
      <table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Ref</th><th>Model</th><th>Cause</th><th>Closed</th></tr>${due.map(row).join('')}</table>` : ''}
    <p>Open RepNet → Quality → QHSE Review → Eff. Check tile to verify.</p></body></html>`;
}
