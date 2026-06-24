# Assembly Backlog — Daily 07:00 Email to Richard Semmens

**Date:** 2026-06-17
**Status:** Design approved, ready for implementation plan
**Branch:** `pod-auto-send-trial` (azure-functions worktree)

## Goal

Email **richard.semmens@reposefurniture.co.uk** every **working day (Mon–Fri) at
07:00** the Assembly backlog for `/stats/team/assembly` — the exact same data
the website's **"Backlog"** export button produces — as a CSV attachment plus a
short HTML summary. Send from the established `systemapp@reposefurniture.co.uk`
auto-email sender. Trigger one **real** send today (not a test), then daily
going forward.

## Hard requirement

The attached CSV must be **byte-for-byte identical** to what the website button
emits today:

- Headers: `REP, Week, W/C Date, Prep Day, Item No, Days Late, Express?`
- Every field wrapped per `csvEsc` (double-quoted, internal `"` doubled)
- Fields joined with `,`, rows joined with `\r\n`
- UTF-8 BOM (`﻿`) prepended
- Filename: `repose-assembly-backlog-YYYY-MM-DD.csv`
- Same row set, same sort (days-late desc, then REP asc), same `Days Late`
  definition (working days strictly after the prep due date, up to and
  including today; Express rows = 0)

This is achieved by porting `repnet/src/features/stats/assemblyBacklog.ts`
(`getAssemblyBacklogRows` + `backlogRowsToCsv`) **verbatim** into the function.

## Why recompute server-side

The backlog is computed entirely client-side in the browser. There is no server
endpoint to call. Two rejected alternatives:

- **Headless-render the SWA and click the button** — fragile (Supabase JWT
  bridge, MSAL, a browser running in Azure Functions). Rejected.
- **Supabase Edge Function** — would duplicate the Graph/MSAL auth already
  working in this Function App and split the deployment. Rejected.

Chosen: a new Node timer function in the existing Function App that reproduces
the three inputs and runs the ported calc.

## Inputs (all reproducible from existing code)

| Input | Source | Reuse |
|---|---|---|
| Production plan → `WeekData[]` (weeks → prep slots 1–5 + express → jobs with `rep`, `itemNo`, `expressType`) | SharePoint plan workbook via Graph Workbook API | `pod-auto-send/prod-plan.js` already resolves the share + opens the workbook. Extend to a full-plan parse — port of `repnet/src/features/production/loader.ts`. |
| Completions (done chairs) | Supabase `production_completions` | `daily-report` already reads Supabase with the service-role key. Query `team='Assembly'`; build the set of `wk\|prep\|rep` keys where `is_complete=true`. Mirrors `indexCompletions` + `stateKey('Assembly','all',wk,p,rep)`. |
| QC-passed REPs (QC sign-off counts as done) | QC Excel sheet on the **Quality** site via Graph | Port of `repnet/src/features/production/qcAutoSync.ts` — column A holds 7-digit REPs. Only the `Set<rep7>` is needed (`.has(rep7)`). |

Supporting pure helpers to port: `workingDays.ts` (`isWorkingDay`,
`workingPrepNumber`, bank-holiday list) and `dates.ts` (`isoWeekOfDate`).

## Backlog rule (ported verbatim)

A job is in the backlog when **all** hold:

1. Its prep day has passed (past weeks fully; current week only prep slots
   before today's prep; Express counts for the current and earlier weeks).
2. It is **not** marked done in `production_completions`
   (`stateKey('Assembly','all',wk,prep,rep)` → `.done` is false/absent).
3. Its 7-digit REP is **not** in the QC-passed set (operators sometimes skip
   the Assembly "done" tick once a chair clears QC).

## Module layout (`azure-functions/assembly-backlog-report/`)

- `function.json` — timer binding, `"schedule": "0 0 7 * * 1-5"`, `disabled`
  cleared for deploy.
- `index.js` — handler: load 3 inputs in sequence → `getAssemblyBacklogRows` →
  `backlogRowsToCsv` → build HTML summary → `sendMail` with a `fileAttachment`.
- `assembly-backlog.js` — port of `assemblyBacklog.ts` (rows + CSV).
- `plan-weeks.js` — full-plan parse (port of `loader.ts`).
- `qc.js` — QC-passed REP set (port of `qcAutoSync.ts`).
- `working-days.js` / `dates.js` — pure date helpers.
- `repnet-logo-white.png` — copied from a sibling function for the HTML header.

Graph/MSAL and Supabase access follow the existing patterns in the tree.

## Email

- **From:** `systemapp@reposefurniture.co.uk` (via Graph `users/{SEND_FROM}/sendMail`).
- **To:** `richard.semmens@reposefurniture.co.uk` only.
- **Subject:** `RepNet — Assembly Backlog — <weekday D Month YYYY>`.
- **Body (HTML):** RepNet-branded header (navy, white logo) + one-line summary
  (`N overdue Assembly chairs this morning`, oldest job's days-late), a small
  preview table of the top rows, and a link to
  `…/stats/team/assembly`. Footer: "automated at 07:00 each working day · do
  not reply".
- **Attachment:** the BOM CSV as a Graph `#microsoft.graph.fileAttachment`
  (`contentType: text/csv`, `contentBytes` = base64 of `﻿` + csv,
  `name` = `repose-assembly-backlog-YYYY-MM-DD.csv`).
- **Empty backlog:** still send — subject `… — All clear`, body
  `✓ No overdue Assembly chairs this morning`, no attachment (or an empty CSV
  with just the header — decide in plan; default: no attachment).

## Secrets / config

None new. The Function App already has `TENANT_ID`, `CLIENT_ID`,
`CLIENT_SECRET`, `SEND_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
A `BACKLOG_REPORT_RECIPIENT` app setting (default `richard.semmens@…`) and an
optional `BACKLOG_REPORT_DRY_RUN=1` kill switch are nice-to-haves.

## Pre-flight before the first real send

Because this recomputes a calc rather than calling the proven button, run once
in **dry-run** (compute only, no email), report the row count + a few sample
rows, and confirm the number matches the website. Then trigger the **real**
send to Richard today via the deployed function's admin endpoint. After that it
runs unattended at 07:00 Mon–Fri.

## Deploy

Commit to `pod-auto-send-trial`; deploy via
`gh workflow run --ref pod-auto-send-trial` (same path as pod-auto-send).

## Out of scope

- Other teams (Assembly only — that's the only team with a Backlog export).
- Bank-holiday awareness of the cron schedule (other digests are also
  Mon–Fri-only and BH-unaware; the calc itself *is* BH-aware via
  `isWorkingDay`).
- Any change to the website button or `assemblyBacklog.ts`.
