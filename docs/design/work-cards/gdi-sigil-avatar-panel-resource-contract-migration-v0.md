# GDI Work Card: Sigil Avatar Panel Resource Contract Migration V0

## Routing Status

Do not dispatch until
`docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md` has been
accepted. Detached toolkit panels must drag reliably before this panel-based
editing UX is expanded.

When Foreman routes this card, update the `required_start_ref` below to the
accepted live-drag correction head. Do not start from `origin/main`.

## Recipient

GDI implementation round.

## Branch / Base

- `branch_from`: accepted live-drag correction branch/head
- `required_start_ref`: to be filled by Foreman after live-drag acceptance
- `expected_output_branch`: `gdi/sigil-avatar-panel-resource-contract-migration-v0`

## Source Artifacts

- Accepted action bus / detached panel checkpoint:
  `21dc331d7bb4ec77493e77ad32541d0d70ba70a1`
- Active prerequisite:
  `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`
- Current architecture report:
  `docs/dev/reports/aos-visual-object-architecture.md`
- Existing wire contract:
  `shared/schemas/canvas-object-control.md`
- Existing avatar object-control adapter:
  `apps/sigil/renderer/live-modules/avatar-object-control.js`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Migrate the detached Sigil avatar controls panel from the private
`sigil.avatar_panel.*` protocol to the existing AOS visual object/resource
contract, then delete the private protocol and owned stale callers.

The target state is one synchronized avatar resource:

```text
avatar-main owner
  -> publishes canvas_object.registry and visual_object_descriptors
toolkit/Sigil panels
  -> subscribe/read the resource
  -> send canvas_object.transform.patch / canvas_object.effects.patch or
     descriptor-addressed updates
avatar-main owner
  -> validates, applies, emits canonical result and refreshed registry
```

Do not invent `aos.state.*` or a new shared store for this slice. Exhaust the
existing `visual_object_descriptors`, `canvas_object.registry`,
`canvas_object.transform.patch`, `canvas_object.effects.patch`, and
`aos.action` / `canvas.send` transport model first.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `shared/schemas/canvas-object-control.md`
- `shared/schemas/canvas-object-control.schema.json`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/avatar-editor/panel.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/visual-object-binding.js`
- `apps/sigil/renderer/live-modules/avatar-object-control.js`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/runtime/action.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/workbench/visual-object-form-binding.js`
- `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/components/object-transform-panel/model.js`
- `tests/renderer/avatar-object-control.test.mjs`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`
- `tests/schemas/canvas-object-control.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --post-permission
./aos dev recommend --json --paths apps/sigil/avatar-editor/panel.js,apps/sigil/context-menu/menu.js,apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/avatar-object-control.js,packages/toolkit/runtime/action.js
rg -n "sigil\\.avatar_panel|visual_object_descriptors|bindVisualObjectForm|canvas_object\\.(registry|transform\\.patch|effects\\.patch|transform\\.result|effects\\.result)|handlePanelMessage|sendPanelUpdate|canvas.send|aos.action" apps/sigil packages/toolkit tests shared/schemas
```

If live readiness reports a repo-mode TCC, Accessibility, Input Monitoring, or
inactive input-tap blocker, use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, continue
in the same GDI session and run:

```bash
./aos ready --post-permission
```

## Required Behavior

### 1. Use Existing Resource Contracts

- The avatar controls panel consumes the current avatar resource through
  `visual_object_descriptors` and/or `canvas_object.registry`.
- Canonical avatar edits route through `canvas_object.transform.patch`,
  `canvas_object.effects.patch`, or descriptor-addressed controller updates that
  resolve to those canonical routes.
- `avatar-main` remains the owner that validates, applies, emits
  `canvas_object.*.result`, refreshes `canvas_object.registry`, and triggers
  renderer sync.
- `state.avatar.*`, `appearance.js`, and current renderer update hooks remain
  the Sigil-owned source of truth.

### 2. Remove The Private Panel Protocol

Remove the owned private panel transport after migration:

- `sigil.avatar_panel.ready`
- `sigil.avatar_panel.update`
- `sigil.avatar_panel.snapshot`
- `sigil.avatar_panel.tab_change`
- `sigil.avatar_panel.control_change`
- `sigil.avatar_panel.projection_change`
- `sigil.avatar_panel.projection_action`
- `sigil.avatar_panel.close`

Do not keep aliases or compatibility shims for these names unless rediscovery
finds a real external consumer. If a compatibility path is kept, the completion
report must name the consumer and the removal gate.

### 3. Preserve Product Behavior Through The New Contract

- Right-clicking the avatar still opens the detached Avatar panel.
- The panel still has compact avatar controls, title `Avatar`, one close button,
  no minimize/maximize buttons, draggable chrome, and normal focus behavior.
- Canonical control edits still update the live avatar and persisted appearance
  where current behavior does so.
- Projection-only tools remain explicit Sigil actions and are not misrepresented
  as canonical avatar resource edits.
- Child panel canvas input is still treated as inside the Sigil menu while the
  panel is open.
- The Sigil context menu owner snapshot remains accurate enough for outside
  click/routing/lifecycle behavior after panel movement from the prerequisite
  drag fix.

### 4. Keep Contracts Strict

- Migrate owned callers in the same slice.
- Delete old private vocabulary and duplicate target-routing paths.
- Fail loudly in tests if stale `sigil.avatar_panel.*` protocol names remain in
  owned code.
- Do not add a new daemon product branch for Sigil avatar controls.

## Suggested Implementation Shape

Inspect first; do not treat this as a mandate.

- Reuse `buildSigilAvatarCompactSurfaceViewModel()` as the panel's view
  projection if it remains the narrowest way to render the compact surface, but
  source its state/update loop from the canonical descriptor/resource contract.
- Extend or reuse `createVisualObjectBindingAdapter()` so detached panel field
  changes route through owner-managed `canvas_object.*` / descriptor updates
  instead of private panel messages.
- Use `canvas.send` or `aos.action` only as transport for canonical messages,
  not as a new Sigil-specific protocol.
- Let `avatar-main` publish or replay the latest registry/descriptors to the
  panel with retained-state semantics where possible.
- Keep projection-only actions on a Sigil action route with explicit action ids.
- Add a focused stale-protocol test that fails if owned source files still
  contain `sigil.avatar_panel.` after the migration.

## Scope

Sigil avatar controls panel, Sigil avatar owner message handling, avatar
object-control/descriptor routing, focused toolkit runtime glue only if needed,
and deterministic tests.

Wiki graph browser, shared 3D editor subjects, and broad semantic target cleanup
are follow-up slices. Do not route them in this implementation round.

## Hard Boundaries / Non-Goals

- Do not redesign the Avatar panel UI.
- Do not move Three.js renderer ownership into toolkit or daemon code.
- Do not introduce `aos.state.*` or a new shared state service in this slice.
- Do not keep repo-owned compatibility aliases for `sigil.avatar_panel.*`.
- Do not resurrect old embedded context-menu behavior as the primary panel path.
- Do not broaden into Wiki graph browser editing.
- Do not mutate unrelated work cards/reports or generated proof artifacts.

## Verification

Run deterministic checks:

```bash
git diff --check
node --check apps/sigil/avatar-editor/panel.js
node --check apps/sigil/context-menu/menu.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/avatar-object-control.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/toolkit/runtime-action.test.mjs tests/toolkit/aos-action-demo.test.mjs
node --test tests/schemas/canvas-object-control.test.mjs
bash tests/aos-action-bus.sh
```

Add or update a focused regression proving:

- canonical panel control edits route through the resource/descriptor contract;
- owner result messages conform to `canvas-object-control.schema.json` where
  applicable;
- no owned source files still contain `sigil.avatar_panel.` after migration;
- projection-only actions stay explicit Sigil actions.

When `./aos ready --post-permission` passes, run a bounded live smoke:

1. Open Sigil avatar.
2. Right-click to open the Avatar panel.
3. Change one canonical control.
4. Verify the live avatar updates and no stale private panel protocol appears in
   logs or source checks.
5. Move the panel with `./aos do drag` if the prerequisite drag fix changed
   owner bounds behavior.
6. Close the panel and confirm `./aos show list --json` is clean after cleanup.

## Completion Report

Include:

- branch name and head SHA;
- accepted live-drag start ref used;
- changed paths;
- exact contract used for panel read/update/result flow;
- proof that private `sigil.avatar_panel.*` protocol names were removed from
  owned source, or the named external consumer/removal gate for any survivor;
- how projection-only controls route;
- deterministic test commands and pass/fail results;
- live smoke result or exact readiness blocker;
- final cleanup result from `./aos show list --json`;
- recommended next slice: Wiki graph browser read/drilldown, shared 3D editor
  subject refresh, or semantic target cleanup.
