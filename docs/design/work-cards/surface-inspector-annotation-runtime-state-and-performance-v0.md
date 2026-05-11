# Surface Inspector Annotation Runtime State + Performance V0

## Tracker

- Parent Surface Inspector epic: https://github.com/michaelblum/agent-os/issues/295
- Follows:
  `docs/design/work-cards/surface-inspector-browser-dom-pinned-reveal-fix-v0.md`

## Goal

Repair Surface Inspector Annotation Mode runtime state, cleanup, and input
performance before the Employer Brand human-alignment Operator pass resumes.

The verified HTML Workbench Expression and browser DOM projection path are ready,
but the human reported platform-level regressions:

- clicking/right-clicking the AOS status icon is less responsive;
- dragging AOS panels is degraded;
- radial menu release hitches;
- fans spin up more often;
- the status item menu reports Annotation Mode on while Surface Inspector itself
  reports Annotation Mode off;
- a gold perimeter remains visible around an AOS panel despite SI showing
  Annotation Mode off.

Treat this as a Surface Inspector/runtime correctness slice. Do not continue
Employer Brand review, capture, locator, report, export, or workflow work.

## Foreman Evidence

Foreman checked the current runtime after the report:

- `./aos show list --json` returned `{"canvases":[],"status":"success"}`;
- `./aos status` later reported `status=ok`, `tap=active`,
  `stale_canvases=0`;
- `ps` showed noticeable runtime load while no canvases were listed:
  - `/Users/Michael/Code/agent-os/aos serve --idle-timeout none` around 11%;
  - WebKit GPU process around 58%;
  - WebKit WebContent processes around 8-11%;
- `src/display/status-item.swift` currently marks the `Annotation Mode` menu
  item on when `isUtilityCanvasVisible(id: canvasInspectorId)` is true, which
  is Surface Inspector visibility, not Annotation Mode state;
- Surface Inspector annotation code subscribes to input events and syncs
  controlled overlays/action canvases around mouse-move handling while
  Annotation Mode is active.

The exact CPU percentages are not a deterministic test oracle, but they justify
adding bounded diagnostics and cleanup invariants.

## Required Behavior

### 1. Status Item Annotation Mode State Must Be Truthful

The status item menu must not show `Annotation Mode` as on merely because
Surface Inspector is visible.

Required behavior:

- if Surface Inspector is not open, Annotation Mode is off;
- if Surface Inspector is open but its annotation state is off, the menu item is
  off;
- if Surface Inspector reports Annotation Mode active, the menu item is on;
- if the daemon cannot know the state synchronously, default to off or use a
  clear unknown/disabled state rather than showing a false on state.

Implementation guidance:

- Surface Inspector can emit/cache an annotation-mode state message whenever it
  toggles mode and on bootstrap;
- the status item can cache that state per `canvas-inspector`;
- closing/suspending/removing Surface Inspector must reset cached Annotation
  Mode state to off;
- avoid synchronous WebView eval from menu construction if it would block the
  status item.

### 2. Annotation Mode Off Must Clear Runtime Projections

When Annotation Mode turns off, when anchors are cleared, or when Surface
Inspector is suspended/removed, there must be no lingering runtime annotation
artifacts:

- no gold display perimeter overlays on target canvases;
- no annotation hit-layer canvas;
- no annotation action-control canvases;
- no active hover candidate;
- no active edge projection unless Annotation Mode remains active and has pins;
- no target-canvas overlay script left in a drawn state.

Add explicit cleanup for previously decorated target canvases. If the overlay is
drawn by `buildAnnotationOverlayEvalScript(...)`, track which canvases received
annotation overlays and send a clear/no-op overlay update to those canvases on
mode-off/clear/suspend/remove.

Avoid relying on the disappearance of Surface Inspector itself to clean target
canvas DOM.

### 3. Input Subscriptions Must Be Scoped

Surface Inspector must not keep high-frequency input subscriptions active when
they are not needed.

Required behavior:

- Annotation Mode off means no annotation hover processing;
- if cursor tracking and mouse effects are also off, `input_event`
  subscription should be disabled/unsubscribed;
- Annotation Mode on may subscribe to input, but only for the scoped hit-layer
  behavior;
- mode-off/clear/suspend/remove must release the subscription and child canvases.

Add debug state fields or reuse existing ones so Operator/GDI can confirm
whether high-frequency input handling is active.

### 4. Mouse-Move Work Must Be Idempotent And Bounded

While Annotation Mode is active:

- mouse-move handling should coalesce through `requestAnimationFrame` or an
  equivalent single pending update;
- unchanged hover candidate and unchanged frame rect must not re-emit overlay
  evals or action-control canvas updates;
- action-control create/update/remove counts should remain stable when the
  cursor stays over the same frame;
- no per-mousemove `evalCanvas`, `show list`, semantic-target replay, or canvas
  create/remove churn should happen when the resolved candidate is unchanged.

If existing code already intends this, tighten tests and debug counters so the
behavior is proven.

### 5. Runtime Diagnostics

Add a small, deterministic diagnostic surface for this issue. It can be a helper
function, debug-state payload, CLI smoke, or focused tests, but it must make the
following observable:

- annotation mode active/off;
- input subscription active/off for SI;
- annotation hit-layer id or empty;
- action-control canvas ids;
- last hover candidate id;
- active overlay target canvas ids;
- action-control create/update/remove counters;
- overlay eval create/update/clear counters if practical.

Do not introduce a broad profiler. Keep this as a targeted runtime invariant
surface.

## Suggested Implementation Areas

Inspect before editing:

- `src/display/status-item.swift`
- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/components/canvas-inspector/annotation-hit-layer/index.js`
- `packages/toolkit/components/canvas-inspector/annotation-action-control/index.js`
- `tests/toolkit/canvas-inspector.test.mjs`
- existing Swift/status item tests, if present.

Likely fixes:

- change status item Annotation Mode checkmark from Surface Inspector visibility
  to cached SI annotation state;
- have SI emit annotation state changes to the daemon/status item;
- reset cached state on SI close/suspend/remove;
- track decorated target canvas ids and clear them on mode-off/clear/lifecycle;
- ensure `syncInputSubscription(...)` releases input when annotation/cursor/mouse
  features are inactive;
- harden idempotent hover/action-control sync tests.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

If Swift status item code changes, run the repo build path recommended by the
workflow router:

```bash
./aos dev recommend --json
./aos dev build
```

If `./aos ready` passes, run a bounded AOS smoke:

1. launch HTML Workbench Expression and Surface Inspector;
2. open the status item menu and verify Annotation Mode does not show on before
   SI mode is enabled;
3. toggle Annotation Mode on and verify SI state and status item state agree;
4. hover a stable target and verify only one perimeter/one action-control pair
   appears and action-control counts do not churn while stationary;
5. toggle Annotation Mode off and verify no gold perimeter remains on target
   canvases, no hit-layer/action-control canvases remain, and high-frequency
   input subscription debug state is inactive;
6. repeat after clearing anchors and after closing/suspending Surface Inspector;
7. capture lightweight CPU/process evidence before and after cleanup. Do not
   fail solely on noisy CPU numbers, but report whether `aos serve`/WebKit load
   returns to an idle-looking state when no canvases are listed.

## Non-Goals

- no Employer Brand human-alignment review pass;
- no Employer Brand live capture, locator, URL opening, report, export, or data
  bundle mutation;
- no arbitrary live websites;
- no new annotation UX model;
- no Surface-Zoom work;
- no broad profiler or daemon architecture rewrite;
- no screenshot-pixel oracle.
