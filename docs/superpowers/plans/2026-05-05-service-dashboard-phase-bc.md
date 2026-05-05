# Service Dashboard — Phase B+C (Ship-Now Batch) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development to execute task-by-task.

**Goal:** Fill ~80% of the visual gap between Phase A (live now) and v0.3 mockup, using only the Excel data we already read — no external API dependencies.

**Architecture:** Adds 10 features to the existing Service Dashboard. All code lives in the SERVICE DASHBOARD section of `index.html` (added by Phase A). No new files. Reuses existing `_serviceState`, `_renderServiceAll`, `_escapeSvc`, `_pct`, etc.

**Spec:** `service-dashboard-mockup.html` v0.3 is the de-facto spec. Each task references the corresponding mockup section.

**Phase scope:** B+C "ship-now" subset only. Things blocked on external APIs (Maxoptra, FedEx, iAuditor, transport email, public tracking page, weekly digest, service engineer schedule) ship in Phase D.

---

## Task 1: Chair # parsing helper + display badges

Foundation for several later tasks. Add helpers to parse `REP1234-R2` format from REP No / ticket fields and a CSS class for the orange chair-# badge.

**Files:** `index.html` — append in SERVICE section after `_escapeSvc`.

```js
// Parse a chair return identifier from any REP-No-like string.
// Examples:
//   "REP2891"     → { rep: 'REP2891', returnNo: 0, isReturn: false, label: 'REP2891' }
//   "REP2891-R1"  → { rep: 'REP2891', returnNo: 1, isReturn: true,  label: 'REP2891-R1' }
//   "REP2284-R3"  → { rep: 'REP2284', returnNo: 3, isReturn: true,  label: 'REP2284-R3' }
//   ""            → null
function _parseChairId(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const m = /^(REP\d+)(?:-R(\d+))?$/i.exec(v);
  if (!m) return { rep: v, returnNo: 0, isReturn: false, label: v };
  return { rep: m[1].toUpperCase(), returnNo: m[2] ? parseInt(m[2], 10) : 0, isReturn: !!m[2], label: v.toUpperCase() };
}

// Group all tickets by chair REP No to detect repeat returns. Returns
// a Map of REP No → array of tickets sorted by openDate ascending. Only
// includes REPs with 2+ tickets (i.e. at least one return).
function _computeRepeatReturns() {
  const byRep = new Map();
  for (const t of _serviceState.tickets) {
    const cid = _parseChairId(t.repNo);
    if (!cid) continue;
    if (!byRep.has(cid.rep)) byRep.set(cid.rep, []);
    byRep.get(cid.rep).push(t);
  }
  // Filter to only REPs with 2+ tickets and sort each list by openDate
  const repeats = [];
  for (const [rep, tickets] of byRep.entries()) {
    if (tickets.length < 2) continue;
    tickets.sort((a, b) => (a.openDate?.getTime() || 0) - (b.openDate?.getTime() || 0));
    repeats.push({ rep, count: tickets.length, latestOpenDate: tickets[tickets.length - 1].openDate, tickets });
  }
  // Most-frequent first
  repeats.sort((a, b) => b.count - a.count);
  return repeats;
}
```

CSS:
```css
.svc-chair-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; background: var(--orange); color: #fff; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; }
.svc-chair-pill.repeat { background: var(--fail); }
```

Verify: `_parseChairId('REP2284-R3').isReturn === true && _parseChairId('REP2284-R3').returnNo === 3`.

Commit: `feat(service): chair # parsing helpers + repeat-return detector`

---

## Task 2: Mockup ribbon at top of page

Tiny cosmetic — adds the "Mockup · v0.3 feature parity" ribbon above the page head so QHSE knows this is post-Phase-A live UI matching the agreed mockup.

Append in `_renderServiceShell` content template at the very top, before `.svc-page-head`:

```html
<div class="svc-mock-ribbon"><span class="dot"></span> Live · Phase A + B/C ship-now batch · v0.3 feature parity</div>
```

CSS:
```css
.svc-mock-ribbon { display: inline-flex; align-items: center; gap: 10px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; font-weight: 800; color: var(--purple); padding: 7px 14px; background: var(--purple-soft); border: 1px solid #ddd6fe; border-radius: 999px; margin-bottom: 14px; }
.svc-mock-ribbon .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--purple); }
```

Commit: `feat(service): live ribbon header`

---

## Task 3: Repeat-return alert banner (third alert in triple row)

Adds the third banner from the mockup. Detects chairs returned 2+ times in the current quarter. Click → opens a list-modal of those chairs.

In `_renderServiceAlerts` (added by Phase A Task 7B), append a third banner block computed from `_computeRepeatReturns()`:

```js
const quarterStart = new Date(); quarterStart.setMonth(Math.floor(quarterStart.getMonth() / 3) * 3, 1); quarterStart.setHours(0,0,0,0);
const repeats = _computeRepeatReturns().filter(r => r.latestOpenDate && r.latestOpenDate >= quarterStart);
if (repeats.length > 0) {
  const examples = repeats.slice(0, 3).map(r => `${r.rep} (${r.count}× return${r.count === 1 ? '' : 's'})`).join(', ');
  banners.push(`
    <div class="svc-alert warn">
      <div class="ab-icn">🔁</div>
      <div class="ab-mid">
        <b>${repeats.length} chair${repeats.length === 1 ? '' : 's'} returned 2× or more this quarter</b>
        <span class="small">${examples}${repeats.length > 3 ? ` + ${repeats.length - 3} more` : ''} · candidates for CAPA</span>
      </div>
      <button class="ab-act" data-svc-act="show-repeats">Review →</button>
    </div>
  `);
}
```

Click handler: filters Open Tickets to repeat-return REPs (or scrolls to CAPA panel if Task 4 has shipped — for now just `console.log`).

Commit: `feat(service): repeat-return alert banner`

---

## Task 4: CAPA auto-bridge panel

New panel below the trend charts, before the 3-column scorecard grid. Shows up to 4 candidate CAPAs detected from the ticket data:

1. **Repeat-fault patterns**: same fault code + model in 30 days (≥3 occurrences)
2. **Repeat-return chairs**: from Task 1's `_computeRepeatReturns`
3. **Customer concentration**: any single fault code where one customer accounts for ≥60% of MTD count
4. **Volume spikes**: fault categories with >2× last-month's count

Each row: icon · title · brief justification · "⊕ Raise CAPA" button.

The Raise-CAPA button opens the existing CAPA module (`navTo('actions')`) with a deep-link query string for pre-fill. For Phase B+C the deep-link is a console-log placeholder.

Computation function: `_computeCapaCandidates()` returning array of `{ kind, title, justification, sourceTicketNos }`.

Render function: `_renderServiceCapaBridge()` injecting into a new `<div id="svc-capa-container">` placed in the shell after `svc-charts-container`.

Commit: `feat(service): CAPA auto-bridge panel`

---

## Task 5: Forecast panel

3-stat strip + backlog risk band from the mockup. Shows next-month predicted opens, predicted parts spend, current backlog risk band.

Algorithm v1 (no ML):
- **Predicted opens** = average of last 3 months' opened-counts × seasonal multiplier (May = 0.91, etc., hardcoded from rough trend)
- **Predicted parts spend** = average of last 3 months' £ chargeable
- **Backlog risk band** thresholds: <18 healthy / 18-25 warning / >25 breach (current open count places marker)

Render into a new container `<div id="svc-forecast-container">` between charts and CAPA bridge.

CSS for forecast band: gradient horizontal bar with healthy/warning/breach segments + a marker dot.

Commit: `feat(service): next-month forecast + backlog risk band`

---

## Task 6: Customer drill-down page

Click a row in the Customer scorecard → opens a detail "page" (full-screen overlay, similar to ticket drawer but bigger).

Shows for the selected customer:
- Avatar (initials in colored badge)
- Name + ticket count + warranty share + avg close days
- 3-stat header strip (Tickets FY26, Warranty %, Avg close)
- Top fault patterns table (rows: fault code, count, % of customer's tickets)
- Repeat-return chairs flag (red banner) — chairs back 2+ times for this customer
- £ chargeable FY26 footer with link "Open all tickets for this customer"

New function `openServiceCustomerDrill(customerName)`. Click handler on `_renderServicePanels`'s customer rows.

Commit: `feat(service): customer drill-down page`

---

## Task 7: 5-stage parcel progress bars

Upgrade the Parts in Transit panel. Currently shows simple "in transit" / "delivered" pills. Mockup shows 5-stage progress bar (Picked up → Transit → Local depot → OFD → Delivered) with current stage highlighted.

Without FedEx API integration, we infer stage from how long since dispatch:
- 0 days: Picked up
- 1-2 days: Transit
- 3 days: Local depot
- 4 days: OFD (out for delivery)
- 5+ days unaccounted: Delayed
- Has Delivered timestamp: Delivered

Update `_renderServiceParts` to render the 5-stage pill row + a thin progress bar fill matching elapsed-days.

Commit: `feat(service): 5-stage parcel progress visualisation`

---

## Task 8: Mark-for-return toggle on ticket drawer

Adds a "🔁 Mark for return" button to the read-only drawer (Phase A Task 12). When clicked, opens a confirmation modal asking if the chair needs to come back to the factory. On confirm:

- Writes to the ticket's "Returned to Factory" column with current date (Excel serial)
- Patches the row via Graph Excel REST `tables/{TicketLog}/rows/{idx}` PATCH endpoint
- Increments the chair return number — finds the next R-suffix and updates the REP No (e.g. REP2891 → REP2891-R1)
- Refreshes dashboard

This task does NOT include the Maxoptra collection booking or transport email — those need external APIs. This just records the intent in the existing Excel column.

Drawer button only visible when `t.openClosed === 'OPEN'` and `!t.returnedToFactory`.

Commit: `feat(service): mark-for-return toggle (intent capture)`

---

## Task 9: Returns Pipeline kanban (basic)

Mockup shows 3-column kanban (Awaiting collection / In factory / Ready to return). Without Maxoptra, the column assignment is heuristic from existing TICKET LOG fields:

- **Awaiting collection** = `returnedToFactory` set AND `inspected` not set
- **In factory** = `returnedToFactory` AND `inspected` set, but `inProduction` and `returnToCustomer` not yet
- **Ready to return** = `returnToCustomer` set but `closeDate` not set

Render between SLA banner and KPI strip (so it's high-prominence). Each card shows chair # badge, customer, fault category, current stage, owner.

If all three columns are empty, the panel is hidden (no point in clutter).

Commit: `feat(service): basic Returns Pipeline kanban`

---

## Task 10: Quality SPC cross-link

Small link in the CAPA panel that says "Quality SPC limit breached for Mech 1203 — view in Quality →" if the Quality module's data shows a breach in the current week. Click → `navTo('quality')` with optional deep-link.

Phase B+C scope: just check if Quality module exists (`document.getElementById('view-quality')`) and add the link unconditionally — actual SPC integration is Phase D.

Commit: `feat(service): Quality module cross-link from CAPA panel`

---

## Self-review

| Phase B+C ship-now goal | Task |
|---|---|
| Repeat-return banner | 1 + 3 |
| Chair # parsing | 1 |
| Mockup ribbon | 2 |
| CAPA auto-bridge | 4 |
| Forecast panel | 5 |
| Customer drill-down | 6 |
| 5-stage parcel bars | 7 |
| Mark-for-return | 8 |
| Returns Pipeline kanban | 9 |
| Quality cross-link | 10 |

**Out of scope** (Phase D): Maxoptra integration, FedEx auto-tracking, iAuditor capture, transport email, public tracking page, weekly digest, service engineer schedule, photo attachments, REP build link, Phase 2 ML forecasting.

**Risks:**
- Quality module integration in Task 10 is best-effort; if no SPC data exists, the link is a stub
- Backlog risk thresholds in Task 5 are guesses; tune after first month of usage
- Heuristic kanban assignment in Task 9 may not match how the team actually tracks status — adjust after feedback
