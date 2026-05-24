#!/usr/bin/env bash
set -euo pipefail

phase="${1:-}"
dock="${2:-}"

if [[ "$phase" != "post-tool-use" ]]; then
  echo "FAIL: usage: post-tool-use-runner.sh post-tool-use <dock>" >&2
  exit 2
fi
if [[ -z "$dock" ]]; then
  echo "FAIL: dock name is required" >&2
  exit 2
fi

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
payload="$(cat || true)"

python_result="$(python3 - "$payload" "$REPO_ROOT" <<'PY'
import json
import pathlib
import shlex
import sys

payload_text, repo_root = sys.argv[1:]

try:
    payload = json.loads(payload_text) if payload_text.strip() else {}
except json.JSONDecodeError:
    payload = {}

def walk(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)

def strings(value):
    for item in walk(value):
        if isinstance(item, str):
            yield item

def command_candidates(value):
    for item in walk(value):
        if not isinstance(item, dict):
            continue
        for key in ("cmd", "command", "shell_command"):
            candidate = item.get(key)
            if isinstance(candidate, str):
                yield candidate
        args = item.get("args")
        if isinstance(args, list) and all(isinstance(part, str) for part in args):
            yield " ".join(shlex.quote(part) for part in args)

def normalizes_to_dev_build(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()
    if len(parts) >= 3 and pathlib.Path(parts[0]).name == "aos" and parts[1:3] == ["dev", "build"]:
        return True
    if "./aos dev build" in command or "aos dev build" in command:
        return True
    return False

def normalizes_to_post_permission_ready(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()
    if len(parts) >= 3 and pathlib.Path(parts[0]).name == "aos" and parts[1] == "ready" and "--post-permission" in parts:
        return True
    if "./aos ready --post-permission" in command or "aos ready --post-permission" in command:
        return True
    return False

def tool_failed(value):
    failure_tokens = {
        "failed",
        "error",
        "errored",
        "cancelled",
        "canceled",
        "timeout",
        "timed_out",
    }
    for item in walk(value):
        if isinstance(item, dict):
            for key in ("exit_code", "status", "returncode", "return_code"):
                result = item.get(key)
                if isinstance(result, int) and result != 0:
                    return True
                if isinstance(result, str) and result.lower() in failure_tokens:
                    return True
            for key in ("success", "ok"):
                result = item.get(key)
                if result is False:
                    return True
    return False

found_build = any(normalizes_to_dev_build(candidate) for candidate in command_candidates(payload))
if not found_build:
    # Some providers put command text only in flat transcript strings.
    found_build = any(normalizes_to_dev_build(text) for text in strings(payload))

found_post_permission_ready = any(normalizes_to_post_permission_ready(candidate) for candidate in command_candidates(payload))
if not found_post_permission_ready:
    found_post_permission_ready = any(
        ("aos ready --post-permission" in text or "./aos ready --post-permission" in text)
        for text in strings(payload)
    )

if found_build and not tool_failed(payload):
    print("dev_build_success")
elif found_post_permission_ready and not tool_failed(payload):
    print("post_permission_ready_success")
else:
    print("ignore")
PY
)"

if [[ "$python_result" == "post_permission_ready_success" ]]; then
  "$REPO_ROOT/.docks/harness/human-needed-surface.sh" clear "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true
  printf '{"continue":true}\n'
  exit 0
fi

if [[ "$python_result" != "dev_build_success" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

"$REPO_ROOT/.docks/harness/stop-condition.sh" write "$REPO_ROOT" "$dock" tcc_permission_reset 600
"$REPO_ROOT/.docks/harness/human-needed-surface.sh" show "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true
"$REPO_ROOT/.docks/harness/goal-pause-control.sh" request "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true

python3 - "$dock" <<'PY'
import json
import sys

dock = sys.argv[1]
message = """goal_pause_required: repo-mode AOS permission repair

The last ./aos dev build completed. Repo-mode aos rebuilds are permission
sensitive checkpoints.

Pause the active goal now by sending:
/goal pause

Human action:
1. Run: ./aos permissions setup --once
2. Grant the requested macOS Accessibility/Input Monitoring permission if macOS prompts.
3. Return to this session and say: ready
4. Resume the paused goal with: /goal resume

After resume, run exactly:
./aos ready --post-permission

Do not run ready/repair/status/helper loops before pausing."""

print(json.dumps({"continue": True, "systemMessage": message}))
PY
