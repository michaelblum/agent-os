# Sigil Avatar Hit Target Click-Drag Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `origin/main`
- required_start_ref: `origin/main`
- expected output branch: `gdi/sigil-avatar-hit-target-click-drag-correction-v0`

## Tracker

- Source: current Foreman review of the user report, "avatar is not responding to mouse click or drag."
- Adjacent work cards:
  - `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md`
  - `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`
  - `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Restore the visible Sigil avatar's normal primary-button click and drag
behavior from the physical hit surface.

The current live path appears to accept the child hit surface and then drop or
misroute the left-button path before the avatar press / radial-open / fast
travel state machine can run. The result is that the avatar looks alive but
does not respond to mouse click or drag.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md`
- `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`
- `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `tests/sigil-avatar-interactions.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`

## Rediscover State

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "handleHitCanvasEvent|menu-closed|left_mouse_down|left_mouse_dragged|executeAvatarPressBegin|openRadialMenuFromClick|FAST_TRAVEL|avatarRegionEnabled|sigil-hit-avatar-main" apps/sigil tests/renderer docs/design/work-cards
```

If `./aos ready` reports the known repo-mode TCC or input-tap blocker, stop
with `human_needed` and report that exact diagnosis. Do not burn time on ad-hoc
permission repair in this slice.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - owns the avatar state machine,
  hit-canvas dispatch, and the current left-button gate.
- `apps/sigil/renderer/live-modules/input-message.js` - confirms the child
  canvas echo / normalization shape.
- `apps/sigil/renderer/live-modules/input-regions.js` - owns the daemon-native
  avatar/context-menu claim selection.
- `apps/sigil/renderer/live-modules/hit-target.js` - owns the avatar hit
  surface controller and its interactive/offscreen transitions.
- `apps/sigil/renderer/hit-area.html` - emits the child canvas pointer echo.
- `tests/renderer/input-message.test.mjs` - current child hit-message
  normalization coverage.
- `tests/renderer/hit-target.test.mjs` - avatar hit-target controller coverage.
- `tests/renderer/sigil-input-regions.test.mjs` - daemon input-region claim
  coverage.

## Required Behavior

### Primary Click And Drag

When the avatar is visible and the hit target is active:

- primary-button down/up on the avatar must still reach the normal Sigil avatar
  interaction path;
- a short click must open the radial menu or otherwise follow the existing
  avatar click behavior already encoded in the state machine;
- a drag past threshold must still transition into the existing fast-travel
  behavior;
- right-click/context-menu behavior must remain intact;
- daemon-echo suppression and child source identity must remain intact.

### Boundary Clarity

Do not leave the avatar dependent on a menu-open precondition to become
responsive to primary-button click or drag.

If inspection shows the left-button path should be restored through the daemon
input region rather than the child hit-canvas echo, do that instead of forcing
the click path through a private app flag.

Do not reintroduce `fromHitTarget`, `assumeInside`, or any other app-local
input folklore while repairing the path.

## Scope

Sigil app first, with only the smallest toolkit/runtime adjustment if inspection
proves a missing generic helper is the real blocker. Do not touch daemon/native
code unless the rediscovered evidence proves the issue is below the app layer.

## Hard Boundaries / Non-Goals

- Do not broaden this into a context-menu redesign.
- Do not redesign the avatar state machine.
- Do not change the avatar visuals, geometry, or radial menu content.
- Do not add new Sigil-specific daemon branches.
- Do not accept a fix that restores click/drag by weakening the source-identity
  contract or by adding another private boolean.
- Do not conflate this with the separate context-menu visibility workstream.

## Suggested Implementation Areas

Inspect before editing:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/hit-area.html`
- `packages/toolkit/runtime/input-events.js`

## Verification

Run deterministic tests first:

```bash
git diff --check
node --test tests/renderer/input-message.test.mjs tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
```

Then, if the fix touches the live avatar interaction path, run the focused
smoke:

```bash
bash tests/sigil-avatar-interactions.sh
```

If drag behavior changes, also run:

```bash
bash tests/sigil-hit-target-drag-fast-travel.sh
```

If `./aos ready` passes and live input is available, capture a bounded real
pointer proof for click and drag on the avatar hit target. If readiness is
blocked by the known TCC/input-tap problem, stop after deterministic coverage
and report the blocker exactly.

## Completion Report

Include:

- files changed;
- the confirmed root cause;
- which layer owned the fix;
- tests run with exact pass/fail results;
- live smoke result or the exact readiness blocker;
- whether any local-only state remains;
- any remaining follow-up slice if the fix exposed one.
