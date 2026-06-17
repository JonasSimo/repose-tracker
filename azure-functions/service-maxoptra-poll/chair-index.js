'use strict';

// ─────────────────────────────────────────────────────────────────────────
// chair-index — REP-cell parsing + ticket indexing for service-maxoptra-poll.
//
// A ticket's "REP Number" cell holds one REP or several comma-separated REPs
// (one per chair on a multi-chair ticket). These helpers split that cell and
// build the label/rep indexes the poll uses to match a Maxoptra collection
// order back to its TICKET LOG row. Mirrors the semantics of repnet's
// src/features/service/repList.ts so the two sides stay consistent.
// ─────────────────────────────────────────────────────────────────────────

// Split a REP cell into trimmed, UPPERCASED, de-duped tokens (order-preserving).
// '' / null / undefined → [].
function parseRepList(cell) {
  const seen = new Set();
  const out = [];
  for (const raw of String(cell == null ? '' : cell).split(',')) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// Parse a SINGLE REP token. Matches index.html / repnet _parseChairId semantics.
function parseChairId(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return null;
  const m = /^(REP\d+)(?:-R(\d+))?$/i.exec(v);
  if (!m) return { rep: v, returnNo: 0, isReturn: false, label: v };
  return { rep: m[1].toUpperCase(), returnNo: m[2] ? parseInt(m[2], 10) : 0, isReturn: !!m[2], label: v.toUpperCase() };
}

// From a (possibly multi-REP) cell, return the parsed chair IDs for ONLY the
// -R return chairs — these are the collection candidates. Rows with no -R chair
// yield [] and are skipped by the caller, exactly as the single-REP code did.
function returnChairsInCell(cell) {
  return parseRepList(cell)
    .map((token) => parseChairId(token))
    .filter((cid) => cid && cid.isReturn);
}

// Build the label/rep indexes used to match Maxoptra orders back to tickets.
// Multi-chair aware: every -R chair on a row is indexed independently (by full
// label and by base REP), all pointing at the SAME ticket-row entry — so a
// collection order referencing any one chair of the job matches the row.
//
// opts:
//   repNoIdx              — column index of "REP Number" (required)
//   openDateIdx           — column index of "Open Date" (-1 if absent)
//   tableRowIndex         — 0-based sheet row of the table header
//   parseExcelDateSerial  — fn(cellValue) → Date|null (injected from index.js)
function buildTicketIndex(values, opts) {
  const {
    repNoIdx,
    openDateIdx = -1,
    tableRowIndex = 0,
    parseExcelDateSerial,
  } = opts;

  const ticketsByLabel = new Map();
  const ticketsByRep = new Map();

  for (let i = 1; i < values.length; i++) {
    const chairs = returnChairsInCell(values[i][repNoIdx]);
    if (chairs.length === 0) continue; // no -R chair on this row → not a candidate

    // sheetRow (1-based): tableRowIndex (0-based, points at header) + i + 1.
    const ticketOpenDate = (openDateIdx >= 0 && typeof parseExcelDateSerial === 'function')
      ? parseExcelDateSerial(values[i][openDateIdx])
      : null;
    const entry = { rowIdx: i - 1, sheetRow: tableRowIndex + i + 1, raw: values[i], openDate: ticketOpenDate };

    for (const cid of chairs) {
      ticketsByLabel.set(cid.label, entry);
      if (!ticketsByRep.has(cid.rep)) ticketsByRep.set(cid.rep, []);
      ticketsByRep.get(cid.rep).push({ ...entry, returnNo: cid.returnNo });
    }
  }

  return { ticketsByLabel, ticketsByRep };
}

module.exports = { parseRepList, parseChairId, returnChairsInCell, buildTicketIndex };
