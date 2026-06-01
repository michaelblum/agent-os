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

aos_visual_run_bounded 15 "seed Sigil fixture" aos_visual_seed_sigil repo

aos_visual_run_bounded 20 "start isolated daemon" \
  aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_run_bounded 10 "configure isolated Sigil status item" \
  aos_visual_configure_sigil_status_item avatar-main

export STATUS_ITEM_HYGIENE
DAEMON_PID="$(aos_visual_run_bounded 8 "wait for isolated daemon lock pid" aos_test_wait_for_lock_pid "$ROOT")"
EXPECTED_STATUS_ITEM_PIDS="$(aos_visual_run_bounded 8 "list isolated daemon process owners" aos_test_pids_for_root "$ROOT" | paste -sd, -)"
export STATUS_ITEMS_BEFORE_CLICK
STATUS_ITEMS_BEFORE_CLICK="$(aos_visual_run_bounded 20 "read isolated status item inventory" aos_status_item_matches_for_pids_json "$EXPECTED_STATUS_ITEM_PIDS")"
STATUS_ITEM_PID="$(aos_visual_run_bounded 8 "select isolated status item owner ${EXPECTED_STATUS_ITEM_PIDS}" aos_status_item_pid_from_matches_json "$EXPECTED_STATUS_ITEM_PIDS" "$STATUS_ITEMS_BEFORE_CLICK")"
STATUS_ITEM_HYGIENE="$(aos_visual_run_bounded 8 "assert isolated status item ownership ${STATUS_ITEM_PID}" aos_assert_status_item_overlap_from_matches_json "$STATUS_ITEM_PID" "$STATUS_ITEMS_BEFORE_CLICK")"

aos_visual_run_bounded 8 "remove stale Sigil avatar canvas" aos_visual_remove_canvas avatar-main
aos_visual_run_bounded 8 "remove stale surface inspector canvas" aos_visual_remove_canvas surface-inspector
aos_visual_run_bounded 15 "launch surface inspector" aos_visual_launch_canvas_inspector surface-inspector
wait_for_status_avatar_visible() {
  "$(aos_visual_aos)" show wait \
    --id avatar-main \
    --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true && window.__sigilDebug.snapshot().hitTargetInteractive === true' \
    --timeout 12s >/dev/null
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
VISIBLE_WAIT_DEADLINE=$((SECONDS + 15))
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

effects_tab = harness.native_point_for('[data-ctx-tab="sigil-menu-effects"]')
if not effects_tab:
    raise SystemExit("FAIL: missing effects tab")
harness.click(effects_tab)

menu_center = harness.native_point_for('#sigil-menu-root')
if not menu_center:
    raise SystemExit("FAIL: missing menu root")

before_scroll = harness.eval_json(
    """(() => {
      const root = document.querySelector('#sigil-menu-root')
      const anchor = document.querySelector('#sigil-context-menu')
      const effects = document.querySelector('#sigil-menu-effects')
      return JSON.stringify({
        dialogRole: anchor?.getAttribute('role'),
        dialogHidden: anchor?.getAttribute('aria-hidden'),
        effectsRole: effects?.getAttribute('role'),
        effectsHidden: effects?.getAttribute('aria-hidden'),
        scrollTop: root?.scrollTop ?? null,
        scrollHeight: root?.scrollHeight ?? null,
        clientHeight: root?.clientHeight ?? null
      })
    })()"""
)
if before_scroll["scrollHeight"] > before_scroll["clientHeight"]:
    harness.scroll(menu_center, -8)
    after_scroll = harness.wait_until(
        lambda: (
            lambda state: state if state["scrollTop"] > before_scroll["scrollTop"] else None
        )(harness.eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-root')?.scrollTop ?? null })")),
        label="root menu scrollTop changed from real wheel",
    )
else:
    after_scroll = {"scrollTop": before_scroll["scrollTop"]}

line_button = harness.native_point_for('[data-ctx-open="sigil-menu-line-card"]')
if not line_button:
    raise SystemExit("FAIL: missing Line Trail Settings button after real scroll")
harness.click(line_button)
line_state = harness.wait_until(
    lambda: (
        lambda state: state if state["active"] and state["role"] == "region" and state["label"] == "Line trail settings" else None
    )(harness.eval_json(
        """(() => {
          const card = document.querySelector('#sigil-menu-line-card')
          return JSON.stringify({
            active: card?.classList.contains('active') ?? false,
            role: card?.getAttribute('role'),
            label: card?.getAttribute('aria-label')
          })
        })()"""
    )),
    label="line trail card active with accessible region label",
)

print("PASS", json.dumps({
    "statusItemsBeforeClick": status_items,
    "statusItemHygiene": status_item_hygiene,
    "statusClickTiming": status_click_timing,
    "initial": initial,
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "line": line_state,
}))
PY
}

aos_visual_run_bounded 30 "status avatar real-input assertions" run_status_avatar_assertions
