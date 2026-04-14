// session.swift — Stdin/stdout ndjson session loop with action dispatch for `aos do`.
// Reads ActionRequest JSON lines from stdin, dispatches to handlers, writes ActionResponse JSON to stdout.

import CoreGraphics
import Foundation

// MARK: - Signal-Safe Modifier Cleanup

/// Module-level reference so signal handlers (which can't capture) can access session state.
private var _activeSessionState: SessionState?

/// Release all held modifier keys by posting key-up CGEvents for each.
/// Callable from signal handlers and normal shutdown paths.
func releaseAllModifiers(_ state: SessionState) {
    let source = CGEventSource(stateID: .hidSystemState)
    for mod in state.modifiers {
        if let entry = modifierMap[mod] {
            if let event = CGEvent(keyboardEventSource: source, virtualKey: entry.keyCode, keyDown: false) {
                event.post(tap: .cghidEventTap)
            }
        }
    }
    state.modifiers.removeAll()
}

// MARK: - Session Entry Point

/// Run the interactive ndjson session loop. This function never returns normally.
///
/// 1. Loads the named behavior profile (exits with error if not found).
/// 2. Creates session state with the loaded profile.
/// 3. Reads JSON lines from stdin, dispatches each to the appropriate handler,
///    and writes the response as a JSON line to stdout.
/// 4. Exits cleanly on `"end"` action or when stdin closes.
func runSession(profileName: String) -> Never {
    // Load profile — hard exit if missing, session can't operate without one
    guard let profile = loadProfile(name: profileName) else {
        exitError("Profile not found: \(profileName)", code: "PROFILE_NOT_FOUND")
    }

    let state = SessionState(profile: profile, profileName: profileName)

    // Store in module-level variable so signal handlers can reach it
    _activeSessionState = state

    // Register signal handlers to release held modifiers on kill
    signal(SIGINT) { _ in
        if let s = _activeSessionState { releaseAllModifiers(s) }
        exit(0)
    }
    signal(SIGTERM) { _ in
        if let s = _activeSessionState { releaseAllModifiers(s) }
        exit(0)
    }

    // Disable stdout buffering so every response line flushes immediately
    setbuf(stdout, nil)

    let decoder = JSONDecoder()

    while let line = readLine(strippingNewline: true) {
        // Skip empty lines (blank lines between requests, trailing newlines, etc.)
        if line.isEmpty { continue }

        // Parse the request JSON
        guard let data = line.data(using: .utf8),
              let req = try? decoder.decode(ActionRequest.self, from: data) else {
            // Parse failure — respond with error but keep session alive
            let errorResponse = ActionResponse(
                status: "error",
                action: "unknown",
                cursor: state.cursor,
                modifiers: Array(state.modifiers),
                error: "Failed to parse JSON request",
                code: "PARSE_ERROR"
            )
            writeJSONLine(errorResponse)
            continue
        }

        // Dispatch and respond
        let response = dispatchAction(req, state: state)
        writeJSONLine(response)

        // "end" action terminates the session after writing the response
        if req.action == "end" {
            exit(0)
        }
    }

    // Stdin closed — clean up held modifiers and exit
    let _ = handleEnd(state: state)
    exit(0)
}

// MARK: - Action Dispatch

/// Route an action string to the appropriate handler function.
///
/// Groups:
/// - **CGEvent actions:** move, click, drag, scroll, key_down, key_up, key_tap, type
/// - **AX actions:** press, set_value, focus, raise
/// - **AppleScript actions:** tell
/// - **Meta actions:** context, status, end
/// - **Channel binding:** bind
func dispatchAction(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    // Re-read channel file before each action if bound
    refreshChannelBinding(state: state)

    switch req.action {

    // CGEvent actions
    case "move":     return handleMove(req, state: state)
    case "click":    return handleClick(req, state: state)
    case "drag":     return handleDrag(req, state: state)
    case "scroll":   return handleScroll(req, state: state)
    case "key_down": return handleKeyDown(req, state: state)
    case "key_up":   return handleKeyUp(req, state: state)
    case "key_tap":  return handleKeyTap(req, state: state)
    case "type":     return handleType(req, state: state)

    // AX actions
    case "press":     return handlePress(req, state: state)
    case "set_value": return handleSetValue(req, state: state)
    case "focus":     return handleFocus(req, state: state)
    case "raise":     return handleRaise(req, state: state)

    // AppleScript actions
    case "tell": return handleTell(req, state: state)

    // Meta actions
    case "context": return handleContextAction(req, state: state)
    case "status":  return handleStatus(req, state: state)
    case "end":     return handleEnd(state: state)

    // Channel binding + introspection
    case "bind":
        return handleBind(req, state: state)
    case "list_actions":
        return handleListActions(req, state: state)

    // Unknown action
    default:
        return ActionResponse(
            status: "error",
            action: req.action,
            cursor: state.cursor,
            modifiers: Array(state.modifiers),
            error: "Unknown action: \"\(req.action)\"",
            code: "UNKNOWN_ACTION"
        )
    }
}
