# AOS Panel Window Placement Contract

**Status:** Accepted

## Purpose

Toolkit panel placement provides one opt-in policy over daemon-owned canvas and
display primitives. Consumer products may use, extend, or bypass this policy,
but they do not redefine the native coordinate system.

## Ownership

- The daemon owns DesktopWorld topology, native frames, canvas lifecycle, and
  final native placement.
- Toolkit owns panel drag, resize, maximize, minimize, restore, display choice,
  and clamping policy.
- External consumers own when a surface opens and any product-specific layout
  above the toolkit contract.

## Coordinate Contract

Placement inputs and outputs use DesktopWorld coordinates. Toolkit resolves the
target display, applies visible-frame constraints, and sends one final frame to
the daemon. Consumer code must not mix display-local, AppKit, or DOM coordinates
into placement messages without an explicit boundary conversion.

## Behavioral Contract

- Drag and resize preserve pointer ownership across displays.
- Maximize uses the selected display's visible work area.
- Minimize and restore retain the last valid panel frame.
- Final frames are clamped so a usable portion remains reachable.
- Failed or late operations cannot strand fallback canvases or duplicate panel
  ownership.

Deterministic coverage belongs in toolkit panel tests. Product-specific window
acceptance belongs in the external product repository.
