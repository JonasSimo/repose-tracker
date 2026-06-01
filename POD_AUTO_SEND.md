# POD auto-send (SafetyCulture → email)

Timer-driven Azure Function that picks up completed white-glove delivery PODs from SafetyCulture every 15 minutes, exports the inspection PDF, and emails it via Graph. Phase 1 is in **trial mode** — every send is routed to a single internal recipient (`POD_TRIAL_RECIPIENT`) regardless of who the real customer is, so we can validate eligibility, REP extraction, and PDF rendering without touching customers.

## Pieces

| Piece | Path |
| --- | --- |
| Supabase migration | `repnet/supabase/migrations/0038_pod_auto_send.sql` |
| Azure Function | `bin/azure-functions/pod-auto-send/` |
| Template-ID helper | `bin/azure-functions/safetyculture-sync/find-template-id.js` |
| Local dry-run script | `bin/azure-functions/pod-auto-send/dry-run.js` |

## One-time setup

### 1 — Apply the migration

```bash
supabase db push      # or run 0038_pod_auto_send.sql in the SQL editor
```

Creates `pod_send_sync_state` (watermark per template) and `pod_send_log` (one row per audit, PK on `audit_id`).

### 2 — Find the POD template IDs

White-glove deliveries have separate Office and Home variants — capture both. Run from `bin/azure-functions`:

```powershell
$env:SAFETYCULTURE_API_TOKEN = "<bearer token>"
node safetyculture-sync\find-template-id.js "white glove"
```

Copy each `template_id` (e.g. `template_aBcDeF12345`) — they go in a comma-separated list in step 3.

### 3 — Configure the Function App

RepNet Function App → Configuration → Application settings. SC token, Supabase keys, and Graph credentials (`TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` / `SEND_FROM`) are shared with the other functions and are already set — only add what's new:

| Setting | Value |
| --- | --- |
| `SAFETYCULTURE_POD_TEMPLATE_IDS` | comma-separated template IDs from step 2 |
| `POD_SEND_MODE` | `TRIAL` (do not set `LIVE` yet — see below) |
| `POD_TRIAL_RECIPIENT` | Jonas's mailbox while trialling |

### 4 — Deploy and trigger

`git push` to `main` runs the deploy workflow. After deploy completes the timer fires every 15 minutes automatically. For the first run, manually trigger: Azure portal → Function App → Functions → `pod-auto-send` → Code + Test → Test/Run. Watch the logs for `[pod-auto-send] template <id> summary sent=… failed=…`.

## When does an audit send?

An audit is sent the first time **all** of these hold:

1. `audit_data.date_completed` is set (SC status is Complete).
2. The "Installed By (Signature)" item has a captured signature.
3. The "Chair accepted by (Signature)" item has a captured signature.
4. The `audit_id` is not already in `pod_send_log`.

The REP serial is pulled from the "REP Serial number" question first, falling back to `document_no` and the audit title. The regex uses lookbehind / lookahead — `(?<!\d)(\d{7})(?!\d)` — so jammed-prefix strings like `REP2521107` match correctly (see `feedback_word_boundary_regex.md`; `\b` does **not** work here).

## Status values in `pod_send_log`

| Status | Meaning |
| --- | --- |
| `claimed` | Atomic-claim placeholder inserted before the SC export + Graph send. Either the run is in-flight, or it **crashed mid-send** — investigate manually. |
| `sent` | Graph accepted the mail. Terminal. |
| `failed` | SC export or Graph send raised; `error_message` has the first 500 chars. |
| `skipped` | Reserved for Phase 2 (e.g. holds, "do not email" flags). Not used in Phase 1. |

A row stuck at `claimed` for more than one timer cycle means the function died between the claim insert and the status update — check the Function App logs around that audit's `sent_at`.

## Idempotency

`pod_send_log.audit_id` is the primary key. The claim insert uses `Prefer: resolution=ignore-duplicates`, so if two parallel timer runs see the same audit only the first claim succeeds; the second gets a conflict and exits. This is what guarantees we never double-send across overlapping runs or manual triggers.

## Local dry-run

To test eligibility and PDF export against a known audit without sending anything:

```powershell
cd C:\Users\jonas.simonaitis\.local\bin\azure-functions
$env:SAFETYCULTURE_API_TOKEN = "<bearer token>"
node pod-auto-send\dry-run.js <audit_id>
```

Prints the eligibility verdict, extracted REP serial, customer order number, and writes the PDF to `pod-<audit_id>.pdf` in the current directory. Does **not** touch Supabase or Graph.

## Switching to LIVE mode

**Do not set `POD_SEND_MODE=LIVE` until Phase 2 ships.** Phase 1 has no customer-resolution logic — every send goes to `POD_TRIAL_RECIPIENT`. Phase 2 will route real PODs to two trade customers only: Charterhouse (`operations@charterhousemobility.com`) and Grosvenor (`delivery.photos@grosvenormobility.com`); every other POD will stay manual. See `project_pod_auto_send_scope.md`.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Missing required env vars: …` in logs | App setting missing, or app not restarted after adding settings | Add the setting under Configuration, then restart the Function App |
| SC POST 400 on the inspection export | Bad template ID in `SAFETYCULTURE_POD_TEMPLATE_IDS`, or the audit is archived | Verify the template ID via `find-template-id.js`; archived audits are intentionally skipped |
| Graph `sendMail` 403 | `Mail.Send` consent missing for the app, or `SEND_FROM` mailbox is wrong | Re-grant admin consent on the app registration; confirm `SEND_FROM` is a real shared mailbox the app has rights to send-as |
| Supabase 401 | Service role key rotated | Update `SUPABASE_SERVICE_ROLE_KEY` and restart |
| Deploy completed but nothing happens at the next tick | Stuck Node worker after deploy | `az functionapp restart` — see `feedback_function_app_stuck_worker.md` |
| S3 400 when downloading the exported PDF | Someone "DRY'd out" the binary fetcher and re-added the `Authorization` header on the S3 GET | S3 rejects requests that carry the SC bearer — the export URL is pre-signed; do not forward auth headers on the download step |
