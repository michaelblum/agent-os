#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


LIB_DIR = Path(__file__).resolve().parent
NODE_HELPER = LIB_DIR / "real-input-surface-primitives.mjs"
AOS_COMMAND_TIMEOUT_SECONDS = float(os.environ.get("AOS_REAL_INPUT_COMMAND_TIMEOUT_SECONDS", "8"))


class AOS:
    def __init__(self, aos_bin):
        self.aos_bin = aos_bin

    def run(self, *args):
        return subprocess.check_output(
            [self.aos_bin, *args],
            text=True,
            stderr=subprocess.STDOUT,
            timeout=AOS_COMMAND_TIMEOUT_SECONDS,
        )

    def run_json(self, *args):
        return json.loads(self.run(*args))

    def run_json_capture(self, *args):
        try:
            completed = subprocess.run(
                [self.aos_bin, *args],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=AOS_COMMAND_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as error:
            return {
                "ok": False,
                "returncode": None,
                "stdout": error.stdout or "",
                "error": f"timed out after {AOS_COMMAND_TIMEOUT_SECONDS:g}s",
                "args": [self.aos_bin, *args],
            }
        if completed.returncode != 0:
            return {"ok": False, "returncode": completed.returncode, "stdout": completed.stdout, "args": [self.aos_bin, *args]}
        try:
            return {"ok": True, "payload": json.loads(completed.stdout or "{}"), "stdout": completed.stdout}
        except json.JSONDecodeError as error:
            return {"ok": False, "returncode": completed.returncode, "stdout": completed.stdout, "error": f"invalid JSON: {error}", "args": [self.aos_bin, *args]}

    def eval_json(self, canvas_id, js):
        payload = self.run_json("show", "eval", "--id", canvas_id, "--js", js)
        if payload.get("status") != "success":
            raise RuntimeError(f"show eval failed: {payload}")
        return json.loads(payload.get("result") or "null")

    def show_list(self):
        return self.run_json("show", "list")

    def canvas_info(self, canvas_id):
        result = self.run_json_capture("show", "get", "--id", canvas_id)
        if not result.get("ok"):
            return {"error": result}
        return result.get("payload", {}).get("canvas")

    def display_payloads(self):
        payload = self.run_json("graph", "displays", "--json")
        return payload.get("data", {}).get("displays", payload.get("displays", []))


def wait_until(predicate, timeout=6.0, interval=0.08, label="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise TimeoutError(f"timed out waiting for {label}; last={last!r}")


def node_primitive(action, **payload):
    completed = subprocess.run(
        ["node", str(NODE_HELPER), action],
        input=json.dumps(payload),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{NODE_HELPER.name} {action} failed: {completed.stderr or completed.stdout}")
    return json.loads(completed.stdout or "null")


def normalize_displays(displays):
    return node_primitive("normalize-displays", displays=displays)


def desktop_world_to_native_point(point, displays):
    return node_primitive("desktop-world-to-native", point=point, displays=displays)


def rect_intersects_visible_display(rect, displays):
    return bool(node_primitive("rect-intersects-visible-display", rect=rect, displays=displays).get("intersects"))


def native_rect_intersects_visible_display(rect, displays):
    return bool(node_primitive("native-rect-intersects-visible-display", rect=rect, displays=displays).get("intersects"))


def opposite_visible_display_point(point, displays, pad=96):
    return node_primitive("opposite-visible-display-point", point=point, displays=displays, options={"pad": pad})


def desktop_world_figure_eight_path(displays, radial_menu_radius=260, min_span=240):
    return node_primitive(
        "desktop-world-figure-eight-path",
        displays=displays,
        options={"radialMenuRadius": radial_menu_radius, "minSpan": min_span},
    )


def distance(a, b):
    dx = float(a["x"]) - float(b["x"])
    dy = float(a["y"]) - float(b["y"])
    return (dx * dx + dy * dy) ** 0.5


def canvas_frame(canvas):
    if not isinstance(canvas, dict):
        return None
    frame = canvas.get("at") or canvas.get("frame")
    return frame[:4] if isinstance(frame, list) and len(frame) >= 4 else None


def semantic_target_map(payload):
    result = {}
    for target in payload.get("semantic_targets") or []:
        target_id = target.get("id")
        if target_id:
            result[target_id] = target
    return result


def element_names(payload):
    names = []
    for element in payload.get("elements") or []:
        for key in ("title", "label", "value"):
            value = element.get(key)
            if isinstance(value, str) and value:
                names.append(value)
    return names


def capture_xray(aos, canvas_id, diagnostics):
    fd, path = tempfile.mkstemp(prefix=f"aos-xray-{canvas_id}-", suffix=".png")
    os.close(fd)
    try:
        result = aos.run_json_capture("see", "capture", "--canvas", canvas_id, "--xray", "--out", path)
        if not result.get("ok"):
            raise RuntimeError(json.dumps({"capture": result, **diagnostics()}, sort_keys=True))
        return result["payload"]
    finally:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def ease(t):
    return t * t * (3.0 - 2.0 * t)


class RealPointer:
    # Boundary adapter for DesktopWorld/native drag-path coverage that cannot
    # yet be expressed as one `aos do` gesture with intermediate path holds.
    # Consumer scenarios should prefer SigilContextHarness/AOS do wrappers.
    def __init__(self, aos, displays=None):
        self.aos = aos
        self.displays = displays
        import Quartz  # pylint: disable=import-error
        self.quartz = Quartz
        self.source = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStatePrivate)

    def display_payloads(self):
        if self.displays is None:
            self.displays = self.aos.display_payloads()
        return self.displays

    def refresh_displays(self):
        self.displays = self.aos.display_payloads()
        return self.displays

    def native(self, desktop_world_point):
        return desktop_world_to_native_point(desktop_world_point, self.display_payloads())

    def post_native(self, kind, native_point):
        event = self.quartz.CGEventCreateMouseEvent(
            self.source,
            kind,
            (float(native_point["x"]), float(native_point["y"])),
            self.quartz.kCGMouseButtonLeft,
        )
        if event is None:
            raise RuntimeError(f"failed to create CGEvent {kind}")
        self.quartz.CGEventSetIntegerValueField(event, self.quartz.kCGMouseEventButtonNumber, 0)
        self.quartz.CGEventSetIntegerValueField(event, self.quartz.kCGMouseEventClickState, 1)
        self.quartz.CGEventPost(self.quartz.kCGHIDEventTap, event)

    def post_world(self, kind, desktop_world_point):
        self.post_native(kind, self.native(desktop_world_point))

    def move_world(self, point):
        self.post_world(self.quartz.kCGEventMouseMoved, point)

    def down_world(self, point):
        self.move_world(point)
        time.sleep(0.04)
        self.post_world(self.quartz.kCGEventLeftMouseDown, point)

    def up_world(self, point):
        self.post_world(self.quartz.kCGEventLeftMouseUp, point)

    def drag_world(self, start, end, duration=0.28, steps=None, hold=0.0):
        if steps is None:
            steps = max(6, int(max(0.05, duration) / 0.012))
        for index in range(1, steps + 1):
            t = ease(index / steps)
            point = {
                "x": float(start["x"]) + (float(end["x"]) - float(start["x"])) * t,
                "y": float(start["y"]) + (float(end["y"]) - float(start["y"])) * t,
            }
            self.post_world(self.quartz.kCGEventLeftMouseDragged, point)
            time.sleep(max(0.001, duration / steps))
        if hold > 0:
            self.hold_drag_world(end, hold)
        return end

    def hold_drag_world(self, point, duration=0.12, interval=0.03):
        deadline = time.time() + duration
        while time.time() < deadline:
            self.post_world(self.quartz.kCGEventLeftMouseDragged, point)
            time.sleep(interval)

    def drag_path_world(self, points, segment_duration=0.24, hold=0.08):
        if len(points) < 2:
            raise ValueError("drag_path_world needs at least two points")
        self.move_world(points[0])
        time.sleep(0.04)
        self.post_world(self.quartz.kCGEventLeftMouseDown, points[0])
        current = points[0]
        try:
            for point in points[1:]:
                current = self.drag_world(current, point, duration=segment_duration)
                if hold > 0:
                    self.hold_drag_world(current, hold)
        finally:
            self.up_world(current)


class NativeClick:
    # Low-level real-input boundary for tests that need to separate native
    # event posting time from app-visible response time. Normal CLI scenarios
    # should keep using `aos do click` for safety preflight and public contract
    # coverage.
    def __init__(self):
        import Quartz  # pylint: disable=import-error
        self.quartz = Quartz
        self.source = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStatePrivate)

    def post(self, kind, native_point, button):
        event = self.quartz.CGEventCreateMouseEvent(
            self.source,
            kind,
            (float(native_point["x"]), float(native_point["y"])),
            button,
        )
        if event is None:
            raise RuntimeError(f"failed to create CGEvent {kind}")
        self.quartz.CGEventSetIntegerValueField(event, self.quartz.kCGMouseEventButtonNumber, int(button))
        self.quartz.CGEventSetIntegerValueField(event, self.quartz.kCGMouseEventClickState, 1)
        self.quartz.CGEventPost(self.quartz.kCGHIDEventTap, event)

    def click_native(self, native_point, button="left", count=1, dwell=0.04):
        button_name = "right" if button == "right" else "left"
        cg_button = self.quartz.kCGMouseButtonRight if button_name == "right" else self.quartz.kCGMouseButtonLeft
        down_type = self.quartz.kCGEventRightMouseDown if button_name == "right" else self.quartz.kCGEventLeftMouseDown
        up_type = self.quartz.kCGEventRightMouseUp if button_name == "right" else self.quartz.kCGEventLeftMouseUp

        started_ns = time.time_ns()
        self.post(self.quartz.kCGEventMouseMoved, native_point, self.quartz.kCGMouseButtonLeft)
        for index in range(max(1, int(count))):
            down = self.quartz.CGEventCreateMouseEvent(
                self.source,
                down_type,
                (float(native_point["x"]), float(native_point["y"])),
                cg_button,
            )
            if down is None:
                raise RuntimeError("failed to create click-down CGEvent")
            self.quartz.CGEventSetIntegerValueField(down, self.quartz.kCGMouseEventButtonNumber, int(cg_button))
            self.quartz.CGEventSetIntegerValueField(down, self.quartz.kCGMouseEventClickState, index + 1)
            self.quartz.CGEventPost(self.quartz.kCGHIDEventTap, down)
            time.sleep(max(0.0, float(dwell)))
            up = self.quartz.CGEventCreateMouseEvent(
                self.source,
                up_type,
                (float(native_point["x"]), float(native_point["y"])),
                cg_button,
            )
            if up is None:
                raise RuntimeError("failed to create click-up CGEvent")
            self.quartz.CGEventSetIntegerValueField(up, self.quartz.kCGMouseEventButtonNumber, int(cg_button))
            self.quartz.CGEventSetIntegerValueField(up, self.quartz.kCGMouseEventClickState, index + 1)
            self.quartz.CGEventPost(self.quartz.kCGHIDEventTap, up)
            if index + 1 < max(1, int(count)):
                time.sleep(max(0.0, float(dwell)))
        event_posted_ns = time.time_ns()
        return {
            "button": button_name,
            "count": max(1, int(count)),
            "point": {"x": float(native_point["x"]), "y": float(native_point["y"])},
            "startedAtMs": started_ns / 1_000_000,
            "eventPostedAtMs": event_posted_ns / 1_000_000,
            "injectionDurationMs": (event_posted_ns - started_ns) / 1_000_000,
        }


def _main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: real_input_surface_primitives.py <action>")
    action = sys.argv[1]
    payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    if action == "click-native-json":
        point = payload.get("point") or {}
        result = NativeClick().click_native(
            {"x": point.get("x"), "y": point.get("y")},
            button=payload.get("button", "left"),
            count=payload.get("count", 1),
            dwell=payload.get("dwell", 0.04),
        )
        print(json.dumps(result, sort_keys=True))
        return
    raise SystemExit(f"unknown real-input primitive action: {action}")


if __name__ == "__main__":
    _main()
