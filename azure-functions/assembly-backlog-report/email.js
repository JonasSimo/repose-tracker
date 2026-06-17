'use strict';

// HTML email body for the Assembly backlog. Mirrors the visual language of
// morning-team-digest/index.js (navy header, RepNet logo, light table).

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildSummaryHtml({ rows, dateStr, repnetUrl, logoDataUrl }) {
  const navy = '#1e3a5f', light = '#f0f4f8', border = '#e2e8f0';
  const url = String(repnetUrl || '').replace(/\/?$/, '/');
  const statsUrl = url + 'stats/team/assembly';
  const logo = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="RepNet" style="height:24px;width:auto;display:block;margin-bottom:8px">`
    : `<div style="font-size:14px;font-weight:900;color:#14a1e9;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`;

  const header = `<div style="background:${navy};padding:22px 28px">
      ${logo}
      <div style="color:#fff;font-size:20px;font-weight:700">Assembly Backlog</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">${escHtml(dateStr)}</div>
    </div>`;
  const footer = `<div style="background:${light};padding:12px 28px;font-size:11px;color:#9ca3af;border-top:1px solid ${border}">
      Repose Furniture · QMS — automated at 07:00 each working day · Do not reply.
    </div>`;

  let inner;
  if (!rows.length) {
    inner = `<div style="padding:28px;text-align:center;color:#059669;font-size:15px;font-weight:600">
        ✓ No overdue Assembly chairs this morning.
      </div>`;
  } else {
    const oldest = rows.reduce((m, r) => Math.max(m, r.daysLate), 0);
    const preview = rows.slice(0, 20).map((r) => `<tr style="border-bottom:1px solid ${border}">
        <td style="padding:6px;font-family:monospace;white-space:nowrap">${escHtml(r.rep)}</td>
        <td style="padding:6px;white-space:nowrap">${escHtml(r.week)}</td>
        <td style="padding:6px;white-space:nowrap">${escHtml(r.prepLbl)}</td>
        <td style="padding:6px;text-align:right">${escHtml(r.itemNo)}</td>
        <td style="padding:6px;text-align:right;white-space:nowrap">${escHtml(String(r.daysLate))}</td>
        <td style="padding:6px;white-space:nowrap">${r.express ? 'Yes' : ''}</td>
      </tr>`).join('');
    const more = rows.length > 20 ? `<p style="margin:10px 0 0;font-size:12px;color:#6b7280">+${rows.length - 20} more in the attached CSV.</p>` : '';
    inner = `<div style="padding:20px 28px">
        <p style="margin:0 0 14px;font-size:14px;color:#374151">
          <strong>${rows.length} overdue Assembly chair${rows.length === 1 ? '' : 's'}</strong> awaiting completion or QC sign-off this morning.
          Oldest is <strong>${oldest}</strong> working day${oldest === 1 ? '' : 's'} late. Full list attached as CSV.
        </p>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${border};border-radius:6px;overflow:hidden;font-size:12px">
          <thead><tr style="background:${light}">
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">REP</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Week</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Prep</th>
            <th style="padding:7px;text-align:right;font-size:10px;text-transform:uppercase;color:#6b7280">Item</th>
            <th style="padding:7px;text-align:right;font-size:10px;text-transform:uppercase;color:#6b7280">Days Late</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Express</th>
          </tr></thead>
          <tbody>${preview}</tbody>
        </table>
        ${more}
        <p style="margin:16px 0 0">
          <a href="${escHtml(statsUrl)}" style="display:inline-block;padding:9px 18px;background:${navy};color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet · Assembly Stats →</a>
        </p>
      </div>`;
  }

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${light};font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:680px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      ${header}${inner}${footer}
    </div></body></html>`;
}

module.exports = { escHtml, buildSummaryHtml };
