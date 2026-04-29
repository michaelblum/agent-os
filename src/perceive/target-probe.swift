// target-probe.swift — aos see target: compact structured target acquisition

import Foundation

struct TargetProbeResponse: Encodable {
    let type: String
    let schema_version: String
    let probe_id: String
    let mode: String
    let origin: TargetProbeOrigin
    let surface: TargetProbeSurface
    let target: TargetProbeTarget
    let path: [TargetProbePathNode]
    let nearby: [TargetProbeNearbyNode]?
    let handles: [String: String]
    let available_expansions: [String]
    let privacy: TargetProbePrivacy
    let budgets: TargetProbeBudgets
    let at: String
}

struct TargetProbeOrigin: Encodable {
    let kind: String
    let point: CursorPoint?
    let display_id: Int?
    let gesture: String?
    let utterance: String?
}

struct TargetProbeSurface: Encodable {
    let kind: String
    let app: String?
    let bundle_id: String?
    let pid: Int?
    let window_id: Int?
    let window_title: String?
    let browser_session: String?
    let url: String?
    let title: String?
    let canvas_id: String?
    let bounds: Bounds?
}

struct TargetProbeTarget: Encodable {
    let kind: String
    let role: String?
    let label: String?
    let title: String?
    let name: String?
    let value_preview: String?
    let text_preview: String?
    let enabled: Bool?
    let selected: Bool?
    let checked: Bool?
    let bounds: Bounds?
    let ref: String?
    let selector: String?
    let mime_type: String?
}

struct TargetProbePathNode: Encodable {
    let kind: String
    let label: String
    let role: String?
    let bounds: Bounds?
    let handle: String?
    let state: [String: TargetProbeScalar]?
}

struct TargetProbeNearbyNode: Encodable {
    let relation: String
    let kind: String
    let role: String?
    let label: String?
    let value: TargetProbeScalar?
    let bounds: Bounds?
    let handle: String?
}

enum TargetProbeScalar: Encodable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

struct TargetProbePrivacy: Encodable {
    let redaction: String
    let notes: [String]?
}

struct TargetProbeBudgets: Encodable {
    let elapsed_ms: Double
    let text_preview_chars: Int
    let text_total_chars: Int?
    let max_nodes: Int
    let nodes_returned: Int?
    let max_depth: Int
    let depth_returned: Int?
}

func targetProbeCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["see"], json: args.contains("--json"))
        exit(0)
    }

    let started = Date()
    let cursor = buildCursorResponse()
    let probeID = "probe_" + UUID().uuidString.lowercased()

    let surface: TargetProbeSurface
    if let window = cursor.window {
        surface = TargetProbeSurface(
            kind: "native_app",
            app: window.app_name,
            bundle_id: window.bundle_id,
            pid: window.app_pid,
            window_id: window.window_id,
            window_title: window.title,
            browser_session: nil,
            url: nil,
            title: nil,
            canvas_id: nil,
            bounds: window.bounds
        )
    } else {
        surface = TargetProbeSurface(
            kind: "unknown",
            app: nil,
            bundle_id: nil,
            pid: nil,
            window_id: nil,
            window_title: nil,
            browser_session: nil,
            url: nil,
            title: nil,
            canvas_id: nil,
            bounds: nil
        )
    }

    let target = buildTargetProbeTarget(from: cursor)
    let path = buildTargetProbePath(probeID: probeID, cursor: cursor)
    let elapsedMs = Date().timeIntervalSince(started) * 1000.0
    let textChars = target.value_preview?.count ?? target.text_preview?.count ?? target.label?.count ?? 0

    let response = TargetProbeResponse(
        type: "target.probe",
        schema_version: "aos.target-probe.v0",
        probe_id: probeID,
        mode: "fast",
        origin: TargetProbeOrigin(
            kind: "cursor",
            point: cursor.cursor,
            display_id: cursor.display,
            gesture: nil,
            utterance: nil
        ),
        surface: surface,
        target: target,
        path: path,
        nearby: nil,
        handles: buildTargetProbeHandles(probeID: probeID, cursor: cursor),
        available_expansions: buildTargetProbeExpansions(cursor: cursor),
        privacy: TargetProbePrivacy(redaction: "default", notes: nil),
        budgets: TargetProbeBudgets(
            elapsed_ms: elapsedMs,
            text_preview_chars: 200,
            text_total_chars: textChars,
            max_nodes: 12,
            nodes_returned: path.count,
            max_depth: 6,
            depth_returned: path.count
        ),
        at: iso8601Now()
    )

    print(jsonString(response))
}

private func buildTargetProbeTarget(from cursor: CursorResponse) -> TargetProbeTarget {
    guard let element = cursor.element else {
        return TargetProbeTarget(
            kind: cursor.window == nil ? "unknown" : "window",
            role: nil,
            label: cursor.window?.title,
            title: cursor.window?.title,
            name: cursor.window?.app_name,
            value_preview: nil,
            text_preview: nil,
            enabled: nil,
            selected: nil,
            checked: nil,
            bounds: cursor.window?.bounds,
            ref: nil,
            selector: nil,
            mime_type: nil
        )
    }

    return TargetProbeTarget(
        kind: "ax_element",
        role: element.role,
        label: element.label,
        title: element.title,
        name: element.title ?? element.label,
        value_preview: element.value,
        text_preview: element.value,
        enabled: element.enabled,
        selected: nil,
        checked: nil,
        bounds: element.bounds,
        ref: nil,
        selector: nil,
        mime_type: nil
    )
}

private func buildTargetProbePath(probeID: String, cursor: CursorResponse) -> [TargetProbePathNode] {
    var path: [TargetProbePathNode] = [
        TargetProbePathNode(
            kind: "display",
            label: "Display \(cursor.display)",
            role: nil,
            bounds: nil,
            handle: nil,
            state: nil
        )
    ]

    if let window = cursor.window {
        path.append(TargetProbePathNode(
            kind: "app",
            label: window.app_name,
            role: nil,
            bounds: nil,
            handle: "native://pid/\(window.app_pid)",
            state: nil
        ))
        path.append(TargetProbePathNode(
            kind: "window",
            label: window.title ?? window.app_name,
            role: nil,
            bounds: window.bounds,
            handle: "native://window/\(window.window_id)",
            state: nil
        ))
    }

    if let element = cursor.element {
        let context = element.context_path
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .prefix(6)
        for (idx, label) in context.enumerated() {
            path.append(TargetProbePathNode(
                kind: idx == context.count - 1 ? "control" : "group",
                label: label,
                role: idx == context.count - 1 ? element.role : nil,
                bounds: idx == context.count - 1 ? element.bounds : nil,
                handle: idx == context.count - 1 ? "probe://\(probeID)/target" : "probe://\(probeID)/path/\(path.count)",
                state: idx == context.count - 1 ? ["enabled": .bool(element.enabled)] : nil
            ))
        }
    }

    return Array(path.prefix(12))
}

private func buildTargetProbeHandles(probeID: String, cursor: CursorResponse) -> [String: String] {
    var handles: [String: String] = ["target": "probe://\(probeID)/target"]
    if let window = cursor.window {
        handles["surface"] = "native://pid/\(window.app_pid)"
        handles["window"] = "native://window/\(window.window_id)"
    }
    return handles
}

private func buildTargetProbeExpansions(cursor: CursorResponse) -> [String] {
    var expansions: [String] = []
    if cursor.element != nil {
        expansions.append("target.actions")
        expansions.append("parent.children")
        expansions.append("surface.visible_controls")
    } else if cursor.window != nil {
        expansions.append("surface.visible_controls")
    }
    expansions.append("artifact.capture")
    return expansions
}
