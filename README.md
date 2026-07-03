# agent-os

A macOS automation ecosystem for agents. Primitive perception, action,
projection, and communication verbs are unified into a single `aos` binary, with
convenience voice output, source-backed recipes, runtime readiness/lifecycle
commands, a typed MCP gateway for external consumers, and a Node.js agent host.

## Principle

**Agent tokens are for decisions, not plumbing.** The agent is the brain; the daemon is the nervous system. The daemon handles element resolution, cursor tracking, TTS, visual feedback. The agent decides WHAT and WHY.

## Public Command Model

| Group | Tier | Role |
|-------|------|------|
| `aos see` | Primitive | Perception: screenshots, AX tree, cursor queries, focus channels, graph navigation, saved workspace refs |
| `aos do` | Primitive | Action: saved refs, direct browser/canvas targets, native AX, coordinates, keyboard, AppleScript, behavior profiles |
| `aos show` | Primitive | Projection: persistent WKWebView canvases, overlays, HTML-to-bitmap render, anchors, shared surfaces |
| `aos tell` | Primitive | Outbound communication: human, channel, direct session, and future sinks |
| `aos listen` | Primitive | Inbound communication: channel/direct-session reads and follow today; STT and broader sources planned |
| `aos say` | Convenience | Direct TTS convenience aligned with `tell human` |
| `aos recipe` | Higher-order | Source-backed executable procedures built from primitive commands; `aos ops` is the compatibility alias |
| `aos ready` | Runtime/ops | Front-door readiness gate for agents before runtime work |
| `aos serve` / `aos service` | Runtime/ops | Unified daemon lifecycle: one socket, one CGEventTap, shared state |
| `aos status` / `aos doctor` | Runtime/ops | Runtime, permission, and readiness diagnostics |
| `aos permissions` | Runtime/ops | Permission preflight, onboarding, and reset guidance |
| `aos clean` / `aos reset` | Runtime/ops | Explicit stale-resource cleanup and state reset workflows |

See [docs/api/aos.md](docs/api/aos.md) for the full consumer command table.

## Target Handles

Normal observe-act loops should use saved refs from `aos see capture --save`:
`ref:<snapshot-id>:<ref-id>`. Direct live refs such as
`browser:<session>/<ref>` and `canvas:<canvas-id>/<ref>` are current-host
addresses for diagnostics, provenance, direct execution, and placement anchors.
Coordinate fallback remains raw `x,y` plus `--state-id <id>`; native AX direct
actions use selector flags such as `--pid` and `--role`, not a public `ax:`
target grammar. Semantic Targets are perception records that contain refs and
facts, not another address system.

## Saved Workspaces

Saved perception state is local control state under the active runtime mode.
`--workspace <id>` selects a workspace for a command; otherwise
`AOS_AGENT_WORKSPACE` is used, then `default`. There is no daemon-held current
workspace and `aos see workspace use <id>` is not a command. After a saved-ref
mutation, use `post_action.recommended_next_command` to run a fresh saved
capture before reusing refs.

## Track-2 consumers

| Package | Role |
|---------|------|
| `apps/sigil` | Avatar presence system — Track 2 consumer of the display subsystem |
| `packages/host` | Node.js agent host — Anthropic SDK loop, session store |
| `packages/gateway` | MCP server — typed script execution, cross-harness coordination (for external consumers) |
| `packages/toolkit` | Reusable WKWebView components for apps |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full blueprint.

## Agent Sessions

Agent sessions normally launch through docks under [.docks/](.docks/). Start
with [AGENTS.md](AGENTS.md) only as repo-wide signage, then use
[.docks/README.md](.docks/README.md) and the role-local dock contract.

## Consumer Docs

Maintained consumer-facing API docs live in [docs/api/](docs/api/):

- [docs/api/aos.md](docs/api/aos.md) — unified `aos` CLI contract
- [docs/api/toolkit.md](docs/api/toolkit.md) — toolkit API index with scoped runtime, panel/window, workbench, component, and content-host contracts
