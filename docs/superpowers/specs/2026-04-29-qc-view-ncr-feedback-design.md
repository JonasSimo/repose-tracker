# QC View + NCR Feedback Loop — Design Spec

**Date:** 2026-04-29
**Author:** Jonas Simonaitis (QHSE Manager) with Claude
**Status:** Draft — pending Jonas review
**Builds on:** the CPAR ISO 9001 redesign (`2026-04-27-cpar-iso9001-design.md`) — uses the same `CPARLog` SP list and `submitCPAR` flow.

## Problem

Repose's Quality Control team currently has no purpose-built RepNet view. When QC inspects a chair and finds a defect, they have to either flag it verbally or use the same Team View as the production teams — which exposes job-completion buttons they shouldn't touch and requires them to navigate to find the right job.

There's also no clear visual signal back to area managers (Upholstery, Assembly) that QC has rejected a specific job. Today a chair gets manually moved to a "hold" area with a red sticker, and the area manager has to be told verbally what's wrong.

## Goals

1. Give QC a **dedicated Team View mode** on tablet PWAs — same shell as the existing team views, with completion buttons hidden and the only action being **Raise Internal NCR**.
2. After raising an NCR, show a **big-ref modal** so QC can transcribe the NCR reference number onto the physical red sticker that travels with the rejected chair.
3. **Visual feedback to area managers:**
   - **Delivery view stripe** — red while QC's NCR is open against a job, orange when the area manager has actioned it, green (existing) when QC re-verifies.
   - **Production Plan view banner** — a red banner above any job with an open QC-raised NCR, showing the NCR ref + summary so the area manager knows exactly what to fix.
4. **Zero SharePoint schema changes** — reuse the existing `CPARLog` columns. The new behaviour is driven entirely by `RaisedByTeam = 'QC'` + the existing `Status` lifecycle.

## Non-Goals (deferred / out of scope)

- **Label printer integration** — staff write the NCR ref by hand on the red sticker. A future iteration can add a "Print sticker" button if QC gets a Brother/Dymo printer.
- **QR-code on the sticker** — out of scope. The handwritten ref is sufficient for traceability since each NCR is linked back via the existing CPARLog.
- **Bulk NCR raise** (multiple jobs at once) — single-job raise only.
- **Per-defect photos beyond the existing CPAR photo upload** — already supported in the current CPAR raise form.
- **Individual QC accounts** — Weronika's account is shared across all QC tablets. Audit trail records her email on every NCR; that's accepted as good-enough traceability for now (QCs don't have individual M365 emails).

## Architecture

### View

Adds **QC** as a selectable team in the existing team-select screen (already exists in `TEAMS_CFG` with icon `✅`). When `activeTeam === 'QC'`, the existing Team View renderer applies a "QC mode" branch that:

- Forces the team filter to "all teams" (every prep day shows every team's jobs).
- Hides all completion buttons (`Mark Complete`, `Mark QC'd`, etc.).
- Keeps only the **Raise Internal NCR** button on each job card (renamed from "⚠ CPAR" to "⚠ NCR" for terminology alignment).
- Shows a **mode banner** at the top: "🔍 QC View — read-only inspection mode. Raise NCRs against any job."

Same PWA install. Same MSAL auth (Weronika's account on all QC tablets). Same offline-first service-worker shell.

### Sticker modal

After QC clicks "Raise NCR" and submits the existing CPAR form, the existing success path is augmented: a **full-screen modal** opens showing the new NCR's reference number in massive monospace (target ~64pt). Modal copy:

```
Internal NCR Raised

         RP-03742

📝 Manually write the Internal NCR reference
   number on the red sticker and apply to the
   faulty item being sent.

Job:   REP-23145 / Job 22 / Scroll Arm
Issue: <first 80 chars of description>

[ ✓ I've written the ref — Done ]
```

Single dismiss button, auto-focus so QC can confirm with one tap. Tap-outside-to-close is **disabled** (must explicitly confirm) so the ref isn't dismissed accidentally before being written.

### Delivery-view stripe lifecycle

Currently the Delivery view (`renderLoadSheet`) shows orange stripes for in-progress rows and green for QC'd rows. Add a third state: **red** when an open QC-raised NCR exists against the job.

Stripe state, in priority order:
1. **🟢 Green** — `rep.s.qc === 1` (existing behaviour, unchanged)
2. **🔴 Red** — at least one CPAR exists in `CPAR_ITEMS` where:
   - `RaisedByTeam = 'QC'`
   - `PrimaryREP / PrimaryJobNo` matches the row
   - `Status` is in `['Open', 'Returned to Area Manager']` (NCR is sitting with the area manager, not yet actioned)
3. **🟠 Orange** — anything else not yet QC'd (existing behaviour, unchanged). Includes the case where a previously red row's NCR is now in `Pending QHSE Review` or beyond — the area manager has actioned it; QC re-inspects.

Multiple NCRs on one job: stripe stays red while *any* match the red criteria. Reverts to orange when *all* QC-raised NCRs on that job have moved past `Open` / `Returned`.

### Production Plan red banner

`view-production` (the production plan rendering) gets a banner injection per job. For any job with at least one open QC-raised NCR (same predicate as the red-stripe rule), a **red banner** is rendered above the job card:

```
🔴 NCR RP-03742 — returned by QC
   "Staple sticking out of OSB on inner panel"
   Click to open NCR ▸
```

Click → opens the existing CPAR card via `openCPARByRef('RP-03742')` (Quality → Internal NCRs sub-view, expanded to that NCR). Area manager can close it out from there without leaving the Production Plan flow conceptually — they go to Quality, fill the closeout form, submit, then come back.

Multiple NCRs on one job: stack multiple banners (one per NCR). Banner disappears when the NCR is closed out.

### Auto-prefill SourceDept on QC raise

When the CPAR form is opened from the QC view, the form should default `SourceDept` to the team that *built* the chair (likeliest culprit). Logic: look at the most recent `ProductionCompletion` SP-list entry for the job's REP — that gives the last team to touch it (typically Upholstery or Assembly). Pre-select that team in the SourceDept dropdown; QC can override if needed.

If no ProductionCompletion exists yet (chair hasn't reached any team), leave the SourceDept dropdown blank — QC picks manually. No fallback guess.

`RaisedByTeam` is auto-set to `'QC'` (always, since active team is QC).

## Data Model — no changes

All behaviour driven by existing columns:

- `RaisedByTeam` — frontend now writes `'QC'` when raising from QC view (existing flow already passes `activeTeam`).
- `PrimaryREP` / `PrimaryJobNo` — link NCR to delivery row.
- `Status` lifecycle — drives stripe + banner visibility.
- `Description`, `Disposition`, `Containment`, `CauseCode`, `CorrectiveAction`, `History` — unchanged.

## UI changes

### `index.html`

| Region | Change |
|---|---|
| Job-card raise button | Rename "⚠ CPAR" label → "⚠ NCR" (cosmetic terminology). Logic unchanged. |
| Team View renderer | Add `activeTeam === 'QC'` branch: force "all teams", hide completion buttons, show mode banner. |
| Post-raise success path in `submitCPAR` | After existing success toast, if `activeTeam === 'QC'`, open the new sticker modal with the new ref. |
| New: sticker modal markup | New `<div id="qc-ncr-sticker-modal">` near other modals before `</body>`. |
| `renderLoadSheet` | Compute `qcReturnSet` (Set of `repId#jobNo` strings with open QC-raised NCRs). When a row matches and not yet QC'd, apply `class="rep-stripe red"` instead of `orange`. Add CSS rule `.rep-stripe.red { background:var(--red); /* + same striped texture as orange */ }` mirroring the existing `.rep-stripe.orange` declaration. |
| Production Plan view renderer | Compute same predicate per job. Inject red banner div above each affected job's card. Banner click → `openCPARByRef`. |
| `submitCPAR` | When `activeTeam === 'QC'`, before opening the form, look up the most recent ProductionCompletion for the job and pre-select that team in the SourceDept dropdown. |

### `service-worker.js`

Cache bump v24.

## Edge cases

- **NCR raised, then QC verifies fix and QC's the job before area manager closes-out** — chair becomes green (QC'd) but the NCR is still `Open`. The audit-trail still shows the NCR was raised; QC just chose to verify-and-close in one step. Acceptable. The NCR can be closed out separately by the area manager later; if not, it sits in Open until cleaned up by a sweep or manual.
- **Two QC tablets raise NCRs on the same job simultaneously** — both succeed, two NCRs on the job, both shown as banners. Last write doesn't lose either since they're separate items. (No race.)
- **Job moves from one prep day to another mid-NCR** — NCR is keyed by `PrimaryREP`/`PrimaryJobNo` not prep day. Stripe + banner follow the job correctly across prep-day shifts.
- **NCR is `Returned to Area Manager` (QHSE returned the closeout)** — counts as still-open red stripe. The area manager sees the red stripe + the Quality "Returned" banner together; both clear once they resubmit and it goes back to Pending QHSE Review.
- **Area manager closes out, then QHSE returns it** — stripe goes orange briefly (during Pending QHSE Review), then back to red (during Returned to Area Manager), then orange again on resubmit.

## ISO 9001 alignment

Reinforces:
- §8.7.1 — control of nonconforming output: red sticker + ref + visual signal in three places (sticker, Delivery stripe, Production banner) means a defective item can't move forward unnoticed.
- §10.2.2 — retain documented information as evidence: every QC inspection that produces an NCR is logged in `CPARLog` with `RaisedByTeam = 'QC'`, audit-traceable.
- The 3-state stripe (red → orange → green) is itself a quality KPI proxy: any chair that goes red and then never reaches green is a process gap worth reviewing.

## Implementation order (sketch — full plan in writing-plans hand-off)

1. Add QC-mode branch to Team View renderer (hide completion buttons, force all-teams filter, mode banner).
2. Rename "CPAR" → "NCR" on the raise button.
3. Sticker modal markup + CSS + post-raise integration.
4. Auto-prefill `SourceDept` from last ProductionCompletion when QC opens the raise form.
5. Compute `qcReturnSet` predicate; wire into `renderLoadSheet` for red stripe.
6. Wire same predicate into Production Plan renderer for red banner.
7. Cache bump v24 + manual test pass.

## Effort estimate

User estimate: 1 day. My estimate: 1.5–2 days for a polished version including all 7 implementation steps + visual QA on tablet. Single day is achievable if we cut corners on (e.g.) the auto-prefill SourceDept and accept QC manually picking it. Plan for 1-2 days, ship in 1 if we hit it.

## Open questions / decisions logged

- ✅ Access model: MSAL with Weronika's account, shared across QC tablets
- ✅ Job set: same as Team View, no team filter (all teams)
- ✅ NCR ref display: big-ref full-screen modal with handwriting instructions
- ✅ Stripe lifecycle: red (NCR open by QC) → orange (area manager closed-out) → green (QC re-verified)
- ✅ Production banner: red, click to open NCR
- ✅ Auto-prefill SourceDept from last completion team
- ✅ Zero SP schema changes

## Out of scope (phase 2 candidates)

- Label printer integration for NCR stickers
- QR code embedded in printed sticker
- Bulk NCR raise (multi-job)
- QC inspector individual accounts (when QCs get their own emails)
- "Repeat-from-QC" detection (e.g. QC flags same chair twice — escalate to systemic issue)
