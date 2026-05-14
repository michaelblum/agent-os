# Sigil Avatar Hit Target Toolkit Controller V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #122 Toolkit-owned DesktopWorld hit-region controller
- Parent issue: #119 DesktopWorld interaction surfaces and warmed UI primitives
- Related issues:
  - #305 Remodel Sigil as first-class consumer of AOS surface platform
  - #120 Pointer source identity
  - #303 Daemon generic input regions
- Prerequisite work cards:
  - `docs/design/work-cards/sigil-platform-input-region-adapter-v0.md`
  - `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Move Sigil's avatar child hit target onto the toolkit
`createDesktopWorldHitRegionController` without changing Sigil behavior.

The radial menu target surface now uses the toolkit DesktopWorld hit-region
controller. The remaining physical child hit canvas owned directly by Sigil is
`apps/sigil/renderer/live-modules/hit-target.js`, backed by
`renderer/hit-area.html`. This slice should make the avatar hit target the
second consumer of the same toolkit controller and leave the DOM echo/source
identity cleanup for the next #120/#122 slice.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`
- `docs/api/toolkit/runtime.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 119 --json number,title,state,url,body,labels
gh issue view 305 --json number,title,state,url,body,labels
rg -n "createHitTargetController|hitTarget\\.sync|hitTarget\\.syncFrame|pointFromHitPayload|fromHitTarget|sigil-hit|createDesktopWorldHitRegionController|radial-menu-surface" apps/sigil packages/toolkit tests docs
./aos dev recommend --json
```

Repo-mode readiness may be blocked by macOS TCC:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Use deterministic tests while that remains true. Do not run real mouse-input
smoke without an explicit idle keyboard/mouse handoff.

## Current Evidence

- `packages/toolkit/runtime/desktop-world-hit-region.js` now owns generic
  child surface mechanics: owner selection, offscreen create, DesktopWorld to
  native placement, deduped updates, disable/remove, child payload posting, and
  snapshots.
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js` is already
  rebuilt on that helper.
- `apps/sigil/renderer/live-modules/hit-target.js` still imports
  `createInteractionSurface` directly and owns physical child canvas create,
  frame sync, offscreen disable, and remove.
- `apps/sigil/renderer/hit-area.html` remains the Sigil-specific child page
  that exposes avatar semantics and forwards DOM-origin events back to
  `avatar-main`.
- `apps/sigil/renderer/live-modules/main.js` currently calls:
  - `hitTarget.sync(nativeAvatarPos, interactive)` for avatar placement;
  - `hitTarget.syncFrame(nativeFrame, true)` for context-menu bounds;
  - `hitTarget.sync(..., false)` for hide/offscreen.

## Required Behavior

### Toolkit Controller Adoption

Rebuild `createHitTargetController` on
`createDesktopWorldHitRegionController`.

Preserve its role as a Sigil product adapter:

- stable default id prefix `sigil-hit`;
- default explicit id `sigil-hit-avatar-main` from `main.js`;
- URL selection for `renderer/hit-area.html`;
- query params `parent` and `id` reaching the child page;
- size bookkeeping for avatar hit radius;
- public snapshot shape used by `window.__sigilDebug.snapshot()`.

The toolkit controller should own physical mechanics:

- parent/owner id selection, including `__aosCanvasId` and
  `__aosSurfaceCanvasId`;
- child canvas create/remove;
- offscreen disable;
- DesktopWorld-to-native frame conversion;
- deduped placement/interactivity updates.

### Main Renderer Integration

Prefer passing logical DesktopWorld geometry into the hit target instead of
pre-converting everything to native coordinates in `main.js`.

Acceptable implementation shape:

- add methods such as `syncWorldRect(worldRect, interactive, { displays })` or
  `syncWorldCenter(center, interactive, { displays })`;
- update `syncHitTargetToAvatar()` to use `liveJs.avatarPos`,
  `state.avatarHitRadius`, and `liveJs.displays`;
- update the context-menu path to pass `contextMenu.interactiveBounds()` with
  `liveJs.displays`;
- keep `syncFrame(frame, interactive)` only as a compatibility wrapper if tests
  or adjacent code still need it.

After the migration, Sigil should not directly own child canvas frame mutation
inside `hit-target.js`. It may still own semantic/DOM payload interpretation in
`hit-area.html` and `handleHitCanvasEvent`.

### Behavior To Preserve

Preserve current behavior:

- avatar child page is created offscreen and becomes interactive when the
  avatar is visible in `IDLE`, `PRESS`, `RADIAL`, or `FAST_TRAVEL`;
- context-menu bounds can temporarily drive the hit target while the menu is
  open;
- hiding/parking/suspend moves the child offscreen and non-interactive;
- duplicate frame sync does not emit redundant canvas updates;
- `pointFromHitPayload()` still resolves hit-canvas offsets into DesktopWorld
  points using the current native frame;
- `window.__sigilDebug.snapshot()` still reports hit target id, ready state,
  frame, and interactivity.

### Tests

Update `tests/renderer/hit-target.test.mjs` to cover the new boundary:

- default create uses the toolkit controller path and still creates an
  offscreen child with `window_level: "screen_saver"`;
- owner id prefers `__aosCanvasId`, then `__aosSurfaceCanvasId`, then
  `avatar-main`;
- avatar DesktopWorld center/rect sync produces the expected native frame for
  no-display and offset-display inputs;
- redundant sync is skipped;
- disabling moves offscreen and non-interactive;
- `remove()` delegates and clears ready/interactivity state;
- `hit-area.html` semantic assertions remain intact.

Add toolkit helper tests only if the avatar migration exposes a missing generic
capability in `desktop-world-hit-region.js`.

### Docs

Update only boundary docs that changed:

- `apps/sigil/AGENTS.md` should say both radial menu and avatar hit-target
  physical lifecycle use the toolkit DesktopWorld hit-region controller, while
  Sigil keeps product semantics and DOM event interpretation.
- `docs/design/aos-surface-system.md` or
  `docs/recipes/aos-surface-interaction-decision-tree.md` should reflect that
  Sigil has started moving child hit-surface mechanics into toolkit.
- `docs/api/toolkit/runtime.md` only needs changes if the toolkit helper API
  changes.

## Scope

Primary ownership is Sigil hit-target adapter plus renderer tests. Toolkit
runtime changes are allowed only for small generic helper gaps discovered while
migrating the avatar hit target. This is not a daemon slice.

## Hard Boundaries / Non-Goals

- Do not remove `apps/sigil/renderer/hit-area.html` in this slice.
- Do not change the child DOM event protocol or remove `fromHitTarget` yet.
- Do not tackle canonical routed source identity for child hit-surface echoes
  yet; that is the next #120/#122 slice.
- Do not move `avatar-main` visuals to the shared DesktopWorld stage.
- Do not change daemon input-region schemas or input-event v2.
- Do not run real pointer smoke while repo-mode TCC is blocked or without user
  handoff.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/runtime/desktop-world-hit-region.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/hit-area.html`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`

## Verification

Run focused deterministic checks:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/hit-target.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/renderer/hit-target.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/toolkit/runtime-desktop-world-hit-region.test.mjs
```

If imports or shared Sigil renderer behavior change more broadly, also run:

```bash
node --test tests/renderer/*.test.mjs
```

If isolated daemon smoke is available and not blocked:

```bash
bash tests/sigil-avatar-interactions.sh
```

Report `./aos ready` status. Do not use real mouse input without explicit
user/operator handoff.

## Completion Report

Include:

- files changed;
- whether `hit-target.js` now uses `createDesktopWorldHitRegionController`;
- any generic toolkit helper changes needed;
- whether `hit-area.html` was retained;
- tests run with exact pass/fail results;
- `./aos ready` result or known TCC blocker;
- recommended next slice for canonical routed source identity and removal of
  app-local `fromHitTarget` / `assumeInside` glue.
