---
name: agent-sync
description: >
  Historical tombstone for the retired Codex native custom-agent sync path.
  Do not use this skill to register, rename, retire, or sync agents.
retired: true
current_execution_surface: ./aos dev agents
authority:
  - docs/adr/0017-retire-codex-native-custom-agents.md
  - .codex/AGENTS.md
  - ai-agents/providers/codex/README.md
---

# agent-sync Is Retired

This skill is retained only as a historical tombstone. It is not a working
agent registration command, and agents must not invoke `$agent-sync` or recreate
its old behavior.

The retired path copied Codex-shaped role files into user-global Codex config
and registered native custom agents. That path is unsupported for agent-os
because ADR 0017 retired Codex native custom-agent registration for this repo.

## Current Contract

- Use `./aos dev agents` for bounded project-agent execution.
- Treat `ai-agents/providers/codex/*.toml` as preserved role source material
  for the AOS-owned runner, not as an active Codex native-agent registry.
- `scripts/agent-sync.sh` intentionally exits non-zero.
- Reversal requires a new ADR or explicit human architecture decision naming
  ADR 0017 and ADR 0016.

## Forbidden Actions

Do not create, copy, or instruct another agent to create any of these for
agent-os:

- `multi_agent_v2 = true`
- `[agents]` or `[agents.<role>]` blocks in Codex config files
- repo-root `.codex/agents/*.toml` as an active discovery surface
- user-global `~/.codex/agents/*.toml`
- native Codex custom-agent dispatch as routine project-agent execution

## Read Instead

- `docs/adr/0017-retire-codex-native-custom-agents.md`
- `.codex/AGENTS.md`
- `ai-agents/providers/codex/README.md`
- `ai-agents/providers/codex/SKILL.md`
