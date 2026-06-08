# Sigil Render Performance Regression V0

## Tracker

- User report: 2026-05-14 Sigil performance regression.
- Related workstreams:
  - #305 Remodel Sigil as first-class consumer of AOS surface platform
  - #123 warm/suspend/resume lifecycle primitives
  - #122 DesktopWorld interaction surfaces and warmed UI primitives
- Diagnostic evidence from Foreman live run on 2026-05-14 is included below.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Make Sigil cheap when the avatar is merely visible and idle while preserving
expected idle avatar animation.

The user reported a significant Sigil rendering regression:

- rendering is not performant;
- selecting the Wiki Brain radial menu item takes a long time to bring up the
  panel;
- status icon click to summon avatar is slower on the first couple of clicks;
- the fan comes on when the avatar is just sitting there.

This slice should identify and fix the idle render/runtime hot path first. The
fix must not pause, hide, or remove expected visible avatar motion. If the same
root cause clearly explains the status-click or Wiki radial latency, fix that
too. Otherwise record those as follow-up slices with the evidence below.

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

Follow the active dev workflow profile in `docs/dev/active-profile.json` and
`docs/dev/workflow-profiles.json`. Use the profile's branch/worktree guidance
unless Foreman provides a safer slice-specific dispatch.

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

### Follow-Up Evidence From 2026-05-19

The user clarified that an idle visible avatar should still be allowed to
animate. Turning off effects, hiding the avatar, or removing idle motion is not
an acceptable product fix.

Foreman used `sigil.set_effects paused=true` only as an isolation check. That
made AOS WebContent/GPU/daemon CPU drop sharply, which proves the active Sigil
frame path was hot. It does not prove that avatar animation itself should be
disabled.

After restoring `paused=false`, `window.__sigilDebug.snapshot()` reported
`avatarVisible=true`, `paused=false`, and `renderLoop.mode="idle"` with no
continuation reasons. That exposed a separate bug: `sigil.set_effects` changes
pause state but does not schedule a frame when unpausing, so animation resumes
only after another event wakes the renderer.

Git history shows the regression pressure clearly:

- `44be55f` (`2026-05-14`, `Fix Sigil idle render loop`) repaired the idle loop
  so the visible idle avatar did not require full continuous rendering.
- `05fe5ae` (`2026-05-14`, `Repair Sigil radial reticle drift`) reintroduced
  continuous rendering with the explicit `avatar-motion` continuation reason.
- Current code in `apps/sigil/renderer/live-modules/main.js` makes
  `avatarMotionActive` true whenever the avatar is visible, unpaused, and the
  vitality rotation multiplier is non-zero.
- Current `animate()` does not treat `avatar-motion` as a cheap visual-only
  frame. Every visible idle animation frame still runs child hit target sync,
  radial target surface sync, input region sync, overlay drawing, radial visual
  updates, visibility/fast-travel drawing, render-performance sampling, and
  `desktopWorldSurface.publishState(surfaceRenderSnapshot(...))`.
- A live WebContent sample during the fan event showed heavy work under
  `BroadcastChannel::dispatchMessage` and JavaScript DOM/attribute work. That
  aligns with full-surface/DesktopWorld state fanout and per-frame structural
  work riding on idle motion.

Treat this as a lifecycle/scheduling contract bug: idle visual motion must be
cheap, while structural sync, bridge fanout, overlay work, and diagnostics must
run only when their inputs changed or on an explicitly bounded heartbeat.

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
traveling, no radial menu active, and no context menu open, Sigil may run a
continuous visual animation loop for expected avatar motion. That loop must be
cheap and must not run the full structural/runtime update path every frame.

Acceptable behavior:

- keep expected idle avatar motion visible;
- render a frame when visibility, position, hover, menu, radial, session
  vitality, appearance, display topology, or lifecycle state changes;
- render bounded transition frames while an explicit transition is active;
- keep child hit/input regions and status item state correct without syncing
  unchanged native frames every animation frame;
- keep `canvas_object.marks` heartbeat behavior without using it as a reason to
  render continuously;
- keep multi-segment DesktopWorld state synchronized without publishing a full
  primary state snapshot every idle animation frame unless follower state really
  depends on that exact frame.

Do not fake a fix by hiding the avatar, pausing effects, disabling expected
visible motion, or reverting to pre-DesktopWorld canvas/event ownership.

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
  supports queued/suspended, not separate visual-animation versus structural
  dirty modes.
- `apps/sigil/renderer/live-modules/main.js` - `animate()` always calls
  all visual systems, child-surface/input-region sync, overlay draw,
  BroadcastChannel state publish, and telemetry sampling on the same frame path
  before deciding whether to continue for `avatar-motion`.
- `apps/sigil/renderer/session-vitality.js` - may need event-driven or
  low-frequency tick semantics.
- `apps/sigil/renderer/live-modules/desktop-world-surface-runtime.js` - ensure
  primary/secondary segment sync does not force unnecessary frames.
- `tests/renderer/sigil-render-loop.test.mjs` - extend for dirty/continuous
  scheduling.
- `packages/toolkit/runtime/desktop-world-surface-three.js` - inspect
  `publishState()` fanout and follower scheduling before deciding whether the
  right fix is Sigil dirty gating, sparse follower clock/state, or a toolkit
  helper.
- `apps/sigil/renderer/live-modules/interaction-overlay.js` - avoid full
  overlay canvas clear/draw on idle frames when no overlay feature is visible or
  dirty.
- `tests/renderer/*.test.mjs` around radial and transition behavior if the
  scheduler boundary affects those states.

Implementation shape:

- introduce a scheduler/frame decision helper that distinguishes
  visual animation, transition animation, structural dirty work, diagnostics,
  and idle;
- make `avatar-motion` continue only the cheap visual path;
- run child hit/radial/input sync only when position, visibility, menu bounds,
  display topology, or interactive mode changed;
- publish DesktopWorld state only when follower-observable state changed, or
  replace full-frame fanout with a sparse clock/calibration path if follower
  animation needs time coherence;
- draw the interaction overlay only while overlay-visible features are active or
  dirty;
- keep interaction trace disabled by default and bounded when explicitly
  enabled by diagnostics;
- make `sigil.set_effects paused=false` schedule a frame when visible animation
  should resume;
- make `animate()` reschedule only when visual animation or transition work
  remains;
- request a frame from state-changing paths instead of relying on a permanent
  loop;
- keep low-frequency or event-driven heartbeats separate from visual rendering;
- add deterministic tests proving idle avatar animation remains active while
  structural sync, full state publish, overlay draw, and diagnostic trace work
  do not run every animation frame without dirty inputs.

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
   - the avatar should visibly continue its expected idle animation;
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
