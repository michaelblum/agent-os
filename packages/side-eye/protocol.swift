// protocol.swift — Daemon IPC types + focus channel file schema
//
// Defines all request/response types for side-eye daemon communication,
// plus the channel file schema that side-eye writes and hand-off reads.

import Foundation

// MARK: - Daemon Request (ndjson from client)

struct DaemonRequest: Codable {
    let action: String           // "focus-create", "focus-update", "focus-remove", "focus-list", "snapshot", "subscribe"
    var id: String?              // channel ID
    var window_id: Int?          // target window
    var pid: Int?                // target process (alternative to window_id)
    var subtree: ChannelSubtree? // optional AX subtree to focus on
    var depth: Int?              // AX tree depth (default: 3)

    static func from(_ data: Data) -> DaemonRequest? {
        try? JSONDecoder().decode(DaemonRequest.self, from: data)
    }

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }
}

// MARK: - Daemon Response (ndjson to client)

struct DaemonResponse: Codable {
    var status: String?          // "ok"
    var error: String?
    var code: String?
    var channels: [ChannelSummary]?  // for focus-list
    var snapshot: SnapshotData?      // for snapshot
    var uptime: Double?              // daemon uptime

    static let ok = DaemonResponse(status: "ok")

    static func fail(_ message: String, code: String) -> DaemonResponse {
        DaemonResponse(error: message, code: code)
    }

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }

    static func from(_ data: Data) -> DaemonResponse? {
        try? JSONDecoder().decode(DaemonResponse.self, from: data)
    }
}

struct ChannelSummary: Codable {
    let id: String
    let window_id: Int
    let app: String
    let elements_count: Int
    let updated_at: String
}

struct SnapshotData: Codable {
    let displays: Int
    let windows: Int
    let channels: Int
    let focused_app: String?
}

// MARK: - Daemon Event (pushed to subscribers)

struct DaemonEvent: Codable {
    let type: String             // "channel_updated", "window_moved", "focus_changed"
    var id: String?              // channel ID (for channel events)
    var updated_at: String?
    var window_id: Int?
    var bounds: ChannelBounds?
    var pid: Int?
    var app: String?

    func toData() -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return (try? enc.encode(self)) ?? Data()
    }
}

// MARK: - Focus Channel File Schema

/// Written to ~/.config/agent-os/channels/<id>.json by the daemon.
/// Read by hand-off (bind), heads-up (anchor), and any other tool.
struct ChannelFile: Codable {
    let channel_id: String
    let created_by: String       // "side-eye"
    let created_at: String       // ISO 8601
    var updated_at: String       // ISO 8601
    let target: ChannelTarget
    let focus: ChannelFocus
    var window_bounds: ChannelBounds
    var elements: [ChannelElement]
}

struct ChannelTarget: Codable {
    let pid: Int
    let app: String
    let bundle_id: String?
    let window_id: Int
    let display: Int
    let scale_factor: Double
}

struct ChannelFocus: Codable {
    var subtree: ChannelSubtree?
    var depth: Int
}

struct ChannelSubtree: Codable {
    var role: String?
    var title: String?
    var identifier: String?
}

struct ChannelBounds: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double

    init(x: Double, y: Double, w: Double, h: Double) {
        self.x = x; self.y = y; self.w = w; self.h = h
    }

    init(from rect: CGRect) {
        self.x = Double(rect.origin.x)
        self.y = Double(rect.origin.y)
        self.w = Double(rect.size.width)
        self.h = Double(rect.size.height)
    }
}

struct ChannelElement: Codable {
    let role: String
    let title: String?
    let label: String?
    let identifier: String?
    let value: String?
    let enabled: Bool
    let actions: [String]
    let bounds_pixel: ChannelBounds
    let bounds_window: ChannelBounds
    let bounds_global: ChannelBounds
}

// MARK: - Socket Path

let kSideEyeSocketPath: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/side-eye/sock"
}()

let kChannelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - ISO 8601 Helper

func iso8601Now() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: Date())
}
