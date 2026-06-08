# Surface Inspector Annotation Snapshot Artifact Correction V0

## Tracker

- Parent issue: https://github.com/michaelblum/agent-os/issues/298
- Corrects the in-progress slice:
  `docs/design/work-cards/surface-inspector-annotation-snapshot-artifact-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Work in `/Users/Michael/Code/agent-os`.
Do not assume daemon readiness; the repo daemon was stopped for the stale TCC
handoff after the prior rebuild. Do not run readiness or repair loops unless
the human has completed the macOS permission reset and says `finished`.

## Goal

Fix the annotation snapshot artifact image-data guard so it does not reject
normal user text while still rejecting embedded image payloads.

Foreman review found two issues:

1. `buildSurfaceInspectorAnnotationSnapshotArtifact(...)` currently rejects any
   long base64-looking string anywhere in the artifact. That can reject normal
   annotation text, labels, values, or excerpts. Repro:

   ```bash
   node --input-type=module - <<'NODE'
   import {
     createSurfaceInspectorAnnotationState,
     setSurfaceInspectorAnnotationMode,
     pinSurfaceInspectorFrame,
     addSurfaceInspectorComment,
     buildSurfaceInspectorAnnotationSnapshotArtifact,
   } from './packages/toolkit/workbench/surface-inspector-annotations.js'

   let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
   state = pinSurfaceInspectorFrame(state, { id: 'target', subject_path: ['main', 'target'] }, { id: 'pin-target' })
   state = addSurfaceInspectorComment(state, 'pin-target', 'A'.repeat(121), { id: 'comment-long' })
   buildSurfaceInspectorAnnotationSnapshotArtifact(state)
   console.log('ok')
   NODE
   ```

   Current result: `annotation snapshot artifact must reference external assets
   instead of embedding image data`.

2. The public schema rejects suspicious asset key names like
   `capture_image_base64`, but it currently allows a data URL value under a
   normal asset key:

   ```json
   {
     "capture": {
       "assets": {
         "capture_image": "data:image/png;base64,abc"
       }
     }
   }
   ```

   That violates the documented artifact contract: image data stays external
   and JSON carries paths/references only.

## Required Behavior

- Long normal annotation text, labels, values, excerpts, and ids must not cause
  snapshot artifact creation to throw merely because they look base64-like.
- `data:image/...` string values must still be rejected anywhere they can enter
  the artifact.
- Keys such as `base64`, `binary`, and `image_data` should remain rejected.
- If you keep opaque-base64 detection, restrict it to suspicious key paths such
  as `assets`, `image_data`, `binary`, or `base64`; do not scan every arbitrary
  user text value with a long-base64 heuristic.
- The public schema must reject embedded image data values in
  `capture.assets`, not only suspicious property names.
- Surface Inspector `syncDebugState()` should not become a crash path for a
  valid long comment.

## Likely Files

- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`
- `shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/invalid/`
- `tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs`

## Suggested Test Additions

- Builder accepts a long alphanumeric comment such as `'A'.repeat(121)`.
- Builder still rejects an explicit `assets.capture_image:
  "data:image/png;base64,abc"` input.
- Schema rejects a fixture where `capture.assets.capture_image` is a
  `data:image/...` value.
- Existing suspicious-key invalid fixture still fails.

## Verification

Run:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
git diff --check
```

If you touch Swift docs/config accidentally, also rerun the relevant checks from
the parent card. Otherwise this correction should stay in toolkit/schema tests.

## Completion Report

Report:

- exact guard change;
- schema value rejection change;
- tests added and results;
- whether any Swift or bundle integration files changed;
- whether the TCC/live-smoke blocker is unchanged.
