# Surface Stack V0 Integration Closure

## Tracker

- Epic: #223 AOS Surface System
- Primary issues to reconcile: #304, #303, #122, #120, #123, #261, #305
- Historical/overlap issues to audit: #118, #119, #45
- Related planning doc:
  `docs/design/aos-canon-surface-boundary-alignment-plan.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, GitHub issue, or runtime readiness state. Read and rediscover before
editing. The worktree is expected to be substantially dirty from the surface
stack workstream; do not revert unrelated changes.

## Goal

Turn the completed surface-stack implementation and live-smoke evidence into a
durable integration checkpoint. This is a closure/reconciliation slice, not a
new feature slice.

The key new evidence is that the Surface Inspector stage-chip path passed a
real-pointer, cross-owner shared-stage smoke after the `canvas.info` readiness
correction:

- `./aos ready` reported `ready=true mode=repo daemon=reachable tap=active`;
- `aos-desktop-world-stage` was present before minimize and was owned by
  `__log__`, exercising the cross-owner shared-readiness case;
- minimize used the stage path with `stageEnsureStatus.status: "already_exists"`;
- the controller sent the stage-layer upsert and registered body, restore, and
  close input regions;
- no `aos-chip-*` WebView fallback appeared in the default path;
- no `FORBIDDEN ... may not eval aos-desktop-world-stage` or
  `ready_check_failed` evidence appeared;
- measured hot-path timing was prompt:
  - real pointer click start: `1778589123.978`;
  - region registrations: `1778589124.545`, `.548`, `.552`;
  - source suspended: `1778589124.648`;
  - controller timing: `stageEnsureDurationMs: 0`,
    `inputRegionRegistrationDurationMs: 9`,
    `sourceSuspendDurationMs: 167`, `totalElapsedMs: 178`;
- restore and close through chip regions removed the chip layer and all three
  regions;
- duplicate minimize produced one layer/region set, not duplicates;
- final cleanup had no `surface-inspector`, no `aos-chip-*`, and the shared
  DesktopWorld stage remained active with `layers: []`.

## Read First

- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
- `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`
- `docs/design/work-cards/toolkit-surface-interaction-decision-tree-v0.md`
- `docs/design/work-cards/toolkit-panel-window-normalization-v0.md`
- `docs/design/work-cards/canvas-lifecycle-warm-suspend-resume-contract-v0.md`
- `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`
- `docs/design/work-cards/daemon-sigil-input-path-retirement-v0.md`
- `docs/design/work-cards/sigil-platform-input-region-adapter-v0.md`
- `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`
- `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md`
- `docs/design/work-cards/toolkit-child-hit-surface-source-identity-v0.md`
- `docs/design/work-cards/toolkit-child-hit-surface-normalization-gate-correction-v0.md`
- `docs/design/work-cards/toolkit-stage-chip-shared-readiness-and-fallback-cleanup-v0.md`
- `docs/design/work-cards/operator-stage-chip-latency-live-smoke-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "#304|#303|#305|#122|#120|#123|#261|#119|#118|#45|live pointer smoke|TCC reset|fallback WebView|StageAffordance|Surface Stack|Surface System" docs/design docs/recipes docs/api apps/sigil packages/toolkit AGENTS.md
```

If `./aos ready` reports only `input_tap_not_active`, do not ask the human for
a macOS permission reset. Report it as a runtime readiness blocker and continue
with docs-only work. Use live AOS checks only if readiness is clean.

## Required Work

### 1. Update The Decision Tree

Update `docs/recipes/aos-surface-interaction-decision-tree.md` so it no longer
says #304 is waiting for live pointer smoke.

Required framing:

- default minimized chips are accepted V0: stage-backed, input-region-backed,
  prompt under real pointer smoke, with duplicate/restore/close cleanup proven;
- the explicit WebView minimized-chip path is a fallback only, not the default;
- fallback cleanup has been hardened for timeout races, but fallback retirement
  is a future confidence/telemetry decision;
- Surface Inspector visibility for stage layers/input regions/affordances is
  now in place, not merely a future next slice;
- daemon input regions, input identity, lifecycle warm/suspend/resume, and
  retired Sigil daemon product paths should be described as V0 baselines rather
  than pending conceptual work.

### 2. Update The Alignment Plan

Update `docs/design/aos-canon-surface-boundary-alignment-plan.md` from "routing
plan" language into current V0 integration state.

At minimum:

- Step 1 should say #304 stage-backed minimized chips have live real-pointer
  proof after the shared-readiness correction;
- Step 2 should say #303's product-branch exit criterion is satisfied unless
  GitHub issue review finds a narrower remaining contract gap;
- Steps 3-8 should record which V0 primitives now exist:
  `createResourceScope`, `createStageAffordance`,
  `createPanelWindowController`, Surface Inspector resource visibility,
  `warmCanvas`/`waitForCanvasReady`, `canvas.info`, input-event identity, and
  child hit-surface identity;
- Step 9 should keep Sigil broad remodel deferred while acknowledging bounded
  #305 work already landed: input-region adapter, toolkit DesktopWorld
  hit-region controller, avatar/radial physical lifecycle migration, and child
  source identity cleanup;
- Current Work Routing should point to issue/PR closure and Sigil second-client
  planning, not old already-completed Implementer slices.

### 3. Add A Surface Stack V0 Integration Ledger

Create `docs/design/aos-surface-stack-v0-integration-ledger.md`.

The ledger should be concise and useful to a fresh Foreman/Implementer/Operator
session. Include:

- completed slices by tracker issue and work card;
- verification evidence available from completion reports;
- issue disposition recommendation for each tracked issue:
  - #304: close or mark accepted V0 after Foreman GitHub review;
  - #303: close if issue scope was daemon product-branch/input-region baseline,
    otherwise restate exact remaining contract gap;
  - #122: keep open only for StageAffordance/general visual-hit follow-up, or
    close if the issue text matches completed V0;
  - #120: restate remaining identity work, especially any non-Sigil callers or
    `assumeInside` compatibility retirement;
  - #123: restate any lifecycle gaps beyond warm/suspend/resume V0;
  - #261: restate remaining private panel/window migrations;
  - #305: close as accepted V0 after final topology-neutral DesktopWorld radial
    proof, with future Sigil work routed through exact follow-up cards instead
    of a broad remodel umbrella;
  - #118/#119: fold or close after mapping their remaining claims;
  - #45: keep parked as historical/native chrome unless a new native-chrome
    strategy is explicitly chosen;
- next implementation recommendation:
  Sigil Stage/Surface Second Client V0 after issue/docs closure, not before.

Do not claim GitHub issues are closed unless Foreman actually closes them.
Phrase issue actions as recommendations for Foreman.

### 4. Sweep Stale "Pending Smoke" Language

Find and update stale references that still say the stage-chip V0 proof is
pending TCC/live smoke. Keep historical work-card reports intact when they are
clearly describing the state at that moment, but update active planning docs,
recipes, API docs, and AGENTS guidance.

Do not rewrite large historical work cards just to change tense. Prefer a
current ledger and active docs.

### 5. Do Not Start A New Feature

Do not implement Sigil migration, fallback removal, new daemon primitives, or
new Surface Inspector UI in this slice. The point is to make the repo's source
of truth match the work that already landed.

## Optional GitHub Reconnaissance

If GitHub access is available and cheap, inspect issue titles/bodies/comments
for #304, #303, #122, #120, #123, #261, #305, #118, #119, and #45. Do not close
or edit issues from Implementer unless Foreman explicitly asks. Instead, include exact
recommended issue actions in the completion report.

## Verification

Minimum:

```bash
git diff --check
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
node --test tests/toolkit/toolkit-api-docs-contract.test.mjs
```

If the docs-contract tests do not cover the new ledger, add focused contract
coverage that proves:

- the integration ledger exists;
- it mentions the accepted #304 real-pointer stage-chip proof;
- it lists issue disposition recommendations for the tracked issues;
- the decision tree no longer frames #304 as pending live smoke.

Run broader tests only if `./aos dev recommend --json` points to them for the
files changed.

## Completion Report

Include:

- files changed;
- stale language removed;
- new ledger sections;
- issue disposition recommendations;
- tests run and results;
- readiness result and whether any runtime blocker was observed;
- recommended next card after closure.
