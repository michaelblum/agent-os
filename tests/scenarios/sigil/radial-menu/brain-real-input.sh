#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/sigil/radial-menu.sh"

if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
  echo "SKIP: this scenario uses real mouse input. Re-run with AOS_REAL_INPUT_OK=1 when the keyboard/mouse are idle."
  exit 77
fi

cleanup() {
  aos_visual_remove_canvas avatar-main
  aos_visual_remove_canvas sigil-hit-avatar-main
  aos_visual_remove_canvas canvas-inspector
}
trap cleanup EXIT

echo "INFO: this scenario will use real mouse input through the active repo daemon. Keep the keyboard and mouse idle."
"$(aos_visual_aos)" ready >/dev/null
aos_visual_prepare_live_roots
aos_visual_seed_sigil repo
aos_visual_configure_sigil_status_item avatar-main

aos_visual_launch_sigil_with_inspector_via_live_status_item avatar-main canvas-inspector manual-visible
aos_sigil_radial_verify_brain_real_input avatar-main
