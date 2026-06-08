# Implementer Work Card: AOS Shared Gesture Spine Proof Correction V1

## Routing Status

Ready to dispatch.

## Tracker

- Primary GitHub issue: #427
- Coupled design dependency: #428
- Source work card: `docs/design/work-cards/implementer-aos-shared-gesture-spine-proof-v0.md`
- Restored draft source: `stash@{0}` from
  `implementer/aos-shared-gesture-spine-proof-v0`

## Recipient

Implementer correction and validation round.

## Branch / Base

- `branch_from`: local `main` at `ecb7ada8`
- `required_start_ref`: local branch
  `implementer/aos-shared-gesture-spine-proof-correction-v1`
- `expected_output_branch`: keep working on
  `implementer/aos-shared-gesture-spine-proof-correction-v1`

The current checkout already has the interrupted #427 draft restored from
`stash@{0}` with `git stash apply`; do not start from `origin/main`, and do not
drop or pop `stash@{0}`. The stash remains the safety copy until Foreman accepts
the corrected draft.

Use the single checkout at `/Users/Michael/Code/agent-os`. Do not create linked
worktrees. Preserve unrelated local work, including the untracked
`.playwright-cli/` directory if it is still present.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior implementation state, or parent-thread plans. Read and
rediscover before editing.

## Goal

Correct the restored #427 shared gesture spine draft so it satisfies the
evergreen gesture-frame contract and restores the old active-pointer guard:
temporary ingress from current AOS input messages must be explicitly owned and
removal-gated, and DOM pointer/mouse fallback events must not publish duplicate
gesture starts for one drag.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/controls/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `docs/design/work-cards/implementer-aos-shared-gesture-spine-proof-v0.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/api/toolkit/runtime.md`
- #427 via `./aos dev gh issue view 427 --json`
- #428 via `./aos dev gh issue view 428 --json`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git stash list --date=local | sed -n '1,3p'
./aos service status --mode repo --json
./aos dev gh issue view 427 --json
./aos dev gh issue view 428 --json
```

Live AOS restart/smoke is not approved for this correction. Do not run
`./aos ready`, `./aos status`, `./aos clean`, `./aos service start`, or
`./aos service restart`. Use passive service status only.

## Restored Draft State

Foreman restored the interrupted draft onto the required branch. Expected slice
paths are:

- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/api/toolkit/runtime.md`
- `packages/toolkit/runtime/gesture-stream.js`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/adapters/zag/slider.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/mouse-effects.js`
- `tests/toolkit/runtime-gesture-stream.test.mjs`
- `tests/toolkit/surface-inspector-mouse-effects.test.mjs`
- `tests/toolkit/zag-adapter-slider.test.mjs`

Foreman reran deterministic evidence before routing this correction:

```bash
git diff --check
node --test tests/toolkit/runtime-gesture-stream.test.mjs tests/toolkit/zag-adapter-slider.test.mjs tests/toolkit/surface-inspector-mouse-effects.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/runtime-range-drag.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs
```

All passed under the normal repo shell.

## Required Corrections

### 1. Make The Ingress Contract Evergreen

The restored design note currently says:

- `legacy input_event messages remain a compatibility source`
- `Existing raw input_event support remains only as a compatibility adapter`
- `Escape cancellation stay on the legacy mouse-effects adapter`

That wording is not acceptable without a removal gate. Replace indefinite
legacy/compatibility framing with a strict contract:

- owned callers that can consume `aos.gesture-frame` must migrate to that
  frame contract;
- current daemon/canvas input messages may be normalized as a source ingress
  only when the draft names the owned in-repo consumers;
- if any temporary bridge remains, name the removal gate explicitly;
- do not create or preserve broad compatibility aliases, shim names, or
  product-specific adapter vocabulary.

Acceptable outcomes:

- describe `input_event` / `input_region.event` handling as source
  normalization into the evergreen gesture-frame contract, not indefinite
  compatibility; or
- keep a temporary raw-input-to-gesture bridge, but name the exact owned
  consumers and the gate that removes it.

At minimum, the Surface Inspector minimap path must say whether it owns a
temporary ingress bridge for current daemon input delivery and when that bridge
is removed or narrowed. #428 should remain a schema/design dependency only.

### 2. Restore The Active Gesture Guard

The original slider private pointer path ignored a second start while a pointer
was active. The draft `bindDomPointerGesture(...)` can publish duplicate start
frames when browser fallback events arrive in the same interaction.

Foreman proof:

```text
pointerdown -> mousedown -> pointerup
["gesture.drag.start","gesture.drag.start","gesture.drag.end"]
```

Fix `packages/toolkit/runtime/gesture-stream.js` so a second DOM start event
while a gesture is already active is ignored, unless the corrected contract
intentionally supports an explicit terminal/reset path with tests. Preserve
mouse fallback support for environments that do not emit pointer events.

Add focused deterministic coverage in
`tests/toolkit/runtime-gesture-stream.test.mjs` or
`tests/toolkit/zag-adapter-slider.test.mjs` proving one user drag cannot emit
two start frames through pointer/mouse fallback duplication.

### 3. Keep The Proof Narrow

Do not expand the implementation beyond the restored V0 proof. Keep the active
migration at the Zag slider, keep Surface Inspector as the passive subscriber
proof, and keep #428 parked as a dependent schema/design lane.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/runtime-gesture-stream.test.mjs tests/toolkit/zag-adapter-slider.test.mjs tests/toolkit/surface-inspector-mouse-effects.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/runtime-range-drag.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs
```

Also run a scoped strict-contract text check and report the output:

```bash
rg -n "legacy|compatibility source|compatibility adapter|legacy mouse-effects adapter" docs/design/aos-shared-gesture-spine-v0.md docs/api/toolkit/runtime.md packages/toolkit/runtime/gesture-stream.js
```

If the scoped text check still finds `legacy` or `compatibility`, each match
must be justified by an explicit owned-consumer list and removal gate in the
same file. Otherwise remove the wording.

Do not perform live AOS smoke in this correction round.

## Completion Report

Return a path-scoped report for Foreman with:

- changed files;
- how the ingress bridge/normalization wording changed;
- the named owned consumers and removal gate if any temporary bridge remains;
- how duplicate DOM start frames are suppressed;
- exact verification commands and pass/fail results;
- confirmation that live AOS readiness/control was skipped;
- current `git status --short --branch`;
- confirmation that `stash@{0}` was not popped or dropped;
- any unrelated dirty/untracked state preserved.
