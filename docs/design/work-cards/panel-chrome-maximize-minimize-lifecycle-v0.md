# Panel Chrome Maximize/Minimize Lifecycle V0

## Tracker

- Related Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Related toolkit panel surface: `packages/toolkit/panel/chrome.js`

## Goal

Fix a shared AOS toolkit panel lifecycle defect: maximizing a panel and then
minimizing it can create the minimized chip while leaving the maximized panel
visible.

The defect was observed on Surface Inspector, but the fix belongs in the shared
panel chrome/minimized-chip lifecycle so every toolkit panel inherits the
correct behavior.

Do not resume Employer Brand alignment, capture, locator, report, export, or
workflow work in this slice.

## Human Evidence

The human reported:

- maximizing Surface Inspector was janky;
- minimizing after maximize created the minimized chip;
- the maximized Surface Inspector window remained visible as well;
- this happened alongside broader runtime/input responsiveness concerns, so the
  lifecycle path should avoid unnecessary duplicate canvases and stale active
  panels.

## Required Behavior

### 1. Minimize Must Not Leave The Source Panel Visible

When a panel is minimized:

- exactly one minimized chip should be visible for the source panel;
- the source panel canvas should be suspended or otherwise hidden;
- a maximized source panel must not remain visible behind/alongside the chip;
- failure to suspend/hide the source panel must roll back or remove the chip and
  report an explicit failure state.

Avoid the current failure mode where chip creation succeeds but target suspend
does not hide the source.

### 2. Maximize State Must Not Poison Minimize/Restore

If a panel is maximized before minimize:

- the minimized chip should remember the correct restore frame;
- restore should bring the panel back to the pre-maximized frame, or to a
  documented normalized restore frame if that is the intended policy;
- the maximized work-area frame should not become the permanent restore frame
  unless explicitly intended and tested;
- maximize controller state should be reset or serialized consistently across
  minimize/suspend/restore.

Document the chosen policy in tests.

### 3. Minimize Should Be Atomic Enough For Runtime UX

The minimize sequence should avoid visible duplicate states:

- if the implementation must create chip before suspending source, it should
  clean up on suspend failure;
- if it can suspend first and then create chip, ensure restore metadata is still
  available;
- duplicate minimize clicks should not spawn multiple chips for the same target;
- maximize/minimize controls should be disabled or ignored while a minimize
  operation is in flight.

### 4. Lifecycle Diagnostics

Expose enough deterministic state for tests or runtime inspection:

- source canvas id;
- chip canvas id;
- minimize in-flight state;
- restore frame;
- whether target suspend succeeded;
- whether rollback removed a chip after failure.

This can be a pure helper result, debug callback, or test-only instrumentation.
Do not add a broad panel state manager in this slice.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/panel/chrome.js`
  - `minimizePanel`;
  - `chipUrl`;
  - `createMaximizeController`;
  - maximize/minimize button handlers;
- `packages/toolkit/panel/placement.js`;
- `packages/toolkit/runtime/canvas.js`;
- `tests/toolkit/panel-chrome.test.mjs`;
- `tests/toolkit/surface-inspector.test.mjs`;
- `tests/toolkit/markdown-workbench-layout.test.mjs`.

Likely fixes:

- extract a pure minimize lifecycle helper so success/failure/rollback can be
  tested without a live daemon;
- make minimize idempotent while in flight;
- ensure the target suspend result is checked and chip rollback occurs on
  failure;
- reset maximize controller state before or during minimize if needed;
- add focused tests for maximize -> minimize -> restore frame policy.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/markdown-workbench-layout.test.mjs
node --test tests/toolkit/surface-zoom-inspector.test.mjs
bash tests/help-contract.sh
git diff --check
```

If `./aos ready` passes, run a bounded AOS smoke:

1. launch Surface Inspector;
2. maximize it;
3. minimize it;
4. verify the chip appears and the Surface Inspector panel is not visible;
5. restore from the chip;
6. verify only one Surface Inspector panel exists and the restored frame follows
   the documented restore policy;
7. repeat minimize twice quickly or simulate duplicate click and verify only one
   chip exists.

If runtime was rebuilt in the same session, tell Foreman/user that macOS
Accessibility/Input Monitoring may need remove/re-add before Operator smoke.

## Non-Goals

- no Surface Inspector annotation behavior changes unless needed only to verify
  panel chrome;
- no Employer Brand review/capture/report work;
- no new visual design for panel chrome;
- no daemon lifecycle rewrite;
- no Surface-Zoom-specific workaround.
