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
