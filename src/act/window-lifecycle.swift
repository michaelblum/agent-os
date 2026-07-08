// window-lifecycle.swift — Exact AX window lifecycle controls for `aos do`.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let windowLifecycleConfirmationTimeout: TimeInterval = 0.8
private let windowLifecycleConfirmationPollMicros: useconds_t = 50_000

private func windowLifecycleScreenIndexByDisplayNumber() -> [CGDirectDisplayID: NSScreen] {
    var map: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            map[CGDirectDisplayID(num.uint32Value)] = screen
        }
    }
    return map
}

private func visibleDisplayBounds(
    for id: CGDirectDisplayID,
    fallback: CGRect,
    screens: [CGDirectDisplayID: NSScreen]
) -> CGRect {
    guard let screen = screens[id] else { return fallback }
    let visibleBottomLeft = screen.visibleFrame
    let fullBottomLeft = screen.frame
    let topInset = fullBottomLeft.maxY - visibleBottomLeft.maxY
    let leftInset = visibleBottomLeft.minX - fullBottomLeft.minX
    return CGRect(
        x: fallback.origin.x + leftInset,
        y: fallback.origin.y + topInset,
        width: visibleBottomLeft.width,
        height: visibleBottomLeft.height
    )
}

private func firstDisplayWorkArea(containing frame: CGRect) -> CGRect? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return nil }

    let center = CGPoint(x: frame.midX, y: frame.midY)
    let screens = windowLifecycleScreenIndexByDisplayNumber()
    let displayID = displays.first { CGDisplayBounds($0).contains(center) } ?? displays.first
    guard let displayID else { return nil }
    let fallback = CGDisplayBounds(displayID)
    return visibleDisplayBounds(for: displayID, fallback: fallback, screens: screens)
}

private func setWindowFrame(_ window: AXUIElement, frame: CGRect) -> AXError {
    var point = frame.origin
    guard let pointValue = AXValueCreate(.cgPoint, &point) else { return .failure }
    let positionResult = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue)
    guard positionResult == .success else { return positionResult }

    var size = frame.size
    guard let sizeValue = AXValueCreate(.cgSize, &size) else { return .failure }
    return AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
}

private func setWindowMinimized(_ window: AXUIElement, minimized: Bool) -> AXError {
    var settable = DarwinBoolean(false)
    let settableResult = AXUIElementIsAttributeSettable(window, kAXMinimizedAttribute as CFString, &settable)
    guard settableResult == .success, settable.boolValue else { return settableResult == .success ? .notImplemented : settableResult }
    return AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, minimized as CFTypeRef)
}

private func requireWindowAttributeSettable(_ window: AXUIElement, attribute: String, action: String) {
    var settable = DarwinBoolean(false)
    let result = AXUIElementIsAttributeSettable(window, attribute as CFString, &settable)
    guard result == .success else {
        exitError("Cannot inspect window \(action) support (AX error \(result.rawValue))", code: "AX_ACTION_UNAVAILABLE")
    }
    guard settable.boolValue else {
        exitError("Window does not support \(action)", code: "AX_ACTION_UNAVAILABLE")
    }
}

private func requireWindowFrameSettable(_ window: AXUIElement, action: String) {
    requireWindowAttributeSettable(window, attribute: kAXPositionAttribute as String, action: "\(action) position")
    requireWindowAttributeSettable(window, attribute: kAXSizeAttribute as String, action: "\(action) size")
}

private func requireWindowButtonPress(_ window: AXUIElement, attribute: String, action: String) -> AXUIElement {
    var value: AnyObject?
    let copyResult = AXUIElementCopyAttributeValue(window, attribute as CFString, &value)
    guard copyResult == .success, let button = value else {
        exitError("Window \(action) button is unavailable (AX error \(copyResult.rawValue))", code: "AX_ACTION_UNAVAILABLE")
    }
    let buttonElement = button as! AXUIElement
    if axBool(buttonElement, kAXEnabledAttribute as String) == false {
        exitError("Window \(action) button is disabled", code: "AX_ACTION_UNAVAILABLE")
    }
    guard axActions(buttonElement).contains(kAXPressAction as String) else {
        exitError("Window \(action) button does not expose AXPress", code: "AX_ACTION_UNAVAILABLE")
    }
    return buttonElement
}

private func windowFrameApproximatelyEquals(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    abs(lhs.origin.x - rhs.origin.x) <= 2
        && abs(lhs.origin.y - rhs.origin.y) <= 2
        && abs(lhs.size.width - rhs.size.width) <= 2
        && abs(lhs.size.height - rhs.size.height) <= 2
}

private func cgWindowBounds(windowID: Int) -> CGRect? {
    guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
          let info = infoList.first,
          let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
          let x = boundsDict["X"] as? Double,
          let y = boundsDict["Y"] as? Double,
          let width = boundsDict["Width"] as? Double,
          let height = boundsDict["Height"] as? Double else { return nil }
    return CGRect(x: x, y: y, width: width, height: height)
}

private func windowFrameLooksLikeStageManagerThumbnail(_ candidate: CGRect, original: CGRect) -> Bool {
    guard original.width > 0, original.height > 0 else { return false }
    let candidateArea = candidate.width * candidate.height
    let originalArea = original.width * original.height
    return candidateArea <= originalArea * 0.12
        && candidate.width <= original.width * 0.5
        && candidate.height <= original.height * 0.5
}

private func windowIsStageManagerThumbnail(windowID: Int, axFrame: CGRect?) -> Bool {
    guard let axFrame,
          let cgFrame = cgWindowBounds(windowID: windowID),
          !windowFrameApproximatelyEquals(cgFrame, axFrame) else {
        return false
    }
    return windowFrameLooksLikeStageManagerThumbnail(cgFrame, original: axFrame)
}

private func raiseWindow(pid: Int, windowID: Int) {
    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
        app.activate(options: [.activateAllWindows])
    }
    if let window = findWindowByID(pid: pid_t(pid), windowID: windowID) {
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }
}

private func waitForWindowMinimizedState(pid: Int, windowID: Int, expected: Bool) -> Bool {
    let deadline = Date().addingTimeInterval(windowLifecycleConfirmationTimeout)
    while true {
        if let window = findWindowByID(pid: pid_t(pid), windowID: windowID),
           axBool(window, kAXMinimizedAttribute as String) == expected {
            return true
        }
        if Date() >= deadline { return false }
        usleep(windowLifecycleConfirmationPollMicros)
    }
}

private func waitForWindowMinimizeConfirmation(pid: Int, windowID: Int, originalFrame: CGRect?) -> Bool {
    let deadline = Date().addingTimeInterval(windowLifecycleConfirmationTimeout)
    while true {
        if let window = findWindowByID(pid: pid_t(pid), windowID: windowID),
           axBool(window, kAXMinimizedAttribute as String) == true {
            return true
        }
        if let originalFrame,
           let cgFrame = cgWindowBounds(windowID: windowID),
           windowFrameLooksLikeStageManagerThumbnail(cgFrame, original: originalFrame) {
            return true
        }
        if Date() >= deadline { return false }
        usleep(windowLifecycleConfirmationPollMicros)
    }
}

private func waitForWindowFrame(
    pid: Int,
    windowID: Int,
    matching predicate: (CGRect) -> Bool
) -> CGRect? {
    let deadline = Date().addingTimeInterval(windowLifecycleConfirmationTimeout)
    while true {
        if let window = findWindowByID(pid: pid_t(pid), windowID: windowID),
           let frame = axBounds(window),
           predicate(frame) {
            if let cgFrame = cgWindowBounds(windowID: windowID) {
                if predicate(cgFrame) {
                    return cgFrame
                }
            } else {
                return frame
            }
        }
        if Date() >= deadline { return nil }
        usleep(windowLifecycleConfirmationPollMicros)
    }
}

private func validateWindowLifecyclePrerequisites(
    action: String,
    resolved: (pid: Int, windowID: Int, window: AXUIElement, target: LegacyTargetInfo),
    minimized: Bool?
) {
    switch action {
    case "close":
        _ = requireWindowButtonPress(resolved.window, attribute: kAXCloseButtonAttribute as String, action: "close")
    case "minimize":
        requireWindowAttributeSettable(resolved.window, attribute: kAXMinimizedAttribute as String, action: "minimize")
    case "maximize":
        if minimized == true {
            exitError("Cannot maximize minimized window \(resolved.windowID); restore it first", code: "WINDOW_MINIMIZED")
        }
        guard let current = axBounds(resolved.window) else {
            exitError("Cannot read current window frame", code: "WINDOW_FRAME_UNAVAILABLE")
        }
        guard firstDisplayWorkArea(containing: current) != nil else {
            exitError("Cannot resolve display work area for window \(resolved.windowID)", code: "DISPLAY_NOT_FOUND")
        }
        requireWindowFrameSettable(resolved.window, action: "maximize")
    case "restore":
        guard let minimized else {
            exitError("Cannot read minimized state for window \(resolved.windowID)", code: "WINDOW_STATE_UNAVAILABLE")
        }
        if minimized {
            requireWindowAttributeSettable(resolved.window, attribute: kAXMinimizedAttribute as String, action: "restore")
        } else {
            let currentFrame = axBounds(resolved.window)
            guard windowIsStageManagerThumbnail(windowID: resolved.windowID, axFrame: currentFrame)
                    || loadWindowFrame(pid: resolved.pid, windowID: resolved.windowID) != nil else {
                exitError("No saved maximize frame for window \(resolved.windowID)", code: "WINDOW_RESTORE_STATE_NOT_FOUND")
            }
            requireWindowFrameSettable(resolved.window, action: "restore")
        }
    default:
        exitError("Unknown window lifecycle action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func resolveExactWindow(args: [String], action: String) -> (pid: Int, windowID: Int, window: AXUIElement, target: LegacyTargetInfo) {
    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("\(action) requires --pid", code: "MISSING_ARG")
    }
    guard let windowID = parseInt(getArg(args, "--window")) else {
        exitError("\(action) requires --window", code: "MISSING_ARG")
    }
    guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
        exitError("No running application found for pid \(pid)", code: "APP_NOT_FOUND")
    }
    guard let window = findWindowByID(pid: pid_t(pid), windowID: windowID) else {
        exitError("No window \(windowID) found for pid \(pid)", code: "WINDOW_NOT_FOUND")
    }

    var target = LegacyTargetInfo(pid: pid)
    target.window_id = windowID
    target.app = app.localizedName
    if let frame = axBounds(window) {
        target.x = Double(frame.origin.x)
        target.y = Double(frame.origin.y)
        target.width = Double(frame.size.width)
        target.height = Double(frame.size.height)
    }
    return (pid, windowID, window, target)
}

/// `aos do close|minimize|maximize|restore` — exact window lifecycle controls.
func cliWindowLifecycle(action: String, args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let resolved = resolveExactWindow(args: args, action: action)
    let minimized = axBool(resolved.window, kAXMinimizedAttribute as String)
    validateWindowLifecyclePrerequisites(action: action, resolved: resolved, minimized: minimized)

    if dryRun {
        let onCurrentSpace = nativeAXWindowOnCurrentSpace(windowID: resolved.windowID)
        let space = onCurrentSpace.map { $0 ? "visible_current_space" : "not_visible_current_space" } ?? "unknown_space"
        let detail = "minimized=\(minimized.map(String.init) ?? "unknown") \(space) prerequisite=ok"
        cliPrintLegacy(action: action, backend: "ax", target: resolved.target, detail: detail, dryRun: true)
        return
    }

    switch action {
    case "close":
        let closeButton = requireWindowButtonPress(resolved.window, attribute: kAXCloseButtonAttribute as String, action: "close")
        let result = AXUIElementPerformAction(closeButton, kAXPressAction as CFString)
        guard result == .success else {
            exitError("Failed to press window close button (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        usleep(150_000)
        guard findWindowByID(pid: pid_t(resolved.pid), windowID: resolved.windowID) == nil else {
            exitError("Window close was not confirmed for window \(resolved.windowID)", code: "WINDOW_CLOSE_UNCONFIRMED")
        }
    case "minimize":
        let originalFrame = cgWindowBounds(windowID: resolved.windowID) ?? axBounds(resolved.window)
        let result = setWindowMinimized(resolved.window, minimized: true)
        guard result == .success else {
            exitError("Failed to minimize window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard waitForWindowMinimizeConfirmation(pid: resolved.pid, windowID: resolved.windowID, originalFrame: originalFrame) else {
            exitError("Window minimize was not confirmed for window \(resolved.windowID)", code: "WINDOW_MINIMIZE_UNCONFIRMED")
        }
    case "maximize":
        guard let current = axBounds(resolved.window) else {
            exitError("Cannot read current window frame", code: "WINDOW_FRAME_UNAVAILABLE")
        }
        guard let targetFrame = firstDisplayWorkArea(containing: current) else {
            exitError("Cannot resolve display work area for window \(resolved.windowID)", code: "DISPLAY_NOT_FOUND")
        }
        saveWindowFrame(pid: resolved.pid, windowID: resolved.windowID, frame: current)
        let result = setWindowFrame(resolved.window, frame: targetFrame)
        guard result == .success else {
            exitError("Failed to maximize window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard waitForWindowFrame(pid: resolved.pid, windowID: resolved.windowID, matching: { windowFrameApproximatelyEquals($0, targetFrame) }) != nil else {
            exitError("Window maximize was not confirmed for window \(resolved.windowID)", code: "WINDOW_MAXIMIZE_UNCONFIRMED")
        }
    case "restore":
        if minimized == true {
            let result = setWindowMinimized(resolved.window, minimized: false)
            guard result == .success else {
                exitError("Failed to restore minimized window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
            }
            raiseWindow(pid: resolved.pid, windowID: resolved.windowID)
            guard waitForWindowMinimizedState(pid: resolved.pid, windowID: resolved.windowID, expected: false) else {
                exitError("Window restore was not confirmed for window \(resolved.windowID)", code: "WINDOW_RESTORE_UNCONFIRMED")
            }
        } else {
            if let currentFrame = axBounds(resolved.window),
               windowIsStageManagerThumbnail(windowID: resolved.windowID, axFrame: currentFrame) {
                raiseWindow(pid: resolved.pid, windowID: resolved.windowID)
                guard waitForWindowFrame(pid: resolved.pid, windowID: resolved.windowID, matching: { windowFrameApproximatelyEquals($0, currentFrame) }) != nil else {
                    exitError("Window restore was not confirmed for window \(resolved.windowID)", code: "WINDOW_RESTORE_UNCONFIRMED")
                }
                break
            }
            guard let saved = loadWindowFrame(pid: resolved.pid, windowID: resolved.windowID) else {
                exitError("No saved maximize frame for window \(resolved.windowID)", code: "WINDOW_RESTORE_STATE_NOT_FOUND")
            }
            let frame = CGRect(x: saved.x, y: saved.y, width: saved.width, height: saved.height)
            let result = setWindowFrame(resolved.window, frame: frame)
            guard result == .success else {
                exitError("Failed to restore window frame (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
            }
            guard waitForWindowFrame(pid: resolved.pid, windowID: resolved.windowID, matching: { windowFrameApproximatelyEquals($0, frame) }) != nil else {
                exitError("Window restore was not confirmed for window \(resolved.windowID)", code: "WINDOW_RESTORE_UNCONFIRMED")
            }
        }
    default:
        exitError("Unknown window lifecycle action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }

    cliPrintLegacy(action: action, backend: "ax", target: resolved.target, dryRun: false)
}
