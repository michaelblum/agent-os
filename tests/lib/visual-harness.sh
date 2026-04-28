#!/usr/bin/env bash

VISUAL_HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VISUAL_HARNESS_ROOT="$(cd "$VISUAL_HARNESS_DIR/../.." && pwd)"

source "$VISUAL_HARNESS_DIR/isolated-daemon.sh"
source "$VISUAL_HARNESS_DIR/status-item.sh"

aos_visual_root() {
  printf '%s\n' "$VISUAL_HARNESS_ROOT"
}

aos_visual_aos() {
  printf '%s\n' "${AOS:-$VISUAL_HARNESS_ROOT/aos}"
}

aos_visual_seed_sigil() {
  local mode="${1:-repo}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"
  AOS_BIN="$aos_bin" AOS_RUNTIME_MODE="$mode" "$VISUAL_HARNESS_ROOT/apps/sigil/sigilctl-seed.sh" >/dev/null
}

aos_visual_start_isolated_daemon() {
  local state_root="$1"
  shift

  AOS_STATE_ROOT="$state_root" aos_test_start_daemon "$state_root" "$@"
}

aos_visual_prepare_live_roots() {
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" set content.roots.toolkit packages/toolkit >/dev/null
  "$aos_bin" set content.roots.sigil apps/sigil >/dev/null
  "$aos_bin" content wait --root toolkit --root sigil --auto-start --timeout 15s >/dev/null
}

aos_visual_configure_sigil_status_item() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" set content.roots.toolkit packages/toolkit >/dev/null
  "$aos_bin" set content.roots.sigil apps/sigil >/dev/null
  "$aos_bin" set status_item.enabled true >/dev/null
  "$aos_bin" set status_item.toggle_id "$avatar_id" >/dev/null
  "$aos_bin" set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
  "$aos_bin" set status_item.toggle_track union >/dev/null
}

aos_visual_remove_canvas() {
  local canvas_id="$1"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show remove --id "$canvas_id" >/dev/null 2>&1 || true
}

aos_visual_launch_canvas_inspector() {
  local inspector_id="${1:-canvas-inspector}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  CANVAS_ID="$inspector_id" AOS="$aos_bin" bash "$VISUAL_HARNESS_ROOT/packages/toolkit/components/canvas-inspector/launch.sh" >/dev/null
}

aos_visual_launch_sigil_avatar() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show create \
    --id "$avatar_id" \
    --url 'aos://sigil/renderer/index.html' \
    --track union >/dev/null
}

aos_visual_wait_sigil_avatar_ready() {
  local avatar_id="${1:-avatar-main}"
  local timeout="${2:-10s}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().hitTargetReady === true && window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos?.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && window.__sigilBootError == null' \
    --timeout "$timeout" >/dev/null
}

aos_visual_show_sigil_avatar() {
  local avatar_id="${1:-avatar-main}"
  local fast_travel_effect="${2:-}"
  local aos_bin js
  aos_bin="$(aos_visual_aos)"

  if [[ -n "$fast_travel_effect" ]]; then
    js="window.__sigilDebug.dispatch({ type: 'status_item.show' }); window.state.transitionFastTravelEffect = '$fast_travel_effect'; 'ok'"
  else
    js="window.__sigilDebug.dispatch({ type: 'status_item.show' }); 'ok'"
  fi

  "$aos_bin" show eval --id "$avatar_id" --js "$js" >/dev/null
  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true' \
    --timeout 5s >/dev/null
}

aos_visual_show_sigil_avatar_via_real_status_click() {
  local state_root="$1"
  local avatar_id="${2:-avatar-main}"
  local aos_bin pid
  aos_bin="$(aos_visual_aos)"
  pid="$(aos_test_wait_for_lock_pid "$state_root")"
  [[ -n "$pid" ]] || {
    echo "FAIL: daemon pid missing for real status-item click" >&2
    return 1
  }

  click_aos_status_item_real "$pid" "$aos_bin"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  "$aos_bin" show wait \
    --id "$avatar_id" \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true && window.__sigilDebug.snapshot().hitTargetInteractive === true' \
    --timeout 5s >/dev/null
}

aos_visual_avoid_sigil_avatar_overlap() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-canvas-inspector}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$avatar_id" "$inspector_id" <<'PY'
import json
import subprocess
import sys

aos, avatar_id, inspector_id = sys.argv[1:4]


def run_json(*args):
    return json.loads(subprocess.check_output([aos, *args], text=True))


def rect_contains(rect, point, margin=48):
    x, y, w, h = rect
    return x - margin <= point["x"] <= x + w + margin and y - margin <= point["y"] <= y + h + margin


def rect_overlaps_point(rect, point, margin=48):
    return rect_contains(rect, point, margin)


inspector = run_json("show", "get", "--id", inspector_id).get("canvas")
if not inspector:
    raise SystemExit(0)

payload = run_json(
    "show",
    "eval",
    "--id",
    avatar_id,
    "--js",
    "JSON.stringify({ avatarPos: window.liveJs?.avatarPos, displays: window.liveJs?.displays || [] })",
)
state = json.loads(payload.get("result") or "{}")
avatar = state.get("avatarPos") or {}
displays = state.get("displays") or []
if not avatar.get("valid") or not displays:
    raise SystemExit(0)

avatar_native = None
avatar_display = None
for display in displays:
    world = display.get("desktopWorldBounds") or display.get("desktop_world_bounds") or display.get("bounds") or {}
    native = display.get("nativeBounds") or display.get("native_bounds") or display.get("bounds") or {}
    if (
        world.get("x", 0) <= avatar["x"] <= world.get("x", 0) + world.get("w", 0)
        and world.get("y", 0) <= avatar["y"] <= world.get("y", 0) + world.get("h", 0)
    ):
        avatar_native = {
            "x": avatar["x"] - world.get("x", 0) + native.get("x", 0),
            "y": avatar["y"] - world.get("y", 0) + native.get("y", 0),
        }
        avatar_display = display
        break

if avatar_native is None:
    raise SystemExit(0)

current = inspector.get("at") or []
if len(current) != 4 or not rect_overlaps_point(current, avatar_native):
    raise SystemExit(0)

panel_w = int(current[2])
panel_h = int(current[3])
visible = (
    avatar_display.get("nativeVisibleBounds")
    or avatar_display.get("native_visible_bounds")
    or avatar_display.get("nativeBounds")
    or avatar_display.get("native_bounds")
    or avatar_display.get("bounds")
    or {}
)
vx = int(visible.get("x", 0))
vy = int(visible.get("y", 0))
vw = int(visible.get("w", 1920))
vh = int(visible.get("h", 1080))
pad = 16
candidates = [
    [vx + pad, vy + pad, panel_w, panel_h],
    [vx + vw - panel_w - pad, vy + pad, panel_w, panel_h],
    [vx + pad, vy + vh - panel_h - pad, panel_w, panel_h],
    [vx + vw - panel_w - pad, vy + vh - panel_h - pad, panel_w, panel_h],
]

target = next((rect for rect in candidates if not rect_contains(rect, avatar_native, 96)), candidates[0])
subprocess.check_call([aos, "show", "update", "--id", inspector_id, "--at", ",".join(str(int(v)) for v in target)], stdout=subprocess.DEVNULL)
PY
}

aos_visual_place_sigil_avatar_for_manual_test() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  "$aos_bin" show eval --id "$avatar_id" --js '
    (() => {
      const displays = window.liveJs?.displays || [];
      const display = displays.find((candidate) => !candidate.is_main) || displays[0];
      if (!display) return "no-display";
      const bounds = display.visible_bounds || display.visibleBounds || display.bounds;
      const x = bounds.x + bounds.w * 0.55;
      const y = bounds.y + bounds.h * 0.45;
      window.__sigilDebug.dispatch({ type: "sigil.set_position", x, y });
      window.__sigilDebug.dispatch({ type: "status_item.show" });
      return JSON.stringify({ x, y, display: display.id || display.display_id || null });
    })()
  ' >/dev/null
}

aos_visual_launch_sigil_with_inspector() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-canvas-inspector}"
  local fast_travel_effect="${3:-}"
  local placement="${4:-default}"

  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_launch_sigil_avatar "$avatar_id"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  aos_visual_show_sigil_avatar "$avatar_id" "$fast_travel_effect"
  if [[ "$placement" == "manual-visible" ]]; then
    aos_visual_place_sigil_avatar_for_manual_test "$avatar_id"
  fi
  aos_visual_avoid_sigil_avatar_overlap "$avatar_id" "$inspector_id"
}

aos_visual_launch_sigil_with_inspector_via_status_item() {
  local state_root="$1"
  local avatar_id="${2:-avatar-main}"
  local inspector_id="${3:-canvas-inspector}"
  local placement="${4:-default}"

  aos_visual_configure_sigil_status_item "$avatar_id"
  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_show_sigil_avatar_via_real_status_click "$state_root" "$avatar_id"
  if [[ "$placement" == "manual-visible" ]]; then
    aos_visual_place_sigil_avatar_for_manual_test "$avatar_id"
  fi
  aos_visual_avoid_sigil_avatar_overlap "$avatar_id" "$inspector_id"
}
