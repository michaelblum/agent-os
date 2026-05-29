# Sigil UX Tree Command Adapter Cutover V0

## Recipient

GDI.

## Transfer Kind

Implementation round.

## Single Goal

Add the first allowlisted Sigil UX tree command execution adapter and cut over
one low-risk live binding to it: Selection Mode Escape cancellation.

This is the next slice after the read-only UX tree foundation. It should prove
the path:

```text
normalized input event
  -> UX tree binding lookup
  -> allowlisted command registry
  -> existing runtime function
```

Do not broadly replace Sigil input routing in this round.

## Branch / Base

- `branch_from`: `gdi/sigil-ux-tree-binding-foundation-v0`
- `required_start_ref`: `origin/gdi/sigil-ux-tree-binding-foundation-v0`
- `implementation_base_sha`: `23ae13979ea2e6c73b418ffb62bd8442ab06dbac`
- Expected output branch: `gdi/sigil-ux-tree-command-adapter-cutover-v0`
- This is stacked on PR #383, which is stacked on PR #382.
- Commit the completed slice. Push the output branch for review if branch-push
  credentials are available. Do not open a PR unless explicitly reassigned.

## Product Direction

The UX tree should become an inspectable and eventually editable model for
avatar gestures, mode-specific bindings, radial geometry, and commands. This
slice should move one binding out of handwritten branch ownership without
making the rest of `main.js` harder to understand.

Use Selection Mode Escape as the first live cutover because it has:

- a clear active mode scope;
- no hit-test ambiguity;
- one existing action: cancel active Selection Mode;
- deterministic testability without live mouse/TCC input.

## Read First

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `packages/toolkit/runtime/ux-tree.js`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-menu-activation.test.mjs`
- `docs/design/sigil-ux-tree-binding-foundation-v0.md`
- `docs/design/work-cards/sigil-ux-tree-binding-foundation-v0.md`

## Required Work

### 1. Add a Sigil command execution adapter

Add a small Sigil-local adapter, either in a new focused module such as:

- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`

or in `ux-tree.js` if the code stays small and easy to test.

The adapter should:

- accept a resolved UX tree and an allowlisted registry of command handlers;
- resolve a binding by `{ nodeId, mode, gesture }`;
- verify the resolved command exists, has `safety.execution: "allowlisted"`,
  and has a registry handler for its `handler_ref` or command id;
- execute only registry handlers, never values embedded inside the UX tree;
- return structured result metadata such as `matched`, `executed`,
  `command_id`, `binding_id`, `reason`, and any validation errors;
- fail closed when the tree is invalid or a handler is not registered.

Keep the registry plain JavaScript data/functions owned by Sigil runtime code.
Do not add dynamic imports, eval-like behavior, executable schema values, or
string-to-function lookup.

### 2. Register the first live command

Register the existing Selection Mode cancel path as the first live command:

- command id / handler ref: `sigil.selection_mode.cancel`
- existing behavior: `exitSelectionMode('escape')` for Escape key handling

The handler should reuse the current runtime function. Avoid duplicating
Selection Mode state mutation logic.

### 3. Cut over Selection Mode Escape

In `handleSelectionModeInput`, route Escape through the UX tree command adapter
when Selection Mode is active.

Expected lookup shape:

```text
nodeId: sigil.avatar.selection_mode
mode: selection_mode
gesture: key.escape
```

The successful command should consume the input and preserve current behavior:
Selection Mode exits, the event is recorded as cancellation, and existing
debug/snapshot state remains coherent.

Fallback is acceptable only as an explicit safety path when the UX tree adapter
cannot resolve or execute the binding. Capture enough debug metadata to explain
why fallback happened.

### 4. Keep shadow parity visible

Expose adapter execution evidence in a debug-friendly way. Acceptable options:

- extend `window.__sigilDebug.snapshot()` with a small UX command runtime
  snapshot; or
- expose a debug helper that resolves and executes against injected test
  handlers without mutating live state; or
- record bounded interaction trace entries around UX command execution.

The important part is that a reviewer can tell whether Escape used the UX tree
path or fell back to the old direct path.

## Hard Boundaries

- Do not cut over right-click context menu, double-click Selection Mode entry,
  radial drag threshold, radial item release, or Selection Mode Enter/Tab/Arrow
  keys in this slice.
- Do not add a user-facing editor or persistence.
- Do not change the UX tree schema unless a defect blocks this adapter.
- Do not change radial menu geometry or item config semantics.
- Do not add external dependencies.
- Do not rely on live mouse/TCC input as the only proof.

## Acceptance Criteria

- A Sigil-local allowlisted UX tree command execution adapter exists and is
  covered by deterministic tests.
- Selection Mode Escape cancellation goes through the UX tree binding/command
  adapter on the successful path.
- Invalid tree, missing handler, non-allowlisted command, or unsafe command
  state does not execute a handler.
- Existing Selection Mode cancellation behavior remains unchanged from the
  user's perspective.
- Existing UX tree read-only/debug surfaces keep working.
- Existing renderer radial/selection tests still pass.

## Suggested Tests

Add focused tests for the new adapter, including:

- valid `key.escape` binding executes the registered cancel handler once;
- missing handler returns `executed: false`;
- invalid tree returns `executed: false`;
- non-allowlisted command returns `executed: false`;
- Selection Mode Escape cutover uses the UX command path while preserving
  cancellation behavior.

Prefer a small exported pure helper for testability over importing all of
`main.js` into a Node test.

## Verification

Run at least:

```bash
./aos dev recommend --json --files \
  apps/sigil/renderer/live-modules/main.js \
  apps/sigil/renderer/live-modules/ux-tree.js \
  packages/toolkit/runtime/ux-tree.js \
  tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs

node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --test tests/renderer/sigil-ux-tree.test.mjs \
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

If the adapter file is not created because the implementation stays inside
`ux-tree.js`, replace that `node --check` command with the actual changed
module list.

Run `./aos ready` if the local runtime state makes it cheap. If it reports a
repo-mode TCC/input-tap blocker, stop and use:

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
- whether Selection Mode Escape is the only live cutover;
- how fallback/debug evidence is exposed;
- tests and checks run;
- any follow-up bindings that are now safe to cut over next;
- `git status --short --branch`;
- `git show --stat HEAD`.
