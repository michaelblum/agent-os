import AppKit
import CoreGraphics
import Foundation

/// Produces the event payload (JSON-ready dict) broadcast on the
/// `display_geometry` channel. The shape is a subset of
/// `spatial-topology.schema.json`'s `displays[]`, plus a derived
/// `global_bounds` convenience field.
///
/// Coordinate system is the shared AOS convention: top-left of primary
/// display = (0, 0), logical points, per-display `scale_factor`.
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

        displayDicts.append([
            "display_id": Int(cgID),
            "display_uuid": uuid,
            "bounds": [
                "x": bounds.origin.x,
                "y": bounds.origin.y,
                "w": bounds.width,
                "h": bounds.height,
            ],
            "visible_bounds": [
                "x": visible.origin.x,
                "y": visible.origin.y,
                "w": visible.width,
                "h": visible.height,
            ],
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
    if entries.isEmpty {
        globalBounds = ["x": 0, "y": 0, "w": 0, "h": 0]
    } else {
        globalBounds = [
            "x": minX,
            "y": minY,
            "w": maxX - minX,
            "h": maxY - minY,
        ]
    }

    return [
        "type": "display_geometry",
        "displays": displayDicts,
        "global_bounds": globalBounds,
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
