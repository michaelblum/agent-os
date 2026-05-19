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

aos_real_input_surface_cleanup_subject_family() {
  local root_id="${1:?root canvas id required}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$root_id" <<'PY'
import json
import subprocess
import sys

aos, root_id = sys.argv[1:3]
before = json.loads(subprocess.check_output([aos, "show", "list", "--json"], text=True)).get("canvases", [])
by_id = {canvas.get("id"): canvas for canvas in before if canvas.get("id")}
children = {}
for canvas in before:
    parent = canvas.get("parent") or canvas.get("parent_id")
    if parent:
        children.setdefault(parent, []).append(canvas)

removed_candidates = []
orphan_candidates = []

def walk(canvas_id):
    canvas = by_id.get(canvas_id)
    if not canvas:
        return
    removed_candidates.append(canvas_id)
    for child in children.get(canvas_id, []):
        child_id = child.get("id")
        if not child_id:
            continue
        if child.get("cascade") is False:
            orphan_candidates.append(child_id)
        else:
            walk(child_id)

walk(root_id)
root_present = root_id in by_id
remove_error = None
if root_present:
    try:
        subprocess.check_output([aos, "show", "remove", "--id", root_id], text=True, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as error:
        remove_error = error.output.strip()

after = json.loads(subprocess.check_output([aos, "show", "list", "--json"], text=True)).get("canvases", [])
after_by_id = {canvas.get("id"): canvas for canvas in after if canvas.get("id")}

removed = [canvas_id for canvas_id in removed_candidates if canvas_id not in after_by_id]
preserved = [canvas.get("id") for canvas in after if canvas.get("id") not in removed_candidates]
orphaned = [
    canvas_id for canvas_id in orphan_candidates
    if canvas_id in after_by_id and not (after_by_id[canvas_id].get("parent") or after_by_id[canvas_id].get("parent_id"))
]
errors = []
if remove_error:
    errors.append({"kind": "canvas", "id": root_id, "message": remove_error})
for canvas_id in removed_candidates:
    if canvas_id in after_by_id and canvas_id not in orphan_candidates:
        errors.append({"kind": "canvas", "id": canvas_id, "message": "expected removal but canvas remains"})

print(json.dumps({
    "rootCanvasId": root_id,
    "rootPresentBeforeCleanup": root_present,
    "removed": removed,
    "preserved": preserved,
    "orphaned": orphaned,
    "errors": errors,
}, sort_keys=True))
sys.exit(1 if errors else 0)
PY
}

aos_real_input_surface_assert_inspector_visible() {
  local inspector_id="${1:-$AOS_REAL_INPUT_SURFACE_INSPECTOR_ID}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show wait \
    --id "$inspector_id" \
    --manifest surface-inspector \
    --js '(() => {
      const state = window.__canvasInspectorState;
      const rows = document.querySelectorAll(".tree-row.canvas").length;
      const minimap = !!document.querySelector(".minimap-display");
      return !!state && rows > 0 && minimap;
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
  if ! "$aos_bin" status --json 2>/dev/null | python3 -c 'import json,sys; data=json.load(sys.stdin); runtime=data.get("runtime") or {}; raise SystemExit(0 if (runtime.get("socket_reachable") is True and runtime.get("input_tap_status") == "active") else 1)' >/dev/null 2>&1; then
    "$aos_bin" ready >/dev/null
  fi

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
