'use strict';
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = process.env.REPNET_URL || 'https://brave-island-06ef03810.1.azurestaticapps.net/';

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
function _normaliseLoggedAtDay(la) {
  if (!la) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(la)) return la.slice(0,10);
  // DD/MM/YYYY → YYYY-MM-DD
  const [d, m, y] = String(la).split(/[/ ]/);
  return y ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '';
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

const TEAM_MANAGERS = {
  'Woodmill':         ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','paul.jenkins@reposefurniture.co.uk'],
  'Cutting':          ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','mark@reposefurniture.co.uk'],
  'Sewing':           ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','sewingroom@reposefurniture.co.uk'],
  'Upholstery':       ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Upholstery Arms':  ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Upholstery Backs': ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Upholstery Seats': ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Assembly':         ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Foam':             ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','foam@reposefurniture.co.uk'],
  'Stores':           ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','stores@reposefurniture.co.uk'],
  'QC':               ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','weronika.hathaway@reposefurniture.co.uk'],
  'Admin':            ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk'],
  'Development':      ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','ryan.evans@reposefurniture.co.uk'],
};
const DIGEST_MANAGEMENT = ['mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];

const TEAM_NAME_MAP = {
  'woodmill':'Woodmill', 'wood mill':'Woodmill',
  'cutting':'Cutting', 'cutting room':'Cutting',
  'sewing':'Sewing', 'sewing room':'Sewing',
  'upholstery':'Upholstery', 'upholstery room':'Upholstery',
  'upholstery arms':'Upholstery Arms', 'upholstery backs':'Upholstery Backs', 'upholstery seats':'Upholstery Seats',
  'assembly':'Assembly', 'assembly room':'Assembly',
  'foam':'Foam', 'foam room':'Foam',
  'stores':'Stores', 'stores room':'Stores',
  'qc':'QC', 'quality control':'QC',
  'development':'Development',
  'admin':'Admin',
};
function normaliseTeam(raw) {
  return TEAM_NAME_MAP[(raw||'').toLowerCase().trim()] || (raw||'').trim();
}

function lastWorkingDay(d=new Date()) {
  const x = new Date(d); x.setDate(x.getDate()-1);
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate()-1);
  return x;
}
function daysOpen(loggedAt) {
  const d = parseCPARDate(loggedAt);
  if (!d.getTime()) return '?';
  return Math.floor((Date.now() - d) / 86400000);
}
function rowHtml(i, includeDays) {
  const f = i.fields || {};
  return `<tr style="border-bottom:1px solid #e2e8f0">
    <td style="padding:6px;font-family:monospace;font-weight:700">${escHtml(f.Title)}</td>
    <td style="padding:6px;font-family:monospace">${escHtml(f.PrimaryREP||'')}/${escHtml(String(f.PrimaryJobNo||''))}</td>
    <td style="padding:6px">${escHtml((f.Description||'').slice(0,80))}</td>
    <td style="padding:6px;text-align:right">${escHtml(String(f.QTY||1))}</td>
    <td style="padding:6px">${escHtml(f.IssueCategory||'')}</td>
    <td style="padding:6px">${escHtml(f.Status||'Open')}</td>
    ${includeDays ? `<td style="padding:6px">${daysOpen(f.LoggedAt)}d</td>` : ''}
  </tr>`;
}
function buildEmail(team, raisedYesterday, stillOpen, yest) {
  const navy = '#1e3a5f', light = '#f0f4f8', border = '#e2e8f0';
  const rowsR = raisedYesterday.map(i => rowHtml(i, false)).join('') || `<tr><td colspan="6" style="padding:14px;color:#059669;text-align:center">✓ None raised yesterday</td></tr>`;
  const rowsO = stillOpen.map(i => rowHtml(i, true)).join('') || `<tr><td colspan="7" style="padding:14px;color:#059669;text-align:center">✓ Nothing currently open</td></tr>`;
  const dateStr = yest.toLocaleDateString('en-GB',{ weekday:'long', day:'numeric', month:'long', year:'numeric' });
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${light};font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:680px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:${navy};padding:22px 28px">
      <div style="color:#fff;font-size:20px;font-weight:700">RepNet — ${escHtml(team)} CPAR Digest</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">${escHtml(dateStr)}</div>
    </div>
    <div style="padding:20px 28px">
      <p style="margin:0 0 14px;font-size:14px;color:#374151">
        ${raisedYesterday.length > 0
          ? `<strong>${raisedYesterday.length} new CPAR${raisedYesterday.length===1?'':'s'}</strong> raised against ${escHtml(team)} yesterday.`
          : `<strong>No new CPARs</strong> raised against ${escHtml(team)} yesterday.`}
        ${stillOpen.length > 0 ? `<br><strong>${stillOpen.length}</strong> still open and awaiting close-out.` : ''}
      </p>
      <h3 style="margin:0 0 8px;font-size:14px;color:#374151">Raised against you yesterday (${raisedYesterday.length})</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${border};border-radius:6px;overflow:hidden;font-size:12px">
        <thead><tr style="background:${light}">${['Ref','Job','Description','QTY','Cat','Status'].map(h=>`<th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">${h}</th>`).join('')}</tr></thead>
        <tbody>${rowsR}</tbody>
      </table>
      <h3 style="margin:18px 0 8px;font-size:14px;color:#374151">Still open against you (${stillOpen.length})</h3>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${border};border-radius:6px;overflow:hidden;font-size:12px">
        <thead><tr style="background:${light}">${['Ref','Job','Description','QTY','Cat','Status','Days'].map(h=>`<th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">${h}</th>`).join('')}</tr></thead>
        <tbody>${rowsO}</tbody>
      </table>
      ${(raisedYesterday.length + stillOpen.length) > 0 ? `
        <div style="margin-top:18px;padding:14px;background:${light};border-left:4px solid ${navy};border-radius:4px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">What to do:</p>
          <ol style="font-size:12px;color:#374151;line-height:1.5;padding-left:18px;margin:0">
            <li>Open RepNet → <strong>Quality</strong> → <strong>Internal NCRs</strong></li>
            <li>Filter by your team (e.g. ${escHtml(team)})</li>
            <li>Click each open CPAR row → <em>Close Out Issue</em> → fill Disposition / Containment / Cause / Action</li>
            <li>Submit — sends to QHSE Review for final approval</li>
          </ol>
          <p style="margin:12px 0 0">
            <a href="${escHtml(REPNET_URL)}" style="display:inline-block;padding:9px 18px;background:${navy};color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet →</a>
          </p>
        </div>
      ` : ''}
    </div>
    <div style="background:${light};padding:12px 28px;font-size:11px;color:#9ca3af;border-top:1px solid ${border}">
      Repose Furniture · QMS — automated digest at 07:00 each working day · Do not reply.
    </div>
  </div></body></html>`;
}

module.exports = async function (context, myTimer) {
  context.log('CPAR per-team digest starting');
  const t = await token();
  const siteId = await getSiteId(t);
  const listId = await getListId(t, siteId);
  const cparItems = await fetchAll(t,
    `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`);
  context.log(`Loaded ${cparItems.length} CPAR items`);

  const yest = lastWorkingDay();
  const yestPrefix = yest.toISOString().slice(0,10);

  const uphGroupLc = new Set(['upholstery','upholstery arms','upholstery backs','upholstery seats']);
  const canonicalTeam = t => {
    const norm = (t || '').trim();
    if (!norm) return 'Unknown';
    if (uphGroupLc.has(norm.toLowerCase())) return 'Upholstery';
    return norm;
  };
  const sentTeams = new Set();

  for (const team of Object.keys(TEAM_MANAGERS)) {
    const canon = canonicalTeam(team);
    if (sentTeams.has(canon)) continue;
    sentTeams.add(canon);

    // Match items whose normalised SourceDept rolls up to this canonical team.
    const teamItems = cparItems.filter(i => {
      const src = normaliseTeam(i.fields?.SourceDept || i.fields?.RaisedByTeam);
      return canonicalTeam(src) === canon;
    });
    const raisedYesterday = teamItems.filter(i => _normaliseLoggedAtDay(i.fields?.LoggedAt) === yestPrefix);
    const stillOpen = teamItems.filter(i => {
      const s = i.fields?.Status;
      // Team-actionable: Open, Returned-to-Area-Manager, or no status (legacy / freshly-raised)
      return s === 'Open' || s === 'Returned to Area Manager' || !s;
    });
    if (!raisedYesterday.length && !stillOpen.length) continue;
    const html = buildEmail(canon, raisedYesterday, stillOpen, yest);
    try {
      await sendMail(t, TEAM_MANAGERS[team], `RepNet — ${canon} CPAR Digest`, html);
      context.log(`Sent ${canon} digest (${raisedYesterday.length} new, ${stillOpen.length} open)`);
    } catch(e) {
      context.log.warn(`Team digest failed for ${canon}: ${e.message}`);
    }
  }

  // Master combined digest
  const yest2 = cparItems.filter(i => _normaliseLoggedAtDay(i.fields?.LoggedAt) === yestPrefix);
  const open2 = cparItems.filter(i => {
    const s = i.fields?.Status;
    return s === 'Open' || s === 'Returned to Area Manager' || !s;
  });
  const masterHtml = buildEmail('All Teams', yest2, open2, yest);
  try {
    await sendMail(t, DIGEST_MANAGEMENT, 'RepNet — All Teams CPAR Digest', masterHtml);
  } catch(e) {
    context.log.warn(`Master digest failed: ${e.message}`);
  }
  context.log('CPAR digest done');
};
