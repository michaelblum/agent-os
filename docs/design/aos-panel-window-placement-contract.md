# AOS Panel Window Placement Contract

**Date:** 2026-05-05
**Status:** Closure audit for #261. The public toolkit policy path exists; the
remaining native drag-end question is classified below.

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
a main display and an extended display. Surface Inspector, Agent Terminal, older
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

## 2026-06-02 Observability Preconditions

New Sigil live evidence showed two Avatar/Sigil control surfaces visible at the
same time across displays: the new panel-backed Avatar controls surface and an
older compact controls surface without panel chrome. This changes the immediate
route. A panel that does not drag reliably may be suffering from coordinate
drift, but it may also be losing input to a stale/orphan visible surface, a
wrong content root, or an overlapping higher-level window.

The required observability preconditions are now accepted:

- `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md` covers
  active daemon registry/native-window alignment and labels the runtime scope as
  `runtime.native_window_scope = "current_daemon_process"`.
- `docs/design/work-cards/gdi-aos-visible-surface-cross-process-audit-v0.md`
  lists external visible AOS-owned native windows separately from current-daemon
  registry rows and orphan windows, with bounded process provenance and explicit
  unavailable reasons.
- `docs/design/work-cards/gdi-aos-runtime-service-input-tap-observability-v0.md`
  exposes launchd/service ownership, input-tap ownership, stale input-tap
  capable daemon counts, installed-mode socket reachability, and the explicit
  fact that duplicate macOS TCC rows are human-observable rather than AOS
  database-observable.

The next placement slice can therefore build on `./aos show audit --json`,
`./aos status --json`, and `./aos ready --json` instead of treating duplicate
surfaces, stale worktrees, or input-tap ownership as unknown background noise.

This audit is not layout policy. Daemon/kernel code owns native truth and
diagnostics. Toolkit owns opt-in panel placement policy. Sigil owns whether the
avatar should avoid its controls panel after the panel's final settled frame is
known.

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
- Surface Inspector now uses toolkit chrome and split-pane footer behavior.
- The wiki workbench now opens graph-first and reveals markdown content as a
  second pane.

This is a convergence slice, not a finished contract.

## Glaring Discohesion Found During Audit

The following surfaces still carry private or parallel behavior:

- `apps/sigil/agent-terminal/index.html`
  - Migrated precedent: uses `mountChrome()` and the shared toolkit
    panel/window controller path for drag, minimize, maximize, resize, and
    close behavior. `apps/sigil/codex-terminal/index.html` is a historical
    compatibility entrypoint for the same Agent Terminal surface.
- `apps/sigil/chat/index.html`
  - Parked legacy prototype. It still contains older private drag/chrome code,
    but `apps/sigil/AGENTS.md` marks it non-canonical and future chat work
    should be rebuilt from Agent Terminal/toolkit primitives instead of copying
    this file.
- `apps/sigil/radial-item-editor/index.js`
  - Migrated window drag to `createPanelWindowController().wireDrag(...)`.
    The Three.js object/orbit drag remains app-owned product behavior.
- `apps/sigil/radial-item-workbench/index.js`
  - Migrated window policy to the public toolkit
    `createPanelWindowController()` path for drag, resize, maximize, minimize,
    and close while preserving its custom workbench shell and 3D radial item
    preview as Sigil-owned product UI.
- `packages/toolkit/panel/minimized-chip.html`
  - Transitional fallback for environments where the shared DesktopWorld stage
    or input-region primitive is unavailable. The default toolkit minimize path
    renders a passive stage chip and routes restore/close through explicit
    daemon input regions owned by the source panel.
- `src/display/canvas.swift`
  - Owns native movement mechanics. Its `drag_end` finalization is not a
    competing placement-policy path; it applies the toolkit-requested
    `desiredCGFrame` with mixed-DPI fallback disabled after the toolkit has
    already decided whether to release a transfer frame or clamp the panel.

## Contract Shape Needed

AOS needs a small, explicit panel placement contract. It should define:

- coordinate space for panel frames: native global CG coordinates;
- coordinate space for DesktopWorld visuals: re-anchored display-union
  coordinates;
- panel rest policy: normal panels rest on one display, clamped to that
  display's visible work area unless a surface explicitly opts out;
- viewport overflow policy: panel callers can opt into documented behavior such
  as `allow`, `clamp`, `flip`, or `shift`, with a deterministic final settled
  frame reported after policy is applied;
- frame lifecycle reporting: requested frame, policy-adjusted frame, and actual
  native frame are separately observable so clamping and stale bookkeeping are
  diagnosable;
- drag authority: active drag movement can remain direct/native. Toolkit policy
  decides transfer release and final clamping, then calls `updateFrame()` /
  emits `drag_end`; daemon `drag_end` finalization completes the native frame
  mutation without changing that policy decision;
- display ownership: during drag, the release/cursor display should win over a
  seam-adjacent top-left inference;
- cross-display transfer: outline behavior is a toolkit policy rendered through
  the DesktopWorld stage;
- minimize/restore ownership: chip placement and restore should use the same
  display/work-area helper as drag and maximize;
- app integration: app windows opt into `mountPanel` or the equivalent
  `createPanelWindowController()` path instead of emitting raw `move_abs`.

## Short-Term Exit Criteria

The next implementable slice should be small and testable:

- one public toolkit API for panel/window placement policy;
- explicit requested-frame, policy-adjusted frame, final-settled frame, and
  actual native-frame reporting;
- opt-in viewport overflow behavior for panels;
- stock panel chrome routes through `createPanelWindowController()`;
- minimized chip restore routed through that API and backed by stage layers plus
  explicit input regions by default;
- Agent Terminal migrated off private drag/chrome;
- radial item editor migrated off private window drag while keeping 3D orbit
  drag app-owned;
- legacy Sigil chat marked parked, with any future "Sigil Chat 2" rebuilt from
  Agent Terminal/toolkit primitives instead of extending the old private shell;
- tests covering stacked displays, side-by-side displays, mixed-DPI displays,
  off-left/off-right/off-bottom drops, minimize/restore across displays, and
  maximize work-area clamping;
- Surface Inspector and Agent Terminal behave the same for drag/drop/minimize
  when launched from the same branch root.

## #261 Closure Audit

The current code satisfies the issue's exit criteria with one intentionally
parked legacy exception:

- **One public toolkit API owns panel/window placement policy.** Satisfied by
  `createPanelWindowController()` in `packages/toolkit/panel/chrome.js`, which
  composes drag, resize, maximize, minimize, restore, close, work-area clamp,
  transfer release, and fallback behavior. Stock `mountChrome()` routes through
  that controller.
- **Minimized chip restore routes through the accepted toolkit baseline.**
  Satisfied by the controller's `createMinimizeController()` path: the default
  chip is a passive DesktopWorld stage layer plus daemon input regions, while
  `packages/toolkit/panel/minimized-chip.html` remains explicit fallback only.
- **Agent Terminal no longer carries private drag/chrome.** Satisfied by
  `apps/sigil/agent-terminal/index.html` using `mountChrome()` with drag,
  minimize, maximize, resize, and close enabled. Guard coverage lives in
  `tests/renderer/agent-terminal-chrome.test.mjs`. The historical
  `apps/sigil/codex-terminal/index.html` path remains a compatibility
  entrypoint, not a separate windowing policy owner.
- **Sigil chat is not a live migration target.** Satisfied by
  `apps/sigil/AGENTS.md`, which marks `apps/sigil/chat/` as a parked legacy
  prototype. Its raw `drag_start` / `move_abs` / `drag_end` code is accepted
  only as historical code, not as a live panel pattern.
- **Radial editor and workbench no longer own private window placement.**
  Satisfied by the radial editor's
  `createPanelWindowController().wireDrag(...)` use and the radial workbench's
  controller-backed drag, resize, maximize, minimize, and close path. Their
  Three.js object/orbit dragging remains app-owned product behavior.
- **Display and clamp coverage exists.** Deterministic coverage includes
  side-by-side display ownership, stacked-display cursor ownership,
  mixed-DPI/display-local pointer fallback, off-left/off-right/off-bottom
  clamps, minimize/restore across displays, transfer outline release, and
  maximize work-area clamping in `tests/toolkit/panel-chrome.test.mjs` and
  `tests/toolkit/panel-drag-transfer.test.mjs`.
- **Surface Inspector and Agent Terminal share the same branch-root behavior.**
  The remaining live smoke evidence is the accepted #304 stage-chip proof
  recorded in `docs/design/aos-surface-stack-v0-integration-ledger.md`.
  Deterministic guardrails show both surfaces consume toolkit panel chrome
  instead of private panel movement paths.

## Drag-End Finalization Authority

The daemon/toolkit split is intentional:

- Toolkit owns policy: choosing the drag work area, deciding whether a
  cross-display transfer outline releases to a native frame, clamping the final
  panel frame, and updating the requested frame before `drag_end`.
- Daemon owns mechanics: applying `move_abs` with the native AppKit mouse
  location, suppressing mixed-DPI fallback while `isActivelyDraggingCanvas` is
  true, and on `drag_end` applying `finalizeDragPosition()` to the last
  `desiredCGFrame` with fallback still disabled.

That means `src/display/canvas.swift` finalization should stay. Removing it
would weaken the native primitive that makes toolkit policy reliable across
mixed-DPI display seams.

## Foreman Recommendation

Close #261. The remaining work belongs in separate narrow issues or work cards:
fallback-chip retirement confidence, broader DesktopWorld interaction routing,
and any future Sigil Chat 2 rebuild from Agent Terminal/toolkit primitives.

## Related Work

- Issue #261 tracks the focused placement-contract and private-drag migration
  follow-up.
- Issue #45 tracks opt-in AOS canvas chrome.
- Issue #124 tracks DesktopWorld slots versus app-owned mega-canvas
  composition.
- Issue #260 tracks daemon-scoped content routing for parallel worktrees.
- The current branch's scoped-root slice reduces stale-worktree confusion but
  does not solve this placement contract by itself.
