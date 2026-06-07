# GDI: Visual Object Phase 5 Workbench Form Binding V0

> **Historical status:** Closed Phase 5 form-binding slice. Current authority is
> `bindVisualObjectForm()` and the descriptor/controller/form-binding loop in
> `docs/design/visual-object-descriptor-contract-v0.md`.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 5 controller adapter base:
  `f92a9aaf22de656e91f7a2e23168b84f29ee571b`
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

Continue Phase 5 by connecting the visual object controller adapter to a real
workbench form binding path.

The previous slices proved descriptor metadata, descriptor-addressed mutation,
and a reusable controller adapter. This slice should make those pieces usable by
workbench-style editor surfaces without each surface hand-wiring the bridge.

Target loop:

```text
workbench form field change
  -> visual descriptor lookup
  -> applyVisualObjectControllerUpdate()
  -> route handler
  -> renderer_sync handler
  -> stable target update
```

Keep this deterministic and reviewable. Prefer adding a small binder/helper over
rewriting form controls or renderer code.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase5-workbench-controller-adapter-v0.md`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/workbench/subject-controls.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `packages/toolkit/controls/slider.js`
- `tests/toolkit/panel-form.test.mjs`
- `tests/toolkit/subject-controls.test.mjs`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "applyVisualObjectControllerUpdate|visual_object_descriptors|descriptor_id|state_path|route|renderer_sync|createForm|onChange|binding|data-state-path|data-route" packages/toolkit apps/sigil tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this as one broad but reviewable Phase 5 slice:

1. Workbench form binding helper
   - Add the smallest shared helper that binds form field changes to
     visual-object descriptors through `applyVisualObjectControllerUpdate()`.
   - It should accept a form-like object or field-change payload, descriptor
     collection, JSON state object, route handlers, and renderer sync handlers.
   - It should look up descriptors by `descriptor_id`/field id or explicit
     binding metadata and return deterministic update results.
   - It must reject projection-only descriptors and missing descriptor bindings
     clearly.
   - Keep the helper generic; do not import Sigil avatar renderer code, Three.js,
     DOM globals, or radial runtime modules into shared workbench helpers.

2. Preserve form semantics
   - Do not rewrite `createForm()` controls.
   - If `createForm()` needs a tiny addition to expose field-level change
     payloads or binding metadata cleanly, keep it backward-compatible and cover
     existing form behavior.
   - Existing `onChange(values)` behavior must keep working.

3. Sigil/avatar descriptor compatibility
   - Prove a representative Sigil avatar editor descriptor can be bound through
     the helper using the model's `visual_object_descriptors` and surface-view
     model binding metadata.
   - Use route/sync handler spies for deterministic evidence; do not change live
     Sigil avatar renderer behavior in this slice.

4. Radial menu descriptor compatibility
   - Prove radial menu workbench descriptors can be bound through the same helper
     from a form-like field change.
   - Cover at least one transform route and one boolean route with strict
     boolean coercion.

5. DOM/toolkit control compatibility
   - Prove a toolkit slider field can update through the binder and preserve the
     same root element identity via the existing `setValue()` path.

6. Workbench contract docs
   - Update `docs/design/visual-object-descriptor-contract-v0.md` with the
     binding loop and the exact boundary between descriptor contract, controller
     adapter, and form/surface-owned handlers.

## Scope

Shared toolkit workbench/panel helpers, deterministic tests, and concise docs.

This is not a renderer rewrite, not an avatar optimization pass, and not a
wholesale migration of every workbench surface.

## Hard Boundaries

- Do not alter Sigil avatar renderer behavior.
- Do not rewrite radial menu runtime rendering.
- Do not migrate all toolkit controls.
- Do not add compatibility aliases for stale descriptor field names unless a
  live consumer requires them and the removal gate is documented.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.

## Suggested Implementation Areas

Likely paths:

- optional new `packages/toolkit/workbench/visual-object-form-binding.js`
- `packages/toolkit/workbench/index.js`
- `packages/toolkit/panel/form.js` only if a tiny field-change payload addition
  is necessary.
- `docs/design/visual-object-descriptor-contract-v0.md`
- optional new `tests/toolkit/visual-object-form-binding.test.mjs`
- `tests/toolkit/panel-form.test.mjs`
- `tests/toolkit/subject-controls.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/controls-slider-color.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`

Prefer a helper that composes existing `createForm()` and
`applyVisualObjectControllerUpdate()` over expanding either API into a framework.

## Verification

Run:

```bash
node --test tests/toolkit/visual-object-contract.test.mjs tests/toolkit/subject-controls.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/runtime-radial-menu-config.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

Live AOS verification is optional for this deterministic form-binding proof. If
runtime descriptor routing changes and `./aos ready --json` passes, run a
bounded smoke proving a representative form field edit routes and syncs without
replacing its target object. If `./aos ready` reports a repo-mode
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
- form binding helper location and summary;
- Sigil/avatar descriptor binding evidence;
- radial menu descriptor binding evidence;
- DOM/toolkit slider binding evidence;
- JSON serialization result for mutated state;
- any `createForm()` API changes and compatibility evidence, or state that no
  form API change was needed;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
