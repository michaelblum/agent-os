#!/usr/bin/env python3
"""
xray_target.py — LCS→CG coordinate bridge for agent-os dogfood.

Runs side-eye to get structured AX element data, converts LCS pixel
coordinates to global CG points, and outputs targeting info for hand-off.

Usage:
    python3 xray_target.py --list                          # all elements with global coords
    python3 xray_target.py --role AXTextArea                # first match by role
    python3 xray_target.py --role AXButton --title Save     # match by role + title
    python3 xray_target.py --role AXButton --label Submit   # match by role + label
    python3 xray_target.py --role AXButton --title Save --contains  # substring match
"""

import json
import subprocess
import sys
import argparse

SIDE_EYE = "/Users/Michael/Documents/GitHub/agent-os/packages/side-eye/side-eye"


def run_cmd(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"error": result.stderr.strip()}), file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def get_focused_window_info(topology):
    """Extract focused window bounds and display scale factor."""
    focused_wid = topology.get("focused_window_id")
    if not focused_wid:
        return None, None

    for display in topology.get("displays", []):
        scale = display.get("scale_factor", 1)
        for window in display.get("windows", []):
            if window.get("window_id") == focused_wid:
                bounds = window["bounds"]
                return {
                    "x": bounds["x"],
                    "y": bounds["y"],
                    "w": bounds["width"],
                    "h": bounds["height"],
                    "window_id": focused_wid,
                    "app_name": window.get("app_name", ""),
                    "title": window.get("title", ""),
                }, scale

    return None, None


def lcs_to_global(element_bounds, window_bounds, scale_factor):
    """
    Convert LCS pixel bounds to global CG point bounds.

    Inverse of side-eye's CoordinateMapper.toLCS:
        lcs_x = (global_x - window_x) * scale_factor
    Therefore:
        global_x = window_x + (lcs_x / scale_factor)
    """
    gx = window_bounds["x"] + (element_bounds["x"] / scale_factor)
    gy = window_bounds["y"] + (element_bounds["y"] / scale_factor)
    gw = element_bounds["width"] / scale_factor
    gh = element_bounds["height"] / scale_factor
    return {
        "x": round(gx, 1),
        "y": round(gy, 1),
        "w": round(gw, 1),
        "h": round(gh, 1),
    }


def center_of(bounds):
    return {
        "x": round(bounds["x"] + bounds["w"] / 2, 1),
        "y": round(bounds["y"] + bounds["h"] / 2, 1),
    }


def matches(element, role=None, title=None, label=None, value=None, contains=False):
    """Check if an element matches the given filters."""
    if role and element.get("role") != role:
        return False

    def check(field, query):
        if not query:
            return True
        actual = element.get(field, "")
        if not actual:
            return False
        if contains:
            return query.lower() in actual.lower()
        return actual == query

    return check("title", title) and check("label", label) and check("value", value)


def main():
    parser = argparse.ArgumentParser(description="Find UI elements and convert to global coordinates")
    parser.add_argument("--list", action="store_true", help="List all elements with global coords")
    parser.add_argument("--role", help="Filter by AX role (e.g., AXButton, AXTextArea)")
    parser.add_argument("--title", help="Filter by title")
    parser.add_argument("--label", help="Filter by label (description)")
    parser.add_argument("--value", help="Filter by value")
    parser.add_argument("--contains", action="store_true", help="Use substring matching")
    parser.add_argument("--index", type=int, default=0, help="Which match to return (0-indexed)")
    parser.add_argument("--no-image", action="store_true", help="Skip base64 image in output")
    args = parser.parse_args()

    # Step 1: Get topology for window bounds + scale factor
    topology = run_cmd([SIDE_EYE, "list"])
    window_info, scale_factor = get_focused_window_info(topology)

    if not window_info:
        print(json.dumps({"error": "No focused window found"}), file=sys.stderr)
        sys.exit(1)

    # Step 2: Get xray elements
    xray_args = [SIDE_EYE, "capture", "user_active", "--window", "--xray"]
    if args.no_image:
        xray_args.append("--base64")  # still need to capture, but won't write file
    else:
        xray_args.extend(["--out", "/tmp/agent-os-dogfood/xray-capture.png"])

    xray_data = run_cmd(xray_args)
    elements = xray_data.get("elements", [])

    if not elements:
        print(json.dumps({
            "error": "No interactive elements found",
            "window": window_info,
        }))
        sys.exit(1)

    # Step 3: Convert all elements to global coords
    converted = []
    for el in elements:
        bounds = el.get("bounds", {})
        global_bounds = lcs_to_global(bounds, window_info, scale_factor)
        converted.append({
            "role": el.get("role", ""),
            "title": el.get("title"),
            "label": el.get("label"),
            "value": el.get("value", "")[:50] if el.get("value") else None,
            "enabled": el.get("enabled", True),
            "context_path": el.get("context_path", []),
            "lcs_bounds": bounds,
            "global_bounds": global_bounds,
            "global_center": center_of(global_bounds),
        })

    # Step 4: Filter or list
    if args.list:
        output = {
            "window": window_info,
            "scale_factor": scale_factor,
            "element_count": len(converted),
            "elements": converted,
        }
        print(json.dumps(output, indent=2))
        return

    # Filter
    matched = [
        el for el in converted
        if matches(el, role=args.role, title=args.title, label=args.label,
                   value=args.value, contains=args.contains)
    ]

    if not matched:
        print(json.dumps({
            "error": f"No elements matched filters (role={args.role}, title={args.title}, label={args.label})",
            "available_roles": sorted(set(el["role"] for el in converted)),
            "element_count": len(converted),
        }))
        sys.exit(1)

    if args.index >= len(matched):
        print(json.dumps({
            "error": f"Index {args.index} out of range, only {len(matched)} matches",
            "matches": len(matched),
        }))
        sys.exit(1)

    target = matched[args.index]
    output = {
        "target": target,
        "window": window_info,
        "scale_factor": scale_factor,
        "match_count": len(matched),
        "hand_off_click": f"{int(target['global_center']['x'])},{int(target['global_center']['y'])}",
        "heads_up_at": f"{int(target['global_bounds']['x'])},{int(target['global_bounds']['y'])},{int(target['global_bounds']['w'])},{int(target['global_bounds']['h'])}",
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
