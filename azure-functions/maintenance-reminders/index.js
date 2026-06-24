'use strict';
/**
 * Yearly/Statutory maintenance reminders — Mon-Fri 07:25 (UK).
 * Phase 2 of the compliance cockpit (spec: repnet docs/superpowers/specs/
 * 2026-06-11-yearly-statutory-cockpit-design.md).
 *
 * Three jobs per run:
 *
 * 1. STATUTORY escalation ladder (Category = 'Statutory'):
 *      pre30  — due in ≤30 days            → owner
 *      due    — due date reached            → owner, QHSE cc
 *      qhse7  — ≥7 days overdue             → owner + QHSE (to)
 *      md30   — ≥30 days overdue            → + MT_ESCALATION_MD (skipped
 *               with a log line if that app setting is unset)
 *    Each stage fires ONCE per due-cycle — dedup via maintenance_audit_log
 *    rows (action='escalation', detail {stage, due}). A new cycle (new
 *    nextDue) re-arms every stage.
 *
 * 2. PPM / Insurance gentle reminder: due in ≤30 days → owner, once per
 *    cycle (stage 'pre30'). Overdue non-statutory items ride the Monday
 *    digest instead of a daily chase.
 *
 * 3. EVIDENCE chase (Mondays only): items whose latest completion has no
 *    maintenance_evidence rows and no DocLink → grouped per owner.
 *
 * Items with no owner_email fall back to QHSE (Jonas to, Richard cc).
 *
 * Required app settings: TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: REPNET_URL,
 *   MT_ESCALATION_MD, MT_REMINDERS_TEST_MODE=true (route everything to Jonas).
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const REPNET_URL    = (process.env.REPNET_URL || 'https://ashy-river-0a41a9410.7.azurestaticapps.net/').replace(/\/?$/, '/');
const MAINT_URL     = REPNET_URL + 'maintenance';
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_MODE     = (process.env.MT_REMINDERS_TEST_MODE || '').toLowerCase() === 'true';
const TEST_RECIPIENT = 'jonas.simonaitis@reposefurniture.co.uk';
const MD_EMAIL      = (process.env.MT_ESCALATION_MD || '').trim();
// Reminder window for the gentle pre-due stage (days before due). Configurable
// so Jonas can widen it if 30 days is too tight for contractor lead times.
const PRE_DAYS      = Number(process.env.MT_REMINDERS_PRE_DAYS || 30) || 30;

const JONAS_EMAIL   = 'jonas.simonaitis@reposefurniture.co.uk';
const RICHARD_EMAIL = 'richard.semmens@reposefurniture.co.uk';

// ─── Graph ────────────────────────────────────────────────────────────────
const cca = new ConfidentialClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET },
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
  if (!r.ok) throw new Error(`sendMail ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// ─── Supabase REST ────────────────────────────────────────────────────────
async function sbGet(pathQs) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status} on ${pathQs.split('?')[0]}`);
  return res.json();
}
async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table} ${res.status}`);
}

// ─── Status math (mirrors repnet maintenance/loader.ts) ──────────────────
function todayUkYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function ymdUtc(ymd) { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function daysBetween(fromYmd, toYmd) { return Math.round((ymdUtc(toYmd) - ymdUtc(fromYmd)) / 86400000); }
function freqDays(item) {
  const f = String(item.frequency || '').toLowerCase();
  if (f === 'annual') return 365;
  if (f === '6-monthly') return 183;
  if (f === 'quarterly') return 91;
  if (f === 'monthly') return 30;
  if (f === 'custom') return Number(item.frequency_days || 0) || 365;
  return 365;
}
function nextDueIso(item) {
  const sched = String(item.scheduled_for || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sched)) return sched;
  const last = String(item.last_done || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) return null; // never done — treated as overdue elsewhere
  return new Date(ymdUtc(last) + freqDays(item) * 86400000).toISOString().slice(0, 10);
}

// Statutory ladder stages, most severe first. `when` is daysUntil (negative = overdue).
const STAGES = [
  { id: 'md30',  match: d => d <= -30, statOnly: true,  accent: '#7f1d1d', tag: '⛔ ESCALATION — 30+ days overdue' },
  { id: 'qhse7', match: d => d <= -7,  statOnly: true,  accent: '#dc2626', tag: '⛔ Overdue — QHSE escalation' },
  { id: 'due',   match: d => d <= 0,   statOnly: true,  accent: '#dc2626', tag: '⚠ Due now' },
  { id: 'pre30', match: d => d <= PRE_DAYS, statOnly: false, accent: '#d97706', tag: 'Due soon' },
];

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildEmail({ tag, accent, heading, intro, rows, cta }) {
  const table = rows.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0">
      <thead><tr style="background:#1e3a5f;color:#fff">
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Item</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Category</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Ref</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Due</th>
        <th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Status</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>` : '';
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:680px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-radius:14px">
    <div style="background:${accent};color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;margin:-28px -24px 22px">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.85;margin-bottom:4px">Maintenance · ${escHtml(tag)}</div>
      <div style="font-weight:800;font-size:22px;letter-spacing:-.01em">${escHtml(heading)}</div>
    </div>
    <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55">${intro}</p>
    ${table}
    <p style="margin:14px 0 0">
      <a href="${escHtml(MAINT_URL)}" style="display:inline-block;padding:9px 18px;background:${accent};color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">${escHtml(cta)} →</a>
    </p>
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">Automated message from RepNet · QMS. Do not reply.</div>
</div>
</body></html>`;
}

function itemRow(it, today, due) {
  const d = due ? daysBetween(today, due) : -9999;
  const when = due == null ? '<strong style="color:#7f1d1d">never completed</strong>'
    : d < 0 ? `<strong style="color:#7f1d1d">${Math.abs(d)} days overdue</strong>`
    : d === 0 ? '<strong style="color:#dc2626">due today</strong>'
    : `due in ${d} day${d === 1 ? '' : 's'}`;
  return `<tr>
    <td style="padding:8px 10px;border:1px solid #ddd;font-weight:700">${escHtml(it.title)}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${escHtml(it.category || '—')}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;font-family:monospace;white-space:nowrap">${escHtml(it.legal_ref || '—')}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${escHtml(due || '—')}</td>
    <td style="padding:8px 10px;border:1px solid #ddd;white-space:nowrap">${when}</td>
  </tr>`;
}

module.exports = async function (context) {
  const log = (...a) => context.log('[maintenance-reminders]', ...a);
  const warn = (...a) => context.log.warn('[maintenance-reminders]', ...a);
  log('start', 'TEST_MODE=', TEST_MODE);

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM || !SUPABASE_URL || !SUPABASE_KEY) {
    context.log.error('[maintenance-reminders] missing env vars; aborting'); return;
  }

  const today = todayUkYmd();
  const isMonday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(new Date()) === 'Mon';

  let items, history, evidence, pastEscalations;
  try {
    [items, history, evidence, pastEscalations] = await Promise.all([
      sbGet('maintenance_yearly?select=sp_item_id,title,category,frequency,frequency_days,last_done,scheduled_for,legal_ref,owner_name,owner_email,doc_link&limit=999'),
      sbGet('maintenance_yearly_history?select=sp_item_id,parent_sp_item_id,completed_on,doc_link&order=completed_on.desc&limit=999'),
      sbGet('maintenance_evidence?select=history_sp_item_id,item_sp_item_id&limit=999'),
      sbGet(`maintenance_audit_log?action=eq.escalation&select=item_sp_item_id,detail&limit=999`),
    ]);
  } catch (e) { context.log.error('[maintenance-reminders] fetch failed:', e.message); return; }
  log(`items=${items.length} history=${history.length} evidence=${evidence.length}`);

  const sentKey = new Set(
    pastEscalations
      .filter(r => r && r.detail && r.detail.stage && r.detail.due)
      .map(r => `${r.item_sp_item_id}|${r.detail.stage}|${r.detail.due}`),
  );

  // ── Job 1+2: due/overdue ladder ─────────────────────────────────────────
  // group key: recipientEmail|stageId
  const groups = new Map();
  for (const it of items) {
    if (!it.sp_item_id) continue;
    const due = nextDueIso(it); // null = never done → treat as overdue today
    const dueKey = due || `never-${today.slice(0, 7)}`; // re-arms monthly for never-done items
    const d = due ? daysBetween(today, due) : -9999;
    const isStat = String(it.category || '').trim().toLowerCase() === 'statutory';
    const stage = STAGES.find(s => s.match(d) && (isStat || !s.statOnly));
    if (!stage) continue;
    if (sentKey.has(`${it.sp_item_id}|${stage.id}|${dueKey}`)) continue;

    const owner = (it.owner_email || '').trim().toLowerCase();
    const recipient = owner || JONAS_EMAIL; // no owner set → QHSE fallback
    const key = `${recipient}|${stage.id}`;
    if (!groups.has(key)) groups.set(key, { recipient, ownerName: owner ? it.owner_name : null, stage, items: [] });
    groups.get(key).items.push({ it, due, dueKey });
  }

  // ── Job 3: Monday evidence chase ────────────────────────────────────────
  const chaseGroups = new Map();
  if (isMonday) {
    const evByHistory = new Set(evidence.map(e => e.history_sp_item_id).filter(Boolean));
    const latestByItem = new Map();
    for (const h of history) {
      const pid = h.parent_sp_item_id;
      if (pid && !latestByItem.has(pid)) latestByItem.set(pid, h); // history is sorted desc
    }
    for (const it of items) {
      const latest = latestByItem.get(it.sp_item_id);
      if (!latest) continue; // never completed — the ladder covers it
      const hasEvidence = evByHistory.has(latest.sp_item_id) || Boolean(latest.doc_link) || Boolean(it.doc_link);
      if (hasEvidence) continue;
      const recipient = (it.owner_email || '').trim().toLowerCase() || JONAS_EMAIL;
      if (!chaseGroups.has(recipient)) chaseGroups.set(recipient, { ownerName: it.owner_name, items: [] });
      chaseGroups.get(recipient).items.push({ it, completedOn: String(latest.completed_on || '').slice(0, 10) });
    }
  }

  if (groups.size === 0 && chaseGroups.size === 0) { log('nothing to send'); return; }

  let token;
  try { token = await getToken(); }
  catch (e) { context.log.error('[maintenance-reminders] token failed:', e.message); return; }

  let sent = 0, failed = 0;

  for (const g of groups.values()) {
    const s = g.stage;
    const rows = g.items.map(({ it, due }) => itemRow(it, today, due));
    const first = g.ownerName ? `Hi ${escHtml(String(g.ownerName).split(/\s+/)[0])},` : 'Hi,';
    const intro = {
      pre30: `${first} <strong>${g.items.length}</strong> maintenance item${g.items.length === 1 ? '' : 's'} you own ${g.items.length === 1 ? 'is' : 'are'} due within 30 days — please book the contractor in.`,
      due:   `${first} the statutory item${g.items.length === 1 ? '' : 's'} below ${g.items.length === 1 ? 'is' : 'are'} <strong>at the legal due date</strong>. QHSE is CC'd.`,
      qhse7: `${first} the statutory item${g.items.length === 1 ? '' : 's'} below ${g.items.length === 1 ? 'is' : 'are'} <strong>7+ days past the legal due date</strong>. QHSE is now directly involved.`,
      md30:  `The statutory item${g.items.length === 1 ? '' : 's'} below ${g.items.length === 1 ? 'is' : 'are'} <strong>30+ days past the legal due date</strong> — escalated to senior management.`,
    }[s.id];

    let to, cc;
    if (TEST_MODE) { to = [TEST_RECIPIENT]; cc = []; }
    else if (s.id === 'pre30') { to = [g.recipient]; cc = []; }
    else if (s.id === 'due')   { to = [g.recipient]; cc = [JONAS_EMAIL, RICHARD_EMAIL].filter(e => e !== g.recipient); }
    else if (s.id === 'qhse7') { to = [...new Set([g.recipient, JONAS_EMAIL, RICHARD_EMAIL])]; cc = []; }
    else { // md30
      to = [...new Set([g.recipient, JONAS_EMAIL, RICHARD_EMAIL])];
      cc = MD_EMAIL ? [MD_EMAIL] : [];
      if (!MD_EMAIL) warn('md30 stage fired but MT_ESCALATION_MD is not set — MD not copied');
    }

    const subject = `${s.id === 'pre30' ? '' : '⛔ '}RepNet · ${g.items.length} maintenance item${g.items.length === 1 ? '' : 's'} ${s.id === 'pre30' ? 'due within 30 days' : s.id === 'due' ? 'at due date' : 'OVERDUE'}`;
    try {
      await sendMail(token, to, cc, TEST_MODE ? `[TEST] ${subject}` : subject,
        buildEmail({ tag: s.tag, accent: s.accent, heading: 'Yearly / statutory maintenance', intro, rows, cta: 'Open RepNet · Maintenance' }));
      sent++;
      log(`sent ${s.id} to=${to.join(',')} (${g.items.length} item)`);
    } catch (e) { failed++; context.log.error(`sendMail ${s.id}/${g.recipient}: ${e.message}`); continue; }

    if (!TEST_MODE) {
      for (const { it, dueKey } of g.items) {
        try {
          await sbInsert('maintenance_audit_log', {
            item_sp_item_id: it.sp_item_id,
            action: 'escalation',
            detail: { stage: s.id, due: dueKey, to, cc },
            actor: 'system@repnet',
          });
        } catch (e) { warn(`audit log ${it.title}/${s.id} failed: ${e.message}`); }
      }
    }
  }

  for (const [recipient, g] of chaseGroups.entries()) {
    const rows = g.items.map(({ it, completedOn }) => itemRow(it, today, completedOn));
    const first = g.ownerName ? `Hi ${escHtml(String(g.ownerName).split(/\s+/)[0])},` : 'Hi,';
    const intro = `${first} the item${g.items.length === 1 ? ' was' : 's below were'} completed but <strong>no certificate or report is attached</strong> in RepNet. For ISO audit purposes "done with no evidence" counts as a gap — please attach the contractor's paperwork (Maintenance → Yearly → history → Attach files).`;
    const to = TEST_MODE ? [TEST_RECIPIENT] : [recipient];
    try {
      await sendMail(token, to, [], (TEST_MODE ? '[TEST] ' : '') + `RepNet · ${g.items.length} maintenance completion${g.items.length === 1 ? '' : 's'} missing evidence`,
        buildEmail({ tag: 'Evidence chase · weekly', accent: '#b45309', heading: 'Certificates missing', intro, rows, cta: 'Attach evidence in RepNet' }));
      sent++;
      log(`sent evidence-chase to=${to.join(',')} (${g.items.length} item)`);
    } catch (e) { failed++; context.log.error(`evidence-chase ${recipient}: ${e.message}`); }
  }

  log(`done. ladder-groups=${groups.size} chase-groups=${chaseGroups.size} sent=${sent} failed=${failed}`);
};
