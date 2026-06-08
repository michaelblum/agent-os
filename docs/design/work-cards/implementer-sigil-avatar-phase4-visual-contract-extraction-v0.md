# Implementer: Sigil Avatar Phase 4 Visual Contract Extraction V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 3 descriptor/workbench base:
  `16f8ca96b4a7c7723fd9b40f2ae3b9ead01138d1`
- Branch/output branch: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Begin Phase 4 by extracting the reusable visual-object contracts proven by the
Sigil avatar into a small shared, documented shape that other AOS visuals can
adopt.

The target is not a broad rewrite. The target is to make the avatar reference
implementation stop being only implicit code: capture the state graph,
descriptor metadata, routing, renderer sync, projection-only classification,
and evidence contracts as reusable platform-facing primitives or documentation,
while keeping Sigil behavior intact.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/work-cards/implementer-sigil-avatar-phase3-descriptor-workbench-pass-v0.md`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/renderer/state.js`
- `packages/toolkit/`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "descriptor|state_path|renderer_sync|projection_only|canvas_object\\.(transform|effects)\\.patch|sigil\\.avatar|object_graph|canonical" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md
find packages/toolkit -maxdepth 3 -type f | sort
```

## Required Behavior

Use judgment from the code, but cover this broad Phase 4 surface:

1. Contract extraction
   - Extract or document a reusable visual-object descriptor contract that
     captures the avatar-proven fields: id, label, type/kind, state path, route,
     coercion, range/options, renderer sync, grouping, conditional visibility,
     object ids, and projection-only classification.
   - Prefer an existing shared location under `packages/toolkit/` if a natural
     home exists. If no clean shared module exists, add a durable docs/reference
     artifact first and keep code extraction minimal.

2. Sigil stays the reference implementation
   - Keep Sigil descriptors and avatar editor model compatible with the extracted
     contract.
   - Avoid parallel metadata systems. Any shared helper or schema should reduce
     ambiguity in the existing Sigil descriptor/model flow.
   - Preserve Phase 2 renderer sync behavior and Phase 3 canonical omega/primary
     descriptor paths.

3. Examples across rendering technologies
   - Include examples or fixtures showing how the same contract applies to:
     - Sigil avatar / Three.js 3D object;
     - a 2D/canvas-style visual object;
     - a DOM/toolkit control.
   - These may be docs/examples/tests depending on the best fit in the repo.

4. Validation
   - Add focused deterministic tests that prove Sigil descriptors conform to the
     extracted contract and still classify projection-only controls explicitly.
   - If adding a shared helper, test the helper independently enough that another
     visual can reuse it without depending on Sigil internals.

5. Boundaries and follow-up
   - Record what remains Sigil-specific: polyhedron composition, tesseron
     geometry, aura/omega/lightning/magnetic effects, and live renderer details.
   - Identify the next Phase 5 validation target, but do not implement a
     non-avatar visual migration in this slice unless it is a tiny example or
     fixture.

## Scope

Shared contract docs/helpers under `packages/toolkit/` or `docs/`, Sigil avatar
descriptor/model integration, and focused tests.

This is a broad extraction slice, not a renderer optimization pass and not a
non-avatar migration pass.

## Hard Boundaries

- Do not rewrite the Sigil renderer.
- Do not move polyhedron/tesseron/effect implementation out of Sigil.
- Do not start the Phase 5 radial menu/toolkit migration beyond examples or
  fixtures needed to explain the contract.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `packages/toolkit/` for shared contract helpers or fixtures if a natural home
  exists.
- `docs/dev/reports/aos-visual-object-architecture.md` or a focused companion
  doc under `docs/design/` for durable contract documentation.
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/avatar-editor/model.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`
- optional new focused toolkit/contract test.

Prefer a small, clear contract artifact over a large abstraction layer.

## Verification

Run:

```bash
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

Live AOS verification is optional for this contract extraction slice unless Implementer
changes runtime descriptor routing. If runtime descriptor routing changes and
`./aos ready --json` passes, run a bounded smoke that proves representative
descriptor edits still update `window.state.avatar` and serialize.

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
- extracted contract location and summary;
- Sigil compatibility evidence;
- examples/fixtures added for 3D, 2D/canvas-style, and DOM/toolkit usage;
- explicit Sigil-specific boundaries left in place;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- JSON serialization result if runtime descriptor routing was exercised;
- any local-only state left untouched;
- recommended next broad slice.
