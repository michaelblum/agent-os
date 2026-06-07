# GDI Work Card: AOS Shared Gesture Spine Proof Correction V2

## Routing Status

Ready to dispatch.

## Tracker

- Primary GitHub issue: #427
- Coupled design dependency: #428
- Prior correction card:
  `docs/design/work-cards/gdi-aos-shared-gesture-spine-proof-correction-v1.md`
- Current branch already contains the restored #427 draft and V1 correction.

## Recipient

GDI correction and validation round.

## Branch / Base

- `branch_from`: local `main` at `ecb7ada8`
- `required_start_ref`: local branch
  `gdi/aos-shared-gesture-spine-proof-correction-v1`
- `expected_output_branch`: keep working on
  `gdi/aos-shared-gesture-spine-proof-correction-v1`

The current checkout is intentionally dirty with the restored #427 draft, V1
correction edits, and this V2 correction card. Do not start from `origin/main`.
Do not drop or pop `stash@{0}`; it remains the safety copy until Foreman accepts
the corrected proof.

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local work, including the untracked
`.playwright-cli/` directory if it is still present.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior implementation state, or parent-thread plans. Read and
rediscover before editing.

## Goal

Fix the shared gesture stream lifecycle so non-start input cannot create or
wedge an active gesture. A gesture sequence must begin with an explicit
`gesture.drag.start`; orphan move/end/cancel input should be ignored unless the
design note intentionally defines a tested resume policy.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/design/work-cards/gdi-aos-shared-gesture-spine-proof-correction-v1.md`
- `packages/toolkit/runtime/gesture-stream.js`
- `tests/toolkit/runtime-gesture-stream.test.mjs`
- #427 via `./aos dev gh issue view 427 --json`
- #428 via `./aos dev gh issue view 428 --json`

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

V1 fixed duplicate start frames, but `createPointerGestureStream(...)` still
creates an active gesture on a non-start frame when no gesture is active.

Foreman proof:

```text
stream.handleCanvasInput({ type: 'left_mouse_dragged', desktop_world: { x: 10, y: 20 } })
stream.handleCanvasInput({ type: 'left_mouse_down', desktop_world: { x: 15, y: 25 } })
```

Observed result:

```json
{
  "frames": ["gesture.drag.move"],
  "active": {
    "gestureId": "drag:1",
    "frameIndex": 1
  }
}
```

The orphan move should not publish a gesture frame or leave `active` set. In the
current draft, it wedges the stream and causes the next real start to be ignored
by the duplicate-start guard.

## Required Correction

Update `packages/toolkit/runtime/gesture-stream.js` so:

- `move`, `end`, and `cancel` frames are ignored when there is no active
  gesture;
- only `start` may create a new active gesture;
- the duplicate-start guard from V1 remains intact;
- pointer/mouse fallback support remains intact;
- Surface Inspector raw input fallback still gets a chance to handle non-drag
  or orphan messages when the gesture stream does not publish a frame.

If you believe an orphan non-start frame should resume an in-progress gesture,
do not implement that in this card. Stop and return the proposed resume policy
to Foreman with the frame contract implications.

Add focused deterministic coverage in
`tests/toolkit/runtime-gesture-stream.test.mjs` proving:

- orphan canvas `left_mouse_dragged` does not emit a frame and does not set
  `stream.snapshot().active`;
- a subsequent `left_mouse_down` starts normally after the orphan move;
- preferably the same invariant holds for direct DOM `pointermove` before
  `pointerdown` if practical.

Update `docs/design/aos-shared-gesture-spine-v0.md` only if needed to clarify
that V0 starts gestures only on explicit start frames. Do not expand the proof
scope beyond this lifecycle correction.

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

## Known Broad-Suite Context

Foreman additionally ran `node --test tests/toolkit/*.test.mjs` after V1. The
suite reported 963/967 passing with four unrelated radial menu
descriptor/resolver failures:

- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/runtime-radial-menu-config.test.mjs`

Those paths are not part of this #427 slice. Do not fix radial menu tests in
this card, but mention whether the result changes if you rerun the broad suite.

## Completion Report

Return a path-scoped report for Foreman with:

- changed files;
- how orphan non-start frames are handled;
- exact regression assertions added;
- exact verification commands and pass/fail results;
- confirmation that live AOS readiness/control was skipped;
- current `git status --short --branch`;
- confirmation that `stash@{0}` was not popped or dropped;
- any unrelated dirty/untracked state preserved.
