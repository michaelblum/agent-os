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
aos_visual_configure_sigil_status_item avatar-main

aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

export STATUS_ITEMS_BEFORE_CLICK
STATUS_ITEMS_BEFORE_CLICK="$(aos_status_item_matches_json || printf '{"matches":[]}')"

aos_visual_launch_sigil_with_inspector_via_status_item "$ROOT" avatar-main canvas-inspector manual-visible

python3 - <<'PY'
import json
import os
import subprocess
import time


def run(*args):
    return subprocess.check_output(["./aos", *args], text=True, stderr=subprocess.STDOUT)


def eval_json(js):
    payload = json.loads(run("show", "eval", "--id", "avatar-main", "--js", js))
    assert payload["status"] == "success", payload
    return json.loads(payload["result"])


def wait_until(predicate, timeout=5.0, interval=0.05, label="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for {label}; last={last!r}")


def do_click(point, *extra):
    run("do", "click", f"{round(point['x'])},{round(point['y'])}", *extra)


def do_scroll(point, dy):
    run("do", "scroll", f"{round(point['x'])},{round(point['y'])}", "--dy", str(dy))


def native_point_for(selector, ratio=0.5):
    return eval_json(
        f"""(() => {{
          const el = document.querySelector({json.dumps(selector)})
          if (!el) return JSON.stringify(null)
          const rect = el.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return JSON.stringify(null)
          const snap = window.__sigilDebug.snapshot()
          const dw = snap.surface?.segment?.dw_bounds || [0, 0, 0, 0]
          const native = snap.surface?.segment?.native_bounds || dw
          const world = {{
            x: dw[0] + rect.left + rect.width * {ratio},
            y: dw[1] + rect.top + rect.height / 2,
          }}
          return JSON.stringify({{
            x: native[0] + world.x - dw[0],
            y: native[1] + world.y - dw[1],
            rect: {{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          }})
        }})()"""
    )


initial = eval_json(
    """(() => {
      window.__sigilDebug.armInteractionTrace('real-input-status-avatar')
      const snap = window.__sigilDebug.snapshot()
      return JSON.stringify({
        avatarVisible: snap.avatarVisible,
        hitTargetInteractive: snap.hitTargetInteractive,
        frame: snap.hitTargetFrame,
        avatarPos: snap.avatarPos
      })
    })()"""
)
status_items = json.loads(os.environ.get("STATUS_ITEMS_BEFORE_CLICK", '{"matches": []}'))
if not initial["avatarVisible"] or not initial["hitTargetInteractive"]:
    raise SystemExit(f"FAIL: avatar not visible/interactive after real status click: {initial}")

frame = initial["frame"]
avatar_center = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}
do_click(avatar_center, "--right")
wait_until(
    lambda: eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu)") if eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is True else None,
    label="context menu open from real avatar right click",
)

effects_tab = native_point_for('[data-ctx-tab="sigil-menu-effects"]')
if not effects_tab:
    raise SystemExit("FAIL: missing effects tab")
do_click(effects_tab)

menu_center = native_point_for('#sigil-menu-root')
if not menu_center:
    raise SystemExit("FAIL: missing menu root")

before_scroll = eval_json(
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
    do_scroll(menu_center, -8)
    after_scroll = wait_until(
        lambda: (
            lambda state: state if state["scrollTop"] > before_scroll["scrollTop"] else None
        )(eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-root')?.scrollTop ?? null })")),
        label="root menu scrollTop changed from real wheel",
    )
else:
    after_scroll = {"scrollTop": before_scroll["scrollTop"]}

line_button = native_point_for('[data-ctx-open="sigil-menu-line-card"]')
if not line_button:
    raise SystemExit("FAIL: missing Line Trail Settings button after real scroll")
do_click(line_button)
line_state = wait_until(
    lambda: (
        lambda state: state if state["active"] and state["role"] == "region" and state["label"] == "Line trail settings" else None
    )(eval_json(
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
    "initial": initial,
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "line": line_state,
}))
PY
