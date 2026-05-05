# Wire side-eye `list` to spatial-topology schema

**Date:** 2026-03-26
**Status:** Approved
**Schema:** `shared/schemas/spatial-topology.schema.json` v0.1.0

## Goal

Replace the current `side-eye list` debug dump with structured output conforming to the spatial-topology schema. This makes `list` the canonical producer of the ecosystem's spatial model — the world map that hand-off, heads-up, and orchestrators consume.

## Approach

In-place rewrite of `listCommand()` and its JSON structs in `main.swift`. Single-file architecture preserved. No new files, no build script changes.

## New Structs

Replace `TopologyJSON` and `DisplayJSON` with schema-conformant `Encodable` structs:

| Struct | Schema ref | Required fields |
|--------|-----------|-----------------|
| `SpatialTopology` | root | schema, version, timestamp, screens_have_separate_spaces, focused_window_id, focused_app, displays, apps |
| `STDisplay` | `$defs/Display` | display_id, ordinal, is_main, bounds, scale_factor, rotation, windows |
| `STWindow` | `$defs/Window` | window_id, app_pid, bounds, layer |
| `STApp` | `$defs/App` | pid, name, window_ids |
| `STFocusedApp` | `$defs/FocusedApp` | pid, name |
| `STBounds` | `$defs/Bounds` | x, y, width, height (all `Double` — points) |

`ST` prefix avoids collision with existing `BoundsJSON` used by capture output.

Optional fields per schema (nullable or omittable): `display_uuid`, `label`, `visible_bounds`, `title`, `app_name`, `bundle_id`, `is_focused`, `is_on_screen`, `alpha`, `is_active`, `is_hidden`.

## Data Flow

```
listCommand()
  1. getDisplays()                              → [DisplayEntry]  (existing, unchanged)
  2. CGWindowListCopyWindowInfo(.optionAll)      → [[String: Any]]
  3. NSWorkspace.shared.runningApplications      → [pid: (name, bundleId, isHidden)]
  4. NSWorkspace.shared.frontmostApplication     → focused app PID
  5. AXUIElementCreateApplication(focusedPID)
     → kAXFocusedWindowAttribute
     → _AXUIElementGetWindow                    → focused CGWindowID (or null)
  6. Filter windows (see rules below)
  7. For each window: build STWindow, assign to display by center hit-test
  8. For each display: build STDisplay with UUID, label, visible_bounds
  9. Build apps[] index from unique PIDs across all windows
  10. Assemble SpatialTopology, encode, print
```

## Window Filtering

`CGWindowListCopyWindowInfo(.optionAll)` returns everything. Filter to what agents need:

| Rule | Rationale |
|------|-----------|
| **Include** `kCGWindowIsOnscreen == true` | Only visible windows |
| **Include** any layer value | Layer > 0 windows (floating panels, PiP) can be actionable |
| **Exclude** zero-size windows (width or height == 0) | Menu extras, invisible system chrome |
| **Exclude** windows owned by `"Window Server"` | System chrome, not actionable |

## Window-to-Display Assignment

Hit-test the window's center point against display bounds. "Center wins" — matches macOS Mission Control behavior. Display assignment is organizational context; agents use the window's global bounds directly for targeting, so straddling windows don't cause accuracy issues.

## Display Enrichment

Fields not in the current `DisplayEntry` that need to be sourced:

| Field | Source | Notes |
|-------|--------|-------|
| `display_uuid` | `CGDisplayCreateUUIDFromDisplayID(cgID)` | Returns `CFUUID`, convert to String. Nullable. |
| `label` | `NSScreen.localizedName` (macOS 10.15+) | Human-readable name. Falls back to "Display {ordinal}". |
| `visible_bounds` | `NSScreen.visibleFrame` | Needs flip from AppKit bottom-left to CG top-left origin, plus global offset from display bounds. |

### visibleFrame Coordinate Flip

`NSScreen.visibleFrame` uses AppKit's bottom-left global coordinate system. The schema uses CG's top-left origin. To convert, compute the local offset of visibleFrame within the screen's own frame, then place it in global CG space:

```swift
let screenFrame = screen.frame          // AppKit global coords (bottom-left origin)
let visibleFrame = screen.visibleFrame  // AppKit global coords
let cgBounds = displayEntry.bounds      // CG global coords (top-left origin)

// Local offset within the display
let localX = visibleFrame.origin.x - screenFrame.origin.x   // usually 0 (Dock on bottom/top)
let localY = screenFrame.height - (visibleFrame.origin.y - screenFrame.origin.y) - visibleFrame.height

// Place in global CG space
let visibleBounds = STBounds(
    x: cgBounds.origin.x + localX,
    y: cgBounds.origin.y + localY,
    width: visibleFrame.width,
    height: visibleFrame.height
)
```

### NSScreen ↔ CGDirectDisplayID Mapping

`getDisplays()` already maps NSScreen → CGDirectDisplayID via the `NSScreenNumber` device description key for scale factor. The same pattern provides label and visibleFrame:

```swift
var screenMap: [CGDirectDisplayID: NSScreen] = [:]
for screen in NSScreen.screens {
    if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
        screenMap[n] = screen
    }
}
// Then: screenMap[displayEntry.cgID]?.localizedName, screenMap[displayEntry.cgID]?.visibleFrame
```

## Focused Window

```swift
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError
```

Sequence:
1. Get frontmost app PID from `NSWorkspace.shared.frontmostApplication`
2. `AXUIElementCreateApplication(pid)` → app AX element
3. `AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &value)` → window AX element
4. `_AXUIElementGetWindow(windowElement, &windowID)` → CGWindowID

If any step fails, `focused_window_id = null`. No heuristic fallback — null means "genuinely unknown." Consumers handle the ambiguity.

Requires Accessibility permission. Use `AXIsProcessTrusted()` (no prompt, no exit) as a non-fatal check — NOT the existing `checkAccessibilityPermission()` which exits the process. If not trusted, skip the focused window lookup and set `focused_window_id = null`. The rest of the topology is still useful without it.

## App Index Construction

After assigning windows to displays:

1. Collect unique `(pid, app_name, bundle_id)` tuples from all STWindows
2. For each unique PID:
   - `is_active`: PID matches `NSWorkspace.shared.frontmostApplication.processIdentifier`
   - `is_hidden`: from `NSRunningApplication(processIdentifier: pid)?.isHidden` or the pre-built lookup
   - `window_ids`: all CGWindowIDs owned by this PID (across all displays)
3. Sort apps by name for stable output

## Coordinate Convention

Everything in global CG coordinates (points, top-left origin). This is the reference frame. LCS (local coordinate system) is the capture layer's concern, not the topology's.

Per-display local coordinates are not provided — trivially derivable as `point - display.bounds.origin`.

## Z-Order

Array position in `display.windows[]` is the single source of truth. Index 0 = frontmost. No explicit z_index field — avoids duplication and consistency risk. Schema docs note this.

## Schema Docs Update

Add to `shared/schemas/spatial-topology.md`:
- Recommended filter guidance: "Layer 0 = normal app windows. Most agents should start by filtering to layer 0 and expand as needed."
- Note that array order = z-order, index 0 = frontmost.

## What Doesn't Change

- `DisplayEntry` struct — still used by capture commands
- `getDisplays()` — still the source of display enumeration
- `BoundsJSON`, `CursorJSON`, `AXElementJSON`, `SuccessResponse` — capture/xray output
- `jsonString()` helper — reused
- `build.sh` — unchanged (single file)
- All capture/xray/zone commands — untouched

## Breaking Change

`side-eye list` output format changes completely. Old:
```json
{"active_app": "Cursor", "displays": [{"id": 1, "type": "Main display", ...}]}
```

New:
```json
{"schema": "spatial-topology", "version": "0.1.0", "timestamp": "...", ...}
```

Nothing in the ecosystem consumes the old format programmatically. Safe to break.

## Design Decisions Log

| Decision | Rationale |
|----------|-----------|
| Center hit-test for display assignment | Matches macOS behavior; display assignment is context, not targeting math |
| Include all layers, consumer filters | Floating panels/PiP are actionable; recommended filter in docs |
| Global CG coordinates only | Topology is the reference frame; LCS is capture's concern |
| UUID = persistent identity, display_id = session handle | UUID for cross-session; display_id for API calls |
| null focused_window_id = genuinely unknown | No heuristic fallback; honest null > confident wrong |
| Array position = z-order, no z_index field | Single source of truth, no duplication risk |
| screens_have_separate_spaces = boolean hint only | No Spaces in model (decided in schema session); boolean for topology shape awareness |
| _AXUIElementGetWindow for focused window | Single private API, well-known, stable; focused window too useful to defer |
| Accessibility permission soft-fail | Missing permission → focused_window_id null, rest of topology still emitted |
