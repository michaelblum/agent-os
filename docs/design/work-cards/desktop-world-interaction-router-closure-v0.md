# DesktopWorld Interaction Router Closure V0

## Tracker

- Primary issue: #118 Add DesktopWorld interaction regions with pointer capture
- Parent issue: #119 Epic: DesktopWorld interaction surfaces and warmed UI
  primitives
- Umbrella epic: #223 AOS Surface System
- Related closed V0 baselines: #120, #122, #123, #261, #303, #304
- Related open issue: #305 Sigil first-class surface consumer

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. The worktree is expected to be substantially dirty
from the surface-stack workstream; do not revert unrelated changes.

## Goal

Audit #118 and #119 against current code and decide whether they can close as
accepted/folded V0. Implement only tiny doc/test corrections if the audit finds
that the code is already correct but the repo source of truth is stale.

This should not become a broad interaction-system redesign. The recent
surface-stack work closed the child baselines that previously kept #118/#119
open.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `packages/toolkit/runtime/interaction-region.js`
- `packages/toolkit/runtime/range-drag.js`
- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `packages/toolkit/runtime/input-events.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `tests/toolkit/runtime-interaction-region.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 118 --repo michaelblum/agent-os --json number,title,state,body,comments
gh issue view 119 --repo michaelblum/agent-os --json number,title,state,body,comments
rg -n "createDesktopWorldInteractionRouter|registerRegion\\(|route\\(|assumeInside|fromHitTarget|sourceIdentity|range-drag|context menu|outside-click|slider|input_region|createDesktopWorldHitRegionController" packages/toolkit apps/sigil tests docs
```

If `./aos ready` reports only `input_tap_not_active`, do not ask the human for
a macOS permission reset. Continue with deterministic tests and report the
runtime blocker.

## Current Evidence To Verify

#118 appears closeable if current code confirms:

- toolkit runtime exposes `createDesktopWorldInteractionRouter`;
- router tests cover logical regions, pointer capture, source locking, duplicate
  stream suppression, source identity, outside clicks, hover, unregister/cancel,
  and explicit capture release;
- Sigil context menu uses the router in `apps/sigil/context-menu/menu.js`;
- Sigil no longer uses `fromHitTarget`;
- Sigil no longer passes `assumeInside` as semantic glue; any remaining
  `assumeInside` is toolkit-only compatibility test/path;
- slider/range drag math is reusable toolkit behavior, not Sigil-only math;
- existing Sigil avatar/context-menu tests still pass or have a clear runtime
  blocker.

#119 appears closeable or foldable if current code/docs confirm:

- physical hit-target lifecycle for avatar/menu regions is toolkit-owned via
  `createDesktopWorldHitRegionController`;
- input events expose source identity and child hit-surface identity, covered by
  #120 closure;
- first-use/warm/suspend/resume lifecycle primitives are covered by #123
  closure;
- the "single mega canvas" drift question is decided: keep `avatar-main` as
  Sigil's justified private 3D/product renderer, but do not use it as the
  pattern for ordinary panels or simple desktop layers;
- remaining Sigil work belongs in #305 bounded second-client slices, not in the
  old #119 epic.

## Required Work

### 1. Add A Concise Closure Audit

Add a small active-doc audit, preferably in
`docs/design/aos-surface-stack-v0-integration-ledger.md`, that maps #118 and
#119 exit criteria to current code/tests and gives Foreman a close-or-keep-open
recommendation.

Do not rewrite historical issue comments or old work cards.

### 2. Tighten Guardrails If Needed

If active docs still suggest #118/#119 own work that has moved to #120, #122,
#123, #261, #303, #304, or #305, update the active docs. Useful guardrail
language:

- #118 owns the generic interaction-router V0 only;
- #119 is an older epic that should close once child claims are folded;
- #305 owns future Sigil-as-second-client product/platform adoption;
- `avatar-main` is allowed as Sigil's 3D/product renderer, not as a generic app
  composition pattern.

### 3. Add Focused Tests Only For Missing Cheap Coverage

Do not add tests just to make churn. Add a test only if the audit finds a cheap
missing invariant, for example:

- active Sigil source no longer contains `fromHitTarget`;
- active Sigil source does not pass `assumeInside`;
- context menu imports/uses `createDesktopWorldInteractionRouter`;
- `range-drag.js` owns range value mapping for menu sliders;
- issue ledger mentions #118/#119 closure recommendation.

Prefer extending existing focused tests over creating a new broad harness.

### 4. Leave Foreman A Direct Recommendation

Completion report must say one of:

- close #118 and #119;
- close #118 but keep #119 open with one exact remaining epic-level gap;
- keep both open with exact gaps and the next narrow card.

Do not close GitHub issues from GDI. Foreman owns issue writes.

## Verification

Minimum:

```bash
git diff --check
node --test tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/hit-target.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
```

If the audit touches context menu behavior, also run:

```bash
node --check apps/sigil/context-menu/menu.js
node --test tests/renderer/context-menu-hit-test.test.mjs
```

If `./aos ready` is clean and live input is safe, `bash
tests/sigil-avatar-interactions.sh` is useful evidence. If readiness is blocked,
report the blocker instead of improvising a permission loop.

## Hard Boundaries / Non-Goals

- Do not redesign the context menu.
- Do not remodel `avatar-main`.
- Do not move Sigil visuals to the shared DesktopWorld stage in this slice.
- Do not remove toolkit `assumeInside` compatibility unless the audit proves it
  is unused and tests remain straightforward.
- Do not add daemon product branches.
- Do not start a broad #305 migration.

## Completion Report

Include:

- files changed;
- #118 exit-criteria audit;
- #119 fold/closure audit;
- any guardrail/test additions;
- tests run and results;
- readiness result and runtime blocker, if any;
- explicit Foreman recommendation for #118 and #119.
