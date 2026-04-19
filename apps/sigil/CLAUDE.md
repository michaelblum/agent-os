@../../AGENTS.md

# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It's an opinionated avatar system that uses the AOS daemon's canvas system for display. It does not belong in `packages/` — it's an application, not a toolkit component.

Sigil is pure web — the renderer, studio, and chat surfaces are HTML/JS loaded into WKWebView canvases created by the AOS daemon. There is no Swift host process; all state, animation, and event handling live in JS inside the canvas. The legacy `avatar-sub` Swift binary was retired 2026-04-13 (see #46).

## Run

Start the AOS daemon, then launch the avatar canvas:

```bash
./aos serve                               # repo daemon (launchd normally manages this)
./aos show create --id avatar-main \
    --url 'aos://sigil/renderer/index.html' \
    --track union
```

For the new persistent-stage Sigil runtime, use the app-local helpers:

```bash
apps/sigil/stage-launch.sh
apps/sigil/stage-signal.sh toggle
```

The workbench and Studio code remain on disk for later reuse, but they are
intentionally outside the current avatar runtime path.

Logs for the daemon live under `~/.config/aos/{mode}/daemon.log`. The renderer's `console.log` output is visible via Safari's Develop → Agent-OS menu (WKWebView remote inspector) when the daemon is running in a dev build.

## First-Time Setup — Seed

Sigil's renderer loads its configuration from per-agent wiki documents under the
`sigil/agents/` namespace. Before first launch (or after a wiki wipe), seed the
default agent document so the renderer has something to load:

```bash
# One-shot seed (idempotent — re-running is a no-op once the docs exist)
apps/sigil/sigilctl-seed.sh --mode repo
```

Under the hood this invokes:

```bash
./aos wiki seed --namespace sigil \
  --file "agents/default.md:$(pwd)/apps/sigil/seed/wiki/sigil/agents/default.md"
```

Source of truth is `apps/sigil/seed/wiki/sigil/` in the repo. The default agent
doc lands at `~/.config/aos/{mode}/wiki/sigil/agents/default.md`.

## Architecture

| Path | Role |
|------|------|
| `renderer/index.html` | Persistent avatar-stage entrypoint. Boots the ES-module runtime from `renderer/live-modules/persistent-stage.js` into a transparent passthrough union canvas. |
| `renderer/live-modules/*.js` | Sigil-owned interaction/runtime modules: host bridge, boot sequence, PRESS/DRAG/GOTO state machine, fast-travel, display geometry helpers, overlay drawing, and hit-target lifecycle. |
| `renderer/*.js` | Avatar visual subsystems and shared data modules (`agent-loader`, `appearance`, `birthplace-resolver`, `state`, `geometry`, `colors`, `aura`, `phenomena`, `skins`, `presets`, `fx-registry`, `omega`, `magnetic`, `lightning`, `particles`). |
| `studio/` | Retained editor surface, intentionally shelved for the current persistent-stage runtime. |
| `chat/` | Bidirectional conversational canvas (see Chat Canvas Protocol below). |
| `workbench/` | Retained workstation surface, intentionally outside the current avatar summon/toggle flow. |
| `renderer/hit-area.html` | Minimal interactive child canvas the renderer spawns at the avatar's position so clicks/drags on the dot land somewhere while the parent canvas stays click-through. |
| `radial-menu-config.json` | Menu items (deferred, to be reimplemented). |
| `seed/wiki/sigil/` | Seed source for the default agent wiki doc. |
| `sigilctl-seed.sh` | Wraps `aos wiki seed` for the Sigil namespace. |
| `tests/` | Manual verification pages plus shell smokes for renderer boot, status-item lifecycle, workbench launch/restage, and avatar interactions. Manual pages launch via `./aos show create --url aos://sigil/tests/...`; shell tests live under repo `tests/`. |

## Canvas Model

The renderer runs on a transparent passthrough canvas (typically launched with `--track union`). The avatar moves in Three.js scene space — the window never moves. This enables ghost trails, explosions, and effects that span the full display union with zero impact on user interaction until Sigil intentionally enables its child hit-target.

Coordinate-space warning: `avatarPos` is Sigil-owned global position state, but a
child hit canvas over a union stage must not assume the parent's desired
`show list` rect is the same as the parent's actual AppKit window origin on
screen. Mixed-DPI spanning windows can pick up an OS-level transform. For child
affordances that must visually sit on top of the avatar, use parent-local child
placement (`frame_local` in the canvas mutation API) instead of raw global
`frame` updates. If the minimap or tint shows the hit square in a different
place than the orb, debug the parent window's actual CGWindow bounds first.

The current v1 persistent stage is intentionally narrower:

- one always-on union canvas
- no Studio/workbench dependency in the renderer boot path
- fixed avatar seed loaded from Sigil-owned JS, not wiki fetches
- signal-driven updates over `aos show post`
- show/hide uses scale only; no summon/dismiss translation

- **Renderer**: `aos://sigil/renderer/index.html` — boots the persistent stage, subscribes to `display_geometry`, and accepts `sigil.stage` / `sigil.avatar` commands over the canvas message bridge.
- **Studio**: `aos://sigil/studio/index.html` — retained on disk but intentionally outside the v1 avatar runtime path.
- **Appearance source**: `renderer/fixed-avatar.js` — the fixed default avatar spec used at renderer boot. Runtime updates are signal-driven instead of wiki-driven.

Multi-display: the renderer clamps the avatar position to the union of `visible_bounds` reported by the daemon. Position updates are direct in v1; there is no fast-travel animation in the persistent-stage path.

### Content Server

The AOS daemon serves Sigil's HTML surfaces over localhost. Configure in `~/.config/aos/{mode}/config.json`:

```json
{ "content": { "roots": { "sigil": "apps/sigil" } } }
```

Canvases load via `aos://sigil/studio/index.html` or `aos://sigil/renderer/index.html`. No bundling required — ES modules work over HTTP.

## Dependencies

- **AOS daemon** (`aos serve`) — canvas management, IPC, pub/sub, content server
- **Three.js r128** — 3D rendering engine. Vendored at `renderer/vendor/three.min.js` (loaded by `renderer/index.html` and `tests/appearance-roundtrip.html`). No CDN at boot.

## Chat Canvas Protocol

The chat canvas (`chat/index.html`) is a bidirectional conversational surface. Agents project into it — the canvas does not run its own Claude API client.

### Sending to canvas

Push messages via `aos show post --id chat --event '<json>'` or the coordination channel.

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
