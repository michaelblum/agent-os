# Sigil: Celestial Graft and Full-Screen Avatar

**Date:** 2026-04-07
**Status:** Approved design, pending implementation plan

## Problem

The Sigil avatar renders inside a small moving NSWindow. The Three.js scene has no awareness of the window's screen position — `avatarGroup` stays at the origin while the OS window moves via `setFrame()`. Ghost trails and path-spanning effects never fire because movement detection (`avatarGroup.position.distanceTo(lastPos)`) always returns ~0.

The root cause is architectural: a small moving window is the wrong primitive for a system that needs to render effects across screen space.

## Key Discovery

macOS `ignoresMouseEvents = true` makes an NSWindow completely invisible to the mouse subsystem — clicks, cursor shape changes (ibeam over text, pointer over links), and hover events all pass through to underlying apps. This holds even for fully opaque windows. A full-screen overlay has zero interaction cost.

## Design

### Always-On Full-Screen Canvas

Replace the small moving window with full-screen transparent canvases — one per display. The avatar moves in scene space within the canvas. The window never moves.

- Each display gets a full-screen `NSWindow` at `.statusBar` level, `ignoresMouseEvents = true`, transparent background
- Each loads a WKWebView running the celestial renderer with `renderer.setClearColor(0x000000, 0)` and no UI chrome
- `avatarGroup` / `polyGroup` moves through scene space. Ghost trails, aura, particles, and all effects render correctly because the scene occupies the full screen
- Behaviors (idle, follow, fast-travel) compute screen-coordinate targets and send scene-position updates to JS, which maps pixels to scene units via the camera frustum

### Multi-Display (Intrinsic)

Multi-display support is part of the core model, not an extension:

- All display canvases are created at launch by monitoring `NSScreen.screens`
- The avatar lives on one canvas at a time; others are transparent and idle
- When movement crosses a display edge, the avatar hides on the outgoing canvas and appears on the incoming canvas at the corresponding edge position
- Ghosts and effects fade independently on the outgoing canvas
- Paths can be non-linear (arcs, curves) — display intersection is tested against the actual path geometry, not just a line segment
- For cross-display transit, each display boundary crossing is handled as a handoff, supporting paths that cross any number of displays

### Celestial Legacy Graft

The celestial legacy codebase (~4,500 lines core JS) is copied into Sigil and runs in two modes:

**Studio Mode** — Avatar customization UI. Runs in a Sigil-managed window with the full celestial stage: 3D object, shape selector, stellation slider, color pickers, opacity controls, aura settings, presets, camera controls, background. The user designs their avatar here. What they see on the stage is what the avatar looks like on their desktop.

**Live Mode** — The actual on-screen avatar. Runs in the full-screen transparent canvases. No UI controls, no skybox, no grid. Just the 3D object with aura, effects, and ghost trails composited over the desktop. Initialized from the config saved in Studio.

**Config flow:**
- Studio's existing `getConfig()` produces a JSON blob containing all appearance and behavior parameters
- Saved to `~/.config/aos/{mode}/avatar-config.json`
- Live mode reads config at launch via `setConfig()`
- Optional: live preview — Studio changes propagate to the live avatar in real time via IPC

### Animation Model

Each animation between two points is an atomic operation. A behavior can chain multiple segments.

**Segment:** `(from, to, interpolation, duration)`
- `from` / `to`: screen coordinates
- `interpolation`: function mapping normalized time (0-1) to screen position. Can be linear (straight), curved (CatmullRomCurve3 or bezier), or arbitrary
- `duration`: seconds

Celestial's pathing system provides the interpolation modes:
- **Direct (eased):** segment-by-segment with sine easing — ports as-is for fast-travel
- **Curve (smooth arcs):** CatmullRomCurve3 through waypoints — available for future behaviors

Ghost trails spawn naturally because `avatarGroup.position` changes each frame during any animation, triggering the existing movement-detection logic (delta > 0.01 threshold).

### Swift-Side Changes

**Replaced:**
- `avatar.html` — replaced by celestial live mode renderer
- `sendAvatarUpdate()` / `window.setFrame()` pattern — replaced by scene-position IPC messages

**Updated:**
- `avatar-animate.swift` — `moveTo()` sends scene-position messages to JS instead of daemon window-position updates
- `avatar-behaviors.swift` — behaviors output scene-position updates instead of window-position updates
- `avatar-ipc.swift` — new message types added for scene-position and config

**Kept:**
- `avatar-sub.swift` — avatar lifecycle, channel events, behavior dispatch
- `sendBehavior()` message pattern via `headsup.receive()`
- All behavior logic (idle, follow, fast-travel, interact)

**New responsibilities:**
- Create one full-screen canvas per display at launch
- Load `avatar-config.json` and send to JS via `setConfig()` at canvas load
- Track which canvas the avatar is "on" based on screen-coordinate position
- Send display-handoff messages (show/hide) when crossing display boundaries
- Send `{type: "scene_position", position: [x, y]}` each frame during movement

### JS Message Types

Messages sent from Swift to JS via `headsup.receive()`:

- **`scene_position`**: `{type: "scene_position", position: [px, py]}` — updates `avatarGroup` position in scene space via pixel-to-scene-unit mapping. Sent each frame during movement.
- **`transit_start`**: `{type: "transit_start", position: [px, py], canvasSize: [w, h]}` — signals the start of an active animation. Sets initial position and canvas dimensions for coordinate mapping.
- **`transit_end`**: `{type: "transit_end"}` — signals animation complete. Ghosts continue fading. JS reports `{type: "effects_settled"}` back when all effects are done.
- **`config`**: `{type: "config", data: {...}}` — full or partial config update. Calls `setConfig()` to update appearance.
- **`show`** / **`hide`**: `{type: "show"}` / `{type: "hide"}` — display handoff visibility control.

### Deferred

- **Radial menu**: reimplemented on top of the celestial renderer after the graft stabilizes. Concepts and logic from current `avatar.html` (lines 1071-1097) carry over.
- **Screen-warp effect**: captured screen texture as displacement shader during transit. Requires side-eye integration and shader work. Deferred to Phase 2 per original scratchpad.
- **Avatar Studio as a product feature**: Studio runs as a settings panel for now. Full standalone studio experience deferred.
- **Grid/swarm/black hole**: stripped from initial graft. Can be re-enabled as avatar effects later.

### What This Replaces

The entire expand/shrink canvas approach from the original scratchpad is unnecessary. The ghost trail problem was an architecture problem — a small moving window can't render effects across screen space. Full-screen canvases with scene-space movement solve it permanently with no mode switching, no transit sessions, and no canvas resizing.
