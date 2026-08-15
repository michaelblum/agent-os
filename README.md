# agent-os

A macOS automation ecosystem for agents. Primitive perception, action,
projection, and communication verbs are unified into a single `aos` binary, with
convenience voice output, source-backed recipes, runtime readiness/lifecycle
commands, a reusable surface toolkit, and managed capability companions.

## Principle

**Agent tokens are for decisions, not plumbing.** The agent is the brain; the daemon is the nervous system. The daemon handles element resolution, cursor tracking, TTS, visual feedback. The agent decides WHAT and WHY.

## Public Command Model

| Group | Tier | Role |
|-------|------|------|
| `aos see` | Primitive | Perception: screenshots, AX tree, cursor queries, focus channels, graph navigation, Observation Ref facts, and current saved-workspace handles |
| `aos do` | Primitive | Action: V1 saved/direct handle validation, canvas/native AX Locator actions, coordinates, keyboard, AppleScript, and behavior profiles; stale refs and ambiguous locators reject, while browser Observation Ref actions currently fail closed as unsupported |
| `aos show` | Primitive | Projection: persistent WKWebView canvases, overlays, HTML-to-bitmap render, anchors, shared surfaces |
| `aos tell` | Primitive | Outbound communication: human, channel, direct session, and future sinks |
| `aos listen` | Primitive | Inbound communication: channel/direct-session reads, exact global hotkeys, and bounded microphone capture |
| `aos say` | Convenience | Direct TTS plus streamed system speech aligned with `tell human` |
| `aos skills` | Packaging | Installable AOS root skills for direct agent workflows: list, check, install, and dry-run plans |
| `aos recipe` | Higher-order | Source-backed executable procedures built from primitive commands |
| `aos work-record` | Higher-order | Optional Work Record evidence/history: discovery, report-only verification, recovery guidance, and compact evidence bundle manifests |
| `aos ready` | Runtime/ops | Front-door mechanical readiness check before runtime work |
| `aos serve` / `aos service` | Runtime/ops | Unified daemon lifecycle: one socket, one CGEventTap, shared state |
| `aos status` / `aos doctor` | Runtime/ops | Runtime, permission, and readiness diagnostics |
| `aos permissions` | Runtime/ops | Permission preflight, onboarding, and reset guidance |
| `aos clean` / `aos reset` | Runtime/ops | Explicit stale-resource cleanup and state reset workflows |

See [docs/api/aos.md](docs/api/aos.md) for the full consumer command table.

## Target Handles

The public semantic target types are an ephemeral Observation Ref
`(state_id, ref)`, which rejects when stale, and a Locator, which re-resolves at
action time and rejects zero or multiple matches. A saved-workspace address
such as `ref:<snapshot-id>:<ref-id>` is storage indirection to exactly one of
those handles. Direct browser Observation Refs use
`browser:<session>/<ref>` plus their original `--state-id`; canvas Locators use
`canvas:<canvas-id>/<ref>`. Coordinate fallback remains raw `x,y` and rejects
`--state-id`; native AX direct actions use selector
flags such as `--pid` and `--role`, not a public `ax:` target grammar. Semantic
Targets are perception records that contain refs and facts, not another address
system.

## Saved Workspaces

Saved perception state is local control state under the active runtime mode.
`--workspace <id>` selects a workspace for a command; otherwise
`AOS_AGENT_WORKSPACE` is used, then `default`. There is no daemon-held current
workspace and `aos see workspace use <id>` is not a command. After a saved-ref
mutation, use `post_action.recommended_next_command` to run a fresh saved
capture before reusing refs. Use `aos see refs --diff <from>..<to>` to compare
compact ref changes between two saved snapshots without opening heavy payloads;
add `--expect change|no-change` for whole-diff gates or
repeat `--expect-ref <ref>=changed` for ref postconditions when a script needs
a non-zero mismatch result.

## Consumers And Reusable Packages

| Package | Role |
|---------|------|
| [`Ch-osctrl/sigil`](https://github.com/Ch-osctrl/sigil) | External first-party reference consumer and product authority |
| `tests/fixtures/legacy-sigil/product` | Frozen legacy compatibility fixture; not discoverable or packaged |
| `packages/toolkit` | Reusable WKWebView surface machinery for external consumers |
| `packages/design-tokens` | Shared design tokens versioned with AOS |
| `packages/cli`, `packages/daemon` | Thin package roots around the unified native capability layer |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full blueprint.

## Agent Sessions

Repo-root sessions start with [AGENTS.md](AGENTS.md) and the nearest child
`AGENTS.md` for the path being edited. Historical dock and project-agent
orchestration scaffolding is not part of the active AOS product surface.

## Consumer Docs

Maintained consumer-facing API docs live in [docs/api/](docs/api/):

- [docs/api/aos.md](docs/api/aos.md) — unified `aos` CLI contract
- [docs/api/toolkit.md](docs/api/toolkit.md) — toolkit API index with scoped runtime, panel/window, workbench, component, and content-host contracts
