#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/sigil/radial-menu.sh"
source "$(dirname "$0")/../../../lib/harness-contracts.sh"

aos_real_input_surface_require_enabled || exit $?

AVATAR_ID="${AOS_SIGIL_AVATAR_ID:-avatar-main}"
INSPECTOR_ID="${AOS_SIGIL_INSPECTOR_ID:-surface-inspector}"
RADIAL_ID="sigil-radial-menu-$AVATAR_ID"
HIT_ID="sigil-hit-$AVATAR_ID"
AGENT_TERMINAL_ID="sigil-agent-terminal"
WIKI_WORKBENCH_ID="sigil-wiki-workbench"
DESKTOP_WORLD_STAGE_ID="aos-desktop-world-stage"

phase() {
  local label="$1"
  shift
  echo "INFO: phase=$label command=$*" >&2
  "$@" || {
    local status="$?"
    echo "FAIL: phase=$label status=$status command=$*" >&2
    aos_visual_phase_snapshot "$label" >&2 || true
    return "$status"
  }
}

ready_quiet() {
  "$(aos_visual_aos)" ready --json >/dev/null
}

cleanup_canvases() {
  aos_real_input_surface_cleanup_subject_family "$AVATAR_ID" >/dev/null || true
  aos_visual_remove_canvas "$WIKI_WORKBENCH_ID" 5
  aos_visual_remove_canvas "$INSPECTOR_ID" 5
  aos_visual_remove_canvas "$DESKTOP_WORLD_STAGE_ID" 5
  return 0
}

final_cleanup() {
  local status="$?"
  cleanup_canvases || true
  aos_harness_contract_release_all
  exit "$status"
}
trap final_cleanup EXIT

aos_harness_contract_acquire "tests/scenarios/sigil/radial-menu/real-input.sh" \
  --group repo-daemon-live \
  --group status-item-owner \
  --group real-input-pointer \
  --blocks repo-service-mutator

echo "INFO: this scenario uses real mouse input through the active repo daemon. Keep the keyboard and mouse idle."
phase prepare-live-roots aos_visual_prepare_live_roots
phase ready-after-live-roots ready_quiet
phase start-real-input-surface aos_real_input_surface_start "$INSPECTOR_ID"
phase seed-sigil aos_visual_seed_sigil repo
phase ready-after-seed ready_quiet
cleanup_canvases
phase ready-after-initial-cleanup ready_quiet
phase restart-real-input-surface aos_real_input_surface_start "$INSPECTOR_ID"
phase wait-avatar-absent aos_visual_wait_canvas_absent "$AVATAR_ID" 10
phase wait-radial-absent aos_visual_wait_canvas_absent "$RADIAL_ID" 5
phase wait-hit-absent aos_visual_wait_canvas_absent "$HIT_ID" 5
phase wait-agent-terminal-absent aos_visual_wait_canvas_absent "$AGENT_TERMINAL_ID" 5
phase wait-wiki-workbench-absent aos_visual_wait_canvas_absent "$WIKI_WORKBENCH_ID" 5
sleep 0.25

phase launch-avatar aos_visual_launch_sigil_avatar "$AVATAR_ID"
phase wait-avatar-ready aos_visual_wait_sigil_avatar_ready "$AVATAR_ID" "20s"
phase show-avatar aos_visual_show_sigil_avatar "$AVATAR_ID"
phase place-avatar aos_visual_place_sigil_avatar_for_manual_test "$AVATAR_ID"
phase avoid-avatar-overlap aos_visual_avoid_sigil_avatar_overlap "$AVATAR_ID" "$INSPECTOR_ID"
phase assert-inspector-visible aos_real_input_surface_assert_inspector_visible "$INSPECTOR_ID"
phase verify-radial-real-input aos_sigil_radial_verify_real_input "$AVATAR_ID" "$INSPECTOR_ID"
