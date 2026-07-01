'use strict';
/**
 * maintenance-yearly-reconcile — nightly SharePoint → Supabase self-heal.
 *
 * Why this exists: the RepNet Maintenance cockpit reads last_done /
 * scheduled_for from Supabase, but "Mark complete" writes SharePoint first and
 * mirrors to Supabase in a best-effort second call. A dropped mirror write
 * silently strands an item as "Never done" while SharePoint is correct
 * (2026-07-01: 6 of 40 items had diverged). The modal now surfaces a failed
 * mirror to the user; this job is the belt-and-braces safety net that repairs
 * any drift that still slips through.
 *
 * Each run:
 *   1. read the SharePoint MaintenanceYearly list + the Supabase table
 *   2. compute repairs (reconcile-core.js — SharePoint authoritative, never
 *      erases a non-null Supabase value)
 *   3. PATCH updates + INSERT any Supabase rows that went missing
 *   4. write a maintenance_audit_log row per repair (action='reconcile')
 *   5. email Jonas a summary IF anything was repaired or a conflict needs eyes
 *
 * Required app settings: TENANT_ID, CLIENT_ID, CLIENT_SECRET, SEND_FROM,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Optional: REPNET_URL, MT_RECONCILE_DRY_RUN=true (log repairs, write nothing).
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');
const { computeReconciliation, normDate } = require('./reconcile-core');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REPNET_URL    = (process.env.REPNET_URL || 'https://ashy-river-0a41a9410.7.azurestaticapps.net/').replace(/\/?$/, '/');
const MAINT_URL     = REPNET_URL + 'maintenance';
const DRY_RUN       = (process.env.MT_RECONCILE_DRY_RUN || '').toLowerCase() === 'true';

const JONAS_EMAIL   = 'jonas.simonaitis@reposefurniture.co.uk';
const SP_HOST       = 'reposefurniturelimited.sharepoint.com';
const SP_PATH       = '/sites/ReposeFurniture-Quality';
const SP_LIST       = 'MaintenanceYearly';

// ─── Graph ──────────────────────────────────────────────────────────────────
const cca = new ConfidentialClientApplication({
  auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET },
});
async function getToken() {
  const r = await cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  return r.accessToken;
}
async function graphGet(token, url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`Graph GET ${r.status} on ${url.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.json();
}
async function sendMail(token, to, subject, html) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map((e) => ({ emailAddress: { address: e } })),
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
async function sbPatch(pathQs, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathQs}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status} on ${pathQs.split('?')[0]}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

// ─── SharePoint list read ────────────────────────────────────────────────
async function readSharePointItems(token) {
  const site = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${SP_PATH}`);
  const list = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${SP_LIST}`);
  const out = [];
  let url = `https://graph.microsoft.com/v1.0/sites/${site.id}/lists/${list.id}/items?$expand=fields&$top=200`;
  while (url) {
    const page = await graphGet(token, url);
    for (const it of page.value || []) {
      const f = it.fields || {};
      out.push({
        sp_item_id: String(it.id),
        title: f.Title != null ? String(f.Title) : null,
        category: f.Category != null ? String(f.Category) : null,
        frequency: f.Frequency != null ? String(f.Frequency) : null,
        frequency_days: f.FrequencyDays != null ? Number(f.FrequencyDays) : null,
        last_done: f.LastDone != null ? String(f.LastDone) : null,
        scheduled_for: f.ScheduledFor != null ? String(f.ScheduledFor) : null,
        doc_link: f.DocLink != null ? String(f.DocLink) : null,
      });
    }
    url = page['@odata.nextLink'] || null;
  }
  return out;
}

// ─── Email summary ────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function summaryEmail({ updates, inserts, conflicts, dryRun }) {
  const row = (cells) => `<tr>${cells.map((c) => `<td style="padding:7px 10px;border:1px solid #ddd">${c}</td>`).join('')}</tr>`;
  const updRows = updates.map((u) =>
    row([
      `<strong>${escHtml(u.title)}</strong> <span style="color:#888">#${escHtml(u.sp_item_id)}</span>`,
      Object.entries(u.changes)
        .map(([f, v]) => `${escHtml(f)}: <span style="color:#b91c1c">${escHtml(v.from ?? '—')}</span> → <span style="color:#15803d">${escHtml(v.to ?? '—')}</span>`)
        .join('<br>'),
    ]),
  );
  const insRows = inserts.map((i) => row([`<strong>${escHtml(i.title)}</strong> <span style="color:#888">#${escHtml(i.sp_item_id)}</span>`, 'inserted missing Supabase row']));
  const conRows = conflicts.map((c) => row([`<strong>${escHtml(c.title)}</strong> <span style="color:#888">#${escHtml(c.sp_item_id)}</span>`, `${escHtml(c.field)}: SharePoint is blank but Supabase = <strong>${escHtml(c.supabase)}</strong> — left untouched, needs a look`]));
  const section = (title, rows, accent) => (rows.length
    ? `<h3 style="font-size:14px;color:${accent};margin:18px 0 6px">${escHtml(title)} (${rows.length})</h3>
       <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px"><tbody>${rows.join('')}</tbody></table>`
    : '');
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;margin:0">
<div style="max-width:680px;margin:0 auto;padding:28px 16px">
  <div style="background:#fff;padding:24px;border:1px solid #e1e6eb;border-radius:14px">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#64748b">Maintenance · integrity sync</div>
    <div style="font-weight:800;font-size:20px;margin:4px 0 10px">${dryRun ? 'Would repair' : 'Repaired'} SharePoint ↔ RepNet drift</div>
    <p style="font-size:14px;color:#374151;line-height:1.55;margin:0">
      The nightly check found where the Maintenance cockpit (Supabase) had drifted from SharePoint${dryRun ? ' — <strong>DRY RUN, nothing was written</strong>' : ' and corrected it'}.
    </p>
    ${section('Dates corrected', updRows, '#b45309')}
    ${section('Missing rows re-created', insRows, '#7c3aed')}
    ${section('Conflicts — needs review', conRows, '#dc2626')}
    <p style="margin:18px 0 0"><a href="${escHtml(MAINT_URL)}" style="display:inline-block;padding:9px 18px;background:#1e3a5f;color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet · Maintenance →</a></p>
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:12px 0">Automated message from RepNet · QMS. Do not reply.</div>
</div></body></html>`;
}

module.exports = async function (context) {
  const log = (...a) => context.log('[maintenance-yearly-reconcile]', ...a);
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SEND_FROM || !SUPABASE_URL || !SUPABASE_KEY) {
    context.log.error('[maintenance-yearly-reconcile] missing env vars; aborting');
    return;
  }
  log('start', DRY_RUN ? '(DRY RUN)' : '');

  let token;
  try { token = await getToken(); }
  catch (e) { context.log.error('[maintenance-yearly-reconcile] token failed:', e.message); return; }

  let spItems, sbRows;
  try {
    [spItems, sbRows] = await Promise.all([
      readSharePointItems(token),
      sbGet('maintenance_yearly?select=sp_item_id,title,last_done,scheduled_for&limit=999'),
    ]);
  } catch (e) { context.log.error('[maintenance-yearly-reconcile] fetch failed:', e.message); return; }

  // Guard: an empty SharePoint read is almost always an auth/permission blip,
  // not a genuinely empty register. Never act on it (a no-op anyway, but be
  // explicit so it can't ever drive inserts/updates off bad data).
  if (spItems.length === 0) { log('SharePoint returned 0 items — skipping this run'); return; }

  const { updates, inserts, conflicts } = computeReconciliation(spItems, sbRows);
  log(`sp=${spItems.length} sb=${sbRows.length} → updates=${updates.length} inserts=${inserts.length} conflicts=${conflicts.length}`);

  if (updates.length === 0 && inserts.length === 0 && conflicts.length === 0) { log('in sync — nothing to do'); return; }

  let applied = 0, failed = 0;
  if (!DRY_RUN) {
    for (const u of updates) {
      const patch = { sp_modified_at: new Date().toISOString() };
      for (const [field, v] of Object.entries(u.changes)) patch[field] = v.to;
      try {
        await sbPatch(`maintenance_yearly?sp_item_id=eq.${encodeURIComponent(u.sp_item_id)}`, patch);
        await sbInsert('maintenance_audit_log', { item_sp_item_id: u.sp_item_id, action: 'reconcile', detail: { changes: u.changes }, actor: 'system@repnet' })
          .catch((e) => log(`audit log for #${u.sp_item_id} failed: ${e.message}`));
        applied++;
      } catch (e) { failed++; context.log.error(`patch #${u.sp_item_id} failed: ${e.message}`); }
    }
    for (const i of inserts) {
      try {
        await sbInsert('maintenance_yearly', {
          sp_item_id: i.sp_item_id,
          site_id: 'repose',
          sp_modified_at: new Date().toISOString(),
          title: i.title || `(untitled #${i.sp_item_id})`,
          category: i.category || null,
          frequency: i.frequency || null,
          frequency_days: i.frequency_days != null ? i.frequency_days : null,
          last_done: normDate(i.last_done),
          scheduled_for: normDate(i.scheduled_for),
          doc_link: i.doc_link || null,
        });
        await sbInsert('maintenance_audit_log', { item_sp_item_id: i.sp_item_id, action: 'reconcile', detail: { inserted: true }, actor: 'system@repnet' })
          .catch((e) => log(`audit log for insert #${i.sp_item_id} failed: ${e.message}`));
        applied++;
      } catch (e) { failed++; context.log.error(`insert #${i.sp_item_id} failed: ${e.message}`); }
    }
  }

  // Email Jonas whenever there was drift (repairs made, or conflicts to review).
  try {
    await sendMail(token, [JONAS_EMAIL],
      `${DRY_RUN ? '[DRY RUN] ' : ''}RepNet · maintenance sync ${DRY_RUN ? 'found' : 'repaired'} ${updates.length + inserts.length} item(s)${conflicts.length ? ` · ${conflicts.length} conflict(s)` : ''}`,
      summaryEmail({ updates, inserts, conflicts, dryRun: DRY_RUN }));
    log('summary emailed to', JONAS_EMAIL);
  } catch (e) { context.log.error('[maintenance-yearly-reconcile] summary email failed:', e.message); }

  log(`done. applied=${applied} failed=${failed} dryRun=${DRY_RUN}`);
};
