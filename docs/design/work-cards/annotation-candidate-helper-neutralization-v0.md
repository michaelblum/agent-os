# Annotation Candidate Helper Neutralization V0

## Tracker

- Foreman audit source: `.docks/foreman/tmp/opportunities.md` identified
  annotation candidate ownership drift as the next streamlining slice after
  annotation projection/reveal normalization and Zag adapter consolidation.
- Prior adjacent cards:
  - `docs/design/work-cards/display-first-annotation-sigil-reticle-target-bridge-v0.md`
  - `docs/design/work-cards/annotation-projection-reveal-normalization-v0.md`
  - `docs/design/work-cards/toolkit-zag-adapter-consolidation-v0.md`
- Current neutral module:
  `packages/toolkit/workbench/annotation-candidates.js`
- Current Surface Inspector support module:
  `packages/toolkit/workbench/surface-inspector-annotations.js`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, prior implementation state, or Foreman thread context. Read
and rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

This is a toolkit workbench cleanup/test slice with app consumer updates. Keep
the implementation focused on annotation candidate helper ownership. Do not
change annotation UX, snapshot schema semantics, radial gesture behavior, or
Surface Inspector product behavior.

## Goal

Make annotation candidate construction, normalization, ranking, and adapter
capability summaries live behind neutral toolkit workbench names instead of
Surface Inspector-specific helper names.

After this slice, generic consumers such as Sigil reticle targeting and the
Surface Inspector component should import shared candidate builders from
`workbench/annotation-candidates.js`, not from
`workbench/surface-inspector-annotations.js`. Surface Inspector state/session
helpers may remain in `surface-inspector-annotations.js`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`
- `docs/api/toolkit/workbench.md`
- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/toolkit/annotation-projection.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files \
  packages/toolkit/workbench/annotation-candidates.js \
  packages/toolkit/workbench/surface-inspector-annotations.js \
  packages/toolkit/workbench/annotation-projection.js \
  packages/toolkit/components/surface-inspector/index.js \
  apps/sigil/renderer/live-modules/main.js \
  apps/sigil/renderer/live-modules/annotation-reticle.js \
  tests/toolkit/surface-inspector-annotations.test.mjs \
  tests/renderer/annotation-reticle.test.mjs \
  docs/api/toolkit/workbench.md
rg -n "buildNative(Window|AxElement)SurfaceInspectorCandidate|normalizeProjectionCapabilities|normalizeAdapterCapabilitySummary|chooseAnnotationCandidate|normalizeAnnotationCandidate|isImplicitAnnotationRootCandidate|surface-inspector-annotations" packages/toolkit apps/sigil tests docs --glob '*.js' --glob '*.mjs' --glob '*.md'
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic checks only. This slice should not require
live input unless deterministic tests reveal a runtime behavior gap.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-candidates.js` already owns neutral
  candidate ranking and normalization:
  `chooseAnnotationCandidate`, `normalizeAnnotationCandidate`, and
  `isImplicitAnnotationRootCandidate`.
- `packages/toolkit/workbench/surface-inspector-annotations.js` currently
  imports neutral candidate helpers, but still owns generic builder and summary
  helpers:
  `buildNativeWindowSurfaceInspectorCandidate`,
  `buildNativeAxElementSurfaceInspectorCandidate`,
  `normalizeProjectionCapabilities`, and
  `normalizeAdapterCapabilitySummary`.
- `apps/sigil/renderer/live-modules/main.js` currently imports native candidate
  builders from `workbench/surface-inspector-annotations.js` even though Sigil
  reticle targeting is not a Surface Inspector feature.
- `packages/toolkit/components/surface-inspector/index.js` also imports those
  native builders from `surface-inspector-annotations.js`; it is an owned
  consumer and should be updated to the neutral module if the builders move.
- `tests/toolkit/surface-inspector-annotations.test.mjs` currently mixes tests
  for shared candidate selection/normalization/native candidate builders with
  tests for Surface Inspector annotation state. Split or adjust tests so the
  neutral candidate contract has focused coverage under a neutral test file.
- `tests/renderer/annotation-reticle.test.mjs` already has a guard that
  `annotation-reticle.js` imports neutral candidate helpers. Add or extend a
  similar guard for `main.js` if it helps catch the remaining import leak.

## Required Behavior

### Neutral Candidate Boundary

Move generic helper behavior into `packages/toolkit/workbench/annotation-candidates.js`
or a tightly named sibling only if that reads better after inspection. The
preferred end state is that `annotation-candidates.js` exports:

- `chooseAnnotationCandidate`
- `normalizeAnnotationCandidate`
- `isImplicitAnnotationRootCandidate`
- neutral native candidate builders with non-Surface-Inspector names, for
  example:
  - `buildNativeWindowAnnotationCandidate`
  - `buildNativeAxElementAnnotationCandidate`
- neutral adapter capability helpers if they are not Surface Inspector-specific:
  - `normalizeAnnotationProjectionCapabilities`
  - `normalizeAnnotationAdapterCapabilitySummary`

Preserve the current candidate payload semantics:

- native window roots still use `adapter_id: 'macos-ax'`;
- native window roots keep `root_kind` and `subject_kind` as `native_window`;
- native AX elements still scope to the selected native window root;
- mismatched native AX cursor context remains `stale` with
  `native_ax_root_mismatch`;
- unbounded native AX elements remain `unsupported` with
  `bounded_ax_projection_unavailable`;
- bounded native candidates remain non-revealable with
  `bounded_ax_reveal_unavailable`;
- projection status normalization must continue to come from
  `annotation-projection.js`.

### Surface Inspector State Boundary

Keep `surface-inspector-annotations.js` focused on Surface Inspector annotation
state, pins, comments, scope stack, snapshot artifacts, hover state, projection
refresh from evidence, and Surface Inspector-specific snapshot support.

It may import neutral candidate helpers from `annotation-candidates.js`.

Do not leave generic candidate builder implementation in
`surface-inspector-annotations.js` just because current tests happen to import
it there.

### Owned Consumer Updates, Not Compatibility Adapters

Update owned callers and tests to the canonical neutral names.

Do not add repo-internal compatibility aliases such as:

- `buildNativeWindowSurfaceInspectorCandidate`
- `buildNativeAxElementSurfaceInspectorCandidate`

unless Implementer identifies a concrete non-updatable consumer and adds a clear removal
gate in the code and completion report. "Existing repo tests/callers" is not a
valid reason for compatibility aliases; this repo owns them and should update
them.

If an exported name is documented as a cross-tool public contract, update
`docs/api/toolkit/workbench.md` to name the new neutral boundary. Only keep a
temporary compatibility export if the card discovers a real external consumer
that cannot be updated in this slice, and record the removal trigger.

### Tests

Add focused neutral candidate tests, likely
`tests/toolkit/annotation-candidates.test.mjs`, covering at minimum:

- shared candidate ranking still prefers specific visible semantic/actionable
  targets over implicit roots and passive containers;
- `normalizeAnnotationCandidate` preserves adapter id, root id, subject id,
  projection, capabilities, state id, confidence, and source metadata;
- native window payloads become bounded `macos-ax` annotation candidates with
  stable root metadata;
- native AX element candidates scope to selected native window roots;
- native AX mismatches and unbounded elements preserve the current stale and
  unsupported blocker behavior;
- adapter-result-shaped candidates still preserve projection adapter ids.

Then leave `tests/toolkit/surface-inspector-annotations.test.mjs` focused on
Surface Inspector annotation state, pins, comments, snapshot artifacts,
projection refresh, hover state, and integration with neutral candidate helpers
where the state layer actually depends on them.

Add or update a renderer guard so
`apps/sigil/renderer/live-modules/main.js` no longer imports
`workbench/surface-inspector-annotations.js` for native reticle candidate
builders. It is acceptable for unrelated Surface Inspector surfaces to import
Surface Inspector support, but Sigil reticle/native candidate cache plumbing
should consume neutral workbench helpers.

### Documentation

Update `docs/api/toolkit/workbench.md` if the neutral candidate helper boundary
is now a consumer-facing workbench contract. Keep Surface Inspector docs scoped
to Surface Inspector state/session/snapshot support.

Do not rename snapshot schemas, emitted event names, or old artifact payload
fields in this slice. Names such as `surface_inspector_annotation_snapshot`,
`canvas_inspector.annotation_open`, and `canvas_inspector.annotation_state` are
compatibility surfaces and are out of scope.

## Scope

Likely ownership:

- `packages/toolkit/workbench/annotation-candidates.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/main.js`
- focused tests under `tests/toolkit/` and `tests/renderer/`
- `docs/api/toolkit/workbench.md` if the exported API boundary changes

Avoid daemon, Swift, schemas, runtime event names, Surface Inspector UI
redesign, Sigil radial/3D behavior, and live browser/canvas verification unless
deterministic tests expose a gap that cannot be checked otherwise.

## Hard Boundaries / Non-Goals

- Do not change annotation snapshot schema names, version strings, or artifact
  payload compatibility in this slice.
- Do not rename `surface_inspector_annotation_snapshot`,
  `canvas_inspector.annotation_open`, or `canvas_inspector.annotation_state`.
- Do not add repo-internal compatibility aliases for owned callers. If Implementer
  discovers a non-updatable consumer, name it and include a removal gate.
- Do not move Surface Inspector state/pin/comment/session behavior into
  `annotation-candidates.js`.
- Do not move Sigil product fallback behavior into toolkit. Sigil display-root
  fallback subjects in `annotation-reticle.js` are app-owned until a second
  consumer exists.
- Do not convert native AX reveal behavior or add live AX permissions work in
  this slice.
- Do not broaden this into a full annotation architecture rewrite.

## Suggested Implementation Areas

One acceptable implementation path:

1. Move the generic native candidate builder internals from
   `surface-inspector-annotations.js` to `annotation-candidates.js`, renaming
   public exports to neutral names.
2. Move or expose projection capability summary helpers from the neutral module
   if they are truly shared candidate/projection metadata rather than Surface
   Inspector state.
3. Update `surface-inspector-annotations.js` to import the neutral helpers and
   keep only Surface Inspector state/session/snapshot support there.
4. Update `packages/toolkit/components/surface-inspector/index.js` and
   `apps/sigil/renderer/live-modules/main.js` to import neutral helpers.
5. Split neutral candidate tests out of
   `tests/toolkit/surface-inspector-annotations.test.mjs` into a new focused
   `tests/toolkit/annotation-candidates.test.mjs`, or otherwise make the
   neutral boundary explicit without losing coverage.
6. Add a source guard in `tests/renderer/annotation-reticle.test.mjs` or a new
   focused renderer test so Sigil main native reticle builder imports do not
   regress back to `surface-inspector-annotations.js`.

If moving a helper makes the module name misleading or overlarge, prefer a
small neutral sibling such as `annotation-native-candidates.js`, then re-export
that from `annotation-candidates.js` or `workbench/index.js` only if the import
surface stays clear. Do not create a generic helper path under a
Surface Inspector filename.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json --files \
  packages/toolkit/workbench/annotation-candidates.js \
  packages/toolkit/workbench/surface-inspector-annotations.js \
  packages/toolkit/components/surface-inspector/index.js \
  apps/sigil/renderer/live-modules/main.js \
  tests/toolkit/annotation-candidates.test.mjs \
  tests/toolkit/surface-inspector-annotations.test.mjs \
  tests/renderer/annotation-reticle.test.mjs \
  docs/api/toolkit/workbench.md
node --check packages/toolkit/workbench/annotation-candidates.js
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --check packages/toolkit/components/surface-inspector/index.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/toolkit/annotation-candidates.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs tests/toolkit/annotation-projection.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
git diff --check
```

If `docs/api/toolkit/workbench.md` changes and
`./aos dev recommend --json --files ...` asks for the help contract, run:

```bash
bash tests/help-contract.sh
```

If no `tests/toolkit/annotation-candidates.test.mjs` exists before this slice,
create it and run it directly. If the implementation chooses a neutral sibling
module, add the corresponding `node --check` command.

Live AOS verification is not required unless Implementer changes runtime behavior
beyond imports and helper ownership. If `./aos ready` passes and Implementer wants a
bounded smoke, use it only as supplemental evidence; deterministic tests remain
the acceptance gate.

## Completion Report

Report back with:

- branch name and head SHA;
- files changed;
- exact helper names that became canonical;
- whether any compatibility export/alias remains; if yes, name the concrete
  non-updatable consumer and removal gate;
- confirmation that owned consumers no longer import native candidate builders
  from `surface-inspector-annotations.js`;
- tests run with exact pass/fail results;
- `./aos ready` result or exact readiness blocker;
- local-only state such as dirty files, untracked files, generated artifacts,
  local config, permissions, daemon state, or runtime blockers;
- any follow-up slice Implementer recommends, especially around old snapshot/event
  vocabulary that was intentionally left untouched.

For this card, include a short path-scoped summary of the final ownership:

- neutral candidate module responsibilities;
- Surface Inspector annotation module responsibilities;
- Sigil consumer responsibilities.
