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
    let actions: [String]?
    let surface: String?
    let parent_canvas: String?
    let enabled: Bool
    let bounds: BoundsJSON
    let local_center: CursorJSON
    let click: CanvasRefClickPoint
    let global_point: CanvasRefClickPoint
    let coordinate_space: String
    let capture_scale_factor: Double
    let source: String
    let geometry: JSONValue?
    let metadata: JSONValue?
    let state: AOSSemanticTargetStateJSON?
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

func resolveCanvasRefTarget(_ rawTarget: String, primitive: String? = nil) -> CanvasRefClickResolution {
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
    if let primitive {
        let actions = target.actions ?? []
        guard actions.contains(primitive) else {
            exitError(
                "Ref '\(parsed.ref)' on canvas '\(parsed.canvasID)' does not support \(primitive)",
                code: "UNSUPPORTED_ACTION"
            )
        }
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
            actions: target.actions,
            surface: target.surface,
            parent_canvas: target.parent_canvas,
            enabled: target.enabled,
            bounds: target.bounds,
            local_center: target.center,
            click: CanvasRefClickPoint(x: Double(point.x), y: Double(point.y)),
            global_point: CanvasRefClickPoint(x: Double(point.x), y: Double(point.y)),
            coordinate_space: "global_cg",
            capture_scale_factor: captureScale,
            source: "aos_semantic_targets",
            geometry: target.geometry,
            metadata: target.metadata,
            state: target.state
        ),
        point: point
    )
}

func resolveCanvasRefClickTarget(_ rawTarget: String) -> CanvasRefClickResolution {
    resolveCanvasRefTarget(rawTarget, primitive: "click")
}

private func actJSONStringLiteral(_ value: String) -> String {
    guard
        let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
        let arrayLiteral = String(data: data, encoding: .utf8),
        arrayLiteral.count >= 2
    else {
        return "\"\""
    }
    return String(arrayLiteral.dropFirst().dropLast())
}

private func evalCanvasActionJSON(canvasID: String, js: String) -> [String: Any]? {
    guard
        let response = sendEnvelopeRequest(
            service: "show",
            action: "eval",
            data: ["id": canvasID, "js": js],
            autoStartBinary: aosExecutablePath()
        ),
        let decoded = decodeCanvasResponse(response),
        decoded.error == nil,
        let result = decoded.result,
        let data = result.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        return nil
    }
    return object
}

func dispatchCanvasSemanticValueAction(canvasID: String, ref: String, value: String, primitive: String) -> [String: Any] {
    let encodedRef = actJSONStringLiteral(ref)
    let encodedValue = actJSONStringLiteral(value)
    let encodedPrimitive = actJSONStringLiteral(primitive)
    let js = """
    (() => {
      const ref = \(encodedRef);
      const valueText = \(encodedValue);
      const primitive = \(encodedPrimitive);
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const matches = Array.from(document.querySelectorAll('[data-aos-ref]')).filter((el) => clean(el.getAttribute('data-aos-ref')) === ref);
      if (matches.length === 0) return JSON.stringify({ ok: false, code: 'REF_NOT_FOUND', error: `Ref '${ref}' not found` });
      if (matches.length > 1) return JSON.stringify({ ok: false, code: 'TARGET_AMBIGUOUS', error: `Ref '${ref}' matched ${matches.length} targets` });
      const el = matches[0];
      if (el.matches?.(':disabled') || el.getAttribute('aria-disabled') === 'true') {
        return JSON.stringify({ ok: false, code: 'TARGET_DISABLED', error: `Ref '${ref}' is disabled` });
      }
      const root = el.closest?.('[data-aos-slider-root]');
      const thumbCount = Number(el.getAttribute('data-aos-thumb-count') || root?.querySelectorAll?.('[data-aos-slider-thumb]')?.length || 0);
      if ((el.getAttribute('role') || '').toLowerCase() === 'slider' && thumbCount > 1) {
        return JSON.stringify({ ok: false, code: 'UNSUPPORTED_ACTION', error: `Ref '${ref}' is a multi-thumb slider` });
      }
      const value = Number(valueText);
      if (!Number.isFinite(value)) return JSON.stringify({ ok: false, code: 'INVALID_VALUE', error: 'set-value requires a numeric value for canvas sliders' });
      const event = new CustomEvent('aos:semantic-action', {
        bubbles: true,
        cancelable: true,
        detail: { action: primitive, primitive, value, toValue: value, to_value: value, ref },
      });
      const defaultAllowed = el.dispatchEvent(event);
      const target = root?.querySelector?.('[data-aos-slider-control]') || el;
      return JSON.stringify({
        ok: !defaultAllowed,
        code: defaultAllowed ? 'ACTION_NOT_HANDLED' : null,
        error: defaultAllowed ? `Ref '${ref}' did not handle ${primitive}` : null,
        value: target?.getAttribute?.('aria-valuenow') || null,
        values: target?.getAttribute?.('data-aos-values') || null,
      });
    })()
    """
    guard let result = evalCanvasActionJSON(canvasID: canvasID, js: js) else {
        exitError("Unable to execute canvas semantic action on canvas '\(canvasID)'", code: "CANVAS_ACTION_FAILED")
    }
    if (result["ok"] as? Bool) != true {
        let message = result["error"] as? String ?? "Canvas semantic action failed"
        let code = result["code"] as? String ?? "CANVAS_ACTION_FAILED"
        exitError(message, code: code)
    }
    return result
}

func updateCanvasFrameForSemanticDrag(canvasID: String, dx: Double, dy: Double) {
    guard let canvas = readCanvasInfo(id: canvasID) else {
        exitError("Canvas '\(canvasID)' not found", code: "CANVAS_NOT_FOUND")
    }
    guard canvas.at.count == 4 else {
        exitError("Canvas '\(canvasID)' has invalid bounds", code: "INVALID_CANVAS_BOUNDS")
    }
    let frame: [Double] = [
        Double(canvas.at[0]) + dx,
        Double(canvas.at[1]) + dy,
        Double(canvas.at[2]),
        Double(canvas.at[3]),
    ]
    let response = sendEnvelopeRequest(
        service: "show",
        action: "update",
        data: [
            "id": canvasID,
            "at": frame,
            "geometry_change": "origin",
            "geometry_cause": "aos.semantic.drag",
            "geometry_phase": "settled",
        ],
        autoStartBinary: aosExecutablePath()
    )
    guard
        let decoded = response.flatMap(decodeCanvasResponse),
        decoded.error == nil
    else {
        exitError("Canvas semantic drag update failed for '\(canvasID)'", code: "CANVAS_ACTION_FAILED")
    }
}

func currentCanvasTargetSnapshot(canvasID: String, ref: String, scaleFactor: Double) -> AOSSemanticTargetJSON? {
    collectCanvasSemanticTargets(canvasID: canvasID, scaleFactor: scaleFactor)?
        .first(where: { $0.canvas_id == canvasID && $0.ref == ref })
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
