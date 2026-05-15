# Display-First Annotation Sigil Reticle Camera/Input Correction V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent Sigil reticle card:
  `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

This card is a correction on top of the current dirty Sigil reticle V0 slice.
Do not checkpoint, commit, push, or broaden the #296 workstream.

## Goal

Close the remaining live acceptance blockers from Operator's Sigil reticle V0
smoke:

1. Camera radial activation did not produce `sigil.annotation_reticle.snapshot_request`
   or `canvas_inspector.capture_bundle` evidence even when live anchors existed
   and `annotation-camera` was visible.
2. Operator suspected mouse events falling through to native apps during live
   avatar radial-menu testing. Collect routing evidence and fix the ownership
   bug if it is in Sigil/radial target-surface code. If it is a daemon/input
   primitive gap, preserve a concrete blocker report instead of guessing.

The accepted reticle drag/reentry/commit behavior must stay intact.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
./aos show list --json
rg -n "annotationSnapshot|annotation-camera|requestAnnotationSnapshot|radial_item_click|radialTargetSurface|input_region|mouse|passthrough|interactive" apps/sigil packages/toolkit tests
```

Operator evidence artifacts from the failed live smoke:

```text
/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-real-input-artifacts/operator-reticle-outward-1778717331096-43861.json
/var/folders/hm/d5_18wks38q0lrdhtjpkpw8h0000gq/T/aos-real-input-artifacts/operator-camera-target-fail-1778717479130-45231.json
```

Useful observed facts from those artifacts:

- `annotation-camera` was visible after a reticle commit:
  `item_ids=["context-menu","agent-terminal","annotation-mode","annotation-camera","wiki-graph"]`.
- `camera_available=true` and `live_anchor_count=2`.
- The failed camera probe timed out waiting for `snapshot_request` /
  `canvas_inspector.capture_bundle`; final snapshot was already `IDLE` with the
  radial target surface disabled and no `snapshot_request` event recorded.
- The reticle drag/commit path passed: entry source was `sigil_radial`, commit
  included root/display evidence and deterministic placement.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, stop and report the
blocker with the repo-standard permission handoff. This slice is real-input
work and should not be accepted without live verification or a concrete blocker.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` owns radial item activation,
  target-surface message handling, annotation snapshot request emission, and
  interaction trace.
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` owns
  AX-visible radial target surface sync and enabled/disabled bounds.
- `apps/sigil/renderer/radial-menu-surface.html` owns click dispatch from the
  child target surface back to `avatar-main`.
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js` owns camera item
  filtering based on `state.annotationReticle`.
- `apps/sigil/renderer/live-modules/input-regions.js` and
  `apps/sigil/renderer/live-modules/hit-target.js` own Sigil's current
  DesktopWorld/native input claims.
- `packages/toolkit/runtime/desktop-world-hit-region.js` is the shared
  controller used by the radial target surface.

## Required Behavior

### Camera Activation

When live annotation anchors exist and the radial menu exposes
`annotation-camera` / `Snapshot`, activating that item through the semantic
radial target surface must:

- invoke the same action as a model release over the camera item;
- record `sigil.annotation_reticle.snapshot_request` in
  `annotationReticleEvents`;
- post `canvas_inspector.capture_bundle` with trigger `sigil_radial_camera`;
- leave Sigil in a bounded idle state with the radial target surface cleaned up;
- avoid regressing the hidden-camera behavior when no live anchors exist.

If the current live click can disable the radial target surface without
dispatching `radial_item_click`, capture the reason and fix the target-surface
routing or interaction ownership at the narrowest correct layer.

### Input Fallthrough Evidence

Do not guess at the mouse fallthrough report. Add or use existing trace fields
to answer:

- Did the radial child surface receive the click?
- Did `avatar-main` receive a `canvas_message` from the radial child surface?
- Did daemon `input_event` delivery also reach Sigil while the child target
  surface was active?
- Did the radial target surface bounds remain interactive at the pointer point
  until click dispatch completed?

If the bug is in Sigil state/routing, fix it in Sigil. If evidence shows a
daemon/native input-region ownership gap, report that exact primitive gap and
leave the slice blocked for Foreman routing. Do not make `avatar-main` broadly
interactive or add Sigil-named daemon policy as a workaround.

### Preserve Accepted Behavior

Keep these Operator-passed behaviors intact:

- `annotation-mode` semantic target appears.
- Dragging through reticle enters `entry_source: "sigil_radial"`.
- Radial reentry exits reticle mode.
- Reticle release records `sigil.annotation_reticle.commit` and uses
  deterministic placement, not raw release coordinates.
- Annotation item click does not leave Sigil `IDLE` with
  `annotationReticle.active === true`.
- No-display/startup reticle entry stays blocked/unresolved instead of
  crashing.

## Scope

Likely ownership is Sigil app plus narrow toolkit runtime only if the shared
hit-region controller is dropping or racing messages. Keep toolkit changes
generic. Do not add daemon product branches named for Sigil, avatar, radial
menu, reticle, or camera.

## Suggested Implementation Areas

- Add deterministic coverage for camera request emission through the same
  action path used by radial target-surface clicks.
- Add focused target-surface tests if the issue is stale payload, disabled
  bounds, or missing item dispatch.
- Add bounded interaction-trace evidence around radial child-surface message
  receipt, item id, current state, target surface bounds, and ignored reasons.
- If needed, adjust `handleRadialTargetSurfaceEvent()` so the camera click
  cannot be lost silently and does not get mistaken for a cancellation or normal
  fallthrough input.

## Verification

Run focused deterministic checks:

```bash
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/fast-travel-preview.test.mjs
node --test tests/renderer/radial-menu-activation.test.mjs
node --test tests/toolkit/runtime-radial-gesture.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
git diff --check
```

If `./aos ready` passes, run or prepare a bounded live verification path for
Operator:

1. Run the canonical real-input radial scenario:
   `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`.
2. Seed a reticle commit so live anchors exist.
3. Reopen radial and activate `annotation-camera` through the semantic target
   surface.
4. Verify `snapshot_request` and `canvas_inspector.capture_bundle` evidence.
5. Verify no native-app fallthrough occurs, or capture the exact event-routing
   evidence showing where ownership fails.
6. Clean up canvases and report final `./aos ready` plus
   `git status --short --branch`.

## Completion Report

Report:

- changed files;
- exact root cause of the camera timeout or why it remains blocked;
- whether the suspected mouse fallthrough was reproduced, disproved, or
  converted into a concrete lower-layer blocker;
- deterministic tests run and results;
- live smoke run and results, or the exact handoff for Operator;
- final `./aos ready`;
- final `git status --short --branch`;
- whether Foreman should request another `/review` before Operator retest.
