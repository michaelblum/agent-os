// native-menu.swift — Native AX menu traversal for `aos do menu`.

import AppKit
import ApplicationServices
import Foundation

private func parseMenuPath(_ raw: String?) -> [String] {
    guard let raw else {
        exitError("menu requires --path File,Item", code: "MISSING_ARG")
    }
    let segments = raw
        .split(separator: ",", omittingEmptySubsequences: false)
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    guard segments.count >= 2, !segments.contains(where: { $0.isEmpty }) else {
        exitError("menu --path requires at least two comma-separated segments", code: "INVALID_ARG")
    }
    return segments
}

private func axAttributeElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
          let found = value else {
        return nil
    }
    return (found as! AXUIElement)
}

private func menuTraversalChildren(_ element: AXUIElement) -> [AXUIElement] {
    let children = axChildren(element)
    var expanded: [AXUIElement] = []
    for child in children {
        if axString(child, kAXRoleAttribute) == "AXMenu" {
            expanded.append(contentsOf: axChildren(child))
        } else {
            expanded.append(child)
        }
    }
    return expanded
}

private func resolveMenuPath(pid: Int, segments: [String]) -> AXUIElement {
    let appElement = AXUIElementCreateApplication(pid_t(pid))
    guard let menuBar = axAttributeElement(appElement, kAXMenuBarAttribute as String) else {
        exitError("No AX menu bar found for pid \(pid)", code: "MENU_BAR_NOT_FOUND")
    }

    var scope = axChildren(menuBar)
    var current: AXUIElement?
    var traversed: [String] = []
    for segment in segments {
        let matches = scope.filter { axString($0, kAXTitleAttribute) == segment }
        if matches.isEmpty {
            let prefix = traversed.isEmpty ? "" : " under \(traversed.joined(separator: ","))"
            exitError("Menu item '\(segment)' not found\(prefix)", code: "MENU_ITEM_NOT_FOUND")
        }
        if matches.count > 1 {
            let prefix = traversed.isEmpty ? "" : " under \(traversed.joined(separator: ","))"
            exitError("Menu item '\(segment)' is ambiguous\(prefix)", code: "MENU_ITEM_AMBIGUOUS")
        }
        current = matches[0]
        traversed.append(segment)
        scope = menuTraversalChildren(matches[0])
    }

    guard let leaf = current else {
        exitError("Menu path is empty", code: "INVALID_ARG")
    }
    guard axBool(leaf, kAXEnabledAttribute as String) != false else {
        exitError("Menu item '\(segments.joined(separator: ","))' is disabled", code: "MENU_ITEM_DISABLED")
    }
    guard axActions(leaf).contains(kAXPressAction as String) else {
        exitError("Menu item '\(segments.joined(separator: ","))' does not expose AXPress", code: "AX_ACTION_UNAVAILABLE")
    }
    return leaf
}

/// `aos do menu` — invoke an exact app menu path by process id.
func cliMenu(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("menu requires --pid", code: "MISSING_ARG")
    }
    guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
        exitError("No running application found for pid \(pid)", code: "APP_NOT_FOUND")
    }
    let segments = parseMenuPath(getArg(args, "--path"))
    let leaf = resolveMenuPath(pid: pid, segments: segments)

    var target = LegacyTargetInfo(pid: pid)
    target.app = app.localizedName
    target.role = "AXMenuItem"
    target.title = segments.last
    target.text = segments.joined(separator: ",")

    if dryRun {
        cliPrintLegacy(action: "menu", backend: "ax", target: target, detail: "path=\(segments.joined(separator: ",")) prerequisite=ok", dryRun: true)
        return
    }

    let result = AXUIElementPerformAction(leaf, kAXPressAction as CFString)
    guard result == .success else {
        exitError("Failed to press menu item '\(segments.joined(separator: ","))' (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
    }
    cliPrintLegacy(action: "menu", backend: "ax", target: target, dryRun: false)
}
