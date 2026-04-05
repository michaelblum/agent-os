// act-channel.swift — Focus channel binding for action sessions.
// Reads side-eye channel files, configures session context from channel targets,
// and resolves AX elements from channel element data.

import CoreGraphics
import Foundation

let actChannelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - Channel File Reading

func readActionChannelFile(id: String) -> ChannelFileData? {
    let path = "\(actChannelDirectory)/\(id).json"
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    return try? JSONDecoder().decode(ChannelFileData.self, from: data)
}

/// Check if channel file is stale (>10s since last update).
func isActionChannelStale(_ channel: ChannelFileData) -> Bool {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    guard let updated = fmt.date(from: channel.updated_at) else { return true }
    return Date().timeIntervalSince(updated) > 10.0
}

// MARK: - Bind Action Handler

func handleBind(_ req: ActionRequest, state: SessionState) -> ActionResponse {
    let start = Date()

    // Unbind
    if req.channel == nil {
        state.boundChannel = nil
        state.channelElements = []
        // Restore pre-bind context if any
        if let saved = state.preBindContext {
            state.context = saved
            state.preBindContext = nil
        } else {
            state.context.clear()
        }
        return ActionResponse(
            status: "ok", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            context: state.contextSnapshot(),
            duration_ms: Int(Date().timeIntervalSince(start) * 1000)
        )
    }

    // Bind to channel
    guard let channelID = req.channel else {
        return ActionResponse(
            status: "error", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "channel is required", code: "MISSING_ARG"
        )
    }

    guard let channel = readActionChannelFile(id: channelID) else {
        return ActionResponse(
            status: "error", action: "bind",
            cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
            error: "Channel file not found: \(channelID)", code: "CHANNEL_NOT_FOUND"
        )
    }

    // Save current context for unbind restore
    state.preBindContext = state.context

    // Set context from channel target
    state.context.pid = channel.target.pid
    state.context.app = channel.target.app
    state.context.window_id = channel.target.window_id
    state.context.scale_factor = channel.target.scale_factor
    state.context.coordinate_space = "window"

    // Set subtree from channel focus
    if let sub = channel.focus.subtree {
        state.context.subtree = SubtreeSpec(
            role: sub.role, title: sub.title, identifier: sub.identifier
        )
    }

    // Load elements
    state.boundChannel = channelID
    state.channelElements = channel.elements

    var resp = ActionResponse(
        status: "ok", action: "bind",
        cursor: state.cursor, modifiers: Array(state.modifiers).sorted(),
        context: state.contextSnapshot(),
        duration_ms: Int(Date().timeIntervalSince(start) * 1000)
    )
    resp.bound_channel = channelID
    resp.elements_count = channel.elements.count

    // Warn if stale
    if isActionChannelStale(channel) {
        resp.code = "CHANNEL_STALE"
    }

    return resp
}

// MARK: - Channel-Aware Element Resolution

/// Before each action in a bound session, re-read the channel file for fresh data.
func refreshChannelBinding(state: SessionState) {
    guard let channelID = state.boundChannel else { return }
    guard let channel = readActionChannelFile(id: channelID) else { return }
    state.channelElements = channel.elements

    // Update window bounds in case window moved
    state.context.window_id = channel.target.window_id
}

/// Resolve an element from channel data by matching fields.
/// Returns the global CG point at the element's center (for CGEvent actions).
func resolveChannelElement(_ req: ActionRequest, state: SessionState) -> CGPoint? {
    guard state.boundChannel != nil else { return nil }

    // Only resolve if the request has AX targeting fields but no coordinates
    guard req.x == nil && req.y == nil else { return nil }
    guard req.role != nil || req.title != nil || req.label != nil || req.identifier != nil else { return nil }

    for el in state.channelElements {
        var match = true
        if let role = req.role, el.role != role { match = false }
        if let title = req.title, el.title != title { match = false }
        if let label = req.label, el.label != label { match = false }
        if let ident = req.identifier, el.identifier != ident { match = false }

        if match {
            // Return center of global bounds
            let cx = el.bounds_global.x + el.bounds_global.w / 2
            let cy = el.bounds_global.y + el.bounds_global.h / 2
            return CGPoint(x: cx, y: cy)
        }
    }
    return nil
}
