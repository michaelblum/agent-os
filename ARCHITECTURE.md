# Agent OS — Ecosystem Architecture Blueprint

A macOS automation ecosystem built around `./aos` as a stable TCC capability
broker with a privileged IPC surface. An LLM orchestrator drives public command
behavior through hot-swappable manifests, scripts, packages, and recipes, while
the broker holds the permissioned process identity and exposes the smallest
durable set of privileged native facts, actions, and streams. Verb primitives
remain independent at the capability level - perception doesn't know about
action, action doesn't know about projection - but they share one daemon, one
socket, one runtime mode, and one spatial contract.

## 1. Philosophy & Design Principles

### Agent Tokens Are For Decisions, Not Plumbing

The agent (LLM) is the brain. The daemon is the nervous system. The agent
decides WHAT to do and WHY; the broker handles permission-gated native HOW -
finding elements, tracking the cursor, converting text to speech, showing
visual feedback, and emitting native state. To serve this, the permissioned
process identity stays unified in `./aos`: one TCC capability broker, one
daemon/socket substrate, one CGEventTap, and shared runtime state.

Public command behavior is not the broker's source of truth. Help metadata,
argument shape, recovery policy, workflow composition, next-action text, and
product behavior live in external composition layers whenever they can be built
from stable privileged facts, privileged actions, or privileged streams.
Separate per-capability broker binaries would fragment TCC identity and socket
state; putting public policy back into Swift would make the permission identity
high-churn. Both are architectural drift.

### Unix-Style Composition

At the stable primitive surface, each native capability does one thing.
Perception is separate from action. Action is separate from projection. Voice is
separate from vision. Agent-facing public command forms communicate through
structured JSON on stdout (success) and stderr (errors), but their command
behavior, help, and presentation are external unless a native primitive is
required. Discovery and user-facing surfaces, such as `aos help` without
`--json`, may intentionally default to text. An orchestrator - any orchestrator
- pipes the machine-readable forms together.

`aos see`, `aos show`, `aos do`, `aos tell`, and `aos listen` are independently
useful at the verb level: a consumer can use perception without action, action
without projection, or communication without display. The binary is the shared
permissioned runtime; the stable primitive and external public command route are
the units of composition.

### JSON-First I/O Contract

Agent-facing tools in the ecosystem expose the same machine-readable output
contract:

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

Agent-facing command forms should not require interactive input during normal
operation, and their machine-readable responses should be parseable without
heuristics. User-facing discovery surfaces may emit text by default when they
also expose a JSON form for agents.

### Shared Coordinate Model

The ecosystem uses explicit spatial layers. Only one of them is the shared
cross-surface world model:

| Layer | Origin | Used by |
|-------|--------|---------|
| **Native desktop compatibility** | Top-left of the macOS main display = `(0,0)` | AppKit/CoreGraphics boundary only; current daemon/native emissions |
| **DesktopWorld** | Top-left of the arranged full-display union = `(0,0)` | Canonical world for toolkit, external consumers, Surface Inspector, tests |
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
- `--track union` and `--surface desktop-world` canvases resolve in
  DesktopWorld. They expose one logical surface whose ordered physical segments
  cover the active displays.

**Native desktop compatibility is boundary-only.** Current daemon/native
sources still surface main-display-anchored coordinates in many places. Those
values exist for AppKit/CoreGraphics interop and must be re-anchored into
DesktopWorld before toolkit/app/test consumers treat them as shared world
coordinates.

**VisibleDesktopWorld is derived, not canonical.** Use it for usable-area logic
such as cursor/surface clamping. Do not use it as the origin for the shared
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

### Surface Ownership Boundary

AOS has a native compositor/kernel layer and an optional default surface system.
Keep those separate:

- The **daemon** owns native primitives: canvas lifecycle, native frames, display
  topology, content serving, input streams, coordination, and generic routing
  contracts. It should stay policy-light. It may expose the cheap primitives a
  windowing system needs, but it is not itself the default AOS window manager.
- The **toolkit** owns reusable policy for AOS surfaces: panel chrome, controls,
  workbench shells, minimize/maximize/restore, placement, DesktopWorld visual
  stages, and visual/interaction bindings. Toolkit windowing is opt-in and
  customizable; apps can use it, extend it, or bypass it for non-panel surfaces.
- **External apps** own product expression and domain behavior. Sigil is a
  first-party reference consumer in
  [`Ch-osctrl/sigil`](https://github.com/Ch-osctrl/sigil), not an AOS-owned
  product surface or a precedent for private platform forks. Sigil may drive
  product-neutral primitives, toolkit policy, hosts, schemas, and public CLI
  contracts before another consumer exists. Ownership follows the reusable
  boundary, not consumer count.

Performance bugs are boundary tests. A slow minimized chip does not imply that
the daemon should own minimize policy; it implies the toolkit is missing a cheap
daemon primitive or shared stage contract. App-specific daemon branches and
private full-display canvases are convergence debt unless they are explicitly
documented as temporary adapters with removal gates.

### "Mirror, Don't Reinvent"

When exposing capabilities to agents, use APIs they already know from pre-training. Prefer standard idioms (Playwright method signatures, `chrome.*` APIs, shell-style subcommand grammar) over custom DSLs. An agent that already knows the source API knows how to drive the tool.

---

## 2. The OS Layer - the `aos` Broker

A single Swift broker using only Apple frameworks. Zero external dependencies.
It manages the permissioned process identity for macOS capabilities such as
Screen Recording, Accessibility, Input Monitoring, and Microphone. It treats the
computer as a physical object - pixels, mouse events, audio hardware - and
exposes policy-free native primitives through the daemon/socket and private
broker command surface.

| Subsystem | Role | Frameworks | Status |
|-----------|------|------------|--------|
| `aos` perception | **Perception** - screenshots, AX tree traversal, spatial metadata, focus channels, graph navigation | ScreenCaptureKit, ApplicationServices, CoreGraphics | Production |
| `aos` action | **Action** - multi-backend actuator: AX semantic actions, CGEvent physical input, AppleScript app verbs, behavioral profiles, focus channels, session mode | ApplicationServices (AX), CoreGraphics (CGEvent), Foundation (NSAppleScript) | Production |
| `aos` display | **Projection** - display server: persistent WKWebView canvases, `aos serve` daemon, content HTTP server, render mode (HTML to bitmap) | WebKit (WKWebView), AppKit (NSWindow) | Production |
| `aos` voice | **Audio transport** - `aos say` direct TTS convenience, streamed system speech, bounded microphone-to-WAV capture, meters, `aos voice` registry/catalog/assignments/providers/final-response speech ingress, and config-driven voice/rate. Transcription is consumer-owned | AVFoundation / NSSpeechSynthesizer | Production (transport + TTS + registry) |
| `aos` communication | **Communication** - `aos tell` routes outward; `aos listen` receives channel/direct-session messages, exact global hotkeys, and bounded microphone capture. Daemon routes by audience/source without owning product dictation policy. | Foundation (daemon socket), AVFoundation | Production |

Privileged native capability ships through the unified `aos` broker
(`src/perceive/`, `src/display/`, `src/act/`, `src/voice/`, `src/daemon/`).
No per-capability standalone broker binaries or socket islands: new privileged
audio, perception, action, display, communication, or lifecycle functionality
lands as stable broker primitives on the existing substrate. Public command
behavior and composition stay outside Swift unless they are true
bootstrap/native primitive surfaces. See
`docs/adr/0015-aos-tcc-capability-broker-boundary.md` and
`docs/dev/command-surface.md`.

### Verb Taxonomy: Unified Communication

The verb vocabulary follows an embodied metaphor. Communication is one primitive — the daemon routes by audience and source:

| Verb | What the agent does | What the daemon handles |
|------|--------------------|-----------------------|
| `see` | Perceive the environment | Screen, cursor, AX tree |
| `do` | Act on the environment | CGEvents, AX actions, AppleScript |
| `show` | Project visuals | Canvases, overlays, render |
| `tell` | Communicate outward | Routes to TTS, channels, future sinks |
| `listen` | Receive communication | Channels, direct sessions, exact hotkeys, and bounded microphone capture |

The agent decides WHAT to communicate and TO WHOM. The daemon decides HOW to deliver it. This follows the first principle above: agent tokens are for decisions, not plumbing.

**`say` is conceptually aligned with `tell human`.** It stays as a convenience
path for direct TTS — short, intuitive, already shipped — while `tell human` is
the daemon-routed communication path that participates in audience routing,
presence, and future sinks.

**`do tell` is a different level.** AppleScript `do tell` talks to *apps*. `tell` talks to *agents and humans*. Three tiers: human (`tell human`), agent (`tell <channel>`), app (`do tell`).

### Browser as a target

A browser tab is a first-class target for `see`, `do`, and `show` verbs. The adapter lives entirely in the CLI process (`src/browser/`) and shells out to Microsoft's `playwright-cli`; the daemon is unchanged. Direct browser targets use the grammar `browser:<session>[/<ref>]` where `<session>` is the `playwright-cli -s=<name>` session (registered as an aos focus channel) and `<ref>` is a volatile adapter ref from current browser perception. For normal observe-act loops, agents capture `aos see capture browser:<session> --save --mode som --workspace <id>`, inspect `aos see refs`, and act through scoped saved refs such as `ref:<snapshot-id>:<ref>`; saved-ref dispatch validates the current browser target before routing through the underlying direct `browser:<session>/<ref>` action. Overlays anchored to browser elements still take direct Target-with-Ref input and are static in v1 — they follow Chrome window movement (via `anchor_window`) but not page scroll; agents re-issue `aos show update --anchor-browser …` to re-anchor. Historical adapter design context is archived at `docs/archive/superpowers/specs/2026-04-24-playwright-browser-adapter-design.md`.

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
aos listen --source hotkey|microphone --follow
         ▲
      daemon (arbiter)
        ├── channel message    (source = agent)
        ├── direct-session msg (source = session)
        ├── exact key chord    (source = hotkey)
        └── bounded WAV        (source = microphone)
```

The public `listen` surface reads channels and direct-session messages and
exposes permissioned hotkey and microphone transport. AOS does not transcribe
the WAV or decide whether captured text is sent. Stdin ingestion, webhooks, and
file-watch inputs remain unimplemented. The daemon routes based on config
(`aos set voice.*`), presence (which sessions are online), and channel state.
This is a natural extension of the daemon's existing responsibilities — it
already manages voice config, canvases, and perception state.

### Coordination Bus

The daemon hosts the coordination bus natively — channels, messages, presence. No separate process required. `aos tell` and `aos listen` talk to the daemon over its existing Unix socket, the same way `aos see` and `aos show` do.

Session presence is keyed by canonical `session_id` / thread id. Human-readable names remain ancillary metadata for `/who` output and operator ergonomics; direct session messaging should target the canonical session id channel.
Presence is mirrored into the runtime state dir and restored on daemon restart. `/who` is advisory discovery; once a peer session id is known, direct `--session-id` routing is the stable coordination path.

The MCP gateway (`packages/gateway/`) is an optional adapter that wraps the daemon's communication bus for external consumers who want MCP integration. It is not loaded during development inside agent-os. The daemon is the source of truth; the gateway is a view.

Channels inherit runtime mode isolation (repo channels don't crosstalk with installed channels) and wiki namespace conventions (apps scope channels under their namespace, system channels are root-level). Historical coordination-bus design context is archived at `docs/archive/superpowers/specs/2026-04-15-tell-hear-coordination-verbs-design.md`.

All subsystems share the LCS convention. Agent-facing forms emit JSON. All are
stateless at the subcommand level — the daemon and orchestrator hold state.

---

## 3. Component Roster

### Monorepo Structure

The `aos` broker is the canonical permissioned native primitive substrate.
`packages/` holds supporting Node.js services, extracted CLI/daemon package
work, shared design tokens, and the reusable toolkit surface layer. `apps/`
holds retained compatibility fixtures; active branded products live in their
own repositories.

```
agent-os/
  src/                   ← Unified aos binary
    perceive/            ← `aos see` — screenshots, AX tree, focus channels, graph nav
    display/             ← `aos show` — WKWebView canvases, overlays, render mode
    commands/, shared/   ← external command dispatch and shared CLI helpers
    act/                 ← `aos do` — AX + CGEvent + AppleScript actuator
    voice/               ← `aos say` / `aos voice` — TTS, registry, assignments, final-response ingress
    content/             ← HTTP file server for WKWebView canvases
    daemon/              ← `aos serve` — UnifiedDaemon: socket, routing, autonomic
    commands/, shared/
  packages/
    toolkit/             ← Reusable surface layer: runtime, controls, panel, workbench, components
    design-tokens/       ← Shared CSS token source for toolkit and app surfaces
    cli/, daemon/        ← Extracted package roots for CLI/daemon-adjacent work
    gateway/             ← Node.js MCP server — external consumer surface
    host/                ← Node.js agent host — Anthropic SDK loop, sessions
  apps/
    sigil/               ← Frozen legacy compatibility/proof fixture
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
| `aos recipe` | Execution model | Swift dispatcher + Node recipe engine + JSON manifests | `manifests/commands/aos-external-commands.json`, `scripts/aos-recipe.mjs`, `recipes/`, `shared/schemas/recipe*.schema.json` | v1 scaffold | Source-backed executable recipes that agents can list, explain, statically dry-run, and run; includes read-only `runtime/status-snapshot` plus owned-cleanup canvas smoke `canvas/window-level-smoke`. The old `aos ops` command surface is retired. |
| `aos` voice | OS | Swift | `src/voice/` + `src/daemon/voice-transport.swift` | Production (transport + TTS + registry) | `aos listen` hotkey/microphone streams, `aos say` streamed system speech, meters, `aos voice`, config-driven voice/rate, and final-response ingress; transcription remains consumer-owned |
| `aos` act | OS | Swift | `src/act/` | Production | `aos do click/hover/drag/scroll/type/key/press/focus/set-value/raise/session`; multi-backend (AX, CGEvent, AppleScript), behavioral profiles, focus channels |
| `gateway` | Coordination | Node.js/TS | `packages/gateway/` | Production (v1) | MCP server plus local integration broker: typed script execution, session registration, cross-harness pub/sub, provider-neutral chat workflows/jobs, live workflow registry discovery from `aos wiki`, structured workflow launches, queued job completion notifications, SQLite-backed state |
| `host` | Runtime | Node.js/TS | `packages/host/` | v1 shipped | Anthropic SDK agent loop, session store (SQLite), tool registry |
| `cli` / `daemon` packages | Packaging | JS/TS + assets | `packages/cli/`, `packages/daemon/` | Active | Package roots for CLI verbs and daemon-adjacent runtime surfaces that sit around the unified Swift primitive |
| `design-tokens` | Design system | CSS | `packages/design-tokens/` | Active | Shared token source consumed by toolkit and app surfaces |
| `toolkit` | Toolkit/default surface system | JS/HTML/CSS | `packages/toolkit/` | Active | Opt-in reusable AOS surface policy and stock surfaces: `runtime/`, `controls/`, `adapters/zag`, `panel/`, `workbench/`, and `components/` |
| Sigil | External first-party reference consumer | TypeScript/HTML | [`Ch-osctrl/sigil`](https://github.com/Ch-osctrl/sigil) | External | Product authority for the Sigil application and primary driver of consumer-facing AOS evolution. The embedded `apps/sigil/` tree is a frozen, non-discoverable compatibility fixture only. |

---

## 4. Communication & Data Flow

### Between Subcommands and the Orchestrator

The orchestrator (whatever it is — Codex, Claude Code, a custom daemon) invokes `aos` subcommands as subprocesses:

```
Orchestrator
  |-- aos see capture --xray --base64  --> JSON { status, base64, elements }
  |-- aos recipe dry-run runtime/status-snapshot --json --> JSON { status: "dry_run", steps: [...] }
  |-- aos recipe run canvas/window-level-smoke --json   --> JSON { status, mutated_resources, cleanup }
  |-- aos do click 450,320              --> JSON { status: "success" }
  |-- aos show create --id orb --at ... --> JSON { id: "orb" }
  |-- aos say "Hello"                   --> JSON { status: "success" }
```

Each call is fire-and-forget when using an agent-facing JSON form. The
subcommand does its job and exits. The orchestrator decides what to do next
based on the JSON response. Persistent state — canvases, focus channels,
behavioral profiles — lives in the daemon (`aos serve`), which the subcommands
talk to over a Unix socket.

### The Feedback Loop

The agent's native screen/canvas loop is macOS-first:

1. `aos see capture --xray` perceives the screen
2. `aos show` draws a spotlight, overlay, or app canvas on the native desktop
3. `aos do click` fires at the identified coordinates
4. `aos say` narrates what happened

Browser and DOM work is also an in-repo target adapter through
`browser:<session>[/<ref>]`. The browser adapter remains outside the daemon
kernel, but it is not outside agent-os: `aos see` and `aos do` can target
browser sessions through the CLI adapter when a task is DOM/ARIA scoped.

---

## 5. Union Canvas Foundation

A **DesktopWorld surface** is an AOS canvas primitive whose contract is to draw
across the active DesktopWorld. It keeps one logical canvas id and is backed by
one native window/web view segment per active display. The legacy `--track
union` flag creates this primitive for compatibility; `--surface desktop-world`
is the canonical name.

### Invariants

1. **Coordinate system.** DesktopWorld coordinates (top-left origin, Y-down). DesktopWorld surfaces, toolkit minimaps, external product projections, and cross-surface tests use this frame. Native main-display-anchored coordinates are boundary compatibility only.
2. **Transparent + passthrough by default.** A DesktopWorld surface is non-interactive — clicks pass through to whatever's underneath. Interactive affordances are spawned as separate child canvases positioned over specific regions.
3. **One native surface, one owner.** A raw DesktopWorld surface has one owner.
   A shared DesktopWorld stage is one toolkit-owned surface that exposes a layer
   API to multiple consumers. Apps should prefer the shared stage for ordinary
   desktop-wide visuals and create private full-coverage surfaces only when they
   need a special renderer, lifecycle, or isolation boundary.
4. **Opt-in topology tracking.** A DesktopWorld surface created with `--surface desktop-world` or `--track union` resolves its segments from the current display topology and auto-updates on topology changes. Canvases created with literal `--at` values stay at their spawn-time bounds regardless of topology changes.
5. **Position data stays out of canvases.** Any per-agent / per-entity position state, including product-specific resume positions, should live in the owning app or toolkit state. The daemon exposes a generic `position.get` / `position.set` key-value path for callers that still need it, but the canvas subsystem must not infer product semantics from IDs, URLs, or keys. The canvas itself only knows about its bounds.

### Coordinate system contract

- `display_geometry` carries enough information to derive two unions:
  - full DesktopWorld from display `bounds`
  - VisibleDesktopWorld from `visible_bounds`
- DesktopWorld surface bounds and segment `dw_bounds` mean **full DesktopWorld**.
- Cursor/surface clamping and other usable-area logic should use
  **VisibleDesktopWorld** where appropriate.
- Re-anchoring from native boundary coordinates into DesktopWorld happens at
  the shared runtime boundary for toolkit/app/test consumers.
- Switching the macOS main display without changing Arrange geometry must not
  change DesktopWorld coordinates for the same visual location.

### Lifecycle

- **Creation.** `aos show create --id <name> --surface desktop-world --url ...` creates the canonical logical surface. `--track union` remains a compatibility alias. The daemon creates an ordered segment per active display and exposes the segment snapshot through `CanvasInfo.segments` and `canvas_topology_settled`.
- **Topology change.** Daemon observes `NSApplication.didChangeScreenParametersNotification`, coalesces 100ms, re-resolves the segment set for every DesktopWorld surface, emits segment deltas, then emits a full `canvas_topology_settled` snapshot and rebroadcasts `display_geometry`.
- **Destruction.** `aos show remove --id <name>` cascades to child canvases registered under the parent. No change for DesktopWorld surfaces specifically.

### Known gaps

Tracked under the active AOS Surface System epic (#223) and the current
surface-boundary alignment plan in `docs/design/`. Do not duplicate issue-level
task lists here.

### Moniker

"Union canvas" is the technical name in specs and code (matches `computeUnion`, `display-union`). User-facing speech can stay informal ("the desktop surface," "the desktop canvas"). Avoid "global canvas" — too vague.

---

Open design questions and future work are tracked in GitHub Issues, not in this file. See the `enhancement` label for active design work.
