#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" "$ROOT/.claude/settings.json" <<'PY'
import json
from pathlib import Path
import sys

def flatten_commands(payload, hook_name):
    hooks = payload.get("hooks", {})
    commands = []
    for matcher in hooks.get(hook_name, []):
        for hook in matcher.get("hooks", []):
            commands.append(hook.get("command", ""))
    return hooks, commands

def assert_claude_hooks(path):
    payload = json.load(open(path))
    _, session_start = flatten_commands(payload, "SessionStart")
    _, stop_hooks = flatten_commands(payload, "Stop")

    if not any("git-health.sh" in command for command in session_start):
        raise SystemExit(f"FAIL: claude missing SessionStart git-health hook: {session_start}")
    if any("session-start.sh" in command for command in session_start):
        raise SystemExit(f"FAIL: claude SessionStart should not invoke session-start.sh: {session_start}")
    if not any("final-response.sh" in command for command in stop_hooks):
        raise SystemExit(f"FAIL: claude missing Stop final-response hook: {stop_hooks}")

def assert_dock_codex_hooks(root):
    for role in ["gdi", "operator"]:
        path = Path(root) / ".docks" / role / ".codex" / "hooks.json"
        if path.exists():
            raise SystemExit(f"FAIL: retired standalone {role} Codex hooks still exist: {path}")

    foreman_path = Path(root) / ".docks" / "foreman" / ".codex" / "hooks.json"
    if foreman_path.exists():
        raise SystemExit(f"FAIL: retired Foreman Codex hooks still exist: {foreman_path}")

assert_dock_codex_hooks(sys.argv[1])
assert_claude_hooks(sys.argv[2])

claude_payload = json.load(open(sys.argv[2]))
precompact = claude_payload.get("hooks", {}).get("PreCompact", [])
precompact_commands = [
    hook.get("command", "")
    for matcher in precompact
    for hook in matcher.get("hooks", [])
]
if not any("pre-compact.sh" in command for command in precompact_commands):
    raise SystemExit(f"FAIL: claude missing PreCompact alert hook: {precompact_commands}")
PY

echo "PASS"
