// cli.swift — Standalone CLI commands for hand-off v2.
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
        exitWithError("Profile not found: \(profileName)", code: "PROFILE_NOT_FOUND")
    }
    return SessionState(profile: profile, profileName: profileName)
}

/// Print a v1-compatible legacy response to stdout.
func cliPrintLegacy(action: String, backend: String, target: LegacyTargetInfo, detail: String? = nil, dryRun: Bool) {
    var resp = LegacySuccessResponse(status: dryRun ? "dry_run" : "success", action: action, backend: backend, target: target)
    resp.detail = detail
    writeJSON(resp)
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
                               "--profile", "--value", "--to", "--dy", "--dx", "--window"]
            if valuedFlags.contains(arg) { skipNext = true }
            continue
        }
        result.append(arg)
    }
    return result
}

// MARK: - AX Backend CLI Commands

/// `hand-off press` — press (activate) an AX element.
func cliPress(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitWithError("press requires --pid", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "press failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "press", backend: "ax", target: target, dryRun: false)
}

/// `hand-off set-value` — set the value of an AX element.
func cliSetValue(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitWithError("set-value requires --pid", code: "MISSING_PARAM")
    }
    guard t.role != nil else {
        exitWithError("set-value requires --role", code: "MISSING_PARAM")
    }
    guard let value = getArg(args, "--value") else {
        exitWithError("set-value requires --value", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "set-value failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "set-value", backend: "ax", target: target, dryRun: false)
}

/// `hand-off focus` — focus an AX element.
func cliFocusElement(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let t = axTargetingFields(args: args)

    guard t.pid != nil else {
        exitWithError("focus requires --pid", code: "MISSING_PARAM")
    }
    guard t.role != nil else {
        exitWithError("focus requires --role", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "focus failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "focus", backend: "ax", target: target, dryRun: false)
}

/// `hand-off raise` — raise a window / activate an app.
func cliRaise(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitWithError("raise requires --pid", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "raise failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "raise", backend: "ax", target: target, dryRun: false)
}

/// `hand-off move` — move (reposition) a window via AX. NOT cursor movement.
func cliMove(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitWithError("move requires --pid", code: "MISSING_PARAM")
    }
    guard let toStr = getArg(args, "--to"), let coords = parseCoords(toStr) else {
        exitWithError("move requires --to x,y", code: "MISSING_PARAM")
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
        exitWithError("No window found for pid \(pid)", code: "WINDOW_NOT_FOUND")
    }

    var point = CGPoint(x: coords.0, y: coords.1)
    guard let axValue = AXValueCreate(.cgPoint, &point) else {
        exitWithError("Failed to create AXValue for position", code: "AX_ACTION_FAILED")
    }
    let result = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, axValue)
    if result != .success {
        exitWithError("Failed to set window position (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "move", backend: "ax", target: target, dryRun: false)
}

/// `hand-off resize` — resize a window via AX.
func cliResize(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")

    guard let pid = parseInt(getArg(args, "--pid")) else {
        exitWithError("resize requires --pid", code: "MISSING_PARAM")
    }
    guard let toStr = getArg(args, "--to"), let dims = parseCoords(toStr) else {
        exitWithError("resize requires --to w,h", code: "MISSING_PARAM")
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
        exitWithError("No window found for pid \(pid)", code: "WINDOW_NOT_FOUND")
    }

    var size = CGSize(width: dims.0, height: dims.1)
    guard let axValue = AXValueCreate(.cgSize, &size) else {
        exitWithError("Failed to create AXValue for size", code: "AX_ACTION_FAILED")
    }
    let result = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, axValue)
    if result != .success {
        exitWithError("Failed to set window size (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
    }

    cliPrintLegacy(action: "resize", backend: "ax", target: target, dryRun: false)
}

// MARK: - CGEvent Backend CLI Commands

/// `hand-off click` — click at coordinates.
func cliClick(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitWithError("click requires coordinates (x,y)", code: "MISSING_PARAM")
    }

    let isRight = hasFlag(args, "--right")
    let isDouble = hasFlag(args, "--double")

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
        exitWithError(resp.error ?? "click failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "click", backend: "cgevent", target: target, dryRun: false)
}

/// `hand-off hover` — move cursor to coordinates (NEW in v2).
func cliHover(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitWithError("hover requires coordinates (x,y)", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "hover failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "hover", backend: "cgevent", target: target, dryRun: false)
}

/// `hand-off drag` — drag from one point to another.
func cliDrag(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard positional.count >= 2,
          let from = parseCoords(positional[0]),
          let to = parseCoords(positional[1]) else {
        exitWithError("drag requires two coordinate pairs (x1,y1 x2,y2)", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "drag failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "drag", backend: "cgevent", target: target, dryRun: false)
}

/// `hand-off scroll` — scroll at coordinates.
func cliScroll(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let first = positional.first, let coords = parseCoords(first) else {
        exitWithError("scroll requires coordinates (x,y)", code: "MISSING_PARAM")
    }

    let dx = parseDouble(getArg(args, "--dx"))
    let dy = parseDouble(getArg(args, "--dy"))

    guard dx != nil || dy != nil else {
        exitWithError("scroll requires at least one of --dx or --dy", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "scroll failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "scroll", backend: "cgevent", target: target, dryRun: false)
}

/// `hand-off type` — type text string.
func cliType(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let text = positional.first else {
        exitWithError("type requires a text argument", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "type failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "type", backend: "cgevent", target: target, dryRun: false)
}

/// `hand-off key` — press a key combo (e.g. cmd+s).
func cliKey(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let state = cliSessionState(args: args)
    let positional = positionalArgs(args)

    guard let combo = positional.first else {
        exitWithError("key requires a key combo argument (e.g. cmd+s)", code: "MISSING_PARAM")
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
        exitWithError(resp.error ?? "key failed", code: resp.code ?? "UNKNOWN")
    }
    cliPrintLegacy(action: "key", backend: "cgevent", target: target, dryRun: false)
}

// MARK: - AppleScript CLI Command

/// `hand-off tell` — run AppleScript tell block. Uses NSAppleScript directly for v1 compat with result output.
func cliTell(args: [String]) {
    let dryRun = hasFlag(args, "--dry-run")
    let positional = positionalArgs(args)

    guard positional.count >= 2 else {
        exitWithError("tell requires an app name and a script body", code: "MISSING_PARAM")
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
        exitWithError(msg, code: "APPLESCRIPT_FAILED")
    }

    let detail = result?.stringValue
    cliPrintLegacy(action: "tell", backend: "applescript", target: target, detail: detail, dryRun: false)
}

// MARK: - Help Text

func printUsage() {
    let usage = """
    hand-off v2 — macOS actuator CLI

    USAGE: hand-off <command> [options]

    COMMANDS (CGEvent backend):
      click <x,y>                   Click at coordinates
          --right                   Right-click instead of left
          --double                  Double-click
      hover <x,y>                   Move cursor to coordinates
      drag <x1,y1> <x2,y2>         Drag from one point to another
      scroll <x,y>                  Scroll at coordinates
          --dx <n>                  Horizontal scroll amount (pixels)
          --dy <n>                  Vertical scroll amount (pixels)
      type <text>                   Type text string
      key <combo>                   Press key combo (e.g. cmd+s, ctrl+shift+tab)

    COMMANDS (AX backend):
      press                         Press (activate) a UI element
      set-value                     Set element value (--role and --value required)
      focus                         Focus a UI element (--role required)
      raise                         Raise a window / activate app (--pid required)
          --window <id>             Target specific window by CGWindowID
      move                          Move (reposition) a window (--pid, --to required)
          --to <x,y>               Target position
          --window <id>             Target specific window
      resize                        Resize a window (--pid, --to required)
          --to <w,h>               Target size
          --window <id>             Target specific window

    COMMANDS (AppleScript backend):
      tell <app> <script>           Run AppleScript tell block

    SESSION MODE:
      session                       Start ndjson session (stdin/stdout)
          --profile <name>          Behavior profile (default: natural)

    PROFILES:
      profiles                      List available profiles (JSON)
      profiles show <name>          Show full profile (JSON, pretty-printed)

    ELEMENT TARGETING (AX commands):
      --pid <n>                     Target process ID (required for AX commands)
      --role <role>                 AX role (e.g. AXButton, AXTextField)
      --title <text>                AX title attribute
      --label <text>                AX description/label attribute
      --identifier <text>           AX identifier attribute
      --index <n>                   N-th match (0-based) when multiple elements match
      --near <x,y>                  Disambiguate by proximity to point
      --match <mode>                Matching mode: exact (default), contains, regex
      --depth <n>                   Max AX tree traversal depth (default: 20)
      --timeout <ms>                AX search timeout in milliseconds (default: 5000)

    COORDINATES:
      Coordinates are global CG screen coordinates (origin top-left).
      Format: x,y (no spaces). Example: 450,320

    PROFILES:
      --profile <name>              Use a behavior profile for timing/motion
      Built-in: natural (default). Custom: ~/.config/hand-off/profiles/<name>.json

    SAFETY:
      --dry-run                     Show what would happen without doing it

    JSON OUTPUT:
      All output is JSON. Success to stdout, errors to stderr (exit 1).
      Session mode uses ndjson (one JSON object per line).

    EXAMPLES:
      hand-off click 450,320 --dry-run
      hand-off press --pid 1234 --role AXButton --title "Save"
      hand-off type "hello world"
      hand-off key cmd+s
      hand-off tell Safari 'open location "https://example.com"'
      hand-off move --pid 1234 --to 100,100
      hand-off resize --pid 1234 --to 800,600
      echo '{"action":"click","x":100,"y":200}' | hand-off session
    """
    print(usage)
}
