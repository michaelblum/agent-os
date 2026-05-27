#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/visual-harness.sh"

PREFIX="aos-sigil-context-menu-real-input"
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
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path("tests/lib").resolve()))
from sigil_real_input_context import SigilContextHarness


harness = SigilContextHarness()
harness.arm_trace("real-input-context-menu-smoke")
harness.open_context_menu_from_avatar()
main_menu_clearance = harness.assert_menu_clear_avatar("main display")

shape_select = harness.native_point_for('#sigil-menu-shape-select')
if not shape_select:
    raise SystemExit("FAIL: missing shape geometry select")
harness.click(shape_select)
shape_option = harness.wait_until(
    lambda: harness.native_point_for('[data-ctx-select-option="8"]'),
    label="geometry select option list opened from real click",
)
harness.click(shape_option)
shape_result = harness.wait_until(
    lambda: (
        lambda state: state if state["geometry"] == 8 and state["selectEvents"] >= 1 else None
    )(harness.eval_json(
        """(() => {
          const trace = window.__sigilDebug.interactionTrace()
          return JSON.stringify({
            geometry: window.state.currentGeometryType,
            selectValue: document.querySelector('#sigil-menu-shape-select')?.value ?? null,
            popoverOpen: !!document.querySelector('.ctx-select-popover'),
            selectEvents: trace.entries.filter((entry) => entry.stage === 'context-menu:select-option').length
          })
        })()"""
    )),
    label="real click selected geometry option",
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
      return JSON.stringify({ scrollTop: root?.scrollTop ?? null, scrollHeight: root?.scrollHeight ?? null, clientHeight: root?.clientHeight ?? null })
    })()"""
)
after_scroll = before_scroll
if before_scroll["scrollHeight"] > before_scroll["clientHeight"]:
    harness.scroll(menu_center, -8)
    after_scroll = harness.wait_until(
        lambda: (
            lambda state: state if state["scrollTop"] > before_scroll["scrollTop"] else None
        )(harness.eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-root')?.scrollTop ?? null })")),
        label="root menu scrollTop changed from real wheel",
    )

line_button = harness.native_point_for('[data-ctx-open="sigil-menu-line-card"]')
if not line_button:
    raise SystemExit("FAIL: missing Line Trail Settings button after real scroll")
harness.click(line_button)

line_state = harness.wait_until(
    lambda: (
        lambda state: state if state["active"] and state["buttonsVisible"] else None
    )(harness.eval_json(
        """(() => {
          const card = document.querySelector('#sigil-menu-line-card')
          const buttons = [...document.querySelectorAll('[data-sigil-line-trail-mode]')]
          return JSON.stringify({
            active: card?.classList.contains('active') ?? false,
            scrollTop: card?.scrollTop ?? null,
            scrollHeight: card?.scrollHeight ?? null,
            clientHeight: card?.clientHeight ?? null,
            buttonsVisible: buttons.length >= 5 && buttons.every((button) => {
              const rect = button.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            })
          })
        })()"""
    )),
    label="line trail card active with visible trail buttons",
)

shrink = harness.native_point_for('[data-sigil-line-trail-mode="shrink"]')
if not shrink:
    raise SystemExit("FAIL: missing Shrink trail mode button")
harness.click(shrink)

result = harness.wait_until(
    lambda: (
        lambda state: state if state["mode"] == "shrink" and state["scrollEvents"] > 0 else None
    )(harness.eval_json(
        """(() => {
          const trace = window.__sigilDebug.interactionTrace()
          return JSON.stringify({
            mode: window.state.fastTravelLineTrailMode,
            scrollEvents: trace.entries.filter((entry) => entry.stage === 'context-menu:scroll').length,
            clickEvents: trace.entries.filter((entry) => entry.stage === 'context-menu:click').length
          })
        })()"""
    )),
    label="real click selected line trail mode",
)

back = harness.native_point_for('#sigil-menu-line-card [data-ctx-back]')
if not back:
    raise SystemExit("FAIL: missing Line Trail back button")

def root_card_state():
    return harness.eval_json(
        """(() => {
          const root = document.querySelector('#sigil-menu-root')
          return JSON.stringify({
            active: root?.classList.contains('active') ?? false,
            pushed: root?.classList.contains('pushed') ?? false,
            stack: window.__sigilDebug.snapshot().contextMenu.stack
          })
        })()"""
    )

root_state = None
for _ in range(3):
    harness.click(back)
    try:
        root_state = harness.wait_until(
            lambda: (lambda state: state if state["active"] else None)(root_card_state()),
            timeout=1.0,
            interval=0.08,
            label="root card active after real back click",
        )
        break
    except TimeoutError as error:
        root_state = root_card_state()
        back = harness.native_point_for('#sigil-menu-line-card [data-ctx-back]')
        if not back:
            raise SystemExit(f"FAIL: root card did not become active and back button disappeared: {root_state}") from error
if not root_state or not root_state["active"]:
    raise SystemExit(f"FAIL: root card did not become active after real back click: {root_state}")

wormhole_button = harness.native_point_for('[data-ctx-open="sigil-menu-wormhole-card"]')
if not wormhole_button:
    raise SystemExit("FAIL: missing Wormhole Settings button")

def wormhole_card_state():
    return harness.eval_json(
        """(() => {
          const card = document.querySelector('#sigil-menu-wormhole-card')
          return JSON.stringify({
            active: card?.classList.contains('active') ?? false,
            scrollTop: card?.scrollTop ?? null,
            scrollHeight: card?.scrollHeight ?? null,
            clientHeight: card?.clientHeight ?? null,
            stack: window.__sigilDebug.snapshot().contextMenu.stack
          })
        })()"""
    )

wormhole_before = None
for _ in range(3):
    harness.click(wormhole_button)
    try:
        wormhole_before = harness.wait_until(
            lambda: (
                lambda state: state
                if state["active"] and state["scrollHeight"] > state["clientHeight"]
                else None
            )(wormhole_card_state()),
            timeout=1.0,
            interval=0.08,
            label="wormhole card active and scrollable after real click",
        )
        break
    except TimeoutError as error:
        wormhole_before = wormhole_card_state()
        wormhole_button = harness.native_point_for('[data-ctx-open="sigil-menu-wormhole-card"]')
        if not wormhole_button:
            raise SystemExit(f"FAIL: wormhole card did not open and trigger disappeared: {wormhole_before}") from error
if not wormhole_before or not wormhole_before["active"] or wormhole_before["scrollHeight"] <= wormhole_before["clientHeight"]:
    raise SystemExit(f"FAIL: wormhole card not active/scrollable after real click: {wormhole_before}")
wormhole_center = harness.native_point_for('#sigil-menu-wormhole-card')
if not wormhole_center:
    raise SystemExit("FAIL: missing Wormhole Settings card point")
harness.scroll(wormhole_center, -8)
wormhole_after = harness.wait_until(
    lambda: (
        lambda state: state if state["scrollTop"] > wormhole_before["scrollTop"] else None
    )(harness.eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-wormhole-card')?.scrollTop ?? null })")),
    label="wormhole card scrollTop changed from real wheel",
)

harness.key("Escape")
harness.wait_until(
    lambda: True if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is False else None,
    label="context menu closed before extended-display setup",
)

extended = harness.eval_json(
    """(() => {
      const displays = window.liveJs?.displays || []
      const display = displays.find((entry) => !(entry.is_main ?? entry.isMain))
      if (!display) return JSON.stringify({ skipped: true, reason: 'no extended display', displays })
      const visible = display.visible_bounds || display.visibleBounds || display.bounds
      const point = { x: visible.x + Math.min(220, Math.max(80, visible.w / 4)), y: visible.y + Math.min(220, Math.max(80, visible.h / 4)) }
      const world = display.desktop_world_bounds || display.desktopWorldBounds || display.bounds
      const native = display.native_bounds || display.nativeBounds || world
      const nativePoint = {
        x: native.x + ((point.x - world.x) * native.w / world.w),
        y: native.y + ((point.y - world.y) * native.h / world.h),
      }
      window.__sigilDebug.dispatch({ type: 'status_item.show' })
      window.__sigilDebug.dispatch({ type: 'sigil.set_position', x: point.x, y: point.y })
      window.__sigilDebug.armInteractionTrace('real-input-context-menu-extended-display')
      return JSON.stringify({ skipped: false, display, point, nativePoint })
    })()"""
)
extended_result = None
if not extended.get("skipped"):
    harness.wait_until(
        lambda: (
            lambda snap: snap if (
                snap["avatarVisible"]
                and snap["state"] == "IDLE"
                and not snap["contextMenu"]["open"]
                and abs(snap["avatarPos"]["x"] - extended["point"]["x"]) < 1
                and abs(snap["avatarPos"]["y"] - extended["point"]["y"]) < 1
            ) else None
        )(harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot())")),
        label="avatar visible and idle on extended display",
    )
    harness.click(extended["nativePoint"], "--right")
    harness.wait_until(
        lambda: harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu)") if harness.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is True else None,
        label="context menu opened on extended display from real right click",
    )
    extended_clearance = harness.assert_menu_clear_avatar("extended display")
    extended_effects_tab = harness.native_point_for('[data-ctx-tab="sigil-menu-effects"]')
    if not extended_effects_tab:
        raise SystemExit("FAIL: missing effects tab on extended display")
    harness.click(extended_effects_tab)
    extended_menu_center = harness.native_point_for('#sigil-menu-root')
    if not extended_menu_center:
        raise SystemExit("FAIL: missing menu root on extended display")
    extended_before = harness.eval_json(
        """(() => {
          const root = document.querySelector('#sigil-menu-root')
          return JSON.stringify({ scrollTop: root?.scrollTop ?? null, scrollHeight: root?.scrollHeight ?? null, clientHeight: root?.clientHeight ?? null })
        })()"""
    )
    if extended_before["scrollHeight"] > extended_before["clientHeight"]:
        harness.scroll(extended_menu_center, -8)
        extended_after = harness.wait_until(
            lambda: (
                lambda state: state if state["scrollTop"] > extended_before["scrollTop"] else None
            )(harness.eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-root')?.scrollTop ?? null })")),
            label="extended-display menu scrollTop changed from real wheel",
        )
    else:
        extended_after = extended_before
    extended_result = {
        "display_id": extended["display"].get("id") or extended["display"].get("display_id"),
        "before": extended_before,
        "after": extended_after,
        "clearance": extended_clearance,
    }
else:
    extended_result = extended

print("PASS", json.dumps({
    "main_menu_clearance": main_menu_clearance,
    "shape_result": shape_result,
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "line": line_state,
    "result": result,
    "wormhole_before": wormhole_before,
    "wormhole_after": wormhole_after,
    "extended": extended_result,
}))
PY
