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
  if (!j.value || !j.value.length) throw new Error(`SharePoint list not found: ${SP_CPAR_LIST}`);
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
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method:'POST', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
    body: JSON.stringify({ message:{ subject, body:{ contentType:'HTML', content:html },
      toRecipients: recipients.map(e => ({ emailAddress:{ address:e }})) }})
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`sendMail failed: ${r.status} ${errText.slice(0,200)}`);
  }
}

function appendHistoryLine(currentHistory, event) {
  const line = JSON.stringify({ ...event, t: new Date().toISOString() });
  return currentHistory ? currentHistory + '\n' + line : line;
}

const REPEAT_DAYS = 30;
const REPEAT_THRESHOLD = 3;

module.exports = async function (context, myTimer) {
  try {
  const t = await token();
  const siteId = await getSiteId(t);
  const listId = await getListId(t, siteId);
  const cutoff = new Date(Date.now() - 90*86400000).toISOString();
  // IsRepeat default null; we want to scan items not yet flagged true (i.e. null OR false).
  // Post-filter in JS to avoid SP $filter null-handling quirks.
  // Fetch all items in window (including already-flagged) so the comparison set is complete.
  const allItems = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$filter=fields/Created ge '${cutoff}'`
  );
  // Iterate only the unflagged subset for potential flipping; compare against the full set.
  const items = allItems.filter(i => i.fields?.IsRepeat !== true);
  context.log(`scanning ${items.length} items for repeats`);
  let flipped = 0;
  for (const i of items) {
    const f = i.fields || {};
    if (!f.PrimaryModel || !f.CauseCode) continue; // not yet closed-out
    const since = new Date(Date.now() - REPEAT_DAYS*86400000);
    const matches = allItems.filter(j => {
      if (j.id === i.id) return false;
      const g = j.fields || {};
      if ((g.PrimaryModel||'').trim().toLowerCase() !== (f.PrimaryModel||'').trim().toLowerCase()) return false;
      if ((g.CauseCode||'').trim() !== (f.CauseCode||'').trim()) return false;
      const d = parseCPARDate(g.LoggedAt);
      return d.getTime() && d >= since;
    });
    if (matches.length >= REPEAT_THRESHOLD - 1) {
      const linked = matches.map(m => m.fields.Title).filter(Boolean).join(';');
      try {
        const newHistory = appendHistoryLine(i.fields?.History || '', { by:'system', ev:'repeat-flagged-by-sweep', linked });
        const r = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items/${i.id}/fields`, {
          method:'PATCH', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
          body: JSON.stringify({ IsRepeat: true, RepeatLinkedRefs: linked, History: newHistory })
        });
        if (r.ok) flipped++;
      } catch(e) { context.log.warn('flip failed for '+f.Title+': '+e.message); }
    }
  }
  context.log(`flipped ${flipped} CPARs to IsRepeat=true`);
  } catch (e) {
    context.log.error('repeat-issue-sweep failed:', e && e.message || e);
    throw e;
  }
};
