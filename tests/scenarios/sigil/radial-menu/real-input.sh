#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/sigil/radial-menu.sh"

AVATAR_ID="${AOS_SIGIL_AVATAR_ID:-avatar-main}"
INSPECTOR_ID="${AOS_SIGIL_INSPECTOR_ID:-sigil-radial-harness-inspector}"
RADIAL_ID="sigil-radial-menu-$AVATAR_ID"
HIT_ID="sigil-hit-$AVATAR_ID"

if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
  echo "SKIP: this scenario uses real mouse input. Re-run with AOS_REAL_INPUT_OK=1 when the keyboard and mouse are idle."
  exit 77
fi

cleanup() {
  aos_visual_remove_canvas "$RADIAL_ID"
  aos_visual_remove_canvas "$HIT_ID"
  aos_visual_remove_canvas "$AVATAR_ID"
  aos_visual_remove_canvas "$INSPECTOR_ID"
}
trap cleanup EXIT

echo "INFO: this scenario uses real mouse input through the active repo daemon. Keep the keyboard and mouse idle."
"$(aos_visual_aos)" ready >/dev/null
aos_visual_prepare_live_roots
aos_visual_seed_sigil repo
aos_visual_configure_sigil_status_item "$AVATAR_ID"
cleanup

aos_visual_launch_sigil_with_inspector_via_live_status_item "$AVATAR_ID" "$INSPECTOR_ID" manual-visible
aos_sigil_radial_verify_real_input "$AVATAR_ID"
