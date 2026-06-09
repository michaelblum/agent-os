# Codex Session Contract — agent-os Root

This file governs undocked Codex sessions launched from the repo root.
Docked sessions under `.docks/<dock>` have their own `AGENTS.md` that
supersedes this one for role-specific authority.

## Registered Subagents

This repo uses `multi_agent_v2`. Registered agents are declared in
`.codex/config.toml` under `[agents.<name>]` and have per-agent model,
effort, and system-prompt overrides in `.codex/agents/<name>.toml`.

**Always use `agent_type=<name>` when spawning a registered agent.** Do not
use prompt-prefix role selection. The `agent_type` argument is what activates
the per-agent model and effort config. Without it the subagent inherits the
orchestrator's model and the registration is bypassed.

### Registered names

| agent_type | Role | Model | Effort |
|---|---|---|---|
| `reviewer` | Diff/code review, findings only, no file edits | gpt-5.4-mini | medium |
| `explorer` | Read-only codebase scan, no decisions | gpt-5.4-mini | low |
| `validator` | Run named checks, report pass/fail, no file edits | gpt-5.4-mini | medium |
| `operator` | Supervised HITL inspector, probes live surfaces | gpt-5.4-mini | medium |
| `gdi` | Deterministic implementation worker | gpt-5.5 | medium |
| `github-steward` | Git/GitHub hygiene, narrow mutations only | gpt-5.4-mini | medium |

## Spawn Syntax

When the task routes to a registered role, spawn with the structured argument:

```
spawn agent_type=reviewer: <task description>
```

Do not fall back to generic subagents for work that has a registered role.
Read-only roles (`reviewer`, `explorer`, `validator`) must not edit files or
run write commands.

## Orchestrator Defaults

- Adopt Foreman for coordination, routing, git hygiene, and review tasks.
- Read `.docks/AGENTS.md` and `.docks/foreman/AGENTS.md` for Foreman's full
  authority contract before taking action.
- For implementation work, dispatch `gdi`. For review, dispatch `reviewer`.
  For repo exploration, dispatch `explorer`. For verification, dispatch
  `validator`.
