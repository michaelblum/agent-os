#!/usr/bin/env bash

VISUAL_HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VISUAL_HARNESS_ROOT="$(cd "$VISUAL_HARNESS_DIR/../.." && pwd)"

source "$VISUAL_HARNESS_DIR/isolated-daemon.sh"

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

aos_visual_launch_sigil_with_inspector() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-canvas-inspector}"
  local fast_travel_effect="${3:-}"

  aos_visual_remove_canvas "$avatar_id"
  aos_visual_remove_canvas "$inspector_id"
  aos_visual_launch_canvas_inspector "$inspector_id"
  aos_visual_launch_sigil_avatar "$avatar_id"
  aos_visual_wait_sigil_avatar_ready "$avatar_id"
  aos_visual_show_sigil_avatar "$avatar_id" "$fast_travel_effect"
}
