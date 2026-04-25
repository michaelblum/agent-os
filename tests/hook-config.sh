#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT/.codex/hooks.json" "$ROOT/.claude/settings.json" <<'PY'
import json
import sys

def flatten_commands(payload, hook_name):
    hooks = payload.get("hooks", {})
    commands = []
    for matcher in hooks.get(hook_name, []):
        for hook in matcher.get("hooks", []):
            commands.append(hook.get("command", ""))
    return hooks, commands

def assert_hooks(label, path):
    payload = json.load(open(path))
    _, session_start = flatten_commands(payload, "SessionStart")
    _, stop_hooks = flatten_commands(payload, "Stop")

    if not any("git-health.sh" in command for command in session_start):
        raise SystemExit(f"FAIL: {label} missing SessionStart git-health hook: {session_start}")
    if any("session-start.sh" in command for command in session_start):
        raise SystemExit(f"FAIL: {label} SessionStart should not invoke session-start.sh: {session_start}")
    if not any("final-response.sh" in command for command in stop_hooks):
        raise SystemExit(f"FAIL: {label} missing Stop final-response hook: {stop_hooks}")

assert_hooks("codex", sys.argv[1])
assert_hooks("claude", sys.argv[2])

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
