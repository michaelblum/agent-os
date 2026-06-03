#!/usr/bin/env python3
import json
import os

from real_input_surface_primitives import AOS, radial_drag_point, wait_until
from real_input_surface_primitives import (
    aos_native_segmented_ready_js,
    aos_native_slider_ready_js,
    aos_native_tab_ready_js,
)


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
        return self.aos.run("do", "scroll", f"{round(point['x'])},{round(point['y'])}", "--dy", str(dy))

    def drag(self, start, end, speed=None):
        args = ["do", "drag", f"{round(start['x'])},{round(start['y'])}", f"{round(end['x'])},{round(end['y'])}"]
        if speed is not None:
            args.extend(["--speed", str(speed)])
        return self.aos.run(*args)

    def key(self, key):
        if os.getenv("SIGIL_REAL_INPUT_ALLOW_KEYS") == "1":
            self.aos.run("do", "key", key)
            return
        raise RuntimeError(
            "Sigil real-input smokes must not send real keyboard input by default; "
            "use renderer/debug dispatch helpers instead, or set "
            "SIGIL_REAL_INPUT_ALLOW_KEYS=1 for an isolated safe environment."
        )

    def dispatch_escape(self):
        return self.eval_json(
            """(() => {
              window.__sigilDebug.dispatch({ type: 'key_down', key_code: 53 })
              return JSON.stringify(window.__sigilDebug.snapshot().avatarControls)
            })()"""
        )

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

    def open_avatar_controls_from_avatar(self, label="avatar controls open from real right click"):
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
            lambda: self.eval_json("JSON.stringify(window.__sigilDebug.snapshot().avatarControls)")
            if self.eval_json("JSON.stringify(window.__sigilDebug.snapshot().avatarControls.open)") is True
            else None,
            label=label,
        )

    def compact_surface_point(self):
        return self.wait_until(
            lambda: self.native_point_for('[data-sigil-avatar-control-surface]'),
            label="compact avatar control surface rendered",
        )

    def scroll_compact_surface(self, dy):
        point = self.compact_surface_point()
        return {
            "point": point,
            "result": self.scroll(point, dy),
        }

    def scroll_until_selector_visible(self, selector, dy=-80, attempts=8):
        last = None
        for attempt in range(1, attempts + 1):
            point = self.native_point_for(selector)
            if point:
                return {"attempt": attempt, "point": point, "lastScroll": last}
            before = self.eval_json("JSON.stringify({ scrollTop: document.querySelector('[data-sigil-avatar-control-surface]')?.scrollTop ?? null })")
            last = self.scroll_compact_surface(dy)
            after = self.eval_json("JSON.stringify({ scrollTop: document.querySelector('[data-sigil-avatar-control-surface]')?.scrollTop ?? null })")
            if after["scrollTop"] == before["scrollTop"]:
                break
        raise RuntimeError(f"selector did not become visible after bounded compact scroll: {selector}; last={last!r}")

    def hit_canvas_id(self):
        return self.eval_json("JSON.stringify(window.__sigilDebug.snapshot().hitTargetId)")

    def select_compact_tab(self, value):
        ready = self.eval_json(aos_native_tab_ready_js(value))
        if not ready.get("ok"):
            raise RuntimeError(f"compact tab is not reachable: {ready}")
        point = self.native_point_for(f'[data-aos-tabs-trigger][data-value="{value}"]')
        if not point:
            raise RuntimeError(f"compact tab has no native point: {ready}")
        self.click(point)
        return ready

    def select_segmented_control(self, descriptor_id, value):
        ready = self.eval_json(aos_native_segmented_ready_js(descriptor_id, value))
        if not ready.get("ok"):
            raise RuntimeError(f"segmented control is not reachable: {ready}")
        point = self.native_point_for(
            f'.aos-form-field[data-descriptor-id="{descriptor_id}"] .aos-segmented button[data-value="{value}"]'
        )
        if not point:
            raise RuntimeError(f"segmented control has no native point: {ready}")
        self.click(point)
        return ready

    def drag_slider_control(self, descriptor_id, start_ratio=0.15, end_ratio=0.85):
        ready = self.eval_json(aos_native_slider_ready_js(descriptor_id))
        if not ready.get("ok"):
            raise RuntimeError(f"slider control is not reachable: {ready}")
        selector = f'.aos-form-field[data-descriptor-id="{descriptor_id}"] [data-aos-slider-control]'
        start = self.native_point_for(selector, start_ratio)
        end = self.native_point_for(selector, end_ratio)
        if not start or not end:
            raise RuntimeError(f"slider control has no native drag points: {ready}")
        self.drag(start, end)
        return {**ready, "start": start, "end": end}

    def radial_config(self):
        return self.eval_json(
            """(() => {
              const snap = window.__sigilDebug.snapshot()
              return JSON.stringify({
                source: snap.radialGestureMenu ? 'snapshot.radialGestureMenu' : 'state.radialGestureMenu',
                config: snap.radialGestureMenu || window.state.radialGestureMenu,
                avatarPos: snap.avatarPos,
              })
            })()"""
        )

    def radial_drag_plan(self, phase="fastTravel", angle=0, epsilon=3):
        data = self.radial_config()
        origin = data["avatarPos"]
        plan = radial_drag_point(
            origin,
            data["config"],
            phase=phase,
            angle=angle,
            epsilon=epsilon,
            source=data["source"],
        )
        return plan

    def open_radial_with_drag(self, phase="radial"):
        plan = self.radial_drag_plan(phase=phase)
        self.drag(plan["origin"], plan["point"])
        return plan

    def rects_overlap(self, a, b):
        return (
            a["x"] < b["x"] + b["w"]
            and a["x"] + a["w"] > b["x"]
            and a["y"] < b["y"] + b["h"]
            and a["y"] + a["h"] > b["y"]
        )

    def assert_avatar_controls_clear_avatar(self, label):
        state = self.eval_json(
            """(() => {
              const snap = window.__sigilDebug.snapshot()
              const radius = snap.avatarHitRadius || 40
              return JSON.stringify({
                controls: snap.avatarControls.bounds,
                avatar: {
                  x: snap.avatarPos.x - radius,
                  y: snap.avatarPos.y - radius,
                  w: radius * 2,
                  h: radius * 2,
                },
              })
            })()"""
        )
        if not state["controls"]:
            raise SystemExit(f"FAIL: missing avatar controls bounds for {label}")
        if self.rects_overlap(state["controls"], state["avatar"]):
            raise SystemExit(f"FAIL: avatar controls overlaps avatar for {label}: {state}")
        return state
