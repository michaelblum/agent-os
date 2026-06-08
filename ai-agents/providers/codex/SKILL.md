---
name: agent-sync
provider: codex
description: >
  Syncs the ai-agents/ roster into Codex user-level config.
  Reads ai-agents/agents/*.md as the source of truth, writes
  ~/.codex/agents/*.toml and registers [agents.*] blocks in
  ~/.codex/config.toml. Idempotent: add, update, or skip — never destructive.
  Invoke with '$agent-sync' in the Codex CLI or dispatch from any agent
  that creates, renames, or retires an agent definition.
source_of_truth: ai-agents/agents/
target_config: ~/.codex/config.toml
target_agents_dir: ~/.codex/agents/
script: scripts/agent-sync.sh
---

# agent-sync (Codex)

This is the **Codex provider skill** for agent roster sync.
The agent definitions themselves live in `ai-agents/agents/` — read that
folder to understand who the agents are.  This file covers only the
Codex-specific sync mechanics.

## Source of truth

`ai-agents/agents/*.md` — one file per agent, provider-neutral.

The sync script reads each `.md` file's frontmatter for the fields Codex
needs (`name`, `description`, `nickname_candidates`, model tier), then
generates the corresponding `.toml` and config block.

## Outputs (Codex-specific)

| File | What gets written |
|---|---|
| `~/.codex/agents/<name>.toml` | Full Codex agent config with `developer_instructions` |
| `~/.codex/config.toml` | `[agents.<name>]` block with `description`, `nickname_candidates`, `config_file` |

## Invocation

```bash
# Codex CLI skill invocation:
$agent-sync

# Direct shell:
./scripts/agent-sync.sh
./scripts/agent-sync.sh --dry-run
./scripts/agent-sync.sh --agent-os-path ~/Documents/GitHub/agent-os

# aos CLI (once wired):
./aos agent-sync
./aos agent-sync --dry-run
```

## When to invoke

| Trigger | Who invokes |
|---|---|
| First-time setup on a new machine | User: `$agent-sync` |
| Any `ai-agents/agents/*.md` file added or changed | Agent that made the change |
| `spawn_agent` can't find an expected agent at startup | Foreman: run `$agent-sync`, then retry |
| Migrating from subagent-smoke or an older roster | User: `$agent-sync` once |

## Resilience

| Risk | Protection |
|---|---|
| Config corruption | Timestamped `.bak-YYYYMMDDHHMMSS` backup before every write |
| agent-os not found | Search order: `AGENT_OS_PATH` env → `~/Documents/GitHub/agent-os` → `~/Code/agent-os` → cwd |
| Global config missing | Created with safe defaults before merge |
| Relative path written | Absolute resolution enforced |
| Foreign agents in global config | Listed as `noticed`, never deleted |
| One agent file fails to parse | Warn and continue — other agents still sync |
| `--dry-run` | No files written; full report printed |

## Implementation

The sync logic lives in `scripts/agent-sync.sh`.
See that file for the full implementation.

## Future: shared logic layer

When Claude and Gemini provider skills are added, the merge algorithm and
agent definition parsing will be factored into a shared script
(`scripts/agent-sync-core.sh` or similar) that all three provider skills
import.  Provider skills become thin wrappers that supply:
- Target config path
- Output format (`.toml` vs `json` vs provider API call)
- Provider-specific field mapping
