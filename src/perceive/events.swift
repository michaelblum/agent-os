// events.swift — Perception event definitions and emission

import Foundation
import CoreGraphics

// MARK: - Perception Event Names

enum PerceptionEvent: String {
    // Depth 0
    case cursor_moved = "cursor_moved"
    case cursor_settled = "cursor_settled"
    case input_event = "input_event"
    // Depth 1
    case window_entered = "window_entered"
    case app_entered = "app_entered"
    // Depth 2
    case element_focused = "element_focused"
}

// MARK: - Event Data Builders

private final class AOSInputEventIdentityState {
    private let lock = NSLock()
    private var nextValue: UInt64 = 0
    private var activePointerGestureID: String?

    func identity(for type: String) -> (sequence: UInt64, gestureID: String?) {
        lock.lock()
        defer { lock.unlock() }

        nextValue += 1
        let sequence = nextValue
        let phase = inputEventPhase(type)
        let eventKind = inputEventKind(type)
        var gestureID: String?

        if eventKind == "pointer" || eventKind == "scroll" {
            if phase == "down" {
                gestureID = "g-\(sequence)"
                activePointerGestureID = gestureID
            } else if phase == "drag" || phase == "up" {
                gestureID = activePointerGestureID ?? "g-\(sequence)"
                if phase == "up" {
                    activePointerGestureID = nil
                }
            } else {
                gestureID = "g-\(sequence)"
            }
        }

        return (sequence, gestureID)
    }
}

private let aosInputEventIdentityState = AOSInputEventIdentityState()

private func inputEventKind(_ type: String) -> String {
    switch type {
    case "scroll_wheel":
        return "scroll"
    case "key_down", "key_up":
        return "key"
    case "pointer_cancel", "mouse_cancel":
        return "cancel"
    default:
        return "pointer"
    }
}

private func inputEventPhase(_ type: String) -> String? {
    switch type {
    case "left_mouse_down", "right_mouse_down", "middle_mouse_down", "other_mouse_down":
        return "down"
    case "left_mouse_dragged", "right_mouse_dragged", "middle_mouse_dragged", "other_mouse_dragged":
        return "drag"
    case "left_mouse_up", "right_mouse_up", "middle_mouse_up", "other_mouse_up":
        return "up"
    case "mouse_moved":
        return "move"
    case "scroll_wheel":
        return "scroll"
    case "pointer_cancel", "mouse_cancel":
        return "cancel"
    default:
        return nil
    }
}

private func inputEventButton(_ type: String) -> String {
    if type.hasPrefix("left_") { return "left" }
    if type.hasPrefix("right_") { return "right" }
    if type.hasPrefix("middle_") { return "middle" }
    if type.hasPrefix("other_") { return "other:0" }
    return "none"
}

private func inputEventButtons(type: String, phase: String?) -> [String: Any] {
    let pressed = phase == "down" || phase == "drag"
    return [
        "left": type.hasPrefix("left_") && pressed,
        "right": type.hasPrefix("right_") && pressed,
        "middle": type.hasPrefix("middle_") && pressed,
        "other_pressed": type.hasPrefix("other_") && pressed ? [0] : [],
    ]
}

private func inputEventDisplayID(x: Double?, y: Double?) -> Int {
    guard let x, let y else { return 1 }
    let point = CGPoint(x: x, y: y)
    return getDisplays().first(where: { $0.bounds.contains(point) }).map { Int($0.id) } ?? 1
}

private func normalizedInputEventModifiers(_ flags: [String: Bool]?) -> [String: Bool] {
    return [
        "shift": flags?["shift"] ?? false,
        "ctrl": flags?["ctrl"] ?? false,
        "cmd": flags?["cmd"] ?? false,
        "opt": flags?["opt"] ?? false,
        "fn": flags?["fn"] ?? false,
        "caps_lock": flags?["caps_lock"] ?? false,
    ]
}

func cursorMovedData(x: Double, y: Double, display: Int, velocity: Double) -> [String: Any] {
    ["x": x, "y": y, "display": display, "velocity": velocity]
}

func cursorSettledData(x: Double, y: Double, display: Int, idle_ms: Int) -> [String: Any] {
    ["x": x, "y": y, "display": display, "idle_ms": idle_ms]
}

func inputEventData(
    type: String,
    x: Double? = nil,
    y: Double? = nil,
    keyCode: Int64? = nil,
    flags: [String: Bool]? = nil,
    scrollDX: Double? = nil,
    scrollDY: Double? = nil,
    cancelReason: String? = nil
) -> [String: Any] {
    let identity = aosInputEventIdentityState.identity(for: type)
    let eventKind = inputEventKind(type)
    let phase = inputEventPhase(type)
    let modifiers = normalizedInputEventModifiers(flags)
    let hasNativePoint = x != nil && y != nil
    let canClaimV2: Bool
    switch eventKind {
    case "pointer":
        canClaimV2 = phase != nil && hasNativePoint
    case "scroll":
        canClaimV2 = phase == "scroll" && hasNativePoint && scrollDX != nil && scrollDY != nil
    case "key":
        canClaimV2 = keyCode != nil
    case "cancel":
        canClaimV2 = phase == "cancel" && cancelReason != nil
    default:
        canClaimV2 = false
    }
    var data: [String: Any] = [
        "type": type,
        "modifiers": modifiers,
    ]
    if canClaimV2 {
        data["input_schema_version"] = 2
        data["event_kind"] = eventKind
        data["timestamp_monotonic_ms"] = ProcessInfo.processInfo.systemUptime * 1000
        data["sequence"] = ["source": "daemon", "value": Int(identity.sequence)]
        data["source_origin"] = "daemon"
        if let phase { data["phase"] = phase }
        if let gestureID = identity.gestureID { data["gesture_id"] = gestureID }
    }
    if let x { data["x"] = x }
    if let y { data["y"] = y }
    if let x, let y {
        data["native"] = ["x": x, "y": y]
        data["display_id"] = inputEventDisplayID(x: x, y: y)
        data["topology_version"] = 0
    }
    if eventKind == "pointer" {
        data["device"] = "mouse"
        data["button"] = inputEventButton(type)
        data["buttons"] = inputEventButtons(type: type, phase: phase)
    }
    if eventKind == "scroll", let scrollDX, let scrollDY {
        data["device"] = "mouse"
        data["scroll"] = ["dx": scrollDX, "dy": scrollDY, "unit": "point"]
    }
    if eventKind == "key", let keyCode {
        data["key_code"] = keyCode
        data["key"] = [
            "physical_key_code": Int(keyCode),
            "logical": "",
            "repeat": false,
            "is_printable": false,
        ]
    }
    if eventKind == "cancel", let cancelReason {
        data["cancel_reason"] = cancelReason
    }
    if let flags { data["flags"] = flags }
    return data
}

func windowEnteredData(window_id: Int, app: String, pid: Int, bundle_id: String?, bounds: Bounds) -> [String: Any] {
    var d: [String: Any] = [
        "window_id": window_id, "app": app, "pid": pid,
        "bounds": ["x": bounds.x, "y": bounds.y, "width": bounds.width, "height": bounds.height]
    ]
    if let bid = bundle_id { d["bundle_id"] = bid }
    return d
}

func appEnteredData(app: String, pid: Int, bundle_id: String?) -> [String: Any] {
    var d: [String: Any] = ["app": app, "pid": pid]
    if let bid = bundle_id { d["bundle_id"] = bid }
    return d
}

func elementFocusedData(role: String, title: String?, label: String?, value: String?,
                         bounds: Bounds?, action_names: [String] = [], capabilities: [String] = [],
                         context_path: [String]) -> [String: Any] {
    var d: [String: Any] = ["role": role, "context_path": context_path]
    if let t = title { d["title"] = t }
    if let l = label { d["label"] = l }
    if let v = value { d["value"] = v }
    if let b = bounds {
        d["bounds"] = ["x": b.x, "y": b.y, "width": b.width, "height": b.height]
    }
    d["action_names"] = action_names
    d["capabilities"] = capabilities
    return d
}
