# agent-os

A macOS automation ecosystem for agents. Perception, action, projection, and voice unified into a single `aos` binary with subcommand groups, plus a typed MCP gateway for external consumers and a Node.js agent host.

## Principle

**Agent tokens are for decisions, not plumbing.** The agent is the brain; the daemon is the nervous system. The daemon handles element resolution, cursor tracking, TTS, visual feedback. The agent decides WHAT and WHY.

## Subcommand groups

| Group | Role | Status |
|-------|------|--------|
| `aos see` | Perception — screenshots, AX tree, cursor queries, focus channels, graph navigation | Production |
| `aos show` | Projection — persistent WKWebView canvases, overlays, HTML→bitmap render | Production |
| `aos do` | Action — AX semantic actions, CGEvent input, AppleScript verbs, behavioral profiles | Production |
| `aos say` | Voice — TTS, daemon-driven announcements | Production (TTS); STT planned |
| `aos serve` | Unified daemon: one socket, one CGEventTap, shared state | Production |

## Track-2 consumers

| Package | Role |
|---------|------|
| `apps/sigil` | Avatar presence system — Track 2 consumer of the display subsystem |
| `packages/host` | Node.js agent host — Anthropic SDK loop, session store |
| `packages/gateway` | MCP server — typed script execution, cross-harness coordination (for external consumers) |
| `packages/toolkit` | Reusable WKWebView components for apps |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full blueprint.
