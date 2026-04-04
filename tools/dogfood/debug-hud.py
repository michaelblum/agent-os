#!/usr/bin/env python3
"""debug-hud.py — Real-time debug overlay for drag testing.

Polls mouse position, canvas positions, and display geometry.
Pushes updates to the debug overlay via heads-up eval.

Requires: pyobjc-framework-Quartz (pip3 install pyobjc-framework-Quartz)
"""

import subprocess
import json
import time
import sys
import os

HEADS_UP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "packages", "heads-up", "heads-up")
SIDE_EYE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "packages", "side-eye", "side-eye")

# Get display geometry from side-eye
def get_displays():
    try:
        result = subprocess.run([SIDE_EYE, "list"], capture_output=True, text=True, timeout=5)
        data = json.loads(result.stdout)
        displays = []
        for d in data.get("displays", []):
            b = d["bounds"]
            displays.append({
                "name": "main" if d.get("is_main") else f"external {d.get('ordinal', '?')}",
                "x": b["x"], "y": b["y"],
                "w": b["width"], "h": b["height"],
                "scale": d.get("scale_factor", 1),
                "label": d.get("label", ""),
            })
        return displays
    except Exception:
        return []

def which_display(x, y, displays):
    for d in displays:
        if d["x"] <= x < d["x"] + d["w"] and d["y"] <= y < d["y"] + d["h"]:
            return d["name"]
    return "none"

def relative_to_display(x, y, displays):
    for d in displays:
        if d["x"] <= x < d["x"] + d["w"] and d["y"] <= y < d["y"] + d["h"]:
            return f"({x - d['x']:.0f}, {y - d['y']:.0f})"
    return "—"

def get_canvas_positions():
    try:
        result = subprocess.run([HEADS_UP, "list"], capture_output=True, text=True, timeout=2)
        data = json.loads(result.stdout)
        positions = {}
        for c in data.get("canvases", []):
            positions[c["id"]] = c["at"]
        return positions
    except Exception:
        return {}

def push_update(data):
    js = f"update({json.dumps(data)})"
    try:
        subprocess.run([HEADS_UP, "eval", "--id", "debug-hud", "--js", js],
                      capture_output=True, timeout=2)
    except Exception:
        pass

def main():
    from Quartz import NSEvent

    displays = get_displays()
    print(f"Displays: {[d['name'] + ' ' + d['label'] for d in displays]}", file=sys.stderr)

    # Track drag state from events file
    events_file = "/tmp/agent-os-dogfood/events.jsonl"
    last_events_size = 0
    dragging = False

    from AppKit import NSScreen

    # Build display info string
    disp_info = " | ".join([f"{d['name']}: ({d['x']},{d['y']}) {d['w']}x{d['h']}" for d in displays])
    print(f"Display geometry: {disp_info}", file=sys.stderr)

    # Primary screen height for NS→CG conversion
    primary = NSScreen.screens()[0]
    primary_height = primary.frame().size.height
    print(f"Primary NSScreen height: {primary_height}", file=sys.stderr)

    while True:
        # Mouse position
        loc = NSEvent.mouseLocation()
        ns_x, ns_y = loc.x, loc.y

        # NS (bottom-left, Y-up) → CG (top-left, Y-down)
        mouse_cg_x = ns_x
        mouse_cg_y = primary_height - ns_y

        mouse_display = which_display(mouse_cg_x, mouse_cg_y, displays)

        # Check drag state from events file
        try:
            size = os.path.getsize(events_file)
            if size > last_events_size:
                with open(events_file, "rb") as f:
                    f.seek(max(0, size - 2000))
                    tail = f.read().decode("utf-8", errors="replace")
                if '"drag_start"' in tail[-(size - last_events_size + 500):]:
                    dragging = True
                if '"drag_end"' in tail[-(size - last_events_size + 500):]:
                    dragging = False
                last_events_size = size
        except Exception:
            pass

        # Widget position
        canvases = get_canvas_positions()
        chat_at = canvases.get("agent-chat")

        widget_cg = "—"
        widget_rel = "—"
        widget_disp = "—"
        if chat_at:
            # The "widget" (card) is inset 16px from canvas edge
            card_x = chat_at[0] + 16
            card_y = chat_at[1] + 16
            card_w = chat_at[2] - 32
            card_h = chat_at[3] - 32
            widget_cg = f"({card_x:.0f}, {card_y:.0f}) {card_w:.0f}x{card_h:.0f}"
            widget_disp = which_display(card_x, card_y, displays)
            widget_rel = relative_to_display(card_x, card_y, displays)

        push_update({
            "mouse": f"({mouse_cg_x:.0f}, {mouse_cg_y:.0f})",
            "mouseNS": f"({ns_x:.0f}, {ns_y:.0f})",
            "dragging": dragging,
            "mouseDisplay": mouse_display,
            "widgetCG": widget_cg,
            "widgetRel": widget_rel,
            "widgetDisplay": widget_disp,
            "dispInfo": disp_info,
        })

        time.sleep(0.1)  # 10fps

if __name__ == "__main__":
    main()
