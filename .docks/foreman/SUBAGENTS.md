# Foreman Subagents

Foreman leads an extensible Codex native subagent team. This document describes
the subagent-first architecture, the currently registered team members, and when
the legacy terminal/AFK path is still acceptable.

## Architecture: Two Layers

```
.docks/                          ← semantic layer (provider-agnostic)
  foreman/AGENTS.md              ← Foreman role contract
  gdi/AGENTS.md                  ← GDI role contract
  operator/AGENTS.md             ← Operator role contract

.docks/foreman/.codex/agents/    ← Codex provider-adapter layer
  gdi.toml                       ← spawnable GDI subagent
  operator.toml                  ← spawnable Operator subagent
  explorer.toml                  ← spawnable Explorer utility subagent
```

The `.docks/` tree is canonical. It owns role definitions, scripts, skills, and
legacy terminal metadata. The `.codex/agents/` files are thin adapters: they set
`model`, `model_reasoning_effort`, and brief `developer_instructions` that point
back to the canonical dock AGENTS.md. If the dock contract changes, only the
dock AGENTS.md changes; the adapter TOML references it by path.

## Registered Subagent Catalog

| Name | Model | Effort | Role |
|---|---|---|---|
| `gdi` | gpt-5.4-mini | low | Deterministic implementation worker |
| `operator` | gpt-5.4 | medium | Supervised HITL inspector |
| `explorer` | gpt-5.4-mini | low | Read-only codebase scanner |

Foreman itself runs at `gpt-5.5 / xhigh` (see `.docks/foreman/.codex/config.toml`).
That expensive coordination posture is for Foreman only. Each subagent adapter
must declare its own `model` and `model_reasoning_effort`; cheap reconnaissance,
validation, and bounded execution roles should not inherit Foreman's model or
effort by default.

## Routing Policy

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

### Use subagent spawning when:

- The task has a bounded goal and a clear stop condition.
- You need parallel reconnaissance, validation, or bounded execution without
  filling Foreman's context window or spending Foreman's model/effort on the
  side task.
- You need GDI to execute a deterministic work card and report verification.
- You need Operator to run a bounded supervised probe or capture-plan check.

### Use the legacy terminal/AFK path only when:

- The work explicitly tests or repairs the legacy AFK terminal substrate.
- Native subagent role resolution is unavailable.
- The human explicitly asks for a separate supervised terminal session.

## How Foreman Spawns Subagents

Foreman invokes subagents by name in natural language. Codex resolves the name
to the matching `.docks/foreman/.codex/agents/*.toml` file.

```
"Spawn explorer: find all files under src/ that import from aos-gesture-frame
and return paths, import forms, and counts only."

"Spawn gdi: follow the instructions in
docs/design/work-cards/input-event-v2-cutover-v0.md; start from origin/main."

"Spawn operator: open https://localhost:3000/workbench and report whether
the avatar compact control renders without error in the console. Stop
immediately on any login or paywall gate."
```

## What Subagents Inherit from Foreman

Per Codex runtime rules, subagents inherit sandbox/approval policy, MCP server
configuration, and runtime permission state. They do **not** inherit Foreman's
model or reasoning effort; each adapter must declare `model` and
`model_reasoning_effort`.

## Adding New Subagent Types

To add a new subagent:

1. Create `.docks/foreman/.codex/agents/<name>.toml` with `name`, `description`,
   `developer_instructions`, `model`, and `model_reasoning_effort`.
2. Add an `[agents.<name>]` entry with `config_file = "agents/<name>.toml"` in
   `.docks/foreman/.codex/config.toml`.
3. Document it in this file's catalog table.

If the new subagent maps to an existing dock (e.g., a future `verifier` dock),
write the canonical role contract in `.docks/verifier/AGENTS.md` first, then
have the TOML `developer_instructions` reference that file. Keep the adapter
thin.
