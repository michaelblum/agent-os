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

python3 - "$field" <<'PY'
import sys

field = sys.argv[1]

messages = {
    "post_tool_system_message": """goal_pause_required: repo-mode AOS permission repair

./aos dev build rebuilt the repo-mode AOS binary. This is the rare path that invalidates macOS TCC grants, so stop now for permission repair. Do not run ./aos dev build again after the human return signal unless a human explicitly asks for another rebuild.

Pause the active goal now by sending:
/goal pause

Stop the active session now. Do not run ready/repair/status/helper loops, setup, or other recovery loops before stopping. Do not run readiness, repair, status, or helper loops.

The hook has already requested:
./aos permissions reset-runtime --mode repo

TCC reset needed. User must do this.

Human action:
1. Open macOS System Settings -> Privacy & Security.
2. For the repo-mode AOS runtime, manually remove and re-add the entries needed for Accessibility, Input Monitoring, and Screen & System Audio Recording if they are stale or missing.
3. Enable the repo-mode AOS runtime in those panes.
4. Return to this waiting session, or the next turn for this same session, and say: finished.

After the human says finished, run exactly:
./aos ready --post-permission

If that reports ready=true, continue with the next planned step after the completed build.""",
    "repeated_build_system_message": """dev_build_checkpoint_already_completed

The repo-mode ./aos binary was rebuilt successfully for this checkpoint. Do not run ./aos dev build again. Wait for the permission recovery handoff instead.

TCC reset needed. User must do this.

Stop and wait for the human to complete the macOS TCC reset. After the human says finished, run exactly:
./aos ready --post-permission

If that reports ready=true, continue with the next planned step after the completed build.""",
    "stop_system_message": """GDI stopped for repo-mode AOS permission repair.

TCC reset needed. User must do this.

The hook/helper has already requested:
./aos permissions reset-runtime --mode repo

Do not run permission setup, readiness repair, status, or helper loops from the dock session.

Human action:
1. Open macOS System Settings -> Privacy & Security.
2. Grant the requested macOS Accessibility/Input Monitoring permission for the repo-mode AOS runtime.
3. For the repo-mode AOS runtime, manually remove and re-add stale or missing entries for Accessibility/Input Monitoring and Screen & System Audio Recording if the grant remains stale.
4. Enable the repo-mode AOS runtime in those panes.
5. Return to the waiting session and say: finished.

After the human says finished, run exactly:
./aos ready --post-permission""",
    "stop_system_message_after_build": """GDI stopped for repo-mode AOS permission repair.

TCC reset needed. User must do this.

Checkpoint: the repo-mode ./aos binary was rebuilt successfully. Do not run ./aos dev build again for this checkpoint after the human return signal.

The hook has already requested:
./aos permissions reset-runtime --mode repo

Do not run permission setup, readiness repair, status, or helper loops from the dock session.

Human action:
1. Open macOS System Settings -> Privacy & Security.
2. Grant the requested macOS Accessibility/Input Monitoring permission for the repo-mode AOS runtime.
3. For the repo-mode AOS runtime, manually remove and re-add stale or missing entries for Accessibility/Input Monitoring and Screen & System Audio Recording if the grant remains stale.
4. Enable the repo-mode AOS runtime in those panes.
5. Return to the waiting session and say: finished.

After the human says finished, run exactly:
./aos ready --post-permission

If ready=true, continue with the next planned step after the completed build.""",
    "pause_command": "/goal pause",
    "resume_command": "/goal resume",
    "return_signal": "finished",
    "canvas_title": "TCC reset needed",
    "canvas_body": "AOS rebuilt the repo-mode binary and requested a repo-mode permission reset. Complete the macOS TCC reset manually. Open System Settings -> Privacy & Security, remove and re-add the repo-mode AOS runtime in Accessibility, Input Monitoring, and Screen & System Audio Recording if needed, enable it, then return and say: finished.",
    "post_permission_ready_command": "./aos ready --post-permission",
}

try:
    print(messages[field])
except KeyError:
    raise SystemExit(f"unknown field: {field}")
PY
