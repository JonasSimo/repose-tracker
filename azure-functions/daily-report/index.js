'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

// ─── Config ────────────────────────────────────────────────────────────────
const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;
const RECIPIENTS    = (process.env.RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);

const SP_HOST           = 'reposefurniturelimited.sharepoint.com';
const SP_SITE_PATH      = '/sites/ReposeFurniture-PlanningRepose';
const NMS_SITE_PATH     = '/sites/ReposeFurniture-HealthandSafety';
const NMS_LIST_ID       = '8481E1E4-8C93-4CCD-A38A-9736011EFEAB';
const WM_QUALITY_SITE   = '/sites/ReposeFurniture-Quality';
const WM_LIST_ID        = '6edbe08b-b3a2-4693-afb2-e11531bcda7a';
const CC_SITE_PATH      = '/sites/ReposeFurniture-Quality';
const CC_LIST_NAME      = 'CuttingChecks';
const SP_LIST_NAME      = 'ProductionCompletions';
const SP_SPEC_LIST      = 'SpecAlerts';
const SP_CPAR_LIST      = 'CPARLog';
const PROD_SHARING_URL  = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBLf67iYnbQSq2O8UU_zQihARfBedzZcW-CmO0q3v5zC3o?e=nfze02';
const QC_SHARING_URL    = 'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Quality/IQBkNajahlhzTZcypUVLsTM7AW-gHMSu-C2cd2MMLj5npe0?e=8BfsBL';
const QC_SHEET_NAME     = 'Data';

const TEAMS_CFG = [
  { name:'Woodmill',   icon:'🪵', hasSubs:true,  subs:['Arms','Backs','Seats'] },
  { name:'Foam',       icon:'🧽', hasSubs:false },
  { name:'Cutting',    icon:'✂️', hasSubs:false },
  { name:'Sewing',     icon:'🧵', hasSubs:false },
  { name:'Upholstery', icon:'🪑', hasSubs:true,  subs:['Arms','Backs','Seats'] },
  { name:'Assembly',   icon:'🔩', hasSubs:false },
  { name:'Stores',     icon:'📦', hasSubs:false },
  { name:'QC',         icon:'✅', hasSubs:false },
];
const PROD_TEAMS = TEAMS_CFG.filter(t => t.name !== 'QC');

const WM_MACHINES = [
  { id:'bandsaw',        name:'Bandsaw'        },
  { id:'panel-saw-1',    name:'Panel Saw 1'    },
  { id:'panel-saw-2',    name:'Panel Saw 2'    },
  { id:'crosscut-saw-1', name:'Crosscut Saw 1' },
  { id:'crosscut-saw-2', name:'Crosscut Saw 2' },
  { id:'moulder',        name:'Moulder'        },
  { id:'spindle',        name:'Spindle Moulder'},
  { id:'planer',         name:'Planer Thicknesser'},
  { id:'sander',         name:'Wide Belt Sander'},
  { id:'pillar-drill',   name:'Pillar Drill'   },
];
const CC_MACHINES = [
  { id:'lectra',       name:'Lectra Vector' },
  { id:'pathfinder1',  name:'Pathfinder 1'  },
  { id:'pathfinder2',  name:'Pathfinder 2'  },
];

const TEAM_NAME_MAP = {
  'woodmill':'Woodmill','wood mill':'Woodmill',
  'cutting':'Cutting','cutting room':'Cutting',
  'sewing':'Sewing','sewing room':'Sewing',
  'upholstery':'Upholstery',
  'assembly':'Assembly','assembly room':'Assembly',
  'foam':'Foam','stores':'Stores',
  'qc':'QC','quality control':'QC',
  'development':'Development','admin':'Admin',
};
function normaliseTeam(raw) {
  return TEAM_NAME_MAP[(raw||'').toLowerCase().trim()] || (raw||'').trim();
}

// ─── MS Graph client ───────────────────────────────────────────────────────
let _msalApp = null;
let _token   = null;
let _tokenExpiry = 0;

function getMsalApp() {
  if (!_msalApp) {
    _msalApp = new ConfidentialClientApplication({
      auth: { clientId: CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT_ID}`, clientSecret: CLIENT_SECRET },
    });
  }
  return _msalApp;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;
  const result = await getMsalApp().acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'] });
  _token = result.accessToken;
  _tokenExpiry = result.expiresOn?.getTime() || (Date.now() + 3600000);
  return _token;
}

async function graphGet(url) {
  const token = await getToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Graph ${r.status} ${url}: ${await r.text()}`);
  return r.json();
}

async function graphPost(url, body) {
  const token = await getToken();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Graph POST ${r.status}: ${await r.text()}`);
  return r.status === 202 || r.status === 204 ? {} : r.json();
}

async function graphGetAll(url) {
  let items = [], nextUrl = url, guard = 0;
  while (nextUrl && guard++ < 200) {
    const page = await graphGet(nextUrl);
    items = items.concat(page.value || []);
    nextUrl = page['@odata.nextLink'] || null;
  }
  return items;
}

function encodeSharingUrl(link) {
  return 'u!' + Buffer.from(link).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}

// ─── Date helpers ──────────────────────────────────────────────────────────
function isoWeekNumber(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
}
function isoWeekYear(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  return tmp.getUTCFullYear();
}
function isoWeekMonday(wn, refYear) {
  function weekStart(y) {
    const jan4 = new Date(y, 0, 4);
    const dow  = jan4.getDay() || 7;
    const mon  = new Date(jan4); mon.setDate(jan4.getDate() - (dow - 1));
    const r = new Date(mon); r.setDate(mon.getDate() + (wn - 1) * 7);
    return r;
  }
  const now = new Date();
  const yr = refYear || now.getFullYear();
  const cands = [weekStart(yr-1), weekStart(yr), weekStart(yr+1)];
  return cands.reduce((best, d) => Math.abs(d - now) < Math.abs(best - now) ? d : best);
}
function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function wmDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseDdmmyyyy(str) {
  if (!str) return null;
  const parts = String(str).split(' ')[0].split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}
function parseCPARDate(str) {
  if (!str) return new Date(0);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) { const [y,m,d] = str.split('-').map(Number); return new Date(y, m-1, d); }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) { const d = new Date(str); return isNaN(d) ? new Date(0) : d; }
  const [datePart, timePart='00:00'] = str.split(' ');
  const [d,m,y] = datePart.split('/');
  if (!y) return new Date(0);
  return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${timePart}:00`);
}
function sameWeek(d, ref) {
  return isoWeekNumber(d) === isoWeekNumber(ref) && isoWeekYear(d) === isoWeekYear(ref);
}
function getCPARStatus(item) {
  const f = item.fields||{};
  if (f.Status === 'Closed') return 'closed';
  const dt = parseCPARDate(f.LoggedAt);
  if (!dt.getTime()) return 'open';
  const hrs = (Date.now() - dt.getTime()) / 3600000;
  if (hrs >= 48) return 'red';
  if (hrs >= 24) return 'amber';
  return 'open';
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const SPEC_NOISE = /DELIVERED|ORDERED|STOCK/i;
function specAlertIsNoise(a) {
  const f = a.fields||a;
  return SPEC_NOISE.test(f.OldValue||'') || SPEC_NOISE.test(f.NewValue||'');
}

// ─── Production plan parsing (mirrors index.html parseSheetValues + distributeIntoPreps) ──
function parseSheetValues(values) {
  if (!values || !values.length) return [];
  let startRow = 4;
  for (let i = 0; i < Math.min(8, values.length); i++) {
    if (String(values[i]?.[10]||'').toLowerCase().includes('item')) { startRow = i+1; break; }
  }
  const jobs = [];
  for (let i = startRow; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length < 12) continue;
    const kRaw = String(row[10]||'').trim();
    const isExpressCode = /^(EXP|M-FT)\d*$/i.test(kRaw);
    const lCell = String(row[11]||'');
    const isServCode = /^SERV/i.test(kRaw) || /\bserv\b/i.test(lCell);
    const itemNo = (isExpressCode || isServCode) ? kRaw : Number(kRaw);
    if (!kRaw || (!isExpressCode && !isServCode && (!Number.isFinite(itemNo) || itemNo <= 0))) continue;
    const m = lCell.match(/REP\s*(\d{7})/);
    if (!m) continue;
    const biRaw = String(row[60]||'').trim().toUpperCase();
    let prep;
    if (/^(EXP|M-FT|MFT)/.test(biRaw)) prep = 'express';
    else {
      const prepVal = parseInt(biRaw.replace(/^PREP\s*/,''), 10);
      prep = (prepVal >= 1 && prepVal <= 5) ? prepVal : null;
    }
    jobs.push({ itemNo, rep: `REP ${m[1]}`, prep, isService: isServCode });
  }
  return jobs;
}
function distributeIntoPreps(jobs) {
  const preps = {1:[],2:[],3:[],4:[],5:[],express:[]};
  const jo = j => ({ itemNo: j.itemNo, rep: j.rep, isService: j.isService||false });
  jobs.filter(j => j.prep === 'express').forEach(j => preps.express.push(jo(j)));
  const normal = jobs.filter(j => j.prep !== 'express');
  const hasNumeric = normal.some(j => typeof j.prep === 'number');
  if (hasNumeric) {
    normal.forEach(j => { if (j.prep !== null) preps[j.prep].push(jo(j)); });
  } else {
    const n = normal.length;
    normal.forEach((j, i) => { const p = Math.min(5, Math.floor(i*5/n)+1); preps[p].push(jo(j)); });
  }
  return preps;
}

// ─── SharePoint site ID helpers ────────────────────────────────────────────
const _siteIdCache = {};
async function getSiteId(sitePath) {
  if (_siteIdCache[sitePath]) return _siteIdCache[sitePath];
  const res = await graphGet(`https://graph.microsoft.com/v1.0/sites/${SP_HOST}:${sitePath}`);
  _siteIdCache[sitePath] = res.id;
  return res.id;
}
async function getListIdByName(siteId, name) {
  const lists = await graphGet(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists?$filter=displayName eq '${encodeURIComponent(name)}'&$select=id,displayName`);
  const found = (lists.value||[]).find(l => l.displayName === name);
  if (!found) throw new Error(`List not found: ${name}`);
  return found.id;
}

// ─── Main data fetch ───────────────────────────────────────────────────────
async function fetchAllData(context) {
  const log = msg => context.log(msg);
  const warn = msg => context.log.warn(msg);

  // 1. Production plan
  log('Loading production plan…');
  const PROD = {}, WEEKS = [];
  try {
    const encoded   = encodeSharingUrl(PROD_SHARING_URL);
    const driveItem = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
    const driveId   = driveItem.parentReference.driveId;
    const itemId    = driveItem.id;
    const now = isoWeekNumber(new Date());
    for (const wn of [now-2, now-1, now, now+1]) {
      const sheetName = `WK ${wn}`;
      const monday    = isoWeekMonday(wn);
      try {
        const range = await graphGet(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange`
        );
        const jobs = parseSheetValues(range.values||[]);
        PROD[sheetName] = { wc: ddmmyyyy(monday), ...distributeIntoPreps(jobs) };
      } catch(e) {
        warn(`Sheet ${sheetName} unavailable: ${e.message}`);
        PROD[sheetName] = { wc: ddmmyyyy(monday), 1:[],2:[],3:[],4:[],5:[],express:[] };
      }
      WEEKS.push(sheetName);
    }
  } catch(e) { warn(`Production plan failed: ${e.message}`); }

  // 2. Production completions (for STATE + STATS_COMPLETIONS)
  log('Loading completions…');
  const STATE = {};
  let STATS_COMPLETIONS = [];
  try {
    const siteId = await getSiteId(SP_SITE_PATH);
    const listId = await getListIdByName(siteId, SP_LIST_NAME);
    const weekFilter = WEEKS.map(wk => `fields/Week eq '${wk}'`).join(' or ');
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$filter=${encodeURIComponent(weekFilter)}`;
    const allItems = await graphGetAll(url);

    STATS_COMPLETIONS = allItems.filter(i => i.fields?.IsComplete === true);

    // Build STATE
    TEAMS_CFG.forEach(t => {
      STATE[t.name] = {};
      const keys = t.hasSubs ? t.subs : ['all'];
      keys.forEach(k => {
        STATE[t.name][k] = {};
        WEEKS.forEach(wk => {
          STATE[t.name][k][wk] = {};
          [1,2,3,4,5,'express'].forEach(p => {
            const jobs = PROD[wk]?.[p] || [];
            STATE[t.name][k][wk][p] = jobs.map(() => ({ done:false }));
          });
        });
      });
    });

    allItems.forEach(item => {
      const f = item.fields;
      if (!f.Team || !f.Week || !f.IsComplete) return;
      const sub  = f.SubTeam || 'all';
      const wk   = f.Week;
      const prep = f.Prep === 'express' ? 'express' : Number(f.Prep);
      const rep  = f.REP;
      if (!wk || !prep || !rep) return;
      const jobs = PROD[wk]?.[prep] || [];
      const ji   = jobs.findIndex(j => j.rep === rep);
      if (ji < 0) return;
      const s = STATE[f.Team]?.[sub]?.[wk]?.[prep]?.[ji];
      if (s) s.done = true;
    });
  } catch(e) { warn(`Completions failed: ${e.message}`); }

  // 3. Spec alerts
  log('Loading spec alerts…');
  let STATS_ALERTS = [];
  try {
    const siteId = await getSiteId(SP_SITE_PATH);
    const listId = await getListIdByName(siteId, SP_SPEC_LIST);
    STATS_ALERTS = await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`);
  } catch(e) { warn(`Spec alerts failed: ${e.message}`); }

  // 4. CPARs
  log('Loading CPARs…');
  let CPAR_ITEMS = [];
  try {
    const siteId = await getSiteId(SP_SITE_PATH);
    const listId = await getListIdByName(siteId, SP_CPAR_LIST);
    CPAR_ITEMS = await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999&$orderby=createdDateTime desc`);
  } catch(e) { warn(`CPARs failed: ${e.message}`); }

  // 5. Near misses
  log('Loading near misses…');
  let NMS_ITEMS = [];
  try {
    const siteId = await getSiteId(NMS_SITE_PATH);
    NMS_ITEMS = await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${NMS_LIST_ID}/items?$expand=fields&$top=999&$orderby=createdDateTime desc`);
  } catch(e) { warn(`Near misses failed: ${e.message}`); }

  // 6. QC sheet
  log('Loading QC sheet…');
  let STATS_QC = [];
  try {
    const encoded   = encodeSharingUrl(QC_SHARING_URL);
    const driveItem = await graphGet(`https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`);
    const driveId   = driveItem.parentReference.driveId;
    const itemId    = driveItem.id;
    const dims = await graphGet(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(QC_SHEET_NAME)}')/usedRange?$select=rowCount`
    );
    const lastRow = dims.rowCount||1;
    const CHUNK = 5000;
    const ranges = [];
    for (let r=1; r<=lastRow; r+=CHUNK) ranges.push([r, Math.min(r+CHUNK-1, lastRow)]);
    const chunks = await Promise.all(ranges.map(([r,end]) =>
      graphGet(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(QC_SHEET_NAME)}')/range(address='A${r}:D${end}')?$select=values`)
    ));
    const seen = new Set();
    chunks.forEach(chunk => {
      (chunk.values||[]).forEach(row => {
        const repCell = String(row[0]??'').trim();
        const tsCell  = String(row[1]??'').trim();
        const m = repCell.match(/(?<!\d)(\d{7})(?!\d)/);
        if (!m) return;
        const d = tsCell ? new Date(tsCell) : null;
        const date = d && !isNaN(d) ? d : null;
        const dateKey = date ? date.toISOString().slice(0,16) : 'nodate';
        const uniqKey = `${m[1]}__${dateKey}`;
        if (seen.has(uniqKey)) return;
        seen.add(uniqKey);
        const rawType = String(row[3]??'').trim().toLowerCase();
        const type = rawType.includes('service') ? 'Service Chair' : rawType.includes('access') ? 'Accessories' : 'New Chair';
        STATS_QC.push({ rep7: m[1], date, type });
      });
    });
  } catch(e) { warn(`QC sheet failed: ${e.message}`); }

  // 7. Woodmill checks
  log('Loading Woodmill checks…');
  let wmByMachineDate = {};
  try {
    const siteId = await getSiteId(WM_QUALITY_SITE);
    const items  = await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${WM_LIST_ID}/items?$expand=fields&$top=999`);
    for (const item of items) {
      const f = item.fields;
      const mid     = (f.MachineId||f.machineId||f.Title||'').trim();
      const dateStr = f.InspectedAt ? wmDateStr(new Date(f.InspectedAt)) : '';
      if (!mid||!dateStr) continue;
      if (!wmByMachineDate[mid]) wmByMachineDate[mid] = {};
      if (!wmByMachineDate[mid][dateStr]) wmByMachineDate[mid][dateStr] = [];
      wmByMachineDate[mid][dateStr].push(f);
    }
  } catch(e) { warn(`Woodmill checks failed: ${e.message}`); }

  // 8. Cutting checks
  log('Loading Cutting checks…');
  let ccByMachineDate = {};
  try {
    const siteId = await getSiteId(CC_SITE_PATH);
    const listId = await getListIdByName(siteId, CC_LIST_NAME);
    const items  = await graphGetAll(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=999`);
    for (const item of items) {
      const f = item.fields;
      const mid     = (f.MachineId||f.machineId||f.Title||'').trim();
      const dateStr = f.InspectedAt ? wmDateStr(new Date(f.InspectedAt)) : '';
      if (!mid||!dateStr) continue;
      if (!ccByMachineDate[mid]) ccByMachineDate[mid] = {};
      if (!ccByMachineDate[mid][dateStr]) ccByMachineDate[mid][dateStr] = [];
      ccByMachineDate[mid][dateStr].push(f);
    }
  } catch(e) { warn(`Cutting checks failed: ${e.message}`); }

  return { PROD, WEEKS, STATE, STATS_COMPLETIONS, STATS_ALERTS, CPAR_ITEMS, NMS_ITEMS, STATS_QC, wmByMachineDate, ccByMachineDate };
}

// ─── Report HTML builder ───────────────────────────────────────────────────
function buildReportHtml(data) {
  const { PROD, WEEKS, STATE, STATS_COMPLETIONS, STATS_ALERTS, CPAR_ITEMS, NMS_ITEMS, STATS_QC, wmByMachineDate, ccByMachineDate } = data;

  const now   = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);

  // Last working day (skip weekends)
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  while (yest.getDay()===0||yest.getDay()===6) yest.setDate(yest.getDate()-1);

  // Saturday overtime between last working day and today
  const overtimeDates = [];
  const _d = new Date(yest); _d.setDate(_d.getDate()+1);
  while (_d < today) {
    if (_d.getDay()===6) overtimeDates.push(new Date(_d));
    _d.setDate(_d.getDate()+1);
  }
  const hasOvertime = overtimeDates.length > 0;

  const yestDDMMYYYY = yest.toLocaleDateString('en-GB');
  const yestISO      = wmDateStr(yest);
  const satDateStr   = hasOvertime ? overtimeDates[0].toLocaleDateString('en-GB') : '';
  const yestLabel    = yest.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  const satLabel     = hasOvertime ? overtimeDates[0].toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }) : '';
  const genTime      = now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  const todayDayName = now.toLocaleDateString('en-GB', { weekday:'long' });
  const todayDayDate = now.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  // Completions split
  const fridayComps = STATS_COMPLETIONS.filter(i => i.fields?.CompletedDate === yestDDMMYYYY && i.fields?.IsComplete);
  const satComps    = hasOvertime ? STATS_COMPLETIONS.filter(i => i.fields?.CompletedDate === satDateStr && i.fields?.IsComplete) : [];
  const yestComps   = [...fridayComps, ...satComps];
  const wtdComps    = STATS_COMPLETIONS.filter(i => {
    if (!i.fields?.CompletedDate||!i.fields?.IsComplete) return false;
    const d = parseDdmmyyyy(i.fields.CompletedDate);
    return d && sameWeek(d, yest);
  });

  function subCount(comps, team, sub) {
    return comps.filter(i => i.fields?.Team===team && i.fields?.SubTeam===sub).length;
  }
  function buildDoneByTeam(comps) {
    const map = {};
    PROD_TEAMS.forEach(t => { map[t.name]=0; });
    comps.forEach(i => {
      const t = i.fields?.Team||'';
      if (map[t]===undefined) return;
      const team = PROD_TEAMS.find(x => x.name===t);
      if (!team?.hasSubs) map[t]++;
    });
    PROD_TEAMS.filter(t => t.hasSubs).forEach(t => {
      map[t.name] = Math.round((subCount(comps,t.name,'Arms')+subCount(comps,t.name,'Backs'))/2);
    });
    return map;
  }

  const doneByTeam    = buildDoneByTeam(fridayComps);
  const satDoneByTeam = hasOvertime ? buildDoneByTeam(satComps) : null;
  const wtdByTeam     = buildDoneByTeam(wtdComps);
  const totalDone     = Object.values(doneByTeam).reduce((a,b)=>a+b,0);
  const satTotalDone  = satDoneByTeam ? Object.values(satDoneByTeam).reduce((a,b)=>a+b,0) : 0;

  // Target + backlog
  const isRegularPrep = p => /^\d+$/.test(String(p));
  const todayWkNum  = isoWeekNumber(today);
  const todayWkCode = `WK ${todayWkNum}`;
  const currentWk   = WEEKS.includes(todayWkCode) ? todayWkCode : (WEEKS.slice(-2)[0]||WEEKS[WEEKS.length-1]||'');
  const todayDOW    = today.getDay();
  const todayPrepDay= (todayDOW>=1&&todayDOW<=5) ? String(todayDOW) : null;
  const yesterdayDOW     = yest.getDay();
  const yesterdayPrepDay = (yesterdayDOW>=1&&yesterdayDOW<=5) ? String(yesterdayDOW) : null;
  const yesterdayJobs = yesterdayPrepDay ? (PROD[currentWk]?.[yesterdayPrepDay]||[]) : [];
  const dayTarget = yesterdayJobs.length;

  const currentWkIdx = WEEKS.indexOf(currentWk);
  const backlogByTeam = {};
  PROD_TEAMS.forEach(t => { backlogByTeam[t.name]=0; });
  WEEKS.slice(0,currentWkIdx).forEach(wk => {
    Object.entries(PROD[wk]||{}).forEach(([prep,jobs]) => {
      if (!Array.isArray(jobs)||!isRegularPrep(prep)) return;
      jobs.forEach((job,ji) => {
        PROD_TEAMS.filter(t=>t.name!=='QC').forEach(t => {
          const subs = t.hasSubs ? t.subs : ['all'];
          if (!subs.every(sub => STATE[t.name]?.[sub]?.[wk]?.[Number(prep)]?.[ji]?.done))
            backlogByTeam[t.name]++;
        });
      });
    });
  });
  Object.entries(PROD[currentWk]||{}).forEach(([prep,jobs]) => {
    if (!Array.isArray(jobs)||!isRegularPrep(prep)) return;
    if (!todayPrepDay||Number(prep)>=Number(todayPrepDay)) return;
    jobs.forEach((job,ji) => {
      PROD_TEAMS.filter(t=>t.name!=='QC').forEach(t => {
        const subs = t.hasSubs ? t.subs : ['all'];
        if (!subs.every(sub => STATE[t.name]?.[sub]?.[currentWk]?.[Number(prep)]?.[ji]?.done))
          backlogByTeam[t.name]++;
      });
    });
  });
  const assemblyReps = new Set(
    STATS_COMPLETIONS.filter(c=>c.fields?.Team==='Assembly')
      .map(c=>String(c.fields?.REP??'').replace(/\D/g,'').slice(-7)).filter(r=>r.length===7)
  );
  const qcCompletedReps = new Set(STATS_QC.map(q=>q.rep7));
  backlogByTeam['QC'] = [...assemblyReps].filter(r=>!qcCompletedReps.has(r)).length;
  const totalBacklog = Object.values(backlogByTeam).reduce((a,b)=>a+b,0);

  // QC
  const yestQC      = STATS_QC.filter(r=>r.date&&wmDateStr(r.date)===yestISO);
  const qcTotal     = yestQC.length;
  const qcNewChair  = yestQC.filter(r=>r.type==='New Chair').length;
  const qcService   = yestQC.filter(r=>r.type==='Service Chair').length;
  const qcAccessory = yestQC.filter(r=>r.type==='Accessories').length;

  // Near misses
  const nmsYest  = NMS_ITEMS.filter(i=>{ const d=new Date(i.createdDateTime); d.setHours(0,0,0,0); return d.getTime()===yest.getTime(); });
  const nmsWeek  = NMS_ITEMS.filter(i=>sameWeek(new Date(i.createdDateTime),yest));
  const nmsMonth = NMS_ITEMS.filter(i=>{ const d=new Date(i.createdDateTime); return d.getMonth()===today.getMonth()&&d.getFullYear()===today.getFullYear(); });
  const nmsYTD   = NMS_ITEMS.filter(i=>new Date(i.createdDateTime).getFullYear()===today.getFullYear());
  const nmsWeekOpen   = nmsWeek.filter(i=>!i.fields?.NearMissclosedout_x003f_).length;
  const nmsWeekClosed = nmsWeek.length - nmsWeekOpen;

  const nmsRows = nmsYest.map(item => {
    const f = item.fields||{};
    const ref = f.Title||('NMS-'+item.id.slice(0,6));
    const loc = (f.Locationofissue||'').replace(/^Repose\s*[-–]\s*/i,'');
    const isOpen = !f.NearMissclosedout_x003f_;
    return `<div class="alert-row ${isOpen?'red':'green'}">
      <div class="alert-icon">⚠️</div>
      <div class="alert-body">
        <div class="alert-title">${escHtml(ref)}${loc?' · '+escHtml(loc):''}</div>
        <div class="alert-sub">${escHtml(f.Whatistheissue_x003f_||'—')}${f.RaisedBy_x003a_?' — Raised by '+escHtml(f.RaisedBy_x003a_):''}</div>
      </div>
      <div class="alert-badge"><span class="pill ${isOpen?'pill-red':'pill-green'}">${isOpen?'Open':'Closed'}</span></div>
    </div>`;
  }).join('')||'<div style="color:#9ca3af;font-size:12px;padding:6px 0">No near misses reported.</div>';

  // CPARs
  const cparOpen    = CPAR_ITEMS.filter(i=>getCPARStatus(i)!=='closed').length;
  const cparOverdue = CPAR_ITEMS.filter(i=>getCPARStatus(i)==='red').length;
  const todayDDMMYYYY = now.toLocaleDateString('en-GB');

  function cparDateInPeriod(item, checker) {
    const la = item.fields?.LoggedAt||item.createdDateTime||'';
    if (!la) return false;
    const d = la.includes('/') ? parseCPARDate(la) : new Date(la);
    return d&&!isNaN(d)&&checker(d);
  }
  const cparRaisedThisWeek  = CPAR_ITEMS.filter(i=>cparDateInPeriod(i,d=>sameWeek(d,today))).length;
  const cparRaisedThisMonth = CPAR_ITEMS.filter(i=>cparDateInPeriod(i,d=>d.getMonth()===today.getMonth()&&d.getFullYear()===today.getFullYear())).length;

  const cparByTeam = {};
  PROD_TEAMS.forEach(t => { cparByTeam[t.name]={raisedYest:0,open:0,overdue:0,raisedThisWeek:0,closedThisWeek:0}; });
  CPAR_ITEMS.forEach(item => {
    const t = normaliseTeam(item.fields?.SourceDept||item.fields?.RaisedByTeam||'');
    if (!cparByTeam[t]) return;
    const s  = getCPARStatus(item);
    const la = item.fields?.LoggedAt||item.createdDateTime||'';
    const isYest = la.includes('/') ? la.startsWith(yestDDMMYYYY) : (la&&wmDateStr(new Date(la))===yestISO);
    if (isYest) cparByTeam[t].raisedYest++;
    if (s==='closed') {
      if (cparDateInPeriod(item,d=>sameWeek(d,today))) cparByTeam[t].closedThisWeek++;
    } else {
      cparByTeam[t].open++;
      if (s==='red') cparByTeam[t].overdue++;
    }
    if (cparDateInPeriod(item,d=>sameWeek(d,today))) cparByTeam[t].raisedThisWeek++;
  });
  const cparRaisedYestTotal = Object.values(cparByTeam).reduce((a,c)=>a+c.raisedYest,0);

  // Spec changes
  const specYest = STATS_ALERTS.filter(a => {
    const da = a.fields?.DetectedAt||'';
    if (!da) return false;
    const parsed = parseDdmmyyyy(da);
    return parsed && wmDateStr(parsed)===yestISO && !specAlertIsNoise(a);
  });

  // Pre-use checks
  function checkToken(name, insps) {
    const status = insps.length===0 ? 'none' : insps.some(f=>f.AnyFail===true||f.AnyFail==='true'||f.AnyFail===1) ? 'fail' : 'pass';
    const icon   = status==='pass'?'✓':status==='fail'?'⚠':'–';
    let timeOp = 'Not submitted';
    if (insps.length&&insps[0].InspectedAt) {
      timeOp = new Date(insps[0].InspectedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
      if (insps[0].Inspector) timeOp += ' · '+insps[0].Inspector;
    }
    return `<div class="check-machine ${status}"><div class="check-icon ${status}">${icon}</div><div class="check-info"><div class="check-name">${escHtml(name)}</div><div class="check-time">${escHtml(timeOp)}</div></div></div>`;
  }
  const woodmillChecksHtml = WM_MACHINES.map(m => checkToken(m.name, wmByMachineDate[m.id]?.[yestISO]||[])).join('');
  const cuttingChecksHtml  = CC_MACHINES.map(m => checkToken(m.name, ccByMachineDate[m.id]?.[yestISO]||[])).join('');

  // Production table rows
  const prodRows = PROD_TEAMS.map(t => {
    const done    = doneByTeam[t.name]||0;
    const wtd     = wtdByTeam[t.name]||0;
    const backlog = backlogByTeam[t.name]||0;
    const pct = dayTarget>0 ? Math.min(100,Math.round(done/dayTarget*100)) : (done>0?100:0);
    const barColor = pct>=90?'#16a34a':pct>=70?'#f59e0b':'#ef4444';
    const pillCls  = backlog===0?'pill-grey':backlog<=3?'pill-amber':'pill-red';
    const statusTxt = pct>=100?'Complete':pct>=90?'On Track':pct>=70?'Below Target':'Behind';
    const statusCls = pct>=100||pct>=90?'pill-green':pct>=70?'pill-amber':'pill-red';
    return `<tr>
      <td><span style="margin-right:5px">${t.icon}</span><span class="team-name">${escHtml(t.name)}</span></td>
      <td>${done}</td><td>${dayTarget||'—'}</td>
      <td><div class="bar-wrap"><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${barColor}"></div></div><span class="bar-pct">${pct}%</span></div></td>
      <td><span class="pill ${pillCls}">${backlog}</span></td>
      <td class="wtd">${wtd}</td>
      <td><span class="pill ${statusCls}">${statusTxt}</span></td>
    </tr>`;
  }).join('');

  const satProdRows = (satDoneByTeam&&satTotalDone>0) ? PROD_TEAMS.map(t => {
    const done = satDoneByTeam[t.name]||0;
    if (!done) return '';
    return `<tr><td><span style="margin-right:5px">${t.icon}</span><span class="team-name">${escHtml(t.name)}</span></td><td>${done}</td></tr>`;
  }).join('') : '';

  const backlogCards = PROD_TEAMS.map(t => {
    const n = backlogByTeam[t.name]||0;
    const numColor = n>5?'#dc2626':n>0?'#d97706':'#16a34a';
    const cardStyle = n>5?'border-color:#fca5a5;background:#fef2f2':n>0?'border-color:#fed7aa;background:#fff7ed':'';
    return `<div class="plan-card" style="${cardStyle}">
      <div class="plan-team">${t.icon} ${escHtml(t.name)}</div>
      <div class="plan-num" style="color:${numColor}">${n}</div>
      <div class="plan-sub">${n===0?'All clear':'jobs outstanding'}</div>
    </div>`;
  }).join('');
  const qcBacklogN = backlogByTeam['QC']||0;
  const qcBacklogCard = `<div class="plan-card" style="${qcBacklogN>5?'border-color:#fca5a5;background:#fef2f2':qcBacklogN>0?'border-color:#fed7aa;background:#fff7ed':''}">
    <div class="plan-team">✅ QC</div>
    <div class="plan-num" style="color:${qcBacklogN>5?'#dc2626':qcBacklogN>0?'#d97706':'#16a34a'}">${qcBacklogN}</div>
    <div class="plan-sub">${qcBacklogN===0?'All clear':'assembly done, not QC\'d'}</div>
  </div>`;

  const cparTeamRows = PROD_TEAMS.map(t => {
    const c = cparByTeam[t.name]||{raisedYest:0,open:0,overdue:0,raisedThisWeek:0,closedThisWeek:0};
    return `<tr>
      <td><span style="margin-right:5px">${t.icon}</span><span class="team-name">${escHtml(t.name)}</span></td>
      <td>${c.raisedYest||'—'}</td>
      <td><span class="pill ${c.open>0?'pill-amber':'pill-grey'}">${c.open}</span></td>
      <td><span class="pill ${c.overdue>0?'pill-red':'pill-grey'}">${c.overdue}</span></td>
      <td>${c.raisedThisWeek}</td><td>${c.closedThisWeek}</td>
    </tr>`;
  }).join('');

  const specRows = specYest.slice(0,10).map(a => {
    const f = a.fields||{};
    const da = f.DetectedAt||'';
    const timeStr = da.includes(' ') ? da.split(' ')[1] : '';
    return `<tr>
      <td><span class="spec-rep">${escHtml(f.Title||'—')}</span></td>
      <td class="spec-field">${escHtml(f.FieldLabel||f.FieldKey||'—')}</td>
      <td><span class="spec-old">${escHtml(f.OldValue||'—')}</span></td>
      <td><span class="spec-new">${escHtml(f.NewValue||'—')}</span></td>
      <td class="spec-time">${timeStr}</td>
    </tr>`;
  }).join()||'<tr><td colspan="5" style="color:#9ca3af;font-size:12px;padding:6px 8px">No spec changes detected.</td></tr>';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RepNet Daily Report</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f4f8;padding:32px 16px 60px;color:#1a202c}
.email-wrap{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
.header{background:#0e023a;padding:28px 32px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.header-left{display:flex;flex-direction:column;gap:4px}
.logo-row{display:flex;align-items:center;gap:8px}
.logo-dot{width:9px;height:9px;border-radius:50%;background:#14a1e9}
.logo-wordmark{font-size:16px;font-weight:900;color:#14a1e9;letter-spacing:-.04em}
.header-title{font-size:20px;font-weight:700;color:#fff;letter-spacing:-.02em}
.header-sub{font-size:12px;color:#94a3b8;margin-top:2px}
.header-date{text-align:right;color:#cbd5e1;font-size:12px;line-height:1.6}
.header-date strong{display:block;font-size:18px;color:#fff;font-weight:700}
.summary-bar{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid #e5e7eb}
.summary-cell{padding:14px 10px;border-right:1px solid #e5e7eb;text-align:center}
.summary-cell:last-child{border-right:none}
.summary-num{font-size:24px;font-weight:800;color:#0e023a;line-height:1}
.summary-num.green{color:#16a34a}.summary-num.amber{color:#d97706}.summary-num.red{color:#dc2626}.summary-num.blue{color:#0e7490}
.summary-lbl{font-size:10px;color:#6b7280;margin-top:4px;font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.body{padding:0 32px 32px}
.section{margin-top:26px}
.section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;padding-bottom:8px;border-bottom:1.5px solid #e5e7eb;margin-bottom:12px}
.prod-table{width:100%;border-collapse:collapse;font-size:13px}
.prod-table th{text-align:left;font-size:10px;color:#9ca3af;font-weight:600;padding:0 8px 6px;border-bottom:1px solid #f3f4f6;text-transform:uppercase;letter-spacing:.04em}
.prod-table th:not(:first-child){text-align:center}
.prod-table td{padding:7px 8px;border-bottom:1px solid #f9fafb;vertical-align:middle}
.prod-table td:not(:first-child){text-align:center}
.prod-table tr:last-child td{border-bottom:none}
.prod-table .wtd{font-size:11px;color:#9ca3af}
.team-name{font-weight:600;color:#0e023a;font-size:13px}
.pill{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.pill-green{background:#dcfce7;color:#16a34a}.pill-amber{background:#fef9c3;color:#92400e}.pill-red{background:#fee2e2;color:#dc2626}.pill-grey{background:#f3f4f6;color:#6b7280}
.bar-wrap{display:flex;align-items:center;gap:6px}
.bar-bg{flex:1;height:5px;background:#f3f4f6;border-radius:3px;overflow:hidden;min-width:40px}
.bar-fill{height:100%;border-radius:3px}
.bar-pct{font-size:11px;color:#6b7280;width:30px;text-align:right;flex-shrink:0}
.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.plan-card{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px}
.plan-team{font-size:12px;font-weight:700;color:#374151}
.plan-num{font-size:20px;font-weight:800;color:#0e023a;line-height:1.1;margin-top:2px}
.plan-sub{font-size:11px;color:#9ca3af;margin-top:1px}
.qc-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.qc-cell{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:11px 12px;text-align:center}
.qc-num{font-size:20px;font-weight:800;color:#0e7490}
.qc-num.red{color:#dc2626}.qc-num.grey{color:#374151}
.qc-lbl{font-size:11px;color:#6b7280;margin-top:2px}
.alert-row{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:8px;margin-bottom:8px;font-size:13px;border:1px solid}
.alert-row.red{background:#fef2f2;border-color:#fca5a5}.alert-row.green{background:#f0fdf4;border-color:#bbf7d0}
.alert-icon{font-size:15px;flex-shrink:0;margin-top:1px}
.alert-body{flex:1}
.alert-title{font-weight:600;color:#0e023a}
.alert-sub{font-size:12px;color:#6b7280;margin-top:2px;line-height:1.4}
.alert-badge{font-size:11px;font-weight:700;flex-shrink:0;margin-top:2px}
.spec-table{width:100%;border-collapse:collapse;font-size:12px}
.spec-table th{text-align:left;font-size:10px;color:#9ca3af;font-weight:600;padding:0 8px 6px;text-transform:uppercase}
.spec-table td{padding:6px 8px;border-top:1px solid #f3f4f6;vertical-align:top}
.spec-rep{font-family:monospace;font-weight:700;color:#0e023a;white-space:nowrap}
.spec-field{color:#374151}.spec-old{color:#dc2626;text-decoration:line-through}.spec-new{color:#16a34a;font-weight:600}.spec-time{color:#9ca3af;white-space:nowrap}
.checks-area{margin-bottom:10px}
.checks-area-label{font-size:11px;font-weight:700;color:#374151;margin-bottom:6px}
.checks-grid{display:flex;gap:6px;flex-wrap:wrap}
.check-machine{display:flex;align-items:center;gap:6px;background:#f8fafc;border:1.5px solid #e5e7eb;border-radius:6px;padding:5px 10px}
.check-machine.pass{background:#f0fdf4;border-color:#86efac}.check-machine.fail{background:#fef2f2;border-color:#fca5a5}
.check-icon{font-size:13px;font-weight:700;flex-shrink:0}
.check-icon.pass{color:#16a34a}.check-icon.fail{color:#dc2626}.check-icon.none{color:#9ca3af}
.check-info{display:flex;flex-direction:column}
.check-name{font-size:11px;font-weight:600;color:#374151;line-height:1.2}
.check-time{font-size:10px;color:#9ca3af}
.stat-note{font-size:12px;color:#6b7280;margin-top:8px;padding:0 2px}
.footer{background:#f8fafc;border-top:1px solid #e5e7eb;padding:14px 32px;font-size:11px;color:#9ca3af;display:flex;justify-content:space-between;align-items:center}
</style></head><body>
<div class="email-wrap">
  <div class="header">
    <div class="header-left">
      <div class="logo-row"><span class="logo-dot"></span><span class="logo-wordmark">RepNet</span></div>
      <div class="header-title">Daily Production Report</div>
      <div class="header-sub">Repose Furniture Ltd &nbsp;·&nbsp; Generated at ${genTime}</div>
    </div>
    <div class="header-date"><strong>${todayDayName}</strong>${todayDayDate}</div>
  </div>

  <div class="summary-bar">
    <div class="summary-cell"><div class="summary-num green">${totalDone+satTotalDone}</div><div class="summary-lbl">Jobs Done</div></div>
    <div class="summary-cell"><div class="summary-num ${totalBacklog>0?'amber':'green'}">${totalBacklog}</div><div class="summary-lbl">Backlog</div></div>
    <div class="summary-cell"><div class="summary-num blue">${qcTotal}</div><div class="summary-lbl">QC'd</div></div>
    <div class="summary-cell"><div class="summary-num ${nmsYest.length>0?'red':'green'}">${nmsYest.length}</div><div class="summary-lbl">Near Misses</div></div>
    <div class="summary-cell"><div class="summary-num ${cparOpen>0?'red':'green'}">${cparOpen}</div><div class="summary-lbl">Open CPARs</div></div>
  </div>

  <div class="body">
    <div class="section">
      <div class="section-title">Production — ${yestLabel}</div>
      <table class="prod-table">
        <thead><tr><th>Team</th><th>Done</th><th>Target</th><th>Progress</th><th>Backlog</th><th>WTD</th><th>Status</th></tr></thead>
        <tbody>${prodRows}</tbody>
      </table>
      <div class="stat-note">Target = job count for that prep day &nbsp;·&nbsp; WTD = this ISO week &nbsp;·&nbsp; Backlog = incomplete jobs from all past weeks + past prep days this week</div>
    </div>

    ${satTotalDone>0?`
    <div class="section">
      <div class="section-title" style="color:#d97706;border-bottom-color:#fed7aa">Saturday Overtime — ${satLabel}</div>
      <table class="prod-table">
        <thead><tr><th>Team</th><th>Done</th></tr></thead>
        <tbody>${satProdRows}</tbody>
      </table>
      <div class="stat-note">${satTotalDone} job${satTotalDone!==1?'s':''} completed during Saturday overtime</div>
    </div>`:''}

    <div class="section">
      <div class="section-title">Backlog</div>
      <div class="plan-grid">${backlogCards}${qcBacklogCard}</div>
      <div class="stat-note">Outstanding jobs from all past weeks + past prep days this week &nbsp;·&nbsp; QC = Assembly done but not yet QC'd</div>
    </div>

    <div class="section">
      <div class="section-title">Quality Control — ${yestLabel}</div>
      <div class="qc-strip">
        <div class="qc-cell"><div class="qc-num">${qcTotal}</div><div class="qc-lbl">Total QC'd</div></div>
        <div class="qc-cell"><div class="qc-num">${qcNewChair}</div><div class="qc-lbl">New Chairs</div></div>
        <div class="qc-cell"><div class="qc-num">${qcService}</div><div class="qc-lbl">Service Chairs</div></div>
        <div class="qc-cell"><div class="qc-num grey">${qcAccessory}</div><div class="qc-lbl">Accessories</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Near Misses — ${yestLabel}</div>
      ${nmsRows}
      <div class="qc-strip" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
        <div class="qc-cell"><div class="qc-num ${nmsWeek.length>0?'':'grey'}">${nmsWeek.length}</div><div class="qc-lbl">Raised This Week</div></div>
        <div class="qc-cell"><div class="qc-num ${nmsWeekOpen>0?'red':'grey'}">${nmsWeekOpen}</div><div class="qc-lbl">Still Open</div></div>
        <div class="qc-cell"><div class="qc-num grey">${nmsWeekClosed}</div><div class="qc-lbl">Closed</div></div>
      </div>
      <div class="stat-note" style="margin-top:8px">This month: <strong>${nmsMonth.length}</strong> &nbsp;·&nbsp; YTD: <strong>${nmsYTD.length}</strong></div>
    </div>

    <div class="section">
      <div class="section-title">CPARs — Issues by Team</div>
      <table class="prod-table" style="margin-bottom:14px">
        <thead><tr><th>Team</th><th>Raised ${yestLabel}</th><th>Open</th><th>Overdue</th><th>Raised This Week</th><th>Closed This Week</th></tr></thead>
        <tbody>${cparTeamRows}</tbody>
      </table>
      <div class="qc-strip" style="grid-template-columns:repeat(4,1fr)">
        <div class="qc-cell"><div class="qc-num" style="color:#0e023a">${cparOpen}</div><div class="qc-lbl">Open</div></div>
        <div class="qc-cell" style="${cparOverdue?'border-color:#fca5a5;background:#fef2f2':''}"><div class="qc-num ${cparOverdue?'red':'grey'}">${cparOverdue}</div><div class="qc-lbl">Overdue</div></div>
        <div class="qc-cell"><div class="qc-num grey">${cparRaisedThisWeek}</div><div class="qc-lbl">Raised This Week</div></div>
        <div class="qc-cell"><div class="qc-num grey">${cparRaisedThisMonth}</div><div class="qc-lbl">Raised This Month</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Spec Changes — ${yestLabel}</div>
      <table class="spec-table">
        <thead><tr><th>REP</th><th>Field</th><th>From</th><th>To</th><th>Time</th></tr></thead>
        <tbody>${specRows}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Pre-Use Checks — ${yestLabel}</div>
      <div class="checks-area">
        <div class="checks-area-label">🪵 Woodmill Machines</div>
        <div class="checks-grid">${woodmillChecksHtml}</div>
      </div>
      <div class="checks-area" style="margin-bottom:0">
        <div class="checks-area-label">✂️ Cutting Machines</div>
        <div class="checks-grid">${cuttingChecksHtml}</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>Generated by RepNet &nbsp;·&nbsp; Repose Furniture Ltd</span>
    <span>Auto-send 07:00 &nbsp;·&nbsp; Powered by <strong style="color:#0e023a">RepNet</strong></span>
  </div>
</div>
</body></html>`;
}

// ─── Send email via MS Graph ───────────────────────────────────────────────
async function sendEmail(subject, htmlBody) {
  const toRecipients = RECIPIENTS.map(addr => ({ emailAddress: { address: addr } }));
  const now = new Date();
  const ts  = now.toISOString().replace(/[:.]/g,'-').slice(0,19);
  const filename = `RepNet-Daily-Report-${ts}.html`;

  await graphPost(
    `https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`,
    {
      message: {
        subject,
        body: { contentType: 'Text', content: 'Daily production report attached — open the HTML file in your browser to view.\n\nGenerated by RepNet · Repose Furniture Ltd' },
        toRecipients,
        attachments: [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: filename,
          contentType: 'text/html',
          contentBytes: Buffer.from(htmlBody).toString('base64'),
        }],
      },
      saveToSentItems: true,
    }
  );
}

// ─── Azure Function entry point ────────────────────────────────────────────
module.exports = async function (context, myTimer) {
  context.log('RepNet daily report timer triggered');

  if (myTimer.isPastDue) context.log.warn('Timer is past due — running late');

  try {
    const data    = await fetchAllData(context);
    const html    = buildReportHtml(data);
    const now     = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    await sendEmail(`RepNet Daily Production Report — ${dateStr}`, html);
    context.log(`Report sent successfully to ${RECIPIENTS.join(', ')}`);
  } catch(e) {
    context.log.error('Daily report failed:', e.message);
    throw e;
  }
};
