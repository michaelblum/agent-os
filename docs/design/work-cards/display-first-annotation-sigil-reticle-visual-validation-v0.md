# Display-First Annotation Sigil Reticle Visual Validation V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Related Sigil issue: https://github.com/michaelblum/agent-os/issues/305
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Builds on accepted #296 slices:
  - `94a46bd Preserve annotation anchor data on status refresh`
  - `a082196 Add display-first annotation overlay renderer`
  - `5772d43 Demote Surface Inspector annotation authoring UI`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. Work in `/Users/Michael/Code/agent-os`, not in
`.docks/`.

The shared annotation session model, display overlay renderer, and Surface
Inspector support-demotion slice are already implemented. Do not reimplement
Surface Inspector annotation state inside Sigil. This slice is Sigil visual and
gesture validation for the display-first Annotation Mode direction.

## Goal

Add the first Sigil radial reticle prototype for display-first Annotation Mode.

The prototype should let Sigil prove the corrected interaction grammar:

- a radial reticle item can enter Annotation Mode;
- dragging through the reticle switches the fast-travel vector into the
  corrected reticle/gold treatment;
- the drag cursor behaves like an annotation preview selector instead of normal
  travel while the annotation reticle is active;
- returning to the radial interior exits Annotation Mode and restores normal
  fast-travel visuals;
- releasing from annotation reticle mode commits a bounded preview event and
  uses deterministic travel placement rather than traveling to the raw cursor
  coordinate;
- a camera radial affordance can request a snapshot when live annotation anchors
  exist.

This is visual validation and integration groundwork, not the full settled
reprojection or adapter matrix.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/display-first-annotation-session-model-v0.md`
- `docs/design/work-cards/display-first-annotation-overlay-renderer-v0.md`
- `docs/design/work-cards/display-first-annotation-surface-inspector-support-demotion-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/radial-gesture-visuals.test.mjs`
- `tests/renderer/fast-travel-preview.test.mjs`
- `tests/toolkit/runtime-radial-gesture.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos dev gh issue view 296 --json
./aos dev recommend --json
rg -n "annotation|reticle|radialGesture|FAST_TRAVEL|fastTravel|camera|capture_bundle|annotation_toggle" apps/sigil packages/toolkit src tests docs
```

Use the repo wrapper syntax exactly as shown for GitHub issue discovery. Do not
append a raw `gh issue view --json <fields>` field list to
`./aos dev gh issue view`; the wrapper expects one issue number plus `--json`.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, stop and report the
blocker with the concrete human recovery step. This slice is gesture/display
work and should not be accepted without live or Operator verification.

If `./aos dev recommend --json` reports broad changed files because the branch
is ahead of origin, treat that as branch context rather than this card's test
scope. If you touch Swift, use `./aos dev build`; do not call `bash build.sh`
directly.

## Existing Code To Inspect

- `apps/sigil/renderer/radial-menu-defaults.js` - declares default radial items
  and geometry/action metadata.
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js` - owns Sigil's
  wrapper around the toolkit radial gesture model.
- `packages/toolkit/runtime/radial-gesture.js` - owns generic radial phase,
  item hit, handoff, reentry, and release math.
- `apps/sigil/renderer/live-modules/main.js` - owns Sigil gesture state
  transitions, radial item activation, fast-travel handoff/reentry, and debug
  snapshots.
- `apps/sigil/renderer/live-modules/interaction-overlay.js` - draws the current
  normal fast-travel dashed vector/arrow treatment.
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js` - owns radial
  item 3D glyph/model rendering.
- `apps/sigil/renderer/live-modules/fast-travel.js` and
  `tests/renderer/fast-travel-preview.test.mjs` - own fast-travel gesture and
  preview state.
- `src/daemon/surface-inspector-bundle.swift` and `src/display/status-item.swift`
  - existing Canvas Inspector annotation/snapshot entry precedents if Sigil
  needs a generic request path. Do not add Sigil-named daemon policy.

## Required Behavior

### Radial Reticle Item

Add a default radial item for Annotation Mode. Suggested identity:

```js
{
  id: 'annotation-mode',
  label: 'Annotate',
  action: 'annotationMode',
  geometry: ...
}
```

The visual should read as a reticle/crosshair, not as a generic gear or tablet.
Prefer a lightweight code-native glyph or existing radial visual system. Do not
add a new bitmap/model asset unless the codebase reveals a clear local precedent
and licensing path.

The item must remain discoverable through the radial target surface and debug
snapshots just like existing items.

### Annotation Reticle Gesture State

Dragging through or selecting the annotation reticle item should enter an
annotation reticle state with `entry_source: "sigil_radial"` semantics. Use the
shared annotation session model for any local session state instead of inventing
a private shape.

The Sigil debug snapshot should expose enough state for tests and Operator:

- whether annotation reticle mode is active;
- entry source;
- current root/display evidence;
- preview pointer or target evidence;
- last committed annotation reticle event;
- whether a snapshot/camera affordance is available.

If a true shared Annotation Mode transport is missing, do not fake durable
anchors. Emit a structured, inspectable Sigil event/proposal and report the
missing primitive in the completion report. The V0 must still prove the radial
gesture, visual treatment, and bounded commit payload.

### Canvas Inspector Entry Bridge

If Sigil can reuse an existing generic Canvas Inspector request path to open or
toggle Annotation Mode, use it. If no such path exists, add the smallest generic
Canvas Inspector request needed, modeled after existing bundle capture/status
entrypoints. Keep it named for Canvas Inspector or Annotation Mode, not Sigil.

Acceptable direction:

- `canvas_inspector.annotation_toggle` remains the canvas-visible toggle event;
- a generic daemon/canvas message may open Surface Inspector and post that
  toggle, similar to the status-item annotation entry;
- `canvas_inspector.capture_bundle` remains the snapshot request path for the
  camera affordance.

Hard boundary: do not add daemon branches named for Sigil, avatar, radial menu,
or reticle.

### Gold Reticle Vector Treatment

While annotation reticle mode is active, the existing fast-travel vector should
switch from the normal greenish line/arrow treatment to the corrected annotation
treatment:

- gold dashed vector;
- circle/cross reticle at the drag cursor;
- no normal arrow-head wings while in annotation reticle mode;
- normal treatment restored when annotation reticle mode exits.

Returning to the radial interior should exit Annotation Mode / annotation
reticle mode and restore normal radial behavior.

### Bounded Preview Commit And Travel Placement

On release from annotation reticle mode:

- produce an inspectable commit/proposal event that includes the root/display
  evidence, release point, preview pointer/target evidence, and the annotation
  session snapshot or bounded equivalent;
- use deterministic travel placement for the avatar destination rather than the
  exact cursor coordinate.

Use the placement cascade from the design note, scoped to what the code can
project in this slice:

1. compute outside corner candidates for the visible target/display rect;
2. sort by distance to release point;
3. choose the first candidate where the full avatar hit box fits in visible
   display bounds;
4. fall back to inside corners, edge midpoints, then target center with
   `placement_status: "constrained"` if needed.

If the only reliable V0 target is the display under the release point, implement
that target honestly and expose the limitation in the commit payload. Do not
pretend child/window/AX/DOM candidates are supported before a real adapter
exists.

### Camera Snapshot Affordance

When live annotation anchors exist, expose a camera radial affordance. In V0,
"live annotation anchors exist" may come from either:

- a shared annotation session maintained by this slice; or
- the latest `canvas_inspector.annotation_state` broadcast if Surface Inspector
  is open and reporting pins/anchors.

Activating the camera should request the existing Canvas Inspector see-bundle
snapshot path, not create a new snapshot database. Prefer the existing
`canvas_inspector.capture_bundle` request path where possible.

If no reliable anchor-state source is available in this slice, do not fake the
camera item as always available. Keep it hidden/disabled and report the missing
state source as the follow-up.

## Scope

Ownership is Sigil app plus narrow toolkit helper only if needed:

- Sigil owns the radial item, reticle visuals, gesture state, debug snapshot,
  and product expression.
- Toolkit may own a reusable pure helper for deterministic travel placement if
  the implementation would otherwise duplicate neutral geometry logic.
- Daemon changes are allowed only for a tiny generic Canvas Inspector request
  bridge if Sigil cannot reach the existing Annotation Mode/snapshot entry
  points.

## Hard Boundaries / Non-Goals

- No settled reprojection engine.
- No browser DOM/CDP adapter.
- No broad AX harvesting.
- No freehand drawing.
- No long-lived annotation database.
- No snapshot artifact schema redesign.
- No removal of existing radial items.
- No remodel of `avatar-main` surface architecture.
- No migration of Sigil to shared DesktopWorld stage in this slice.
- No daemon product policy named for Sigil, avatar, radial menu, or reticle.

## Suggested Implementation Areas

After reading the code, likely edits are:

- `apps/sigil/renderer/radial-menu-defaults.js`
  - add the annotation reticle radial item and optionally camera item metadata.
- `apps/sigil/renderer/live-modules/main.js`
  - track annotation reticle state, integrate radial item activation/hover,
    expose debug snapshot fields, and bridge to Canvas Inspector requests.
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
  - render the gold reticle vector treatment when annotation reticle mode is
    active.
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
  - add a reticle/camera glyph if the existing fallback glyphs are insufficient.
- `packages/toolkit/workbench/annotation-session.js` or a new small helper only
  if Sigil needs shared session/placement behavior that belongs below the app.
- `src/daemon/surface-inspector-bundle.swift` or adjacent daemon canvas-message
  handling only if a generic Canvas Inspector request bridge is required.

## Verification

Run focused deterministic checks appropriate to touched files. Likely minimum:

```bash
node --check apps/sigil/renderer/radial-menu-defaults.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
node --test tests/renderer/fast-travel-preview.test.mjs
node --test tests/renderer/radial-menu-activation.test.mjs
node --test tests/toolkit/runtime-radial-gesture.test.mjs
git diff --check
```

If you touch shared annotation helpers, also run:

```bash
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/toolkit/annotation-overlay-renderer.test.mjs
```

If you touch Swift, run:

```bash
./aos dev build
```

If `./aos ready` passes, run a bounded live smoke:

1. Launch Sigil through the canonical repo path.
2. Open the radial menu and verify the annotation reticle item is visible and
   discoverable through AOS semantic targets/debug state.
3. Drag through the annotation reticle item and verify the vector switches to
   gold reticle treatment.
4. Return to radial interior and verify annotation reticle mode exits and normal
   vector behavior returns.
5. Release in annotation reticle mode and verify the commit/proposal payload and
   deterministic travel placement evidence.
6. If live anchors are available, verify the camera affordance requests the
   existing snapshot path.
7. Clean up Sigil and utility canvases.

For physical pointer behavior, prefer the canonical real-input radial scenario
or route to Operator if the slice reaches real mouse ownership. Synthetic
`show eval` probes are acceptable for focused state-machine/debug fields, but
not enough to accept a real-input regression.

## Completion Report

Report:

- changed files;
- reticle and camera item identities/actions;
- how annotation reticle mode enters/exits;
- how shared annotation session state is consumed or why a missing primitive
  prevented real shared-session binding;
- the gold reticle vector behavior and how normal vector behavior is restored;
- deterministic travel placement behavior and payload shape;
- snapshot/camera behavior;
- tests run and results;
- live smoke result or readiness blocker;
- final `git status --short --branch`;
- recommended next #296 card, likely settled reprojection or a focused
  annotation reticle backend bridge depending on what this slice proves.
