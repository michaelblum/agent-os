# Annotation Session Surface Inspector Adapter Boundary V0

## Tracker

- Follows current `main` after:
  - `docs/design/work-cards/annotation-projection-reveal-normalization-v0.md`
  - `docs/design/work-cards/annotation-candidate-helper-neutralization-v0.md`
- Current neutral session model:
  `packages/toolkit/workbench/annotation-session.js`
- Current neutral overlay renderer:
  `packages/toolkit/workbench/annotation-overlay-renderer.js`
- Current Surface Inspector support module:
  `packages/toolkit/workbench/surface-inspector-annotations.js`
- API boundary:
  `docs/api/toolkit/workbench.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, prior implementation state, or Foreman thread context. Read
and rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

This is a neutral-boundary cleanup. Keep behavior stable and focused on module
ownership. Do not change annotation UX, snapshot schemas, emitted event names,
or Surface Inspector product behavior.

## Goal

Move Surface Inspector-specific session adapter logic out of neutral Annotation
Session and Annotation Overlay Renderer modules.

After this slice:

- `annotation-session.js` should expose only neutral session, subject, anchor,
  status, commit, refresh, and opacity helpers;
- `annotation-overlay-renderer.js` should convert an
  `aos_annotation_session` into an overlay render plan and should not know how
  Surface Inspector pins/comments are shaped;
- Surface Inspector compatibility adapters, including pin-to-anchor and
  state-to-session conversion, should live behind a Surface Inspector support
  boundary such as `surface-inspector-annotations.js` or a tightly named
  sibling;
- owned callers and tests should import the canonical adapter from the Surface
  Inspector support boundary, not from neutral session or renderer modules.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `.docks/foreman/skills/session-transfer/references/implementer-work-card-authoring.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/work-cards/annotation-candidate-helper-neutralization-v0.md`
- `docs/design/work-cards/annotation-projection-reveal-normalization-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/toolkit/annotation-session.test.mjs`
- `tests/toolkit/annotation-overlay-renderer.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json --files \
  packages/toolkit/workbench/annotation-session.js \
  packages/toolkit/workbench/annotation-overlay-renderer.js \
  packages/toolkit/workbench/surface-inspector-annotations.js \
  packages/toolkit/components/surface-inspector/index.js \
  tests/toolkit/annotation-session.test.mjs \
  tests/toolkit/annotation-overlay-renderer.test.mjs \
  tests/toolkit/surface-inspector-annotations.test.mjs \
  tests/toolkit/surface-inspector.test.mjs \
  docs/api/toolkit/workbench.md
rg -n "surfaceInspectorPinToAnnotationAnchor|surfaceInspectorAnnotationStateToSession|activeSurfaceInspectorPins|activeSurfaceInspectorComments|activeSurfaceInspectorFramePath" packages/toolkit tests docs --glob '*.js' --glob '*.mjs' --glob '*.md'
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, report the exact
blocker and continue deterministic checks only. This slice should not require
live input verification unless Implementer changes runtime behavior beyond imports and
module ownership.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-session.js` currently exports
  `surfaceInspectorPinToAnnotationAnchor`, which is a Surface Inspector
  compatibility adapter living in the neutral session model.
- `packages/toolkit/workbench/annotation-overlay-renderer.js` currently imports
  that adapter and exports `surfaceInspectorAnnotationStateToSession`; it also
  contains Surface Inspector-specific helpers for active pins, comments, and
  frame paths.
- `packages/toolkit/workbench/surface-inspector-annotations.js` currently
  imports `surfaceInspectorAnnotationStateToSession` from the overlay renderer
  to build snapshot artifacts.
- `packages/toolkit/components/surface-inspector/index.js` imports
  `surfaceInspectorAnnotationStateToSession` from the overlay renderer for
  support UI and controlled overlay sync.
- `tests/toolkit/annotation-session.test.mjs` and
  `tests/toolkit/annotation-overlay-renderer.test.mjs` currently cover some
  Surface Inspector compatibility behavior through neutral modules.
- `docs/api/toolkit/workbench.md` currently documents the Surface Inspector
  compatibility adapter under the neutral overlay renderer usage block.

## Required Behavior

### Neutral Session Boundary

`annotation-session.js` must remain the canonical home for neutral session
behavior:

- session schema/version constants;
- neutral entry source, subject address, anchor, and projection evidence
  normalization;
- preview, commit, refresh, clear, and opacity helpers.

It should not export helpers named for Surface Inspector, pins, Canvas
Inspector, or snapshot compatibility. If a generic helper is needed to support
the adapter, name it around neutral subjects or anchors.

### Neutral Overlay Renderer Boundary

`annotation-overlay-renderer.js` must accept an `aos_annotation_session` and
return an overlay render plan. It should not know the shape of
Surface Inspector state, pins, comments, or active frame ids.

Keep existing overlay behavior stable:

- committed frames, preview frames, hover candidates, comment chips, and active
  comment inputs remain distinguishable;
- stale, absent, blocked, and non-projectable records still enter
  `frame_states` instead of drawing fake live rectangles;
- group signatures remain stable enough to avoid unnecessary overlay updates.

### Surface Inspector Compatibility Boundary

Move Surface Inspector state-to-session compatibility into a Surface Inspector
support boundary. Acceptable homes:

- `packages/toolkit/workbench/surface-inspector-annotations.js`, if the added
  code stays readable; or
- a tightly named sibling such as
  `packages/toolkit/workbench/surface-inspector-session-adapter.js`, re-exported
  only from the Surface Inspector support module if that keeps imports clearer.

The compatibility adapter must preserve current behavior:

- active, non-removed pins become annotation anchors;
- active comments are joined as anchor `comment_text`;
- active frame path becomes `committed_scope_stack`;
- hover candidate remains preview-only and extends `preview_scope_stack`;
- `entry_source` defaults to `surface_inspector`;
- `snapshot_count`, root selection, subject addresses, projection evidence,
  stale/blocker evidence, actor, timestamps, and comments preserve current
  semantics.

Internal `pin` fields may remain inside the Surface Inspector compatibility
boundary. Do not rename snapshot payload fields in this slice.

### Owned Consumers And Tests

Update owned consumers to import the adapter from the Surface Inspector support
boundary:

- `packages/toolkit/components/surface-inspector/index.js`;
- `packages/toolkit/workbench/surface-inspector-annotations.js`;
- focused tests.

Move or adjust tests so neutral modules are tested for neutral behavior, while
Surface Inspector adapter behavior is tested through the Surface Inspector
support boundary. Add a source guard if it helps prevent regression:

- neutral session/overlay modules should not contain `surfaceInspector`,
  `SurfaceInspector`, or `pinToAnnotationAnchor` adapter exports;
- Surface Inspector support tests should still prove compatibility conversion.

### Documentation

Update `docs/api/toolkit/workbench.md` so:

- Annotation Session docs describe the neutral session model and opacity helper;
- Annotation Overlay Renderer docs describe only session-to-render-plan
  behavior;
- Surface Inspector support docs own the compatibility adapter import/example;
- the text remains clear that future tooling contexts should produce the shared
  session model directly.

## Scope

Likely ownership:

- `packages/toolkit/workbench/annotation-session.js`;
- `packages/toolkit/workbench/annotation-overlay-renderer.js`;
- `packages/toolkit/workbench/surface-inspector-annotations.js` or a tightly
  named Surface Inspector adapter sibling;
- `packages/toolkit/components/surface-inspector/index.js`;
- focused toolkit tests;
- `docs/api/toolkit/workbench.md`.

This is a toolkit workbench/component refactor. It should not touch daemon,
Swift, Sigil runtime behavior, browser DOM/CDP adapters, snapshot schemas, or
runtime event names.

## Hard Boundaries / Non-Goals

- Do not rename `surface_inspector_annotation_snapshot`.
- Do not rename emitted events such as `canvas_inspector.annotation_open`,
  `canvas_inspector.annotation_state`, or `canvas_inspector.capture_bundle`.
- Do not rename public snapshot artifact fields such as `pins`, `pin_id`, or
  `frame_path_pin_ids`.
- Do not change Surface Inspector UI behavior, display overlays, minimap
  behavior, reticle behavior, reveal behavior, or snapshot bundle output beyond
  import/module ownership.
- Do not add repo-internal compatibility aliases in neutral modules. If a
  compatibility export must remain, name the concrete non-updatable consumer and
  add a removal gate in the completion report.
- Do not broaden this into a full annotation architecture rewrite.

## Suggested Implementation Areas

One acceptable implementation path:

1. Move `surfaceInspectorPinToAnnotationAnchor` from
   `annotation-session.js` to the Surface Inspector support boundary.
2. Move `surfaceInspectorAnnotationStateToSession` and its active pin/comment
   helpers from `annotation-overlay-renderer.js` to the same support boundary.
3. Update Surface Inspector component and snapshot code to import the adapter
   from the Surface Inspector support boundary.
4. Keep `annotation-overlay-renderer.js` dependent only on neutral session
   helpers such as `createAnnotationSession`, `normalizeAnnotationSubjectAddress`,
   and `opacityForDepth`.
5. Move adapter-specific tests out of neutral session/overlay tests where that
   makes the boundary clearer, while preserving coverage for the converted
   compatibility behavior.
6. Update API docs to show the new import boundary.

If a helper becomes generic during the move, give it a neutral name and prove it
has no Surface Inspector-specific assumptions.

## Verification

Run focused deterministic checks:

```bash
./aos dev recommend --json --files \
  packages/toolkit/workbench/annotation-session.js \
  packages/toolkit/workbench/annotation-overlay-renderer.js \
  packages/toolkit/workbench/surface-inspector-annotations.js \
  packages/toolkit/components/surface-inspector/index.js \
  tests/toolkit/annotation-session.test.mjs \
  tests/toolkit/annotation-overlay-renderer.test.mjs \
  tests/toolkit/surface-inspector-annotations.test.mjs \
  tests/toolkit/surface-inspector.test.mjs \
  docs/api/toolkit/workbench.md
node --check packages/toolkit/workbench/annotation-session.js
node --check packages/toolkit/workbench/annotation-overlay-renderer.js
node --check packages/toolkit/workbench/surface-inspector-annotations.js
node --check packages/toolkit/components/surface-inspector/index.js
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/annotation-overlay-renderer.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs tests/toolkit/surface-inspector.test.mjs
rg -n "surfaceInspectorPinToAnnotationAnchor|surfaceInspectorAnnotationStateToSession|activeSurfaceInspectorPins|activeSurfaceInspectorComments|activeSurfaceInspectorFramePath" packages/toolkit/workbench/annotation-session.js packages/toolkit/workbench/annotation-overlay-renderer.js
git diff --check
```

If `docs/api/toolkit/workbench.md` changes and the workflow router asks for the
help contract, run:

```bash
bash tests/help-contract.sh
```

No live AOS smoke is required for pure module-boundary cleanup. If Implementer changes
runtime behavior or Surface Inspector UI output, run one bounded live smoke
after `./aos ready` passes and report the exact steps and results.

## Completion Report

Report back with:

- branch name and head SHA;
- files changed;
- canonical home and exported names for the Surface Inspector session adapter;
- confirmation that neutral `annotation-session.js` no longer exports
  Surface Inspector/pin adapters;
- confirmation that neutral `annotation-overlay-renderer.js` no longer exports
  or implements Surface Inspector state-to-session conversion;
- whether any compatibility export remains in a neutral module, and if so the
  concrete non-updatable consumer and removal gate;
- confirmation that snapshot schemas, emitted event names, and snapshot payload
  fields were not renamed;
- exact tests run with pass/fail results;
- `./aos ready` result or exact readiness blocker;
- local-only state such as dirty files, untracked files, generated artifacts,
  local config, permissions, daemon state, or runtime blockers;
- any follow-up slice Implementer recommends.
