# Sigil Avatar Scope Select Mode V0

## Tracker

- Source request: Michael, 2026-05-28.
- Related display-first annotation direction:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Related sequence card:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Related native candidate work:
  `docs/design/work-cards/surface-inspector-native-ax-candidate-adapter-v0.md`
- Donor interaction source:
  `/Users/Michael/Documents/GitHub/selection/puppeteer-server/server/helpers/autoscraper-chrome-extension/content.js`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

## Branch / Base

- `branch_from`: `origin/main`
- `required_start_ref`: local `main` including the Foreman work-card commit
- Branch/output expectations: create a focused implementation branch if useful,
  keep changes scoped, and do not push or open a PR unless explicitly asked.

## Goal

Add the first Sigil-owned "Scope Select Mode" path:

1. Double-click the avatar to enter Scope Select Mode.
2. While active, Sigil draws a vivid animated cursor decoration on the existing
   `avatar-main` canvas, including a cursor-shaped trail that uses the same
   configurable timing/count/mode settings as the avatar's current line
   fast-travel trail.
3. A left click in this mode is captured by AOS/Sigil and must not pass through
   to underlying apps.
4. That click selects the lowest available target under the pointer, highlights
   it, and shows an ancestor/scope chain of badges.
5. The badge chain climbs upward across available display graph
   representations: DOM element when a DOM adapter provides it, native AX
   element/window/app, AOS canvas/surface, display, and top-level whole screen.
6. Hovering a badge previews that scope; clicking a badge changes the scoped
   target.

This is the reverse/drill-up complement to the existing Sigil avatar anchor,
reticle, and frame targeting paths.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/surface-inspector-native-ax-candidate-adapter-v0.md`
- `/Users/Michael/Documents/GitHub/selection/puppeteer-server/server/helpers/autoscraper-chrome-extension/content.js`

Use the donor `content.js` only for interaction semantics:

- right-click opens a selection flow;
- the clicked leaf is highlighted;
- an ancestor chain of numbered badges appears near the pointer;
- hover previews an ancestor;
- clicking a badge commits/opens controls for that target.

Do not port the Chrome extension architecture, sidebar, injected DOM overlay,
server calls, emoji controls, or browser-only assumptions.

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

For live checks, start with:

```bash
./aos ready
./aos status
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention` unless the human returns with `finished`; after
that run `./aos ready --post-permission`.

## Existing Code To Inspect

- `apps/sigil/renderer/live-modules/main.js` - Sigil state machine, avatar
  pointer handling, context menu entry, annotation reticle candidate cache,
  render loop, and host message routing.
- `apps/sigil/renderer/live-modules/input-regions.js` - Sigil adapter for
  daemon `input_region.*` claims. Extend this rather than adding a full-screen
  WebView/canvas capture surface.
- `apps/sigil/renderer/live-modules/interaction-overlay.js` - existing
  canvas-overlay drawing for hover/radial/reticle frames. The cursor decoration
  belongs on this existing visual layer or a sibling module mounted by
  `avatar-main`.
- `apps/sigil/renderer/live-modules/fast-travel.js` and
  `apps/sigil/renderer/state.js` - line fast-travel trail settings that the
  cursor trail should reuse.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` - existing
  display-first target resolution, candidate cache, preview stack, and overlay
  model.
- `packages/toolkit/workbench/annotation-candidates.js` - candidate
  normalization/ranking and cross-adapter blocker language.
- `packages/toolkit/workbench/browser-dom-element-picker.js` - DOM candidate
  shape when controlled browser/page data is available.
- `src/daemon/input-surface-ownership.swift` and `src/daemon/unified.swift` -
  daemon input-region routing and consume-policy semantics.
- `tests/renderer/sigil-input-regions.test.mjs`,
  `tests/renderer/input-message.test.mjs`,
  `tests/renderer/fast-travel-preview.test.mjs`, and
  `tests/sigil-avatar-interactions.sh` - focused existing coverage.

## Required Behavior

### Entry And Exit

- Double-clicking the visible avatar enters Scope Select Mode.
- The double-click should be detected through the existing Sigil avatar input
  path: daemon `input_event` / child hit target / normalized DesktopWorld
  events. Do not add a document-level DOM double-click listener on the
  pass-through parent canvas as the authority.
- Scope Select Mode exits on Escape, successful scope commit if that is the
  simplest V0 behavior, or an explicit cancel path.
- Context menu, radial gesture, fast-travel, annotation reticle, and Scope
  Select Mode must cancel or ignore each other deterministically. Do not leave
  two pointer-owning modes active.

### Cursor Decoration

- While active, draw a vivid decorative animated outline over the current macOS
  cursor position on `avatar-main`.
- The decoration should read as a glowing cursor outline, not another avatar.
- Add a trail that mirrors the avatar line fast-travel trail behavior:
  `fastTravelLineInterDimensional`, duration/delay, repeat count, repeat
  duration, trail mode, lag, and scale should be the source settings unless a
  tiny adapter is needed for cursor-shaped geometry.
- The overlay is visual only. It must use `pointer-events: none` and live on the
  existing Sigil renderer canvas/layer.
- Mouse tracking for the decoration should use the same daemon input stream and
  render-frame cadence as existing fast-travel/frame-targeting overlays.

### Click Capture

- While Scope Select Mode is active, a left click is intended for Sigil and
  must not pass through to the underlying app.
- Do not create a full-screen mouse-capture WebView/canvas.
- Use the daemon `input_region` contract for the active display or display
  union, registered by Sigil while the mode is active and removed immediately
  when it exits.
- The region should be owned by `avatar-main`, carry clear metadata such as
  `purpose: "scope-select-pointer-capture"`, and use an appropriate
  `consume_policy` so the selecting click is consumed.
- Keep the existing small avatar hit target and radial target surfaces for their
  normal responsibilities; do not remodel the canvas architecture.

### Scope Chain

On captured left click:

- resolve the lowest available target under the pointer from existing candidate
  evidence;
- build a scope chain from leaf to root;
- draw the leaf highlight and numbered badge chain near the click, using the
  donor extension's placement behavior as the interaction reference;
- hovering each badge previews that scope;
- clicking a badge commits the scoped target and updates debug state.

The chain must climb as far as current evidence allows:

- DOM element ancestry when a DOM adapter supplies an ancestor chain;
- AOS semantic target or canvas subject;
- native AX element when current bounded AX evidence exists;
- native window/app scope;
- display scope;
- top-level whole screen scope.

Do not add broad DOM scraping, broad AX tree harvesting, or hidden background
inspection to fill missing ancestry in V0. If an adapter cannot supply a true
inner ancestor, keep the chain conservative and still include outer scopes such
as window/app/display/whole screen.

### Visual Scope Picker

- Badges should be rendered by Sigil on `avatar-main`, not by injecting DOM into
  the clicked app or web page.
- Badge hit handling may use a small temporary Sigil-owned input region around
  the badge group, or the active Scope Select capture region, whichever is
  simpler and consistent with daemon routing.
- Highlight frames should reuse the existing annotation/reticle frame overlay
  model where practical.
- The top ancestor label should be explicit, for example `Whole screen`.
- The display scope label should name the display when possible.
- Native/app/window scopes should use available app, window title, bundle id,
  pid, or window id evidence.

### Debug State

Expose enough state under `window.__sigilDebug.snapshot()` for deterministic
tests:

- whether Scope Select Mode is active;
- current cursor decoration/trail state summary;
- current selected leaf target;
- scope chain entries with ids, labels, adapter/source, rank/depth, and
  projectable rect status;
- hovered/previewed scope id;
- committed scope id;
- input-region registration snapshot for the mode capture region.

## Scope

Primary ownership boundary:

- Sigil app behavior and visuals;
- existing daemon input-region primitive as the capture mechanism;
- toolkit candidate/projection helpers only when a small reusable helper is
  necessary.

Swift daemon changes are not expected. If a daemon change becomes necessary,
keep it generic to `input_region` or perception contracts and run the
router-selected native checks.

## Hard Boundaries / Non-Goals

- No pointer waggle detector.
- No full-screen mouse-capture canvas/WebView.
- No global Sigil-specific daemon branch.
- No broad AX tree harvesting.
- No arbitrary browser DOM inspection.
- No live website browsing.
- No extension/sidebar port.
- No new persistent annotation database.
- No requirement to solve every adapter ancestry source in V0; use current
  evidence and report explicit blockers/gaps.

## Suggested Implementation Shape

Implementer should inspect before editing and choose the smallest correct patch.

Likely first V0 shape:

1. Add a small Scope Select model/controller module under
   `apps/sigil/renderer/live-modules/`, or keep it in `main.js` only if the
   resulting patch stays readable.
2. Extend `input-regions.js` with a third region for active scope selection.
3. Detect avatar double-click by timing two accepted avatar left-clicks within a
   bounded interval and distance, without breaking existing single-click GOTO
   behavior. If this conflicts with current single-click GOTO, prefer a small
   delayed single-click resolution in V0 and cover it with tests.
4. Reuse `annotationReticleTargetEvidence` and candidate helpers to resolve the
   clicked leaf and outer scopes.
5. Extend `interaction-overlay.js` or add a sibling overlay helper for cursor
   outline/trail and scope badges.
6. Add deterministic tests before live smoke.

## Verification

Run focused deterministic checks:

```bash
node --test tests/renderer/sigil-input-regions.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/fast-travel-preview.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/toolkit/annotation-candidates.test.mjs
git diff --check
```

Also run `./aos dev recommend --json` and follow any additional focused checks
for changed paths.

If `./aos ready` passes and real input is safe, run a bounded Sigil smoke:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Add or update a narrower live smoke only if the deterministic tests cannot
prove double-click entry, mode capture registration, and scope-chain state.

## Completion Report

Report back with:

- changed files;
- exact mode name used in code/UI/debug state;
- how double-click enters mode without breaking single-click GOTO/radial
  behavior;
- how click capture is implemented without a full-screen capture canvas;
- how cursor decoration/trail settings map to fast-travel settings;
- how the leaf target and ancestor/scope chain are built;
- which adapter ancestry sources work in V0 and which report blockers;
- tests run with exact pass/fail results;
- live smoke result or exact readiness/TCC blocker;
- any follow-up slice needed for richer DOM/native AX ancestry.
