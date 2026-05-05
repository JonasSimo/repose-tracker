# Assembly Backlog Excel Export — Design

**Date:** 2026-05-05
**Author:** Jonas Simonaitis
**Status:** Approved (pending implementation)

## Problem

The Stats dashboard shows the Assembly team's completion count and lets the user
drill in to see who completed what. There is no quick way to take the list of
Assembly jobs that are still outstanding (overdue or due today) off the
dashboard and onto paper or into Excel for the foreman to work from.

The same number is computed in two places already (Daily Report `backlogByTeam`
and the Stats tab "Outstanding" figure), but only as an aggregate count, never
as an itemised list the user can hand out.

## Goal

Add an "Export Backlog" button on the Assembly tile in the Stats dashboard's
Production tokens grid. Clicking it downloads a CSV file (UTF-8 with BOM,
opens directly in Excel) listing every Assembly job in the production plan
that is overdue or due today and not yet ticked.

## Scope

### In scope
- Single new export action, accessible only from the Assembly tile
- Backlog defined as: jobs in prior weeks + jobs in current week with prep
  day ≤ today's weekday, where the Assembly tick is missing
- Express jobs included when not done (they are always "due now")
- CSV download with seven columns (see below)

### Out of scope
- XLSX (binary) output — the existing pattern in this codebase is CSV with BOM
  and that works in Excel without adding a library
- Equivalent buttons on other team tiles (Cutting, Sewing, etc.) — can be
  generalised later if useful
- Filtering by sub-team — Assembly has no sub-teams (`hasSubs:false` in
  `TEAMS_CFG`)
- Persisting export history or auditing who downloaded what

## Backlog definition

A job at `PROD[wk][prep][ji]` is included in the export when **all** of the
following are true:

1. `wk` is one of the loaded weeks (`WEEKS` global, currently WK 10–13)
2. Either:
   - `wk` is strictly before the current ISO week, OR
   - `wk` is the current ISO week AND `prep` is a numeric prep day (1–5) AND
     `Number(prep) <= todayPrepDay` where `todayPrepDay` is `today.getDay()`
     for Mon–Fri (returns 1–5), OR
   - `prep === 'express'` (express jobs are always considered due)
3. `STATE['Assembly']?.['all']?.[wk]?.[prep]?.[ji]?.done` is falsy

On weekends (`today.getDay()` is 0 or 6) the "today" leg of rule 2 contributes
nothing, so only prior weeks and express jobs are included.

This matches the existing `backlogByTeam['Assembly']` calculation at
`index.html:17529–17558`, with two deliberate differences:
- Existing logic uses `< todayPrepDay`; this spec uses `<= todayPrepDay` so
  today's prep day is included (per user choice "C")
- Existing logic does not iterate the `express` bucket; this spec does

## Output file

- Filename: `repose-assembly-backlog-YYYY-MM-DD.csv` where the date is today
  in local time
- Encoding: UTF-8 with BOM prefix `﻿` (matches existing
  `exportRegisterCSV` at `index.html:15264`)
- MIME type: `text/csv;charset=utf-8`
- Line endings: `\r\n`
- Field quoting: every field wrapped in double quotes; embedded `"` doubled
  (matches existing `exportCSV` at `index.html:7161`)

### Columns (in this order)

| Column     | Source                                              | Example         |
|------------|-----------------------------------------------------|-----------------|
| REP        | `job.rep` (e.g. `"REP 2611160"`)                    | `REP 2611160`   |
| Week       | the `wk` key                                         | `WK 12`         |
| W/C Date   | `PROD[wk].wc` (DD/MM/YYYY string already)           | `16/03/2026`    |
| Prep Day   | `Mon`/`Tue`/`Wed`/`Thu`/`Fri`/`Express`             | `Wed`           |
| Item No    | `job.itemNo`                                         | `8`             |
| Days Late  | working days between job's due date and today (≥ 0) | `3`             |
| Express?   | `Yes` if rep7 is in `EXPRESS_TYPE_MAP`, else blank  | `Yes` / ``      |

`Days Late` calculation:
- For numeric prep days: due date = `WC Date` (Monday) + `(prep - 1)` calendar
  days. Working days late = count of Mon–Fri between (exclusive) due date and
  (inclusive) today.
- For `express`: `Days Late = 0` (treated as due today).
- Today's prep day → `Days Late = 0`.

## Sort order

Primary: `Days Late` descending (oldest backlog first).
Secondary: `REP` ascending (lexicographic on the full `REP NNNNNNN` string).

## Button placement & behaviour

### Markup
Inside `renderStatsDashboard`'s `tokensHtml` map (`index.html:11170`), when
`t.name === 'Assembly'`, append a small chip element to the tile:

```html
<button class="tt-export-btn"
        title="Export outstanding Assembly jobs to Excel"
        onclick="event.stopPropagation(); exportAssemblyBacklogCSV()">
  ⬇ Backlog
</button>
```

### Style
Top-right corner of the tile, absolutely positioned. Background:
`var(--repose-navy)` matching the Assembly tile colour. Text: 10px, white,
600 weight. Padding: `3px 8px`, border-radius `999px`. Disabled (opacity 0.4,
cursor not-allowed, pointer-events none) when the computed backlog count is
zero.

### Click behaviour
- `event.stopPropagation()` prevents the tile's existing
  `onclick="statsSetTeamFilter('Assembly')"` from firing
- Calls `exportAssemblyBacklogCSV()`
- Shows a `toast()` confirmation (`'Backlog exported — open in Excel'`,
  matching existing pattern at `index.html:7200`)
- If backlog count is zero, the button is disabled — no click handler fires

### Tile click area unchanged
Drill-in still works by clicking anywhere else on the tile.

## Implementation surface

### New code
- One function `exportAssemblyBacklogCSV()` placed adjacent to existing
  `exportCSV()` near `index.html:7161`
- One CSS rule for `.tt-export-btn` placed near other `.tt-*` rules

### Modified code
- `renderStatsDashboard` (`index.html:11134`) — inject the button markup only
  for the Assembly tile, and compute the Assembly backlog count in the same
  pass so the disabled state is correct

### Unchanged
- `TEAMS_CFG`, `PROD`, `STATE`, `WEEKS`, `EXPRESS_TYPE_MAP`, `STATS_COMPLETIONS`
  globals are read-only here
- No SharePoint/Graph API calls — purely client-side from already-loaded data
- No new external dependencies

## Edge cases

- **No backlog**: button disabled, click does nothing
- **Weekend**: today contributes no prep day, so backlog only includes prior
  weeks + express
- **Job has no `itemNo`** (theoretical): export blank in that column rather
  than failing
- **`PROD[wk].wc` missing or malformed**: `Days Late` falls back to `0`,
  W/C Date export blank
- **User clicks while STATE is mid-update from a SharePoint sync**: snapshot
  is read synchronously at click time; one stale row is acceptable — the
  next click will reflect the updated state
- **Reps appearing in `STATE` but not in `PROD`**: not relevant — we iterate
  PROD, not STATE
- **Same REP appearing twice in PROD across weeks**: each occurrence is its
  own row in the export (matches how the dashboard counts it)

## Testing checklist

Functional:
- [ ] Button visible only on Assembly tile, not on other team tiles
- [ ] Clicking the button does NOT trigger the Assembly drill-in detail view
- [ ] Clicking elsewhere on the Assembly tile still opens the detail view
- [ ] Downloaded file opens cleanly in Excel with no encoding artefacts
- [ ] First row is the header row; subsequent rows are data
- [ ] Row count equals the number of outstanding Assembly jobs per definition
- [ ] Sort order: oldest first, then by REP
- [ ] Express jobs marked `Yes` in the Express? column
- [ ] Button is disabled and visually greyed when backlog is zero
- [ ] Toast confirmation appears after download

Date-edge:
- [ ] Test on Monday: backlog includes prior weeks + Mon prep day only
- [ ] Test on Friday: backlog includes prior weeks + Mon–Fri prep days
- [ ] Test on Saturday: backlog includes prior weeks + express only
- [ ] Test mid-week with one job ticked: that job is excluded

Visual:
- [ ] Chip does not overflow the tile in narrow viewports (mobile/tablet)
- [ ] Chip's hover state is distinguishable from the tile's hover state

## Risks

- **Definition drift**: If `backlogByTeam` logic in the Daily Report is
  later changed but this export is not, numbers may diverge. Mitigation: the
  spec deliberately documents the small differences (today included, express
  included) so a future maintainer can reason about them.
- **Click-through bug**: if `event.stopPropagation()` is forgotten, every
  export click also opens the detail view — minor but jarring. Caught by the
  testing checklist above.
- **CSV vs XLSX expectations**: the user said "Excel file" but the
  established pattern is CSV-with-BOM, which Excel opens correctly. Spec
  acknowledges this and stays with CSV.

## Open items

None.
