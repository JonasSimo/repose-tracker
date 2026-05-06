'use strict';
/**
 * Shared email-building logic for NMS reminders.
 * Used by both `nms-reminders` (timer) and `nms-reminders-test` (HTTP).
 * Keep all visual / copy changes in this one place.
 */
const fs   = require('fs');
const path = require('path');

let LOGO_DATAURL = '';
try {
  const buf = fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png'));
  LOGO_DATAURL = 'data:image/png;base64,' + buf.toString('base64');
} catch (e) { /* fall back to text wordmark */ }

const REPNET_URL = process.env.REPNET_URL || 'https://brave-island-06ef03810.1.azurestaticapps.net/';
const OVERDUE_LIMIT_DAYS = 28;

const BANDS = [
  { day:  7, kind: 'week1',    tone: 'gentle',   accent: '#14a1e9', tag: '1 week reminder',                  subject: 'Near miss reminder — open 1 week' },
  { day: 14, kind: 'week2',    tone: 'firmer',   accent: '#d97706', tag: '2 week reminder',                  subject: 'Near miss still open — 2 weeks' },
  { day: 21, kind: 'week3',    tone: 'urgent',   accent: '#ea580c', tag: '3 week reminder',                  subject: 'Near miss still open — 3 weeks · approaching limit' },
  { day: 26, kind: 'critical', tone: 'critical', accent: '#dc2626', tag: 'Critical · 2 days to overdue',     subject: '⚠ CRITICAL — Near miss will be overdue in 2 days' },
];

function escHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function buildReminder(item, days, band) {
  const f = item.fields || {};
  const ref      = f.ReferenceNumber || f.Title || ('NMS-' + (item.id ? String(item.id).slice(0,6) : 'mock'));
  const raisedOn = item.createdDateTime ? item.createdDateTime.slice(0,10) : '';
  const daysLeft = OVERDUE_LIMIT_DAYS - days;
  const isCritical = band.kind === 'critical';

  const callToAction = isCritical
    ? `<p style="margin:0 0 8px;font-size:14px;color:#7f1d1d;font-weight:700">⚠ This near miss will be marked overdue in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> if it isn't closed out.</p>`
    : `<p style="margin:0 0 8px;font-size:13px;color:#374151">It's been ${days} days since this near miss was raised — the 28-day close-out limit is in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.</p>`;

  const tone = {
    gentle:   'Just a friendly nudge — nothing urgent yet, but please put eyes on it this week.',
    firmer:   'Two weeks is half the close-out limit. Please prioritise closing this out, or escalate if you need help.',
    urgent:   "Three weeks open — only 7 days left to close. If there's a blocker, flag it to QHSE today.",
    critical: "This must be closed out within the next 2 working days or it will breach the 28-day SLA. If you can't complete the action, escalate to QHSE immediately so we can re-route.",
  }[band.tone] || '';

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      <div style="background:${band.accent};padding:18px 24px;color:#fff">
        ${LOGO_DATAURL ? `<img src="${LOGO_DATAURL}" alt="RepNet" style="height:22px;width:auto;display:block;margin-bottom:8px">` : `<div style="font-size:14px;font-weight:900;color:#fff;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`}
        <div style="font-size:18px;font-weight:700">${escHtml(band.tag)}</div>
        <div style="opacity:.85;font-size:12px;margin-top:4px">Near Miss · ${escHtml(ref)} · open ${days} day${days === 1 ? '' : 's'}</div>
      </div>
      <div style="padding:22px 24px">
        ${callToAction}
        <p style="margin:0 0 14px;font-size:13px;color:#374151;line-height:1.5">${escHtml(tone)}</p>

        <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px">
          <tr><td style="padding:7px 0;color:#6b7280;width:130px;vertical-align:top">Reference</td><td style="padding:7px 0;font-family:'Courier New',monospace;font-weight:700;color:#111">${escHtml(ref)}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Raised on</td><td style="padding:7px 0;color:#111">${escHtml(raisedOn)} · ${days} days ago</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Location</td><td style="padding:7px 0;color:#111;font-weight:600">${escHtml(f.Locationofissue || '—')}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Raised by</td><td style="padding:7px 0;color:#111">${escHtml(f.RaisedBy_x003a_ || '—')}</td></tr>
          <tr><td style="padding:7px 0;color:#6b7280;vertical-align:top;border-bottom:1px solid #e2e8f0">Issue</td><td style="padding:7px 0;color:#111;border-bottom:1px solid #e2e8f0">${escHtml(f.Whatistheissue_x003f_ || '—')}</td></tr>
          ${f.NearMissCategory   ? `<tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Category</td><td style="padding:7px 0;color:#111">${escHtml(f.NearMissCategory)} · ${escHtml(f.ObservationCategory || '—')}</td></tr>` : ''}
          ${f.StepsTakenToKeepSafe ? `<tr><td style="padding:7px 0;color:#6b7280;vertical-align:top">Steps already taken</td><td style="padding:7px 0;color:#111">${escHtml(f.StepsTakenToKeepSafe)}</td></tr>` : ''}
        </table>

        <div style="margin-top:18px;padding:14px;background:#f0f4f8;border-left:4px solid ${band.accent};border-radius:4px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#374151">How to close out:</p>
          <ol style="font-size:12px;color:#374151;line-height:1.5;padding-left:18px;margin:0">
            <li>Open RepNet → <strong>Safety</strong> tab</li>
            <li>Find <strong>${escHtml(ref)}</strong> in the open list</li>
            <li>Click <em>→ Close out</em> on the card</li>
            <li>Describe the actions taken to resolve and click <em>Mark Closed</em></li>
          </ol>
          <p style="margin:14px 0 0">
            <a href="${escHtml(REPNET_URL)}" style="display:inline-block;padding:10px 20px;background:${band.accent};color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:700">Open RepNet · Safety tab →</a>
          </p>
        </div>

        <p style="margin:18px 0 0;font-size:12px;color:#6b7280">If this near miss is no longer relevant or has been resolved another way, please still close it in RepNet so the record is up to date.</p>
      </div>
      <div style="background:#f0f4f8;padding:12px 24px;font-size:11px;color:#9ca3af;border-top:1px solid #e2e8f0">
        Repose Furniture · QHSE — automated near-miss reminder · daily 07:00 · do not reply.
      </div>
    </div>
  </body></html>`;
}

module.exports = { BANDS, buildReminder, OVERDUE_LIMIT_DAYS, REPNET_URL };
