# Sigil UX Tree Binding Foundation V0

## Recipient

Implementer.

## Transfer Kind

Implementation round.

## Single Goal

Create the first canonical UX tree/binding foundation that makes Sigil avatar,
radial menu, Selection Mode, and reticle interactions inspectable as ordinary
data, while leaving current runtime behavior unchanged.

This is the first cutover slice toward a user-editable model where gestures,
commands, radial geometry, radial items, and mode-scoped affordances can be
viewed and later edited without hand-editing `main.js`.

## Branch / Base

- `branch_from`: `implementer/context-selection-mode-recording-follow-through-v0`
- `required_start_ref`: `a9915c7b8f090a672c24c411ea55ed2fa56488a1`
- Expected output branch: `implementer/sigil-ux-tree-binding-foundation-v0`
- Commit the completed slice. Push the output branch for review if the current
  Implementer runtime has branch-push credentials available. Do not open a PR unless
  explicitly reassigned.

## Product Direction

Treat the avatar as the first implementation of a general UX tree, not as a
private one-off. The target model is:

```text
normalized input event
  -> gesture recognition
  -> UX tree node / mode scope
  -> binding lookup
  -> allowlisted command
  -> existing runtime function
```

For this V0, build the inspectable model and shadow matching. Do not replace
the live router yet.

The model should make these future edits ordinary data changes:

- left click does something different;
- double-click opens the menu instead of right-click;
- right-click enters Selection Mode;
- radial menu radii/spread/handoff settings are adjusted;
- radial items are created, hidden, reordered, or retargeted through a
  schema-backed editor.

## Read First

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-menu-activation.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-menu-activation.test.mjs`
- `tests/renderer/radial-object-control.test.mjs`
- `tests/renderer/radial-item-editor.test.mjs`

## Phase 1: Contract And Schema

Add a V0 UX tree contract in shared schema/docs.

Suggested files:

- `shared/schemas/aos-ux-tree-v0.schema.json`
- `shared/schemas/aos-ux-tree-v0.md`
- `shared/schemas/fixtures/aos-ux-tree-v0/valid/sigil-avatar.json`
- `shared/schemas/fixtures/aos-ux-tree-v0/invalid/*.json`
- `tests/schemas/aos-ux-tree-v0.test.mjs`

Required concepts:

- `schema`: `aos_ux_tree`
- `version`
- `id`
- `label`
- `owner`
- `source_refs`
- `modes`
- `nodes`
- `commands`
- `bindings`
- `settings`
- `metadata`

Node fields should support:

- `id`
- `parent_id`
- `label`
- `role`
- `node_type`
- `hit` or `hit_source`
- `settings_ref`
- `resource_refs`
- `children` or parent-derived hierarchy
- `source_metadata`

Binding fields should support:

- `id`
- `node_id`
- `mode`
- `gesture`
- `command_id`
- `enabled`
- `priority`
- `consume_policy`
- `source_metadata`

Command fields should support:

- `id`
- `label`
- `description`
- `handler_ref`
- `parameters`
- `safety`
- `source_metadata`

Settings should support keyed subtrees for radial geometry, radial menu config,
visual overlays, and future user overrides. Keep settings plain JSON.

Hard schema requirements:

- No arbitrary executable code.
- Commands are declarative references to allowlisted handlers.
- Bindings must reference known nodes and commands.
- Gestures are strings in V0, such as `pointer.left.double_click`,
  `pointer.right.click`, `pointer.left.drag_threshold`, `key.escape`,
  `key.enter`, `key.tab`, and `key.arrow_down`.
- Asset-like values should be refs, not embedded binary/blob payloads.

## Phase 2: Toolkit Runtime Helpers

Add a small, dependency-light toolkit helper for UX trees.

Suggested file:

- `packages/toolkit/runtime/ux-tree.js`

Export from the relevant runtime index if that is the local pattern.

Required helpers:

- `createUxTree(input, options)`
- `normalizeUxTreeNode(node, options)`
- `normalizeUxTreeCommand(command, options)`
- `normalizeUxTreeBinding(binding, options)`
- `mergeUxTreeDefinitions(base, override)`
- `resolveUxTree(input, options)`
- `uxTreeBindingsForGesture(tree, { nodeId, mode, gesture })`
- `uxTreeCommandById(tree, commandId)`

Use the existing radial-menu keyed-merge style as precedent:

- objects merge deeply;
- arrays replace by default;
- `nodes`, `commands`, and `bindings` merge by stable `id`;
- invalid references are surfaced in `validation.errors`;
- strict mode can throw, non-strict mode returns validation metadata.

Add focused runtime tests.

## Phase 3: Sigil Read-Only UX Tree Producer

Add a Sigil producer that builds a read-only UX tree from current Sigil state and
existing radial menu data.

Suggested file:

- `apps/sigil/renderer/live-modules/ux-tree.js`

Expose the current tree in debug state, for example:

- `window.__sigilDebug.snapshot().uxTree`
- `window.__sigilDebug.uxTree()`

The tree should include at least:

- `sigil.avatar`
- `sigil.avatar.body`
- `sigil.avatar.radial_menu`
- each radial menu item from the resolved Sigil radial menu config;
- `sigil.avatar.context_menu`
- `sigil.avatar.selection_mode`
- `sigil.avatar.selection_mode.cursor_overlay`
- `sigil.avatar.selection_mode.ancestor_badges`
- `sigil.avatar.annotation_reticle`
- `sigil.avatar.annotation_camera`

Represent current bindings as data, including:

- avatar right click opens/toggles context menu;
- avatar left press/release enters GOTO behavior;
- avatar left drag threshold begins radial gesture;
- avatar double-click in GOTO enters Selection Mode;
- Selection Mode Escape cancels;
- Selection Mode Enter commits;
- Selection Mode Tab/ArrowUp/ArrowDown cycles targets;
- Selection Mode left click acquires/commits selection candidates as currently
  implemented;
- radial item release invokes the item command/activation path.

Represent current commands as allowlisted IDs, for example:

- `sigil.context_menu.open`
- `sigil.context_menu.toggle`
- `sigil.avatar.goto.begin`
- `sigil.radial.begin`
- `sigil.radial.release_item`
- `sigil.selection_mode.enter`
- `sigil.selection_mode.cancel`
- `sigil.selection_mode.commit`
- `sigil.selection_mode.cycle_target`
- `sigil.selection_mode.acquire`
- `sigil.annotation_reticle.enter`
- `sigil.annotation_camera.capture_bundle`
- `sigil.wiki_graph.open`
- `sigil.agent_terminal.open`

Do not make these command IDs execute yet except through existing code paths.
This phase is a read-only producer plus tests.

## Phase 4: Shadow Binding Resolver

Add a deterministic shadow resolver that can answer what command the UX tree
would choose for a normalized event/mode/node. It should not replace
`handleInputEvent()` yet.

Required tests:

- current avatar right-click maps to `sigil.context_menu.open` or toggle;
- current avatar double-click entry maps to `sigil.selection_mode.enter`;
- current avatar drag-threshold path maps to `sigil.radial.begin`;
- current Selection Mode Escape maps to `sigil.selection_mode.cancel`;
- current Selection Mode Enter maps to `sigil.selection_mode.commit`;
- current Selection Mode Tab/Arrow keys map to target cycling;
- current radial item release maps to a radial item command using the item id.

Keep this resolver pure or debug-only. The goal is parity evidence, not behavior
cutover.

## Phase 5: Workbench / Editor Readiness Hooks

Add the smallest useful read-only workbench/editor-facing projection.

Acceptable V0 options:

- add a generic `createUxTreeWorkbenchSubject()` helper; or
- add a read-only UX tree facet/resource to the existing Sigil/radial-menu
  workbench subject; or
- document the exact next work card needed if adding a subject would over-expand
  the slice.

The projection should make bindings, commands, settings, and raw JSON
discoverable. It does not need to persist edits yet.

Do not build a full editor UI in this slice.

## Phase 6: Docs And Migration Notes

Update docs to describe:

- `aos_ux_tree` as the future canonical shape for inspectable/editable UX
  affordances;
- radial menu config as an existing settings subtree, not a competing model;
- current runtime state: read-only/shadow, no behavior cutover yet;
- future cutover phases:
  1. command registry execution adapter;
  2. low-risk binding cutover;
  3. radial settings override patches;
  4. user editor/persistence;
  5. removal of duplicated hardcoded binding logic.

Likely docs:

- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- a short design note under `docs/design/` if needed.

## Hard Boundaries

- Do not replace live input routing in this slice.
- Do not remove `sigil-radial-menu.json` or the radial-menu config resolver.
- Do not remove existing `handleInputEvent()`, Selection Mode, radial menu, or
  context menu behavior.
- Do not add arbitrary executable user code.
- Do not add persistence or a user-editing UI yet.
- Do not add always-on capture, pointer streams, or new full-screen capture
  surfaces.
- Do not broaden into unrelated app panels or non-Sigil components except for
  toolkit helpers/docs/tests.

## Recommended Verification

Start with:

```bash
./aos dev recommend --json --files <changed files>
```

Run the relevant recommendation and include at least:

```bash
node --check packages/toolkit/runtime/ux-tree.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/schemas/aos-ux-tree-v0.test.mjs
node --test tests/toolkit/runtime-ux-tree.test.mjs
node --test tests/renderer/sigil-ux-tree.test.mjs
node --test tests/renderer/sigil-selection-mode-input.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-menu-activation.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
bash tests/help-contract.sh
git diff --check
```

If runtime behavior is accidentally touched, also run:

```bash
./aos ready
bash tests/sigil-avatar-interactions.sh
```

But the intended slice should be deterministic and behavior-preserving.

## Stop Conditions

Stop and report a blocker if:

- a useful UX tree requires changing live routing first;
- current radial config cannot be represented without duplicating source of
  truth;
- binding references cannot be validated without inventing a much larger
  command system;
- workbench projection would require building a full editor UI;
- any required step would add user-authored executable code.

## Completion Report Required

Report:

- branch, base SHA, and head SHA;
- whether the branch was pushed;
- files changed by phase;
- UX tree schema/helper names and exported APIs;
- where Sigil exposes the read-only UX tree;
- which current bindings and commands are represented;
- shadow resolver coverage and parity claims;
- workbench/editor readiness surface added or explicitly deferred;
- tests run with pass/fail/skip details;
- compatibility and behavior-preservation notes;
- final `git status --short --branch`;
- first recommended follow-up for actual binding cutover.
