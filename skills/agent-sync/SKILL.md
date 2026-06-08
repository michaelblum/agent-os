---
name: agent-sync
description: >
  Syncs agent definitions from the agent-os repo into the user-level
  ~/.codex/config.toml so spawn_agent can find them at startup.
  Idempotent: add, update, or skip — never destructive.
  Invoke with '$agent-sync' in the CLI or dispatch from any agent that
  needs to register, rename, or retire an agent in the global roster.
---

# agent-sync

Installs or updates the Codex agent roster from `agent-os` into the
user-level Codex config.  Safe to re-run at any time.

## When to invoke

| Trigger | Who invokes |
|---|---|
| First-time setup on a new machine | User: `$agent-sync` in CLI |
| A `.codex/agents/*.toml` file is added or renamed in `agent-os` | Any agent that made the change |
| A `description` or `nickname_candidates` field changes | Any agent that made the change |
| Foreman or Steward can't find an expected subagent at spawn time | Foreman: dispatch agent-sync, then retry |

## What this skill does

1. **Locate the global config** — resolves `~/.codex/config.toml`.  If the
   file does not exist, create it with safe defaults before writing agents.
2. **Find agent-os** — checks (in order):
   - The env var `AGENT_OS_PATH` if set.
   - `~/Documents/GitHub/agent-os`
   - `~/Code/agent-os`
   - `git remote get-url origin` inside the current working directory if
     the cwd looks like a clone of `agent-os`.
   Abort with a clear error if none resolve.
3. **Read the source roster** — parse every `*.toml` file under
   `<agent-os>/.codex/agents/`.  Each file is one agent.
   Required fields per agent: `name`, `description`.
   Optional: `nickname_candidates` (array of strings).
4. **Merge into `~/.codex/config.toml`** — for each agent found:
   - If `[agents.<name>]` block does not exist → append it.
   - If it exists and any field differs → overwrite those fields in-place.
   - If it exists and all fields match → skip (no write).
   - **Never delete** an existing `[agents.*]` block that isn't in the
     source roster — it might belong to another project.  Log a notice
     instead.
5. **Absolute `config_file` path** — the written path must be absolute:
   `<agent-os>/.codex/agents/<name>.toml`.
   Never write a relative path into the global config.
6. **Report what changed** — print a terse summary:
   ```
   agent-sync complete
     added:   architect, implementer
     updated: reviewer (description changed)
     skipped: explorer, validator, operator, steward (no change)
     noticed: [any agents in global config not in source — listed but untouched]
   ```

## Implementation (shell — preferred for portability)

Write this as `scripts/agent-sync.sh` in agent-os.  The skill invocation
`$agent-sync` maps to `./scripts/agent-sync.sh` via the `aos` command surface
or directly as a shell script.

```sh
#!/usr/bin/env bash
# agent-sync — sync agent-os agent roster → ~/.codex/config.toml
# Usage: ./scripts/agent-sync.sh [--agent-os-path <path>] [--dry-run]
set -euo pipefail

DRY_RUN=false
AGENT_OS_PATH=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-os-path) AGENT_OS_PATH="$2"; shift 2 ;;
    --dry-run)       DRY_RUN=true; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# 1. Resolve agent-os root
if [[ -z "$AGENT_OS_PATH" ]]; then
  for candidate in \
    "${AGENT_OS_PATH:-}" \
    "$HOME/Documents/GitHub/agent-os" \
    "$HOME/Code/agent-os"; do
    [[ -d "$candidate/.codex/agents" ]] && { AGENT_OS_PATH="$candidate"; break; }
  done
fi

# Fallback: cwd if it looks like agent-os
if [[ -z "$AGENT_OS_PATH" && -d ".codex/agents" ]]; then
  AGENT_OS_PATH="$(pwd)"
fi

if [[ -z "$AGENT_OS_PATH" ]]; then
  echo "ERROR: Cannot locate agent-os. Set AGENT_OS_PATH or run from inside the repo." >&2
  exit 1
fi

AGENTS_DIR="$AGENT_OS_PATH/.codex/agents"
GLOBAL_CONFIG="$HOME/.codex/config.toml"

# 2. Ensure global config exists
if [[ ! -f "$GLOBAL_CONFIG" ]]; then
  mkdir -p "$(dirname "$GLOBAL_CONFIG")"
  cat > "$GLOBAL_CONFIG" <<'EOF'
# ~/.codex/config.toml — created by agent-sync
model = "gpt-5.5"
model_reasoning_effort = "medium"
approval_policy = "on-failure"
sandbox_mode = "workspace-write"

[features]
multi_agent_v2 = true
guardian_approval = true
EOF
  echo "Created $GLOBAL_CONFIG with safe defaults."
fi

# 3. Parse and merge — requires Python 3 (ships with macOS)
python3 - "$AGENTS_DIR" "$GLOBAL_CONFIG" "$DRY_RUN" <<'PYEOF'
import sys, os, re, tomllib, pathlib, shutil, datetime

agents_dir   = pathlib.Path(sys.argv[1])
global_cfg   = pathlib.Path(sys.argv[2])
dry_run      = sys.argv[3] == "true"

# Read source agents
source = {}
for toml_file in sorted(agents_dir.glob("*.toml")):
    try:
        with open(toml_file, "rb") as f:
            data = tomllib.load(f)
        name = data.get("name") or toml_file.stem
        source[name] = {
            "name":                name,
            "description":         data.get("description", ""),
            "nickname_candidates": data.get("nickname_candidates", []),
            "config_file":         str(toml_file.resolve()),
        }
    except Exception as e:
        print(f"  WARN: could not parse {toml_file.name}: {e}", flush=True)

# Read existing global config as raw text (preserve hand-authored content)
raw = global_cfg.read_text()

# Parse existing [agents.*] blocks to detect what's already there
existing_agents = set(re.findall(r'^\[agents\.(\w[\w-]*)\]', raw, re.MULTILINE))

added, updated, skipped, noticed = [], [], [], []
new_blocks = []

for name, agent in source.items():
    block_header = f"[agents.{name}]"
    desc_line    = f'description         = "{agent["description"]}"'
    nicks_line   = ""
    if agent["nickname_candidates"]:
        nicks   = ", ".join(f'"{n}"' for n in agent["nickname_candidates"])
        nicks_line = f"nickname_candidates = [{nicks}]\n"
    cfg_line     = f'config_file         = "{agent["config_file"]}"'
    new_block    = f"{block_header}\n{desc_line}\n{nicks_line}{cfg_line}\n"

    if name not in existing_agents:
        new_blocks.append(new_block)
        added.append(name)
    else:
        # Check if update needed — simple substring checks
        needs_update = (
            agent["description"] and agent["description"] not in raw
        ) or (
            agent["config_file"] not in raw
        )
        if needs_update:
            # Replace the existing block
            pattern = rf'(\[agents\.{re.escape(name)}\][^\[]*?)'
            raw = re.sub(pattern, new_block, raw, flags=re.DOTALL)
            updated.append(name)
        else:
            skipped.append(name)

# Agents in global config not in source
for name in existing_agents:
    if name not in source:
        noticed.append(name)

# Append new blocks
if new_blocks:
    raw = raw.rstrip() + "\n\n" + "\n".join(new_blocks)

# Write (unless dry-run)
if not dry_run and (added or updated):
    backup = str(global_cfg) + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    shutil.copy2(global_cfg, backup)
    global_cfg.write_text(raw)
    print(f"  Backup written to {backup}", flush=True)

# Report
print("\nagent-sync complete")
if added:   print(f"  added:   {', '.join(added)}")
if updated: print(f"  updated: {', '.join(updated)}")
if skipped: print(f"  skipped: {', '.join(skipped)} (no change)")
if noticed: print(f"  noticed: {', '.join(noticed)} (in global config but not in agent-os — untouched)")
if dry_run: print("  [dry-run — no files written]")
PYEOF
```

## Resilience properties

| Risk | Protection |
|---|---|
| Config corruption | Timestamped `.bak-YYYYMMDDHHMMSS` backup written before every mutation |
| agent-os not found | Explicit search order + env var override + clear error |
| Global config missing | Created with safe defaults before any merge |
| Relative path written | Absolute resolution enforced in Python step |
| Agent in global config deleted by accident | `noticed` list only — never deletes foreign agents |
| TOML parse failure on one agent file | Per-file try/except — warn and continue, don't abort |
| Concurrent run | Last writer wins; backup makes this recoverable |
| `--dry-run` | No files written; full report still printed |
| Python not available | Script prints a clear error (Python 3 ships with macOS 12+) |

## Registering the skill in agent-os

Add to `AGENTS.md` (or the project's skill registry) so agents know to
invoke `$agent-sync` when they create, rename, or retire an agent config:

```markdown
## agent-sync
Invoke `$agent-sync` after any change to `.codex/agents/*.toml`.
This syncs the updated roster into `~/.codex/config.toml`.
See `skills/agent-sync/SKILL.md` for full spec.
```

## aos CLI integration (optional)

Add to `scripts/aos-dev-workflow.mjs` or register as a named `aos` command:

```js
// In command dispatch
case 'agent-sync': {
  await execa('bash', ['scripts/agent-sync.sh', ...remainingArgs], { stdio: 'inherit' })
  break
}
```

Once wired, `./aos agent-sync` and `./aos agent-sync --dry-run` both work.
