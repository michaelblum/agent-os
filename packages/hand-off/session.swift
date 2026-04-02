// session.swift — Stdin/stdout ndjson session loop with action dispatch for hand-off v2.
// Reads ActionRequest JSON lines from stdin, dispatches to handlers, writes ActionResponse JSON to stdout.

import Foundation

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
        exitWithError("Profile not found: \(profileName)", code: "PROFILE_NOT_FOUND")
    }

    let state = SessionState(profile: profile, profileName: profileName)

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
            writeJSON(errorResponse)
            continue
        }

        // Dispatch and respond
        let response = dispatchAction(req, state: state)
        writeJSON(response)

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
