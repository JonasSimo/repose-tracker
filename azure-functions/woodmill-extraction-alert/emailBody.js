// Pure email builder for the Woodmill Extraction Check fault alert. Kept free
// of Graph/Supabase so it is unit-testable with `node --test`.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// check = { operator_name, submitted_at, flag_count, results:[{ machine, checks:[{label,result,note}] }] }
function buildAlertEmail(check) {
  const when = new Date(check.submitted_at).toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const flags = [];
  for (const m of check.results || []) {
    for (const c of m.checks || []) {
      if (c.result === 'attention') flags.push({ machine: m.machine, label: c.label, note: c.note || '' });
    }
  }
  const n = check.flag_count == null ? flags.length : check.flag_count;
  const subject = `Woodmill extraction check — ${n} item${n === 1 ? '' : 's'} need attention`;

  const rows = flags.map((f) =>
    `<tr><td style="padding:6px 10px;border:1px solid #e1e6eb">${esc(f.machine)}</td>` +
    `<td style="padding:6px 10px;border:1px solid #e1e6eb">${esc(f.label)}</td>` +
    `<td style="padding:6px 10px;border:1px solid #e1e6eb">${esc(f.note)}</td></tr>`).join('');

  const html =
    `<div style="font-family:Arial,sans-serif;color:#0e023a">` +
    `<h2 style="margin:0 0 4px">Woodmill extraction check — action needed</h2>` +
    `<p style="margin:0 0 12px;color:#706f6f">By <b>${esc(check.operator_name)}</b> on ${esc(when)}</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><th style="padding:6px 10px;border:1px solid #e1e6eb;text-align:left">Machine</th>` +
    `<th style="padding:6px 10px;border:1px solid #e1e6eb;text-align:left">Item</th>` +
    `<th style="padding:6px 10px;border:1px solid #e1e6eb;text-align:left">Note</th></tr>${rows}</table>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#a8a8a8">Sent automatically by RepNet when an extraction check is flagged.</p></div>`;

  return { subject, html };
}

module.exports = { buildAlertEmail };
