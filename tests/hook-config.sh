#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT/.codex/hooks.json" "$ROOT/.claude/settings.json" <<'PY'
import json
import sys

def flatten_commands(payload):
    hooks = payload.get("hooks", {})
    commands = []
    for key in ("SessionStart", "PreToolUse", "PostToolUse", "Stop"):
        for matcher in hooks.get(key, []):
            for hook in matcher.get("hooks", []):
                commands.append((key, hook.get("command", "")))
    return hooks, commands

def assert_hooks(label, path):
    payload = json.load(open(path))
    _, commands = flatten_commands(payload)
    command_strings = [command for _, command in commands]
    required = ["session-start.sh", "git-health.sh", "pre-tool-use.sh", "check-messages.sh", "post-tool-use.sh", "final-response.sh", "session-stop.sh"]
    for needle in required:
        if not any(needle in command for command in command_strings):
            raise SystemExit(f"FAIL: {label} missing required hook command containing {needle!r}: {command_strings}")

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
