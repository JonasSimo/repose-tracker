# Stats Tab — Design Spec

**Date:** 2026-03-25
**Project:** Repose Production Tracker (`index.html`)
**Status:** Approved

---

## 1. Overview

A password-protected Stats tab added to the existing three-tab navigation (Team View, Load Plan, Stats). Intended for both floor supervisors (daily checks) and managers (weekly/monthly review). Shows completion counts, per-person breakdowns, spec change history, and scrap log — with manager actions available from within the detail views.

---

## 2. Access Control

**Type:** Client-side password gate — UI lock only, not cryptographic security. Adequate for keeping factory floor staff out; not intended to protect against determined access. The password is stored as a plain-text constant in the JS source, which is publicly downloadable from the hosted URL — acceptable for this use case.

**Implementation:**
- Constant in code: `const STATS_PASSWORD = 'repose'` — placeholder, user to confirm final value
- Module-level variable: `let statsUnlocked = false`
- Tapping the Stats tab (or navigating to it via any routing mechanism) checks `statsUnlocked`. If `false`, shows the password modal before rendering any stats content. If `true` (already unlocked this session), renders the dashboard directly — no re-prompt within the same session.
- Correct password sets `statsUnlocked = true` and renders the dashboard
- Resets to `false` on every page reload (not persisted to localStorage)
- Wrong password shows an error shake animation on the input, no lockout limit

**Future:** Azure Static Web Apps route-level auth with Entra ID noted for Phase 2 deployment.

---

## 3. Layout Structure

### 3.1 Navigation
Stats tab added to top nav bar alongside Team View and Load Plan. Same visual style as existing tabs (navy background, white text, Repose Blue active indicator).

### 3.2 Dashboard (entry view)
Displayed after successful password entry. Contains:
- **Period toggle** at top: `This Week` / `This Month` / `This Year` — applies to all four cards and all detail views
- **Manual refresh button** — re-fetches all three SharePoint lists without page reload
- **Loading spinner** shown during data fetch on tab open and on manual refresh
- **Four summary cards** in a 2×2 grid (stacks to single column on narrow viewports):

| Card | Summary shown | Tap action |
|---|---|---|
| Completions | Total jobs done this period | → Completions detail |
| Per Person | Top 3 operators this period | → Per Person detail |
| Spec Changes | Count of changes detected | → Spec Changes detail |
| Scrap | Count of `ScrapLog` rows this period (one row per scrapped field, not distinct REPs) | → Scrap detail |

### 3.3 Detail Views
Accessed by tapping a dashboard card. A back arrow returns to the dashboard. Period selection carries through from the dashboard and cannot be changed in detail views.

**Exclusion list:** A single constant `const STATS_NO_PER_PERSON = ['Woodmill', 'QC']` governs both the Completions detail (no expand) and the Per Person aggregation (excluded entirely). Both sections reference this same constant.

---

**Completions detail**
- Table: one row per team, showing job count for the period (filtered by `CompletedDate`)
- Sub-team breakdown is not shown — all sub-teams within a team are aggregated together
- Each team row is tappable to expand and show per-person breakdown
- Teams in `STATS_NO_PER_PERSON` (Woodmill, QC): total count only, no expand affordance
- All other teams: expand to show operator full name (via `STATS_OPERATORS` lookup) + count, sorted descending
- Operators whose initials are not in `STATS_OPERATORS` for their team are shown with raw initials
- Teams not present in `STATS_OPERATORS` at all: shown in Completions total; raw initials shown in per-person expand (not silently dropped)
- Read only — no manager actions

---

**Per Person detail**
- Full list of all operators across all teams NOT in `STATS_NO_PER_PERSON`
- Columns: Full Name, Team, Count
- Sorted by count descending
- Operators with initials not in `STATS_OPERATORS`: shown with raw initials and team name
- Teams not present in `STATS_OPERATORS`: included with raw initials (not dropped)
- Sub-team breakdown not shown — aggregated at team level
- Read only

---

**Spec Changes detail**
- List of all `SpecAlerts` entries where `DetectedAt` falls within the selected period
- Fetched without status filter — all statuses included (see Section 4.1)
- Each entry shows: REP number, field that changed, old value → new value, date detected
- Entries with `Status === 'unread'`: show two action buttons
- Entries with `Status === 'acknowledged'` or `'scrapped'`: shown greyed, no action buttons
- Two inline action buttons per unread entry:
  - **Dismiss** — calls `statsAcknowledgeAlert(alert, btn)`: PATCHes `SpecAlerts` item `Status` → `'acknowledged'`, removes from `SPEC_ALERT_SENT` cache, updates entry in `STATS_ALERTS` in-memory, re-renders the Stats detail view. Does NOT call `acknowledgeAlert()` directly — that function mutates `SPEC_ALERTS` (Team View global) and calls `renderSpecAlerts()` (Team View renderer).
  - **Already Scrapped** — calls `statsLogScrapAndDismiss(alert, btn)`: writes a new `ScrapLog` item using data from the alert object in memory (`alert.rep`, `alert.jobNo`, `alert.week`, `alert.prep`, `alert.fieldLabel`, `alert.oldVal`, `alert.newVal`), then PATCHes `SpecAlerts` item `Status` → `'scrapped'`, updates `STATS_ALERTS` in-memory, re-renders. `Team` is written as `''` (empty string) because the `SpecAlerts` list does not store which team the job belongs to; this is a known limitation in the Stats context. Does NOT call `logScrapAndDismiss()` directly (same reason as above).
- Valid `SpecAlerts.Status` values: `'unread'` | `'acknowledged'` | `'scrapped'`
- Actions are guarded against double-tap (button disabled immediately on press)
- After a successful action, the entry is updated in-memory and re-rendered (greyed, no buttons) without a full re-fetch

---

**Scrap detail**
- Flat list of all `ScrapLog` rows where `LoggedAt` falls within the selected period (not grouped by team)
- Each entry shows: REP number (`Title` field), team (`Team` field), field that triggered it (`FieldLabel`), date logged (`LoggedAt`)
- The SharePoint item `id` (top-level field on each Graph API list item response, outside `fields`) is retained in memory for each entry and used for delete calls
- One inline action per entry:
  - **Delete** — permanently removes the item via `DELETE https://graph.microsoft.com/v1.0/sites/{siteId}/lists/{listId}/items/{id}`
  - Shows inline confirm/cancel (replaces the Delete button) before executing, to prevent accidental deletion
  - On confirm: calls the Graph API delete, removes the entry from `STATS_SCRAP` in-memory, re-renders the list
  - On success: `toast('Scrap entry deleted', 's')`; on failure: `toast('Could not delete — check connection', 'u')` and button re-enabled

---

## 4. Data Layer

### 4.1 Fetching
On Stats tab open (after password), three parallel fetches using a new `graphGetAll(url)` utility. All three calls must include `?$expand=fields&$top=999`:
```
graphGetAll(`…/lists/ProductionCompletions/items?$expand=fields&$top=999`)
graphGetAll(`…/lists/SpecAlerts/items?$expand=fields&$top=999`)
graphGetAll(`…/lists/ScrapLog/items?$expand=fields&$top=999`)
```

Each Graph response item has two parts: `item.id` (top-level, the SharePoint item ID used for PATCH/DELETE calls) and `item.fields` (the list column values used for display and filtering). Both are available when `$expand=fields` is included.

**Important:** Stats fetch of `SpecAlerts` retrieves all statuses — do not apply the `Status === 'unread'` filter used by the Team View's `fetchSpecAlerts()`.

Results stored in module-level variables: `STATS_COMPLETIONS`, `STATS_ALERTS`, `STATS_SCRAP`.

All filtering is client-side. Date strings (`dd/mm/yyyy` or `dd/mm/yyyy HH:mm`) are parsed to JS Date objects for comparison. No server-side `$filter` — avoids 400 errors on unindexed columns.

**`graphGetAll(url)` utility:**
A new function wrapping `graphGet`. Fetches the first page, then follows `@odata.nextLink` in a loop until exhausted, concatenating all `value` arrays. Used only by the Stats data fetch. Returns a flat array of all items.

```js
async function graphGetAll(url) {
  let items = [];
  let nextUrl = url;
  while (nextUrl) {
    const page = await graphGet(nextUrl);
    items = items.concat(page.value || []);
    nextUrl = page['@odata.nextLink'] || null;
  }
  return items;
}
```

### 4.2 Period Filtering

Date field used per list:
- `ProductionCompletions` → `CompletedDate` (when the job was marked done)
- `SpecAlerts` → `DetectedAt`
- `ScrapLog` → `LoggedAt`

| Period | Logic |
|---|---|
| This Week | `isoWeekNumber(date) === isoWeekNumber(today)` AND `isoWeekYear(date) === isoWeekYear(today)` |
| This Month | `date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()` |
| This Year | `date.getFullYear() === today.getFullYear()` |

Two named helpers extracted to module level from the existing inline ISO week logic. The existing `isoWeekMonday(isoWeek)` helper uses the same year-calculation — the new functions must be consistent with it to avoid week-boundary disagreements (early January / late December where ISO week year differs from calendar year). Prefer refactoring `isoWeekMonday` to call these helpers rather than duplicating the logic:
```js
function isoWeekNumber(d) { /* returns 1–53 */ }
function isoWeekYear(d)   { /* returns the ISO week year (may differ from d.getFullYear() near year boundaries) */ }
```

### 4.3 Aggregation
All grouping and counting done in JS after fetch and period filtering:
- Completions by team: group `STATS_COMPLETIONS` by `Team` field, count items
- Per person: group by `Team` + `Initials`, map initials → full name via `STATS_OPERATORS`
- Spec changes: filter `STATS_ALERTS` by `DetectedAt` date (all statuses)
- Scrap: filter `STATS_SCRAP` by `LoggedAt` date (flat list — "group by Team" applies only to the dashboard card summary count display, not the detail view)

### 4.4 Performance
Acceptable for first 12 months of data (hundreds to low thousands of records). `graphGetAll` ensures correctness beyond 999 records. If response times degrade at scale, mitigation is to add an indexed date column to each list and move filtering server-side.

---

## 5. Operator Name Lookup

A new `STATS_OPERATORS` constant with shape `{ [teamName]: { [initials]: fullName } }` — a two-level object, distinct from `TEAM_OPERATORS` (which is an array of `{ name, initials }` objects used for the operator button UI):

```js
const STATS_OPERATORS = {
  Foam:       { 'AB': 'Alice Brown',  'CD': 'Chris Davis'  },
  Cutting:    { 'EF': 'Eve Foster',   'GH': 'George Hall'  },
  Sewing:     { 'IJ': 'Ian Jones',    'KL': 'Karen Lewis'  },
  Upholstery: { 'MN': 'Mark Newton',  'OP': 'Olivia Price' },
  Assembly:   { 'QR': 'Quinn Reid',   'ST': 'Sarah Thomas' },
};
```

Lookup: `STATS_OPERATORS[team]?.[initials] ?? initials` (falls back to raw initials if not found).

Placeholder names used at build time. User to provide real names per department. Note: the existing `TEAM_OPERATORS` constant in the codebase is currently populated for Cutting only — it cannot be mechanically converted to `STATS_OPERATORS`. All teams must be populated independently when real names are provided.

- Woodmill and QC absent from `STATS_OPERATORS` — also listed in `STATS_NO_PER_PERSON`
- Initials not found in a team's lookup: displayed as raw initials string
- Teams not present in `STATS_OPERATORS` at all: included with raw initials (not silently dropped)

---

## 6. New Functions

| Function | Purpose |
|---|---|
| `statsAcknowledgeAlert(alert, btn)` | Stats-context dismiss: PATCHes SpecAlerts, updates `STATS_ALERTS`, re-renders Stats view |
| `statsLogScrapAndDismiss(alert, btn)` | Stats-context scrap: writes ScrapLog item, PATCHes SpecAlerts, updates `STATS_ALERTS`, re-renders |
| `graphGetAll(url)` | Paginated Graph API fetch — follows `@odata.nextLink` until exhausted |
| `isoWeekNumber(d)` | Returns ISO week number for a date (extracted from existing inline logic) |
| `isoWeekYear(d)` | Returns ISO week year for a date (extracted from existing inline logic) |
| `renderStatsDashboard()` | Renders the 4-card dashboard for the current period |
| `renderStatsDetail(view)` | Renders a detail view (`'completions'`, `'perperson'`, `'changes'`, `'scrap'`) |

## 7. Reuse of Existing Functions

| Function | Used where |
|---|---|
| `getSpSiteId()`, `getListIdByName(name)`, `getGraphToken()` | All Graph API calls in Stats |
| `toast(msg, type)` | Action feedback |

**Not reused:** `acknowledgeAlert()` and `logScrapAndDismiss()` — both operate on Team View globals (`SPEC_ALERTS`, `renderSpecAlerts()`). The Stats tab uses dedicated `statsAcknowledgeAlert` and `statsLogScrapAndDismiss` instead.

---

## 8. Visual Style

Follows existing app design language:
- Navy topbar (`#0e023a`), Repose Blue (`#14a1e9`) for interactive elements
- Completion green (`#059669`) for done states
- Warning amber (`#d97706`) for spec change entries
- Same card/border/radius patterns as Team View

Dashboard cards: 2×2 grid on tablet landscape, single column on narrow viewports.

---

## 9. Out of Scope

- CSV export from stats (completions export already exists in Team View)
- Push notifications or email alerts
- Power BI integration (Phase 3)
- Per-week or per-day trend charts/graphs
- Filtering by individual operator from dashboard

---

## 10. Open Items

- Final password value — `'repose'` used as placeholder until user confirms. Note: password is visible in plain text in the downloaded JS source — acceptable for this use case.
- Real operator names per department — placeholder map used until user provides list
- `Team` field in ScrapLog entries created from Stats tab will be empty string — because `SpecAlerts` does not store which team the job belongs to. If this needs to be populated, `Team` should be added as a column to the `SpecAlerts` SharePoint list and written when an alert is first created.
