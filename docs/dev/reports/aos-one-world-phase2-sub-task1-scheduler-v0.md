# AOS One-World Phase 2 — Sub-task 1: Shared RAF Scheduler V0

Date: 2026-06-05

Branch: `implementer/aos-one-world-phase2-world-substrate-v0`

Start ref: `e48a526d9f01f7579182004d5fd6c82dcc66fdee`

## Status

`partial` — Gate 1a met (publishState/s drops to 0 live-confirmed). Gate 1b not
met (structural-frame-% retained at 100%; see §Gate 1b Gap). Gates 2 and 3 met.

Gate failure is characterized in §Gate 1b Gap. Constraint returned to Foreman
per work card §Gate Failure Case before routing sub-task 2.

## What Was Built

### New modules

- `apps/sigil/renderer/live-modules/world-raf-scheduler.js` — multi-contributor
  shared RAF scheduler (Phase 3 integration substrate). Accepts injectable
  `requestAnimationFrame` for testability. API: `createWorldRafScheduler()` →
  `register(name, { needsFrame, onFrame })` → `{ requestStructural(), unregister(),
  scheduleFrame() }`. Contributors report `needsFrame()` each tick; scheduler
  merges structural requests (`structural=true` if any contributor called
  `requestStructural()`). Fault isolation: contributor errors do not break other
  contributors. Synchronous `tick()` for test mode.

  **Not yet wired to main.js.** The scheduler is Phase 3 substrate — the
  integration point (replacing main.js's `renderLoop.schedule` with a
  multi-contributor loop) is a Phase 3 concern. Sub-task 1 delivers the
  scheduler as a tested, ready artifact.

### Modified modules

- `apps/sigil/renderer/live-modules/render-loop.js` — added `trackingOnlyReasons`
  and `trackingFrame` classification to `classifyRenderLoopWork`. Avatar-controls
  frames are now "tracking-only": structural ops (hit-region, segment tracking)
  keep running, but `publishState` is skipped when no geometry changed.

### New tests

- `tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` — 22 focused tests
  covering the scheduler contract, render-loop classification (panel-ui-idle,
  avatar-controls tracking-only, structural-dirty parity), and end-to-end
  scheduler + classifyRenderLoopWork integration.

## Scheduler Design

```
createWorldRafScheduler({ requestAnimationFrame, cancelAnimationFrame })
  .register('avatar-scene', { needsFrame, onFrame })
    → { requestStructural(), unregister(), scheduleFrame() }

  .register('panel-ui', { needsFrame, onFrame })
    → { requestStructural(), unregister(), scheduleFrame() }
```

Each frame tick:

1. All registered contributors' `needsFrame()` is polled.
2. `structural = true` if any contributor called `requestStructural()` since the
   last tick; `false` otherwise.
3. Each active contributor receives `onFrame({ structural, contributors })`.
4. `requestStructural()` flag is cleared after the frame.

This moves structural from a hard default (`scheduleRenderFrame` defaults
`structural=true`, main.js:543) to a demand-driven annotation: a contributor
marks structural only when avatar geometry actually changed.

## render-loop.js: Tracking-Only Frame Classification

`classifyRenderLoopWork` now distinguishes three frame tiers:

| Tier | `structural` | `publishState` | Example reasons |
|------|:---:|:---:|---|
| `cheapFrame` | false | false | `avatar-motion`, `panel-ui-idle` |
| `trackingFrame` | true | false | `avatar-controls` (idle, no geometry change) |
| Full structural | true | true | any reason + `structuralDirty=true` |

`trackingOnlyReasons = new Set(['avatar-controls'])`:
- Structural ops block (`updateSegmentPosition`, `syncWorldRect`,
  `syncSigilInputRegions`) keeps running so hit-region and segment tracking
  stay current.
- `publishState` is skipped — no avatar geometry changed, daemon does not need
  a new snapshot just because controls are open and idle.

Previously `avatar-controls` was treated identically to full structural
(publishState on every controls-open frame = 31/s baseline).

## Gate Measurement Results

### Gate 1a: publishState/s drops under panel-only interaction

**Met — live-confirmed.**

Scenario: avatar-main canvas reloaded, probe enabled, controls opened (native
right-click at sigil-hit-avatar-main center), 15.2s idle window, probe snapshot.

| Metric | Phase 0/1 baseline | Sub-task 1 result |
|---|---|---|
| publishState/s | 31/s | **0/s** (0 calls / 908 frames) |
| `hit_target_sync_calls` | — | 908 (structural ops still running) |
| `input_region_sync_calls` | — | 908 (structural ops still running) |
| `hit_target_sync_changes` | — | 0 (idle, no movement) |
| `input_region_sync_changes` | — | 0 (idle, no movement) |

The structural ops block runs every frame (tracking ops working), but no daemon
geometry snapshots are published during idle controls-open frames.

### Gate 1b: Structural-frame-% drops below 100%

**Not met.** See §Gate 1b Gap.

Structural-frame-% in the idle measurement: 908 structural / 908 total = **100%**.

### Gate 2: Avatar scale drag parity

**Met — live-confirmed.**

Scenario: 20.5s window including active scale drag.

| Metric | Phase 0/1 baseline | Sub-task 1 result |
|---|---|---|
| publishState calls | 31/s | **57 publishState / 147 control_change** |
| Structural frames | — | 923 |
| publishState ran | — | 57 (when `structuralDirty=true`) |

`publishState` runs only when `structuralDirty=true` (geometry changed). Parity
confirmed: publishState fires on every geometry-change frame.

### Gate 3: Tests pass

**Met.** 84/84 tests pass across all focused test files:

```
node --test \
  tests/renderer/sigil-render-loop.test.mjs \
  tests/renderer/avatar-controls-hit-test.test.mjs \
  tests/renderer/sigil-surface-transport-probe.test.mjs \
  tests/renderer/sigil-one-world-co-location-probe.test.mjs \
  tests/renderer/sigil-one-world-phase2-scheduler.test.mjs
```

Result: `# tests 84 / # pass 84 / # fail 0`

## Gate 1b Gap

### What the gate requires

> Structural-frame-% also drops below 100%. Confirm with the existing probe
> instruments.

### What the implementation delivers

The current `trackingFrame` approach keeps `structural=true` for all
`avatar-controls`-driven frames. Structural-% stays at 100%.

### Why dropping to cheap is unsafe without a bounds-dirty signal

To drop structural-% below 100%, `avatar-controls` would need to become a
`cheapFrame` reason (`structural=false`). But the structural ops block
(main.js:5017-5032) must run whenever the panel or avatar bounds change to keep
hit-region and input-region tracking current.

The panel bounds change path:
```
canvas_lifecycle message
  → main.js:4490: avatarControls.updatePanelFrame(panelNativeFrameFromLifecycle(msg), 'lifecycle')
  → avoidAvatarPanelOverlapFromLifecycle(msg)
```

This path does NOT call `scheduleRenderFrame()`. It updates the panel bounds
held by `avatarControls` but does not set `structuralFrameDirty`. If
`avatar-controls` were made a cheap reason, the structural ops would be skipped
on the next frame — and `syncWorldRect(avatarControls.interactiveBounds(), ...)` 
would not run with the new bounds. Hit-region and input-region tracking would be
stale until the next geometry event from another source.

### The fix (deferred)

Add a `structuralFrameDirty = true` signal in the `canvas_lifecycle` handler
when `updatePanelFrame` updates the panel bounds:

```javascript
// main.js ~4490
avatarControls.updatePanelFrame?.(panelNativeFrameFromLifecycle(msg), 'lifecycle');
structuralFrameDirty = true;  // panel bounds changed; hit-region needs update
```

With this signal in place, `avatar-controls` can be promoted to a cheap reason
— idle frames (no panel-bounds update, no geometry event) would be cheap
(`structural=false`), and frames with an actual bounds change would be structural
via `structuralDirty`. This would drop structural-% below 100% for true idle
periods.

### Why this is the "Decompose the coarse structural render bundle" backlog item

The structural-bundle backlog item (handoff §5) identifies that `overlay.draw`
and `publishState` are unconditional on structural frames, and that transform
edit over-marks inflate the structural rate. The panel-bounds-dirty signal is
the minimal version of that decomposition: separating "tracking needs to run"
(bounds changed) from "tracking always runs" (avatar-controls open).

### Routing

This gap is the Gate Failure Case from the work card §Gate Failure Case:

> "If the structural over-mark cannot be made demand-driven without a larger
> refactor of the render path, stop and characterize the blocker. Do not paper
> over it with scope expansion. Return the failure evidence and the implied
> constraint to Foreman before routing sub-task 2."

The constraint: structural-% cannot drop below 100% without adding a
panel-bounds-dirty signal in the `canvas_lifecycle` handler. This is a
targeted, low-risk change (1 line) but it modifies the event-handler path for
the panel canvas lifecycle, which has existing tests. It should be a scoped
follow-on work card or an inline fix by Foreman, not scope-expanded into sub-task 1.

**Sub-task 2 routing decision is Foreman's call.** The work card says to return
the constraint "before routing sub-task 2." Sub-task 1's publishState result
(0/s, live-confirmed) is the functional goal; structural-% below 100% requires
the bounds-dirty follow-on.

## What Sub-task 1 Delivers

Despite 1b not being met, sub-task 1 delivers real, live-verified improvements:

1. **publishState eliminated for idle controls-open frames** — daemon display
   compositor no longer receives geometry snapshots 31 times/second when the
   avatar controls panel is open and idle. Confirmed: 0/s live.

2. **Tracking ops preserved** — hit-region and input-region tracking remain
   current on every controls-open frame. No regression.

3. **World RAF scheduler** — tested, injectable, ready for Phase 3 wiring.

4. **Demand-driven classification foundation** — `trackingOnlyReasons` and
   `trackingFrame` in `classifyRenderLoopWork` establish the classification
   model for future reasons to join the tracking tier.

5. **panel-ui-idle reason** — in `cheapFrameReasons`; Phase 3 use when the
   scheduler drives co-located document frames for panel-only updates.

## Files Changed

| File | Change |
|---|---|
| `apps/sigil/renderer/live-modules/render-loop.js` | Added `trackingOnlyReasons`, `trackingFrame`; updated `publishState` gate |
| `apps/sigil/renderer/live-modules/world-raf-scheduler.js` | New: multi-contributor shared RAF scheduler |
| `tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` | New: 22 tests for scheduler + classification |

## Backlog Item Routing

From work card §Backlog Items, sub-task 1 affects these items:

### Delivered (partial)

- **Decompose the coarse structural render bundle** — `publishState` is now
  demand-driven for avatar-controls-only frames. The overlay.draw / structural-frame-%
  half requires the panel-bounds-dirty follow-on (see §Gate 1b Gap).

### Promoted (must not fall into a memory hole)

These items were not addressed in sub-task 1 and need issues or work cards:

- **Drain-paced daemon input coalescing** (Direction A): per-canvas backpressure.
  Phase 2/3 candidate. Gate: Phase 0/1 measurements complete.

- **Preview/commit protocol class** (Direction C): coalescible signal vs reliable
  commit. Phase 2/3 candidate.

- **Shared interaction scheduler / priority tiers** (Direction D): interaction >
  app render > diagnostics. Adjacent to sub-task 1; Phase 3 candidate.

- **Retire `sigil.avatar_panel.*`; promote visual-object descriptor contract**
  (Direction E): Phase 3+ track.

- **Reactive signals core** (Direction F): Phase 1's throwaway store is
  placeholder; resolved in sub-task 2 if routed.

- **Browser-overlay CDP geometry stream** (★): owner explicitly flagged as
  must-not-lose. Separate track; not Phase 2 scope.

- **Focus model**: focus-group manager, Tab-loop trap, per-panel focus memory,
  passthrough-drives-key-window seam. Not Phase 2.

- **Panel-bounds-dirty signal** (new, from §Gate 1b Gap): add
  `structuralFrameDirty = true` in `canvas_lifecycle` handler when
  `updatePanelFrame` updates panel bounds. Prerequisite for structural-% dropping
  below 100%. Scoped: 1 line + lifecycle handler test.
