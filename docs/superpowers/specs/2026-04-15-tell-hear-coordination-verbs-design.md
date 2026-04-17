# `tell`/`listen` — Unified Communication Verbs Design Spec

**Date:** 2026-04-15 (revised)
**Scope:** Two top-level `aos` verbs for all agent communication. Daemon-native routing, no MCP dependency.
**Status:** Shipped. `aos tell` / `aos listen` are the native coordination surface; the gateway is now an optional adapter.

## Problem

Before this design shipped, session coordination (handoff, presence, messaging) required the MCP gateway to be loaded. `scripts/handoff` did everything except gateway posting — that step required the agent to manually call MCP tools. This meant:

1. The MCP server must be configured and running for basic handoff to work
2. Codex and other non-MCP stacks can't participate
3. Agent context windows are loaded with MCP tool schemas that exist only for coordination plumbing

Beyond coordination, the existing verb vocabulary encodes the delivery mechanism into the verb choice: `say` for TTS, a future `tell` for channels. This forces the agent to choose *how* to communicate rather than *what* to communicate and *to whom*. That's plumbing — and the first principle of ARCHITECTURE.md says agent tokens are for decisions, not plumbing.

## Key Insight: Communication Is One Primitive

The earlier design (v1, same date) proposed a 2×2 grid:

|  | **Human-facing** | **Agent-facing** |
|--|------------------|------------------|
| **Agent produces** | `say` | `tell` |
| **Agent receives** | `listen` | `hear` |

This is clean but encodes the *audience* into the *verb*. The agent has to decide: am I talking to a human or an agent? Then pick the right verb. But that's a routing decision, not a communication decision.

**The revised design:** the primitive is communication itself. Two verbs, one routing layer.

- **`tell`** — agent produces language. The daemon routes it based on audience.
- **`listen`** — agent receives language. The daemon aggregates sources.

The agent decides WHAT to say and TO WHOM. The daemon decides HOW to deliver it.

## Design: Two Verbs + Routing Arbiter

### `tell` — all outbound communication

```
aos tell <audience> "message"
         │
         ▼
      daemon (arbiter)
         │
         ├─→ TTS engine (audience is human, voice enabled)
         ├─→ channel post (audience is a session/channel name)
         ├─→ both (audience is mixed)
         └─→ future: Slack, push notification, webhook, etc.
```

The audience determines the route:

| Audience | Route | Mechanism |
|----------|-------|-----------|
| `human` | Voice | TTS via SpeechEngine |
| `<channel-name>` | Channel | Daemon coordination bus |
| `--session-id <canonical-session-id>` | Direct message | Daemon coordination bus |
| `human,handoff` | Mixed | TTS + channel post |

### `listen` — all inbound communication

```
      daemon (arbiter)
         │
         ├── channel message (agent posted)
         ├── direct session message
         ├── stdin pipe (bash command)
         ├── future: STT, webhook, file watch, etc.
         │
         ▼
aos listen <channel>|--session-id <canonical-session-id>
```

All inbound language arrives through `listen`. The source metadata comes with the message, but the verb is the same regardless of origin.

### `say` becomes sugar

`aos say "hello"` is sugar for `aos tell human "hello"`. It stays as a convenience command — it's short, intuitive, already shipped. But conceptually, it's not a separate primitive. It's `tell` with a hardcoded audience.

This means `say` doesn't need to evolve independently. When `tell` gains new capabilities (structured payloads, delivery confirmation), `say` inherits them automatically because it's the same codepath.

### Why this is better than v1

1. **Follows ARCHITECTURE.md principle #1.** "Agent Tokens Are For Decisions, Not Plumbing." Choosing between `say` and `tell` based on audience *is* plumbing. The agent shouldn't care whether the human hears it through speakers or reads it in a channel.

2. **New delivery mechanisms are routes, not verbs.** Want Slack integration? Add a route to the arbiter. The verb vocabulary doesn't grow. Four verbs was already at the edge of elegant; more would be bloat.

3. **The agent's mental model is simpler.** "I tell things and I listen for things." That's it. No decision tree about which communication verb to use.

4. **Source/audience composition.** `tell human,handoff "done"` posts to a channel AND speaks aloud. With separate verbs, the agent has to make two calls. With unified `tell`, it's one intent, one call, multiple routes.

## Design Decision: The Daemon as Arbiter

The daemon routes communication based on:

- **Config** — voice enabled? which voice? rate? (`aos set voice.*`)
- **Presence** — which sessions are online? (`tell --who`)
- **Channel state** — does the channel exist? who's subscribed?
- **Audience type** — human, canonical session id, channel name, mixed

The daemon already has all of this context. It manages voice config, runs the coordination bus, and tracks state. Routing is a natural extension, not a new responsibility.

Direct session routing should target canonical `session_id` values. Human-readable names remain ancillary metadata for `/who` output and operator ergonomics.

### MCP gateway becomes an adapter

The gateway package (`packages/gateway/`) remains as an optional MCP adapter for external consumers. It wraps the daemon's communication bus. The daemon is the source of truth; the gateway is a view.

| Role | Interface | Who uses it |
|------|-----------|-------------|
| Agent-os developer | `aos` CLI (tell/listen) | Sessions working on or inside agent-os |
| App developer | `aos` CLI | Apps built on agent-os (Sigil, future apps) |
| External integrator | MCP gateway (optional) | Third-party tools wanting MCP access |

## Design Decision: Scoping Inherits Existing Conventions

### Runtime mode isolation

Channels are scoped by runtime mode, same as all other state:

```
~/.config/aos/{repo|installed}/
  config.json       # aos set
  wiki/             # aos wiki
  channels/         # aos tell / aos listen
```

Repo-mode dev sessions don't crosstalk with installed-mode app sessions.

### Wiki namespace convention

Channels follow the same namespace convention as wiki entries:

- `handoff` — system-level, root namespace
- `sigil/events` — app-scoped
- `myplugin/status` — plugin-scoped

### Why inherit rather than invent

The scoping model (mode isolation + namespace convention) is already established. New resource types that follow existing conventions require zero new documentation about scoping. New resource types that invent their own create cognitive overhead and divergence.

## Verb Taxonomy (Revised)

| Verb | What the agent does | What the daemon does |
|------|--------------------|--------------------|
| `see` | Perceive the environment | Captures screen, AX tree, cursor state |
| `do` | Act on the environment | Fires CGEvents, AX actions, AppleScript |
| `show` | Project visuals | Manages canvases, overlays, render |
| `tell` | Communicate outward | Routes to TTS, channels, future sinks |
| `listen` | Receive communication | Aggregates STT, channels, stdin, future sources |

`say` stays as sugar for `tell human`. `do tell` stays as AppleScript (different level — talking to apps, not agents/humans).

Five core verbs, not six. The communication primitive is unified.

## Usage (Shipped)

```bash
# Tell a human (TTS) — identical to current `aos say`
aos tell human "I found the bug in line 47"
aos say "I found the bug in line 47"              # sugar, same thing

# Tell a channel (agent coordination)
aos tell handoff "task complete, see commit abc1234"

# Tell a session directly
aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c "ready for your review"

# Tell multiple audiences
aos tell human,handoff "done — handing off to visual testing"

# Structured payload
aos tell sigil/events --json '{"type": "state_change", "state": "active"}'

# Presence
aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name hitl-visual-test
aos tell --who

# Listen for messages
aos listen handoff
aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c
aos listen sigil/events --follow                  # stream
```

Source-filtered `listen` inputs such as STT remain part of the long-term routing model, but the current coordination CLI exposes channel and direct-session reads first.

## Trigger: What Started This

The canvas lifecycle work (suspend/resume) was triggered by status-item toggle latency. During handoff of that work, `scripts/handoff` couldn't post to the gateway without MCP tools. This surfaced: why is coordination locked behind MCP?

The first answer was `tell`/`hear` as coordination-specific verbs (the 2×2). But examining the verb taxonomy revealed a deeper insight: `say` and `tell` are the same primitive — produce language — differing only in routing. The agent shouldn't choose the delivery mechanism; the daemon should. This collapsed four verbs into two, with the daemon as routing arbiter.

## What This Replaces

| Before | After |
|--------|-------|
| `aos say "text"` | `aos tell human "text"` (or keep `say` as sugar) |
| MCP `post_message` | `aos tell <channel> "message"` |
| MCP `register_session` | `aos tell --register --session-id <id> --name <name>` |
| MCP `who_is_online` | `aos tell --who` |
| MCP `read_stream` | `aos listen <channel>` |
| Direct session inbox reads | `aos listen --session-id <id>` |
| STT (#55) as separate verb | future `aos listen` source routing |
| `scripts/handoff` + manual MCP | `scripts/handoff` calls `aos tell` internally |
| 4 communication verbs | 2 verbs + routing |

## Design Evolution

This spec supersedes the v1 design (same date) which proposed four verbs (`say`/`tell`/`listen`/`hear`). The revision recognizes that audience-routing is the daemon's job, not the agent's verb choice. The v1 thinking was useful — the 2×2 grid revealed the gap — but the final design compresses it.

## Principles Reinforced

1. **Agent Tokens Are For Decisions, Not Plumbing.** The agent decides what to communicate and to whom. The daemon decides how to deliver it.
2. **Primitives First.** Communication is one primitive with routing, not four separate capabilities.
3. **CLI is the control surface.** `aos` is the canonical interface. MCP is an optional adapter.
4. **Scoping inheritance.** Channels follow runtime mode isolation and wiki namespace conventions.
