# Toolkit Panel Chip Drag And Transfer Outline Correction V0

## Foreman Acceptance

Status: accepted after correction commit `0824e52`.

Accepted evidence:

- `packages/toolkit/components/desktop-world-stage/model.js` again renders
  explicit restore and close affordances for chip layers.
- `packages/toolkit/components/desktop-world-stage/styles.css` again styles
  separate restore and close affordances instead of a single close pseudo-marker.
- `packages/toolkit/panel/chrome.js` again maps chip visual frames through
  `stageLayerFrameFromNativeFrame` for initial stage upserts and drag upserts,
  while native input regions stay in native coordinates.
- `tests/toolkit/desktop-world-stage.test.mjs` covers chip affordance rendering.
- `tests/toolkit/panel-chrome.test.mjs` covers native-to-DesktopWorld chip frame
  mapping and drag updates.

Foreman verification:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/desktop-world-stage.test.mjs
node --test tests/toolkit/toolkit-api-docs-contract.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
git diff --check
./aos ready
```

`./aos ready` returned `ready=true mode=repo daemon=reachable tap=active`.

## Foreman Review - Request Changes Superseded

The gesture and transfer-outline work in `395d6f8` is directionally right, but
the branch is based on `main` and drops behavior from the prior minimized-chip
affordance branch `a3acb69`. Do not treat this branch as accepted until the
drag correction and prior chip affordance fix are integrated into one coherent
branch.

Evidence:

- `packages/toolkit/components/desktop-world-stage/model.js` renders only the
  label for chip layers. The explicit restore and close affordance spans added
  in `a3acb69` are absent.
- `packages/toolkit/components/desktop-world-stage/styles.css` is back to the
  old `::after { content: "x"; }` close marker and no longer styles separate
  restore and close affordances.
- `packages/toolkit/panel/chrome.js` no longer exports or uses
  `stageLayerFrameFromNativeFrame`. Initial stage chip upsert and drag updates
  send native chip frames directly to DesktopWorld instead of mapping through
  `nativeToDesktopWorldRect`. Native input regions should remain native, but the
  passive DesktopWorld visual layer must be in DesktopWorld coordinates.
- `tests/toolkit/desktop-world-stage.test.mjs` is back to 4 tests and no longer
  proves that chips render visible restore and close affordances.

Required correction:

- Preserve the current `395d6f8` gesture semantics: body/restore down records a
  gesture only; up below threshold restores; drag past the threshold moves the
  chip and updates body/restore/close native input regions; close remains
  `down_only`.
- Carry forward the visible stage chip restore and close affordances from
  `a3acb69`, or implement an equivalent toolkit-owned rendering contract.
- Carry forward the native-to-DesktopWorld mapping for stage chip visual frames.
  Apply the mapping both to the initial chip layer and every drag upsert. Keep
  registered and updated input-region frames in native coordinates.
- Restore behavioral tests that prove chip layers render both affordances.
- Restore or replace the `stageLayerFrameFromNativeFrame` coverage so the tests
  fail if a native frame is sent directly to DesktopWorld again.
- Keep the new bidirectional transfer-outline and direct-drag resume coverage.

Verification:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/desktop-world-stage.test.mjs
node --test tests/toolkit/toolkit-api-docs-contract.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
git diff --check
```

If `./aos ready` reports `ready=true`, rerun the live smoke with the same
acceptance points:

- A real chip body drag moves the visible stage chip and leaves the source
  suspended.
- A click-like body/restore gesture restores the source and removes chip layer
  and regions.
- Close removes the source and chip resources.
- Cross-display transfer outlines appear in both directions for horizontal and
  stacked layouts.

Completion report should include:

- branch and head SHA;
- changed files;
- deterministic command results;
- whether live AOS smoke ran and what it proved;
- local-only state;
- final `git status --short --branch`.
