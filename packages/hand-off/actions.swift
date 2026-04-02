// actions.swift — Session-mode action handlers for hand-off v2.
// Each handler takes (ActionRequest, SessionState) -> ActionResponse and never kills the session on error.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Private Helpers

/// Build a success response carrying current cursor, modifiers, context, and timing.
private func okResponse(_ action: String, state: SessionState, start: Date, extra: ((inout ActionResponse) -> Void)? = nil) -> ActionResponse {
    let elapsed = Int(Date().timeIntervalSince(start) * 1000)
    var resp = ActionResponse(
        status: "ok",
        action: action,
        cursor: state.cursor,
        modifiers: state.modifiers.sorted(),
        context: state.contextSnapshot(),
        duration_ms: elapsed
    )
    extra?(&resp)
    return resp
}

/// Build an error response carrying current cursor, modifiers, context, and the error details.
private func errorResponse(_ action: String, state: SessionState, message: String, code: String) -> ActionResponse {
    return ActionResponse(
        status: "error",
        action: action,
        cursor: state.cursor,
        modifiers: state.modifiers.sorted(),
        context: state.contextSnapshot(),
        duration_ms: nil,
        error: message,
        code: code
    )
}

/// Build CGEventFlags from all currently held modifiers in session state.
private func currentFlags(_ state: SessionState) -> CGEventFlags {
    var flags = CGEventFlags()
    for mod in state.modifiers {
        if let f = flagsForModifier(mod) {
            flags.insert(f)
        }
    }
    return flags
}

/// Canonical modifier name — normalizes aliases so the modifiers set is consistent.
private func canonicalModifier(_ name: String) -> String {
    let lower = name.lowercased()
    switch lower {
    case "command": return "cmd"
    case "option":  return "alt"
    case "opt":     return "alt"
    case "control": return "ctrl"
    default:        return lower
    }
}

/// All canonical modifier names that share the same CGEventFlags as the given name.
/// Used when releasing a modifier to ensure all aliases are cleared.
private func allAliases(for name: String) -> [String] {
    guard let entry = modifierMap[name.lowercased()] else { return [name.lowercased()] }
    let flag = entry.flag
    return modifierMap.compactMap { (key, value) in
        value.flag == flag ? canonicalModifier(key) : nil
    }
}

// MARK: - CGEvent Action Handlers

/// Move cursor to (req.x, req.y) along a profile-driven Bezier curve.
func handleMove(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard let target = resolveActionCoordinates(req, state: state) else {
        return errorResponse("move", state: state, message: "Missing or unresolvable x,y coordinates", code: "INVALID_COORDS")
    }

    let from = CGPoint(x: state.cursor.x, y: state.cursor.y)
    let dx = Double(target.x - from.x)
    let dy = Double(target.y - from.y)
    let dist = sqrt(dx * dx + dy * dy)

    // Calculate step count from distance and profile speed
    let duration = dist / profile.mouse.pixels_per_second  // seconds
    let stepInterval = 0.008 // ~125 Hz — smooth enough for CG
    let steps = max(1, Int(duration / stepInterval))

    let points = bezierPath(from: from, to: target, steps: steps, overshoot: profile.mouse.overshoot, jitter: profile.mouse.jitter)

    let source = CGEventSource(stateID: .hidSystemState)
    for pt in points {
        if let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved,
                               mouseCursorPosition: pt, mouseButton: .left) {
            event.flags = currentFlags(state)
            event.post(tap: .cghidEventTap)
        }
        usleep(UInt32(stepInterval * 1_000_000))
    }

    state.updateCursor(target)
    return okResponse("move", state: state, start: start)
}

/// Click at (req.x, req.y). Moves to target first if cursor is more than 2px away.
func handleClick(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    // Resolve click position: explicit coords or current cursor
    let clickPoint: CGPoint
    if req.x != nil && req.y != nil {
        guard let resolved = resolveActionCoordinates(req, state: state) else {
            return errorResponse("click", state: state, message: "Unresolvable x,y coordinates", code: "INVALID_COORDS")
        }
        clickPoint = resolved
    } else {
        clickPoint = CGPoint(x: state.cursor.x, y: state.cursor.y)
    }

    // Move to target if cursor is far away
    let curPos = CGPoint(x: state.cursor.x, y: state.cursor.y)
    let moveDx = Double(clickPoint.x - curPos.x)
    let moveDy = Double(clickPoint.y - curPos.y)
    let moveDist = sqrt(moveDx * moveDx + moveDy * moveDy)
    if moveDist > 2.0 {
        let moveReq = ActionRequest(action: "move", x: Double(clickPoint.x), y: Double(clickPoint.y))
        let moveResult = handleMove(moveReq, state: state)
        if moveResult.status == "error" { return moveResult }
    }

    // Determine button and event types
    let isRight = req.button == "right"
    let downType: CGEventType = isRight ? .rightMouseDown : .leftMouseDown
    let upType: CGEventType = isRight ? .rightMouseUp : .leftMouseUp
    let cgButton: CGMouseButton = isRight ? .right : .left
    let clickCount = req.count ?? 1

    let source = CGEventSource(stateID: .hidSystemState)
    let flags = currentFlags(state)

    for i in 1...clickCount {
        guard let down = CGEvent(mouseEventSource: source, mouseType: downType,
                                 mouseCursorPosition: clickPoint, mouseButton: cgButton) else { continue }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        down.flags = flags
        down.post(tap: .cghidEventTap)

        usleep(sampleDelay(profile.timing.click_dwell))

        guard let up = CGEvent(mouseEventSource: source, mouseType: upType,
                               mouseCursorPosition: clickPoint, mouseButton: cgButton) else { continue }
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        up.flags = flags
        up.post(tap: .cghidEventTap)

        // Small gap between multi-clicks
        if i < clickCount {
            usleep(sampleDelay(profile.timing.click_dwell))
        }
    }

    state.updateCursor(clickPoint)
    return okResponse("click", state: state, start: start)
}

/// Drag from req.from (or current cursor) to req.x, req.y along a Bezier curve.
func handleDrag(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    // Resolve destination
    guard let target = resolveActionCoordinates(req, state: state) else {
        return errorResponse("drag", state: state, message: "Missing or unresolvable x,y coordinates for drag destination", code: "INVALID_COORDS")
    }

    // Resolve origin
    let origin: CGPoint
    if let fromPos = req.from {
        guard let resolved = resolveCoordinates(x: fromPos.x, y: fromPos.y, context: state.context) else {
            return errorResponse("drag", state: state, message: "Unresolvable from coordinates", code: "INVALID_COORDS")
        }
        origin = resolved
    } else {
        origin = CGPoint(x: state.cursor.x, y: state.cursor.y)
    }

    // Move to origin if needed
    let curPos = CGPoint(x: state.cursor.x, y: state.cursor.y)
    let originDx = Double(origin.x - curPos.x)
    let originDy = Double(origin.y - curPos.y)
    if sqrt(originDx * originDx + originDy * originDy) > 2.0 {
        let moveReq = ActionRequest(action: "move", x: Double(origin.x), y: Double(origin.y))
        let moveResult = handleMove(moveReq, state: state)
        if moveResult.status == "error" { return moveResult }
    }

    let source = CGEventSource(stateID: .hidSystemState)
    let flags = currentFlags(state)

    // Mouse down at origin
    guard let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown,
                             mouseCursorPosition: origin, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouseDown event", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    down.post(tap: .cghidEventTap)

    // Bezier path from origin to target
    let dx = Double(target.x - origin.x)
    let dy = Double(target.y - origin.y)
    let dist = sqrt(dx * dx + dy * dy)
    let duration = dist / profile.mouse.pixels_per_second
    let stepInterval = 0.008
    let steps = max(1, Int(duration / stepInterval))

    let points = bezierPath(from: origin, to: target, steps: steps, overshoot: 0, jitter: profile.mouse.jitter)

    for pt in points {
        if let drag = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged,
                              mouseCursorPosition: pt, mouseButton: .left) {
            drag.flags = flags
            drag.post(tap: .cghidEventTap)
        }
        usleep(UInt32(stepInterval * 1_000_000))
    }

    // Mouse up at target
    guard let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp,
                           mouseCursorPosition: target, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouseUp event", code: "CGEVENT_FAILED")
    }
    up.flags = flags
    up.post(tap: .cghidEventTap)

    state.updateCursor(target)
    return okResponse("drag", state: state, start: start)
}

/// Scroll at (req.x, req.y) or current cursor with req.dx/req.dy.
func handleScroll(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard req.dx != nil || req.dy != nil else {
        return errorResponse("scroll", state: state, message: "At least one of dx or dy is required", code: "MISSING_PARAM")
    }

    // Resolve scroll position (move cursor there first)
    if req.x != nil && req.y != nil {
        guard let scrollPos = resolveActionCoordinates(req, state: state) else {
            return errorResponse("scroll", state: state, message: "Unresolvable x,y coordinates for scroll position", code: "INVALID_COORDS")
        }
        let curPos = CGPoint(x: state.cursor.x, y: state.cursor.y)
        let moveDx = Double(scrollPos.x - curPos.x)
        let moveDy = Double(scrollPos.y - curPos.y)
        if sqrt(moveDx * moveDx + moveDy * moveDy) > 2.0 {
            let moveReq = ActionRequest(action: "move", x: Double(scrollPos.x), y: Double(scrollPos.y))
            let moveResult = handleMove(moveReq, state: state)
            if moveResult.status == "error" { return moveResult }
        }
    }

    let totalDx = Int32(req.dx ?? 0)
    let totalDy = Int32(req.dy ?? 0)
    let eventCount = profile.scroll.events_per_action
    let decel = profile.scroll.deceleration
    let intervalUs = UInt32(profile.scroll.interval_ms) * 1000

    // Distribute scroll across events with deceleration
    // Weight each event: w_i = decel^i, then normalize
    var weights: [Double] = []
    var weightSum = 0.0
    for i in 0..<eventCount {
        let w = pow(decel, Double(i))
        weights.append(w)
        weightSum += w
    }

    let source = CGEventSource(stateID: .hidSystemState)
    for i in 0..<eventCount {
        let fraction = weights[i] / weightSum
        let evDy = Int32(Double(totalDy) * fraction)
        let evDx = Int32(Double(totalDx) * fraction)

        if let scroll = CGEvent(scrollWheelEvent2Source: source, units: .pixel,
                                wheelCount: 2, wheel1: evDy, wheel2: evDx, wheel3: 0) {
            scroll.post(tap: .cghidEventTap)
        }
        usleep(intervalUs)
    }

    return okResponse("scroll", state: state, start: start)
}

/// Press and hold a key. If it is a modifier, add to state.modifiers.
func handleKeyDown(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let keyName = req.key else {
        return errorResponse("key_down", state: state, message: "Missing 'key' field", code: "MISSING_PARAM")
    }

    let lower = keyName.lowercased()

    // Check if this is a modifier key
    if let mod = modifierMap[lower] {
        state.modifiers.insert(canonicalModifier(lower))
        let source = CGEventSource(stateID: .hidSystemState)
        if let event = CGEvent(keyboardEventSource: source, virtualKey: mod.keyCode, keyDown: true) {
            event.flags = currentFlags(state)
            event.post(tap: .cghidEventTap)
        }
        return okResponse("key_down", state: state, start: start)
    }

    // Regular key
    guard let keyCode = keyCodeMap[lower] else {
        return errorResponse("key_down", state: state, message: "Unknown key: \(keyName)", code: "UNKNOWN_KEY")
    }

    let source = CGEventSource(stateID: .hidSystemState)
    if let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true) {
        event.flags = currentFlags(state)
        event.post(tap: .cghidEventTap)
    }

    return okResponse("key_down", state: state, start: start)
}

/// Release a key. If modifier, remove all aliases from state.modifiers.
func handleKeyUp(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let keyName = req.key else {
        return errorResponse("key_up", state: state, message: "Missing 'key' field", code: "MISSING_PARAM")
    }

    let lower = keyName.lowercased()

    // Check if this is a modifier key
    if let mod = modifierMap[lower] {
        // Remove ALL aliases that share the same flag
        let aliases = allAliases(for: lower)
        for alias in aliases {
            state.modifiers.remove(alias)
        }
        let source = CGEventSource(stateID: .hidSystemState)
        if let event = CGEvent(keyboardEventSource: source, virtualKey: mod.keyCode, keyDown: false) {
            event.flags = currentFlags(state)
            event.post(tap: .cghidEventTap)
        }
        return okResponse("key_up", state: state, start: start)
    }

    // Regular key
    guard let keyCode = keyCodeMap[lower] else {
        return errorResponse("key_up", state: state, message: "Unknown key: \(keyName)", code: "UNKNOWN_KEY")
    }

    let source = CGEventSource(stateID: .hidSystemState)
    if let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
        event.flags = currentFlags(state)
        event.post(tap: .cghidEventTap)
    }

    return okResponse("key_up", state: state, start: start)
}

/// Press and release a key combo (e.g. "cmd+shift+tab"). Uses parseKeyCombo from helpers.
func handleKeyTap(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard let keyName = req.key else {
        return errorResponse("key_tap", state: state, message: "Missing 'key' field", code: "MISSING_PARAM")
    }

    guard let (keyCode, comboFlags) = parseKeyCombo(keyName) else {
        return errorResponse("key_tap", state: state, message: "Unknown key combo: \(keyName)", code: "UNKNOWN_KEY")
    }

    // Combine combo flags with currently held modifiers
    var flags = comboFlags
    flags.insert(currentFlags(state))

    let source = CGEventSource(stateID: .hidSystemState)

    // Key down
    if let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true) {
        down.flags = flags
        down.post(tap: .cghidEventTap)
    }

    usleep(sampleDelay(profile.timing.keystroke_delay))

    // Key up
    if let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) {
        up.flags = flags
        up.post(tap: .cghidEventTap)
    }

    return okResponse("key_tap", state: state, start: start)
}

/// Type text character by character with profile-driven cadence.
func handleType(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard let text = req.text, !text.isEmpty else {
        return errorResponse("type", state: state, message: "Missing or empty 'text' field", code: "MISSING_PARAM")
    }

    let cadence = profile.timing.typing_cadence
    // Base interval from WPM: average word is 5 chars, so chars/sec = wpm * 5 / 60
    let charsPerSecond = Double(cadence.wpm) * 5.0 / 60.0
    let baseIntervalMs = 1000.0 / charsPerSecond

    let source = CGEventSource(stateID: .hidSystemState)
    let flags = currentFlags(state)

    for char in text {
        // Create a Unicode key event
        var utf16 = Array(String(char).utf16)
        if let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            down.flags = flags
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            up.flags = flags
            up.post(tap: .cghidEventTap)
        }

        // Cadence: apply variance
        let variance = cadence.variance
        let jitteredInterval = baseIntervalMs * (1.0 + Double.random(in: -variance...variance))
        usleep(UInt32(max(1.0, jitteredInterval)) * 1000)

        // Extra pause after whitespace
        if char.isWhitespace, let pauseRange = cadence.pause_after_word {
            usleep(sampleDelay(pauseRange))
        }
    }

    return okResponse("type", state: state, start: start)
}

// MARK: - AX Action Handlers

/// Press (activate) an AX element matching the query.
func handlePress(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("press", state: state, message: "Accessibility permission not granted", code: "AX_NOT_TRUSTED")
    }

    let query = ElementQuery(from: req, context: state.context, profile: state.profile)

    switch findElement(query: query) {
    case .found(let element):
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            return errorResponse("press", state: state, message: "AXPress failed with code \(result.rawValue)", code: "AX_ACTION_FAILED")
        }
        return okResponse("press", state: state, start: start)
    case .notFound(let msg):
        return errorResponse("press", state: state, message: msg, code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("press", state: state, message: "Timed out searching for element", code: "AX_TIMEOUT")
    }
}

/// Set the value of an AX element. req.value is the NEW value, not a search criterion.
func handleSetValue(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("set_value", state: state, message: "Accessibility permission not granted", code: "AX_NOT_TRUSTED")
    }

    guard let newValue = req.value else {
        return errorResponse("set_value", state: state, message: "Missing 'value' field", code: "MISSING_PARAM")
    }

    // Build query without value — value is the payload, not a search criterion
    let searchReq = ActionRequest(
        action: req.action,
        pid: req.pid,
        role: req.role,
        title: req.title,
        label: req.label,
        identifier: req.identifier,
        value: nil,
        index: req.index,
        near: req.near,
        match: req.match,
        depth: req.depth,
        timeout: req.timeout
    )
    let query = ElementQuery(from: searchReq, context: state.context, profile: state.profile)

    switch findElement(query: query) {
    case .found(let element):
        // Check if value attribute is settable
        var settable: DarwinBoolean = false
        let settableResult = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        if settableResult != .success {
            return errorResponse("set_value", state: state,
                message: "Cannot check if value is settable (AX error \(settableResult.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard settable.boolValue else {
            return errorResponse("set_value", state: state,
                message: "Value attribute is not settable on this element", code: "AX_NOT_SETTABLE")
        }

        let setResult = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, newValue as CFTypeRef)
        if setResult != .success {
            return errorResponse("set_value", state: state,
                message: "Failed to set value (AX error \(setResult.rawValue))", code: "AX_ACTION_FAILED")
        }
        return okResponse("set_value", state: state, start: start)

    case .notFound(let msg):
        return errorResponse("set_value", state: state, message: msg, code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("set_value", state: state, message: "Timed out searching for element", code: "AX_TIMEOUT")
    }
}

/// Focus an AX element by setting kAXFocusedAttribute to true.
func handleFocus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("focus", state: state, message: "Accessibility permission not granted", code: "AX_NOT_TRUSTED")
    }

    let query = ElementQuery(from: req, context: state.context, profile: state.profile)

    switch findElement(query: query) {
    case .found(let element):
        let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
        if result != .success {
            return errorResponse("focus", state: state,
                message: "Failed to set focus (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        return okResponse("focus", state: state, start: start)
    case .notFound(let msg):
        return errorResponse("focus", state: state, message: msg, code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("focus", state: state, message: "Timed out searching for element", code: "AX_TIMEOUT")
    }
}

/// Raise a window: activate its app, then raise the window via AX.
func handleRaise(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let pid = req.pid ?? state.context.pid else {
        return errorResponse("raise", state: state, message: "No pid specified (in request or context)", code: "MISSING_PARAM")
    }

    let pidT = pid_t(pid)

    // Activate the application
    guard let app = NSRunningApplication(processIdentifier: pidT) else {
        return errorResponse("raise", state: state, message: "No running application with pid \(pid)", code: "APP_NOT_FOUND")
    }
    app.activate()

    // Find the window to raise
    let window: AXUIElement?
    if let wid = req.window_id ?? state.context.window_id {
        window = findWindowByID(pid: pidT, windowID: wid)
    } else {
        window = findFirstWindow(pid: pidT)
    }

    if let win = window {
        AXUIElementPerformAction(win, kAXRaiseAction as CFString)
    }

    return okResponse("raise", state: state, start: start)
}

// MARK: - AppleScript Handler

/// Execute an AppleScript tell block: tell application "<app>" to <script>.
func handleTell(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let appName = req.app else {
        return errorResponse("tell", state: state, message: "Missing 'app' field", code: "MISSING_PARAM")
    }
    guard let scriptBody = req.script else {
        return errorResponse("tell", state: state, message: "Missing 'script' field", code: "MISSING_PARAM")
    }

    let source = "tell application \"\(appName)\" to \(scriptBody)"
    let script = NSAppleScript(source: source)
    var errorDict: NSDictionary?
    _ = script?.executeAndReturnError(&errorDict)

    if let err = errorDict {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "AppleScript execution failed"
        return errorResponse("tell", state: state, message: msg, code: "APPLESCRIPT_FAILED")
    }

    return okResponse("tell", state: state, start: start)
}

// MARK: - Meta Handlers

/// Return session status: cursor, modifiers, context, profile, uptime, bound_channel.
func handleStatus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    return okResponse("status", state: state, start: start) { resp in
        resp.profile = state.profileName
        resp.session_uptime_s = Date().timeIntervalSince(state.startTime)
        resp.bound_channel = state.boundChannel
    }
}

// MARK: - Action Introspection

/// Map AX action names to hand-off session verbs.
let axActionToVerb: [String: String] = [
    "AXPress": "press",
    "AXConfirm": "press",
    "AXCancel": "press",
    "AXRaise": "raise",
    "AXShowMenu": "right_click",
    "AXIncrement": "set_value",
    "AXDecrement": "set_value",
    "AXPick": "press",
]

/// List available actions for the currently bound channel's elements plus global actions.
func handleListActions(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    guard state.boundChannel != nil else {
        return errorResponse("list_actions", state: state, message: "Not bound to a channel. Use bind first.", code: "NOT_BOUND")
    }

    var available: [AvailableAction] = []

    for elem in state.channelElements {
        // Map AX actions to hand-off verbs
        var verbs = Set<String>()
        for axAction in elem.actions {
            if let verb = axActionToVerb[axAction] {
                verbs.insert(verb)
            }
        }
        // All visible elements can be clicked and right-clicked
        verbs.insert("click")
        verbs.insert("right_click")

        available.append(AvailableAction(
            element: ElementRef(role: elem.role, title: elem.title),
            actions: Array(verbs).sorted()
        ))
    }

    // Global actions always available (no element required)
    available.append(AvailableAction(
        global: true,
        actions: ["key_down", "key_tap", "key_up", "move", "scroll", "type"]
    ))

    return okResponse("list_actions", state: state, start: start) { resp in
        resp.available = available
        resp.bound_channel = state.boundChannel
    }
}

/// End session: release all held modifier keys, clear state, return final response.
func handleEnd(state: SessionState) -> ActionResponse {
    let start = Date()

    // Release all held modifiers by posting keyUp events
    let source = CGEventSource(stateID: .hidSystemState)
    for mod in state.modifiers {
        if let entry = modifierMap[mod] {
            if let event = CGEvent(keyboardEventSource: source, virtualKey: entry.keyCode, keyDown: false) {
                event.post(tap: .cghidEventTap)
            }
        }
    }
    state.modifiers.removeAll()

    return okResponse("end", state: state, start: start)
}
