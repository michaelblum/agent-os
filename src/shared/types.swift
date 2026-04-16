// types.swift — Shared types used across modules

import AppKit
import Foundation
import CoreGraphics

// MARK: - Bounds

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }

    init(from rect: CGRect) {
        self.x = Double(rect.origin.x)
        self.y = Double(rect.origin.y)
        self.width = Double(rect.size.width)
        self.height = Double(rect.size.height)
    }

    func contains(_ point: CGPoint) -> Bool {
        point.x >= x && point.x < x + width && point.y >= y && point.y < y + height
    }
}

// MARK: - Coordinate Conversion

func globalDisplayBounds() -> CGRect {
    let displays = getDisplays()
    guard let first = displays.first else {
        return CGRect(x: 0, y: 0, width: 0, height: 0)
    }
    return displays.dropFirst().reduce(first.bounds) { partial, display in
        partial.union(display.bounds)
    }
}

func mainDisplayHeight() -> CGFloat {
    getDisplays().first(where: \.isMain)?.bounds.height ?? 0
}

/// Convert AppKit mouse coordinates (bottom-left origin on the primary display)
/// into the shared AOS global coordinate space (top-left origin on the primary display).
func mouseInCGCoords() -> CGPoint {
    let mouse = NSEvent.mouseLocation
    let primaryHeight = mainDisplayHeight()
    guard primaryHeight > 0 else {
        return CGPoint(x: mouse.x, y: mouse.y)
    }
    return CGPoint(x: mouse.x, y: primaryHeight - mouse.y)
}
