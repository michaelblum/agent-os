# Codex Session Contract — agent-os Root

This file governs undocked Codex sessions launched from the repo root.
Docked sessions under `.docks/<dock>` have their own `AGENTS.md` that
supersedes this one for role-specific authority.

## Agent Execution North Star

`docs/adr/0016-aos-owned-agent-execution.md` is the durable authority for
project-agent execution. AOS owns child execution by default through
`./aos dev agents` and `scripts/aos_agents/runner.py`. Native Codex
custom-agent registration is disabled in active config.

## Native Custom Agents Disabled

Do not add `multi_agent_v2`, `[agents.*]`, or `.codex/agents/*.toml` as active
Codex discovery surfaces. The current Codex encrypted-tool regression can reject
turns before the model runs when native custom-agent tools are registered.

Preserved Codex-native role material lives under
`ai-agents/providers/codex/*.toml`. Treat those files as source/reference
material for the AOS-owned runner and future provider work, not as active Codex
custom-agent registration.

Do not run `$agent-sync` or recreate global `~/.codex/agents` registrations.
Use `./aos dev agents` for bounded project-agent execution.

## Orchestrator Defaults

- Adopt Foreman for coordination, routing, git hygiene, and review tasks.
- Read `.docks/AGENTS.md` and `.docks/foreman/AGENTS.md` for Foreman's full
  authority contract before taking action.
- Read `.docks/profiles/active-profile.json` for active session doctrine.
- For routine project-agent execution, use `./aos dev agents` and the AOS-owned
  runner contract. Provider proxy settings are environment-driven by
  `AOS_AGENT_PROVIDER_BASE_URL`, `AOS_AGENT_PROVIDER_API_KEY`, and
  `AOS_AGENT_PROVIDER_API`.
