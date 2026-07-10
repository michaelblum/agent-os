// actions.swift — Session-mode action handlers for `aos do`.
// Each handler takes (ActionRequest, SessionState) -> ActionResponse and never kills the session on error.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Private Helpers

/// Build a success response carrying current cursor, modifiers, context, and timing.
private func okResponse(
    _ action: String,
    state: SessionState,
    start: Date,
    backend: String = "session",
    strategy: String? = nil,
    fallbackUsed: Bool = false,
    stateID: String? = nil,
    terminalReceiptID: String? = nil,
    extra: ((inout ActionResponse) -> Void)? = nil
) -> ActionResponse {
    let elapsed = Int(Date().timeIntervalSince(start) * 1000)
    var resp = ActionResponse(
        status: "ok",
        action: action,
        cursor: state.cursor,
        modifiers: state.modifiers.sorted(),
        context: state.contextSnapshot(),
        duration_ms: elapsed
    )
    resp.execution = ActionExecutionMetadata(
        strategy: strategy ?? "\(backend)_\(action)",
        backend: backend,
        fallback_used: fallbackUsed,
        state_id: stateID
    )
    resp.execution?.terminal_event_receipt = terminalReceiptID
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

private func inputDeliveryError(_ action: String, state: SessionState) -> ActionResponse {
    errorResponse(
        action,
        state: state,
        message: "Terminal input event was not observed before the delivery deadline",
        code: "CGEVENT_DELIVERY_UNCONFIRMED"
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

private struct FrontmostAppSnapshot {
    let pid: pid_t
    let name: String
    let app: NSRunningApplication

    static func current() -> FrontmostAppSnapshot? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        return FrontmostAppSnapshot(
            pid: app.processIdentifier,
            name: app.localizedName ?? "Unknown",
            app: app
        )
    }
}

private struct ForegroundRestorationResult {
    let before: FrontmostAppSnapshot?
    let after: FrontmostAppSnapshot?
    let attempted: Bool
    let success: Bool
    let preservation: String
}

private func waitForFrontmostPID(_ pid: pid_t, timeoutMs: Int = 500) -> FrontmostAppSnapshot? {
    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
    repeat {
        if let current = FrontmostAppSnapshot.current(), current.pid == pid {
            return current
        }
        usleep(25_000)
    } while Date() < deadline
    return FrontmostAppSnapshot.current()
}

private func restoreForegroundIfNeeded(_ before: FrontmostAppSnapshot?) -> ForegroundRestorationResult {
    guard let before else {
        return ForegroundRestorationResult(
            before: nil,
            after: FrontmostAppSnapshot.current(),
            attempted: false,
            success: false,
            preservation: "unknown"
        )
    }

    guard let immediateAfter = FrontmostAppSnapshot.current() else {
        return ForegroundRestorationResult(
            before: before,
            after: nil,
            attempted: false,
            success: false,
            preservation: "unknown"
        )
    }

    if immediateAfter.pid == before.pid {
        return ForegroundRestorationResult(
            before: before,
            after: immediateAfter,
            attempted: false,
            success: true,
            preservation: "preserved"
        )
    }

    let attempted = before.app.activate(options: [.activateAllWindows])
    let final = waitForFrontmostPID(before.pid)
    let success = final?.pid == before.pid
    return ForegroundRestorationResult(
        before: before,
        after: final,
        attempted: true,
        success: success,
        preservation: success ? "restored" : "changed_unrestored"
    )
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

    let stepInterval = 0.008 // ~125 Hz — smooth enough for CG
    let steps = safeMotionStepCount(
        distance: dist,
        pixelsPerSecond: profile.mouse.pixels_per_second,
        stepInterval: stepInterval
    )
    let overshoot = safeNonNegativeDouble(profile.mouse.overshoot)
    let jitter = safeNonNegativeDouble(profile.mouse.jitter)

    let points = bezierPath(from: from, to: target, steps: steps, overshoot: overshoot, jitter: jitter)

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("move", state: state)
    }
    for (index, pt) in points.enumerated() {
        guard let event = CGEvent(mouseEventSource: owner.source, mouseType: .mouseMoved,
                                  mouseCursorPosition: pt, mouseButton: .left) else {
            return errorResponse("move", state: state, message: "Failed to create mouseMoved event", code: "CGEVENT_FAILED")
        }
        event.flags = currentFlags(state)
        let isTerminal = index == points.count - 1
        if !owner.post(event, receipt: isTerminal ? receipt : nil, awaitReceipt: isTerminal) {
            return inputDeliveryError("move", state: state)
        }
        usleep(UInt32(stepInterval * 1_000_000))
    }

    state.updateCursor(target)
    return okResponse("move", state: state, start: start, backend: "cgevent", strategy: "cgevent_move", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Click at (req.x, req.y). Moves to target first if cursor is more than 2px away.
func handleClick(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile
    let clickCount = req.count ?? 1

    guard clickCount > 0 else {
        return errorResponse("click", state: state, message: "Click count must be greater than zero", code: "INVALID_COUNT")
    }

    // Resolve click position: explicit coords, channel element, or current cursor
    let clickPoint: CGPoint
    if req.x != nil && req.y != nil {
        guard let resolved = resolveActionCoordinates(req, state: state) else {
            return errorResponse("click", state: state, message: "Unresolvable x,y coordinates", code: "INVALID_COORDS")
        }
        clickPoint = resolved
    } else if let channelPoint = resolveChannelElement(req, state: state) {
        // Bound to channel and targeting fields matched an element — use its center
        clickPoint = channelPoint
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

    let owner = state.eventPostingOwner
    let flags = currentFlags(state)
    var terminalReceipt: AOSInputPostReceipt?

    for i in 1...clickCount {
        guard let receipt = owner.makeReceipt() else {
            return inputDeliveryError("click", state: state)
        }
        guard let down = CGEvent(mouseEventSource: owner.source, mouseType: downType,
                                 mouseCursorPosition: clickPoint, mouseButton: cgButton) else {
            return errorResponse("click", state: state, message: "Failed to create mouseDown event", code: "CGEVENT_FAILED")
        }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        down.flags = flags
        owner.post(down, receipt: receipt)

        usleep(sampleDelay(profile.timing.click_dwell))

        guard let up = CGEvent(mouseEventSource: owner.source, mouseType: upType,
                               mouseCursorPosition: clickPoint, mouseButton: cgButton) else {
            return errorResponse("click", state: state, message: "Failed to create mouseUp event", code: "CGEVENT_FAILED")
        }
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        up.flags = flags
        if !owner.post(up, receipt: receipt, awaitReceipt: true) {
            return inputDeliveryError("click", state: state)
        }
        terminalReceipt = receipt

        // Small gap between multi-clicks
        if i < clickCount {
            usleep(sampleDelay(profile.timing.click_dwell))
        }
    }

    state.updateCursor(clickPoint)
    return okResponse("click", state: state, start: start, backend: "cgevent", strategy: "cgevent_click", stateID: req.state_id, terminalReceiptID: terminalReceipt?.id)
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

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("drag", state: state)
    }
    let flags = currentFlags(state)

    // Mouse down at origin
    guard let down = CGEvent(mouseEventSource: owner.source, mouseType: .leftMouseDown,
                             mouseCursorPosition: origin, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouseDown event", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    owner.post(down, receipt: receipt)

    // Bezier path from origin to target
    let dx = Double(target.x - origin.x)
    let dy = Double(target.y - origin.y)
    let dist = sqrt(dx * dx + dy * dy)
    let stepInterval = 0.008
    let steps = safeMotionStepCount(
        distance: dist,
        pixelsPerSecond: profile.mouse.pixels_per_second,
        stepInterval: stepInterval
    )
    let jitter = safeNonNegativeDouble(profile.mouse.jitter)

    let points = bezierPath(from: origin, to: target, steps: steps, overshoot: 0, jitter: jitter)

    for pt in points {
        if let drag = CGEvent(mouseEventSource: owner.source, mouseType: .leftMouseDragged,
                              mouseCursorPosition: pt, mouseButton: .left) {
            drag.flags = flags
            owner.post(drag, receipt: receipt)
        }
        usleep(UInt32(stepInterval * 1_000_000))
    }

    // Mouse up at target
    guard let up = CGEvent(mouseEventSource: owner.source, mouseType: .leftMouseUp,
                           mouseCursorPosition: target, mouseButton: .left) else {
        return errorResponse("drag", state: state, message: "Failed to create mouseUp event", code: "CGEVENT_FAILED")
    }
    up.flags = flags
    if !owner.post(up, receipt: receipt, awaitReceipt: true) {
        return inputDeliveryError("drag", state: state)
    }

    state.updateCursor(target)
    return okResponse("drag", state: state, start: start, backend: "cgevent", strategy: "cgevent_drag", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Scroll at (req.x, req.y) or current cursor with req.dx/req.dy.
func handleScroll(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard req.dx != nil || req.dy != nil else {
        return errorResponse("scroll", state: state, message: "At least one of dx or dy is required", code: "MISSING_ARG")
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
    guard eventCount > 0 else {
        return errorResponse("scroll", state: state, message: "Scroll profile must emit at least one event", code: "INVALID_PROFILE")
    }
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

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("scroll", state: state)
    }
    for i in 0..<eventCount {
        let fraction = weights[i] / weightSum
        let evDy = Int32(Double(totalDy) * fraction)
        let evDx = Int32(Double(totalDx) * fraction)

        guard let scroll = CGEvent(scrollWheelEvent2Source: owner.source, units: .pixel,
                                   wheelCount: 2, wheel1: evDy, wheel2: evDx, wheel3: 0) else {
            return errorResponse("scroll", state: state, message: "Failed to create scroll event", code: "CGEVENT_FAILED")
        }
        let isTerminal = i == eventCount - 1
        if !owner.post(scroll, receipt: isTerminal ? receipt : nil, awaitReceipt: isTerminal) {
            return inputDeliveryError("scroll", state: state)
        }
        usleep(intervalUs)
    }

    return okResponse("scroll", state: state, start: start, backend: "cgevent", strategy: "cgevent_scroll", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Press and hold a key. If it is a modifier, add to state.modifiers.
func handleKeyDown(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let keyName = req.key else {
        return errorResponse("key_down", state: state, message: "Missing 'key' field", code: "MISSING_ARG")
    }

    let lower = keyName.lowercased()

    // Check if this is a modifier key
    if let mod = modifierMap[lower] {
        let owner = state.eventPostingOwner
        guard let receipt = owner.makeReceipt() else {
            return inputDeliveryError("key_down", state: state)
        }
        guard let event = CGEvent(keyboardEventSource: owner.source, virtualKey: mod.keyCode, keyDown: true) else {
            return errorResponse("key_down", state: state, message: "Failed to create keyDown event", code: "CGEVENT_FAILED")
        }
        let modifier = canonicalModifier(lower)
        state.modifiers.insert(modifier)
        event.flags = currentFlags(state)
        if !owner.post(event, receipt: receipt, awaitReceipt: true) {
            state.modifiers.remove(modifier)
            return inputDeliveryError("key_down", state: state)
        }
        return okResponse("key_down", state: state, start: start, backend: "cgevent", strategy: "cgevent_key_down", stateID: req.state_id, terminalReceiptID: receipt.id)
    }

    // Regular key
    guard let keyCode = keyCodeMap[lower] else {
        return errorResponse("key_down", state: state, message: "Unknown key: \(keyName)", code: "INVALID_KEY")
    }

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("key_down", state: state)
    }
    guard let event = CGEvent(keyboardEventSource: owner.source, virtualKey: keyCode, keyDown: true) else {
        return errorResponse("key_down", state: state, message: "Failed to create keyDown event", code: "CGEVENT_FAILED")
    }
    event.flags = currentFlags(state)
    if !owner.post(event, receipt: receipt, awaitReceipt: true) {
        return inputDeliveryError("key_down", state: state)
    }

    return okResponse("key_down", state: state, start: start, backend: "cgevent", strategy: "cgevent_key_down", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Release a key. If modifier, remove all aliases from state.modifiers.
func handleKeyUp(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let keyName = req.key else {
        return errorResponse("key_up", state: state, message: "Missing 'key' field", code: "MISSING_ARG")
    }

    let lower = keyName.lowercased()

    // Check if this is a modifier key
    if let mod = modifierMap[lower] {
        // Remove ALL aliases that share the same flag
        let aliases = allAliases(for: lower)
        let owner = state.eventPostingOwner
        guard let receipt = owner.makeReceipt() else {
            return inputDeliveryError("key_up", state: state)
        }
        guard let event = CGEvent(keyboardEventSource: owner.source, virtualKey: mod.keyCode, keyDown: false) else {
            return errorResponse("key_up", state: state, message: "Failed to create keyUp event", code: "CGEVENT_FAILED")
        }
        let previousModifiers = state.modifiers
        for alias in aliases {
            state.modifiers.remove(alias)
        }
        event.flags = currentFlags(state)
        if !owner.post(event, receipt: receipt, awaitReceipt: true) {
            state.modifiers = previousModifiers
            return inputDeliveryError("key_up", state: state)
        }
        return okResponse("key_up", state: state, start: start, backend: "cgevent", strategy: "cgevent_key_up", stateID: req.state_id, terminalReceiptID: receipt.id)
    }

    // Regular key
    guard let keyCode = keyCodeMap[lower] else {
        return errorResponse("key_up", state: state, message: "Unknown key: \(keyName)", code: "INVALID_KEY")
    }

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("key_up", state: state)
    }
    guard let event = CGEvent(keyboardEventSource: owner.source, virtualKey: keyCode, keyDown: false) else {
        return errorResponse("key_up", state: state, message: "Failed to create keyUp event", code: "CGEVENT_FAILED")
    }
    event.flags = currentFlags(state)
    if !owner.post(event, receipt: receipt, awaitReceipt: true) {
        return inputDeliveryError("key_up", state: state)
    }

    return okResponse("key_up", state: state, start: start, backend: "cgevent", strategy: "cgevent_key_up", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Press and release a key combo (e.g. "cmd+shift+tab"). Uses parseKeyCombo from helpers.
func handleKeyTap(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard let keyName = req.key else {
        return errorResponse("key_tap", state: state, message: "Missing 'key' field", code: "MISSING_ARG")
    }

    guard let (keyCode, comboFlags) = parseKeyCombo(keyName) else {
        return errorResponse("key_tap", state: state, message: "Unknown key combo: \(keyName)", code: "INVALID_KEY")
    }

    // Combine combo flags with currently held modifiers
    var flags = comboFlags
    flags.insert(currentFlags(state))

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("key_tap", state: state)
    }

    // Key down
    guard let down = CGEvent(keyboardEventSource: owner.source, virtualKey: keyCode, keyDown: true) else {
        return errorResponse("key_tap", state: state, message: "Failed to create keyDown event", code: "CGEVENT_FAILED")
    }
    down.flags = flags
    owner.post(down, receipt: receipt)

    usleep(sampleDelay(profile.timing.keystroke_delay))

    // Key up
    guard let up = CGEvent(keyboardEventSource: owner.source, virtualKey: keyCode, keyDown: false) else {
        return errorResponse("key_tap", state: state, message: "Failed to create keyUp event", code: "CGEVENT_FAILED")
    }
    up.flags = flags
    if !owner.post(up, receipt: receipt, awaitReceipt: true) {
        return inputDeliveryError("key_tap", state: state)
    }

    return okResponse("key_tap", state: state, start: start, backend: "cgevent", strategy: "cgevent_key_tap", stateID: req.state_id, terminalReceiptID: receipt.id)
}

/// Type text character by character with profile-driven cadence.
func handleType(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    let profile = state.profile

    guard let text = req.text, !text.isEmpty else {
        return errorResponse("type", state: state, message: "Missing or empty 'text' field", code: "MISSING_ARG")
    }

    let cadence = profile.timing.typing_cadence
    // Base interval from WPM: average word is 5 chars, so chars/sec = wpm * 5 / 60
    let wpm = max(1, cadence.wpm)
    let variance = safeUnitInterval(cadence.variance)
    let charsPerSecond = Double(wpm) * 5.0 / 60.0
    let baseIntervalMs = max(1.0, 1000.0 / charsPerSecond)

    let owner = state.eventPostingOwner
    guard let receipt = owner.makeReceipt() else {
        return inputDeliveryError("type", state: state)
    }
    let flags = currentFlags(state)
    let characters = Array(text)

    for (index, char) in characters.enumerated() {
        // Create a Unicode key event
        var utf16 = Array(String(char).utf16)
        guard let down = CGEvent(keyboardEventSource: owner.source, virtualKey: 0, keyDown: true) else {
            return errorResponse("type", state: state, message: "Failed to create keyDown event", code: "CGEVENT_FAILED")
        }
        let isTerminal = index == characters.count - 1
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down.flags = flags
        owner.post(down, receipt: isTerminal ? receipt : nil)
        guard let up = CGEvent(keyboardEventSource: owner.source, virtualKey: 0, keyDown: false) else {
            return errorResponse("type", state: state, message: "Failed to create keyUp event", code: "CGEVENT_FAILED")
        }
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.flags = flags
        if !owner.post(up, receipt: isTerminal ? receipt : nil, awaitReceipt: isTerminal) {
            return inputDeliveryError("type", state: state)
        }

        // Cadence: apply variance
        let jitteredInterval = baseIntervalMs * (1.0 + Double.random(in: -variance...variance))
        usleep(UInt32(max(1.0, jitteredInterval)) * 1000)

        // Extra pause after whitespace
        if char.isWhitespace, let pauseRange = cadence.pause_after_word {
            usleep(sampleDelay(pauseRange))
        }
    }

    return okResponse("type", state: state, start: start, backend: "cgevent", strategy: "cgevent_type", stateID: req.state_id, terminalReceiptID: receipt.id)
}

// MARK: - AX Action Handlers

/// Press (activate) an AX element matching the query.
func handlePress(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("press", state: state, message: "Accessibility permission not granted", code: "PERMISSION_DENIED")
    }

    // If bound to a channel, try resolving element coordinates to use as a near-hint
    var augmentedReq = req
    if let channelPoint = resolveChannelElement(req, state: state), req.near == nil {
        augmentedReq = ActionRequest(
            action: req.action, pid: req.pid, role: req.role, title: req.title,
            label: req.label, identifier: req.identifier, value: req.value,
            index: req.index, near: [channelPoint.x, channelPoint.y],
            match: req.match, depth: req.depth, timeout: req.timeout
        )
    }

    let query = ElementQuery(from: augmentedReq, context: state.context, profile: state.profile)

    switch findElement(query: query) {
    case .found(let element):
        let foregroundBefore = FrontmostAppSnapshot.current()
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if result != .success {
            return errorResponse("press", state: state, message: "AXPress failed with code \(result.rawValue)", code: "AX_ACTION_FAILED")
        }
        let foreground = restoreForegroundIfNeeded(foregroundBefore)
        return okResponse("press", state: state, start: start, backend: "ax", strategy: "ax_press", stateID: req.state_id) { resp in
            resp.execution?.foreground_before_pid = foreground.before.map { Int($0.pid) }
            resp.execution?.foreground_before_app = foreground.before?.name
            resp.execution?.foreground_after_pid = foreground.after.map { Int($0.pid) }
            resp.execution?.foreground_after_app = foreground.after?.name
            resp.execution?.foreground_restore_attempted = foreground.attempted
            resp.execution?.foreground_restore_success = foreground.success
            resp.execution?.foreground_preservation = foreground.preservation
        }
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
        return errorResponse("set-value", state: state, message: "Accessibility permission not granted", code: "PERMISSION_DENIED")
    }

    guard let newValue = req.value else {
        return errorResponse("set-value", state: state, message: "Missing 'value' field", code: "MISSING_ARG")
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
            return errorResponse("set-value", state: state,
                message: "Cannot check if value is settable (AX error \(settableResult.rawValue))", code: "AX_ACTION_FAILED")
        }
        guard settable.boolValue else {
            return errorResponse("set-value", state: state,
                message: "Value attribute is not settable on this element", code: "AX_NOT_SETTABLE")
        }

        let setResult = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, newValue as CFTypeRef)
        if setResult != .success {
            return errorResponse("set-value", state: state,
                message: "Failed to set value (AX error \(setResult.rawValue))", code: "AX_ACTION_FAILED")
        }
        let valueAfter = axValue(element)
        return okResponse("set-value", state: state, start: start, backend: "ax", strategy: "ax_set_value", stateID: req.state_id) { resp in
            resp.execution?.ax_value_after = valueAfter
            resp.execution?.ax_value_matches_request = valueAfter == newValue
        }

    case .notFound(let msg):
        return errorResponse("set-value", state: state, message: msg, code: "ELEMENT_NOT_FOUND")
    case .timeout:
        return errorResponse("set-value", state: state, message: "Timed out searching for element", code: "AX_TIMEOUT")
    }
}

/// Focus an AX element by setting kAXFocusedAttribute to true.
func handleFocus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard AXIsProcessTrusted() else {
        return errorResponse("focus", state: state, message: "Accessibility permission not granted", code: "PERMISSION_DENIED")
    }

    let query = ElementQuery(from: req, context: state.context, profile: state.profile)

    switch findElement(query: query) {
    case .found(let element):
        let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
        if result != .success {
            return errorResponse("focus", state: state,
                message: "Failed to set focus (AX error \(result.rawValue))", code: "AX_ACTION_FAILED")
        }
        let focusedAfter = axBool(element, kAXFocusedAttribute as String)
        return okResponse("focus", state: state, start: start, backend: "ax", strategy: "ax_focus", stateID: req.state_id) { resp in
            resp.execution?.ax_focused_after = focusedAfter
        }
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
        return errorResponse("raise", state: state, message: "No pid specified (in request or context)", code: "MISSING_ARG")
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

    return okResponse("raise", state: state, start: start, backend: "ax", strategy: "ax_raise", stateID: req.state_id)
}

// MARK: - AppleScript Handler

/// Execute an AppleScript tell block: tell application "<app>" to <script>.
func handleTell(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    guard let appName = req.app else {
        return errorResponse("tell", state: state, message: "Missing 'app' field", code: "MISSING_ARG")
    }
    guard let scriptBody = req.script else {
        return errorResponse("tell", state: state, message: "Missing 'script' field", code: "MISSING_ARG")
    }

    let source = "tell application \"\(appName)\" to \(scriptBody)"
    let script = NSAppleScript(source: source)
    var errorDict: NSDictionary?
    _ = script?.executeAndReturnError(&errorDict)

    if let err = errorDict {
        let msg = (err[NSAppleScript.errorMessage] as? String) ?? "AppleScript execution failed"
        return errorResponse("tell", state: state, message: msg, code: "APPLESCRIPT_FAILED")
    }

    return okResponse("tell", state: state, start: start, backend: "applescript", strategy: "applescript_tell", stateID: req.state_id)
}

// MARK: - Meta Handlers

/// Return session status: cursor, modifiers, context, profile, uptime, bound_channel.
func handleStatus(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()
    return okResponse("status", state: state, start: start, stateID: req.state_id) { resp in
        resp.profile = state.profileName
        resp.session_uptime_s = Date().timeIntervalSince(state.startTime)
        resp.bound_channel = state.boundChannel
    }
}

// MARK: - Action Introspection

/// Map AX action names to `aos do` session verbs.
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
        // Map AX actions to `aos do` verbs
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

    return okResponse("list_actions", state: state, start: start, stateID: req.state_id) { resp in
        resp.available = available
        resp.bound_channel = state.boundChannel
    }
}

/// End session: release all held modifier keys, clear state, return final response.
func handleEnd(state: SessionState) -> ActionResponse {
    let start = Date()

    releaseAllModifiers(state)

    return okResponse("end", state: state, start: start)
}
