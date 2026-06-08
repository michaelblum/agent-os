# agent-sync

Idempotent Codex agent roster sync.  Reads `.codex/agents/*.toml` from
this repo and merges them into `~/.codex/config.toml`.

## Quick start

```bash
# From inside agent-os:
./scripts/agent-sync.sh

# Preview without writing anything:
./scripts/agent-sync.sh --dry-run

# Explicit path (useful from another repo or CI):
./scripts/agent-sync.sh --agent-os-path ~/Documents/GitHub/agent-os

# Via aos CLI (once wired):
./aos agent-sync
./aos agent-sync --dry-run

# Via Codex skill invocation:
$agent-sync
```

## What it does

1. Finds `~/.codex/config.toml` (creates it with safe defaults if missing).
2. Reads every `.codex/agents/*.toml` file in agent-os.
3. For each agent: **add** if new, **update** if description/path changed, **skip** if identical.
4. Never deletes agents that aren't in agent-os (foreign agents are listed as `noticed`).
5. Writes a timestamped `.bak-YYYYMMDDHHMMSS` backup before any mutation.

## When to run

- First setup on a new machine.
- After adding, renaming, or editing any `.codex/agents/*.toml`.
- Anytime `spawn_agent` can't find an expected agent at startup.

## Requirements

- macOS or Linux with Bash 3.2+
- Python 3.11+ (ships with macOS 12+)  
  OR Python 3.8+ with `pip install tomli`

## Full documentation

See [`SKILL.md`](./SKILL.md).
