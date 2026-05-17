# Display-First Annotation Sigil Reticle Target Bridge V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Adapter tracker: https://github.com/michaelblum/agent-os/issues/297
- Completed snapshot tracker: https://github.com/michaelblum/agent-os/issues/298
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Builds on:
  - `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
  - `docs/design/work-cards/display-first-annotation-sigil-reticle-camera-input-correction-v0.md`
  - `docs/design/work-cards/display-first-annotation-settled-reprojection-v0.md`
  - `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue state, runtime readiness, Surface Inspector state, Sigil state, or
prior implementation state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the next annotation slice after #298 landed. Do not reopen snapshot
payload design, broad surface architecture, or Surface Inspector-first
authoring. The goal is to make the accepted Sigil reticle path target real
subjects where the platform already has candidate/projection evidence.

## Goal

Bridge Sigil's display-first annotation reticle from its current V0
`display_root_only_v0` / `display_under_release_pointer_v0` target limitation to
the shared annotation candidate and projection adapters already used by Surface
Inspector.

When the user drags through the Sigil reticle, preview and release should prefer
the best available live subject under the pointer: AOS semantic targets,
canvas/window subjects, native AX candidates, or other already-supported
annotation targets. If no projectable candidate is available, keep the current
display-root fallback and record the fallback explicitly.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-camera-input-correction-v0.md`
- `docs/design/work-cards/display-first-annotation-settled-reprojection-v0.md`
- `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/toolkit/annotation-projection.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/surface-inspector-ax.test.mjs`
- `tests/toolkit/runtime-semantic-targets.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git log --oneline --decorate -12
./aos ready
./aos dev gh issue view 295 --json
./aos dev gh issue view 297 --json
./aos dev recommend --json
rg -n "display_root_only_v0|display_under_release_pointer_v0|annotationReticle|annotation candidate|aos-toolkit-semantic-target|macos-ax|capture_bundle|sigil_radial" apps packages tests docs
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic inspection/tests only unless Foreman or the
human explicitly routes runtime repair. This slice should not be accepted as
live-complete without either a bounded real-input smoke or a concrete readiness
blocker.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/annotation-reticle.js` owns Sigil reticle
  session state, display fallback targets, release commit payloads, camera
  availability, and travel-placement input.
- `apps/sigil/renderer/live-modules/main.js` owns radial handoff/reentry,
  reticle preview throttling, release commit, snapshot requests, and Sigil debug
  state.
- `packages/toolkit/workbench/annotation-session.js` is the shared in-memory
  session model. Sigil should keep using this shape.
- `packages/toolkit/workbench/annotation-projection.js` owns reusable projection
  adapter result builders and normalized capability/blocker states.
- `packages/toolkit/workbench/surface-inspector-annotations.js` owns shared
  annotation session helpers currently consumed by Surface Inspector.
- `packages/toolkit/components/surface-inspector/index.js` contains candidate
  collection/ranking code. Extract or reuse only neutral helpers; do not make
  Sigil depend on Surface Inspector UI internals.
- `tests/renderer/annotation-reticle.test.mjs` records the accepted reticle V0
  behavior and current display-only limitations.
- `tests/toolkit/surface-inspector-annotations.test.mjs`,
  `tests/toolkit/annotation-projection.test.mjs`,
  `tests/toolkit/surface-inspector-ax.test.mjs`, and
  `tests/toolkit/runtime-semantic-targets.test.mjs` cover adjacent candidate and
  projection contracts.

## Required Behavior

### Shared Target Candidate Bridge

During active Sigil annotation reticle preview, resolve the best available
annotation subject for the current pointer using existing candidate/projection
contracts where possible.

Acceptable V0 candidate sources include:

- AOS-owned semantic targets published by toolkit surfaces;
- canvas/window subjects with projectable visible display rects;
- native AX candidates when the existing AX evidence path is available;
- display root fallback when no richer target is available.

The resulting candidate must carry the same useful fields the shared annotation
session expects: stable address, adapter id, root id/kind/label, subject id/path,
role/label evidence, projection status, reveal capability when available, stale
or blocker evidence, and source metadata.

Do not perform fresh AX/DOM/CDP discovery on every mousemove. Use cached,
already-observed, or bounded candidate evidence. If a missing daemon primitive
is the blocker, preserve that as a concrete primitive gap instead of moving
product policy into the daemon.

### Preview And Release Semantics

Reticle preview should update the shared session hover/preview state with the
resolved subject. Release should commit that subject as the anchor target and
use the subject's visible/projected rect for deterministic travel placement.

Keep the current display fallback, but make it explicit:

- fallback adapter remains clearly labeled as Sigil display fallback;
- fallback source metadata explains why no richer candidate was available;
- release commit payload reports the target limitation and blocker reason.

### Snapshot Continuity

Do not redesign #298. The camera radial item should keep using the accepted
`canvas_inspector.capture_bundle` path with trigger `sigil_radial_camera`.

The reticle session state that feeds snapshot evidence should now preserve the
resolved target's adapter/projection evidence where available. Clipboard-payload
and bundle-path modes must keep their current behavior.

### Surface Inspector Boundary

Surface Inspector remains support UI: entry, snapshot, current path, adapter
evidence, stale/blocker diagnostics, passive minimap/debug inspection. Do not
route primary reticle authoring through Surface Inspector list rows, pin icons,
or minimap controls.

## Scope

Likely ownership:

- Sigil app reticle/runtime integration in `apps/sigil/renderer/live-modules/`;
- toolkit-neutral candidate/projection helpers if Surface Inspector currently
  owns logic Sigil also needs;
- focused renderer/toolkit tests;
- docs only if a public behavior contract changes.

Avoid Swift/daemon changes unless inspection proves a missing generic primitive
is required. If Swift changes become necessary, use `./aos dev recommend --json`
before choosing the build/test loop and `./aos dev build` for the rebuild.

## Hard Boundaries / Non-Goals

- No persistent annotation database.
- No snapshot payload redesign.
- No new report/export renderer.
- No broad Surface Inspector settings or authoring UI work.
- No Sigil-named daemon branches, actions, or policy.
- No arbitrary browser DOM/CDP adapter work in this slice.
- No screenshot-pixel oracle for structured hit testing.
- No private target schema when the shared annotation session/projection shapes
  already fit.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/fast-travel-preview.test.mjs
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector-ax.test.mjs tests/toolkit/runtime-semantic-targets.test.mjs
git diff --check
```

If `./aos ready` passes, run a bounded live smoke:

1. Launch Sigil through the canonical repo-mode path.
2. Open the radial menu and drag through `Annotate`.
3. Move over an AOS semantic target or native AX target that Surface Inspector
   can already project.
4. Verify Sigil debug state records a non-display fallback candidate with
   adapter/projection evidence.
5. Release and verify the commit target is the same subject and travel placement
   uses its visible/projected rect rather than the raw cursor coordinate.
6. Trigger the camera radial item and verify `canvas_inspector.capture_bundle`
   still emits `sigil_radial_camera`.
7. Clean up canvases and report final `./aos ready` plus
   `git status --short --branch`.

If live verification is blocked, provide an Operator-ready handoff with the
exact state to set up and the exact evidence to collect.

## Completion Report

Report:

- changed files;
- which candidate sources now work from the Sigil reticle path;
- fallback behavior and any remaining target limitations;
- whether any neutral helper was extracted from Surface Inspector code;
- deterministic tests and exact results;
- live smoke result or exact readiness/runtime blocker;
- final `./aos ready`;
- final `git status --short --branch`;
- recommended next annotation follow-up, if any.
