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
| `avatar-animate.swift` | Animation primitives (moveTo, scaleTo, orbit, holdPosition) |
| `avatar-spatial.swift` | Spatial helpers (display geometry, element resolution via xray_target.py) |
| `avatar-easing.swift` | Easing functions |
| `avatar-ipc.swift` | Socket/IPC helpers for heads-up daemon communication |
| `avatar.html` | Avatar skin — Three.js stellation, ghost trail, behavior presets, radial menu |
| `cursor-decor.html` | **Moved to `packages/toolkit/components/cursor-decor.html`** — reusable cursor decoration, not sigil-specific |
| `radial-menu-config.json` | Menu items (geometry, name, color, action) |

## Dependencies

- **AOS daemon** (`aos serve`) — canvas management, IPC, pub/sub (subsumes heads-up)
- **xray_target.py** (`tools/dogfood/xray_target.py`) — element resolution for spatial behaviors
- **agent_helpers.sh** (`tools/dogfood/agent_helpers.sh`) — channel events that drive avatar behaviors
