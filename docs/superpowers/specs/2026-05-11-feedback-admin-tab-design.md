# Feedback admin tab — triage UI for RepNet_Feedback

**Status:** designed 2026-05-11, not yet built. Builds on the feedback widget shipped earlier today (commit `72ade08`).
**Prerequisite:** `RepNet_Feedback` SharePoint list exists on `/sites/ReposeFurniture-PlanningRepose` with all 10 columns + `Created` / `Author` built-ins.

## Goal

Give Jonas a single place inside RepNet to review user-submitted feedback, change status, leave private triage notes, and delete spam — without leaving the app for SharePoint.

Closes the loop on the feedback widget: users submit → Jonas reviews → users see their reports get worked on (future: email-on-Done).

## Audience

Jonas only, for v1. Gating via a hardcoded allowlist constant — one-line change to grant access to additional people later.

```js
const FEEDBACK_ADMINS = ['jonas.simonaitis@reposefurniture.co.uk'];
```

Other users never see the nav item and the admin JS bundle is loaded conditionally, so payload is also gated (not just visibility).

## Behaviour

### Nav entry

- New sidebar item **"Feedback"** with a chat-bubble glyph (same icon as the FAB), injected at the bottom of the existing nav list, before the user/NMS footer.
- Only rendered when `graphAccount.username` matches `FEEDBACK_ADMINS`.
- Hidden in `.tv-mode` (consistent with the FAB).
- Active-state styling matches the existing `.on` pattern on other nav items.

### Tab layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Feedback                                                ↻ Refresh│
├─────────────────────────────────────────────────────────────────┤
│ [ All 23 ] [ New 7 ] [ Triaged 4 ] [ In Progress 2 ] [ Done 10 ] │
├─────────────────────────────────────────────────────────────────┤
│ #  │ Type │ Title                       │ Submitter  │ Status   │
├────┼──────┼─────────────────────────────┼────────────┼──────────┤
│ 42 │ 🐞   │ Complete button flashes…    │ jonas      │ [New]    │
│ 41 │ 💡   │ Add a 'my jobs' filter      │ tom        │ [Triaged]│
│ 40 │ ❓   │ Why does timer reset?       │ kate       │ [In Prog]│
└────┴──────┴─────────────────────────────┴────────────┴──────────┘
```

- **Filter pills** at top — `All` · `New` · `Triaged` · `In Progress` · `Done`. Default selection: `New`. Count badge next to each label, recomputed on every fetch.
- **Table** sorted by `createdDateTime` desc. Columns:
  - `#` — SP list item ID
  - `Type` — emoji only (🐞 / 💡 / ❓)
  - `Title` — first 80 chars of description (already stored as Title)
  - `Submitter` — left-of-`@` portion of email
  - `Page` — `PageLabel` truncated to 30 chars
  - `Created` — relative time ("2h ago", "yesterday", "3 days ago")
  - `Status` — coloured pill (New=amber, Triaged=blue, In Progress=violet, Done=green, Wontfix=grey)

### Expanded row

Click anywhere on a collapsed row → expands inline. Click again → collapses. Only one row expanded at a time (clicking a different row collapses the previous).

Expanded view, below the row, in a soft inset panel:

```
Full description:
  When I press 'Complete' on a ticket the screen flashes and the row
  disappears before the timer saves. Happens about 1 in 5 times on
  Assembly B tablet, only when offline-queue is pending sync.

Page: Assembly tracker                              [Open page →]

Triage notes:
┌─────────────────────────────────────────────────────────────────┐
│ Reproduced — looks like a race between completeJob() and the    │
│ offline queue flush. _____________________________________      │
└─────────────────────────────────────────────────────────────────┘

[ Triaged ] [ In Progress ] [ Done ] [ Wontfix ]    [ 🗑 Delete ]
```

- **Full description**: preserves line breaks (`white-space: pre-wrap`).
- **Open page link**: `target="_blank"` to `PageUrl`. Useful to land on the exact RepNet page the user was on.
- **Triage notes**: `<textarea>` bound to the `TriageNotes` field, saves on blur (no save button — just lose focus). Debounced 300ms so rapid focus loss doesn't double-PATCH.
- **Status buttons**: four buttons for the four target statuses (the "from" status is always implicit). The current status button is highlighted. Clicking another sends a PATCH and updates the row in place.
- **Delete**: red trash icon on the right. Asks for confirmation via existing `confirm()` (lightweight; we're the only user, no need for a custom dialog).

### Auto-refresh

- While the Feedback tab is visible and the document is not `hidden`, poll the list every 60 seconds.
- Polling pauses immediately when the tab changes or the page is hidden (visibility API + tab-state check).
- Manual refresh button top-right for forced reload.
- The 60s poll is silent — only re-renders if the result differs from the cached payload. No toast spam.

### Empty state

If the current filter returns zero items: show a centred message — *"Nothing to triage in this bucket — nice."* — with a soft icon. Filter pills remain interactive.

## Data flow

| Operation        | Graph call                                                                                                              | Notes                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| List items       | `GET /sites/{siteId}/lists/{listId}/items?$expand=fields&$orderby=createdDateTime desc&$top=200`                       | Caches result for 30s to absorb tab-flipping.  |
| Update status    | `PATCH /sites/{siteId}/lists/{listId}/items/{itemId}/fields` with `{ Status: "<new>" }`                                | Optimistic UI update; reverts on failure.      |
| Save notes       | `PATCH /sites/{siteId}/lists/{listId}/items/{itemId}/fields` with `{ TriageNotes: "<text>" }`                          | Debounced on blur. Toast on failure only.      |
| Delete           | `DELETE /sites/{siteId}/lists/{listId}/items/{itemId}`                                                                  | Removes row immediately; reverts on failure.   |

All four reuse `getGraphToken`, `_graphFetchWithRetry`, `getSpSiteId`, and `getListIdByName('RepNet_Feedback')` already in `index.html`.

## Error handling

- **Graph 401 / token expired**: surface to the existing `getGraphToken` flow (MSAL refresh). User sees nothing.
- **Graph 403 on PATCH/DELETE**: probably permission drift — toast "Can't update — check list permissions". Row reverts to previous state.
- **Graph 404 on PATCH/DELETE**: item was deleted by another session. Drop from local cache, re-render, toast "Item was already removed".
- **Network failure**: toast "Lost connection — try again". Local state preserved (no optimistic update commits until success).
- **Throttling (429/503)**: `_graphFetchWithRetry` already handles Retry-After.

## File layout

```
repnet-feedback-admin.js  ← NEW (~250 lines)
  ├── isFeedbackAdmin()   → boolean check against allowlist
  ├── initFeedbackAdmin() → called from skin-v4 init; wires nav, view container
  ├── renderTab()         → table render + filter pills + counts
  ├── expandRow(id)       → accordion behaviour
  ├── changeStatus(id, s) → optimistic PATCH
  ├── saveNotes(id, txt)  → debounced PATCH
  ├── deleteItem(id)      → confirm + DELETE
  ├── fetchItems()        → GET with 30s cache
  └── startPoll() / stopPoll() → visibility-aware 60s loop

repnet-feedback-admin.css ← NEW (~100 lines)
  └── .fb-admin-* scoped styles; reuses --repose-* tokens

repnet-skin-v4.js         ← edit: add allowlist-gated nav item + view container
index.html                ← edit: 2 lines (<link> + <script>) for the new files
```

No edits to existing nav rendering logic — just append a new entry that's filtered out for non-admins inside `injectSidebar`.

## Testing plan

1. **Visibility gate** — sign in as Jonas → Feedback nav appears. Sign in as anyone else → nav absent, network tab shows no `repnet-feedback-admin.js` load.
2. **Submit feedback** via existing FAB → switch to Feedback tab → new row appears at top with `Status = New`.
3. **Filter pills** — click each, table filters correctly, counts match.
4. **Expand row** — click row, panel opens; click again, closes; click different row, previous collapses.
5. **Status transition** — click `Triaged` on a `New` row, pill colour updates, status persists after refresh.
6. **Notes save** — type in notes textarea, click elsewhere, refresh tab, notes still there.
7. **Open page link** — click "Open page →", correct RepNet view loads in new tab.
8. **Delete** — click trash, confirm, row disappears, refresh confirms it's gone from SP.
9. **Auto-refresh** — open tab, in another browser submit feedback, within 60s the new row appears without manual action.
10. **Tab inactive** — switch to a different RepNet tab, network tab shows polling stopped.
11. **TV mode** — toggle fullscreen Delivery TV, Feedback nav item hidden.

## Things deliberately out of scope for v1

- **TicketRef field editing** — the column exists; UI can be added once you actually start linking to Jira/GitHub issues.
- **Email-on-Done auto-reply** — separate Power Automate / Azure Function piece. Schema already supports it (`Submitter` column).
- **Search box / freetext filter** — at expected volume (<50 open items), filter pills + scrolling is enough.
- **Bulk actions / multi-select** — same reasoning.
- **Type filter** (Bug/Idea/Question) — Type emoji is in the row, you can eyeball quickly.
- **Pagination beyond 200 items** — by the time you have 200 open items, you've got bigger problems.
- **Mobile / tablet layout** — admin work is desktop-only. Tab will still load on mobile but isn't polished.

## Rollout

1. Build behind no flag — only Jonas sees it anyway.
2. Push to main → Azure Static Web App rebuilds.
3. Hard refresh, verify Feedback nav appears for Jonas only.
4. Once stable, optionally add a second admin email to the allowlist.
