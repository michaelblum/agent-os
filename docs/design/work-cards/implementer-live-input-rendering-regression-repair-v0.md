# Implementer Work Card: Live Input And Rendering Regression Repair V0

## Recipient

Implementer implementation round.

## Branch / Base

- `branch_from`: current workspace branch
  `implementer/sigil-avatar-panel-final-frame-avoidance-assessment-v0`
- `minimum_code_start_ref`: `1cb60a5801960aca0c3120236b7b9549fcdffbf4`
- `required_start_ref`: current dirty workspace on
  `implementer/sigil-avatar-panel-final-frame-avoidance-assessment-v0`
- `expected_output_branch`: keep the current branch unless Implementer must create a
  correction branch for isolation.

Do not restart from `origin/main`. The tracked dirty files on this branch are
part of the current candidate state. Inspect them carefully and work with them.
Do not revert recent work unless you prove a clear regression or corruption.

## Source Artifact

Foreman live regression sweep on 2026-06-03 after recent AOS/UI/input refactors.

Foreman first restored the repo daemon to a usable state. `./aos ready --repair`
and `./aos service restart --mode repo` looped on an unmanaged owner pid, while
`./aos clean` protected that lock owner. As a last-resort diagnostic/control
step, Foreman SIGTERM'd the unmanaged interactive `./aos serve` process family
(`6213`/`6215`) and restarted through `./aos service start --mode repo --json`.
After that, `./aos ready --json` reported launchd-managed repo mode, active
input tap, and no blockers.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Make the post-refactor live input tests pass again and produce a defensible
live rendering proof near 60fps, without undoing the recent AOS primitive,
canonical identifier, binary-reduction, and dock-hook-removal work unless a
specific regression requires it.

## Foreman Evidence

Live failures:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Failed before pointer proof. First Surface Inspector launch timed out waiting
for manifest readiness. After retry/cleanup, the scenario failed at
`wait-avatar-absent` because `avatar-main`, `sigil-hit-avatar-main`,
`sigil-radial-menu-avatar-main`, and `sigil-agent-terminal` were present again.
Daemon logs showed `status-item front-load persistent target=avatar-main
reason=setup`.

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Failed before pointer proof. It hit Surface Inspector manifest timeout, then
after retry hit daemon/socket instability:
`ipc: daemon auto-start disabled by AOS_DISABLE_DAEMON_AUTOSTART`,
`CONNECT_ERROR`, and an IPC failure while creating `surface-inspector`.

```bash
AOS_REAL_INPUT_OK=1 bash tests/sigil-real-input-status-avatar.sh
```

Failed before real status-click assertions:
`FAIL: timed out after 15s during launch surface inspector`. Snapshot showed an
isolated foreground/dev daemon lock owner alive but socket-unreachable.

```bash
AOS_REAL_INPUT_OK=1 bash tests/sigil-context-menu-real-input.sh
```

Failed after setup:
`TimeoutError: timed out waiting for context menu open from real right click`.

```bash
bash tests/sigil-hit-target-drag-fast-travel.sh
```

Failed:
`FAIL: open context menu swallowed avatar drag`, with `menuOpen: true`,
`state: IDLE`, and pointer at the drag destination.

Passing checks from the same sweep:

```bash
bash tests/sigil-avatar-interactions.sh
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/toolkit/real-input-surface-primitives.test.mjs tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/toolkit/controls-slider-color.test.mjs
```

Bounded live rendering sample while `avatar-main` was visible and idle:

```json
{
  "frames": 180,
  "durationMs": 3052.0,
  "avgFrameMs": 16.94,
  "p95FrameMs": 22,
  "avgFps": 59.04,
  "over16_7": 95,
  "over33_3": 2,
  "renderLoop": {
    "mode": "continuous",
    "continuationReasons": ["avatar-motion"],
    "structuralDirty": false,
    "work": {
      "visualOnly": true,
      "structural": false,
      "overlay": false,
      "publishState": false,
      "idleMotionDelayMs": 33
    }
  }
}
```

This is close to 60fps, but not a clean 60fps proof because p95 frame spacing
was 22ms and half the samples exceeded 16.7ms.

Built-in stellation resource smoke passed:

- `fullRebuildDelta: 0`
- `stable: true`
- `finite: true`
- `updates: 81140` over a 1000ms proof window
- `draw_calls: 13`
- no replacement resources created/disposed

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/post-refactor-aos-dock-real-input-audit-v0.md`
- `docs/dev/reports/sigil-renderer-post-refactor-quality-review-and-forensics-v0.md`
- `docs/design/work-cards/implementer-post-refactor-real-input-dogfooding-corrections-v0.md`
- `docs/design/work-cards/implementer-sigil-avatar-hit-target-click-drag-correction-v0.md`
- `docs/design/work-cards/implementer-radial-compact-real-input-primitives-v0.md`
- `docs/design/work-cards/sigil-render-performance-regression-v0.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
./aos ready --json
./aos status --json
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos show list --json
./aos dev recommend --json
```

If `./aos ready --json` reports a repo-mode TCC, Accessibility, Input
Monitoring, or inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. Do not run permission setup, TCC reset, or
unbounded repair loops from Implementer.

## Existing Code To Inspect

- `src/display/status-item.swift` - current persistent target front-load,
  recreate, show/hide, and click behavior.
- `src/commands/serve.swift` - status item setup path and whether front-load
  should happen during daemon startup/setup.
- `src/daemon/unified.swift` and `src/display/canvas.swift` - canvas lifecycle,
  parent/cascade, socket/daemon stability, and recent product-key removals.
- `tests/lib/real-input-surface-harness.sh` - live repo scenario startup,
  cleanup, and opt-in order.
- `tests/lib/sigil/visual-harness.sh` - Sigil launch/show/status-item helpers.
- `tests/lib/sigil/radial-menu.sh` - canonical real-input radial proof body.
- `tests/lib/sigil_real_input_context.py` - real avatar right-click/context
  menu harness.
- `tests/sigil-context-menu-real-input.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/avatar-editor/panel.js`
- `apps/sigil/renderer/live-modules/render-loop.js`

## Required Behavior

### Live Surface Startup Is Reliable

The real-input radial scenarios must be able to prepare live roots, launch or
restart Surface Inspector, clean Sigil canvases, and reach the actual pointer
proof. Surface Inspector manifest readiness must not intermittently leave the
repo daemon socket-unreachable or leave only a stale daemon lock.

If status-item persistent front-load is still product-required, tests that need
`avatar-main` absent must explicitly disable or neutralize it through a clear
AOS-owned setup step before asserting absence. If front-load on daemon startup
is the regression, fix the product/runtime path instead. Do not solve this with
hard-coded sleeps or by hiding the failure behind broad cleanup.

### Real Input Uses Canonical AOS Paths

Live pointer/click/drag proofs must use the current AOS primitives, recipes, and
shared real-input helpers. Do not add private ad hoc pointer injection or new
test-only product strings.

### Avatar Right Click Opens The Compact Context Menu

`tests/sigil-context-menu-real-input.sh` must prove that a real right-click on
the avatar opens the current compact context menu and that subsequent compact
controls still route through populated AOS control records.

### Open Context Menu Does Not Swallow Avatar Drag

`tests/sigil-hit-target-drag-fast-travel.sh` must prove that an open/duplicate
context-menu state does not prevent the avatar drag path from entering
`FAST_TRAVEL`. Preserve duplicate right-click echo suppression; do not regress
right-click-away behavior.

### Rendering Proof Is Honest

Keep the deterministic render-loop visual-only contract passing. Add or update
a bounded live proof that reports enough numbers for Foreman to decide whether
idle visible Sigil is back at the intended 60fps-class behavior:

- average FPS / average frame ms;
- p95 frame ms;
- over-budget counts for 16.7ms and 33.3ms;
- render-loop mode, continuation reasons, and work classification;
- whether the avatar was visible, idle, unpaused, and context-menu closed.

Do not fake the performance result by hiding the avatar, disabling expected idle
motion, pausing effects, or removing the current visual-only scheduling
contract. If the live target is intentionally 30fps for idle visual-only motion,
document that current product contract explicitly and update the test/reporting
language so "60fps" is not falsely claimed.

## Scope

This slice may touch Sigil app code, toolkit real-input/control helpers, tests,
and narrow AOS runtime lifecycle/status-item code if needed. Keep reusable input
and surface mechanics in AOS/toolkit layers. Keep Sigil product behavior in
Sigil. Do not put Sigil product keys or branches back into the daemon.

## Hard Boundaries / Non-Goals

- Do not resurrect `.docks` hooks or automatic rebuild hooks.
- Do not broaden the Swift binary with product policy unless the bug is proven
  to be in a native primitive contract.
- Do not reintroduce old competing AOS UI identifiers or compatibility shims.
- Do not replace canonical AOS input primitives with ad hoc script clicks.
- Do not disable real-input opt-in gates.
- Do not run TCC reset or permission setup from Implementer.
- Do not remove expected idle avatar motion to satisfy FPS.
- Do not revert recent refactors broadly. Revert or amend only the narrow code
  proven to cause a regression.
- Do not mutate unrelated untracked work cards or reports.

## Verification

Start with deterministic checks:

```bash
git diff --check
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/toolkit/real-input-surface-primitives.test.mjs tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/toolkit/controls-slider-color.test.mjs
bash tests/sigil-avatar-interactions.sh
bash tests/sigil-hit-target-drag-fast-travel.sh
```

Then run live checks only when `./aos ready --json` is ready:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
AOS_REAL_INPUT_OK=1 bash tests/sigil-real-input-status-avatar.sh
AOS_REAL_INPUT_OK=1 bash tests/sigil-context-menu-real-input.sh
```

Also include a bounded live rendering proof. It may be a proper script/test, or
an AOS-backed command sequence if the codebase has not yet promoted it to a
test. It must emit the FPS/frame fields listed above plus the render-loop
classification.

Finish with:

```bash
./aos ready --json
./aos clean --dry-run --json
./aos show list --json
git status --short --branch
```

## Completion Report

Include:

- branch name and head SHA;
- path-scoped changed-file summary;
- which current dirty tracked files belonged to this slice and which were
  pre-existing;
- root cause for Surface Inspector/daemon socket startup failure;
- root cause for status-item front-load recreating `avatar-main` during live
  tests, or the reason it is intentional and how tests now account for it;
- root cause for real avatar right-click not opening the compact context menu;
- root cause for open context menu swallowing avatar drag;
- live FPS proof values and whether they meet the intended contract;
- exact deterministic and live commands run with pass/fail results;
- final `ready`, `clean --dry-run`, and `show list` state;
- any generated artifacts retained for review;
- whether the branch was pushed.
