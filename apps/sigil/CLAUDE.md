# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It's an opinionated avatar system that uses the AOS daemon's canvas system for display. It does not belong in `packages/` — it's an application, not a toolkit component.

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
| `renderer/` | Shared Three.js modules (geometry, colors, aura, effects, ghost trails) + bundled live renderer |
| `studio/` | Avatar Studio — customization UI for designing the avatar's appearance |
| `avatar.html` | **Legacy** — replaced by `renderer/index.html`, kept for reference |
| `radial-menu-config.json` | Menu items (geometry, name, color, action) — deferred, to be reimplemented |

## Canvas Model

The avatar runs on full-screen transparent canvases (`ignoresMouseEvents = true`), one per display. The avatar moves in Three.js scene space — the window never moves. This enables ghost trails, explosions, and effects that span the full screen with zero impact on user interaction (cursor shapes, clicks all pass through).

- **Live mode**: `renderer/index.html` — bundled renderer, IPC-driven position via `headsup.receive()`
- **Studio mode**: `studio/index.html` — full customization UI for avatar design
- **Config**: `~/.config/aos/{mode}/avatar-config.json` — saved from Studio, loaded by Live

Multi-display: canvases on all displays at launch. Avatar hands off between displays when crossing boundaries.

### Content Server

The AOS daemon serves Sigil's HTML surfaces (renderer, studio) over localhost. Configure in `~/.config/aos/{mode}/config.json`:

```json
{ "content": { "roots": { "sigil": "apps/sigil" } } }
```

Canvases load via `aos://sigil/studio/index.html` or `aos://sigil/renderer/index.html`. No bundling required — ES modules work over HTTP.

## Dependencies

- **AOS daemon** (`aos serve`) — canvas management, IPC, pub/sub
- **Three.js r128** — 3D rendering engine (loaded from CDN)
- **xray_target.py** (`tools/dogfood/xray_target.py`) — element resolution for spatial behaviors
- **agent_helpers.sh** (`tools/dogfood/agent_helpers.sh`) — channel events that drive avatar behaviors

## Chat Canvas Protocol

The chat canvas (`chat/index.html`) is a bidirectional conversational surface. Agents project into it — the canvas does not run its own Claude API client.

### Sending to canvas

Push messages via `evalCanvas('chat', 'headsup.receive("' + btoa(json) + '")')` or the coordination channel. Payload must be base64-encoded JSON.

| Message | Payload | Effect |
|---------|---------|--------|
| Assistant message | `{type: 'assistant', content: [<Anthropic content blocks>]}` | Renders text, thinking, tool use, images |
| Echo user message | `{type: 'user', content: string}` | Shows user bubble |
| Status line | `{type: 'status', text: string}` | Replaces status indicator |
| Clear | `{type: 'clear'}` | Resets conversation display |

Supported content block types: `text`, `thinking`, `redacted_thinking`, `tool_use`, `tool_result`, `image`, `server_tool_use`, `web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`, `bash_code_execution_tool_result`.

Special tool_use renderers: `AskUserQuestion` (option buttons), `TodoWrite` (checklist), `ExitPlanMode` (plan card).

### Receiving from canvas

Messages arrive via the canvas `onMessage` callback (Swift side). Every emitted
event is wrapped as `{type: '<name>', payload: <body>}` — the outer `type` is
the event name, the `payload` carries only the event-specific fields (no
redundant inner `type`).

| Type | `payload` | When |
|------|-----------|------|
| `response` | `{value: string, tool_use_id: string}` | User answered an AskUserQuestion |
| `user_message` | `{text: string}` | User sent a free-form message |
| `stop` | _(no payload)_ | User requested interrupt |
| `ready` | `{name, accepts, emits}` (the canvas manifest) | Canvas loaded |
| `avatar_toggle` | _(no payload)_ | User clicked the avatar dot |
| `drag_start` / `move_abs` / `drag_end` | position data | Window drag |

### Focus on show

By default, clicking into an `.accessory` app's window to type is debounced by
macOS and takes several seconds. Pass `--focus` to `aos show create` or
`aos show update` to eliminate the delay:

- The daemon activates the aos process (`NSApp.activate`) and marks the canvas
  window key, so the next keystroke lands there.
- On create, the daemon arms a one-shot that evals `focusInput()` when the page
  emits `ready`. On update, it evals `focusInput()` immediately (the page is
  already loaded).

`--focus` is a no-op on non-interactive canvases.

The chat page exposes `focusInput()` as a top-level function that focuses its
`<input>`; other canvases can expose their own `focusInput()` if they want to
opt into the same behavior.

### Active state

Call `setActive()` (via eval) when the agent is generating. This pulses the status dot and shows the stop button. Call `setIdle()` when done. Input is always enabled regardless of state.
