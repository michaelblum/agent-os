import AppKit
import CoreGraphics
import Foundation

/// Produces the event payload (JSON-ready dict) broadcast on the
/// `display_geometry` channel. Per-display shape is a subset of
/// `spatial-topology.schema.json`'s `displays[]`: it carries both the
/// native-compat fields (`bounds`, `visible_bounds`, plus explicit
/// `native_bounds` / `native_visible_bounds` aliases) and the canonical
/// DesktopWorld-anchored fields (`desktop_world_bounds`,
/// `visible_desktop_world_bounds`). The top-level payload adds
/// `desktop_world_bounds` / `visible_desktop_world_bounds` aggregates
/// alongside the retained `global_bounds` native-compat alias.
///
/// Cursor fields are intentionally absent from this channel — the
/// topology schema owns DesktopWorld cursor coordinates via
/// `aos see list`. Live cursor consumers re-anchor `input_event`
/// messages at the boundary via `nativeToDesktopWorldPoint`.
func snapshotDisplayGeometry() -> [String: Any] {
    let entries = getDisplays()  // from src/perceive/models.swift
    let screensByNumber = screenIndexByDisplayNumber()

    var displayDicts: [[String: Any]] = []
    var minX = Double.infinity, minY = Double.infinity
    var maxX = -Double.infinity, maxY = -Double.infinity

    for entry in entries {
        let cgID = entry.id
        let uuid = displayUUID(for: cgID) ?? ""
        let bounds = entry.bounds
        let visible = visibleBounds(for: cgID, fallback: bounds, screens: screensByNumber)
        let rotation = Int(CGDisplayRotation(cgID))

        let nativeBounds: [String: Double] = [
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "w": bounds.width,
            "h": bounds.height,
        ]
        let nativeVisible: [String: Double] = [
            "x": visible.origin.x,
            "y": visible.origin.y,
            "w": visible.width,
            "h": visible.height,
        ]

        displayDicts.append([
            "display_id": Int(cgID),
            "display_uuid": uuid,
            "bounds": nativeBounds,
            "visible_bounds": nativeVisible,
            "native_bounds": nativeBounds,
            "native_visible_bounds": nativeVisible,
            "scale_factor": entry.scaleFactor,
            "rotation": rotation,
            "is_main": entry.isMain,
        ])

        minX = min(minX, bounds.minX)
        minY = min(minY, bounds.minY)
        maxX = max(maxX, bounds.maxX)
        maxY = max(maxY, bounds.maxY)
    }

    let globalBounds: [String: Double]
    let nativeUnion: (x: Double, y: Double, w: Double, h: Double)
    if entries.isEmpty {
        globalBounds = ["x": 0, "y": 0, "w": 0, "h": 0]
        nativeUnion = (0, 0, 0, 0)
    } else {
        nativeUnion = (minX, minY, maxX - minX, maxY - minY)
        globalBounds = [
            "x": nativeUnion.x,
            "y": nativeUnion.y,
            "w": nativeUnion.w,
            "h": nativeUnion.h,
        ]
    }

    // VisibleDesktopWorld native-side union.
    var visibleMinX = Double.infinity
    var visibleMinY = Double.infinity
    var visibleMaxX = -Double.infinity
    var visibleMaxY = -Double.infinity
    for display in displayDicts {
        guard let v = display["native_visible_bounds"] as? [String: Double] else { continue }
        visibleMinX = min(visibleMinX, v["x"] ?? 0)
        visibleMinY = min(visibleMinY, v["y"] ?? 0)
        visibleMaxX = max(visibleMaxX, (v["x"] ?? 0) + (v["w"] ?? 0))
        visibleMaxY = max(visibleMaxY, (v["y"] ?? 0) + (v["h"] ?? 0))
    }
    let visibleUnionNative: (x: Double, y: Double, w: Double, h: Double)
    if !visibleMinX.isFinite {
        visibleUnionNative = nativeUnion
    } else {
        visibleUnionNative = (
            visibleMinX,
            visibleMinY,
            visibleMaxX - visibleMinX,
            visibleMaxY - visibleMinY
        )
    }

    // Re-anchor every native rect into DesktopWorld by subtracting the
    // full-desktop native union origin. The full DesktopWorld union lands
    // at (0,0,w,h) by construction.
    func reanchor(_ rect: [String: Double]) -> [String: Double] {
        [
            "x": (rect["x"] ?? 0) - nativeUnion.x,
            "y": (rect["y"] ?? 0) - nativeUnion.y,
            "w": rect["w"] ?? 0,
            "h": rect["h"] ?? 0,
        ]
    }
    for idx in displayDicts.indices {
        if let native = displayDicts[idx]["native_bounds"] as? [String: Double] {
            displayDicts[idx]["desktop_world_bounds"] = reanchor(native)
        }
        if let nativeVisible = displayDicts[idx]["native_visible_bounds"] as? [String: Double] {
            displayDicts[idx]["visible_desktop_world_bounds"] = reanchor(nativeVisible)
        }
    }

    let desktopWorldBounds: [String: Double] = [
        "x": 0,
        "y": 0,
        "w": nativeUnion.w,
        "h": nativeUnion.h,
    ]
    let visibleDesktopWorldBounds: [String: Double] = [
        "x": visibleUnionNative.x - nativeUnion.x,
        "y": visibleUnionNative.y - nativeUnion.y,
        "w": visibleUnionNative.w,
        "h": visibleUnionNative.h,
    ]

    return [
        "type": "display_geometry",
        "displays": displayDicts,
        "global_bounds": globalBounds,
        "desktop_world_bounds": desktopWorldBounds,
        "visible_desktop_world_bounds": visibleDesktopWorldBounds,
    ]
}

/// Lookup CGDirectDisplayID -> UUID string, e.g.
/// "37D8832A-2B0A-4DFB-8C3E-CFFD4C93F3A5".
private func displayUUID(for id: CGDirectDisplayID) -> String? {
    guard let uuidRef = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else {
        return nil
    }
    guard let str = CFUUIDCreateString(nil, uuidRef) as String? else {
        return nil
    }
    return str
}

/// Index NSScreen by its `NSScreenNumber` device description key (the
/// CGDirectDisplayID). Used to look up `visibleFrame` per display.
private func screenIndexByDisplayNumber() -> [CGDirectDisplayID: NSScreen] {
    var map: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let num = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            map[CGDirectDisplayID(num.uint32Value)] = screen
        }
    }
    return map
}

/// Return visible bounds in top-left-origin coordinates matching the
/// AOS global CG convention. NSScreen returns frames in bottom-left
/// origin; we flip y against the primary display's full height so the
/// result is consistent with `CGDisplayBounds`.
private func visibleBounds(
    for id: CGDirectDisplayID,
    fallback: CGRect,
    screens: [CGDirectDisplayID: NSScreen]
) -> CGRect {
    guard let screen = screens[id] else { return fallback }
    let visibleBottomLeft = screen.visibleFrame
    let fullBottomLeft = screen.frame

    // visibleFrame sits inside frame. Top inset = (frame.maxY - visibleFrame.maxY).
    // Bottom inset = (visibleFrame.minY - frame.minY).
    let topInset = fullBottomLeft.maxY - visibleBottomLeft.maxY
    let leftInset = visibleBottomLeft.minX - fullBottomLeft.minX

    return CGRect(
        x: fallback.origin.x + leftInset,
        y: fallback.origin.y + topInset,
        width: visibleBottomLeft.width,
        height: visibleBottomLeft.height
    )
}
