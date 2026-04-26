import CoreGraphics
import Foundation

struct DesktopWorldSurfaceSegment: Codable, Equatable {
    let displayID: UInt32          // CGDirectDisplayID
    let index: Int                 // position in the ordered topology
    let dwBounds: [CGFloat]        // [x, y, w, h] in DesktopWorld coords
    let nativeBounds: [CGFloat]    // [x, y, w, h] in native CG coords

    init(displayID: UInt32, index: Int, dwBounds: [CGFloat], nativeBounds: [CGFloat]) {
        precondition(dwBounds.count == 4,
                     "dwBounds must have exactly 4 elements [x, y, w, h]")
        precondition(nativeBounds.count == 4,
                     "nativeBounds must have exactly 4 elements [x, y, w, h]")
        self.displayID = displayID
        self.index = index
        self.dwBounds = dwBounds
        self.nativeBounds = nativeBounds
    }

    enum CodingKeys: String, CodingKey {
        case displayID = "display_id"
        case index
        case dwBounds = "dw_bounds"
        case nativeBounds = "native_bounds"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let displayID    = try c.decode(UInt32.self,    forKey: .displayID)
        let index        = try c.decode(Int.self,       forKey: .index)
        let dwBounds     = try c.decode([CGFloat].self, forKey: .dwBounds)
        let nativeBounds = try c.decode([CGFloat].self, forKey: .nativeBounds)
        self.init(displayID: displayID, index: index,
                  dwBounds: dwBounds, nativeBounds: nativeBounds)
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
