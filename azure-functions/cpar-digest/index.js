'use strict';
/**
 * Open CPAR (Internal NCR) digest — daily 07:00 weekdays.
 *
 * Port of bin/repnet src/features/cpars/cparDigest.ts to an Azure Function so
 * it actually fires automatically (the React-app version was orphaned post-
 * cutover). Reads Supabase `cpars` table direct via PostgREST and sends a
 * branded per-team email through Graph as systemapp@.
 *
 * Replaces the legacy SharePoint-backed `morning-team-digest`. That timer is
 * effectively dead post-cutover (writes go to Supabase, not CPARLog).
 *
 * Required app settings:
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, REPNET_URL,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   CPAR_DIGEST_TEST_MODE=true   → sends every team digest to jonas.simonaitis@ only
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = (process.env.REPNET_URL || 'https://ashy-river-0a41a9410.7.azurestaticapps.net/').replace(/\/?$/, '/');
const QUALITY_URL   = REPNET_URL + 'quality';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_MODE     = (process.env.CPAR_DIGEST_TEST_MODE || '').toLowerCase() === 'true';
const TEST_RECIPIENT = 'jonas.simonaitis@reposefurniture.co.uk';

let LOGO_DATAURL = '';
try {
  const buf = fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png'));
  LOGO_DATAURL = 'data:image/png;base64,' + buf.toString('base64');
} catch (e) { /* falls back to text wordmark */ }

// ─── Recipient map (mirrors morning-team-digest TEAM_MANAGERS) ────────────
const TEAM_MANAGERS = {
  'Woodmill':         ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','paul.jenkins@reposefurniture.co.uk'],
  'Cutting':          ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','mark@reposefurniture.co.uk'],
  'Sewing':           ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','sewingroom@reposefurniture.co.uk'],
  'Upholstery':       ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Assembly':         ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','daniel.seymour@reposefurniture.co.uk'],
  'Foam':             ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','foam@reposefurniture.co.uk'],
  'Stores':           ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','stores@reposefurniture.co.uk'],
  'QC':               ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','weronika.hathaway@reposefurniture.co.uk'],
  'Admin':            ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','katy.bartlett@reposefurniture.co.uk','julie.underhill@reposefurniture.co.uk','jody.tilley@reposefurniture.co.uk','production@reposefurniture.co.uk'],
  'Development':      ['richard.semmens@reposefurniture.co.uk','mitch@reposefurniture.co.uk','jonas.simonaitis@reposefurniture.co.uk','ryan.evans@reposefurniture.co.uk'],
};

// Upholstery sub-team rows collapse into the parent "Upholstery" digest.
const UPH_GROUP = new Set(['upholstery', 'upholstery arms', 'upholstery backs', 'upholstery seats']);
function canonicalTeam(t) {
  const s = String(t || '').trim();
  if (!s) return '';
  if (UPH_GROUP.has(s.toLowerCase())) return 'Upholstery';
  return s;
}

function normaliseTeam(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  if (/\bupholstery\b/i.test(t)) {
    if (/\barm/i.test(t)) return 'Upholstery Arms';
    if (/\bback/i.test(t)) return 'Upholstery Backs';
    if (/\bseat/i.test(t)) return 'Upholstery Seats';
    return 'Upholstery';
  }
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

// CPAR statuses that count as "open" for the TEAM digest. 'Awaiting
// Effectiveness Check' is deliberately excluded — the team's actions are
// done and the 30-day effectiveness verify is QHSE's queue (the
// effectiveness-reminder function), so listing them here read as phantom
// open issues aging forever.
const OPEN_STATUSES = [
  'Open',
  'Pending QHSE Review',
  'Returned to Area Manager',
  'Investigation',
  'Awaiting Final Sign-Off',
];

// ─── UK timezone helpers ──────────────────────────────────────────────────
function ukPrevWorkingDay() {
  // Returns a Date at start-of-day in Europe/London for the most recent
  // weekday before today. Mon -> previous Friday; Tue-Fri -> previous day.
  const now = new Date();
  const ukParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  let y = Number(ukParts.year);
  let m = Number(ukParts.month);
  let d = Number(ukParts.day);
  const dow = ukParts.weekday; // Mon, Tue, ...

  const back = dow === 'Mon' ? 3 : (dow === 'Sun' ? 2 : 1);
  // Build at 00:00 UK then subtract `back` days.
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - back * 86400000;
  return new Date(startUtcMs);
}

// ─── App-only Graph auth ──────────────────────────────────────────────────
const cca = new ConfidentialClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
  },
});
async function getToken() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}

async function sendMail(token, recipients, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients.map(e => ({ emailAddress: { address: e } })),
      },
      saveToSentItems: 'true',
    }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '<unreadable>');
    throw new Error(`sendMail failed: ${r.status} ${errText.slice(0, 200)}`);
  }
}

// ─── Supabase REST ────────────────────────────────────────────────────────
async function fetchOpenCpars() {
  // PostgREST: status=in.("Open","Pending QHSE Review",...) — values need URL-encoded quotes.
  const statusList = OPEN_STATUSES.map(s => `"${s}"`).join(',');
  const select = encodeURIComponent('id,ref,status,source_dept,issue_category,description,logged_at,closed_out_at,raised_by_team');
  // closed_out_at=is.null — backfilled rows can carry a close timestamp while
  // the status string still reads open; those are closed, don't report them.
  const qs = `?select=${select}&status=in.(${encodeURIComponent(statusList)})&closed_out_at=is.null&order=logged_at.asc&limit=500`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cpars${qs}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase fetch ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

// ─── HTML helpers ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function rowColour(key) {
  return key === 'red' ? '#fff8f8' : key === 'amber' ? '#fffbeb' : '#f0f7ff';
}
function ageBadge(days) {
  if (days >= 2) return { label: '🔴 2+ days', key: 'red' };
  if (days >= 1) return { label: '🟡 1 day+', key: 'amber' };
  return { label: '🔵 Open', key: 'open' };
}

const TABLE_HEAD = `<thead><tr style="background:#1e3a5f;color:#fff">
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Ref</th>
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Raised By</th>
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Category</th>
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Description</th>
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Age</th>
  <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Status</th>
</tr></thead>`;

function buildRows(items) {
  return items.map(r => {
    const rd = new Date(r.logged_at);
    const ageDays = Math.floor((Date.now() - rd.getTime()) / 86400000);
    const badge = ageBadge(ageDays);
    const refDeepLink = `${QUALITY_URL}?search=${encodeURIComponent(r.ref || '')}`;
    return `<tr style="background:${rowColour(badge.key)}">
      <td style="padding:8px 10px;border:1px solid #ddd;font-weight:700;font-family:monospace;white-space:nowrap"><a href="${refDeepLink}" style="color:#0e023a;text-decoration:none">${escHtml(r.ref)}</a></td>
      <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${escHtml(r.raised_by_team || r.source_dept || '?')}</td>
      <td style="padding:8px 10px;border:1px solid #ddd">${escHtml(r.issue_category || '—')}</td>
      <td style="padding:8px 10px;border:1px solid #ddd;max-width:280px">${escHtml(r.description || '—')}</td>
      <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${ageDays}d</td>
      <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${badge.label}</td>
    </tr>`;
  }).join('');
}

// ─── Branded email shell (mirrors src/features/service/email.ts) ──────────
function emailShell(innerHtml, subtitle) {
  const sub = subtitle || 'Quality · CPAR Digest';
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:680px;margin:0 auto;padding:32px 16px">
  <div style="background:#0e023a;color:#fff;padding:22px 24px;border-radius:14px 14px 0 0">
    ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:32px;width:auto;display:block;margin-bottom:14px">` : ''}
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:4px">RepNet · ${escHtml(sub)}</div>
    <div style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em">Repose Production Tracker</div>
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-top:none;border-radius:0 0 14px 14px">
    ${innerHtml}
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">This is an automated message from RepNet. Please do not reply to this email.</div>
</div>
</body></html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[cpar-digest] starting at', new Date().toISOString(), 'TEST_MODE=', TEST_MODE);

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[cpar-digest] missing Graph env vars; aborting'); return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    context.log.error('[cpar-digest] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; aborting'); return;
  }

  let token;
  try { token = await getToken(); }
  catch (e) { context.log.error('[cpar-digest] token failed:', e.message); return; }

  let rows;
  try { rows = await fetchOpenCpars(); }
  catch (e) { context.log.error('[cpar-digest] supabase fetch failed:', e.message); return; }
  context.log(`[cpar-digest] fetched ${rows.length} open CPAR(s)`);

  const prev = ukPrevWorkingDay();
  const prevLabel = prev.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
  });
  const nowLabel = new Date().toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  // Group by the team the NCR was raised AGAINST (source_dept = where the
  // problem originated), not the team that reported it. Sewing's digest is
  // "issues caused by Sewing", with the reporter shown in the Raised By
  // column. raised_by_team is only a fallback for legacy rows with no
  // source_dept.
  const teamOf = (r) => canonicalTeam(normaliseTeam(r.source_dept || r.raised_by_team));

  let sent = 0, skipped = 0, failed = 0;
  const seen = new Set();
  for (const [teamKey, recipientsRaw] of Object.entries(TEAM_MANAGERS)) {
    const canon = canonicalTeam(teamKey);
    if (seen.has(canon)) continue;
    seen.add(canon);

    const matchTeam = (t) =>
      canon === 'Upholstery' ? UPH_GROUP.has(t.toLowerCase()) : t === canon;
    const openForTeam = rows.filter(r => matchTeam(teamOf(r)));
    const newForTeam = rows.filter(r => {
      const rd = new Date(r.logged_at);
      return rd >= prev && matchTeam(teamOf(r));
    });

    if (openForTeam.length === 0 && newForTeam.length === 0) {
      skipped++;
      context.log(`[cpar-digest] skip ${canon} (nothing to report)`);
      continue;
    }

    const newSection = newForTeam.length
      ? `<h3 style="margin:20px 0 6px;font-size:14px;color:#1e3a5f">Raised since ${escHtml(prevLabel)} (${newForTeam.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px">${TABLE_HEAD}<tbody>${buildRows(newForTeam)}</tbody></table>`
      : `<p style="color:#059669;font-style:italic;margin:12px 0">No new CPARs raised on ${escHtml(prevLabel)}.</p>`;

    const openSection = openForTeam.length
      ? `<h3 style="margin:20px 0 6px;font-size:14px;color:#1e3a5f">All open CPARs (${openForTeam.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:18px">${TABLE_HEAD}<tbody>${buildRows(openForTeam)}</tbody></table>`
      : `<p style="color:#059669;font-style:italic;margin:12px 0">No outstanding open CPARs — great work!</p>`;

    const innerHtml = `
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">Internal Non-Conformances · ${escHtml(canon)}</h2>
      <p style="font-size:13px;color:#374151;margin:0 0 14px">${escHtml(nowLabel)}</p>
      ${newSection}
      ${openSection}
      <p style="margin:18px 0 6px;font-size:13px;color:#374151">Please ensure all open issues are investigated and closed out promptly.</p>
      <p style="font-size:14px;margin:18px 0 0"><a href="${QUALITY_URL}" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open RepNet · Quality</a></p>
    `;

    const subject = `Internal Non-Conformances — ${canon} · ${openForTeam.length} open · ${nowLabel}`;
    const html = emailShell(innerHtml, 'Quality · CPAR Digest');
    const recipients = TEST_MODE ? [TEST_RECIPIENT] : [...new Set(recipientsRaw)];

    try {
      await sendMail(token, recipients, TEST_MODE ? `[TEST] ${subject}` : subject, html);
      sent++;
      context.log(`[cpar-digest] sent ${canon} -> ${recipients.length} recipient(s)`);
    } catch (e) {
      failed++;
      context.log.error(`[cpar-digest] sendMail ${canon} failed: ${e.message}`);
    }
  }

  context.log(`[cpar-digest] done. sent=${sent} skipped=${skipped} failed=${failed}`);
};
