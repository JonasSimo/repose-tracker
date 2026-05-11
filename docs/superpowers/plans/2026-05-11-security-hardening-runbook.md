# RepNet security hardening — items needing Azure/SharePoint admin work

Surfaced in the 2026-05-11 critical/high bug review. These can't be fully
fixed in client code alone — each needs portal-level changes. Documenting
here so they don't get forgotten.

---

## 1. MSAL cache: `localStorage` → `sessionStorage`

**Current:** `index.html` line ~10087 — `cache: { cacheLocation: 'localStorage', ... }`.

**Risk:** RepNet runs on shared kiosk tablets on the shop floor. `localStorage`
persists across tab close and full browser restart. If a previous user closed
the tab without completing the OIDC `logoutRedirect` flow, their MSAL token
sits in `localStorage` until it expires (typically 60–90 minutes). The next
person at the device can open DevTools and copy the access token. Combined
with the `Sites.ReadWrite.All` scope (item 2), a stolen token grants tenant-
wide SharePoint write access until expiry.

**Mitigation already in place:**
- `61ea4b7` clears in-memory caches (NMS, CAPA, Complaints, IVN, service) on
  signout, so screen content doesn't leak.
- MSAL clears its own cache on a clean `logoutRedirect`/`logoutPopup`.

**Why not auto-fixed:** switching to `sessionStorage` forces a full re-login
every time a kiosk tablet reboots or the user closes the tab. That's a
significant UX cost on a factory floor where the PWA is expected to "just
work" between shifts.

**Recommendation: switch when convenient, with a re-login UX warning.**
1. Edit `index.html`: change `cacheLocation: 'localStorage'` to
   `'sessionStorage'` and `storeAuthStateInCookie: true` to `false`.
2. Add a tablet boot-up banner: "Sign in to start your shift" so operators
   know what to expect.
3. Roll out during an off-shift window so the first morning crowd doesn't
   all hit a re-auth at once.

**Alternative (no UX impact):** keep `localStorage` but trigger
`msalInstance.logoutRedirect({ account })` on `visibilitychange` →
hidden + 5 minutes idle. Tokens still get cleared between users without
forcing re-login during active use. More code but no kiosk-boot friction.

---

## 2. Graph scope: `Sites.ReadWrite.All` → `Sites.Selected`

**Current:** `index.html` line ~9917 —
`GRAPH_SCOPES = ['Files.Read.All', 'User.Read', 'User.ReadBasic.All', 'Sites.ReadWrite.All']`.

**Risk:** `Sites.ReadWrite.All` grants every signed-in RepNet user write
access to **every SharePoint site in the tenant**, not just the three the
app actually uses (PlanningRepose, Service, Quality). If a token is stolen
(see item 1), the attacker can mutate any tenant SharePoint site. Even
without a leak, an insider could go off-script and write to unrelated sites
under the RepNet token.

**Why not auto-fixed:** `Sites.Selected` requires an Azure admin to grant
the app contributor permission **per site** through the SharePoint admin
centre. Pure client-code change isn't enough — the app would simply fail
to authenticate against any site until the grants are in place.

**Recommendation (roughly 30 min of admin work):**

1. **Inventory the sites RepNet writes to.** From the codebase:
   - `reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-PlanningRepose`
   - `reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Service`
   - `reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality`
   - (Plus the NMS list site — confirm from `NMS_LIST_ID` site ID.)
2. **Grant `Sites.Selected` write** on each via PowerShell or Graph API:
   ```pwsh
   # Using PnP.PowerShell
   Grant-PnPAzureADAppSitePermission -AppId <RepNet client ID> `
       -DisplayName 'RepNet' -Site <each site URL> -Permissions Write
   ```
3. **Switch `GRAPH_SCOPES`** in `index.html` to
   `['Files.Read.All', 'User.Read', 'User.ReadBasic.All', 'Sites.Selected']`.
4. **Deploy + smoke test.** Sign in fresh on a desktop, exercise every
   write path (mark job done, raise NCR, save a doc, add a service
   ticket, etc.). If anything 403s, the site is missing its grant.
5. **Rollback:** revert the `index.html` line. Users can keep working
   while the grant is investigated.

`Files.Read.All` can probably also drop to `Files.ReadWrite.Selected`
under the same model — only the three RepNet workbooks need it.

---

## 3. Anyone-with-link sharing URLs in client source

**Current:** `index.html` lines ~5023–5133 and ~9921–9923 — six hardcoded
URLs of the form `https://reposefurniturelimited.sharepoint.com/:x:/s/<site>/<token>?e=<share-id>` for:
- `OV_LOAD_PLAN_URL` — overview load plan
- `CP_TICKETING_LOG_URL` — complaints ticketing log
- `PARTS_TRACKER_URL` — parts dispatch log
- `QC_SHEET_SHARING_URL` — QC sheet
- `PROD_SHARING_URL` — production plan
- `HIST_LEDGER_SHARING_URL` — history ledger

**Risk:** The `?e=...` token is an **anyone-with-the-link** SharePoint share.
Anyone who views the deployed page source (RepNet is a public Azure Static
Web App — no server-side rendering, source is downloadable) can copy these
URLs and open the underlying Excel workbooks directly in a browser, with
no Microsoft sign-in required. Production plans, parts dispatch logs,
complaint records, and the service ticket log are all exposed.

**Why not auto-fixed:** revoking the `?e=` tokens is portal work. The
client code change is trivial (drop the `?e=...` suffix and rely on the
app's authenticated drive-item lookup, which already works via MSAL) but
without the revoke step, the old URLs remain valid indefinitely until
someone explicitly invalidates them.

**Recommendation:**

1. **Revoke each `?e=` share token.** For each file in SharePoint:
   File → Manage Access → External / Links → delete the "Anyone" share.
   This invalidates the URLs immediately, including any already-leaked
   copies.
2. **Audit who's used them.** SharePoint audit logs (Microsoft Purview)
   keep a record of every access by anonymous-link. Pull a 90-day view
   per file before revoking — flags any unexpected access from outside
   the org.
3. **Update `index.html`** so the constants point at the bare file URLs
   without `?e=`. The app's existing `resolveDriveItem` helper already
   converts a SharePoint URL to a Graph driveId/itemId pair and reads
   under the signed-in user's identity, so no further code change is
   needed once the share is revoked.
4. **Verify:** sign in fresh, navigate each tab, confirm the relevant
   data loads. If any path fails, the site permission grant from item 2
   is the likely cause — that user doesn't have read on the underlying
   site.

---

## Ordering recommendation

1. **Item 3 first** — revoke the anyone-with-link shares. This is the most
   directly exploitable risk and the revoke is reversible.
2. **Item 2 second** — switch to `Sites.Selected`. Closes the blast radius
   of any future leaked token.
3. **Item 1 last** — switch MSAL to `sessionStorage` or visibility-based
   logout, once you've decided whether you're OK with the re-login UX.

After all three are done, the residual risk surface drops to: a single
in-session token leak gives the attacker write access only to the three
RepNet sites for the remainder of that token's lifetime. That's a
materially smaller exposure than today's "any RepNet user → any tenant
SharePoint site forever-until-expiry."
