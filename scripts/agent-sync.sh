#!/usr/bin/env bash
# agent-sync — sync agent-os agent roster → ~/.codex/config.toml
#
# Usage:
#   ./scripts/agent-sync.sh                          # auto-detect agent-os path
#   ./scripts/agent-sync.sh --dry-run                # preview changes, write nothing
#   ./scripts/agent-sync.sh --agent-os-path <path>   # explicit path override
#   AGENT_OS_PATH=/path/to/agent-os ./scripts/agent-sync.sh
#
# Invokable as $agent-sync from the Codex CLI.
# See ai-agents/providers/codex/SKILL.md for full documentation.

set -euo pipefail

DRY_RUN=false
AGENT_OS_PATH="${AGENT_OS_PATH:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-os-path) AGENT_OS_PATH="$2"; shift 2 ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── 1. Resolve agent-os root ────────────────────────────────────────────────
if [[ -z "$AGENT_OS_PATH" ]]; then
  for candidate in \
    "$HOME/Documents/GitHub/agent-os" \
    "$HOME/Code/agent-os"; do
    if [[ -d "$candidate/ai-agents/providers/codex" ]]; then
      AGENT_OS_PATH="$candidate"
      break
    fi
  done
fi

# Fallback: are we already inside agent-os?
if [[ -z "$AGENT_OS_PATH" && -d "ai-agents/providers/codex" ]]; then
  AGENT_OS_PATH="$(pwd)"
fi

if [[ -z "$AGENT_OS_PATH" ]]; then
  echo "ERROR: Cannot locate agent-os." >&2
  echo "       Set AGENT_OS_PATH env var or run from inside the repo." >&2
  exit 1
fi

echo "agent-sync: source = $AGENT_OS_PATH"

AGENTS_DIR="$AGENT_OS_PATH/ai-agents/providers/codex"
GLOBAL_CONFIG="$HOME/.codex/config.toml"

# ── 2. Ensure global config exists ──────────────────────────────────────────
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
  echo "agent-sync: created $GLOBAL_CONFIG with safe defaults"
fi

# ── 3. Merge via Python 3 (ships with macOS 12+) ────────────────────────────
python3 - "$AGENTS_DIR" "$GLOBAL_CONFIG" "$DRY_RUN" <<'PYEOF'
import sys, os, re, pathlib, shutil, datetime

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib  # pip install tomli for Python < 3.11
    except ImportError:
        print("ERROR: Python 3.11+ required (or install tomli: pip install tomli)", file=sys.stderr)
        sys.exit(1)

agents_dir = pathlib.Path(sys.argv[1])
global_cfg = pathlib.Path(sys.argv[2])
dry_run    = sys.argv[3] == "true"

# ── Read source agents from .toml files ─────────────────────────────────────
source = {}
for toml_file in sorted(agents_dir.glob("*.toml")):
    try:
        with open(toml_file, "rb") as f:
            data = tomllib.load(f)
        name = data.get("name") or toml_file.stem
        source[name] = {
            "name":                name,
            "description":         data.get("description", "").strip(),
            "nickname_candidates": data.get("nickname_candidates", []),
            "config_file":         str(toml_file.resolve()),
        }
    except Exception as e:
        print(f"  WARN: skipping {toml_file.name} — parse error: {e}", flush=True)

if not source:
    print("  WARN: no agent .toml files found in", agents_dir, flush=True)
    sys.exit(0)

# ── Read existing global config as raw text ──────────────────────────────────
raw = global_cfg.read_text()

# Detect existing [agents.<name>] blocks
existing_agents = set(re.findall(r'^\[agents\.(\w[\w-]*)\]', raw, re.MULTILINE))

added, updated, skipped, noticed = [], [], [], []
new_blocks = []

for name, agent in source.items():
    desc     = agent["description"].replace('"', '\\"')
    cfg_path = agent["config_file"]
    nicks    = agent["nickname_candidates"]

    lines = [f'[agents.{name}]']
    lines.append(f'description         = "{desc}"')
    if nicks:
        nicks_str = ", ".join(f'"{n}"' for n in nicks)
        lines.append(f'nickname_candidates = [{nicks_str}]')
    lines.append(f'config_file         = "{cfg_path}"')
    new_block = "\n".join(lines) + "\n"

    if name not in existing_agents:
        new_blocks.append(new_block)
        added.append(name)
    else:
        # Detect if anything meaningful changed
        needs_update = (
            agent["description"] and f'"{agent["description"]}"' not in raw
        ) or (cfg_path not in raw)

        if needs_update:
            pattern = rf'\[agents\.{re.escape(name)}\][^\[]*'
            raw = re.sub(pattern, new_block, raw, flags=re.DOTALL)
            updated.append(name)
        else:
            skipped.append(name)

# Agents in global config not sourced from agent-os (do not touch)
for name in existing_agents:
    if name not in source:
        noticed.append(name)

# Append new agent blocks
if new_blocks:
    raw = raw.rstrip() + "\n\n" + "\n\n".join(new_blocks) + "\n"

# ── Write changes (with backup) ──────────────────────────────────────────────
if not dry_run and (added or updated):
    ts     = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    backup = str(global_cfg) + ".bak-" + ts
    shutil.copy2(global_cfg, backup)
    global_cfg.write_text(raw)
    print(f"  backup: {backup}", flush=True)

# ── Report ───────────────────────────────────────────────────────────────────
print("\nagent-sync complete")
if added:   print(f"  added:   {', '.join(added)}")
if updated: print(f"  updated: {', '.join(updated)}")
if skipped: print(f"  skipped: {', '.join(skipped)} (no change)")
if noticed: print(f"  noticed: {', '.join(noticed)} (foreign agents — untouched)")
if dry_run: print("  [dry-run — no files written]")
PYEOF
