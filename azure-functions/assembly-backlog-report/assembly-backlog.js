'use strict';

// Verbatim port of repnet/src/features/stats/assemblyBacklog.ts.
// Difference: completions are passed as a Set<string> of done stateKeys
// (built in completions.js) rather than a Map; we check doneSet.has(key).

const { isWorkingDay, workingPrepNumber, isoWeekOfDateUTC } = require('./working-days');

function stateKey(team, sub, wk, prep, rep) {
  return `${team}|${sub}|${wk}|${prep}|${rep}`;
}

function extractRep7(rep) {
  return String(rep || '').replace(/\D/g, '').slice(-7);
}

function parseDdmmyyyy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

const PREP_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function prepDayLabel(wc, prep) {
  if (!wc) return PREP_DAY_NAMES[prep - 1] ?? String(prep);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(wc); d.setDate(wc.getDate() + i);
    if (!isWorkingDay(d)) continue;
    count++;
    if (count === prep) {
      const dow = d.getDay();
      return PREP_DAY_NAMES[dow - 1] ?? String(prep);
    }
  }
  return PREP_DAY_NAMES[prep - 1] ?? String(prep);
}

function getAssemblyBacklogRows(weeks, doneSet, qcPassedReps, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayPrep = workingPrepNumber(today);
  const currentWk = `WK ${isoWeekOfDateUTC(today)}`;
  const wkOrder = new Map(weeks.map((w, i) => [w.wk, i]));
  const currentWkIdx = wkOrder.get(currentWk) ?? -1;

  const rows = [];

  for (const wkData of weeks) {
    const wkIdx = wkOrder.get(wkData.wk) ?? -1;
    const wcDate = parseDdmmyyyy(wkData.wc || '');

    const preps = [1, 2, 3, 4, 5, 'express'];
    for (const p of preps) {
      const jobs = wkData.preps[p];
      if (!Array.isArray(jobs) || jobs.length === 0) continue;

      let included = false;
      if (p === 'express') {
        included = currentWkIdx >= 0 && wkIdx <= currentWkIdx;
      } else if (currentWkIdx >= 0 && wkIdx < currentWkIdx) {
        included = true;
      } else if (wkData.wk === currentWk && todayPrep > 0 && Number(p) < todayPrep) {
        included = true;
      }
      if (!included) continue;

      jobs.forEach((job) => {
        const stateK = stateKey('Assembly', 'all', wkData.wk, p, job.rep);
        if (doneSet.has(stateK)) return;

        const rep7 = extractRep7(job.rep);
        if (rep7 && qcPassedReps.has(rep7)) return;

        let daysLate = 0;
        if (p !== 'express' && wcDate) {
          const due = new Date(wcDate); due.setDate(wcDate.getDate() + (Number(p) - 1));
          due.setHours(0, 0, 0, 0);
          if (due < today) {
            const cur = new Date(due); cur.setDate(due.getDate() + 1);
            while (cur <= today) {
              if (isWorkingDay(cur)) daysLate++;
              cur.setDate(cur.getDate() + 1);
            }
          }
        }

        rows.push({
          rep: job.rep || '',
          week: wkData.wk,
          wc: wkData.wc,
          prepLbl: p === 'express' ? 'Express' : prepDayLabel(wcDate, Number(p)),
          itemNo: String(job.itemNo ?? ''),
          daysLate,
          express: p === 'express' || !!job.expressType,
        });
      });
    }
  }

  rows.sort((a, b) => (b.daysLate - a.daysLate) || a.rep.localeCompare(b.rep));
  return rows;
}

const HEADER = ['REP', 'Week', 'W/C Date', 'Prep Day', 'Item No', 'Days Late', 'Express?'];

function csvEsc(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function backlogRowsToCsv(rows) {
  const body = rows.map((r) => [
    r.rep, r.week, r.wc, r.prepLbl, r.itemNo, r.daysLate, r.express ? 'Yes' : '',
  ].map(csvEsc).join(','));
  return [HEADER.map(csvEsc).join(','), ...body].join('\r\n');
}

function backlogCsvWithBom(rows) {
  return '﻿' + backlogRowsToCsv(rows);
}

function backlogFilename(now = new Date()) {
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `repose-assembly-backlog-${ts}.csv`;
}

module.exports = {
  stateKey, getAssemblyBacklogRows, backlogRowsToCsv, backlogCsvWithBom, backlogFilename,
};
