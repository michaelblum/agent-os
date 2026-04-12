# Spec: Extended Input Events

**Session:** drag-capture
**Date:** 2026-04-12
**Status:** Approved (pre-plan)
**Parent brief:** handoff `01KNZWQ68B1FHQ67SP2N8FTE13` from `hit-area-canvas`
**Arc:** Second of four specs in the avatar-streamline continuation. Generic AOS-layer capability used by Sigil (gesture state machine) and available to any future interactive canvas.

## Problem

The daemon's `input_event` broadcast (fanned out to canvases subscribed via the Phase 3 subscription machinery) carries event type + position + key code, but not modifier-key state. Consumers that want to distinguish `click` from `cmd+click` or `shift+click` have no way to do so.

The event list also has asymmetric gaps: `left_mouse_down` has a matching `up`, but `right_mouse_down`, `other_mouse_dragged`, and `key_down` do not. Future consumers that want release-on-right-button, release-on-middle-button, or key-release semantics have to either poll or be told "sorry, not emitted."

## Goal

1. Every mouse and key event broadcast on `input_event` includes a `flags` object representing the modifier-key state at the moment of the event.
2. The missing counterpart events (`right_mouse_up`, `other_mouse_down`, `other_mouse_up`, `key_up`) are captured and broadcast with the same shape as their existing counterparts.

**Success means:** a canvas subscribed to `input_event` sees `flags.cmd=true` on a command-held click, sees `right_mouse_up` fire on button release, and Phase 3's existing `draw.html` continues to work unchanged.

## Non-goals

- No `flags_changed` events (bare modifier press/release with no other action). Useful for some consumers but noisy; deferred until a concrete use case appears.
- No click-count field (double/triple click disambiguation). Deferred.
- No `scrollWheel` events. Deferred.
- No `capslock` state in `flags`. Deferred.
- No change to existing event names or payload fields. Strictly additive.

## Architecture

### Event payload shape

All mouse events gain a `flags` object:

```json
{
  "type": "left_mouse_down",
  "x": 500.0,
  "y": 300.0,
  "flags": {
    "shift": false,
    "ctrl": false,
    "cmd": true,
    "opt": false,
    "fn": false
  }
}
```

Key events gain the same `flags` object alongside the existing `key_code`:

```json
{
  "type": "key_down",
  "key_code": 53,
  "flags": { "shift": false, "ctrl": false, "cmd": false, "opt": false, "fn": false }
}
```

`flags` is always present on mouse and key events (never omitted). All five booleans are always present (never nil).

### New events

Added to the `CGEventTap` mask and emitted with the same payload shape as their counterparts:

| New event | Payload |
|---|---|
| `right_mouse_up` | `type`, `x`, `y`, `flags` |
| `other_mouse_down` | `type`, `x`, `y`, `flags` |
| `other_mouse_up` | `type`, `x`, `y`, `flags` |
| `key_up` | `type`, `key_code`, `flags` |

### Modifier reading

`CGEvent.flags` returns a `CGEventFlags` option set. The mapping:

| Flag booleans field | `CGEventFlags` mask |
|---|---|
| `shift` | `.maskShift` |
| `ctrl` | `.maskControl` |
| `cmd` | `.maskCommand` |
| `opt` | `.maskAlternate` |
| `fn` | `.maskSecondaryFn` |

`.maskAlphaShift` (capslock) is intentionally ignored.

### Files touched

- `src/perceive/daemon.swift`:
  - Add `.rightMouseUp`, `.otherMouseDown`, `.otherMouseUp`, `.keyUp` to the `eventTypes` array (around line 53).
  - Add `case` branches in `inputEventName(for:)` (around line 117) returning `"right_mouse_up"`, `"other_mouse_down"`, `"other_mouse_up"`, `"key_up"` respectively.
  - Read `event.flags` and build the flags dict in `inputEventPayload(for:event:eventName:)` (around line 140). Pass the dict to `inputEventData`.
- `src/perceive/events.swift`:
  - Extend `inputEventData(type:x:y:keyCode:)` to accept `flags: [String: Bool]?` and include it in the returned dict when non-nil.

No other files change. No changes to the subscription machinery, the forwarding path, the CLI, or the daemon config. No new files.

### Backward compatibility

Strictly additive. Existing consumers that read `msg.type`, `msg.x`, `msg.y`, or `msg.key_code` are unaffected. New consumers opt in by reading `msg.flags` and/or the new event types.

Phase 3's `draw.html` is validated unchanged as part of the acceptance criteria.

## Test harness

New page: `apps/sigil/test-input-events/index.html`.

Behavior:
- Subscribes to `input_event`.
- Renders a scrolling log of every event received, one line per event.
- Each line shows: timestamp, event type, x/y (or key_code for key events), and any modifiers present (e.g., `"cmd+shift"`).
- Colors the line by event category (mouse-down red, mouse-up blue, mouse-moved gray, key events yellow).

Manual test procedure:
1. Launch: `./aos show create --id input-test --url aos://sigil/test-input-events/index.html --at 80,80,720,520`.
2. Click somewhere → `left_mouse_down` and `left_mouse_up` appear in the log with `flags=(none)`.
3. Hold cmd and click → `flags=cmd` on both down and up.
4. Hold shift+cmd and click → `flags=cmd+shift`.
5. Right-click somewhere → `right_mouse_down` and `right_mouse_up` both appear (the `up` is new).
6. Press a modifier-less key (e.g., a letter) → `key_down` and `key_up` appear with `flags=(none)`.
7. Press cmd+a → `key_down` with `flags=cmd`, followed by `key_up` with `flags=cmd`.
8. `./aos show remove --id input-test`.

## Acceptance criteria

1. Every mouse event broadcast on `input_event` includes a `flags` object with all five boolean fields present.
2. Every key event broadcast on `input_event` includes the same `flags` object.
3. Holding cmd while clicking produces `flags.cmd = true` on the resulting `left_mouse_down`.
4. Holding shift while clicking produces `flags.shift = true`.
5. `right_mouse_up` fires on right-button release (verified in test-input-events log).
6. `other_mouse_down` and `other_mouse_up` fire for middle-button clicks (if hardware available; otherwise verified by inspecting the event type list in the built binary).
7. `key_up` fires for every key release after a `key_down`.
8. Phase 3's `draw.html` continues to work without modification: relaunching it after this spec lands reproduces the Phase 3 behavior (blue dot follows cursor with wake trail).
9. The shape of existing events (`left_mouse_down`, `left_mouse_up`, `left_mouse_dragged`, `mouse_moved`, `right_mouse_down`, `right_mouse_dragged`, `other_mouse_dragged`, `key_down`) retains all existing fields — only `flags` is added.

## Failure modes and fallbacks

| Failure | Symptom | Fallback |
|---|---|---|
| `CGEvent.flags` returns unexpected bitmask on fn key on certain hardware | `flags.fn` may be inaccurate on non-Apple keyboards | Accept as-is; `.maskSecondaryFn` is Apple-documented but known to be unreliable across third-party keyboards. Not worth special-casing. |
| An additional CGEventType is missing from the tap mask | New event never fires | Adding one event type is a trivial follow-up; filing as an issue and revisiting is cheaper than trying to enumerate every `CGEventType` case upfront. |

## Out of scope (will come later)

- `flags_changed` event (modifier-only key press/release). File an issue if a use case appears.
- Click count (single/double/triple click disambiguation).
- `scrollWheel` events with deltas.
- `capslock` state in `flags`.
- Timestamps on events (JS can timestamp receipt with `Date.now()` which is adequate for all known consumers).
