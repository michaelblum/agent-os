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

def json_strings(value):
    for candidate in strings(value):
        text = candidate.strip()
        if not text or text[0] not in "{[":
            continue
        try:
            yield json.loads(text)
        except json.JSONDecodeError:
            continue

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
    return len(parts) >= 3 and pathlib.Path(parts[0]).name == "aos" and parts[1:3] == ["dev", "build"]

def normalizes_to_post_permission_ready(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()
    return len(parts) >= 2 and pathlib.Path(parts[0]).name == "aos" and parts[1] == "ready" and "--post-permission" in parts

def dev_build_was_noop(value):
    for item in walk(value):
        if isinstance(item, dict) and item.get("binary_rebuilt") is False:
            return True
    for nested in json_strings(value):
        for item in walk(nested):
            if isinstance(item, dict) and item.get("binary_rebuilt") is False:
                return True
    for item in strings(value):
        if "Up to date: ./aos" in item:
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
found_post_permission_ready = any(normalizes_to_post_permission_ready(candidate) for candidate in command_candidates(payload))

if found_build and not tool_failed(payload) and dev_build_was_noop(payload):
    print("dev_build_noop")
elif found_build and not tool_failed(payload):
    print("dev_build_success")
elif found_post_permission_ready and not tool_failed(payload):
    print("post_permission_ready_success")
else:
    print("ignore")
PY
)"

if [[ "$python_result" == "post_permission_ready_success" ]]; then
  # Hook-owned lifecycle: the human-needed surface is shown after a successful
  # GDI rebuild and cleared only by the explicit post-permission readiness handoff.
  "$REPO_ROOT/.docks/harness/human-needed-surface.sh" clear "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true
  "$REPO_ROOT/.docks/harness/dev-build-checkpoint.sh" clear "$REPO_ROOT" "$dock" >/dev/null 2>&1 || true
  printf '{"continue":true}\n'
  exit 0
fi

if [[ "$python_result" != "dev_build_success" ]]; then
  printf '{"continue":true}\n'
  exit 0
fi

aos_bin="${AOS_DOCK_AOS_BIN:-$REPO_ROOT/aos}"
"$aos_bin" permissions reset-runtime --mode repo >/dev/null 2>&1 || true
"$aos_bin" permissions setup --once >/dev/null 2>&1 || true
"$REPO_ROOT/.docks/harness/stop-condition.sh" write "$REPO_ROOT" "$dock" tcc_permission_reset 600
"$REPO_ROOT/.docks/harness/dev-build-checkpoint.sh" write "$REPO_ROOT" "$dock" 3600
"$REPO_ROOT/.docks/harness/goal-pause-control.sh" request "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true
(
  "$REPO_ROOT/.docks/harness/human-needed-surface.sh" show "$REPO_ROOT" "$dock" tcc_permission_reset >/dev/null 2>&1 || true
) >/dev/null 2>&1 &

if [[ "$dock" == "gdi" ]]; then
  message="$("$REPO_ROOT/.docks/harness/dev-build-checkpoint-contract.sh" "$REPO_ROOT" post_tool_system_message)"
else
  message="stop: user action needed

./aos dev build completed successfully, and repo runtime reset/setup were requested.
Stop now. Do not run readiness, repair, status, or helper loops before stopping.

The hook has already requested:
1. ./aos permissions reset-runtime --mode repo
2. ./aos permissions setup --once

Human action:
1. Complete the macOS System Settings permission step for the repo-mode AOS runtime.
2. If macOS does not prompt or the grant remains stale, physically remove and re-add the repo-mode aos runtime in Accessibility/Input Monitoring, then enable it.
3. Return to this waiting session, or the next turn for this same session, and say: finished

After the human says finished, run exactly:
./aos ready --post-permission

If that reports ready=true, continue with the next planned step after the completed build. Do not restart from the build step."
fi
python3 - "$message" <<'PY'
import json
import sys

print(json.dumps({"continue": False, "systemMessage": sys.argv[1]}))
PY
