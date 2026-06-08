# Toolkit DesktopWorld Hit Region Controller V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #122 Toolkit-owned DesktopWorld hit-region controller
- Parent issue: #119 DesktopWorld interaction surfaces and warmed UI primitives
- Related issues:
  - #305 Remodel Sigil as first-class consumer of AOS surface platform
  - #303 Daemon generic input regions
  - #120 Pointer source identity
- Related docs:
  - `docs/design/aos-canon-surface-boundary-alignment-plan.md`
  - `docs/design/aos-surface-system.md`
  - `docs/recipes/aos-surface-interaction-decision-tree.md`
  - `docs/design/work-cards/sigil-platform-input-region-adapter-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create the first toolkit-owned DesktopWorld hit-region controller and migrate
one Sigil child hit surface onto it.

Sigil now uses generic daemon input regions for native consumption, but it still
directly owns physical child canvases such as `radial-menu-surface.html` and the
avatar hit target. This slice should extract the reusable part of that pattern
into toolkit runtime, then rebuild the Sigil radial menu target surface as a
thin product mapper over the toolkit helper. Leave the avatar hit target for a
later slice unless the extraction makes it mechanically trivial and well tested.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/sigil-platform-input-region-adapter-v0.md`
- `docs/api/toolkit/runtime.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 119 --json number,title,state,url,body,labels
gh issue view 305 --json number,title,state,url,body,labels
rg -n "createRadialMenuTargetSurface|radial-menu-surface|createInteractionSurface|createDesktopWorldInteractionRouter|fromHitTarget|assumeInside|inputRegions" apps/sigil packages/toolkit tests docs
./aos dev recommend --json
```

The current repo-mode runtime may be blocked for live pointer smoke:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Use deterministic tests while that remains true. Do not run real-input smoke
without an explicit idle keyboard/mouse handoff.

## Current Evidence

- `packages/toolkit/runtime/interaction-surface.js` already owns generic child
  canvas lifecycle, frame updates, interactivity, offscreen disable, and remove.
- `packages/toolkit/runtime/interaction-region.js` already owns logical
  pointer-capture routing for DesktopWorld events.
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` owns a
  reusable-looking pattern:
  - derives semantic targets from logical DesktopWorld items;
  - computes a combined DesktopWorld rect;
  - converts it to native frame with display geometry;
  - creates/updates a child interaction surface;
  - posts localized target geometry to that child surface.
- `apps/sigil/renderer/radial-menu-surface.html` is currently Sigil-specific
  child HTML for DOM/semantic target transport.
- `apps/sigil/renderer/live-modules/hit-target.js` still owns the avatar child
  hit canvas. That is related but not required for this first toolkit slice.

## Required Behavior

### Toolkit Helper

Add a small toolkit runtime helper for DesktopWorld hit-region surfaces. The
exact module name may change after inspection, but prefer something like:

```text
packages/toolkit/runtime/desktop-world-hit-region.js
```

The helper should own the reusable mechanics:

- owner canvas id selection from `__aosCanvasId`, `__aosSurfaceCanvasId`, or an
  explicit fallback;
- offscreen initial frame;
- creating/updating/removing a child interaction surface via
  `createInteractionSurface`;
- converting DesktopWorld rects to native frames using display geometry;
- avoiding redundant frame/interactivity updates;
- posting structured region/target updates to the child canvas;
- exposing a small `snapshot()`.

Do not make the helper depend on Sigil names, radial-menu actions, or avatar
state. Product mapping belongs in Sigil.

### First Consumer: Sigil Radial Menu Target Surface

Rebuild `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` on the
toolkit helper while preserving the public API used by `main.js`:

- `createRadialMenuTargetSurface(...)`;
- `radialMenuTargetsFromSnapshot(...)`;
- `radialMenuWorldRect(...)`;
- returned methods `ensureCreated`, `sync`, `disable`, `remove`, `snapshot`;
- existing payload shape sent to `radial-menu-surface.html`.

The Sigil module should keep product mapping:

- item label/action mapping;
- radial item semantic ids/aos refs;
- active item mapping;
- Sigil-specific URL selection.

The toolkit helper should handle physical child-surface placement and lifecycle.

### Tests

Add focused toolkit runtime tests for the new helper:

- owner id selection honors canvas id, surface id, and fallback;
- first sync creates or updates the child surface with native frame and
  interactivity;
- redundant sync does not update;
- disable moves offscreen and marks non-interactive;
- remove delegates to the child surface and clears state;
- target update payload is posted only when it changes.

Preserve or update existing Sigil radial tests:

- `tests/renderer/radial-menu-target-surface.test.mjs` should continue proving
  radial target semantics and the public Sigil wrapper behavior.
- Do not weaken semantic target assertions.

### Docs

Update only the boundaries that changed:

- `docs/api/toolkit/runtime.md` should document the new helper in the runtime
  input/surface section.
- `apps/sigil/AGENTS.md` should say radial menu hit-surface lifecycle now uses
  toolkit DesktopWorld hit-region controller mechanics, while Sigil still owns
  radial item product mapping.
- `docs/design/aos-surface-system.md` or the alignment plan should mention this
  as the first #122 toolkit extraction if useful.

## Scope

Primary ownership is toolkit runtime plus one Sigil wrapper migration. This is
not a daemon slice.

## Hard Boundaries / Non-Goals

- Do not remove the avatar child hit target in this slice unless it becomes an
  obvious mechanical follow-up with focused tests.
- Do not remove `radial-menu-surface.html` unless a generic toolkit child HTML
  page is introduced and all existing radial semantic behavior is preserved.
- Do not move Sigil's radial visuals onto the shared DesktopWorld stage.
- Do not change daemon input-region schemas or input-event v2.
- Do not run live pointer smoke while repo-mode TCC is blocked.
- Do not make toolkit depend on Sigil content roots.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/runtime/interaction-surface.js`
- `packages/toolkit/runtime/interaction-region.js`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/runtime/index.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/radial-menu-surface.html`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/toolkit/runtime-interaction-region.test.mjs`
- `tests/toolkit/runtime-input-region.test.mjs`

## Verification

Run focused deterministic tests:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/radial-menu-target-surface.js
node --test tests/toolkit/runtime-desktop-world-hit-region.test.mjs
node --test tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
```

If toolkit runtime exports or docs change, also run:

```bash
node --test tests/toolkit/*.test.mjs
node --test tests/toolkit/toolkit-api-docs-contract.test.mjs
```

If Sigil imports or shared renderer behavior change more broadly, run:

```bash
node --test tests/renderer/*.test.mjs
```

If isolated daemon smoke is available and not blocked, run:

```bash
bash tests/sigil-avatar-interactions.sh
```

For live pointer smoke, report the readiness state. Do not use real mouse input
without explicit user/operator handoff.

## Completion Report

Include:

- files changed;
- toolkit helper API and why it is generic rather than Sigil-specific;
- how the Sigil radial wrapper changed;
- whether the child HTML page was retained or replaced;
- tests run with exact pass/fail results;
- `./aos ready` result or known TCC blocker;
- recommended next #122/#305 slice, especially whether avatar hit-target
  migration is now low-risk.
