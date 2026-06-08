# Toolkit StageAffordance Extraction V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #122 Toolkit-owned DesktopWorld hit-region controller
- Follow-up from: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions
- Related issues: #120 input event identity, #123 warm/suspend/resume lifecycle,
  #261 panel window placement
- Plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract a reusable toolkit StageAffordance or visual-hit binding from the
stage-backed minimized-chip V0, then rebuild minimized chips on top of that
abstraction without changing the user-facing chip behavior.

The result should make passive DesktopWorld visuals plus daemon input regions a
toolkit primitive instead of one-off panel chrome code.

## Current Evidence

The V0 chip implementation in `packages/toolkit/panel/chrome.js` proves the
architecture direction:

- a passive layer is upserted into `aos-desktop-world-stage`;
- restore, close, and body regions are registered through
  `packages/toolkit/runtime/input-region.js`;
- restore and close clean up regions and the stage layer;
- WebView chip creation remains as explicit fallback.

Foreman deterministic review passed:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
git diff --check
```

Live pointer smoke is still blocked by repo-mode TCC:
`./aos ready` reports `phase=human_required` and
`diagnosis=daemon_tcc_grant_stale_or_missing`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
- `docs/api/toolkit.md`
- `shared/schemas/daemon-event.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 304 --json number,title,state,url,body,labels
```

If `./aos ready` reports the known TCC blocker, do not run live pointer smoke.
Use deterministic tests and report the blocker. If the human has completed the
safe permission reset and says `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `packages/toolkit/panel/chrome.js` - current chip V0 and current duplication
  target.
- `packages/toolkit/panel/drag-transfer.js` - existing passive stage layer
  helper and shared stage bootstrap.
- `packages/toolkit/components/desktop-world-stage/model.js` - layer shape and
  rendering contract.
- `packages/toolkit/runtime/input-region.js` - generic bridge helper for
  registering and removing hit regions.
- `packages/toolkit/runtime/bridge.js` and `runtime/subscribe.js` - message
  delivery and event subscription mechanics.
- `src/daemon/unified.swift` - input-region ownership, event routing, and
  cleanup semantics.
- `tests/toolkit/panel-chrome.test.mjs` - deterministic chip behavior tests.
- `tests/toolkit/runtime-input-region.test.mjs` - focused input-region helper
  tests.

## Required Behavior

### StageAffordance Contract

- Provide one small toolkit abstraction that binds passive stage layers to one
  or more daemon input regions.
- It must own deterministic setup and cleanup for stage layers, regions, and
  any subscriptions or bridge handlers it installs.
- It must make ownership explicit: which canvas owns each input region, which
  canvas renders the visual layer, and which controller receives events.
- It must expose enough state for tests and future inspector visibility:
  layer ids, region ids, owner canvas id, target/source canvas id, mode, and
  cleanup status.
- It must not move default windowing policy into runtime or daemon code.

### Minimized Chips

- Rebuild the current stage-backed chip path on StageAffordance.
- Preserve current restore, close, fallback, duplicate-minimize, source-removal,
  and failure cleanup behavior.
- Keep drag/body behavior explicitly deferred unless this slice can implement it
  cleanly without broadening scope.
- Keep `packages/toolkit/panel/minimized-chip.html` only as explicit fallback.

### Cleanup And Idempotence

- Repeated cleanup should be safe.
- Restore should remove all chip regions and the stage layer, then resume the
  source panel.
- Close should remove all chip regions and the stage layer, then remove the
  source panel.
- Source removal or setup failure must not leave stale stage layers or stale
  input regions.

## Scope

This is toolkit surface/windowing architecture. The likely home is
`packages/toolkit/panel/`, with runtime used only for generic daemon bridge
helpers that already exist. If code inspection proves the abstraction belongs
under `packages/toolkit/components/`, document why in the completion report.

## Hard Boundaries / Non-Goals

- no Sigil migration;
- no daemon-owned window manager or minimize policy;
- no broad panel redesign;
- no replacement for Surface Inspector in this slice;
- no lifecycle warming implementation in this slice;
- no live pointer smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

- Add a focused module such as `packages/toolkit/panel/stage-affordance.js`.
- Move chip region id generation, layer upsert/remove, input-region
  register/remove, and event matching out of `chrome.js`.
- Keep chip placement math in existing panel placement/chrome helpers unless a
  narrower extraction is obvious.
- Add focused tests for the new abstraction and keep panel tests asserting the
  minimize behavior.

## Verification

Run deterministic tests:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
git diff --check
```

If the abstraction touches shared stage model behavior, also run:

```bash
node --test tests/toolkit/*.test.mjs
```

If `./aos ready` passes, run a bounded live smoke for Surface Inspector minimize,
restore, close, fallback observability, and stale region cleanup. If it reports
the known TCC blocker, record that exact blocker instead.

## Completion Report

Include:

- files changed;
- new abstraction name, module path, and public functions;
- whether minimized chips use the abstraction in the default path;
- exact region ownership and event routing model retained or changed;
- cleanup behavior for restore, close, source removal, and failures;
- deterministic tests run with exact result;
- live smoke result or exact readiness blocker;
- whether the next slice should be input identity (#120), lifecycle warming
  (#123), panel placement (#261), or inspector visibility.

## Foreman Review Status

Accepted after the subscription cleanup correction in
`docs/design/work-cards/toolkit-stage-affordance-subscription-cleanup-correction-v0.md`.

The accepted shape is:

- `packages/toolkit/panel/stage-affordance.js` owns passive stage layer,
  input-region registration, event matching, source-removal cleanup, and
  idempotent cleanup state;
- minimized chips use StageAffordance in the default path and retain the
  WebView chip as explicit fallback;
- default cleanup retains shared canvas-wide lifecycle subscriptions and reports
  `cleanupStatus.subscriptionRetained`.

Live pointer smoke remains blocked until the repo-mode TCC reset.
