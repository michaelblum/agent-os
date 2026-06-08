# Work Card: Toolkit 3D Radial Menu Workbench V0

## Tracker

- Active GitHub issue: #365, "Epic: Toolkit 3D radial menu workbench and
  Sigil showcase".
- Related umbrella: #223 AOS Surface System.
- Related behavior epic: #295 Display-first Annotation Mode and Sigil reticle.
- Related adapter tracker: #297 Annotation projection and subject-address
  adapters.
- Historical Sigil avatar configuration tracker: #75, now superseded by the
  parked-legacy avatar configuration boundary. New avatar configuration work
  should get a fresh product decision and issue.
- Prior implementation slice:
  `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`.
- Prior design slice:
  `docs/design/work-cards/sigil-3d-object-graph-platform-contract-v0.md`.

This is intentionally a long-running implementation card. Do not stop after a
design note unless a hard blocker prevents implementation. The expected output
is a cohesive V0 toolkit stack plus Sigil migration/proof.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the 3D radial menu a reusable toolkit workbench/menu-expression capability,
with Sigil's radial menu as the first showcase consumer.

The architecture must support drilling from a Sigil subject into radial menu
configuration, logical menu items, 3D expression data, preview/stage, object
registry, transforms, effects, and animation controls through subject facets,
linked resources, and workbench hosts. It must not turn every radial menu item
or 3D object part into a wiki graph node by default.

The current reticle/camera item behavior must remain intact. In particular,
the reticle menu item face/glyph should keep facing the camera through resolved
3D item config and renderer behavior, not through an untracked one-off patch.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `shared/schemas/radial-menu-3d.schema.json`
- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `shared/schemas/aos-workbench-subject.schema.json`
- `shared/schemas/aos-workbench-subject-vnext.md`
- `shared/schemas/aos-subject-capabilities.md`
- `docs/design/aos-grand-unification-plan.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`, if present
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-review-corrections-v0.md`
- `docs/design/work-cards/sigil-3d-object-graph-platform-contract-v0.md`
- `docs/design/work-cards/sigil-3d-thing-editor-subjects-v0.md`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- `packages/toolkit/runtime/radial-gesture.js`
- `packages/toolkit/runtime/radial-item-transition.js`
- `packages/toolkit/runtime/stack-menu.js`
- `packages/toolkit/adapters/zag/menu.js`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-entry-handle.js`
- `packages/toolkit/workbench/subject-controls.js`
- `packages/toolkit/workbench/subject-graph.js`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu/item-registry.js`
- `apps/sigil/renderer/radial-menu/items/*.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `apps/sigil/radial-item-editor/README.md`
- `apps/sigil/radial-item-editor/model.js`
- `apps/sigil/radial-item-editor/index.js`
- `apps/sigil/radial-item-workbench/index.js`

## Rediscover State

Run these before editing:

```bash
git status --short --branch
git log --oneline -8 --decorate
./aos ready
./aos dev recommend --json
./aos dev gh issue view 365 --json
./aos dev gh issue view 223 --json
./aos dev gh issue view 295 --json
./aos dev gh issue view 297 --json
rg -n "radial_menu|radial menu|radial-menu|canvas_object|Subject Entry|subject_entry|subject_references|facets|createAosZagMenu|createStackMenu|three.*facing|facing.*camera|reticle" docs packages/toolkit apps/sigil shared tests
```

At Foreman handoff time, repo-mode live readiness had recently reported an
inactive input tap. Rediscover rather than assuming it is still blocked. If
`./aos ready` is blocked by macOS TCC/input-tap state, continue deterministic
implementation and report the exact blocker for live verification. Do not run
repeated ad-hoc repair loops.

## Current Baseline

The repo already has useful pieces, but they do not yet form the clean
abstraction stack the product needs:

- `packages/toolkit/runtime/radial-gesture.js` is a neutral radial pointer and
  phase model. Preserve that boundary.
- `packages/toolkit/runtime/radial-menu-config.js` and
  `packages/toolkit/runtime/radial-menu/default-3d.json` are renderer-neutral
  radial menu config pieces. They should become part of the toolkit contract,
  not a dead fixture.
- `shared/schemas/radial-menu-3d.schema.json` is the current schema starting
  point. Update it if the V0 contract changes.
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json` and
  `apps/sigil/renderer/radial-menu/items/*` are Sigil-specific expression and
  rendering modules. Keep Sigil-specific Three.js code in Sigil.
- `apps/sigil/radial-item-editor/model.js` already exposes a
  `sigil.radial_menu.item_3d` workbench subject with `canvas_object.registry`,
  transform, effects, visibility, preview, and lock-in facets.
- `apps/sigil/radial-item-workbench/` appears to be the newer/current
  workbench surface. Inspect both `radial-item-editor/` and
  `radial-item-workbench/` and make an explicit compatibility decision.
- `packages/toolkit/adapters/zag/menu.js` is useful for DOM/AX menu projection,
  but it is not currently the 3D radial renderer foundation.
- `docs/design/aos-grand-unification-plan.md` currently contains examples that
  can be read as a literal subject chain from wiki to radial item to object.
  That wording must be reconciled with the desired facet/resource model.

## Required Architecture

### Layer Ownership

Keep the stack boundaries explicit:

- Daemon/kernel owns native primitives: canvas lifecycle, content serving,
  display topology, input streams, coordination, and generic message routing.
  Do not add Sigil, radial menu, avatar, Three.js, or menu-stack policy to
  Swift daemon code unless a missing primitive is genuinely required.
- Toolkit owns reusable policy and contracts: menu models, radial expression
  resolution, workbench subject/facet descriptors, stock editor/workbench
  shells, object-control contracts, DOM/AX/2D projection adapters, and generic
  browser/editor drilldown behavior.
- Sigil owns product expression: avatar personality, radial item modules,
  action routing, concrete Three.js geometry/material/effects, animation
  personality, and app-specific defaults.

### Menu Stack And Projections

Represent the 3D radial menu as an expression of a lower menu model:

- base menu identity, root/parent/stack path, ordered logical items, labels,
  actions, hidden/disabled/checked/current state, submenu references, role
  hints, shortcut/typeahead/focus metadata where relevant, and activation
  target descriptors;
- 3D radial expression data layered on top: orbital placement, menu/item/model
  defaults, geometry refs, materials, hover transforms, activation
  transitions, effects, animation refs, and object-control metadata;
- resolved logical items available to DOM/AX/semantic surfaces and tests
  without importing Three.js or Sigil modules;
- resolved 3D expression data available to Sigil's renderer and item modules.

Zag may be used for ordinary DOM stack menus or an accessibility projection of
the resolved logical menu. Do not put Zag in the Three.js render hot path, and
do not make Zag responsible for radial pointer geometry, drag-to-handoff state,
or per-frame 3D animation.

### Subject, Facet, And Browser Model

Do not promote radial menu/menu item implementation internals as first-class
wiki graph nodes by default.

Use subject descriptors and entry handles this way:

- A source wiki/domain subject such as Sigil or a Sigil avatar may advertise a
  radial-menu facet/resource.
- A radial menu subject/facet may advertise related resources such as base menu
  JSON, 3D expression JSON, resolved logical items, preview/stage, object
  registry, transform/effects controls, animation/effect controls, source notes,
  and export/lock-in actions.
- A specific item can be addressed as a resource path or facet target under the
  menu subject when needed, but it should not become a graph node unless it has
  a durable source document/domain identity.
- Browser trails may look like `wiki:Sigil -> sigil.radial_menu:default
  [facet: menu-config] -> resource:item/wiki-graph -> facet:object-controls`,
  but this is a trail of entry handles, facets, and resources, not a claim that
  every menu item is a wiki node.

Update docs and tests to protect this distinction where practical.

### 3D Viewer/Editor Workbench

Create or adapt a toolkit-owned workbench/editor pattern for 3D radial menus.
It should support these V0 facets/resources:

- menu overview: base logical items, action ids, hidden/disabled state, and
  stack/submenu metadata;
- config JSON: editable or exportable JSON shape for default/app/menu/item
  overrides;
- source notes: concise natural-language description/source metadata for the
  menu/item/object being edited;
- 3D expression preview/stage: an isolated preview of the resolved radial menu
  or selected item using app-provided render adapters;
- object registry: renderer-neutral `canvas_object.registry` data for item or
  menu objects;
- controls: transform, effects, visibility, animation/effect controls, and
  owner actions expressed through toolkit contracts;
- export/lock-in: a behavior-preserving path back to Sigil config when a user
  accepts edits.

The toolkit may own the subject/facet model, shell, control semantics, and
message contracts. Sigil should still own concrete Three.js object creation and
special effects.

## Required Implementation

### 1. Reconcile Docs And Issue Language

Update durable docs where the current wording conflicts with the desired model:

- clarify that subject/browser drilldown is through Subject Entry Handles,
  facets, hosts, and resources;
- avoid examples that imply radial menu items or `canvas_object` parts are
  mandatory graph nodes;
- clarify that Sigil is a showcase consumer, while reusable radial menu and 3D
  editor patterns belong in toolkit;
- clarify Zag's role as DOM/AX/2D projection support, not the 3D radial
  foundation.

Likely docs:

- `docs/design/aos-grand-unification-plan.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- possibly `docs/api/toolkit/components.md`
- possibly `shared/schemas/radial-menu-3d.schema.json` companion docs if a
  schema note exists or is needed

### 2. Harden Toolkit Contracts

Add or update toolkit helpers so consumers can work with a resolved radial menu
without knowing Sigil:

- radial menu subject/facet descriptor helpers, likely under
  `packages/toolkit/workbench/`;
- radial menu expression/resource normalization helpers if they do not belong
  in `runtime/radial-menu-config.js`;
- stable entry-handle/resource conventions for radial menu config, item
  config, 3D expression, preview, object registry, controls, and export;
- logical item projection helpers for DOM/AX/semantic surfaces;
- tests proving toolkit modules do not import Sigil, Three.js, DOM-only
  globals, or Zag unless the helper is specifically a DOM/Zag adapter.

Prefer extending the current `aos.workbench.subject` and `canvas_object.*`
contracts over inventing a parallel object model.

### 3. Build The Toolkit Workbench/Editor Pattern

Create a reusable V0 surface/model/helper layer that a generic browser/editor
can open for a 3D radial menu. The exact UI surface depends on existing code
after inspection, but the V0 must be real enough that Sigil can consume it.

Acceptable outcomes include either:

- a toolkit stock component/workbench surface for radial menu editing; or
- a toolkit model/subject/facet layer plus migrated Sigil workbench surface
  that uses it and leaves only Sigil render/action adapters in app code.

Do not leave the toolkit layer as docs-only. Add focused tests around the
descriptor/model behavior.

### 4. Migrate Sigil As Showcase Consumer

Migrate Sigil radial menu/editor code to consume the toolkit stack while
preserving behavior:

- live radial menu continues using the data-driven JSON resolver;
- item modules remain Sigil-owned leaf adapters;
- action ids and semantics remain stable: context menu, agent terminal,
  annotation mode, annotation camera/snapshot, wiki graph;
- reticle/camera visibility and annotation anchor behavior remain stable;
- the reticle glyph/item face keeps facing the camera;
- radial target semantic surface uses the resolved logical menu items rather
  than a hand-maintained parallel list;
- radial item editor/workbench exposes the new toolkit facets/resources while
  preserving existing launch and lock-in flows;
- if both `radial-item-editor/` and `radial-item-workbench/` are live, either
  align both or clearly retire one with compatibility wrappers and docs/tests.

### 5. Browser/Subject Drilldown

Add the minimal generic drilldown path needed to prove the model:

- from a Sigil/avatar subject or related browser entry, expose a radial menu
  entry handle/facet/resource;
- allow opening the radial menu workbench/editor from that handle;
- allow navigating to selected item config and object-control facets without
  adding wiki graph nodes for every item;
- keep links to real source files or wiki docs as links/resources inside the
  subject/facet model.

If a full browser-hosted wiki subject browser is not ready for this exact path,
implement the reusable descriptors/helpers and a deterministic test fixture
that proves the drilldown payload is shaped correctly. Do not block the whole
slice on a UI that is outside this work card.

## Suggested Implementation Areas

Adjust after reading the code, but likely files include:

- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/workbench/index.js`
- `packages/toolkit/workbench/subject.js`
- `packages/toolkit/workbench/subject-entry-handle.js`
- new `packages/toolkit/workbench/radial-menu-subject.js`
- new or updated toolkit radial menu workbench/component surface under
  `packages/toolkit/workbench/` or `packages/toolkit/components/`
- `shared/schemas/radial-menu-3d.schema.json`
- `shared/schemas/aos-workbench-subject.schema.json`, only if the generic
  subject schema truly needs extension
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `docs/design/aos-grand-unification-plan.md`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `apps/sigil/renderer/radial-menu/item-registry.js`
- `apps/sigil/renderer/radial-menu/items/*.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `apps/sigil/radial-item-editor/model.js`
- `apps/sigil/radial-item-editor/index.js`
- `apps/sigil/radial-item-workbench/index.js`
- focused tests under `tests/toolkit/` and `tests/renderer/`

## Hard Boundaries / Non-Goals

- Do not add Sigil, radial menu, avatar, or Three.js policy to the daemon.
- Do not move concrete Sigil item modules, visual personality, or app actions
  into `packages/toolkit/`.
- Do not make toolkit runtime import Three.js, Sigil files, app actions, or DOM
  globals.
- Do not put Zag in the Three.js render hot path.
- Do not make radial menu/menu item internals first-class wiki graph nodes by
  default.
- Do not create a separate object-control contract that bypasses
  `canvas_object.*` unless the existing contract is proven insufficient and the
  docs/schema are updated.
- Do not introduce npm dependencies.
- Do not execute arbitrary code from JSON. Keep module refs allowlisted.
- Do not rename Sigil actions, semantic ids, or visible labels unless required
  by a failing compatibility path and called out in the completion report.
- Do not revive parked legacy Sigil `chat/` or historical `workbench/`
  behavior unless a direct import/test breaks and the fix is mechanical.
- Do not run destructive git commands or discard unrelated dirty work.

## Acceptance Criteria

- #365 has a concrete implementation in the repo, not just a design note.
- Toolkit exports/documentation cover a reusable 3D radial menu/menu-expression
  and workbench subject/facet model.
- Sigil radial menu is a consumer/showcase of the toolkit contract.
- Sigil-specific Three.js item modules and action handlers remain in Sigil.
- Resolved logical menu items can be projected to semantic/DOM/AX surfaces
  independently from 3D rendering.
- Workbench/browser drilldown can reach radial menu config, selected item
  config/resource, 3D preview/stage, object registry, transform/effects,
  visibility, animation/effect controls, and export/lock-in behavior through
  facets/resources.
- The wiki/browser graph boundary is documented and tested enough that menu
  internals are not treated as graph nodes by default.
- The reticle menu item face/glyph faces the camera after migration.
- Existing Sigil radial behavior is preserved for context menu, agent terminal,
  annotation mode, annotation camera/snapshot, and wiki graph activation.
- Existing deterministic tests still pass, and new tests cover the toolkit
  subject/facet contract and Sigil migration path.

## Verification

Run the focused deterministic set first. Adjust exact files after inspection,
but include equivalents for every changed area:

```bash
./aos dev recommend --json
node --check packages/toolkit/runtime/radial-menu-config.js
node --check packages/toolkit/workbench/index.js
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/radial-gesture-menu.js
node --check apps/sigil/renderer/live-modules/radial-gesture-visuals.js
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --check apps/sigil/radial-item-editor/model.js
node --test tests/toolkit/runtime-radial-gesture.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
git diff --check
```

Add or update focused tests for:

- radial menu subject/facet descriptor normalization;
- Subject Entry Handle formatting/parsing for radial menu facets/resources;
- base menu logical item projection independent of Three.js/Sigil;
- 3D radial expression resolution with default/app/item override cascade;
- object registry/control facet exposure through `canvas_object.*`;
- Sigil radial target surface consuming resolved logical items;
- reticle `three.item.facing: "camera"` or equivalent camera-facing behavior
  surviving resolution and renderer application;
- browser/drilldown fixture proving menu/item/object resources are facets or
  resources, not wiki graph nodes by default;
- no toolkit runtime import of Three.js or Sigil modules.

If Swift/shared IPC code changes or any command/test executes `./aos` through a
changed Swift path, run:

```bash
./aos dev build
```

If `./aos ready` passes, run the bounded Sigil live smoke:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Then capture or report live evidence for:

- radial menu opens through the human-facing path;
- reticle item face/glyph is camera-facing, not edgewise;
- semantic radial child surface exposes menu items from resolved logical data;
- context menu, agent terminal, annotation mode, camera/snapshot, and wiki graph
  activations still route correctly;
- new or migrated workbench/editor opens from the radial menu subject/facet
  path, if live hosting is ready.

If live readiness is blocked, report the exact `./aos ready` output and do not
claim live visual acceptance.

## Completion Report

Return a path-scoped report with:

- issue/work-card implemented;
- files changed, grouped by toolkit runtime, toolkit workbench/component,
  schemas/docs, Sigil renderer, Sigil editor/workbench, and tests;
- final public contract names and export paths;
- final radial menu subject/facet/resource shape, with one example tooling context;
- how the implementation avoids wiki graph node pollution;
- how Zag is used or intentionally not used;
- how Sigil remains a leaf showcase consumer;
- how reticle camera-facing behavior is represented and verified;
- exact tests run with pass/fail results;
- live AOS smoke result or exact readiness blocker;
- unrelated dirty/untracked state observed;
- remaining follow-up slices only if a hard blocker forced deferral.
