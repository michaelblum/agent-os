// act-cli.swift — Standalone CLI commands for the aos do module.
// Each command creates a temporary SessionState, builds an ActionRequest,
// calls the appropriate handler, and outputs a v1-compatible LegacySuccessResponse.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - CLI Helpers

/// Create a one-shot session state. Loads --profile if given, defaults to "natural".
func cliSessionState(args: [String]) -> SessionState {
    let profileName = getArg(args, "--profile") ?? "natural"
    guard let profile = loadProfile(name: profileName) else {
        exitError("Profile not found: \(profileName)", code: "PROFILE_NOT_FOUND")
    }
    return SessionState(profile: profile, profileName: profileName)
}

/// Print a v1-compatible legacy response to stdout.
func cliPrintLegacy(
    action: String,
    backend: String,
    target: LegacyTargetInfo,
    detail: String? = nil,
    dryRun: Bool,
    stateID: String? = nil,
    execution: ActionExecutionMetadata? = nil
) {
    var resp = LegacySuccessResponse(status: dryRun ? "dry_run" : "success", action: action, backend: backend, target: target)
    resp.detail = detail
    let normalizedAction = action.replacingOccurrences(of: "-", with: "_")
    resp.execution = execution ?? ActionExecutionMetadata(
        strategy: dryRun ? "dry_run_\(normalizedAction)" : "\(backend)_\(normalizedAction)",
        backend: backend,
        fallback_used: false,
        state_id: stateID
    )
    writeJSONLine(resp)
}

/// Extract AX targeting flags from CLI args and build common fields for ActionRequest.
private func axTargetingFields(args: [String]) -> (pid: Int?, role: String?, title: String?, label: String?,
                                                     identifier: String?, index: Int?, near: [Double]?,
                                                     match: String?, depth: Int?, timeout: Int?) {
    let pid = parseInt(getArg(args, "--pid"))
    let role = getArg(args, "--role")
    let title = getArg(args, "--title")
    let label = getArg(args, "--label")
    let identifier = getArg(args, "--identifier")
    let index = parseInt(getArg(args, "--index"))
    let match = getArg(args, "--match")
    let depth = parseInt(getArg(args, "--depth"))
    let timeout = parseInt(getArg(args, "--timeout"))

    var near: [Double]? = nil
    if let nearStr = getArg(args, "--near"), let coords = parseCoords(nearStr) {
        near = [coords.0, coords.1]
    }

    return (pid, role, title, label, identifier, index, near, match, depth, timeout)
}

/// Build a LegacyTargetInfo from AX targeting flags.
private func axTargetInfo(args: [String]) -> LegacyTargetInfo {
    let t = axTargetingFields(args: args)
    return LegacyTargetInfo(pid: t.pid, role: t.role, title: t.title, index: t.index)
}

/// Get the first positional argument (not a flag and not a flag value).
private func positionalArgs(_ args: [String]) -> [String] {
    var result: [String] = []
    var skipNext = false
    for arg in args {
        if skipNext { skipNext = false; continue }
        if arg.hasPrefix("--") {
            // Flags that take a value
            let valuedFlags = ["--pid", "--role", "--title", "--label", "--identifier",
                               "--index", "--near", "--match", "--depth", "--timeout",
                               "--profile", "--value", "--to", "--dy", "--dx", "--window",
                               "--delay", "--variance", "--dwell", "--steps", "--speed",
                               "--state-id", "--by", "--to-value", "--playback", "--path"]
            if valuedFlags.contains(arg) { skipNext = true }
            continue
        }
        result.append(arg)
    }
    return result
}

private func playbackMode(args: [String]) -> String {
    let mode = getArg(args, "--playback") ?? "auto"
    switch mode {
    case "auto", "immediate", "human":
        return mode
    default:
        exitError("unsupported playback mode '\(mode)'", code: "INVALID_PLAYBACK")
    }
}

private func positiveIntArg(_ args: [String], _ flag: String) -> Int? {
    guard let raw = getArg(args, flag) else { return nil }
    guard let parsed = parseInt(raw), parsed > 0 else {
        exitError("\(flag) requires a positive integer", code: "INVALID_ARG")
    }
    return parsed
}

private func positiveDoubleArg(_ args: [String], _ flag: String) -> Double? {
    guard let raw = getArg(args, flag) else { return nil }
    guard let parsed = parseDouble(raw), parsed > 0, parsed.isFinite else {
        exitError("\(flag) requires a positive number", code: "INVALID_ARG")
    }
    return parsed
}

private func varianceArg(_ args: [String], _ flag: String) -> Double? {
    guard let raw = getArg(args, flag) else { return nil }
    guard let parsed = parseDouble(raw), parsed >= 0, parsed <= 1, parsed.isFinite else {
        exitError("\(flag) requires a number from 0 to 1", code: "INVALID_ARG")
    }
    return parsed
}

private func printCanvasTargetActionResult(
    action: String,
    backend: String = "canvas",
    strategy: String,
    target: CanvasRefClickTargetInfo,
    playback: String,
    dryRun: Bool,
    stateID: String?,
    detail: String? = nil,
    actionResult: [String: Any]? = nil,
    postTarget: AOSSemanticTargetJSON? = nil
) {
    struct Payload: Encodable {
        let status: String
        let action: String
        let backend: String
        let playback: String
        let target: CanvasRefClickTargetInfo
        let detail: String?
        let action_result: JSONValue?
        let post_target: AOSSemanticTargetJSON?
        let execution: ActionExecutionMetadata
    }
    let resultValue = actionResult.flatMap { JSONValue($0) }
    let payload = Payload(
        status: dryRun ? "dry_run" : "success",
        action: action,
        backend: backend,
        playback: playback,
        target: target,
        detail: detail,
        action_result: resultValue,
        post_target: postTarget,
        execution: ActionExecutionMetadata(
            strategy: dryRun ? "dry_run_\(strategy)" : strategy,
            backend: backend,
            fallback_used: backend == "cgevent",
            state_id: stateID
        )
    )
    writeJSONLine(payload)
}

private func sliderValuePoint(target: CanvasRefClickTargetInfo, value: Double) -> CGPoint? {
    guard
        let minimum = target.state?.min,
        let maximum = target.state?.max,
        maximum > minimum,
        let canvas = readCanvasInfo(id: target.canvas_id),
        canvas.at.count == 4
    else {
        return nil
    }
    let ratio = Swift.min(1.0, Swift.max(0.0, (value - minimum) / (maximum - minimum)))
    let localX = Double(target.bounds.x) + Double(target.bounds.width) * ratio
    let localY = Double(target.bounds.y) + Double(target.bounds.height) / 2.0
    return CGPoint(
        x: Double(canvas.at[0]) + localX / target.capture_scale_factor,
        y: Double(canvas.at[1]) + localY / target.capture_scale_factor
    )
}

// MARK: - AX Backend CLI Commands

/// `aos do press` — press (activate) an AX element.
func cliPress(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitError("press requires --pid", code: "MISSING_ARG")
    }

    let target = axTargetInfo(args: args)

    if dryRun {
        cliPrintLegacy(action: "press", backend: "ax", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "press",
        pid: t.pid, role: t.role, title: t.title, label: t.label,
        identifier: t.identifier, index: t.index,
        near: t.near, match: t.match, depth: t.depth, timeout: t.timeout
    )
    let resp = handlePress(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "press failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "press", backend: "ax", target: target, dryRun: false, execution: resp.execution)
}

/// `aos do set-value` — set the value of an AX element.
func cliSetValue(args: [String]) {
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("canvas:") {
        cliSetCanvasRefValue(targetString: first, args: args, positional: positional)
        return
    }

    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitError("set-value requires --pid", code: "MISSING_ARG")
    }
    guard t.role != nil else {
        exitError("set-value requires --role", code: "MISSING_ARG")
    }
    guard let value = getArg(args, "--value") else {
        exitError("set-value requires --value", code: "MISSING_ARG")
    }

    var target = axTargetInfo(args: args)
    target.text = value

    if dryRun {
        cliPrintLegacy(action: "set-value", backend: "ax", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "set_value",
        pid: t.pid, role: t.role, title: t.title, label: t.label,
        identifier: t.identifier, value: value, index: t.index,
        near: t.near, match: t.match, depth: t.depth, timeout: t.timeout
    )
    let resp = handleSetValue(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "set-value failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "set-value", backend: "ax", target: target, dryRun: false, execution: resp.execution)
}

private func cliSetCanvasRefValue(targetString: String, args: [String], positional: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let playback = playbackMode(args: args)
    guard playback != "human" else {
        exitError("set-value canvas targets do not support --playback human", code: "UNSUPPORTED_PLAYBACK")
    }
    let value = getArg(args, "--value") ?? positional.dropFirst().first
    guard let value else {
        exitError("set-value requires --value or a positional value", code: "MISSING_ARG")
    }
    let resolution = resolveCanvasRefTarget(targetString, primitive: "set-value")

    if dryRun {
        printCanvasTargetActionResult(
            action: "set-value",
            strategy: "canvas_semantic_set_value",
            target: resolution.target,
            playback: playback == "auto" ? "immediate" : playback,
            dryRun: true,
            stateID: stateID,
            detail: "value=\(value)"
        )
        return
    }

    let result = dispatchCanvasSemanticValueAction(
        canvasID: resolution.target.canvas_id,
        ref: resolution.target.ref,
        value: value,
        primitive: "set-value"
    )
    let postTarget = currentCanvasTargetSnapshot(
        canvasID: resolution.target.canvas_id,
        ref: resolution.target.ref,
        scaleFactor: resolution.target.capture_scale_factor
    )
    printCanvasTargetActionResult(
        action: "set-value",
        strategy: "canvas_semantic_set_value",
        target: resolution.target,
        playback: "immediate",
        dryRun: false,
        stateID: stateID,
        detail: "value=\(value)",
        actionResult: result,
        postTarget: postTarget
    )
}

/// `aos do focus` — focus an AX element.
func cliFocusElement(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitError("focus requires --pid", code: "MISSING_ARG")
    }
    guard t.role != nil else {
        exitError("focus requires --role", code: "MISSING_ARG")
    }

    let target = axTargetInfo(args: args)

    if dryRun {
        cliPrintLegacy(action: "focus", backend: "ax", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "focus",
        pid: t.pid, role: t.role, title: t.title, label: t.label,
        identifier: t.identifier, index: t.index,
        near: t.near, match: t.match, depth: t.depth, timeout: t.timeout
    )
    let resp = handleFocus(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "focus failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "focus", backend: "ax", target: target, dryRun: false, execution: resp.execution)
}

/// `aos do raise` — raise a window / activate an app.
func cliRaise(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("raise requires --pid", code: "MISSING_ARG")
    }

    let windowID = parseInt(getArg(args, "--window"))
    var target = LegacyTargetInfo(pid: pid)
    target.window_id = windowID

    if dryRun {
        cliPrintLegacy(action: "raise", backend: "ax", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(action: "raise", pid: pid, window_id: windowID)
    let resp = handleRaise(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "raise failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "raise", backend: "ax", target: target, dryRun: false)
}

/// `aos do move` — move (reposition) a window via AX. NOT cursor movement.
func cliMove(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("move requires --pid", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let coords = parseCoords(toStr) else {
        exitError("move requires --to x,y", code: "MISSING_ARG")
    }

    let windowID = parseInt(getArg(args, "--window"))
    var target = LegacyTargetInfo(pid: pid)
    target.x = coords.0
    target.y = coords.1
    target.window_id = windowID

    if dryRun {
        cliPrintLegacy(action: "move", backend: "ax", target: target, dryRun: true)
        return
    }

    let pidT = pid_t(pid)
    let window: AXUIElement?
    if let wid = windowID {
        window = findWindowByID(pid: pidT, windowID: wid)
    } else {
        window = findFirstWindow(pid: pidT)
    }

    guard let win = window else {
        exitError("No window found for pid \(pid)", code: "WINDOW_NOT_FOUND")
    }

    var point = CGPoint(x: coords.0, y: coords.1)
    guard let axValue = AXValueCreate(.cgPoint, &point) else {
        exitError("Failed to create AXValue for position", code: "AX_ACTION_FAILED")
    }
    let result = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, axValue)
    if result != .success {
        exitError("Failed to set window position (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "move", backend: "ax", target: target, dryRun: false)
}

/// `aos do resize` — resize a window via AX.
func cliResize(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("resize requires --pid", code: "MISSING_ARG")
    }
    guard let toStr = getArg(args, "--to"), let dims = parseCoords(toStr) else {
        exitError("resize requires --to w,h", code: "MISSING_ARG")
    }

    let windowID = parseInt(getArg(args, "--window"))
    var target = LegacyTargetInfo(pid: pid)
    target.width = dims.0
    target.height = dims.1
    target.window_id = windowID

    if dryRun {
        cliPrintLegacy(action: "resize", backend: "ax", target: target, dryRun: true)
        return
    }

    let pidT = pid_t(pid)
    let window: AXUIElement?
    if let wid = windowID {
        window = findWindowByID(pid: pidT, windowID: wid)
    } else {
        window = findFirstWindow(pid: pidT)
    }

    guard let win = window else {
        exitError("No window found for pid \(pid)", code: "WINDOW_NOT_FOUND")
    }

    var size = CGSize(width: dims.0, height: dims.1)
    guard let axValue = AXValueCreate(.cgSize, &size) else {
        exitError("Failed to create AXValue for size", code: "AX_ACTION_FAILED")
    }
    let result = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, axValue)
    if result != .success {
        exitError("Failed to set window size (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "resize", backend: "ax", target: target, dryRun: false)
}

private struct SavedWindowFrame: Codable {
    let pid: Int
    let window_id: Int
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private func windowLifecycleFramePath(pid: Int, windowID: Int) -> String {
    let dir = (aosStateDir() as NSString).appendingPathComponent("window-frames")
    try? FileManager.default.createDirectory(
        atPath: dir,
        withIntermediateDirectories: true,
        attributes: nil
    )
    return (dir as NSString).appendingPathComponent("\(pid)-\(windowID).json")
}

private func saveWindowFrame(pid: Int, windowID: Int, frame: CGRect) {
    let saved = SavedWindowFrame(
        pid: pid,
        window_id: windowID,
        x: Double(frame.origin.x),
        y: Double(frame.origin.y),
        width: Double(frame.size.width),
        height: Double(frame.size.height)
    )
    guard let data = try? JSONEncoder().encode(saved) else { return }
    try? data.write(to: URL(fileURLWithPath: windowLifecycleFramePath(pid: pid, windowID: windowID)), options: [.atomic])
}

private func loadWindowFrame(pid: Int, windowID: Int) -> SavedWindowFrame? {
    let path = windowLifecycleFramePath(pid: pid, windowID: windowID)
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    return try? JSONDecoder().decode(SavedWindowFrame.self, from: data)
}

private func firstDisplayBounds(containing frame: CGRect) -> CGRect? {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return nil }
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return nil }

    let center = CGPoint(x: frame.midX, y: frame.midY)
    let bounds = displays.map { CGDisplayBounds($0) }
    return bounds.first { $0.contains(center) } ?? bounds.first
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
        guard firstDisplayBounds(containing: current) != nil else {
            exitError("Cannot resolve display bounds for window \(resolved.windowID)", code: "DISPLAY_NOT_FOUND")
        }
        requireWindowFrameSettable(resolved.window, action: "maximize")
    case "restore":
        guard let minimized else {
            exitError("Cannot read minimized state for window \(resolved.windowID)", code: "WINDOW_STATE_UNAVAILABLE")
        }
        if minimized {
            requireWindowAttributeSettable(resolved.window, attribute: kAXMinimizedAttribute as String, action: "restore")
        } else {
            guard loadWindowFrame(pid: resolved.pid, windowID: resolved.windowID) != nil else {
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
        let result = setWindowMinimized(resolved.window, minimized: true)
        guard result == .success else {
            exitError("Failed to minimize window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard axBool(resolved.window, kAXMinimizedAttribute as String) == true else {
            exitError("Window minimize was not confirmed for window \(resolved.windowID)", code: "WINDOW_MINIMIZE_UNCONFIRMED")
        }
    case "maximize":
        guard let current = axBounds(resolved.window) else {
            exitError("Cannot read current window frame", code: "WINDOW_FRAME_UNAVAILABLE")
        }
        guard let targetFrame = firstDisplayBounds(containing: current) else {
            exitError("Cannot resolve display bounds for window \(resolved.windowID)", code: "DISPLAY_NOT_FOUND")
        }
        saveWindowFrame(pid: resolved.pid, windowID: resolved.windowID, frame: current)
        let result = setWindowFrame(resolved.window, frame: targetFrame)
        guard result == .success else {
            exitError("Failed to maximize window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard let actual = axBounds(resolved.window), windowFrameApproximatelyEquals(actual, targetFrame) else {
            exitError("Window maximize was not confirmed for window \(resolved.windowID)", code: "WINDOW_MAXIMIZE_UNCONFIRMED")
        }
    case "restore":
        if minimized == true {
            let result = setWindowMinimized(resolved.window, minimized: false)
            guard result == .success else {
                exitError("Failed to restore minimized window (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
            }
            guard axBool(resolved.window, kAXMinimizedAttribute as String) == false else {
                exitError("Window restore was not confirmed for window \(resolved.windowID)", code: "WINDOW_RESTORE_UNCONFIRMED")
            }
        } else {
            guard let saved = loadWindowFrame(pid: resolved.pid, windowID: resolved.windowID) else {
                exitError("No saved maximize frame for window \(resolved.windowID)", code: "WINDOW_RESTORE_STATE_NOT_FOUND")
            }
            let frame = CGRect(x: saved.x, y: saved.y, width: saved.width, height: saved.height)
            let result = setWindowFrame(resolved.window, frame: frame)
            guard result == .success else {
                exitError("Failed to restore window frame (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
            }
            guard let actual = axBounds(resolved.window), windowFrameApproximatelyEquals(actual, frame) else {
                exitError("Window restore was not confirmed for window \(resolved.windowID)", code: "WINDOW_RESTORE_UNCONFIRMED")
            }
        }
    default:
        exitError("Unknown window lifecycle action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }

    cliPrintLegacy(action: action, backend: "ax", target: resolved.target, dryRun: false)
}

/// `aos do activate|quit|hide|unhide` — app lifecycle controls by process id.
func cliAppLifecycle(action: String, args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitError("\(action) requires --pid", code: "MISSING_ARG")
    }

    guard let app = NSRunningApplication(processIdentifier: pid_t(pid)) else {
        exitError("No running application found for pid \(pid)", code: "APP_NOT_FOUND")
    }
    var target = LegacyTargetInfo(pid: pid)
    target.app = app.localizedName

    if dryRun {
        cliPrintLegacy(action: action, backend: "appkit", target: target, dryRun: true)
        return
    }

    let ok: Bool
    switch action {
    case "activate":
        ok = app.activate(options: [.activateAllWindows])
    case "quit":
        ok = app.terminate()
    case "hide":
        ok = app.hide()
    case "unhide":
        ok = app.unhide()
    default:
        exitError("Unknown app lifecycle action: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }

    guard ok else {
        exitError("App lifecycle action \(action) failed for pid \(pid)", code: "APP_ACTION_FAILED")
    }

    cliPrintLegacy(action: action, backend: "appkit", target: target, dryRun: false)
}

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

// MARK: - CGEvent Backend CLI Commands

/// `aos do click` — click at coordinates.
func cliClick(args: [String]) {
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("canvas:") {
        cliClickCanvasRef(targetString: first, args: args)
        return
    }
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let state = cliSessionState(args: args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitError("click requires coordinates (x,y) or canvas:<canvas-id>/<ref>", code: "MISSING_ARG")
    }

    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")

    // Override click dwell from CLI flag
    if let dwellMs = positiveIntArg(args, "--dwell") {
        state.profile.timing.click_dwell = DelayRange(min: dwellMs, max: dwellMs)
    }

    var target = LegacyTargetInfo()
    target.x = coords.0
    target.y = coords.1

    if dryRun {
        var detail: String? = nil
        if isRight { detail = "right-click" }
        if isDouble { detail = "double-click" }
        cliPrintLegacy(action: "click", backend: "cgevent", target: target, detail: detail, dryRun: true, stateID: stateID)
        return
    }

    let req = ActionRequest(
        action: "click",
        x: coords.0, y: coords.1,
        button: isRight ? "right" : "left",
        count: isDouble ? 2 : 1,
        state_id: stateID
    )
    let resp = handleClick(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "click failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "click", backend: "cgevent", target: target, dryRun: false, stateID: stateID)
}

/// `aos do click canvas:<canvas-id>/<ref>` — click a semantic target on an AOS canvas.
private func cliClickCanvasRef(targetString: String, args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")
    let resolution = resolveCanvasRefClickTarget(targetString)

    var detail: String? = nil
    if isRight { detail = "right-click" }
    if isDouble { detail = "double-click" }

    if dryRun {
        printCanvasRefClickResult(target: resolution.target, detail: detail, dryRun: true, stateID: stateID)
        return
    }

    let state = cliSessionState(args: args)
    if let dwellMs = positiveIntArg(args, "--dwell") {
        state.profile.timing.click_dwell = DelayRange(min: dwellMs, max: dwellMs)
    }

    let req = ActionRequest(
        action: "click",
        x: Double(resolution.point.x),
        y: Double(resolution.point.y),
        button: isRight ? "right" : "left",
        count: isDouble ? 2 : 1,
        state_id: stateID
    )
    let resp = handleClick(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "click failed", code: resp.code ?? "UNKNOWN")
    }
    printCanvasRefClickResult(target: resolution.target, detail: detail, dryRun: false, stateID: stateID)
}

/// `aos do hover` — move cursor to coordinates.
func cliHover(args: [String]) {
    let positional = positionalArgs(args)
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let state = cliSessionState(args: args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitError("hover requires coordinates (x,y)", code: "MISSING_ARG")
    }

    var target = LegacyTargetInfo()
    target.x = coords.0
    target.y = coords.1

    if dryRun {
        cliPrintLegacy(action: "hover", backend: "cgevent", target: target, dryRun: true, stateID: stateID)
        return
    }

    let req = ActionRequest(action: "move", x: coords.0, y: coords.1, state_id: stateID)
    let resp = handleMove(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "hover failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "hover", backend: "cgevent", target: target, dryRun: false, stateID: stateID)
}

/// `aos do drag` — drag from one point to another.
func cliDrag(args: [String]) {
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("canvas:") {
        cliDragCanvasRef(targetString: first, args: args)
        return
    }
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let state = cliSessionState(args: args)

    guard positional.count >= 2,
          let from = parseCoords(positional[0]),
          let to = parseCoords(positional[1]) else {
        exitError("drag requires two coordinate pairs (x1,y1 x2,y2)", code: "MISSING_ARG")
    }

    // Override drag speed from CLI flags
    if let speedPxPerSec = positiveDoubleArg(args, "--speed") {
        state.profile.mouse.pixels_per_second = speedPxPerSec
    }

    var target = LegacyTargetInfo()
    target.x = from.0
    target.y = from.1
    target.x2 = to.0
    target.y2 = to.1

    if dryRun {
        cliPrintLegacy(action: "drag", backend: "cgevent", target: target, dryRun: true, stateID: stateID)
        return
    }

    let req = ActionRequest(
        action: "drag",
        x: to.0, y: to.1,
        from: CursorPosition(x: from.0, y: from.1),
        state_id: stateID
    )
    let resp = handleDrag(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "drag failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "drag", backend: "cgevent", target: target, dryRun: false, stateID: stateID)
}

private func cliDragCanvasRef(targetString: String, args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let playback = playbackMode(args: args)
    let by = getArg(args, "--by").flatMap(parseCoords)
    let toValue = getArg(args, "--to-value")
    guard by != nil || toValue != nil else {
        exitError("drag canvas target requires --by dx,dy or --to-value value", code: "MISSING_ARG")
    }
    let resolution = resolveCanvasRefTarget(targetString, primitive: "drag")

    if let toValue {
        if dryRun {
            printCanvasTargetActionResult(
                action: "drag",
                backend: playback == "human" ? "cgevent" : "canvas",
                strategy: playback == "human" ? "cgevent_canvas_ref_drag_to_value" : "canvas_semantic_drag_to_value",
                target: resolution.target,
                playback: playback == "auto" ? "immediate" : playback,
                dryRun: true,
                stateID: stateID,
                detail: "to-value=\(toValue)"
            )
            return
        }
        if playback == "human" {
            guard
                let value = parseDouble(toValue),
                let current = resolution.target.state?.values?.first ?? parseDouble(resolution.target.state?.value),
                let origin = sliderValuePoint(target: resolution.target, value: current),
                let destination = sliderValuePoint(target: resolution.target, value: value)
            else {
                exitError("Unable to resolve slider value geometry for human playback", code: "TARGET_GEOMETRY_UNAVAILABLE")
            }
            let state = cliSessionState(args: args)
            let req = ActionRequest(
                action: "drag",
                x: Double(destination.x),
                y: Double(destination.y),
                from: CursorPosition(x: Double(origin.x), y: Double(origin.y)),
                state_id: stateID
            )
            let resp = handleDrag(req, state: state)
            if resp.status == "error" {
                exitError(resp.error ?? "drag failed", code: resp.code ?? "UNKNOWN")
            }
            let postTarget = currentCanvasTargetSnapshot(
                canvasID: resolution.target.canvas_id,
                ref: resolution.target.ref,
                scaleFactor: resolution.target.capture_scale_factor
            )
            printCanvasTargetActionResult(
                action: "drag",
                backend: "cgevent",
                strategy: "cgevent_canvas_ref_drag_to_value",
                target: resolution.target,
                playback: "human",
                dryRun: false,
                stateID: stateID,
                detail: "to-value=\(toValue)",
                postTarget: postTarget
            )
            return
        }
        let result = dispatchCanvasSemanticValueAction(
            canvasID: resolution.target.canvas_id,
            ref: resolution.target.ref,
            value: toValue,
            primitive: "drag"
        )
        let postTarget = currentCanvasTargetSnapshot(
            canvasID: resolution.target.canvas_id,
            ref: resolution.target.ref,
            scaleFactor: resolution.target.capture_scale_factor
        )
        printCanvasTargetActionResult(
            action: "drag",
            strategy: "canvas_semantic_drag_to_value",
            target: resolution.target,
            playback: "immediate",
            dryRun: false,
            stateID: stateID,
            detail: "to-value=\(toValue)",
            actionResult: result,
            postTarget: postTarget
        )
        return
    }

    guard let delta = by else {
        exitError("drag canvas target requires --by dx,dy or --to-value value", code: "MISSING_ARG")
    }
    let to = CGPoint(x: resolution.point.x + CGFloat(delta.0), y: resolution.point.y + CGFloat(delta.1))
    let detail = "by=\(delta.0),\(delta.1)"

    if dryRun {
        printCanvasTargetActionResult(
            action: "drag",
            backend: playback == "human" ? "cgevent" : "canvas",
            strategy: playback == "human" ? "cgevent_canvas_ref_drag" : "canvas_semantic_drag_by",
            target: resolution.target,
            playback: playback == "auto" ? "immediate" : playback,
            dryRun: true,
            stateID: stateID,
            detail: detail
        )
        return
    }

    if playback == "human" {
        let state = cliSessionState(args: args)
        let req = ActionRequest(
            action: "drag",
            x: Double(to.x),
            y: Double(to.y),
            from: CursorPosition(x: Double(resolution.point.x), y: Double(resolution.point.y)),
            state_id: stateID
        )
        let resp = handleDrag(req, state: state)
        if resp.status == "error" {
            exitError(resp.error ?? "drag failed", code: resp.code ?? "UNKNOWN")
        }
        printCanvasTargetActionResult(
            action: "drag",
            backend: "cgevent",
            strategy: "cgevent_canvas_ref_drag",
            target: resolution.target,
            playback: "human",
            dryRun: false,
            stateID: stateID,
            detail: detail
        )
        return
    }

    updateCanvasFrameForSemanticDrag(canvasID: resolution.target.canvas_id, dx: delta.0, dy: delta.1)
    let postTarget = currentCanvasTargetSnapshot(
        canvasID: resolution.target.canvas_id,
        ref: resolution.target.ref,
        scaleFactor: resolution.target.capture_scale_factor
    )
    printCanvasTargetActionResult(
        action: "drag",
        strategy: "canvas_semantic_drag_by",
        target: resolution.target,
        playback: "immediate",
        dryRun: false,
        stateID: stateID,
        detail: detail,
        postTarget: postTarget
    )
}

/// `aos do scroll` — scroll at coordinates.
func cliScroll(args: [String]) {
    let positional = positionalArgs(args)
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let state = cliSessionState(args: args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitError("scroll requires coordinates (x,y)", code: "MISSING_ARG")
    }

    let dx = parseDouble(getArg(args, "--dx"))
    let dy = parseDouble(getArg(args, "--dy"))

    guard dx != nil || dy != nil else {
        exitError("scroll requires at least one of --dx or --dy", code: "MISSING_ARG")
    }

    var target = LegacyTargetInfo()
    target.x = coords.0
    target.y = coords.1

    if dryRun {
        var detail = "scroll"
        if let dy = dy { detail += " dy=\(Int(dy))" }
        if let dx = dx { detail += " dx=\(Int(dx))" }
        cliPrintLegacy(action: "scroll", backend: "cgevent", target: target, detail: detail, dryRun: true, stateID: stateID)
        return
    }

    let req = ActionRequest(
        action: "scroll",
        x: coords.0, y: coords.1,
        dx: dx, dy: dy,
        state_id: stateID
    )
    let resp = handleScroll(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "scroll failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "scroll", backend: "cgevent", target: target, dryRun: false, stateID: stateID)
}

/// `aos do type` — type text string.
func cliType(args: [String]) {
    let positional = positionalArgs(args)
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let text = positional.first else {
        exitError("type requires a text argument", code: "MISSING_ARG")
    }

    // Override typing cadence from CLI flags
    if let delayMs = positiveDoubleArg(args, "--delay") {
        // delay is ms per character -> derive WPM: chars/sec = 1000/delay, WPM = chars_per_sec * 60 / 5
        let charsPerSec = 1000.0 / delayMs
        state.profile.timing.typing_cadence.wpm = max(1, Int(charsPerSec * 60.0 / 5.0))
    }
    if let variance = varianceArg(args, "--variance") {
        state.profile.timing.typing_cadence.variance = variance
    }

    var target = LegacyTargetInfo()
    target.text = text

    if dryRun {
        cliPrintLegacy(action: "type", backend: "cgevent", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(action: "type", text: text)
    let resp = handleType(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "type failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "type", backend: "cgevent", target: target, dryRun: false)
}

/// `aos do key` — press a key combo (e.g. cmd+s).
func cliKey(args: [String]) {
    let positional = positionalArgs(args)
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let combo = positional.first else {
        exitError("key requires a key combo argument (e.g. cmd+s)", code: "MISSING_ARG")
    }

    var target = LegacyTargetInfo()
    target.keys = combo

    if dryRun {
        cliPrintLegacy(action: "key", backend: "cgevent", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(action: "key_tap", key: combo)
    let resp = handleKeyTap(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "key failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "key", backend: "cgevent", target: target, dryRun: false)
}

// MARK: - AppleScript CLI Command

/// `aos do tell` — run AppleScript tell block.
func cliTell(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let positional = positionalArgs(args)

    guard positional.count >= 2 else {
        exitError("tell requires an app name and a script body", code: "MISSING_ARG")
    }

    let appName = positional[0]
    let scriptBody = positional[1...].joined(separator: " ")

    var target = LegacyTargetInfo()
    target.app = appName
    target.script = scriptBody

    if dryRun {
        cliPrintLegacy(action: "tell", backend: "applescript", target: target, dryRun: true)
        return
    }

    let source = "tell application \"\(appName)\" to \(scriptBody)"
    let script = NSAppleScript(source: source)
    var errorDict: NSDictionary?
    let result = script?.executeAndReturnError(&errorDict)

    if let err = errorDict {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "AppleScript execution failed"
        exitError(msg, code: "APPLESCRIPT_FAILED")
    }

    let detail = result?.stringValue
    cliPrintLegacy(action: "tell", backend: "applescript", target: target, detail: detail, dryRun: false)
}
