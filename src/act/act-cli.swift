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
func cliPrintLegacy(action: String, backend: String, target: LegacyTargetInfo, detail: String? = nil, dryRun: Bool, stateID: String? = nil) {
    var resp = LegacySuccessResponse(status: dryRun ? "dry_run" : "success", action: action, backend: backend, target: target)
    resp.detail = detail
    let normalizedAction = action.replacingOccurrences(of: "-", with: "_")
    resp.execution = ActionExecutionMetadata(
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
                               "--state-id"]
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
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("browser:") {
        dispatchBrowserVerb("click", targetString: first,
                            remaining: Array(positional.dropFirst()), flags: args)
        return
    }
    let dryRun = hasFlag(args, "--dry-run")
    let stateID = getArg(args, "--state-id")
    let state = cliSessionState(args: args)

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

/// `aos do hover` — move cursor to coordinates.
func cliHover(args: [String]) {
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("browser:") {
        dispatchBrowserVerb("hover", targetString: first,
                            remaining: Array(positional.dropFirst()), flags: args)
        return
    }
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
    if let first = positional.first, first.hasPrefix("browser:"),
       positional.indices.contains(1), positional[1].hasPrefix("browser:") {
        // Both endpoints must be the same session. Playwright's drag verb
        // takes two refs on a single page; we bypass the single-target
        // doVerb() helper and call runPlaywright() directly.
        do {
            let fromT = try parseBrowserTarget(first)
            let toT = try parseBrowserTarget(positional[1])
            guard fromT.session == toT.session else {
                exitError("drag endpoints must share the same browser session", code: "INVALID_TARGET")
            }
            guard let fromRef = fromT.ref, let toRef = toT.ref else {
                exitError("drag requires ref on both endpoints (browser:<s>/<ref>)", code: "INVALID_TARGET")
            }
            let r = try runPlaywright(PlaywrightInvocation(
                session: fromT.session, verb: "drag",
                args: [fromRef, toRef],
                withTempFilename: false
            ))
            try requireSuccess(r, action: "drag")
            emitDoResult(r, backend: "playwright", strategy: "playwright_drag", stateID: getArg(args, "--state-id"))
            return
        } catch BrowserTargetError.invalid(let msg) {
            exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
        } catch BrowserTargetError.missingSession {
            exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
        } catch BrowserAdapterError.subprocess(let msg, let code) {
            exitError(msg, code: code)
        } catch {
            exitError("\(error)", code: "INTERNAL")
        }
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
    if let speedPxPerSec = parseDouble(getArg(args, "--speed")) {
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

/// `aos do scroll` — scroll at coordinates.
func cliScroll(args: [String]) {
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("browser:") {
        dispatchBrowserVerb("scroll", targetString: first,
                            remaining: Array(positional.dropFirst()), flags: args)
        return
    }
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
    if let first = positional.first, first.hasPrefix("browser:") {
        dispatchBrowserVerb("type", targetString: first,
                            remaining: Array(positional.dropFirst()), flags: args)
        return
    }
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

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
    let positional = positionalArgs(args)
    if let first = positional.first, first.hasPrefix("browser:") {
        dispatchBrowserVerb("key", targetString: first,
                            remaining: Array(positional.dropFirst()), flags: args)
        return
    }
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

/// `aos do fill` — browser-only in v1. Clears and enters text into an input
/// element identified by a `browser:<session>/<ref>` target.
func cliFill(args: [String]) {
    let positional = positionalArgs(args)
    guard positional.count >= 2 else {
        exitError("Usage: aos do fill <browser:<s>/<ref>> <text>", code: "MISSING_ARG")
    }
    let targetString = positional[0]
    let text = positional[1]
    guard targetString.hasPrefix("browser:") else {
        exitError("aos do fill is browser-only in v1. Target must be browser:<s>/<ref>.",
                  code: "BROWSER_ONLY")
    }
    dispatchBrowserVerb("fill", targetString: targetString, remaining: [text], flags: args)
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

/// `aos do navigate` — browser-only in v1. Navigates the session to a URL by
/// dispatching playwright-cli's `goto` verb. macOS equivalent is deferred.
func cliNavigate(args: [String]) {
    guard args.count >= 2 else {
        exitError("Usage: aos do navigate <browser:<s>> <url>", code: "MISSING_ARG")
    }
    let targetString = args[0]
    let url = args[1]
    guard targetString.hasPrefix("browser:") else {
        exitError("aos do navigate is browser-only in v1.", code: "BROWSER_ONLY")
    }
    // navigate is aos's alias for playwright's "goto" verb; pass aosVerb="navigate"
    // so the translation reaches goto via the switch in dispatchBrowserVerb.
    dispatchBrowserVerb("navigate", targetString: targetString, remaining: [url], flags: [])
}

// MARK: - Browser-Target Dispatch (Task 9)

/// Route an aos `do` verb to playwright-cli when the first positional argument
/// is a `browser:<session>[/<ref>]` target. Verb translation (key -> press,
/// scroll -> mousewheel) happens here so the browser adapter stays
/// playwright-native.
///
/// - Parameters:
///   - aosVerb: the aos verb name ("click", "hover", "scroll", "type", "key").
///   - targetString: the raw `browser:...` string for `parseBrowserTarget`.
///   - remaining: positional args after the target (e.g. text to type,
///     "100,200" scroll deltas, or the key combo).
///   - flags: the full original arg list, still containing `--right` /
///     `--double` / similar flag tokens stripped by `positionalArgs(_:)`.
func dispatchBrowserVerb(_ aosVerb: String, targetString: String, remaining: [String], flags: [String]) {
    let pwVerb: String
    switch aosVerb {
    case "key":      pwVerb = "press"
    case "scroll":   pwVerb = "mousewheel"
    case "navigate": pwVerb = "goto"
    default:         pwVerb = aosVerb
    }
    do {
        let t = try parseBrowserTarget(targetString)
        var extra: [String] = []
        switch pwVerb {
        case "click":
            if flags.contains("--right") {
                extra = ["right"]
            } else if flags.contains("--double") {
                // Translate `aos do click --double browser:<s>/<ref>` into
                // playwright's dblclick verb.
                let r = try doVerb("dblclick", target: t)
                try requireSuccess(r, action: "dblclick")
                emitDoResult(r, backend: "playwright", strategy: "playwright_dblclick", stateID: getArg(flags, "--state-id"))
                return
            }
        case "type", "press":
            if remaining.indices.contains(0) {
                extra.append(remaining[0])
            }
        case "mousewheel":
            if remaining.indices.contains(0) {
                let parts = remaining[0].split(separator: ",").map(String.init)
                if parts.count == 2 {
                    extra = [parts[0], parts[1]]
                }
            }
        case "fill":
            // fill requires target.ref to know which element to fill.
            guard t.ref != nil else {
                exitError("aos do fill requires a ref (browser:<session>/<ref>)",
                          code: "INVALID_TARGET")
            }
            if remaining.indices.contains(0) { extra.append(remaining[0]) }
        case "goto":
            if remaining.indices.contains(0) { extra.append(remaining[0]) }
        default:
            break
        }
        let r = try doVerb(pwVerb, target: t, extraArgs: extra)
        try requireSuccess(r, action: pwVerb)
        emitDoResult(r, backend: "playwright", strategy: "playwright_\(pwVerb)", stateID: getArg(flags, "--state-id"))
    } catch BrowserTargetError.invalid(let msg) {
        exitError("invalid browser target: \(msg)", code: "INVALID_TARGET")
    } catch BrowserTargetError.missingSession {
        exitError("PLAYWRIGHT_CLI_SESSION not set", code: "MISSING_SESSION")
    } catch BrowserAdapterError.versionCheckFailed(let msg, let code) {
        exitError(msg, code: code)
    } catch BrowserAdapterError.subprocess(let msg, let code) {
        exitError(msg, code: code)
    } catch {
        exitError("\(error)", code: "INTERNAL")
    }
}

/// Emit the `{status, result}` JSON payload for a PlaywrightResult from a
/// browser-target `do` verb.
func emitDoResult(_ r: PlaywrightResult, backend: String = "playwright", strategy: String = "playwright_do", stateID: String? = nil) {
    struct Payload: Encodable {
        let status: String
        let result: PlaywrightResult
        let execution: ActionExecutionMetadata
    }
    let payload = Payload(
        status: r.exit_code == 0 ? "success" : "error",
        result: r,
        execution: ActionExecutionMetadata(
            strategy: strategy,
            backend: backend,
            fallback_used: false,
            state_id: stateID
        )
    )
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys]
    print(String(data: try! enc.encode(payload), encoding: .utf8)!)
}
