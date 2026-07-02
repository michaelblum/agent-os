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

struct AXAncestorJSON: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let bounds: Bounds?
}

struct CursorElement: Encodable {
    let role: String
    let title: String?
    let label: String?
    let value: String?
    let enabled: Bool
    let bounds: Bounds?
    let action_names: [String]
    let settable_attributes: [String]
    let ancestor_chain: [AXAncestorJSON]
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
    let action_names: [String]
    let settable_attributes: [String]
    let bounds: STBounds?
    let ancestor_chain: [AXAncestorJSON]
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

struct NativeFocusCursorSpaceBaselineJSON: Encodable {
    let captured: Bool
    let focus: String
    let cursor: String
    let space: String
}

struct NativeSavedRefEvidenceJSON: Encodable {
    let status: String
    let actionability: String
    let known_limit_facts_complete: Bool
    let producer: String
    let reasons: [String]
}

struct AXElementJSON: Encodable {
    let app_pid: Int?
    let app_name: String?
    let window_id: Int?
    let role: String
    let title: String?
    let label: String?
    let identifier: String?
    let value: String?
    let enabled: Bool
    let action_names: [String]?
    let permission_state: String?
    let focus_cursor_space_baseline: NativeFocusCursorSpaceBaselineJSON?
    let native_saved_ref_evidence: NativeSavedRefEvidenceJSON?
    let window_state: String?
    let space_state: String?
    let control_kind: String?
    let surface_kind: String?
    let focus_state: String?
    let minimized: Bool?
    let off_space: Bool?
    let custom_control: Bool?
    let canvas_surface: Bool?
    let context_path: [String]
    let bounds: BoundsJSON?
    let ref: String?

    init(
        app_pid: Int? = nil,
        app_name: String? = nil,
        window_id: Int? = nil,
        role: String,
        title: String?,
        label: String?,
        identifier: String? = nil,
        value: String?,
        enabled: Bool,
        action_names: [String]? = nil,
        permission_state: String? = nil,
        focus_cursor_space_baseline: NativeFocusCursorSpaceBaselineJSON? = nil,
        native_saved_ref_evidence: NativeSavedRefEvidenceJSON? = nil,
        window_state: String? = nil,
        space_state: String? = nil,
        control_kind: String? = nil,
        surface_kind: String? = nil,
        focus_state: String? = nil,
        minimized: Bool? = nil,
        off_space: Bool? = nil,
        custom_control: Bool? = nil,
        canvas_surface: Bool? = nil,
        context_path: [String],
        bounds: BoundsJSON?,
        ref: String?
    ) {
        self.app_pid = app_pid
        self.app_name = app_name
        self.window_id = window_id
        self.role = role
        self.title = title
        self.label = label
        self.identifier = identifier
        self.value = value
        self.enabled = enabled
        self.action_names = action_names
        self.permission_state = permission_state
        self.focus_cursor_space_baseline = focus_cursor_space_baseline
        self.native_saved_ref_evidence = native_saved_ref_evidence
        self.window_state = window_state
        self.space_state = space_state
        self.control_kind = control_kind
        self.surface_kind = surface_kind
        self.focus_state = focus_state
        self.minimized = minimized
        self.off_space = off_space
        self.custom_control = custom_control
        self.canvas_surface = canvas_surface
        self.context_path = context_path
        self.bounds = bounds
        self.ref = ref
    }
}

// MARK: - AOS-owned Canvas Semantic Target Output

struct AOSSemanticTargetStateJSON: Codable {
    let value: String?
    let current: String?
    let pressed: Bool?
    let selected: Bool?
    let checked: Bool?
    let expanded: Bool?
    let values: [Double]?
    let min: Double?
    let max: Double?
    let step: Double?
    let orientation: String?
    let thumb_count: Int?
}

struct AOSSemanticTargetExtensionSourceJSON: Codable {
    let path: String?
    let line_start: Int?
    let line_end: Int?
}

struct AOSSemanticTargetExtensionJSON: Codable {
    let dom_id: String?
    let source: AOSSemanticTargetExtensionSourceJSON?
}

struct AOSSemanticTargetProvenanceJSON: Codable {
    let canvas_id: String?
    let do_target: String?
    let parent_canvas_id: String?
    let source_payload_id: String?
    let bounds: BoundsJSON?
    let frame: BoundsJSON?
    let center: CursorJSON?
}

struct AOSSemanticTargetJSON: Codable {
    let ref: String
    let surface: String?
    let role: String
    let name: String?
    let kind: String
    let enabled: Bool
    let state: AOSSemanticTargetStateJSON?
    let actions: [String]
    let `extension`: AOSSemanticTargetExtensionJSON
    let provenance: AOSSemanticTargetProvenanceJSON
    let geometry: JSONValue?
    let metadata: JSONValue?
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
    var state_id: String?
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
        case status, state_id, files, base64, cursor, bounds, click_x, click_y, warning, elements, semantic_targets, annotations, window, surfaces, perceptions
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        if let id = state_id { try c.encode(id, forKey: .state_id) }
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
