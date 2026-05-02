# CAPA Log — SharePoint setup

One-off setup before the CAPA tab can save anything. ~10 minutes.

---

## 1 · Create the SharePoint list

**Site:** `https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality`

**List name:** `CAPAActions`
**List type:** Custom list (start blank)

> Site path is hardcoded in `CAPA_SITE_PATH` (index.html). Different from `CPARLog` which lives on the Planning site — same pattern as Near Misses (Safety site) and Complaints (Service site).

---

## 2 · Add columns

Add each column with the exact **internal name** shown — the code references these by the names in the right-hand column.

| Display name | Type | Required | Internal name (what the code uses) |
|---|---|---|---|
| Title | Single line text (built-in) | Yes | `Title` — stores the auto ref `CAPA-26-001` |
| Area | Choice (Quality, H&S, Environment) | Yes | `Area` |
| Description | Multiple lines of text (plain) | Yes | `Description` |
| Source | Single line text — free text or CPAR ref | No | `Source` |
| Source CPAR Id | Single line text — SharePoint item id of the linked CPAR | No | `SourceCPARId` |
| Owner email | Single line text | Yes | `OwnerEmail` |
| Owner name | Single line text | Yes | `OwnerName` |
| Owner team | Choice (Woodmill, Cutting, Sewing, Upholstery, Foam, Stores, Assembly, QC, Admin, PE, Other) | Yes | `OwnerTeam` |
| Due date | Date (no time) | Yes | `DueDate` |
| Status | Choice (Open, In Progress, Awaiting Verify, Closed) | Yes — default `Open` | `Status` |
| Actions taken | Multiple lines of text (plain) | No | `Actionstaken` |
| Effectiveness | Choice (Pending, Yes, No) | Yes — default `Pending` | `Effectiveness` |
| Raised by | Single line text | Yes | `RaisedBy` |
| Raised at | Date and time | Yes | `RaisedAt` |
| Done by | Single line text | No | `DoneBy` |
| Done at | Date and time | No | `DoneAt` |
| Verified by | Single line text | No | `VerifiedBy` |
| Verified at | Date and time | No | `VerifiedAt` |
| History | Multiple lines of text (plain) — JSON audit trail | No | `History` |

> **Internal name tip:** SharePoint sets the internal name from the first display name you type. If you rename later, the internal name stays the original. If a column ends up with internal name like `Area0`, either delete it and recreate, or edit `index.html` to match.

---

## 3 · Permissions

Same as `CPARLog`:

- **Anyone in the org** — Add items, Edit own items
- **QHSE group** — Full control
- **Production managers** — Edit all items

If `CPARLog` already inherits from the site, just leave inheritance on.

---

## 4 · Verify

After creating the list:

1. Reload RepNet
2. Open browser console
3. Run: `await getListIdByName('CAPAActions')`
4. You should get back a GUID. If you get `undefined` or an error, the list name is wrong.

Then the Actions tab will show "0 actions · raise the first one" instead of an error.

---

## 5 · Optional — seed test data

After you've confirmed the list works, raise one CAPA from the UI to verify the round-trip. The first ref will be `CAPA-26-001`.

---

## Field cheat-sheet for future code changes

```
Title            → "CAPA-26-001"
Area             → "Quality" | "H&S" | "Environment"
Description      → free text
Source           → "CPAR-26-104" or "Near-miss 24 Apr" or "Audit Q1"
SourceCPARId     → SharePoint item id of the parent CPAR (only when spawned from CPAR)
OwnerEmail       → "richard.semmens@reposefurniture.co.uk"
OwnerName        → "Richard Semmens"
OwnerTeam        → "Woodmill" | "Cutting" | … | "PE" | "Other"
DueDate          → "2026-05-15"
Status           → "Open" | "In Progress" | "Awaiting Verify" | "Closed"
EffectivenessYN  → "Pending" | "Yes" | "No"
RaisedBy         → email of the person who raised it
RaisedAt         → ISO timestamp
DoneBy           → email of the owner when they ticked Mark Done
DoneAt           → ISO timestamp
VerifiedBy       → email of the QHSE who verified
VerifiedAt       → ISO timestamp
History          → JSON array of { by, ev, at } audit entries
```
