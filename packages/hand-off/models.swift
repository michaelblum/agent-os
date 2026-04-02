// models.swift — Shared types for hand-off v2
// All response, request, targeting, profile, and state types live here.

import CoreGraphics
import Foundation

// MARK: - Session Action Request (ndjson input)

/// Decoded from each line of stdin in session mode.
struct ActionRequest: Codable {
    let action: String

    // Coordinate fields (CGEvent actions)
    var x: Double?
    var y: Double?
    var dx: Double?
    var dy: Double?
    var from: CursorPosition?
    var button: String?           // "left" | "right"
    var count: Int?               // click count

    // Text/key fields
    var text: String?
    var key: String?

    // AX targeting fields
    var pid: Int?
    var role: String?
    var title: String?
    var label: String?
    var identifier: String?
    var value: String?
    var index: Int?
    var near: [Double]?           // [x, y]
    var match: String?            // "exact" | "contains" | "regex"

    // AX tree controls
    var depth: Int?
    var timeout: Int?             // milliseconds

    // Context fields
    var set: ContextFields?
    var clear: Bool?

    // AppleScript
    var app: String?
    var script: String?

    // Window targeting
    var window_id: Int?

    // Phase 2 placeholder
    var channel: String?

    // Memberwise init with defaults for use in CLI bridge
    init(action: String, x: Double? = nil, y: Double? = nil, dx: Double? = nil, dy: Double? = nil,
         from: CursorPosition? = nil, button: String? = nil, count: Int? = nil,
         text: String? = nil, key: String? = nil,
         pid: Int? = nil, role: String? = nil, title: String? = nil, label: String? = nil,
         identifier: String? = nil, value: String? = nil, index: Int? = nil,
         near: [Double]? = nil, match: String? = nil, depth: Int? = nil, timeout: Int? = nil,
         set: ContextFields? = nil, clear: Bool? = nil,
         app: String? = nil, script: String? = nil, window_id: Int? = nil, channel: String? = nil) {
        self.action = action; self.x = x; self.y = y; self.dx = dx; self.dy = dy
        self.from = from; self.button = button; self.count = count
        self.text = text; self.key = key
        self.pid = pid; self.role = role; self.title = title; self.label = label
        self.identifier = identifier; self.value = value; self.index = index
        self.near = near; self.match = match; self.depth = depth; self.timeout = timeout
        self.set = set; self.clear = clear
        self.app = app; self.script = script; self.window_id = window_id; self.channel = channel
    }
}

struct ContextFields: Codable {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String? // "global" | "window"
    var scale_factor: Double?
    var subtree: SubtreeSpec?
}

struct SubtreeSpec: Codable {
    var role: String?
    var title: String?
    var identifier: String?
}

// MARK: - Session Action Response (ndjson output)

struct ActionResponse: Encodable {
    let status: String            // "ok" | "error"
    let action: String
    var cursor: CursorPosition?
    var modifiers: [String]?
    var context: ContextSnapshot?
    var duration_ms: Int?

    // Error fields
    var error: String?
    var code: String?

    // Status-specific
    var profile: String?
    var session_uptime_s: Double?
    var bound_channel: String?

    // Element count (for bind)
    var elements_count: Int?
}

struct CursorPosition: Codable {
    let x: Double
    let y: Double
}

struct ContextSnapshot: Codable {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String?
    var scale_factor: Double?
}

// MARK: - Session State

/// Mutable state maintained across a session's lifetime.
class SessionState {
    var cursor: CursorPosition
    var modifiers: Set<String> = []
    var context: SessionContext = SessionContext()
    var profileName: String
    var profile: BehaviorProfile
    var startTime: Date = Date()

    init(profile: BehaviorProfile, profileName: String) {
        // Get current cursor position from CGEvent
        let pos = CGEvent(source: nil)?.location ?? .zero
        self.cursor = CursorPosition(x: pos.x, y: pos.y)
        self.profile = profile
        self.profileName = profileName
    }

    func updateCursor(_ point: CGPoint) {
        cursor = CursorPosition(x: Double(point.x), y: Double(point.y))
    }

    func contextSnapshot() -> ContextSnapshot? {
        guard context.pid != nil else { return nil }
        return ContextSnapshot(
            pid: context.pid,
            app: context.app,
            window_id: context.window_id,
            coordinate_space: context.coordinate_space,
            scale_factor: context.scale_factor
        )
    }
}

struct SessionContext {
    var pid: Int?
    var app: String?
    var window_id: Int?
    var coordinate_space: String = "global"
    var scale_factor: Double = 1.0
    var subtree: SubtreeSpec?

    mutating func apply(_ fields: ContextFields) {
        if let v = fields.pid { pid = v }
        if let v = fields.app { app = v }
        if let v = fields.window_id { window_id = v }
        if let v = fields.coordinate_space { coordinate_space = v }
        if let v = fields.scale_factor { scale_factor = v }
        if let v = fields.subtree { subtree = v }
    }

    mutating func clear() {
        pid = nil; app = nil; window_id = nil
        coordinate_space = "global"; scale_factor = 1.0
        subtree = nil
    }
}

// MARK: - Behavioral Profile

struct BehaviorProfile: Codable {
    var name: String
    var description: String?
    var timing: TimingProfile
    var mouse: MouseProfile
    var scroll: ScrollProfile
    var ax: AXProfile

    static let natural = BehaviorProfile(
        name: "natural",
        description: "Default human-like feel — moderate speed, natural variance",
        timing: TimingProfile(
            keystroke_delay: DelayRange(min: 80, max: 250, distribution: "gaussian"),
            typing_cadence: TypingCadence(wpm: 65, variance: 0.3, pause_after_word: DelayRange(min: 30, max: 150)),
            click_dwell: DelayRange(min: 40, max: 120),
            action_gap: DelayRange(min: 100, max: 400)
        ),
        mouse: MouseProfile(pixels_per_second: 800, curve: "bezier", jitter: 2, overshoot: 0.05),
        scroll: ScrollProfile(events_per_action: 4, deceleration: 0.7, interval_ms: 30),
        ax: AXProfile(depth: 20, timeout: 5000)
    )
}

struct TimingProfile: Codable {
    var keystroke_delay: DelayRange
    var typing_cadence: TypingCadence
    var click_dwell: DelayRange
    var action_gap: DelayRange
}

struct DelayRange: Codable {
    var min: Int
    var max: Int
    var distribution: String?     // "gaussian" | "uniform"
}

struct TypingCadence: Codable {
    var wpm: Int
    var variance: Double
    var pause_after_word: DelayRange?
}

struct MouseProfile: Codable {
    var pixels_per_second: Double
    var curve: String             // "bezier" | "linear"
    var jitter: Double
    var overshoot: Double
}

struct ScrollProfile: Codable {
    var events_per_action: Int
    var deceleration: Double
    var interval_ms: Int
}

struct AXProfile: Codable {
    var depth: Int
    var timeout: Int              // milliseconds
}

// MARK: - AX Targeting

enum MatchMode: String {
    case exact = "exact"
    case contains = "contains"
    case regex = "regex"
}

/// All fields that can identify an AX element.
struct ElementQuery {
    var pid: pid_t
    var role: String?
    var title: String?
    var label: String?
    var identifier: String?
    var value: String?
    var index: Int?
    var near: CGPoint?
    var matchMode: MatchMode = .exact
    var maxDepth: Int = 20
    var timeoutMs: Int = 5000
    var subtree: SubtreeSpec?

    /// Build from an ActionRequest + session context.
    init(from req: ActionRequest, context: SessionContext, profile: BehaviorProfile) {
        self.pid = pid_t(req.pid ?? context.pid ?? 0)
        self.role = req.role
        self.title = req.title
        self.label = req.label
        self.identifier = req.identifier
        self.value = req.value
        self.index = req.index
        if let near = req.near, near.count == 2 {
            self.near = CGPoint(x: near[0], y: near[1])
        }
        self.matchMode = MatchMode(rawValue: req.match ?? "exact") ?? .exact
        self.maxDepth = req.depth ?? profile.ax.depth
        self.timeoutMs = req.timeout ?? profile.ax.timeout
        self.subtree = context.subtree
    }

    /// Direct init for internal use (subtree search, CLI commands).
    init(pid: pid_t, role: String? = nil, title: String? = nil, label: String? = nil,
         identifier: String? = nil, value: String? = nil, index: Int? = nil,
         near: CGPoint? = nil, matchMode: MatchMode = .exact,
         maxDepth: Int = 20, timeoutMs: Int = 5000, subtree: SubtreeSpec? = nil) {
        self.pid = pid
        self.role = role
        self.title = title
        self.label = label
        self.identifier = identifier
        self.value = value
        self.index = index
        self.near = near
        self.matchMode = matchMode
        self.maxDepth = maxDepth
        self.timeoutMs = timeoutMs
        self.subtree = subtree
    }
}

// MARK: - CLI v1 Compatibility (standalone mode)

/// Used only by the standalone CLI commands (backward compat with v1).
struct LegacySuccessResponse: Encodable {
    let status: String
    let action: String
    let backend: String
    let target: LegacyTargetInfo
    var detail: String?
}

struct LegacyTargetInfo: Encodable {
    var pid: Int?
    var role: String?
    var title: String?
    var index: Int?
    var x: Double?
    var y: Double?
    var x2: Double?
    var y2: Double?
    var app: String?
    var script: String?
    var window_id: Int?
    var width: Double?
    var height: Double?
    var text: String?
    var keys: String?
}
