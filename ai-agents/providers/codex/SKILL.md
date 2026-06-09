---
name: agent-sync
provider: codex
description: >
  Syncs the ai-agents/providers/codex/ roster into the Codex user-level
  config. Reads ai-agents/providers/codex/*.toml as the source of truth,
  writes ~/.codex/agents/*.toml and registers [agents.*] blocks in
  ~/.codex/config.toml with correct absolute config_file paths.
  Idempotent: add, update, or skip — never destructive.
  Invoke with '$agent-sync' in the Codex CLI or dispatch from any agent
  that creates, renames, or retires an agent definition.
source_of_truth: ai-agents/providers/codex/
target_config: ~/.codex/config.toml
target_agents_dir: ~/.codex/agents/
script: scripts/agent-sync.sh
---

# agent-sync (Codex)

This is the **Codex provider skill** for agent roster sync.
The agent definitions live in `ai-agents/providers/codex/` — one `.toml`
per agent. This file covers only the Codex-specific sync mechanics.

## Source of truth

`ai-agents/providers/codex/*.toml` — one file per agent, Codex-native.

The sync script reads each `.toml` file, copies it verbatim to
`~/.codex/agents/<name>.toml`, then writes or patches the corresponding
`[agents.<name>]` block in `~/.codex/config.toml` with:
- `description`
- `nickname_candidates`
- `config_file` → absolute path to `~/.codex/agents/<name>.toml`

## Outputs

| File | What gets written |
|---|---|
| `~/.codex/agents/<name>.toml` | Full Codex agent config (verbatim copy from source) |
| `~/.codex/config.toml` | `[agents.<name>]` block with `description`, `nickname_candidates`, `config_file` |

## Invocation

```bash
# Codex CLI skill invocation:
$agent-sync

# Direct shell (from repo root):
./scripts/agent-sync.sh
./scripts/agent-sync.sh --dry-run
./scripts/agent-sync.sh --agent-os-path ~/Documents/GitHub/agent-os

# With explicit path:
AGENT_OS_PATH=~/Code/agent-os ./scripts/agent-sync.sh
```

## Telemetry

Every run emits a structured JSON block at the end of stdout:

```
================================================================
AGENT-SYNC TELEMETRY — paste this back for validation
================================================================
{
  "agent_sync_telemetry": {
    "run_at": "2026-06-08T21:00:00",
    "dry_run": false,
    "agent_os_path": "/Users/Michael/Code/agent-os",
    "source_dir": ".../ai-agents/providers/codex",
    "global_config": "/Users/Michael/.codex/config.toml",
    "local_agents_dir": "/Users/Michael/.codex/agents",
    "backup": "/Users/Michael/.codex/config.toml.bak-20260608210000",
    "config_changes": {
      "added":   [],
      "updated": ["architect", "explorer", "implementer", ...],
      "skipped": [],
      "noticed": []
    },
    "toml_files": [
      {"agent": "architect", "action": "updated", "path": "/Users/Michael/.codex/agents/architect.toml"}
    ],
    "errors": []
  }
}
================================================================
```

Paste the telemetry block back to your AI session to validate the sync.

## When to invoke

| Trigger | Who invokes |
|---|---|
| First-time setup on a new machine | User: `$agent-sync` |
| Any `ai-agents/providers/codex/*.toml` added, renamed, or changed | Agent that made the change |
| `spawn_agent` can't find an expected agent at startup | Foreman: run `$agent-sync`, then retry |
| Migrating from subagent-smoke or an older roster | User: `$agent-sync` once |

## Resilience

| Risk | Protection |
|---|---|
| Config corruption | Timestamped `.bak-YYYYMMDDHHMMSS` backup before every write |
| agent-os not found | Search order: `AGENT_OS_PATH` env → `~/Documents/GitHub/agent-os` → `~/Code/agent-os` → `~/code/agent-os` → `~/projects/agent-os` → cwd |
| Global config missing | Created with safe defaults before merge |
| Relative path written | Absolute resolution enforced |
| Foreign agents in global config | Listed as `noticed`, never deleted |
| One agent file fails to parse | Warn and continue — other agents still sync |
| `--dry-run` | No files written; full telemetry printed |

## Implementation

The sync logic lives in `scripts/agent-sync.sh`.
