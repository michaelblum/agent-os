# Surface Inspector Annotation Reveal + Projection Adapters V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active issue: https://github.com/michaelblum/agent-os/issues/297
- Builds after: https://github.com/michaelblum/agent-os/issues/296
- Related foundation tracker: https://github.com/michaelblum/agent-os/issues/294
- Related human-intent epic: https://github.com/michaelblum/agent-os/issues/141

## Goal

Extend Surface Inspector Annotation Mode from controlled canvas-frame pins into
a real navigation/projection layer:

1. annotation rows remain reachable through the Surface Inspector tree even when
   the target is clipped or scrolled out of view;
2. `Reveal Target` recursively reveals a rendered-but-hidden target by using
   adapter-owned scroll/focus behavior;
3. adapter capability reports make the distinction between visible,
   offscreen-scrollable, virtualized, hidden, absent, stale, and unsupported
   targets explicit;
4. AOS-owned canvas semantic targets become first-class annotation targets when
   their structured bounds are available;
5. native window/AX and Chrome seam targets are represented conservatively
   without broad user-app harvesting or Chrome DOM piercing.

This is a wider slice than the last correction, but it must remain platform
work. Do not mutate Employer Brand artifacts or resume any capture/report
workflow.

## Current Baseline

Surface Inspector Annotation Mode V0 already exists:

- user-facing Surface Inspector labels touched by this path read Surface
  Inspector;
- `ctrl+opt+a` toggles Annotation Mode;
- `ctrl+opt+c` emits a see bundle with annotation state;
- pins/comments are in memory and included in
  `window.__canvasInspectorState.annotation`;
- the minimap is passive geometry only;
- target canvas display overlays and SI tree/list are the action entry points.

Keep those contracts intact. This slice should add reveal/projection capability,
not reintroduce minimap actions or Surface-Zoom preview behavior.

## Concepts

### Entity Reachability

Every annotated entity should remain reachable in SI as long as the underlying
subject still exists in a known tree.

Use these states:

- `visible`: rendered and projectable to current display coordinates;
- `clipped`: rendered but clipped by one or more ancestor viewports;
- `offscreen_scrollable`: rendered or materializable by scrolling known
  ancestors;
- `virtualized`: known in a logical tree but not currently rendered;
- `hidden`: mounted but not visible by style/state;
- `absent`: no longer exists under its recorded parent/root;
- `stale`: root exists but identity/bounds no longer reconcile;
- `unsupported`: adapter cannot inspect or reveal this target class.

Display overlays only render for `visible` targets with a current display-space
rect. SI tree/minimap rows can still show clipped/offscreen/virtualized/hidden
targets with explicit state.

### Reveal Target

`Reveal Target` is an adapter-owned operation that attempts to make a target
visible on its current display.

The operation must be explicit, not an invisible side effect of row selection.

Required entry points:

- `Reveal` button/action on selected annotation rows when `can_reveal=true`;
- double-clicking a selected annotation row may call reveal if that is already
  consistent with SI row behavior;
- optional keyboard action is allowed if it uses accessible names and existing
  toolkit patterns.

Reveal result states:

- `already_visible`;
- `revealed`;
- `blocked`;
- `virtualized`;
- `unsupported`;
- `target_absent`;
- `adapter_error`.

After a successful reveal, refresh projection state and render the display
overlay if the target is now visible.

### Active Edge

Only one active annotation edge/path remains visible at a time.

Selecting a pin or comment:

- selects its parent/root edge;
- focuses/raises the owning AOS canvas/window when supported;
- refreshes projection and visibility state;
- does not automatically reveal hidden descendants unless the user invokes
  `Reveal Target`.

## Adapter Contract

Add or extend neutral helper/schema/fixture contracts for adapter projection.
The implementation can live beside `surface-inspector-annotations.js` or in a
new focused helper.

Each projection adapter result should include:

- adapter id;
- subject id/path;
- root id/path;
- subject kind;
- source tree node metadata;
- current render status from the state list above;
- `can_project_display_overlay`;
- `can_reveal`;
- display-space rect when visible;
- local-space rect when known;
- ancestor viewport/clip chain when known;
- scrollable ancestor chain when revealable;
- z-order or hit priority evidence when known;
- blocker reason when unavailable;
- refreshed_at;
- provenance/source payload id where applicable.

Do not use screenshot pixels as the source of truth. Screenshot/capture evidence
may verify the result, but the adapter contract must be structured.

## Required Adapter Coverage

### 1. AOS Canvas/Window Adapter

Keep and harden the current controlled AOS canvas/window path:

- root canvases/windows are projectable if they have current geometry;
- focus/raise should use existing AOS canvas/window primitives if available;
- stale/removed canvases must clear display overlays and mark affected
  annotations stale or absent;
- reveal for a root canvas/window is `already_visible`, `revealed`, or
  `unsupported` depending on available primitives.

### 2. AOS Toolkit Semantic Target Adapter

Add first-class support for AOS-owned canvas semantic targets when structured
target metadata is available.

Inputs to inspect:

- toolkit semantic target helpers;
- `data-aos-ref`, `data-aos-action`, `data-aos-surface`,
  `data-semantic-target-id`;
- `aos see capture --canvas <id> --xray` `semantic_targets[]`;
- existing tests such as `tests/aos-semantic-targets-xray.sh`;
- existing docs around `semantic_targets[].do_target`.

Required behavior:

- semantic targets can appear as SI annotation targets under their owning
  canvas;
- visible semantic target bounds can project to display overlays;
- if the target is inside a scrollable AOS canvas DOM surface, reveal should
  ask the owning canvas to scroll the target into view;
- if the owning canvas does not expose a reveal handler, report
  `unsupported` or `offscreen_scrollable` with `can_reveal=false`;
- after reveal, refresh projection from current target bounds.

Acceptable implementation paths:

- a generic owner-canvas `canvas.send` message such as
  `surface_inspector.reveal_target`;
- a same-canvas DOM helper when the target is stamped with toolkit semantic
  attributes and no app-specific behavior is needed;
- a no-op capability report when reveal cannot be done safely.

Do not add app-specific reveal behavior.

### 3. AOS Object Registry / 3D-Canvas Adapter Slot

Represent object-registry targets conservatively.

Inputs to inspect:

- `canvas_object.registry`;
- `canvas_object.transform.*`;
- object marks and existing object-control docs/tests.

Required behavior:

- object-registry targets may be listed as annotation-capable only when their
  owner exposes enough structured bounds or projection metadata;
- transform-only 3D objects should report a clear blocker such as
  `object_registry_no_display_projection`;
- no fake 2D display rectangle should be synthesized from scene transform alone.

This slot can remain mostly capability/reporting in V0 if current object
registry payloads do not expose projection.

### 4. Native macOS Window / AX Adapter Slot

Add conservative native window/AX capability reporting and fixture coverage.

Allowed:

- explicit focused/current window or known-window payloads;
- existing `aos see capture --window --xray` or equivalent structured AX output;
- controlled fixtures/tests that prove contract normalization.

Not allowed:

- continuous broad AX harvesting of arbitrary user apps;
- hidden background scraping;
- drawing overlays for AX elements without current display-space bounds;
- pretending every AX element is revealable.

Required behavior:

- native windows can be represented as root frame candidates when current bounds
  are known;
- AX child elements may be represented only when bounds and visibility are
  available from an explicit capture/payload;
- reveal for AX child elements is `unsupported` unless a safe, existing AX
  scroll/focus action is already available and bounded.

### 5. Chrome / Browser Seam Adapter Slot

Represent Chrome/browser-class windows down to the tab/content seam only.

Allowed:

- browser window root frame;
- tab/content viewport seam if AX/window geometry exposes it;
- freehand/region-ready target record for the tab content area.

Not allowed in this slice:

- Chrome DOM piercing;
- arbitrary live website inspection;
- browser automation/crawling;
- login/paywall/consent bypass;
- locator resolution or evidence capture.

Reveal for Chrome seam targets is usually `already_visible`, `revealed` by
window focus, or `unsupported`. DOM-level reveal waits for a later issue.

## UI Requirements

### Surface Inspector Tree

Annotation rows should show:

- pin/comment type;
- path;
- visibility/projection state;
- reveal capability;
- blocker text when blocked;
- `Reveal` action when available;
- stale/absent styling when the root/target is gone.

Click row:

- selects edge/path;
- refreshes projection state;
- raises owning canvas/window when supported.

Double-click or `Reveal`:

- calls reveal operation;
- refreshes projection;
- reports result in row state and snapshot.

### Display Overlays

Display overlays render only for visible/projectable targets.

Required:

- gold frame overlays for active frame path;
- blue comment chips for visible comments;
- add/pin actions remain on target display overlay or explicit SI tree/list
  fallback only;
- overlays clear when target becomes stale, hidden, absent, or unsupported.

### Minimap

Do not regress the correction:

- minimap remains passive;
- no `+`, `pin`, edit, delete, hover button, object mark, or cursor action
  controls inside minimap annotation geometry;
- minimap shows active path and comment markers only;
- minimap rows should reflect stale/unsupported state without becoming an action
  surface.

## Snapshot Bundle Extension

Extend annotation snapshot payloads with projection/reveal information:

- per-pin projection adapter result;
- per-comment projection status through parent pin;
- last reveal request/result;
- adapter capability summary;
- unsupported/stale/absent blockers.

Keep image data out of annotation JSON.

## Non-Goals

- No Employer Brand capture, locator, report, export, or workflow mutation.
- No Surface-Zoom implementation path.
- No Chrome DOM piercing.
- No arbitrary live website support.
- No broad hidden AX harvesting.
- No screenshot-pixel oracle.
- No freehand drawing implementation.
- No persistent annotation database.
- No full snapshot settings surface from #298 unless trivial.

## Suggested Files To Inspect

- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/tree.js`
- `packages/toolkit/components/surface-inspector/styles.css`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- toolkit semantic target helpers
- `tests/aos-semantic-targets-xray.sh`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/canvas-object-control.schema.json`
- `src/daemon/surface-inspector-bundle.swift`
- `docs/api/toolkit.md`
- `docs/api/aos.md`

## Verification

Start with:

```bash
./aos dev recommend --json
```

If Swift/daemon/config/menu/hotkey paths are touched, follow router guidance
and rebuild with:

```bash
./aos dev build
```

Required deterministic tests:

- annotation state/model tests;
- projection adapter normalization tests;
- reveal result/state tests;
- stale/absent root tests;
- passive minimap regression tests;
- semantic target projection/reveal tests;
- snapshot payload tests.

Likely commands:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-hit-test-inspect.test.mjs
node --test tests/toolkit/surface-inspector-tree.test.mjs
bash tests/aos-semantic-targets-xray.sh
bash tests/surface-inspector-see-bundle.sh
git diff --check
```

If `./aos ready` is available, run one bounded AOS smoke:

1. open Surface Inspector;
2. enable Annotation Mode;
3. create/select a root AOS canvas pin;
4. create/select a semantic target inside an AOS-owned canvas;
5. scroll or position the target so it is not visible if the fixture supports
   it;
6. invoke `Reveal Target`;
7. verify the target becomes visible and overlay projection updates;
8. verify snapshot includes projection/reveal result;
9. verify minimap remains passive.

If the local daemon is not ready, report the exact readiness blocker and rely on
deterministic tests.

## Completion Audit

Final report must include:

- issue #297 reference;
- files changed;
- adapter capability matrix;
- reveal target states implemented;
- semantic target support result;
- native AX/window and Chrome seam support or explicit deferral states;
- passive minimap regression evidence;
- snapshot extension evidence;
- exact verification commands and results;
- explicit statement that Employer Brand capture/locator/report/export/workflow
  artifacts were not mutated.
