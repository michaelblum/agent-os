# Foreman Subagents

Foreman leads an extensible Codex native subagent team. This document describes
the team split, the registered roles, and the proof gate Foreman must use before
broad fan-out.

## Architecture: Two Layers

```text
.docks/                          <- AOS team layer, provider-agnostic
  foreman/AGENTS.md              <- Foreman role contract and launch persona
  gdi/AGENTS.md                  <- GDI role contract
  operator/AGENTS.md             <- Operator role contract

.codex/agents/                   <- native Codex subagent config roster
  gdi.toml                       <- spawnable GDI subagent config
  operator.toml                  <- spawnable Operator subagent config
  explorer.toml                  <- spawnable Explorer utility config
  validator.toml                 <- spawnable Validator utility config
```

The `.docks/` tree is the AOS team layer. It owns role definitions, scripts,
skills, recovery helpers, and legacy terminal metadata. It is not the native
Codex agent config store.

Root `.codex/agents/` is the native Codex roster. Each TOML pins the role name,
description, model, reasoning effort, and short developer instructions. When a
subagent maps to a dock role, the TOML points back to that dock's canonical
`AGENTS.md` instead of duplicating the role contract.

Repo-root `.codex/config.toml` registers the native files with
`config_file = "agents/<role>.toml"`. The Foreman launch config at
`.docks/foreman/.codex/config.toml` registers those same root files with
`config_file = "../../../.codex/agents/<role>.toml"`. That keeps dock launch
as a team/persona/hooks entrypoint while keeping native Codex agent definitions
in the first-class project location.

## Registered Subagent Catalog

| Name | Model | Effort | Role |
|---|---|---|---|
| `gdi` | gpt-5.4-mini | low | Deterministic implementation worker |
| `operator` | gpt-5.4 | medium | Supervised HITL inspector |
| `explorer` | gpt-5.4-mini | low | Read-only codebase scanner |
| `validator` | gpt-5.4-mini | low | Bounded verification worker |

Foreman itself runs at `gpt-5.5 / xhigh` when launched from
`.docks/foreman` (see `.docks/foreman/.codex/config.toml`). That expensive
coordination posture is for Foreman only. Every subagent config must declare
its own `model` and `model_reasoning_effort`; cheap reconnaissance,
validation, and bounded execution roles must not silently inherit Foreman's
model or effort.

## Context Firewall

Foreman owns the read-first set. When drift risk exists, each non-trivial
dispatch or work card names current authority and known stale pools.

Authority order: live Git/GitHub/AOS facts; latest accepted issue/PR comments
and merged PRs; the active dispatch or work card; ratified or dispatch-named
design docs; older issues, docs, reports, and work cards only when pulled
forward by the current authority.

Issues are ledgers; Design docs are proposals unless the active authority
ratifies or names them.

GDI executes the assigned prompt/card. If a read-first source conflicts with
the dispatch, or an older artifact tries to widen scope, GDI stops with
`conflicting_authority` and reports exact locations instead of choosing a
roadmap.

Explorer performs bounded read-only scans only. It returns paths, counts,
snippets, and raw facts; it does not interpret roadmaps, rank authority, or
decide follow-up work.

Validator performs bounded verification only. It runs named checks or inspects
named evidence, reports pass/fail facts, and does not edit files or decide next
work.

## Routing Policy

Use subagent spawning when:

- The task has a bounded goal and a clear stop condition.
- You need parallel reconnaissance, validation, or bounded execution without
  filling Foreman's context window or spending Foreman's model/effort on the
  side task.
- You need GDI to execute a deterministic work card and report verification.
- You need Operator to run a bounded supervised probe or capture-plan check.
- You need Validator to run named proof, test, or manifest checks without
  turning validation into implementation.

Use the legacy terminal/AFK path only when:

- The work explicitly tests or repairs the legacy AFK terminal substrate.
- Native subagent role resolution is unavailable.
- The human explicitly asks for a separate supervised terminal session.

## How Foreman Spawns Subagents

Foreman must select the role with the spawn tool's `agent_type` field. Codex
resolves custom agents from native TOML configs under `.codex/agents/` and from
explicit `config_file` registrations in the active project `.codex`
configuration. The `name` field inside each agent config is the runtime
identity.

Do not rely on naming a role inside the child prompt. If the spawn tool
argument `agent_type` is omitted, Codex uses `default`, and the child can
inherit Foreman's model/effort.

There is no generic helper role. If a user asks for a helper, scanner, second
set of eyes, or lightweight pass, Foreman must translate that request to a
registered role before spawning: `explorer` for read-only reconnaissance,
`validator` for bounded verification, `gdi` for deterministic implementation,
and `operator` for supervised live/HITL inspection. The first spawn attempt
must use the registered role; a blocked generic/default spawn is a routing
mistake, even if Foreman recovers by retrying correctly.

Before broad fan-out, smoke one child. The visible spawn/status line and
SubagentStart/SubagentStop voice labels must identify the intended role
(`explorer`, `validator`, `gdi`, or `operator`), not `default`, and the visible
model/effort must match the native agent config. If it says `default`, `Gibbs`,
or inherits Foreman's `gpt-5.5 / xhigh`, stop and fix role loading before
continuing.

Foreman's `PreToolUse` hook blocks recognized spawn-tool calls that omit
`agent_type`, use `default`, or name an unregistered role. `SubagentStart`
cannot stop startup in current Codex; it is the second-line warning/TTS tripwire
for missing `agent_type`, `default`, `foreman`, `gibbs`, and roles that do not
map to a repo-root `.codex/agents/<role>.toml` file declaring the same `name`.
`SubagentStop` suppresses invalid-role voice lines so a bad child does not
produce misleading "Default stopped" feedback.

Use the AOS gate for this instead of relying on memory. First generate the
native spawn contract:

```bash
./aos dev subagent plan --role explorer --prompt "reply exactly EXPLORER_AGENT_TYPE_SMOKE_OK" --json
```

After the smoke, capture the visible spawn/proof transcript and validate it:

```bash
./aos dev subagent validate-proof --role explorer --transcript-file /tmp/subagent-smoke.txt --json
```

If proof validation fails, do not fan out. The failed proof is the blocker.

Tool argument: `agent_type=explorer`

Child prompt:
`find all files under src/ that import from aos-gesture-frame and return paths, import forms, and counts only.`

Tool argument: `agent_type=validator`

Child prompt:
`run bash tests/dock-hook-isolation.sh and report the pass/fail result and any exact failure line. Do not edit files.`

Tool argument: `agent_type=gdi`

Child prompt:
`follow the instructions in docs/design/work-cards/input-event-v2-cutover-v0.md; start from origin/main.`

Tool argument: `agent_type=operator`

Child prompt:
`open https://localhost:3000/workbench and report whether the avatar compact control renders without error in the console. Stop immediately on any login or paywall gate.`

## What Subagents Inherit from Foreman

Do not rely on inheritance for role identity, model, or reasoning effort. Each
native agent config must pin those values.

The active Codex runtime still supplies the session's permissions, configured
tools, and project context. A child config may further constrain itself, such
as `explorer` using `sandbox_mode = "read-only"`. If a role needs a different
sandbox, model, effort, tool access, or skill configuration, declare it in that
role's native agent config instead of relying on Foreman's launch posture.

## Adding New Subagent Types

To add a new subagent:

1. Create `.codex/agents/<name>.toml` with `name`, `description`,
   `developer_instructions`, `model`, and `model_reasoning_effort`.
2. Register it from repo-root `.codex/config.toml` with
   `config_file = "agents/<name>.toml"`.
3. Register it from `.docks/foreman/.codex/config.toml` with
   `config_file = "../../../.codex/agents/<name>.toml"`.
4. Document it in this file's catalog table.
5. Smoke one spawn and verify the runtime identity and model/effort before
   using the role for fan-out.

If the new subagent maps to an existing dock, write the canonical role contract
in `.docks/<role>/AGENTS.md` first, then have the TOML
`developer_instructions` reference that file. Keep the native agent config
thin.
