# Canvas Geometry / Lifecycle Render Contract V0

## Tracker

User-observed regression on 2026-05-19: Surface Inspector can be dragged, but
dragging is janky after recent panel/runtime and Surface Inspector control
refactors. History points to a confluence:

- `eb117d1` moved panel title-bar drag onto daemon/native input coordinates.
- `src/display/canvas.swift` emits `canvas_lifecycle action:"updated"` for
  every frame move.
- Surface Inspector subscribes to `canvas_lifecycle` and calls `rerender()` for
  every update.
- May 18 Surface Inspector Zag tree work made full rerender materially heavier.

This card owns the durable contract fix. Do not treat this as a local
"Surface Inspector skips rerender while dragging" patch.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Separate high-frequency canvas geometry changes from structural canvas
lifecycle/resource changes so renderers can make correct invalidation choices.
Dragging a panel by its title bar, resizing from an edge/corner, maximizing,
restoring, minimizing, anchor-follow movement, track retargeting, and display
topology adjustment must not all collapse into the same generic
`canvas_lifecycle action:"updated"` render path.

Surface Inspector is the visible failing client, but the fix belongs at the
daemon/toolkit event contract and render invalidation boundary.

## Read First

- `AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md` if present
- `packages/toolkit/panel/AGENTS.md`
- `src/display/canvas.swift`
- `src/daemon/unified.swift`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/canvas-lifecycle.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `docs/api/` entries that describe canvas lifecycle/subscription payloads, if
  any exist; add or update the appropriate API doc if this contract is not
  currently documented.
- Relevant tests under `tests/toolkit/`, `tests/renderer/`, and daemon/display
  integration tests that mention `canvas_lifecycle`, panel drag, resize,
  Surface Inspector, or subscriptions.

## Rediscover State

```bash
git status --short --branch
./aos dev recommend --json
rg -n "canvas_lifecycle|canvas_geometry|move_abs|drag_start|resize_start|rerender\\(|createAosZagTreeView" src packages tests docs
```

If Swift sources change, run `./aos dev recommend --json` again before choosing
build/test commands.

## Current Failure Shape

The current event shape is too coarse:

- `move_abs` drives native window movement from daemon/native coordinates.
- `moveCanvas()` updates the native canvas position.
- `moveCanvas()` emits `canvas_lifecycle action:"updated"` immediately.
- The daemon fans that event to every `canvas_lifecycle` subscriber.
- Surface Inspector handles every `canvas_lifecycle` event by applying lifecycle
  state and calling `rerender()`.
- `rerender()` rewrites large DOM sections and rebinds Zag-backed lower-pane
  trees, so a pointer-frequency drag can become pointer-frequency structural UI
  rebuilds.

This is insidious because any future subscriber that treats generic lifecycle
updates as structural invalidation can accidentally enter the same hot path.

## Required Contract

Introduce an explicit canvas geometry/update vocabulary. The exact spelling may
change after reading existing schema/docs, but the V0 contract should express
these dimensions:

- `change`: `origin`, `size`, or `frame`.
- `cause`: at least `placement.drag`, `resize.drag`, `layout.maximize`,
  `layout.restore`, `layout.minimize`, `layout.unminimize`, `anchor.follow`,
  `track.retarget`, `display.topology`, and `unknown`.
- `phase`: `start`, `update`, `settled`, or `cancelled`.
- `transaction_id`: stable across a drag/resize/maximize/restore sequence when
  there is a sequence.
- `frame`: the current native canvas frame.
- `previous_frame` where cheaply available.
- `canvas_id` and the existing canvas identity fields needed by subscribers.

High-frequency geometry should be published as a geometry event, not as a
generic lifecycle event that forces structural invalidation. Backward
compatibility may require a final/coalesced `canvas_lifecycle updated` at
`phase:"settled"` for older consumers, but pointer-frequency `updated` fanout
should not remain the primary hot path.

## Required Render Invalidation Policy

Surface Inspector must make invalidation decisions from event semantics:

- Geometry `phase:"update"` from `placement.drag` updates cached frame/minimap
  visuals cheaply and must not rebuild lower-pane trees.
- Geometry `phase:"update"` from `resize.drag` may update frame/minimap and any
  visible dimensions cheaply, but must still avoid destroying/recreating Zag
  tree machines at pointer cadence.
- Geometry `phase:"settled"` may trigger annotation projection refresh when the
  moved/resized canvas affects projection, but should still avoid full tree
  rebuild unless the tree model changed.
- Lifecycle/resource changes such as create, remove, suspend, resume,
  interactivity, window level, parent/cascade, stage layers, input regions,
  semantic targets, and object registries remain structural invalidation
  candidates.
- Zag adapters should have stable ownership across ordinary render updates.
  Rebinding/destroying tree machines should be tied to tree model or active pane
  changes, not geometry-only updates.

## Native Input Boundary

Do not revert panel title-bar dragging to DOM pointermove coordinates as the
placement authority. Daemon/native input and native window geometry remain the
authority for cross-display and mixed-DPI correctness.

The problem is event semantics and render invalidation after the native move,
not the existence of native drag authority.

## Suggested Implementation Areas

These are starting points, not a command to make the largest possible diff:

- `packages/toolkit/panel/chrome.js`
  - attach geometry cause/phase/transaction metadata to `move_abs`, resize,
    maximize, restore, minimize, and final settled updates where applicable.
  - preserve native coordinate drag.
- `packages/toolkit/runtime/canvas.js`
  - allow `moveAbsolute()` and `mutateSelf({ frame })` callers to pass geometry
    metadata.
- `src/display/canvas.swift`
  - teach frame mutation helpers to classify origin/size/frame deltas and
    accept geometry context.
  - stop unconditionally using immediate `canvas_lifecycle updated` as the hot
    frame-move notification.
- `src/daemon/unified.swift`
  - publish/fan out the new geometry event channel.
  - keep subscription and snapshot behavior explicit.
  - coalesce pointer-frequency geometry events where appropriate.
- `packages/toolkit/runtime/canvas-lifecycle.js`
  - add a companion geometry normalizer or update naming if this file remains
    lifecycle-only.
- `packages/toolkit/components/surface-inspector/index.js`
  - subscribe to geometry events.
  - update cached canvas frame/minimap cheaply on geometry updates.
  - reserve full rerender/tree rebinding for structural changes.
- `docs/api/` or `shared/schemas/`
  - document the event contract if it crosses daemon/toolkit or consumer
    boundaries.

## Hard Boundaries / Non-Goals

- Do not implement a temporary Surface Inspector-only "ignore updates during
  drag" patch as the primary fix.
- Do not move toolkit panel policy into the daemon.
- Do not remove Zag controls or blame the controls library. The problem is
  feeding structural tree binding from a high-frequency geometry stream.
- Do not replace native drag authority with canvas DOM pointermove authority.
- Do not broaden into Sigil reticle/browser targeting work.
- Do not run live website smokes for this card.

## Verification

Deterministic verification should prove the contract, not just visual smoothness:

```bash
node --test tests/toolkit/*panel* tests/toolkit/*surface-inspector* tests/renderer/*surface* 2>/dev/null || true
git diff --check
```

Prefer focused exact test files after rediscovery over the broad glob above.
Add or update tests that prove:

- title-bar drag emits geometry update semantics without relying on DOM
  pointermove placement authority;
- drag/resize update phases do not force Surface Inspector full structural
  rerender/tree rebinding;
- settled geometry can still refresh annotation projection when needed;
- lifecycle/resource changes still cause structural updates;
- existing `canvas_lifecycle` subscribers retain compatible behavior at settle
  or through documented migration behavior.

If Swift changes are made, use `./aos dev recommend --json` to select the build
and integration checks. Use `./aos dev build` for repo binary rebuilds.

If `./aos ready` passes and live verification is safe, run one bounded manual
smoke:

1. Open Surface Inspector.
2. Drag it by the title bar for several seconds.
3. Confirm dragging remains smooth and first-click/panel chrome interaction is
   responsive.
4. Resize and maximize/restore once each.
5. Confirm Surface Inspector still reflects canvas frame changes after settle.

If readiness is blocked by macOS TCC/input tap state, report the blocker using
the repo-standard readiness path instead of substituting unbounded live tests.

## Completion Report

Report:

- files changed;
- exact event contract introduced or amended;
- how lifecycle and geometry are now separated;
- how Surface Inspector render invalidation changed;
- whether native drag authority stayed in place;
- tests run with exact pass/fail results;
- live smoke result or readiness blocker;
- any compatibility behavior left for old `canvas_lifecycle updated`
  subscribers;
- follow-up slices, especially if docs/schema migration or broader subscriber
  audit remains.
