# Feedback widget — v4 FAB + modal

**Status:** built (CSS + JS landed 2026-05-11). Requires the SharePoint list below to be created before users can submit.
**Files:** `repnet-skin-v4.css`, `repnet-skin-v4.js`, one-line getter in `index.html`.

## Goal

Capture user bug reports, ideas, and questions digitally — directly from the RepNet UI where the issue happens — instead of getting them verbally and losing context.

## Behaviour

- **FAB**: persistent circular chat-bubble button, bottom-right of every v4 page. Hidden in `tv-mode`.
- **Modal**: opens over current page with a navy backdrop blur. ESC closes. Cmd/Ctrl+Enter submits. Focus returns to the FAB on close.
- **Form**: three-pill type selector (Bug / Idea / Question, default Bug) + multi-line description. Page label, full URL, user email/name, user-agent, and timestamp are auto-attached invisibly.
- **Submit**: POST to SharePoint list `RepNet_Feedback` via Graph, reusing `getGraphToken` and `_graphFetchWithRetry` from index.html. Toast on success/error.
- **Empty state**: send button does nothing if description is blank.

## SharePoint list — to be created manually

Create the list on the main production site (`ReposeFurniture` — same site as `ProductionCompletions`):

| Column         | Type                | Notes                                                                       |
| -------------- | ------------------- | --------------------------------------------------------------------------- |
| `Title`        | Single line of text | First line of description (auto-trimmed to 80 chars). Built-in column.      |
| `FeedbackType` | Choice              | Options: `Bug`, `Idea`, `Question`. Default: `Bug`. NOTE: cannot be named `Type` — SP reserves that name on every list. |
| `Description`  | Multiple lines      | Plain text. Allow > 255 chars.                                              |
| `PageUrl`      | Single line of text | Full `location.href` at submission time.                                    |
| `PageLabel`    | Single line of text | Active view title (e.g. "Assembly tracker"). Easier to read than raw URL.   |
| `Submitter`    | Single line of text | Email (MSAL `account.username`). `(anonymous)` if not signed in.            |
| `SubmitterName`| Single line of text | Display name from MSAL account.                                             |
| `UserAgent`    | Single line of text | Truncated to 255 chars.                                                     |
| `Status`       | Choice              | Options: `New`, `Triaged`, `In Progress`, `Done`, `Wontfix`. Default: `New`. |
| `TicketRef`    | Single line of text | Set on triage if the item gets a Jira/GitHub/etc. link. Optional.           |
| `TriageNotes`  | Multiple lines      | For your notes during triage. Optional.                                     |

`Created` and `Author` are built-in — no need to add.

**Permissions**: anyone who can read RepNet should be able to write. Easiest: grant Contribute on the list to the same M365 group that has access to the site.

## Step-by-step: create the list in SharePoint

This is the one manual setup step. Takes about 5 minutes through the SP web UI. You'll need Site Owner (or equivalent) permissions on the `ReposeFurniture` site.

### 1. Open the site

1. Go to `https://reposefurniture.sharepoint.com/sites/ReposeFurniture` (same site as the `ProductionCompletions` list).
2. Sign in if needed.

### 2. Create the list

1. Top-right gear icon → **Site contents** → **+ New** → **List**.
2. Choose **Blank list**.
3. Name: `RepNet_Feedback` (exact spelling, underscore — the code looks for this name).
4. Description: optional, e.g. "User-submitted bug reports, ideas, and questions from RepNet."
5. Untick **"Show in site navigation"** unless you want it in the left rail.
6. Click **Create**.

The list opens with a single `Title` column. Now add the rest.

### 3. Add columns

For each column below, click **+ Add column** above the list. Match the type and the **exact** internal name (the underscore-free version SP generates from the display name).

| Display name    | Type                                                                 | Required | Default | Notes                                              |
| --------------- | -------------------------------------------------------------------- | -------- | ------- | -------------------------------------------------- |
| `FeedbackType`  | Choice                                                               | Yes      | `Bug`   | Options (one per line): `Bug`, `Idea`, `Question`. **Don't name it just `Type` — that's reserved by SP.** |
| `Description`   | Multiple lines of text → **plain text**, "Use enhanced rich text" OFF | Yes      | —       | Tick "Append changes to existing text" → OFF       |
| `PageUrl`       | Single line of text                                                  | No       | —       | Max length 255 is fine                             |
| `PageLabel`     | Single line of text                                                  | No       | —       |                                                    |
| `Submitter`     | Single line of text                                                  | No       | —       | Stored as email string, not Person column          |
| `SubmitterName` | Single line of text                                                  | No       | —       |                                                    |
| `UserAgent`     | Single line of text                                                  | No       | —       |                                                    |
| `Status`        | Choice                                                               | Yes      | `New`   | Options: `New`, `Triaged`, `In Progress`, `Done`, `Wontfix` |
| `TicketRef`     | Single line of text                                                  | No       | —       |                                                    |
| `TriageNotes`   | Multiple lines of text → plain text                                  | No       | —       |                                                    |

**Why "Single line of text" for Submitter, not a Person column?** Person columns require a resolvable AAD identity at write time, which makes anonymous submissions and "graphAccount is null" cases fail. Storing the email string is robust and good enough for triage.

### 4. Set permissions (only if needed)

By default, list items inherit permissions from the site — so anyone who can read RepNet can submit. That's what you want.

If the site is locked down to a smaller group than your RepNet audience:

1. Open the list → gear icon → **List settings** → **Permissions for this list**.
2. **Stop Inheriting Permissions** → confirm.
3. Add the M365 group / SP group that covers all RepNet users → assign **Contribute** (write items, no delete).
4. Keep Owners on **Full Control** so you can triage and delete spam.

### 5. Set up a default view for triage (optional)

1. Click the view dropdown (top-right of the list, default "All Items") → **Create new view** → **List view**.
2. Name: `Triage`.
3. Show columns: `Title`, `Type`, `Status`, `Submitter`, `PageLabel`, `Created`.
4. Sort: `Created` descending.
5. Filter: `Status` is equal to `New` (you can clear this when you want to see everything).
6. Save. Make it the default view if you like.

### 6. Test it end-to-end

1. Open `https://brave-island-06ef03810.1.azurestaticapps.net/?ui=v4` (or wherever the live site is).
2. Click the blue chat-bubble FAB bottom-right.
3. Submit a test "Idea" with description "Test submission — please delete."
4. Check the list — a new item should appear within a second or two.
5. Delete the test item.

### Troubleshooting

- **Toast says "feedback list not set up yet — ask Jonas"** → list name typo (must be exactly `RepNet_Feedback`) or list is on the wrong site (must be `ReposeFurniture`, not `-Quality` or `-Service`).
- **Toast says "Graph 403"** → list permissions block the submitter. Re-check step 4.
- **Toast says "Graph 400" with "Invalid field name"** → a column display name was changed and the internal name no longer matches. Easiest fix: rename the column back. SP keeps the original internal name even after a display rename, so it usually self-heals.
- **Toast says "Not authenticated"** → user isn't signed in. Their MSAL popup should have triggered; if it didn't, ask them to sign in via the sidebar user button first.

### Alternative: create via PnP PowerShell (faster if you've done this before)

```powershell
# Requires PnP.PowerShell installed and Connect-PnPOnline first
Connect-PnPOnline -Url "https://reposefurniture.sharepoint.com/sites/ReposeFurniture" -Interactive

New-PnPList -Title "RepNet_Feedback" -Template GenericList -OnQuickLaunch:$false

Add-PnPField -List "RepNet_Feedback" -DisplayName "FeedbackType"  -InternalName "FeedbackType"  -Type Choice -Choices "Bug","Idea","Question" -AddToDefaultView
Add-PnPField -List "RepNet_Feedback" -DisplayName "Description"   -InternalName "Description"   -Type Note   -AddToDefaultView
Add-PnPField -List "RepNet_Feedback" -DisplayName "PageUrl"       -InternalName "PageUrl"       -Type Text
Add-PnPField -List "RepNet_Feedback" -DisplayName "PageLabel"     -InternalName "PageLabel"     -Type Text   -AddToDefaultView
Add-PnPField -List "RepNet_Feedback" -DisplayName "Submitter"     -InternalName "Submitter"     -Type Text   -AddToDefaultView
Add-PnPField -List "RepNet_Feedback" -DisplayName "SubmitterName" -InternalName "SubmitterName" -Type Text
Add-PnPField -List "RepNet_Feedback" -DisplayName "UserAgent"     -InternalName "UserAgent"     -Type Text
Add-PnPField -List "RepNet_Feedback" -DisplayName "Status"        -InternalName "Status"        -Type Choice -Choices "New","Triaged","In Progress","Done","Wontfix" -AddToDefaultView
Add-PnPField -List "RepNet_Feedback" -DisplayName "TicketRef"     -InternalName "TicketRef"     -Type Text
Add-PnPField -List "RepNet_Feedback" -DisplayName "TriageNotes"   -InternalName "TriageNotes"   -Type Note
```

Both Choice fields default to the first option, which matches what the code expects (`Type = Bug` if pill not changed, `Status = New` is set explicitly anyway).

## Triage flow (manual, no code yet)

1. Open the list in SharePoint, filter by `Status = New`.
2. For each item, read description, click `PageUrl` to land where the user was.
3. Mark `Status = Triaged` and (optionally) paste a ticket link into `TicketRef`.
4. When fixed, set `Status = Done`. (Future: email notification back to submitter — not in v1.)

## Code architecture

```
repnet-skin-v4.js
├── init()                ← already exists, calls each inject step
│   └── injectFeedback()  ← NEW: appends FAB + modal DOM, wires events
├── submitFeedback(input) ← NEW: builds payload, POSTs to Graph
└── ...

repnet-skin-v4.css
└── #fb-fab, #fb-backdrop, #fb-modal, .fb-* ← all scoped under .ui-v4

index.html
└── window.getCurrentUser = () => graphAccount   ← single line to expose
                                                   account across file boundary
```

The skin file already runs in its own IIFE and reads `window.getSpSiteId`, `window.getListIdByName`, `window.getGraphToken`, and `window._graphFetchWithRetry` — all of which are top-level `function` declarations in index.html and auto-attach to `window`. The only thing that didn't auto-attach was the `let graphAccount` variable; the new `getCurrentUser` getter closes over it and returns the live value.

## Things deliberately out of scope for v1

- **Screenshot attach** — Graph file upload to SP doc lib adds complexity, skipped.
- **Severity (Low/Med/High)** — extra click, not needed at current volume.
- **Team/area picker** — auto-captured `PageLabel` is usually enough.
- **"Your recent feedback" strip** in the modal — would drive repeat submissions but adds an extra Graph GET on every open; revisit if submissions stall.
- **Auto-email back to submitter on `Status = Done`** — Power Automate flow, separate piece of work.
- **Old UI (non-v4)** — feedback widget only appears under `.ui-v4`. Users on `?ui=old` won't see it. Acceptable: v4 is canonical and all teams are on it.

## Test plan

1. Open RepNet with `?ui=v4`. FAB visible bottom-right.
2. Click FAB → modal opens, focus lands in textarea.
3. Click each type pill → only one is `.on` at a time.
4. Type description → click Send → toast appears, modal closes, item lands in SP list.
5. ESC closes the modal without sending.
6. Cmd/Ctrl+Enter sends without clicking the button.
7. Submit while signed out → Graph triggers MSAL popup → after sign-in, submission completes.
8. On mobile (<900px), FAB stays visible at slightly smaller size; modal fits viewport.
9. In TV mode (fullscreen Delivery board), FAB hides via `.ui-v4.tv-mode #fb-fab { display:none }`.
