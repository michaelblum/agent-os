# Display-First Annotation Sigil Radial Camera Bundle Source V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active issue: https://github.com/michaelblum/agent-os/issues/364
- Builds on:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- Related prior card:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-camera-input-correction-v0.md`
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, live annotation state, Surface Inspector
state, Sigil state, bundle config, or prior implementation state. Read and
rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

## Goal

Make the Sigil radial camera snapshot path produce a real
`canvas_inspector.capture_bundle` result after live reticle anchors exist.

Operator verified the merged reticle target bridge on `main` at `269b33c`:
dragging through the Sigil reticle over live projected evidence selected a
non-display `macos-ax` subject with
`source_metadata.bridge: "sigil_reticle_annotation_candidate_bridge_v0"`,
`source_metadata.sigil_fallback: false`, and commit `fallback: false`. The
remaining live gap is that activating the radial camera recorded
`sigil.annotation_reticle.snapshot_request` in Sigil, but did not materialize a
daemon see-bundle artifact or daemon log entry for `sigil_radial_camera`.

Source inspection confirms the likely root cause:

- Sigil posts `canvas_inspector.capture_bundle` from `avatar-main` with trigger
  `sigil_radial_camera`.
- `src/daemon/surface-inspector-bundle.swift` only accepts bundle requests when
  `sourceCanvasID` is `surface-inspector`, and silently returns for other
  sources.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
- `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-camera-input-correction-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `src/daemon/unified.swift`
- `src/daemon/surface-inspector-bundle.swift`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos dev recommend --json
./aos dev gh issue view 295 --json
rg -n "sigil_radial_camera|canvas_inspector\\.capture_bundle|triggerCanvasInspectorSeeBundle|canvasInspectorBundleCanvasIDs|requestSeeBundle" apps packages src tests docs
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, use the repo
standard readiness/permission path. This slice needs live verification before
acceptance because the defect is at the daemon/Sigil runtime boundary.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` posts the radial camera bundle
  request after `annotationReticle.requestSnapshotEvent()` reports live anchors.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` owns live anchor
  availability and snapshot request event shape.
- `packages/toolkit/components/surface-inspector/index.js` posts the same
  `canvas_inspector.capture_bundle` request from Surface Inspector.
- `src/daemon/unified.swift` routes canvas messages of type
  `canvas_inspector.capture_bundle` to `triggerCanvasInspectorSeeBundle(...)`
  with the sending canvas id.
- `src/daemon/surface-inspector-bundle.swift` currently whitelists only
  `surface-inspector` as an accepted source and posts bundle status back to the
  source canvas.

## Required Behavior

### Bundle Request Contract

When Sigil has live annotation anchors and the radial camera item is activated,
the request must either:

- produce the same see-bundle artifact path as a Surface Inspector bundle
  request, with trigger `sigil_radial_camera`; or
- report an explicit unavailable/unauthorized status that Sigil can surface in
  debug state, rather than silently dropping the request.

Prefer a generic contract over product-specific daemon policy. Acceptable
approaches include forwarding trusted external capture requests to the active
Surface Inspector bundle canvas, or allowing a small allowlist of bundle request
sources while preserving the authoritative bundle owner and output mode. Do not
add daemon branches named for Sigil, reticle, avatar, or radial camera.

### Status And Evidence

The live path should leave enough evidence to debug success and failure:

- Sigil records `sigil.annotation_reticle.snapshot_request` with
  `available: true`.
- The daemon receives or records a `canvas_inspector.capture_bundle` request
  with trigger `sigil_radial_camera` and original source canvas `avatar-main`.
- A successful request creates or reports the see-bundle artifact path according
  to the active bundle output mode.
- A rejected request reports a clear reason such as
  `bundle_request_source_not_authorized`, not a silent no-op.
- Surface Inspector's existing manual and hotkey bundle behavior remains
  unchanged.

### Preserve Reticle Target Bridge

Do not regress the accepted target bridge:

- reticle preview/release keeps preferring projectable shared annotation
  candidates over display fallback;
- display fallback remains explicit when no candidate exists;
- stale semantic candidates are cleared on canvas removal or semantic target
  replacement/empty payloads;
- the mousemove hot path does not perform fresh AX, DOM, or CDP discovery.

## Scope

Likely ownership crosses:

- daemon bundle request authorization/status in `src/daemon/`;
- Sigil camera request/debug evidence in `apps/sigil/renderer/live-modules/`;
- Surface Inspector bundle status expectations in `packages/toolkit/components/`
  only if the generic contract needs UI/debug readback;
- focused tests.

If Swift changes are required, use `./aos dev recommend --json` before choosing
the build/test loop and `./aos dev build` for the rebuild.

## Hard Boundaries / Non-Goals

- No persistent annotation database.
- No new snapshot artifact schema unless the existing public contract truly
  cannot represent the result.
- No Surface Inspector-first authoring revival.
- No Sigil-named daemon policy branches.
- No broad rewrite of bundle output modes.
- No fresh AX, DOM, or CDP discovery on every reticle mousemove.
- No changes to unrelated radial menu behavior.

## Suggested Implementation Areas

After inspection, likely implementation paths are:

- change `triggerCanvasInspectorSeeBundle(...)` to handle a non-owner source
  explicitly while preserving `surface-inspector` as the bundle owner;
- add a structured rejection/status path for unauthorized bundle request
  sources;
- include original source canvas evidence in daemon status or bundle metadata if
  useful for debugging;
- add deterministic tests around the daemon bundle source gate if an existing
  Swift or shell harness can cover it cheaply;
- add or extend Sigil renderer tests only for request emission/debug evidence.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
git diff --check
```

If Swift or daemon bundle code changes, also run:

```bash
./aos dev build
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
```

If `./aos ready` passes, run a bounded live smoke:

1. Launch Sigil in repo mode.
2. Open or reuse a surface with projectable semantic/native target evidence.
3. Drag through the Sigil radial reticle and release over a non-display target.
4. Confirm the commit has `fallback: false` and anchors the non-display subject.
5. Reopen radial and activate `annotation-camera`.
6. Verify `sigil.annotation_reticle.snapshot_request` and
   `canvas_inspector.capture_bundle` evidence with trigger
   `sigil_radial_camera`.
7. Verify the daemon creates or reports the expected see-bundle artifact.
8. Clean up canvases and report final `./aos ready` plus
   `git status --short --branch`.

## Completion Report

Report:

- changed files;
- exact root cause and chosen boundary for the fix;
- whether Surface Inspector remains the authoritative bundle owner;
- deterministic tests and exact results;
- live smoke result and artifact paths, or exact readiness/runtime blocker;
- final `./aos ready`;
- final `git status --short --branch`;
- whether Foreman should request an Operator retest or a `/review` pass before
  acceptance.
