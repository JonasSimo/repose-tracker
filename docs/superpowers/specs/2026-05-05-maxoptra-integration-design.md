# Maxoptra Integration — Phase 1 (Read-from + Mark-for-return Email)

**Status:** Draft for review
**Date:** 2026-05-05
**Author:** Jonas Simonaitis (with Claude Code)
**Related:**
- Service Dashboard design — `docs/superpowers/specs/2026-05-04-service-dashboard-design.md` (goals #6 + #7)
- Service Dashboard Phase B+C plan — `docs/superpowers/plans/2026-05-05-service-dashboard-phase-bc.md` (out-of-scope items)
- Reference function — `azure-functions/parts-fedex-poll/index.js` (architectural twin)

## Context

The team uses Maxoptra to plan and execute collection / delivery routes for chairs that need to come back to the factory for repair. Today, when a chair is marked for return on RepNet, the action records intent (`Returned to Factory` date written, REP Number gets `-R` suffix) but nothing flows to Maxoptra and nothing flows back. Transport books the Maxoptra job off ad-hoc emails; Service has no visibility into where the chair is in the collection lifecycle.

This spec covers Phase 1: a one-way **read-from** sync (Maxoptra → RepNet) that surfaces collection status on the ticket plus the small **transport email** that closes the request loop. RepNet creating Maxoptra jobs (write-to) is explicitly Phase 2.

## Goals

1. Surface the live state of a return-collection on the ticket — without anyone refreshing or asking transport.
2. Auto-fill the existing `Returned to Factory` date when Maxoptra reports the chair has physically arrived at the factory.
3. Email transport (John + transport@) automatically when "Mark for return" is clicked, so they know to book the Maxoptra job.
4. Make the Returns Pipeline kanban data-driven, not heuristic.

## Non-goals (Phase 2 or later)

- RepNet creating Maxoptra jobs from "Mark for return" (write-to)
- Maxoptra webhooks for instant updates (timer-poll only for Phase 1)
- Driver name, ETA, vehicle, photo or signature on the pill
- Delivery jobs (factory → customer) — collections only
- Reading Maxoptra jobs that have no REP Number reference
- Two-way reconciliation if status disagrees between RepNet and Maxoptra

## Architecture

One new Azure Function: `azure-functions/service-maxoptra-poll/`. Timer trigger, every 30 minutes. Mirrors the shape of `parts-fedex-poll`.

```
[Timer 0 */30 * * * *]
    │
    ▼
1. Auth to Microsoft Graph (MSAL client credentials — existing pattern)
2. Auth to Maxoptra (API key in Authorization header)
    │
    ▼
3. GET Maxoptra active collection jobs:
     · type = Pickup
     · status NOT IN [Completed, Cancelled, Failed]
     · paginate if >100 results
    │
    ▼
4. Read TICKET LOG used range from SharePoint (single Graph call)
    │
    ▼
5. Build map: REP Number → { row_index, current Maxoptra Status, current Returned to Factory }
    │
    ▼
6. For each Maxoptra job:
     a. repNo = job.reference.trim().toUpperCase()
     b. ticket = ticketsByRepNo[repNo]
     c. No match → log as orphan, continue
     d. Compute friendly pill text via _mapMaxoptraStatus()
     e. If pill text === current → skip (no Graph write)
     f. Else PATCH Maxoptra Job ID + Maxoptra Status + Maxoptra Updated
     g. If status terminal-completed AND Returned to Factory empty
            → also PATCH Returned to Factory with job.completedAt
    │
    ▼
7. Scan TICKET LOG for tickets needing the "waiting" pill:
     · REP No has -R suffix AND no Maxoptra Job ID
     · Set Maxoptra Status = "⏳ Waiting for collection booking" (idempotent — skipped if already set)
    │
    ▼
8. Log structured summary
```

## Schema changes (TICKET LOG)

| Column | Type | Filled by | Purpose |
|---|---|---|---|
| `Maxoptra Job ID` (NEW) | text | Azure Function | Job identifier for traceability + dedupe |
| `Maxoptra Status` (NEW) | text | Azure Function | Friendly pill text rendered as-is on dashboard |
| `Maxoptra Updated` (NEW) | datetime | Azure Function | Last sync timestamp (debug "why is this stale?") |
| `Returned to Factory` (existing) | date | **NOW: Azure Function on completion** (was: button click) | Actual factory arrival date |

**Behaviour change:** The existing "Mark for return" button (`index.html` ~line 21441) currently writes today's date into `Returned to Factory`. This stops. The button will now only update REP Number and trigger the transport email. `Returned to Factory` is filled by Maxoptra completion, or by manual entry if Maxoptra is bypassed.

**Existing data not migrated.** Old rows keep whatever `Returned to Factory` value they have (which may be intent-date or arrival-date depending on team practice). Going forward, the column means "actual factory arrival" consistently.

## Status mapping

The Azure Function computes the friendly pill text and writes it directly to `Maxoptra Status` in TICKET LOG. The dashboard renders the column verbatim — no client-side mapping logic.

| RepNet state | Detection rule | Pill text written |
|---|---|---|
| *(no pill)* | REP No has no `-R` suffix AND no Maxoptra Job ID | *(empty)* |
| Waiting for booking | REP No has `-R` suffix AND no Maxoptra Job ID after 1+ poll cycles | `⏳ Waiting for collection booking` |
| Scheduled | Maxoptra status ∈ {Planned, Scheduled} | `📅 Scheduled · Tue 12 May 14:00` |
| Collected | Maxoptra status ∈ {In Progress, Picked Up, On Way} | `🚚 Collected · returning to factory` |
| In factory | Maxoptra status ∈ {Completed, Delivered} | `✅ In factory · 14 May` |

**Maxoptra status names AND response field names will both be confirmed at implementation time** by hitting the production API and inspecting real responses. Status strings vary by Maxoptra tenant configuration; field names like `job.reference`, `job.status`, `job.scheduledTime`, `job.completedAt` are assumed conventional but the actual JSON shape is not pre-validated in this spec. The function has a `_mapMaxoptraStatus(rawStatus, scheduledTime)` lookup; unmapped statuses produce `❓ {raw status}` so they're visible in both UI and logs and we can extend the mapping fast.

## Polling cron

`schedule: "0 */30 * * * *"` — every 30 minutes on the hour and half-hour.

Rationale: collections take 1-3 days end-to-end, with 4-6 status changes per job. 30-min poll catches changes within ~30 min staleness, well within useful range. Yields ~48 Maxoptra calls/day — light load.

15-min was suggested in the original service-dashboard spec but is overkill for collections. Configurable via `host.json` if we want to tune later.

## Error handling

| Failure | Handling |
|---|---|
| Maxoptra auth fails | Log error, return early. Pick up on next tick. |
| Maxoptra API 5xx | Log + return. |
| Graph token fails | Log + return. (Existing pattern.) |
| TICKET LOG `MaxRequestDurationExceeded` 504 | Retry once with 1.5s backoff (helper already added to `index.html` for browser writes; same logic ported to function). |
| Job's `reference` empty / not REP-shaped | Count as orphan, skip. No write to TICKET LOG. |
| Job's `reference` matches multiple TICKET LOG rows | Pick row with latest Open Date; log warning. |
| Maxoptra returns unmapped status | Pill text = `❓ {raw status}`. Log raw value for mapping update. |
| `Returned to Factory` already filled when Maxoptra reports completion | Don't overwrite. Log discrepancy. |
| `MAXOPTRA_API_KEY` env missing | Log error and return — do not crash worker (avoids host-level outage taking down the rest of the function app). |

## Sandbox / dry-run guard

Same pattern just deployed to `parts-fedex-poll`:

```js
const isProd = (process.env.MAXOPTRA_ENV || 'sandbox').toLowerCase() === 'production';
```

In sandbox mode, the function still authenticates to Maxoptra and reads jobs, but logs every PATCH it *would* perform without writing to TICKET LOG. Lets us deploy with `MAXOPTRA_ENV=sandbox`, observe a few real polls in Application Insights, tune the status mapping table, then flip to `production` with no schema risk.

## Email notification (Mark for return)

Triggered from the browser inside the existing "Mark for return" handler, **after** the TICKET LOG patch + REP No update succeed.

- **Method:** Microsoft Graph `/me/sendMail` — same delegated-auth pattern as the Document Control sends already use
- **TO (both as primary recipients, not CC):** `john.bradnick@reposefurniture.co.uk`, `transport@reposefurniture.co.uk`
- **Subject:** `Collection needed: {REP Number} ({Customer})`
- **Body (HTML, RepNet-branded):**

```
Hi team,

{Customer} have a chair that needs to come back to the factory.

Chair:                 {REP Number}
Customer:              {Customer}
Address:               {address from ticket if present}
Fault:                 {fault code} — {sub-fault}
Marked for return by:  {user name} on {today}

Please book the collection in Maxoptra against reference {REP Number}.
The status will update automatically on RepNet once the job is in Maxoptra.

Open this ticket in RepNet → {ticket drawer link}

— RepNet (auto-generated)
```

- **Failure handling:** if email send fails, the TICKET LOG patch is NOT rolled back. Toast surfaces: *"Ticket marked for return, but transport email failed — please notify John manually."*

## UI changes (`index.html`)

### Status pill

Same `Maxoptra Status` text from TICKET LOG rendered in three locations:

| Location | Treatment |
|---|---|
| Open tickets table — meta line | Small `.svc-mx-pill` next to the chair-# pill, only when row has `-R` suffix REP No |
| Ticket drawer | Full-width status strip near the top, between header and field grid |
| Returns Pipeline kanban "Awaiting collection" column | Card subtitle now shows the Maxoptra Status pill instead of (or alongside) the heuristic "Returned date set · not yet inspected" text. Kanban placement rules unchanged — only the rendered subtitle changes. |

### Pill styling

```css
.svc-mx-pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; }
.svc-mx-pill.waiting    { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
.svc-mx-pill.scheduled  { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.svc-mx-pill.collected  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.svc-mx-pill.in-factory { background: #f0fdf4; color: #14532d; border: 1px solid #86efac; }
.svc-mx-pill.unknown    { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
```

CSS class derived from the leading emoji of the pill text (unambiguous: `⏳` → waiting, `📅` → scheduled, `🚚` → collected, `✅` → in-factory, `❓` → unknown).

### Mark for return modal text update

Line ~21383 in `index.html`:

> Old: *"This will write today's date to the ticket's `Returned to Factory` column…Maxoptra collection booking + transport email will be added in Phase D — for now this records intent only."*
>
> New: *"This will update the REP Number to {nextChairId} and email transport@ + John to book collection in Maxoptra. The status will track here automatically once the job is created."*

## Configuration

New Azure Function App settings (set in Azure Portal → Function App → Environment variables):

| Setting | Value | Notes |
|---|---|---|
| `MAXOPTRA_API_KEY` | (rotated production key) | Set directly in portal — never commit |
| `MAXOPTRA_BASE_URL` | `https://api.maxoptra.com` (or sandbox URL) | Confirm at impl time vs Maxoptra docs |
| `MAXOPTRA_ENV` | `sandbox` initially → `production` once tested | Same guard pattern as FedEx |
| `MAXOPTRA_ACCOUNT_ID` | (if Maxoptra requires a tenant param) | Confirm at impl time |

Existing `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `TICKETS_SHARING_URL` are reused.

## Dependencies

`azure-functions/package.json` already has `@azure/msal-node` and `node-fetch`. **No new npm packages.**

## Maxoptra-side prep (operational, not engineering)

1. Rotate the API key that was pasted in chat earlier
2. Confirm with transport that they will type the REP Number into the Maxoptra `Reference` field on every collection booking — without that, sync silently no-ops
3. Optional: in Maxoptra create a saved view "Collection jobs with reference starting REP" as a sanity-check view

## Logging

Each poll cycle logs one structured summary line plus per-job detail lines (matches `parts-fedex-poll`).

Useful Application Insights queries enabled by this:

- *"How many tickets are stuck in `⏳ Waiting for collection booking` for >24h?"* → flags transport not booking promptly
- *"Which Maxoptra statuses are showing up as `❓ unmapped`?"* → flags mapping table needs extending
- *"What's our orphan-job rate?"* (Maxoptra jobs with no matching ticket) → flags REP-No typos by transport

## Open questions / risks

| Risk | Mitigation |
|---|---|
| Maxoptra status names not yet verified — mapping table is hypothetical until impl | Sandbox guard means the unmapped-status `❓` pill surfaces them safely. First production poll = mapping-table tuning session. |
| Transport may not type REP Number consistently | Operational prep (item 2 above); orphan-job log flag catches it within 30 min of first happening |
| Maxoptra API rate limits unknown | 30-min poll = ~48 calls/day, almost certainly within free-tier; back off + log if 429 |
| Customer address may not be on TICKET LOG row | Email body conditionally includes address; if absent, transport already knows the customer so omission is acceptable |
| `Returned to Factory` semantic change may confuse existing reports / pivots | Existing rows untouched; new behaviour applies to new returns only. Document in QHSE handover note. |

## Out of scope — Phase 2 candidates

- Write-to: RepNet creates Maxoptra jobs from "Mark for return" click directly
- Maxoptra webhooks for sub-minute status freshness
- Driver name / vehicle / ETA on pill
- Delivery jobs (factory → customer) sync
- Photo and signature capture from Maxoptra completion
- Two-way reconciliation when status disagrees
- Service engineer schedule view (goal #15 in service-dashboard spec)
