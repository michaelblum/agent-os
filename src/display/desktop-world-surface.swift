import CoreGraphics
import Foundation

struct DesktopWorldSurfaceSegment: Codable, Equatable {
    let displayID: UInt32          // CGDirectDisplayID
    let index: Int                 // position in the ordered topology
    let dwBounds: [CGFloat]        // [x, y, w, h] in DesktopWorld coords
    let nativeBounds: [CGFloat]    // [x, y, w, h] in native CG coords

    enum CodingKeys: String, CodingKey {
        case displayID = "display_id"
        case index
        case dwBounds = "dw_bounds"
        case nativeBounds = "native_bounds"
    }
}

/// Orders segments by (dwBounds.y asc, dwBounds.x asc, displayID asc).
/// Total order; always yields a unique first segment when at least one
/// segment exists.
func orderSegments(_ unordered: [DesktopWorldSurfaceSegment]) -> [DesktopWorldSurfaceSegment] {
    let sorted = unordered.sorted { a, b in
        if a.dwBounds[1] != b.dwBounds[1] { return a.dwBounds[1] < b.dwBounds[1] }
        if a.dwBounds[0] != b.dwBounds[0] { return a.dwBounds[0] < b.dwBounds[0] }
        return a.displayID < b.displayID
    }
    return sorted.enumerated().map { (i, s) in
        DesktopWorldSurfaceSegment(displayID: s.displayID, index: i,
                                    dwBounds: s.dwBounds, nativeBounds: s.nativeBounds)
    }
}
