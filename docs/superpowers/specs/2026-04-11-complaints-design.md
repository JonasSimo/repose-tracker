# Customer Complaint Investigation System — Design Spec

**Date:** 2026-04-11  
**Status:** Approved for implementation  
**Feature:** Complaints tab in RepNet for managing Inside 30 Day customer complaint investigations

---

## 1. Purpose

A new "Complaints" tab in RepNet that surfaces all "Inside 30 Days" entries from the REPO-Q006 Ticketing Log (SharePoint Excel file) from 1 April 2026 onwards. Jonas can open investigations, assign investigators, and sign off completed ones. Investigators access their assigned forms in RepNet, fill in a digital version of PHCIRP-0038, draw a wet-style signature, and submit. Jonas reviews and countersigns to close. A PDF export produces an auditor-ready document at any point.

---

## 2. Access Control

The "Complaints" nav button is visible to **any signed-in M365 user**. Behaviour differs by role, determined by checking the signed-in email against a manager set in `updateAuthBadge()`.

```js
const COMPLAINTS_MANAGERS = new Set([
  'jonas.simonaitis@reposefurniture.co.uk',
]);
```

- **Manager (Jonas):** Sees all complaints, all statuses. Can open any investigation. Has the final sign-off signature slot.
- **All other authenticated users:** Sees only investigations where `InvestigatorEmail` matches their signed-in account.

---

## 3. Data Sources

### 3.1 Excel — REPO-Q006 Ticketing Log

Read via Graph API Excel REST endpoint. Sheet: `TICKET LOG`.

Filter rows where:
- Column B = `"Inside 30"` (exact match)
- Column O (Open Date, DD/MM/YYYY) >= 01/04/2026

Fields extracted per row:

| Excel Column | Field name | Purpose |
|---|---|---|
| C7 | `TicketNo` | Unique identifier, foreign key |
| C8 | `Customer` | Pre-fills form header |
| C10 | `RepNo` | Pre-fills form header |
| C12 | `Model` | Pre-fills form header |
| C14 | `Description` | Pre-fills form header |
| C15 | `OpenDate` | Period display, pre-fills form |

The SharePoint site ID, drive ID, and file item ID are resolved once on tab open via Graph API and cached for the session.

### 3.2 SharePoint List — ComplaintInvestigations

New SharePoint list. One item per started investigation. Joined to Excel data in the browser by `TicketNo`.

| Column | Type | Notes |
|---|---|---|
| `TicketNo` | Single line text | Foreign key to Excel row |
| `Status` | Single line text | `Open` / `InProgress` / `PendingClosure` / `Closed` |
| `InvestigatorName` | Single line text | Displayed in form header |
| `InvestigatorEmail` | Single line text | Used for access filtering |
| `AssignedDate` | Single line text | DD/MM/YYYY, set when investigator assigned |
| `Section1` through `Section7` | Multiple lines of text | Free text per section |
| `FiveWhys` | Multiple lines of text | JSON: `{why1, why2, why3, why4, why5, causes: [[...],[...],[...],[...]]}` |
| `ActionsLog` | Multiple lines of text | JSON array: `[{initiative, owner, targetDate, completionDate, status}]` |
| `InvestigatorSignature` | Multiple lines of text | Base64 PNG of canvas drawing |
| `InvestigatorSignedDate` | Single line text | DD/MM/YYYY HH:MM |
| `ManagerSignature` | Multiple lines of text | Base64 PNG of canvas drawing |
| `ManagerSignedDate` | Single line text | DD/MM/YYYY HH:MM |
| `ClosedDate` | Single line text | DD/MM/YYYY |

Complaints with no matching `ComplaintInvestigations` record display as **Open** with an "Investigate" button.

---

## 4. Status Flow

```
Open → InProgress → PendingClosure → Closed
```

| Status | Meaning | Transition |
|---|---|---|
| Open | Excel row exists, no investigation started | Jonas clicks "Investigate", assigns investigator |
| InProgress | Investigation record created, form being filled | Investigator submits with signature |
| PendingClosure | Investigator signed, awaiting Jonas sign-off | Jonas signs |
| Closed | Both signatures captured | — |

---

## 5. UI Layout

### 5.1 Nav

New "Complaints" button added to nav bar, visible to all authenticated users (access filtered in-view, not by nav visibility).

### 5.2 List View (Manager)

```
┌──────────────────────────────────────────────────────┐
│  Customer Complaints                                  │
│                                                       │
│  [All] [Open] [In Progress] [Pending] [Closed]        │
│                                                       │
│  Ticket   Customer     Model    Opened      Status    │
│  ──────────────────────────────────────────────────  │
│  T-0042   Acme Ltd     Oxford   01/04/2026  Open  [Investigate] │
│  T-0039   Beta Co      Windsor  05/04/2026  In Progress [Open]  │
│  T-0031   Gamma Inc    Oxford   08/04/2026  Pending    [Sign Off] │
└──────────────────────────────────────────────────────┘
```

### 5.3 List View (Investigator)

Same layout but only shows rows where `InvestigatorEmail` matches the signed-in user. Status filter chips still present.

### 5.4 Assign Investigator Modal

When Jonas clicks "Investigate" on an Open complaint, a modal appears:

```
┌─────────────────────────────────┐
│  Assign Investigator            │
│                                 │
│  Investigator Name: [________]  │
│  Investigator Email: [________] │
│                                 │
│  [Cancel]  [Assign]             │
└─────────────────────────────────┘
```

On confirm: creates `ComplaintInvestigations` record with `Status: InProgress`.

### 5.5 Investigation Form

Opens full-screen within RepNet view. Scrollable single page.

**Header (pre-filled, read-only after assignment):**
- IRP No (= TicketNo), Date Opened, Customer, REP No, Model, Concern Type (free text), Reported By, Description

**Sections 1–7:** Each is a labelled heading + multi-line textarea. Labels match PHCIRP-0038 exactly:
1. Problem Description
2. Immediate Response / Disposition
3. Containment Actions
4. Root Cause Analysis
5. Escape Points
6. Corrective Actions
7. Preventative Actions

**5 Whys (within Section 4):**
- 5 rows (Why 1–5), each with 4 probable cause inputs
- Rendered as a grid table

**Actions Log:**
- Repeating rows: Initiative | Owner | Target Date | Completion Date | Status
- "Add Row" button at the bottom
- Each row has a remove button

**Signatures:**
- Investigator signature block: name, date auto-filled, canvas pad, Clear + Submit buttons. Only editable by the assigned investigator. Submit locks the form and sets status to `PendingClosure`.
- Manager signature block: only editable by Jonas. Appears after investigator has signed. Sign + Close button sets status to `Closed` and writes `ClosedDate`.

**Export PDF button:** Always visible. Triggers `window.print()`.

---

## 6. PDF Export

`window.print()` with `@media print` CSS that:
- Hides all RepNet nav, chips, and non-form elements
- Forces A4 page size
- Renders the form with Repose Furniture header, all sections, actions log, and signature images
- Unsigned slots display "Pending" placeholder text

Print layout:
```
REPOSE FURNITURE
Issue Resolution Process — PHCIRP
IRP No: [ticket]    Date: [date]
─────────────────────────────────
Customer: [...]    REP No: [...]
Model: [...]       Concern: [...]
Description: [...]
─────────────────────────────────
1. Problem Description
[text]
...sections 2–7...
─────────────────────────────────
Actions Log
Initiative | Owner | Target | Done | Status
[rows]
─────────────────────────────────
Investigator: [name]    Date: [date]
[signature image or "Pending"]

Approved by: Jonas Simonaitis    Date: [date]
[signature image or "Pending"]
```

---

## 7. New Functions

| Function | Responsibility |
|---|---|
| `cpOnOpen()` | Called by `showView('complaints')`. Loads Excel data + SharePoint list, renders list view. |
| `cpLoadData()` | Fetches Excel rows (Inside 30, >= 01/04/2026) and all ComplaintInvestigations list items. Joins by TicketNo. |
| `cpRenderList()` | Renders the complaint list with status filter chips. |
| `cpOpenInvestigation(ticketNo)` | Switches to form view for the given complaint. |
| `cpSaveForm()` | POSTs or PATCHes ComplaintInvestigations record with current form state. |
| `cpSubmitInvestigatorSignature()` | Saves signature, updates status to PendingClosure. |
| `cpSubmitManagerSignature()` | Saves signature, updates status to Closed, writes ClosedDate. |
| `cpExportPdf()` | Triggers `window.print()`. |
| `cpAddActionsRow()` | Appends a new row to the actions log table. |

---

## 8. New Constants / State

```js
const COMPLAINTS_MANAGERS = new Set([
  'jonas.simonaitis@reposefurniture.co.uk',
]);

let cpComplaints = [];       // joined Excel + SharePoint data
let cpActiveFilter = 'all';  // 'all' | 'open' | 'inprogress' | 'pending' | 'closed'
let cpActiveTicket = null;   // TicketNo of open investigation form
```

---

## 9. CSS

New `.cp-*` class namespace. Follows existing RepNet design tokens (`--bg2`, `--border`, `--text1`, `--text2`, `--repose-blue`, `--green`, etc.). Chip style matches Stats/Timing tabs. Signature canvas has a visible border and light background.

---

## 10. Graph API Calls

### Read Excel rows
```
GET /sites/{siteId}/drives/{driveId}/items/{itemId}/workbook/worksheets/TICKET LOG/usedRange
```
Returns all cell values. Filtered client-side for column B = "Inside 30" and column O >= 01/04/2026.

### Read SharePoint list
```
GET /sites/{siteId}/lists/ComplaintInvestigations/items?expand=fields&$top=999
```

### Create investigation record
```
POST /sites/{siteId}/lists/ComplaintInvestigations/items
```

### Update investigation record
```
PATCH /sites/{siteId}/lists/ComplaintInvestigations/items/{id}/fields
```

---

## 11. Out of Scope

- Automatic email notifications (checking RepNet is sufficient)
- Formal e-signature platform (DocuSign etc.) — canvas wet-style is sufficient
- Uploading photos to the investigation (Pictures sheet from PHCIRP-0038 not included)
- Writing data back to the Excel file
- Per-complaint audit trail / change history
- Investigators outside M365 (external contacts)
