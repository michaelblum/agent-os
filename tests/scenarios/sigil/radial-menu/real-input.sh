#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/sigil/radial-menu.sh"

AVATAR_ID="${AOS_SIGIL_AVATAR_ID:-avatar-main}"
INSPECTOR_ID="${AOS_SIGIL_INSPECTOR_ID:-surface-inspector}"
RADIAL_ID="sigil-radial-menu-$AVATAR_ID"
HIT_ID="sigil-hit-$AVATAR_ID"
AGENT_TERMINAL_ID="sigil-agent-terminal"
WIKI_WORKBENCH_ID="sigil-wiki-workbench"

cleanup() {
  aos_real_input_surface_cleanup_subject_family "$AVATAR_ID" >/dev/null || true
  aos_visual_remove_canvas "$WIKI_WORKBENCH_ID" 5
  if [[ "$INSPECTOR_ID" != "surface-inspector" ]]; then
    aos_visual_remove_canvas "$INSPECTOR_ID"
  fi
  return 0
}
trap cleanup EXIT

echo "INFO: this scenario uses real mouse input through the active repo daemon. Keep the keyboard and mouse idle."
aos_visual_prepare_live_roots
aos_real_input_surface_start "$INSPECTOR_ID"
aos_visual_seed_sigil repo
cleanup
aos_visual_wait_canvas_absent "$AVATAR_ID" 10
aos_visual_wait_canvas_absent "$RADIAL_ID" 5
aos_visual_wait_canvas_absent "$HIT_ID" 5
aos_visual_wait_canvas_absent "$AGENT_TERMINAL_ID" 5
aos_visual_wait_canvas_absent "$WIKI_WORKBENCH_ID" 5
sleep 0.25

aos_visual_launch_sigil_avatar "$AVATAR_ID"
aos_visual_wait_sigil_avatar_ready "$AVATAR_ID" "20s"
aos_visual_show_sigil_avatar "$AVATAR_ID"
aos_visual_place_sigil_avatar_for_manual_test "$AVATAR_ID"
aos_visual_avoid_sigil_avatar_overlap "$AVATAR_ID" "$INSPECTOR_ID"
aos_real_input_surface_assert_inspector_visible "$INSPECTOR_ID" >/dev/null
aos_sigil_radial_verify_real_input "$AVATAR_ID" "$INSPECTOR_ID"
