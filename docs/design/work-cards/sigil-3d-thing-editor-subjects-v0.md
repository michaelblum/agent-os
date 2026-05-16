# Work Card: Sigil 3D Thing Editor Subjects V0

## Tracker

- Continue from branch: `gdi/sigil-avatar-object-graph-adapter-v0`
- Accepted prerequisite adapter head:
  `1e4c44c9d34de3ae8d84481c0fe1a88a127c105f`
- Accepted prerequisite context-menu descriptor head:
  `1baf0be1ede3f7adb819ef4366239b46ee256665`
- Foreman review note on 2026-05-16: deterministic checks passed, but
  repo-mode live verification was blocked by `./aos ready` reporting
  `diagnosis=input_tap_not_active`. Keep this slice deterministic unless the
  implementation changes editor launch, canvas subscription, or panel behavior.

## Goal

Generalize the radial item editor subject loader/stage so it can load both
radial item and avatar subjects through a shared 3D thing editor path.

The editor shell should become reusable toolkit-facing policy, while Sigil
modules remain responsible for concrete Three.js creation, update, validation,
and persistence.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-3d-object-graph-platform-contract.md`
- `docs/design/work-cards/sigil-avatar-object-graph-adapter-v0.md`
- `docs/design/work-cards/sigil-context-menu-data-driven-controls-v0.md`
- `apps/sigil/radial-item-editor/model.js`
- `apps/sigil/radial-item-editor/index.js`
- `apps/sigil/radial-item-editor/README.md`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `apps/sigil/renderer/live-modules/avatar-object-control.js`
- `tests/renderer/radial-item-editor.test.mjs`
- `tests/renderer/radial-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline -5 --decorate
./aos dev recommend --json
rg -n "buildRadialItemWorkbenchSubject|canvas_object|subject_type|lock_in|preview|applyEditorObjectPatch|applyEditorEffectsPatch|avatar-object-control|radial-item-editor" apps/sigil tests/renderer docs/design
```

Run `./aos ready` only if the implementation changes live editor launch,
canvas subscription, or panel behavior beyond deterministic model tests.

## Scope

Refactor the current radial item editor model so the subject loader can resolve
subject descriptors for:

- a Sigil radial menu item subject;
- a Sigil avatar subject exposed by the avatar object graph adapter;
- a future app-owned 3D subject that publishes the same contracts.

Keep the existing radial item editor launch path and behavior working. Add the
minimum loader/facet abstraction needed to select a subject, subscribe to or
build its object registry, send transform/effects patches, display owner
results, and export or lock in app-owned changes.

## Hard Boundaries

- Do not make Sigil generic or remove radial item product behavior.
- Do not move Three.js creation/update logic into toolkit.
- Do not change context menu behavior in this slice.
- Do not introduce new runtime dependencies.
- Do not remodel panel/window chrome unless required by the existing editor
  contract.

## Acceptance Criteria

- The existing radial item editor subject still emits the same workbench subject
  contracts and lock-in payload behavior.
- A subject loader abstraction can load a radial item subject and an avatar
  subject descriptor.
- The editor can consume registry, transform patch, effects patch, preview, and
  export/action facets from a subject descriptor instead of hard-coding only
  radial item state.
- App-owned modules remain responsible for concrete renderer creation/update
  and persistence.
- Focused tests cover radial subject compatibility and avatar subject loading.

## Suggested Implementation Areas

- Keep most current logic in `apps/sigil/radial-item-editor/model.js`, but
  isolate radial-specific source handling behind a subject adapter.
- Add an avatar subject adapter that consumes the avatar object graph registry
  without requiring the live context menu.
- Consider whether a tiny toolkit workbench helper is needed only after both
  subject adapters expose the same shape.

## Verification

Run:

```bash
git diff --check
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
```

If the editor launch page or panel behavior changes, launch the editor through
its existing script and report the exact AOS readiness/launch result.

## Completion Report

Report files changed, subject types supported, radial compatibility evidence,
tests run with exact results, any live-launch evidence, local-only state, and
the next owner/slice.
