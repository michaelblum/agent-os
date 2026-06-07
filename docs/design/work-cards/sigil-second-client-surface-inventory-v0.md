# Sigil Second-Client Surface Inventory V0

## Tracker

- Epic: #223 AOS Surface System
- Issue: #305 Remodel Sigil as first-class consumer of AOS surface platform
- Closure ledger: `docs/design/aos-surface-stack-v0-integration-ledger.md`
- Boundary plan: `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- Older umbrella card to reconcile: `docs/design/work-cards/sigil-platform-stage-remodel-v0.md`

## Fresh Context Reset

Treat #304, #303, #122, #120, #123, #261, #118, and #119 as accepted or folded
V0 unless fresh evidence contradicts the ledger. Do not reopen broad primitive
debates in this slice. The current open question is narrower: after the accepted
surface primitives, what remains in Sigil that is still private platform
behavior rather than app product expression?

## Goal

Turn #305 from a broad remodel idea into a precise second-client status map.
Audit the active Sigil surfaces, classify each platform boundary, and implement
one safe remaining migration if the audit finds an obvious live private path.
If no safe implementation slice remains, update the docs so #305 has exact
remaining gaps or a clear close recommendation.

## Read First

- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/work-cards/sigil-platform-stage-remodel-v0.md`
- `apps/sigil/AGENTS.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/panel-window.md`

## Inspect

At minimum inspect these live or historical Sigil surfaces:

- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/agent-terminal/`
- `apps/sigil/codex-terminal/`
- `apps/sigil/radial-item-editor/`
- `apps/sigil/radial-item-workbench/`
- `apps/sigil/workbench/`
- `apps/sigil/chat/`

Use these rediscovery commands and add any more that are useful:

```bash
rg -n "aos-chip|panel/minimized-chip|spawnChild|suspendCanvas|resumeCanvas|drag_start|move_abs|drag_end|fromHitTarget|assumeInside" apps/sigil
rg -n "input_region|canvas\\.create|createPanelWindowController|mountChrome|createDesktopWorldHitRegionController|createDesktopWorldInteractionRouter|warmCanvas|waitForCanvas" apps/sigil
rg -n "avatar-main|DesktopWorld|desktop_world|canvas_lifecycle|display_geometry" apps/sigil
```

## Classification Rules

Classify each surface as exactly one primary bucket, with a short rationale:

- **Product expression**: Sigil-owned avatar identity, 3D renderer, effects,
  state machine, radial semantics, agent personality, or app-specific content.
- **Platform consumer**: already using daemon/toolkit primitives correctly,
  such as generic input regions, panel/window controller, interaction router,
  hit-region controller, or shared lifecycle helpers.
- **Transitional private path**: live code still owns platform-like behavior
  that should move to toolkit/daemon or consume an existing primitive.
- **Parked legacy**: old chat, workbench, or compatibility paths that
  should not be migrated unless a new product decision revives them.

Be strict about the boundary. `avatar-main` may remain a private full-coverage
DesktopWorld canvas only for the distinct Three.js/product renderer lifecycle;
it is not a precedent for ordinary panels, chips, menus, or simple global
visual layers.

## Implementation Scope

If the audit finds one obvious live transitional private path, implement that
single migration in this slice. Good candidates are small paths that replace
app-owned windowing, lifecycle, hit-region, or input plumbing with an existing
daemon/toolkit primitive.

If the only remaining transitional paths are historical/parked surfaces or
would require a new primitive, do not force an implementation. Instead, update
the durable plan so #305 has either:

- a close recommendation with evidence, or
- a short list of exact follow-up issues/work cards.

## Required Updates

- Update `docs/design/aos-surface-stack-v0-integration-ledger.md` with a #305
  second-client inventory section.
- Update `docs/design/aos-canon-surface-boundary-alignment-plan.md` if the
  active routing or issue map changes.
- Update `docs/design/work-cards/sigil-platform-stage-remodel-v0.md` so it no
  longer reads as an untouched broad card if its slices are now completed,
  superseded, or narrowed.
- Update `apps/sigil/AGENTS.md` only if the audit reveals stale guidance.
- Add or update focused tests only for code behavior changed in this slice.

## Hard Boundaries

- No wholesale Sigil rewrite.
- No removal of the 3D avatar renderer unless a shared 3D stage already
  satisfies the same product needs.
- No new daemon product branches named for Sigil, avatar, radial, menu, chat, or
  context menu.
- No migration of parked legacy chat/workbench surfaces unless the audit
  proves they are still active product paths.
- No broad visual redesign.
- Do not treat `apps/sigil` grep hits inside historical acceptance docs as live
  regressions without checking the active path.

## Verification

Always run:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --test tests/renderer/sigil-panel-window-migration.test.mjs
node --test tests/renderer/hit-target.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/runtime-desktop-world-hit-region.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
```

If code changes touch real pointer routing and `./aos ready` reports
`ready=true`, also run:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If readiness is blocked, report the exact `./aos ready` diagnosis and do not run
ad hoc permission loops.

## Completion Report

Report:

- the surface inventory by bucket;
- any implementation slice completed, with paths changed;
- whether #305 should remain open, close, or split into exact follow-ups;
- verification commands and results;
- any runtime readiness blocker.
