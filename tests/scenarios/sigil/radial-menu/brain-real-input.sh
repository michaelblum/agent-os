#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../../../lib/sigil/radial-menu.sh"

if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
  echo "SKIP: this scenario uses real mouse input. Re-run with AOS_REAL_INPUT_OK=1 when the keyboard/mouse are idle."
  exit 77
fi

PREFIX="aos-sigil-radial-brain-real-input"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_visual_seed_sigil repo
aos_visual_configure_sigil_status_item avatar-main

aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_launch_sigil_with_inspector_via_status_item "$ROOT" avatar-main canvas-inspector manual-visible
aos_sigil_radial_verify_brain_real_input avatar-main
