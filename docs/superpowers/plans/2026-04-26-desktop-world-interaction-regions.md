# DesktopWorld Interaction Regions

## Goal

Extract the duplicate-input and pointer-capture behavior discovered in the Sigil
context menu into a reusable toolkit runtime primitive. Sigil should not own the
rules for reconciling global DesktopWorld input with child hit-canvas events.

## Invariants

- `DesktopWorld` remains the logical coordinate space.
- Rendering may be segmented, but interaction regions are declared in
  DesktopWorld coordinates.
- A pointer sequence has one captured logical owner from down through up/cancel.
- Duplicate streams may be observed, but they must not mutate one interaction
  twice.
- Click-off dismissal is a policy layered on top of the router, not hidden
  inside the daemon.

## Phase 1: Toolkit Router

1. Add `packages/toolkit/runtime/interaction-region.js`.
2. Support registering regions with `id`, `contains(point)`, optional
   `priority`, and `onPointer(event)` handler.
3. Normalize input event types into pointer phases: `down`, `drag`, `up`,
   `move`, and `cancel`.
4. Capture the winning region on pointerdown and route subsequent drag/up events
   to that region only.
5. Consume duplicate non-captured streams during a capture without delivering
   duplicate state mutations.
6. Expose outside-click callbacks for surfaces that need click-off dismissal.
7. Add focused Node tests for capture, duplicate-stream suppression, outside
   click, and source locking.

## Phase 2: Sigil Migration

1. Replace menu-local pointer arbitration (`pointerDownInside`,
   `suppressNextOutsideMouseUp`, and source checks) with the toolkit router.
2. Keep range-slider math in Sigil menu code, but route range events through a
   captured interaction-region sequence.
3. Keep the hit-canvas frozen-frame conversion in Sigil until the daemon/toolkit
   has a first-class region hit-test primitive.
4. Preserve ESC dismissal and outside-click dismissal.

## Validation

- `node --test` for the new toolkit router tests and existing stack-menu tests.
- `tests/sigil-avatar-interactions.sh`.
- Live `avatar-main` duplicate-stream simulation:
  - hit stream drags a slider normally,
  - duplicate global stream sends bad far-left drag coordinates,
  - slider value remains monotonic and menu remains open.

## Follow-Up Boundary

This is a toolkit primitive, not yet a daemon primitive. If additional apps need
the same behavior or if child hit canvases keep showing platform limitations,
the next step is daemon-backed interaction-region registration so the daemon can
hit-test regions and emit one canonical pointer stream.
