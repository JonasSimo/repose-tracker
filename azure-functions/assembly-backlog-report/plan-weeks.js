'use strict';

// Production-plan loader. parseSheetValues / distributeIntoPreps are a verbatim
// port of repnet/src/features/production/loader.ts. Fetch path mirrors
// pod-auto-send/prod-plan.js: sessionless share → driveItem → per-week range.

const { graphGet, encodeSharingUrl } = require('./graph');

const PROD_SHARING_URL =
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBLf67iYnbQSq2O8UU_zQihARfBedzZcW-CmO0q3v5zC3o?e=nfze02';

// Local-time ISO week — used ONLY for naming WK sheets, exactly as loader.ts.
function isoWeekOfDateLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const w1 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function isoWeekMonday(isoWeek) {
  const now = new Date();
  const year = now.getFullYear();
  function weekStart(y) {
    const jan4 = new Date(y, 0, 4);
    const d = new Date(jan4);
    d.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (isoWeek - 1) * 7);
    return d;
  }
  const candidates = [weekStart(year - 1), weekStart(year), weekStart(year + 1)];
  return candidates.reduce((best, d) =>
    Math.abs(d.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime()) ? d : best);
}

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseSheetValues(values) {
  if (!values || !values.length) return [];
  let startRow = 4;
  for (let i = 0; i < Math.min(8, values.length); i++) {
    const row = values[i];
    if (row && String(row[10] ?? '').toLowerCase().includes('item')) { startRow = i + 1; break; }
  }
  const jobs = [];
  for (let i = startRow; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length < 12) continue;
    const kRaw = String(row[10] ?? '').trim();
    const isExpressCode = /^(EXP|M-FT)\d*$/i.test(kRaw);
    const lCell = String(row[11] ?? '');
    const isServCode = /^SERV/i.test(kRaw) || /\bserv\b/i.test(lCell);
    const itemNoNum = Number(kRaw);
    const itemNo = isExpressCode || isServCode ? kRaw : itemNoNum;
    if (!kRaw || (!isExpressCode && !isServCode && (!Number.isFinite(itemNoNum) || itemNoNum <= 0))) continue;
    const m = lCell.match(/REP\s*(\d{7})/);
    if (!m) continue;

    const biRaw = String(row[60] ?? '').trim().toUpperCase();
    let prep;
    if (/^(EXP|M-FT|MFT)/.test(biRaw)) {
      prep = 'express';
    } else {
      const prepVal = parseInt(biRaw.replace(/^PREP\s*/, ''), 10);
      prep = prepVal >= 1 && prepVal <= 5 ? prepVal : null;
    }

    const expressType = isExpressCode ? (/^M-?FT/i.test(kRaw) ? 'MFT' : 'EXP') : null;
    jobs.push({ itemNo, rep: `REP ${m[1]}`, prep, expressType, isService: isServCode });
  }
  return jobs;
}

function distributeIntoPreps(jobs) {
  const preps = { 1: [], 2: [], 3: [], 4: [], 5: [], express: [] };
  const jo = (j) => ({ itemNo: j.itemNo, rep: j.rep, expressType: j.expressType, isService: j.isService });
  jobs.filter((j) => j.prep === 'express').forEach((j) => preps.express.push(jo(j)));
  const normalJobs = jobs.filter((j) => j.prep !== 'express');
  const hasNumericPrep = normalJobs.some((j) => typeof j.prep === 'number');
  if (hasNumericPrep) {
    normalJobs.forEach((j) => { if (j.prep !== null && typeof j.prep === 'number') preps[j.prep].push(jo(j)); });
  } else {
    const n = normalJobs.length;
    normalJobs.forEach((j, i) => {
      const p = (n === 0 ? 1 : Math.min(5, Math.floor((i * 5) / n) + 1));
      preps[p].push(jo(j));
    });
  }
  return preps;
}

async function resolveDriveItem() {
  const item = await graphGet(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`,
  );
  return { driveId: item.parentReference.driveId, itemId: item.id };
}

async function loadProductionWeeks(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  const { driveId, itemId } = await resolveDriveItem();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekNums = [-3, -2, -1, 0, 1, 2].map((delta) => {
    const d = new Date(today); d.setDate(d.getDate() + delta * 7);
    return isoWeekOfDateLocal(d);
  });

  const out = [];
  for (const wn of weekNums) {
    const wk = `WK ${wn}`;
    const wc = ddmmyyyy(isoWeekMonday(wn));
    try {
      const range = await graphGet(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
        `/workbook/worksheets('${encodeURIComponent(wk)}')/range(address='A1:BI1000')?$select=values`,
      );
      out.push({ wk, wc, preps: distributeIntoPreps(parseSheetValues(range.values ?? [])) });
    } catch (e) {
      info(`[plan] sheet ${wk} unavailable: ${e.message}`);
      out.push({ wk, wc, preps: { 1: [], 2: [], 3: [], 4: [], 5: [], express: [] } });
    }
  }
  return out;
}

module.exports = { parseSheetValues, distributeIntoPreps, loadProductionWeeks, isoWeekOfDateLocal };
