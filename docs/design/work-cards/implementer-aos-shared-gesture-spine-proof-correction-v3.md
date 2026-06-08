# Implementer Work Card: AOS Shared Gesture Spine Proof Correction V3

## Routing Status

Ready to dispatch.

## Tracker

- Primary GitHub issue: #427
- Coupled design dependency: #428
- Prior correction card:
  `docs/design/work-cards/implementer-aos-shared-gesture-spine-proof-correction-v2.md`
- Current branch already contains the restored #427 draft plus V1/V2
  corrections.

## Recipient

Implementer correction and validation round.

## Branch / Base

- `branch_from`: local `main` at `ecb7ada8`
- `required_start_ref`: local branch
  `implementer/aos-shared-gesture-spine-proof-correction-v1`
- `expected_output_branch`: keep working on
  `implementer/aos-shared-gesture-spine-proof-correction-v1`

The current checkout is intentionally dirty with the restored #427 draft and
correction cards. Do not start from `origin/main`. Do not drop or pop
`stash@{0}`; it remains the safety copy until Foreman accepts the corrected
proof.

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local work, including the untracked
`.playwright-cli/` directory if it is still present.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior implementation state, or parent-thread plans. Read and
rediscover before editing.

## Goal

Make stream destruction satisfy the documented gesture lifecycle contract:
destroying an active `createPointerGestureStream(...)` must publish one terminal
`gesture.drag.cancel` frame before clearing subscribers/state.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `packages/toolkit/runtime/gesture-stream.js`
- `tests/toolkit/runtime-gesture-stream.test.mjs`
- #427 via `./aos dev gh issue view 427 --json`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git stash list --date=local | sed -n '1,3p'
./aos service status --mode repo --json
```

Live AOS restart/smoke is not approved for this correction. Do not run
`./aos ready`, `./aos status`, `./aos clean`, `./aos service start`, or
`./aos service restart`. Use passive service status only.

## Foreman Review Finding

The V2 correction passed its required verification, but Foreman found one
remaining lifecycle-contract gap. `docs/design/aos-shared-gesture-spine-v0.md`
says the shared lifecycle owner must publish `gesture.drag.cancel` on
destruction while a gesture is active.

Current proof:

```text
stream.handleCanvasInput({ type: 'left_mouse_down', desktop_world: { x: 1, y: 2 } })
stream.destroy()
```

Observed result:

```json
{
  "frames": ["gesture.drag.start"],
  "active": null
}
```

Expected result: a terminal `gesture.drag.cancel` frame is published before the
stream clears subscribers/state.

## Required Correction

Update `packages/toolkit/runtime/gesture-stream.js` so `destroy()` publishes one
cancel frame when a gesture is active, then clears active state and subscribers.
Keep existing explicit `cancel(...)` behavior and the V1/V2 guards intact.

Add focused deterministic coverage in
`tests/toolkit/runtime-gesture-stream.test.mjs` proving:

- destroying an active stream publishes `gesture.drag.cancel`;
- `stream.snapshot().active` is `null` after destroy;
- destroying an idle stream does not publish a cancel frame.

Avoid double-cancel behavior for `bindDomPointerGesture(...)` cleanup. If the
bound helper calls `stream.cancel('destroyed')` and then destroys an internally
owned stream, the corrected `destroy()` must not publish a second cancel.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/runtime-gesture-stream.test.mjs tests/toolkit/zag-adapter-slider.test.mjs tests/toolkit/surface-inspector-mouse-effects.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/runtime-range-drag.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs
rg -n "legacy|compatibility source|compatibility adapter|legacy mouse-effects adapter" docs/design/aos-shared-gesture-spine-v0.md docs/api/toolkit/runtime.md packages/toolkit/runtime/gesture-stream.js
```

The final `rg` command should produce no output and exits non-zero when there
are no matches; report it as "no matches" when that happens.

Do not perform live AOS smoke in this correction round.

## Completion Report

Return a path-scoped report for Foreman with:

- changed files;
- how stream destruction publishes cancel without double-canceling;
- exact regression assertions added;
- exact verification commands and pass/fail results;
- confirmation that live AOS readiness/control was skipped;
- current `git status --short --branch`;
- confirmation that `stash@{0}` was not popped or dropped;
- any unrelated dirty/untracked state preserved.
