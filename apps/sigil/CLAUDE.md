# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It's an opinionated avatar system that uses heads-up (Track 1) as its display server. It does not belong in `packages/` — it's an application, not a toolkit component.

## Build

```bash
cd apps/sigil && bash build-avatar.sh
```

Compiles all Swift files into `./build/avatar-sub`.

To remove local Sigil build outputs:

```bash
cd apps/sigil && bash clean.sh
```

## Run

Sigil is a client of the AOS daemon — it connects via the mode-scoped socket.

```bash
# Repo mode — use explicit paths so both come from the same mode
./aos serve                              # repo daemon
apps/sigil/build/avatar-sub              # repo avatar

# Or use sigilctl for service lifecycle
apps/sigil/sigilctl --mode repo install
apps/sigil/sigilctl status
apps/sigil/sigilctl logs
```

**Important:** `aos` and `avatar-sub` must come from the same runtime mode. Do not mix an installed `aos serve` with a repo-built `avatar-sub` — they connect to different mode-scoped sockets and will appear disconnected.

Sigil resolves the daemon socket from the current runtime mode (`~/.config/aos/{mode}/sock`). Logs go to `~/.config/aos/{mode}/sigil.log`.

## Architecture

| File | Role |
|------|------|
| `avatar-sub.swift` | Entry point, state machine, runtime input bridge, event dispatch, reconnection |
| `avatar-behaviors.swift` | Choreographer — maps channel events to animation sequences |
| `avatar-animate.swift` | Animation primitives (moveTo, scaleTo, orbit, holdPosition) — sends scene-position updates |
| `avatar-spatial.swift` | Spatial helpers (display geometry, multi-display handoff, element resolution) |
| `avatar-easing.swift` | Easing functions |
| `avatar-ipc.swift` | Socket/IPC helpers for daemon communication + scene-position messaging |
| `celestial/js/` | Shared Three.js modules (geometry, colors, aura, effects, ghost trails) from celestial legacy |
| `celestial/live/` | Live avatar renderer — full-screen transparent canvas, IPC-driven movement |
| `celestial/studio/` | Avatar Studio — customization UI (celestial legacy with Sigil integration) |
| `avatar.html` | **Legacy** — replaced by `celestial/live/index.html`, kept for reference |
| `radial-menu-config.json` | Menu items (geometry, name, color, action) — deferred, to be reimplemented on celestial renderer |

## Canvas Model

The avatar runs on full-screen transparent canvases (`ignoresMouseEvents = true`), one per display. The avatar moves in Three.js scene space — the window never moves. This enables ghost trails, explosions, and effects that span the full screen with zero impact on user interaction (cursor shapes, clicks all pass through).

- **Live mode**: `celestial/live/index.html` — bundled renderer, IPC-driven position via `headsup.receive()`
- **Studio mode**: `celestial/studio/index.html` — full customization UI (celestial legacy)
- **Config**: `~/.config/aos/{mode}/avatar-config.json` — saved from Studio, loaded by Live

Multi-display: canvases on all displays at launch. Avatar hands off between displays when crossing boundaries.

## Dependencies

- **AOS daemon** (`aos serve`) — canvas management, IPC, pub/sub (subsumes heads-up)
- **Three.js r128** — 3D rendering engine (loaded from CDN)
- **xray_target.py** (`tools/dogfood/xray_target.py`) — element resolution for spatial behaviors
- **agent_helpers.sh** (`tools/dogfood/agent_helpers.sh`) — channel events that drive avatar behaviors
