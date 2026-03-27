// hand-off — Multi-backend macOS actuator CLI
// Pure Swift, zero dependencies. Requires Accessibility permission.
//
// Backend dispatch is input-driven:
//   Element identity (pid + role + title) → AX backend
//   Coordinates                           → CGEvent backend
//   App verb                              → AppleScript backend

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - JSON Output Models

struct SuccessResponse: Encodable {
    let status: String
    let action: String
    let backend: String
    let target: TargetInfo
    var detail: String?
}

struct TargetInfo: Encodable {
    var pid: Int?
    var role: String?
    var title: String?
    var index: Int?
    var x: Double?
    var y: Double?
    var x2: Double?
    var y2: Double?
    var app: String?
    var script: String?
    var window_id: Int?
    var width: Double?
    var height: Double?
    var text: String?
    var keys: String?
}

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func exitError(_ message: String, code: String) -> Never {
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(s.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

func printSuccess(_ response: SuccessResponse) {
    print(jsonString(response))
}

// MARK: - AX Helpers

private func axString(_ element: AXUIElement, _ attr: String) -> String? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else { return nil }
    return ref as? String
}

private func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &ref) == .success,
          let children = ref as? [AXUIElement] else { return [] }
    return children
}

/// Walk the AX tree of an app to find an element matching role + optional title + optional index.
/// Returns the first match in a breadth-first traversal.
private func findElement(pid: pid_t, role: String, title: String?, index: Int?) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var queue: [AXUIElement] = [app]
    var matches: [AXUIElement] = []

    while !queue.isEmpty {
        let current = queue.removeFirst()
        let currentRole = axString(current, kAXRoleAttribute) ?? ""

        if currentRole == role {
            if let title = title {
                let currentTitle = axString(current, kAXTitleAttribute) ?? ""
                let currentDesc = axString(current, kAXDescriptionAttribute) ?? ""
                if currentTitle == title || currentDesc == title {
                    matches.append(current)
                }
            } else {
                matches.append(current)
            }
        }

        // If we have enough matches for the requested index, stop early
        if let idx = index, matches.count > idx { break }
        if index == nil && !matches.isEmpty && title != nil { break }

        queue.append(contentsOf: axChildren(current))
    }

    if let idx = index {
        return idx < matches.count ? matches[idx] : nil
    }
    return matches.first
}

/// Find a specific window by window ID for an app, or the first window if no ID given.
private func findWindow(pid: pid_t, windowID: Int?) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success,
          let windows = ref as? [AXUIElement] else { return nil }

    if let targetID = windowID {
        // Match by window ID (AX doesn't expose CGWindowID directly, but we can compare titles/positions)
        // For now, use index-based matching or first window
        for win in windows {
            // Try to get the window's CGWindowID via the undocumented but widely-used _AXUIElementGetWindow
            var winID: CGWindowID = 0
            if _AXUIElementGetWindow(win, &winID) == .success && Int(winID) == targetID {
                return win
            }
        }
        return nil
    }
    return windows.first
}

// Undocumented but stable API to get CGWindowID from AXUIElement
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ windowID: UnsafeMutablePointer<CGWindowID>) -> AXError

// MARK: - Argument Parsing Helpers

func getArg(_ args: [String], _ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

func hasFlag(_ args: [String], _ flag: String) -> Bool {
    args.contains(flag)
}

func parseInt(_ s: String?) -> Int? {
    guard let s = s else { return nil }
    return Int(s)
}

func parseCoords(_ s: String) -> (Double, Double)? {
    let parts = s.split(separator: ",").map(String.init)
    guard parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) else { return nil }
    return (x, y)
}

// MARK: - Modifier Key Parsing

func parseKeyCombo(_ combo: String) -> (CGKeyCode, CGEventFlags)? {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var keyName: String?

    for part in parts {
        switch part {
        case "cmd", "command":
            flags.insert(.maskCommand)
        case "shift":
            flags.insert(.maskShift)
        case "alt", "option", "opt":
            flags.insert(.maskAlternate)
        case "ctrl", "control":
            flags.insert(.maskControl)
        case "fn":
            flags.insert(.maskSecondaryFn)
        default:
            keyName = part
        }
    }

    guard let key = keyName, let keyCode = keyCodeForName(key) else { return nil }
    return (keyCode, flags)
}

func keyCodeForName(_ name: String) -> CGKeyCode? {
    let map: [String: CGKeyCode] = [
        // Letters
        "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E,
        "f": 0x03, "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26,
        "k": 0x28, "l": 0x25, "m": 0x2E, "n": 0x2D, "o": 0x1F,
        "p": 0x23, "q": 0x0C, "r": 0x0F, "s": 0x01, "t": 0x11,
        "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07, "y": 0x10,
        "z": 0x06,
        // Numbers
        "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
        "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
        // Special keys
        "return": 0x24, "enter": 0x24, "tab": 0x30, "space": 0x31,
        "delete": 0x33, "backspace": 0x33, "escape": 0x35, "esc": 0x35,
        "up": 0x7E, "down": 0x7D, "left": 0x7B, "right": 0x7C,
        "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
        "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
        "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
        // Punctuation
        "-": 0x1B, "=": 0x18, "[": 0x21, "]": 0x1E,
        "\\": 0x2A, ";": 0x29, "'": 0x27, ",": 0x2B,
        ".": 0x2F, "/": 0x2C, "`": 0x32,
    ]
    return map[name]
}

// MARK: - CGEvent Helpers

func postClick(at point: CGPoint, button: CGMouseButton = .left, clickCount: Int = 1) {
    let downType: CGEventType = button == .left ? .leftMouseDown : .rightMouseDown
    let upType: CGEventType = button == .left ? .leftMouseUp : .rightMouseUp

    for i in 0..<clickCount {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: downType,
                                  mouseCursorPosition: point, mouseButton: button),
              let up = CGEvent(mouseEventSource: nil, mouseType: upType,
                                mouseCursorPosition: point, mouseButton: button) else {
            exitError("Failed to create mouse event.", code: "CGEVENT_FAILED")
        }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        down.flags = []  // Clear inherited modifiers
        up.flags = []
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        if i < clickCount - 1 {
            usleep(30_000)  // 30ms between multi-clicks
        }
    }
}

func postKeyEvent(keyCode: CGKeyCode, flags: CGEventFlags) {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
        exitError("Failed to create keyboard event.", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func postTypeString(_ text: String) {
    for char in text.utf16 {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            exitError("Failed to create keyboard event.", code: "CGEVENT_FAILED")
        }
        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: [char])
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: [char])
        down.flags = []
        up.flags = []
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        usleep(5_000)  // 5ms between characters
    }
}

// MARK: - Commands

// -- press: AX backend --
func pressCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    guard let role = getArg(args, "--role") else {
        exitError("--role is required.", code: "MISSING_ARG")
    }
    let title = getArg(args, "--title")
    let index = parseInt(getArg(args, "--index"))

    let target = TargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "press", backend: "ax", target: target,
                                      detail: "Would AXPerformAction(AXPress) on matching element."))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let element = findElement(pid: pid_t(pid), role: role, title: title, index: index) else {
        exitError("Element not found: role=\(role)\(title.map { " title=\($0)" } ?? "")\(index.map { " index=\($0)" } ?? "").",
                  code: "ELEMENT_NOT_FOUND")
    }

    let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
    guard result == .success else {
        exitError("AXPerformAction(AXPress) failed with code \(result.rawValue).", code: "AX_ACTION_FAILED")
    }

    printSuccess(SuccessResponse(status: "success", action: "press", backend: "ax", target: target))
}

// -- set-value: AX backend --
func setValueCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    guard let role = getArg(args, "--role") else {
        exitError("--role is required.", code: "MISSING_ARG")
    }
    guard let value = getArg(args, "--value") else {
        exitError("--value is required.", code: "MISSING_ARG")
    }
    let title = getArg(args, "--title")
    let index = parseInt(getArg(args, "--index"))

    let target = TargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "set-value", backend: "ax", target: target,
                                      detail: "Would set AXValue to: \(value)"))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let element = findElement(pid: pid_t(pid), role: role, title: title, index: index) else {
        exitError("Element not found.", code: "ELEMENT_NOT_FOUND")
    }

    // Check if value is settable
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue else {
        exitError("AXValue is not settable on this element.", code: "AX_NOT_SETTABLE")
    }

    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
    guard result == .success else {
        exitError("AXUIElementSetAttributeValue failed with code \(result.rawValue).", code: "AX_ACTION_FAILED")
    }

    printSuccess(SuccessResponse(status: "success", action: "set-value", backend: "ax", target: target))
}

// -- focus: AX backend --
func focusCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    guard let role = getArg(args, "--role") else {
        exitError("--role is required.", code: "MISSING_ARG")
    }
    let title = getArg(args, "--title")
    let index = parseInt(getArg(args, "--index"))

    let target = TargetInfo(pid: pid, role: role, title: title, index: index)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "focus", backend: "ax", target: target,
                                      detail: "Would set AXFocused=true on matching element."))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let element = findElement(pid: pid_t(pid), role: role, title: title, index: index) else {
        exitError("Element not found.", code: "ELEMENT_NOT_FOUND")
    }

    let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
    guard result == .success else {
        exitError("Failed to set focus.", code: "AX_ACTION_FAILED")
    }

    printSuccess(SuccessResponse(status: "success", action: "focus", backend: "ax", target: target))
}

// -- click: CGEvent backend --
func clickCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")

    // First positional arg after "click" is the coordinate
    guard let coordStr = args.first, let (x, y) = parseCoords(coordStr) else {
        exitError("Coordinates required: hand-off click <x>,<y>", code: "MISSING_ARG")
    }

    let target = TargetInfo(x: x, y: y)
    let button: CGMouseButton = isRight ? .right : .left
    let clickCount = isDouble ? 2 : 1

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "click", backend: "cgevent", target: target,
                                      detail: "\(isRight ? "Right" : "Left") click\(isDouble ? " (double)" : "") at (\(x), \(y))."))
        return
    }

    postClick(at: CGPoint(x: x, y: y), button: button, clickCount: clickCount)
    printSuccess(SuccessResponse(status: "success", action: "click", backend: "cgevent", target: target))
}

// -- drag: CGEvent backend --
func dragCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    // Two positional args: start and end coordinates
    let positional = args.filter { !$0.hasPrefix("--") }
    guard positional.count >= 2,
          let (x1, y1) = parseCoords(positional[0]),
          let (x2, y2) = parseCoords(positional[1]) else {
        exitError("Two coordinate pairs required: hand-off drag <x1>,<y1> <x2>,<y2>", code: "MISSING_ARG")
    }

    let target = TargetInfo(x: x1, y: y1, x2: x2, y2: y2)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "drag", backend: "cgevent", target: target,
                                      detail: "Drag from (\(x1),\(y1)) to (\(x2),\(y2))."))
        return
    }

    let start = CGPoint(x: x1, y: y1)
    let end = CGPoint(x: x2, y: y2)

    // Mouse down at start
    guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                              mouseCursorPosition: start, mouseButton: .left) else {
        exitError("Failed to create mouse event.", code: "CGEVENT_FAILED")
    }
    down.flags = []
    down.post(tap: .cghidEventTap)
    usleep(50_000)  // 50ms hold before drag

    // Drag in steps for smoothness
    let steps = 20
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let cx = x1 + (x2 - x1) * t
        let cy = y1 + (y2 - y1) * t
        guard let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                                  mouseCursorPosition: CGPoint(x: cx, y: cy), mouseButton: .left) else { continue }
        drag.flags = []
        drag.post(tap: .cghidEventTap)
        usleep(10_000)  // 10ms between steps
    }

    // Mouse up at end
    guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                            mouseCursorPosition: end, mouseButton: .left) else {
        exitError("Failed to create mouse event.", code: "CGEVENT_FAILED")
    }
    up.flags = []
    up.post(tap: .cghidEventTap)

    printSuccess(SuccessResponse(status: "success", action: "drag", backend: "cgevent", target: target))
}

// -- scroll: CGEvent backend --
func scrollCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let coordStr = positional.first, let (x, y) = parseCoords(coordStr) else {
        exitError("Coordinates required: hand-off scroll <x>,<y> --dy <pixels>", code: "MISSING_ARG")
    }
    guard let dyStr = getArg(args, "--dy"), let dy = Int32(dyStr) else {
        exitError("--dy is required (scroll amount in pixels, negative = down).", code: "MISSING_ARG")
    }

    let target = TargetInfo(x: x, y: y)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "scroll", backend: "cgevent", target: target,
                                      detail: "Scroll \(dy) at (\(x),\(y))."))
        return
    }

    // Move cursor to position first
    if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                           mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) {
        move.post(tap: .cghidEventTap)
        usleep(10_000)
    }

    // Post scroll event
    guard let scroll = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                                wheel1: dy, wheel2: 0, wheel3: 0) else {
        exitError("Failed to create scroll event.", code: "CGEVENT_FAILED")
    }
    scroll.post(tap: .cghidEventTap)

    printSuccess(SuccessResponse(status: "success", action: "scroll", backend: "cgevent", target: target))
}

// -- type: CGEvent backend --
func typeCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let text = positional.first else {
        exitError("Text required: hand-off type \"hello world\"", code: "MISSING_ARG")
    }

    let target = TargetInfo(text: text)

    if dryRun {
        let preview = text.count > 50 ? String(text.prefix(50)) + "..." : text
        printSuccess(SuccessResponse(status: "dry_run", action: "type", backend: "cgevent", target: target,
                                      detail: "Would type: \(preview)"))
        return
    }

    postTypeString(text)
    printSuccess(SuccessResponse(status: "success", action: "type", backend: "cgevent", target: target))
}

// -- key: CGEvent backend --
func keyCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    let positional = args.filter { !$0.hasPrefix("--") }
    guard let combo = positional.first else {
        exitError("Key combo required: hand-off key cmd+s", code: "MISSING_ARG")
    }

    let target = TargetInfo(keys: combo)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "key", backend: "cgevent", target: target,
                                      detail: "Would press: \(combo)"))
        return
    }

    guard let (keyCode, flags) = parseKeyCombo(combo) else {
        exitError("Unknown key combo: \(combo). Format: modifier+key (e.g., cmd+s, ctrl+shift+a).", code: "INVALID_KEY")
    }

    postKeyEvent(keyCode: keyCode, flags: flags)
    printSuccess(SuccessResponse(status: "success", action: "key", backend: "cgevent", target: target))
}

// -- raise: AX backend --
func raiseCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = TargetInfo(pid: pid, window_id: windowID)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "raise", backend: "ax", target: target,
                                      detail: "Would raise window to front."))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    // Activate the application
    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
        app.activate()
    }

    // Raise the specific window
    if let window = findWindow(pid: pid_t(pid), windowID: windowID) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }

    printSuccess(SuccessResponse(status: "success", action: "raise", backend: "ax", target: target))
}

// -- move: AX backend --
func moveCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let (x, y) = parseCoords(toStr) else {
        exitError("--to <x>,<y> is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = TargetInfo(pid: pid, x: x, y: y, window_id: windowID)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "move", backend: "ax", target: target,
                                      detail: "Would move window to (\(x),\(y))."))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let window = findWindow(pid: pid_t(pid), windowID: windowID) else {
        exitError("Window not found.", code: "WINDOW_NOT_FOUND")
    }

    var point = CGPoint(x: x, y: y)
    let axValue = AXValueCreate(.cgPoint, &point)!
    let result = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, axValue)
    guard result == .success else {
        exitError("Failed to move window (AX error \(result.rawValue)).", code: "AX_ACTION_FAILED")
    }

    printSuccess(SuccessResponse(status: "success", action: "move", backend: "ax", target: target))
}

// -- resize: AX backend --
func resizeCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    guard let pidStr = getArg(args, "--pid"), let pid = Int(pidStr) else {
        exitError("--pid is required.", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let (w, h) = parseCoords(toStr) else {
        exitError("--to <width>,<height> is required.", code: "MISSING_ARG")
    }
    let windowID = parseInt(getArg(args, "--window"))

    let target = TargetInfo(pid: pid, window_id: windowID, width: w, height: h)

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "resize", backend: "ax", target: target,
                                      detail: "Would resize window to \(w)x\(h)."))
        return
    }

    guard AXIsProcessTrusted() else {
        exitError("Accessibility permission required.", code: "PERMISSION_DENIED")
    }

    guard let window = findWindow(pid: pid_t(pid), windowID: windowID) else {
        exitError("Window not found.", code: "WINDOW_NOT_FOUND")
    }

    var size = CGSize(width: w, height: h)
    let axValue = AXValueCreate(.cgSize, &size)!
    let result = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, axValue)
    guard result == .success else {
        exitError("Failed to resize window (AX error \(result.rawValue)).", code: "AX_ACTION_FAILED")
    }

    printSuccess(SuccessResponse(status: "success", action: "resize", backend: "ax", target: target))
}

// -- tell: AppleScript backend --
func tellCommand(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    // args: [<app>, <script-body...>]
    let positional = args.filter { !$0.hasPrefix("--") }
    guard positional.count >= 2 else {
        exitError("Usage: hand-off tell <app> <script-body>", code: "MISSING_ARG")
    }
    let appName = positional[0]
    let scriptBody = positional.dropFirst().joined(separator: " ")

    let target = TargetInfo(app: appName, script: scriptBody)

    let fullScript = "tell application \"\(appName)\" to \(scriptBody)"

    if dryRun {
        printSuccess(SuccessResponse(status: "dry_run", action: "tell", backend: "applescript", target: target,
                                      detail: "Would execute: \(fullScript)"))
        return
    }

    let appleScript = NSAppleScript(source: fullScript)
    var errorInfo: NSDictionary?
    let result = appleScript?.executeAndReturnError(&errorInfo)

    if let error = errorInfo {
        let message = error[NSAppleScript.errorMessage] as? String ?? "AppleScript execution failed."
        exitError(message, code: "APPLESCRIPT_FAILED")
    }

    var response = SuccessResponse(status: "success", action: "tell", backend: "applescript", target: target)
    if let resultStr = result?.stringValue, !resultStr.isEmpty {
        response.detail = resultStr
    }
    printSuccess(response)
}

// MARK: - Help

func printUsage() {
    print("""
    hand-off — Multi-backend macOS actuator CLI  (v1.0)

    USAGE
      hand-off press --pid <pid> --role <role> [options]    Press a UI element (AX)
      hand-off set-value --pid <pid> --role <role> --value  Set element value (AX)
      hand-off focus --pid <pid> --role <role> [options]    Focus a UI element (AX)
      hand-off click <x>,<y> [--right] [--double]          Click at coordinates (CGEvent)
      hand-off drag <x1>,<y1> <x2>,<y2>                    Drag between points (CGEvent)
      hand-off scroll <x>,<y> --dy <pixels>                Scroll at position (CGEvent)
      hand-off type "text"                                  Type text (CGEvent)
      hand-off key <combo>                                  Key combo, e.g. cmd+s (CGEvent)
      hand-off raise --pid <pid> [--window <id>]            Raise window (AX)
      hand-off move --pid <pid> --to <x>,<y>               Move window (AX)
      hand-off resize --pid <pid> --to <w>,<h>             Resize window (AX)
      hand-off tell <app> <script>                          AppleScript verb

    ELEMENT TARGETING (AX commands)
      --pid <pid>         Target process ID (required)
      --role <role>       AX role, e.g. AXButton, AXTextField (required for press/set-value/focus)
      --title <title>     Match element title or description
      --index <n>         0-based index among matching elements

    COORDINATES
      All coordinates are global CG points (matching side-eye topology output).
      Format: <x>,<y> (no spaces).

    KEY COMBOS
      Format: modifier+key. Modifiers: cmd, shift, alt/option, ctrl, fn.
      Examples: cmd+s, ctrl+shift+a, cmd+shift+4, escape, return, tab

    SAFETY
      --dry-run           Show what would happen without doing it

    JSON OUTPUT
      Success:  {"status":"success", "action":"...", "backend":"...", "target":{...}}
      Failure:  exit 1, stderr: {"error":"...", "code":"..."}

    BACKENDS
      AX (ApplicationServices)   — Semantic actions via Accessibility API. No coordinates needed.
      CGEvent (CoreGraphics)     — Physical input simulation. Needs global coordinates.
      AppleScript (Foundation)   — App-specific verbs for scriptable apps.

      Backend selection is automatic based on the command. The caller never chooses a backend.
    """)
}

// MARK: - Main Dispatch

@available(macOS 14.0, *)
struct HandOff {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())

        guard !args.isEmpty else {
            printUsage()
            exit(0)
        }

        let command = args[0]
        let commandArgs = Array(args.dropFirst())

        switch command {
        // AX backend
        case "press":
            pressCommand(args: commandArgs)
        case "set-value":
            setValueCommand(args: commandArgs)
        case "focus":
            focusCommand(args: commandArgs)
        case "raise":
            raiseCommand(args: commandArgs)
        case "move":
            moveCommand(args: commandArgs)
        case "resize":
            resizeCommand(args: commandArgs)

        // CGEvent backend
        case "click":
            clickCommand(args: commandArgs)
        case "drag":
            dragCommand(args: commandArgs)
        case "scroll":
            scrollCommand(args: commandArgs)
        case "type":
            typeCommand(args: commandArgs)
        case "key":
            keyCommand(args: commandArgs)

        // AppleScript backend
        case "tell":
            tellCommand(args: commandArgs)

        // Help
        case "help", "--help", "-h":
            printUsage()

        default:
            exitError("Unknown command: \(command). Run 'hand-off help' for usage.", code: "UNKNOWN_COMMAND")
        }

        exit(0)
    }
}

// Entry point — @main would conflict with -parse-as-library, so use top-level via @_cdecl
@_cdecl("main")
func entryPoint(_ argc: Int32, _ argv: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32 {
    if #available(macOS 14.0, *) {
        HandOff.main()
    } else {
        exitError("hand-off requires macOS 14.0 or later.", code: "UNSUPPORTED_OS")
    }
    return 0
}
