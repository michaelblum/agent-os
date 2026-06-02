# Work Card: Sigil 3D Object Graph Platform Contract V0

## Routing Status

Historical / do not route as-is.

This design-card slice predates the accepted visual-object architecture closure,
the current avatar object-control adapter, and the accepted `21dc331d` detached
Sigil avatar controls panel. Its follow-on sequence is stale.

Current routing sequence:

1. Finish and accept
   `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
2. Route
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.
3. Refresh any remaining Wiki graph browser, 3D thing editor, or semantic
   target cleanup card against the accepted resource migration head.

Strict contract rule for this workstream: migrate owned Sigil/toolkit callers in
the same slice and delete private aliases or old vocabulary. Compatibility is
allowed only for a named external consumer, release boundary, or migration
window with an explicit removal gate.

## Historical Tracker

- Historical branch, do not use:
  `gdi/sigil-radial-menu-data-driven-3d-config-v0`
- Historical prerequisite head:
  `7bc5605e92b8123f7518dd5d301ff229b719ca8b`
- Product/platform direction from Michael:
  Sigil should be a great product and a showcase for the AOS toolkit stack.
  The radial menu data-driven 3D config is one slice of a larger golden stack:
  AOS primitives, toolkit reusable policy/contracts, and Sigil app expression.
- Related current contracts:
  - `shared/schemas/canvas-object-control.schema.json`
  - `shared/schemas/canvas-object-control.md`
  - `docs/api/toolkit/components.md`
  - `docs/api/toolkit/runtime.md`
- Related current Sigil precedents:
  - `apps/sigil/radial-item-editor/model.js`
  - `apps/sigil/renderer/live-modules/radial-object-control.js`
  - `apps/sigil/context-menu/menu.js`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Continue from the current radial-menu branch unless Foreman or the
human explicitly routes this work elsewhere.

## Historical Goal

Turn the "3D thing" idea into a concrete platform contract and migration plan.

Sigil now has two adjacent 3D editing worlds:

- radial menu items, which already expose an isolated 3D workbench subject and
  use `canvas_object.registry`, transform patches, and effects patches;
- the avatar/context-menu path, which edits Sigil's 3D avatar, tesseron,
  phenomena, visual effects, and world state through hard-coded context menu DOM
  controls and direct `state.*` mutations.

The output of this slice is a provider-neutral design note plus follow-on work
cards that align both paths under one reusable object-graph/editing stack. Do
not build the full implementation in this slice.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `docs/api/toolkit/components.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-v0.md`
- `docs/design/work-cards/sigil-radial-menu-data-driven-3d-config-review-corrections-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
rg -n "canvas_object|radial item editor|context menu|state\\.|onAppearanceChange|updateGeometry|effects.patch|transform.patch|tesseron|phenomena|avatar" apps/sigil packages/toolkit shared/schemas docs tests
```

This is primarily a design and routing slice. Run `./aos ready` only if you need
live canvas evidence for a claim in the design note.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/radial-object-control.js` - current
  concrete object registry and transform/effects patch adapter for radial menu
  3D objects.
- `apps/sigil/radial-item-editor/model.js` - current isolated radial item
  workbench subject model using `canvas_object.*` contracts.
- `tests/renderer/radial-object-control.test.mjs` - regression coverage for the
  registry and patch adapter.
- `tests/renderer/radial-item-editor.test.mjs` - regression coverage for the
  isolated editor subject model.
- `shared/schemas/canvas-object-control.schema.json` - existing generic object
  control message envelope.
- `shared/schemas/canvas-object-control.md` - existing owner-publishes,
  controller-patches, owner-acknowledges contract.
- `docs/api/toolkit/components.md` - public toolkit documentation for
  addressable canvas object control and object transform/effects panels.
- `apps/sigil/context-menu/menu.js` - current context menu implementation. It
  uses toolkit menu/control helpers, but the actual controls are hard-coded and
  mutate Sigil state directly.
- `tests/renderer/context-menu-hit-test.test.mjs` - current deterministic
  context menu regression coverage.
- `apps/sigil/renderer/state.js` - current avatar/radial/default state shape.
- `apps/sigil/renderer/appearance.js` - current persisted/default appearance
  shape.
- `apps/sigil/renderer/phenomena.js` - current effect/phenomena ownership.
- `apps/sigil/renderer/tesseron.js` - current tesseron geometry/effect
  ownership.
- `apps/sigil/renderer/live-modules/main.js` - avatar-main renderer boundary and
  the place where a future avatar object graph adapter may need to attach.

## Current Observations

`canvas_object` is already the nucleus of the abstraction. It can advertise
addressable objects, transform controls, visibility/effect capabilities, and
patch results without putting Three.js or Sigil policy in the daemon.

The radial item editor already behaves like a prototype "3D thing editor": it
loads a subject, builds an object registry, applies patches through a renderer
adapter, and lets the object be viewed in isolation.

The context menu has not crossed that boundary yet. It is currently a large
Sigil-owned DOM surface that maps controls directly to avatar and world state
fields. That makes it useful product UI, but not yet a reusable demonstration
of the AOS toolkit stack.

## Required Design Output

Create a design note at:

```text
docs/design/aos-3d-object-graph-platform-contract.md
```

The note should be concise but specific enough for implementation work. It must
cover these sections.

### Layer Ownership

Define the stack boundary in AOS terms:

- AOS daemon/kernel owns canvas lifecycle, content serving, input streams,
  display topology, generic message fan-out, and semantic capture. It must not
  know Three.js, Sigil avatar state, radial menu items, tesserons, or context
  menu product behavior.
- Toolkit owns the reusable object graph/editing contract: subject descriptors,
  object registries, transform/effects/control descriptors, isolated preview
  stages, controller panels, action routing, and owner-publishes /
  controller-patches / owner-acknowledges lifecycle.
- Sigil owns product expression: avatar identity, radial item modules,
  tesseron/phenomena choices, default appearance, context menu composition, and
  app-specific action semantics.

### Contract Shape

Describe a V0 "3D object graph" or "3D thing" contract that grows out of
`canvas_object` instead of replacing it abruptly. The design should name the
minimum entities and fields implementation work needs, for example:

- subject id/type, owner canvas, display mode, and preview profile;
- graph nodes with stable ids, parent ids, kind, labels, semantic roles, and
  optional source module/config references;
- local/world transform descriptors and editable transform controls;
- geometry/model/material/effect descriptors that remain renderer-neutral;
- animation/effect controls with value schemas and patch semantics;
- visibility/lock/read-only capability flags;
- action bindings for app-owned behaviors;
- result/acknowledgement semantics and error shape.

Be explicit about what should stay in `canvas_object.*` as the generic wire
contract and what, if anything, should become a higher-level toolkit subject or
schema on top of it.

### Avatar Adapter Inventory

Inventory the current Sigil avatar/context-menu state that would become an
avatar object graph adapter. Include at least:

- base avatar geometry/shape/color/material state;
- tesseron controls;
- aura, pulsar, gamma, accretion, neutrino, lightning, magnetic, wormhole, omega
  and trail-style effects;
- world/window-level controls where they are product context rather than object
  graph properties;
- current persistence homes in `state.js` and `appearance.js`;
- current renderer ownership in `main.js`, `phenomena.js`, and `tesseron.js`.

The inventory should make clear which controls are object graph transform or
effect patches, which are app actions, and which are context-menu-only product
commands.

### Context Menu Migration Path

Define how the Sigil context menu should move from hard-coded direct mutation
to a data/action-driven surface without losing its product feel. Include a
staged path, not one large rewrite.

The plan should explain how a context menu item/control eventually maps to:

- a toolkit control descriptor;
- a `canvas_object` or object-graph patch;
- a Sigil-owned action handler;
- a persisted appearance update;
- a renderer sync step.

### Shared 3D Editor Path

Define how the existing radial item editor can become the first consumer of a
more general "3D thing editor" without making Sigil generic or bland. The plan
should explain how the same editor/stage can load:

- a radial menu item subject;
- an avatar subject;
- a future app-owned 3D subject.

The shared editor path should keep app-owned modules responsible for concrete
Three.js creation/update logic.

## Follow-On Work Cards To Create

Create at least these follow-on cards under `docs/design/work-cards/`. Keep
them narrow enough that GDI can execute them independently.

1. `sigil-avatar-object-graph-adapter-v0.md` - expose the Sigil avatar as an
   object graph/`canvas_object` subject without changing context menu behavior.
2. `sigil-context-menu-data-driven-controls-v0.md` - refactor the context menu
   control definitions and update routing to consume descriptors/actions while
   preserving the current UI and behavior.
3. `sigil-3d-thing-editor-subjects-v0.md` - generalize the radial item editor
   subject loader/stage so it can load both radial item and avatar subjects.

If rediscovery shows a smaller prerequisite is necessary, create that card too
and explain why.

## Acceptance Criteria

- The new design note gives a clear AOS/toolkit/Sigil ownership model.
- The design note treats existing `canvas_object` as live precedent, not
  throwaway work.
- The design note identifies the minimum V0 object graph contract and where it
  lives.
- The avatar/context-menu inventory is grounded in current files, not only a
  conceptual sketch.
- The context menu migration path is staged and behavior-preserving.
- The follow-on cards are actionable and include read-first files, hard
  boundaries, verification, and completion-report sections.
- No feature implementation is mixed into this design slice except tiny docs or
  test fixture adjustments that are needed to make the contract precise.

## Hard Boundaries / Non-Goals

- Do not build a generic 3D engine.
- Do not move Three.js rendering into the daemon.
- Do not rewrite `apps/sigil/context-menu/menu.js` in this slice.
- Do not break or remodel the radial item editor.
- Do not change Sigil avatar defaults or persisted appearance behavior.
- Do not introduce new runtime dependencies.
- Do not add app-specific windowing, Sigil behavior, or context menu policy to
  the daemon.
- Do not treat `_dev` demos as canonical.

## Suggested Implementation Areas

Likely edits:

- add `docs/design/aos-3d-object-graph-platform-contract.md`;
- add the follow-on work cards under `docs/design/work-cards/`;
- optionally update `shared/schemas/canvas-object-control.md` or
  `docs/api/toolkit/components.md` only if the design exposes a small missing
  clarification in the existing public contract.

Avoid code edits unless you discover a tiny docs/test naming issue that blocks
the design note from being coherent.

## Verification

Minimum for a docs/card-only slice:

```bash
git diff --check
```

If any code, schema, or public API doc is changed, also run the relevant subset:

```bash
node --test tests/schemas/canvas-object-control.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
bash tests/help-contract.sh
```

If `./aos ready` is clean and you use live evidence in the design note, report
the exact command and result. If readiness is blocked, do not route a
permission-repair loop for this design slice unless live evidence is actually
needed.

## Completion Report

Include:

- files changed;
- short summary of the proposed V0 object graph contract;
- how the design separates AOS daemon, toolkit, and Sigil ownership;
- follow-on cards created;
- tests/checks run with exact results;
- whether any local-only state exists;
- recommended next owner and first implementation slice.
