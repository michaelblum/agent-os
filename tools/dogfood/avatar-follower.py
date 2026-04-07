#!/usr/bin/env python3
"""avatar-follower.py — Click-following orchestrator for the avatar overlay.

Monitors global mouse clicks via CGEventTap (listen-only).
Animates the avatar canvas to wherever the user clicks.
Clicks pass through to apps — this is listen-only, not intercepting.

Requires:
  - Accessibility permission (for CGEventTap)
  - heads-up daemon running with avatar canvas created
  - pip3 install pyobjc-framework-Quartz (for CGEventTap)

Usage:
  python3 avatar-follower.py

Architecture lesson from the ball experiment:
  - CGEventTap in kCGEventTapOptionListenOnly does NOT block clicks
  - Clicks go through to the desktop/app AND we receive them
  - This is the "broken hands" design: the agent perceives without interfering
"""

import subprocess
import sys
import time
import threading
import json
import math
import os

HEADS_UP = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "packages", "heads-up", "heads-up")
CANVAS_ID = "avatar"
CANVAS_SIZE = 300  # matches --at w,h from creation

# Current position (CG coordinates, top-left origin)
cur_x = 700.0
cur_y = 1300.0

# Animation state
move_id = 0
move_lock = threading.Lock()

def ease_in_out_cubic(t):
    if t < 0.5:
        return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2

def send_update(x, y):
    """Update avatar canvas position via heads-up."""
    try:
        subprocess.run(
            [HEADS_UP, "update", "--id", CANVAS_ID,
             "--at", f"{x},{y},{CANVAS_SIZE},{CANVAS_SIZE}"],
            capture_output=True, timeout=2
        )
    except Exception:
        pass

def animate_to(tx, ty, mid):
    """Animate avatar to target position with easing."""
    global cur_x, cur_y, move_id

    sx, sy = cur_x, cur_y
    # Center the canvas on the click point
    tx -= CANVAS_SIZE / 2
    ty -= CANVAS_SIZE / 2

    duration = 1.2  # seconds
    fps = 60
    n = int(fps * duration)
    t0 = time.time()

    for i in range(n + 1):
        with move_lock:
            if move_id != mid:
                return  # animation was superseded

        t = i / n
        e = ease_in_out_cubic(t)
        x = sx + (tx - sx) * e
        y = sy + (ty - sy) * e
        cur_x, cur_y = x, y

        send_update(x, y)

        # Frame timing
        want = (i + 1) / fps
        got = time.time() - t0
        if want > got:
            time.sleep(want - got)

def on_click(x, y):
    """Handle a click event — start animation to click position."""
    global move_id

    with move_lock:
        move_id += 1
        mid = move_id

    threading.Thread(target=animate_to, args=(x, y, mid), daemon=True).start()

def main():
    # Try to use CGEventTap via pyobjc
    try:
        from Quartz import (
            CGEventTapCreate, CGEventTapEnable,
            CGEventGetLocation, CGEventMaskBit,
            kCGSessionEventTap, kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly, kCGEventLeftMouseDown,
            CFMachPortCreateRunLoopSource, CFRunLoopGetCurrent,
            CFRunLoopAddSource, CFRunLoopRun, kCFRunLoopCommonModes
        )

        def callback(proxy, type_, event, refcon):
            loc = CGEventGetLocation(event)
            on_click(loc.x, loc.y)
            return event

        mask = CGEventMaskBit(kCGEventLeftMouseDown)
        tap = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly,
            mask,
            callback,
            None
        )

        if tap is None:
            print("CGEventTap failed. Grant Accessibility permission.", file=sys.stderr)
            sys.exit(1)

        source = CFMachPortCreateRunLoopSource(None, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes)
        CGEventTapEnable(tap, True)

        print("avatar-follower running (CGEventTap).", file=sys.stderr)
        print("  Click anywhere → avatar follows (1.2s ease)", file=sys.stderr)
        print("  Clicks pass through to apps.", file=sys.stderr)
        print("  Ctrl+C to stop.", file=sys.stderr)

        CFRunLoopRun()

    except ImportError:
        print("pyobjc-framework-Quartz not found.", file=sys.stderr)
        print("Install: pip3 install pyobjc-framework-Quartz", file=sys.stderr)
        print("Falling back to polling mode (no click detection).", file=sys.stderr)
        # Fallback: just keep the process alive
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    main()
