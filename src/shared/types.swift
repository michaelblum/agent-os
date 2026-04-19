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

/// Convert AOS global coordinates (top-left of the primary display, Y-down)
/// into AppKit global screen coordinates (bottom-left of the primary display,
/// Y-up). This is the canonical point transform for display/window placement.
func cgPointToScreen(_ point: CGPoint) -> NSPoint {
    let primaryHeight = mainDisplayHeight()
    guard primaryHeight > 0 else {
        return NSPoint(x: point.x, y: point.y)
    }
    return NSPoint(x: point.x, y: primaryHeight - point.y)
}

/// Convert AppKit global screen coordinates back into AOS global coordinates.
func screenPointToCG(_ point: NSPoint) -> CGPoint {
    let primaryHeight = mainDisplayHeight()
    guard primaryHeight > 0 else {
        return CGPoint(x: point.x, y: point.y)
    }
    return CGPoint(x: point.x, y: primaryHeight - point.y)
}

/// Convert an AOS global rect into an AppKit global screen rect.
func cgToScreen(_ cgRect: CGRect) -> NSRect {
    let bottomLeft = cgPointToScreen(
        CGPoint(x: cgRect.origin.x, y: cgRect.origin.y + cgRect.size.height)
    )
    return NSRect(origin: bottomLeft, size: cgRect.size)
}

/// Convert an AppKit global screen rect back into an AOS global rect.
func screenToCG(_ nsRect: NSRect) -> CGRect {
    let topLeft = screenPointToCG(
        NSPoint(x: nsRect.origin.x, y: nsRect.origin.y + nsRect.size.height)
    )
    return CGRect(origin: topLeft, size: nsRect.size)
}

/// Convert AppKit mouse coordinates (bottom-left origin on the primary display)
/// into the shared AOS global coordinate space (top-left origin on the primary display).
func mouseInCGCoords() -> CGPoint {
    screenPointToCG(NSEvent.mouseLocation)
}
