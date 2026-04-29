# QC View + NCR Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give QC a tablet PWA Team View where the only action is "Raise NCR", show a big-ref sticker modal after raise, and feed visual signals (red Delivery stripe, red Production Plan banner) back to area managers — driven entirely by `RaisedByTeam = 'QC'` + the existing `Status` lifecycle in `CPARLog`. Zero SharePoint schema changes.

**Architecture:** All changes are in `index.html` (vanilla single-page app, ~19,600 lines) plus a cache bump in `service-worker.js`. We branch the existing Team View renderer on `activeTeam === 'QC'` to hide completion controls, add a sticker modal opened from `submitCPAR` success path, and inject a CSS class + a banner into the existing `renderLoadSheet` and `renderProductionPlan` based on a predicate over `CPAR_ITEMS`.

**Tech Stack:** Vanilla HTML/CSS/JavaScript. SharePoint via Microsoft Graph (already wired). MSAL for auth (already wired). No build step. Codebase has **no automated test framework**, so each task ends with an explicit manual smoke test in the live app.

**Spec:** `docs/superpowers/specs/2026-04-29-qc-view-ncr-feedback-design.md`

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `index.html` | All UI/logic changes — QC-mode helper, hide completion buttons, NCR rename, sticker modal, source-prefill, Delivery red stripe, Production banner | Tasks 1-11 |
| `service-worker.js` | Cache version bump so PWA tablets pick up the new shell on next load | Task 12 |

Implementation is intentionally additive — no existing function gets restructured. Each phase ends with a commit. The codebase has no test runner, so verification is a manual smoke test on the live app.

---

## Task 1: Add `isQCMode()` helper and rename CPAR button label

**Files:**
- Modify: `index.html:4166-4168` (add helper after `getTeamColor()`)
- Modify: `index.html:4013` (rename label on priority-view raise button)
- Modify: `index.html:4247` (rename label on main team-view raise button)

- [ ] **Step 1: Add the QC-mode helper after `getTeamColor()`**

Find this block in `index.html` (around line 4166-4168):

```
function getTeamColor() {
  return TEAMS_CFG.find(t=>t.name===activeTeam)?.color || '#14a1e9';
}
```

Insert immediately after it (one blank line between):

```
// QC inspection mode flag. In QC mode the Team View hides completion
// buttons (tick/start/glu/serial) and exposes only the Raise NCR button.
// QC inspects + raises NCRs; closeout happens in the Quality view.
function isQCMode() { return activeTeam === 'QC'; }
```

- [ ] **Step 2: Rename the raise button label in the priority-jobs renderer (line 4013)**

Find:

```
            <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${wc}','${prep}',${ji})" title="Raise CPAR for this job">⚠<br>CPAR</button>
```

Replace with:

```
            <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${wc}','${prep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
```

- [ ] **Step 3: Rename the raise button label in the main team-view renderer (line 4247)**

Find:

```
        <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${activeWC}','${activePrep}',${ji})" title="Raise CPAR for this job">⚠<br>CPAR</button>
```

Replace with:

```
        <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${activeWC}','${activePrep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
```

- [ ] **Step 4: Manual test**

1. Open the app in a browser, sign in as any team-leader account, and navigate to Team View.
2. Confirm the per-job raise button now shows "⚠ NCR" (not "⚠ CPAR").
3. Click it once to confirm the existing CPAR raise modal still opens.
4. Open the browser dev console and run `isQCMode()` — should return `false` (active team is not QC).
5. Run `activeTeam = 'QC'; isQCMode()` — should return `true`. Restore by reloading the page.

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "feat(qc-view): add isQCMode helper + rename CPAR raise button to NCR"
```

---

## Task 2: Hide completion buttons in QC mode (main team view)

**Files:**
- Modify: `index.html:4245-4264` (`renderJobs` job card output)

- [ ] **Step 1: Wrap each completion button with `!isQCMode()`**

In `renderJobs()` at the job-card output (lines 4245-4264 — the block that emits `serial-card-btn`, `uhReadyTokens`, `cpar-btn`, `start-btn`, `glu-btn`, `tick-btn`), each non-NCR button must be hidden when `isQCMode()` is true. The CPAR button stays visible always.

Find:

```
        ${activeTeam === 'Assembly' ? (() => { const _s = MECH_SERIALS.get(`${job.rep}__${activeWC}__${activePrep}`); return `<button class="serial-card-btn${_s?' saved':''}" onclick="event.stopPropagation();openMechSerialModal('${activeWC}','${activePrep}',${ji},'${escHtml(job.rep)}')">${_s ? `✓<br><span style="font-size:9px;letter-spacing:.02em">${escHtml(_s)}</span>` : '⊞<br>Serial'}</button>`; })() : ''}
        ${activeTeam === 'Assembly' ? uhReadyTokens(activeWC, activePrep, ji) : ''}
        <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${activeWC}','${activePrep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
        ${showStart && !s.done ? `<button class="start-btn${isStarted?' active':''}" onclick="event.stopPropagation();${isStarted?`unStartJob(${ji})`:`startJob(${ji})`}" title="${isStarted?'Cancel start':'Start this job'}">
          <span class="sb-icon">${isStarted?'⏸':'▶'}</span>
          <span>${isStarted?'STARTED':'START'}</span>
        </button>` : ''}
        ${activeTeam === 'Woodmill' && !job.isService ? (() => {
          const gk = gluingKey(activeWC, activePrep, job.rep, activeSub);
          const g  = GLUING_QUEUE[gk];
          const cls = g?.done ? 'glued' : g ? 'flagged' : '';
          const lbl = g?.done ? 'GLUED' : g ? 'GLU ✓' : 'GLU';
          return `<button class="glu-btn ${cls}" onclick="event.stopPropagation();toggleGluingFlag('${activeWC}','${activePrep}',${ji},'${activeSub}')" title="${g?.done?'Gluing complete':g?'Remove gluing flag':'Flag '+activeSub+' for gluing'}">
            <span class="glu-icon">🧲</span><span>${lbl}</span>
          </button>`;
        })() : ''}
        <button class="tick-btn ${s.done?'ticked':''}" onclick="tickJob(${ji})">
          <span class="tb-icon">${s.done?'✓':'○'}</span>
          <span class="tb-label">${s.done?'DONE':'MARK'}</span>
        </button>
```

Replace with (only the first three lines change `activeTeam === 'Assembly'` checks — but everything except the `cpar-btn` must additionally check `!isQCMode()`):

```
        ${!isQCMode() && activeTeam === 'Assembly' ? (() => { const _s = MECH_SERIALS.get(`${job.rep}__${activeWC}__${activePrep}`); return `<button class="serial-card-btn${_s?' saved':''}" onclick="event.stopPropagation();openMechSerialModal('${activeWC}','${activePrep}',${ji},'${escHtml(job.rep)}')">${_s ? `✓<br><span style="font-size:9px;letter-spacing:.02em">${escHtml(_s)}</span>` : '⊞<br>Serial'}</button>`; })() : ''}
        ${!isQCMode() && activeTeam === 'Assembly' ? uhReadyTokens(activeWC, activePrep, ji) : ''}
        <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${activeWC}','${activePrep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
        ${!isQCMode() && showStart && !s.done ? `<button class="start-btn${isStarted?' active':''}" onclick="event.stopPropagation();${isStarted?`unStartJob(${ji})`:`startJob(${ji})`}" title="${isStarted?'Cancel start':'Start this job'}">
          <span class="sb-icon">${isStarted?'⏸':'▶'}</span>
          <span>${isStarted?'STARTED':'START'}</span>
        </button>` : ''}
        ${!isQCMode() && activeTeam === 'Woodmill' && !job.isService ? (() => {
          const gk = gluingKey(activeWC, activePrep, job.rep, activeSub);
          const g  = GLUING_QUEUE[gk];
          const cls = g?.done ? 'glued' : g ? 'flagged' : '';
          const lbl = g?.done ? 'GLUED' : g ? 'GLU ✓' : 'GLU';
          return `<button class="glu-btn ${cls}" onclick="event.stopPropagation();toggleGluingFlag('${activeWC}','${activePrep}',${ji},'${activeSub}')" title="${g?.done?'Gluing complete':g?'Remove gluing flag':'Flag '+activeSub+' for gluing'}">
            <span class="glu-icon">🧲</span><span>${lbl}</span>
          </button>`;
        })() : ''}
        ${!isQCMode() ? `<button class="tick-btn ${s.done?'ticked':''}" onclick="tickJob(${ji})">
          <span class="tb-icon">${s.done?'✓':'○'}</span>
          <span class="tb-label">${s.done?'DONE':'MARK'}</span>
        </button>` : ''}
```

- [ ] **Step 2: Manual test**

1. Open the app and sign in. Switch to QC team in the sidebar (or sign in as Weronika).
2. Pick any prep day. Confirm each job card shows ONLY the "⚠ NCR" button — no MARK / START / GLU / Serial / UH-readiness buttons.
3. Switch back to a non-QC team (e.g. Sewing). Confirm MARK + START + NCR buttons all reappear.

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat(qc-view): hide completion buttons in renderJobs when QC mode active"
```

---

## Task 3: Hide completion buttons in QC mode (priority-jobs view)

**Files:**
- Modify: `index.html:4011-4022` (`renderPriorityJobsList` job card output)

- [ ] **Step 1: Apply the same `!isQCMode()` gating to priority-view cards**

Find this block in `renderPriorityJobsList()` (around line 4011-4022):

```
            ${activeTeam === 'Assembly' ? (() => { const _s = MECH_SERIALS.get(`${job.rep}__${wc}__${prep}`); return `<button class="serial-card-btn${_s?' saved':''}" onclick="event.stopPropagation();openMechSerialModal('${wc}','${prep}',${ji},'${escHtml(job.rep)}')">${_s ? `✓<br><span style="font-size:9px;letter-spacing:.02em">${escHtml(_s)}</span>` : '⊞<br>Serial'}</button>`; })() : ''}
            ${activeTeam === 'Assembly' ? uhReadyTokens(wc, prep, ji) : ''}
            <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${wc}','${prep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
            ${showStart && !s.done ? `<button class="start-btn${isStarted?' active':''}" onclick="event.stopPropagation();${isStarted?`priorityUnStartJob('${wc}','${prep}',${ji})`:`priorityStartJob('${wc}','${prep}',${ji})`}" title="${isStarted?'Cancel start':'Start this job'}">
              <span class="sb-icon">${isStarted?'⏸':'▶'}</span>
              <span>${isStarted?'STARTED':'START'}</span>
            </button>` : ''}
            <button class="tick-btn ${s.done?'ticked':''}" onclick="priorityTickJob('${wc}','${prep}',${ji})">
              <span class="tb-icon">${s.done?'✓':'○'}</span>
              <span class="tb-label">${s.done?'DONE':'MARK'}</span>
            </button>
```

Replace with:

```
            ${!isQCMode() && activeTeam === 'Assembly' ? (() => { const _s = MECH_SERIALS.get(`${job.rep}__${wc}__${prep}`); return `<button class="serial-card-btn${_s?' saved':''}" onclick="event.stopPropagation();openMechSerialModal('${wc}','${prep}',${ji},'${escHtml(job.rep)}')">${_s ? `✓<br><span style="font-size:9px;letter-spacing:.02em">${escHtml(_s)}</span>` : '⊞<br>Serial'}</button>`; })() : ''}
            ${!isQCMode() && activeTeam === 'Assembly' ? uhReadyTokens(wc, prep, ji) : ''}
            <button class="cpar-btn" onclick="event.stopPropagation();openCPARForm('${wc}','${prep}',${ji})" title="Raise Internal NCR for this job">⚠<br>NCR</button>
            ${!isQCMode() && showStart && !s.done ? `<button class="start-btn${isStarted?' active':''}" onclick="event.stopPropagation();${isStarted?`priorityUnStartJob('${wc}','${prep}',${ji})`:`priorityStartJob('${wc}','${prep}',${ji})`}" title="${isStarted?'Cancel start':'Start this job'}">
              <span class="sb-icon">${isStarted?'⏸':'▶'}</span>
              <span>${isStarted?'STARTED':'START'}</span>
            </button>` : ''}
            ${!isQCMode() ? `<button class="tick-btn ${s.done?'ticked':''}" onclick="priorityTickJob('${wc}','${prep}',${ji})">
              <span class="tb-icon">${s.done?'✓':'○'}</span>
              <span class="tb-label">${s.done?'DONE':'MARK'}</span>
            </button>` : ''}
```

- [ ] **Step 2: Manual test**

1. Sign in as Weronika (or set `activeTeam = 'QC'` in dev console then call `renderJobs()`).
2. Click "Priority Jobs" in the QC sidebar.
3. Confirm each priority card shows ONLY the "⚠ NCR" button (no MARK / START).

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat(qc-view): hide completion buttons in priority-jobs view when QC mode active"
```

---

## Task 4: Add QC-mode banner above job list

**Files:**
- Modify: `index.html:4203-4207` (insert banner injection in `renderJobs`)
- Modify: `index.html` CSS (insert near `.cpar-btn` rule around line 1326)

- [ ] **Step 1: Add CSS for the QC mode banner**

Find this CSS block in `index.html` (around line 1326-1334):

```
/* ── CPAR button on job card ── */
.cpar-btn {
  flex-shrink: 0; margin: 8px 4px; padding: 5px 8px;
  border: 1.5px solid var(--aborder); border-radius: 7px;
  background: var(--abg); color: var(--amber); font-size: 11px;
  font-weight: 600; font-family: inherit; cursor: pointer;
  transition: .12s; white-space: nowrap; line-height: 1.4; text-align: center;
}
.cpar-btn:hover { border-color: var(--amber); background: #fef3c7; }
```

Insert immediately after `.cpar-btn:hover { ... }`:

```
/* ── QC inspection mode banner above job list ── */
.qc-mode-banner {
  margin: 0 0 10px 0; padding: 10px 14px;
  background: linear-gradient(90deg, #ecfeff 0%, #cffafe 100%);
  border: 1px solid #67e8f9; border-left: 4px solid var(--teal, #0e7490);
  border-radius: 8px; color: #155e75; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; gap: 8px;
}
.qc-mode-banner-icon { font-size: 16px; }
```

- [ ] **Step 2: Inject the banner above the job list in `renderJobs`**

Find this block in `renderJobs()` (around line 4203-4207):

```
  const area = document.getElementById('jobListArea');
  if (!total) {
    area.innerHTML = `<div class="no-jobs"><div style="font-size:28px">🎉</div><p>No jobs for this prep day</p></div>`;
    renderUndo(); return;
  }
```

Replace with:

```
  const area = document.getElementById('jobListArea');
  const qcBanner = isQCMode()
    ? `<div class="qc-mode-banner"><span class="qc-mode-banner-icon">🔍</span>QC inspection mode — read-only. Tap ⚠ NCR on any job to raise an Internal Non-Conformance.</div>`
    : '';
  if (!total) {
    area.innerHTML = `${qcBanner}<div class="no-jobs"><div style="font-size:28px">🎉</div><p>No jobs for this prep day</p></div>`;
    renderUndo(); return;
  }
```

- [ ] **Step 3: Inject the banner at the top of the rendered job list HTML**

Still in `renderJobs()`, find the line near the end of the function (around line 4268):

```
  area.innerHTML = html;
  renderQCSyncBar();
  renderUndo();
}
```

Replace with:

```
  area.innerHTML = qcBanner + html;
  renderQCSyncBar();
  renderUndo();
}
```

- [ ] **Step 4: Inject the banner in the priority-jobs renderer too**

Find in `renderPriorityJobsList()` (around line 3950-3958):

```
  const jobs = getPriorityJobs(activeTeam, activeSub);

  if (!jobs.length) {
    area.innerHTML = `<div class="pj-clear">
      <div class="pj-clear-icon">🎉</div>
      <div class="pj-clear-title">All clear!</div>
      <div class="pj-clear-sub">${activeTeam}${subLabel} has no outstanding jobs<br>in Yesterday, Today or Tomorrow's load plan.</div>
    </div>`;
    return;
  }
```

Replace with:

```
  const jobs = getPriorityJobs(activeTeam, activeSub);
  const qcBanner = isQCMode()
    ? `<div class="qc-mode-banner"><span class="qc-mode-banner-icon">🔍</span>QC inspection mode — read-only. Tap ⚠ NCR on any job to raise an Internal Non-Conformance.</div>`
    : '';

  if (!jobs.length) {
    area.innerHTML = qcBanner + `<div class="pj-clear">
      <div class="pj-clear-icon">🎉</div>
      <div class="pj-clear-title">All clear!</div>
      <div class="pj-clear-sub">${activeTeam}${subLabel} has no outstanding jobs<br>in Yesterday, Today or Tomorrow's load plan.</div>
    </div>`;
    return;
  }
```

Then find the final `area.innerHTML = html;` at the end of `renderPriorityJobsList()` (around line 4035). Replace with:

```
  area.innerHTML = qcBanner + html;
```

- [ ] **Step 5: Manual test**

1. Sign in as Weronika (QC). Confirm the cyan banner "🔍 QC inspection mode — read-only..." appears at the top of the job list.
2. Switch to Priority Jobs in the QC sidebar — banner appears there too.
3. Switch back to a non-QC team — banner disappears.

- [ ] **Step 6: Commit**

```
git add index.html
git commit -m "feat(qc-view): cyan QC inspection mode banner above job list"
```

---

## Task 5: Sticker modal markup + CSS

**Files:**
- Modify: `index.html` — add modal markup near the end of `<body>` next to other modals
- Modify: `index.html` — add CSS rules near other CPAR modal styles

- [ ] **Step 1: Find an existing modal to add the new one near**

Run this grep to find where other `cpar-modal` markup lives:

```
grep -n 'id="cpar-modal"' C:/Users/jonas.simonaitis/.local/bin/index.html
grep -n 'id="cpar-summary-modal"' C:/Users/jonas.simonaitis/.local/bin/index.html
```

Open `index.html` and locate the `<div id="cpar-summary-modal" ...>` block. Add the new modal markup as a sibling immediately after the closing `</div>` of that summary modal.

- [ ] **Step 2: Add the sticker modal markup**

Insert this HTML as a sibling after the closing tag of `cpar-summary-modal`:

```
<!-- QC NCR sticker modal — shown after QC raises an Internal NCR.
     Displays the new NCR ref in giant monospace so QC can hand-write it
     onto the red sticker that travels with the rejected chair. -->
<div class="modal-bg" id="qc-ncr-sticker-modal" style="display:none">
  <div class="qc-sticker-card">
    <div class="qc-sticker-title">Internal NCR Raised</div>
    <div class="qc-sticker-ref" id="qc-sticker-ref-text">RP-00000</div>
    <div class="qc-sticker-instr">
      <div class="qc-sticker-instr-icon">📝</div>
      <div>Manually write the Internal NCR reference number on the red sticker and apply to the faulty item being sent.</div>
    </div>
    <div class="qc-sticker-meta" id="qc-sticker-meta-text"></div>
    <button class="qc-sticker-done-btn" id="qc-sticker-done-btn" onclick="closeQCStickerModal()">✓ I've written the ref — Done</button>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for the sticker modal**

Find an existing CPAR modal CSS rule by grepping (e.g. `.cpar-modal-card`). Add the following block as a new section in the same area:

```
/* ── QC NCR sticker modal (shown after QC raises an Internal NCR) ── */
#qc-ncr-sticker-modal { z-index: 10001; }
.qc-sticker-card {
  background: #fff; border: 3px solid var(--red);
  border-radius: 14px; padding: 32px 28px;
  max-width: 560px; width: 92%;
  box-shadow: 0 24px 64px rgba(0,0,0,.4);
  text-align: center;
}
.qc-sticker-title {
  font-size: 18px; font-weight: 700; color: var(--text2);
  letter-spacing: .04em; text-transform: uppercase;
  margin-bottom: 18px;
}
.qc-sticker-ref {
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 64px; font-weight: 800; color: var(--red);
  letter-spacing: .04em; line-height: 1.1;
  padding: 18px 12px; margin: 0 auto 22px;
  background: #fff5f5; border: 2px dashed var(--red); border-radius: 10px;
  user-select: all;
}
.qc-sticker-instr {
  display: flex; align-items: flex-start; gap: 10px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  padding: 12px 14px; margin-bottom: 14px;
  font-size: 13px; color: #78350f; text-align: left; line-height: 1.45;
}
.qc-sticker-instr-icon { font-size: 18px; flex-shrink: 0; }
.qc-sticker-meta {
  font-size: 11px; color: var(--text3);
  margin-bottom: 18px; text-align: left;
  white-space: pre-line; line-height: 1.5;
}
.qc-sticker-done-btn {
  width: 100%; padding: 14px 18px;
  background: var(--green); color: #fff;
  border: none; border-radius: 9px;
  font-size: 15px; font-weight: 700; font-family: inherit;
  cursor: pointer; transition: .12s;
}
.qc-sticker-done-btn:hover { filter: brightness(1.08); }
.qc-sticker-done-btn:focus { outline: 3px solid #86efac; outline-offset: 2px; }
```

- [ ] **Step 4: Add the open/close helpers**

Find the `closeCPARModal()` function in `index.html` (around line 10978-10980). Insert these new functions immediately after it:

```
// Open the QC sticker modal showing the freshly-raised NCR ref. Called
// from submitCPAR's success path when activeTeam === 'QC'. Tap-outside is
// disabled — staff must explicitly confirm so the ref isn't dismissed
// before being copied onto the physical red sticker.
function openQCStickerModal(ref, repId, jobNo, model, descSnippet) {
  document.getElementById('qc-sticker-ref-text').textContent = ref;
  const metaParts = [];
  if (repId)        metaParts.push('Job:   ' + repId + (jobNo ? ' / Job ' + jobNo : '') + (model ? ' / ' + model : ''));
  if (descSnippet)  metaParts.push('Issue: ' + descSnippet.slice(0, 80) + (descSnippet.length > 80 ? '…' : ''));
  document.getElementById('qc-sticker-meta-text').textContent = metaParts.join('\n');
  document.getElementById('qc-ncr-sticker-modal').style.display = 'flex';
  // Auto-focus the Done button so a single tap dismisses
  setTimeout(() => document.getElementById('qc-sticker-done-btn')?.focus(), 50);
}

function closeQCStickerModal() {
  document.getElementById('qc-ncr-sticker-modal').style.display = 'none';
}
```

- [ ] **Step 5: Manual test**

In the dev console, run:

```
openQCStickerModal('RP-09999', 'REP 2611160', '22', 'Aurora High', 'Staple sticking out of OSB on inner panel')
```

Expected: full-screen modal appears with `RP-09999` rendered in giant red monospace, the handwriting instructions in amber, and Job/Issue metadata at the bottom. The Done button is auto-focused. Clicking Done dismisses. Clicking outside the card does NOT dismiss.

- [ ] **Step 6: Commit**

```
git add index.html
git commit -m "feat(qc-view): sticker modal markup + CSS for big-ref NCR display"
```

---

## Task 6: Wire `submitCPAR` to open sticker modal in QC mode

**Files:**
- Modify: `index.html:11315-11317` (success path of `submitCPAR`)

- [ ] **Step 1: Open the sticker modal after the success toast**

Find this block in `submitCPAR()` (around line 11315-11317):

```
    toast(`${ref} raised successfully`, 's');
    closeCPARModal();
```

Replace with:

```
    toast(`${ref} raised successfully`, 's');
    closeCPARModal();

    // QC inspection mode → open the sticker modal so the inspector can
    // hand-copy the new NCR ref onto the physical red sticker.
    if (activeTeam === 'QC') {
      openQCStickerModal(ref, s.rep, s.jobNo, s.model, s.desc.trim());
    }
```

- [ ] **Step 2: Manual test**

1. Sign in as Weronika (QC). Open Team View → pick any prep day.
2. Tap "⚠ NCR" on any job. Fill the form (Source = Upholstery, Description = "test sticker modal flow"). Submit.
3. Confirm: success toast fires, the CPAR form modal closes, AND the giant-ref sticker modal opens showing the new RP-XXXXX number.
4. Confirm tapping outside the card does NOT dismiss it; only the green "Done" button does.
5. Switch to a non-QC team and raise a CPAR — the sticker modal must NOT appear (only the toast).

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat(qc-view): open sticker modal after submitCPAR in QC mode"
```

---

## Task 7: Auto-prefill SourceDept from last completion team

**Files:**
- Modify: `index.html:10946` (insert helper above `openCPARForm`)
- Modify: `index.html:10952-10957` (extend `openCPARForm` with prefill logic)

- [ ] **Step 1: Add the helper functions above `openCPARForm`**

Find this line in `index.html` (around line 10947, immediately above `function openCPARForm(`):

```
function openCPARForm(wc, prep, ji) {
```

Insert this block on the line(s) directly above it:

```
// Walk the in-memory STATE map for this (wc, prep, ji) and return the name
// of the most recently-completed team (Assembly / Upholstery / Sewing /
// Cutting / Woodmill / Foam) excluding QC. Returns null if no team has
// marked the job done yet.
function findLastCompletionTeamForJob(wc, prep, ji) {
  let bestTeam = null;
  let bestTime = 0;
  TEAMS_CFG.forEach(t => {
    if (t.name === 'QC') return;
    const subKeys = t.hasSubs ? SUBS : ['all'];
    subKeys.forEach(sk => {
      const s = STATE[t.name]?.[sk]?.[wc]?.[prep]?.[ji];
      if (!s?.done) return;
      const dStr = (s.doneDate || '').trim();
      const tStr = (s.doneAt   || '00:00').trim();
      const m = dStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return;
      const ts = new Date(`${m[3]}-${m[2]}-${m[1]}T${tStr}:00`).getTime();
      if (Number.isFinite(ts) && ts > bestTime) {
        bestTime = ts;
        bestTeam = t.name;
      }
    });
  });
  return bestTeam;
}

// Map a STATE team name to the closest CPAR_SOURCES key. Assembly defects
// almost always show as upholstery-finish issues (visible during QC) so
// Assembly maps to 'upholstery' as the most useful default; the QC user
// can override in the dropdown if Assembly is the actual culprit.
function teamNameToCparSourceKey(team) {
  if (!team) return '';
  const t = String(team).toLowerCase();
  if (t === 'assembly')              return 'upholstery';
  if (t.startsWith('upholstery'))    return 'upholstery';
  if (t === 'sewing')                return 'sewing';
  if (t === 'cutting')               return 'cutting';
  if (t === 'woodmill')              return 'woodmill';
  if (t === 'foam')                  return 'foam';
  return '';
}

```

- [ ] **Step 2: Use the helper in `openCPARForm`**

Find this block in `openCPARForm` (around line 10948-10958):

```
function openCPARForm(wc, prep, ji) {
  const job = PROD[wc]?.[prep]?.[ji];
  if (!job) return;

  Object.assign(cparFormState, {
    wc, prep:String(prep), ji,
    rep:job.rep, jobNo:job.itemNo, model:(job.spec?.model||'').trim(),
    week:wc, source:'', category:'', causeCode:'', desc:'', qty:1,
    extraJobs:[], photoFile:null, photoDataUrl:null,
  });
```

Replace with:

```
function openCPARForm(wc, prep, ji) {
  const job = PROD[wc]?.[prep]?.[ji];
  if (!job) return;

  // QC inspection mode pre-selects the most-recent completion team as the
  // likely source (typically Upholstery or Assembly). QC can override.
  const prefillSource = activeTeam === 'QC'
    ? teamNameToCparSourceKey(findLastCompletionTeamForJob(wc, prep, ji))
    : '';

  Object.assign(cparFormState, {
    wc, prep:String(prep), ji,
    rep:job.rep, jobNo:job.itemNo, model:(job.spec?.model||'').trim(),
    week:wc, source:prefillSource, category:'', causeCode:'', desc:'', qty:1,
    extraJobs:[], photoFile:null, photoDataUrl:null,
  });
```

- [ ] **Step 3: Trigger source-grid render so the prefill is visible**

Still in `openCPARForm`, find this block near the end:

```
  renderCPARSourceGrid();
  renderCPARJobsItems('');
  document.getElementById('cpar-modal').style.display = 'flex';
}
```

Replace with:

```
  renderCPARSourceGrid();
  // If the source was auto-prefilled (QC mode), trigger the cascade so the
  // Type-of-issue panel for that source is rendered on form open.
  if (prefillSource) {
    selectCPARSource(prefillSource);
    const grid = document.getElementById('cpar-source-grid');
    if (grid) grid.value = prefillSource;
  }
  renderCPARJobsItems('');
  document.getElementById('cpar-modal').style.display = 'flex';
}
```

- [ ] **Step 4: Manual test**

1. In dev console, set `activeTeam = 'QC'`.
2. Pick a job that has had Upholstery marked done — e.g. find one in the team-sidebar that shows >0 done for Upholstery in the current week. (Or quickly mark one done from another team to seed the data.)
3. Run `openCPARForm('WK 12', 1, 0)` (or whichever wc/prep/ji has a known completion).
4. Confirm the source dropdown shows "Upholstery" already selected and the Upholstery type-of-issue panel is visible.
5. Run `openCPARForm('WK 12', 1, 99)` (a job with no completions). Confirm the source dropdown is blank.
6. Reset by reloading the page.

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "feat(qc-view): auto-prefill SourceDept from last completion team in QC mode"
```

---

## Task 8: Build the open-QC-NCR predicate helpers

**Files:**
- Modify: `index.html` — insert helper block near `getCPARStatus` (line 12923)

- [ ] **Step 1: Add the QC-NCR predicate helpers**

Find this function in `index.html` (around line 12923):

```
function getCPARStatus(item) {
```

Insert this block IMMEDIATELY ABOVE that function (so the helpers are colocated with status logic):

```
// Returns true if this CPAR represents an open NCR raised by QC and is
// currently sitting with the area manager (i.e. not yet closed-out into
// Pending QHSE Review). Drives the red Delivery stripe + red Production
// banner. Pure function over `item.fields` — safe to call from renderers.
function isOpenQCNCR(item) {
  const f = item?.fields || {};
  if (f.RaisedByTeam !== 'QC') return false;
  return f.Status === CPAR_STATUS.OPEN
      || f.Status === CPAR_STATUS.RETURNED;
}

// Extracts the 7-digit REP number from a 'REP 1234567' / 'REP1234567'
// string. Used to match CPAR.PrimaryREP rows against Delivery view items
// (which key on rep7 only).
function extractRep7(repStr) {
  const m = String(repStr || '').match(/(\d{7})/);
  return m ? m[1] : '';
}

// Returns the set of rep7 strings that have at least one open QC-raised
// NCR. Used by renderLoadSheet to colour the Delivery stripe red.
function buildQCNcrRep7Set() {
  const set = new Set();
  CPAR_ITEMS.forEach(item => {
    if (!isOpenQCNCR(item)) return;
    const r = extractRep7(item.fields?.PrimaryREP);
    if (r) set.add(r);
  });
  return set;
}

// Returns a Map keyed by `${rep}#${jobNo}` whose value is an array of the
// matching open QC-raised CPAR items. Used by renderProductionPlan to draw
// per-job red banners (one banner per NCR — multiple NCRs stack).
function buildQCNcrJobMap() {
  const map = new Map();
  CPAR_ITEMS.forEach(item => {
    if (!isOpenQCNCR(item)) return;
    const f   = item.fields || {};
    const rep = String(f.PrimaryREP || '').trim();
    const job = String(f.PrimaryJobNo || '').trim();
    if (!rep || !job) return;
    const key = rep + '#' + job;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

```

- [ ] **Step 2: Manual test**

In the dev console, run:

```
buildQCNcrRep7Set()
buildQCNcrJobMap()
```

Expected: with no QC-raised NCRs in current data, both return an empty Set / empty Map. After Task 6 the QC user can raise one and re-running should show it.

You can also seed-test by mutating in-memory:

```
CPAR_ITEMS.unshift({ id:'test', fields:{ Title:'RP-test', RaisedByTeam:'QC', PrimaryREP:'REP 9999999', PrimaryJobNo:'1', Status:'Open' }});
buildQCNcrRep7Set();   // → Set { '9999999' }
buildQCNcrJobMap();    // → Map { 'REP 9999999#1' => [...] }
CPAR_ITEMS.shift();    // remove the test row
```

- [ ] **Step 3: Commit**

```
git add index.html
git commit -m "feat(qc-view): add isOpenQCNCR predicate + rep7/job-map builder helpers"
```

---

## Task 9: Red stripe in Delivery view

**Files:**
- Modify: `index.html:1679-1681` (CSS — add `.ls-item-rep.qc-ncr-open` rule)
- Modify: `index.html:10346-10399` (`renderLoadSheet` — apply class)

- [ ] **Step 1: Add CSS for the red diagonal stripe**

Find this CSS block in `index.html` (around lines 1679-1681):

```
.ls-item-rep.qc-done { background:#bbf7d0 !important; }
.ls-item-rep.asm-done { background:repeating-linear-gradient(45deg,#fff7ed,#fff7ed 4px,#fed7aa 4px,#fed7aa 8px) !important; }
.ls-item-rep.asm-done .ls-rep-num { color:#9a3412; }
```

Insert immediately after the third line:

```
.ls-item-rep.qc-ncr-open { background:repeating-linear-gradient(45deg,#fff5f5,#fff5f5 4px,#fecaca 4px,#fecaca 8px) !important; }
.ls-item-rep.qc-ncr-open .ls-rep-num { color:#991b1b; font-weight:700; }
```

- [ ] **Step 2: Compute `qcReturnSet` once per render and apply class**

Find this block in `renderLoadSheet()` (around lines 10346-10371):

```
  wrap.innerHTML = cols.map(col => {
    const label    = lsDayLabel(col.date);
    const cls      = lsDayCls(col.date);
    const dateStr  = col.date.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
    const repCount  = col.items.filter(i => i.rep7 || i.isAcc).length;
    const doneCount = col.items.filter(i => {
      if (i.rep7)   return qcCompletedReps.has(i.rep7) || mechQCDone.has(i.rep7);
      if (i.isAcc)  return accQCDone.has(i.accJobNum) || qcCompletedReps.has(i.accJobNum);
      return false;
    }).length;
    const allDone   = repCount > 0 && doneCount === repCount;

    const itemsHtml = col.items.length ? col.items.map(item => {
      const changedAt  = LS_CHANGES.get(item.text);
      const isChanged  = !!changedAt && (Date.now() - changedAt < 3600000);
      const delayStyle = isChanged ? `animation-delay:-${Math.floor((Date.now()-changedAt)/1000)}s` : '';

      if (item.rep7) {
        const isDone     = qcCompletedReps.has(item.rep7) || mechQCDone.has(item.rep7);
        const mechTag    = item.isMech ? ' <span class="ls-mech-tag">MECH</span>' : '';
        const servTag    = item.isServ ? ' <span class="ls-serv-tag">SERV</span>' : '';
        const extra      = item.text.replace(/\bREP\b/gi,'').replace(/\bmech\b/gi,'').replace(/\bserv\b/gi,'').replace(item.rep7,'').replace(/^[\s\-–]+|[\s\-–]+$/g,'').trim();
        const expType    = EXPRESS_TYPE_MAP.get(item.rep7);
        const expCls     = expType === 'MFT' ? ' mft-job' : expType === 'EXP' ? ' exp-job' : '';
        const isAsmDone  = !isDone && isAssemblyFullyDoneForRep(item.rep7);
        const cls        = `ls-item-rep${expCls}${isDone?' qc-done':isAsmDone?' asm-done':''}${isChanged?' ls-changed':''}`;
```

Replace with:

```
  // Build the set of rep7 numbers with at least one open QC-raised NCR
  // once per render — used to colour the Delivery stripe red.
  const qcReturnSet = buildQCNcrRep7Set();

  wrap.innerHTML = cols.map(col => {
    const label    = lsDayLabel(col.date);
    const cls      = lsDayCls(col.date);
    const dateStr  = col.date.toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' });
    const repCount  = col.items.filter(i => i.rep7 || i.isAcc).length;
    const doneCount = col.items.filter(i => {
      if (i.rep7)   return qcCompletedReps.has(i.rep7) || mechQCDone.has(i.rep7);
      if (i.isAcc)  return accQCDone.has(i.accJobNum) || qcCompletedReps.has(i.accJobNum);
      return false;
    }).length;
    const allDone   = repCount > 0 && doneCount === repCount;

    const itemsHtml = col.items.length ? col.items.map(item => {
      const changedAt  = LS_CHANGES.get(item.text);
      const isChanged  = !!changedAt && (Date.now() - changedAt < 3600000);
      const delayStyle = isChanged ? `animation-delay:-${Math.floor((Date.now()-changedAt)/1000)}s` : '';

      if (item.rep7) {
        const isDone     = qcCompletedReps.has(item.rep7) || mechQCDone.has(item.rep7);
        const mechTag    = item.isMech ? ' <span class="ls-mech-tag">MECH</span>' : '';
        const servTag    = item.isServ ? ' <span class="ls-serv-tag">SERV</span>' : '';
        const extra      = item.text.replace(/\bREP\b/gi,'').replace(/\bmech\b/gi,'').replace(/\bserv\b/gi,'').replace(item.rep7,'').replace(/^[\s\-–]+|[\s\-–]+$/g,'').trim();
        const expType    = EXPRESS_TYPE_MAP.get(item.rep7);
        const expCls     = expType === 'MFT' ? ' mft-job' : expType === 'EXP' ? ' exp-job' : '';
        const isAsmDone  = !isDone && isAssemblyFullyDoneForRep(item.rep7);
        // Stripe priority (highest wins): qc-done (green) > qc-ncr-open
        // (red, NCR sitting with area manager) > asm-done (orange).
        const isQcReturn = !isDone && qcReturnSet.has(item.rep7);
        const stripeCls  = isDone ? ' qc-done' : isQcReturn ? ' qc-ncr-open' : isAsmDone ? ' asm-done' : '';
        const cls        = `ls-item-rep${expCls}${stripeCls}${isChanged?' ls-changed':''}`;
```

Note: this replaces the single `const cls = ...` line at the end with two lines (`const isQcReturn` + `const stripeCls`) and a new composed `const cls`. Indentation is preserved.

- [ ] **Step 3: Manual test**

1. Sign in as Weronika. Pick a job whose REP appears on the Delivery tab (current/next week prep day). Raise an NCR against it.
2. Switch to Delivery view. Confirm that REP row now has a red diagonal stripe (instead of orange or white).
3. Open Quality view, find the new NCR card, click "Submit close-out → QHSE Review" with a disposition. Refresh CPAR list. Return to Delivery.
4. Confirm the red stripe is gone — falls back to white (or orange if Assembly was already done for that REP).
5. Sign in as a non-QC user, raise a CPAR. Confirm the stripe stays whatever it was — non-QC NCRs do NOT trigger red.

- [ ] **Step 4: Commit**

```
git add index.html
git commit -m "feat(qc-view): red diagonal stripe on Delivery view for open QC NCRs"
```

---

## Task 10: Red banner on Production Plan view

**Files:**
- Modify: `index.html` — add CSS for `.pp-ncr-banner` near other `.pp-job` styles
- Modify: `index.html:7382-7508` (`renderProductionPlan` — inject banner per job)

- [ ] **Step 1: Add CSS for the production-plan red banner**

Run this grep to locate the existing `.pp-job` styles:

```
grep -n '\.pp-job\b' C:/Users/jonas.simonaitis/.local/bin/index.html
```

Open the file at the first matching CSS line and insert this rule block as a sibling, immediately AFTER the existing `.pp-job` selector group ends (look for the next non-`.pp-job-*` rule):

```
/* ── Open QC NCR banner on Production Plan job cards ── */
.pp-ncr-banner {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 0 0 4px 0; padding: 7px 10px;
  background: #fef2f2; border: 1px solid var(--red);
  border-left: 4px solid var(--red); border-radius: 6px;
  font-size: 11px; color: #7f1d1d; line-height: 1.4;
  cursor: pointer; transition: .12s;
}
.pp-ncr-banner:hover { background: #fee2e2; }
.pp-ncr-banner .pp-ncr-icon { font-size: 14px; flex-shrink: 0; }
.pp-ncr-banner .pp-ncr-body { flex: 1; min-width: 0; }
.pp-ncr-banner .pp-ncr-ref  { font-weight: 700; font-family: 'JetBrains Mono', monospace; }
.pp-ncr-banner .pp-ncr-desc { color: #991b1b; font-style: italic; margin-top: 2px; word-break: break-word; }
.pp-ncr-banner .pp-ncr-cta  { color: var(--red); font-weight: 600; margin-top: 2px; }
```

- [ ] **Step 2: Compute the open-QC-NCR map once per `renderProductionPlan` call**

Find this line in `renderProductionPlan()` (around line 7382):

```
  const wkData = PROD[activeProdWC] || {};
```

Replace with:

```
  const wkData    = PROD[activeProdWC] || {};
  // Build an index of open QC-raised NCRs once per render — used below to
  // inject a red banner above any pp-job that has at least one open NCR.
  const qcNcrMap  = buildQCNcrJobMap();
```

- [ ] **Step 3: Inject the banner above each affected job's `pp-job` div**

Find this block in `renderProductionPlan()` (around lines 7477-7484):

```
          return `<div class="pp-job${rowCls}" onclick="ppJobClick('${col.key}',${ji},event)" style="cursor:pointer">
            <div class="pp-job-top">
              <span class="pp-job-code">${codeLabel}</span>
              <span class="pp-job-rep">${escHtml(j.rep)}</span>
            </div>
            ${badgeHtml}
          </div>`;
        }).join('')
```

Replace with:

```
          // Per-job NCR banners — one per open QC-raised NCR. Click a
          // banner to open the CPAR summary modal; clicks must not fall
          // through to the pp-job click handler.
          const ncrItems = qcNcrMap.get(j.rep + '#' + String(j.itemNo)) || [];
          const ncrBanners = ncrItems.map(it => {
            const f = it.fields || {};
            const ref = escHtml(f.Title || '');
            const desc = escHtml((f.Description || '').slice(0, 110)) + ((f.Description || '').length > 110 ? '…' : '');
            return `<div class="pp-ncr-banner" onclick="event.stopPropagation();openCPARByRef('${ref}')" title="Open NCR ${ref}">
              <span class="pp-ncr-icon">🔴</span>
              <div class="pp-ncr-body">
                <span class="pp-ncr-ref">NCR ${ref}</span> — returned by QC
                ${desc ? `<div class="pp-ncr-desc">"${desc}"</div>` : ''}
                <div class="pp-ncr-cta">Click to open NCR ▸</div>
              </div>
            </div>`;
          }).join('');
          return `<div class="pp-job${rowCls}" onclick="ppJobClick('${col.key}',${ji},event)" style="cursor:pointer">
            ${ncrBanners}
            <div class="pp-job-top">
              <span class="pp-job-code">${codeLabel}</span>
              <span class="pp-job-rep">${escHtml(j.rep)}</span>
            </div>
            ${badgeHtml}
          </div>`;
        }).join('')
```

- [ ] **Step 4: Manual test**

1. Sign in as Weronika. Raise an NCR against a job in the current week (note REP + Job number).
2. Open Production Plan view. Find the matching prep-day column. Confirm the affected job row shows a red banner above the badge strip with: 🔴 NCR RP-XXXXX — returned by QC / "<description>" / "Click to open NCR ▸".
3. Click the banner. Confirm the CPAR summary modal opens for that NCR (and the pp-job click handler does NOT fire — i.e. the per-team status tooltip does not appear).
4. Close out the NCR via Quality view. Refresh CPAR list. Re-open Production Plan. Confirm banner is gone.
5. Raise two NCRs against the same job. Confirm two banners stack above the job card.

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "feat(qc-view): red NCR banner on Production Plan job cards"
```

---

## Task 11: Re-render Delivery + Production after submitCPAR + closeout

**Files:**
- Modify: `index.html:11315-11329` (success path of `submitCPAR`)
- Modify: `index.html:14460` (success path of `submitCPARCloseout`)

The Delivery + Production renderers compute `qcReturnSet`/`qcNcrMap` from `CPAR_ITEMS` at render-time. Currently neither view auto-re-renders when a CPAR is added or closed-out, so the visual feedback is stale until the next nav. This task plugs that hole.

- [ ] **Step 1: Re-render after raising an NCR**

Find this block in `submitCPAR()` (around lines 11324-11328):

```
    if (document.getElementById('view-issues').classList.contains('active')) renderIssuesList();

    // Update Issues tab button counter
    updateIssuesTabBadge();
```

Replace with:

```
    if (document.getElementById('view-issues').classList.contains('active')) renderIssuesList();

    // Update Issues tab button counter
    updateIssuesTabBadge();

    // Refresh visual signals if the user is currently looking at them.
    // (Delivery red stripe + Production red banner read from CPAR_ITEMS.)
    if (document.getElementById('view-loadsheet')?.classList.contains('active')) renderLoadSheet();
    if (document.getElementById('view-production')?.classList.contains('active')) renderProductionPlan();
```

- [ ] **Step 2: Re-render after closing out an NCR**

Run this grep to locate `submitCPARCloseout`:

```
grep -n 'async function submitCPARCloseout' C:/Users/jonas.simonaitis/.local/bin/index.html
```

Open the function at that line. Find the line where it updates Issues view after the PATCH succeeds (look for `renderIssuesList` near the success path, typically around line 14458-14464). Add the same two `renderLoadSheet` / `renderProductionPlan` calls immediately after the existing `renderIssuesList()` call.

If the existing code looks like:

```
    if (document.getElementById('view-issues').classList.contains('active')) renderIssuesList();
    updateIssuesTabBadge();
```

Replace with:

```
    if (document.getElementById('view-issues').classList.contains('active')) renderIssuesList();
    updateIssuesTabBadge();
    if (document.getElementById('view-loadsheet')?.classList.contains('active')) renderLoadSheet();
    if (document.getElementById('view-production')?.classList.contains('active')) renderProductionPlan();
```

If the exact lines differ, the rule is: anywhere `submitCPARCloseout` notifies the Issues view of a change, also notify Delivery + Production with the same `classList.contains('active')` guard.

- [ ] **Step 3: Manual test**

1. Open Production Plan view. Keep it open in the background.
2. Raise an NCR (QC mode → Team View → NCR button). Submit the form.
3. Without navigating away, switch back to Production Plan tab. The red banner should already be visible without manual reload. (If you raised the NCR while on Production, the page won't auto-show — the renderer guard runs only if Production was already the active view at submit time. Reload + re-open Production confirms the persistent state.)
4. Repeat for Delivery.

- [ ] **Step 4: Commit**

```
git add index.html
git commit -m "feat(qc-view): re-render Delivery + Production after CPAR raise/closeout"
```

---

## Task 12: Bump service-worker cache to v24

**Files:**
- Modify: `service-worker.js:7`

- [ ] **Step 1: Increment the cache version**

Find this line in `service-worker.js`:

```
const CACHE_VERSION = 'repnet-shell-v23';
```

Replace with:

```
const CACHE_VERSION = 'repnet-shell-v24';
```

- [ ] **Step 2: Manual test on a tablet (or simulated)**

1. Open the deployed site in a fresh Incognito window. Confirm the new service worker version is installed (DevTools → Application → Service Workers shows `repnet-shell-v24`).
2. Reload once. Confirm none of the new files (index.html with sticker modal, etc.) are stale.
3. On an actual QC tablet (or a normal browser logged in as Weronika), reload twice — first reload activates the new SW, second reload uses the new shell.

- [ ] **Step 3: Commit**

```
git add service-worker.js
git commit -m "chore(sw): bump cache to v24 for QC view + NCR feedback rollout"
```

---

## Task 13: End-to-end smoke test

This is a top-to-bottom rehearsal of the spec on a real tablet (or browser). No code changes — verification only. Mark each box as you go.

- [ ] **A. QC mode access**
   - Sign in as `weronika.hathaway@reposefurniture.co.uk`. Sidebar shows ONLY the QC team. Banner above job list reads "🔍 QC inspection mode — read-only…".

- [ ] **B. Hidden completion buttons**
   - Each job card shows ONLY the "⚠ NCR" button. No MARK / START / GLU / Serial / UH-readiness controls.

- [ ] **C. NCR raise + sticker modal**
   - Tap NCR on a job. Form opens with the SourceDept dropdown pre-selected (for jobs with a prior completion). Submit.
   - Sticker modal opens with the new RP-XXXXX in giant red monospace + handwriting instructions + Job/Issue meta. Tapping outside does NOT dismiss; tapping "Done" does.

- [ ] **D. Red Delivery stripe**
   - Switch to Delivery view. The job's REP row has a red diagonal stripe.

- [ ] **E. Red Production banner**
   - Switch to Production Plan. The same job has a red banner above the badge strip showing the NCR ref + first 110 chars of the description + "Click to open NCR ▸". Click → CPAR summary modal opens.

- [ ] **F. Closeout lifecycle**
   - As the area manager (e.g. Daniel for Upholstery), open Quality view. Find the NCR. Submit close-out with a disposition.
   - Status moves to "Pending QHSE Review". Delivery stripe turns back to orange (or white). Production banner disappears.

- [ ] **G. Returned-to-AM lifecycle**
   - As QHSE (Jonas), reject the closeout (Investigation outcome → Returned). Status becomes "Returned to Area Manager".
   - Delivery stripe turns red again. Production banner reappears.

- [ ] **H. Multi-NCR stack**
   - Raise two NCRs against the same REP+JobNo. Production Plan shows TWO stacked banners. Delivery stripe stays red.

- [ ] **I. Non-QC raises don't trigger red**
   - Sign in as a non-QC user (e.g. Sewing leader). Raise a CPAR. Delivery stays orange/white; Production has no red banner.

- [ ] **J. Empty state**
   - On a fresh CPAR list with no QC-raised NCRs, Delivery shows no red stripes anywhere and Production has no red banners. (Visual diff against pre-rollout screenshot if available.)

If any check fails, fix forward in a new commit and re-run the affected sub-test.

---

## Self-review checklist (filled at plan-time)

**Spec coverage** — each spec section maps to a task:
- QC team mode in Team View → Tasks 1-4 (helper, button gating x2, banner)
- Sticker modal → Tasks 5-6 (markup/CSS + wire submitCPAR)
- Delivery red stripe → Tasks 8-9 (predicate + CSS + render)
- Production red banner → Tasks 8 + 10 (predicate + render)
- Auto-prefill SourceDept → Task 7
- Re-render on raise/closeout → Task 11
- Cache bump → Task 12
- E2E smoke → Task 13

**Type/name consistency** — `isQCMode()`, `isOpenQCNCR()`, `extractRep7()`, `buildQCNcrRep7Set()`, `buildQCNcrJobMap()`, `findLastCompletionTeamForJob()`, `teamNameToCparSourceKey()`, `openQCStickerModal()`, `closeQCStickerModal()` are used consistently across all tasks.

**Status values** referenced (`CPAR_STATUS.OPEN`, `CPAR_STATUS.RETURNED`) match the existing enum at line 10779.

**No placeholders** — every code block contains complete code; no "TODO", no "fill in error handling", no "similar to Task X".

**Effort** — single day for a brisk pass; allow 1.5 days for visual polish and full smoke test on tablet.
