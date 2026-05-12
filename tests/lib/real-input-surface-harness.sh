#!/usr/bin/env bash

REAL_INPUT_SURFACE_HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REAL_INPUT_SURFACE_HARNESS_DIR/visual-harness.sh"

AOS_REAL_INPUT_SURFACE_INSPECTOR_ID="${AOS_REAL_INPUT_SURFACE_INSPECTOR_ID:-surface-inspector}"

aos_real_input_surface_run() {
  local aos_bin
  aos_bin="$(aos_visual_aos)"
  "$aos_bin" "$@"
}

aos_real_input_surface_run_json() {
  aos_real_input_surface_run "$@" | python3 -m json.tool
}

aos_real_input_surface_wait_until() {
  local timeout="${1:?timeout seconds required}"
  local label="${2:?label required}"
  shift 2
  local deadline
  deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if "$@"; then
      return 0
    fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for $label" >&2
  return 1
}

aos_real_input_surface_require_enabled() {
  if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
    echo "SKIP: this scenario uses real mouse/keyboard input. Re-run with AOS_REAL_INPUT_OK=1 when the keyboard and mouse are idle."
    return 77
  fi
}

aos_real_input_surface_canvas_exists() {
  local canvas_id="$1"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show get --id "$canvas_id" >/dev/null 2>&1
}

aos_real_input_surface_assert_inspector_visible() {
  local inspector_id="${1:-$AOS_REAL_INPUT_SURFACE_INSPECTOR_ID}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show wait \
    --id "$inspector_id" \
    --manifest canvas-inspector \
    --js '(() => {
      const state = window.__canvasInspectorState;
      const rows = document.querySelectorAll(".tree-row.canvas").length;
      const minimap = !!document.querySelector(".minimap-display");
      return !!state && rows > 0 && minimap && document.visibilityState === "visible";
    })()' \
    --timeout 5s >/dev/null

  python3 - "$aos_bin" "$inspector_id" <<'PY'
import json
import subprocess
import sys

aos, inspector_id = sys.argv[1:3]
payload = json.loads(subprocess.check_output([aos, "show", "get", "--id", inspector_id], text=True))
canvas = payload.get("canvas") or {}
frame = canvas.get("at") or canvas.get("frame") or []
if len(frame) < 4 or int(frame[2]) <= 1 or int(frame[3]) <= 1:
    raise SystemExit(f"FAIL: Surface Inspector is not visibly placed: {json.dumps(canvas, sort_keys=True)}")
if canvas.get("lifecycleState") == "warm_suspended" or canvas.get("lifecycle") == "warm_suspended" or canvas.get("suspended") is True or canvas.get("interactive") is False:
    raise SystemExit(f"FAIL: Surface Inspector is not active/interactive: {json.dumps(canvas, sort_keys=True)}")
print(json.dumps({
    "inspectorId": inspector_id,
    "frame": frame[:4],
    "interactive": canvas.get("interactive"),
    "lifecycle": canvas.get("lifecycle"),
}, sort_keys=True))
PY
}

aos_real_input_surface_start() {
  local inspector_id="${1:-$AOS_REAL_INPUT_SURFACE_INSPECTOR_ID}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  aos_real_input_surface_require_enabled || return $?
  "$aos_bin" ready >/dev/null

  if ! aos_real_input_surface_canvas_exists "$inspector_id"; then
    aos_visual_launch_canvas_inspector "$inspector_id"
  fi
  if ! aos_real_input_surface_assert_inspector_visible "$inspector_id" >/dev/null 2>&1; then
    local lifecycle_state
    lifecycle_state="$("$aos_bin" show get --id "$inspector_id" 2>/dev/null | python3 -c 'import json,sys; print((json.load(sys.stdin).get("canvas") or {}).get("lifecycleState", ""))' 2>/dev/null || true)"
    if [[ "$lifecycle_state" == "warm_suspended" || "$lifecycle_state" == "" ]]; then
      aos_visual_remove_canvas "$inspector_id" 5
      aos_visual_launch_canvas_inspector "$inspector_id"
    fi
    aos_real_input_surface_assert_inspector_visible "$inspector_id" >/dev/null
  fi
}
