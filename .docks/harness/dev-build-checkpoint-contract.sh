#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: dev-build-checkpoint-contract.sh <repo-root> <field>" >&2
  exit 2
}

repo_root="${1:-}"
field="${2:-}"
if [[ -z "$repo_root" || -z "$field" ]]; then
  usage
fi

aos_bin="${AOS_DOCK_CONTRACT_AOS_BIN:-$repo_root/aos}"
if ! [[ -x "$aos_bin" ]]; then
  echo "aos_unavailable" >&2
  exit 1
fi

payload="$("$aos_bin" dev build-checkpoint --json)"
python3 - "$field" "$payload" <<'PY'
import json
import sys

field = sys.argv[1]
payload = json.loads(sys.argv[2])

if field == "post_tool_system_message":
    print(payload["post_tool_system_message"])
elif field == "repeated_build_system_message":
    print(payload["repeated_build_system_message"])
elif field == "stop_system_message":
    print(payload["stop_system_message"])
elif field == "stop_system_message_after_build":
    print(payload["stop_system_message_after_build"])
elif field == "pause_command":
    print(payload["pause_command"])
elif field == "resume_command":
    print(payload["resume_command"])
elif field == "canvas_title":
    print(payload["canvas"]["title"])
elif field == "canvas_body":
    print(payload["canvas"]["body"])
elif field == "post_permission_ready_command":
    print(payload["commands"]["post_permission_ready"])
else:
    raise SystemExit(f"unknown field: {field}")
PY
