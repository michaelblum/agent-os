# Panel Drag Coordinate Abstraction V0

## Routing Status

Historical / do not route as-is.

New Sigil live evidence showed duplicate Avatar/Sigil visible surfaces across
displays, so panel drag should not be treated as a coordinate abstraction issue
until AOS can audit visible native windows versus registered canvases. Route
`docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md` first, then
refresh toolkit placement/final-frame reporting and the active live-drag card
against that accepted evidence.

## Tracker

- Panel chrome drag controller:
  `packages/toolkit/panel/chrome.js`
- Shared panel placement policy:
  `packages/toolkit/panel/placement.js`
- Cross-display panel transfer affordance:
  `packages/toolkit/panel/drag-transfer.js`
- Toolkit canvas mutation helper:
  `packages/toolkit/runtime/canvas.js`
- Native canvas move path:
  `src/display/canvas.swift`
- Display geometry payload:
  `src/display/display-geometry.swift`
- Draft evidence commit:
  `3fbcf86 Fix extended-display panel drag clamp`

## Goal

Fix the AOS panel drag snapping bug as a coordinate-abstraction issue, not as a
lower-display special case.

The observed failure is that dragging AOS panels on `extended1` can snap panels
upward to the top of that display, just below the secondary menu bar. The fix
must work for one or more displays with arbitrary macOS Arrangement layouts,
varying resolution, mixed DPI, and menu-bar or visible-work-area insets.

## Existing Protections To Preserve

The repo already has two intended panel-placement protections.

First, panel seam/drop transfer is implemented in
`packages/toolkit/panel/drag-transfer.js`. It detects cross-display drag
transfers, draws a DesktopWorld transfer outline, and clamps the transfer
candidate to the target display.

Second, visible work-area and menu-bar protection is implemented in
`packages/toolkit/panel/placement.js`. It resolves display
`nativeVisibleBounds` or `native_visible_bounds` and clamps panels, chips,
maximize, restore, and drag-end placement to the visible work area. Those
visible bounds come from `NSScreen.visibleFrame` in
`src/display/display-geometry.swift`.

Do not remove, bypass, or weaken either protection. The likely bug is that
these protections can receive the wrong coordinate basis during drag, not that
the protections are conceptually wrong.

## Architecture Requirement

Panel drag should use one canonical desktop coordinate system at the boundary.
WebKit DOM pointer `screenX` and `screenY` must not be trusted as canonical
global placement coordinates across displays.

The native canvas `move_abs` path already uses `NSEvent.mouseLocation` through
`mouseInCGCoords()` to place canvases. That native/global coordinate source is
closer to the correct boundary than raw DOM pointer coordinates.

For global panel drag:

- DOM pointer events may start the drag and provide local offset or pointer
  identity.
- Global placement should come from daemon/native input events, daemon-reported
  canvas frames, or a documented normalization helper.
- Seam-transfer and work-area clamps should operate on canonical native/global
  coordinates, not raw display-local WebKit coordinates.
- Toolkit chrome should not leak AppKit/WKWebView coordinate quirks into panel
  placement policy.

## Required Work

1. Audit the draft commit `3fbcf86` and the surrounding drag path before
   deciding whether to keep it.
2. Identify where raw WebKit pointer coordinates still flow into global
   placement, seam transfer, or drag-end clamps.
3. Implement the durable fix at the narrowest correct layer.
4. Preserve cross-display seam/drop transfer behavior.
5. Preserve final visible-work-area and menu-bar clamp behavior.
6. Add deterministic regression coverage for stale or display-local WebKit
   pointer coordinates on extended displays. The regression should prove that
   drag-end clamping cannot snap a correctly moved panel to `visible_bounds.y`
   solely because the release pointer was reported in the wrong coordinate
   basis.
7. Keep scope tight. Do not mutate Employer Brand artifacts, report/capture
   workflows, annotation UX, or unrelated dock/hook code.

## Draft Commit Guidance

Foreman created `3fbcf86 Fix extended-display panel drag clamp` as draft
evidence while investigating. Treat it as non-authoritative. You may retain,
amend, replace, or revert it as needed.

The completion report must explicitly state whether that draft commit was
retained, amended, superseded, or reverted.

## Suggested Verification

Run focused deterministic coverage:

```bash
node --test tests/toolkit/panel-chrome.test.mjs
```

Run any adjacent panel, drag-transfer, or canvas tests touched by the change.

Run repository hygiene:

```bash
git diff --check
```

If local AOS readiness allows, run a bounded live smoke:

1. `./aos ready`
2. Launch a temporary panel on `extended1`.
3. Drag it within that same display.
4. Verify its final `at[]` is near the intended point and not snapped to the
   display visible-work-area top edge.
5. Remove the temporary canvas.

If `./aos ready` is blocked, use the codified repair path. Stop with concrete
human instructions only if macOS permissions require human action.

## Completion Report

Include:

- whether `3fbcf86` was retained, amended, superseded, or reverted;
- what the final coordinate-boundary rule is;
- whether seam-transfer behavior remains covered;
- whether visible work-area/menu-bar clamping remains covered;
- exact deterministic test results;
- exact live-smoke result, or the readiness blocker that prevented it.
