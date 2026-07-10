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

    func identity(for type: String, gestureIDOverride: String? = nil) -> (sequence: UInt64, gestureID: String?) {
        lock.lock()
        defer { lock.unlock() }

        nextValue += 1
        let sequence = nextValue
        let descriptor = AOSInputEventDescriptor(type: type)
        var gestureID: String?

        if let gestureIDOverride,
           (descriptor?.kind == .pointer || descriptor?.kind == .scroll) {
            gestureID = gestureIDOverride
        } else if descriptor?.kind == .pointer || descriptor?.kind == .scroll {
            if descriptor?.phase == .down {
                gestureID = "g-\(sequence)"
                activePointerGestureID = gestureID
            } else if descriptor?.phase == .drag || descriptor?.phase == .up {
                gestureID = activePointerGestureID ?? "g-\(sequence)"
                if descriptor?.phase == .up {
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
    cancelReason: String? = nil,
    gestureIDOverride: String? = nil
) -> [String: Any] {
    let identity = aosInputEventIdentityState.identity(
        for: type,
        gestureIDOverride: gestureIDOverride
    )
    let descriptor = AOSInputEventDescriptor(type: type)
    let canonicalEvent = AOSCanonicalInputEvent(
        type: type,
        x: x,
        y: y,
        keyCode: keyCode,
        scrollDX: scrollDX,
        scrollDY: scrollDY,
        cancelReason: cancelReason
    )
    let modifiers = normalizedInputEventModifiers(flags)
    var data: [String: Any] = [
        "type": type,
        "modifiers": modifiers,
    ]
    if let canonicalEvent {
        let descriptor = canonicalEvent.descriptor
        data["input_schema_version"] = 2
        data["event_kind"] = descriptor.kind.rawValue
        data["timestamp_monotonic_ms"] = ProcessInfo.processInfo.systemUptime * 1000
        data["sequence"] = ["source": "daemon", "value": Int(identity.sequence)]
        data["source_origin"] = "daemon"
        if let phase = descriptor.phase { data["phase"] = phase.rawValue }
        if let gestureID = identity.gestureID { data["gesture_id"] = gestureID }
    }
    if let x { data["x"] = x }
    if let y { data["y"] = y }
    if let x, let y {
        data["native"] = ["x": x, "y": y]
        data["display_id"] = inputEventDisplayID(x: x, y: y)
        data["topology_version"] = 0
    }
    if descriptor?.kind == .pointer {
        data["device"] = "mouse"
        data["button"] = descriptor?.button?.rawValue ?? "none"
        data["buttons"] = descriptor?.buttonState?.jsonObject ?? AOSInputButtonState(
            left: false,
            right: false,
            middle: false,
            otherPressed: []
        ).jsonObject
    }
    if case .scroll(_, _, let dx, let dy) = canonicalEvent {
        data["device"] = "mouse"
        data["scroll"] = ["dx": dx, "dy": dy, "unit": "point"]
    } else if descriptor?.kind == .scroll, let scrollDX, let scrollDY {
        data["device"] = "mouse"
        data["scroll"] = ["dx": scrollDX, "dy": scrollDY, "unit": "point"]
    }
    if case .key(_, let canonicalKeyCode) = canonicalEvent {
        data["key_code"] = canonicalKeyCode
        data["key"] = [
            "physical_key_code": Int(canonicalKeyCode),
            "logical": "",
            "repeat": false,
            "is_printable": false,
        ]
    } else if descriptor?.kind == .key, let keyCode {
        data["key_code"] = keyCode
        data["key"] = [
            "physical_key_code": Int(keyCode),
            "logical": "",
            "repeat": false,
            "is_printable": false,
        ]
    }
    if case .cancel(_, let canonicalReason) = canonicalEvent {
        data["cancel_reason"] = canonicalReason.rawValue
    } else if descriptor?.kind == .cancel, let cancelReason {
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
                         bounds: Bounds?, action_names: [String] = [],
                         settable_attributes: [String] = [], ancestor_chain: [[String: Any]] = []) -> [String: Any] {
    var d: [String: Any] = ["role": role, "ancestor_chain": ancestor_chain]
    if let t = title { d["title"] = t }
    if let l = label { d["label"] = l }
    if let v = value { d["value"] = v }
    if let b = bounds {
        d["bounds"] = ["x": b.x, "y": b.y, "width": b.width, "height": b.height]
    }
    d["action_names"] = action_names
    d["settable_attributes"] = settable_attributes
    return d
}
