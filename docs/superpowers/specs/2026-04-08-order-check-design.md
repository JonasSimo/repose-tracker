# Order Check — Design Spec

**Date:** 2026-04-08  
**Status:** Approved for implementation  
**Feature:** Order validation view in RepNet

---

## 1. Purpose

A new "Order Check" view within RepNet that allows planning to scan a selected production week's orders against full historical order data. Each order's spec is validated field by field. Flags are shown at the field level — hard blocks for values never seen in any history, warnings for values that exist globally but have never been used with the specific model on the order.

---

## 2. User Workflow

1. Planning opens RepNet and navigates to the "Order Check" tab.
2. They click **Build History** (once per session). The tool loads all historical data sources and builds an in-memory index of known values.
3. They select a production week (e.g. WK 15) and click **Load & Check**.
4. The tool loads that week's orders from SharePoint and runs validation immediately.
5. Results are shown as a collapsed card per order. Each card can be expanded to see field-level flags.
6. Planning resolves issues (contacting sales or correcting the Excel) before the week goes to production.

---

## 3. Data Sources

| Source | Purpose | Access |
|---|---|---|
| `Production 2026 Dec-Nov.xlsx` — WK 1–52 sheets | Current year orders + orders to validate | Existing Graph API setup |
| `Production 2026 Dec-Nov.xlsx` — internal reference sheet | Additional historical/lookup data in same file | Same file, different sheet |
| Historical orders ledger (separate SharePoint Excel) | Richest historical source — full spec per past order | New Graph item ID constant |

**Historical ledger field mapping:**

| Ledger column | Internal field |
|---|---|
| Batch no | `rep` |
| Model | `model` |
| Back design | `backDesign` |
| Cover code/supplier | `coverCode` |
| Fabric Description | `fabric` |
| Mechanism - 1 | `mechanism1` |
| Mechanism - 2 | `mechanism2` |
| Seat height | `seatHeight` |
| Seat width | `seatWidth` |
| Seat depth | `seatDepth` |
| Back height | `backHeight` |
| Arm height | `armHeight` |
| Seat Option | `seatOption` |
| Castor - 1 | `castor1` |
| Castor - 2 | `castor2` |
| Special instruction | `specialInst` |
| Optional extras | `optExtras` |

---

## 4. Validation Rules

### 4.1 Hard Blocks (red — must resolve before production)

A field value that has **never appeared anywhere** in any historical source for any model. Likely a typo or an unknown product/code.

Applies to: `model`, `fabric`, `coverCode`, `backDesign`, `mechanism1`, `mechanism2`, `seatOption`, `castor1`, `castor2`.

For numeric dimension fields (`seatHeight`, `seatWidth`, `seatDepth`, `backHeight`, `armHeight`): flagged as a hard block if the value falls **outside the global min/max range** seen across all history.

### 4.2 Warnings (amber — worth checking, can proceed if intentional)

A field value that is **known globally** (seen on other models) but has **never been used with the specific model** on this order.

Applies to all fields listed in 4.1, plus dimension fields (outside the per-model range but within the global range).

### 4.3 OK (green)

Value is consistent with historical records for this model.

### 4.4 Blank fields

Not flagged. Empty values are common and legitimate across all spec fields.

---

## 5. `knownValues` Index Structure

Built once per session during the **Build History** step:

```js
knownValues = {
  global: {
    model:      Set<string>,
    fabric:     Set<string>,
    coverCode:  Set<string>,
    backDesign: Set<string>,
    mechanism1: Set<string>,
    mechanism2: Set<string>,
    seatOption: Set<string>,
    castor1:    Set<string>,
    castor2:    Set<string>,
    seatHeight: { min: number, max: number },
    seatWidth:  { min: number, max: number },
    seatDepth:  { min: number, max: number },
    backHeight: { min: number, max: number },
    armHeight:  { min: number, max: number },
  },
  byModel: {
    "Oxford 3 Seater": {
      fabric:     Set<string>,
      coverCode:  Set<string>,
      backDesign: Set<string>,
      mechanism1: Set<string>,
      mechanism2: Set<string>,
      seatOption: Set<string>,
      castor1:    Set<string>,
      castor2:    Set<string>,
      seatHeight: { min: number, max: number },
      // ... same pattern for all dimension fields
    },
    // ... one entry per model
  }
}
```

---

## 6. UI Layout

### 6.1 Nav

New "Order Check" tab added to RepNet's top navigation bar alongside existing view tabs.

### 6.2 View Structure

```
┌─────────────────────────────────────────────────┐
│  Order Check                                    │
│                                                 │
│  Week: [WK 15 ▼]   [Load & Check]              │
│  History: ○ Not loaded  [Build History]         │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ REP 2614021  Job 12   ✓ All OK           │   │
│  ├──────────────────────────────────────────┤   │
│  │ REP 2614038  Job 15   ⚠ 2 warnings  ▼   │   │
│  │   Fabric: "ZINC" — never used with       │   │
│  │   [Oxford 3 Seater]. Used on other       │   │
│  │   models. Check with planning.           │   │
│  │   Mechanism 2: "TILT PLUS" — never used  │   │
│  │   with [Oxford 3 Seater].                │   │
│  ├──────────────────────────────────────────┤   │
│  │ REP 2614052  Job 18   ✖ 1 issue     ▼   │   │
│  │   Model: "CAMDEN XL" — never seen in     │   │
│  │   any historical order. Possible typo.   │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  3 orders checked  ·  1 issue  ·  1 warning     │
└─────────────────────────────────────────────────┘
```

### 6.3 Behaviours

- **Build History:** Loads all WK sheets sequentially with a progress indicator ("Loading WK 3/52…"). Also loads the internal reference sheet and the historical ledger file. Result held in memory for the session — user must manually rebuild if they want fresh data.
- **Load & Check:** Loads the selected week's sheet, runs validation, renders results immediately.
- **Order cards:** Collapsed by default showing REP, Job No, and status badge. Expand to see per-field flag messages.
- **Summary bar:** Shown below the card list — total checked / issues count / warnings count.

---

## 7. Technical Implementation

### 7.1 New functions in `index.html`

| Function | Responsibility |
|---|---|
| `buildOrderCheckHistory()` | Loads all three historical sources, populates `knownValues` |
| `loadHistLedger()` | Loads the historical orders Excel via Graph, maps columns to spec fields |
| `checkWeekOrders(weekName)` | Loads selected week, runs `validateSpec()` per order |
| `validateSpec(spec, knownValues)` | Returns `{ blocks: [], warnings: [] }` per order |
| `renderOrderCheckResults(results)` | Renders card list + summary bar |

### 7.2 New constants

```js
const HIST_LEDGER_ITEM_ID   = '...'; // Graph item ID — historical orders Excel
const HIST_LEDGER_SHEET     = '...'; // Sheet name within that file
const ORDER_CHECK_REF_SHEET = '...'; // Reference sheet name in Production 2026
```

Item IDs to be confirmed once the file is accessed via Graph (resolved from the SharePoint sharing URL).

### 7.3 Graph API

No new auth scopes required — `Files.Read` already in place. All calls follow the existing `usedRange` pattern.

**History build:** ~52 WK sheet calls + 1 ledger call + 1 reference sheet call. Run sequentially to avoid rate limiting. Expected duration: 15–30 seconds on first run.

### 7.4 Brand / styles

Follows existing RepNet colour tokens:
- Hard block: `--danger` red
- Warning: `--warn` amber (`#d97706`)
- OK: `--green` (`#059669`)

---

## 8. Out of Scope

- Writing check results back to SharePoint or the Excel file (UI-only status)
- Offline support
- Filtering/sorting results by flag type (can be added later)
- Auto-refresh or scheduled checks
