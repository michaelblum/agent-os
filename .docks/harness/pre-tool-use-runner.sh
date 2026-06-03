#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"
if [[ "$phase" != "pre-tool-use" ]]; then
  echo "FAIL: usage: pre-tool-use-runner.sh pre-tool-use <dock>" >&2
  exit 2
fi
case "$dock" in
  *[!a-zA-Z0-9_.-]*|"") echo "FAIL: invalid dock" >&2; exit 2 ;;
esac

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
payload="$(cat || true)"

python_result="$(python3 - "$payload" <<'PY'
import json
import pathlib
import shlex
import sys

raw = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    payload = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    payload = {}

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from strings(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from strings(nested)

def command_candidates(value):
    if not isinstance(value, dict):
        return []
    candidates = []
    for key in ("command", "cmd", "input", "tool_input"):
        nested = value.get(key)
        if isinstance(nested, str):
            candidates.append(nested)
        elif isinstance(nested, dict):
            for inner_key in ("command", "cmd"):
                inner = nested.get(inner_key)
                if isinstance(inner, str):
                    candidates.append(inner)
    return candidates

def split_command(command):
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()

def command_contains_repo_binary_build(command, depth=0):
    if depth > 2:
        return False
    parts = split_command(command)
    if not parts:
        return False
    executable = pathlib.Path(parts[0]).name
    if executable == "aos" and len(parts) >= 3 and parts[1:3] == ["dev", "build"]:
        return True
    if executable == "build.sh":
        return True
    if executable == "aos-after-build":
        return True
    if executable in {"bash", "sh", "zsh"}:
        if len(parts) >= 2 and pathlib.Path(parts[1]).name == "build.sh":
            return True
        for index, part in enumerate(parts):
            if part in {"-c", "-lc"} and index + 1 < len(parts):
                return command_contains_repo_binary_build(parts[index + 1], depth + 1)
    return False

found = any(command_contains_repo_binary_build(candidate) for candidate in command_candidates(payload))
print("repo_binary_build" if found else "ignore")
PY
)"

if [[ "$python_result" != "repo_binary_build" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

if [[ "$dock" == "gdi" ]]; then
  message='gdi_binary_change_forbidden

GDI must not rebuild, refresh, or mutate the repo-mode ./aos binary. Stop and return this to Foreman as a binary/native ownership issue.

Blocked commands include ./aos dev build, build.sh, and scripts/aos-after-build. Foreman owns this binary correction and any post-build permission handoff.'
  python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"continue": False, "systemMessage": sys.argv[1]}))
PY
  exit 0
fi

if ! "$REPO_ROOT/.docks/harness/dev-build-checkpoint.sh" peek "$REPO_ROOT" "$dock" >/dev/null 2>&1; then
  printf '{"continue":true}\n'
  exit 0
fi

message="$("$REPO_ROOT/.docks/harness/dev-build-checkpoint-contract.sh" "$REPO_ROOT" repeated_build_system_message)"
python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"continue": False, "systemMessage": sys.argv[1]}))
PY
