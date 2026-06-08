# Implementer Work Card: Toolkit Panel Placement Final Frame Contract V0

## Recipient

Implementer implementation round.

## Branch / Base

- `branch_from`: `implementer/aos-runtime-service-input-tap-observability-v0`
- `minimum_code_start_ref`: `6cd1f386396ae5c0c781aa2d8bbf8bea1b8e66fd`
- `required_start_ref`: the Foreman docs-alignment checkpoint containing this
  work card, descendant of `6cd1f386396ae5c0c781aa2d8bbf8bea1b8e66fd`
- `expected_output_branch`: `implementer/toolkit-panel-placement-final-frame-contract-v0`

Do not restart from `origin/main`. This work depends on the accepted
visible-surface audit, cross-process audit, and runtime service/input-tap
observability slices.

## Source Artifact

Foreman accepted the passive TCC observability correction on:

```text
6cd1f386396ae5c0c781aa2d8bbf8bea1b8e66fd
```

The next step in the active Sigil/avatar panel workstream is toolkit placement
contract work, not live drag correction. The live-drag card remains paused.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, display, content-root, or prior live state. Read and rediscover before
editing. Leave unrelated untracked work cards and reports alone.

## Goal

Make toolkit panel placement expose a strict, inspectable contract for requested
frame, policy-adjusted frame, final settled frame, actual native frame, and
viewport overflow policy, so future Sigil avatar avoidance and live drag work
can reason from AOS-visible evidence instead of hidden placement side effects.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `src/AGENTS.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/mount.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/manifest.js`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/panel-drag-transfer.test.mjs`
- `tests/canvas-visible-surface-audit.sh`
- `tests/canvas-window-placement.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 6cd1f386396ae5c0c781aa2d8bbf8bea1b8e66fd HEAD; echo "accepted_runtime_observability_ancestor=$?"
./aos ready --json
./aos status --json
./aos show audit --json
./aos dev recommend --json --paths packages/toolkit/panel/placement.js,packages/toolkit/panel/chrome.js,packages/toolkit/panel/mount.js,packages/toolkit/runtime/canvas.js,src/display/canvas.swift,src/display/protocol.swift
rg -n "clampFrameToWorkArea|createPanelWindowController|createDragController|updateFrame\\(|mutateSelf\\(|geometry|requested_frame|desiredCGFrame|actual_native_windows|final|settled|overflow|allow|clamp|flip|shift" packages/toolkit src tests docs/design
```

If `./aos ready` reports a repo-mode TCC, Accessibility, Input Monitoring, or
inactive input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, continue
in the same Implementer session and run:

```bash
./aos ready --post-permission
```

## Required Behavior

### 1. Placement Contract

Define a small public toolkit placement contract that uses native global CG
coordinates for panel frames. The contract must make these concepts explicit:

- `requested_frame`: the caller's requested frame before toolkit placement
  policy changes it.
- `policy_adjusted_frame`: the frame after toolkit placement policy such as
  viewport overflow handling, display work-area selection, clamp, flip, or
  shift.
- `final_settled_frame`: the frame the toolkit requests as the settled panel
  frame after placement policy is complete.
- `actual_native_frame`: the native frame reported by the daemon/window server.
- `viewport_overflow_policy`: the effective policy for the placement operation.

Names can differ if the existing code has a clearly better vocabulary, but the
fields must be unambiguous and stable in tests. Avoid duplicate target
vocabulary and transitional aliases.

### 2. Opt-In Viewport Overflow Policy

Panel placement must support opt-in viewport overflow behavior using the
existing toolkit placement layer. Acceptable policy names include `allow`,
`clamp`, `flip`, and `shift`, but prefer existing local naming if one already
exists.

Default behavior should remain conservative and compatible with current panel
clamping. Do not make the daemon own layout policy.

### 3. Inspectable Reporting

Expose the placement contract through the narrowest AOS-visible path that fits
the current architecture. Likely options are canvas geometry lifecycle payloads,
`./aos show list --json`, and/or `./aos show audit --json`.

At minimum, a panel opened near a viewport edge must let a test distinguish:

- the caller-requested frame;
- the toolkit policy-adjusted/final settled frame;
- the actual native frame seen by the daemon.

If a canvas type cannot provide a single requested placement frame, preserve
the existing unavailable-reason pattern from the visible-surface audit.

### 4. Keep Ownership Boundaries Strict

- Daemon/kernel owns native truth, actual frames, displays, lifecycle, and
  observability.
- Toolkit owns reusable opt-in panel placement policy and final settled frame
  reporting.
- Sigil owns avatar semantics and any later decision to avoid or reposition the
  avatar around its controls panel.

## Scope

Toolkit panel placement/chrome, toolkit runtime canvas mutation helpers, daemon
canvas geometry/audit reporting, and focused tests are in scope.

Sigil code is in scope only if an existing first-party panel open path needs a
small option pass-through to consume the new toolkit placement API. Do not
implement avatar avoidance in this slice.

## Hard Boundaries / Non-Goals

- Do not resume live drag correction.
- Do not implement Sigil avatar avoidance or avatar movement.
- Do not migrate `sigil.avatar_panel.*` to the visual-object/resource contract.
- Do not introduce `aos.state.*` or a new shared store.
- Do not move toolkit layout policy into Swift daemon code.
- Do not weaken current current-daemon, cross-process, or input-tap
  observability behavior.
- Do not remove or rewrite unrelated untracked work cards or reports.

## Suggested Implementation Shape

This is guidance, not a mandate:

- Add a pure placement-plan helper in `packages/toolkit/panel/placement.js`
  that accepts a requested frame, display/work-area inputs, and overflow policy,
  then returns requested, policy-adjusted, final settled, and policy metadata.
- Thread the plan through `createPanelWindowController()` / `mountPanel()` where
  panels are initially placed and where drag/resize/maximize settle frames.
- When toolkit calls `mutateSelf({ frame, geometry })`, include placement
  context in the geometry payload only if that is the smallest stable reporting
  path.
- Extend `src/display/canvas.swift` audit or geometry serialization only enough
  to expose native truth and the last requested/final placement metadata. Keep
  actual native frame sourced from the window server when using `show audit`.
- Preserve existing `requested_frame` from `Canvas.desiredCGFrame`; add new
  fields only when their source is clear.

## Verification

Minimum deterministic checks:

```bash
git diff --check
./aos dev recommend --json --paths packages/toolkit/panel/placement.js,packages/toolkit/panel/chrome.js,packages/toolkit/panel/mount.js,packages/toolkit/runtime/canvas.js,src/display/canvas.swift,src/display/protocol.swift
node --test tests/toolkit/panel-chrome.test.mjs tests/toolkit/panel-drag-transfer.test.mjs
bash tests/canvas-visible-surface-audit.sh
bash tests/canvas-window-placement.sh
```

If Swift files change, also run:

```bash
./aos dev build
bash build.sh --no-restart
```

Live proof when `./aos ready --json` is ready:

```bash
./aos show remove-all
./aos show create --id toolkit-panel-placement-edge --at 1400,80,420,260 --interactive --focus --url aos://toolkit/components/aos-action-demo/index.html
./aos show audit --json --point 1410,90
./aos show list --json
./aos show remove-all
./aos status --json
./aos clean --dry-run --json
```

Adapt coordinates to the active display geometry. The evidence must include a
panel near a viewport edge where requested versus final/actual frame reporting
can be observed. Do not rely on screenshots alone.

## Completion Report

Include:

- files changed;
- public placement contract fields and where they are exposed;
- default and opt-in overflow policy behavior;
- how requested, policy-adjusted, final settled, and actual native frames are
  sourced;
- deterministic tests run and results;
- live proof result, or exact TCC/input-tap blocker and manual-intervention path;
- cleanup result from `./aos show list --json` and `./aos clean --dry-run --json`;
- any follow-up required before Sigil avatar avoidance or live drag resumes.
