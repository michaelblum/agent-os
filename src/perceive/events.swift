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
    case target_changed = "target_changed"
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

func targetProbeEventData(
    probe_id: String,
    cursor: CGPoint,
    display: Int,
    app: String,
    pid: Int,
    bundle_id: String?,
    window_id: Int?,
    window_title: String?,
    window_bounds: Bounds?,
    hit: AXHitResult,
    elapsed_ms: Double
) -> [String: Any] {
    var surface: [String: Any] = [
        "kind": "native_app",
        "app": app,
        "pid": pid
    ]
    if let bundle_id { surface["bundle_id"] = bundle_id }
    if let window_id { surface["window_id"] = window_id }
    if let window_title { surface["window_title"] = window_title }
    if let window_bounds { surface["bounds"] = boundsDict(window_bounds) }

    var target: [String: Any] = [
        "kind": "ax_element",
        "role": hit.role,
        "enabled": hit.enabled
    ]
    if let title = hit.title { target["title"] = title; target["name"] = title }
    if let label = hit.label { target["label"] = label; if target["name"] == nil { target["name"] = label } }
    if let value = hit.value {
        target["value_preview"] = value
        target["text_preview"] = value
    }
    if let bounds = hit.bounds { target["bounds"] = boundsDict(Bounds(from: bounds)) }

    var path: [[String: Any]] = [
        ["kind": "display", "label": "Display \(display)"],
        ["kind": "app", "label": app, "handle": "native://pid/\(pid)"]
    ]
    if let window_id {
        var windowNode: [String: Any] = [
            "kind": "window",
            "label": window_title ?? app,
            "handle": "native://window/\(window_id)"
        ]
        if let window_bounds { windowNode["bounds"] = boundsDict(window_bounds) }
        path.append(windowNode)
    }

    let context = hit.contextPath
        .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        .prefix(6)
    for (idx, label) in context.enumerated() {
        let isTarget = idx == context.count - 1
        var node: [String: Any] = [
            "kind": isTarget ? "control" : "group",
            "label": label,
            "handle": isTarget ? "probe://\(probe_id)/target" : "probe://\(probe_id)/path/\(path.count)"
        ]
        if isTarget {
            node["role"] = hit.role
            node["state"] = ["enabled": hit.enabled]
            if let bounds = hit.bounds { node["bounds"] = boundsDict(Bounds(from: bounds)) }
        }
        path.append(node)
    }
    if path.count > 12 { path = Array(path.prefix(12)) }

    let textChars = hit.value?.count ?? hit.label?.count ?? hit.title?.count ?? 0
    var handles: [String: Any] = ["target": "probe://\(probe_id)/target", "surface": "native://pid/\(pid)"]
    if let window_id { handles["window"] = "native://window/\(window_id)" }

    return [
        "type": "target.probe",
        "schema_version": "aos.target-probe.v0",
        "probe_id": probe_id,
        "mode": "fast",
        "origin": [
            "kind": "cursor",
            "display_id": display,
            "point": ["x": cursor.x, "y": cursor.y]
        ],
        "surface": surface,
        "target": target,
        "path": path,
        "handles": handles,
        "available_expansions": [
            "target.actions",
            "parent.children",
            "surface.visible_controls",
            "artifact.capture"
        ],
        "privacy": ["redaction": "default"],
        "budgets": [
            "elapsed_ms": elapsed_ms,
            "text_preview_chars": 200,
            "text_total_chars": textChars,
            "max_nodes": 12,
            "nodes_returned": path.count,
            "max_depth": 6,
            "depth_returned": path.count
        ],
        "at": iso8601Now()
    ]
}

func targetProbeSignature(window_id: Int?, hit: AXHitResult) -> String {
    let bounds = hit.bounds.map { rect in
        "\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.width)),\(Int(rect.height))"
    } ?? ""
    let context = hit.contextPath.joined(separator: "›")
    return [
        String(window_id ?? 0),
        hit.role,
        hit.title ?? "",
        hit.label ?? "",
        hit.value ?? "",
        bounds,
        context
    ].joined(separator: "\u{1f}")
}

private func boundsDict(_ bounds: Bounds) -> [String: Any] {
    [
        "x": bounds.x,
        "y": bounds.y,
        "width": bounds.width,
        "height": bounds.height
    ]
}
