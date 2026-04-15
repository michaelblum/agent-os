# `tell`/`hear` — Coordination Verbs Design Spec

**Date:** 2026-04-15
**Scope:** New top-level `aos` verbs for agent-to-agent coordination. Daemon-native, no MCP dependency.

## Problem

Session coordination (handoff, presence, messaging) currently requires the MCP gateway to be loaded. `scripts/handoff` does everything except gateway posting — that step requires the agent to manually call MCP tools. This means:

1. The MCP server must be configured and running for basic handoff to work
2. Codex and other non-MCP stacks can't participate
3. Agent context windows are loaded with MCP tool schemas that exist only for coordination plumbing

The MCP gateway should be an optional adapter for external consumers, not a prerequisite for core platform operations.

## Design Decision: Verb Taxonomy

### The existing metaphor

The `aos` verb vocabulary follows an embodied metaphor — the agent has a body:

| Verb | Metaphor | What it does |
|------|----------|-------------|
| `see` | eyes | Perceive the environment (screen, cursor, AX tree) |
| `do` | hands | Act on the environment (click, type, press) |
| `say` | mouth | Speak aloud to the human (TTS) |
| `show` | projection | Display visuals to the human (canvases, overlays) |

These cover the agent's relationship with **the environment** (`see`/`do`) and with **the human** (`say`/`show`). What's missing is the agent's relationship with **other agents**.

### The 2x2

|  | **Human-facing** | **Agent-facing** |
|--|------------------|------------------|
| **Agent produces** | `say` (speak aloud) | `tell` (send message) |
| **Agent receives** | `listen` (STT, #55) | `hear` (receive messages) |

- `say`/`listen` = voice channel between agent and human
- `tell`/`hear` = message channel between agents

`tell` is `say` for agents — same output modality (language), different audience. `hear` is `listen` for agents — same input modality, different source.

### Why `tell`/`hear` specifically

- **Body metaphor consistency.** The existing verbs are embodied English words, not technical jargon. `tell` and `hear` continue this.
- **Semantic distinction from `say`.** `say` broadcasts audibly (TTS to the room). `tell` is directed to a specific recipient or channel (textual, structured).
- **No collision with existing verbs.** `do tell` exists (AppleScript tell blocks) but operates at a different level — `do tell` talks to *apps*, `tell` talks to *agents*. This is a hierarchy (human → agent → app), not a conflict.
- **`listen` is already earmarked** for STT (#55). `hear` is the agent-facing counterpart, keeping the symmetry clean.

## Design Decision: Daemon-Native Coordination

The coordination bus is a **daemon primitive**, not a separate service.

### Reasoning

The daemon (`aos serve`) is already a persistent process with a Unix socket, routing, and shared state. Adding channels/messages is another daemon capability alongside perception, display, and voice. This means:

- No separate process to run (the daemon is already running)
- `aos tell` talks to the daemon the same way `aos see` and `aos show` do
- No Node.js dependency for coordination
- Works from any shell, any agent stack — if you can run `aos`, you can coordinate

### MCP gateway becomes an adapter

The gateway package (`packages/gateway/`) remains as an optional MCP adapter. External developers who want MCP integration can use it. It wraps the daemon's coordination bus, not the other way around. The daemon is the source of truth; the gateway is a view.

### Platform vs SDK split

| Role | Interface | Who uses it |
|------|-----------|-------------|
| Agent-os developer | `aos` CLI (tell/hear) | Sessions working on or inside agent-os |
| App developer | `aos` CLI | Apps built on agent-os (Sigil, future apps) |
| External integrator | MCP gateway (optional) | Third-party tools wanting MCP access |

## Design Decision: Scoping Inherits Existing Conventions

### Runtime mode isolation

Channels are scoped by runtime mode, same as all other state:

```
~/.config/aos/{repo|installed}/
  config.json       # aos set
  wiki/             # aos wiki
  channels/         # aos tell / aos hear
```

Repo-mode dev sessions don't crosstalk with installed-mode app sessions. No new scoping mechanism.

### Wiki namespace convention

Channels can be namespaced following the same convention as wiki entries:

- `handoff` — system-level, root namespace
- `sigil/events` — app-scoped
- `myplugin/status` — plugin-scoped

Apps and plugins declare channels in their namespace. System channels are root-level.

### Why inherit rather than invent

The scoping model (mode isolation + namespace convention) is already established and understood by agents via AGENTS.md. New resource types that follow existing conventions require zero new documentation about scoping. New resource types that invent their own conventions create cognitive overhead and potential for divergence.

## Trigger: What Started This

The canvas lifecycle work (suspend/resume, `fafbe10`..`00993d8`) was triggered by status-item toggle latency: clicking the menu bar icon to show the avatar took several seconds because each toggle destroyed and recreated the canvas. The fix wasn't a Sigil-specific workaround — it was suspend/resume as a canvas lifecycle primitive.

During handoff of the lifecycle work for HITL testing, the handoff script couldn't post to the gateway without MCP tools loaded. This surfaced the question: why is coordination locked behind MCP? The answer — it shouldn't be. Coordination is a primitive that belongs in the daemon, exposed through `tell`/`hear`, following the verb taxonomy and scoping conventions already established.

## Usage (Planned)

```bash
# Post a message to a channel
aos tell handoff "task complete, see commit abc1234"

# Post structured payload
aos tell sigil/events --json '{"type": "state_change", "state": "active"}'

# Register presence
aos tell --register my-session-name

# Who's online
aos tell --who

# Read messages from a channel
aos hear handoff

# Stream messages (future, with aos hear)
aos hear sigil/events --follow
```

## What This Replaces

| Before | After |
|--------|-------|
| MCP `post_message` tool | `aos tell <channel> "message"` |
| MCP `register_session` tool | `aos tell --register <name>` |
| MCP `who_is_online` tool | `aos tell --who` |
| MCP `read_stream` tool | `aos hear <channel>` |
| `scripts/handoff` + manual MCP posting | `scripts/handoff` calls `aos tell` internally |
| MCP server must be loaded | `aos` CLI is sufficient |

## Principles Reinforced

1. **Primitives First.** Coordination is a primitive, not an app-level concern. Push it down to the daemon so every app benefits.
2. **CLI is the control surface.** `aos` is the canonical interface for development inside agent-os. MCP is an optional adapter for external consumers.
3. **Scoping inheritance.** New resource types follow existing mode/namespace conventions. Don't invent new scoping models.
