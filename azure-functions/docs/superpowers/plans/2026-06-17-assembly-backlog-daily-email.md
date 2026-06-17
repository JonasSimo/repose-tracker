# Assembly Backlog Daily Email — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Azure timer function that emails Richard Semmens the Assembly backlog (identical to the website's "Backlog" CSV export) every working day at 07:00, plus one real send today.

**Architecture:** New folder `azure-functions/assembly-backlog-report/` in the existing Function App. The handler reproduces the three client-side inputs the website uses — production plan (SharePoint Excel via Graph), completions (Supabase), QC-passed REPs (QC Excel via Graph) — then runs a verbatim port of `repnet/src/features/stats/assemblyBacklog.ts` to produce the exact same CSV, and sends it from `systemapp@` via Graph with the CSV as a file attachment.

**Tech Stack:** Node 18+ (runs on Node 24 locally), Azure Functions v4 timer trigger, `@azure/msal-node` (app-only Graph), `node-fetch@2`, Microsoft Graph (Workbook + sendMail), Supabase PostgREST (service-role). Tests: Node built-in `node:test` (`node --test`), no devDependencies — matches `service-maxoptra-poll/chair-index.test.js`.

## Global Constraints

- **Identical CSV:** headers exactly `REP, Week, W/C Date, Prep Day, Item No, Days Late, Express?`; every field double-quoted with internal `"` doubled; fields joined `,`; rows joined `\r\n`; UTF-8 BOM (`﻿`) prepended; filename `repose-assembly-backlog-YYYY-MM-DD.csv` (today's local date). Achieved by porting `backlogRowsToCsv` verbatim.
- **No new secrets.** Function App already has `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `SEND_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Sender:** always `systemapp@reposefurniture.co.uk` (the `SEND_FROM` app setting) — never a `noreply@` default.
- **Recipient:** `richard.semmens@reposefurniture.co.uk`, overridable by app setting `BACKLOG_REPORT_RECIPIENT`.
- **Schedule:** `"0 0 7 * * 1-5"` (07:00 Mon–Fri, BH-unaware cron — matches `morning-team-digest`). The calc itself IS bank-holiday-aware via `isWorkingDay`.
- **Empty backlog:** still send — subject suffix `— All clear`, no attachment.
- **Preserve both `isoWeekOfDate` variants verbatim — do not unify them.** `plan-weeks.js` uses the local-time variant (from `loader.ts`) for naming `WK NN` sheets; `assembly-backlog.js` uses the UTC variant (from `shared/dates.ts`). This split is how production works.
- **Source files to port are on disk** — read them directly:
  - `C:\Users\jonas.simonaitis\.local\repnet\src\features\stats\assemblyBacklog.ts`
  - `C:\Users\jonas.simonaitis\.local\repnet\src\features\production\loader.ts`
  - `C:\Users\jonas.simonaitis\.local\repnet\src\features\production\qcAutoSync.ts`
  - `C:\Users\jonas.simonaitis\.local\repnet\src\shared\workingDays.ts`
  - `C:\Users\jonas.simonaitis\.local\repnet\src\shared\dates.ts`
- **Pattern references** (already in the tree): `pod-auto-send/graph.js`, `pod-auto-send/supa.js`, `morning-team-digest/index.js` (HTML email + timer), `pod-auto-send/function.json`.
- All files created under `C:\Users\jonas.simonaitis\.local\bin\azure-functions\assembly-backlog-report\`. Commit after each task.

---

## File Structure

- `assembly-backlog-report/working-days.js` — pure date helpers (`isWorkingDay`, `workingPrepNumber`, `localDateKey`, `UK_BANK_HOLIDAYS`) + UTC `isoWeekOfDate`. (Task 1)
- `assembly-backlog-report/assembly-backlog.js` — `getAssemblyBacklogRows`, `backlogRowsToCsv`. (Task 2)
- `assembly-backlog-report/graph.js` — app-only token, `graphGet`, `encodeSharingUrl`, `sendMailWithAttachment`. (Task 3)
- `assembly-backlog-report/plan-weeks.js` — `parseSheetValues`, `distributeIntoPreps`, `loadProductionWeeks`. (Task 4)
- `assembly-backlog-report/completions.js` — `buildAssemblyDoneSet`, `loadAssemblyDoneSet`. (Task 5)
- `assembly-backlog-report/qc.js` — `parseQcRows`, `loadQcPassedReps`. (Task 6)
- `assembly-backlog-report/email.js` — `buildSummaryHtml`. (Task 7)
- `assembly-backlog-report/index.js` + `function.json` + `repnet-logo-white.png` — handler + binding. (Task 8)
- `assembly-backlog-report/run-once.js` — manual dry-run / real-send invoker. (Task 9)
- Test files alongside each module: `*.test.js`. (in their tasks)

---

### Task 1: Pure date / working-day helpers

**Files:**
- Create: `assembly-backlog-report/working-days.js`
- Test: `assembly-backlog-report/working-days.test.js`

**Interfaces:**
- Produces: `isWorkingDay(d: Date): boolean`, `workingPrepNumber(d: Date): number`, `localDateKey(d: Date): string`, `isoWeekOfDateUTC(d: Date): number`, `UK_BANK_HOLIDAYS: Set<string>`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Run: node --test assembly-backlog-report/working-days.test.js
const test = require('node:test');
const assert = require('node:assert');
const { isWorkingDay, workingPrepNumber, isoWeekOfDateUTC, UK_BANK_HOLIDAYS } = require('./working-days');

test('isWorkingDay: weekends and bank holidays are non-working', () => {
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 17)), true);   // Wed 17 Jun 2026
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 20)), false);  // Sat
  assert.strictEqual(isWorkingDay(new Date(2026, 5, 21)), false);  // Sun
  assert.strictEqual(isWorkingDay(new Date(2026, 4, 25)), false);  // 2026-05-25 spring BH
  assert.ok(UK_BANK_HOLIDAYS.has('2026-12-25'));
});

test('workingPrepNumber: 1-based working-day index within the week, 0 on non-working', () => {
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 15)), 1); // Mon
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 17)), 3); // Wed
  assert.strictEqual(workingPrepNumber(new Date(2026, 5, 20)), 0); // Sat
  // Bank-holiday Monday 2026-05-25 → Tue is prep 1
  assert.strictEqual(workingPrepNumber(new Date(2026, 4, 26)), 1);
});

test('isoWeekOfDateUTC matches ISO week numbering', () => {
  assert.strictEqual(isoWeekOfDateUTC(new Date(2026, 0, 1)), 1);
  assert.strictEqual(isoWeekOfDateUTC(new Date(2026, 5, 17)), 25);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/working-days.test.js`
Expected: FAIL — `Cannot find module './working-days'`.

- [ ] **Step 3: Write the implementation**

Port the relevant exports from `repnet/src/shared/workingDays.ts` and the UTC `isoWeekOfDate` from `repnet/src/shared/dates.ts`. Create `assembly-backlog-report/working-days.js`:

```js
'use strict';

// Ported verbatim from repnet/src/shared/workingDays.ts (isWorkingDay,
// workingPrepNumber, localDateKey, UK_BANK_HOLIDAYS) and the UTC isoWeekOfDate
// from repnet/src/shared/dates.ts. Keep UK_BANK_HOLIDAYS in sync with the app.

const UK_BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWorkingDay(d, holidays = UK_BANK_HOLIDAYS) {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(localDateKey(d));
}

function workingPrepNumber(d, holidays = UK_BANK_HOLIDAYS) {
  if (!isWorkingDay(d, holidays)) return 0;
  const mon = new Date(d);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  let count = 0;
  for (let cur = new Date(mon); cur.getTime() <= d.getTime(); cur.setDate(cur.getDate() + 1)) {
    if (isWorkingDay(cur, holidays)) count++;
  }
  return count;
}

// UTC variant — repnet/src/shared/dates.ts isoWeekOfDate. Used by the backlog
// calc for `WK ${isoWeekOfDateUTC(today)}`. DO NOT replace with the local-time
// variant used in plan-weeks.js.
function isoWeekOfDateUTC(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

module.exports = { UK_BANK_HOLIDAYS, localDateKey, isWorkingDay, workingPrepNumber, isoWeekOfDateUTC };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/working-days.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/jonas.simonaitis/.local/bin/azure-functions
git add assembly-backlog-report/working-days.js assembly-backlog-report/working-days.test.js
git commit -m "feat(assembly-backlog): port working-day + ISO-week helpers"
```

---

### Task 2: Backlog calculator + CSV (verbatim port)

**Files:**
- Create: `assembly-backlog-report/assembly-backlog.js`
- Test: `assembly-backlog-report/assembly-backlog.test.js`

**Interfaces:**
- Consumes: `isWorkingDay`, `workingPrepNumber`, `isoWeekOfDateUTC` from `./working-days`.
- Produces:
  - `getAssemblyBacklogRows(weeks, doneSet, qcPassedSet, now=new Date()): BacklogRow[]` where `weeks` is `[{ wk, wc, preps: {1..5, express: Job[]} }]`, `Job = { rep, itemNo, expressType }`, `doneSet: Set<string>` of `Assembly|all|<wk>|<prep>|<rep>` keys, `qcPassedSet: Set<string>` of 7-digit REPs.
  - `BacklogRow = { rep, week, wc, prepLbl, itemNo, daysLate, express }`.
  - `backlogRowsToCsv(rows): string` and `backlogCsvWithBom(rows): string` (BOM-prefixed).
  - `backlogFilename(now=new Date()): string` → `repose-assembly-backlog-YYYY-MM-DD.csv`.

This is a verbatim port of `repnet/src/features/stats/assemblyBacklog.ts`. The one adaptation: the app passes a `Map<stateKey, CompletionState>` and calls `completionsMap.get(stateKey('Assembly','all',wk,p,rep))?.done`. Here we pass a `Set<string>` of done keys and check `doneSet.has(key)`. The key string is built identically via the inlined `stateKey`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Run: node --test assembly-backlog-report/assembly-backlog.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  getAssemblyBacklogRows, backlogRowsToCsv, backlogCsvWithBom, backlogFilename,
} = require('./assembly-backlog');

// Wed 17 Jun 2026 is WK 25; Mon of WK 25 is 15/06/2026. Build a current-week
// plan with one overdue Monday job, one done Monday job, one QC-passed Monday
// job, and one future (today/Wed) job that must NOT be in the backlog.
function fixture() {
  const weeks = [{
    wk: 'WK 25', wc: '15/06/2026',
    preps: {
      1: [
        { rep: 'REP 1000001', itemNo: 10, expressType: null }, // overdue → in backlog
        { rep: 'REP 1000002', itemNo: 11, expressType: null }, // done → excluded
        { rep: 'REP 1000003', itemNo: 12, expressType: null }, // QC passed → excluded
      ],
      2: [], 3: [
        { rep: 'REP 1000004', itemNo: 13, expressType: null }, // Wed (today) → not past → excluded
      ], 4: [], 5: [], express: [],
    },
  }];
  const doneSet = new Set(['Assembly|all|WK 25|1|REP 1000002']);
  const qc = new Set(['1000003']);
  return { weeks, doneSet, qc };
}

test('getAssemblyBacklogRows includes only overdue, not-done, not-QC jobs', () => {
  const { weeks, doneSet, qc } = fixture();
  const rows = getAssemblyBacklogRows(weeks, doneSet, qc, new Date(2026, 5, 17)); // Wed
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].rep, 'REP 1000001');
  assert.strictEqual(rows[0].prepLbl, 'Mon');
  assert.strictEqual(rows[0].itemNo, '10');
  assert.strictEqual(rows[0].daysLate, 2); // Tue + Wed working days after Mon due
});

test('backlogRowsToCsv emits the exact header and quoted rows with CRLF', () => {
  const { weeks, doneSet, qc } = fixture();
  const rows = getAssemblyBacklogRows(weeks, doneSet, qc, new Date(2026, 5, 17));
  const csv = backlogRowsToCsv(rows);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines[0], '"REP","Week","W/C Date","Prep Day","Item No","Days Late","Express?"');
  assert.strictEqual(lines[1], '"REP 1000001","WK 25","15/06/2026","Mon","10","2",""');
});

test('backlogCsvWithBom prepends the UTF-8 BOM; filename uses local date', () => {
  const csv = backlogCsvWithBom([]);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  assert.strictEqual(backlogFilename(new Date(2026, 5, 17)), 'repose-assembly-backlog-2026-06-17.csv');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/assembly-backlog.test.js`
Expected: FAIL — `Cannot find module './assembly-backlog'`.

- [ ] **Step 3: Write the implementation**

Read `repnet/src/features/stats/assemblyBacklog.ts` and port it. Create `assembly-backlog-report/assembly-backlog.js`:

```js
'use strict';

// Verbatim port of repnet/src/features/stats/assemblyBacklog.ts.
// Difference: completions are passed as a Set<string> of done stateKeys
// (built in completions.js) rather than a Map; we check doneSet.has(key).

const { isWorkingDay, workingPrepNumber, isoWeekOfDateUTC } = require('./working-days');

function stateKey(team, sub, wk, prep, rep) {
  return `${team}|${sub}|${wk}|${prep}|${rep}`;
}

function extractRep7(rep) {
  return String(rep || '').replace(/\D/g, '').slice(-7);
}

function parseDdmmyyyy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

const PREP_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function prepDayLabel(wc, prep) {
  if (!wc) return PREP_DAY_NAMES[prep - 1] ?? String(prep);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(wc); d.setDate(wc.getDate() + i);
    if (!isWorkingDay(d)) continue;
    count++;
    if (count === prep) {
      const dow = d.getDay();
      return PREP_DAY_NAMES[dow - 1] ?? String(prep);
    }
  }
  return PREP_DAY_NAMES[prep - 1] ?? String(prep);
}

function getAssemblyBacklogRows(weeks, doneSet, qcPassedReps, now = new Date()) {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const todayPrep = workingPrepNumber(today);
  const currentWk = `WK ${isoWeekOfDateUTC(today)}`;
  const wkOrder = new Map(weeks.map((w, i) => [w.wk, i]));
  const currentWkIdx = wkOrder.get(currentWk) ?? -1;

  const rows = [];

  for (const wkData of weeks) {
    const wkIdx = wkOrder.get(wkData.wk) ?? -1;
    const wcDate = parseDdmmyyyy(wkData.wc || '');

    const preps = [1, 2, 3, 4, 5, 'express'];
    for (const p of preps) {
      const jobs = wkData.preps[p];
      if (!Array.isArray(jobs) || jobs.length === 0) continue;

      let included = false;
      if (p === 'express') {
        included = currentWkIdx >= 0 && wkIdx <= currentWkIdx;
      } else if (currentWkIdx >= 0 && wkIdx < currentWkIdx) {
        included = true;
      } else if (wkData.wk === currentWk && todayPrep > 0 && Number(p) < todayPrep) {
        included = true;
      }
      if (!included) continue;

      jobs.forEach((job) => {
        const stateK = stateKey('Assembly', 'all', wkData.wk, p, job.rep);
        if (doneSet.has(stateK)) return;

        const rep7 = extractRep7(job.rep);
        if (rep7 && qcPassedReps.has(rep7)) return;

        let daysLate = 0;
        if (p !== 'express' && wcDate) {
          const due = new Date(wcDate); due.setDate(wcDate.getDate() + (Number(p) - 1));
          due.setHours(0, 0, 0, 0);
          if (due < today) {
            const cur = new Date(due); cur.setDate(due.getDate() + 1);
            while (cur <= today) {
              if (isWorkingDay(cur)) daysLate++;
              cur.setDate(cur.getDate() + 1);
            }
          }
        }

        rows.push({
          rep: job.rep || '',
          week: wkData.wk,
          wc: wkData.wc,
          prepLbl: p === 'express' ? 'Express' : prepDayLabel(wcDate, Number(p)),
          itemNo: String(job.itemNo ?? ''),
          daysLate,
          express: p === 'express' || !!job.expressType,
        });
      });
    }
  }

  rows.sort((a, b) => (b.daysLate - a.daysLate) || a.rep.localeCompare(b.rep));
  return rows;
}

const HEADER = ['REP', 'Week', 'W/C Date', 'Prep Day', 'Item No', 'Days Late', 'Express?'];

function csvEsc(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function backlogRowsToCsv(rows) {
  const body = rows.map((r) => [
    r.rep, r.week, r.wc, r.prepLbl, r.itemNo, r.daysLate, r.express ? 'Yes' : '',
  ].map(csvEsc).join(','));
  return [HEADER.map(csvEsc).join(','), ...body].join('\r\n');
}

function backlogCsvWithBom(rows) {
  return '﻿' + backlogRowsToCsv(rows);
}

function backlogFilename(now = new Date()) {
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `repose-assembly-backlog-${ts}.csv`;
}

module.exports = {
  stateKey, getAssemblyBacklogRows, backlogRowsToCsv, backlogCsvWithBom, backlogFilename,
};
```

> Note: the website's `downloadAssemblyBacklogCsv` uses `new Date().toISOString().slice(0,10)` (UTC) for the filename date. We use local date here so a 07:00 UK send is never stamped the previous day. The CSV *contents* are byte-identical; only the date-stamp basis differs and only ever around midnight UTC. Acceptable.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/assembly-backlog.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/assembly-backlog.js assembly-backlog-report/assembly-backlog.test.js
git commit -m "feat(assembly-backlog): port backlog calc + CSV export"
```

---

### Task 3: Graph helper — token, workbook GET, sendMail with attachment

**Files:**
- Create: `assembly-backlog-report/graph.js`

**Interfaces:**
- Produces:
  - `getToken(): Promise<string>` (app-only, cached).
  - `encodeSharingUrl(link): string`.
  - `graphGet(url): Promise<object>` — GET with bearer; throws on non-OK.
  - `sendMailWithAttachment({ to, cc?, subject, html, attachment? }): Promise<null>` where `attachment = { name, contentType, contentBytes }` (contentBytes is a base64 string) and is optional (omit on All-clear days).

Copy `pod-auto-send/graph.js` and adapt: keep `getMsalApp`/`getToken`; add `encodeSharingUrl` and `graphGet`; replace `sendMailWithPdf` with a generic `sendMailWithAttachment` whose body is HTML and whose attachment is optional.

- [ ] **Step 1: Write the implementation**

```js
'use strict';

// Graph client for assembly-backlog-report. App-only MSAL token (same pattern
// as pod-auto-send/graph.js + daily-report). Adds graphGet for Workbook reads
// and an HTML sendMail with an optional generic file attachment.

const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SEND_FROM     = process.env.SEND_FROM;

let _msal = null, _token = null, _tokenExpiry = 0;

function getMsalApp() {
  if (_msal) return _msal;
  _msal = new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      clientSecret: CLIENT_SECRET,
    },
  });
  return _msal;
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  _token = result.accessToken;
  _tokenExpiry = result.expiresOn?.getTime() || (Date.now() + 3600000);
  return _token;
}

function encodeSharingUrl(link) {
  return 'u!' + Buffer.from(link).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function graphGet(url) {
  const token = await getToken();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Graph GET ${res.status} ${url.slice(0, 120)}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sendMailWithAttachment({ to, cc = [], subject, html, attachment }) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/users/${SEND_FROM}/sendMail`;
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: (Array.isArray(to) ? to : [to]).map((a) => ({ emailAddress: { address: a } })),
    ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
  };
  if (attachment) {
    message.attachments = [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.name,
      contentType: attachment.contentType,
      contentBytes: attachment.contentBytes,
    }];
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return null;
}

module.exports = { getToken, encodeSharingUrl, graphGet, sendMailWithAttachment };
```

- [ ] **Step 2: Smoke-check the module loads**

Run: `node -e "require('./assembly-backlog-report/graph.js'); console.log('ok')"`
Expected: prints `ok` (no env needed to require).

- [ ] **Step 3: Commit**

```bash
git add assembly-backlog-report/graph.js
git commit -m "feat(assembly-backlog): graph token + workbook GET + HTML sendMail w/ attachment"
```

---

### Task 4: Production-plan loader (parse + fetch)

**Files:**
- Create: `assembly-backlog-report/plan-weeks.js`
- Test: `assembly-backlog-report/plan-weeks.test.js`

**Interfaces:**
- Consumes: `graphGet`, `encodeSharingUrl` from `./graph`.
- Produces:
  - `parseSheetValues(values: unknown[][]): ParsedJob[]` (verbatim port).
  - `distributeIntoPreps(jobs): { 1..5, express: Job[] }` (verbatim port).
  - `loadProductionWeeks(log?): Promise<WeekData[]>` — resolves the share, reads the -3..+2 week sheets sessionlessly (like `pod-auto-send/prod-plan.js`), returns `[{ wk, wc, preps }]`.
  - Internal `isoWeekOfDateLocal` + `isoWeekMonday` + `ddmmyyyy` (local-time variants from `loader.ts`).

Port `parseSheetValues`, `distributeIntoPreps`, the local `isoWeekOfDate`, `isoWeekMonday`, `ddmmyyyy` from `repnet/src/features/production/loader.ts`. For fetching, mirror the sessionless share→driveItem→worksheet-range approach in `pod-auto-send/prod-plan.js` (no `createSession`, no `localStorage`). Read `range(address='A1:BI1000')` per week sheet.

- [ ] **Step 1: Write the failing test** (covers the pure parser only — fetch is integration-verified in Task 9)

```js
'use strict';
// Run: node --test assembly-backlog-report/plan-weeks.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseSheetValues, distributeIntoPreps } = require('./plan-weeks');

// Build a values grid. Header row 0 has 'Item' in col 10 (K) → startRow = 1.
// Columns used by the parser: 10=item code (K), 11=REP cell (L), 60=prep (BI).
function rowWith(item, repCell, prepCell) {
  const r = new Array(61).fill('');
  r[10] = item; r[11] = repCell; r[60] = prepCell;
  return r;
}

test('parseSheetValues extracts REP, itemNo, prep from K/L/BI', () => {
  const header = new Array(61).fill(''); header[10] = 'Item No';
  const values = [
    header,
    rowWith('10', 'REP 1234567', 'PREP 1'),
    rowWith('11', 'something REP 7654321 x', 'PREP 3'),
    rowWith('EXP1', 'REP 2222222', 'EXP'),
    rowWith('5', 'no rep here', 'PREP 2'),     // dropped: no REP
  ];
  const jobs = parseSheetValues(values);
  assert.strictEqual(jobs.length, 3);
  assert.deepStrictEqual(
    jobs.map((j) => [j.rep, j.prep, j.expressType]),
    [['REP 1234567', 1, null], ['REP 7654321', 3, null], ['REP 2222222', 'express', 'EXP']],
  );
});

test('distributeIntoPreps buckets by numeric prep and express', () => {
  const header = new Array(61).fill(''); header[10] = 'Item No';
  const jobs = parseSheetValues([
    header,
    rowWith('10', 'REP 1000001', 'PREP 1'),
    rowWith('11', 'REP 1000002', 'PREP 1'),
    rowWith('12', 'REP 1000003', 'PREP 5'),
    rowWith('EXP1', 'REP 1000004', 'EXP'),
  ]);
  const preps = distributeIntoPreps(jobs);
  assert.strictEqual(preps[1].length, 2);
  assert.strictEqual(preps[5].length, 1);
  assert.strictEqual(preps.express.length, 1);
  assert.strictEqual(preps[1][0].rep, 'REP 1000001');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/plan-weeks.test.js`
Expected: FAIL — `Cannot find module './plan-weeks'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';

// Production-plan loader. parseSheetValues / distributeIntoPreps are a verbatim
// port of repnet/src/features/production/loader.ts. Fetch path mirrors
// pod-auto-send/prod-plan.js: sessionless share → driveItem → per-week range.

const { graphGet, encodeSharingUrl } = require('./graph');

const PROD_SHARING_URL =
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-PlanningRepose/IQBLf67iYnbQSq2O8UU_zQihARfBedzZcW-CmO0q3v5zC3o?e=nfze02';

// Local-time ISO week — used ONLY for naming WK sheets, exactly as loader.ts.
function isoWeekOfDateLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const w1 = new Date(x.getFullYear(), 0, 4);
  return 1 + Math.round(((x.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

function isoWeekMonday(isoWeek) {
  const now = new Date();
  const year = now.getFullYear();
  function weekStart(y) {
    const jan4 = new Date(y, 0, 4);
    const d = new Date(jan4);
    d.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (isoWeek - 1) * 7);
    return d;
  }
  const candidates = [weekStart(year - 1), weekStart(year), weekStart(year + 1)];
  return candidates.reduce((best, d) =>
    Math.abs(d.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime()) ? d : best);
}

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function parseSheetValues(values) {
  if (!values || !values.length) return [];
  let startRow = 4;
  for (let i = 0; i < Math.min(8, values.length); i++) {
    const row = values[i];
    if (row && String(row[10] ?? '').toLowerCase().includes('item')) { startRow = i + 1; break; }
  }
  const jobs = [];
  for (let i = startRow; i < values.length; i++) {
    const row = values[i];
    if (!row || row.length < 12) continue;
    const kRaw = String(row[10] ?? '').trim();
    const isExpressCode = /^(EXP|M-FT)\d*$/i.test(kRaw);
    const lCell = String(row[11] ?? '');
    const isServCode = /^SERV/i.test(kRaw) || /\bserv\b/i.test(lCell);
    const itemNoNum = Number(kRaw);
    const itemNo = isExpressCode || isServCode ? kRaw : itemNoNum;
    if (!kRaw || (!isExpressCode && !isServCode && (!Number.isFinite(itemNoNum) || itemNoNum <= 0))) continue;
    const m = lCell.match(/REP\s*(\d{7})/);
    if (!m) continue;

    const biRaw = String(row[60] ?? '').trim().toUpperCase();
    let prep;
    if (/^(EXP|M-FT|MFT)/.test(biRaw)) {
      prep = 'express';
    } else {
      const prepVal = parseInt(biRaw.replace(/^PREP\s*/, ''), 10);
      prep = prepVal >= 1 && prepVal <= 5 ? prepVal : null;
    }

    const expressType = isExpressCode ? (/^M-?FT/i.test(kRaw) ? 'MFT' : 'EXP') : null;
    jobs.push({ itemNo, rep: `REP ${m[1]}`, prep, expressType, isService: isServCode });
  }
  return jobs;
}

function distributeIntoPreps(jobs) {
  const preps = { 1: [], 2: [], 3: [], 4: [], 5: [], express: [] };
  const jo = (j) => ({ itemNo: j.itemNo, rep: j.rep, expressType: j.expressType, isService: j.isService });
  jobs.filter((j) => j.prep === 'express').forEach((j) => preps.express.push(jo(j)));
  const normalJobs = jobs.filter((j) => j.prep !== 'express');
  const hasNumericPrep = normalJobs.some((j) => typeof j.prep === 'number');
  if (hasNumericPrep) {
    normalJobs.forEach((j) => { if (j.prep !== null && typeof j.prep === 'number') preps[j.prep].push(jo(j)); });
  } else {
    const n = normalJobs.length;
    normalJobs.forEach((j, i) => {
      const p = (n === 0 ? 1 : Math.min(5, Math.floor((i * 5) / n) + 1));
      preps[p].push(jo(j));
    });
  }
  return preps;
}

async function resolveDriveItem() {
  const item = await graphGet(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(PROD_SHARING_URL)}/driveItem`,
  );
  return { driveId: item.parentReference.driveId, itemId: item.id };
}

async function loadProductionWeeks(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  const { driveId, itemId } = await resolveDriveItem();

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekNums = [-3, -2, -1, 0, 1, 2].map((delta) => {
    const d = new Date(today); d.setDate(d.getDate() + delta * 7);
    return isoWeekOfDateLocal(d);
  });

  const out = [];
  for (const wn of weekNums) {
    const wk = `WK ${wn}`;
    const wc = ddmmyyyy(isoWeekMonday(wn));
    try {
      const range = await graphGet(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
        `/workbook/worksheets('${encodeURIComponent(wk)}')/range(address='A1:BI1000')?$select=values`,
      );
      out.push({ wk, wc, preps: distributeIntoPreps(parseSheetValues(range.values ?? [])) });
    } catch (e) {
      info(`[plan] sheet ${wk} unavailable: ${e.message}`);
      out.push({ wk, wc, preps: { 1: [], 2: [], 3: [], 4: [], 5: [], express: [] } });
    }
  }
  return out;
}

module.exports = { parseSheetValues, distributeIntoPreps, loadProductionWeeks, isoWeekOfDateLocal };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/plan-weeks.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/plan-weeks.js assembly-backlog-report/plan-weeks.test.js
git commit -m "feat(assembly-backlog): production-plan loader (parse + fetch)"
```

---

### Task 5: Completions done-set (Supabase)

**Files:**
- Create: `assembly-backlog-report/completions.js`
- Test: `assembly-backlog-report/completions.test.js`

**Interfaces:**
- Consumes: `supaSelectMany` from `../pod-auto-send/supa` (re-exported locally — see Step 3).
- Produces:
  - `buildAssemblyDoneSet(rows): Set<string>` — pure; rows are `{ week, prep, rep, sub_team, is_complete }`; returns the set of `Assembly|<sub||all>|<week>|<prep>|<rep>` keys for completed rows. Key construction mirrors `indexCompletions` (`sub = sub_team || 'all'`, `prep = prep==='express'?'express':Number(prep)`).
  - `loadAssemblyDoneSet(weeks: string[], log?): Promise<Set<string>>` — queries `production_completions` filtered to `team=eq.Assembly`, `is_complete=is.true`, and `week=in.(...)` for the given week labels, paged.

The keys must match `assembly-backlog.js`'s `stateKey('Assembly','all',wk,p,rep)`. Assembly rows store `sub_team = null` → `'all'`, and `rep` is stored as `REP NNNNNNN` (same as the plan), so the keys align.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Run: node --test assembly-backlog-report/completions.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildAssemblyDoneSet } = require('./completions');

test('buildAssemblyDoneSet keys completed Assembly rows as Assembly|all|wk|prep|rep', () => {
  const rows = [
    { week: 'WK 25', prep: '1', rep: 'REP 1000002', sub_team: null, is_complete: true },
    { week: 'WK 25', prep: 'express', rep: 'REP 1000009', sub_team: null, is_complete: true },
    { week: 'WK 25', prep: '2', rep: 'REP 1000003', sub_team: null, is_complete: false }, // not complete → skipped
    { week: '', prep: '1', rep: 'REP 1', sub_team: null, is_complete: true },             // no week → skipped
  ];
  const set = buildAssemblyDoneSet(rows);
  assert.ok(set.has('Assembly|all|WK 25|1|REP 1000002'));
  assert.ok(set.has('Assembly|all|WK 25|express|REP 1000009'));
  assert.strictEqual(set.size, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/completions.test.js`
Expected: FAIL — `Cannot find module './completions'`.

- [ ] **Step 3: Write the implementation**

Reuse the proven PostgREST helper from `pod-auto-send/supa.js` rather than re-implementing it.

```js
'use strict';

// Assembly "done" set from Supabase production_completions. Key format mirrors
// repnet indexCompletions + stateKey so it matches assembly-backlog.js lookups.

const { supaSelectMany } = require('../pod-auto-send/supa');

function buildAssemblyDoneSet(rows) {
  const out = new Set();
  for (const r of rows) {
    if (!r.is_complete) continue;
    if (!r.week || !r.rep || r.prep == null) continue;
    const prep = r.prep === 'express' ? 'express' : Number(r.prep);
    if (prep !== 'express' && !Number.isFinite(prep)) continue;
    const sub = r.sub_team || 'all';
    out.add(`Assembly|${sub}|${r.week}|${prep}|${r.rep}`);
  }
  return out;
}

async function loadAssemblyDoneSet(weeks, log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  if (!weeks.length) return new Set();
  // PostgREST in.(...) list — quote each label (they contain a space).
  const inList = weeks.map((w) => `"${w.replace(/"/g, '')}"`).join(',');
  const select = 'select=week,prep,rep,sub_team,is_complete';
  const filter = `team=eq.Assembly&is_complete=is.true&week=in.(${encodeURIComponent(inList)})`;
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const qs = `${select}&${filter}&limit=${PAGE}&offset=${from}`;
    const rows = await supaSelectMany('production_completions', qs);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  info(`[completions] ${all.length} completed Assembly rows across ${weeks.length} weeks`);
  return buildAssemblyDoneSet(all);
}

module.exports = { buildAssemblyDoneSet, loadAssemblyDoneSet };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/completions.test.js`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/completions.js assembly-backlog-report/completions.test.js
git commit -m "feat(assembly-backlog): Assembly done-set from Supabase completions"
```

---

### Task 6: QC-passed REP set

**Files:**
- Create: `assembly-backlog-report/qc.js`
- Test: `assembly-backlog-report/qc.test.js`

**Interfaces:**
- Consumes: `graphGet`, `encodeSharingUrl` from `./graph`.
- Produces:
  - `parseQcRows(rows: unknown[][]): Set<string>` — pure; column A holds the REP cell; extracts the 7-digit REP via `(?<!\d)(\d{7})(?!\d)`.
  - `loadQcPassedReps(log?): Promise<Set<string>>` — resolves the QC sheet share, reads `Data` sheet cols A:D, returns the set of 7-digit REPs. Sessionless reads (chunked by rowCount like `qcAutoSync.ts`).

Port from `repnet/src/features/production/qcAutoSync.ts`. The backlog calc only needs the `Set<rep7>`, so drop the inspector/date/type fields.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Run: node --test assembly-backlog-report/qc.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseQcRows } = require('./qc');

test('parseQcRows extracts 7-digit REPs from column A, ignoring jammed prefixes', () => {
  const rows = [
    ['REP 1234567', '2026-06-16 09:00', 'Sarah J', 'New Chair'],
    ['7654321', '2026-06-16 10:00', 'Tom', 'Service'],
    ['REP25211071', 'x', 'y', 'z'],   // 8 digits jammed → no 7-digit match
    ['header', '', '', ''],
  ];
  const set = parseQcRows(rows);
  assert.ok(set.has('1234567'));
  assert.ok(set.has('7654321'));
  assert.strictEqual(set.size, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/qc.test.js`
Expected: FAIL — `Cannot find module './qc'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';

// QC-passed REP set. Port of repnet/src/features/production/qcAutoSync.ts,
// reduced to the Set<rep7> the backlog calc needs. Sessionless chunked reads.

const { graphGet, encodeSharingUrl } = require('./graph');

const QC_SHEET_SHARING_URL =
  'https://reposefurniturelimited.sharepoint.com/:x:/s/ReposeFurniture-Quality/IQBkNajahlhzTZcypUVLsTM7AW-gHMSu-C2cd2MMLj5npe0?e=8BfsBL';
const QC_SHEET_NAME = 'Data';

function parseQcRows(rows) {
  const out = new Set();
  for (const row of rows ?? []) {
    const repCell = String(row?.[0] ?? '').trim();
    const m = repCell.match(/(?<!\d)(\d{7})(?!\d)/);
    if (m) out.add(m[1]);
  }
  return out;
}

async function resolveQcDriveItem() {
  const di = await graphGet(
    `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(QC_SHEET_SHARING_URL)}/driveItem`,
  );
  return { driveId: di.parentReference.driveId, itemId: di.id };
}

async function loadQcPassedReps(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : undefined);
  const { driveId, itemId } = await resolveQcDriveItem();
  const base = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}` +
    `/workbook/worksheets('${encodeURIComponent(QC_SHEET_NAME)}')`;

  const dims = await graphGet(`${base}/usedRange?$select=rowCount`);
  const lastRow = dims.rowCount ?? 1;
  const CHUNK = 10000;

  const all = new Set();
  for (let r = 1; r <= lastRow; r += CHUNK) {
    const end = Math.min(r + CHUNK - 1, lastRow);
    const range = await graphGet(`${base}/range(address='A${r}:D${end}')?$select=values`);
    for (const rep of parseQcRows(range.values ?? [])) all.add(rep);
  }
  info(`[qc] ${all.size} QC-passed REPs (rowCount ${lastRow})`);
  return all;
}

module.exports = { parseQcRows, loadQcPassedReps };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/qc.test.js`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/qc.js assembly-backlog-report/qc.test.js
git commit -m "feat(assembly-backlog): QC-passed REP set from Quality sheet"
```

---

### Task 7: Email HTML builder

**Files:**
- Create: `assembly-backlog-report/email.js`
- Test: `assembly-backlog-report/email.test.js`

**Interfaces:**
- Produces: `buildSummaryHtml({ rows, dateStr, repnetUrl, logoDataUrl }): string`. Renders the RepNet navy header + a one-line summary, a preview table of up to the top 20 rows (REP / Week / Prep / Item / Days Late / Express), and a button linking to `repnetUrl + 'stats/team/assembly'`. When `rows` is empty, renders the green "✓ No overdue Assembly chairs this morning" all-clear body. Escapes HTML in cell values.

Model the markup on `morning-team-digest/index.js buildEmail` (navy `#1e3a5f`, light `#f0f4f8`, border `#e2e8f0`, logo data-URL, footer "automated at 07:00 each working day · do not reply").

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Run: node --test assembly-backlog-report/email.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildSummaryHtml } = require('./email');

const BASE = { dateStr: 'Wednesday 17 June 2026', repnetUrl: 'https://ashy-river-0a41a9410.7.azurestaticapps.net/', logoDataUrl: '' };

test('buildSummaryHtml renders count, a row, and the stats link when rows exist', () => {
  const rows = [{ rep: 'REP 1000001', week: 'WK 25', wc: '15/06/2026', prepLbl: 'Mon', itemNo: '10', daysLate: 2, express: false }];
  const html = buildSummaryHtml({ ...BASE, rows });
  assert.match(html, /1 overdue Assembly chair/);
  assert.match(html, /REP 1000001/);
  assert.match(html, /stats\/team\/assembly/);
});

test('buildSummaryHtml renders the all-clear body when rows is empty', () => {
  const html = buildSummaryHtml({ ...BASE, rows: [] });
  assert.match(html, /No overdue Assembly chairs/i);
});

test('buildSummaryHtml escapes HTML in cell values', () => {
  const rows = [{ rep: 'REP <b>x</b>', week: 'WK 25', wc: '15/06/2026', prepLbl: 'Mon', itemNo: '10', daysLate: 0, express: false }];
  const html = buildSummaryHtml({ ...BASE, rows });
  assert.match(html, /REP &lt;b&gt;x&lt;\/b&gt;/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test assembly-backlog-report/email.test.js`
Expected: FAIL — `Cannot find module './email'`.

- [ ] **Step 3: Write the implementation**

```js
'use strict';

// HTML email body for the Assembly backlog. Mirrors the visual language of
// morning-team-digest/index.js (navy header, RepNet logo, light table).

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildSummaryHtml({ rows, dateStr, repnetUrl, logoDataUrl }) {
  const navy = '#1e3a5f', light = '#f0f4f8', border = '#e2e8f0';
  const url = String(repnetUrl || '').replace(/\/?$/, '/');
  const statsUrl = url + 'stats/team/assembly';
  const logo = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="RepNet" style="height:24px;width:auto;display:block;margin-bottom:8px">`
    : `<div style="font-size:14px;font-weight:900;color:#14a1e9;letter-spacing:-.04em;margin-bottom:8px">RepNet</div>`;

  const header = `<div style="background:${navy};padding:22px 28px">
      ${logo}
      <div style="color:#fff;font-size:20px;font-weight:700">Assembly Backlog</div>
      <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">${escHtml(dateStr)}</div>
    </div>`;
  const footer = `<div style="background:${light};padding:12px 28px;font-size:11px;color:#9ca3af;border-top:1px solid ${border}">
      Repose Furniture · QMS — automated at 07:00 each working day · Do not reply.
    </div>`;

  let inner;
  if (!rows.length) {
    inner = `<div style="padding:28px;text-align:center;color:#059669;font-size:15px;font-weight:600">
        ✓ No overdue Assembly chairs this morning.
      </div>`;
  } else {
    const oldest = rows.reduce((m, r) => Math.max(m, r.daysLate), 0);
    const preview = rows.slice(0, 20).map((r) => `<tr style="border-bottom:1px solid ${border}">
        <td style="padding:6px;font-family:monospace;white-space:nowrap">${escHtml(r.rep)}</td>
        <td style="padding:6px;white-space:nowrap">${escHtml(r.week)}</td>
        <td style="padding:6px;white-space:nowrap">${escHtml(r.prepLbl)}</td>
        <td style="padding:6px;text-align:right">${escHtml(r.itemNo)}</td>
        <td style="padding:6px;text-align:right;white-space:nowrap">${escHtml(String(r.daysLate))}</td>
        <td style="padding:6px;white-space:nowrap">${r.express ? 'Yes' : ''}</td>
      </tr>`).join('');
    const more = rows.length > 20 ? `<p style="margin:10px 0 0;font-size:12px;color:#6b7280">+${rows.length - 20} more in the attached CSV.</p>` : '';
    inner = `<div style="padding:20px 28px">
        <p style="margin:0 0 14px;font-size:14px;color:#374151">
          <strong>${rows.length} overdue Assembly chair${rows.length === 1 ? '' : 's'}</strong> awaiting completion or QC sign-off this morning.
          Oldest is <strong>${oldest}</strong> working day${oldest === 1 ? '' : 's'} late. Full list attached as CSV.
        </p>
        <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid ${border};border-radius:6px;overflow:hidden;font-size:12px">
          <thead><tr style="background:${light}">
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">REP</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Week</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Prep</th>
            <th style="padding:7px;text-align:right;font-size:10px;text-transform:uppercase;color:#6b7280">Item</th>
            <th style="padding:7px;text-align:right;font-size:10px;text-transform:uppercase;color:#6b7280">Days Late</th>
            <th style="padding:7px;text-align:left;font-size:10px;text-transform:uppercase;color:#6b7280">Express</th>
          </tr></thead>
          <tbody>${preview}</tbody>
        </table>
        ${more}
        <p style="margin:16px 0 0">
          <a href="${escHtml(statsUrl)}" style="display:inline-block;padding:9px 18px;background:${navy};color:#fff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700">Open RepNet · Assembly Stats →</a>
        </p>
      </div>`;
  }

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${light};font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:680px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
      ${header}${inner}${footer}
    </div></body></html>`;
}

module.exports = { escHtml, buildSummaryHtml };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test assembly-backlog-report/email.test.js`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/email.js assembly-backlog-report/email.test.js
git commit -m "feat(assembly-backlog): HTML summary email builder"
```

---

### Task 8: Handler + timer binding

**Files:**
- Create: `assembly-backlog-report/index.js`
- Create: `assembly-backlog-report/function.json`
- Create: `assembly-backlog-report/repnet-logo-white.png` (copy from a sibling function)

**Interfaces:**
- Consumes: `loadProductionWeeks`, `loadAssemblyDoneSet`, `loadQcPassedReps`, `getAssemblyBacklogRows`, `backlogCsvWithBom`, `backlogFilename`, `buildSummaryHtml`, `sendMailWithAttachment`.
- Produces: `module.exports = async function (context, myTimer)` — the timer handler. Also `module.exports.run = runBacklogReport(context)` so `run-once.js` can call the same code path. Reads env `BACKLOG_REPORT_RECIPIENT` (default `richard.semmens@reposefurniture.co.uk`), `BACKLOG_REPORT_DRY_RUN` ('1' = compute + log, no send), `REPNET_URL` (default the SWA URL).

- [ ] **Step 1: Copy the logo asset**

```bash
cd /c/Users/jonas.simonaitis/.local/bin/azure-functions
cp morning-team-digest/repnet-logo-white.png assembly-backlog-report/repnet-logo-white.png
```

- [ ] **Step 2: Write `function.json`**

```json
{
  "disabled": false,
  "bindings": [
    {
      "name": "myTimer",
      "type": "timerTrigger",
      "direction": "in",
      "schedule": "0 0 7 * * 1-5"
    }
  ]
}
```

- [ ] **Step 3: Write `index.js`**

```js
'use strict';

// assembly-backlog-report — timer fn, 07:00 Mon-Fri. Recomputes the website's
// Assembly "Backlog" CSV (plan Excel + Supabase completions + QC sheet) and
// emails it to Richard Semmens from systemapp@ with the CSV attached.

const fs = require('fs');
const path = require('path');
const { loadProductionWeeks } = require('./plan-weeks');
const { loadAssemblyDoneSet } = require('./completions');
const { loadQcPassedReps } = require('./qc');
const { getAssemblyBacklogRows, backlogCsvWithBom, backlogFilename } = require('./assembly-backlog');
const { buildSummaryHtml } = require('./email');
const { sendMailWithAttachment } = require('./graph');

let LOGO_DATAURL = '';
try {
  LOGO_DATAURL = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'repnet-logo-white.png')).toString('base64');
} catch { /* falls back to text wordmark */ }

const DEFAULT_RECIPIENT = 'richard.semmens@reposefurniture.co.uk';
const DEFAULT_REPNET_URL = 'https://ashy-river-0a41a9410.7.azurestaticapps.net/';

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

async function runBacklogReport(log) {
  const info = (...a) => (typeof log === 'function' ? log(...a) : console.log(...a));
  requireEnv(['TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'SEND_FROM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);

  const recipient = process.env.BACKLOG_REPORT_RECIPIENT || DEFAULT_RECIPIENT;
  const repnetUrl = process.env.REPNET_URL || DEFAULT_REPNET_URL;
  const dryRun = process.env.BACKLOG_REPORT_DRY_RUN === '1';
  const now = new Date();

  info('[backlog] loading production plan…');
  const weeks = await loadProductionWeeks(info);
  const weekLabels = weeks.map((w) => w.wk);

  info('[backlog] loading completions + QC…');
  const [doneSet, qcSet] = await Promise.all([
    loadAssemblyDoneSet(weekLabels, info),
    loadQcPassedReps(info),
  ]);

  const rows = getAssemblyBacklogRows(weeks, doneSet, qcSet, now);
  info(`[backlog] ${rows.length} overdue Assembly chairs`);

  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const html = buildSummaryHtml({ rows, dateStr, repnetUrl, logoDataUrl: LOGO_DATAURL });
  const subject = rows.length
    ? `RepNet — Assembly Backlog — ${dateStr}`
    : `RepNet — Assembly Backlog — ${dateStr} — All clear`;
  const attachment = rows.length
    ? { name: backlogFilename(now), contentType: 'text/csv', contentBytes: Buffer.from(backlogCsvWithBom(rows), 'utf8').toString('base64') }
    : undefined;

  if (dryRun) {
    info(`[backlog] DRY_RUN — would send to ${recipient}: "${subject}" (${rows.length} rows, attachment=${!!attachment})`);
    return { rows: rows.length, sent: false };
  }

  await sendMailWithAttachment({ to: recipient, subject, html, attachment });
  info(`[backlog] sent to ${recipient} (${rows.length} rows)`);
  return { rows: rows.length, sent: true };
}

module.exports = async function (context) {
  try {
    await runBacklogReport((...a) => context.log(...a));
  } catch (e) {
    context.log.error('[backlog] failed:', e && e.message || e);
    throw e; // surface for Azure retry + alerting
  }
};
module.exports.runBacklogReport = runBacklogReport;
```

- [ ] **Step 4: Smoke-check require + dry-run wiring (no network)**

Run: `node -e "const m=require('./assembly-backlog-report/index.js'); console.log(typeof m, typeof m.runBacklogReport)"`
Expected: prints `function function`.

- [ ] **Step 5: Commit**

```bash
git add assembly-backlog-report/index.js assembly-backlog-report/function.json assembly-backlog-report/repnet-logo-white.png
git commit -m "feat(assembly-backlog): timer handler + 07:00 Mon-Fri binding"
```

---

### Task 9: Manual runner, dry-run verification, real send, deploy

**Files:**
- Create: `assembly-backlog-report/run-once.js`

**Interfaces:**
- Produces: a CLI that loads `local.settings.json` values into `process.env` and calls `runBacklogReport(console.log)`. Honors `BACKLOG_REPORT_DRY_RUN`.

- [ ] **Step 1: Write `run-once.js`**

```js
'use strict';

// Local one-off runner. Loads local.settings.json Values into process.env,
// then runs the backlog report once. Usage:
//   BACKLOG_REPORT_DRY_RUN=1 node assembly-backlog-report/run-once.js   # compute only
//   node assembly-backlog-report/run-once.js                            # real send
const fs = require('fs');
const path = require('path');

try {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local.settings.json'), 'utf8'));
  for (const [k, v] of Object.entries(settings.Values || {})) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
} catch (e) {
  console.warn('Could not load local.settings.json — relying on ambient env:', e.message);
}

const { runBacklogReport } = require('./index.js');
runBacklogReport(console.log)
  .then((r) => { console.log('DONE', r); process.exit(0); })
  .catch((e) => { console.error('FAILED', e); process.exit(1); });
```

- [ ] **Step 2: Confirm `local.settings.json` has the needed values**

Run: `node -e "const s=require('./local.settings.json').Values; console.log(['TENANT_ID','CLIENT_ID','CLIENT_SECRET','SEND_FROM','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].map(k=>k+'='+(s[k]?'set':'MISSING')).join('\n'))"`
Expected: all six print `=set`. If any are MISSING, stop and ask Jonas for them before continuing.

- [ ] **Step 3: Dry-run against live data — numbers check**

Run: `BACKLOG_REPORT_DRY_RUN=1 node assembly-backlog-report/run-once.js`
Expected: logs the per-stage counts and a final `[backlog] N overdue Assembly chairs` + `DRY_RUN — would send…`, then `DONE { rows: N, sent: false }`.

**STOP — human checkpoint.** Report N (and a handful of sample REPs) to Jonas. Jonas opens `…/stats/team/assembly`, reads the `⬇ Backlog (X)` button count, and confirms `N === X`. Do not proceed to the real send until Jonas confirms the number matches. If they differ, debug (likely week-window or key-format mismatch) before sending anything to Richard.

- [ ] **Step 4: Real send today (to Richard)**

After Jonas confirms the count matches:

Run: `node assembly-backlog-report/run-once.js`
Expected: `[backlog] sent to richard.semmens@reposefurniture.co.uk (N rows)` then `DONE { rows: N, sent: true }`. Confirm with Jonas that Richard's inbox shows the email with the CSV attached and that opening the CSV in Excel matches the website export.

- [ ] **Step 5: Run the full test suite**

Run: `node --test assembly-backlog-report/*.test.js`
Expected: all tests across the five suites PASS.

- [ ] **Step 6: Commit the runner**

```bash
git add assembly-backlog-report/run-once.js
git commit -m "feat(assembly-backlog): local one-off runner for dry-run + manual send"
```

- [ ] **Step 7: Deploy the timer to the Function App**

Push the branch and trigger the same deploy workflow pod-auto-send uses:

```bash
git push origin pod-auto-send-trial
gh workflow run --ref pod-auto-send-trial
```

Confirm the new function registered (after the run completes): the Azure portal Functions list shows `assembly-backlog-report` enabled with the `0 0 7 * * 1-5` schedule. If `BACKLOG_REPORT_RECIPIENT` should differ from the default, set it as an app setting now. Going forward it fires unattended at 07:00 Mon–Fri.

---

## Self-Review

**Spec coverage:**
- Identical CSV → Task 2 (verbatim `backlogRowsToCsv` + BOM + filename) + Global Constraints. ✅
- 07:00 Mon–Fri → Task 8 `function.json`. ✅
- To Richard, from systemapp@ → Task 8 (recipient default + `SEND_FROM`). ✅
- CSV attachment + HTML summary → Tasks 3, 7, 8. ✅
- Three server-side inputs (plan / completions / QC) → Tasks 4, 5, 6. ✅
- Empty-day "all clear" send, no attachment → Tasks 7, 8. ✅
- No new secrets → Task 9 Step 2 verifies existing env. ✅
- Dry-run numbers check before real send → Task 9 Step 3 checkpoint. ✅
- Real send today + deploy → Task 9 Steps 4, 7. ✅

**Placeholder scan:** No TBD/TODO; every code step has full code; every test has real assertions. ✅

**Type/name consistency:**
- `doneSet` is a `Set<string>` produced by `buildAssemblyDoneSet`/`loadAssemblyDoneSet` (Task 5) and consumed by `getAssemblyBacklogRows` via `doneSet.has(key)` (Task 2). ✅
- `qcPassedReps`/`qcSet` is a `Set<string>` from `loadQcPassedReps` (Task 6), consumed via `.has(rep7)` (Task 2). ✅
- `weeks` shape `{ wk, wc, preps }` produced by `loadProductionWeeks` (Task 4), consumed by `getAssemblyBacklogRows` (Task 2). ✅
- `backlogFilename`/`backlogCsvWithBom` defined in Task 2, used in Task 8. ✅
- `runBacklogReport` defined in Task 8, used in Task 9. ✅
- Two `isoWeekOfDate` variants kept separate: `isoWeekOfDateUTC` (Task 1, used by Task 2) vs `isoWeekOfDateLocal` (Task 4). ✅
