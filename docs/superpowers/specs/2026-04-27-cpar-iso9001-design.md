# CPAR ISO 9001 Redesign — Design Spec

**Date:** 2026-04-27
**Author:** Jonas Simonaitis (QHSE Manager) with Claude
**Status:** Draft — pending Jonas review
**Approach:** #3 — Full ISO 9001 NCR module (chosen from picker)

## Problem

The current CPAR tab in RepNet captures a description, source dept, category, root cause and corrective action — closed by anyone with access. For ISO 9001 (clauses 8.7 *Control of nonconforming outputs* and 10.2 *Nonconformity and corrective action*) this is not enough evidence:

- No **disposition** record (was the part scrapped, reworked, used as-is, returned?). §8.7.1
- No **containment** action (what stopped the bad batch from progressing?). §8.7.1
- No **segregation of duties** — same person closes that did the rework. §10.2.1
- No **investigation owner** when an issue needs deeper analysis. §10.2.1 b
- No **effectiveness check** after close to confirm the action actually worked. §10.2.1 e
- No **repeat-issue detection** to flag systemic problems. §10.2.1 b
- No **printable single-CPAR report** that can be filed against a job folder.
- No **bulk register export** or monthly KPI rollup for management review meetings.
- No **trend visibility** for the QMS — only ad-hoc Stats tab counts.

There is also no formal handoff from CPAR to ECR (Engineering Change Request) when the root cause is a template/spec issue. The ECR form lives elsewhere (`PHCF-203`, sent to `ECR@prismmedical.co.uk` at Prism Medical, parent company); CPAR currently has no field to capture the returned ECR number, breaking traceability.

## Goals

1. Add an audit-grade **lifecycle** to every CPAR: Raised → Area Manager Close-Out → QHSE Review → (optional) Investigation → Closed → Effectiveness Re-Check → Archived, with a return-to-sender path.
2. Capture full **ISO 9001 §8.7 + §10.2 evidence**: disposition, containment, sign-off trail, **effectiveness verified**.
3. **Auto-flag repeat issues** — same `PrimaryModel` + `CauseCode` ≥ 3 times in 30 rolling days — for deeper investigation.
4. Provide a **single-CPAR printable Non-Conforming Job Note** (PDF via browser print), modelled on the "NCR Report" sheet in `CPAR Dashboard.xlsm`.
5. Provide a **bulk register CSV export** filterable by date range / team for management review.
6. Provide a **monthly KPI export** (CSV, automated): opened / closed / still-open per team, MTTR, top 5 causes, ECR-linked count, repeat-flagged count.
7. Provide a **Quality Dashboard** sub-view with three trend charts (monthly raised vs closed, top 5 causes, MTTR trend) — vanilla SVG, no chart library.
8. Add a **dedicated QHSE Review queue** for Jonas and a filtered **Production Engineer view** for Mark Staniland and Gareth Stringer — both behind the existing Stats password gate.
9. **Automate per-team morning digests** (Azure Function, 07:00 UK Mon–Fri) showing each team's last working day's raised CPARs and currently-open CPARs.
10. **Document a 7-year retention policy** per §7.5 in the printed report footer and in the spec — no auto-delete.

## Non-Goals (deferred to Phase 2 or out-of-scope)

- **Native ECR module in RepNet.** This spec captures only the *ECR ref* on the CPAR; ECR itself stays in the Prism Word-form workflow.
- **Backfill of existing 12k historical CPARs.** New fields are additive; legacy CPARs keep working unchanged.
- **Native `.xlsx` export.** CSV first; `.xlsx` via SheetJS can be added later.
- **Auto-deletion / hard archive after 7 years.** Retention is documented, not enforced — auto-deleting compliance records is too risky.
- **8D problem-solving template.** Repeat issues are flagged with a banner; a structured 8D form is not built — investigation still uses the existing `CorrectiveAction` text field for now.

## The Workflow

```
                                                       ┌─→ Approve → Closed → Eff. Re-Check (30d) → Archived
                                                       │                          │
Raised → Area Manager Close-Out → QHSE Review ─────────┼─→ Escalate → Investigation (PE) → QHSE Final Close ─┤
                ↑                                      │                                                     │
                │                                      └─→ Return to sender ───┐                             │
                └──────────────────────────────────────────────────────────────┘                             │
                                                                                                             │
                                  ┌──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  └─→ Eff. Re-Check (30d): Yes still effective → Archived
                                                            No, recurred → New CPAR auto-linked, original stays Archived (with recurrence note)
```

### 1. Raised
**Who:** any operator on the floor, via existing CPAR button on a job card.
**No change** from today's flow — keeps tablet UX fast. Status: `Open`.

The existing daily team digest infrastructure (Azure Function in `azure-functions/daily-report/` + the per-team email pattern in `buildDigestHtml(...)`) is extended (see §6) to alert area managers each morning of new CPARs raised against their team yesterday.

**Repeat detection runs on submit** — see §6 below.

### 2. Area Manager Close-Out
**Who:** the manager of the **Source Dept** that caused the issue (resolved against `TEAM_MANAGERS[SourceDept]`).
**Trigger:** they see the CPAR in the morning digest and in the existing Issues tab. If the CPAR is **flagged repeat**, the card shows a red banner with links to the prior occurrences.
**Action:** opens the CPAR, fills:
- **Disposition** *(required)* — Reworked / Scrapped / Use-as-is (concession) / Returned to supplier / Other
- **Disposition notes** *(required if Disposition = Other; optional otherwise)*
- **Containment action** *(optional; required if Disposition ≠ Use-as-is)*
- **Root cause** *(required)* — existing 6-code dropdown
- **Corrective action** *(required)*

On submit, status moves to `Pending QHSE Review`. `ClosedOutBy` and `ClosedOutAt` are recorded.

**Repeat CPARs cannot be closed-out by area manager alone** — they always go to QHSE Review even if area manager attempts to mark complete. Card shows guidance text: "Repeat issue — QHSE will route to investigation".

### 3. QHSE Review (Jonas)
**Who:** Jonas Simonaitis (QHSE). Hard-coded for now via email match against the logged-in MSAL user; widenable to a `QHSE_REVIEWERS` list later.
**Trigger:** new "Quality" tab → "QHSE Review" sub-view. Queue stat tiles: *To Review* / *Investigating* / *Returned* / *Awaiting Sign-Off* / *Awaiting Eff. Check* / *Overdue*.

Three actions per CPAR:

**(a) Approve & Close** — status becomes `Closed`. `ClosedBy` = Jonas, `ClosedAt` = now. Sign-off trail: area manager + QHSE. Auto-schedules effectiveness re-check 30 days out.

**(b) Escalate to Investigation** — assigns to `mark.staniland@reposefurniture.co.uk` or `gareth.stringer@reposefurniture.co.uk`. Status becomes `Investigation`. Email sent to assignee. `InvestigatorAssigned`, `EscalatedBy`, `EscalatedAt` recorded.

**Repeat-flagged CPARs default this option pre-selected** with a "Repeat — recommend escalating" hint.

**(c) Return to Area Manager** — Jonas adds a return note (required). Status becomes `Returned to Area Manager`. `ReturnedNote`, `ReturnedAt` recorded. Area manager re-opens, edits on top, resubmits → returns to `Pending QHSE Review`.

### 4. Investigation (Production Engineer — branch only)
**Who:** Mark Staniland or Gareth Stringer.
**Action:** record investigation outcome — one of two paths:

- **Human Error** → fills/updates `CorrectiveAction`. Returns to Jonas as `Awaiting Final Sign-Off`.
- **Template / Spec Issue** → "Raise ECR" prompt with pre-filled `mailto:`:
  ```
  mailto:ECR@prismmedical.co.uk
    ?subject=[CPAR RP-XXXXX] ECR request — <model>
    &body=<CPAR ref, model, REP/job, description, root cause, link to CPAR record>
  ```
  PE clicks → email opens → sends to Prism → Prism replies with `ECR-NNN` → PE pastes into ECR Ref field → Returns to Jonas as `Awaiting Final Sign-Off`.

`InvestigatedBy`, `InvestigatedAt`, `InvestigationOutcome` recorded.

### 5. Closed (final)
Jonas approves from `Awaiting Final Sign-Off`. Status: `Closed`. `ClosedBy`, `ClosedAt` recorded. Auto-schedules effectiveness re-check 30 days from `ClosedAt`.

### 6. Effectiveness Re-Check (§10.2.1 e — NEW)
**Who:** Jonas (QHSE).
**Trigger:** 30 calendar days after `ClosedAt`. The CPAR appears in a new "Awaiting Effectiveness Check" queue tile in the Quality tab. Email reminder is sent to Jonas weekly summarising any due / overdue re-checks (Mon morning digest, see §6).
**Action:** two-button confirmation:
- **✓ Still effective** → status: `Archived`. `EffectivenessVerifiedBy = Jonas`, `EffectivenessVerifiedAt = now`, `EffectivenessVerified = true`.
- **✗ Recurred — re-open** → original CPAR status: `Archived` with `EffectivenessVerified = false` and a `RecurrenceNote`. A new CPAR is auto-created with `LinkedFromRef` set to the original (so the chain is auditable). New CPAR enters the workflow at `Open` → flows normally.

If Jonas takes no action, the CPAR stays in `Awaiting Effectiveness Check` indefinitely (no auto-archive). Overdue re-checks (>7 days past due) get a red badge in the queue.

### Audit trail (history)
A single multi-line text column `History` on the SP list captures every state transition as a JSON-line append:
```json
{"t":"2026-04-27T09:08:00Z","by":"daniel.seymour@…","ev":"raised"}
{"t":"2026-04-27T09:09:00Z","by":"system","ev":"repeat-flagged","linked":["RP-03450","RP-03512","RP-03589"]}
{"t":"2026-04-27T11:42:00Z","by":"daniel.seymour@…","ev":"closed-out","fields":{"disposition":"Reworked",…}}
{"t":"2026-04-27T14:00:00Z","by":"jonas.simonaitis@…","ev":"escalated","to":"mark.staniland@…"}
{"t":"2026-04-27T14:32:00Z","by":"mark.staniland@…","ev":"investigated","outcome":"Human Error"}
{"t":"2026-04-28T16:10:00Z","by":"jonas.simonaitis@…","ev":"closed"}
{"t":"2026-05-28T09:00:00Z","by":"jonas.simonaitis@…","ev":"effectiveness-verified","verified":true}
```

Rendered as a "History" expandable section in the closed-state card.

## Status enum

| Status                       | Whose queue                  | Visible to floor? |
|------------------------------|------------------------------|-------------------|
| `Open`                       | Area Manager                 | Yes               |
| `Pending QHSE Review`        | Jonas                        | Yes (read-only)   |
| `Returned to Area Manager`   | Area Manager (banner)        | Yes               |
| `Investigation`              | Mark / Gareth (assignee)     | Yes (read-only)   |
| `Awaiting Final Sign-Off`    | Jonas                        | Yes (read-only)   |
| `Closed`                     | (transitional — 30-day clock running) | Yes (read-only) |
| `Awaiting Effectiveness Check` | Jonas                      | No (manager-only) |
| `Archived`                   | Register / KPI views         | No (search/filter only) |

The Issues tab top-of-list filter chips become: *To do* (Open + Returned) / *In progress* (Investigation + Pending Review + Awaiting Sign-Off) / *Closed* (recently closed, last 30d) / *All*. `Archived` items don't show in the floor Issues tab — only in Quality → Register.

## Repeat-issue detection

Logic runs in two places:

**1. On CPAR submit** (`submitCPAR()`) — after the new item is saved to SharePoint, scan the in-memory `CPAR_ITEMS` for prior CPARs with:
- Same `PrimaryModel` (case-insensitive trim)
- Same `CauseCode`
- `LoggedAt` within the last 30 calendar days
- Status ≠ `Open` (i.e. don't count the one we just raised)

If count ≥ 3 (i.e., this one makes a 4th, 5th, etc.), set `IsRepeat = true` on the new CPAR and store the linked refs in `RepeatLinkedRefs` (semicolon-separated). Append a `repeat-flagged` event to `History`.

**Edge case:** at submit time, `CauseCode` may be empty (it's filled at close-out, not on raise). So the check actually runs on close-out submit, not on initial raise. Re-evaluation also runs whenever cause is edited.

**2. Daily sweep** (Azure Function) — once per night at 02:00, run a back-fill pass on the last 90 days of CPARs to catch any repeats that were missed (e.g. due to async ordering, edits, or outages). Idempotent — only flips `IsRepeat = false → true`, never the reverse.

**Card UI:** a red banner above the description: `🔴 REPEAT — 4th of this fault on Scroll Arm in 30 days. See: RP-03450, RP-03512, RP-03589`. Refs are clickable, opening the linked CPARs in a side panel.

## Data model — new SharePoint columns

Adding to `CPARLog` (additive — historical CPARs unchanged).

| Column                       | Type                       | Purpose                                                       |
|------------------------------|----------------------------|---------------------------------------------------------------|
| `Disposition`                | Choice                     | Reworked / Scrapped / Use-as-is / Returned / Other            |
| `DispositionNotes`           | Multi-line text            | Free-text qualifier                                           |
| `Containment`                | Multi-line text            | What stopped the bad batch (§8.7.1)                           |
| `ClosedOutBy`                | Single-line text (email)   | Area manager who completed closeout                           |
| `ClosedOutAt`                | DateTime                   | Closeout timestamp                                            |
| `ReviewedBy`                 | Single-line text (email)   | QHSE reviewer (currently Jonas)                               |
| `ReviewedAt`                 | DateTime                   | QHSE review timestamp                                         |
| `ReviewDecision`             | Choice                     | Approved / Escalated / Returned                               |
| `ReturnedNote`               | Multi-line text            | QHSE note when returning                                      |
| `InvestigatorAssigned`       | Choice                     | mark.staniland@… / gareth.stringer@…                          |
| `EscalatedBy`                | Single-line text (email)   | Who escalated                                                 |
| `EscalatedAt`                | DateTime                   | Escalation timestamp                                          |
| `InvestigatedBy`             | Single-line text (email)   | PE who completed investigation                                |
| `InvestigatedAt`             | DateTime                   | Investigation completion                                      |
| `InvestigationOutcome`       | Choice                     | Human Error / Template-Spec Issue                             |
| `ECRRef`                     | Single-line text           | Free-form ECR ref (e.g. `ECR-191`)                            |
| `IsRepeat`                   | Yes/No                     | Auto-set if same model+cause ≥ 3 times in 30d                 |
| `RepeatLinkedRefs`           | Multi-line text            | Semicolon-separated list of linked CPAR refs                  |
| `EffectivenessVerifiedBy`    | Single-line text (email)   | QHSE who confirmed effectiveness                              |
| `EffectivenessVerifiedAt`    | DateTime                   | Re-check timestamp                                            |
| `EffectivenessVerified`      | Yes/No                     | True = still effective; False = recurred                      |
| `RecurrenceNote`             | Multi-line text            | If recurred, describes the recurrence                         |
| `LinkedFromRef`              | Single-line text           | If this CPAR is the recurrence of a closed one, points back   |
| `Status`                     | Choice (extended)          | See enum above                                                |
| `History`                    | Multi-line text            | JSON-lines audit trail                                        |

Existing columns reused unchanged: `CauseCode`, `CorrectiveAction`, `Description`, `SourceDept`, `IssueCategory`, `RaisedByTeam`, `Title`, `LoggedAt`, `PrimaryREP`, `PrimaryJobNo`, `PrimaryModel`, `QTY`, `HasPhoto`, `AffectedJobs`, `TotalAffected`, `ClosedBy`, `ClosedAt`.

## UI changes

All in `index.html` (vanilla JS, no framework). New constants colocated with `SP_CPAR_LIST`.

### Existing CPAR card (Issues tab) — additions
- New status badges with distinct colours:
  - `Returned to Area Manager` → red, with banner showing QHSE return note
  - `Pending QHSE Review` → green
  - `Investigation` → purple
  - `Awaiting Final Sign-Off` → green
  - `Awaiting Effectiveness Check` → not shown on floor (manager-only)
  - `Archived` → not shown on floor
- **Repeat banner** (red, with linked refs) above description when `IsRepeat = true`
- Closeout panel becomes multi-block: Disposition radio grid → Containment textarea (conditional) → Root Cause grid → Corrective Action textarea
- Closed-state card adds: Disposition block, Containment block, Sign-Off trail (2-3 names), History expandable, ECR Ref pill, Effectiveness status badge ("✓ Verified 28/05" or "⏳ Re-check due 28/05"), Repeat info, **Print Non-Conforming Report** button

### New "Quality" tab — manager-only

Behind the existing Stats password gate (`statsPasswordOk` localStorage flag). Four sub-views, switched by chips:

- **QHSE Review queue** (Jonas)
  - Stat tiles: *To Review* / *Investigating* / *Returned* / *Awaiting Sign-Off* / *Awaiting Eff. Check* / *Overdue*
  - Per-card actions: **Approve & Close**, **Escalate** (modal), **Return** (modal)
  - Repeat-flagged cards have a red top-stripe and "Repeat — recommend escalating" hint

- **Production Engineer view** (Mark / Gareth)
  - Filter to CPARs where `InvestigatorAssigned` = logged-in user
  - Per-card actions: **Mark Human Error**, **Mark Template-Spec issue** (opens ECR mailto, prompts for ECR ref)

- **Quality Dashboard** (NEW)
  - Three vanilla-SVG charts:
    1. **Monthly raised vs closed** — 12-month trailing line chart, two series (raised, closed). Hover shows count + month.
    2. **Top 5 causes — current month** — horizontal bar chart, descending count, each bar tagged with cause code colour.
    3. **MTTR trend by team** — 12-month trailing line, one line per team that had any CPARs in window. MTTR computed in working hours (using existing `workingHoursBetween`) from `LoggedAt` to `ClosedAt`.
  - Above charts: 4 KPI cards (Open count · Closed this month · Avg MTTR · Repeat-flagged count this month)
  - Below charts: "Top recent repeat-flagged issues" list (last 30d)

- **Register**
  - Date range / team / status filters
  - Inline table of matching CPARs
  - **Export CSV** button → client-side CSV blob (column set in §7 below)
  - Date range default: last 30 days; "All time" toggles include `Archived`

### Print Non-Conforming Report (single-CPAR PDF)
Triggered from closed-state card. Print-only stylesheet (`@media print`). User triggers `window.print()` → "Print to PDF". No library.

Layout mirrors the `NCR Report` sheet in `CPAR Dashboard.xlsm`:
- Repose logo + QMS doc-control header (`PHCF-NCR-001`, issue, page)
- Title: **Non-Conforming Job Note**
- Header table: REF · Date Raised · Raised by · Department · Job Ref · Model · QTY · Source/Category
- **Concern / Issue / Fault** block (Description)
- **Containment Action** block
- **Disposition** tick-box grid
- **Possible Root Cause** 6-cell tick-box grid
- **Investigation Findings & Corrective Action** block
- **Linked ECR** cell
- **Sign-Off** — 2 or 3 boxes with name + role + ISO timestamp
- **Effectiveness Check** — appended once verified ("Re-checked 28/05/2026 by J. Simonaitis — Verified Effective")
- Footer: "Generated from RepNet · CPARLog/RP-XXXXX · Retention: 7 years per ISO 9001 §7.5"

## Email automation

### Per-team morning digest
New Azure Function next to `azure-functions/daily-report/`. Cron: `0 0 7 * * 1-5` (07:00 UK Mon–Fri).

For each team in `TEAM_MANAGERS`:
- Fetch CPARs where `(SourceDept matches team) AND (created last working day OR Status NOT IN (Closed, Archived))`
- Build HTML email with two tables:
  - **Raised against you yesterday** (Ref / Job / Description / QTY / Status / Repeat? badge)
  - **Still open against you** (above + Days Open)
- Send via `/me/sendMail` to `TEAM_MANAGERS[team]`
- Master combined digest to `DIGEST_MANAGEMENT` (Mitch + Richard)

Follows existing `buildDigestHtml(...)` styling.

### Investigator assignment notification
Immediate email when Jonas escalates → assigned PE.
- Subject: `[CPAR RP-XXXXX] Investigation assigned — <model>`
- Body: ref, source dept, description, repeat status, link to RepNet CPAR view, ECR mailto pre-fill

### Return-to-sender notification
Immediate email to area manager + cc `TEAM_MANAGERS[SourceDept]`:
- Subject: `[CPAR RP-XXXXX] Returned for revision`
- Body: Jonas's return note, link to RepNet CPAR

### Weekly effectiveness re-check reminder
New Azure Function. Cron: `0 0 7 * * 1` (Mondays 07:00 UK only).
- Email to Jonas listing: due-this-week, overdue, all in `Awaiting Effectiveness Check`
- Subject: `Effectiveness re-checks due — <count> this week`

### Monthly KPI export
New Azure Function. Cron: `0 0 7 1 * *` (1st of every month 07:00 UK; falls forward to next working day if 1st = Sat/Sun via job logic).

Generates a CSV attached to an email sent to Jonas + `DIGEST_MANAGEMENT`. Columns:

| # | Column                    | Description                                              |
|---|---------------------------|----------------------------------------------------------|
| 1 | Period                    | YYYY-MM (the month being reported on)                    |
| 2 | Team                      | Source dept (one row per team + one "ALL" row)           |
| 3 | Opened                    | Count raised in period                                   |
| 4 | Closed                    | Count moved to Closed in period                          |
| 5 | Still Open (end of month) | Count not in Closed or Archived at end of period         |
| 6 | MTTR (working hrs)        | Mean time-to-close in working hours (Mon–Fri 06:00–17:00)|
| 7 | Top Cause                 | Most-frequent CauseCode in period                        |
| 8 | Top Cause Count           | Count of the top cause                                   |
| 9 | Repeat-flagged count      | CPARs with `IsRepeat = true` raised in period            |
| 10 | ECR-linked count         | CPARs with non-empty `ECRRef` closed in period           |
| 11 | Effectiveness-verified count | Re-checks completed in period (verified true)        |
| 12 | Effectiveness-failed count | Re-checks completed in period (recurred / verified false) |

Filename: `cpar-kpi-YYYY-MM.csv`.

## Bulk register CSV export

Client-side, no library. Triggered from Quality → Register → Export.

Columns (one row per CPAR):

| # | Column                  | Source                                    |
|---|-------------------------|-------------------------------------------|
| 1 | REF                     | `Title`                                   |
| 2 | Date Raised             | `LoggedAt`                                |
| 3 | Raised By Team          | `RaisedByTeam`                            |
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
| 20 | Repeat?                | `IsRepeat`                                |
| 21 | Repeat Linked Refs     | `RepeatLinkedRefs`                        |
| 22 | Eff. Verified By / At  | `EffectivenessVerifiedBy`/`At`            |
| 23 | Eff. Verified?         | `EffectivenessVerified`                   |
| 24 | Recurrence Note        | `RecurrenceNote`                          |
| 25 | Linked-From Ref        | `LinkedFromRef`                           |
| 26 | Days Open              | computed: `(ClosedAt OR now) - LoggedAt` working days |
| 27 | Status                 | `Status`                                  |

CSV is RFC 4180 compliant. Filename: `cpar-register-YYYY-MM-DD.csv`.

## ISO 9001 clause coverage

| Clause   | Requirement                                              | Where it's satisfied                                                          |
|----------|----------------------------------------------------------|-------------------------------------------------------------------------------|
| 8.7.1    | Identify & control non-conforming output                  | Status workflow + Containment field                                           |
| 8.7.1 a-d | Disposition options                                      | `Disposition` field                                                            |
| 8.7.2    | Documented information on actions & approving authority   | Sign-off trail (2-3 names) + History audit + PDF print + bulk CSV             |
| 9.1.3    | Analysis & evaluation                                    | Quality Dashboard + Monthly KPI export                                        |
| 10.2.1 a  | React to nonconformity, contain, deal with consequences  | Area-manager closeout step + Containment field                                |
| 10.2.1 b  | Evaluate need for action to eliminate cause              | QHSE Review + Investigation + **Repeat-issue auto-flag**                      |
| 10.2.1 c  | Implement action                                         | `CorrectiveAction` + Investigation step                                       |
| 10.2.1 d  | Update risks/opportunities                               | ECR raise + ECRRef capture                                                    |
| 10.2.1 e  | Review effectiveness of corrective action                | **30-day Effectiveness Re-Check workflow + verified flag in audit pack**      |
| 10.2.1 f  | Update QMS if necessary                                  | KPI rollup feeds management review meetings                                   |
| 10.2.2    | Retain documented information as evidence                | `CPARLog` SP list + History column + PDF + CSV + KPI exports                  |
| 7.5      | Documented info — control & retention                    | 7-year retention documented in print footer (no auto-delete)                  |

## Migration

- **No backfill** of historical 12k CPARs. New columns are nullable. Legacy CPARs render with empty fields exactly as today.
- Issues tab list filter logic updated so legacy `Closed` CPARs still appear under new `Closed` chip; legacy `Open` CPARs under `To do`.
- `cpar_max_ref` localStorage counter keeps working — new CPARs continue the existing `RP-NNNNN` sequence.
- Repeat-detection runs only on CPARs raised post-go-live (legacy `CauseCode` quality is too patchy to trust).

## Implementation order (full plan in writing-plans hand-off)

1. SP column additions (manual or via `migrate-cpar.html` scaffold)
2. Status enum extension + Issues tab filter chip refactor
3. Closeout-panel multi-block redesign
4. Quality tab + QHSE Review queue + PE view
5. Repeat-issue detection (close-out hook + nightly sweep stub)
6. Print-to-PDF stylesheet + single-CPAR layout
7. CSV register export
8. Email: investigator assignment + return-to-sender
9. Azure Function: per-team morning digest
10. Effectiveness Re-Check workflow + queue tile + weekly reminder Azure Function
11. Quality Dashboard with 3 vanilla SVG charts + KPI cards
12. Monthly KPI export Azure Function
13. End-to-end test: full lifecycle (raise → repeat-detect → closeout → review → escalate → investigate → ECR mailto → final close → 30-day re-check → archived; plus return-to-sender path)

## Open questions / decisions logged

- ✅ Approach 3 chosen
- ✅ Final closure authority = Jonas (QHSE)
- ✅ Production Engineers = Mark Staniland, Gareth Stringer
- ✅ ECR system stays in Word for now; CPAR captures `ECRRef` only
- ✅ Return-to-sender = real state (`Returned to Area Manager`)
- ✅ No per-issue email; daily team digest at 07:00 Mon–Fri
- ✅ CSV exports first; `.xlsx` later
- ✅ Repeat threshold = same `PrimaryModel` + `CauseCode` ≥ 3 in 30 days
- ✅ Effectiveness re-check = fixed 30 days for all CPARs; Jonas does the check; two-button confirmation
- ✅ Retention = 7 years documented in print footer, no auto-delete

## Out-of-scope (phase-2-or-later candidates)

- Native ECR module in RepNet (linked from CPAR)
- `.xlsx` formatted exports with charts
- Backfill of historical 12k CPARs
- 8D structured problem-solving template for repeat issues
- Auto-archive / hard-delete after 7 years
- ISO 13485 / ISO 45001 / ISO 14001 specific extensions (separate spec)
