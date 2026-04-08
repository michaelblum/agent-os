// models.swift — Output types for perception commands

import AppKit
import CoreGraphics
import Foundation

// MARK: - Cursor Command Output

struct CursorResponse: Encodable {
    let cursor: CursorPoint
    let display: Int
    let window: CursorWindow?
    let element: CursorElement?
}

struct CursorPoint: Encodable {
    let x: Double
    let y: Double
}

struct CursorWindow: Encodable {
    let window_id: Int
    let title: String?
    let app_name: String
    let app_pid: Int
    let bundle_id: String?
    let bounds: Bounds
}

struct CursorElement: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let bounds: Bounds?
    let context_path: [String]
}

// MARK: - Display Info

struct DisplayEntry {
    let id: CGDirectDisplayID
    let ordinal: Int
    let bounds: CGRect
    let isMain: Bool
    let scaleFactor: Double
}

func getDisplays() -> [DisplayEntry] {
    var displayIDs = [CGDirectDisplayID](repeating: 0, count: 16)
    var count: UInt32 = 0
    CGGetActiveDisplayList(16, &displayIDs, &count)
    let mainID = CGMainDisplayID()

    return (0..<Int(count)).map { i in
        let id = displayIDs[i]
        let bounds = CGDisplayBounds(id)
        let mode = CGDisplayCopyDisplayMode(id)
        let scale = mode.map { Double($0.pixelWidth) / Double($0.width) } ?? 2.0
        return DisplayEntry(id: id, ordinal: i + 1, bounds: bounds, isMain: id == mainID, scaleFactor: scale)
    }.sorted(by: { $0.bounds.origin.x < $1.bounds.origin.x })
}

// MARK: - Shared Window Utilities

/// Filter predicate for visible, user-facing windows from CGWindowList.
/// Excludes Window Server, hidden windows, and non-layer-0 windows.
func isVisibleWindow(_ info: [String: Any]) -> Bool {
    let layer = info[kCGWindowLayer as String] as? Int ?? -1
    guard layer == 0 else { return false }
    let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
    guard alpha > 0 else { return false }
    let owner = info[kCGWindowOwnerName as String] as? String ?? ""
    guard owner != "Window Server" else { return false }
    return true
}

/// Build a PID-indexed lookup of running GUI applications.
func buildAppLookup() -> [pid_t: (name: String, bundleID: String?, isHidden: Bool)] {
    var lookup: [pid_t: (name: String, bundleID: String?, isHidden: Bool)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        lookup[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleID: app.bundleIdentifier,
            isHidden: app.isHidden
        )
    }
    return lookup
}
