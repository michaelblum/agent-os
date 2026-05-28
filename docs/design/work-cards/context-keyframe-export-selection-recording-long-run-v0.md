# Context Keyframe Export, Selection Mode, And Recording Long Run V0

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
Surface Inspector runtime state, Sigil runtime state, permission state, or prior
conversation details. Read and rediscover before editing.

Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

This is a long-running, multi-phase convergence round. It follows the accepted
foundation, Surface Inspector adapter, and Sigil reticle context adapter slices.
The intent is to finish the remaining canonical context artifact/keyframe line
in one coordinated run while preserving reviewable checkpoints.

## Branch / Base

- `branch_from`: `gdi/sigil-reticle-context-artifact-adapter-v0`
- `required_start_ref`: local branch
  `gdi/sigil-reticle-context-artifact-adapter-v0` at or after commit
  `15da7ab9 feat(sigil): add reticle context session adapter`, plus this work
  card
- Expected output branch: create a focused successor branch, suggested:
  `gdi/context-keyframe-export-selection-recording-long-run-v0`
- Do not push, open a PR, or mutate GitHub state unless explicitly asked
- Commit at clean phase boundaries. Keep commits reviewable, with each phase
  independently explaining what changed.

## Goal

Finish the convergence from reticle/Surface Inspector annotation snapshots
toward canonical context sessions, keyframes, Selection Mode artifacts, and
recordings.

This run should make the current export shutters consume canonical context
data, define the missing recording contract, and add the first deterministic
Selection Mode acquisition path that produces the same artifact family as
reticle and Surface Inspector.

## Current Accepted Baseline

The baseline already has:

- `packages/toolkit/workbench/context-session.js` with
  `aos_context_session`, `aos_context_artifact`, `aos_context_keyframe`,
  `createContextSession`, `createContextKeyframe`,
  `createContextArtifactFromAnnotationSession`, and `contextSessionSnapshot`;
- `packages/toolkit/workbench/surface-inspector-annotations.js` with
  `surfaceInspectorAnnotationStateToContextSession()`;
- `apps/sigil/renderer/live-modules/annotation-reticle.js` with
  `createSigilAnnotationReticleContextSession()` and reticle snapshots/request
  events exposing `context_session`;
- existing `surface_inspector_annotation_snapshot` bundle compatibility;
- existing radial camera bundle transport through
  `canvas_inspector.capture_bundle`;
- existing daemon-owned `ctrl+opt+c` Surface Inspector bundle hotkey.

Do not redo those foundations unless a later phase reveals a concrete blocker.

## Read First

Read at minimum:

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `src/CLAUDE.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `docs/design/work-cards/context-artifact-keyframe-foundation-v0.md`
- `docs/design/work-cards/surface-inspector-context-session-adapter-v0.md`
- `docs/design/work-cards/sigil-reticle-context-artifact-adapter-v0.md`
- `shared/schemas/aos-context-session-v0.md`
- `shared/schemas/aos-context-session-v0.schema.json`
- `packages/toolkit/workbench/context-session.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `src/daemon/surface-inspector-bundle.swift`
- `src/daemon/unified.swift`
- `tests/toolkit/context-session.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/surface-hit-test-inspect.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/schemas/aos-context-session-v0.test.mjs`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git worktree list
./aos dev recommend --json
rg -n "aos_context_session|aos_context_keyframe|createContextKeyframe|contextSessionSnapshot|context_session|surfaceInspectorAnnotationStateToContextSession|createSigilAnnotationReticleContextSession|canvas_inspector.capture_bundle|annotation-snapshot|surface_inspector_annotation_snapshot|ctrl\\+opt\\+c|capture_bundle|surface_hit_test_inspect|Selection Mode|recording" packages apps src tests docs shared
```

If `./aos dev recommend --json` fails, record the failure and continue with
bounded deterministic checks.

## Phase Contract

This is one GDI round, but it has explicit phase checkpoints. Complete phases in
order. After each phase:

- run the smallest relevant deterministic tests;
- commit the phase if the worktree is cleanly scoped;
- continue to the next phase without asking the human unless a stop condition
  applies.

If a later phase requires a product choice, live permission, TCC reset, or
unbounded daemon/runtime investigation, stop with a partial completion report
that names the completed phase commits and the precise blocker.

## Phase 1: Keyframe And Recording Contract Hardening

Goal: make canonical keyframes and recordings a first-class toolkit/schema
contract without broad runtime behavior changes.

Required behavior:

- Keep `aos_context_session` and `aos_context_keyframe` under the existing
  V0 context session family unless a strict schema split is clearly necessary.
- Add `aos_context_recording` as the ordered keyframe-plus-events contract.
- Prefer helpers in `packages/toolkit/workbench/context-session.js`, for example
  `createContextRecording()`, if that fits the existing helper style.
- A recording must preserve keyframe order, optional text/action/blocker events,
  source metadata, and asset references without requiring video or embedded
  image data.
- Keep data URL/base64 image rejection strict for keyframe and recording asset
  refs.
- Update schema docs and API docs with the smallest clear explanation.

Likely files:

- `packages/toolkit/workbench/context-session.js`
- `shared/schemas/aos-context-session-v0.md`
- `shared/schemas/aos-context-session-v0.schema.json`
- `shared/schemas/fixtures/aos-context-session-v0/...`
- `tests/toolkit/context-session.test.mjs`
- `tests/schemas/aos-context-session-v0.test.mjs`
- `docs/api/toolkit/workbench.md`

Acceptance evidence:

- keyframe fixtures validate;
- recording fixtures validate;
- helper tests prove ordered keyframes/events and no embedded image data.

## Phase 2: Radial Camera Canonical Keyframe Export

Goal: make Sigil radial camera carry canonical context session/keyframe data
while preserving existing bundle transport semantics.

Required behavior:

- `requestAnnotationSnapshot()` should derive or reuse the current reticle
  `context_session`.
- The radial camera request to `canvas_inspector.capture_bundle` should include
  canonical context data as compact JSON in the request payload, preferably a
  `context_session` plus a generated `context_keyframe`.
- The current request transport remains `canvas_inspector.capture_bundle`.
- Existing fields `trigger: "sigil_radial_camera"`, `reason`, and
  `anchor_count` remain compatible.
- Existing bundle outputs stay present: `annotation-snapshot.json` remains when
  configured and current tests expecting compatibility artifacts should pass.
- Add deterministic renderer tests proving the request contains canonical data
  and that no bundle transport rename happened.

Likely files:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`

Acceptance evidence:

- radial camera request includes `aos_context_session` and
  `aos_context_keyframe` data when reticle context exists;
- request still posts `canvas_inspector.capture_bundle`;
- fallback when no context exists is explicit and does not crash.

## Phase 3: Bundle Inclusion For Radial Camera And `ctrl+opt+c`

Goal: make both bundle path mode and clipboard payload mode include canonical
context keyframe/session data when available, without removing the existing
Surface Inspector annotation snapshot compatibility artifact.

Required behavior:

- Extend daemon bundle capture to accept optional canonical context data supplied
  by the `canvas_inspector.capture_bundle` request.
- For `ctrl+opt+c` exports where no request-supplied context exists, derive a
  context session from the active Surface Inspector state by evaluating the
  Surface Inspector debug/toolkit adapter, analogous to the current
  `annotation-snapshot.json` collection path.
- Write canonical context artifacts in bundle-path mode, with stable filenames.
  Suggested files:
  - `context-session.json`
  - `context-keyframe.json`
- Add manifest entries without removing existing keys:
  - `context_session_json`
  - `context_keyframe_json`
- In clipboard payload mode, include compact `context_session` and
  `context_keyframe` fields when available, and explicit skipped/disabled
  evidence when unavailable.
- Asset refs in the keyframe should reference existing bundle artifacts such as
  `annotation-snapshot.json`, `capture.png`, `capture.json`, `display-geometry.json`,
  `canvas-list.json`, and `inspector-state.json` when enabled.
- Preserve `surface_inspector_annotation_snapshot` and
  `annotation_snapshot_json` compatibility.

Likely files:

- `src/daemon/surface-inspector-bundle.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/renderer/annotation-reticle.test.mjs`
- `docs/api/toolkit/components.md`
- `docs/api/aos.md`

Acceptance evidence:

- bundle path mode includes context JSON files and manifest entries when context
  exists;
- clipboard payload mode includes inline context fields when context exists;
- `annotation-snapshot.json` remains present when configured;
- toggles disabling annotation snapshot do not disable canonical context unless
  a separate explicit context include toggle is added and tested;
- no embedded image data appears in context JSON or clipboard payloads.

## Phase 4: Selection Mode Deterministic Acquisition Path

Goal: add the first deterministic Selection Mode path that converts a clicked
leaf and chosen ancestor into the same context artifact family as reticle and
Surface Inspector.

This phase should implement the model/path first. Keep runtime UI minimal unless
the existing code makes a small integration obvious.

Required behavior:

- Add a toolkit-level Selection Mode acquisition helper rather than burying the
  model in Sigil-only code.
- Input should include:
  - pointer/click evidence;
  - clicked leaf candidate;
  - ordered ancestor/path candidates up to whole screen/display/workspace where
    available;
  - selected target id or address, which may equal the clicked leaf;
  - candidate report, ambiguity, rejected/skipped ancestors, and adapter
    blockers.
- Output must be an `aos_context_session` with one `aos_context_artifact`.
- `acquisition.mode` must be `selection_mode`.
- `leaf_node_id` and `selected_node_id` must both be preserved and may differ.
- Full root-to-leaf ancestry must be represented as artifact path nodes.
- Comments must be attachable to any path node or compatible anchor in the same
  shape used by reticle/Surface Inspector.
- Use existing `surface-hit-test-inspect` and annotation candidate helpers where
  practical; do not invent another display graph vocabulary.
- Add deterministic tests. Do not require a full-screen click-capture canvas or
  live mouse capture for this phase.

Likely files:

- `packages/toolkit/workbench/context-session.js`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- a new toolkit helper if cleaner, such as
  `packages/toolkit/workbench/selection-mode.js`
- `tests/toolkit/context-session.test.mjs`
- `tests/toolkit/surface-hit-test-inspect.test.mjs`
- new `tests/toolkit/selection-mode.test.mjs` if a new helper is added
- `shared/schemas/fixtures/aos-context-session-v0/...`

Acceptance evidence:

- selected ancestor differs from clicked leaf and validates;
- selected leaf equals clicked leaf and validates;
- full ancestry is preserved up to a whole-screen/display root when supplied;
- ambiguous candidates and skipped ancestors are explicit;
- artifact shape is compatible with reticle-created and Surface
  Inspector-created artifacts.

## Phase 5: Minimal Runtime Entry Points Or Explicit Deferral

Goal: wire only the runtime pieces that can be implemented safely after the
deterministic contract exists.

Allowed if small and testable:

- Add a Sigil/debug entry point that can construct a Selection Mode context
  artifact from supplied candidates/click evidence.
- Add a dormant/deterministic double-click avatar entry hook only if existing
  input-region/radial infrastructure makes it a small, bounded change.
- Expose the active Selection Mode context session in debug state using the same
  naming style as `annotationReticle.context_session`.

Boundaries:

- Do not add an always-on full-screen mouse capture canvas.
- Do not add expensive pointer stream watchers.
- Do not change app click-through behavior outside an explicitly active mode.
- Do not require live AX/DOM discovery on every mouse move.
- Do not attempt the decorative cursor overlay/trail in this run unless all
  prior phases are done and the implementation is trivially reusing existing
  fast-travel/reticle overlay assets.

If runtime entry is larger than expected, stop after deterministic Selection
Mode helper/schema/tests and record the runtime follow-up as the first
recommended next slice.

## Phase 6: Docs, Migration Notes, And Compatibility Gates

Goal: leave the repo with one understandable convergence line.

Required docs:

- Update `docs/api/toolkit/workbench.md` for context recording, Selection Mode
  helper/API, and export/keyframe use.
- Update `docs/api/toolkit/components.md` and `docs/api/aos.md` for canonical
  context export files/clipboard fields.
- Update `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
  only if the implemented result materially changes the map.

Required compatibility notes:

- State that `surface_inspector_annotation_snapshot` remains compatibility
  export data.
- State that canonical context session/keyframe/recording data is the new
  machine-readable convergence path.
- Name removal gates for compatibility keys, but do not remove them in this run.

## Hard Boundaries / Non-Goals

- Do not remove `surface_inspector_annotation_snapshot`.
- Do not break current `canvas_inspector.capture_bundle` transport.
- Do not remove or rename current `annotation-snapshot.json` outputs.
- Do not add video/blob recording.
- Do not embed screenshots, base64 image strings, or `data:image/...` values in
  canonical context JSON.
- Do not add a persistent annotation database.
- Do not add broad UI polish, cursor trail effects, or visual redesign.
- Do not add an always-on full-screen input-capture surface.
- Do not push, open PRs, or mutate GitHub state.

## Verification Ladder

Start each phase with the router for the actual changed files:

```bash
./aos dev recommend --json --files <changed files>
```

Expected deterministic checks across the full run:

```bash
node --check packages/toolkit/workbench/context-session.js
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --check packages/toolkit/workbench/surface-hit-test-inspect.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/toolkit/context-session.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-hit-test-inspect.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/schemas/aos-context-session-v0.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
git diff --check
```

If Swift/daemon files change, run the smallest repo-standard daemon/build check
recommended by `./aos dev recommend`. If that requires live runtime permission
or `./aos ready` reports a TCC/input-tap blocker, use the repo-standard recovery
path:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

Then stop until the human returns with `finished`, unless the remaining work is
deterministic and does not require live runtime proof.

Live/supervised tests such as `tests/surface-inspector-see-bundle.sh` or real
input Sigil scenarios may be run only when readiness allows it and the router or
changed runtime behavior makes them meaningful. If they skip for permission
reasons, report the skip precisely and keep deterministic evidence separate.

## Completion Report

Report:

- branch, base SHA, head SHA;
- phase commits and files changed per phase;
- whether each phase completed, was explicitly deferred, or hit a blocker;
- final exported canonical file/clipboard field names;
- Selection Mode helper/API names and artifact shape;
- recording helper/schema names and fixture coverage;
- compatibility guarantees for `annotation-snapshot.json` and
  `surface_inspector_annotation_snapshot`;
- tests/checks run with pass/fail/skip details;
- conflict risk and any shared files touched;
- current `git status --short --branch`;
- first recommended follow-up slice, if any.
