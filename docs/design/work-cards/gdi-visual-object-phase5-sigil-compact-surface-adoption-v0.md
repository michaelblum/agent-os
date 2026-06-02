# GDI: Visual Object Phase 5 Sigil Compact Surface Adoption V0

> **Historical status:** Closed Phase 5 real-surface adoption slice. Current
> Sigil avatar compact-surface guidance is covered by the accepted
> descriptor/controller/form-binding contract and the status report.
>
> **2026-06-02 routing guard:** Do not route this card for the detached Sigil
> avatar controls panel introduced at `21dc331d`. That panel must be migrated
> through
> `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`
> after the live panel drag correction is accepted, and the private
> `sigil.avatar_panel.*` protocol should be removed rather than preserved as an
> internal compatibility layer.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 5 form binding base:
  `beca93f7ec9d85d8d9a00ee01d24ea90729b7ebb`
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

Continue Phase 5 by wiring one real workbench editor surface to consume the
visual object form binding path with surface-owned route and renderer sync
handlers.

Target surface: Sigil avatar compact control surface.

The previous slice proved the generic binder with test fixtures. This slice
should make `apps/sigil/avatar-editor/compact-surface.js` use that binder for
canonical avatar form controls while preserving existing public callbacks and
not changing live renderer behavior unless handlers are explicitly supplied by
the caller.

Target loop:

```text
actual compact surface field change
  -> bindVisualObjectForm()
  -> visual descriptor lookup from the surface/model
  -> applyVisualObjectControllerUpdate()
  -> caller-owned route handler
  -> caller-owned renderer_sync handler
```

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase5-workbench-form-binding-v0.md`
- `packages/toolkit/workbench/visual-object-form-binding.js`
- `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/toolkit/visual-object-form-binding.test.mjs`
- `tests/toolkit/panel-form.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "bindVisualObjectForm|applyVisualObjectFormFieldChange|visual_object_descriptors|onFieldChange|onControlChange|onSectionChange|projection|createSigilAvatarCompactControlSurface|renderer_sync|routeHandlers|rendererSyncHandlers" packages/toolkit apps/sigil tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this as one broad but reviewable adoption slice:

1. Real surface adoption
   - Wire `createSigilAvatarCompactControlSurface()` so canonical avatar section
     forms can optionally bind through `bindVisualObjectForm()`.
   - The surface should use descriptors from the supplied view model or model,
     not a parallel descriptor map.
   - Keep projection-only tools out of canonical mutation binding. Existing
     projection callbacks must continue to work.

2. Caller-owned handlers
   - Add a small, explicit options shape for caller-owned route handlers,
     renderer sync handlers, and mutable visual object state.
   - Do not import Sigil live renderer internals into the compact surface just to
     satisfy tests.
   - If handlers/state are not provided, preserve existing behavior:
     `onControlChange`, `onSectionChange`, and `onProjectionChange` still fire as
     before.

3. Deterministic update evidence
   - Add tests that mount the actual compact control surface, edit a real
     canonical control, and prove:
     - `bindVisualObjectForm()` routes the field change through the descriptor;
     - caller route and renderer sync handlers are invoked deterministically;
     - canonical `state.avatar.*` mutates at the expected path;
     - the existing form/root element identity is preserved;
     - `JSON.stringify(state.avatar)` succeeds.

4. Compatibility evidence
   - Existing compact-surface behavior must keep passing: tab rendering, form
     changes, conditional controls, projection tools, and cleanup.
   - Existing generic binder tests must keep passing.

5. Documentation
   - Update `docs/design/visual-object-descriptor-contract-v0.md` with the first
     real-surface adoption note and the handler/state boundary.

## Scope

Sigil avatar compact surface integration, focused renderer/toolkit tests, and
concise docs.

This is not a Sigil renderer optimization pass, not a radial item workbench
migration, and not a wholesale migration of every form surface.

## Hard Boundaries

- Do not alter Sigil live renderer behavior unless the caller explicitly opts
  into handler/state binding.
- Do not bind projection-only controls as canonical avatar mutations.
- Do not rewrite `createForm()` again unless a tiny compatibility fix is
  necessary.
- Do not migrate radial item workbench in this slice.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `docs/design/visual-object-descriptor-contract-v0.md`
- optional minor tests in `tests/toolkit/visual-object-form-binding.test.mjs`
  only if the shared helper needs a small compatibility adjustment.

Prefer composing the existing binder over duplicating descriptor lookup inside
Sigil.

## Verification

Run:

```bash
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/visual-object-contract.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
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
`./aos ready --json` passes, run a bounded smoke proving one compact-surface
field edit routes through the visual object binding path. If `./aos ready`
reports a repo-mode TCC/input-tap blocker, stop live-dependent work and use:

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
- compact surface binding option/API summary;
- deterministic route/sync evidence from the real compact surface;
- JSON serialization result for `state.avatar`;
- compatibility evidence for existing compact-surface callbacks/projection
  tools;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
