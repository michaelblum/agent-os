# Display-First Annotation Snapshot Continuity V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Foundation issue: https://github.com/michaelblum/agent-os/issues/296
- Snapshot issue: https://github.com/michaelblum/agent-os/issues/298
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Existing snapshot artifact card:
  `docs/design/work-cards/surface-inspector-annotation-snapshot-artifact-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, live annotation state, Sigil state, bundle
config, or prior implementation state. Read and rediscover before editing. Work
in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Goal

Connect explicit Annotation Mode snapshots to the accepted display-first shared
session model.

Snapshots are durable point-in-time evidence. Live annotations remain in-memory
and tied to live subjects. This slice should make Surface Inspector see-bundle
captures and Sigil camera captures preserve the same session-derived root,
scope, anchors, comments, projection status, stale/blocker state, and adapter
evidence without creating a persistent annotation database or adding a second
snapshot model.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/display-first-annotation-session-model-v0.md`
- `docs/design/work-cards/display-first-annotation-overlay-renderer-v0.md`
- `docs/design/work-cards/display-first-annotation-surface-inspector-support-demotion-v0.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- `docs/design/work-cards/display-first-annotation-settled-reprojection-v0.md`
- `docs/design/work-cards/display-first-annotation-regression-repair-v0.md`
- `docs/design/work-cards/surface-inspector-annotation-snapshot-artifact-v0.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `docs/api/aos.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos dev recommend --json
./aos dev gh issue view 296 --json
./aos dev gh issue view 298 --json
rg -n "annotation-snapshot|capture_bundle|snapshot_count|requestSeeBundle|annotation_snapshot|sigil_radial_camera" packages apps tests docs shared
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop repair.
Report the exact blocker and continue deterministic tests only unless Foreman or
the human explicitly routes runtime repair work.

## Existing Code To Inspect

- `packages/toolkit/workbench/annotation-session.js` - shared display-first
  session, anchors, scope stacks, `snapshot_count`, and live-session reset
  behavior.
- `packages/toolkit/workbench/annotation-overlay-renderer.js` - current
  session-to-overlay adapter and Surface Inspector compatibility projection.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - current
  annotation state, snapshot payload builder, stale/reprojection state, and
  public snapshot artifact constants.
- `packages/toolkit/components/surface-inspector/index.js` - Annotation Mode
  orchestration, `requestSeeBundle(...)`, bundle status, and
  `canvas_inspector.capture_bundle` emission.
- `apps/sigil/renderer/live-modules/main.js` - Sigil reticle camera path and
  `sigil_radial_camera` bundle request.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` - live reticle
  anchors, camera availability, and snapshot request event shape.
- `src/daemon/surface-inspector-bundle.swift` - bundle file orchestration and
  `annotation-snapshot.json` inclusion.
- `tests/toolkit/annotation-session.test.mjs`
- `tests/toolkit/annotation-overlay-renderer.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs`

## Required Behavior

### 1. Snapshot From The Shared Session Boundary

Ensure the public `annotation-snapshot.json` artifact is derived from the
accepted display-first session boundary, or from a clearly named compatibility
adapter that converts current Surface Inspector state into that session shape.

The snapshot must preserve:

- session id or equivalent capture context when available;
- entry source;
- active root;
- committed scope stack;
- preview scope stack or its point-in-time absence;
- hover candidate as preview evidence only;
- live anchors and comments;
- projection status, stale/absent/blocker reasons, and adapter capability
  evidence;
- `snapshot_count` semantics without treating snapshots as a live database.

Do not use last-known rectangles as live truth. If stale or absent evidence is
recorded, mark it explicitly in the artifact.

### 2. Multi-Entry Capture Continuity

Surface Inspector support UI and Sigil radial camera captures should request
the same bundle/snapshot path and produce compatible artifact semantics.

Expected behavior:

- `requestSeeBundle(...)` still emits `canvas_inspector.capture_bundle`;
- Sigil camera requests still use trigger `sigil_radial_camera`;
- successful captures increment the live session's snapshot evidence exactly
  once where the current architecture can observe success;
- failed or unavailable captures do not pretend to persist a snapshot;
- taking a snapshot leaves live anchors in place for continued refinement;
- no Sigil-specific snapshot schema is introduced.

If the current event boundary cannot report capture success back to the shared
session without broad daemon work, preserve a narrow blocker/proposal in the
completion report instead of guessing.

### 3. Public Artifact Compatibility

Keep the existing snapshot artifact contract compatible:

- schema remains `surface_inspector_annotation_snapshot`;
- version remains `0.1.0` unless a schema change is truly required;
- `bundle.json.files.annotation_snapshot_json` still points to
  `annotation-snapshot.json`;
- existing bundle directory clipboard behavior remains unchanged;
- `see.canvas_inspector_bundle.include.annotation_snapshot` remains default-on;
- JSON must not embed image binaries or base64 image data.

If a public schema or docs update is needed, update the shared schema/docs at
the interface boundary. Do not silently change fixture shape without explaining
why the shape is now more faithful to the shared session.

### 4. Explicit Non-Persistence

Preserve the display-first lifetime rule:

- live annotations are in-memory and tied to their subject/window/process;
- snapshots are point-in-time evidence only;
- snapshot artifacts must not become the hidden source of truth for active
  annotations after live state disappears;
- disk-write-disabled clipboard-payload mode and settings/menu exposure remain a
  later #298 slice unless the implementation exposes an unavoidable tiny seam.

### 5. Keep The Hot Path Cheap

Snapshot continuity must not regress accepted display-first performance:

- no fresh AX, DOM, or CDP discovery on every mousemove;
- no create/destroy canvas churn per hover;
- no new Sigil hot-path work while the radial menu is open;
- no broad Surface Inspector authoring UI revival.

## Scope

Likely ownership:

- toolkit workbench/session/snapshot helpers;
- Surface Inspector component capture wiring;
- Sigil camera request wiring only if continuity evidence shows a narrow gap;
- daemon bundle orchestration only if the existing generic bundle path cannot
  carry the session-derived artifact;
- shared schema/docs/tests only if the public artifact contract changes.

Keep daemon behavior generic. Do not add product-specific daemon branches for
Sigil, reticles, or Surface Inspector annotation policy.

## Hard Boundaries / Non-Goals

- No persistent annotation database.
- No sync service.
- No report/export renderer.
- No arbitrary browser DOM/CDP adapter work.
- No broad AX harvesting.
- No image binary or base64 data embedded in JSON.
- No Surface Inspector-first authoring revival.
- No snapshot settings/menu UI unless it is an unavoidable tiny compatibility
  correction.
- No Employer Brand workflow changes.

## Suggested Implementation Areas

After inspection, likely edits are:

- add or refine a session-to-snapshot helper near
  `packages/toolkit/workbench/surface-inspector-annotations.js`;
- add focused tests that snapshot artifacts carry session root/scope/anchor
  semantics and explicit stale/absent status;
- adjust `packages/toolkit/components/surface-inspector/index.js` only where it
  needs to keep `snapshot_count` or capture status synchronized;
- adjust Sigil reticle tests only if the camera path lacks enough trigger or
  success/failure evidence for continuity;
- update schema/docs only if the artifact shape must expose a missing shared
  session field.

Prefer small adapters over broad rewrites. If current Surface Inspector state is
still the easiest source, name that adapter and keep the long-term source of
truth clear in code and docs.

## Verification

Run focused deterministic checks:

```bash
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/toolkit/annotation-overlay-renderer.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
git diff --check
```

If Swift/bundle/config code changes, also run:

```bash
./aos dev recommend --json
./aos dev build
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
```

If `./aos ready` passes, run a bounded live smoke:

1. Open Surface Inspector or use the accepted Sigil reticle path.
2. Enter Annotation Mode and create or reuse at least one visible frame anchor
   and one comment.
3. Trigger a snapshot through `requestSeeBundle(...)` or the Sigil camera.
4. Verify `annotation-snapshot.json` records the same root/scope/anchor/comment
   state shown by the display-first session.
5. Verify stale/blocked evidence is marked as such and not drawn or recorded as
   live truth.
6. Verify live anchors remain after capture.
7. Clean up smoke canvases and temp artifacts.

If live readiness is blocked, report the exact blocker and the deterministic
coverage completed.

## Completion Report

Report:

- changed files;
- final session-to-snapshot boundary and helper path;
- how Surface Inspector and Sigil camera captures share the artifact semantics;
- whether `snapshot_count` is incremented, left unchanged, or blocked by a
  missing success boundary;
- public schema/docs compatibility status;
- deterministic tests and results;
- live smoke result or readiness blocker;
- final `git status --short --branch`;
- recommended next #298 slice, likely disk-write-disabled clipboard payload mode
  and settings/menu exposure if snapshot continuity is accepted.
