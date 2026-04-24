# Agent OS — Ecosystem Architecture Blueprint

A macOS automation ecosystem built around a single unified Swift binary (`aos`) with Unix-style subcommand groups. An LLM orchestrator drives the binary by invoking subcommands and piping structured JSON between them. Subcommands are independent at the verb level — perception doesn't know about action, action doesn't know about projection — but they share one daemon, one socket, and one spatial contract.

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

### Shared Coordinate Model

The ecosystem uses explicit spatial layers. Only one of them is the shared
cross-surface world model:

| Layer | Origin | Used by |
|-------|--------|---------|
| **Native desktop compatibility** | Top-left of the macOS main display = `(0,0)` | AppKit/CoreGraphics boundary only; current daemon/native emissions |
| **DesktopWorld** | Top-left of the arranged full-display union = `(0,0)` | Canonical world for toolkit, Sigil, canvas-inspector, tests |
| **VisibleDesktopWorld** | Same DesktopWorld frame, restricted to visible bounds | Usable-area logic such as clamping |
| **LCS** (Local Coordinate System) | Top-left of captured region = `(0,0)` | `aos see` captures, `--xray` element bounds, annotations |

**LCS is what agents see during perception.** All perception output uses coordinates relative to the captured target — a display, a window, a cropped zone. `(0,0)` is always the top-left of whatever was captured. This means:
- Agents never do global screen math during perception
- Coordinates from one tool's output can be fed directly to another tool's input
- Foveated perception (cropping to a region) automatically filters out everything outside the crop

**DesktopWorld is the world map.**

- Origin is the top-left of the arranged display union, not the macOS main
  display.
- Flipping which display macOS marks as main must not renumber DesktopWorld if
  the display arrangement is otherwise unchanged.
- Non-visible holes inside the full union bounding box remain valid world
  coordinates.
- `--track union` canvases resolve in DesktopWorld, so a full union canvas
  should be `[0,0,w,h]` in that space.

**Native desktop compatibility is boundary-only.** Current daemon/native
sources still surface main-display-anchored coordinates in many places. Those
values exist for AppKit/CoreGraphics interop and must be re-anchored into
DesktopWorld before toolkit/app/test consumers treat them as shared world
coordinates.

**VisibleDesktopWorld is derived, not canonical.** Use it for usable-area logic
such as cursor/avatar clamping. Do not use it as the origin for the shared
world.

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
| `aos` voice | **Audio** — `aos say` (TTS), daemon-driven announcements, config-driven voice/rate, registry-backed provider-pluggable voice selection. STT (`aos listen` or similar) and persona routing land here as extensions | AVFoundation / NSSpeechSynthesizer | Production (TTS); STT + persona planned |
| `aos` communication | **Communication** — `aos tell` (outbound: TTS, channels, direct session routing, presence), `aos listen` (inbound: channel/direct-session reads and follow today; STT and aggregated sources later). Daemon routes by audience/source. | Foundation (daemon socket), AVFoundation (TTS/STT) | Production for daemon-native coordination; STT + broader inbound aggregation planned |

All capability ships inside the unified `aos` binary (`src/perceive/`, `src/display/`, `src/act/`, `src/voice/`). No per-capability standalone CLI escape hatches — new audio/perception/action functionality lands as subcommands on the existing subsystems.

### Verb Taxonomy: Unified Communication

The verb vocabulary follows an embodied metaphor. Communication is one primitive — the daemon routes by audience and source:

| Verb | What the agent does | What the daemon handles |
|------|--------------------|-----------------------|
| `see` | Perceive the environment | Screen, cursor, AX tree |
| `do` | Act on the environment | CGEvents, AX actions, AppleScript |
| `show` | Project visuals | Canvases, overlays, render |
| `tell` | Communicate outward | Routes to TTS, channels, future sinks |
| `listen` | Receive communication | Aggregates STT, channels, stdin, future sources |

The agent decides WHAT to communicate and TO WHOM. The daemon decides HOW to deliver it. This follows the first principle above: agent tokens are for decisions, not plumbing.

**`say` is sugar for `tell human`.** It stays as a convenience — short, intuitive, already shipped — but it's not a separate primitive. When `tell` gains new capabilities, `say` inherits them.

**`do tell` is a different level.** AppleScript `do tell` talks to *apps*. `tell` talks to *agents and humans*. Three tiers: human (`tell human`), agent (`tell <channel>`), app (`do tell`).

### Browser as a target

As of spec `docs/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`, a browser tab is a first-class target for `see`, `do`, and `show` verbs. The adapter lives entirely in the CLI process (`src/browser/`) and shells out to Microsoft's `playwright-cli`; the daemon is unchanged. Targets use the grammar `browser:<session>[/<ref>]` where `<session>` is the `playwright-cli -s=<name>` session (registered as an aos focus channel) and `<ref>` is a ref from a prior `aos see capture browser:<session> --xray`. Overlays anchored to browser elements are static in v1 — they follow Chrome window movement (via `anchor_window`) but not page scroll; agents re-issue `aos show update --anchor-browser …` to re-anchor.

### Communication Routing

```
aos tell <audience> "message"
         │
         ▼
      daemon (arbiter)
         ├─→ TTS engine         (audience = human)
         ├─→ channel post       (audience = session/channel)
         ├─→ both               (audience = human,channel)
         └─→ future sinks       (Slack, push, webhook)

aos listen <channel>|--session-id <canonical-session-id>
         ▲
      daemon (arbiter)
         ├── STT engine         (source = human)
         ├── channel message    (source = agent)
         ├── stdin pipe         (source = bash)
         └── future sources     (webhook, file watch)
```

The daemon routes based on config (`aos set voice.*`), presence (which sessions are online), and channel state. This is a natural extension of the daemon's existing responsibilities — it already manages voice config, canvases, and perception state.

### Coordination Bus

The daemon hosts the coordination bus natively — channels, messages, presence. No separate process required. `aos tell` and `aos listen` talk to the daemon over its existing Unix socket, the same way `aos see` and `aos show` do.

Session presence is keyed by canonical `session_id` / thread id. Human-readable names remain ancillary metadata for `/who` output and operator ergonomics; direct session messaging should target the canonical session id channel.
Presence is mirrored into the runtime state dir and restored on daemon restart. `/who` is advisory discovery; once a peer session id is known, direct `--session-id` routing is the stable coordination path.

The MCP gateway (`packages/gateway/`) is an optional adapter that wraps the daemon's communication bus for external consumers who want MCP integration. It is not loaded during development inside agent-os. The daemon is the source of truth; the gateway is a view.

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
| `gateway` | Coordination | Node.js/TS | `packages/gateway/` | Production (v1) | MCP server plus local integration broker: typed script execution, session registration, cross-harness pub/sub, provider-neutral chat workflows/jobs, live workflow registry discovery from `aos wiki`, structured workflow launches, queued job completion notifications, SQLite-backed state |
| `host` | Runtime | Node.js/TS | `packages/host/` | v1 shipped | Anthropic SDK agent loop, session store (SQLite), sigil bridge, tool registry |
| `toolkit` | Web components | JS/HTML | `packages/toolkit/` | Active | Reusable WKWebView components: base class, shared theme, canvas-inspector, integration-hub, legacy single-file overlays |
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

A **union canvas** is an AOS canvas whose bounds span the full DesktopWorld
bounding box of the current display arrangement. It exists so agent-presence
surfaces — Sigil's avatar, ghost trails, inter-display effects — can render
across display boundaries with a single transparent overlay.

### Invariants

1. **Coordinate system.** DesktopWorld coordinates (top-left origin, Y-down). Union canvases, toolkit minimaps, Sigil stage projection, and cross-surface tests use this frame. Native main-display-anchored coordinates are boundary compatibility only.
2. **Transparent + passthrough by default.** A union canvas is non-interactive — clicks pass through to whatever's underneath. Interactive affordances (e.g., Sigil's avatar hit target) are spawned as separate child canvases positioned over specific regions.
3. **One canvas, one owner.** A given union canvas has a single owning app (e.g., Sigil owns `avatar-main`). Multi-tenant union canvases are out of scope; composition happens by stacking multiple independently-owned canvases.
4. **Opt-in topology tracking.** A union canvas created with `--track union` resolves its bounds from the current display topology and auto-updates on topology changes. Canvases created with literal `--at` values stay at their spawn-time bounds regardless of topology changes.
5. **Position data stays out of canvases.** Any per-agent / per-entity position state (e.g., "where the avatar was last") lives in the owning app's state, not in the canvas subsystem. The canvas only knows about its bounds.

### Coordinate system contract

- `display_geometry` carries enough information to derive two unions:
  - full DesktopWorld from display `bounds`
  - VisibleDesktopWorld from `visible_bounds`
- Union canvases and union-canvas bounds mean **full DesktopWorld**.
- Cursor/avatar clamping and other usable-area logic should use
  **VisibleDesktopWorld** where appropriate.
- Re-anchoring from native boundary coordinates into DesktopWorld happens at
  the shared runtime boundary for toolkit/app/test consumers.
- Switching the macOS main display without changing Arrange geometry must not
  change DesktopWorld coordinates for the same visual location.

### Lifecycle

- **Creation.** `aos show create --id <name> --track union --url ...` — the canvas's tracking target is stored by the daemon. Bounds resolve from the current full DesktopWorld topology snapshot. Callers who want a snapshot-only canvas should prefer `--track union` over a shell-substituted `--at`: `aos runtime display-union` now prints the canonical DesktopWorld shape (origin (0,0)), while `aos show create --at` remains a native-compat rect. Use `aos runtime display-union --native` if you deliberately need the legacy native-compat shape.
- **Topology change.** Daemon observes `NSApplication.didChangeScreenParametersNotification`, coalesces 100ms, re-resolves bounds for every canvas whose `track == union`, then rebroadcasts `display_geometry`. Renderers see their canvas already sitting in the new bounds by the time they receive the event.
- **Destruction.** `aos show remove --id <name>` cascades to child canvases registered under the parent. No change for union canvases specifically.

### Known gaps

Tracked as sub-issues under the umbrella #50. Do not duplicate the list here — the issue is the source of truth.

### Moniker

"Union canvas" is the technical name in specs and code (matches `computeUnion`, `display-union`). User-facing speech can stay informal ("the desktop avatar," "the desktop canvas"). Avoid "global canvas" — too vague.

---

Open design questions and future work are tracked in GitHub Issues, not in this file. See the `enhancement` label for active design work.
