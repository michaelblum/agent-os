# Toolkit Stage Chip Shared Readiness And Fallback Cleanup V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions
- Related issues:
  - #122 StageAffordance / visual-hit binding
  - #123 warm/suspend/resume lifecycle primitives
  - #261 panel window placement
- Prior work cards:
  - `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
  - `docs/design/work-cards/toolkit-stage-chip-live-materialization-correction-v0.md`
  - `docs/design/work-cards/toolkit-stage-chip-minimize-latency-v0.md`
  - `docs/design/work-cards/operator-stage-chip-latency-live-smoke-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Fix the failed real-pointer latency smoke where the shared DesktopWorld stage
was present before minimize, but the stage-backed path still fell back because
the readiness probe used ownership-gated `canvas.eval`.

Operator report:

- readiness was clean: `ready=true mode=repo daemon=reachable tap=active`;
- `aos-desktop-world-stage` existed before the real-pointer minimize click;
- minimize controller state reported:
  - `stageEnsureStatus: ready_check_failed`;
  - `error: FORBIDDEN: caller surface-inspector may not eval aos-desktop-world-stage`;
  - `stageLayerUpsertSent: false`;
  - `registeredRegionIds: []`;
  - `mode: fallback_webview`;
- the default path created `aos-chip-*` WebView fallbacks;
- the first fallback create timed out and left a stale warm-suspended
  `aos-chip-surface-inspector-*` chip even though the source remained active;
- duplicate minimize created another fallback chip rather than preserving one
  stage-backed materialization;
- restore/close worked for the active fallback chip but the stale chip remained
  until Operator ran `./aos show remove-all`.

This is no longer a pure latency problem. It is a shared-stage readiness
contract problem plus fallback timeout cleanup.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-stage-chip-minimize-latency-v0.md`
- `docs/design/work-cards/operator-stage-chip-latency-live-smoke-v0.md`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/manifest.js`
- `packages/toolkit/components/desktop-world-stage/index.js`
- `src/daemon/unified.swift`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/panel-drag-transfer.test.mjs`
- `tests/toolkit/runtime-canvas.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "ensureDesktopWorldStage|waitForCanvasReady|evalCanvas|canvas.eval|canvas.send|canvasMutationPermitted|canvasCreatedBy|DUPLICATE_ID|aos-desktop-world-stage|fallbackCreate" packages/toolkit src tests docs
tail -n 260 ~/.config/aos/repo/daemon.log 2>/dev/null || true
```

The worktree is expected to be substantially dirty from the surface-stack
workstream. Do not revert unrelated changes.

## Root Cause To Confirm

The current shared stage path has a conceptual mismatch:

- `ensureDesktopWorldStage()` creates or reuses singleton
  `aos-desktop-world-stage`;
- after a duplicate/already-exists response, it calls `waitForCanvasReady()`;
- `waitForCanvasReady()` uses `canvas.eval` to inspect
  `window.headsup.manifest`;
- daemon `canvas.eval` is intentionally guarded by `canvasMutationPermitted()`;
- if the shared stage was created by a different canvas, such as a previous
  panel, `__log__`, or another owner, `surface-inspector` is forbidden from
  evaling it.

Do not fix this by allowing arbitrary cross-canvas `canvas.eval`. That would
weaken the canvas ownership model. The platform needs a readiness/status path
that is appropriate for shared surfaces.

## Required Behavior

### Shared Stage Readiness Must Not Depend On Arbitrary Cross-Canvas Eval

A panel should be able to determine that the shared DesktopWorld stage is
available even when another canvas originally created it.

Preferred direction:

- add or use a non-mutating daemon-backed canvas status/readiness API that is
  safe across owners, such as `canvas.info`, `canvas.ready`, or an equivalent;
- cache renderer `ready` manifest data in the daemon when a canvas emits
  `ready` / `lifecycle.ready`;
- expose enough status to verify:
  - canvas exists;
  - lifecycle state is active or warm enough;
  - manifest name is `desktop-world-stage` when required.

Acceptable alternative if it better matches existing code:

- mark the singleton DesktopWorld stage as an ownerless/shared platform surface
  for readiness and mutation bookkeeping only, while preserving the general
  sibling ownership protections.

Hard boundary: do not make unrelated canvas A able to arbitrary-`eval` canvas B.
Existing cross-canvas eval protection should remain covered by tests.

### Stage Path Should Stay Default When Stage Is Already Warm

When `aos-desktop-world-stage` already exists and is ready, Surface Inspector
minimize should:

- report `mode: "stage"`;
- record a truthful `stageEnsureStatus.ok === true`;
- send the chip stage-layer upsert;
- register body, restore, and close input regions;
- suspend `surface-inspector` only after those resources exist;
- not create an `aos-chip-*` WebView fallback in the default path.

### Fallback Timeout Must Not Leak Chips

If fallback WebView creation fails or times out after the daemon eventually
materializes the chip, the controller must clean up the known generated chip id.

Requirements:

- a failed fallback create should leave the source active;
- no stale `aos-chip-*` canvas should remain after fallback create failure,
  including timeout races where the daemon creates the chip after the JS RPC
  timed out;
- cleanup should be observable in controller state/logging;
- retrying minimize after a failed fallback should not accumulate stale fallback
  chips.

It is acceptable to remove the generated chip id optimistically and retry
cleanup briefly if the first remove races before the delayed create.

## Tests

Add tests that would have caught Operator's failure.

Suggested coverage:

- a shared stage created by canvas A can be readiness-checked by canvas B through
  the new non-mutating status/readiness path;
- unrelated cross-canvas `canvas.eval` remains forbidden;
- `ensureDesktopWorldStage()` treats an already-existing, ready, shared
  DesktopWorld stage as usable without requiring owner-gated eval;
- `createMinimizeController()` keeps `mode: "stage"` when the prewarmed stage is
  owned by another canvas but reported ready through the shared readiness path;
- fallback create rejection/timeouts attempt cleanup for the known chip id even
  when the spawn promise rejects before `fallbackChipCreated` is true;
- timeout-race cleanup retries or otherwise proves no stale generated chip is
  left behind;
- existing materialization, restore, close, duplicate-minimize, and fallback
  rollback tests still pass.

If daemon API changes are needed, add or update shell coverage around the
isolated daemon. A useful shape is:

1. canvas A creates a shared DesktopWorld stage;
2. canvas B verifies readiness through the new safe path;
3. canvas B still cannot arbitrary-`eval` canvas A or the stage unless that is
   explicitly part of the new contract, which should be avoided.

## Verification

Minimum:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
node --test tests/toolkit/runtime-canvas.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
```

If Swift/daemon files change:

```bash
./aos dev build
bash tests/canvas-lifecycle-metadata-smoke.sh
```

Also run any new focused daemon/API shell test added for shared canvas
readiness.

If `./aos ready` is clean after implementation, run a bounded non-real-pointer
probe that starts Surface Inspector with an already-existing stage owned by a
different canvas and confirms minimize uses the stage path. Do not run real
pointer smoke unless explicitly routed to Operator or the human has made input
ownership available for that purpose.

## Hard Boundaries / Non-Goals

- Do not remove stage-backed chips.
- Do not make WebView fallback the normal path.
- Do not move panel/windowing policy into daemon.
- Do not broadly allow arbitrary cross-canvas eval.
- Do not migrate Sigil.
- Do not rename Surface Inspector compatibility namespaces.

## Completion Report

Include:

- confirmed root cause;
- chosen readiness/status contract and why it preserves canvas ownership;
- code paths changed;
- fallback timeout cleanup behavior;
- tests and command results;
- whether live/non-real-pointer or real-pointer smoke was run or why skipped.
