# Implementer: Visual Object Phase 5 Radial Workbench Adoption V0

> **Historical status:** Closed Phase 5 non-avatar adoption slice. Current
> radial workbench guidance is the accepted descriptor/controller path in
> `docs/design/visual-object-descriptor-contract-v0.md` and the architecture
> status report.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted compact surface adoption base:
  `292d282165bda6ed2c2a706037fa0a731877a28c`
- Branch/output branch: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Continue Phase 5 by wiring one real non-avatar editor surface to consume the
visual object descriptor/controller/binding contract.

Target surface: Sigil radial item workbench/editor.

The compact avatar surface now proves real-surface adoption for the avatar
reference implementation. This slice should prove the same architecture across
a non-avatar 3D visual editor by connecting the existing radial item
workbench/editor state and patch path to the visual object descriptors already
exposed by `createRadialMenuWorkbenchSubject()`.

Target loop:

```text
actual radial editor/workbench edit
  -> visual descriptor lookup
  -> applyVisualObjectControllerUpdate() or bindVisualObjectForm()
  -> existing radial item route handler
  -> existing preview/registry sync path
  -> stable non-avatar state update
```

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/implementer-visual-object-phase5-sigil-compact-surface-adoption-v0.md`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/workbench/visual-object-form-binding.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `apps/sigil/radial-item-editor/model.js`
- `apps/sigil/radial-item-workbench/index.js`
- `packages/toolkit/components/object-transform-panel/index.js`
- `packages/toolkit/components/object-transform-panel/model.js`
- `tests/renderer/radial-item-editor.test.mjs`
- `tests/renderer/radial-object-control.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/object-transform-panel-model.test.mjs`
- `tests/toolkit/visual-object-form-binding.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "visual_object_descriptors|createRadialMenuWorkbenchSubject|applyVisualObjectControllerUpdate|bindVisualObjectForm|applyEditorObjectPatch|applyEditorEffectsPatch|ObjectTransformPanel|canvas_object\\.(transform|effects|visibility)\\.patch|syncPanelRegistry|selectedRadialItem" packages/toolkit apps/sigil tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this as one broad but reviewable non-avatar adoption slice:

1. Real radial editor/workbench adoption
   - Connect the radial item editor/workbench subject or state path to the
     visual object descriptors from `createRadialMenuWorkbenchSubject()`.
   - Use `applyVisualObjectControllerUpdate()` directly if the existing
     `ObjectTransformPanel` patch path is the correct boundary.
   - Use `bindVisualObjectForm()` only if there is a clean actual form path. Do
     not force a form abstraction onto a panel that is already patch-message
     driven.

2. Existing route handlers stay authoritative
   - Route descriptor edits through the existing radial editor handlers:
     `applyEditorObjectPatch()`, `applyEditorEffectsPatch()`, and registry/preview
     sync where appropriate.
   - Do not duplicate radial menu patch semantics in a parallel metadata system.
   - Preserve existing lock-in/export behavior.

3. Deterministic update evidence
   - Add tests that use the actual radial item editor/workbench model path and
     prove at least:
     - one transform descriptor edit updates selected radial item JSON state;
     - one effects or visibility descriptor edit updates selected radial item
       JSON state;
     - route handlers and sync handlers are invoked deterministically;
     - exported/subject state remains JSON-serializable;
     - existing object registry or preview sync path still observes the edited
       values.

4. Surface compatibility
   - Existing radial item editor tests must keep passing: selection, transform
     patching, effects patching, workbench subject construction, lock-in payload,
     and avatar owner-managed behavior.
   - Existing radial object control tests must keep passing.

5. Documentation
   - Update `docs/design/visual-object-descriptor-contract-v0.md` with the first
     non-avatar real-surface adoption note and the boundary between radial
     descriptors, controller update, existing patch handlers, and preview/registry
     sync.

## Scope

Sigil radial item editor/workbench model integration, focused deterministic
tests, and concise docs.

This is not a renderer rewrite, not a full live browser migration, and not a
replacement for the existing Object Transform Panel. The purpose is to connect
the existing radial editor patch path to the shared visual object contract.

## Hard Boundaries

- Do not rewrite radial menu runtime rendering.
- Do not remove or bypass existing `canvas_object.*.patch` contracts.
- Do not alter Sigil avatar renderer behavior.
- Do not migrate unrelated toolkit controls or forms.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/radial-item-editor/model.js`
- `apps/sigil/radial-item-workbench/index.js`
- `tests/renderer/radial-item-editor.test.mjs`
- `tests/renderer/radial-object-control.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `docs/design/visual-object-descriptor-contract-v0.md`
- optional small shared helper only if it removes real duplication between
  existing radial patch routing and visual object controller usage.

Prefer model-level deterministic adoption first. Touch the browser workbench
entry only if the deterministic model path needs a small export/wiring point.

## Verification

Run:

```bash
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

The broad `node --test tests/toolkit/*.test.mjs` command is currently known to
fail in untouched `tests/toolkit/runtime-radial-gesture.test.mjs` and
`tests/toolkit/spatial-governance.test.mjs` on this branch. Do not treat those
as part of this slice unless your edits touch those areas; report them
separately if rerun.

Live AOS verification is optional. If runtime descriptor routing changes and
`./aos ready --json` passes, run a bounded smoke proving one radial item edit
routes through the visual object controller path and the preview/registry state
updates. If `./aos ready` reports a repo-mode TCC/input-tap blocker, stop
live-dependent work and use:

```bash
the manual TCC blocker report path
./aos ready --post-permission
```

after the human returns with `finished`.

## Commit And Push

Use path-scoped `git add`. Make one or more scoped commits as needed, but keep
the final diff reviewable:

```bash
git push origin implementer/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- radial workbench/editor adoption summary;
- transform descriptor route/sync evidence;
- effects or visibility descriptor route/sync evidence;
- JSON serialization result for mutated radial item state or exported subject;
- compatibility evidence for existing radial editor/object-control behavior;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
