# Spatial Topology Schema

**File:** `spatial-topology.schema.json`
**Version:** 0.1.0
**Producer:** `side-eye list`
**Consumers:** `hand-off`, orchestrators

## What This Is

A snapshot of the macOS display and window layout. The orchestrator's world map.

```
Display → Windows (visible, front-to-back z-order)
Apps[]   (top-level index — all apps with windows, by PID)
```

## Coordinate System

Two layers, not one:

| Layer | Origin | Units | Used by |
|-------|--------|-------|---------|
| **Global CG** (this schema) | Top-left of primary display = `(0,0)` | Points (logical pixels) | Topology, hand-off targeting, display arrangement |
| **LCS** (side-eye captures) | Top-left of captured region = `(0,0)` | Points | `--xray` element bounds, annotations, crops |

**Converting between them:**
- LCS → Global: add the display's `bounds.x` and `bounds.y`
- Global → LCS: subtract them
- Points → Physical pixels: multiply by `scale_factor`

**Axis directions:** X increases rightward, Y increases downward. Multi-monitor: a display to the right of a 1512px-wide primary starts at `x: 1512`.

## Key Design Decisions

**Windows nest under displays, not spaces.** macOS Spaces are not modeled. Agents perceive and act on what's visible — spaces don't change that. App activation (`NSRunningApplication.activate()`) handles space-switching implicitly. If space awareness is needed later, it can be added as an optional enrichment.

**Apps are a top-level index.** An app can have windows across multiple displays. The flat `apps[]` array enables "where is Safari?" without tree traversal. Windows carry inline `app_name` and `bundle_id` so you rarely need to join.

**Array order = z-order.** Windows in each display's `windows[]` are ordered front-to-back. Index 0 is the frontmost window on that display. This is derived from `CGWindowListCopyWindowInfo` ordering. There is no explicit `z_index` field — array position is the single source of truth for stacking order.

**Layer filtering is the consumer's job.** All windows visible on screen are included regardless of layer. Layer 0 = normal application windows. Layer > 0 = system overlays, floating panels, PiP windows. Most agents should start by filtering to layer 0 and expand as needed. The full set is provided so agents can reason about floating UI when necessary.

**Session-scoped IDs are exposed but not for persistence.** `window_id` (CGWindowID) and `display_id` (CGDirectDisplayID) are valid for the current login session. Use `display_uuid` and `bundle_id` for cross-session references.

## How hand-off Uses This

**Click in a window:**
```
Input:  "click (200, 150) in window 4521"
Lookup: window 4521 → bounds { x: 50, y: 30 }
Math:   global = (50 + 200, 30 + 150) = (250, 180)
Action: CGEvent at (250, 180)
```

**Activate an app:**
```
Input:  "bring up Safari"
Lookup: apps[] → Safari → pid 892
Action: NSRunningApplication(pid: 892).activate()
```

**Check occlusion:**
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
| Window contents (AX tree) | That's `side-eye --xray`, not topology | Topology = containers, xray = contents |
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
