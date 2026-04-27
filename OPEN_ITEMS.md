# RepNet — Open Items (not implemented)

Tracking list of issues found across the 7 review rounds that are **intentionally unfixed** because they need either a product decision, a SharePoint schema change, or an architectural shift that's too big for a single in-review fix.

Last updated after round 7.

---

## 1. CPAR sequence number race

**Severity:** MEDIUM (multi-user correctness)
**Where:** `getNextCPARRef` at index.html:10515 (approx)
**Reinforced in round 7:** Multi-tab scenario on the same browser also produces this race — both tabs read the same `cpar_max_ref` from localStorage, fetch the same live list, compute the same max, and emit the same `RP-XXXXX`.

**What happens:** Two users on two devices (or two browser tabs on one device) submitting a CPAR within the same ~second will both get the same ref number. Results in duplicate ref numbers in SharePoint. Display side shows both — they just have the same identifier.

**Blocker to fixing:** Needs a dedicated counter SharePoint list item that is PATCHed atomically with an `If-Match` ETag check to serialise increments. Or a timestamp-suffixed ref (e.g. `RP-1729712345678`) that is guaranteed unique. Either approach needs alignment with how the CPAR ref is used externally (emails, printed reports) before implementation.

---

## 2. Non-QC overview badge taps ephemeral

**Severity:** HIGH (data-loss-like — but may be intentional)
**Where:** `ovToggle` at index.html:6622

**What happens:** When a QC user taps a non-QC department badge (e.g. Assembly, Foam, Woodmill) in the Overview grid, the change persists locally in `rep.s[dept]` but is wiped on the next 10-minute full refresh (which re-derives `rep.s` from `STATE`). Only QC taps on mech/accessory deliveries have a proper persistence path (`mechQCDone`/`accQCDone`).

**Blocker to fixing:** Needs a product decision:
- Should these taps persist? If yes, need a new persistence channel (can't retrofit into existing team-specific STATE).
- Or should non-QC badges not be clickable at all? Current UI has `cursor:pointer` + `onclick` on them which sets a user expectation of persistence.

---

## 3. SPEC_NOISE regex too permissive

**Severity:** MEDIUM (alert suppression)
**Where:** `SPEC_NOISE = /DELIVERED|ORDERED|STOCK/i` at index.html:7648

**What happens:** `specAlertIsNoise` uses substring matching. A fabric field value containing "STOCK" (e.g. "Stockholm Blue", "STOCK-BRN", or a description "In Stock") would be silently suppressed from spec change alerts.

**Blocker to fixing:** Needs your confirmation on what legitimately appears in the value fields. If the supply-status field always has exactly `ORDERED FROM X` / `DELIVERED` / `STOCK`, we could anchor to start-of-string: `/^(DELIVERED|ORDERED|STOCK)\b/i`. If we want to be fully safe, filter by `FieldKey` instead of value content (noise is a property of which field changed, not the value).

---

## 4. Duplicate SharePoint rows on simultaneous tick

**Severity:** MEDIUM (audit integrity, not live data integrity)
**Where:** `saveCompletionToList` at index.html:5695

**What happens:** Two devices ticking the same job at the same moment both see `s.startItemId === null` and both POST a new row. Display dedup (by date) handles this correctly — only one appears ticked in the UI. But SharePoint accumulates duplicate rows forever, confusing manual audits and growing the list unnecessarily.

**Blocker to fixing:** Would need either a SP unique index on (Team, REP, Week, Prep), or a post-POST cleanup query that DELETEs extra rows — but the latter risks deleting legitimate re-completions after undos.

---

## 5. Stats chart leak catcher could miss very rapid renders

**Severity:** LOW (minor UX at very high click rate)
**Where:** `statsDestroyCharts` at index.html:7383 (already tracks `_statsDetailTimers` post-round 6)

**What happens:** Now largely mitigated by `statsScheduleDraw` that tracks pending timers. Remaining theoretical edge case: if somehow a chart-create is scheduled outside `statsScheduleDraw`, it'd leak briefly. All known chart-creates go through the helper now.

**Blocker to fixing:** Nothing — essentially fixed. Keeping here as a regression-watch note: any new chart-create code should use `statsScheduleDraw`, not raw `setTimeout`.

---

## 7. Maintenance dashboard (2026-04-27) — known leftovers

**Status:** dashboard is live and functional; these are minor follow-ups.

- **Development team not yet wired:** `MT_TEAMS` registry has only Woodmill + Cutting. Adding Development requires (a) a `DEV_MACHINES` constant with each machine's id/name/group/checks, and (b) `DEVInspections` + `DEVDowntime` SharePoint Lists on the Quality site. Both deferred until Jonas confirms the Development machine list.
- **Legacy dead helpers:** Task 17 removed the standalone Woodmill + Cutting Checks dashboards but intentionally left `wmSetView`, `wmStepBack`, `wmStepForward`, `ccSetView`, `ccStepBack`, `ccStepForward`, `wmToggleDowntime`, `wmOnOpen`, `ccOnOpen` in place. They have no callers now and reference deleted functions — safe but should be cleaned up in a follow-up PR after a soak period.
- **Complaints print rule too greedy:** `body > *:not(#view-complaints) { display:none !important }` at index.html ~line 2496 fires on ANY `window.print()` and was hiding the maintenance audit PDF. Worked around by boosting maintenance-print specificity (commit b0b742f). Proper fix is to scope the complaints rule to `body.cp-printing > ...` and have the complaints export set/clear that class — left for future cleanup since both flows now coexist correctly.
- **Yearly "Scheduled" semantics:** Jonas asked how to log specific-date scheduled inspections (e.g. "LOLER booked for 12 May 2027") — currently next-due is always computed from `LastDone + Frequency`. Optional `ScheduledFor` override field deferred (he said "leave it as-is for now").
- **LastDone vs history mismatch:** if a user sets `LastDone` directly via the edit form (instead of using "✓ Mark complete"), the calendar doesn't show that date as Completed because Completed is read from `MaintenanceYearlyHistory`. Same product decision deferred.

---

## 6. Two separate document click handlers

**Severity:** LOW (maintenance/readability)
**Where:** index.html:3439 and index.html:15572

**What happens:** Both are top-level, fire once, no leak. But having two separate global click handlers means a future developer could add a third, leading to subtle interaction bugs over time.

**Blocker to fixing:** Cosmetic / refactor — would consolidate into one handler with multiple branches. Not urgent.

---

## Notes on what was fixed across rounds 1–7

~30 fixes shipped:
- Security: XSS in people picker, URL param validation (view, sub, team, tab)
- Auth: MSAL redirect error surfacing, interval cleanup on sign-out, token refresh per iter in batch ops
- Concurrency: Graph 429/503 retry with Retry-After, IVN patch endpoint + OData annotation + atomic completion, stats generation counter, undoJob resurrection race + pending-delete tracking, saveCompletionToList STATE re-read, qcSyncing finally pattern, ensureDeliveryStateLoaded guard bypass removal
- Data integrity: parseDdmmyyyy rollover validation, BST date parse in wm/cc modals, mech serial rehydration from Excel AS, outstanding QC filters (MFT/service/accessories), optimistic revert on tmCancel/Restore failure, textarea maxlength attrs
- Perf: parallel 4 week sheet fetch, parallel top-level loads, server-side `$filter=Team eq Assembly`, elimination of 8 redundant Graph calls via parseSheetValues extract
- UX: completion banner for Done idea, Completed badge + assignee on list cards, outstanding QC expandable row, toast on safety-critical submit failure, afterprint cleanup for complaint signature print

All pushed and deployed to main.
