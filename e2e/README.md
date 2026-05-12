# RepNet E2E (Playwright)

Phase 1 of the E2E suite — harness + smoke test + CI scaffold. Real feature
flows (CPAR raise→approve, Doc create→revise→obsolete, Maintenance scan,
NCR raise+close-out) land in follow-up commits.

## One-time local setup

```bash
# Install Playwright browsers (~300 MB download, once per machine)
npx playwright install chromium

# Sign in to MSAL ONCE — a Chrome window opens, you complete sign-in,
# Playwright captures cookies + localStorage + sessionStorage to
# e2e/.auth/user.json (git-ignored).
npm run e2e:auth
```

After that, run the suite headlessly:

```bash
npm run e2e          # all specs, single run
npm run e2e:ui       # Playwright's interactive UI (great for debugging)
```

Force re-auth (saved state expired, or you want a different account):

```bash
RE_AUTH=1 npm run e2e:auth
```

## CI

`.github/workflows/e2e.yml` runs the suite on push/PR **only if** a
`TEST_MSAL_STATE` repo secret is set. To enable:

1. Locally, capture state via `npm run e2e:auth`.
2. Base64-encode the state file:
   - **Bash:** `base64 -w0 e2e/.auth/user.json`
   - **PowerShell:** `[Convert]::ToBase64String([IO.File]::ReadAllBytes("e2e/.auth/user.json"))`
3. Add the output as a GitHub repo secret named `TEST_MSAL_STATE`.
4. Optionally set `TEST_REPNET_URL` if you want CI to run against a staging
   deploy instead of production.

CI re-captures the state file from the secret before running tests. State
will eventually expire — refresh tokens last ~90 days for Azure AD by
default, so plan to refresh the secret quarterly.

## Test data isolation

Real flows (added in follow-up commits) write to **production SharePoint**
with a `TEST-` prefix on every CPAR/doc/REP they create, and clean up
after themselves in an `afterEach` hook. If a test crashes mid-way and
leaks a `TEST-*` row, run the bundled nuke utility:

```bash
node e2e/nuke-test-rows.mjs    # (to be added in the CPAR-flow commit)
```

## What's covered today

| Spec | Status |
|---|---|
| `smoke.spec.mjs` — app loads, signed-in, three tabs render | ✅ |
| `cpar.spec.mjs` — raise → PE investigate → QHSE approve → CAPA | ⏳ next |
| `docs.spec.mjs` — create → revise → mark obsolete | ⏳ next |
| `maintenance.spec.mjs` — scan QR → fill REP → submit | ⏳ next |
| `ncr.spec.mjs` — raise → escalate → close-out | ⏳ next |
