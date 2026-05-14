# Panel Window Placement Contract Closure V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #261 Define panel window placement contract and migrate private
  drag paths
- Related issue: #305 Sigil first-class surface consumer
- Historical/native chrome issue: #45
- Closed baselines this card should consume: #304, #122, #120, #123

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. The worktree is expected to be substantially dirty
from the surface-stack workstream; do not revert unrelated changes.

## Goal

Reconcile the final #261 placement-contract questions and leave Foreman with a
clear close-or-restatement recommendation.

This is not another app migration slice unless the audit reveals a tiny missing
guard. Agent Terminal, radial item editor, radial item workbench, stage-backed
minimized chips, and legacy chat parking have already landed. The remaining
unclear point is the issue's "drag-end finalization overlap with
`src/display/canvas.swift`" language.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-panel-window-normalization-v0.md`
- `docs/design/work-cards/sigil-radial-item-workbench-panel-controller-v0.md`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/drag-transfer.js`
- `src/display/canvas.swift`
- `apps/sigil/chat/index.html`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/panel-drag-transfer.test.mjs`
- `tests/renderer/sigil-panel-window-migration.test.mjs`
- `tests/renderer/agent-terminal-chrome.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "drag_start|move_abs|drag_end|finalizeDragPosition|isActivelyDraggingCanvas|createPanelWindowController|mountChrome|minimized-chip|aos-chip|legacy Sigil chat|panel window placement" src packages/toolkit apps/sigil tests docs
gh issue view 261 --repo michaelblum/agent-os --json number,title,state,body,comments
```

If `./aos ready` reports only `input_tap_not_active`, do not ask the human for
a macOS permission reset. Continue with deterministic code/docs tests and
report the runtime blocker.

## Current Evidence

Known #261 migrations now in-tree:

- stock `mountChrome()` routes through `createPanelWindowController()`;
- Agent Terminal uses `mountChrome()`;
- radial item editor uses `createPanelWindowController().wireDrag(...)`;
- radial item workbench uses `createPanelWindowController()` for drag, resize,
  maximize, minimize, and close;
- default minimized chips use the stage-backed path from #304;
- `packages/toolkit/panel/minimized-chip.html` remains explicit fallback only;
- legacy `apps/sigil/chat/index.html` still contains older private drag/chrome,
  but active docs and tests mark it parked/non-canonical rather than a live
  surface to migrate.

The likely remaining authority split:

- Toolkit owns window policy: drag controller, transfer outline, work-area
  clamp, display-owner selection, minimize/restore placement, maximize/restore,
  and app integration.
- Daemon owns native mechanics: actual `move_abs` window mutation, mixed-DPI
  direct-drag handling, active-drag flag, and native frame finalization on
  `drag_end`.

Confirm whether that split is already true and documented. Do not remove
daemon `drag_end` finalization just because the old design note called it an
"overlap"; it may be the native primitive that makes the toolkit policy work
across mixed-DPI seams.

## Required Work

### 1. Audit #261 Exit Criteria Against Current Code

Map each #261 exit criterion to current code/tests:

- one public toolkit API owns panel/window placement policy;
- minimized chip restore routes through that API / accepted stage-backed chip
  baseline;
- Agent Terminal no longer carries private drag/chrome;
- Sigil chat is parked rather than a live surface to migrate;
- stacked, side-by-side, mixed-DPI, off-left/off-right/off-bottom,
  minimize/restore, and maximize clamping coverage exists or has a named gap;
- Surface Inspector and Agent Terminal share behavior when launched from the
  same branch root, or the remaining live smoke gap is explicitly named.

Put the concise audit in `docs/design/aos-panel-window-placement-contract.md`
or a small new section in `docs/design/aos-surface-stack-v0-integration-ledger.md`.

### 2. Reconcile Drag-End Finalization Authority

Inspect `src/display/canvas.swift` and toolkit drag code. Decide which is true:

- **Preferred if supported by code:** daemon `drag_end` finalization is not
  policy overlap; it is native placement mechanics that completes the frame the
  toolkit requested while active-drag mixed-DPI fallback is disabled. Toolkit
  still owns final policy by deciding when to call `updateFrame()` / clamp /
  transfer release before emitting `drag_end`.
- **If not supported:** there is still a real policy conflict; write the exact
  gap and the smallest next work card needed to fix it.

Update docs to say this clearly. If code comments are currently misleading,
make a small comment/doc edit. Add or adjust deterministic tests only if there
is a cheap assertion missing around the authority split.

### 3. Add Guardrails For "Live App Private Drag"

The repo may still contain historical raw `drag_start` / `move_abs` /
`drag_end` in parked or fallback files. The guardrail should not ban those
globally. Instead, encode the intended classification:

- live panel apps should use `mountChrome()` or `createPanelWindowController()`;
- `apps/sigil/chat/index.html` is parked legacy;
- `packages/toolkit/panel/minimized-chip.html` is fallback only;
- toolkit internals may still emit drag lifecycle messages to the daemon.

If an existing test already covers this, extend it only as needed. Do not write
a brittle grep test that blocks intentional toolkit internals.

### 4. Leave A Foreman-Usable Issue Recommendation

At the end of the audit, leave one of these outcomes in docs and completion
report:

- **Close #261:** all exit criteria are satisfied or intentionally parked, and
  remaining work belongs in separate narrow issues.
- **Keep #261 open with exact gap:** name the one remaining gap and route the
  next card.

Do not close GitHub issues from GDI. Foreman owns the issue write.

## Verification

Minimum:

```bash
git diff --check
node --test tests/renderer/sigil-panel-window-migration.test.mjs
node --test tests/renderer/agent-terminal-chrome.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
```

If Swift files change:

```bash
./aos dev build
```

If the work is docs/tests only, do not rebuild unless `./aos dev recommend
--json` says the changed paths require it.

## Hard Boundaries / Non-Goals

- Do not migrate or revive legacy `apps/sigil/chat/` unless the audit proves
  parking is insufficient and the change is tiny.
- Do not remove the toolkit WebView minimized-chip fallback.
- Do not remodel Sigil visuals or `avatar-main`.
- Do not move panel/window policy into the daemon.
- Do not weaken native drag behavior for mixed-DPI seams.

## Completion Report

Include:

- files changed;
- #261 exit-criteria audit result;
- daemon/toolkit drag-end authority conclusion;
- any guardrail/test changes;
- tests run and results;
- readiness result and any runtime blocker;
- explicit Foreman recommendation: close #261 or keep open with one exact next
  gap.
