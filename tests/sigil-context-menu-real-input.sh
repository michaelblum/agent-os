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

aos_visual_launch_sigil_with_inspector avatar-main canvas-inspector "" manual-visible

python3 - <<'PY'
import json
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
      window.__sigilDebug.armInteractionTrace('real-input-context-menu-smoke')
      const snap = window.__sigilDebug.snapshot()
      const frame = snap.hitTargetFrame
      return JSON.stringify({ frame, avatarPos: snap.avatarPos })
    })()"""
)
frame = initial["frame"]
avatar_center = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}

do_click(avatar_center, "--right")
wait_until(
    lambda: eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu)") if eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is True else None,
    label="context menu open from real right click",
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
      return JSON.stringify({ scrollTop: root?.scrollTop ?? null, scrollHeight: root?.scrollHeight ?? null, clientHeight: root?.clientHeight ?? null })
    })()"""
)
after_scroll = before_scroll
if before_scroll["scrollHeight"] > before_scroll["clientHeight"]:
    do_scroll(menu_center, -8)
    after_scroll = wait_until(
        lambda: (
            lambda state: state if state["scrollTop"] > before_scroll["scrollTop"] else None
        )(eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-root')?.scrollTop ?? null })")),
        label="root menu scrollTop changed from real wheel",
    )

line_button = native_point_for('[data-ctx-open="sigil-menu-line-card"]')
if not line_button:
    raise SystemExit("FAIL: missing Line Trail Settings button after real scroll")
do_click(line_button)

line_state = wait_until(
    lambda: (
        lambda state: state if state["active"] and state["buttonsVisible"] else None
    )(eval_json(
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

shrink = native_point_for('[data-sigil-line-trail-mode="shrink"]')
if not shrink:
    raise SystemExit("FAIL: missing Shrink trail mode button")
do_click(shrink)

result = wait_until(
    lambda: (
        lambda state: state if state["mode"] == "shrink" and state["scrollEvents"] > 0 else None
    )(eval_json(
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

back = native_point_for('#sigil-menu-line-card [data-ctx-back]')
if not back:
    raise SystemExit("FAIL: missing Line Trail back button")
do_click(back)
time.sleep(0.2)
root_state = eval_json(
    """(() => {
      const root = document.querySelector('#sigil-menu-root')
      return JSON.stringify({
        active: root?.classList.contains('active') ?? false,
        pushed: root?.classList.contains('pushed') ?? false,
        stack: window.__sigilDebug.snapshot().contextMenu.stack
      })
    })()"""
)
if not root_state["active"]:
    raise SystemExit(f"FAIL: root card did not become active after real back click: {root_state}")

wormhole_button = native_point_for('[data-ctx-open="sigil-menu-wormhole-card"]')
if not wormhole_button:
    raise SystemExit("FAIL: missing Wormhole Settings button")
do_click(wormhole_button)
time.sleep(0.2)
wormhole_before = eval_json(
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
if not wormhole_before["active"] or wormhole_before["scrollHeight"] <= wormhole_before["clientHeight"]:
    raise SystemExit(f"FAIL: wormhole card not active/scrollable after real click: {wormhole_before}")
wormhole_center = native_point_for('#sigil-menu-wormhole-card')
if not wormhole_center:
    raise SystemExit("FAIL: missing Wormhole Settings card point")
do_scroll(wormhole_center, -8)
wormhole_after = wait_until(
    lambda: (
        lambda state: state if state["scrollTop"] > wormhole_before["scrollTop"] else None
    )(eval_json("JSON.stringify({ scrollTop: document.querySelector('#sigil-menu-wormhole-card')?.scrollTop ?? null })")),
    label="wormhole card scrollTop changed from real wheel",
)

print("PASS", json.dumps({
    "before_scroll": before_scroll,
    "after_scroll": after_scroll,
    "line": line_state,
    "result": result,
    "wormhole_before": wormhole_before,
    "wormhole_after": wormhole_after,
}))
PY
