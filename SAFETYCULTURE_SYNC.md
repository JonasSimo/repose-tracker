# SafetyCulture → RepNet service-inspection sync

Pulls service-inspection audits from SafetyCulture every 15 minutes and upserts them into the Supabase `service_inspections` table so the Service tab can show on-site inspection records next to each REP job.

## Pieces

| Piece | Path |
| --- | --- |
| Supabase migration | `repnet/supabase/migrations/0033_service_inspections.sql` |
| Azure Function | `bin/azure-functions/safetyculture-sync/` |
| Template-ID helper | `bin/azure-functions/safetyculture-sync/find-template-id.js` |

## One-time setup

### 1 — Find the template ID

Run locally from `bin/azure-functions`:

```powershell
$env:SAFETYCULTURE_API_TOKEN = "<bearer token>"
node safetyculture-sync\find-template-id.js "service"
```

Copy the printed `template_id` (e.g. `template_aBcDeF12345`).

### 2 — Apply the migration

```bash
supabase db push      # or run 0033_service_inspections.sql in the SQL editor
```

### 3 — Configure the Function App

Add to **RepNet** Function App → Configuration → Application settings:

| Setting | Value |
| --- | --- |
| `SAFETYCULTURE_API_TOKEN` | bearer token from SC → Settings → Integrations → API |
| `SAFETYCULTURE_TEMPLATE_ID` | template_id from step 1 |
| `SUPABASE_URL` | already set for other functions |
| `SUPABASE_SERVICE_ROLE_KEY` | already set for other functions |

### 4 — Run the historical backfill

Set `SAFETYCULTURE_BACKFILL=1` temporarily, restart the Function App, and wait for the next 15-min tick (or trigger manually via Azure portal → Code + Test → Test/Run). Once the watermark settles, **remove `SAFETYCULTURE_BACKFILL`** so subsequent runs are incremental.

## How REP linkage works

The function looks for the REP number in this order:

1. `audit_data.document_no` (SC's built-in Doc Number field, which the service template renames to "Rep Number:")
2. Any header item with a label containing both "rep" and "no"/"number"
3. The audit title

Always normalised to `REP NNNNNNN` (7-digit REP). Audits without a recognisable REP number still land in the table — they just have `rep_number = NULL` and won't show on a service-job card until a REP is added in SC and the inspection is re-synced.

## How sync state works

`service_inspection_sync_state` holds one row per template ID with a `last_modified_after` watermark. Each run reads it, fetches everything modified after that timestamp, and writes back the newest `modified_at` it saw. Idempotent — re-running upserts on the audit_id PK.

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 from SC | Wrong / expired token | Regenerate the API token in SafetyCulture → Settings → Integrations |
| 0 audits returned | Watermark already at latest, or wrong template_id | Check `service_inspection_sync_state.last_modified_after` vs the inspection's `modified_at`; verify template_id |
| Audits in table but `rep_number = NULL` | Inspector didn't fill the "Rep Number:" field | Add REP in SC; next sync will pick it up |
| Photos broken in RepNet | SafetyCulture asset URL expired | Re-sync the audit (URLs are signed; some templates use short-lived links) |
