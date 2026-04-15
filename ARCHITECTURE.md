# Agent OS — Ecosystem Architecture Blueprint

A macOS automation ecosystem built around a single unified Swift binary (`aos`) with Unix-style subcommand groups. An LLM orchestrator drives the binary by invoking subcommands and piping structured JSON between them. Subcommands are independent at the verb level — perception doesn't know about action, action doesn't know about projection — but they share one daemon, one socket, and one coordinate contract.

## 1. Philosophy & Design Principles

### Agent Tokens Are For Decisions, Not Plumbing

The agent (LLM) is the brain. The daemon is the nervous system. The agent decides WHAT to do and WHY; the daemon handles HOW — finding elements, tracking the cursor, converting text to speech, showing visual feedback. To serve this, OS-layer capability ships as a single binary (`aos`) with subcommand groups (`see`, `show`, `do`, `say`) over one daemon, one socket, one CGEventTap, and shared state. Separate CLIs per capability wasted agent tokens on inter-tool plumbing and fragmented state across sockets that had to be kept in sync. **The unified binary is the canonical architecture.** Any doc language suggesting per-capability standalone CLIs is drift from an earlier iteration — squash it.

### Unix-Style Composition

Within the unified binary, each subcommand does one thing. Perception is separate from action. Action is separate from projection. Voice is separate from vision. Subcommands communicate through structured JSON on stdout (success) and stderr (errors). An orchestrator — any orchestrator — pipes them together.

`aos see`, `aos show`, `aos do`, and `aos say` are independently useful at the verb level: a consumer can use perception without action, action without projection. The binary is the shared runtime; the subcommand is the unit of composition.

### JSON-First I/O Contract

Every tool in the ecosystem follows the same output contract:

**Success** (stdout, exit 0):
```json
{
  "status": "success",
  "...": "tool-specific payload"
}
```

**Failure** (stderr, exit 1):
```json
{
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE"
}
```

No tool emits unstructured text. No tool requires interactive input during normal operation. An LLM can parse every response without heuristics.

### Two-Layer Coordinate System

The ecosystem uses two coordinate layers that compose cleanly:

| Layer | Origin | Used by |
|-------|--------|---------|
| **Global CG** | Top-left of primary display = `(0,0)` | Spatial topology (`shared/schemas/spatial-topology.schema.json`), `aos do` targeting, display arrangement |
| **LCS** (Local Coordinate System) | Top-left of captured region = `(0,0)` | `aos see` captures, `--xray` element bounds, annotations |

**LCS is what agents see.** All perception output uses coordinates relative to the captured target — a display, a window, a cropped zone. `(0,0)` is always the top-left of whatever was captured. This means:
- Agents never do global screen math during perception
- Coordinates from one tool's output can be fed directly to another tool's input
- Foveated perception (cropping to a region) automatically filters out everything outside the crop

**Global CG is the world map.** The spatial topology model uses global coordinates so `aos do` can translate window-relative positions to absolute click targets. Converting between layers: LCS → Global = add display/window origin; Global → LCS = subtract it.

See `shared/schemas/spatial-topology.md` for the full coordinate system specification.

### Sensor / Actuator / Projection Separation

The ecosystem draws hard lines between three categories of capability:

| Category | What it does | Example |
|----------|-------------|---------|
| **Sensor** | Reads state, emits structured data | `aos see` captures pixels + AX tree |
| **Actuator** | Changes state, synthesizes events | `aos do` fires CGEvent clicks |
| **Projection** | Renders visual feedback for humans | The display subsystem (`src/display/`) draws floating overlays |

No tool crosses these boundaries. A sensor never mutates. An actuator never renders UI. A projection never captures.

### "Mirror, Don't Reinvent"

When exposing capabilities to agents, use APIs they already know from pre-training. Prefer standard idioms (Playwright method signatures, `chrome.*` APIs, shell-style subcommand grammar) over custom DSLs. An agent that already knows the source API knows how to drive the tool.

---

## 2. The OS Layer — the `aos` Binary

A single Swift binary using only Apple frameworks. Zero external dependencies. Manages its own macOS permissions (Screen Recording, Accessibility, Microphone). Treats the computer as a physical object — pixels, mouse events, audio hardware.

| Subsystem | Role | Frameworks | Status |
|-----------|------|------------|--------|
| `aos` perception | **Perception** — screenshots, AX tree traversal, spatial metadata, focus channels, graph navigation | ScreenCaptureKit, ApplicationServices, CoreGraphics | Production |
| `aos` action | **Action** — multi-backend actuator: AX semantic actions, CGEvent physical input, AppleScript app verbs, behavioral profiles, focus channels, session mode | ApplicationServices (AX), CoreGraphics (CGEvent), Foundation (NSAppleScript) | Production |
| `aos` display | **Projection** — display server: persistent WKWebView canvases, `aos serve` daemon, content HTTP server, render mode (HTML→bitmap) | WebKit (WKWebView), AppKit (NSWindow) | Production |
| `aos` voice | **Audio** — `aos say` (TTS), daemon-driven announcements, config-driven voice/rate. STT (`aos listen` or similar) and persona routing land here as extensions | AVFoundation / NSSpeechSynthesizer | Production (TTS); STT + persona planned |
| `aos` coordination | **Coordination** — `aos tell` (post messages, register presence), `aos hear` (receive messages). Agent-to-agent communication over daemon channels | Foundation (daemon socket) | Planned |

All capability ships inside the unified `aos` binary (`src/perceive/`, `src/display/`, `src/act/`, `src/voice/`). No per-capability standalone CLI escape hatches — new audio/perception/action functionality lands as subcommands on the existing subsystems.

### Verb Taxonomy: The 2×2

The verb vocabulary follows an embodied metaphor with two axes — audience (human vs agent) and direction (produce vs receive):

|  | **Human-facing** | **Agent-facing** |
|--|------------------|------------------|
| **Agent produces** | `say` (speak aloud) | `tell` (send message) |
| **Agent receives** | `listen` (STT, planned) | `hear` (receive messages) |

The environment-facing verbs (`see`/`do`) perceive and act on the physical desktop. The human-facing verbs (`say`/`show`/`listen`) communicate with the user via voice and visuals. The agent-facing verbs (`tell`/`hear`) coordinate between agent sessions.

`do tell` (AppleScript tell blocks) is not the same verb — it talks to *apps*, not agents. Three tiers of communication: human (`say`), agent (`tell`), app (`do tell`).

### Coordination Bus

The daemon hosts the coordination bus natively — channels, messages, presence. `aos tell` and `aos hear` talk to the daemon over its existing Unix socket, the same way `aos see` and `aos show` do. No separate process required.

The MCP gateway (`packages/gateway/`) is an optional adapter that wraps the daemon's coordination bus for external consumers who want MCP integration. It is not loaded during development inside agent-os. The daemon is the source of truth; the gateway is a view.

Channels inherit runtime mode isolation (repo channels don't crosstalk with installed channels) and wiki namespace conventions (apps scope channels under their namespace, system channels are root-level). See the design spec: `docs/superpowers/specs/2026-04-15-tell-hear-coordination-verbs-design.md`.

All subsystems share the LCS convention. All emit JSON. All are stateless at the subcommand level — the daemon and orchestrator hold state.

---

## 3. Component Roster

### Monorepo Structure

The `aos` unified binary is the canonical primitive. `packages/` holds supporting Node.js services (MCP gateway, agent host) and reusable WKWebView components. `apps/` holds Track 2 consumers.

```
agent-os/
  src/                   ← Unified aos binary
    perceive/            ← `aos see` — screenshots, AX tree, focus channels, graph nav
    display/             ← `aos show` — WKWebView canvases, overlays, render mode
    act/                 ← `aos do` — AX + CGEvent + AppleScript actuator
    voice/               ← `aos say` — TTS, daemon announcements (STT planned)
    content/             ← HTTP file server for WKWebView canvases
    daemon/              ← `aos serve` — UnifiedDaemon: socket, routing, autonomic
    commands/, shared/
  packages/
    toolkit/             ← Reusable WKWebView components for apps
    gateway/             ← Node.js MCP server — external consumer surface
    host/                ← Node.js agent host — Anthropic SDK loop, sessions
  apps/
    sigil/               ← Avatar presence system (consumer of display subsystem)
  shared/
    schemas/             ← Cross-tool JSON contracts
      spatial-topology.schema.json
      spatial-topology.md
      annotation.schema.json
      annotation.md
      daemon-event.schema.json
      daemon-event.md
    swift/ipc/           ← Shared Swift IPC helpers (runtime paths, socket client)
  ARCHITECTURE.md        ← This file
```

| Component | Layer | Language | Location | Status | Key Capabilities |
|-----------|-------|----------|----------|--------|-----------------|
| `aos` perception | OS | Swift | `src/perceive/` | Production | Screenshots, `--xray` AX tree, `--label` annotated screenshots, cursor query, selection query, focus channels, graph navigation, grids, overlays, zones, LCS |
| `aos` display | OS | Swift | `src/display/` + `src/content/` + `src/daemon/` | Production | Persistent WKWebView canvases (`aos show create/update/remove/eval`), render mode (HTML→bitmap), content HTTP server, autonomic projections, cascade cleanup |
| `aos` voice | OS | Swift | `src/voice/` | Production (TTS) | `aos say`, config-driven voice/rate, daemon event announcements; STT + persona planned |
| `aos` act | OS | Swift | `src/act/` | Production | `aos do click/hover/drag/scroll/type/key/press/focus/set-value/raise/session`; multi-backend (AX, CGEvent, AppleScript), behavioral profiles, focus channels |
| `gateway` | Coordination | Node.js/TS | `packages/gateway/` | Production (v1) | MCP server: typed script execution, session registration, cross-harness pub/sub, capability discovery, SQLite-backed state |
| `host` | Runtime | Node.js/TS | `packages/host/` | v1 shipped | Anthropic SDK agent loop, session store (SQLite), sigil bridge, tool registry |
| `toolkit` | Web components | JS/HTML | `packages/toolkit/` | Active | Reusable WKWebView components: base class, shared theme, canvas-inspector, legacy single-file overlays |
| Sigil | Track 2 app | HTML/JS | `apps/sigil/` | Active | Avatar presence system: renderer (Three.js state machine), Studio control surface, chat canvas. Consumer of `aos` display subsystem. |

---

## 4. Communication & Data Flow

### Between Subcommands and the Orchestrator

The orchestrator (whatever it is — Codex, Claude Code, a custom daemon) invokes `aos` subcommands as subprocesses:

```
Orchestrator
  |-- aos see capture --xray --base64  --> JSON { status, base64, elements }
  |-- aos do click 450,320              --> JSON { status: "success" }
  |-- aos show create --id orb --at ... --> JSON { id: "orb" }
  |-- aos say "Hello"                   --> JSON { status: "success" }
```

Each call is fire-and-forget. The subcommand does its job and exits. The orchestrator decides what to do next based on the JSON response. Persistent state — canvases, focus channels, behavioral profiles — lives in the daemon (`aos serve`), which the subcommands talk to over a Unix socket.

### The Feedback Loop

The agent's way of showing the human what it's doing is native macOS throughout:

1. `aos see capture --xray` perceives the screen
2. `aos show` draws a spotlight, overlay, or avatar canvas on the native desktop
3. `aos do click` fires at the identified coordinates
4. `aos say` narrates what happened

No DOM involved. Browser automation (if needed) is the orchestrator's concern and lives outside agent-os.

---

## 5. Union Canvas Foundation

A **union canvas** is an AOS canvas whose bounds span the bounding box of the current display arrangement ("union of displays"). It exists so agent-presence surfaces — Sigil's avatar, ghost trails, inter-display effects — can render across display boundaries with a single transparent overlay.

### Invariants

1. **Coordinate system.** Global CG coordinates (top-left origin, Y-down). The daemon reports `display_geometry` in this frame; all canvases and all position data share it. No per-display local frames at the canvas layer.
2. **Transparent + passthrough by default.** A union canvas is non-interactive — clicks pass through to whatever's underneath. Interactive affordances (e.g., Sigil's avatar hit target) are spawned as separate child canvases positioned over specific regions.
3. **One canvas, one owner.** A given union canvas has a single owning app (e.g., Sigil owns `avatar-main`). Multi-tenant union canvases are out of scope; composition happens by stacking multiple independently-owned canvases.
4. **Opt-in topology tracking.** A union canvas created with `--track union` resolves its bounds from the current display topology and auto-updates on topology changes. Canvases created with literal `--at` values stay at their spawn-time bounds regardless of topology changes.
5. **Position data stays out of canvases.** Any per-agent / per-entity position state (e.g., "where the avatar was last") lives in the owning app's state, not in the canvas subsystem. The canvas only knows about its bounds.

### Coordinate system contract

- `display_geometry` events carry an array of displays, each with global-frame `{x, y, w, h}` (top-left origin), a `visible_bounds` subset excluding the menu bar/dock, and an identifier. See `src/display/display-geometry.swift`.
- `computeUnion(displays)` (in the renderer) produces `{minX, minY, maxX, maxY, w, h}` — the tight bounding box around all displays.
- Negative coordinates are valid when a secondary display sits above or to the left of the primary. Apps must not assume `{0, 0}` is a valid upper-left.
- When an app stores absolute positions (e.g., Sigil's in-memory `lastPosition`), those coordinates remain absolute across display-topology changes. On topology change, positions outside the new union are expected to clamp to the union edge (handled by the renderer today; see `apps/sigil/renderer/index.html:2906-2929`).

### Lifecycle

- **Creation.** `aos show create --id <name> --track union --url ...` — the canvas's tracking target is stored by the daemon. Bounds resolve from the current display topology snapshot. Callers who want a snapshot-only canvas can still pass `--at $(aos runtime display-union)` (legacy shorthand) but it produces a static canvas that won't follow topology changes.
- **Topology change.** Daemon observes `NSApplication.didChangeScreenParametersNotification`, coalesces 100ms, re-resolves bounds for every canvas whose `track == union`, then rebroadcasts `display_geometry`. Renderers see their canvas already sitting in the new bounds by the time they receive the event.
- **Destruction.** `aos show remove --id <name>` cascades to child canvases registered under the parent. No change for union canvases specifically.

### Known gaps

Tracked as sub-issues under the umbrella #50. Do not duplicate the list here — the issue is the source of truth.

### Moniker

"Union canvas" is the technical name in specs and code (matches `computeUnion`, `display-union`). User-facing speech can stay informal ("the desktop avatar," "the desktop canvas"). Avoid "global canvas" — too vague.

---

Open design questions and future work are tracked in GitHub Issues, not in this file. See the `enhancement` label for active design work.
