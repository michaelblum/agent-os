# Sigil UX Tree Pre Toolkit Adoption Closure V0

## Recipient

Implementer.

## Transfer Kind

Implementation round.

## Single Goal

Finish the Sigil-side UX tree operating-model proof so the project is ready to
start toolkit-wide adoption in a later slice.

This is a multi-phase closure card. It should complete the remaining Sigil
interaction cutovers and readiness gates, but it must stop before converting
toolkit controls/components/panels to emit their own UX tree fragments.

## Branch / Base

- `branch_from`: `implementer/sigil-ux-tree-trigger-anchor-relations-v0`
- `required_start_ref`: `origin/implementer/sigil-ux-tree-trigger-anchor-relations-v0`
- `implementation_base_sha`: `f84276ea9ada95ae1d181a2ddb904fbf61659ffc`
- Expected output branch: `implementer/sigil-ux-tree-pre-toolkit-adoption-closure-v0`
- This is stacked on PR #387, which is stacked on #386, #385, #384, #383, and
  #382.
- Commit the completed slice. Push the output branch for review if branch-push
  credentials are available. Do not open a PR unless explicitly reassigned.

## What "Ready For Toolkit Adoption" Means

After this slice, Sigil should be a credible reference implementation of the
operating model:

```text
UX tree nodes
  -> bindings
  -> generic relations
  -> allowlisted command adapter
  -> existing runtime functions
```

The desired checkpoint is:

- Sigil's user-visible avatar, context-menu, Selection Mode, radial-menu,
  reticle/camera, wiki graph, and terminal launch interactions are represented
  in the UX tree.
- Remaining direct runtime branches are classified as gesture recognition,
  physics/state-machine mechanics, guards, fallback, or platform plumbing rather
  than unmodeled user-facing bindings.
- No avatar-specific canvas ownership assumption is required to understand
  trigger/anchor/target relationships.
- Debug/tests can prove what is already data-routed and what remains direct by
  design.
- Toolkit adoption can begin next by asking toolkit controls/components/panels
  to emit their own UX tree fragments.

Do not start that toolkit adoption here.

## Read First

- `docs/design/work-cards/sigil-ux-tree-trigger-anchor-relations-v0.md`
- `docs/design/work-cards/sigil-ux-tree-context-menu-bindings-cutover-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/context-menu-input.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-menu-activation.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `packages/toolkit/runtime/ux-tree.js`
- `packages/toolkit/workbench/ux-tree-subject.js`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/sigil-context-menu-input.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-menu-activation.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

## Current Completed Baseline

These paths have already been cut over to the UX tree command adapter:

- Selection Mode Escape.
- Selection Mode Enter/Return.
- Selection Mode Tab/ArrowUp/ArrowDown.
- Selection Mode non-avatar left-click acquire.
- Context-menu right-click open/toggle.

These model pieces exist:

- `aos_ux_tree` schema/runtime/toolkit helpers.
- Strict command handler refs and allowlisted execution.
- Generic relations: `triggers`, `opens`, `anchors`, `targets`, `owns`.
- Sigil projection for avatar/context-menu/radial-menu/Selection Mode
  relations.

## Remaining Pre-Adoption Work

### Phase 1: Add A Sigil UX Routing Readiness Audit

Create a small deterministic audit helper for Sigil's UX tree and runtime
adapter status. Suggested location:

- `apps/sigil/renderer/live-modules/ux-tree-readiness.js`

The audit should answer, as data:

- Which UX tree commands have registered runtime handlers?
- Which UX tree bindings are intentionally routed through the UX command
  adapter?
- Which bindings remain direct, and why?
- Which direct paths are guards/gesture recognition/state-machine mechanics
  rather than user-editable command bindings?
- Which relations describe trigger/anchor/target-surface topology?

Expose the result in debug state, for example:

- `window.__sigilDebug.snapshot().uxTreeReadiness`
- `window.__sigilDebug.uxTreeReadiness()`

Add tests that fail if a binding is neither:

- routed through the UX command adapter;
- explicitly deferred with a reason; nor
- explicitly classified as a non-command runtime mechanic.

Keep this audit Sigil-local. Do not require toolkit controls to adopt it yet.

### Phase 2: Complete Command Registry Coverage For Sigil Commands

Extend the Sigil command registry so every command currently emitted by
`apps/sigil/renderer/live-modules/ux-tree.js` has an explicit status:

- executable through a registered allowlisted handler;
- intentionally shadow-only/deferred with a reason; or
- not a user-facing command and should be renamed/removed from the UX tree.

At minimum, decide and implement the status for:

- `sigil.avatar.goto.begin`
- `sigil.radial.begin`
- `sigil.radial.release_item`
- `sigil.selection_mode.enter`
- `sigil.annotation_reticle.enter`
- `sigil.annotation_camera.capture_bundle`
- `sigil.wiki_graph.open`
- `sigil.agent_terminal.open`

Prefer real allowlisted handlers where the runtime function already exists and
the behavior can be preserved. If a command name is too coarse or misleading,
rename/split it in the UX tree and tests rather than preserving stale
vocabulary.

Hard safety rule: the UX tree still names commands only. Runtime closures remain
in the Sigil registry. No eval, dynamic imports, or executable tree values.

### Phase 3: Cut Over Remaining Low-Risk Sigil Bindings

Cut over remaining user-facing Sigil bindings that can be safely routed through
the adapter without changing behavior.

Expected candidates:

- avatar double-click in `GOTO` enters Selection Mode;
- avatar left press/release GOTO behavior, if the route can be expressed
  clearly without lying about command names;
- avatar drag-threshold radial begin;
- radial menu item release/action dispatch;
- radial target surface item click dispatch;
- radial camera recovery click path, if it can share the same command handler
  without weakening recovery behavior.

Do not force a bad abstraction. Gesture recognition and physics may remain
direct mechanics if they are explicitly classified by the readiness audit. For
example, radial hover/fast-travel movement and target-surface pointer tracking
are probably state-machine mechanics, not user-editable commands.

For each cutover:

- keep the existing guard order;
- keep explicit fallback to the old direct runtime function;
- record `ux-command` debug evidence;
- add deterministic tests around route decision and command execution.

### Phase 4: Route Radial Item Actions Through Commands

The radial menu should not remain a private switchboard of item actions once the
relations model exists. Route radial item release/action handling through the
same command adapter where practical.

Target actions:

- context menu item -> `sigil.context_menu.open`
- agent terminal item -> `sigil.agent_terminal.open`
- annotation mode item -> `sigil.annotation_reticle.enter`
- annotation camera item -> `sigil.annotation_camera.capture_bundle`
- wiki graph item -> `sigil.wiki_graph.open`

Keep radial gesture math and item hit detection in the radial runtime. The
cutover target is action dispatch after the runtime has identified the committed
item.

The gesture release path and radial target-surface click path should converge
on the same item-action dispatch helper so they cannot drift.

### Phase 5: Tighten UX Tree Relations Around Radial Items

After radial item action dispatch is routed, update Sigil's relation projection
if needed so the model expresses:

- avatar body triggers radial menu;
- avatar anchors radial menu;
- radial menu targets radial item collection;
- each radial item invokes or maps to its command;
- radial target surface is implementation metadata, not conceptual ownership.

If relation vocabulary needs one more generic type such as `invokes`, add it
only if it improves the model for more than Sigil. Otherwise keep invocation in
bindings/commands and avoid relation creep.

### Phase 6: Remove Or Mark Stale Duplicate Paths

Clean up dead or misleading code created by the incremental cutover.

Examples:

- duplicate route helpers that can be unified;
- stale comments claiming a path is shadow-only after it is live-routed;
- debug names that imply avatar-specific canvas ownership;
- UX tree commands that no longer correspond to a real command.

Do not remove direct fallback paths unless tests prove the command adapter path
and old direct path are equivalent. Fallback can remain for safety, but it must
be explicit and observable.

### Phase 7: Durable Docs And Adoption Gate

Add a short durable note that names the handoff point before toolkit adoption.
Suggested file:

- `docs/design/sigil-ux-tree-pre-toolkit-adoption-closure-v0.md`

It should summarize:

- what Sigil now proves;
- what is deliberately not toolkit adoption yet;
- how toolkit adoption should start next;
- what tests/debug views show the readiness state;
- any remaining explicit Sigil-only exceptions.

Update existing UX tree docs only as needed. Avoid broad narrative churn.

## Hard Boundaries

- Do not start converting toolkit controls/components/panels to emit UX tree
  fragments.
- Do not add persistence, user-editable settings, or editor UI.
- Do not change radial menu visuals, geometry, or physics.
- Do not change Selection Mode behavior.
- Do not change context menu layout or item behavior.
- Do not remove fallback unless the old and new paths are proven equivalent.
- Do not introduce dynamic command execution.
- Do not model canvas IDs as conceptual ownership. Canvas/input-region IDs stay
  in hit-source or target-surface implementation metadata.

## Acceptance Criteria

- Sigil has a deterministic UX tree readiness audit.
- Every Sigil UX tree binding/command is routed, deferred with a reason, or
  classified as non-command runtime mechanics.
- Remaining safely routable Sigil-owned bindings are routed through the UX tree
  command adapter.
- Radial item action dispatch is command-adapter based or explicitly deferred
  with a documented reason.
- Gesture/physics/direct runtime mechanics are named as mechanics, not hidden
  user-facing bindings.
- Debug state exposes the readiness audit and recent command/fallback evidence.
- Existing stacked behavior remains unchanged.
- A short design note marks the point where toolkit adoption can begin next.

## Suggested Tests

Add or update tests for:

- readiness audit covers every command and binding in `createSigilUxTree()`;
- no unclassified direct user-facing binding remains;
- avatar double-click Selection Mode entry command path, if cut over;
- radial begin command path, if cut over;
- radial item action dispatch for context menu, terminal, reticle, camera, and
  wiki graph;
- radial target-surface click and gesture release share dispatch semantics;
- fallback paths record fallback evidence and call the old direct behavior;
- existing relation tests still prove trigger/anchor/target separation;
- existing Selection Mode/context-menu tests still pass.

Avoid source-text-only assertions where behavior can be tested through exported
pure helpers. Source-text assertions are acceptable only for guarding broad
runtime integration that is otherwise hard to instantiate in Node.

## Verification

Run at least:

```bash
./aos dev recommend --json --files \
  apps/sigil/renderer/live-modules/main.js \
  apps/sigil/renderer/live-modules/ux-tree.js \
  apps/sigil/renderer/live-modules/ux-tree-command-registry.js \
  apps/sigil/renderer/live-modules/selection-mode-input.js \
  apps/sigil/renderer/live-modules/context-menu-input.js \
  apps/sigil/renderer/live-modules/radial-gesture-menu.js \
  apps/sigil/renderer/live-modules/radial-menu-target-surface.js \
  tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs

node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/ux-tree.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/selection-mode-input.js
node --check apps/sigil/renderer/live-modules/context-menu-input.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --test tests/renderer/sigil-ux-tree.test.mjs \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs \
  tests/renderer/sigil-context-menu-input.test.mjs \
  tests/renderer/radial-gesture-menu.test.mjs \
  tests/renderer/radial-menu-activation.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/renderer/radial-object-control.test.mjs \
  tests/renderer/radial-item-editor.test.mjs \
  tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/runtime-ux-tree.test.mjs \
  tests/toolkit/ux-tree-subject.test.mjs \
  tests/schemas/aos-ux-tree-v0.test.mjs
git diff --check
```

Run broader checks if changed files imply them:

```bash
node --test tests/renderer/*.test.mjs
node --test tests/toolkit/*.test.mjs
node --test tests/schemas/*.test.mjs
./aos dev build
bash tests/help-contract.sh
```

Run `./aos ready`. If it reports a repo-mode TCC/input-tap blocker, stop and
use:

```bash
the manual TCC blocker report path
```

Then rerun:

```bash
./aos ready --post-permission
```

after the human returns with `finished`.

## Stop Conditions

Stop and report instead of forcing the implementation if:

- a remaining binding requires product judgment about its intended user-visible
  semantics;
- a command name would need a breaking schema vocabulary change;
- live behavior would change to complete the cutover;
- radial item dispatch cannot be unified without destabilizing reticle/camera
  behavior.

If one of these occurs, still complete the readiness audit and mark the blocker
as an explicit deferred item with evidence.

## Completion Report

Include:

- branch name;
- head SHA and base SHA;
- changed files;
- list of bindings/commands routed in this slice;
- list of bindings/commands explicitly deferred or classified as mechanics;
- confirmation that toolkit adoption did not start;
- tests and checks run;
- whether the next recommended slice is toolkit read-only UX tree fragments;
- `git status --short --branch`;
- `git show --stat HEAD`.
