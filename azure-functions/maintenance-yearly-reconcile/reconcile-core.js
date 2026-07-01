'use strict';
/**
 * Pure reconciliation logic for maintenance_yearly (SharePoint ↔ Supabase).
 *
 * The RepNet Maintenance cockpit READS last_done / scheduled_for from Supabase,
 * but "Mark complete" writes SharePoint first and then mirrors to Supabase in a
 * second, best-effort call. A dropped mirror write silently strands an item as
 * "Never done" while SharePoint is correct (observed 2026-07-01: 6 of 40 items
 * diverged). This module computes the repairs needed to make Supabase match
 * SharePoint.
 *
 * SharePoint is the source of truth (it's the primary, always-written store),
 * with ONE safety rule: never overwrite a non-null Supabase value with null.
 * If SharePoint is blank but Supabase has a value, that's flagged as a conflict
 * for human review rather than auto-erased — so a reverse-direction anomaly
 * can't cause data loss.
 *
 * Only the status-driving completion fields are reconciled (last_done,
 * scheduled_for). Cockpit-only columns (legal_ref, owner_name, owner_email)
 * live only in Supabase and are never touched.
 */

// Fields compared/repaired. Both are dates and both mirror through the same
// vulnerable best-effort upsert, so both need healing.
const FIELDS = ['last_done', 'scheduled_for'];

// Normalise any date-ish value to a YYYY-MM-DD calendar day, or null.
// Handles SharePoint datetimes ("2025-09-22T07:00:00Z"), plain dates,
// empty strings and null/undefined.
function normDate(v) {
  if (v == null) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * @param {Array<Object>} spItems  SharePoint rows, normalised to snake_case
 *   ({ sp_item_id, title, last_done, scheduled_for, ...passthrough }).
 * @param {Array<Object>} sbRows   Supabase maintenance_yearly rows.
 * @returns {{updates: Array, inserts: Array, conflicts: Array}}
 *   updates:   { sp_item_id, title, changes: { field: { from, to } } }
 *   inserts:   the normalised SP item (present in SharePoint, missing in Supabase)
 *   conflicts: { sp_item_id, title, field, sp, supabase }  (SP null, SB non-null)
 */
function computeReconciliation(spItems, sbRows) {
  const sbByKey = new Map(
    (sbRows || [])
      .filter((r) => r && r.sp_item_id != null)
      .map((r) => [String(r.sp_item_id), r]),
  );

  const updates = [];
  const inserts = [];
  const conflicts = [];

  for (const sp of spItems || []) {
    if (!sp || sp.sp_item_id == null) continue;
    const key = String(sp.sp_item_id);
    const sb = sbByKey.get(key);

    if (!sb) {
      inserts.push(sp);
      continue;
    }

    const changes = {};
    for (const field of FIELDS) {
      const spVal = normDate(sp[field]);
      const sbVal = normDate(sb[field]);
      if (spVal === sbVal) continue;
      if (spVal == null && sbVal != null) {
        // SharePoint blank, Supabase has a value — don't erase; flag it.
        conflicts.push({ sp_item_id: key, title: sp.title ?? sb.title ?? null, field, sp: spVal, supabase: sbVal });
        continue;
      }
      changes[field] = { from: sbVal, to: spVal };
    }
    if (Object.keys(changes).length > 0) {
      updates.push({ sp_item_id: key, title: sp.title ?? sb.title ?? null, changes });
    }
  }

  return { updates, inserts, conflicts };
}

module.exports = { computeReconciliation, normDate, FIELDS };
