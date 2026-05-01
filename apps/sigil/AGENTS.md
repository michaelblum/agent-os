@../../AGENTS.md

# Sigil — Avatar Presence System

Sigil is a **Track 2 consumer** of agent-os. It is an opinionated avatar system
that uses the AOS daemon's canvas system for display. It does not belong in
`packages/`; it is an application, not a toolkit component.

Sigil is pure web. The renderer, configuration, diagnostics, and chat surfaces
are HTML/JS loaded into WKWebView canvases created by the AOS daemon. There is
no Swift host process; all state, animation, and event handling live in JS
inside the canvas. The legacy `avatar-sub` Swift binary was retired 2026-04-13
(see #46).

## Operating Surface

Use `./aos ready` as the repo-mode readiness gate before launching or verifying
Sigil. The canonical live avatar URL is `aos://sigil/renderer/index.html`,
usually shown as canvas id `avatar-main` on the union display track.

Sigil depends on both canonical repo content roots:

- `toolkit` -> `packages/toolkit`
- `sigil` -> `apps/sigil`

Use [`docs/recipes/content-root-hygiene.md`](../../docs/recipes/content-root-hygiene.md)
when diagnosing stale `aos://...` content or worktree-root drift. Use
[`docs/api/aos.md`](../../docs/api/aos.md) for `show`, `wiki`, `content`, and
focus command forms instead of duplicating command reference here.

Logs for the daemon live under `~/.config/aos/{mode}/daemon.log`. Renderer
`console.log` output is visible through Safari's WKWebView remote inspector when
the daemon is running in a dev build.

## Wiki Seed

The renderer loads configuration from per-agent wiki documents under the
`sigil/agents/` namespace. `apps/sigil/seed/wiki/sigil/` is the repo source for
seeded Sigil wiki documents, and `apps/sigil/sigilctl-seed.sh` is the
app-local wrapper for seeding the namespace in repo mode.

The default agent document lands at
`~/.config/aos/{mode}/wiki/sigil/agents/default.md`. Do not treat runtime wiki
copies as source-controlled truth.

## Architecture

| Path | Role |
|------|------|
| `renderer/index.html` | Live avatar renderer entrypoint. Boots the ES-module runtime from `renderer/live-modules/main.js` into a transparent passthrough canvas. |
| `renderer/live-modules/*.js` | Sigil-owned interaction/runtime modules: host bridge, boot sequence, PRESS/RADIAL/FAST_TRAVEL/GOTO state machine, fast-travel, display geometry helpers, overlay drawing, and hit-target lifecycle. |
| `renderer/*.js` | Avatar visual subsystems and shared data modules (`agent-loader`, `appearance`, `birthplace-resolver`, `state`, `geometry`, `colors`, `aura`, `phenomena`, `skins`, `presets`, `fx-registry`, `omega`, `magnetic`, `lightning`, `particles`). |
| `context-menu/` | Live avatar context menu implementation and app-local playbook for menu diagnostics. |
| `codex-terminal/` | Codex-only terminal MVP. A Sigil canvas fronts a named tmux session through a dependency-free local bridge; launch with `apps/sigil/codex-terminal/launch.sh`. tmux is preferred for durable resume/reattach, with a process fallback for machines without tmux. |
| `studio/` | Historical URL/path for the avatar configuration surface. Do not use the old product name in new user-facing copy. |
| `chat/` | Bidirectional conversational canvas. Protocol details live in `chat/README.md`. |
| `workbench/` | Historical multi-tab surface. Do not use as the standard launch or verification path for current Sigil work unless the task explicitly targets that surface. |
| `renderer/hit-area.html` | Minimal interactive child canvas the renderer spawns at the avatar's position so clicks/drags on the dot land somewhere while the parent canvas stays click-through. |
| `renderer/radial-menu-surface.html` | Minimal interactive child canvas the renderer spawns around live radial-menu items so `aos see --xray` can discover labeled item targets and `aos do` can act on them. |
| `renderer/appearance.js` / `renderer/state.js` | Runtime appearance and interaction config, including Sigil's radial gesture menu defaults. |
| `seed/wiki/sigil/` | Seed source for the default agent wiki doc. |
| `sigilctl-seed.sh` | Wraps `aos wiki seed` for the Sigil namespace. |
| `tests/` | Manual verification pages plus shell smokes for renderer boot, status-item lifecycle, and avatar interactions. Shell tests live under repo `tests/`. |

`renderer/live-modules/main.js` is the only active renderer entrypoint on `main`.
The old `persistent-stage.js` path was retired; do not use it for new work,
tests, or debug hooks.

## Canvas Model

The renderer runs on a transparent passthrough canvas, typically launched on the
union display track. The avatar moves in Three.js scene space; the window never
moves. This enables ghost trails, explosions, and effects that span the full
display union with zero impact on user interaction until Sigil intentionally
enables its child hit-target.

- **Renderer**: `aos://sigil/renderer/index.html` — owns the interaction state machine, subscribes to `input_event`, `display_geometry`, `wiki_page_changed`, and `canvas_lifecycle`, and spawns the `avatar-hit` child canvas when needed.
- **Configuration surface**: `aos://sigil/studio/index.html` — historical URL path for avatar configuration. Agent docs live at `sigil/agents/*.md` in the wiki; the surface lists them via `GET /wiki/sigil/agents/`.
- **Config per agent**: the renderer loads `sigil/agents/<id>.md` via the content server's `/wiki` REST surface. Live-edits to that doc trigger a `wiki_page_changed` broadcast, which the renderer flushes on the next IDLE frame.

Multi-display: the renderer clamps the avatar position to the union of `visible_bounds` reported by the daemon. Moving the avatar across displays is handled by the state machine's fast-travel animation, not by Swift-side window handoff.

### Pointer Input Authority

Daemon-normalized DesktopWorld input is the semantic authority for Sigil pointer
state. Hit canvases and DOM listeners are absorber/transport surfaces only. They
must not independently decide hover, drag, fast-travel, menu selection, or cancel
semantics unless explicitly documented as a temporary convergence adapter with a
removal gate.

If a hit canvas forwards native DOM events, the renderer must immediately
normalize them into the same DesktopWorld event path used by daemon `input_event`
delivery. Do not add a parallel DOM-owned interaction stream for convenience.

Interactive Sigil surfaces must be ergonomic for AOS agents as well as humans.
Canvas-only visuals that represent actionable controls should have a small
child surface or equivalent AX-visible affordance with stable labels, adequate
target size, and daemon-routed behavior before tests reach for renderer debug
state. If the visual control is already rendered by the parent canvas, keep the
child surface's labels in ARIA/AX semantics rather than painting duplicate text
or tooltips into the user-facing composition. See
`docs/recipes/aos-app-accessibility-surfaces.md` for the repo-wide app and
toolkit contract.

### Content Server

The AOS daemon serves Sigil's HTML surfaces over localhost through the `sigil`
content root. No bundling is required; ES modules load over HTTP. Because Sigil
uses toolkit runtime modules for shared spatial helpers, repo-mode launch paths
must keep both the `sigil` and `toolkit` content roots aligned with the active
checkout.

## Dependencies

- **AOS daemon** — canvas management, IPC, pub/sub, content server
- **Three.js r128** — 3D rendering engine. Vendored at `renderer/vendor/three.min.js` (loaded by `renderer/index.html` and `tests/appearance-roundtrip.html`). No CDN at boot.

## Chat Canvas

The chat canvas (`chat/index.html`) is a bidirectional conversational surface.
Agents project into it; the canvas does not run its own model runtime or
transport adapter. Keep protocol details in [`chat/README.md`](chat/README.md),
and keep generic focus command behavior in
[`docs/api/aos.md`](../../docs/api/aos.md).
