# CPAR ISO 9001 Redesign — Design Spec

**Date:** 2026-04-27
**Author:** Jonas Simonaitis (QHSE Manager) with Claude
**Status:** Draft — pending Jonas review
**Approach:** #2 — Lifecycle + dedicated Review view (chosen from picker)

## Problem

The current CPAR tab in RepNet captures a description, source dept, category, root cause and corrective action — closed by anyone with access. For ISO 9001 (clauses 8.7 *Control of nonconforming outputs* and 10.2 *Nonconformity and corrective action*) this is not enough evidence:

- No **disposition** record (was the part scrapped, reworked, used as-is, returned?). §8.7.1
- No **containment** action (what stopped the bad batch from progressing?). §8.7.1
- No **segregation of duties** — same person closes that did the rework. §10.2.1
- No **investigation owner** when an issue needs deeper analysis. §10.2.1 b
- No **printable single-CPAR report** that can be filed against a job folder.
- No **bulk register export** for management review meetings or external audit.

There is also no formal handoff from CPAR to ECR (Engineering Change Request) when the root cause is a template/spec issue. The ECR form lives elsewhere (`PHCF-203`, sent to `ECR@prismmedical.co.uk` at Prism Medical, parent company); CPAR currently has no field to capture the returned ECR number, breaking traceability.

## Goals

1. Add an audit-grade **lifecycle** to every CPAR: Raised → Area Manager Close-Out → QHSE Review → (optional) Investigation → Closed, with a return-to-sender path.
2. Capture the **ISO 9001 §8.7 + §10.2 evidence** the current form omits: disposition, containment, sign-off trail.
3. Provide a **single-CPAR printable Non-Conforming Job Note** (PDF via browser print), modelled on the "NCR Report" sheet in `CPAR Dashboard.xlsm`, suitable for filing against a physical job and for inclusion in audit packs.
4. Provide a **bulk register CSV export** filterable by date range / team, suitable for management review meetings.
5. Add a **dedicated QHSE Review queue** UI for Jonas and a filtered **Production Engineer view** for Mark Staniland and Gareth Stringer — both behind the existing Stats password gate.
6. **Automate per-team morning digests** (Azure Function, 07:00 UK Mon–Fri) showing each team last working day's raised CPARs and their currently-open CPARs.

## Non-Goals (deferred to Phase 2)

- §10.2.1 e **effectiveness re-check** after N days. Data model leaves room for a `EffectivenessVerifiedBy` / `EffectivenessVerifiedAt` pair to be added later.
- **Repeat-issue auto-detection** (same model + same cause > N times in 30d).
- **Monthly KPI dashboard** (open/closed counts, MTTR, top-cause table, trend charts).
- **Native ECR module in RepNet.** This spec captures only the *ECR ref* on the CPAR; the ECR itself stays in the existing Word form workflow until a separate ECR module is built.
- **Backfill of existing 12k historical CPARs.** New fields are additive; legacy CPARs keep working unchanged.
- **Native `.xlsx` export.** CSV first; `.xlsx` via SheetJS can be added later without reworking the data path.

## The Workflow

```
                                                       ┌─→ Approve → Closed (final)
                                                       │
Raised → Area Manager Close-Out → QHSE Review ─────────┼─→ Escalate → Investigation (PE) → QHSE Final Close → Closed
                ↑                                      │
                │                                      └─→ Return to sender ───┐
                └──────────────────────────────────────────────────────────────┘
```

### 1. Raised
**Who:** any operator on the floor, via existing CPAR button on a job card.
**No change** from today's flow — keeps tablet UX fast. Status: `Open`.

The existing daily team digest infrastructure (Azure Function in `azure-functions/daily-report/` + the per-team email pattern in `buildDigestHtml(...)`) is extended (see §6) to alert area managers each morning of new CPARs raised against their team yesterday.

### 2. Area Manager Close-Out
**Who:** the manager of the **Source Dept** that caused the issue (resolved against `TEAM_MANAGERS[SourceDept]` — same map already used for digest routing).
**Trigger:** they see the CPAR in the morning digest *and* in the existing Issues tab.
**Action:** opens the CPAR, fills:
- **Disposition** *(required)* — Reworked / Scrapped / Use-as-is (concession) / Returned to supplier / Other
- **Disposition notes** *(required if Disposition = Other; optional otherwise)*
- **Containment action** *(optional; required only if Disposition ≠ Use-as-is)* — what stopped the bad batch progressing
- **Root cause** *(required)* — the existing 6-code dropdown is reused: Human Error / Design-Spec Error / Machine-Equipment Failure / Process-Procedure Issue / Measurement-Template Error / Material Defect
- **Corrective action** *(required)* — what was done to prevent recurrence

On submit, status moves to `Pending QHSE Review`. `ClosedOutBy` and `ClosedOutAt` are recorded.

### 3. QHSE Review (Jonas)
**Who:** Jonas Simonaitis (QHSE). Hard-coded for now via email match against the logged-in MSAL user; can be widened to a `QHSE_REVIEWERS` list later.
**Trigger:** new "Quality" tab → "QHSE Review" sub-view shows the queue. Queue stat tiles: *To Review* / *Investigating* / *Returned* / *Awaiting Final Sign-Off* / *Overdue*.

Three actions per CPAR:

**(a) Approve & Close** — status becomes `Closed`. `ClosedBy` = Jonas, `ClosedAt` = now. Two-name sign-off trail: area manager + QHSE.

**(b) Escalate to Investigation** — assigns to one of two named Production Engineers:
- `mark.staniland@reposefurniture.co.uk`
- `gareth.stringer@reposefurniture.co.uk`

Status becomes `Investigation`. The assigned PE receives an email (via `Mail.Send`, same pattern as the existing daily digest send). `InvestigatorAssigned`, `EscalatedBy`, `EscalatedAt` are recorded.

**(c) Return to Area Manager** — Jonas adds a return note (free text, required). Status becomes `Returned to Area Manager`. `ReturnedNote`, `ReturnedAt` recorded. The CPAR re-appears in the area manager's queue with the returned-from-QHSE banner. They edit on top of their previous closeout fields and resubmit (which appends to history — see §5 audit trail) and the CPAR returns to `Pending QHSE Review`.

### 4. Investigation (Production Engineer — branch only)
**Who:** Mark Staniland or Gareth Stringer (whoever was assigned).
**Action:** they review the CPAR, do whatever investigation is needed off-system, then record the **investigation outcome** — one of two paths:

- **Human Error** → fills/updates `CorrectiveAction` field. CPAR returns to Jonas as `Awaiting Final Sign-Off`.
- **Template / Spec Issue** → CPAR shows a "Raise ECR" prompt with a pre-filled `mailto:` link:

  ```
  mailto:ECR@prismmedical.co.uk
    ?subject=[CPAR RP-XXXXX] ECR request — <model>
    &body=<CPAR ref, model, REP/job, description, root cause, link to CPAR record>
  ```

  PE clicks, the email opens in their default client, they hit Send, Prism's ECR lead allocates an ECR number, replies. PE pastes the returned `ECR-NNN` into the **ECR Ref** field on the CPAR. CPAR returns to Jonas as `Awaiting Final Sign-Off`.

`InvestigatedBy`, `InvestigatedAt`, `InvestigationOutcome` recorded.

### 5. Closed (final)
Jonas approves from `Awaiting Final Sign-Off`. Status: `Closed`. Final sign-off trail = up to three names: area manager + PE (if investigation branch) + QHSE.

### Audit trail (history)
A single multi-line text column `History` on the SP list captures every state transition as a JSON-line append:
```json
{"t":"2026-04-27T09:08:00Z","by":"daniel.seymour@…","ev":"raised"}
{"t":"2026-04-27T11:42:00Z","by":"daniel.seymour@…","ev":"closed-out","fields":{"disposition":"Reworked",…}}
{"t":"2026-04-27T14:00:00Z","by":"jonas.simonaitis@…","ev":"escalated","to":"mark.staniland@…"}
{"t":"2026-04-27T14:32:00Z","by":"mark.staniland@…","ev":"investigated","outcome":"Human Error"}
{"t":"2026-04-28T16:10:00Z","by":"jonas.simonaitis@…","ev":"closed"}
```

This avoids a separate audit-log SharePoint list, gives auditable per-CPAR replay, and keeps the data model simple. Rendered as a "History" expandable section in the closed-state card.

## Status enum

Replaces the current binary `Open` / `Closed` with:

| Status                    | Whose queue            | Visible to floor? |
|---------------------------|------------------------|-------------------|
| `Open`                    | Area Manager           | Yes               |
| `Pending QHSE Review`     | Jonas                  | Yes (read-only)   |
| `Returned to Area Manager`| Area Manager (banner)  | Yes               |
| `Investigation`           | Mark / Gareth (the assignee) | Yes (read-only) |
| `Awaiting Final Sign-Off` | Jonas                  | Yes (read-only)   |
| `Closed`                  | Archive / Register     | Yes (read-only, dim)|

The Issues tab top-of-list filter chips become: *To do* (Open + Returned) / *In progress* (Investigation + Pending Review + Awaiting Sign-Off) / *Closed* / *All*.

## Data model — new SharePoint columns

Adding to the existing `CPARLog` SharePoint list (additive — historical CPARs unchanged).

| Column                    | Type                  | Purpose                                                       |
|---------------------------|-----------------------|---------------------------------------------------------------|
| `Disposition`             | Choice                | Reworked / Scrapped / Use-as-is / Returned to supplier / Other |
| `DispositionNotes`        | Multi-line text       | Free-text qualifier                                           |
| `Containment`             | Multi-line text       | What stopped the bad batch from progressing (§8.7.1)          |
| `ClosedOutBy`             | Single-line text (email) | Area manager who completed the closeout                    |
| `ClosedOutAt`             | DateTime              | Closeout timestamp                                            |
| `ReviewedBy`              | Single-line text (email) | QHSE reviewer (currently always Jonas)                     |
| `ReviewedAt`              | DateTime              | QHSE review timestamp                                         |
| `ReviewDecision`          | Choice                | Approved / Escalated / Returned                               |
| `ReturnedNote`            | Multi-line text       | QHSE's note when returning to sender                          |
| `InvestigatorAssigned`    | Choice                | mark.staniland@… / gareth.stringer@…                          |
| `EscalatedBy`             | Single-line text (email) | Who escalated (Jonas)                                      |
| `EscalatedAt`             | DateTime              | When escalated                                                |
| `InvestigatedBy`          | Single-line text (email) | PE who completed investigation                             |
| `InvestigatedAt`          | DateTime              | Investigation completion timestamp                            |
| `InvestigationOutcome`    | Choice                | Human Error / Template-Spec Issue                             |
| `ECRRef`                  | Single-line text      | Free-form ECR ref e.g. `ECR-191` (no FK constraint — ECR module is phase 2) |
| `Status`                  | Choice (extended)     | See enum above                                                |
| `History`                 | Multi-line text       | JSON-lines audit trail (one event per line)                   |

The existing `CauseCode`, `CorrectiveAction`, `Description`, `SourceDept`, `IssueCategory`, `RaisedByTeam`, `Title` (ref), `LoggedAt`, `PrimaryREP`, `PrimaryJobNo`, `PrimaryModel`, `QTY`, `HasPhoto`, `AffectedJobs`, `TotalAffected`, `ClosedBy`, `ClosedAt` columns stay unchanged.

## UI changes

All in `index.html` (vanilla JS pattern, no framework). New constants colocated with existing `SP_CPAR_LIST` block.

### Existing CPAR card (Issues tab) — additions
- Status badge gains the new states with distinct colours (per-state `border-left` already established):
  - `Returned to Area Manager` → red (`#dc2626`) — area manager sees red banner with QHSE's note
  - `Pending QHSE Review` → green (`#059669`) — read-only for floor
  - `Investigation` → purple (`#7c3aed`) — read-only for floor
  - `Awaiting Final Sign-Off` → green
- Closeout panel becomes a multi-block form: Disposition (radio grid) → Containment (textarea, conditional) → Root Cause (existing 6-code grid) → Corrective Action (textarea). On submit posts to SP and moves status to `Pending QHSE Review`.
- Closed-state card gains: Disposition block, Containment block, Sign-Off trail (2-or-3 names with timestamps), History expandable, ECR Ref pill (if present), and a **Print Non-Conforming Report** button.

### New "Quality" tab — manager-only

Behind the existing Stats password gate (`statsPasswordOk` localStorage flag — same pattern). Three sub-views, switched by chips at top:

- **QHSE Review queue** (Jonas)
  - Stat tiles: *To Review* / *Investigating* / *Returned* / *Awaiting Sign-Off* / *Overdue*
  - List of CPARs grouped by stat tile selection
  - Per-card actions: **Approve & Close**, **Escalate** (modal: pick Mark / Gareth), **Return** (modal: enter return note)

- **Production Engineer view** (Mark / Gareth)
  - Filter to CPARs where `InvestigatorAssigned` matches the logged-in user
  - Per-card actions: **Mark as Human Error** (closes investigation, returns to Jonas), **Mark as Template/Spec issue** (opens ECR mailto, prompts for ECR ref, returns to Jonas)

- **Register**
  - Date range filter, team filter, status filter
  - Inline table of all CPARs matching the filter
  - **Export CSV** button (top right) → triggers client-side CSV blob download with the column set defined in §7

### Print Non-Conforming Report (single-CPAR PDF)

Triggered from the closed-state card. Implementation: a print-only stylesheet (`@media print`) hides everything except a printable container that's populated client-side from the in-memory CPAR object. User triggers `window.print()` and uses the browser's "Print to PDF" — no library dependency.

Layout mirrors the `NCR Report` sheet in `CPAR Dashboard.xlsm`:
- Repose logo + QMS doc-control header (`PHCF-NCR-001`, issue, page)
- Title: **Non-Conforming Job Note**
- Header table: REF · Date Raised · Raised by · Department · Job Ref · Model · QTY · Source/Category
- **Concern / Issue / Fault** (block from Description)
- **Containment Action** (block)
- **Disposition** (tick-box grid showing the chosen option)
- **Possible Root Cause** (6-cell tick-box grid showing the chosen cause)
- **Investigation Findings & Corrective Action** (block)
- **Linked ECR** (cell — N/A if not set)
- **Sign-Off** — 2 or 3 boxes with name + role + ISO-formatted timestamp
- Footer: "Generated from RepNet · CPARLog/RP-XXXXX" + retention note

## Email automation

### Per-team morning digest (extension)
Add a new Azure Function next to `azure-functions/daily-report/`. Cron: `0 0 7 * * 1-5` (07:00 UK Mon–Fri). On run:

1. Authenticate to Graph using the existing app-only credentials.
2. For each team in `TEAM_MANAGERS`:
   - Fetch CPARs from `CPARLog` where `(SourceDept matches team) AND (created during last working day OR Status != Closed)`.
   - "Last working day" logic: if today = Mon, fetch Fri; otherwise yesterday.
   - Build an HTML email with two tables:
     - **Raised against you yesterday** (Ref / Job / Description / QTY / Status)
     - **Still open against you** (same columns + Days Open)
   - Send via `/me/sendMail` to `TEAM_MANAGERS[team]` recipients.
3. Build a master combined digest for `DIGEST_MANAGEMENT` (Mitch + Richard) with all teams' rollups.

Follows the existing `buildDigestHtml(...)` styling so emails match the manual digest template.

### Investigator assignment notification
When Jonas escalates a CPAR, send an immediate email (via `Mail.Send` in-browser flow, same as `sendDailyDigest`) to the assigned PE:
- Subject: `[CPAR RP-XXXXX] Investigation assigned — <model>`
- Body: CPAR ref, source dept, description, link back to RepNet CPAR view, link to ECR mailto if Template/Spec is the likely path

### Return-to-sender notification
When Jonas returns a CPAR, send an immediate email to the area manager who closed it out plus `TEAM_MANAGERS[SourceDept]` cc:
- Subject: `[CPAR RP-XXXXX] Returned for revision`
- Body: Jonas's return note, link back to RepNet CPAR

## Bulk register CSV export

Client-side CSV blob, no library. Triggered from Quality → Register → Export.

Columns (one row per CPAR, ordered to match what auditors and management review meetings need):

| # | Column                  | Source                                    |
|---|-------------------------|-------------------------------------------|
| 1 | REF                     | `Title`                                   |
| 2 | Date Raised             | `LoggedAt`                                |
| 3 | Raised By               | `RaisedByTeam`                            |
| 4 | Source Dept             | `SourceDept`                              |
| 5 | Category                | `IssueCategory`                           |
| 6 | Job Ref                 | `PrimaryREP`/`PrimaryJobNo`               |
| 7 | Model                   | `PrimaryModel`                            |
| 8 | QTY                     | `QTY`                                     |
| 9 | Description             | `Description`                             |
| 10 | Closed-Out By / At     | `ClosedOutBy`/`ClosedOutAt`               |
| 11 | Disposition            | `Disposition` (+ notes)                   |
| 12 | Containment            | `Containment`                             |
| 13 | Root Cause             | `CauseCode`                               |
| 14 | Corrective Action      | `CorrectiveAction`                        |
| 15 | Reviewed By / At / Decision | `ReviewedBy`/`ReviewedAt`/`ReviewDecision` |
| 16 | Investigator           | `InvestigatorAssigned`                    |
| 17 | Investigation Outcome  | `InvestigationOutcome`                    |
| 18 | ECR Ref                | `ECRRef`                                  |
| 19 | Closed By / At         | `ClosedBy`/`ClosedAt`                     |
| 20 | Days Open              | computed: `(ClosedAt OR now) - LoggedAt` in working days |
| 21 | Status                 | `Status`                                  |

CSV escaping: RFC 4180 compliant — fields containing `,` `"` or newline wrapped in `"…"` with embedded `"` doubled. Filename: `cpar-register-YYYY-MM-DD.csv`.

## ISO 9001 clause coverage

| Clause   | Requirement                                              | Where it's satisfied                                                          |
|----------|----------------------------------------------------------|-------------------------------------------------------------------------------|
| 8.7.1    | Identify & control non-conforming output                  | Status workflow keeps CPAR out of `Closed` until disposition recorded         |
| 8.7.1 a-d | Disposition options                                      | `Disposition` field — Reworked / Scrapped / Use-as-is / Returned / Other       |
| 8.7.1     | Containment action                                       | `Containment` field                                                            |
| 8.7.2     | Documented information on actions taken & approving authority | Sign-off trail (2-3 names) + History audit trail + PDF print-out             |
| 10.2.1 a  | React to nonconformity, contain, deal with consequences  | Area-manager closeout step + containment field                                |
| 10.2.1 b  | Evaluate need for action to eliminate cause              | QHSE Review stage — Jonas decides Approve / Escalate / Return                |
| 10.2.1 c  | Implement action                                         | `CorrectiveAction` + Investigation step                                       |
| 10.2.1 d  | Update risks/opportunities if necessary                  | ECR raise + ECRRef capture for template/spec causes                          |
| 10.2.1 e  | Review effectiveness of corrective action                | **Deferred to phase 2** — data model leaves room for `EffectivenessVerifiedBy/At` |
| 10.2.2    | Retain documented information as evidence                | `CPARLog` SP list (existing) + History column + per-CPAR PDF + bulk CSV       |

## Migration

- **No backfill** of historical 12k CPARs. They keep `Status = Open` or `Closed` as today; new fields are empty (`null`).
- The Issues tab list filter logic is updated so legacy `Closed` CPARs still appear under the new `Closed` chip, and legacy `Open` CPARs all appear under `To do` until manually re-touched.
- The `ref-counter` (currently `cpar_max_ref` in localStorage, scanning `CPARLog` for `RP-NNNNN`) keeps working — new CPARs continue the existing sequence.

## Implementation order (sketch — full plan in writing-plans hand-off)

1. SP column additions (manual or via migrate-cpar.html scaffold)
2. Status enum extension + Issues-tab filter chip refactor
3. Closeout-panel multi-block redesign
4. Quality tab + QHSE Review queue + PE view
5. Print-to-PDF stylesheet + single-CPAR layout
6. CSV register export
7. Email: investigator assignment + return-to-sender
8. Azure Function: per-team morning digest
9. End-to-end test: full lifecycle (raise → closeout → review → escalate → investigate → ECR mailto → final close → print PDF → bulk export)

## Open questions / decisions logged

- ✅ Approach 2 chosen
- ✅ Final closure authority = Jonas (QHSE)
- ✅ Production Engineers = Mark Staniland, Gareth Stringer
- ✅ ECR system stays in Word for now; CPAR captures `ECRRef` only
- ✅ Return-to-sender = real state (`Returned to Area Manager`)
- ✅ No per-issue email; daily team digest at 07:00 Mon–Fri instead
- ✅ CSV export first, `.xlsx` later
- ✅ §10.2.1 e effectiveness re-check deferred to phase 2

## Out-of-scope for this design (phase 2 candidates)

- Effectiveness re-check after 30 days
- Repeat-issue auto-detection
- Monthly KPI / management review export
- Native ECR module in RepNet
- `.xlsx` formatted export with charts
- Backfill historical 12k CPARs
- Trend charts / quality dashboard
