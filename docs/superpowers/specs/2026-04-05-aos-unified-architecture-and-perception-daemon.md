# AOS: Unified Architecture & Perception Daemon

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Unification of agent-os packages into a single binary, perception daemon design, autonomic configuration layer, toolkit layer

## 1. Overview

Agent-os consolidates from separate CLI tools (side-eye, heads-up, hand-off, speak-up) into a single binary (`aos`) with subcommand groups. A unified daemon (`aos serve`) runs all modules in one process with shared state, one Unix socket, and one CGEventTap. The perception daemon is the first new capability built on this foundation.

### Design Principle: Agent Tokens Are For Decisions, Not Plumbing

The agent (LLM) is the brain. The daemon is the nervous system. The agent decides WHAT to do and WHY. The daemon handles HOW — finding elements, tracking the cursor, converting text to speech, showing visual feedback. The agent never spends tokens on plumbing that the system can handle autonomically.

## 2. Unified Binary

### Command Structure

```
aos see ...       # perception (was side-eye)
aos show ...      # display (was heads-up)
aos do ...        # action (was hand-off)
aos say ...       # voice (was speak-up)
aos set ...       # configure autonomic modes
aos serve         # start unified daemon
```

### One-Shot Mode

Commands work standalone without a daemon running:

```bash
aos see cursor              # what's under the cursor, exit
aos see capture             # screenshot, exit
aos show render --html ..   # rasterize to PNG, exit
aos do click 450,320        # click and exit
aos say "task complete"     # speak and exit
```

### Daemon Mode

`aos serve` starts a single process hosting all modules. One Unix socket at `~/.config/aos/sock`. One CGEventTap. Shared state between modules.

When the daemon is running, one-shot commands auto-route through it (shared state, lower overhead). Detection: try connecting to `~/.config/aos/sock` — if it succeeds, route through daemon; if not, run standalone. When it's not running, commands work independently.

### Internal Structure

The code stays modular — separate files per module, clean dependency direction:

```
src/
  main.swift              # entry point, subcommand routing
  shared/                 # envelope, socket helpers, coordinate math, config
  perceive/               # perception module
  display/                # display server module
  act/                    # actuator module
  voice/                  # voice I/O module (future)
```

Dependency direction: `shared` ← `perceive` ← `display` (display can consume perception events for auto-projection). `act` depends on `shared` and optionally `perceive` (for element resolution). No module depends on `voice`. `voice` depends on `shared` only.

## 3. Perception Daemon

### The Model: Depth × Scope × Rate

Perception has three dimensions:

**Depth** — how much detail to extract:

| Depth | What You Learn | Cost | Trigger |
|-------|---------------|------|---------|
| 0 | Cursor position, velocity, which display | Free | CGEventTap (always on) |
| 1 | Which window, which app, window bounds | Cheap | On window boundary cross |
| 2 | AX element at cursor — role, title, label, bounds, context_path | Moderate | On cursor settle (~200ms) or element boundary cross |
| 3 | AX subtree — siblings, parent, children of element | Expensive | On demand only |

Higher depths include everything below them.

**Scope** — where to look:

| Scope | Meaning |
|-------|---------|
| `cursor` | Follows the cursor (default) |
| `window:<id>` | Locked to a specific window |
| `app:<name>` | All windows of an app |
| `rect:<x,y,w,h>` | A screen region |
| `subtree:<path>` | An AX subtree within a scoped target |

**Rate** — how often to report:

| Rate | Meaning |
|------|---------|
| `continuous` | Every event/movement |
| `on-change` | Only when the observed value changes |
| `on-settle` | Only when cursor stops moving (settle threshold) |

### Perception Channels

Consumers open perception channels by specifying depth + scope + rate:

```json
{"action": "perceive", "depth": 2, "scope": "cursor", "rate": "on-settle"}
```

The daemon maintains an **attention envelope** — the union of all active perception channels. It does the minimum work to satisfy all consumers. When nobody needs depth 2, AX queries don't run. When nobody's connected, the daemon idles.

Multiple consumers at the same depth/scope share observations — the query runs once.

### Perception Events

All events use the standard daemon envelope (see `shared/schemas/daemon-event.schema.json`):

```json
{"v":1,"service":"perceive","event":"cursor_moved","ts":1712345678.123,"data":{"x":450,"y":320,"display":1,"velocity":12.5}}
```

| Event | Depth | Data |
|-------|-------|------|
| `cursor_moved` | 0 | `{x, y, display, velocity}` |
| `cursor_settled` | 0 | `{x, y, display, idle_ms}` |
| `window_entered` | 1 | `{window_id, app, pid, bounds}` |
| `app_entered` | 1 | `{app, pid, bundle_id}` |
| `element_focused` | 2 | `{role, title, label, value, bounds, context_path}` |
| `element_detail` | 3 | `{...element_focused, children, parent, siblings}` |

### X-Ray and Focus Beam — Unified

These existing concepts map directly to the perception model:

- **X-ray** = high depth. `aos see xray` is perception at depth 2-3 across a region. Not a separate feature — it's a depth setting.
- **Focus beam** = narrow scope. A focus channel is perception locked to a specific window/subtree. Not a separate feature — it's a scope setting.
- **Inspect overlay** (the original shower thought) = depth 2, scope cursor, rate on-settle, rendered via a toolkit component.

### CGEventTap Ownership

The daemon owns the single CGEventTap for the system. All mouse and keyboard input flows through it. No other process (including sigil) runs its own event tap. Consumers subscribe to the perception stream for input events.

This eliminates:
- Multiple event taps competing for system resources
- Each app reimplementing click-vs-drag detection
- Inconsistent input handling across consumers

## 4. Autonomic Configuration

### Config File

```
~/.config/aos/config.json
```

The daemon reads this at startup and watches it for changes (FSEvents). Any change takes effect immediately — no restart needed.

```json
{
  "voice": {
    "enabled": false,
    "engine": "system",
    "voice": "Samantha",
    "announce_actions": true
  },
  "perception": {
    "default_depth": 1,
    "settle_threshold_ms": 200
  },
  "feedback": {
    "visual": true,
    "sound": false
  }
}
```

### Multiple Paths to Configure

1. **User edits JSON directly** — text editor, full control
2. **Settings panel** — toolkit component rendered via `aos show`, visual toggles
3. **User tells the agent** — "I want to hear your voice" → agent runs `aos set voice.enabled true`
4. **CLI** — `aos set voice.enabled false`, `aos set perception.default_depth 2`

All paths write to the same file. The daemon picks up changes. No special plumbing per path.

### Autonomic Behaviors

When configured, these run continuously without agent involvement:

- **Voice**: all agent output piped through TTS automatically
- **Perception**: daemon monitors at configured depth, pushes context to agent without being asked
- **Feedback**: visual/audio confirmation of actions happens automatically
- **Announce actions**: when voice is on and announce_actions is true, the daemon speaks what it's doing ("clicking Reply in Slack") without the agent composing the utterance

The agent doesn't decide per-turn whether to speak or show feedback. The system just does it based on config. The agent focuses on decisions.

## 5. Toolkit Layer

### Location

```
packages/toolkit/
  components/       # HTML/CSS/JS templates for heads-up canvases
  patterns/         # reusable Swift patterns (daemon-subscriber, gesture recognizer)
```

### Relationship to AOS

```
┌─────────────────────────────┐
│  Apps (sigil, future apps)  │  Track 2 — opinionated
├─────────────────────────────┤
│  Toolkit (reusable pieces)  │  Shared components on AOS primitives
├─────────────────────────────┤
│  AOS (unified daemon/CLI)   │  Track 1 — unopinionated
└─────────────────────────────┘
```

AOS provides raw capabilities. Toolkit provides prefab components (inspector panel, settings panel, gesture recognizer, log console). Apps import toolkit components and add personality.

### Toolkit Components (Planned)

| Component | Type | Description |
|-----------|------|-------------|
| `daemon-subscriber.swift` | Pattern | Generic reconnecting subscriber for AOS daemon events (exists) |
| `cursor-decor.html` | Component | Three.js shape following cursor (exists, moved from sigil) |
| `gesture-recognizer.swift` | Pattern | Click/drag/long-press detection from perception events (planned) |
| `inspector-panel.html` | Component | AX element metadata display for inspect mode (planned) |
| `settings-panel.html` | Component | Visual config editor for `config.json` (planned) |
| `log-console.html` | Component | Scrolling log output panel (planned) |

## 6. Event Envelope

Already defined at `shared/schemas/daemon-event.schema.json`. Standard wire format for all daemon events:

```json
{"v":1,"service":"perceive","event":"cursor_moved","ts":1712345678.123,"data":{...}}
```

Five required fields: `v` (version), `service` (module), `event` (name), `ts` (timestamp), `data` (payload). Optional `ref` for correlation.

The `service` field uses module names: `"perceive"`, `"display"`, `"act"`, `"voice"`. These are the programmatic identifiers (matching internal directory names), distinct from the short CLI verbs (`see`, `show`, `do`, `say`). The existing `daemon-event.schema.json` enum (`"side-eye"`, `"heads-up"`, `"hand-off"`) will be updated during migration Phase 1.

## 7. Cross-Platform Portability

The protocol (event envelope, config format, socket IPC, perception model) is the portable layer. The daemon is platform-specific.

| Concept | macOS | Windows (future) |
|---------|-------|-------------------|
| Input capture | CGEventTap | SetWindowsHookEx |
| Window enumeration | CGWindowListCopyWindowInfo | EnumWindows |
| Accessibility tree | AXUIElement API | UI Automation |
| Overlay rendering | NSWindow + WKWebView | HWND + WebView2 |
| Socket IPC | Unix domain socket | Named pipes |

A Windows consumer using the same event envelope would work identically. The daemon implementation changes; the protocol doesn't.

## 8. Migration Path

### From Current Architecture

| Current | Becomes |
|---------|---------|
| `side-eye` binary | `aos see` subcommand group |
| `heads-up` binary | `aos show` subcommand group |
| `hand-off` binary | `aos do` subcommand group |
| `~/.config/heads-up/sock` | `~/.config/aos/sock` |
| `side-eye cursor` | `aos see cursor` |
| `heads-up create --id ball ...` | `aos show create --id ball ...` |
| `hand-off session` | `aos do session` |
| Sigil's CGEventTap | Subscribe to AOS perception stream |
| Sigil's avatar-ipc.swift | Use toolkit's daemon-subscriber.swift |
| radial-menu-config.json | Stays in sigil (app-specific) |

### Phased Approach

**Phase 1: Perception daemon + unified entry point**
- Build `aos` binary with `see` subcommands (perception module)
- Implement `aos serve` with perception daemon
- Depth 0-2 perception, cursor scope, all three rates
- Config file with perception settings
- One-shot `aos see cursor` / `aos see capture` working without daemon

**Phase 2: Fold in display**
- Merge heads-up code into `aos show` subcommands
- Unified socket (display + perception on same connection)
- Auto-projection uses live perception data (zero IPC)

**Phase 3: Fold in action**
- Merge hand-off code into `aos do` subcommands
- High-level intent commands: `aos do click --element 'Reply' --in Slack`
- Element resolution via perception module (shared process, no subprocess call)

**Phase 4: Voice + autonomic layer**
- `aos say` subcommands
- `aos set` for autonomic configuration
- Voice mode: daemon auto-speaks agent output when enabled
- Settings panel toolkit component

**Phase 5: Toolkit maturation**
- Gesture recognizer consuming perception events
- Inspector panel, log console, settings panel components
- Sigil refactored to use toolkit components + AOS perception stream

## 9. Open Questions

1. **Binary name**: `aos` assumed. Short, memorable, available? Or `agent-os` with `aos` as alias?
2. **Config file format**: JSON shown above. TOML or YAML better for human editing? JSON keeps consistency with schemas.
3. **Backwards compatibility period**: Should old `side-eye`/`heads-up` binaries be kept as thin wrappers during migration, or clean break?
4. **Settle threshold**: 200ms assumed for cursor settle. Needs empirical testing. Should be configurable.
5. **Perception depth 3 cost**: Full subtree queries on complex apps (Electron) could be slow. May need caching or incremental updates.
6. **Daemon auto-start**: Should `aos see cursor` auto-start the daemon if not running (like heads-up does today), or stay strictly one-shot?
