# Service Dashboard Module — Design Spec

**Date:** 2026-05-04
**Author:** Jonas Simonaitis (QHSE Manager) with Claude
**Status:** Draft — pending Jonas review
**Mockup:** `service-dashboard-mockup.html` (v0.3 — full feature set; v4 design language)
**Target UI:** RepNet v4 — `Bricolage Grotesque` + `Manrope` + `JetBrains Mono`, sidebar nav, pill-shaped interactive elements. See `repnet-design-mockup-v4.html` and `repnet-skin-v4.js`.

## Problem

The Service Department manages two parallel workflows that today live entirely in Excel:

1. **Customer parts dispatch** — `PARTS TRACKER.xlsm` (Service SharePoint site, same as Ticketing Log). Single sheet, ~230 rows. Columns: Date, Customer, PO Number, Sales Ack No, Invoice No, FedEx Tracking, Delivered, Comment. The "Delivered" column is a manually-typed timestamp string (`13.01.26 @ 13.25`) — someone copies it in after checking FedEx.
2. **Service tickets** — `REPO-Q006 — Repose Ticketing Log V2.xlsx` (Service SharePoint site). 20-sheet workbook. Master sheet `TICKET LOG` has ~9,988 rows over multiple years, plus 19 pivot/dashboard sheets (Open list, 13-month dashboard, Mechanism Analysis, MTD, Quality Dashboard, etc.). Tickets are either **Warranty** (834 YTD) or **Chargeable** (311 YTD). Master columns include Open Date, Despatch Date, Customer, REP Number, PO ref, Model, Mech Code, Fault Code, Sub-Fault, Warranty/Chargeable, Owner, Action, Proposed Close Date, Close Date, Days to Complete, Overdue By, Invoice details, Factory Status (Returned to Factory / Inspected / In Production / Return to customer).

This setup has real operational gaps:

- **No live overview** — to see "what's open right now" you open the workbook and refresh pivots. Senior managers don't have a glance-able dashboard.
- **Performance metrics buried** — avg days to close, % within 30-day target, top fault categories all exist as pivots but no one looks at them on a Monday morning.
- **Manual delivery confirmation** — someone visits FedEx tracking page per parcel, types the timestamp into the Excel cell. ~7 parcels in transit at any time.
- **Returned chairs disconnected from production** — when a chair physically comes back for rework, it gets a "Factory Status" cell update on the ticket but doesn't enter the actual Production Plan. Sewing / Upholstery / Assembly teams can't see it in their queues.
- **Transport collection requested by ad-hoc email** — when a chair needs to come back, someone types an email to `transport@`. No audit trail, no link to the ticket.
- **Service-engineer inspection reports live in iAuditor** — exported manually as PDF, attached… somewhere. Not surfaced on the ticket.
- **Maxoptra is the source of truth for delivery routes** — but RepNet doesn't see Maxoptra at all. When Maxoptra marks a return-collection job complete, the ticket Factory Status doesn't update automatically.
- **Repeat-return chairs go unnoticed** — REP2284 has been back 3 times this quarter for the same fault. The pivot tables don't surface this; it would only show up if someone manually pivoted by REP Number, which no one does.
- **No CAPA bridge** — recurring fault patterns (e.g. "5 foam-collapsing on Chatsworth in 30 days") are visible only after the fact in pivots, never auto-surfaced as candidate CAPAs.
- **No customer-facing visibility** — customers email/call asking "where is my chair?" The answer requires looking up Maxoptra + Excel; could be self-serve.

## Goals

The Service Dashboard becomes the operational hub for the entire ticket and parts workflow, while the two existing Excel files **remain the system of record** (RepNet writes back to them; existing pivot tables and external dependencies keep working).

1. Build a **Service tab in RepNet** with a live dashboard surfacing performance KPIs, open tickets, parts in transit, and the returns pipeline.
2. **Read both Excel files** via Microsoft Graph Excel REST API on view-open. 5-min in-browser cache, manual refresh button.
3. **Write back to both Excel files** via Excel REST when the user creates a new ticket / new parts dispatch / marks a chair for return / approves an action — RepNet becomes the only write path going forward, but Excel files keep their shape so existing pivots / formulas / DASHBOARD sheets survive untouched.
4. Surface **performance KPIs** at a glance: open count (split by Inside 30d / Outside 30d), avg days to close (split by Warranty / Chargeable), parts in transit, % within 30-day target.
5. Add a **chair-return workflow** — when a ticket is logged and the chair must come back to the factory, the user assigns a chair number (`REP2284-R1` / `R2` / `R3` format), which routes the chair into the Production Plan + Team View queues alongside new builds.
6. Auto-email **transport@** with the customer address when a chair is marked for return — same Graph `/me/sendMail` we already use for Document Control.
7. Bridge to **Maxoptra** — Azure Function polls Maxoptra Order API every 15 min for jobs tagged with a RepNet ticket number, syncs collection / delivery status back to the ticket Factory Status. v2 = webhook for near-real-time.
8. Bridge to **iAuditor** (Safety Culture) — Phase 1: service engineer exports inspection PDF and uploads on the ticket. Phase 2: Azure Function auto-fetches inspections matching the "Service Engineer — Returned Chair Inspection" template and attaches them by REP Number reference.
9. **Auto-track FedEx parcels** — Azure Function polls FedEx REST API every 30 min for rows in Part Tracker where Delivered is blank, writes back delivery status, signature, ETA. Free FedEx tier covers our volume (~7 parcels in transit, ~30 polls/day max).
10. Surface **repeat-return chairs** with prominent banner alerts and link them to a CAPA-bridge action.
11. Add a **CAPA auto-bridge** — when the same fault code repeats N times in 30 days for the same model, RepNet flags a candidate CAPA suggestion. One click opens a pre-filled CAPA form in the existing CAPA module.
12. Add a **Returns Pipeline kanban** with three columns: Awaiting collection / In factory / Ready to return — every returned chair visible at a glance with current production stage and Maxoptra job status.
13. Add **SLA pre-alerts** — when a ticket is at 80%+ of its proposed-close window with no recent action, surface in the alert banner so issues get caught before they breach.
14. Add a **forecasting panel** — predict next-month opens + parts spend from the 13-month trend; backlog risk band (Healthy / Warning / Breach).
15. Add a **service engineer schedule** — week view aggregating Maxoptra collections + Maxoptra deliveries + iAuditor inspections + manual on-site visits into one calendar.
16. Add a **customer scorecard** — top customers ranked by ticket volume, with warranty/chargeable split, avg days to close, and £ chargeable revenue. Click → customer drill-down page.
17. Add a **mechanism code analysis** panel — top failing mech codes (1203, 1211, 1245…) with model attribution, exposing supplier/design issues.
18. Add **photo attachments per ticket** — IN photos (from customer) + OUT photos (from service engineer post-inspection) stored in `/Service-Photos/{TICKET-NO}/` SharePoint folder.
19. Add a **ticket → original REP build sheet link** — click any chair # to see the original build week, prep day, and which operators built it (Sewing / Upholstery / Assembly initials).
20. Add a **customer-facing public tracking page** — token-secured URL `repose.tracking/t/{ticket-no}/{token}`. No login. Customers see a 5-stage timeline matching their ticket's progress. Reduces "where's my chair?" calls.
21. Add a **weekly digest email** — every Monday 06:00 UK, Azure Function sends an HTML summary of last week's opens/closes, top fault, overdue list, repeat returns, parts spend to the service team + senior managers.
22. Add **Quality module cross-link** — when mechanism-fault count breaches a Quality SPC limit, the Service tab surfaces a link straight to the Quality dashboard. Bidirectional: a Quality-flagged trend can drill back to its source tickets.

## Non-Goals (out of scope for this design)

- **Replacing the Excel files entirely with a SharePoint List system of record** — Jonas explicitly declined; existing pivots, dashboards, and external reporting depend on the file shape. Phase 3 candidate.
- **Customer authentication portal** — the public tracking page is read-only and token-secured; no login flow, no per-customer account portal. Phase 3 candidate.
- **Predictive ML models for fault forecasting** — Phase 3. Forecast in Phase A is a simple 13-month moving average with seasonal adjustment.
- **Inline iAuditor inspection editing** — RepNet displays the iAuditor PDF/findings; editing happens in iAuditor only.
- **Automated parts ordering when stock low** — separate procurement system; out of scope.
- **Multi-currency** — all figures GBP.
- **Mobile app for service engineers** — RepNet stays web-only. The schedule view is mobile-responsive; that's it.
- **Two-way Maxoptra sync where RepNet creates Maxoptra jobs** — Phase 1 is read-only from Maxoptra. Phase 2 candidate to write jobs from RepNet's "Mark for return" action directly into Maxoptra (Maxoptra Order API supports this).

## Roles and Permissions

| Role | Capability |
|---|---|
| **Service team** (e.g. K. Bryce service engineer, customer service operators) | Read dashboard, create tickets, log parts dispatches, mark chairs for return, attach photos / iAuditor PDFs, close tickets. Excel write permission. |
| **QHSE** (Jonas) | All of Service team + raise CAPAs from auto-bridge suggestions, override SLA flags, mark items as systemic / wear-and-tear. |
| **Production / Team leads** (Sewing, Upholstery, Assembly, QC) | See returned chairs in their team queue (already-existing Team View pattern). Update production stage; ticket Factory Status auto-updates. No ticket-level edit. |
| **Senior managers** | Read-only dashboard view + receive weekly digest email. |
| **Customers** (external) | Public tracking page only — token-secured URL per ticket; no login. |

Roles resolve from the existing RepNet auth pattern (Entra ID groups via MSAL). No new auth flow.

## UI placement (RepNet v4)

A new entry in the v4 sidebar `NAV` array (`repnet-skin-v4.js`), under a new **Service** group between *Quality / QHSE* and *Operations*:

```js
{ h: 'Service' },
{ v: 'service',      g: '🔧',    l: 'Service Dashboard' },
```

The view itself is `id="view-service"` in `index.html`. Hash route `#service` (and deep-links like `#service/ticket/TICKET1297` and `#service/customer/CASTELAN`).

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│              RepNet (browser, v4 UI)                        │
│  Service tab · MSAL · Microsoft Graph                       │
└──────┬──────────┬──────────┬──────────┬──────────┬──────────┘
       │          │          │          │          │
       │ read+    │ read+    │ Mail.Send│ public   │ deep-link
       │ write    │ write    │ Graph    │ tracking │ to CAPA /
       │ Excel    │ Excel    │ /me/     │ page     │ Production
       │ REST     │ REST     │ sendMail │ (read-   │
       ▼          ▼          ▼          │ only)    ▼
   ┌────────┐ ┌────────┐ ┌──────────┐  ▼      ┌──────────────┐
   │Ticketing│ │Parts   │ │Transport │       │RepNet         │
   │Log .xlsx│ │Tracker │ │team      │       │(other modules)│
   │         │ │.xlsm   │ │mailbox   │       │               │
   └─────────┘ └────────┘ └──────────┘       └───────────────┘
       ▲          ▲                ▲
       │          │                │
       │ status   │ delivery       │ inspection
       │ updates  │ status         │ PDFs + findings
       │          │                │
   ┌─────────┐ ┌────────┐    ┌──────────┐
   │Maxoptra │ │FedEx   │    │iAuditor  │
   │Order API│ │REST API│    │(Safety   │
   │         │ │        │    │ Culture) │
   └─────────┘ └────────┘    └──────────┘
       ▲          ▲                ▲
       │          │                │
       └──────────┴────────────────┘
                   │
              Azure Functions (poll/sync layer)
              · maxoptra-sync       (15 min)
              · parts-fedex-poll    (30 min)
              · iauditor-pull       (60 min, Phase B)
              · service-weekly-digest (Mon 06:00)
              · service-sla-alerts   (daily 08:00)
              · service-forecast-rebuild (weekly Sun)
```

### Data sources & write paths

| Source | Read | Write | API |
|---|---|---|---|
| `REPO-Q006 Ticketing Log V2.xlsx` (Service site) — sheet `TICKET LOG` | yes (live, every view-open) | yes (RepNet appends new ticket rows + PATCHes Factory Status / Close Date / etc.) | Graph Excel REST `worksheets('TICKET LOG')/usedRange` + `tables('TicketLog').rows/add` |
| `PARTS TRACKER.xlsm` (Service site, same site as Ticketing Log) — sheet `Part Tracker` | yes (live, every view-open) | yes (RepNet appends new parts rows + FedEx auto-poll updates Delivered cell) | Graph Excel REST same pattern |
| Maxoptra Order API | yes (poll every 15 min) | no in Phase A; Phase B might write `mark for collection` jobs back | REST + API key auth |
| FedEx REST API | yes (poll every 30 min for in-transit parcels) | no | REST + API key |
| iAuditor (Safety Culture) | yes (Phase B; Phase A is manual upload) | no | REST + API token |
| `transport@reposefurniture.co.uk` | no read | yes (auto-email) | Graph `/me/sendMail` (existing scope) |
| `/Service-Photos/{TICKET-NO}/` SharePoint folder | yes | yes (upload) | Graph Drive Item API |

### Why Excel-as-record vs SharePoint-List-as-record

We deliberately keep the existing Excel files as the system of record:

- **External dependencies survive** — your pivot tables, the `DASHBOARD` sheet, the `13Mnth` analysis, Mech Code analysis, MTD, Week, Quality Dashboard, FY rollups all reference the master sheets directly. Migrating to a SharePoint List would require rebuilding all of these.
- **Manual edit safety net** — if RepNet has a bug or is temporarily unavailable, your team can open Excel and add a row by hand. RepNet refreshes from the file on every load, so manual edits show up.
- **Audit history preserved** — SharePoint document-library versioning gives 50 major versions, so the file's history is recoverable.
- **Zero schema migration** — no risk of breaking existing reports or external stakeholders.
- **Data shape is stable** — you've been running these workflows for years; the columns work; we don't need to re-design them.

The cost is more careful Excel REST handling — concurrent writes, row appends in a multi-sheet workbook with formulas — but Graph's Excel REST API is designed for this and handles row append cleanly into a defined Table object. We'll convert the master sheets into Excel Tables (one-time setup) so row-append is bulletproof.

## Module-by-module description

### 1. KPI strip (top of page)

Four primary KPI tiles, each with a split-bar showing 2-3 segments:

| Tile | Number | Splits |
|---|---|---|
| **Open tickets** (warn) | 19 (4 overdue · ▲3 vs week) | Inside 30d (12) / Outside 30d (7) |
| **Avg days to close** (pass) | 9d (target 14, ▼1.2) | Warranty (7d) / Chargeable (14d) |
| **Parts in transit** (info) | 7 parcels (2 due today · 1 delayed) | Transit (4) / Delayed (1) / OFD (2) |
| **% within 30-day target** (pass) | 87% (▲4% MTD) | Warranty target (91%) / Chargeable target (74%) |

Plus a secondary 4-mini-tile strip:
- **In returns pipeline** (purple) — chair count
- **Opened this week** — count
- **£ chargeable MTD** (pass) — currency
- **Top fault category MTD** (fail) — category name

KPIs computed in-browser from `_serviceState.tickets` and `_serviceState.parts` (the in-memory cache of the two Excel sheets). No stored aggregates. Period selector (default: current month MTD) re-computes everything for the chosen window.

### 2. Triple alert banner row

Three banners, top-of-page:

- **SLA breach pre-alert (red)** — count of tickets at 80%+ of their proposed-close window with no action logged in last 5 days. Click → filter Open Tickets to SLA-risk.
- **Repeat-returns / CAPA suggestion (amber)** — chairs back twice or more in current quarter. Click → opens CAPA module pre-filled with suggested investigation.
- **Forecast (blue)** — next-month predicted opens + parts spend. Click → expands forecast detail panel.

Each banner is dismissible per-session via local state.

### 3. Returns Pipeline kanban

Three columns, fed from tickets where `Factory Status != ''` and current chair-return state. Cards show:
- Chair # badge (`REP2284-R3` orange pill)
- Repeat-return badge (red, if R2+)
- Type pill (Warranty / Chargeable)
- Customer + fault category
- Current production team + day-N-of-M (e.g. "Sewing · day 1/3") OR Maxoptra job number
- ETA date

| Column | Trigger | Source |
|---|---|---|
| Awaiting collection | `Factory Status == ''` AND `MarkedForReturn == true` | Ticketing Log + Maxoptra job lookup |
| In factory | `Factory Status IN ('Chair Returned', 'Inspected', 'In Production')` | Ticketing Log + Production module read |
| Ready to return | `Factory Status == 'Return to customer'` AND not yet delivered | Ticketing Log + Maxoptra delivery lookup |

Filter chips: All / Warranty / Chargeable.

### 4. Service Engineer Schedule (week view)

Calendar grid: hours 08:00–16:00 × days Mon–Fri. Coloured events:
- 🟠 Collection (Maxoptra)
- 🟢 Delivery (Maxoptra)
- 🟣 iAuditor inspection (scheduled in iAuditor)
- 🔵 Site visit (manual entry by service engineer)

Pulled from:
- Maxoptra Order API (collections + deliveries with `RETURN` tag)
- iAuditor scheduled audits (Phase B; Phase A is manual entry)
- A new SharePoint List `ServiceEngineerSchedule` for manual entries

Click any event → opens linked ticket drawer or schedule-detail modal.

### 5. Open Tickets table

Sorted by SLA risk (most urgent first):
1. Overdue (past Proposed Close Date)
2. SLA risk (>80% of close window with no recent action)
3. Inside 30 days
4. Other

Columns: Ticket # · Issue+Customer (with Chair # badge if applicable) · Type (Warr/Chrg) · Period (In30/Out30) · SLA/Age.

Filter chips: All · SLA risk · Overdue · In30d · Out30d · Warranty · Chargeable · Going back · Awaiting parts.

Search box: substring on Ticket No, Customer, REP No, Description.

Click row → ticket detail drawer.

### 6. Parts in Transit panel

FedEx-style cards. One per parcel where `Delivered` is blank in Part Tracker. Each card:
- Customer + PO ref + status pill (In Transit / Delayed / Out for delivery / Delivered)
- FedEx tracking number + current location
- 5-stage progress bar (Picked up → Transit → Local depot → OFD → Delivered)
- ETA + signature info

FedEx data comes from the Azure Function (`parts-fedex-poll`) which writes back to the Excel file. Browser just renders what's there.

### 7. Performance trend (13-month bar chart)

Stacked bars: Inside 30d (info blue) + Outside 30d (purple). Y-axis = avg days to close. Target line at 14d. Current month highlighted in Repose blue.

Chip selector: Days to close · % within target · Volume · Backlog.

Click bar → drills to that month's tickets.

### 8. £ Chargeable revenue (line chart)

13-month trend with area fill. FY YTD figure (£24.2k) labelled at the latest data point. Footer shows avg per chargeable ticket and highest single-ticket value.

Source: `£` column in TICKET LOG, summed by month for `Warranty / Chargeable == 'CHARGEABLE'`.

### 9. Top fault categories panel

5 rows. Each: category name · sub-fault examples · split bar (warranty blue + chargeable purple) · count.

Categories from the `dropdowns` sheet: MECHANISM, ELECTRICS, UPHOLSTERY, DAMAGE ON DELIVERY, ORDER ERROR, etc.

### 10. Mechanism Code analysis panel

Top 5 mech codes by failure count this FY. Each row:
- Mech code badge (1203, 1211 — navy chip)
- Mech name + sub-faults
- Bar chart
- Count

Surfaces design / supplier issues. Source: `Mech Code` column on TICKET LOG.

### 11. Customer scorecard panel

Top 5 customers by ticket volume FY26. Each row:
- Rank
- Customer name + warranty% / avg close days
- Bar (warranty info + chargeable purple split)
- Total ticket count

Click row → customer drill-down page.

### 12. Customer drill-down (panel + future page)

Shown as a preview panel on the dashboard for the user's pinned customer; full deep-link page at `#service/customer/CASTELAN` shows:
- Avatar + name + ticket count + warranty share + avg close
- 3-stat strip: Tickets FY26 · Warranty % · Avg close
- Top fault patterns (4 rows with %)
- Repeat-return chairs flag (red banner if any)
- £ chargeable FY26 footer

### 13. Ticket detail drawer

Right-side overlay (matches RepNet pattern from Document Control). Sections:

1. **Ticket details** (metadata grid: customer, model, mech code, open date, owner, proposed close, SLA %)
2. **Return workflow timeline** (if chair is going back) — vertical timeline with 5 steps:
   - Email sent → Maxoptra job created → Out for collection → Inspection → Production rework + return
   - Each step tagged with source system (📧 Email / 🚚 Maxoptra / 📝 iAuditor / 🔧 RepNet)
3. **Inspection photos** — 4-thumbnail grid: IN photos (orange) + OUT photos (green) + add button
4. **Original build sheet link** — chair # → REP2891 build context (week, prep day, who built it). Click → opens Production module to that REP
5. **Action log** — append-only notes
6. **Linked CAPAs / Quality flags** (if any)

Buttons at top: Mark for return · Add note · Close ticket · Print.

### 14. CAPA auto-bridge

Standalone panel below performance trend. Shows current CAPA candidates:
- **Repeat-fault patterns** — when same fault code repeats N times in 30 days for same model (e.g. "3× foam collapsing on Chatsworth")
- **Repeat-return chairs** — REPxxxx-R2+ in current quarter
- **Quality SPC breach cross-links** — bidirectional link from Quality module when an SPC limit is breached

Each row has a "⊕ Raise CAPA" button that opens the existing CAPA module's "+ New action" form pre-filled with the suggested issue, model, fault category, and source ticket links.

### 15. Forecast panel

3-stat grid:
- Predicted opens (next month, with ▼/▲ vs current month)
- Predicted parts spend (£)
- Backlog risk band (current open count vs. healthy/warning/breach thresholds)

Plus a horizontal band visualization showing where current backlog sits in the band.

Algorithm v1: 13-month moving average with seasonal multiplier (May = 0.91 of running avg based on historical May months). Recomputed weekly by `service-forecast-rebuild` Azure Function.

### 16. Public tracking page

Hosted at `/track/{ticket-no}/{token}` (within RepNet, but bypasses MSAL auth via token check). Token is HMAC-SHA256 of `ticket-no + secret`. Pages render:

- Header: 📦 Track your repair · Repose
- Friendly summary line ("Hi Abbey Healthcare — your Chatsworth chair repair is in progress")
- 5-stage timeline:
  1. Issue logged with Repose
  2. Collection scheduled
  3. Driver en route to collect
  4. At Repose factory · in repair
  5. Returned to you

Each stage shows status (✓ done / ● now / ○ pending) with a date or estimate.

Footer: "URL: repose.tracking/t/{ticket-no}/{token} · No customer data exposed"

## Phasing

To ship value early and de-risk the integrations, the design splits into 5 phases. Each phase ships in its own spec→plan→implement cycle.

### Phase A — Foundation (this design's first plan)

The minimum to deliver a useful service dashboard that reads both Excel files and lets the team file new tickets / parts dispatches in RepNet rather than the spreadsheet.

Includes:

- New Service tab in v4 sidebar
- Excel REST read of both files on view-open + 5-min cache
- Excel REST write-back for `+ New Ticket` and `+ New Parts Dispatch` forms
- Top KPI strip (4 primary tiles with In30/Out30 + Warranty/Chargeable splits)
- Secondary KPI strip (4 mini tiles)
- **SLA breach pre-alerts banner** + per-ticket chip (catches issues before they breach proposed-close, not just after) — promoted from Phase C to Phase A
- Open Tickets table with filter chips and search
- Parts in Transit panel (renders from Excel; no FedEx integration yet)
- Performance trend bar chart (13-month, stacked)
- £ Chargeable trend line chart
- Top fault categories panel
- Mechanism Code analysis panel
- Customer scorecard panel
- Ticket detail drawer (read-only — no Mark for return yet)

Out of Phase A: returns pipeline kanban, Maxoptra integration, FedEx auto-tracking, transport email, schedule view, customer drill-down, photo attachments, build link, public tracking page, CAPA bridge, forecast, weekly digest, Quality cross-link.

### Phase B — Returns Workflow

- "Mark for return" toggle on ticket → assigns chair # (`REPxxxx-Rn` format)
- Auto-email to `transport@` via Graph
- Returns Pipeline kanban (3 columns)
- Returned-chair appearance in Production Plan + Team View queues (cross-module work)
- Maxoptra integration (Azure Function `maxoptra-sync` + status writes back to ticket Factory Status)
- Repeat-return banner alert

### Phase C — Performance Intelligence

- Forecast panel (next-month opens + parts spend + backlog risk)
- CAPA auto-bridge panel (4 detection rules + pre-filled CAPA form bridge)
- Customer drill-down page (`#service/customer/CASTELAN`)
- Quality module cross-link (SPC limit triggers)

(SLA breach pre-alerts moved to Phase A.)

### Phase D — External Integrations

- FedEx auto-tracking Azure Function (`parts-fedex-poll`)
- iAuditor inspection capture (Phase 1: manual upload; Phase 2: auto-pull via API)
- Weekly digest email Azure Function (`service-weekly-digest`)
- Customer-facing public tracking page (`/track/{ticket}/{token}`)

### Phase E — Polish

- Service engineer schedule (week view aggregating Maxoptra + iAuditor + manual entries)
- Photo attachments per ticket (`/Service-Photos/{TICKET-NO}/`)
- Ticket → REP build link
- Schedule-driven mobile responsiveness improvements

## Risks

- **Excel concurrent writes** — two RepNet sessions saving a new ticket at the same moment could collide. Mitigation: use Graph Excel REST `tables/rows/add` (which is atomic at the row level) rather than calculating row indexes manually. Convert master sheets to Excel Tables (one-time SharePoint admin action).
- **Excel file open by colleague** — when someone has the file open in desktop Excel with autosave off, Graph writes can fail with 423 Locked. Mitigation: detect 423, show user "Excel file is locked by [user]; saved your draft locally — will auto-retry every 30s". Drafts kept in localStorage.
- **Maxoptra API key not yet obtained** — Phase B blocker. Same blocker model as the Document Control `Sites.ReadWrite.All` admin consent — implement code, deploy, function fails until key lands.
- **FedEx free-tier rate limits** — 250 polls/day. Real volume <50/day; safe. If we exceed, switch to paid tier (~£20/month).
- **iAuditor template name changes** — Phase B `iauditor-pull` matches by template name. If iAuditor admin renames the template, sync silently fails. Mitigation: Function logs a warning; weekly digest includes "iAuditor sync failures last 7 days".
- **Repeat-return detection false positives** — REP2284-R3 might be a different fault each time, not a systemic issue. Mitigation: detection rule includes fault-code matching, not just REP No matching.
- **Photo storage growth** — `/Service-Photos/` could grow unbounded. Mitigation: add a 24-month retention policy on the SharePoint folder. Photos older than 24 months auto-archive.
- **Public tracking page security** — token must be unguessable. HMAC-SHA256 of `ticket-no + secret` (32-char hex) is sufficient. Token never expires (customer needs it long-term).
- **Ticket-to-REP build link ambiguity** — old REP numbers might not have build records in RepNet (pre-RepNet builds). Mitigation: link card shows "Build sheet not on RepNet — see Production 2026 Excel for week 32" when build data is missing.
- **Customer scorecard / drill-down requires customer-name normalization** — the data has `CASTELAN`, `Castelan`, `CASTELAN ASSURANCE` etc. Mitigation: normalize to UPPERCASE-trim on read; flag mismatches in the dashboard footer for manual cleanup.

## Migration / Cutover

1. **One-time SharePoint admin step** — convert TICKET LOG and Part Tracker master sheets into Excel Tables (`Insert → Table` while in Excel). Required for atomic row append via Graph.
2. **Phase A ships** with Excel read + write + dashboard. Existing pivot tables auto-adopt new rows because they reference the table name not a fixed range.
3. **Cutover communication** to service team: "From Monday, file all new tickets and parts dispatches in RepNet. The Excel file is still there, but you don't open it to add new rows anymore." Backfill of historical rows is unnecessary — they're already in the file.
4. **Phase B onwards** rolls out incrementally; each phase has its own cutover note.

## Open Questions

- *Maxoptra admin access* — does Repose already have admin? (If not, that's the first ticket to raise.)
- *iAuditor API token* — does someone have admin on the Safety Culture / iAuditor account to issue an API token? Phase B blocker.
- *Transport team email auto-send vs draft modal* — auto-send (fire-and-forget) confirmed by Jonas. Confirm before Phase B build.
- *Photo storage retention* — 24-month default OK? Or longer for warranty audit purposes?
- *Public tracking page URL hosting* — within RepNet (`/track/...`) or a standalone subdomain (`tracking.repose.com`)? RepNet-hosted is simpler; subdomain is friendlier for customers.
- *Customer drill-down page deep-link format* — `#service/customer/CASTELAN` (uppercase-trim)? Or use a customer ID column we don't have yet? (Sticking with uppercase-trim for Phase A.)
- *Forecast model sophistication* — moving average + seasonal is sufficient for v1; do we ever want ML? (Probably no — volume is too low to be useful.)
- *SLA target window definition* — currently using `Proposed Close Date - Open Date` as the SLA budget; 80% threshold. Confirm matches the team's mental model.

## Out-of-scope future ideas

- ML-driven fault forecasting
- Customer satisfaction surveys auto-sent on ticket close
- Inline iAuditor inspection editing (vs current PDF view-only)
- Spare-parts inventory module (RepNet doesn't track parts stock — that's Sage)
- Automated parts ordering when stock runs low
- Customer authentication portal (login, ticket history, payments)
- Mobile-native app
- Voice / phone ticket logging (Twilio integration)
- WhatsApp Business notifications to customers
