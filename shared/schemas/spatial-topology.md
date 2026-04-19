# Spatial Topology Schema

**File:** `spatial-topology.schema.json`
**Version:** 0.2.0
**Producer:** `aos see list`
**Consumers:** `aos do`, orchestrators

## What This Is

A snapshot of the macOS display and window layout. The orchestrator's world map.

```
Display → Windows (visible, front-to-back z-order)
Apps[]   (top-level index — all apps with windows, by PID)
```

## Coordinate System

The spatial contract now has four explicit layers. Only one of them is the
cross-surface world model.

| Layer | Origin | Units | Used by |
|-------|--------|-------|---------|
| **Native desktop compatibility** | Top-left of the macOS main display = `(0,0)` | Points (logical pixels) | Current daemon/AppKit/CoreGraphics boundary data only |
| **DesktopWorld** | Top-left of the arranged full-display union = `(0,0)` | Points | Canonical shared world for toolkit, Sigil, canvas-inspector, tests |
| **VisibleDesktopWorld** | Top-left of the arranged visible-bounds union = `(0,0)` in the same DesktopWorld frame | Points | Usable-area logic such as cursor/avatar clamping |
| **LCS** (`aos see` captures) | Top-left of captured region = `(0,0)` | Points | `--xray` element bounds, annotations, crops |

### Canonical World Contract

**DesktopWorld is the canonical cross-surface space.**

- Origin is the top-left of the arranged display union.
- Flipping which display macOS marks as main must **not** renumber DesktopWorld
  if the Displays > Arrange topology is otherwise unchanged.
- `--track union` canvases and union-canvas bounds are defined in DesktopWorld.
- Non-visible holes inside the full union bounding box are valid DesktopWorld
  coordinates even if no display occupies them.

**VisibleDesktopWorld is a derived usable-area space, not the full world.**

- It is built from each display's `visible_bounds`, projected into DesktopWorld.
- Use it for clamping and other "usable screen area" logic.
- Do **not** use it as the canonical world origin for canvases or minimaps.

### Boundary Compatibility

The `aos see list` topology producer now emits both native-compat and
DesktopWorld-anchored fields on every display, plus top-level
`desktop_world_bounds` / `visible_desktop_world_bounds` aggregates and
DesktopWorld cursor siblings (`desktop_world_x`, `desktop_world_y`). Cross-
surface consumers should read the DesktopWorld fields directly.

Window frames, input events, and other surfaces that still emit only native-
compat values must be re-anchored into DesktopWorld before cross-surface use.
The toolkit JS runtime (`packages/toolkit/runtime/spatial.js`) provides the
canonical helpers (`nativeToDesktopWorldPoint`, `nativeToDesktopWorldRect`).

### Converting Between Layers

| From | To | How |
|------|----|-----|
| `Display.native_bounds` | `Display.desktop_world_bounds` | Subtract the native full-union origin (or use the emitted value directly — both producers emit it). |
| `Display.desktop_world_bounds` | `Display.native_bounds` | Add the native full-union origin; use `desktopWorldToNativeRect` at the boundary. |
| `Display.native_visible_bounds` | `Display.visible_desktop_world_bounds` | Same offset as above; emitted directly. |
| Native / DesktopWorld | LCS | Subtract the origin of the capture target in the same source frame. |
| LCS | Native / DesktopWorld | Add the origin of the capture target in the same source frame. |
| Points | Physical pixels | Multiply by `scale_factor`. |

**Axis directions:** X increases rightward, Y increases downward.

### Channel vs topology split

- `aos see list` (full topology) — governed by `spatial-topology.schema.json`.
  Carries displays, windows, apps, and cursor. Cursor DesktopWorld siblings
  live **here only**.
- `display_geometry` daemon channel — displays-only subset of the same shape.
  No cursor field. Subscribers consume `native_bounds` /
  `desktop_world_bounds` on each display plus the top-level aggregates.
  Live-cursor needs re-anchor `input_event` messages via
  `nativeToDesktopWorldPoint` or read `aos see list --json` for a one-shot
  DesktopWorld cursor.

## Governance

This document is the canonical contract for DesktopWorld and related boundary
spaces, but
contracts drift unless implementation reuse is enforced.

Current governance surface:

- live audit:
  - `node scripts/spatial-audit.mjs --summary`
  - `node scripts/spatial-audit.mjs --check`
- allowlist:
  - `tests/fixtures/spatial-governance-allowlist.json`
- test gate:
  - `node --test tests/toolkit/spatial-governance.test.mjs`

When changing spatial math, the intended workflow is:

1. update this schema doc if the contract changes
2. update the audited allowlist only if ownership of a helper is intentionally changing
3. prefer consolidating transforms into canonical modules instead of adding new local helpers

The medium-term goal is to shrink the allowlist until coordinate transforms live
in one native boundary layer and one shared JS runtime.

## Key Design Decisions

**Windows nest under displays, not spaces.** macOS Spaces are not modeled. Agents perceive and act on what's visible — spaces don't change that. App activation (`NSRunningApplication.activate()`) handles space-switching implicitly. If space awareness is needed later, it can be added as an optional enrichment.

**Apps are a top-level index.** An app can have windows across multiple displays. The flat `apps[]` array enables "where is Safari?" without tree traversal. Windows carry inline `app_name` and `bundle_id` so you rarely need to join.

**Array order = z-order.** Windows in each display's `windows[]` are ordered front-to-back. Index 0 is the frontmost window on that display. This is derived from `CGWindowListCopyWindowInfo` ordering. There is no explicit `z_index` field — array position is the single source of truth for stacking order.

**Layer filtering is the consumer's job.** All windows visible on screen are included regardless of layer. Layer 0 = normal application windows. Layer > 0 = system overlays, floating panels, PiP windows. Most agents should start by filtering to layer 0 and expand as needed. The full set is provided so agents can reason about floating UI when necessary.

**Session-scoped IDs are exposed but not for persistence.** `window_id` (CGWindowID) and `display_id` (CGDirectDisplayID) are valid for the current login session. Use `display_uuid` and `bundle_id` for cross-session references.

## How `aos do` Uses This

**Click in a window from LCS:**
```
Input:  "click (200, 150) in window 4521"
Lookup: window 4521 → native_bounds { x: 50, y: 30 }    (daemon-emitted native-compat)
Math:   native = (50 + 200, 30 + 150) = (250, 180)
Bridge: shared-world code uses display.desktop_world_bounds; native bridge
        happens once at the daemon boundary via desktopWorldToNativePoint
Action: CGEvent at native point (250, 180)
```

**Activate an app:**
```
Input:  "bring up Safari"
Lookup: apps[] → Safari → pid 892
Action: NSRunningApplication(pid: 892).activate()
```

**Check occlusion in DesktopWorld:**
```
Input:  "is the login button visible?"
Lookup: window containing button → index in display.windows[]
Check:  any window at lower index overlaps the button's bounds?
```

## What This Does NOT Cover

| Gap | Why | Future |
|-----|-----|--------|
| Spaces | Not actionable — agents work with visible state; app activation handles switching | Optional enrichment if a use case emerges |
| Stage Manager groups | Apple doesn't expose an API | Add if API appears |
| Tab groups within windows | App-specific (Safari tabs, Finder tabs) | Separate schema |
| Window contents (AX tree) | That's `aos see capture --xray`, not topology | Topology = containers, xray = contents |
| Menu bar items | Different API surface | Out of scope |

## macOS APIs Backing This Schema

All public, no SIP required. Screen Recording + Accessibility permissions needed.

| Field | Source API |
|-------|-----------|
| `displays[]` | `CGGetActiveDisplayList()` |
| `display_id` | `CGDirectDisplayID` from display list |
| `display_uuid` | `CGDisplayCreateUUIDFromDisplayID()` |
| `bounds` (display) | `CGDisplayBounds()` |
| `visible_bounds` | `NSScreen.visibleFrame` (flipped to top-left origin) |
| `scale_factor` | `NSScreen.backingScaleFactor` |
| `rotation` | `CGDisplayRotation()` |
| `is_main` | `CGMainDisplayID()` comparison |
| `windows[]` | `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)` |
| `window_id` | `kCGWindowNumber` |
| `title` | `kCGWindowName` |
| `app_pid` | `kCGWindowOwnerPID` |
| `app_name` | `kCGWindowOwnerName` |
| `bounds` (window) | `kCGWindowBounds` |
| `layer` | `kCGWindowLayer` |
| `alpha` | `kCGWindowAlpha` |
| `is_on_screen` | `kCGWindowIsOnscreen` |
| `bundle_id` | `NSRunningApplication(pid:).bundleIdentifier` |
| `focused_app` | `NSWorkspace.shared.frontmostApplication` |
| `focused_window_id` | `AXUIElementCopyAttributeValue(focusedWindow)` + `_AXUIElementGetWindow` |
| `is_hidden` | `NSRunningApplication.isHidden` |
| `screens_have_separate_spaces` | `NSScreen.screensHaveSeparateSpaces` |

## Union Canvas Contract

Union canvases are anchored to **DesktopWorld**, not to the macOS main display.

- `--track union` resolves to the full arranged display union.
- The authoritative union rect is the top-level `desktop_world_bounds` emitted
  by `aos see list`; it is `[0,0,w,h]` by construction.
- Visible-bounds data remains available separately via
  `visible_desktop_world_bounds` for usable-area logic.
