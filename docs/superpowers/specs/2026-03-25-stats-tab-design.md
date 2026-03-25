# Stats Tab — Design Spec

**Date:** 2026-03-25
**Project:** Repose Production Tracker (`index.html`)
**Status:** Approved

---

## 1. Overview

A password-protected Stats tab added to the existing three-tab navigation (Team View, Load Plan, Stats). Intended for both floor supervisors (daily checks) and managers (weekly/monthly review). Shows completion counts, per-person breakdowns, spec change history, and scrap log — with manager actions available from within the detail views.

---

## 2. Access Control

**Type:** Client-side password gate — UI lock only, not cryptographic security. Adequate for keeping factory floor staff out; not intended to protect against determined access.

**Implementation:**
- Constant in code: `const STATS_PASSWORD = '<placeholder>'` — to be set by user
- Tapping the Stats tab opens a password modal if not already unlocked
- Correct password sets an in-memory JS variable `statsUnlocked = true`
- Resets to locked on every page reload (not persisted to localStorage)
- Wrong password shows an error shake animation, no lockout limit

**Future:** Option B (Azure Static Web Apps route-level auth with Entra ID) noted for Phase 2 deployment.

---

## 3. Layout Structure

### 3.1 Navigation
Stats tab added to top nav bar alongside Team View and Load Plan. Same visual style as existing tabs.

### 3.2 Dashboard (entry view)
Displayed after successful password entry. Contains:
- **Period toggle** at top: `This Week` / `This Month` / `This Year` — applies to all four cards and all detail views
- **Manual refresh button** — re-fetches all three SharePoint lists without page reload
- **Loading spinner** shown during data fetch
- **Four summary cards** in a 2×2 grid:

| Card | Summary shown | Tap action |
|---|---|---|
| Completions | Total jobs done this period | → Completions detail |
| Per Person | Top 3 operators this period | → Per Person detail |
| Spec Changes | Count of changes detected | → Spec Changes detail |
| Scrap | Count of scrap instances | → Scrap detail |

### 3.3 Detail Views
Accessed by tapping a dashboard card. Back arrow returns to dashboard. Period selection carries through from dashboard.

**Completions detail**
- Table: one row per team, showing job count for the period
- Each team row is tappable/expandable to show per-person breakdown
- Woodmill and QC rows: total count only, no per-person expansion
- All other teams: expand to show operator name + count, sorted descending
- Read only — no manager actions

**Per Person detail**
- Full list of all operators across all eligible teams (all except Woodmill and QC)
- Columns: Full Name, Team, Count
- Sorted by count descending
- Read only

**Spec Changes detail**
- List of all detected spec changes in the selected period
- Each entry shows: REP number, field that changed, old value → new value, date detected
- Two inline action buttons per entry:
  - **Dismiss** — marks alert as `acknowledged` in `SpecAlerts` SharePoint list (same as Team View Acknowledge button)
  - **Already Scrapped** — logs entry to `ScrapLog` list and marks alert as `scrapped` (same as Team View Already Produced button)
- Actions are guarded against double-tap (button disabled immediately on press)

**Scrap detail**
- List of all scrap entries in the selected period
- Each entry shows: REP number, team, field that triggered it, date logged
- One inline action per entry:
  - **Delete** — permanently removes the item from the `ScrapLog` SharePoint list
  - Requires a confirmation step (e.g. inline confirm/cancel) to prevent accidental deletion

---

## 4. Data Layer

### 4.1 Fetching
On Stats tab open (after password), three parallel Graph API calls:
```
GET /sites/{site}/lists/ProductionCompletions/items?$expand=fields&$top=999
GET /sites/{site}/lists/SpecAlerts/items?$expand=fields&$top=999
GET /sites/{site}/lists/ScrapLog/items?$expand=fields&$top=999
```

All filtering is client-side. Dates stored as `dd/mm/yyyy` strings are parsed to JS Date objects for comparison. No server-side `$filter` — avoids 400 errors on unindexed columns.

### 4.2 Period Filtering
| Period | Logic |
|---|---|
| This Week | ISO week matching today's ISO week number |
| This Month | Same calendar month and year as today |
| This Year | Same calendar year as today |

### 4.3 Aggregation
All grouping and counting done in JS after fetch:
- Completions by team: group `ProductionCompletions` by `Team`, count
- Per person: group by `Team` + `Initials`, map initials to full name
- Spec changes: filter `SpecAlerts` by parsed `DetectedAt` date
- Scrap: filter `ScrapLog` by parsed `LoggedAt` date, group by `Team`

### 4.4 Performance
Acceptable for first 12 months of data (hundreds to low thousands of records). If response times degrade, mitigation is to add an indexed date column to each SharePoint list and move filtering server-side via `$filter`. No action needed at build time.

---

## 5. Operator Name Lookup

Same pattern as existing `TEAM_OPERATORS` constant. A new `STATS_OPERATORS` map:

```js
const STATS_OPERATORS = {
  Foam:        { 'AB': 'Alice Brown',  'CD': 'Chris Davis'  },
  Cutting:     { 'EF': 'Eve Foster',   'GH': 'George Hall'  },
  Sewing:      { 'IJ': 'Ian Jones',    'KL': 'Karen Lewis'  },
  Upholstery:  { 'MN': 'Mark Newton',  'OP': 'Olivia Price' },
  Assembly:    { 'QR': 'Quinn Reid',   'ST': 'Sarah Thomas' },
};
```

Placeholder names used at build time. User to provide real names per department — updated the same way as `TEAM_OPERATORS`.

Woodmill and QC are excluded from per-person stats. Completions with initials not found in the lookup are displayed as the raw initials string.

---

## 6. Reuse of Existing Functions

The following functions are called directly from Stats tab actions — no duplication:
- `acknowledgeAlert(alertId, btn)` — Dismiss button in Spec Changes detail
- `logScrapAndDismiss(alertId, btn)` — Already Scrapped button in Spec Changes detail
- `getSpSiteId()`, `getListIdByName()`, `getGraphToken()` — all Graph API calls
- `toast(msg, type)` — success/error feedback

---

## 7. Visual Style

Follows existing app design language:
- Navy topbar (`#0e023a`), Repose Blue (`#14a1e9`) for interactive elements
- Completion green (`#059669`) for done states
- Warning amber (`#d97706`) for spec change entries
- Same card/border/radius patterns as Team View

Dashboard cards use a 2×2 grid on tablet landscape. Stack to single column on narrow viewports.

---

## 8. Out of Scope

- CSV export from stats (completions export already exists in Team View)
- Push notifications or email alerts
- Power BI integration (Phase 3)
- Per-week or per-day trend charts/graphs
- Filtering by individual operator from dashboard

---

## 9. Open Items

- Final password value — placeholder `'repose'` used until user confirms
- Real operator names per department — placeholder map used until user provides list
