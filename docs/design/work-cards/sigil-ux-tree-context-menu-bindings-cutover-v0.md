# Sigil UX Tree Context Menu Bindings Cutover V0

## Recipient

Implementer.

## Transfer Kind

Implementation round.

## Single Goal

Cut over only Sigil avatar/context-menu right-click routing to the UX tree
command adapter while preserving current behavior.

This slice should cover:

- right-click on the avatar/body opens the context menu;
- right-click while the context menu is open toggles/closes it;
- duplicate right-click echo suppression remains intact;
- right-click away still closes/cancels as it does today.

Do not cut over avatar left press/release, avatar double-click Selection Mode
entry/exit, drag-threshold radial start, radial item release, annotation
reticle, annotation camera, wiki graph, or agent terminal commands.

## Branch / Base

- `branch_from`: `implementer/sigil-ux-tree-selection-mode-bindings-cutover-v0`
- `required_start_ref`: `origin/implementer/sigil-ux-tree-selection-mode-bindings-cutover-v0`
- `implementation_base_sha`: `c8aa0206dd7f1134686cac3c3b4c115855127f5f`
- Expected output branch: `implementer/sigil-ux-tree-context-menu-bindings-cutover-v0`
- This is stacked on PR #385, which is stacked on #384, #383, and #382.
- Commit the completed slice. Push the output branch for review if branch-push
  credentials are available. Do not open a PR unless explicitly reassigned.

## Product Direction

Selection Mode-local bindings now use the UX tree command path. The next
smallest broader-family cutover is context menu right-click routing because the
commands already exist in the UX tree and the runtime behavior is localized in
`handleInputEvent`.

Target path:

```text
right_mouse_down
  -> context/avatar guard logic
  -> UX tree binding lookup
  -> allowlisted command registry
  -> existing context menu runtime function
```

## Read First

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/context-menu/menu.js`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `docs/design/work-cards/sigil-ux-tree-selection-mode-bindings-cutover-v0.md`

## Existing Behavior To Preserve

Current `handleInputEvent` right-click behavior is:

- record `context-menu:right-down`;
- if the context menu is open:
  - if the click is a duplicate open echo, record
    `context-menu:right-down-duplicate-ignored` and return;
  - otherwise record `context-menu:right-down-close-open-menu`, close with
    reason `right-click-toggle`, call `cancelInteraction('right-click-toggle')`,
    and return;
- if the context menu is closed:
  - if coordinates are numeric and `openContextMenuAt(x, y)` succeeds, return;
  - otherwise close with reason `right-click-away`, call
    `cancelInteraction('right-click')`, and return.

The cutover should preserve that sequence, including rejection behavior from
`openContextMenuAt`.

## Required Work

### 1. Extend command inputs and registry handlers

Add context-menu command input constants for:

- `sigil.context_menu.open`
  - node: `sigil.avatar.body`
  - mode: `idle`
  - gesture: `pointer.right.click`
- `sigil.context_menu.toggle`
  - node: `sigil.avatar.context_menu`
  - mode: `global`
  - gesture: `pointer.right.click`

Register allowlisted handlers for:

- `sigil.context_menu.open`
- `sigil.context_menu.toggle`

The handlers must call existing runtime functions/closures supplied by
`main.js`. The adapter must not import or own context menu state.

Suggested handler shape:

- open handler receives pointer context and calls `openContextMenuAt(x, y)`;
- toggle handler receives pointer context and invokes the existing close/cancel
  sequence for an open menu.

Keep plain handler registry semantics from PR #384: only own registered
handlers execute.

### 2. Cut over only right-click context menu routing

In `handleInputEvent`, route right-click context-menu open/toggle through the
UX tree command adapter.

Direct guards may remain around the command call when they are not user-editable
bindings, for example:

- numeric coordinate guard;
- duplicate context-menu echo suppression;
- existing context-menu-open branch vs closed branch;
- fallback when the adapter cannot resolve or execute the command.

Fallback should call the exact current runtime behavior for the branch that
failed to execute:

- open fallback: `openContextMenuAt(x, y)`;
- toggle fallback: `contextMenu.close('right-click-toggle')` plus
  `cancelInteraction('right-click-toggle')`.

### 3. Preserve debug evidence

Reuse the existing UX command runtime evidence:

- `window.__sigilDebug.snapshot().uxCommandRuntime`
- `window.__sigilDebug.uxTreeCommand(...)`
- bounded `ux-command` interaction trace entries

The reviewer should be able to see whether the right-click command executed
through the UX tree path or used fallback.

## Hard Boundaries

- Do not change context menu visual behavior, layout, hit testing, or item
  actions.
- Do not cut over avatar left press/release, double-click, radial, reticle,
  camera, wiki graph, or terminal commands.
- Do not change radial menu config, radial target surface behavior, or
  annotation behavior.
- Do not change the UX tree schema unless a defect blocks this slice.
- Do not add persistence, editor UI, or user settings writes.
- Do not rely on live input/TCC as the only proof.

## Acceptance Criteria

- Selection Mode command cutovers from PR #385 still pass.
- Context menu right-click open uses the UX command adapter on the successful
  path.
- Context menu right-click toggle/close uses the UX command adapter on the
  successful path.
- Duplicate right-click echo suppression still bypasses close/toggle.
- Right-click-away fallback/rejection behavior remains unchanged.
- Invalid tree or missing handler fails closed and uses explicit fallback.
- Avatar/radial/reticle/camera bindings remain unchanged.

## Suggested Tests

Add focused tests without importing all of `main.js` into Node if possible. If a
small pure helper is needed for route decision or command execution
preparation, extract one.

Cover at least:

- command adapter executes context-menu open handler with pointer context;
- command adapter executes context-menu toggle handler with pointer context;
- missing handler reports `handler_not_registered` and does not execute;
- route helper preserves duplicate open echo suppression before toggle;
- route helper chooses open only when coordinates are numeric and menu is
  closed;
- route helper chooses right-click-away fallback when open cannot be attempted
  or open rejects.

Keep existing Selection Mode, own-handler safety, UX tree, and context menu hit
tests passing.

## Verification

Run at least:

```bash
./aos dev recommend --json --files \
  apps/sigil/renderer/live-modules/main.js \
  apps/sigil/renderer/live-modules/ux-tree.js \
  apps/sigil/renderer/live-modules/ux-tree-command-registry.js \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/context-menu-hit-test.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs

node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/selection-mode-input.js
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs \
  tests/renderer/context-menu-hit-test.test.mjs \
  tests/renderer/sigil-input-regions.test.mjs \
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
the manual TCC blocker report path
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
- confirmation that only context-menu right-click bindings were cut over;
- confirmation that avatar/radial/reticle/camera bindings stayed unchanged;
- how fallback/debug evidence is exposed;
- tests and checks run;
- next recommended binding family, if any;
- `git status --short --branch`;
- `git show --stat HEAD`.
