write_fake_native_aos() {
    local file="$1"
    cat >"$file" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "__see" && "${2:-}" == "capture" ]]; then
    if [[ "${NATIVE_DENIED_PERMISSION_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_denied_permission_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-install",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "focused": false,
      "action_names": ["AXPress", "AXFocus"],
      "actions": ["press", "focus"],
      "permission_state": "denied",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_WEAK_BASELINE_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_weak_baseline_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-install",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "focused": false,
      "action_names": ["AXPress"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_SYNTHETIC_BASELINE_ONLY_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_synthetic_baseline_only_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-synthetic-baseline-only",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "focused": false,
      "action_names": ["AXPress", "AXFocus"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_DISABLED_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_disabled_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-install",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": false,
      "action_names": ["AXPress"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_KNOWN_LIMIT_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_known_limit_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-off-space",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "action_names": ["AXPress"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "space_state": "off_space",
      "off_space": true,
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    },
    {
      "ref": "native-minimized",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5151,
      "role": "AXButton",
      "title": "Hidden Install",
      "label": "Hidden install fixture",
      "identifier": "hidden-install-button",
      "value": "ready",
      "enabled": true,
      "action_names": ["AXPress"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "window_state": "minimized",
      "minimized": true,
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Hidden"]
    },
    {
      "ref": "native-custom-control",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5152,
      "role": "AXGroup",
      "title": "Timeline",
      "label": "Timeline scrubber",
      "identifier": "timeline-scrubber",
      "value": "0:10",
      "enabled": true,
      "action_names": ["AXPress"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "control_kind": "custom_control",
      "custom_control": true,
      "bounds": { "x": 12, "y": 40, "width": 260, "height": 40 },
      "context_path": ["app:Fixture", "window:Main", "Timeline"]
    },
    {
      "ref": "native-game-canvas",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5153,
      "role": "AXGroup",
      "title": "Game Board",
      "label": "Game canvas",
      "identifier": "game-board",
      "value": "active",
      "enabled": true,
      "action_names": ["AXPress"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "surface_kind": "game_canvas",
      "canvas_surface": true,
      "bounds": { "x": 0, "y": 0, "width": 640, "height": 480 },
      "context_path": ["app:Fixture", "window:Game"]
    },
    {
      "ref": "native-focus-mismatch",
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5154,
      "role": "AXTextField",
      "title": "Name",
      "label": "Name field",
      "identifier": "name-field",
      "value": "",
      "enabled": true,
      "focused": false,
      "action_names": ["AXSetValue", "AXFocus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "focus_state": "mismatch",
      "bounds": { "x": 10, "y": 60, "width": 200, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_DURABLE_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_durable_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-install",
      "app_pid": 4242,
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "focused": false,
      "action_names": ["AXPress", "AXFocus"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    },
    {
      "ref": "native-name",
      "app_pid": 4242,
      "window_id": 5150,
      "role": "AXTextField",
      "title": "Name",
      "label": "Name field",
      "identifier": "name-field",
      "value": "",
      "enabled": true,
      "focused": false,
      "action_names": ["AXSetValue", "AXFocus"],
      "actions": ["set-value", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "bounds": { "x": 10, "y": 60, "width": 200, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_PRESS_ONLY_DURABLE_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_press_only_durable_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-install",
      "app_pid": 4242,
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "action_names": ["AXPress", "AXFocus"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_UNSUPPORTED_DURABLE_ACTION_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_unsupported_durable_action_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-menu-only",
      "app_pid": 4242,
      "window_id": 5150,
      "role": "AXMenuButton",
      "title": "Options",
      "label": "Options menu",
      "identifier": "options-menu",
      "value": "closed",
      "enabled": true,
      "action_names": ["AXShowMenu"],
      "actions": ["press", "focus", "set-value"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "bounds": { "x": 100, "y": 20, "width": 90, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    if [[ "${NATIVE_STABLE_PATH_ONLY_CAPTURE:-0}" == "1" ]]; then
        cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_stable_path_only_fixture",
  "files": [],
  "elements": [
    {
      "ref": "native-path-only",
      "app_pid": 4242,
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "stable_path": "AXWindow[0]/AXButton[2]",
      "value": "ready",
      "enabled": true,
      "action_names": ["AXPress"],
      "actions": ["press", "focus"],
      "permission_state": "granted",
      "focus_cursor_space_baseline": { "captured": true, "focus": "not_changed", "cursor": "not_changed", "space": "not_changed" },
      "native_saved_ref_evidence": { "status": "actionable", "actionability": "direct_ax_saved_ref_mutation", "known_limit_facts_complete": true, "producer": "native_ax", "reasons": [] },
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
        exit 0
    fi
    cat <<'JSON'
{
  "status": "success",
  "state_id": "see_native_fixture",
  "files": [],
  "elements": [
    {
      "app_pid": 4242,
      "app_name": "Fixture",
      "window_id": 5150,
      "role": "AXButton",
      "title": "Install",
      "label": "Install fixture",
      "identifier": "install-button",
      "value": "ready",
      "enabled": true,
      "focused": false,
      "action_names": ["AXPress"],
      "permission_state": "granted",
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "context_path": ["app:Fixture", "window:Main"]
    }
  ]
}
JSON
    exit 0
fi

if [[ "${1:-}" == "do" && ( "${2:-}" == "press" || "${2:-}" == "focus" || "${2:-}" == "set-value" ) && " $* " == *" --pid 4242 "* ]]; then
    verb="$2"
    shift 2
    node scripts/aos-do-native.mjs "$verb" "$@"
    exit $?
fi

if [[ "${1:-}" == "__do" && "${2:-}" == "press" && " $* " == *" --pid 4242 "* ]]; then
    if [[ "${NATIVE_AX_FAIL:-0}" == "1" ]]; then
        cat >&2 <<'JSON'
{"code":"AX_TARGET_NOT_FOUND","error":"no matching AX element"}
JSON
        exit 9
    fi
    python3 - "$@" <<'PY'
import json
import os
import sys

args = sys.argv[1:]
fallback = os.environ.get("NATIVE_AX_FALLBACK") == "1"
print(json.dumps({
    "status": "dry_run" if "--dry-run" in args else "success",
    "action": "press",
    "backend": "ax",
    "target": {
        "pid": 4242,
        "role": "AXButton",
        "title": "Install",
    },
    "execution": {
        "backend": "ax",
        "strategy": "dry_run_press" if "--dry-run" in args else "ax_press",
        "fallback_used": fallback,
        "foreground_fallback_required": fallback,
    },
    "received": args,
}))
PY
    exit 0
fi

if [[ "${1:-}" == "__do" && "${2:-}" == "focus" && " $* " == *" --pid 4242 "* ]]; then
    python3 - "$@" <<'PY'
import json
import os
import sys

args = sys.argv[1:]
fallback = os.environ.get("NATIVE_AX_FALLBACK") == "1"
print(json.dumps({
    "status": "dry_run" if "--dry-run" in args else "success",
    "action": "focus",
    "backend": "ax",
    "target": {
        "pid": 4242,
        "role": "AXTextField",
        "title": "Name",
    },
    "execution": {
        "backend": "ax",
        "strategy": "dry_run_focus" if "--dry-run" in args else "ax_focus",
        "fallback_used": fallback,
        "foreground_fallback_required": fallback,
    },
    "received": args,
}))
PY
    exit 0
fi

if [[ "${1:-}" == "__do" && "${2:-}" == "set-value" && " $* " == *" --pid 4242 "* ]]; then
    python3 - "$@" <<'PY'
import json
import os
import sys

args = sys.argv[1:]
fallback = os.environ.get("NATIVE_AX_FALLBACK") == "1"
print(json.dumps({
    "status": "dry_run" if "--dry-run" in args else "success",
    "action": "set-value",
    "backend": "ax",
    "target": {
        "pid": 4242,
        "role": "AXTextField",
        "title": "Name",
    },
    "execution": {
        "backend": "ax",
        "strategy": "dry_run_set_value" if "--dry-run" in args else "ax_set_value",
        "fallback_used": fallback,
        "foreground_fallback_required": fallback,
    },
    "received": args,
}))
PY
    exit 0
fi

echo "unexpected fake aos invocation: $*" >&2
exit 2
SH
    chmod +x "$file"
}
