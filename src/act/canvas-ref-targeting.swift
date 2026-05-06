// canvas-ref-targeting.swift — Resolve AOS-owned canvas semantic refs for actions.

import CoreGraphics
import Foundation

struct CanvasRefTarget {
    let canvasID: String
    let ref: String
}

struct CanvasRefClickPoint: Encodable {
    let x: Double
    let y: Double
}

struct CanvasRefClickTargetInfo: Encodable {
    let target_dialect: String
    let canvas_id: String
    let ref: String
    let target_id: String?
    let role: String
    let name: String?
    let action: String?
    let surface: String?
    let parent_canvas: String?
    let enabled: Bool
    let bounds: BoundsJSON
    let local_center: CursorJSON
    let click: CanvasRefClickPoint
    let coordinate_space: String
    let capture_scale_factor: Double
    let source: String
}

struct CanvasRefClickResolution {
    let target: CanvasRefClickTargetInfo
    let point: CGPoint
}

func parseCanvasRefTarget(_ raw: String) -> CanvasRefTarget? {
    guard raw.hasPrefix("canvas:") else { return nil }
    let body = String(raw.dropFirst("canvas:".count))
    let parts = body.split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    let canvasID = String(parts[0])
    let ref = String(parts[1])
    guard !canvasID.isEmpty, !ref.isEmpty else { return nil }
    return CanvasRefTarget(canvasID: canvasID, ref: ref)
}

func resolveCanvasRefClickTarget(_ rawTarget: String) -> CanvasRefClickResolution {
    guard let parsed = parseCanvasRefTarget(rawTarget) else {
        exitError("invalid canvas target. Expected canvas:<canvas-id>/<ref>", code: "INVALID_TARGET")
    }

    guard let canvas = readCanvasInfo(id: parsed.canvasID) else {
        exitError("Canvas '\(parsed.canvasID)' not found", code: "CANVAS_NOT_FOUND")
    }
    if let segments = canvas.segments, !segments.isEmpty {
        exitError(
            "Ref click does not support segmented DesktopWorld canvases in V0: \(parsed.canvasID)",
            code: "UNSUPPORTED_SURFACE"
        )
    }
    if canvas.suspended == true {
        exitError("Canvas '\(parsed.canvasID)' is suspended", code: "CANVAS_SUSPENDED")
    }
    if !canvas.interactive {
        exitError("Canvas '\(parsed.canvasID)' is not interactive", code: "CANVAS_NOT_INTERACTIVE")
    }
    guard canvas.at.count == 4, canvas.at[2] > 0, canvas.at[3] > 0 else {
        exitError("Canvas '\(parsed.canvasID)' has invalid bounds", code: "INVALID_CANVAS_BOUNDS")
    }

    let canvasBounds = CGRect(
        x: canvas.at[0],
        y: canvas.at[1],
        width: canvas.at[2],
        height: canvas.at[3]
    ).integral
    let displays = getCaptureDisplays()
    let surfaceSegments = resolveSurfaceSegments(canvasBounds, displays: displays)
    let captureScale = max(surfaceSegments.map { $0.display.scaleFactor }.max() ?? 1.0, 1.0)

    guard let targets = collectCanvasSemanticTargets(canvasID: parsed.canvasID, scaleFactor: captureScale) else {
        exitError(
            "Unable to collect semantic targets for canvas '\(parsed.canvasID)'",
            code: "SEMANTIC_TARGETS_UNAVAILABLE"
        )
    }

    let matches = targets.filter { target in
        target.canvas_id == parsed.canvasID && target.ref == parsed.ref
    }
    guard !matches.isEmpty else {
        exitError("Ref '\(parsed.ref)' not found on canvas '\(parsed.canvasID)'", code: "REF_NOT_FOUND")
    }
    guard matches.count == 1, let target = matches.first else {
        exitError(
            "Ref '\(parsed.ref)' matched \(matches.count) semantic targets on canvas '\(parsed.canvasID)'",
            code: "TARGET_AMBIGUOUS"
        )
    }
    guard target.enabled, target.state?.disabled != true else {
        exitError("Ref '\(parsed.ref)' on canvas '\(parsed.canvasID)' is disabled", code: "TARGET_DISABLED")
    }

    let globalX = canvasBounds.origin.x + CGFloat(Double(target.center.x) / captureScale)
    let globalY = canvasBounds.origin.y + CGFloat(Double(target.center.y) / captureScale)
    let point = CGPoint(x: globalX, y: globalY)

    return CanvasRefClickResolution(
        target: CanvasRefClickTargetInfo(
            target_dialect: "canvas",
            canvas_id: parsed.canvasID,
            ref: parsed.ref,
            target_id: target.id,
            role: target.role,
            name: target.name,
            action: target.action,
            surface: target.surface,
            parent_canvas: target.parent_canvas,
            enabled: target.enabled,
            bounds: target.bounds,
            local_center: target.center,
            click: CanvasRefClickPoint(x: Double(point.x), y: Double(point.y)),
            coordinate_space: "global_cg",
            capture_scale_factor: captureScale,
            source: "aos_semantic_targets"
        ),
        point: point
    )
}

func printCanvasRefClickResult(
    target: CanvasRefClickTargetInfo,
    detail: String?,
    dryRun: Bool,
    stateID: String?
) {
    struct Payload: Encodable {
        let status: String
        let action: String
        let backend: String
        let target: CanvasRefClickTargetInfo
        let detail: String?
        let execution: ActionExecutionMetadata
    }

    let payload = Payload(
        status: dryRun ? "dry_run" : "success",
        action: "click",
        backend: "cgevent",
        target: target,
        detail: detail,
        execution: ActionExecutionMetadata(
            strategy: dryRun ? "dry_run_canvas_ref_click" : "cgevent_canvas_ref_click",
            backend: "cgevent",
            fallback_used: false,
            state_id: stateID
        )
    )
    writeJSONLine(payload)
}
