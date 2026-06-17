'use strict';

// Assembly "done" set from Supabase production_completions. Key format mirrors
// repnet indexCompletions + stateKey so it matches assembly-backlog.js lookups.

const { supaSelectMany } = require('../pod-auto-send/supa');

function buildAssemblyDoneSet(rows) {
  const out = new Set();
  for (const r of rows) {
    if (!r.is_complete) continue;
    if (!r.week || !r.rep || r.prep == null) continue;
    const prep = r.prep === 'express' ? 'express' : Number(r.prep);
    if (prep !== 'express' && !Number.isFinite(prep)) continue;
    const sub = r.sub_team || 'all';
    out.add(`Assembly|${sub}|${r.week}|${prep}|${r.rep}`);
  }
  return out;
}

async function loadAssemblyDoneSet(weeks, log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  if (!weeks.length) return new Set();
  // PostgREST in.(...) list — quote each label (they contain a space).
  const inList = weeks.map((w) => `"${w.replace(/"/g, '')}"`).join(',');
  const select = 'select=week,prep,rep,sub_team,is_complete';
  const filter = `team=eq.Assembly&is_complete=is.true&week=in.(${encodeURIComponent(inList)})`;
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const qs = `${select}&${filter}&limit=${PAGE}&offset=${from}`;
    const rows = await supaSelectMany('production_completions', qs);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  info(`[completions] ${all.length} completed Assembly rows across ${weeks.length} weeks`);
  return buildAssemblyDoneSet(all);
}

module.exports = { buildAssemblyDoneSet, loadAssemblyDoneSet };
