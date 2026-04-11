# Job Timing — Design Spec

**Date:** 2026-04-11  
**Status:** Approved for implementation  
**Feature:** Job timing view showing average completion duration per model per team

---

## 1. Purpose

A new "Timing" tab in RepNet visible only to Jonas and Richard Semmens. It shows how long each furniture model takes to complete on average, broken down by team, using data from jobs where a worker tapped Start and then Done. The goal is to understand real production pace per model.

---

## 2. Access Control

The Timing nav button is only injected into the DOM when the signed-in Microsoft account matches an allowed email. No password gate — the email check is sufficient.

```js
const TIMING_ALLOWED = new Set([
  'jonas.simonaitis@reposefurniture.co.uk',
  'richard.semmens@reposefurniture.co.uk',
]);
```

Check performed in `updateAuthBadge()` after MSAL sign-in resolves. If the signed-in email is not in `TIMING_ALLOWED`, the nav button is never added and the view is never reachable.

---

## 3. Data Capture Changes

Two new fields are written to the `ProductionCompletions` SharePoint list when a job is completed. The columns (`StartTime`, `Model`) have already been added to the list by the user.

### 3.1 Changes to `saveCompletionToList()`

Add to the `fields` payload:

```js
StartTime: s.startedAt || '',          // HH:MM — empty if job was never started
Model:     job.spec?.model?.trim() || '',
```

`StartTime` is only populated when the job went through the Start → Done flow. Jobs marked done without tapping Start will have `StartTime: ''` and are excluded from timing stats automatically.

---

## 4. Teams

| Team | Notes |
|---|---|
| Sewing | Tracking now |
| Assembly | Tracking now |
| Cutting | Tracking now |
| Upholstery | Starting next week — tab shows "No timed completions yet" until data arrives. Sub-teams (Arms, Backs, Seats) are combined into one "Upholstery" view. |

---

## 5. UI Layout

### 5.1 Nav

New "Timing" button added to the nav bar, injected only for allowed users after auth resolves.

### 5.2 View Structure

```
┌─────────────────────────────────────────────────────┐
│  Job Timing                                         │
│                                                     │
│  [Sewing] [Assembly] [Cutting] [Upholstery]         │
│                                                     │
│  [Today] [This Week] [This Month] [All Time]        │
│                                                     │
│  Model                  Jobs   Avg      Min    Max  │
│  ─────────────────────────────────────────────────  │
│  Oxford 3 Seater          24   1h 12m   45m  2h 3m  │
│  Cambridge 2 Seater       18   58m      32m  1h 40m │
│  Windsor Armchair          9   43m      28m    55m  │
│  ...                                                │
│                                                     │
│  Based on 51 timed completions                      │
└─────────────────────────────────────────────────────┘
```

### 5.3 Behaviours

- **Team chips**: One active at a time. Switching team re-renders the table immediately (no new fetch).
- **Period chips**: Today / This Week / This Month / All Time. Switching re-renders immediately.
- **Table**: Sorted by Jobs count descending (most-produced model first). Empty state shows "No timed completions yet" when the filtered set is empty.
- **Duration format**: Under 60 min → `43m`. 60 min or over → `1h 12m`.
- **Footer**: "Based on N timed completions" — N is the count of records used after all filters applied.

---

## 6. Duration Calculation

Jobs can span overnight (e.g. started 15:45 Monday, completed 08:20 Tuesday). Duration is calculated in **working minutes**, not raw clock time.

### 6.1 Working hours

| Day | Start | End |
|---|---|---|
| Monday–Thursday | 07:00 | 16:00 |
| Friday | 07:00 | 12:00 |
| Saturday–Sunday | Non-working (skip) |

### 6.2 Same-day vs cross-day detection

The `StartDate` is not stored — only `CompletedDate` (DD/MM/YYYY) is available. Start date is inferred:

- If `CompletedTime >= StartTime` → started and completed **same day** as `CompletedDate`
- If `CompletedTime < StartTime` → started on the **previous working day** before `CompletedDate`

"Previous working day" steps back from `CompletedDate`, skipping Saturday and Sunday.

### 6.3 Working minutes algorithm

**Same day:**
```
durationMin = timeToMin(CompletedTime) − timeToMin(StartTime)
```

**Cross-day:**
```
durationMin =
  workDayEndMin(startDate) − timeToMin(StartTime)     // remaining mins on start day
  + Σ workDayMins(d) for each full working day between start and end
  + timeToMin(CompletedTime) − 7*60                   // mins into end day from 07:00
```

Where:
- `workDayEndMin(d)` = 720 (12:00) if Friday, else 960 (16:00)
- `workDayMins(d)` = 300 if Friday, else 540 for Mon–Thu; 0 for Sat/Sun

### 6.4 Filtering rules — exclude a record if:

- `StartTime` is empty (job was not started via Start button)
- `Model` is empty
- Calculated duration < 1 minute
- Calculated duration > 1440 minutes (24 working hours — implausible, likely a forgotten start tap)

Records passing all filters are grouped by `fields.Model` to compute avg / min / max.

---

## 7. Period Filtering

Reuses `parseDdmmyyyy()` (already in codebase) to parse `fields.CompletedDate` (format: `DD/MM/YYYY`).

| Period | Filter |
|---|---|
| Today | `CompletedDate` = today |
| This Week | `CompletedDate` within current ISO Mon–Sun |
| This Month | `CompletedDate` within current calendar month |
| All Time | No date filter |

---

## 8. Data Loading

When the Timing tab opens (`tmOnOpen()`):

1. If `STATS_COMPLETIONS` is already populated, render immediately.
2. If not, call `loadStatsData()` (same function used by Stats tab) to fetch all completions, then render.

This avoids a duplicate Graph API call when both tabs are used in the same session.

### 8.1 Upholstery filtering

Upholstery sub-teams are stored in the completions list as `Team: 'Upholstery'` (with `SubTeam` varying). Filter by `fields.Team === 'Upholstery'` to combine all sub-teams.

---

## 9. New Functions

| Function | Responsibility |
|---|---|
| `tmOnOpen()` | Called by `showView('timing')`. Ensures data loaded, then renders. |
| `tmRender()` | Reads active team + period chips, filters `STATS_COMPLETIONS`, computes stats, renders table. |
| `tmFormatDuration(min)` | Formats integer minutes as `43m` or `1h 12m`. |
| `tmPeriodFilter(record)` | Returns true if record's `CompletedDate` falls within the active period. |
| `tmCalcDuration(startTimeStr, completedTimeStr, completedDateStr)` | Returns working minutes between start and completion, handling cross-day jobs. Returns null if invalid. |
| `tmPrevWorkingDay(date)` | Returns the Date of the previous Mon–Fri working day before the given date. |
| `tmWorkDayMins(date)` | Returns total working minutes for a given date (540 Mon–Thu, 300 Fri, 0 Sat/Sun). |

---

## 10. New Constants / State

```js
const TIMING_ALLOWED = new Set([
  'jonas.simonaitis@reposefurniture.co.uk',
  'richard.semmens@reposefurniture.co.uk',
]);

let tmActiveTeam   = 'Sewing';
let tmActivePeriod = 'week';   // 'today' | 'week' | 'month' | 'all'
```

---

## 11. CSS

New `.tm-*` class namespace. Follows existing RepNet design tokens (`--bg2`, `--border`, `--text1`, `--text2`, `--repose-blue`, `--green`, etc.). Chip style matches the period chips already used in Stats.

---

## 12. Out of Scope

- Per-person timing breakdown
- Exporting data to Excel or email
- Overtime / weekend shift handling (treated as normal working day — anomaly filter handles edge cases)
- Sub-team breakdown for Upholstery (combined for now)
- Editing or correcting individual timing records
