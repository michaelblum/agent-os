@../../AGENTS.md

# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It's an opinionated avatar system that uses the AOS daemon's canvas system for display. It does not belong in `packages/` — it's an application, not a toolkit component.

Sigil is pure web — the renderer, studio, and chat surfaces are HTML/JS loaded into WKWebView canvases created by the AOS daemon. There is no Swift host process; all state, animation, and event handling live in JS inside the canvas. The legacy `avatar-sub` Swift binary was retired 2026-04-13 (see #46).

## Run

Start the AOS daemon, then launch the avatar canvas:

```bash
./aos serve                               # repo daemon (launchd normally manages this)
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos show create --id avatar-main \
    --url 'aos://sigil/renderer/index.html' \
    --track union
```

For the full operator-facing control surface, use the one-shot workbench launcher:

```bash
apps/sigil/workbench/launch.sh
```

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
| `renderer/index.html` | Live avatar renderer entrypoint. Boots the ES-module runtime from `renderer/live-modules/main.js` into a transparent passthrough canvas. |
| `renderer/live-modules/*.js` | Sigil-owned interaction/runtime modules: host bridge, boot sequence, PRESS/RADIAL/FAST_TRAVEL/GOTO state machine, fast-travel, display geometry helpers, overlay drawing, and hit-target lifecycle. |
| `renderer/*.js` | Avatar visual subsystems and shared data modules (`agent-loader`, `appearance`, `birthplace-resolver`, `state`, `geometry`, `colors`, `aura`, `phenomena`, `skins`, `presets`, `fx-registry`, `omega`, `magnetic`, `lightning`, `particles`). |
| `studio/` | Stageless control surface for designing the avatar's appearance and managing the agent roster. No in-Studio 3D canvas — the live desktop avatar is the preview. |
| `chat/` | Bidirectional conversational canvas (see Chat Canvas Protocol below). |
| `workbench/` | Multi-tab operator workstation that embeds Studio + Chat and warms debug tabs (canvas inspector + log) in one canvas. |
| `renderer/hit-area.html` | Minimal interactive child canvas the renderer spawns at the avatar's position so clicks/drags on the dot land somewhere while the parent canvas stays click-through. |
| `renderer/appearance.js` / `renderer/state.js` | Runtime appearance and interaction config, including Sigil's radial gesture menu defaults. |
| `seed/wiki/sigil/` | Seed source for the default agent wiki doc. |
| `sigilctl-seed.sh` | Wraps `aos wiki seed` for the Sigil namespace. |
| `tests/` | Manual verification pages plus shell smokes for renderer boot, status-item lifecycle, workbench launch/restage, and avatar interactions. Manual pages launch via `./aos show create --url aos://sigil/tests/...`; shell tests live under repo `tests/`. |

`renderer/live-modules/main.js` is the only active renderer entrypoint on `main`.
The old `persistent-stage.js` path was retired; do not use it for new work,
tests, or debug hooks.

## Canvas Model

The renderer runs on a transparent passthrough canvas (typically launched with `--track union`). The avatar moves in Three.js scene space — the window never moves. This enables ghost trails, explosions, and effects that span the full display union with zero impact on user interaction until Sigil intentionally enables its child hit-target.

- **Renderer**: `aos://sigil/renderer/index.html` — owns the interaction state machine, subscribes to `input_event`, `display_geometry`, `wiki_page_changed`, and `canvas_lifecycle`, and spawns the `avatar-hit` child canvas when needed.
- **Studio**: `aos://sigil/studio/index.html` — stageless control surface. Agent docs live at `sigil/agents/*.md` in the wiki; Studio lists them via `GET /wiki/sigil/agents/`.
- **Config per agent**: the renderer loads `sigil/agents/<id>.md` via the content server's `/wiki` REST surface. Live-edits to that doc trigger a `wiki_page_changed` broadcast, which the renderer flushes on the next IDLE frame.

Multi-display: the renderer clamps the avatar position to the union of `visible_bounds` reported by the daemon. Moving the avatar across displays is handled by the state machine's fast-travel animation, not by Swift-side window handoff.

### Content Server

The AOS daemon serves Sigil's HTML surfaces over localhost. Configure in `~/.config/aos/{mode}/config.json`:

```json
{ "content": { "roots": { "sigil": "apps/sigil" } } }
```

Canvases load via `aos://sigil/studio/index.html` or `aos://sigil/renderer/index.html`. No bundling required — ES modules work over HTTP.

Sigil now depends on toolkit runtime modules at load time for shared spatial
helpers, so repo-mode workflows must ensure both content roots are configured:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
```

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
