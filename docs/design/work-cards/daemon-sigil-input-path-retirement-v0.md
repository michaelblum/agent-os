# Daemon Sigil Input Path Retirement V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #303 Daemon generic input regions for DesktopWorld-bound hit
  areas
- Related issue: #305 Remodel Sigil as first-class consumer of AOS surface
  platform
- Related contracts:
  - `docs/design/aos-canon-surface-boundary-alignment-plan.md`
  - `docs/design/aos-surface-system.md`
  - `docs/recipes/aos-surface-interaction-decision-tree.md`
  - `docs/adr/0011-host-neutral-surfaces-use-capability-bounded-hosts.md`
- Prior cards:
  - `docs/design/work-cards/daemon-generic-input-region-contract-v0.md`
  - `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`
  - `docs/design/work-cards/input-event-v2-version-truth-correction-v0.md`
  - `docs/design/work-cards/canvas-lifecycle-warm-suspend-resume-contract-v0.md`
  - `docs/design/work-cards/sigil-platform-stage-remodel-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Retire the default daemon path that understands Sigil product nouns.

The generic `input_region.*` primitive now exists, routed input identity is
versioned, and lifecycle cleanup is explicit. The remaining #303 exit criterion
is that Sigil-specific daemon input handling is removed or wrapped behind the
generic contract. Make that true without starting the broad #305 Sigil platform
remodel.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/api/toolkit/runtime.md`
- `shared/schemas/daemon-event.md`
- `shared/schemas/input-event-v2.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 303 --json number,title,state,url,body,labels
gh issue view 305 --json number,title,state,url,body,labels
./aos dev recommend --json
rg -n "sigil_input_mode|SigilInputState|shouldConsumeSigilInputEvent|isPointOnSigilAvatar|updateSigilCanvasState|fromHitTarget|assumeInside|input_region|registerInputRegion" src apps/sigil packages/toolkit tests docs
```

The current repo-mode runtime is expected to be blocked for live pointer smoke:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Use deterministic tests and isolated daemon tests while that remains true. Do
not run interactive live smoke until the safe TCC reset has happened.

## Current Evidence

- `src/daemon/unified.swift` still contains `SigilInputState`,
  `sigil_input_mode`, `updateSigilCanvasState`,
  `shouldConsumeSigilInputEvent`, and `isPointOnSigilAvatar`.
- The same file still tracks product-named canvas ids such as `avatar` and
  `agent-chat` for input consumption.
- Current app search did not show Sigil calling `sigil_input_mode`; verify this
  before deleting it.
- Generic daemon input regions now support register/update/remove, priority,
  owner cleanup, consume policies, capture identity, snapshots, and
  `input_region.event` delivery.
- Sigil's current `hit-area.html` and radial target surface are still useful
  app-managed child canvases for semantic targets and DOM event bridging. They
  are not the daemon product branch being retired in this slice.

## Required Behavior

### Daemon Boundary

The daemon must not have a default input-consumption state machine named for
Sigil, avatar, chat, or any other app surface.

Remove the product-named branch if it is unused:

- remove `SigilInputState`;
- remove the `sigil_input_mode` action;
- remove `updateSigilCanvasState`;
- remove `shouldConsumeSigilInputEvent`;
- remove `isPointOnSigilAvatar`;
- remove the Sigil-specific call from `handleInputEvent`.

If fresh inspection proves an external compatibility path still depends on
`sigil_input_mode`, keep only a tiny compatibility wrapper that forwards to a
generic input-region mechanism or returns a documented deprecation response.
Do not keep default behavior that consumes events based on `avatar` or
`agent-chat` canvas ids.

### Sigil Ownership

Sigil should own its product policy by registering generic input regions for the
native areas it needs the daemon to consume.

At minimum, preserve current behavior for:

- visible avatar down/right-click targeting;
- captured avatar drag/release gestures while radial or fast-travel interaction
  is active;
- context-menu interactive bounds while the menu is open;
- region cleanup when `avatar-main` is removed or suspended.

Likely V0 shape:

- add a Sigil renderer controller for avatar/context-menu input regions;
- use the existing Sigil `host.request(...)` bridge or add small
  `inputRegionRegister`, `inputRegionUpdate`, and `inputRegionRemove` helpers
  to `apps/sigil/renderer/live-modules/host-runtime.js`;
- register regions with `owner_canvas_id` set to the owning Sigil canvas
  (`window.__aosCanvasId`, `window.__aosSurfaceCanvasId`, or `avatar-main` as
  appropriate);
- use native frames because the daemon region registry routes native event
  coordinates;
- use a consume policy that preserves capture semantics, likely `captured`;
- use explicit ids such as `sigil-avatar-main-input-region` and metadata such
  as app/surface/purpose so Surface Inspector can explain the resource.

Do not import `packages/toolkit/runtime/input-region.js` blindly into Sigil
without checking bridge ownership. Sigil currently installs its own
`window.headsup.receive` through `host-runtime.js`, and the toolkit bridge
helper returns early when a receiver already exists.

### Event Delivery

Sigil may continue to process raw `input_event` fanout for behavior in this V0.
The input region is allowed to exist primarily as the daemon-native consumption
claim. If consuming `input_region.event` simplifies the app path and can be
tested, do it; otherwise record why raw fanout remains the behavior source.

Do not reintroduce boolean folklore such as `fromHitTarget` as a daemon
contract. Existing app-local echo suppression may remain if it is still needed
for child WebView event bridging.

### Existing Hit Surfaces

Keep the current Sigil hit-target child canvases unless you can remove or
passivate them with focused tests that preserve:

- avatar semantic target discoverability;
- right-click/context-menu behavior;
- radial target selection;
- current deterministic renderer tests.

Removing the WebView hit target entirely is acceptable only if the slice stays
bounded and evidence is strong. It is not required for #303.

### Docs And Status

Update the surface docs so the state is no longer contradictory:

- `docs/recipes/aos-surface-interaction-decision-tree.md` should stop saying
  the daemon still has live Sigil-specific input paths once the code is gone.
- `docs/design/aos-surface-system.md` should distinguish any remaining
  app-local Sigil glue from daemon product branches.
- `apps/sigil/AGENTS.md` should tell future agents that Sigil input claims use
  generic daemon input regions, not daemon product hooks.
- If #303 is not fully closable after this slice, state the exact remaining
  gap.

## Scope

Primary ownership crosses daemon/native primitive and Sigil app glue. Toolkit
runtime changes are allowed only if they expose a small generic helper needed by
Sigil without disturbing existing panel/window or StageAffordance behavior.

## Hard Boundaries / Non-Goals

- Do not start the full #305 Sigil platform-stage remodel.
- Do not move Sigil visuals to the shared DesktopWorld stage in this slice.
- Do not remove Sigil's Three.js `avatar-main` renderer.
- Do not invent a daemon window manager.
- Do not add new daemon branches named for Sigil, avatar, chat, radial menu, or
  context menu.
- Do not change the input-event v2 schema unless fresh evidence proves the
  current routed identity cannot represent this case.
- Do not run live pointer smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

Inspect before editing:

- `src/daemon/unified.swift` - product-named input state and generic
  input-region routing.
- `src/daemon/input-surface-ownership.swift` - input-region capture and consume
  policy semantics.
- `apps/sigil/renderer/live-modules/main.js` - avatar state machine, hit target
  sync, input handling, context menu bounds.
- `apps/sigil/renderer/live-modules/host-runtime.js` - Sigil bridge request
  helper.
- `apps/sigil/renderer/live-modules/hit-target.js` - current child hit surface.
- `apps/sigil/renderer/hit-area.html` - current semantic/DOM bridge surface.
- `apps/sigil/context-menu/menu.js` - context-menu interaction bounds and
  app-local `assumeInside` usage.
- `packages/toolkit/runtime/input-region.js` - generic API precedent.
- `packages/toolkit/runtime/input-events.js` - `input_region.event`
  normalization.
- `tests/daemon-input-surface-ownership.sh` - daemon generic region contract.
- `tests/renderer/hit-target.test.mjs` - current hit-target expectations.
- `tests/sigil-avatar-interactions.sh`,
  `tests/sigil-hit-target-drag-fast-travel.sh`, and
  `tests/sigil-context-menu-real-input.sh` - live smoke references. Treat as
  optional while TCC is blocked.

## Verification

Run focused deterministic tests:

```bash
git diff --check
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/renderer/hit-target.test.mjs
bash tests/daemon-input-surface-ownership.sh
```

Add or update a focused deterministic test that proves daemon Sigil product
input state is gone or explicitly compatibility-wrapped. A simple source guard
is acceptable if paired with behavior tests for the generic region path.

If Sigil renderer modules change, run the affected renderer tests. If Swift
changes, run the router and build:

```bash
./aos dev recommend --json
./aos dev build --force
```

If `./aos ready` passes after the safe TCC reset, run a bounded live smoke:

1. launch Sigil;
2. verify avatar click/right-click/context-menu still works;
3. verify a drag/radial gesture still starts, captures, and releases;
4. verify Surface Inspector or daemon snapshot shows Sigil-owned input regions
   and no stale region remains after Sigil removal.

If readiness is blocked by the known repo-mode TCC issue, report that exact
blocker and do not fake live evidence.

## Completion Report

Include:

- files changed;
- whether the daemon product-named input branch was removed or compatibility
  wrapped;
- how Sigil now registers/updates/removes generic input regions;
- whether current hit-target child canvases were retained, passivated, or
  removed;
- tests run with exact pass/fail results;
- `./aos ready` result or the known TCC blocker;
- whether #303 is now closable, or the exact remaining gap.
