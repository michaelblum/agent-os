# Codex Session Contract — agent-os Root

This file governs undocked Codex sessions launched from the repo root.
Docked sessions under `.docks/<dock>` have their own `AGENTS.md` that
supersedes this one for role-specific authority.

## Agent Execution North Star

`docs/adr/0016-aos-owned-agent-execution.md` is the durable authority for
project-agent execution. AOS owns child execution by default through
`./aos dev agents` and `scripts/aos_agents/runner.py`. Native Codex subagents
are an explicit diagnostic/import lane only; they are not the default execution
substrate.

## Registered Native Subagents

This repo uses `multi_agent_v2`. Registered agents are declared in
`.codex/config.toml` under `[agents.<name>]` and have per-agent model,
effort, and system-prompt overrides in `.codex/agents/<name>.toml`.

**When an explicit native diagnostic requires spawning a registered agent, use
the v2 custom-agent call shape:**
`task_name=<short_task_id>` plus `agent_type=<name>`. Do not use prompt-prefix
role selection. The `agent_type` argument is what activates the per-agent model
and effort config. `task_name` is only the v2 thread label; by itself it does
not bind the custom agent. Without `agent_type`, the subagent inherits the
orchestrator's model and the registration is bypassed.

### Registered names

| agent_type | Role | Model | Effort |
|---|---|---|---|
| `architect` | System design, decomposition, and interface contracts | gpt-5.4-mini | high |
| `implementer` | Scoped code-writing worker | gpt-5.4-mini | medium |
| `reviewer` | Diff/code review, findings only, no file edits | gpt-5.4-mini | high |
| `explorer` | Read-only codebase scan, no decisions | gpt-5.4-mini | low |
| `validator` | Run named checks, report pass/fail, no file edits | gpt-5.4-mini | low |
| `operator` | Supervised HITL inspector, probes live surfaces | gpt-5.4-mini | low |
| `steward` | Git/GitHub hygiene, narrow mutations only | gpt-5.4-mini | low |
| `historian` | Read-only chronology and stale-source synthesis | gpt-5.4-mini | medium |

## Spawn Syntax

When an explicit native diagnostic routes to a registered role, spawn with the
v2 custom-agent arguments:

```
spawn_agent(task_name="review_current_diff", agent_type="reviewer", fork_turns="none", message="<task description>")
```

Do not fall back to generic subagents for work that has a registered role. Do
not use native Codex subagents as the routine execution default. Read-only roles
(`reviewer`, `explorer`, `validator`) must not edit files or run write commands.

## Orchestrator Defaults

- Adopt Foreman for coordination, routing, git hygiene, and review tasks.
- Read `.docks/AGENTS.md` and `.docks/foreman/AGENTS.md` for Foreman's full
  authority contract before taking action.
- Read `.docks/profiles/active-profile.json` for active session doctrine.
- For routine project-agent execution, use `./aos dev agents` and the AOS-owned
  runner contract. Use native `architect`, `implementer`, `reviewer`,
  `explorer`, `validator`, `steward`, and `historian` only for explicit native
  diagnostics or when a human deliberately asks for that substrate.
