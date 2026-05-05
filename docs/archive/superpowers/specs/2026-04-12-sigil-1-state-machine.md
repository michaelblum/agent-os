# Sigil-1 — Avatar state machine, gesture, fast-travel, goto-mode

> **Superseded 2026-04-12:** Acceptance criterion #2 (idle cursor-follow) was the wrong default. See `docs/superpowers/specs/2026-04-12-sigil-foundation-agents-and-global-canvas.md` for the parked-idle model that replaces it.

**Status:** spec
**Date:** 2026-04-12
**Parent arc:** avatar-sub elimination (AOS-1 + AOS-2 + Sigil-1 + Sigil-2)
**Predecessors:** `2026-04-12-display-geometry-stream` (AOS-1), `2026-04-12-extended-input-events` (AOS-2), `2026-04-12-hit-area-canvas-follow-cursor` (Phase 3)
**Successor:** Sigil-2 (radial menu slices + beam + stellation polish)

## Purpose

Move the avatar's brain from Swift (`avatar-sub`) into JS running inside a full-display passthrough canvas loaded from `apps/sigil/renderer/index.html`. The renderer already owns all visual machinery (Three.js scene, aura, phenomena, ghost trails); today its position is driven by Swift IPC. Sigil-1 replaces that IPC-driven position with an in-JS state machine fed by the AOS-2 `input_event` stream and AOS-1 `display_geometry` stream.

Sigil-1 is the first real consumer of the locked interaction model: **click = goto-mode, click-and-drag = radial menu, drag-release = fast-travel**.

## Non-goals

- Radial menu slices, selection rendering, beam, stellation polish → Sigil-2
- Porting remaining Swift behaviors (dock, undock, possess, trace, escape) → Sigil-2 tail
- Removing `avatar-sub.swift` source files → Sigil-2 tail
- Replacing `draw.html` / `hit-area.html` from Phase 3 → retired by Sigil-1 (renderer subsumes draw; hit-area page survives unchanged)

## Consumed contracts

- **input_event** (AOS-2, post-extension): per-event `{type, x, y, button?, flags: {shift, ctrl, cmd, opt, fn}}`. New event types this spec uses: `mouse_down`, `mouse_up`, `mouse_drag`, `mouse_move`, `key_down`, `key_up` — with left/right/other variants on the button axis.
- **display_geometry** (AOS-1): `{type: 'display_geometry', displays: [{display_id, bounds, visible_bounds, scale_factor, is_main, ...}]}` — snapshot on subscribe + rebroadcast on topology change.
- **canvas.create / canvas.update / canvas.remove** (Phase 1): already wired in `draw.html`; reused verbatim for hit-area spawn.

## Runtime shape

One full-display renderer canvas **per display** (multi-display handoff deferred to a follow-up within Sigil-1 if trivial, else Sigil-2). Renderer canvas is passthrough (`ignoresMouseEvents=true`). It owns:

- Its own Three.js scene positioning via existing `setScenePosition(sx, sy)` + `screenToScene(px, py)`
- One child hit-area canvas (`avatar-hit`) — 80×80, default passthrough, flipped interactive during drag capture

### Launch

```
./aos show create --id avatar-main \
    --url aos://sigil/renderer/index.html \
    --at 0,0,<display-width>,<display-height>
```

Renderer spawns `avatar-hit` as its child via `canvas.create` on load. Cascade-delete: removing `avatar-main` removes `avatar-hit`.

### Retire

- `draw.html` / `hit-area.html` from Phase 3 remain on disk, unlaunched (dead code cleanup deferred to Sigil-2).
- `avatar-sub.swift` binary is already Cylance-blocked; Swift path is left alone. No changes to `avatar-ipc.swift`, `avatar-sub.swift`, etc.
- The IPC path in `renderer/index.html` (`headsup.receive` → `handleMessage` switch on `scene_position`, `transit_start`, etc.) stays functional. The new Sigil-1 state machine lives alongside it, activated by a `?mode=live-js` query param on the `aos://` URL (or detected by absence of Swift host). Swift-driven live mode continues to work unchanged for as long as avatar-sub can still boot.

## State machine

```
   ┌──────┐ click-on-avatar      ┌──────┐
   │      │────────────────────▶ │ GOTO │
   │ IDLE │                      │      │
   │      │ ◀────────────────────│      │
   └──────┘  click-on-avatar /    └──┬───┘
     ▲       ESC / right-click       │
     │                               │ click anywhere
     │                               ▼
     │                          (fast-travel)
     │                               │
     │◀──────────────────────────────┘
     │
     │ mousedown-on-avatar → (poll motion)
     ▼
  ┌──────┐ move ≥ threshold     ┌──────┐
  │ PRESS│────────────────────▶ │ DRAG │
  │      │                      │      │ ◀── menu breathes with drag position
  └──┬───┘                      └──┬───┘
     │ mouseup < threshold         │
     ▼                             ▼ mouseup
  (plain click; reclassified    release-over-avatar-zone → cancel (IDLE)
   as click-on-avatar → GOTO)   release-elsewhere → fast-travel → IDLE
                                release-over-menu-item → select → IDLE (Sigil-2)
```

### State detail

| State | Hit-area | Visual cue | Exits on |
|-------|----------|-----------|----------|
| `IDLE` | passthrough | normal avatar | mousedown over avatar → `PRESS`; external fast-travel request → `IDLE` (animation runs, state unchanged) |
| `PRESS` | interactive | normal avatar | mouseup → emit `click-on-avatar` → `GOTO`; movement ≥ 6px → `DRAG` |
| `GOTO` | passthrough | beam + stellation push (Sigil-2) / placeholder outline ring (Sigil-1) | click anywhere → fast-travel to release point → `IDLE`; ESC/right-click → `IDLE`; click-on-avatar → `IDLE` |
| `DRAG` | interactive | placeholder menu ring (Sigil-1) / radial slices (Sigil-2) | mouseup over avatar-origin zone → cancel → `IDLE`; mouseup over menu item → select (stubbed) → `IDLE`; mouseup elsewhere → fast-travel → `IDLE` |

Threshold: 6px (middle of brief's 4–8 range). Avatar-origin zone for drag cancel: 40px radius around mousedown point.

## Hit-area ownership

Renderer owns `avatar-hit`. Mode-based flipping via `canvas.update`:

- `PRESS`, `DRAG`: `interactive=true` (captures mouseup + motion for state machine)
- `IDLE`, `GOTO`: `interactive=false` (passthrough; lets text-field clicks through, matching the spec's promise that the avatar doesn't block normal input outside gestures)

Position: hit-area frame driven every rAF tick (same pattern as Phase 3 `draw.html`), tracking the avatar's rendered screen position. In multi-display future work, hit-area may also need to cross displays — out of scope for Sigil-1 initial pass.

## Fast-travel

Ported from `behaviorFastTravel` in `avatar-behaviors.swift`:

- `duration = max(0.12, min(0.3, dist / 5000))` — same curve
- Easing: `easeOutQuart` (port from `avatar-easing.swift`)
- Emits `transit_start` at kick-off, `transit_end` at landing — reuses existing `applyBehaviorPreset('fast_travel')` handler already in renderer to toggle `omegaInterDimensional` (ghost trails)

## Goto-mode visual cue (Sigil-1)

Simple 2D Canvas overlay on top of the Three.js canvas: dashed circle at beam length (placeholder for the eventual beam + stellation effect). Sigil-2 replaces with the real beam + stellation push.

## Placeholder menu ring

During `DRAG`, draw a simple circle outline at fixed radius (120px) around the mousedown origin on a 2D canvas overlay. No slices, no labels, no hover highlight — just enough to confirm the state is entered. On release, log `[sigil-1] menu release angle=<θ> radius=<r>` to console (future Sigil-2 wires slice selection).

## Keyboard

- `ESC` during `GOTO` or `DRAG`: cancel → `IDLE`
- All other keys: ignored (forwarding keystrokes through the passthrough canvas is already handled by AOS — nothing for Sigil-1 to do)

## Acceptance criteria

1. `./aos show create --id avatar-main --url aos://sigil/renderer/index.html --at 0,0,W,H` launches a full-display canvas showing the Three.js avatar at screen center by default.
2. Moving the cursor → avatar tracks cursor position in `IDLE` with the existing `holdPosition`-style smoothing (reuse Swift's `smoothing: 0.12` → JS lerp alpha 0.12 per-tick).
3. Click on avatar hit zone → enters `GOTO`; placeholder dashed ring appears.
4. In `GOTO`, click anywhere → avatar fast-travels to that point; ring disappears; returns to `IDLE`.
5. In `GOTO`, press ESC → ring disappears; returns to `IDLE`; no travel.
6. Mousedown + drag > 6px from avatar → placeholder menu ring appears; state = `DRAG`.
7. Drag release over avatar-origin zone → menu cancels, no travel.
8. Drag release elsewhere → fast-travel to release point.
9. Drag release over any position on the menu ring → console logs `[sigil-1] menu release angle=… radius=…`; state returns to `IDLE`. (No visual item feedback until Sigil-2.)
10. Text fields outside `PRESS`/`DRAG` remain clickable (hit-area is passthrough in `IDLE`/`GOTO`).
11. `./aos show remove --id avatar-main` cleanly removes both `avatar-main` and `avatar-hit` (cascade).
12. `aos see capture main --out /tmp/sigil1.png` shows the avatar at its expected position in at least one sampled state per criterion above (verified by author via screenshot).

## Failure modes to watch

- **60Hz canvas.update contention**: Phase 3 deferred this test. Sigil-1 exercises it. If hit-area lags visibly behind avatar, fall back to updating hit-area every other frame (30Hz) — document if needed.
- **ignoresMouseEvents race**: if `canvas.update` with `interactive=true` takes longer than the gesture (e.g. a fast click-drag-release completes before hit-area captures), drag will "slip" and be misclassified. If observed, flip hit-area interactive on mousedown over a preemptive larger zone. Document observed behavior — don't over-engineer before the evidence is in.
- **Multi-display at launch**: Sigil-1 first pass ships single-display. Multi-display launch and handoff is a follow-up; filed as issue #17 follow-through if still unresolved after Sigil-1 lands.

## Out of scope (filed for Sigil-2)

- Radial menu slices (geometry, colors, hover states) from `radial-menu-config.json`
- Menu item action dispatch (dock, undock, possess, trace, escape)
- Beam + stellation push visuals for `GOTO` cue
- Breathing menu behavior (retract when cursor returns inside origin zone)
- Multi-display fast-travel handoff

## References

- Brief: handoff message `01KP05GH6B0E1Z7TE23KWBKKR3` from `drag-capture`
- Phase 3 spec: `docs/superpowers/specs/2026-04-12-hit-area-canvas-follow-cursor.md`
- AOS-1: `docs/superpowers/specs/2026-04-12-display-geometry-stream.md`
- AOS-2: `docs/superpowers/specs/2026-04-12-extended-input-events.md`
- Swift source (reference): `apps/sigil/avatar-behaviors.swift` (behaviorFastTravel, behaviorFollowCursor), `apps/sigil/avatar-animate.swift` (moveTo, easing), `apps/sigil/avatar-easing.swift`
