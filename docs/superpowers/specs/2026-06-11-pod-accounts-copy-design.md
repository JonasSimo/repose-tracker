# POD accounts copy — design (2026-06-11)

Approved by Jonas in-session 2026-06-11.

## What

Every completed white-glove POD — regardless of customer — additionally emails an
internal copy to `accounts@reposefurniture.co.uk`, identifying the customer from the
production plan and quoting the PO + REP number(s), with the POD PDF attached.

The existing Grosvenor / Charterhouse customer flow is **untouched**: no CC, no shared
email. The accounts copy is always a separate email with its own subject, body, and
its own send log, so a failure in either flow never blocks the other.

## How

Extends the existing `pod-auto-send` timer function (same 15-min scan, same
eligibility: completed + non-archived). Each eligible audit now feeds two independent
sends; the SC PDF export is performed once and shared.

- **Recipient**: new app setting `POD_ACCOUNTS_EMAIL`. Unset ⇒ accounts flow off
  (kill switch); customer flow unaffected.
- **TRIAL mode**: accounts copy redirects to `POD_TRIAL_RECIPIENT` like customer
  sends do — TRIAL means no email leaves Jonas's inbox.
- **Customer name**: production plan column D (client) + column R (trade account,
  tally suffix `- N` stripped). Shown as `CLIENT (ACCOUNT)` when they differ, just
  `CLIENT` when same. REP not in plan ⇒ `(not found in production plan)` — accounts
  still gets the POD.
- **Subject**: `POD for <customer> — PO <orderNo> · REP NNNNNNN [+ REP …]`
  (PO omitted when the inspection has none).
- **Dedup/log**: new Supabase table `pod_accounts_send_log` (PK `audit_id`,
  claim → sent/failed lifecycle identical to `pod_send_log`). Migration must be
  pasted into the Supabase SQL editor — feature is inert until applied (claim
  insert fails, customer flow unaffected).
- **Forward-only**: PODs already behind the watermark don't get retro accounts
  copies.

## Out of scope

Backfilling accounts copies for PODs sent before this feature; any change to
customer routing or eligibility.
