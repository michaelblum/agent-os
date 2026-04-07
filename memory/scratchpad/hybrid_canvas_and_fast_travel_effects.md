---
name: hybrid-canvas-fast-travel
description: Expanding canvas approach for avatar transit effects, plus screen-warp fast travel concept
type: project
status: superseded
superseded_by: docs/superpowers/specs/2026-04-07-sigil-celestial-graft-and-fullscreen-avatar.md
---

# Hybrid Expanding Canvas + Fast Travel Effects

## What it connects to
Sigil avatar system (`apps/sigil/`), heads-up canvas manager (`src/display/`), side-eye capture pipeline.

## Why it matters
The ghost trail effect ported from celestial doesn't work because the avatar is a small moving OS window — ghosts render inside the window and slide along with it instead of trailing behind in screen space. The current architecture can't render effects that span the path between two points.

## Why not now
The current StatusItemManager + Sigil coordination was just stabilized. This is a visual effects change, not a correctness fix.

## When to revisit
When working on avatar visual polish, fast-travel behavior refinement, or the avatar creator studio.

---

## The Problem

The avatar canvas is a 300x300 NSWindow. During fast-travel, the window moves from point A to point B via `sendAvatarUpdate()` → daemon → `window.setFrame()`. The Three.js scene inside the canvas has no awareness of the window's screen position — from its perspective, nothing moves. Ghost trails (ported from celestial `omega.js`) detect movement via `avatarGroup.position.distanceTo()`, but the 3D object stays at (0,0,0) in scene space while the OS window moves. So ghosts never spawn.

## The Hybrid Expanding Canvas Approach

Keep the avatar as a small moving window during normal behavior (idle, follow, interact). Only expand the canvas when an effect-heavy transition fires.

### Sequence

1. **Trigger**: fast-travel (or any origin → destination animation) starts
2. **Expand**: resize the canvas to cover the bounding rect from origin to destination, plus margin for ghost scatter/effects
3. **Offset**: adjust the Three.js scene so the avatar starts at the correct position within the larger canvas (canvas-local coordinates)
4. **Animate**: move the 3D object through the scene. Ghosts trail behind in scene space — they stay where they were spawned while the avatar keeps moving. All effects render correctly because the canvas physically covers the path.
5. **Settle**: wait for ghosts and effects to fully fade out
6. **Shrink**: resize the canvas back to normal avatar size at the destination position

### Why this works
- No full-screen WKWebView running permanently
- No multi-display problems — the expanded canvas covers a region on one display
- No cursor passthrough issues — expansion is brief and non-interactive
- No architectural change to idle/follow/interact behaviors
- Ghost trail, warp effects, and any future path-spanning visuals all work because the canvas occupies the screen space where the effect needs to render

### What the avatar skin needs
A message from avatar-sub with origin and destination in canvas-local coordinates:
```json
{"type": "transit", "from": [x1, y1], "to": [x2, y2], "canvasSize": [w, h]}
```
The skin translates these to scene-space positions and animates the 3D object accordingly.

### What avatar-sub needs
- Compute bounding rect for the expanded canvas (origin, destination, margin)
- Send a single `update` to resize/reposition the canvas before the animation
- Send the `transit` message to the skin with canvas-local coordinates
- After animation + effect settle time, shrink canvas back to destination size

---

## Alternate Fast Travel Effect: Screen-Warp

Michael's concept for a more dramatic fast-travel visual:

### Concept
Instead of (or in addition to) ghost trails, distort the actual screen content along the avatar's travel path — as if spacetime warps around the avatar as it moves.

### Sequence

1. **Capture**: before expanding the canvas, use side-eye to capture the screen region along the travel path (the "strip" — bounding rect of the path)
2. **Inject**: pass the captured image into the WKWebView as a texture (base64 or file URL)
3. **Render**: the Three.js scene composites the strip as a background plane behind the avatar. A displacement/warp shader ripples outward from the avatar's position as it moves — like spacetime distorting along the path
4. **Snap-back**: as the avatar arrives at the destination, the warp effect resolves — the distorted strip snaps back to flat, aligning perfectly with the real screen underneath
5. **Shrink**: canvas shrinks to avatar size. The real screen content is right there, seamless transition with no visual discontinuity

### Why it's seamless
The captured strip IS the screen content underneath the canvas. When the warp resolves to flat, it's pixel-identical to what the OS would show without the canvas. Removing the canvas is invisible.

### Technical requirements
- side-eye capture of the path bounding rect (already supported: `side-eye capture main --crop x,y,w,h`)
- WebGL displacement shader in the avatar skin (new)
- Timing coordination between capture, canvas expansion, and animation start
- The strip image needs to be captured BEFORE the canvas expands (otherwise it captures the canvas itself)

### Open questions
- Should the warp travel the full path length or ripple outward from the avatar?
- Should it affect the entire strip simultaneously or propagate as the avatar moves?
- How to handle the avatar crossing over UI elements that change during transit (e.g., a video playing underneath) — the captured strip becomes stale. Probably fine for sub-second animations.

---

## Implementation Order (suggested)

1. **Phase 1**: Get the hybrid expanding canvas working with the existing ghost trail system. Validate that ghosts render correctly across the expanded canvas during fast-travel.
2. **Phase 2**: Add the screen-warp effect as an alternate or additive fast-travel visual. Requires shader work and side-eye integration.
3. **Phase 3**: Make these selectable via the avatar creator studio (deferred — studio doesn't exist yet).

---

## Files to read first
- `apps/sigil/avatar.html` — Three.js scene, presets, ghost trail system (lines 605-670, 763-870)
- `apps/sigil/avatar-behaviors.swift` — `behaviorFastTravel()` (line 77)
- `apps/sigil/avatar-animate.swift` — `moveTo()`, `sendAvatarUpdate()`, animation loop
- `apps/sigil/avatar-ipc.swift` — canvas creation, eval messaging
- `src/display/canvas.swift` — `CanvasManager`, window resize, `setCanvasAlpha`
