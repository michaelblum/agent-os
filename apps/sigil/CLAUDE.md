# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It's an opinionated avatar system that uses heads-up (Track 1) as its display server. It does not belong in `packages/` — it's an application, not a toolkit component.

## Build

```bash
cd apps/sigil && bash build-avatar.sh
```

Compiles all Swift files into `./avatar-sub`.

## Run

```bash
# Start the heads-up daemon first
packages/heads-up/heads-up serve

# Then start Sigil
apps/sigil/avatar-sub
```

## Architecture

| File | Role |
|------|------|
| `avatar-sub.swift` | Entry point, state machine, CGEventTap, event dispatch, reconnection |
| `avatar-behaviors.swift` | Choreographer — maps channel events to animation sequences |
| `avatar-animate.swift` | Animation primitives (moveTo, scaleTo, orbit, holdPosition) |
| `avatar-spatial.swift` | Spatial helpers (display geometry, element resolution via xray_target.py) |
| `avatar-easing.swift` | Easing functions |
| `avatar-ipc.swift` | Socket/IPC helpers for heads-up daemon communication |
| `avatar.html` | Avatar skin — Three.js stellation, ghost trail, behavior presets, radial menu |
| `cursor-decor.html` | **Moved to `packages/toolkit/components/cursor-decor.html`** — reusable cursor decoration, not sigil-specific |
| `radial-menu-config.json` | Menu items (geometry, name, color, action) |

## Dependencies

- **heads-up daemon** (`packages/heads-up/`) — canvas management, IPC, pub/sub
- **xray_target.py** (`tools/dogfood/xray_target.py`) — element resolution for spatial behaviors
- **agent_helpers.sh** (`tools/dogfood/agent_helpers.sh`) — channel events that drive avatar behaviors
