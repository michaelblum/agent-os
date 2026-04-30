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

// MARK: - Spatial Topology Output Models (spatial-topology.schema.json v0.1.0)

struct STBounds: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct STFocusedApp: Encodable {
    let pid: Int
    let name: String
    let bundle_id: String?
}

struct STWindow: Encodable {
    let window_id: Int
    let title: String?
    let app_pid: Int
    let app_name: String
    let bundle_id: String?
    let bounds: STBounds
    let is_focused: Bool
    let is_on_screen: Bool
    let layer: Int
    let alpha: Double
}

struct STDisplay: Encodable {
    let display_id: Int
    let display_uuid: String?
    let ordinal: Int
    let label: String
    let is_main: Bool
    let bounds: STBounds
    let visible_bounds: STBounds
    let native_bounds: STBounds
    let native_visible_bounds: STBounds
    let desktop_world_bounds: STBounds
    let visible_desktop_world_bounds: STBounds
    let scale_factor: Double
    let rotation: Double
    let windows: [STWindow]
}

struct STApp: Encodable {
    let pid: Int
    let name: String
    let bundle_id: String?
    let is_active: Bool
    let is_hidden: Bool
    let window_ids: [Int]
}

struct STCursor: Encodable {
    let x: Double
    let y: Double
    let desktop_world_x: Double
    let desktop_world_y: Double
    let display: Int
}

struct SpatialTopology: Encodable {
    let schema: String
    let version: String
    let timestamp: String
    let screens_have_separate_spaces: Bool
    let cursor: STCursor
    let focused_window_id: Int?
    let focused_app: STFocusedApp?
    let displays: [STDisplay]
    let desktop_world_bounds: STBounds
    let visible_desktop_world_bounds: STBounds
    let apps: [STApp]
}

// MARK: - Capture Pipeline Cursor Output Models
// These use different struct names to avoid collision with the aos cursor command models.

struct CursorJSON: Codable {
    let x: Int
    let y: Int
}

struct CursorPointJSON: Encodable {
    let x: Double
    let y: Double
}

struct CursorWindowJSON: Encodable {
    let window_id: Int
    let title: String?
    let app_name: String
    let app_pid: Int
    let bundle_id: String?
    let bounds: STBounds
}

struct CursorElementJSON: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
}

/// Capture pipeline's cursor response (distinct from the aos cursorCommand response).
struct CaptureCursorResponse: Encodable {
    let cursor: CursorPointJSON
    let display: Int
    let window: CursorWindowJSON?
    let element: CursorElementJSON?
}

// MARK: - Selection Command Output Models

struct SelectionResponse: Encodable {
    let selected_text: String
    let app_name: String
    let app_pid: Int
    let bundle_id: String?
    let role: String
}

// MARK: - Capture Pipeline AX Output Models

struct BoundsJSON: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct AXElementJSON: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let context_path: [String]
    let bounds: BoundsJSON?
    let ref: String?
}

// MARK: - AOS-owned Canvas Semantic Target Output

struct AOSSemanticTargetStateJSON: Codable {
    let current: String?
    let pressed: Bool?
    let selected: Bool?
    let checked: Bool?
    let expanded: Bool?
    let disabled: Bool?
    let value: String?
}

struct AOSSemanticTargetJSON: Codable {
    let canvas_id: String?
    let id: String?
    let ref: String?
    let role: String
    let name: String?
    let action: String?
    let surface: String?
    let parent_canvas: String?
    let enabled: Bool
    let bounds: BoundsJSON
    let center: CursorJSON
    let state: AOSSemanticTargetStateJSON?
}

// MARK: - Annotation Output Model (annotation.schema.json v0.1.0)

struct AnnotationBoundsJSON: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AnnotationJSON: Encodable {
    let bounds: AnnotationBoundsJSON
    let label: String?
}

struct CaptureWindowJSON: Encodable {
    let window_id: Int
    let title: String?
    let app_name: String
    let app_pid: Int
    let bounds: STBounds
    let scale_factor: Double
}

struct CaptureSurfaceSegmentJSON: Encodable {
    let display: Int
    let display_id: Int
    let scale_factor: Double
    let bounds_global: STBounds
    let bounds_local: BoundsJSON
}

struct CapturePerceptionJSON: Encodable {
    let capture_bounds_global: STBounds
    let capture_bounds_local: BoundsJSON
    let capture_scale_factor: Double
    let cursor_local: CursorJSON?
    let segments: [CaptureSurfaceSegmentJSON]
    let topology: SpatialTopology
}

struct CaptureSurfaceJSON: Encodable {
    let kind: String
    let id: String?
    let display: Int?
    let displays: [Int]
    let scale_factor: Double?
    let capture_scale_factor: Double
    let window_id: Int?
    let bounds_global: STBounds
    let bounds_local: BoundsJSON
    let segments: [CaptureSurfaceSegmentJSON]
}

struct SuccessResponse: Encodable {
    let status = "success"
    var files: [String]?
    var base64: [String]?
    var cursor: CursorJSON?
    var bounds: BoundsJSON?
    var click_x: Int?
    var click_y: Int?
    var warning: String?
    var elements: [AXElementJSON]?
    var semantic_targets: [AOSSemanticTargetJSON]?
    var annotations: [AnnotationJSON]?
    var window: CaptureWindowJSON?
    var surfaces: [CaptureSurfaceJSON]?
    var perceptions: [CapturePerceptionJSON]?

    enum CodingKeys: String, CodingKey {
        case status, files, base64, cursor, bounds, click_x, click_y, warning, elements, semantic_targets, annotations, window, surfaces, perceptions
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        if let f = files { try c.encode(f, forKey: .files) }
        if let b = base64 { try c.encode(b, forKey: .base64) }
        if let cur = cursor { try c.encode(cur, forKey: .cursor) }
        if let bnd = bounds { try c.encode(bnd, forKey: .bounds) }
        if let cx = click_x { try c.encode(cx, forKey: .click_x) }
        if let cy = click_y { try c.encode(cy, forKey: .click_y) }
        if let w = warning { try c.encode(w, forKey: .warning) }
        if let e = elements { try c.encode(e, forKey: .elements) }
        if let st = semantic_targets { try c.encode(st, forKey: .semantic_targets) }
        if let a = annotations { try c.encode(a, forKey: .annotations) }
        if let win = window { try c.encode(win, forKey: .window) }
        if let s = surfaces { try c.encode(s, forKey: .surfaces) }
        if let p = perceptions { try c.encode(p, forKey: .perceptions) }
    }
}
