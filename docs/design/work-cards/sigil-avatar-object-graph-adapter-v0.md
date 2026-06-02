# Work Card: Sigil Avatar Object Graph Adapter V0

## Routing Status

Historical / do not route as-is.

This card predates the accepted avatar object-control implementation now present
in `apps/sigil/renderer/live-modules/avatar-object-control.js` with focused
coverage in `tests/renderer/avatar-object-control.test.mjs`. It also predates
the accepted `21dc331d` Sigil avatar controls panel, which currently uses a
temporary private `sigil.avatar_panel.*` message protocol.

Current sequence:

1. Accept
   `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`.
2. Refresh toolkit panel placement/final-frame reporting, then add Sigil-owned
   avatar avoidance only if the evidence requires it.
3. Refresh and accept
   `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
4. Route the current replacement card:
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.

Do not use this card to preserve old context-menu behavior or to add a second
avatar store. The next implementation must migrate owned Sigil/toolkit callers
to the existing `visual_object_descriptors` and `canvas_object.*` contracts,
delete the private `sigil.avatar_panel.*` route, and fail loudly if stale
internal paths remain. Compatibility is acceptable only for a named external
consumer or release boundary.

## Historical Goal

Expose the live Sigil avatar as an object graph / `canvas_object` subject
without changing context menu behavior. This is an adapter slice, not a UI
rewrite.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `shared/schemas/canvas-object-control.schema.json`
- `shared/schemas/canvas-object-control.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/phenomena.js`
- `apps/sigil/renderer/tesseron.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `tests/renderer/radial-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
rg -n "canvas_object|avatar|tesseron|phenomena|omega|wormhole|trail|appearance|updateGeometry|applyAppearance|snapshotAppearance" apps/sigil shared/schemas docs tests
```

Run `./aos ready` only if live registry fan-out or live canvas evidence becomes
part of the implementation proof. Prefer deterministic adapter tests first.

## Scope

Create a Sigil-owned avatar object graph adapter that can build and publish a
`canvas_object.registry` snapshot for `avatar-main`. Include primary avatar,
primary tesseron child/link objects when enabled/supported, aura/effect groups,
omega secondary shape, omega tesseron objects when enabled/supported, and major
travel/trail effect groups as renderer-neutral nodes.

The adapter should describe controls and capabilities but does not need to make
every field editable in this slice. Prefer read-only registry coverage first,
then add patch support only for the smallest safe set if it is needed by tests.

## Hard Boundaries

- Do not change context menu markup or behavior.
- Do not move Three.js rendering out of Sigil.
- Do not add Sigil/avatar branches to the daemon.
- Do not change avatar defaults, persisted appearance shape, or seed docs.
- Do not make a retired configuration surface the new implementation path.

## Acceptance Criteria

- `avatar-main` can publish a valid `canvas_object.registry` for the avatar
  subject using current `state.js` / `appearance.js` state.
- Registry nodes have stable ids, labels, parent ids where applicable, kind,
  visibility, capabilities, transform or effect descriptors, and source refs.
- The adapter distinguishes object/effect controls from Sigil app actions and
  world/window context.
- Existing radial item object control behavior is unchanged.
- Focused tests cover registry shape and at least one state-to-registry mapping
  for primary avatar, tesseron, phenomena, and omega.

## Suggested Implementation Areas

- Add an adapter near `apps/sigil/renderer/live-modules/avatar-object-control.js`
  or another Sigil renderer-local module.
- Reuse naming and result conventions from
  `apps/sigil/renderer/live-modules/radial-object-control.js`.
- Attach publish/refresh wiring from `apps/sigil/renderer/live-modules/main.js`
  only after boot has initialized enough renderer state.
- Add focused tests under `tests/renderer/`.

## Verification

Run:

```bash
git diff --check
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
```

If live registry fan-out is changed, also run the smallest relevant
`canvas_object` shell test or explain why live daemon evidence is not needed.

## Completion Report

Report files changed, the adapter's registry node inventory, tests run with
exact results, whether context menu behavior was untouched, local-only state,
and the next owner/slice.
