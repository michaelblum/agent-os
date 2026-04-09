// display — Focus channel integration
// Reads channel files from ~/.config/agent-os/channels/<id>.json
// Used by anchorChannel and auto-projection modes.

import CoreGraphics
import Foundation

// MARK: - Channel File Types

struct ChannelData: Codable {
    let channel_id: String
    var created_by: String?
    var created_at: String?
    var updated_at: String
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

// MARK: - Channel Directory

let kDisplayChannelDirectory: String = {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    return "\(home)/.config/agent-os/channels"
}()

// MARK: - Read Channel File

/// Read and parse a focus channel file by ID.
/// Returns nil if the file doesn't exist or can't be parsed.
func readChannelFile(id: String) -> ChannelData? {
    let path = "\(kDisplayChannelDirectory)/\(id).json"
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
    let path = "\(kDisplayChannelDirectory)/\(id).json"
    return FileManager.default.fileExists(atPath: path)
}
