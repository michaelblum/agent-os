#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/visual-harness.sh"

PREFIX="aos-sigil-real-input-status-avatar"
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

export STATUS_ITEMS_BEFORE_CLICK
STATUS_ITEMS_BEFORE_CLICK="$(aos_status_item_matches_json || printf '{"matches":[]}')"
export STATUS_ITEM_HYGIENE
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")"
STATUS_ITEM_PID="$(aos_unambiguous_status_item_pid "$DAEMON_PID")"
STATUS_ITEM_HYGIENE="$(aos_assert_status_item_overlap_bounded_json "$STATUS_ITEM_PID")"

aos_visual_launch_sigil_with_inspector_via_status_item "$ROOT" avatar-main surface-inspector manual-visible

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
    "initial": initial,
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "line": line_state,
}))
PY
