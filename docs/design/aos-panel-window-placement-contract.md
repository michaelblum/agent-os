# AOS Panel Window Placement Contract

**Date:** 2026-05-05
**Status:** Design note and handoff map. The first toolkit slice exists on
`codex/wiki-workbench-layout-polish`, but the platform contract is not complete.

## Plain-English Model

AOS can put rectangles on the desktop. Some rectangles are ambient visuals, like
the Sigil avatar and radial menu. Other rectangles are windows, like Canvas
Inspector, wiki workbenches, terminals, editors, and settings panels.

The toolkit should be the standard window kit for those window-shaped canvases:
title bar, drag, resize, close, minimize, maximize, restore, and safe placement
on displays. Apps should use that kit instead of each app inventing its own
window behavior.

In this sense, a "toolkit window" does not mean "a window owned by
`packages/toolkit`." It means any AOS canvas, including app canvases under
`apps/`, that opts into toolkit panel/window behavior.

## Why This Matters

The observed bug class was inconsistent placement when dragging windows between
a main display and an extended display. Canvas Inspector, Agent Terminal, older
Sigil editors, and minimized chips could differ because they do not all share
one placement path.

This is not primarily a worktree issue. Stale content roots can make an old
version stay on screen, but the deeper issue is multiple window systems
coexisting:

- shared toolkit panel chrome;
- standalone minimized chip drag/restore logic;
- app-owned titlebars that emit raw `move_abs`;
- daemon native window movement and drag finalization;
- DesktopWorld visuals for outlines, minimaps, avatar, and radial menu.

## Ownership Boundary

The intended boundary is:

- **Daemon:** owns physical canvas lifecycle, native macOS frames, display
  geometry snapshots, and the actual window-server mutation.
- **Toolkit panel/window layer:** owns policy for window-shaped canvases:
  draggable titlebars, resize handles, minimize chips, maximize/restore,
  cross-display transfer affordances, and final safe clamping.
- **Apps:** opt into toolkit behavior and provide content, actions, theme
  overrides, and app-specific layout. Apps should not hand-roll drag/drop/chrome
  unless the surface is explicitly not a panel window.
- **DesktopWorld stage:** owns click-through visual layers for avatar, radial
  menu graphics, transfer outlines, spotlights, and telemetry. It is not the
  place for text inputs or normal window controls.

## Current Implementation Slice

The current branch has a useful partial extraction:

- `packages/toolkit/panel/chrome.js` provides shared panel chrome, drag, resize,
  minimize, maximize, restore, and close behavior.
- `packages/toolkit/panel/placement.js` provides shared display-owner,
  work-area, clamp, chip-frame, and restore helpers.
- `packages/toolkit/panel/drag-transfer.js` provides cross-display outline and
  release-frame behavior.
- `packages/toolkit/panel/layouts/split-pane.js` provides reusable split panes
  and accordion-style collapsed panes.
- Canvas Inspector now uses toolkit chrome and split-pane footer behavior.
- The wiki workbench now opens graph-first and reveals markdown content as a
  second pane.

This is a convergence slice, not a finished contract.

## Glaring Discohesion Found During Audit

The following surfaces still carry private or parallel behavior:

- `apps/sigil/codex-terminal/index.html`
  - Private titlebar, private window buttons, and raw
    `drag_start` / `move_abs` / `drag_end`.
  - This can behave differently from Canvas Inspector.
- `apps/sigil/chat/index.html`
  - Same older private drag/chrome pattern.
- `apps/sigil/radial-item-editor/index.js`
  - Older private drag logic using raw `move_abs`.
- `apps/sigil/radial-item-workbench/index.js`
  - Better: uses toolkit `wireDrag` and `wireResize`.
  - Still owns a custom workbench shell instead of mounting fully through the
    panel/window contract.
- `packages/toolkit/panel/minimized-chip.html`
  - Owns a small alternate drag/restore loop. It should become a first-class
    toolkit placement primitive instead of a special HTML page with private
    movement policy.
- `src/display/canvas.swift`
  - Correctly owns native movement, but currently also performs drag-end
    finalization. That must be reconciled with toolkit final-placement policy so
    the daemon and toolkit do not both independently decide the final resting
    frame.

## Contract Shape Needed

AOS needs a small, explicit panel placement contract. It should define:

- coordinate space for panel frames: native global CG coordinates;
- coordinate space for DesktopWorld visuals: re-anchored display-union
  coordinates;
- panel rest policy: normal panels rest on one display, clamped to that
  display's visible work area unless a surface explicitly opts out;
- drag authority: active drag movement can remain direct/native, but final
  placement should have one authoritative policy path;
- display ownership: during drag, the release/cursor display should win over a
  seam-adjacent top-left inference;
- cross-display transfer: outline behavior is a toolkit policy rendered through
  the DesktopWorld stage;
- minimize/restore ownership: chip placement and restore should use the same
  display/work-area helper as drag and maximize;
- app integration: app windows opt into `mountPanel` or the equivalent
  panel/window controller instead of emitting raw `move_abs`.

## Short-Term Exit Criteria

The next implementable slice should be small and testable:

- one public toolkit API for panel/window placement policy;
- minimized chip restore routed through that API;
- Agent Terminal and Sigil chat migrated off private drag/chrome or wrapped by
  the shared controller;
- tests covering stacked displays, side-by-side displays, mixed-DPI displays,
  off-left/off-right/off-bottom drops, minimize/restore across displays, and
  maximize work-area clamping;
- Canvas Inspector and Agent Terminal behave the same for drag/drop/minimize
  when launched from the same branch root.

## Related Work

- Issue #261 tracks the focused placement-contract and private-drag migration
  follow-up.
- Issue #45 tracks opt-in AOS canvas chrome.
- Issue #124 tracks DesktopWorld slots versus app-owned mega-canvas
  composition.
- Issue #260 tracks daemon-scoped content routing for parallel worktrees.
- The current branch's scoped-root slice reduces stale-worktree confusion but
  does not solve this placement contract by itself.
