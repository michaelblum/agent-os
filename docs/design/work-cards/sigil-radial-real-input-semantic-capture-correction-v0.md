# Sigil Radial Real-Input Semantic Capture Correction V0

## Tracker

- Issue: #305 Remodel Sigil as first-class consumer of AOS surface platform
- Parent card: `docs/design/work-cards/sigil-second-client-surface-inventory-v0.md`
- Related code:
  - `packages/toolkit/runtime/desktop-world-hit-region.js`
  - `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
  - `apps/sigil/renderer/radial-menu-surface.html`
  - `apps/sigil/renderer/live-modules/main.js`
  - `tests/scenarios/sigil/radial-menu/real-input.sh`
  - `tests/lib/sigil/radial-menu.sh`

## Foreman Outcome

Completed for the canonical radial path on 2026-05-12. Foreman reran the canonical real-input
scenario twice with `AOS_REAL_INPUT_OK=1 bash
tests/scenarios/sigil/radial-menu/real-input.sh`; both runs passed. #305 remains
open for the follow-up test-platform slice that factors repeated real-input
harness logic into AOS-derived test primitives and adds topology-neutral
DesktopWorld path radial coverage. The investigation notes below are historical
context for this correction, not active routing instructions.

## Fresh Context Reset

Historical pre-fix context: Implementer reported the second-client inventory and semantic
target replay slice passed real-input smoke, but Foreman reran the canonical
scenario and it failed. Deterministic tests are green; the blocker is live
semantic capture reliability for the radial child surface.

## Foreman Evidence

Foreman reran:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --check packages/toolkit/runtime/desktop-world-hit-region.js
node --test tests/renderer/sigil-panel-window-migration.test.mjs \
  tests/renderer/hit-target.test.mjs \
  tests/renderer/radial-menu-target-surface.test.mjs \
  tests/renderer/sigil-input-regions.test.mjs \
  tests/renderer/input-message.test.mjs \
  tests/toolkit/runtime-interaction-region.test.mjs \
  tests/toolkit/runtime-desktop-world-hit-region.test.mjs \
  tests/toolkit/runtime-input-events.test.mjs \
  tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
./aos ready --json
```

Those passed: syntax checks passed, 62 node tests passed, and readiness was
`ready=true mode=repo daemon=reachable tap=active`.

Then Foreman ran:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

It failed inside the scenario at:

```text
Command '['/Users/Michael/Code/agent-os/aos', 'see', 'capture', '--canvas',
'sigil-radial-menu-avatar-main', '--xray', '--out',
'/var/folders/.../aos-sigil-radial-....png']' returned non-zero exit status 1.
```

The current harness loses the capture command's stdout/stderr because
`run_json()` raises `CalledProcessError` before wrapping it in the scenario's
diagnostic JSON. A direct capture of the leftover radial child state after a
diagnostic attempt returned:

```json
{
  "code": "NO_DISPLAY",
  "error": "Region {{-10000, -10000}, {1, 1}} does not intersect any active display."
}
```

That suggests a likely race or stale state: the parent debug snapshot can get
far enough for the scenario to attempt semantic capture, while the daemon canvas
for `sigil-radial-menu-avatar-main` is still offscreen/non-interactive or has
already been disabled. Confirm this before fixing; do not assume the hypothesis
is proven.

A later Foreman rerun produced a richer failure before semantic capture:

```json
{
  "proofError": "FAIL: timed out waiting for AOS radial menu target surface; last=None",
  "initial": {
    "avatarVisible": true,
    "hitTargetReady": true,
    "hitTargetInteractive": true,
    "hitTargetFrame": [809, 1428, 80, 80],
    "state": "IDLE"
  },
  "lastProbe": {
    "state": "IDLE",
    "phase": null,
    "surface": {
      "id": "sigil-radial-menu-avatar-main",
      "ready": true,
      "interactive": false,
      "frame": [-10000, -10000, 371, 183],
      "targets": []
    },
    "targetIds": [],
    "visuals": {
      "visible": true,
      "itemIds": ["context-menu", "agent-terminal", "wiki-graph"]
    }
  },
  "drag": { "status": "success", "backend": "cgevent" }
}
```

This points to a live state synchronization problem: radial visuals can become
visible and the drag can succeed, while the semantic child target surface never
becomes interactive with target IDs during the scenario window.

Human observation during Foreman's diagnostic drag: the cursor visibly
"vibrated" while moving up/right. That is probably not incidental. The current
scenario uses a very short, very slow real drag:

```python
target = {"x": start["x"] + 24, "y": start["y"]}
subprocess.Popen([aos, "do", "drag", point_arg(start), point_arg(target), "--speed", "6"])
```

The `aos do drag` implementation in `src/act/actions.swift` still generates a
Bezier path with `profile.mouse.jitter` even when `--speed` is overridden. The
default natural profile has `jitter: 2` in `src/act/act-models.swift`, and
`src/act/act-helpers.swift` applies random `jx`/`jy` to every 8 ms drag step.
For a 24 px drag at 6 px/sec, that means hundreds of drag events with per-step
random motion that is a large fraction of the intended progress. This can create
visible vibration/backtracking and can make the app's animation/gesture timing
interact badly with real input delivery.

Sigil's defaults also matter: `dragThreshold` is 6 px, while radial item centers
are about `itemRadius * avatarHitRadius = 4.15 * 40 = 166 px` away. A 24 px drag
is enough to enter RADIAL but not enough to select an item, so the scenario is
trying to prove semantic targets during the narrow "drag is still down and
RADIAL is externally observable" window. If the low-speed jittery drag and
render-loop/canvas-update timing do not line up, the semantic child surface can
stay offscreen until release clears the radial snapshot.

## Goal

Make the canonical real-input radial menu semantic-target scenario reliable.
The outcome must be either:

- `AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh`
  passes from a clean repo daemon, or
- the scenario reports a richer, actionable failure that proves a different
  platform blocker and live #305 state records that exact gap.

Also make the test harness improvement durable. Surface Inspector must be
visible during these real-input surface tests from now on, and the reusable
harness level should make that the default instead of relying on each scenario
to remember it.

## Harness Contract

Add or refactor toward a reusable real-input surface harness in `tests/lib/`
instead of keeping all policy inside one Sigil scenario. The exact filenames are
up to implementation, but the levels should be clear:

- **Base / Level 0**: readiness and cleanup helpers only. No hidden runtime
  mutation beyond `./aos ready`, scoped content roots, and cleanup traps.
- **Level 1: real-input surface harness**: requires `AOS_REAL_INPUT_OK=1`,
  verifies `./aos ready`, launches a visible Surface Inspector, waits for its
  manifest/UI, and records enough state for failure diagnostics. Tests using
  real mouse/keyboard against AOS surfaces should start here.
- **Level 2: app scenario harness**: composes Level 1 with app-specific launch,
  stable placement, interaction trace arming, semantic-target capture, and
  cleanup. The Sigil radial scenario should become a Level 2 consumer, not a
  private harness pattern.

Surface Inspector requirements:

- It must be visible/active during real-input surface scenarios, not minimized or
  warm-suspended.
- Prefer the canonical `surface-inspector` id unless a scenario-specific
  inspector id is genuinely needed; either way, use the Surface Inspector
  manifest path and keep the panel visible.
- Failure output should include the Surface Inspector id, `show list` canvas
  state, relevant target surface frame/interactivity, and app interaction trace
  where available.
- Cleanup should remove scenario app surfaces and scenario-specific inspector
  canvases, but should not accidentally remove an unrelated user-opened Surface
  Inspector.

## Required Investigation

1. Reproduce the failure with `./aos ready` clean.
2. Improve `tests/lib/sigil/radial-menu.sh` diagnostics so `see capture`
   failures include the capture command output, surface snapshot, daemon canvas
   frame/interactivity if available, and the last radial probe.
3. Check whether `radial_surface_ready` / `refreshPayload()` only fixes payload
   replay while leaving placement readiness unacknowledged.
4. Check whether `createDesktopWorldHitRegionController.sync()` reports
   state-interactive before the daemon has actually applied `canvas.update`.
5. Check whether the scenario should wait for the daemon canvas frame to
   intersect an active display before calling `aos see capture --canvas`.
6. Inspect `aos do drag` path generation for short/slow drags. Confirm whether
   natural `jitter: 2` is being applied during `--speed 6` real drags and
   whether that produces non-monotonic/vibrating pointer movement.
7. Decide whether the right fix is in the action primitive, the live scenario,
   or both:
   - action primitive: suppress or scale jitter for precise/slow/short drags,
     or add an explicit precise drag mode;
   - scenario: use a longer radial hold/drag path and a timeout that reflects
     the actual animation plus CGEvent duration;
   - Sigil: make semantic target surface sync occur immediately on radial
     state entry, not only when the next animation frame happens to process it.
8. Make the reusable real-input harness level enforce visible Surface Inspector
   for this and future surface tests.

## Desired Radial Gesture Shape

The generic radial menu real-input path should model how a human explores a
radial menu rather than issuing one tiny drag and racing the render loop:

1. mouse down on the menu trigger origin;
2. move away from origin with human-like easing;
3. move back toward origin with easing;
4. move to the radial zone that makes menu items appear and active;
5. move in an elliptical path following the center of that zone while the mouse
   remains down, so target surfaces have a stable observation window.

This does not have to be a new CLI verb in this slice if it can be built in the
scenario harness, but the code should make the gesture shape reusable rather
than embedding unexplained point constants.

## Desired Sigil Radial Scenario

Build the Sigil scenario on top of the generic radial path:

1. Move from the avatar/menu-trigger origin to the opposite side of the current
   display while holding the mouse, then release.
2. Confirm avatar travel occurred.
3. Repeat mousedown on the avatar/menu-trigger origin.
4. Move through each radial menu item with stable easing/hold points.
5. Release on the last item.
6. Confirm the expected action occurred for that item.
7. Clean up every surface opened by the scenario, including utility/action
   surfaces opened by the selected menu item.

Choose the item order/action so the cleanup is deterministic. If the last item
opens Agent Terminal or another utility surface, assert it appears and then
remove it before the scenario exits.

## Implementation Scope

Prefer the smallest durable fix:

- If the runtime helper needs a generic "wait until child surface placement is
  externally observable" helper, add it in toolkit runtime and cover it.
- If the app should request/replay payload only after both child readiness and
  placement are visible, fix that path.
- If the live scenario is racing a fire-and-forget placement update, make the
  scenario wait on daemon-observed placement before semantic capture.
- If the live scenario is using an unrealistic short/slow jittery drag, correct
  the scenario so it exercises stable user intent. Do not paper over a real
  `aos do drag` primitive bug; open or route that as a separate exact action
  primitive fix if it is larger than this Sigil correction.
- If the existing scenario-local Surface Inspector launch is insufficient, lift
  it into the reusable real-input harness level.
- Keep the fix generic where the problem is generic; do not add one-off
  `sigil-radial-menu-avatar-main` daemon behavior.

## Required Docs / Issue State

- Do not change #305 to closed language unless the real-input scenario passes.
- If you change the conclusion in
  `docs/design/aos-surface-stack-v0-integration-ledger.md`, make the wording
  match the actual live evidence.
- Keep the #305 inventory, but qualify closure on this real-input semantic
  capture gate until it passes.

## Verification

Always run:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --check packages/toolkit/runtime/desktop-world-hit-region.js
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/toolkit/runtime-desktop-world-hit-region.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
```

If `./aos ready` is clean, run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Add or update focused harness tests if you introduce pure shell/Python helper
logic that can be checked without real input. At minimum, the real-input
scenario itself must prove Surface Inspector was visible during the run.

If readiness is blocked, report the exact `./aos ready` diagnosis. Do not run
permission-reset loops.

## Completion Report

Report:

- root cause;
- files changed;
- whether the fix is toolkit-generic, Sigil-specific, or harness-only;
- what reusable harness level was added or changed;
- how Surface Inspector visibility is guaranteed during real-input surface
  scenarios;
- real-input scenario result;
- whether #305 can close after Foreman review.
