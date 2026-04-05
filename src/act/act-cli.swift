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
func cliPrintLegacy(action: String, backend: String, target: LegacyTargetInfo, detail: String? = nil, dryRun: Bool) {
    var resp = LegacySuccessResponse(status: dryRun ? "dry_run" : "success", action: action, backend: backend, target: target)
    resp.detail = detail
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
                               "--delay", "--variance", "--dwell", "--steps", "--speed"]
            if valuedFlags.contains(arg) { skipNext = true }
            continue
        }
        result.append(arg)
    }
    return result
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
    cliPrintLegacy(action: "press", backend: "ax", target: target, dryRun: false)
}

/// `aos do set-value` — set the value of an AX element.
func cliSetValue(args: [String]) {
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
    cliPrintLegacy(action: "set-value", backend: "ax", target: target, dryRun: false)
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
    cliPrintLegacy(action: "focus", backend: "ax", target: target, dryRun: false)
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

// MARK: - CGEvent Backend CLI Commands

/// `aos do click` — click at coordinates.
func cliClick(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitError("click requires coordinates (x,y)", code: "MISSING_ARG")
    }

    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")

    // Override click dwell from CLI flag
    if let dwellMs = parseInt(getArg(args, "--dwell")) {
        state.profile.timing.click_dwell = DelayRange(min: dwellMs, max: dwellMs)
    }

    var target = LegacyTargetInfo()
    target.x = coords.0
    target.y = coords.1

    if dryRun {
        var detail: String? = nil
        if isRight { detail = "right-click" }
        if isDouble { detail = "double-click" }
        cliPrintLegacy(action: "click", backend: "cgevent", target: target, detail: detail, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "click",
        x: coords.0, y: coords.1,
        button: isRight ? "right" : "left",
        count: isDouble ? 2 : 1
    )
    let resp = handleClick(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "click failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "click", backend: "cgevent", target: target, dryRun: false)
}

/// `aos do hover` — move cursor to coordinates.
func cliHover(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitError("hover requires coordinates (x,y)", code: "MISSING_ARG")
    }

    var target = LegacyTargetInfo()
    target.x = coords.0
    target.y = coords.1

    if dryRun {
        cliPrintLegacy(action: "hover", backend: "cgevent", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(action: "move", x: coords.0, y: coords.1)
    let resp = handleMove(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "hover failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "hover", backend: "cgevent", target: target, dryRun: false)
}

/// `aos do drag` — drag from one point to another.
func cliDrag(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard positional.count >= 2,
          let from = parseCoords(positional[0]),
          let to = parseCoords(positional[1]) else {
        exitError("drag requires two coordinate pairs (x1,y1 x2,y2)", code: "MISSING_ARG")
    }

    // Override drag speed from CLI flags
    if let speedPxPerSec = parseDouble(getArg(args, "--speed")) {
        state.profile.mouse.pixels_per_second = speedPxPerSec
    }

    var target = LegacyTargetInfo()
    target.x = from.0
    target.y = from.1
    target.x2 = to.0
    target.y2 = to.1

    if dryRun {
        cliPrintLegacy(action: "drag", backend: "cgevent", target: target, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "drag",
        x: to.0, y: to.1,
        from: CursorPosition(x: from.0, y: from.1)
    )
    let resp = handleDrag(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "drag failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "drag", backend: "cgevent", target: target, dryRun: false)
}

/// `aos do scroll` — scroll at coordinates.
func cliScroll(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

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
        cliPrintLegacy(action: "scroll", backend: "cgevent", target: target, detail: detail, dryRun: true)
        return
    }

    let req = ActionRequest(
        action: "scroll",
        x: coords.0, y: coords.1,
        dx: dx, dy: dy
    )
    let resp = handleScroll(req, state: state)
    if resp.status == "error" {
        exitError(resp.error ?? "scroll failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "scroll", backend: "cgevent", target: target, dryRun: false)
}

/// `aos do type` — type text string.
func cliType(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let text = positional.first else {
        exitError("type requires a text argument", code: "MISSING_ARG")
    }

    // Override typing cadence from CLI flags
    if let delayMs = parseDouble(getArg(args, "--delay")) {
        // delay is ms per character -> derive WPM: chars/sec = 1000/delay, WPM = chars_per_sec * 60 / 5
        let charsPerSec = 1000.0 / max(1.0, delayMs)
        state.profile.timing.typing_cadence.wpm = max(1, Int(charsPerSec * 60.0 / 5.0))
    }
    if let variance = parseDouble(getArg(args, "--variance")) {
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
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

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
