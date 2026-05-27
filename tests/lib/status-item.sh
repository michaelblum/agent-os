#!/usr/bin/env bash

press_aos_status_item() {
  local pid="$1"
  local expected_label="${AOS_STATUS_ITEM_LABEL:-AOS status item}"

  for _ in $(seq 1 30); do
    if swift - "$pid" "$expected_label" <<'SWIFT'
import AppKit
import ApplicationServices
import Foundation

func getAttr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    guard result == .success else { return nil }
    return value
}

guard CommandLine.arguments.count >= 3,
      let pidValue = Int32(CommandLine.arguments[1]) else {
    fputs("FAIL: missing pid\n", stderr)
    exit(1)
}

let expectedLabel = CommandLine.arguments[2]
let app = AXUIElementCreateApplication(pidValue)
guard let extrasValue = getAttr(app, kAXExtrasMenuBarAttribute as String) else {
    fputs("FAIL: missing extras menu bar\n", stderr)
    exit(1)
}
let extras = extrasValue as! AXUIElement

var childrenRef: CFTypeRef?
let childrenResult = AXUIElementCopyAttributeValue(extras, kAXChildrenAttribute as CFString, &childrenRef)
guard childrenResult == .success,
      let childrenValue = childrenRef,
      let children = childrenValue as? [AXUIElement] else {
    fputs("FAIL: missing status item\n", stderr)
    exit(1)
}

func matchesExpectedItem(_ el: AXUIElement) -> Bool {
    let title = getAttr(el, kAXTitleAttribute as String) as? String
    let desc = getAttr(el, kAXDescriptionAttribute as String) as? String
    let help = getAttr(el, kAXHelpAttribute as String) as? String
    return [title, desc, help].contains(expectedLabel)
}

let item = children.first(where: matchesExpectedItem) ?? (children.count == 1 ? children.first : nil)
guard let item else {
    fputs("FAIL: matching status item not found\n", stderr)
    exit(1)
}

let pressResult = AXUIElementPerformAction(item, kAXPressAction as CFString)
guard pressResult == .success else {
    fputs("FAIL: status item press failed\n", stderr)
    exit(1)
}
SWIFT
    then
      return 0
    fi
    sleep 0.1
  done

  return 1
}

aos_status_item_bounds_json() {
  local pid="$1"
  local expected_label="${AOS_STATUS_ITEM_LABEL:-AOS status item}"

  swift - "$pid" "$expected_label" <<'SWIFT'
import AppKit
import ApplicationServices
import Foundation

func getAttr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    guard result == .success else { return nil }
    return value
}

func pointAttr(_ el: AXUIElement, _ name: String) -> CGPoint? {
    guard let value = getAttr(el, name) else { return nil }
    var point = CGPoint.zero
    guard AXValueGetType(value as! AXValue) == .cgPoint,
          AXValueGetValue(value as! AXValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

func sizeAttr(_ el: AXUIElement, _ name: String) -> CGSize? {
    guard let value = getAttr(el, name) else { return nil }
    var size = CGSize.zero
    guard AXValueGetType(value as! AXValue) == .cgSize,
          AXValueGetValue(value as! AXValue, .cgSize, &size) else {
        return nil
    }
    return size
}

guard CommandLine.arguments.count >= 3,
      let pidValue = Int32(CommandLine.arguments[1]) else {
    fputs("FAIL: missing pid\n", stderr)
    exit(1)
}

let expectedLabel = CommandLine.arguments[2]
let app = AXUIElementCreateApplication(pidValue)
guard let extrasValue = getAttr(app, kAXExtrasMenuBarAttribute as String) else {
    fputs("FAIL: missing extras menu bar\n", stderr)
    exit(1)
}
let extras = extrasValue as! AXUIElement

var childrenRef: CFTypeRef?
let childrenResult = AXUIElementCopyAttributeValue(extras, kAXChildrenAttribute as CFString, &childrenRef)
guard childrenResult == .success,
      let childrenValue = childrenRef,
      let children = childrenValue as? [AXUIElement] else {
    fputs("FAIL: missing status item\n", stderr)
    exit(1)
}

func matchesExpectedItem(_ el: AXUIElement) -> Bool {
    let title = getAttr(el, kAXTitleAttribute as String) as? String
    let desc = getAttr(el, kAXDescriptionAttribute as String) as? String
    let help = getAttr(el, kAXHelpAttribute as String) as? String
    return [title, desc, help].contains(expectedLabel)
}

guard let item = children.first(where: matchesExpectedItem) ?? (children.count == 1 ? children.first : nil),
      let position = pointAttr(item, kAXPositionAttribute as String),
      let size = sizeAttr(item, kAXSizeAttribute as String) else {
    fputs("FAIL: matching status item bounds not found\n", stderr)
    exit(1)
}

let payload: [String: Any] = [
    "x": position.x,
    "y": position.y,
    "w": size.width,
    "h": size.height,
    "center": [
        "x": position.x + size.width / 2,
        "y": position.y + size.height / 2,
    ],
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
SWIFT
}

click_aos_status_item_real() {
  local pid="$1"
  local aos_bin="${2:-${AOS:-./aos}}"
  local bounds center

  bounds="$(aos_status_item_bounds_json "$pid")" || return 1
  center="$(python3 - "$bounds" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
center = payload["center"]
print(f"{round(center['x'])},{round(center['y'])}")
PY
)"
  "$aos_bin" do click "$center" >/dev/null
}

aos_status_item_matches_json() {
  local expected_label="${AOS_STATUS_ITEM_LABEL:-AOS status item}"

  swift - "$expected_label" <<'SWIFT'
import AppKit
import ApplicationServices
import Foundation

func getAttr(_ el: AXUIElement, _ name: String) -> AnyObject? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    guard result == .success else { return nil }
    return value
}

func pointAttr(_ el: AXUIElement, _ name: String) -> CGPoint? {
    guard let value = getAttr(el, name) else { return nil }
    var point = CGPoint.zero
    guard AXValueGetType(value as! AXValue) == .cgPoint,
          AXValueGetValue(value as! AXValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

func sizeAttr(_ el: AXUIElement, _ name: String) -> CGSize? {
    guard let value = getAttr(el, name) else { return nil }
    var size = CGSize.zero
    guard AXValueGetType(value as! AXValue) == .cgSize,
          AXValueGetValue(value as! AXValue, .cgSize, &size) else {
        return nil
    }
    return size
}

let expectedLabel = CommandLine.arguments.count >= 2 ? CommandLine.arguments[1] : "AOS status item"
var matches: [[String: Any]] = []

for appInfo in NSWorkspace.shared.runningApplications {
    let pid = appInfo.processIdentifier
    if pid <= 0 { continue }
    let app = AXUIElementCreateApplication(pid)
    guard let extrasValue = getAttr(app, kAXExtrasMenuBarAttribute as String) else { continue }
    let extras = extrasValue as! AXUIElement
    var childrenRef: CFTypeRef?
    let childrenResult = AXUIElementCopyAttributeValue(extras, kAXChildrenAttribute as CFString, &childrenRef)
    guard childrenResult == .success,
          let childrenValue = childrenRef,
          let children = childrenValue as? [AXUIElement] else {
        continue
    }

    for child in children {
        let title = getAttr(child, kAXTitleAttribute as String) as? String
        let desc = getAttr(child, kAXDescriptionAttribute as String) as? String
        let help = getAttr(child, kAXHelpAttribute as String) as? String
        if ![title, desc, help].contains(expectedLabel) { continue }
        let position = pointAttr(child, kAXPositionAttribute as String)
        let size = sizeAttr(child, kAXSizeAttribute as String)
        matches.append([
            "pid": Int(pid),
            "bundle_id": appInfo.bundleIdentifier ?? "",
            "app_name": appInfo.localizedName ?? "",
            "x": position.map { $0.x } ?? NSNull(),
            "y": position.map { $0.y } ?? NSNull(),
            "w": size.map { $0.width } ?? NSNull(),
            "h": size.map { $0.height } ?? NSNull(),
        ])
    }
}

let data = try JSONSerialization.data(withJSONObject: ["matches": matches], options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
SWIFT
}

aos_assert_status_item_overlap_bounded_json() {
  local expected_pid="${1:-}"
  local matches_json
  matches_json="$(aos_status_item_matches_json)" || return 1

  python3 - "$expected_pid" "$matches_json" <<'PY'
import json
import sys

expected_pid = int(sys.argv[1]) if sys.argv[1] else None
payload = json.loads(sys.argv[2])
matches = payload.get("matches") or []
target = next((entry for entry in matches if expected_pid is not None and entry.get("pid") == expected_pid), None)
if expected_pid is not None and target is None:
    raise SystemExit(f"FAIL: expected daemon status item pid {expected_pid} not found: {json.dumps(matches, sort_keys=True)}")

def has_rect(entry):
    return all(isinstance(entry.get(key), (int, float)) for key in ("x", "y", "w", "h"))

def overlaps(a, b):
    return (
        a["x"] < b["x"] + b["w"]
        and a["x"] + a["w"] > b["x"]
        and a["y"] < b["y"] + b["h"]
        and a["y"] + a["h"] > b["y"]
    )

overlaps_target = []
if target and has_rect(target):
    overlaps_target = [
        entry for entry in matches
        if entry.get("pid") != target.get("pid") and has_rect(entry) and overlaps(target, entry)
    ]

if overlaps_target:
    raise SystemExit(
        "FAIL: AOS status item overlap makes real-click target ambiguous: "
        + json.dumps({"target": target, "overlaps": overlaps_target, "matches": matches}, sort_keys=True)
    )

result = {
    "matches": matches,
    "targetPid": expected_pid,
    "targetFound": target is not None if expected_pid is not None else None,
    "overlapCount": len(overlaps_target),
}
print(json.dumps(result, sort_keys=True))
PY
}

aos_unambiguous_status_item_pid() {
  local expected_pid="${1:-}"
  local matches_json out last_error

  for _ in $(seq 1 30); do
    matches_json="$(aos_status_item_matches_json)" || {
      last_error="FAIL: unable to read AOS status items"
      sleep 0.1
      continue
    }

    if out="$(python3 - "$expected_pid" "$matches_json" 2>&1 <<'PY'
import json
import sys

expected_pid = int(sys.argv[1]) if sys.argv[1] else None
payload = json.loads(sys.argv[2])
matches = payload.get("matches") or []

def has_rect(entry):
    return all(isinstance(entry.get(key), (int, float)) for key in ("x", "y", "w", "h"))

def overlaps(a, b):
    return (
        a["x"] < b["x"] + b["w"]
        and a["x"] + a["w"] > b["x"]
        and a["y"] < b["y"] + b["h"]
        and a["y"] + a["h"] > b["y"]
    )

target = next((entry for entry in matches if expected_pid is not None and entry.get("pid") == expected_pid), None)
if target is None and expected_pid is not None:
    raise SystemExit(f"FAIL: expected daemon status item pid {expected_pid} not found: {json.dumps(matches, sort_keys=True)}")
if target is None and len(matches) == 1:
    target = matches[0]

if target is None:
    raise SystemExit(f"FAIL: unable to choose unambiguous AOS status item: {json.dumps(matches, sort_keys=True)}")
if not has_rect(target):
    raise SystemExit(f"FAIL: chosen AOS status item is missing bounds: {json.dumps(target, sort_keys=True)}")

overlaps_target = [
    entry for entry in matches
    if entry.get("pid") != target.get("pid") and has_rect(entry) and overlaps(target, entry)
]
if overlaps_target:
    raise SystemExit(
        "FAIL: AOS status item overlap makes real-click target ambiguous: "
        + json.dumps({"target": target, "overlaps": overlaps_target, "matches": matches}, sort_keys=True)
    )

print(target.get("pid"))
PY
    )"; then
      printf '%s\n' "$out"
      return 0
    fi
    last_error="$out"
    sleep 0.1
  done

  printf '%s\n' "${last_error:-FAIL: unable to choose unambiguous AOS status item}" >&2
  return 1
}
