# Sigil Render Performance Regression V0

## Tracker

- User report: 2026-05-14 Sigil performance regression.
- Related workstreams:
  - #305 Remodel Sigil as first-class consumer of AOS surface platform
  - #123 warm/suspend/resume lifecycle primitives
  - #122 DesktopWorld interaction surfaces and warmed UI primitives
- Diagnostic evidence from Foreman live run on 2026-05-14 is included below.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Make Sigil cheap when the avatar is merely visible and idle.

The user reported a significant Sigil rendering regression:

- rendering is not performant;
- selecting the Wiki Brain radial menu item takes a long time to bring up the
  panel;
- status icon click to summon avatar is slower on the first couple of clicks;
- the fan comes on when the avatar is just sitting there.

This slice should identify and fix the idle render/runtime hot path first. If
the same root cause clearly explains the status-click or Wiki radial latency,
fix that too. Otherwise record those as follow-up slices with the evidence
below.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/api/toolkit/components.md` - `Inline Canvas Stats` and
  `Render Performance`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/desktop-world-surface-runtime.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-activation-transition.js`
- `apps/sigil/renderer/live-modules/radial-menu-activation.js`
- `packages/toolkit/components/render-performance/model.js`
- `packages/toolkit/components/render-performance/index.js`
- `tests/renderer/sigil-render-loop.test.mjs`
- `tests/renderer/radial-menu-activation.test.mjs`
- `tests/renderer/radial-activation-transition.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "scheduleRenderFrame|createRenderLoopScheduler|rendererSuspended|visualActive|requestAnimationFrame|postRenderPerformanceSample|renderPerformanceTelemetry|animateVisibility|status_item|openWikiWorkbench|radialActivationTransition" apps/sigil/renderer packages/toolkit tests/renderer
```

Follow the active dev workflow profile in `docs/dev/workflow-profiles.json`.
Under the current `hybrid_trunk` profile, stay on `main` for a small,
single-sitting implementation. Create a short-lived branch or worktree only if
the slice is risky, experimental, multi-day, or needs dirty-worktree isolation.

## Current Evidence

Foreman restored AOS readiness with:

```bash
./aos ready --repair
```

The toolkit render-performance panel and inline `window.aosStats` were used to
measure Sigil. Browser plugin was not available, so all live checks used AOS
toolkit components plus bounded real input.

### Idle Rendering Evidence

With avatar visible, no context menu open, and diagnostic canvases removed:

- `./aos status`: daemon ready, repo mode, tap active.
- AOS daemon process: about `10-11%` CPU.
- AOS WebKit GPU process: about `47-51%` CPU.
- AOS WebContent processes: about `6-11%` CPU on the active Sigil-related
  processes.

With the toolkit render-performance panel attached before teardown:

- `sigil-avatar` source entered `warn`.
- Current FPS: `35.7`
- Average FPS: `54.4`
- Current frame: `28ms`
- P95 frame: `28ms`
- Over-budget frames: `50%`
- Render/update reported around `0-1ms`.
- One idle sample reported `drawCalls: 0`, `triangles: 0`, while still
  producing over-budget frames.

This points at continuous scheduling / WebKit / canvas-surface overhead while
idle, not only heavy Three.js scene complexity.

### Status Icon Evidence

After forcing hidden state with `status_item.hide`, two status-click summon
cycles behaved like this:

- first real status click did not summon the avatar within `5000ms`;
- second real status click summoned it in `1516.6ms`;
- later cycle: first real click again timed out after `5000ms`;
- second real click summoned it in `1417.1ms`.

Treat this as a related but secondary symptom unless the idle render fix makes
the status path obviously correct.

### Wiki Radial Evidence

A fresh real-input radial activation selected the Wiki Graph item and opened the
Markdown Workbench:

- Radial semantic targets were present:
  `context-menu`, `agent-terminal`, `annotation-mode`, `wiki-graph`.
- Activation lifecycle:
  - `requested`: `0ms`
  - `item_transition`: `0ms`
  - `surface_transition`: `2151ms`
  - `completed`: `2183ms`
- Pointer release to Markdown Workbench readiness:
  `5022.4ms`.
- Destination: `sigil-wiki-workbench`
  with `aos/concepts/employer-brand-workflow-map.md`.

This is enough to prove the user-visible delay. Do not assume the whole 5s is
render-loop work; the workbench cold create/fetch/readiness path may be a
separate warm lifecycle slice.

## Required Behavior

### Idle Avatar Cost

When the avatar is visible, in `IDLE`, not hovered, not transitioning, not
traveling, no radial menu active, no context menu open, and no animation state
needs continuous visual motion, Sigil should not run a full continuous
render/update loop.

Acceptable behavior:

- render a frame when visibility, position, hover, menu, radial, session
  vitality, appearance, display topology, or lifecycle state changes;
- render bounded transition frames while an explicit transition is active;
- keep child hit/input regions and status item state correct;
- keep `canvas_object.marks` heartbeat behavior without using it as a reason to
  render continuously;
- keep multi-segment DesktopWorld state synchronized without making secondary
  segments burn frames unnecessarily.

Do not fake a fix by hiding the avatar or disabling expected visible effects
without a deliberate product decision. If the current product intentionally
requires an always-rotating idle avatar, make the loop adaptive enough that CPU
and WebKit/GPU load are materially lower, and report that tradeoff.

### Render Performance Telemetry

Keep or improve Sigil's existing telemetry:

- `postRenderPerformanceSample()` should still feed
  `sigil-render-performance` when the panel is visible.
- `window.aosStats` should still work for inline canvas stats.
- `window.__sigilDebug.snapshot()` should expose enough state to tell whether
  the avatar is idle, transitioning, menu-active, radial-active, or suspended.

If adding timing/debug fields, keep them compact and inspector-friendly.

### Status And Wiki Follow-Up

After idle loop repair, briefly recheck:

- status icon summon after hidden state;
- Wiki radial release to workbench readiness.

If they are still slow, do not balloon this slice. Record the remaining measured
gap in the completion report and recommend the next work card:

- status item event/state synchronization;
- Wiki Workbench warm/suspend/resume or activation lifecycle prewarm.

## Scope

Primary ownership is Sigil renderer/runtime scheduling.

Allowed:

- small changes to `apps/sigil/renderer/live-modules/render-loop.js`;
- focused changes in `apps/sigil/renderer/live-modules/main.js`;
- focused Sigil renderer tests;
- small debug/telemetry additions that are useful through toolkit
  render-performance or `__sigilDebug`.

Toolkit changes are allowed only if the Sigil investigation exposes a generic
runtime helper gap. Daemon/native changes are out of scope unless evidence
shows a missing primitive is the true blocker; report that to Foreman before
moving policy into Swift.

## Hard Boundaries / Non-Goals

- Do not move Sigil product policy into the daemon.
- Do not remodel Sigil onto the shared DesktopWorld stage in this slice.
- Do not remove the private Sigil 3D renderer.
- Do not change radial item semantics or menu item labels.
- Do not remove `sigil-render-performance` or `window.aosStats`.
- Do not add private warm-hidden WebView tricks now that lifecycle primitives
  exist.
- Do not run repeated TCC repair loops. Use `./aos ready`; if it reports a
  human permission blocker, report the blocker and continue deterministic tests.
- Do not leave live diagnostic canvases or generated proof artifacts in the
  repo unless explicitly asked.

## Suggested Implementation Areas

Inspect before editing:

- `apps/sigil/renderer/live-modules/render-loop.js` - current scheduler only
  supports queued/suspended, not idle dirty/continuous modes.
- `apps/sigil/renderer/live-modules/main.js` - `animate()` always calls
  `scheduleRenderFrame()` after visible frames, and visible idle work currently
  animates particles, phenomena, aura, lightning, magnetic field, omega, skins,
  trails, pulses, overlay, radial visuals, visibility, and fast travel.
- `apps/sigil/renderer/session-vitality.js` - may need event-driven or
  low-frequency tick semantics.
- `apps/sigil/renderer/live-modules/desktop-world-surface-runtime.js` - ensure
  primary/secondary segment sync does not force unnecessary frames.
- `tests/renderer/sigil-render-loop.test.mjs` - extend for dirty/continuous
  scheduling.
- `tests/renderer/*.test.mjs` around radial and transition behavior if the
  scheduler boundary affects those states.

Likely shape:

- introduce a scheduler mode or frame decision helper that distinguishes
  `continuous`, `transition`, `dirty`, and `idle`;
- make `animate()` reschedule only when continuous/transition work remains;
- request a frame from state-changing paths instead of relying on a permanent
  loop;
- keep low-frequency or event-driven heartbeats separate from visual rendering;
- add deterministic tests for no reschedule in idle and reschedule while
  visible effects/transitions/radial activity are active.

## Verification

Minimum deterministic checks:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/render-loop.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/sigil-render-loop.test.mjs
node --test tests/renderer/radial-menu-activation.test.mjs
node --test tests/renderer/radial-activation-transition.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-gesture-visuals.test.mjs
```

If the change touches shared toolkit runtime or DesktopWorld helpers, also run
the focused toolkit tests recommended by:

```bash
./aos dev recommend --json
```

Live AOS verification if `./aos ready` passes:

1. Configure live roots and seed Sigil:

   ```bash
   source tests/lib/visual-harness.sh
   aos_visual_prepare_live_roots
   aos_visual_seed_sigil repo
   ```

2. Launch Sigil and the toolkit render-performance panel through Sigil's World
   diagnostics menu or `window.__sigilDebug` utility action.

3. Measure idle visible avatar for at least 5 seconds:

   - toolkit `sigil-avatar` source should be stable;
   - CPU/GPU load should be materially lower than Foreman's `~11% daemon` and
     `~47-51% WebKit GPU` idle baseline;
   - no visible regression to avatar placement, hit target readiness, or status
     item state.

4. Recheck one status icon summon after hidden state and one Wiki radial
   activation. Record exact latencies even if still failing.

Cleanup after live checks:

```bash
for id in sigil-wiki-workbench sigil-render-performance sigil-interaction-trace surface-inspector aos-desktop-world-stage sigil-agent-terminal sigil-hit-avatar-main sigil-radial-menu-avatar-main avatar-main; do
  ./aos show remove --id "$id" >/dev/null 2>&1 || true
done
```

## Completion Report

Include:

- files changed;
- root cause or strongest confirmed cause of idle CPU/GPU load;
- before/after render-performance metrics for visible idle avatar;
- before/after process CPU snapshot for daemon, WebKit GPU, and active
  WebContent processes;
- status icon summon result after hidden state;
- Wiki radial release-to-workbench result;
- exact deterministic tests run and pass/fail results;
- live AOS readiness result or blocker;
- any follow-up card recommendation, especially if status or Wiki latency
  remains after idle render repair.
