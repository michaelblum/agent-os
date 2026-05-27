#!/usr/bin/env python3
import json

from real_input_surface_primitives import AOS, wait_until


class SigilContextHarness:
    def __init__(self, aos_bin="./aos", canvas_id="avatar-main"):
        self.aos = AOS(aos_bin)
        self.canvas_id = canvas_id

    def eval_json(self, js):
        return self.aos.eval_json(self.canvas_id, js)

    def arm_trace(self, label):
        return self.eval_json(
            f"""(() => {{
              window.__sigilDebug.armInteractionTrace({json.dumps(label)})
              const snap = window.__sigilDebug.snapshot()
              return JSON.stringify({{
                avatarVisible: snap.avatarVisible,
                hitTargetInteractive: snap.hitTargetInteractive,
                frame: snap.hitTargetFrame,
                avatarPos: snap.avatarPos
              }})
            }})()"""
        )

    def wait_until(self, predicate, timeout=5.0, interval=0.05, label="condition"):
        return wait_until(predicate, timeout=timeout, interval=interval, label=label)

    def click(self, point, *extra):
        self.aos.run("do", "click", f"{round(point['x'])},{round(point['y'])}", *extra)

    def scroll(self, point, dy):
        self.aos.run("do", "scroll", f"{round(point['x'])},{round(point['y'])}", "--dy", str(dy))

    def key(self, key):
        self.aos.run("do", "key", key)

    def native_point_for(self, selector, ratio=0.5):
        # Transitional canvas-DOM helper until AOS canvas perception exposes DOM refs.
        return self.eval_json(
            f"""(() => {{
              const el = document.querySelector({json.dumps(selector)})
              if (!el) return JSON.stringify(null)
              const rect = el.getBoundingClientRect()
              if (rect.width <= 0 || rect.height <= 0) return JSON.stringify(null)
              const snap = window.__sigilDebug.snapshot()
              const dw = snap.surface?.segment?.dw_bounds || [0, 0, 0, 0]
              const world = {{
                x: dw[0] + rect.left + rect.width * {ratio},
                y: dw[1] + rect.top + rect.height / 2,
              }}
              const displays = window.liveJs?.displays || []
              const display = displays.find((entry) => {{
                const bounds = entry.desktop_world_bounds || entry.desktopWorldBounds || entry.bounds
                return bounds
                  && world.x >= bounds.x
                  && world.y >= bounds.y
                  && world.x < bounds.x + bounds.w
                  && world.y < bounds.y + bounds.h
              }})
              const displayWorld = display?.desktop_world_bounds || display?.desktopWorldBounds || display?.bounds
              const displayNative = display?.native_bounds || display?.nativeBounds
              const fallbackNative = snap.surface?.segment?.native_bounds || dw
              const native = displayWorld && displayNative
                ? {{
                    x: displayNative.x + ((world.x - displayWorld.x) * displayNative.w / displayWorld.w),
                    y: displayNative.y + ((world.y - displayWorld.y) * displayNative.h / displayWorld.h),
                  }}
                : {{
                    x: fallbackNative[0] + world.x - dw[0],
                    y: fallbackNative[1] + world.y - dw[1],
                  }}
              return JSON.stringify({{
                x: native.x,
                y: native.y,
                rect: {{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              }})
            }})()"""
        )

    def open_context_menu_from_avatar(self, label="context menu open from real right click"):
        initial = self.eval_json(
            """(() => {
              const snap = window.__sigilDebug.snapshot()
              return JSON.stringify({ frame: snap.hitTargetFrame, avatarPos: snap.avatarPos })
            })()"""
        )
        frame = initial["frame"]
        avatar_center = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}
        self.click(avatar_center, "--right")
        return self.wait_until(
            lambda: self.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu)")
            if self.eval_json("JSON.stringify(window.__sigilDebug.snapshot().contextMenu.open)") is True
            else None,
            label=label,
        )

    def rects_overlap(self, a, b):
        return (
            a["x"] < b["x"] + b["w"]
            and a["x"] + a["w"] > b["x"]
            and a["y"] < b["y"] + b["h"]
            and a["y"] + a["h"] > b["y"]
        )

    def assert_menu_clear_avatar(self, label):
        state = self.eval_json(
            """(() => {
              const snap = window.__sigilDebug.snapshot()
              const radius = snap.avatarHitRadius || 40
              return JSON.stringify({
                menu: snap.contextMenu.bounds,
                avatar: {
                  x: snap.avatarPos.x - radius,
                  y: snap.avatarPos.y - radius,
                  w: radius * 2,
                  h: radius * 2,
                },
              })
            })()"""
        )
        if not state["menu"]:
            raise SystemExit(f"FAIL: missing menu bounds for {label}")
        if self.rects_overlap(state["menu"], state["avatar"]):
            raise SystemExit(f"FAIL: context menu overlaps avatar for {label}: {state}")
        return state

