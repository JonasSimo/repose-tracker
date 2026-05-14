// Mirrors the browser export logic with mock data so we can verify the
// output deck without a UI click. Mocks include S7 internal CPARs, S10
// CoPQ disposition counts and a deliberate overflow on S5 to exercise the
// row-cloning path.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE = path.resolve(__dirname, '../qa-meeting-template.pptx');
const CONFIG   = path.resolve(__dirname, '../qa-deck-config.json');
const OUT      = path.resolve(__dirname, 'smoke-output.pptx');

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
function fmtRC(t){
  const a=(t?.faultCode||'').toUpperCase(), b=(t?.subFault||'').toUpperCase();
  return a&&b ? `${a} - ${b}` : (a||b||'—');
}
function monthWindow(d){
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1),
    end:   new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999),
  };
}
function inRange(d, start, end){ return d && d >= start && d <= end; }
function countByDispo(items, start, end, dispo){
  const target = String(dispo).toLowerCase();
  return items.filter(c => inRange(c.loggedAt, start, end)
    && String(c.fields?.Disposition||'').toLowerCase() === target).length;
}

// Row-cloning + token-helper mirror of the browser code.
function expandActionsTable(slideXml, prefix, capacity, itemCount){
  if (itemCount <= capacity) return slideXml;
  const rowRe = new RegExp(
    `<a:tr\\b[^>]*>(?:(?!<\\/a:tr>)[\\s\\S])*?\\{\\{${prefix}R1_TKT\\}\\}(?:(?!<\\/a:tr>)[\\s\\S])*?<\\/a:tr>`
  );
  const m = slideXml.match(rowRe);
  if (!m) return slideXml;
  const tpl = m[0];
  const newRows = [];
  for (let i = capacity + 1; i <= itemCount; i++){
    newRows.push(
      tpl.split(`{{${prefix}R1_TKT}}`).join(`{{${prefix}R${i}_TKT}}`)
         .split(`{{${prefix}R1_RC}}`).join(`{{${prefix}R${i}_RC}}`)
         .split(`{{${prefix}R1_ACTION}}`).join(`{{${prefix}R${i}_ACTION}}`)
    );
  }
  const lastRowRe = new RegExp(
    `(<a:tr\\b[^>]*>(?:(?!<\\/a:tr>)[\\s\\S])*?\\{\\{${prefix}R${capacity}_TKT\\}\\}(?:(?!<\\/a:tr>)[\\s\\S])*?<\\/a:tr>)`
  );
  return slideXml.replace(lastRowRe, `$1${newRows.join('')}`);
}
function addActionRowTokens(tokens, prefix, capacity, items){
  const n = Math.max(items.length, capacity);
  for (let i = 0; i < n; i++){
    const t = items[i];
    tokens[`${prefix}R${i+1}_TKT`]    = t ? (t.ticketNo || '—') : '—';
    tokens[`${prefix}R${i+1}_RC`]     = t ? fmtRC(t) : '—';
    tokens[`${prefix}R${i+1}_ACTION`] = '';
  }
}
function addCparRowTokens(tokens, prefix, capacity, cpars){
  const n = Math.max(cpars.length, capacity);
  for (let i = 0; i < n; i++){
    const c = cpars[i]; const f = c?.fields || null;
    tokens[`${prefix}R${i+1}_TKT`]    = f ? (f.Title || '—') : '—';
    tokens[`${prefix}R${i+1}_RC`]     = f ? String(f.IssueCategory || f.Description || '—').slice(0, 80) : '—';
    tokens[`${prefix}R${i+1}_ACTION`] = '';
  }
}

(async()=>{
  // Treat "today" as 2026-05-14 (Thursday wk 20). The data week is then wk 19.
  const today = new Date(2026, 4, 14);
  const win = getLastCompletedISOWeek(today);
  const prevMonday = new Date(win.monday); prevMonday.setDate(prevMonday.getDate()-7);
  const prevSunday = new Date(win.sunday); prevSunday.setDate(prevSunday.getDate()-7);
  console.log(`Mock today: ${today.toDateString()}  →  data window: Wk.${win.week} (${win.monday.toDateString()} – ${win.sunday.toDateString()})`);

  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf-8'));

  // Mock data — 3 complaints (overflow), 1 warranty, 3 internal CPARs (overflow),
  // mixed dispositions for S10 CoPQ totals.
  const data = {
    complaints: [
      { ticketNo: 'TICKET1305', faultCode: 'FRAME',  subFault: 'CRACK',      openDate: new Date(win.sunday.getTime() - 1*86400000) },
      { ticketNo: 'TICKET1308', faultCode: 'FABRIC', subFault: 'PILLING',    openDate: new Date(win.sunday.getTime() - 3*86400000) },
      { ticketNo: 'TICKET1311', faultCode: 'CASTOR', subFault: 'BROKEN',     openDate: new Date(win.monday.getTime() + 1*86400000) },
    ],
    warranty: [
      { ticketNo: 'TICKET1297', faultCode: 'MECH',   subFault: 'MOTOR FAIL', openDate: new Date(win.sunday.getTime() - 2*86400000) },
    ],
    internalCpars: [
      { fields: { Title: 'RP-00521', IssueCategory: 'Wrong mech', Disposition: 'Scrapped',  Description: 'Wrong mech installed' } },
      { fields: { Title: 'RP-00522', IssueCategory: 'Damaged in assembly', Disposition: 'Reworked', Description: 'Frame scratched by stapler' } },
      { fields: { Title: 'RP-00523', IssueCategory: 'Fabric defect', Disposition: 'Use-as-is', Description: 'Minor fabric pull, customer accepted' } },
    ],
  };
  // CoPQ source: ALL CPARs in the data week + same calendar month + prev week.
  const allCpars = [
    // Data-week dispositions (1 scrap, 1 rework, 1 concession)
    { loggedAt: new Date(win.monday.getTime() + 1*86400000), fields: { Disposition: 'Scrapped'   } },
    { loggedAt: new Date(win.monday.getTime() + 2*86400000), fields: { Disposition: 'Reworked'   } },
    { loggedAt: new Date(win.monday.getTime() + 3*86400000), fields: { Disposition: 'Use-as-is'  } },
    // Earlier this month — adds to monthly counts only
    { loggedAt: new Date(win.monday.getFullYear(), win.monday.getMonth(), 2), fields: { Disposition: 'Scrapped' } },
    { loggedAt: new Date(win.monday.getFullYear(), win.monday.getMonth(), 4), fields: { Disposition: 'Scrapped' } },
    // Previous ISO week — drives S12 banner only
    { loggedAt: new Date(prevMonday.getTime() + 2*86400000), fields: { Disposition: 'Scrapped' } },
    { loggedAt: new Date(prevMonday.getTime() + 4*86400000), fields: { Disposition: 'Scrapped' } },
  ];

  const tplBuf = fs.readFileSync(TEMPLATE);
  const zip = await JSZip.loadAsync(tplBuf);

  const wcDay = pad2(win.monday.getDate());
  const wcMonth = pad2(win.monday.getMonth() + 1);
  const wcYear = String(win.monday.getFullYear());
  const mDay = pad2(today.getDate());
  const mMonth = pad2(today.getMonth() + 1);
  const mYear = String(today.getFullYear());
  const mWin = monthWindow(win.monday);
  const moEnd = win.sunday < mWin.end ? win.sunday : mWin.end;
  const fmtGbp = n => (n||0).toLocaleString('en-GB');

  const scrapWk  = countByDispo(allCpars, win.monday, win.sunday, 'Scrapped');
  const reworkWk = countByDispo(allCpars, win.monday, win.sunday, 'Reworked');
  const concWk   = countByDispo(allCpars, win.monday, win.sunday, 'Use-as-is');
  const scrapMo  = countByDispo(allCpars, mWin.start, moEnd, 'Scrapped');
  const reworkMo = countByDispo(allCpars, mWin.start, moEnd, 'Reworked');
  const concMo   = countByDispo(allCpars, mWin.start, moEnd, 'Use-as-is');
  const s12Count = countByDispo(allCpars, prevMonday, prevSunday, 'Scrapped');

  const tokens = {
    WC_DAY1: wcDay[0], WC_DAY2: wcDay[1], WC_MONTH: wcMonth, WC_YEAR: wcYear,
    MEET_DAY: mDay, MEET_MONTH: mMonth, MEET_YEAR: mYear,
    WK_NUM: String(win.week), WK_NUM_PREV: String(win.week-1),
    S10_SCRAP_WK_GBP:  fmtGbp(scrapWk  * cfg.scrap.ratePerInstance),
    S10_SCRAP_MO_GBP:  fmtGbp(scrapMo  * cfg.scrap.ratePerInstance),
    S10_REWORK_WK_GBP: fmtGbp(reworkWk * cfg.rework.ratePerInstance),
    S10_REWORK_MO_GBP: fmtGbp(reworkMo * cfg.rework.ratePerInstance),
    S10_CONC_WK_GBP:   fmtGbp(concWk   * cfg.concession.ratePerInstance),
    S10_CONC_MO_GBP:   fmtGbp(concMo   * cfg.concession.ratePerInstance),
    S12_SCRAP_COUNT:   String(s12Count),
  };
  addActionRowTokens(tokens, 'S5', 2, data.complaints);
  addActionRowTokens(tokens, 'S6', 1, data.warranty);
  // S7 actions table stays entirely blank — user fills manually during the meeting.
  tokens.S7R1_TKT = ''; tokens.S7R1_RC = ''; tokens.S7R1_ACTION = ''; tokens.S7R1_OWNER = '';
  tokens.S7R2_TKT = ''; tokens.S7R2_RC = ''; tokens.S7R2_ACTION = ''; tokens.S7R2_OWNER = '';

  const expansions = [
    { slide: 'ppt/slides/slide5.xml', prefix: 'S5', cap: 2, n: data.complaints.length },
    { slide: 'ppt/slides/slide6.xml', prefix: 'S6', cap: 1, n: data.warranty.length },
  ];
  for (const e of expansions) {
    const f = zip.file(e.slide); if (!f) continue;
    const xml = await f.async('string');
    zip.file(e.slide, expandActionsTable(xml, e.prefix, e.cap, e.n));
  }

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

    const leftover = (xml.match(/\{\{[A-Z0-9_]+\}\}/g)||[]);
    if (leftover.length) console.warn(`  LEFTOVER in ${sf}: ${JSON.stringify([...new Set(leftover)])}`);
  }
  console.log(`Total: ${totalReplaced} token instances replaced`);
  console.log(`CoPQ wk:  scrap=${scrapWk} rework=${reworkWk} conc=${concWk}`);
  console.log(`CoPQ mo:  scrap=${scrapMo} rework=${reworkMo} conc=${concMo}`);
  console.log(`S12 prev-week scrap count: ${s12Count}`);

  const buf = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE', compressionOptions:{level:6} });
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT}  (${buf.length} bytes)`);
})();
