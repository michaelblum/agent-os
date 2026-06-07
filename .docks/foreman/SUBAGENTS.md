# Foreman Subagents

Foreman can spawn three Codex native subagents. This document describes the
dual-layer architecture, what each subagent does, and when to use subagent
spawning versus a separate CLI session.

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

The `.docks/` tree is canonical. It owns role definitions, inbound contracts,
hooks, scripts, and skills. The `.codex/agents/` files are thin adapters: they
set `model`, `model_reasoning_effort`, and brief `developer_instructions` that
point back to the canonical dock AGENTS.md. If the dock contract changes, only
the dock AGENTS.md changes; the adapter TOML references it by path.

## Subagent Catalog

| Name | Model | Effort | Role |
|---|---|---|---|
| `gdi` | gpt-5.4-mini | low | Deterministic implementation worker |
| `operator` | gpt-5.4 | medium | Supervised HITL inspector |
| `explorer` | gpt-5.4-mini | low | Read-only codebase scanner |

Foreman itself runs at `gpt-5.5 / xhigh` (see `.docks/foreman/.codex/config.toml`).

## When to Use Subagents vs. Separate CLI Sessions

### Use subagent spawning when:

- The task is small enough that a separate CLI session is more overhead than the
  work itself (e.g., "find all files that reference the old target-card schema").
- You need parallel reconnaissance without filling Foreman's context window
  (spawn one or more `explorer` subagents).
- You need a single bounded Operator probe (one URL check, one element-clip
  acceptance) with no multi-step HITL needed.
- The GDI task has a single clear done condition, no multi-milestone work card,
  and no `/goal` iteration benefit.

### Use separate CLI sessions when:

- The GDI work card has multiple ordered milestones or a blast-radius that
  warrants Foreman acceptance between steps.
- The Operator run is multi-step, requires a capture plan, or needs the human to
  intervene between steps.
- The work benefits from `/review` in a live GDI session.
- Token budget for the subagent would exceed the cost of a fresh session.

## How Foreman Spawns Subagents

Foreman invokes subagents by name in natural language. Codex resolves the name
to the matching `.docks/foreman/.codex/agents/*.toml` file.

Example invocation patterns:

```
# Reconnaissance before writing a work card
"Spawn explorer: find all files under src/ that import from aos-gesture-frame
and return a plain list of paths and import forms."

# Small bounded GDI task
"Spawn gdi: in docs/design/work-cards/open-cards.md, replace every occurrence
of 'human-readable name as identity' with 'label ref, not durable id'.
Verify with grep and report."

# Single-probe Operator task
"Spawn operator: open https://localhost:3000/workbench and report whether
the avatar compact control renders without error in the console. Stop
immediately on any login or paywall gate."
```

## What Subagents Inherit from Foreman

Per Codex runtime rules, subagents inherit the parent session's:
- Sandbox mode and approval policy.
- MCP server configuration.
- Runtime permission state (TCC, file access).

Subagents do **not** inherit Foreman's model or reasoning effort. Each subagent
uses its own `model` and `model_reasoning_effort` from its TOML file.

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
