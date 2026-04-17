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

def assert_minimal(label, path):
    payload = json.load(open(path))
    hooks, commands = flatten_commands(payload)

    if hooks.get("Stop"):
        raise SystemExit(f"FAIL: {label} should not define Stop hooks")

    command_strings = [command for _, command in commands]
    required = ("session-start.sh", "git-health.sh", "pre-tool-use.sh", "post-tool-use.sh")
    for needle in required:
        if not any(needle in command for command in command_strings):
            raise SystemExit(f"FAIL: {label} missing required hook command containing {needle!r}: {command_strings}")

    forbidden = (
        "check-messages.sh",
        "final-response.sh",
        "session-stop.sh",
        "session-common.sh",
        "session-name",
        "parallel-codex",
    )
    for needle in forbidden:
        if any(needle in command for command in command_strings):
            raise SystemExit(f"FAIL: {label} still references removed coordination hook asset {needle!r}: {command_strings}")

assert_minimal("codex", sys.argv[1])
assert_minimal("claude", sys.argv[2])
PY

echo "PASS"
