# AOS Runtime Resource Accumulation Forensics V0

## Tracker

- User report: after Implementer or Foreman sessions leave AOS canvases on display,
  interacting with them becomes progressively janky over time.
- Clarification: the user does not think canvas count alone explains it.
  Resource drain appears to accumulate even when there are not more canvases.
- Related workstreams:
  - `docs/design/work-cards/sigil-render-performance-regression-v0.md`
  - `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`
  - `docs/design/work-cards/canvas-geometry-lifecycle-render-contract-v0.md`
  - `docs/design/work-cards/input-tap-force-quit-carveout-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Forensically diagnose and measure AOS runtime resource accumulation where
canvas count stays stable but mouse interaction becomes janky and CPU/GPU/WebKit
load increases over time.

The primary deliverable is a reproducible telemetry report with enough evidence
to identify the likely ownership layer and route the next fix. If the root cause
is obvious, implement only a narrow, low-risk instrumentation or lifecycle fix;
otherwise stop after the evidence-backed diagnosis and proposed repair card.

## Current Evidence

Foreman collected this read-only snapshot on 2026-05-19 after the user reported
accumulating jank. No cleanup, restart, or kill was performed.

`./aos status`:

```text
status=ok mode=repo daemon=reachable pid=48452 tap=active focused_app=Code displays=2 windows=58 channels=0 stale_canvases=0 branch=implementer/canvas-geometry-lifecycle-render-contract-v0 ahead=11 dirty=0
```

`./aos show list --json` showed 7 canvases, 5 active, 2 suspended, 9 native
windows. Active interactive canvases were `sigil-hit-avatar-main` and
`surface-inspector`. Active full-desktop surfaces were `aos-desktop-world-stage`
and `avatar-main`.

Process snapshot from `ps`:

```text
pid=48452 aos serve --idle-timeout none: about 6.4% CPU, 47-48 MB RSS
pid=48458 com.apple.WebKit.GPU: about 21.7% CPU, 27 MB RSS
pid=48460 com.apple.WebKit.WebContent: about 6.5% CPU, 19 MB RSS
pid=48461 com.apple.WebKit.WebContent: about 4.5% CPU, 22-37 MB RSS
```

File descriptor and thread counts from `lsof` / `ps -M`:

```text
pid=48452 aos: 71 lsof lines, 12 thread lines
pid=48458 WebKit.GPU: 28 lsof lines, 20 thread lines
pid=48460 WebContent: 23 lsof lines, 8 thread lines
pid=48461 WebContent: 23 lsof lines, 7 thread lines
pid=48463 WebContent: 52 lsof lines, 9 thread lines
```

System memory was not the immediate limiter in that snapshot:

```text
System-wide memory free percentage: 32%
```

Interpretation: current evidence supports the user's suspicion that canvas count
is an incomplete health signal. The hot path appears to be accumulated
render/compositor/JS work in WebKit GPU/WebContent plus a non-idle daemon, not
simply too many visible canvas records.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/work-cards/sigil-render-performance-regression-v0.md`
- `src/display/canvas.swift`
- `src/display/desktop-world-surface.swift`
- `src/daemon/unified.swift`
- `src/daemon/input-surface-ownership.swift`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/canvas-lifecycle.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `packages/toolkit/components/render-performance/model.js`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
./aos ready
./aos status
./aos show list --json
./aos dev recommend --json
```

Then collect a fresh read-only process baseline:

```bash
ps -axo pid,ppid,pcpu,pmem,rss,vsz,etime,state,comm,args | \
  awk 'NR==1 || /\/Users\/Michael\/Code\/agent-os\/aos serve/ || /com\.apple\.WebKit/'

vm_stat
memory_pressure
```

Do not run `./aos clean`, stop services, restart the daemon, kill WebKit
processes, or remove canvases during the baseline phase. The first report must
preserve the dirty runtime state if the user is actively seeing jank.

## Scope

This is a daemon/display/toolkit runtime forensic investigation. It may inspect
Sigil and Surface Inspector because those are active consumers, but do not treat
this as a Sigil-only performance card unless the data proves the problem is
isolated there.

Likely ownership layers:

- daemon/native primitive: canvas lifecycle, input tap routing, input region
  routing, event fanout, process health counters;
- display runtime: NSWindow/WKWebView lifetime, DesktopWorld segments, suspended
  canvas behavior, WebKit process reuse;
- toolkit runtime: subscriptions, lifecycle listeners, render-performance
  telemetry, panel drag/input handlers;
- app surfaces: Sigil render loop, Surface Inspector mouse/event diagnostics.

## Required Investigation

### 1. Build A Repeatable Telemetry Snapshot

Create a script or documented command sequence that captures one timestamped
snapshot without mutating runtime state.

Minimum fields:

- `./aos status`;
- `./aos show list --json`;
- canvas summary: total, active, suspended, interactive active, full-desktop
  active, native window count, window levels;
- process table for repo `aos serve` and WebKit XPC processes;
- RSS, CPU, elapsed time, state, file descriptor count, thread count per process;
- `vm_stat` and `memory_pressure`;
- optional `sample <pid> 5` for the top AOS/WebKit CPU consumers if it does not
  require elevated permission.

Write output under a timestamped diagnostics directory such as
`docs/design/fixtures/aos-runtime-resource-forensics-v0/<timestamp>/`.
Keep large raw samples out of chat; report paths and summarized findings.

### 2. Measure Idle Drift

With the current live runtime untouched except for telemetry collection, sample
at a fixed cadence for at least 2 minutes while the human is not interacting:

```text
t=0s, 15s, 30s, 60s, 90s, 120s
```

Answer:

- Does daemon CPU stay non-idle?
- Does WebKit GPU stay non-idle?
- Do WebContent RSS, thread count, file descriptor count, or CPU trend upward?
- Does canvas count remain stable while process load changes?
- Do hidden or suspended canvases still have live WebContent activity?

### 3. Measure Interaction Jank Without Guessing

If `./aos ready` passes and the human approves live interaction, collect one
bounded real-input run. Prefer the human as the sensor for perceived jank, while
Implementer collects telemetry around it.

Suggested sequence:

1. Baseline snapshot.
2. Human drags or clicks `surface-inspector` for 30 seconds.
3. Snapshot immediately after.
4. Let runtime idle for 60 seconds.
5. Snapshot again.

If the human is not in the loop, do not synthesize broad mouse interaction
against the live desktop. Use deterministic isolated-daemon experiments instead.

### 4. Isolate Surface Contributions

Do not use `./aos clean` as the first isolation tool. It hides evidence.

If the human approves controlled mutation or the experiment runs in an isolated
daemon state root, compare resource deltas for these conditions:

- baseline with no canvases;
- one simple interactive canvas;
- one full-desktop noninteractive `track=union` canvas;
- `avatar-main` only;
- `aos-desktop-world-stage` only;
- `surface-inspector` only;
- Sigil hit surface and radial surface active;
- suspended canvas with its WebView still warm.

For each condition, record WebKit process count, top CPU, RSS, thread count,
file descriptor count, and whether CPU returns to idle after 60 seconds.

### 5. Audit Lifecycle And Subscription Cleanup

Inspect code paths for retained work after suspend/remove/recreate:

- `Canvas.close`, `CanvasManager.handleRemove`, `handleRemoveAll`,
  `handleSuspend`, `handleResume`;
- `DesktopWorldSurfaceCanvas` segment creation/rebuild/close paths;
- `CanvasMessageHandler` and WKUserContentController handler cleanup;
- `canvasEventSubscriptions`, `canvasPerceptionChannels`,
  `canvasObjectRegistries`, `canvasReadyManifests`;
- input region registration/removal and capture state;
- toolkit `subscribe()`/unsubscribe/lifecycle listeners;
- Sigil render loop continuation reasons;
- Surface Inspector mouse-event and cursor tracking toggles.

Answer with evidence, not guesses:

- Which maps/registries shrink on remove?
- Which keep entries for suspended canvases?
- Are WKWebView message handlers removed on close?
- Do DesktopWorld segments leave windows/WebViews alive after topology changes?
- Do render loops stop on `lifecycle:suspend` and resume only once?
- Are repeated status item / inspector launches adding duplicate listeners?

### 6. Identify Missing Health Counters

If existing telemetry cannot explain the leak, propose or implement narrow
health counters in `system.ping` or a daemon diagnostics command.

Useful counters:

- canvas count by lifecycle state and surface type;
- native window count by level and interactive state;
- input region count and active capture owner;
- canvas event subscription counts by event type;
- perception channel count by canvas;
- pending lifecycle waiter count;
- DesktopWorld segment count;
- WebKit process count is OS-owned, so include only if safely observable from
  CLI diagnostics rather than daemon core.

Update `tests/daemon-ipc-system.sh` if ping schema changes.

## Hard Boundaries / Non-Goals

- Do not clean, restart, kill, or remove the user's live canvases during the
  initial baseline.
- Do not run unbounded live pointer loops.
- Do not treat `stale_canvases=0` as proof that resource lifecycle is healthy.
- Do not paper over runtime drain by hiding/removing Sigil or Surface Inspector.
- Do not move toolkit/app policy into the daemon. Daemon changes should expose
  primitive health, lifecycle, routing, or cleanup state.
- Do not create a broad rewrite of canvas lifecycle in this card.
- Do not open a PR or close adjacent workstreams unless Foreman explicitly routes
  that follow-up after reviewing the evidence.

## Suggested Implementation Areas

Inspect before editing. Likely files:

- `src/display/canvas.swift` - NSWindow/WKWebView create, update, suspend,
  resume, remove, message handler, and input passthrough behavior.
- `src/display/desktop-world-surface.swift` - multi-segment DesktopWorld
  surface windows and WebViews.
- `src/daemon/unified.swift` - system ping, canvas subscriptions, input region
  registry, lifecycle waiters, fanout.
- `src/daemon/input-surface-ownership.swift` - input region capture and routing
  state.
- `packages/toolkit/runtime/canvas.js` and
  `packages/toolkit/runtime/canvas-lifecycle.js` - browser-side subscription and
  lifecycle helpers.
- `packages/toolkit/components/surface-inspector/index.js` - live mouse/cursor
  diagnostics and event subscriptions.
- `apps/sigil/renderer/live-modules/render-loop.js` and
  `apps/sigil/renderer/live-modules/main.js` - render-loop continuation and
  idle scheduling.

If creating a telemetry helper, prefer a repo script such as
`scripts/aos-resource-snapshot` over ad hoc one-off shell in documentation.
Keep it read-only by default.

## Verification

Minimum deterministic verification:

```bash
git diff --check
bash tests/daemon-ipc-system.sh
```

If Swift source changes:

```bash
./aos dev build
```

If toolkit/Sigil runtime code changes, run the smallest adjacent tests, for
example:

```bash
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/renderer/sigil-render-loop.test.mjs
```

For live diagnostics, only proceed when `./aos ready` reports ready. If readiness
is blocked, report the exact blocker and continue with isolated or deterministic
tests only.

## Completion Report

Report:

- telemetry artifact directory paths;
- exact runtime state at start and end;
- process/resource baseline table;
- whether resource use accumulates with stable canvas count;
- top suspected owner layer and evidence;
- any code changed, with file paths and rationale;
- tests run with exact pass/fail;
- whether live interaction was human-observed, synthetic, skipped, or blocked;
- remaining unknowns;
- one recommended next repair card if the root cause is not fixed in this slice.
