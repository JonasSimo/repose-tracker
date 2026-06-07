'use strict';
/**
 * CAPA deadline reminders — Mon-Fri 07:15.
 *
 * Replaces the SP-fed effectiveness-reminder. Sends per-owner grouped emails
 * about Open CAPAs from the Supabase `capas` table, banded by days-until-due:
 *
 *   • week2  — due in 12-14 days (±1 day to absorb weekend slippage)
 *              -> owner only
 *   • week1  — due in 5-7 days
 *              -> owner only
 *   • day2   — due in 1-3 days
 *              -> owner + Jonas (to) + Richard (cc)
 *   • overdue — due_date passed, still Open
 *              -> owner + Jonas (to) + Richard (cc), every weekday
 *
 * Dedup: week2/week1/day2 are sent ONCE per CAPA, tracked via an
 * 'reminder:<band>' event appended to capas.history. overdue intentionally
 * fires daily until the CAPA is closed (per spec — Jonas wanted daily chase).
 *
 * Required app settings:
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM, REPNET_URL,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   CAPA_REMINDERS_TEST_MODE=true   → route every send to jonas.simonaitis@ only
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
const ACTIONS_URL   = REPNET_URL + 'actions';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_MODE     = (process.env.CAPA_REMINDERS_TEST_MODE || '').toLowerCase() === 'true';
const TEST_RECIPIENT = 'jonas.simonaitis@reposefurniture.co.uk';

const JONAS_EMAIL   = 'jonas.simonaitis@reposefurniture.co.uk';
const RICHARD_EMAIL = 'richard.semmens@reposefurniture.co.uk';

let LOGO_DATAURL = '';
try {
  const buf = fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png'));
  LOGO_DATAURL = 'data:image/png;base64,' + buf.toString('base64');
} catch (e) { /* fallback to text wordmark */ }

const BAND_META = {
  week2:   { tag: '2 weeks to deadline',     accent: '#16a34a', tone: 'gentle',   ccEscalation: false },
  week1:   { tag: '1 week to deadline',      accent: '#d97706', tone: 'firmer',   ccEscalation: false },
  day2:    { tag: '⚠ 2 days to deadline',    accent: '#dc2626', tone: 'urgent',   ccEscalation: true  },
  overdue: { tag: '⛔ OVERDUE',              accent: '#7f1d1d', tone: 'overdue',  ccEscalation: true  },
};

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

async function sendMail(token, to, cc, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map(e => ({ emailAddress: { address: e } })),
        ccRecipients: cc.map(e => ({ emailAddress: { address: e } })),
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
async function fetchOpenCapas() {
  const select = encodeURIComponent('id,ref,status,priority,owner_email,owner_name,owner_team,due_date,description,actions_taken,history');
  const qs = `?select=${select}&status=eq.Open&due_date=not.is.null&order=due_date.asc&limit=999`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/capas${qs}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase fetch ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function patchHistory(id, newHistory) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/capas?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ history: newHistory }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase PATCH history ${res.status}: ${t.slice(0, 200)}`);
  }
}

// ─── Date helpers (UK calendar days) ──────────────────────────────────────
function todayUkYmd() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // "YYYY-MM-DD"
}
function ymdToUtcMidnight(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, 0, 0);
}
function daysBetweenYmd(fromYmd, toYmd) {
  return Math.round((ymdToUtcMidnight(toYmd) - ymdToUtcMidnight(fromYmd)) / 86400000);
}

// ─── Banding logic ────────────────────────────────────────────────────────
function bandFor(daysUntil) {
  if (daysUntil <= 0) return 'overdue';
  if (daysUntil >= 1 && daysUntil <= 3) return 'day2';
  if (daysUntil >= 5 && daysUntil <= 7) return 'week1';
  if (daysUntil >= 12 && daysUntil <= 14) return 'week2';
  return null;
}
function alreadySent(capa, band) {
  if (band === 'overdue') return false; // daily chase, no dedupe
  const events = Array.isArray(capa.history) ? capa.history : [];
  return events.some(e => e && e.ev === `reminder:${band}`);
}

// ─── HTML helpers ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildRow(capa, today) {
  const daysUntil = daysBetweenYmd(today, capa.due_date);
  const daysLbl = daysUntil < 0 ? `<strong style="color:#7f1d1d">${Math.abs(daysUntil)} days overdue</strong>` :
                  daysUntil === 0 ? `<strong style="color:#dc2626">due today</strong>` :
                  `${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
  const refLink = `${ACTIONS_URL}?capa=${encodeURIComponent(capa.ref || '')}`;
  return `<tr>
    <td style="padding:8px 10px;border:1px solid #ddd;font-family:monospace;font-weight:700;white-space:nowrap"><a href="${refLink}" style="color:#0e023a;text-decoration:none">${escHtml(capa.ref)}</a></td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${escHtml(capa.priority || '—')}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${escHtml(capa.due_date)}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${daysLbl}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;max-width:380px">${escHtml(capa.description || '—')}</td>
  </tr>`;
}

function buildEmail({ band, ownerName, capas, today }) {
  const meta = BAND_META[band];
  const intro = {
    gentle:  `You have <strong>${capas.length}</strong> CAPA action${capas.length === 1 ? '' : 's'} due in around two weeks. Please plan the work in.`,
    firmer:  `You have <strong>${capas.length}</strong> CAPA action${capas.length === 1 ? '' : 's'} due in around one week. Please confirm progress or flag a blocker.`,
    urgent:  `<strong style="color:#7f1d1d">${capas.length}</strong> CAPA action${capas.length === 1 ? '' : 's'} due in the next 2 days. QHSE and Production Director are now CC'd until close-out.`,
    overdue: `<strong style="color:#7f1d1d">${capas.length}</strong> CAPA action${capas.length === 1 ? '' : 's'} <strong>past due</strong>. This reminder repeats every weekday until close-out.`,
  }[meta.tone] || '';

  const greeting = ownerName ? `Hi ${escHtml(ownerName.split(/\s+/)[0])},` : 'Hi,';

  const table = `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0">
      <thead><tr style="background:#1e3a5f;color:#fff">
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Ref</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Priority</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Due</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">When</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Action</th>
      </tr></thead>
      <tbody>${capas.map(c => buildRow(c, today)).join('')}</tbody>
    </table>`;

  const innerHtml = `
    <div style="background:${meta.accent};color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;margin:-28px -24px 22px">
      ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:22px;width:auto;display:block;margin-bottom:8px">` : ''}
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;margin-bottom:4px">CAPA · ${escHtml(meta.tag)}</div>
      <div style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em">Outstanding CAPA actions</div>
    </div>
    <p style="margin:0 0 14px;font-size:14px;color:#374151">${greeting}</p>
    <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55">${intro}</p>
    ${table}
    <div style="margin-top:18px;padding:14px;background:#f0f4f8;border-left:4px solid ${meta.accent};border-radius:4px">
      <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">To close out:</p>
      <ol style="font-size:12px;color:#374151;line-height:1.6;padding-left:18px;margin:0">
        <li>Open RepNet → <strong>Actions</strong></li>
        <li>Find the CAPA ref</li>
        <li>Record what was done in <em>Actions taken</em></li>
        <li>Click <em>Mark done</em></li>
      </ol>
      <p style="margin:14px 0 0">
        <a href="${escHtml(ACTIONS_URL)}" style="display:inline-block;padding:9px 18px;background:${meta.accent};color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet · Actions →</a>
      </p>
    </div>`;

  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:680px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-radius:14px">
    ${innerHtml}
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">This is an automated message from RepNet · QMS. Please do not reply to this email.</div>
</div>
</body></html>`;
}

function subjectFor(band, count) {
  const noun = count === 1 ? 'action' : 'actions';
  switch (band) {
    case 'week2':   return `RepNet · ${count} CAPA ${noun} due in ~2 weeks`;
    case 'week1':   return `RepNet · ${count} CAPA ${noun} due in ~1 week`;
    case 'day2':    return `⚠ RepNet · ${count} CAPA ${noun} due in 2 days`;
    case 'overdue': return `⛔ RepNet · ${count} CAPA ${noun} OVERDUE`;
    default:        return `RepNet · ${count} CAPA ${noun}`;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('[capa-reminders] starting at', new Date().toISOString(), 'TEST_MODE=', TEST_MODE);

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM) {
    context.log.error('[capa-reminders] missing Graph env vars; aborting'); return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    context.log.error('[capa-reminders] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; aborting'); return;
  }

  const today = todayUkYmd();
  context.log(`[capa-reminders] UK today=${today}`);

  let capas;
  try { capas = await fetchOpenCapas(); }
  catch (e) { context.log.error('[capa-reminders] supabase fetch failed:', e.message); return; }
  context.log(`[capa-reminders] fetched ${capas.length} open CAPA(s) with a due_date`);

  // Group key: owner_email|band
  const groups = new Map();
  for (const c of capas) {
    if (!c.owner_email) {
      context.log(`[capa-reminders] skip ${c.ref}: no owner_email`);
      continue;
    }
    if (!c.due_date) continue;
    const daysUntil = daysBetweenYmd(today, c.due_date);
    const band = bandFor(daysUntil);
    if (!band) continue;
    if (alreadySent(c, band)) {
      context.log(`[capa-reminders] dedup ${c.ref}/${band}: already in history`);
      continue;
    }
    const key = `${c.owner_email.toLowerCase()}|${band}`;
    if (!groups.has(key)) groups.set(key, { ownerEmail: c.owner_email, ownerName: c.owner_name, band, capas: [] });
    groups.get(key).capas.push(c);
  }

  context.log(`[capa-reminders] ${groups.size} group(s) to send`);
  if (groups.size === 0) { context.log('[capa-reminders] nothing to send'); return; }

  let token;
  try { token = await getToken(); }
  catch (e) { context.log.error('[capa-reminders] token failed:', e.message); return; }

  let sent = 0, failed = 0;
  for (const g of groups.values()) {
    const html = buildEmail({ band: g.band, ownerName: g.ownerName, capas: g.capas, today });
    const subject = subjectFor(g.band, g.capas.length);
    const isEsc = BAND_META[g.band].ccEscalation;
    let to, cc;
    if (TEST_MODE) {
      to = [TEST_RECIPIENT]; cc = [];
    } else if (isEsc) {
      // Owner is the action owner; Jonas + Richard ride along (CC).
      // Dedupe in case owner is Jonas or Richard themselves.
      const ownerLc = g.ownerEmail.toLowerCase();
      to = [g.ownerEmail];
      cc = [JONAS_EMAIL, RICHARD_EMAIL].filter(e => e.toLowerCase() !== ownerLc);
    } else {
      to = [g.ownerEmail]; cc = [];
    }

    try {
      await sendMail(token, to, cc, TEST_MODE ? `[TEST] ${subject}` : subject, html);
      sent++;
      context.log(`[capa-reminders] sent ${g.band} to=${to.join(',')} cc=${cc.join(',') || '-'} (${g.capas.length} capa)`);
    } catch (e) {
      failed++;
      context.log.error(`[capa-reminders] sendMail ${g.band}/${g.ownerEmail} failed: ${e.message}`);
      continue;
    }

    // Append history events (skip in TEST_MODE so we don't break dedupe for real run).
    if (!TEST_MODE && g.band !== 'overdue') {
      const evAt = new Date().toISOString();
      for (const c of g.capas) {
        try {
          const next = [...(Array.isArray(c.history) ? c.history : []), {
            at: evAt, by: 'system@repnet', ev: `reminder:${g.band}`,
          }];
          await patchHistory(c.id, next);
        } catch (e) {
          context.log.warn(`[capa-reminders] history patch ${c.ref}/${g.band} failed: ${e.message}`);
        }
      }
    }
  }

  context.log(`[capa-reminders] done. groups=${groups.size} sent=${sent} failed=${failed}`);
};
