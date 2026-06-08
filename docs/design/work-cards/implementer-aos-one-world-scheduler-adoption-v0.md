# Implementer Work Card: AOS One-World Scheduler Adoption V0

## Routing Status

Ready for Implementer dispatch from local `main` at
`6d2c4fef264437948db93f8eda38bca7d5ee08a2`.

This is AOS One-World/toolkit substrate work validated through the current Sigil
surface. Treat `apps/sigil/...` paths as the proving experience for platform
adoption, not as standalone Sigil product feature work.

## Tracker

- GitHub ledger: #223
- Goal contract: `docs/design/aos-surface-world-prompt-contract-v0.md`
- Accepted Phase 3 card:
  `docs/design/work-cards/implementer-aos-one-world-phase3-surface-migration-v0.md`
- Accepted Phase 3 report:
  `docs/dev/reports/aos-one-world-phase3-surface-migration-v0.md`
- Scheduler substrate:
  `apps/sigil/renderer/live-modules/world-raf-scheduler.js`
- Render-loop classification:
  `apps/sigil/renderer/live-modules/render-loop.js`

## Branch / Base

- `branch_from`: local `main`
- `required_start_ref`: `6d2c4fef264437948db93f8eda38bca7d5ee08a2`
- prerequisite checkpoint:
  `873a58061987c92e36e285cd85da33274dca7e83` records the Phase 3
  framing/live-acceptance docs update.
- `origin/main`: may still be behind this local documentation checkpoint. Do not
  start from `origin/main` unless Foreman has pushed or restated the base.
- `expected_output_branch`: `implementer/aos-one-world-scheduler-adoption-v0`

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local state, including `.playwright-cli/` and the
existing stashes.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the accepted Phase 2 `world-raf-scheduler.js` the scheduler that drives the
live `main.js` render loop, preserving the existing idle-motion `delayMs`
throttle and structural-dirty behavior.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/design/aos-surface-world-prompt-contract-v0.md`
- `docs/dev/reports/aos-one-world-phase3-surface-migration-v0.md`
- `docs/dev/reports/aos-one-world-phase2-sub-task1-scheduler-v0.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git branch --show-current
./aos ready --json
./aos status --json
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/world-raf-scheduler.js,apps/sigil/renderer/live-modules/render-loop.js,tests/renderer/sigil-one-world-phase2-scheduler.test.mjs,tests/renderer/sigil-render-loop.test.mjs
```

If live readiness reports a repo-mode TCC/input-tap blocker and live smoke is
needed, stop with:

```bash
the manual TCC blocker report path
```

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - currently imports
  `createRenderLoopScheduler`, creates `renderLoop`, uses
  `scheduleRenderFrame(...)`, `renderLoop.suspend()/resume()`, and calls
  `renderLoop.schedule(...)` again at the end of `animate()`.
- `apps/sigil/renderer/live-modules/world-raf-scheduler.js` - accepted shared
  scheduler with `register(...)`, `requestStructural()`, `scheduleFrame({ delayMs })`,
  `suspend()`, and `resume()`.
- `apps/sigil/renderer/live-modules/render-loop.js` - keeps
  `classifyRenderLoopWork(...)` and the legacy `createRenderLoopScheduler(...)`.
  Do not remove the legacy helper unless all in-repo callers/tests can be
  updated in this slice.
- `tests/renderer/sigil-one-world-phase2-scheduler.test.mjs` - scheduler
  contract tests, including the new `delayMs` behavior.
- `tests/renderer/sigil-render-loop.test.mjs` - legacy scheduler and
  classification tests; update only if the production contract changes.
- `tests/renderer/sigil-selection-mode-performance.test.mjs` - static checks
  around `scheduleRenderFrame({ structural:false })`.

## Required Behavior

- `main.js` must consume `createWorldRafScheduler` for the live render loop.
- Idle continuous frames must preserve the accepted throttle:
  `scheduleFrame({ delayMs: IDLE_AVATAR_MOTION_FRAME_DELAY_MS })` when work is
  visual-only.
- Immediate work must preempt any delayed idle frame, matching the scheduler
  `delayMs: 0` contract.
- Structural work must remain demand-driven:
  - existing callers that schedule with default structural behavior still mark
    the next frame structural;
  - callers that schedule with `{ structural:false }` stay non-structural;
  - `structuralFrameDirty` and the scheduler structural request cannot drift
    into contradictory state.
- Suspend/resume behavior must still prevent frames while suspended and resume
  cleanly on `canvas.suspended:false`.
- `liveJs.renderLoop` debug fields should remain meaningful enough for existing
  probes/tests: queued, delayed, suspended, mode, continuation reasons,
  structural dirty state, work, and last frame timestamp.
- Prefer a hard cutover in `main.js`. Do not leave a dual-scheduler adapter
  unless a concrete in-repo caller proves the legacy scheduler is still needed.

## Scope

Allowed:

- `apps/sigil/renderer/live-modules/main.js`
- narrowly necessary scheduler/debug tests under `tests/renderer/`
- narrow report/card updates if the implementation changes acceptance wording

Expected implementation shape:

- import `createWorldRafScheduler` in `main.js`;
- register a single `avatar-scene` or equivalent contributor for `animate()`;
- route `scheduleRenderFrame(options)` through that contributor;
- replace the end-of-`animate()` `renderLoop.schedule(...)` continuation path
  with the world scheduler contributor's `scheduleFrame({ delayMs })`;
- keep or adapt local debug state so probes do not lose visibility.

## Hard Boundaries / Non-Goals

- Do not change Swift or daemon/native code. If native work appears required,
  stop with `foreman_rebuild_needed`.
- Do not change AOS command policy, help, readiness repair, or TCC behavior.
- Do not migrate another surface or resume Phase 5 Sigil-as-content work.
- Do not alter `panelUrl:null`, the embedded controls migration, or the accepted
  avatar compact controls behavior except as required to keep scheduler calls
  correct.
- Do not push, open a PR, or mutate GitHub state.
- Do not treat raw `node --test` as authoritative; it discovers
  `packages/gateway/test/*.ts` without the package loader/build path.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/renderer/sigil-render-loop.test.mjs \
             tests/renderer/avatar-controls-hit-test.test.mjs \
             tests/renderer/sigil-surface-transport-probe.test.mjs \
             tests/renderer/sigil-one-world-co-location-probe.test.mjs \
             tests/renderer/sigil-one-world-phase2-scheduler.test.mjs \
             tests/renderer/sigil-one-world-extension-api.test.mjs \
             tests/renderer/sigil-selection-mode-performance.test.mjs
```

If the scheduler/debug changes add or affect other focused renderer tests, run
those too.

If `./aos ready --json` is ready and the implementation is deterministic-clean,
run a bounded live smoke:

1. Activate the validation experience with `./aos experience activate sigil --json`.
2. Confirm `avatar-main` loads the canonical
   `aos://sigil/renderer/index.html?toolkit-root=toolkit` surface.
3. Confirm the renderer remains responsive enough to produce frames and that no
   detached `sigil-avatar-controls-avatar-main` canvas appears when controls are
   opened.

Do not expand the live smoke into broad manual product testing. If live readiness
blocks on repo-mode TCC/input-tap, run the Implementer manual-intervention helper above and
return the blocker to Foreman.

## Completion Report

Return a path-scoped completion report with:

- branch/head used;
- files changed;
- how `main.js` now wires `createWorldRafScheduler`;
- how structural requests, non-structural scheduling, `delayMs`, and
  suspend/resume are preserved;
- tests run with exact pass/fail results;
- live smoke result or readiness blocker;
- any unrelated dirty state preserved;
- whether the follow-on frame-timing capture remains open.
