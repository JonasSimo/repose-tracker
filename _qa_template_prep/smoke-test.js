// Mirrors the browser export logic with mock data, so we can verify the output deck
// without needing a UI click.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE = path.resolve(__dirname, '../qa-meeting-template.pptx');
const OUT = path.resolve(__dirname, 'smoke-output.pptx');

function pad2(n){ return String(n).padStart(2, '0'); }
function xmlEscape(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function isoWeekOf(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7), isoYear: d.getUTCFullYear() };
}
function getLastCompletedISOWeek(today){
  const t = new Date(today); t.setHours(0,0,0,0);
  const dow = t.getDay();
  const daysBack = dow === 0 ? 7 : dow;
  const sunday = new Date(t); sunday.setDate(t.getDate() - daysBack);
  const monday = new Date(sunday); monday.setDate(sunday.getDate() - 6);
  sunday.setHours(23,59,59,999);
  const { week, isoYear } = isoWeekOf(monday);
  return { monday, sunday, week, year: isoYear };
}

(async()=>{
  // Treat "today" as 2026-05-07 (Thursday wk 19) — same as the live RepNet date
  const today = new Date(2026, 4, 7);   // month is 0-indexed
  const win = getLastCompletedISOWeek(today);
  console.log(`Mock today: ${today.toDateString()}  →  data window: Wk.${win.week} (${win.monday.toDateString()} – ${win.sunday.toDateString()})`);

  // Mock data with realistic ticket shape
  const data = {
    complaints: [
      { ticketNo: 'TICKET1305', faultCode: 'FRAME', subFault: 'CRACK', description: 'Frame cracked on RHS arm reported within 14 days' },
      { ticketNo: 'TICKET1308', faultCode: 'FABRIC', subFault: 'PILLING', description: 'Fabric pilling on seat cushion within 3 weeks of delivery' },
    ],
    warranty: [
      { ticketNo: 'TICKET1297', faultCode: 'MECH', subFault: 'MOTOR FAIL', description: 'Motor stopped working after 4 months' },
    ],
  };

  const tplBuf = fs.readFileSync(TEMPLATE);
  const zip = await JSZip.loadAsync(tplBuf);

  const wcDay = pad2(win.monday.getDate());
  const wcMonth = pad2(win.monday.getMonth() + 1);
  const wcYear = String(win.monday.getFullYear());
  const mDay = pad2(today.getDate());
  const mMonth = pad2(today.getMonth() + 1);
  const mYear = String(today.getFullYear());

  function fmtRC(t){ const a=(t?.faultCode||'').toUpperCase(), b=(t?.subFault||'').toUpperCase();
    return a&&b?`${a} - ${b}`:(a||b||'—'); }
  function actionText(t){ return (t?.description||t?.action||'—').trim()||'—'; }

  const c0=data.complaints[0], c1=data.complaints[1], w0=data.warranty[0];
  const tokens = {
    WC_DAY1: wcDay[0], WC_DAY2: wcDay[1], WC_MONTH: wcMonth, WC_YEAR: wcYear,
    MEET_DAY: mDay, MEET_MONTH: mMonth, MEET_YEAR: mYear,
    WK_NUM: String(win.week), WK_NUM_PREV: String(win.week-1),
    S5R1_TKT: c0?c0.ticketNo:'—', S5R1_RC: fmtRC(c0), S5R1_ACTION: actionText(c0),
    S5R2_TKT: c1?c1.ticketNo:'—', S5R2_RC: fmtRC(c1), S5R2_ACTION: actionText(c1),
    S6R1_TKT: w0?w0.ticketNo:'—', S6R1_RC: fmtRC(w0), S6R1_ACTION: actionText(w0),
  };

  const slideFiles = Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));
  let totalReplaced = 0;
  for (const sf of slideFiles){
    let xml = await zip.file(sf).async('string');
    let perSlide = 0;
    for (const [k,v] of Object.entries(tokens)){
      const before = xml;
      xml = xml.split(`{{${k}}}`).join(xmlEscape(String(v)));
      if (xml !== before) perSlide += (before.match(new RegExp(`\\{\\{${k}\\}\\}`, 'g'))||[]).length;
    }
    if (perSlide) console.log(`${sf}: ${perSlide} tokens replaced`);
    totalReplaced += perSlide;
    zip.file(sf, xml);

    // Sanity check: any leftover {{TOKEN}} ?
    const leftover = (xml.match(/\{\{[A-Z0-9_]+\}\}/g)||[]);
    if (leftover.length) console.warn(`  LEFTOVER in ${sf}: ${JSON.stringify([...new Set(leftover)])}`);
  }
  console.log(`Total: ${totalReplaced} token instances replaced`);

  const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{level:6} });
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT}  (${buf.length} bytes)`);
})();
