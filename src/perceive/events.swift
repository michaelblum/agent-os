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

func cursorMovedData(x: Double, y: Double, display: Int, velocity: Double) -> [String: Any] {
    ["x": x, "y": y, "display": display, "velocity": velocity]
}

func cursorSettledData(x: Double, y: Double, display: Int, idle_ms: Int) -> [String: Any] {
    ["x": x, "y": y, "display": display, "idle_ms": idle_ms]
}

func inputEventData(type: String, x: Double? = nil, y: Double? = nil, keyCode: Int64? = nil, flags: [String: Bool]? = nil) -> [String: Any] {
    var data: [String: Any] = ["type": type]
    if let x { data["x"] = x }
    if let y { data["y"] = y }
    if let keyCode { data["key_code"] = keyCode }
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
                         bounds: Bounds?, context_path: [String]) -> [String: Any] {
    var d: [String: Any] = ["role": role, "context_path": context_path]
    if let t = title { d["title"] = t }
    if let l = label { d["label"] = l }
    if let v = value { d["value"] = v }
    if let b = bounds {
        d["bounds"] = ["x": b.x, "y": b.y, "width": b.width, "height": b.height]
    }
    return d
}
