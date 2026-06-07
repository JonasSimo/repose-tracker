'use strict';
/**
 * Monthly Internal NCR KPI export — 1st of each month at 07:00.
 *
 * Repointed SP CPARLog → Supabase `cpars` (2026-06-07, post-cutover). The
 * SharePoint list stopped receiving writes when RepNet swapped to Supabase.
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
} catch(e) { /* falls back to text wordmark */ }

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = (process.env.REPNET_URL || 'https://ashy-river-0a41a9410.7.azurestaticapps.net/').replace(/\/?$/, '/');
const STATS_URL     = REPNET_URL + 'stats';
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
// Paginate so we cover all rows even if PostgREST's default page cap shrinks.
async function fetchAllCpars() {
  const out = [];
  const PAGE = 1000;
  const select = encodeURIComponent('ref,status,source_dept,logged_at,closed_at,cause_code,is_repeat,ecr_ref,effectiveness_verified');
  for (let offset = 0; ; offset += PAGE) {
    const qs = `?select=${select}&order=logged_at.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cpars${qs}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Supabase fetch ${res.status} at offset ${offset}: ${t.slice(0, 200)}`);
    }
    const batch = await res.json();
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function escHtml(s){
  return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function parseDate(str) {
  if (!str) return new Date(0);
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

const KPI_RECIPIENTS = ['jonas.simonaitis@reposefurniture.co.uk', 'mitch@reposefurniture.co.uk', 'richard.semmens@reposefurniture.co.uk'];

// Repose working hours: Mon-Thu 07:00-16:00 (9h/day), Fri 07:00-12:00 (5h/day). 41h/week.
function workingHoursBetween(s, e) {
  if (e <= s) return 0;
  let total = 0;
  const cur = new Date(s); cur.setSeconds(0, 0);
  while (cur < e) {
    const dow = cur.getDay();
    let WS = null, WE = null;
    if (dow >= 1 && dow <= 4)      { WS = 7; WE = 16; } // Mon-Thu
    else if (dow === 5)             { WS = 7; WE = 12; } // Fri
    if (WS !== null) {
      const dStart = new Date(cur); dStart.setHours(WS, 0, 0, 0);
      const dEnd   = new Date(cur); dEnd.setHours(WE, 0, 0, 0);
      const ws = cur < dStart ? dStart : cur;
      const we = e < dEnd ? e : dEnd;
      if (we > ws) total += (we - ws) / 3600000;
    }
    cur.setDate(cur.getDate() + 1); cur.setHours(0, 0, 0, 0);
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
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method:'POST', headers:{ Authorization:'Bearer '+t, 'Content-Type':'application/json' },
    body: JSON.stringify({ message:{
      subject, body:{ contentType:'HTML', content:html },
      toRecipients: recipients.map(e => ({ emailAddress:{ address:e }})),
      attachments:[{ '@odata.type':'#microsoft.graph.fileAttachment', name:filename, contentType:'text/csv', contentBytes:b64 }]
    }})
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`sendMailWithAttachment failed: ${r.status} ${errText.slice(0,200)}`);
  }
}

module.exports = async function (context, myTimer) {
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      context.log.error('[monthly-kpi-export] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; aborting'); return;
    }
    // Last full calendar month
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
    const period = `${periodStart.getFullYear()}-${String(periodStart.getMonth()+1).padStart(2,'0')}`;
    context.log(`[monthly-kpi-export] period=${period} from Supabase`);

    const items = await fetchAllCpars();
    context.log(`[monthly-kpi-export] fetched ${items.length} CPAR(s)`);

    // Roll Upholstery sub-teams into parent so KPI rows match the ALL row's sum.
    const uphGroupLc = new Set(['upholstery','upholstery arms','upholstery backs','upholstery seats']);
    const canonicalTeam = t => {
      const norm = (t || '').trim();
      if (!norm) return 'Unknown';
      if (uphGroupLc.has(norm.toLowerCase())) return 'Upholstery';
      return norm;
    };
    const teams = [...new Set(items.map(i => canonicalTeam(i.source_dept)).filter(Boolean))].sort();

    const headers = ['Period','Team','Opened','Closed','Still Open EOM','MTTR (work hrs)','Top Cause','Top Cause Count','Repeat-flagged','ECR-linked','Eff. Verified','Eff. Failed'];
    const rows = [];
    for (const team of [...teams, 'ALL']) {
      const teamItems = team === 'ALL' ? items : items.filter(i => canonicalTeam(i.source_dept) === team);
      const opened = teamItems.filter(i => {
        const d = parseDate(i.logged_at); return d >= periodStart && d <= periodEnd;
      });
      const closed = teamItems.filter(i => {
        const d = parseDate(i.closed_at); return d.getTime() && d >= periodStart && d <= periodEnd;
      });
      const stillOpen = teamItems.filter(i => {
        const s = i.status;
        if (s === 'Closed' || s === 'Archived' || s === 'Awaiting Effectiveness Check') return false;
        const d = parseDate(i.logged_at);
        return d <= periodEnd;
      });
      const mttrSamples = closed.map(i =>
        workingHoursBetween(parseDate(i.logged_at), parseDate(i.closed_at))
      ).filter(h => h > 0);
      const mttr = mttrSamples.length ? (mttrSamples.reduce((a,b)=>a+b,0) / mttrSamples.length).toFixed(1) : '';
      const causeCounts = {};
      for (const i of opened) {
        const c = (i.cause_code||'').trim();
        if (c) causeCounts[c] = (causeCounts[c]||0)+1;
      }
      const top = Object.entries(causeCounts).sort((a,b) => b[1]-a[1])[0] || ['', 0];
      const repeats   = opened.filter(i => i.is_repeat === true).length;
      const ecrLinked = closed.filter(i => i.ecr_ref).length;
      const effOk     = closed.filter(i => i.effectiveness_verified === true).length;
      const effFail   = closed.filter(i => i.effectiveness_verified === false).length;
      rows.push([period, team, opened.length, closed.length, stillOpen.length, mttr, top[0], top[1], repeats, ecrLinked, effOk, effFail]);
    }
    const csv = '﻿' + [headers.join(','), ...rows.map(r => r.map(csvEsc).join(','))].join('\r\n');
    const filename = `cpar-kpi-${period}.csv`;
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <div style="background:#1e3a5f;padding:18px 24px;color:#fff">
          ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:22px;width:auto;display:block;margin-bottom:8px">` : `<div style="font-size:14px;font-weight:900;color:#14a1e9;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`}
          <div style="font-size:18px;font-weight:700">Internal Non-Conformances — Monthly KPI · ${period}</div>
          <div style="opacity:.85;font-size:12px;margin-top:4px">Per-team rollup attached as CSV</div>
        </div>
        <div style="padding:20px 24px;font-size:13px;color:#374151;line-height:1.6">
          <p style="margin:0 0 12px">The attached CSV (<code>${filename}</code>) contains the Internal Non-Conformances KPI rollup for <strong>${period}</strong>:</p>
          <ul style="padding-left:18px;margin:0 0 14px">
            <li><strong>Period</strong> — month covered</li>
            <li><strong>Team</strong> — one row per Source Dept + a final ALL row</li>
            <li><strong>Opened / Closed / Still Open EOM</strong> — counts for the period</li>
            <li><strong>MTTR</strong> — mean time to resolve, in working hours (Mon–Thu 07:00–16:00, Fri 07:00–12:00 — 41 working hrs/wk)</li>
            <li><strong>Top Cause + Count</strong> — most-frequent cause for that team that month</li>
            <li><strong>Repeat-flagged / ECR-linked / Eff. Verified / Eff. Failed</strong> — quality metrics</li>
          </ul>
          <p style="margin:0 0 12px"><strong>Use it for:</strong> management review meetings, ISO 9001 §9.1.3 (analysis &amp; evaluation), trend tracking.</p>
          <p style="margin:14px 0 0">
            <a href="${STATS_URL}" style="display:inline-block;padding:9px 18px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet Quality Dashboard →</a>
          </p>
        </div>
        <div style="background:#f0f4f8;padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e2e8f0">
          Repose Furniture · QMS — automated monthly KPI · 1st of each month at 07:00 · Do not reply.
        </div>
      </div>
    </body></html>`;
    const t = await token();
    await sendMailWithAttachment(t, KPI_RECIPIENTS, `Internal Non-Conformances KPI — ${period}`, html, filename, csv);
    context.log(`[monthly-kpi-export] sent for ${period} (rows=${rows.length})`);
  } catch (e) {
    context.log.error('[monthly-kpi-export] failed:', e && e.message || e);
    throw e;
  }
};
