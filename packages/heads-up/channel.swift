// heads-up — Focus channel integration
// Reads side-eye channel files from ~/.config/agent-os/channels/<id>.json
// Used by anchorChannel and auto-projection modes.

import Foundation

// MARK: - Channel File Types (mirrors side-eye ChannelFile schema)

struct ChannelData: Codable {
    let channel_id: String
    let target: ChannelTarget
    let focus: ChannelFocus
    let window_bounds: ChannelBounds
    let elements: [ChannelElement]
    let updated_at: String
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
    let subtree: ChannelSubtree?
    let depth: Int
}

struct ChannelSubtree: Codable {
    let role: String?
    let title: String?
    let identifier: String?
}

struct ChannelBounds: Codable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
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

// MARK: - Channel Directory

let kChannelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - Read Channel File

/// Read and parse a focus channel file by ID.
/// Returns nil if the file doesn't exist or can't be parsed.
func readChannelFile(id: String) -> ChannelData? {
    let path = "\(kChannelDirectory)/\(id).json"
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
    return try? JSONDecoder().decode(ChannelData.self, from: data)
}

/// Check if a channel file is stale (>10s since last update).
func isChannelStale(_ channel: ChannelData) -> Bool {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    guard let updated = fmt.date(from: channel.updated_at) else { return true }
    return Date().timeIntervalSince(updated) > 10.0
}

/// Check if a channel file exists on disk.
func channelFileExists(id: String) -> Bool {
    let path = "\(kChannelDirectory)/\(id).json"
    return FileManager.default.fileExists(atPath: path)
}
