#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/sigil/visual-harness.sh"
source "$(dirname "$0")/lib/real-input-surface-harness.sh"
source "$(dirname "$0")/lib/harness-contracts.sh"

aos_real_input_surface_require_enabled || exit $?

PREFIX="aos-sigil-real-input-status-avatar"
aos_test_cleanup_prefix "$PREFIX"

ROOT=""

cleanup() {
  local status="$?"
  if [[ -n "${ROOT:-}" ]]; then
    aos_test_kill_root "$ROOT" 2>/dev/null || true
    rm -rf "$ROOT"
  fi
  aos_harness_repo_service_restore_if_needed || status=1
  aos_harness_contract_release_all
  exit "$status"
}
trap cleanup EXIT

aos_harness_contract_acquire "tests/sigil-real-input-status-avatar.sh" \
  --group repo-service-mutator \
  --group status-item-owner \
  --group real-input-pointer \
  --blocks repo-daemon-live

aos_harness_repo_service_stop_for_isolated_test

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

start_status_avatar_isolated_daemon() {
  aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil
}

restart_status_avatar_isolated_daemon() {
  aos_test_kill_root "$ROOT" 2>/dev/null || true
  start_status_avatar_isolated_daemon
}

launch_status_avatar_inspector() {
  local attempt status
  for attempt in 1 2; do
    if aos_real_input_surface_launch_inspector_with_retry surface-inspector; then
      return 0
    fi
    status="$?"
    if (( attempt < 2 )); then
      echo "INFO: restarting isolated daemon after surface-inspector launch failure: attempt=$attempt status=$status" >&2
      restart_status_avatar_isolated_daemon || return $?
    fi
  done
  return "$status"
}

aos_visual_run_bounded 15 "seed Sigil fixture" aos_visual_seed_sigil repo

aos_visual_run_bounded 20 "start isolated daemon" \
  start_status_avatar_isolated_daemon \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_run_bounded 10 "configure isolated Sigil status item" \
  aos_visual_configure_sigil_status_item avatar-main

export STATUS_ITEM_HYGIENE
aos_visual_run_bounded 8 "remove stale Sigil avatar canvas" aos_visual_remove_canvas avatar-main
aos_visual_run_bounded 8 "remove stale surface inspector canvas" aos_visual_remove_canvas surface-inspector
aos_visual_run_bounded 120 "launch surface inspector" launch_status_avatar_inspector

DAEMON_PID="$(aos_visual_run_bounded 8 "wait for isolated daemon lock pid" aos_test_wait_for_lock_pid "$ROOT")"
EXPECTED_STATUS_ITEM_PIDS="$(aos_visual_run_bounded 8 "list isolated daemon process owners" aos_test_pids_for_root "$ROOT" | paste -sd, -)"
export STATUS_ITEMS_BEFORE_CLICK
STATUS_ITEMS_BEFORE_CLICK="$(aos_visual_run_bounded 20 "read isolated status item inventory" aos_status_item_matches_for_pids_json "$EXPECTED_STATUS_ITEM_PIDS")"
STATUS_ITEM_PID="$(aos_visual_run_bounded 8 "select isolated status item owner ${EXPECTED_STATUS_ITEM_PIDS}" aos_status_item_pid_from_matches_json "$EXPECTED_STATUS_ITEM_PIDS" "$STATUS_ITEMS_BEFORE_CLICK")"
STATUS_ITEM_HYGIENE="$(aos_visual_run_bounded 8 "assert isolated status item ownership ${STATUS_ITEM_PID}" aos_assert_status_item_overlap_from_matches_json "$STATUS_ITEM_PID" "$STATUS_ITEMS_BEFORE_CLICK")"
wait_for_status_avatar_visible() {
  "$(aos_visual_aos)" show wait \
    --id avatar-main \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true && window.__sigilDebug.snapshot().hitTargetInteractive === true' \
    --timeout 25s >/dev/null
}
VISIBLE_WAIT_STDOUT="$(mktemp "${TMPDIR:-/tmp}/aos-status-avatar-visible-stdout.XXXXXX")"
VISIBLE_WAIT_STDERR="$(mktemp "${TMPDIR:-/tmp}/aos-status-avatar-visible-stderr.XXXXXX")"
wait_for_status_avatar_visible >"$VISIBLE_WAIT_STDOUT" 2>"$VISIBLE_WAIT_STDERR" &
VISIBLE_WAIT_PID="$!"
export STATUS_CLICK_TIMING
STATUS_CLICK_TIMING="$(aos_visual_run_bounded 8 "click isolated status item" click_aos_status_item_real_low_latency_json "$STATUS_ITEM_PID")" || {
  kill "$VISIBLE_WAIT_PID" 2>/dev/null || true
  rm -f "$VISIBLE_WAIT_STDOUT" "$VISIBLE_WAIT_STDERR"
  exit 1
}
VISIBLE_WAIT_DEADLINE=$((SECONDS + 30))
while kill -0 "$VISIBLE_WAIT_PID" 2>/dev/null; do
  if (( SECONDS >= VISIBLE_WAIT_DEADLINE )); then
    kill "$VISIBLE_WAIT_PID" 2>/dev/null || true
    sleep 0.2
    kill -9 "$VISIBLE_WAIT_PID" 2>/dev/null || true
    echo "FAIL: timed out after 8s waiting for Sigil avatar visible from status click" >&2
    echo "stdout:" >&2
    sed -n '1,80p' "$VISIBLE_WAIT_STDOUT" >&2 || true
    echo "stderr:" >&2
    sed -n '1,80p' "$VISIBLE_WAIT_STDERR" >&2 || true
    rm -f "$VISIBLE_WAIT_STDOUT" "$VISIBLE_WAIT_STDERR"
    exit 124
  fi
  sleep 0.05
done
if ! wait "$VISIBLE_WAIT_PID"; then
  echo "FAIL: wait for Sigil avatar visible from status click failed" >&2
  echo "stdout:" >&2
  sed -n '1,80p' "$VISIBLE_WAIT_STDOUT" >&2 || true
  echo "stderr:" >&2
  sed -n '1,80p' "$VISIBLE_WAIT_STDERR" >&2 || true
  rm -f "$VISIBLE_WAIT_STDOUT" "$VISIBLE_WAIT_STDERR"
  exit 1
fi
rm -f "$VISIBLE_WAIT_STDOUT" "$VISIBLE_WAIT_STDERR"
export STATUS_AVATAR_VISIBLE_AT_MS
STATUS_AVATAR_VISIBLE_AT_MS="$(python3 - <<'PY'
import time
print(time.time_ns() / 1_000_000)
PY
)"
aos_visual_run_bounded 10 "wait for Sigil avatar ready" aos_visual_wait_sigil_avatar_ready avatar-main
aos_visual_run_bounded 8 "place Sigil avatar for manual-visible test" aos_visual_place_sigil_avatar_for_manual_test avatar-main
aos_visual_run_bounded 8 "avoid Sigil avatar/inspector overlap" aos_visual_avoid_sigil_avatar_overlap avatar-main surface-inspector

run_status_avatar_assertions() {
python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path("tests/lib").resolve()))
from sigil_real_input_context import SigilContextHarness
from real_input_surface_primitives import (
    aos_native_click_segmented_js,
    aos_native_click_tab_js,
    aos_native_segmented_ready_js,
    aos_native_tab_ready_js,
)


harness = SigilContextHarness()
initial = harness.arm_trace("real-input-status-avatar")
status_items = json.loads(os.environ.get("STATUS_ITEMS_BEFORE_CLICK", '{"matches": []}'))
status_item_hygiene = json.loads(os.environ.get("STATUS_ITEM_HYGIENE", "{}"))
status_click_timing = json.loads(os.environ.get("STATUS_CLICK_TIMING", "{}"))
avatar_visible_at = float(os.environ.get("STATUS_AVATAR_VISIBLE_AT_MS", "0") or "0")
if status_click_timing.get("eventPostedAtMs") and avatar_visible_at:
    status_click_timing["appVisibleAfterEventPostedMs"] = avatar_visible_at - status_click_timing["eventPostedAtMs"]
if not initial["avatarVisible"] or not initial["hitTargetInteractive"]:
    raise SystemExit(f"FAIL: avatar not visible/interactive after real status click: {initial}")

frame = initial["frame"]
avatar_center = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}
harness.click(avatar_center, "--right")
harness.wait_until(
    lambda: harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu)") if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is True else None,
    label="context menu open from real avatar right click",
)

travel_ready = harness.wait_until(
    lambda: (
        lambda result: result if result.get("ok") else None
    )(harness.eval_json(aos_native_tab_ready_js("travel"))),
    label="travel tab AOS control record",
)
travel_click = harness.eval_json(aos_native_click_tab_js("sigil-hit-avatar-main", "travel"))
harness.wait_until(
    lambda: True if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.activeTab)") == "travel" else None,
    label="travel tab selected through AOS control record",
)

trail_ready = harness.wait_until(
    lambda: (
        lambda result: result if result.get("ok") else None
    )(harness.eval_json(aos_native_segmented_ready_js("sigil-menu-line-trail-mode", "shrink"))),
    label="line trail mode AOS control record",
)
trail_click = harness.eval_json(aos_native_click_segmented_js("sigil-hit-avatar-main", "sigil-menu-line-trail-mode", "shrink"))
line_state = harness.wait_until(
    lambda: (
        lambda state: state if state["mode"] == "shrink" else None
    )(harness.eval_json("JSON.stringify({ mode: window.state.fastTravelLineTrailMode })")),
    label="line trail mode changed through AOS control record",
)

print("PASS", json.dumps({
    "statusItemsBeforeClick": status_items,
    "statusItemHygiene": status_item_hygiene,
    "statusClickTiming": status_click_timing,
    "initial": initial,
    "travelReady": travel_ready,
    "travelClick": travel_click,
    "trailReady": trail_ready,
    "trailClick": trail_click,
    "line": line_state,
}))
PY
}

aos_visual_run_bounded 30 "status avatar real-input assertions" run_status_avatar_assertions
