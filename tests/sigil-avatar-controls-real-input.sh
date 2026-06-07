#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/sigil/visual-harness.sh"
source "$(dirname "$0")/lib/real-input-surface-harness.sh"

aos_real_input_surface_require_enabled || exit $?

PREFIX="aos-sigil-avatar-controls-real-input"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_visual_seed_sigil repo

aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_launch_sigil_with_inspector avatar-main surface-inspector "" manual-visible

python3 - <<'PY'
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path("tests/lib").resolve()))
from sigil_real_input_context import SigilContextHarness
from real_input_surface_primitives import (
    aos_native_click_segmented_js,
    aos_native_click_tab_js,
    aos_native_segmented_ready_js,
    aos_native_tab_ready_js,
)


def selector_for(descriptor_id, suffix=""):
    base = f'.aos-form-field[data-descriptor-id="{descriptor_id}"]'
    return f"{base} {suffix}".strip()


harness = SigilContextHarness()
harness.arm_trace("real-input-avatar-controls-smoke")
harness.open_avatar_controls_from_avatar()
main_controls_clearance = harness.assert_avatar_controls_clear_avatar("main display")

avatar_controls = harness.wait_until(
    lambda: (
        lambda controls: controls if controls.get("surface") == "toolkit-panel" and len(controls.get("controls") or []) > 0 else None
    )(harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().avatarControls)")),
    label="compact avatar panel controls projected to avatar controls snapshot",
)

travel_ready = harness.wait_until(
    lambda: (
        lambda result: result if result.get("ok") else None
    )(harness.eval_json(aos_native_tab_ready_js("travel"))),
    label="travel tab AOS control record",
)
travel_click = harness.eval_json(aos_native_click_tab_js("sigil-hit-avatar-main", "travel"))
harness.wait_until(
    lambda: True if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().avatarControls.activeTab)") == "travel" else None,
    label="travel tab selected through AOS control record",
)

trail_ready = harness.wait_until(
    lambda: (
        lambda result: result if result.get("ok") else None
    )(harness.eval_json(aos_native_segmented_ready_js("sigil-avatar-controls-line-trail-mode", "shrink"))),
    label="line trail mode AOS control record",
)
trail_click = harness.eval_json(aos_native_click_segmented_js("sigil-hit-avatar-main", "sigil-avatar-controls-line-trail-mode", "shrink"))
trail_result = harness.wait_until(
    lambda: (
        lambda state: state if state["mode"] == "shrink" else None
    )(harness.eval_json("JSON.stringify({ mode: window.state.fastTravelLineTrailMode })")),
    label="AOS control record selected line trail mode",
)

print("PASS", json.dumps({
    "main_controls_clearance": main_controls_clearance,
    "avatarControls": {
        "surface": avatar_controls.get("surface"),
        "panelId": avatar_controls.get("panelId"),
        "controlCount": len(avatar_controls.get("controls") or []),
    },
    "travelReady": travel_ready,
    "travelClick": travel_click,
    "trailReady": trail_ready,
    "trailClick": trail_click,
    "trail": trail_result,
}, sort_keys=True))
PY
