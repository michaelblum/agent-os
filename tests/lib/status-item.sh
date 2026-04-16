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
