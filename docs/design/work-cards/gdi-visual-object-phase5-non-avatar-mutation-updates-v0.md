# GDI: Visual Object Phase 5 Non-Avatar Mutation Updates V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 5 descriptor validation base:
  `6d589143959262500b2ea14c0fe5a380d227f085`
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

Continue Phase 5 by proving the extracted visual object pattern works as an
actual non-avatar mutation/update loop, not only as descriptor metadata.

Implement or validate a small shared path from visual object descriptor to state
mutation to minimal visual update across existing non-avatar surfaces:

- radial menu config/workbench descriptors as the 3D/non-avatar subject;
- a 2D canvas-style or desktop-world surface update;
- one DOM/toolkit control update, preferably slider value.

The target is deterministic proof of the architecture report's loop:

```text
canonical state graph -> descriptor -> routed mutation -> minimal update
```

Do not rewrite renderers. Prefer small helpers and focused tests that prove
state updates are addressable, JSON-serializable, and applied in place without
recreating the relevant object/DOM node.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase5-non-avatar-validation-v0.md`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/desktop-world-surface-2d.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/controls/slider.js`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/desktop-world-surface-2d.test.mjs`
- `tests/toolkit/runtime-canvas.test.mjs`
- `tests/toolkit/controls-slider-color.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "createVisualObjectDescriptor|createToolkitSliderVisualObjectDescriptor|createRadialMenuVisualObjectDescriptors|validateVisualObjectDescriptors|state_path|route|renderer_sync|setValue|applyWorldTransform|canvas-2d|dom-toolkit|threejs-3d" packages/toolkit tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this as one broad but reviewable Phase 5 slice:

1. Descriptor-driven mutation helper
   - Add the smallest shared helper needed to apply a descriptor-addressed value
     into plain JSON state, or prove an existing helper already does this.
   - The helper must honor the contract fields already in use, especially
     `state_path`, `route`, and `coerce`.
   - Include clear behavior for unsupported projection-only descriptors: they
     should not silently mutate canonical state.
   - Keep this generic and deterministic. Do not couple it to Sigil avatar code.

2. Radial menu state mutation proof
   - Use radial menu visual descriptors from
     `createRadialMenuVisualObjectDescriptors()` to patch representative
     non-avatar radial menu state.
   - Prove at least one transform/config descriptor and one visibility or effect
     descriptor update the intended JSON path and remain serializable.
   - Preserve the current radial menu resolver/subject behavior and avoid
     importing Three.js or Sigil renderer modules into toolkit workbench helpers.

3. 2D canvas-style minimal update proof
   - Use an existing lightweight 2D surface if practical, such as
     `DesktopWorldSurface2D.applyWorldTransform()`, or a focused canvas-style
     fixture if that is the cleaner repository fit.
   - Prove a descriptor-addressed state change leads to an in-place update on
     the same target object/node rather than replacing it.

4. DOM/toolkit minimal update proof
   - Use the slider descriptor proof from Phase 5 validation and connect it to a
     real `createSlider()` instance or a focused equivalent.
   - Prove a descriptor-addressed value update calls the existing in-place
     control update path (`setValue` or equivalent) and keeps the same root
     element identity.

5. Contract friction
   - If the helper exposes missing strictness in
     `visual-object-contract.js`, refine the contract narrowly and update docs
     and all in-repo callers in this slice.
   - Do not leave compatibility aliases for stale field names unless there is a
     documented live consumer and removal gate.

## Scope

Shared toolkit contract/mutation helpers, radial menu workbench validation,
2D/DOM deterministic tests, and concise contract docs.

This is not a renderer rewrite and not an avatar optimization pass.

## Hard Boundaries

- Do not rewrite radial menu runtime rendering.
- Do not migrate all toolkit controls.
- Do not alter Sigil avatar renderer behavior.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.

## Suggested Implementation Areas

Likely paths:

- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/runtime/desktop-world-surface-2d.js`
- `packages/toolkit/controls/slider.js`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/desktop-world-surface-2d.test.mjs`
- `tests/toolkit/controls-slider-color.test.mjs`

Prefer adding tests around existing in-place update APIs before changing those
APIs. If a shared helper is needed, keep it small and technology-neutral.

## Verification

Run:

```bash
node --test tests/toolkit/visual-object-contract.test.mjs tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

Live AOS verification is optional for this deterministic mutation/update proof.
If runtime routing changes and `./aos ready --json` passes, run a bounded smoke
that proves representative non-avatar descriptor edits serialize and update
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
- descriptor-driven mutation helper summary, or explain why an existing helper
  was sufficient;
- radial menu mutation evidence;
- 2D canvas-style minimal update evidence;
- DOM/toolkit minimal update evidence;
- JSON serialization result for mutated non-avatar state;
- any contract refinements and why they were needed;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
