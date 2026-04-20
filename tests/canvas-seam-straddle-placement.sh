#!/usr/bin/env bash
# Deterministic placement harness for mixed-DPI seam straddling.
#
# Creates a fresh canvas per scenario and compares two sources of truth:
#
#   requested  — what we asked the daemon to place
#   actual     — what CGWindowList reports the window server rendered
#
# Usage:
#   tests/canvas-seam-straddle-placement.sh [--out <file.json>]
#
# Exits 0 if every row's (actual vs requested) delta is within tolerance.

set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

OUT_PATH=""
while (( $# > 0 )); do
    case "$1" in
        --out) OUT_PATH="$2"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

PREFIX="aos-seam-straddle"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
    aos_test_kill_root "$ROOT"
    rm -rf "$ROOT"
}
trap cleanup EXIT

# Launch isolated daemon for the current build.
./aos serve --idle-timeout none \
    >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket not reachable"; exit 1; }
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")" \
    || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

# Detect seam: need ≥2 displays and mixed scale factors.
if ! python3 - <<'PY'
import json, subprocess
displays = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True)).get("displays", [])
if len(displays) < 2:
    raise SystemExit(1)
scales = {d.get("scale_factor") for d in displays}
if len(scales) < 2:
    raise SystemExit(2)
PY
then
    rc=$?
    case "$rc" in
        1) echo "SKIP: requires at least two displays"; exit 0 ;;
        2) echo "SKIP: requires mixed-DPI displays"; exit 0 ;;
    esac
fi

OUT_PATH="${OUT_PATH:-$ROOT/seam-straddle.json}"
export OUT_PATH DAEMON_PID

python3 - "$DAEMON_PID" "$OUT_PATH" <<'PY'
import json, subprocess, sys, time, os

from Quartz import (
    CGWindowListCopyWindowInfo,
    kCGNullWindowID,
    kCGWindowAlpha,
    kCGWindowBounds,
    kCGWindowListOptionAll,
    kCGWindowOwnerPID,
)

PID = int(sys.argv[1])
OUT = sys.argv[2]
TOL = 2.5

def run(*args):
    raw = json.loads(subprocess.check_output(["./aos", *args], text=True))
    # Daemon wraps responses in {data, status, v}. Unwrap transparently.
    if isinstance(raw, dict) and "data" in raw and isinstance(raw["data"], dict):
        return raw["data"]
    return raw

def canvas_at(cid):
    payload = run("show", "list", "--json")
    for c in payload.get("canvases", []):
        if c.get("id") == cid:
            return c["at"]
    return None

def best_window_bounds(target):
    deadline = time.time() + 1.5
    best, best_score = None, None
    while time.time() < deadline:
        infos = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID) or []
        for info in infos:
            if int(info.get(kCGWindowOwnerPID, 0)) != PID:
                continue
            if float(info.get(kCGWindowAlpha, 1.0)) <= 0:
                continue
            b = info.get(kCGWindowBounds) or {}
            rect = {
                "x": float(b.get("X", 0)),
                "y": float(b.get("Y", 0)),
                "w": float(b.get("Width", 0)),
                "h": float(b.get("Height", 0)),
            }
            # Prefer windows whose size matches the requested size (canvas) —
            # otherwise we may pick up a status-bar or menu window owned by the
            # same pid.
            size_ok = abs(rect["w"] - target["w"]) < 1 and abs(rect["h"] - target["h"]) < 1
            if not size_ok:
                continue
            score = (
                abs(rect["x"] - target["x"]) +
                abs(rect["y"] - target["y"])
            )
            if best_score is None or score < best_score:
                best, best_score = rect, score
        if best is not None:
            return best
        time.sleep(0.05)
    return None

displays = run("graph", "displays", "--json")["displays"]
main = next(d for d in displays if d.get("is_main"))
other = next(d for d in displays if not d.get("is_main"))

mb, ob = main["bounds"], other["bounds"]

# The seam lies between main's bottom edge and external's top edge (external
# is below main in this topology). Generic: the shared edge is the y where
# main.maxY == other.minY.
SEAM_Y = mb["y"] + mb["h"]  # assumes external below main; handles typical mac setup

# Helper to build rects: (x, y, w, h).
def rect(x, y, w, h):
    return {"x": float(x), "y": float(y), "w": float(w), "h": float(h)}

W, H = 400.0, 300.0

# Scenarios — generic so they survive any topology with a vertical seam.
# Each "straddle-*" row varies the ratio on_main : on_external to find where
# AppKit flips between interpreting the origin as main-local vs external-local.
scenarios = [
    ("pure-main-center",       rect(mb["x"]+100,       mb["y"]+120,         W, 200)),
    ("pure-main-menu-bar",     rect(mb["x"]+100,       mb["y"]+0,           W, 50)),
    ("pure-external-center",   rect(ob["x"]+200,       ob["y"]+120,         W, 200)),
    ("straddle-01pct-ext",     rect(mb["x"]+100,       SEAM_Y - 297,        W, H)),   # 297 main /   3 ext
    ("straddle-10pct-ext",     rect(mb["x"]+100,       SEAM_Y - 270,        W, H)),   # 270 main /  30 ext
    ("straddle-40pct-ext",     rect(mb["x"]+100,       SEAM_Y - 180,        W, H)),   # 180 main / 120 ext
    ("straddle-49pct-ext",     rect(mb["x"]+100,       SEAM_Y - 153,        W, H)),   # 153 main / 147 ext
    ("straddle-50pct-ext",     rect(mb["x"]+100,       SEAM_Y - 150,        W, H)),   # 150 main / 150 ext
    ("straddle-51pct-ext",     rect(mb["x"]+100,       SEAM_Y - 147,        W, H)),   # 147 main / 153 ext
    ("straddle-60pct-ext",     rect(mb["x"]+100,       SEAM_Y - 120,        W, H)),   # 120 main / 180 ext
    ("straddle-90pct-ext",     rect(mb["x"]+100,       SEAM_Y - 30,         W, H)),   #  30 main / 270 ext
    ("straddle-tip-from-main", rect(mb["x"]+100,       SEAM_Y - 2,          W, 20)),   # 2 main /  18 ext (tiny, tests absolute threshold)
    ("straddle-tip-from-ext",  rect(mb["x"]+100,       SEAM_Y - 18,         W, 20)),   # 18 main /   2 ext
    ("straddle-negative-x",    rect(ob["x"]+10,        SEAM_Y - 100,        W, H)),    # x<0, majority-ext
    ("straddle-near-menubar",  rect(mb["x"]+100,       SEAM_Y - (mb["h"]-30), W, mb["h"]-0)),  # large, covers menu bar
]

rows = []
for name, r in scenarios:
    # Fresh canvas per scenario — eliminate dependency on previous position
    # (AppKit behavior for cross-display moves varies with origin state).
    cid = f"seam-probe-{name}"
    run("show", "create",
        "--id", cid,
        "--at", f"{r['x']},{r['y']},{r['w']},{r['h']}",
        "--html", '<html><body style="margin:0;background:rgba(255,0,0,0.35);border:2px solid magenta;"></body></html>')
    # Let the retry loop settle.
    time.sleep(0.25)
    daemon = canvas_at(cid) or [None]*4
    actual = best_window_bounds(r) or {"x": None, "y": None, "w": None, "h": None}
    run("show", "remove", "--id", cid)
    time.sleep(0.1)

    def delta(a, b):
        if a is None or b is None: return None
        return round(a - b, 2)

    daemon_delta = [
        delta(daemon[0], r["x"]),
        delta(daemon[1], r["y"]),
    ]
    actual_delta = [
        delta(actual["x"], r["x"]),
        delta(actual["y"], r["y"]),
    ]

    rows.append({
        "name": name,
        "requested": r,
        "daemon":   {"x": daemon[0], "y": daemon[1], "w": daemon[2], "h": daemon[3]},
        "actual":   actual,
        "daemon_delta_xy": daemon_delta,
        "actual_delta_xy": actual_delta,
    })

report = {
    "displays": displays,
    "seam_y": SEAM_Y,
    "tolerance": TOL,
    "rows": rows,
}

with open(OUT, "w") as f:
    json.dump(report, f, indent=2)

# Text summary.
print(f"Displays: main={mb}  external={ob}   seam_y={SEAM_Y}")
hdr = "scenario                    requested (x,y)         daemon (x,y)          actual (x,y)          daemon Δ          actual Δ"
print(hdr)
print("-" * len(hdr))
fails = 0
for row in rows:
    r = row["requested"]
    d = row["daemon"]
    a = row["actual"]
    dd = row["daemon_delta_xy"]
    ad = row["actual_delta_xy"]
    print(f"{row['name']:<26} "
          f"({r['x']:>7.1f},{r['y']:>7.1f})  "
          f"({d['x']:>7.1f},{d['y']:>7.1f})  "
          f"({a['x'] if a['x'] is not None else '   n/a ':>7},{a['y'] if a['y'] is not None else '   n/a ':>7})  "
          f"({dd[0]:>+6.1f},{dd[1]:>+6.1f})  "
          f"({ad[0] if ad[0] is not None else 'n/a':>+6},{ad[1] if ad[1] is not None else 'n/a':>+6})")

    if ad[0] is None or ad[1] is None or abs(ad[0]) > TOL or abs(ad[1]) > TOL:
        fails += 1

print()
print(f"report written: {OUT}")
if fails:
    print(f"FAIL: {fails}/{len(rows)} scenarios mis-placed by more than {TOL}px")
    sys.exit(1)
print("PASS")
PY
