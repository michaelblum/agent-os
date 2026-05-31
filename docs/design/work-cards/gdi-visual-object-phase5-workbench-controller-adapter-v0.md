# GDI: Visual Object Phase 5 Workbench Controller Adapter V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 5 mutation/update base:
  `e72524c8ef37a16a1f7d6feda4f3da81e4838086`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Continue Phase 5 by connecting the visual object descriptor mutation result to a
reusable routed workbench/controller adapter.

The previous slice proved:

```text
canonical state graph -> descriptor -> state mutation -> minimal update
```

This slice should prove the next layer:

```text
descriptor edit event -> route dispatch -> state mutation -> renderer_sync handler
```

Build the smallest reusable adapter that lets non-avatar callers bind
`route + renderer_sync` to concrete update handlers without each surface
hand-rolling that bridge. Keep it deterministic and platform-facing. Use radial
menu, 2D canvas-style, and DOM/toolkit slider evidence from the prior slices as
the proof surfaces.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase5-non-avatar-validation-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase5-non-avatar-mutation-updates-v0.md`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/workbench/subject-controls.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/desktop-world-surface-2d.js`
- `packages/toolkit/controls/slider.js`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/subject-controls.test.mjs`
- `tests/toolkit/desktop-world-surface-2d.test.mjs`
- `tests/toolkit/controls-slider-color.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "applyVisualObjectDescriptorMutation|coerceVisualObjectDescriptorValue|renderer_sync|visual_object_descriptors|route|deriveWorkbenchSubjectControls|createRadialMenuVisualObjectDescriptors|createToolkitSliderVisualObjectDescriptor|setValue|applyWorldTransform" packages/toolkit tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this as one broad but reviewable Phase 5 slice:

1. Reusable controller adapter
   - Add a small shared helper that accepts a descriptor, a value, a JSON state
     object, and route/sync handlers.
   - The helper should use `applyVisualObjectDescriptorMutation()` for state
     mutation, then dispatch the descriptor's `route`, then call all relevant
     `renderer_sync` handlers.
   - Return a deterministic result containing descriptor id, state path, route,
     coerced value, previous value, and sync outcomes.
   - Keep it generic. Do not import Sigil avatar code, Three.js, DOM globals, or
     radial runtime modules into the shared helper.

2. Strict coercion correction
   - Tighten boolean coercion in `coerceVisualObjectDescriptorValue()` before the
     helper becomes a reusable bridge. String values like `"false"`, `"0"`, and
     `"off"` must not coerce as truthy booleans.
   - Cover both `boolean` and `boolean_inverse`.
   - Keep invalid values explicit: either define and test the accepted input
     vocabulary or throw for ambiguous strings. Do not rely on JavaScript
     truthiness for descriptor booleans.

3. Radial menu routed proof
   - Use `createRadialMenuVisualObjectDescriptors()` with representative radial
     descriptors.
   - Prove route handlers receive `canvas_object.transform.patch`,
     `canvas_object.visibility.patch`, and `canvas_object.effects.patch` edits
     with the mutation result.
   - Prove renderer sync handlers are invoked in descriptor order or a documented
     deterministic order, and that the mutated radial menu state remains
     JSON-serializable.

4. 2D canvas-style routed proof
   - Use a 2D descriptor and a handler that calls the existing
     `DesktopWorldSurface2D.applyWorldTransform()` path.
   - Prove the same target node/object identity is preserved while the sync
     handler applies the new state.

5. DOM/toolkit routed proof
   - Use `createToolkitSliderVisualObjectDescriptor()` and a handler that calls
     an existing `createSlider()` instance's `setValue()`.
   - Prove the same root element identity is preserved and the control value is
     updated through the routed adapter path.

6. Workbench surface integration
   - If there is a natural, low-risk location, expose the adapter from
     `packages/toolkit/workbench/index.js`.
   - Add enough subject/control coverage to show workbench-facing callers can
     discover descriptors and bind them through the adapter without inventing a
     parallel metadata system.

## Scope

Shared toolkit workbench helpers, visual object contract helper refinements,
focused deterministic tests, and concise docs.

This is not a renderer rewrite, not an avatar optimization pass, and not a live
browser-only route migration.

## Hard Boundaries

- Do not alter Sigil avatar renderer behavior.
- Do not rewrite radial menu runtime rendering.
- Do not migrate all toolkit controls.
- Do not add route compatibility aliases unless a live consumer requires them
  and the removal gate is documented.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.

## Suggested Implementation Areas

Likely paths:

- `packages/toolkit/workbench/visual-object-contract.js`
- optional new `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/workbench/index.js`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `tests/toolkit/visual-object-contract.test.mjs`
- optional new `tests/toolkit/visual-object-controller.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/desktop-world-surface-2d.test.mjs`
- `tests/toolkit/controls-slider-color.test.mjs`
- `tests/toolkit/subject-controls.test.mjs`

Prefer a small adapter with explicit handler maps over a framework-like
abstraction. Tests should make the intended integration contract obvious.

## Verification

Run:

```bash
node --test tests/toolkit/visual-object-contract.test.mjs tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/toolkit/subject-controls.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

Live AOS verification is optional for this deterministic routed-adapter proof.
If runtime descriptor routing changes and `./aos ready --json` passes, run a
bounded smoke proving representative non-avatar descriptor edits route and sync
without replacing their target object. If `./aos ready` reports a repo-mode
TCC/input-tap blocker, stop live-dependent work and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

after the human returns with `finished`.

## Commit And Push

Use path-scoped `git add`. Make one or more scoped commits as needed, but keep
the final diff reviewable:

```bash
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- controller adapter location and summary;
- boolean coercion correction evidence;
- radial menu routed mutation/sync evidence;
- 2D canvas-style routed update evidence;
- DOM/toolkit routed update evidence;
- workbench/subject integration evidence;
- JSON serialization result for routed mutated state;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
