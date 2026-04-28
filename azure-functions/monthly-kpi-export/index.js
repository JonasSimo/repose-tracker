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

const KPI_RECIPIENTS = ['jonas.simonaitis@reposefurniture.co.uk', 'mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];

function workingHoursBetween(s, e) {
  if (e <= s) return 0;
  const WS=6, WE=17;
  let total = 0;
  const cur = new Date(s); cur.setSeconds(0,0);
  while (cur < e) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) {
      const dStart = new Date(cur); dStart.setHours(WS,0,0,0);
      const dEnd   = new Date(cur); dEnd.setHours(WE,0,0,0);
      const ws = cur < dStart ? dStart : cur;
      const we = e   < dEnd   ? e      : dEnd;
      if (we > ws) total += (we - ws) / 3600000;
    }
    cur.setDate(cur.getDate()+1); cur.setHours(0,0,0,0);
  }
  return total;
}
function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
async function sendMailWithAttachment(t, recipients, subject, html, filename, csv) {
  const b64 = Buffer.from(csv, 'utf8').toString('base64');
  await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method:'POST', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
    body: JSON.stringify({ message:{
      subject, body:{ contentType:'HTML', content:html },
      toRecipients: recipients.map(e => ({ emailAddress:{ address:e }})),
      attachments:[{ '@odata.type':'#microsoft.graph.fileAttachment', name:filename, contentType:'text/csv', contentBytes:b64 }]
    }})
  });
}

module.exports = async function (context, myTimer) {
  const t = await token();
  const siteId = await getSiteId(t);
  const listId = await getListId(t, siteId);
  // last full calendar month
  const now = new Date();
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
  const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth()+1).padStart(2,'0')}`;

  const items = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`
  );
  const teams = [...new Set(items.map(i => i.fields?.SourceDept).filter(Boolean))];

  const headers = ['Period','Team','Opened','Closed','Still Open EOM','MTTR (work hrs)','Top Cause','Top Cause Count','Repeat-flagged','ECR-linked','Eff. Verified','Eff. Failed'];
  const rows = [];
  for (const team of [...teams, 'ALL']) {
    const teamItems = team === 'ALL' ? items : items.filter(i => i.fields?.SourceDept === team);
    const opened = teamItems.filter(i => {
      const d = new Date(i.fields?.LoggedAt); return d >= periodStart && d <= periodEnd;
    });
    const closed = teamItems.filter(i => {
      const d = new Date(i.fields?.ClosedAt); return d.getTime() && d >= periodStart && d <= periodEnd;
    });
    const stillOpen = teamItems.filter(i => {
      const s = i.fields?.Status;
      if (s === 'Closed' || s === 'Archived') return false;
      const d = new Date(i.fields?.LoggedAt);
      return d <= periodEnd;
    });
    const mttrSamples = closed.map(i =>
      workingHoursBetween(new Date(i.fields.LoggedAt), new Date(i.fields.ClosedAt))
    ).filter(h => h > 0);
    const mttr = mttrSamples.length ? (mttrSamples.reduce((a,b)=>a+b,0) / mttrSamples.length).toFixed(1) : '';
    const causeCounts = {};
    for (const i of opened) {
      const c = (i.fields?.CauseCode||'').trim();
      if (c) causeCounts[c] = (causeCounts[c]||0)+1;
    }
    const top = Object.entries(causeCounts).sort((a,b) => b[1]-a[1])[0] || ['', 0];
    const repeats   = opened.filter(i => i.fields?.IsRepeat).length;
    const ecrLinked = closed.filter(i => i.fields?.ECRRef).length;
    const effOk     = closed.filter(i => i.fields?.EffectivenessVerified === true).length;
    const effFail   = closed.filter(i => i.fields?.EffectivenessVerified === false).length;
    rows.push([period, team, opened.length, closed.length, stillOpen.length, mttr, top[0], top[1], repeats, ecrLinked, effOk, effFail]);
  }
  const csv = '﻿' + [headers.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\r\n');
  const filename = `cpar-kpi-${period}.csv`;
  const html = `<p>CPAR KPI rollup for ${period} attached.</p>`;
  await sendMailWithAttachment(t, KPI_RECIPIENTS, `CPAR KPI ${period}`, html, filename, csv);
  context.log('KPI export sent for '+period);
};
