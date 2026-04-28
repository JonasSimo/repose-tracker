# CPAR ISO 9001 Redesign — End-to-End Test Plan

Walk through these scenarios in a test environment (or with a known throwaway CPAR) before declaring sign-off-ready.

## Prerequisites

- Phases 0-8 deployed to live (verify by `git log --oneline | head -40`)
- All 24 new SharePoint columns exist on `CPARLog`
- All 4 Azure Functions deployed and running (`repnet-daily-report` Function App in Azure portal shows 5 functions)
- Mail.Send admin consent granted on the RepNet Entra app

## Scenario A — Happy path (Approve)

1. Operator raises CPAR via Issues tab (existing flow — click Close Out button on any job card).
2. Verify: morning digest email arrives next working day at 07:00 to area manager.
3. Area manager opens CPAR → Close Out → fills Disposition (Reworked), Containment, Cause (Human Error), Action.
4. Verify: status becomes `Pending QHSE Review`, History has 2 entries.
5. Jonas (QHSE) opens Quality → Review queue → To Review tile shows the CPAR.
6. Click ✓ Approve & Close.
7. Verify: status becomes `Closed`, sign-off trail shows 2 names.
8. Wait 30 days (or manually edit `ClosedAt` in SharePoint to 31 days ago).
9. Reload Quality → Review → CPAR auto-moves to Awaiting Eff. Check tile.
10. Click ✓ Still effective.
11. Verify: status becomes `Archived`, `EffectivenessVerified = true`.

## Scenario B — Escalation path (PE assigned)

1. Raise + Close Out as in A.
2. Jonas → Escalate → Mark Staniland.
3. Verify: email arrives to Mark.
4. Sign in as Mark → Quality → PE View → see CPAR.
5. Click "Mark Template/Spec issue".
6. ECR mailto opens — send to Prism Engineering.
7. Prism replies with `ECR-200`.
8. Mark pastes `ECR-200` into the input → Save & complete investigation.
9. Verify: status `Awaiting Final Sign-Off`, `ECRRef = ECR-200`.
10. Jonas → Approve.
11. Verify: closed with all 3 sign-off names + ECR ref shown on closed-state card.

## Scenario C — Return to sender

1. Raise + Close Out (with intentionally weak corrective action).
2. Jonas → Return → "Please add details about the operator brief".
3. Verify: status `Returned to Area Manager`, email arrives to area manager + cc team managers.
4. Area manager edits the corrective action, resubmits.
5. Verify: status back to `Pending QHSE Review`, History shows return event.

## Scenario D — Repeat detection

1. Close out 2 CPARs against same `PrimaryModel` (e.g. "Scroll Arm") with same `CauseCode` (e.g. "Human Error") in the same week.
2. Raise + close out a 3rd. On submit, verify red REPEAT banner appears with links to prior 2.
3. Verify: `IsRepeat = true`, `RepeatLinkedRefs` populated.
4. Jonas opens it in QHSE Review — sees REPEAT badge.

## Scenario E — Recurrence (Effectiveness FAILED)

1. Take a CPAR that's been Closed > 30 days, in Awaiting Eff. Check.
2. Click ✗ Recurred — re-open. Enter recurrence note in browser prompt.
3. Verify: original status → Archived, `EffectivenessVerified = false`.
4. Verify: new CPAR auto-created with `LinkedFromRef` = original ref, status `Open`, description prefixed `[RECURRENCE of ...]`.

## Scenario F — Print PDF

1. Open any closed CPAR.
2. Click 🖨 Print Non-Conformance Report (PDF).
3. Verify: print preview opens via transient iframe with full NCR layout — header / REF / dates / Concern / Containment / Disposition tick-boxes / Cause tick-boxes / Corrective Action / Sign-Off block / retention footer.
4. Save as PDF, verify it's A4 portrait, 1 page.

## Scenario G — CSV register export

1. Quality → Register → set date range last 90 days, no team filter, all statuses.
2. Click 📊 Export CSV.
3. Open in Excel — verify all 33 columns populate (REF, Date Raised, Source Dept, Disposition, Containment, sign-off audit fields, EffectivenessVerified, etc.). No escaping artefacts on descriptions with commas/quotes.

## Scenario H — Monthly KPI export

1. On 1st of next month, verify KPI email arrives at 07:00 with `cpar-kpi-YYYY-MM.csv` attached.
2. Open — verify columns: Period, Team, Opened, Closed, Still Open EOM, MTTR, Top Cause, Top Cause Count, Repeat-flagged, ECR-linked, Eff. Verified, Eff. Failed.
3. Sanity-check: ALL row at the bottom should equal the sum of per-team rows for Opened/Closed/Repeat-flagged.

## Scenario I — Daily team digest

1. Wait until next working day morning (07:00 UK).
2. Verify each team manager receives email with: yesterday's raised + still-open lists.
3. Verify Mitch + Richard get a master "All Teams" digest.
4. Spot-check: open one team's email, click any ref-listed CPAR — should match what's in RepNet.

## Scenario J — Effectiveness reminder

1. Wait until next Monday 07:00.
2. Verify Jonas receives an `Effectiveness re-checks due` email if any are pending.
3. Click into RepNet → Quality → QHSE Review → Eff. Check tile — count should match email.

## Scenario K — Quality Dashboard

1. Quality → Dashboard.
2. Verify 4 KPI tiles populate (Open total, Closed this month, Avg MTTR, Repeat-flagged this month).
3. Verify all 3 charts render (Raised vs Closed line, Top 5 Causes bar, MTTR by team line).
4. Verify "Recent repeat-flagged" list at bottom — shows last 30 days of repeats.

---

## Done = all scenarios pass

After all 11 scenarios pass, the CPAR ISO 9001 redesign is audit-ready.
