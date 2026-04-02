// context.swift — Context operator and coordinate conversion for hand-off v2 session mode.
// Resolves window-relative or global coordinates, and handles the "context" action.

import CoreGraphics
import Foundation

// MARK: - Coordinate Resolution

/// Resolve (x, y) to a global CGPoint using the current session context.
///
/// - `coordinate_space == "window"`: converts window-relative coords to global CG coords
///   using `windowOrigin(windowID:)` and the context's scale factor.
/// - `coordinate_space == "global"` (default): passes through as-is.
/// - Returns nil if window space is active but `window_id` is missing or the window can't be found.
func resolveCoordinates(x: Double, y: Double, context: SessionContext) -> CGPoint? {
    switch context.coordinate_space {
    case "window":
        guard let wid = context.window_id,
              let origin = windowOrigin(windowID: wid) else {
            return nil
        }
        let scale = context.scale_factor
        let cgX = (x / scale) + origin.x
        let cgY = (y / scale) + origin.y
        return CGPoint(x: cgX, y: cgY)
    default:
        // "global" or anything unrecognized — treat as raw CG coordinates
        return CGPoint(x: x, y: y)
    }
}

/// Convenience: resolve coordinates from an ActionRequest using the session's current context.
/// Returns nil if the request doesn't carry both x and y, or if window resolution fails.
func resolveActionCoordinates(_ req: ActionRequest, state: SessionState) -> CGPoint? {
    guard let x = req.x, let y = req.y else { return nil }
    return resolveCoordinates(x: x, y: y, context: state.context)
}

// MARK: - Context Action Handler

/// Handle the `"context"` session action: set/clear context fields, validate, and respond.
func handleContextAction(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = DispatchTime.now()

    // Apply mutations
    if req.clear == true {
        state.context.clear()
    }
    if let fields = req.set {
        state.context.apply(fields)
    }

    // Validate: window coordinate space requires a window_id
    if state.context.coordinate_space == "window" && state.context.window_id == nil {
        let elapsed = Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
        return ActionResponse(
            status: "error",
            action: "context",
            cursor: state.cursor,
            modifiers: Array(state.modifiers),
            context: state.contextSnapshot(),
            duration_ms: elapsed,
            error: "coordinate_space is \"window\" but no window_id is set",
            code: "INVALID_CONTEXT"
        )
    }

    let elapsed = Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
    return ActionResponse(
        status: "ok",
        action: "context",
        cursor: state.cursor,
        modifiers: Array(state.modifiers),
        context: state.contextSnapshot(),
        duration_ms: elapsed
    )
}
