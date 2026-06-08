# Sigil Platform Input Region Adapter V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #305 Remodel Sigil as first-class consumer of AOS surface
  platform
- Completed prerequisite: #303 daemon generic input regions / Sigil daemon
  product-branch retirement
- Related docs:
  - `docs/design/aos-canon-surface-boundary-alignment-plan.md`
  - `docs/design/aos-surface-system.md`
  - `docs/recipes/aos-surface-interaction-decision-tree.md`
  - `docs/design/work-cards/daemon-sigil-input-path-retirement-v0.md`
  - `docs/design/work-cards/sigil-platform-stage-remodel-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make Sigil's new generic input-region usage look like a deliberate app adapter
instead of more private renderer sprawl.

The daemon product branch is retired. Sigil now registers
`sigil-avatar-main-input-region` and `sigil-context-menu-input-region` through
generic `input_region.*` messages. This slice should harden that new path,
extract it from `main.js`, test its platform boundary, and update docs so #305
can proceed from a clean first-client pattern.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/daemon-sigil-input-path-retirement-v0.md`
- `docs/design/work-cards/sigil-platform-stage-remodel-v0.md`
- `docs/api/toolkit/runtime.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 305 --json number,title,state,url,body,labels
gh issue view 303 --json number,title,state,url,body,labels
rg -n "sigil-avatar-main-input-region|sigil-context-menu-input-region|syncSigilInputRegions|currentOwnerCanvasId|inputRegionRegister|input_region" apps/sigil tests docs src packages/toolkit
./aos dev recommend --json
```

The current repo-mode runtime is expected to be blocked for live pointer smoke:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Use deterministic and isolated-daemon tests while that remains true. Do not run
real-input smoke until the safe macOS TCC reset has happened.

## Current Evidence

- `src/daemon/unified.swift` no longer contains the old Sigil product input
  state/action path.
- `apps/sigil/renderer/live-modules/host-runtime.js` exposes
  `inputRegionRegister`, `inputRegionUpdate`, and `inputRegionRemove`.
- `apps/sigil/renderer/live-modules/main.js` currently owns all Sigil input
  region frame/owner/sync logic inline.
- `currentOwnerCanvasId()` currently uses `window.__aosCanvasId || 'avatar-main'`.
  Future DesktopWorld/private-surface variants should also respect
  `window.__aosSurfaceCanvasId`, matching Sigil hit-target controllers and
  toolkit panel helpers.
- Existing child hit canvases remain app-local semantic/DOM transport surfaces.
  Do not treat them as the daemon product branch.

## Required Behavior

### Adapter Extraction

Extract the input-region logic from `apps/sigil/renderer/live-modules/main.js`
into a focused module, likely:

```text
apps/sigil/renderer/live-modules/input-regions.js
```

The module should own:

- stable region ids;
- owner canvas id selection;
- native frame comparison;
- avatar region payload creation;
- context-menu region payload creation;
- register vs update behavior;
- `NOT_FOUND` update recovery by re-registering;
- remove and remove-all cleanup;
- an inspector/debug snapshot of what it believes is registered.

Keep `main.js` responsible for Sigil product state and for calling the adapter
when avatar position, visibility, interaction state, display geometry,
context-menu bounds, suspend/resume, or hidden-frame cleanup changes.

### Owner Identity

Owner id selection must prefer:

1. `window.__aosCanvasId`;
2. `window.__aosSurfaceCanvasId`;
3. the explicit configured/fallback Sigil canvas id, usually `avatar-main`.

Do not hard-code `avatar-main` as the only owner when the runtime has injected a
surface id.

### Region Semantics

Preserve the behavior from the completed #303 slice:

- avatar region appears only for the primary segment, visible avatar, valid
  avatar position, and states that need native capture (`IDLE`, `PRESS`,
  `RADIAL`, `FAST_TRAVEL`);
- context-menu region appears only while the context menu is open and has valid
  native bounds;
- context-menu priority remains higher than avatar priority;
- both regions use `coordinate_space: "native"` and `consume_policy:
  "captured"`;
- both regions set app/surface/purpose metadata for Surface Inspector;
- both regions remove on owner suspend and explicit hidden/removed cleanup.

### Tests

Add focused renderer tests for the adapter. Prefer pure Node tests with a fake
host runtime, fake window object, and simple frame/projector functions.

Cover at least:

- owner id falls back from `__aosCanvasId` to `__aosSurfaceCanvasId` to
  configured fallback;
- avatar region registers with the expected payload and does not repeat
  redundant updates;
- frame or enabled-state changes update/remove as appropriate;
- context-menu region has higher priority and expected metadata;
- update `NOT_FOUND` triggers a register retry;
- cleanup removes both known regions;
- non-primary segments do not register regions.

### Observability

If `window.__sigilDebug.snapshot()` already has a natural home for this, include
input-region adapter state there:

- region ids;
- whether each is believed registered;
- current owner id;
- last native frame or null.

Keep the debug shape small. This is for Foreman/Operator diagnosis, not a new UI.

### Docs

Update docs only where state changes:

- `apps/sigil/AGENTS.md` should point future agents to the adapter module and
  reiterate that Sigil policy uses generic input regions.
- `docs/design/aos-canon-surface-boundary-alignment-plan.md` should no longer
  say "Do not start Sigil migration yet" as the current posture. It should say
  the first #305 migration work has started with the input-region adapter, while
  the broad visual/stage remodel remains deferred.
- `docs/design/aos-surface-system.md` should stay accurate if the extraction
  changes the remaining app-local glue explanation.

## Scope

Primary ownership is Sigil app glue plus renderer tests. Toolkit and daemon
changes are out of scope unless fresh inspection finds a small generic helper is
needed for this adapter.

## Hard Boundaries / Non-Goals

- Do not start a wholesale Sigil renderer rewrite.
- Do not move `avatar-main` to the shared DesktopWorld stage in this slice.
- Do not remove Sigil's Three.js renderer.
- Do not remove or passivate the child hit canvases in this slice unless it is
  an obvious mechanical consequence with strong tests. Their retirement can be
  a later #305 slice after live input is available.
- Do not add any new daemon product-named input branches.
- Do not run live pointer smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

Inspect before editing:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/host-runtime.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/context-menu/menu.js`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/sigil-avatar-interactions.sh`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `apps/sigil/AGENTS.md`

## Verification

Run focused checks:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/renderer/hit-target.test.mjs tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs tests/toolkit/runtime-input-region.test.mjs
bash tests/daemon-input-surface-ownership.sh
```

If the extraction touches broader Sigil module imports, also run:

```bash
node --test tests/renderer/*.test.mjs
```

If isolated daemon smoke is already stable and not too expensive, rerun the
non-real-input Sigil smoke:

```bash
bash tests/sigil-avatar-interactions.sh
```

If `./aos ready` passes after the safe TCC reset, perform the bounded live smoke
from the previous card. If readiness remains blocked, report the exact blocker.

## Completion Report

Include:

- files changed;
- adapter module API and why it is the right Sigil/platform boundary;
- owner-id behavior, including `__aosSurfaceCanvasId`;
- debug/inspector visibility added, if any;
- whether child hit canvases were retained;
- tests run with exact pass/fail result;
- `./aos ready` result or known TCC blocker;
- recommended next #305 slice after this extraction.
