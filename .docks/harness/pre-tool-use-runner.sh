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

def normalizes_to_dev_build(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()
    return len(parts) >= 3 and pathlib.Path(parts[0]).name == "aos" and parts[1:3] == ["dev", "build"]

found = any(normalizes_to_dev_build(candidate) for candidate in command_candidates(payload))
print("dev_build" if found else "ignore")
PY
)"

if [[ "$python_result" != "dev_build" ]]; then
  printf '{"continue":true}\n'
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
