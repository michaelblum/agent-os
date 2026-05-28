# Sigil UX Tree Selection Mode Bindings Cutover V0

## Recipient

GDI.

## Transfer Kind

Implementation round.

## Single Goal

Cut over the remaining low-risk Selection Mode bindings to the Sigil UX tree
command adapter while preserving current behavior:

- Enter commits Selection Mode.
- Tab cycles to the previous target.
- ArrowUp cycles to the previous target.
- ArrowDown cycles to the next target.
- Left click acquires selection candidates.

Do not cut over avatar entry/exit gestures, context menu, radial gesture, radial
item release, or annotation reticle bindings in this slice.

## Branch / Base

- `branch_from`: `gdi/sigil-ux-tree-command-adapter-cutover-v0`
- `required_start_ref`: `origin/gdi/sigil-ux-tree-command-adapter-cutover-v0`
- `implementation_base_sha`: `fac3ef33ca9226af354ff4232f0e2d02ee4c1b4d`
- Expected output branch: `gdi/sigil-ux-tree-selection-mode-bindings-cutover-v0`
- This is stacked on PR #384, which is stacked on #383 and #382.
- Commit the completed slice. Push the output branch for review if branch-push
  credentials are available. Do not open a PR unless explicitly reassigned.

## Product Direction

PR #384 proved the allowlisted command adapter with Selection Mode Escape. This
slice should finish the Selection Mode-local command path before moving to
broader avatar/radial routing. The goal is not more UI behavior; it is making
the already-existing Selection Mode behavior data-routed through the UX tree.

Target path:

```text
Selection Mode input
  -> UX tree binding lookup
  -> allowlisted command registry
  -> existing Selection Mode runtime function
```

## Read First

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `docs/design/work-cards/sigil-ux-tree-command-adapter-cutover-v0.md`
- `docs/design/work-cards/sigil-ux-tree-command-registry-own-lookup-correction-v0.md`

## Required Work

### 1. Extend command registry handlers

Register handlers for these existing commands:

- `sigil.selection_mode.commit`
- `sigil.selection_mode.cycle_target`
- `sigil.selection_mode.acquire`

Reuse the existing runtime functions:

- `commitSelectionMode('enter')`
- `cycleSelectionModeTarget(delta)`
- `acquireSelectionModeCandidates(pointer)`

Use the binding parameters already modeled in the UX tree for cycle direction:

- Tab: `delta: -1`
- ArrowUp: `delta: -1`
- ArrowDown: `delta: 1`

For left-click acquire, pass the current pointer through adapter context. Do not
duplicate candidate acquisition or context-session mutation logic.

### 2. Cut over only Selection Mode-local handlers

In `handleSelectionModeInput`, route these successful paths through the UX tree
command adapter:

| Existing input | UX gesture | Command |
| --- | --- | --- |
| Enter/Return | `key.enter` | `sigil.selection_mode.commit` |
| Tab | `key.tab` | `sigil.selection_mode.cycle_target` |
| ArrowUp | `key.arrow_up` | `sigil.selection_mode.cycle_target` |
| ArrowDown | `key.arrow_down` | `sigil.selection_mode.cycle_target` |
| non-avatar `left_mouse_up` | `pointer.left.click` | `sigil.selection_mode.acquire` |

Keep these direct guards unchanged:

- `consumeSelectionModeEntryRelease(msg)` must still run before any left-click
  acquire command.
- The active Selection Mode avatar double-click exit path must remain direct in
  this slice.
- Mouse move, drag, right mouse, scroll, and unrelated key consumption semantics
  must stay unchanged.

### 3. Preserve fallback/debug evidence

Extend the PR #384 debug evidence rather than adding a second model:

- `window.__sigilDebug.snapshot().uxCommandRuntime`
- `window.__sigilDebug.uxTreeCommand(...)`
- bounded `ux-command` interaction trace entries

Fallback is acceptable only as an explicit safety path when the UX tree adapter
cannot resolve or execute the binding. The fallback should call the same
existing runtime function the command handler would have called.

## Hard Boundaries

- Do not change Selection Mode UX semantics.
- Do not cut over avatar double-click entry, avatar double-click exit, right
  click context menu, drag-threshold radial start, radial release, or reticle
  commands.
- Do not change radial menu config, geometry, or item behavior.
- Do not change the UX tree schema unless a defect blocks this slice.
- Do not introduce persistence, editor UI, or user settings writes.
- Do not rely on live input/TCC as the only proof.

## Acceptance Criteria

- Escape remains on the UX command path from PR #384.
- Enter/Return, Tab, ArrowUp, ArrowDown, and non-avatar left-click acquire use
  the UX command adapter on the successful path.
- Entry-release suppression still prevents immediate acquire after entering
  Selection Mode.
- Active Selection Mode avatar double-click exit still works.
- Invalid tree or missing handler fails closed and uses explicit fallback.
- Debug evidence distinguishes executed UX commands from fallback executions.
- Existing focused renderer/toolkit/schema tests still pass.

## Suggested Tests

Add focused tests without importing all of `main.js` into Node if possible. If a
small pure helper is needed for testability, extract one.

Cover at least:

- command adapter executes commit handler for `key.enter`;
- command adapter executes cycle handler with `delta: -1` for Tab and ArrowUp;
- command adapter executes cycle handler with `delta: 1` for ArrowDown;
- command adapter executes acquire handler with pointer context for
  `pointer.left.click`;
- missing handler does not execute and reports `handler_not_registered`;
- a cutover routing helper preserves entry-release and avatar double-click exit
  guards around left mouse up.

Keep the existing own-handler safety tests from PR #384.

## Verification

Run at least:

```bash
./aos dev recommend --json --files \
  apps/sigil/renderer/live-modules/main.js \
  apps/sigil/renderer/live-modules/ux-tree.js \
  apps/sigil/renderer/live-modules/ux-tree-command-registry.js \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs

node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  tests/renderer/radial-menu-activation.test.mjs \
  tests/renderer/radial-object-control.test.mjs \
  tests/renderer/radial-item-editor.test.mjs
node --test tests/toolkit/runtime-ux-tree.test.mjs \
  tests/toolkit/ux-tree-subject.test.mjs \
  tests/schemas/aos-ux-tree-v0.test.mjs
git diff --check
```

Run `./aos ready` if it is cheap. If it reports a repo-mode TCC/input-tap
blocker, stop and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then rerun:

```bash
./aos ready --post-permission
```

after the human returns with `finished`.

## Completion Report

Include:

- branch name;
- head SHA and base SHA;
- changed files;
- confirmation that only Selection Mode-local bindings were cut over;
- confirmation that avatar/radial/context menu bindings stayed unchanged;
- how fallback/debug evidence is exposed;
- tests and checks run;
- next recommended binding family, if any;
- `git status --short --branch`;
- `git show --stat HEAD`.
