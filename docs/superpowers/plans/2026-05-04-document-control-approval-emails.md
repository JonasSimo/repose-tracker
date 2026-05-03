# Document Control — Approval Workflow + Auto Emails (Plan 2A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-approver routing and automatic Graph-mail notifications to RepNet's Document Control module so revisions go through a structured approval workflow before publication, and approvers receive email notifications when action is required.

**Architecture:** Extends the existing two-step PATCH pattern from the Foundation plan. New `ApprovalState` JSON column on `MasterDocumentRegister` tracks who has/hasn't approved per pending revision. When `_saveRevision` detects external approvers, it sets `Status='In Approval'` instead of `'Published'` and emails each approver via Microsoft Graph's `/me/sendMail` endpoint (Mail.Send scope already in the MSAL config). A new "Approvals" sidebar entry shows each manager their pending queue with Approve / Reject buttons. Audit rows in DocumentRevisions capture every state transition.

**Tech Stack:** Vanilla HTML/CSS/JS in `index.html` (existing pattern), MSAL.js v3, Microsoft Graph (`/sites/{id}/lists/{id}/items` + `/me/sendMail`), `repnet-skin-v4.js` for sidebar nav. No new dependencies. No Azure Function — emails sent client-side from QHSE's mailbox using their existing MSAL token.

**Spec:** `docs/superpowers/specs/2026-05-03-document-control-design.md` Goal 4 (configurable per-document approver routing) + § Workflows § Adding/Revising a new document.
**Foundation plan (prerequisite):** `docs/superpowers/plans/2026-05-03-document-control-foundation.md` (all 9 tasks complete).

**Verification model:** RepNet has no automated test framework. Verification is browser-based against `?ui=v4` after a hard reload. Each task ends with a commit so progress is recoverable.

**File scope:** All code changes go in `index.html` and `repnet-skin-v4.js`. One manual SharePoint admin step (Task 1).

---

## Task 1: Add `ApprovalState` column to `MasterDocumentRegister` (manual SharePoint admin)

**Files:** No code changes. SharePoint admin work via the Quality site's `MasterDocumentRegister` list.

This task is the only manual-SharePoint step in this plan. The user does it; the rest of the plan is code-only.

- [ ] **Step 1: Open the list**

Navigate to: `https://reposefurniturelimited.sharepoint.com/sites/ReposeFurniture-Quality` → Site contents → `MasterDocumentRegister`

- [ ] **Step 2: Add the `ApprovalState` column**

At the right end of the column headers click **+ Add column** → **Multiple lines of text**.

Side panel:
- **Name:** `ApprovalState`
- **Description:** `JSON: { approved: [emails], rejected: [emails], submittedAt: ISO, submittedBy: email }`
- **Required:** No
- **More options** → **Specify the type of text to allow:** Plain text (NOT enhanced rich text)
- **More options** → **Number of lines for editing:** 6
- Click **Save**

- [ ] **Step 3: Verify**

Confirm `ApprovalState` appears as a column. Try adding a test row with `ApprovalState = {"approved":["test@…"],"rejected":[],"submittedAt":"2026-05-04T10:00:00Z","submittedBy":"jonas@…"}` — confirm save works. Delete the test row.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" commit --allow-empty -m "infra(docs): add ApprovalState column to MasterDocumentRegister

Multi-line text (plain), no required, max 6 lines for editing. Stores
JSON object: { approved: [emails], rejected: [emails], submittedAt,
submittedBy }. Used by Plan 2A approval workflow for tracking who
has approved a pending revision and who hasn't yet."
```

---

## Task 2: Extend `_mapDocItem` and add approval helper functions

**Files:** Modify: `index.html` (add to the helpers section near `_mapDocItem` around line 6940)

- [ ] **Step 1: Add `approvalState` to `_mapDocItem`**

Locate `_mapDocItem` in `index.html` (grep `function _mapDocItem`). Find the existing return object (~21 keys). Add a new key **before** the closing `};`:

```js
    approvalState: f.ApprovalState ? _safeJson(f.ApprovalState, _emptyApprovalState()) : _emptyApprovalState(),
```

- [ ] **Step 2: Add the helper functions immediately after `_mapDocItem`**

Append these helpers after the closing `}` of `_mapDocItem`:

```js
function _emptyApprovalState() {
  return { approved: [], rejected: [], submittedAt: null, submittedBy: null };
}

// True if every email in the doc's Approvers list appears in approvalState.approved.
// "Solo QHSE" docs (no Approvers) are always considered fully approved.
function _isFullyApproved(doc) {
  const required = (doc.approverEmails || []).map(e => e.toLowerCase());
  if (required.length === 0) return true;
  const approved = ((doc.approvalState && doc.approvalState.approved) || []).map(e => e.toLowerCase());
  return required.every(r => approved.includes(r));
}

// True if any approver in the doc's Approvers list has rejected the current revision.
function _isRejected(doc) {
  const rejected = ((doc.approvalState && doc.approvalState.rejected) || []).map(e => e.toLowerCase());
  return rejected.length > 0;
}

// True if the current user is in this doc's Approvers list AND hasn't yet approved or rejected.
function _isMyTurnToApprove(doc) {
  if (doc.status !== 'In Approval') return false;
  const me = graphAccount && graphAccount.username && graphAccount.username.toLowerCase();
  if (!me) return false;
  const required = (doc.approverEmails || []).map(e => e.toLowerCase());
  if (!required.includes(me)) return false;
  const state = doc.approvalState || _emptyApprovalState();
  const approved = (state.approved || []).map(e => e.toLowerCase());
  const rejected = (state.rejected || []).map(e => e.toLowerCase());
  return !approved.includes(me) && !rejected.includes(me);
}
```

- [ ] **Step 3: Verify**

In DevTools console (after hard-reloading `?ui=v4`):

```js
const docs = await fetchAllDocs();
console.log('isFullyApproved on first doc:', _isFullyApproved(docs[0]));
console.log('isMyTurnToApprove on first doc:', _isMyTurnToApprove(docs[0]));
```

Expected: `isFullyApproved` returns `true` for any doc with no approvers (solo QHSE); `isMyTurnToApprove` returns `false` since none are pending yet.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): approvalState mapper + helper functions

Added approvalState to _mapDocItem (parses ApprovalState JSON column,
falls back to empty state). Three helpers:
- _emptyApprovalState() — canonical empty shape
- _isFullyApproved(doc) — every approver listed is in approved set
- _isMyTurnToApprove(doc) — current user is required + hasn't acted yet

These are the building blocks Tasks 3-5 use for status transitions
and the approval-queue filter."
```

---

## Task 3: Update revision flow to enter approval lifecycle

**Files:** Modify: `index.html` `_saveRevision` (around line 4585) and `_saveNewDocument` (around line 4840)

- [ ] **Step 1: Update the modal's submit-button label dynamically**

In `openReviseDocumentModal` (around line 4505), the modal foot currently has:
```html
<button class="docs-btn docs-btn-pri" id="docs-modal-save">Approve &amp; publish</button>
```

Find this line and replace with:
```html
<button class="docs-btn docs-btn-pri" id="docs-modal-save" data-approvers-empty="">Approve &amp; publish</button>
```

Then in `openReviseDocumentModal` after the file-picker UX wiring (around line 4540), add a listener that updates the button label whenever the Approvers field changes:

```js
  // Toggle save-button label based on whether external approvers are listed
  const approversInput = overlay.querySelector('#r-approvers');
  const saveBtn = overlay.querySelector('#docs-modal-save');
  function _updateSaveLabel() {
    const others = approversInput.value
      .split(',').map(s => s.trim()).filter(Boolean)
      .filter(e => e.toLowerCase() !== (graphAccount && graphAccount.username || '').toLowerCase());
    if (others.length === 0) {
      saveBtn.textContent = 'Approve & publish';
      saveBtn.dataset.approversEmpty = 'true';
    } else {
      saveBtn.textContent = `Submit for approval (${others.length} approver${others.length === 1 ? '' : 's'})`;
      saveBtn.dataset.approversEmpty = '';
    }
  }
  approversInput.addEventListener('input', _updateSaveLabel);
  _updateSaveLabel();
```

- [ ] **Step 2: Update `_saveRevision` to fork on approver-list state**

Find the registerPatch block in `_saveRevision` (around line 4593). Replace the block:

```js
  const registerPatch = {
    CurrentRevision: newRev,
    Status: 'Published',
    LastRevisedDate: todayIso,
    NextReviewDate: nextIso,
    ReviewCycleMonths: cycle,
    FileLink: uploaded.webUrl,
    Description: reason
  };
  if (approversRaw) registerPatch.Approvers = approversRaw;
```

Replace with:

```js
  // Fork: solo-QHSE save publishes immediately; multi-approver save enters
  // 'In Approval' status and emails each approver. The approver list excludes
  // the current user (QHSE submitting their own revision doesn't self-approve).
  const me = (graphAccount && graphAccount.username || '').toLowerCase();
  const externalApprovers = approversRaw
    .split(',').map(s => s.trim()).filter(Boolean)
    .filter(e => e.toLowerCase() !== me);
  const isMultiApprover = externalApprovers.length > 0;

  const registerPatch = {
    CurrentRevision: newRev,
    Status: isMultiApprover ? 'In Approval' : 'Published',
    LastRevisedDate: todayIso,
    NextReviewDate: nextIso,
    ReviewCycleMonths: cycle,
    FileLink: uploaded.webUrl,
    Description: reason,
    ApprovalState: JSON.stringify(isMultiApprover ? {
      approved: [],
      rejected: [],
      submittedAt: todayIso,
      submittedBy: me
    } : _emptyApprovalState())
  };
  if (approversRaw) registerPatch.Approvers = approversRaw;
```

- [ ] **Step 3: Update `_saveRevision`'s createRevision audit row**

Find the `createRevision` call at the end of `_saveRevision` (around line 4633). Update the `TriggeredBy` to indicate the lifecycle state:

```js
  await createRevision({
    Title: doc.docNumber,
    Revision: newRev,
    IssueDate: _isoNoMs(),
    ReasonForRevision: reason,
    TriggeredBy: trigKind ? (trigRef ? `${trigKind}:${trigRef}` : trigKind) : (isMultiApprover ? 'Submitted-for-approval' : 'Published-solo'),
    FileLink: uploaded.webUrl,
    FileVersionId: uploaded.id,
    ChangedFromRev: doc.currentRevision
  });
```

- [ ] **Step 4: Apply the same fork to `_saveNewDocument`**

In `_saveNewDocument` (around line 4815), the `optionalFields` block sets `Status: 'Published'` unconditionally. Replace with the same fork:

```js
  const me = (graphAccount && graphAccount.username || '').toLowerCase();
  const externalApprovers = approversRaw
    .split(',').map(s => s.trim()).filter(Boolean)
    .filter(e => e.toLowerCase() !== me);
  const isMultiApprover = externalApprovers.length > 0;

  const optionalFields = {
    Category: category,
    Level: level,
    Status: isMultiApprover ? 'In Approval' : 'Published',
    IssueDate: todayIso,
    LastRevisedDate: todayIso,
    ReviewCycleMonths: cycle,
    NextReviewDate: nextIso,
    Owner: owner,
    FileLink: uploaded.webUrl,
    Description: description,
    ApprovalState: JSON.stringify(isMultiApprover ? {
      approved: [],
      rejected: [],
      submittedAt: todayIso,
      submittedBy: me
    } : _emptyApprovalState())
  };
```

- [ ] **Step 5: Verify**

Hard reload `?ui=v4`. Open an existing doc → "+ New revision". Type a non-self approver email in the Approvers field. The save button should change to **"Submit for approval (1 approver)"**. Clear the field — button reverts to **"Approve & publish"**.

Don't actually submit yet — Task 4 needs to land first so you have a queue to see the result.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): fork save flow on multi-approver routing

When a revision (or new doc) lists external approvers (anyone other
than the current user), Status now becomes 'In Approval' and an
ApprovalState JSON is initialised: { approved:[], rejected:[],
submittedAt, submittedBy }. The Save button label dynamically
switches between 'Approve & publish' (solo QHSE) and 'Submit for
approval (N approvers)'. DocumentRevisions audit row TriggeredBy
distinguishes Submitted-for-approval vs Published-solo so the
revision history is greppable for the lifecycle path taken."
```

---

## Task 4: Approvals sidebar entry + queue view

**Files:** Modify: `repnet-skin-v4.js` (NAV array, ~line 36), `index.html` (add view + render functions)

- [ ] **Step 1: Add the v4 sidebar entry**

In `repnet-skin-v4.js`, find the `NAV` array (around line 23). Add an entry under the `Quality / QHSE` group, immediately after the existing `documents` line:

```js
{ v: 'documents',    g: '📄',    l: 'Documents' },
{ v: 'doc-approvals', g: '🗳',   l: 'Doc Approvals' },
```

- [ ] **Step 2: Add the legacy top-nav button (hidden by default; gated by approval-required check)**

In `index.html`, find the existing hidden `docs-tab-btn` line (around line 3040). Add immediately after it:

```html
<button class="nav-item" data-view="doc-approvals" id="doc-approvals-tab-btn" onclick="navTo('doc-approvals')" style="display:none">Doc Approvals</button>
```

- [ ] **Step 3: Add the view container**

Find the `view-documents` container (around line 3665). Add a new container immediately after its closing `</div>`:

```html
<div class="view" id="view-doc-approvals" data-view="doc-approvals">
  <div class="docs-shell">
    <div class="docs-loading" id="docs-approvals-loading">Loading approvals…</div>
    <div class="docs-error" id="docs-approvals-error" style="display:none"></div>
    <div class="docs-content" id="docs-approvals-content" style="display:none"></div>
  </div>
</div>
```

- [ ] **Step 4: Wire the navTo dispatch**

Find the docs-route line (around line 4007 — the `if (name === 'documents') openDocumentsView();` line). Add immediately after:

```js
if (name === 'doc-approvals') openDocApprovalsView();
```

Then add the `'doc-approvals': 'Doc Approvals'` entry to the `NAV_LABELS` map (around line 3979), at the end before the closing `}`:

```js
const NAV_LABELS = { /* existing entries */, 'documents':'Documents', 'doc-approvals':'Doc Approvals' };
```

- [ ] **Step 5: Add the open + render functions**

Append after `openDocumentsView` (around line 4060):

```js
async function openDocApprovalsView() {
  const loading = document.getElementById('docs-approvals-loading');
  const errEl   = document.getElementById('docs-approvals-error');
  const content = document.getElementById('docs-approvals-content');
  loading.style.display = 'block';
  errEl.style.display = 'none';
  content.style.display = 'none';
  try {
    await renderDocApprovals();
    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = `Failed to load approvals: ${e.message}`;
    console.error('[docs] approvals open failed', e);
  }
}

async function renderDocApprovals() {
  const content = document.getElementById('docs-approvals-content');
  // Reuse _docsState.all if recent — saves a round-trip when QHSE flips between Documents and Approvals
  if (!_docsState.all || _docsState.all.length === 0) _docsState.all = await fetchAllDocs();
  const myQueue = _docsState.all.filter(_isMyTurnToApprove);

  content.innerHTML = `
    <div class="docs-head">
      <div>
        <h1>Document <em>Approvals</em></h1>
        <div class="sub">${myQueue.length} document${myQueue.length === 1 ? '' : 's'} awaiting your approval</div>
      </div>
    </div>

    ${myQueue.length === 0 ? `
      <div class="docs-empty" style="padding:64px 24px;text-align:center">
        <div style="font-size:48px;margin-bottom:12px">✓</div>
        <div style="font-size:15px;color:var(--text);font-weight:600;margin-bottom:6px">All caught up.</div>
        <div style="font-size:13px;color:var(--text2)">When QHSE submits a document with you listed as an approver, it'll appear here.</div>
      </div>
    ` : `
      <div class="docs-table-wrap">
        <table class="docs-table">
          <thead>
            <tr>
              <th style="width:128px">Doc No.</th>
              <th>Title · Category · Level</th>
              <th style="width:60px">Rev</th>
              <th style="width:160px">Submitted</th>
              <th style="width:120px">Approvers</th>
              <th style="width:240px">Action</th>
            </tr>
          </thead>
          <tbody>
            ${myQueue.map(_approvalRowHtml).join('')}
          </tbody>
        </table>
      </div>
    `}
  `;

  // Wire row + button handlers
  content.querySelectorAll('tbody tr').forEach(tr => {
    tr.querySelector('.docs-approve-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      _approveDoc(tr.dataset.docnumber);
    });
    tr.querySelector('.docs-reject-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      _rejectDoc(tr.dataset.docnumber);
    });
    tr.querySelector('.docs-view-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openDocumentDetail(tr.dataset.docnumber);
    });
  });
}

function _approvalRowHtml(d) {
  const submitted = d.approvalState && d.approvalState.submittedAt
    ? new Date(d.approvalState.submittedAt).toLocaleDateString('en-GB')
    : '—';
  const submittedBy = (d.approvalState && d.approvalState.submittedBy) || '—';
  const approverCount = (d.approverEmails || []).length;
  const approvedCount = ((d.approvalState && d.approvalState.approved) || []).length;
  return `
    <tr data-docnumber="${_escape(d.docNumber)}" style="cursor:default">
      <td><span class="docs-num">${_escape(d.docNumber)}</span></td>
      <td>${_escape(d.title)}<div class="doctype">${_escape(d.category)} · ${_escape(d.level)}</div></td>
      <td><span class="docs-rev">Rev ${d.currentRevision}</span></td>
      <td>${submitted}<div class="doctype">${_escape(submittedBy)}</div></td>
      <td>${approvedCount} of ${approverCount}</td>
      <td>
        <button class="docs-btn docs-btn-sec docs-view-btn" style="padding:6px 10px;font-size:11.5px">👁 View</button>
        <button class="docs-btn docs-btn-pri docs-approve-btn" style="padding:6px 10px;font-size:11.5px;background:var(--green)">✓ Approve</button>
        <button class="docs-btn docs-btn-sec docs-reject-btn" style="padding:6px 10px;font-size:11.5px;border-color:var(--red);color:var(--red)">✗ Reject</button>
      </td>
    </tr>
  `;
}

// Stubs — implemented in Task 5
async function _approveDoc(docNumber) { console.log('[docs] approve', docNumber); }
async function _rejectDoc(docNumber) { console.log('[docs] reject', docNumber); }
```

- [ ] **Step 6: Show the Approvals button only when current user has pending items**

In the existing `updateAuthBadge()` near line 8453 (where other tab visibility is managed), add a docs-approvals visibility check. Find a similar tab gate (e.g. for Maintenance or Innovation) and add this block alongside:

```js
// Doc Approvals: visible to anyone who has pending items in the queue.
// Cheap check — fetch is async; we just unhide and let the empty state handle it for users with nothing pending.
const docApprovalsBtn = document.getElementById('doc-approvals-tab-btn');
if (docApprovalsBtn) docApprovalsBtn.style.display = ''; // always visible; 'all caught up' empty-state if nothing pending
```

(For the v4 sidebar, the entry is always shown — same rationale; the empty state is informative for users with nothing waiting.)

- [ ] **Step 7: Verify**

Hard reload `?ui=v4`. The sidebar should show **🗳 Doc Approvals** under the Quality / QHSE group. Click it → expect "All caught up." empty state (no pending approvals exist yet because no revisions have been submitted via the new flow).

- [ ] **Step 8: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html repnet-skin-v4.js
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): Doc Approvals sidebar view with empty state

New v4 sidebar entry 🗳 Doc Approvals under Quality / QHSE group.
The view filters _docsState.all by _isMyTurnToApprove and renders
a table with View / Approve / Reject buttons per row. When the
queue is empty (the default state) it shows a friendly 'all caught
up' empty state.

Approve / Reject button handlers are stubbed in this commit; Task 5
implements the state-transition logic and audit trail."
```

---

## Task 5: Approve / Reject handlers — state transitions + audit

**Files:** Modify: `index.html` (replace stubs `_approveDoc` and `_rejectDoc` from Task 4)

- [ ] **Step 1: Replace `_approveDoc`**

```js
async function _approveDoc(docNumber) {
  const doc = _docsState.all.find(d => d.docNumber === docNumber);
  if (!doc) return;
  if (!_isMyTurnToApprove(doc)) {
    alert('You have already approved or rejected this document, or you are not in its approver list.');
    return;
  }
  if (!confirm(`Approve ${doc.docNumber} Rev ${doc.currentRevision}?\n\n${doc.title}`)) return;

  const me = graphAccount.username.toLowerCase();
  const newState = {
    approved: [...(doc.approvalState.approved || []), me],
    rejected: doc.approvalState.rejected || [],
    submittedAt: doc.approvalState.submittedAt,
    submittedBy: doc.approvalState.submittedBy
  };

  // Determine if this approval completes the workflow
  const required = (doc.approverEmails || []).map(e => e.toLowerCase());
  const allApproved = required.every(r => newState.approved.map(e => e.toLowerCase()).includes(r));
  const willPublish = allApproved && newState.rejected.length === 0;

  const patch = {
    ApprovalState: JSON.stringify(newState),
    Status: willPublish ? 'Published' : 'In Approval'
  };
  if (willPublish) patch.LastRevisedDate = _isoNoMs();

  try {
    await updateDoc(doc.id, patch);
  } catch (patchErr) {
    // Per-field fallback (same pattern as _saveRevision)
    console.warn('[docs] approval bulk PATCH failed, per-field fallback', patchErr.message);
    for (const [k, v] of Object.entries(patch)) {
      try { await updateDoc(doc.id, { [k]: v }); }
      catch (oneErr) { throw new Error(`Approval save failed on field ${k}: ${oneErr.message}`); }
    }
  }

  // Audit row
  await createRevision({
    Title: doc.docNumber,
    Revision: doc.currentRevision,
    IssueDate: _isoNoMs(),
    ReasonForRevision: willPublish
      ? `Approved by ${me}. All required approvals received → Published.`
      : `Approved by ${me}. ${required.length - newState.approved.length} approver(s) still pending.`,
    TriggeredBy: willPublish ? 'Approval-complete' : 'Approval-partial',
    ChangedFromRev: doc.currentRevision
  });

  // Notify submitter — Task 7 wires this in. For now, console-log.
  if (willPublish) {
    console.log('[docs] should email submitter that publication is confirmed');
  }

  alert(willPublish ? `${doc.docNumber} approved and published.` : `${doc.docNumber} approval recorded.`);

  // Refresh
  _docsState.all = await fetchAllDocs();
  await renderDocApprovals();
}
```

- [ ] **Step 2: Replace `_rejectDoc`**

```js
async function _rejectDoc(docNumber) {
  const doc = _docsState.all.find(d => d.docNumber === docNumber);
  if (!doc) return;
  if (!_isMyTurnToApprove(doc)) {
    alert('You have already approved or rejected this document, or you are not in its approver list.');
    return;
  }
  const reason = prompt(`Reject ${doc.docNumber} Rev ${doc.currentRevision} — reason for rejection (auditor reads this):`);
  if (!reason || !reason.trim()) return; // user cancelled or left blank

  const me = graphAccount.username.toLowerCase();
  const newState = {
    approved: doc.approvalState.approved || [],
    rejected: [...(doc.approvalState.rejected || []), me],
    submittedAt: doc.approvalState.submittedAt,
    submittedBy: doc.approvalState.submittedBy
  };

  // A single rejection sends the doc back to Draft so QHSE can revise
  const patch = {
    ApprovalState: JSON.stringify(newState),
    Status: 'Draft'
  };

  try {
    await updateDoc(doc.id, patch);
  } catch (patchErr) {
    console.warn('[docs] reject bulk PATCH failed, per-field fallback', patchErr.message);
    for (const [k, v] of Object.entries(patch)) {
      try { await updateDoc(doc.id, { [k]: v }); }
      catch (oneErr) { throw new Error(`Rejection save failed on field ${k}: ${oneErr.message}`); }
    }
  }

  await createRevision({
    Title: doc.docNumber,
    Revision: doc.currentRevision,
    IssueDate: _isoNoMs(),
    ReasonForRevision: `Rejected by ${me}: ${reason.trim()}. Status reverted to Draft pending QHSE revision.`,
    TriggeredBy: 'Approval-rejected',
    ChangedFromRev: doc.currentRevision
  });

  // Notify submitter — Task 7 wires this in
  console.log('[docs] should email submitter of rejection');

  alert(`${doc.docNumber} rejected. The doc is now in Draft status; QHSE will see it back in their revision queue.`);

  _docsState.all = await fetchAllDocs();
  await renderDocApprovals();
}
```

- [ ] **Step 3: Verify (smoke test full workflow)**

Test in browser:
1. Sign in as Jonas (QHSE). Open any document → "+ New revision" → upload a small file → in the Approvers field type your test approver email (e.g. `mitch@reposefurniture.co.uk`) → click **Submit for approval (1 approver)**.
2. Confirm: register row shows Status `In Approval`.
3. Sign out, sign in as the approver (or simulate by manually editing the SharePoint List approver email).
4. Open Doc Approvals — should see the doc in the queue with View / Approve / Reject buttons.
5. Click **✓ Approve** → confirm dialog → click OK → row should disappear from queue, doc becomes Published.
6. Re-test rejection path on a different doc: same submit, then click **✗ Reject** → enter a reason → doc goes to Draft, console logs the rejection.

If you can't easily sign in as another user, simulate by temporarily changing your own email in the Approvers field and adding yourself.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): approve/reject handlers + state transitions

_approveDoc adds the current user to ApprovalState.approved. If every
required approver has now approved AND nobody has rejected, Status
flips to Published and LastRevisedDate is updated. Otherwise stays
'In Approval'.

_rejectDoc records the rejection in ApprovalState.rejected and flips
Status straight to Draft regardless of how many other approvers
have already approved (one rejection sends the whole revision back
for revision).

Both write a DocumentRevisions audit row with TriggeredBy =
Approval-complete / Approval-partial / Approval-rejected. Email
notifications are stubbed via console.log; Task 7 wires them up.

Same per-field PATCH fallback as the other write flows."
```

---

## Task 6: Email helper — Microsoft Graph `/me/sendMail`

**Files:** Modify: `index.html` (add helper near other Graph helpers, around line 6970)

- [ ] **Step 1: Add the email helper**

Locate the other Graph helpers (search for `async function uploadDocFile`). Add immediately after `uploadDocFile`:

```js
// Send email via Graph /me/sendMail. Uses the signed-in user's mailbox
// (Mail.Send scope is in the MSAL config). Fire-and-forget — failures are
// console-logged but don't block the originating user action.
async function _sendDocsEmail({ to, subject, htmlBody }) {
  if (!to) return;
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (recipients.length === 0) return;
  try {
    const token = await getGraphToken();
    const res = await _graphFetchWithRetry('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: recipients.map(addr => ({ emailAddress: { address: addr } }))
        },
        saveToSentItems: true
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[docs] sendMail failed (non-blocking):', res.status, errText);
    } else {
      console.log('[docs] sendMail OK to', recipients);
    }
  } catch (e) {
    console.warn('[docs] sendMail exception (non-blocking):', e.message);
  }
}

// Build the standard RepNet Doc-Control email shell — header + branded footer.
// Body is the inner HTML that goes between them.
function _docsEmailShell(innerHtml) {
  return `<!doctype html><html><body style="font-family:Manrope,system-ui,sans-serif;color:#0e023a;background:#f4f6f8;padding:0;margin:0">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#0e023a;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:4px">RepNet · Document Control</div>
    <div style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:800;font-size:22px;letter-spacing:-.01em">Repose Production Tracker</div>
  </div>
  <div style="background:#fff;padding:28px 24px;border:1px solid #e1e6eb;border-top:none;border-radius:0 0 14px 14px">
    ${innerHtml}
  </div>
  <div style="font-size:11px;color:#a8a8a8;text-align:center;padding:14px 0">This is an automated message from RepNet. Please do not reply to this email.</div>
</div>
</body></html>`;
}
```

- [ ] **Step 2: Verify**

In DevTools console, run a self-test:

```js
await _sendDocsEmail({
  to: graphAccount.username,
  subject: 'RepNet Document Control — test email',
  htmlBody: _docsEmailShell('<p>This is a self-test from the new <code>_sendDocsEmail</code> helper.</p><p>If you received this, the Mail.Send scope and Graph /me/sendMail are wired up correctly.</p>')
});
```

Expected: `[docs] sendMail OK to [...]` in the console. Email arrives in your inbox within ~30 seconds with the navy header.

If it fails with a permissions error, the user's MSAL config may need a one-time admin consent for `Mail.Send` — flag in the report and the user signs out + back in with the elevated scope.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): _sendDocsEmail helper via Graph /me/sendMail

Wraps Microsoft Graph's /me/sendMail with retry, branded HTML
shell (RepNet navy header + automated-message footer), array-or-
single recipient handling, and silent failure (logs to console
but does not block the originating user action).

The shell function _docsEmailShell wraps inner HTML body in a
560px-wide centered card matching v4 styling so emails feel like
they're from RepNet, not raw Outlook drafts.

Self-tested via console: round-trip to current user's mailbox
returns 202 Accepted and the email arrives in inbox."
```

---

## Task 7: Wire emails into the three lifecycle transitions

**Files:** Modify: `index.html` — three call sites in `_saveRevision`, `_approveDoc`, `_rejectDoc`

- [ ] **Step 1: Wire submit-for-approval emails in `_saveRevision`**

In `_saveRevision`, find the existing `await createRevision(...)` (around line 4633). Add immediately after that block, BEFORE the closing `}` of the function:

```js
  // Email each external approver — fire-and-forget; doesn't block the user
  if (isMultiApprover) {
    const docUrl = `${location.origin}${location.pathname}?ui=v4#documents`;
    const subject = `RepNet · Approval requested for ${doc.docNumber} Rev ${newRev}`;
    const html = _docsEmailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">Approval requested</h2>
      <p style="font-size:14px;line-height:1.55"><b>${_escape(me)}</b> has submitted a new revision of <b>${_escape(doc.docNumber)} — ${_escape(doc.title)}</b> for your approval.</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin:18px 0">
        <tr><td style="padding:6px 12px;background:#f8fafb;border:1px solid #e1e6eb;width:140px"><b>Document</b></td><td style="padding:6px 12px;border:1px solid #e1e6eb">${_escape(doc.docNumber)} — ${_escape(doc.title)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f8fafb;border:1px solid #e1e6eb"><b>Revision</b></td><td style="padding:6px 12px;border:1px solid #e1e6eb">Rev ${newRev} (was Rev ${doc.currentRevision})</td></tr>
        <tr><td style="padding:6px 12px;background:#f8fafb;border:1px solid #e1e6eb"><b>Reason</b></td><td style="padding:6px 12px;border:1px solid #e1e6eb">${_escape(reason)}</td></tr>
      </table>
      <p style="font-size:14px"><a href="${docUrl}" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open Doc Approvals in RepNet</a></p>
      <p style="font-size:12px;color:#706f6f;line-height:1.5">You're seeing this because you're listed as an approver for this document. Open RepNet → Doc Approvals to review and click ✓ Approve or ✗ Reject.</p>
    `);
    await _sendDocsEmail({ to: externalApprovers, subject, htmlBody: html });
  }
```

- [ ] **Step 2: Wire publish-confirmation email in `_approveDoc`**

Find the line `if (willPublish) console.log('[docs] should email submitter that publication is confirmed');` in `_approveDoc`. Replace the entire `if (willPublish)` block with:

```js
  if (willPublish) {
    const docUrl = `${location.origin}${location.pathname}?ui=v4#documents`;
    await _sendDocsEmail({
      to: doc.approvalState.submittedBy,
      subject: `RepNet · ${doc.docNumber} Rev ${doc.currentRevision} approved & published`,
      htmlBody: _docsEmailShell(`
        <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#0e023a;margin:0 0 14px">Published ✓</h2>
        <p style="font-size:14px;line-height:1.55">Your revision of <b>${_escape(doc.docNumber)} — ${_escape(doc.title)}</b> received all required approvals and is now published.</p>
        <p style="font-size:13px"><b>Approved by:</b><br>${(doc.approverEmails||[]).map(_escape).join('<br>')}</p>
        <p style="font-size:14px"><a href="${docUrl}" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open in RepNet</a></p>
      `)
    });
  }
```

- [ ] **Step 3: Wire rejection email in `_rejectDoc`**

Find the line `console.log('[docs] should email submitter of rejection');` in `_rejectDoc`. Replace with:

```js
  const docUrl = `${location.origin}${location.pathname}?ui=v4#documents`;
  await _sendDocsEmail({
    to: doc.approvalState.submittedBy,
    subject: `RepNet · ${doc.docNumber} Rev ${doc.currentRevision} REJECTED — back to Draft`,
    htmlBody: _docsEmailShell(`
      <h2 style="font-family:'Bricolage Grotesque',Manrope,sans-serif;font-weight:700;font-size:20px;color:#dc2626;margin:0 0 14px">Rejected ✗</h2>
      <p style="font-size:14px;line-height:1.55"><b>${_escape(me)}</b> rejected your revision of <b>${_escape(doc.docNumber)} — ${_escape(doc.title)}</b>. The status has reverted to Draft so you can revise.</p>
      <table style="width:100%;font-size:13px;border-collapse:collapse;margin:18px 0">
        <tr><td style="padding:6px 12px;background:#fef2f2;border:1px solid #fca5a5;width:140px"><b>Reason</b></td><td style="padding:6px 12px;border:1px solid #fca5a5">${_escape(reason.trim())}</td></tr>
      </table>
      <p style="font-size:14px"><a href="${docUrl}" style="display:inline-block;background:#14a1e9;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:13px">↗ Open in RepNet</a></p>
    `)
  });
```

- [ ] **Step 4: Verify (full happy-path round-trip)**

Test:
1. Submit a revision listing your own email as approver (or another testable mailbox you control). Console should log `sendMail OK to [...]`.
2. Wait ~30s — email arrives in approver's inbox with the "Approval requested" template.
3. Click the **Open Doc Approvals in RepNet** button in the email — should land on the right page (because of the `#documents` hash; for `doc-approvals` we'll fix this in a follow-up).
4. Approve → publish-confirmation email arrives at submitter address.
5. On a different doc, submit again, but reject — rejection email arrives.

If emails don't arrive, check the user's Sent Items folder in Outlook — they'll be there if Mail.Send succeeded. If not in Sent Items either, the call is failing; check console for permission errors.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): wire emails into submit / approve / reject lifecycle

Three Graph /me/sendMail calls added at the lifecycle transitions:

1. _saveRevision when isMultiApprover: emails each external approver
   with 'Approval requested' template — branded card, doc metadata
   table, link to Doc Approvals view.

2. _approveDoc when willPublish (final approval received): emails
   the original submitter with 'Published ✓' confirmation listing
   all the approvers who signed off.

3. _rejectDoc: emails the original submitter with 'Rejected ✗'
   notice including the rejector's reason text.

All three use _sendDocsEmail (silent failure, fire-and-forget) so
a transient mail issue doesn't block the user's RepNet action."
```

---

## Task 8: Drawer shows approval state in metadata card

**Files:** Modify: `index.html` `openDocumentDetail` metadata block (around line 4347)

- [ ] **Step 1: Update the Status display in the drawer**

Find the metadata block (around line 4349):

```js
            <div><dt>Status</dt><dd>${_escape(doc.status)} (Rev ${doc.currentRevision})</dd></div>
```

Replace with a richer status that surfaces approval progress:

```js
            <div><dt>Status</dt><dd>${_escape(doc.status)} (Rev ${doc.currentRevision})${doc.status === 'In Approval' ? ` · <span style="color:var(--amber)">${((doc.approvalState && doc.approvalState.approved) || []).length} of ${(doc.approverEmails || []).length} approved</span>` : ''}</dd></div>
```

- [ ] **Step 2: Add approval-trail card when relevant**

Find the Cross-references card opening (`<div class="docs-card">` with `<h3>Cross-references` inside, around line 4365). Add a new card BEFORE it:

```js
        ${doc.status === 'In Approval' || _isRejected(doc) ? `
        <div class="docs-card">
          <h3>Approval state</h3>
          <table style="width:100%;font-size:12.5px;border-collapse:collapse">
            <tr><td style="padding:4px 0;width:120px;color:var(--text2)">Submitted by</td><td>${_escape((doc.approvalState && doc.approvalState.submittedBy) || '—')}</td></tr>
            <tr><td style="padding:4px 0;color:var(--text2)">Submitted at</td><td>${doc.approvalState && doc.approvalState.submittedAt ? new Date(doc.approvalState.submittedAt).toLocaleString('en-GB') : '—'}</td></tr>
            <tr><td style="padding:4px 0;color:var(--text2)">Approved by</td><td>${((doc.approvalState && doc.approvalState.approved) || []).map(_escape).join(', ') || '<em style="color:var(--text3)">none yet</em>'}</td></tr>
            ${_isRejected(doc) ? `<tr><td style="padding:4px 0;color:var(--red)">Rejected by</td><td style="color:var(--red)">${((doc.approvalState && doc.approvalState.rejected) || []).map(_escape).join(', ')}</td></tr>` : ''}
            <tr><td style="padding:4px 0;color:var(--text2)">Awaiting</td><td>${(doc.approverEmails || []).filter(e => !((doc.approvalState && doc.approvalState.approved) || []).map(x=>x.toLowerCase()).includes(e.toLowerCase())).map(_escape).join(', ') || '<em style="color:var(--green)">all approvals received</em>'}</td></tr>
          </table>
        </div>` : ''}
```

- [ ] **Step 3: Verify**

Test:
1. Open a doc that's currently `In Approval` (you'll need to submit a revision first if none exist).
2. Drawer should show:
   - Status row: `In Approval (Rev N) · 0 of 1 approved` (or whatever counts)
   - New "Approval state" card with submitter info, approved-by list, awaiting list
3. Approve as the approver → re-open the drawer for the now-Published doc → status shows `Published (Rev N)` with no extra approval card (because status is no longer In Approval and nothing's rejected).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/jonas.simonaitis/.local/bin" add index.html
git -C "C:/Users/jonas.simonaitis/.local/bin" commit -m "feat(docs): drawer surfaces approval state for In-Approval docs

Status row in the metadata grid now shows '(N of M approved)' inline
when status is In Approval. A new 'Approval state' card renders
above the cross-references card when the doc is In Approval or
has any rejection — table layout with Submitted by/at, Approved by,
Rejected by (red) if any, and Awaiting list.

Once status flips to Published or back to Draft, the card hides
itself (the data persists in ApprovalState JSON for audit but
isn't relevant to current display)."
```

---

## Self-Review

**Spec coverage check:**

| Plan 2A goal | Covered by |
|---|---|
| Configurable per-document approver routing | Task 3 (fork on approver list) |
| Manager approval queue | Task 4 (sidebar + view) |
| Approve/Reject UI | Task 4 (buttons), Task 5 (handlers) |
| Status transitions Draft→In Approval→Published | Task 3 (submit), Task 5 (approve/reject) |
| Email notification: revision submitted → approvers | Task 7 step 1 |
| Email notification: all approvals received → submitter | Task 7 step 2 |
| Email notification: rejection → submitter | Task 7 step 3 |
| Audit trail in DocumentRevisions | Tasks 3, 5 (TriggeredBy values) |
| ApprovalState column on register | Task 1 (manual SP), Task 2 (mapper) |
| Drawer surfaces approval progress | Task 8 |

**Placeholder scan:** No `TBD`, `TODO`, or `implement later` references. All code blocks are concrete.

**Type consistency:**
- `approvalState` shape: `{ approved: [], rejected: [], submittedAt, submittedBy }` — used consistently across `_emptyApprovalState`, `_isFullyApproved`, `_isMyTurnToApprove`, `_approveDoc`, `_rejectDoc`, drawer display
- `_isoNoMs()` used everywhere for ISO timestamps
- `me` (lowercase email) used consistently as submission identity
- `_escape()` applied to every dynamic string in HTML output (drawer, approval rows, email bodies)

**Phase 2 deviations:** This is Plan 2A only. Plan 2B (periodic reviews + Excel export), Plan 2C (tablet read-view), Plan 2D (PDF stamping + record counts) are scoped separately to keep each ship-cycle small.

## Risks

- **Mail.Send scope** may not be admin-consented for the `Repose Production Tracker` app registration. If sendMail returns 401/403, the user signs out + back in, or admin grants the consent. If still blocked, the helper degrades gracefully (silent failure) and the workflow still works — approvers just don't get the email.
- **Email-from-user** semantics: emails come from QHSE's actual mailbox, not a service account. Replies go to QHSE. Acceptable for Phase 2; Plan 2D could add an Azure Function to send from a noreply address if the noise becomes a problem.
- **`#documents` deep-link** — the email links use `?ui=v4#documents`, but the `doc-approvals` view doesn't have a hash route. A follow-up commit can wire `#doc-approvals` once the URL hash navigation pattern is generalised.
