import CoreGraphics
import Foundation

struct AOSDesktopPixelDimensions: Equatable, Sendable {
    let height: Int
    let width: Int

    init?(
        pointWidth: Double,
        pointHeight: Double,
        pointPixelScale: Double
    ) {
        guard pointWidth.isFinite,
              pointHeight.isFinite,
              pointPixelScale.isFinite,
              pointWidth > 0,
              pointHeight > 0,
              pointPixelScale > 0 else {
            return nil
        }
        let scaledWidth = (pointWidth * pointPixelScale).rounded()
        let scaledHeight = (pointHeight * pointPixelScale).rounded()
        guard scaledWidth.isFinite,
              scaledHeight.isFinite,
              scaledWidth >= 2,
              scaledHeight >= 2,
              scaledWidth <= Double(Int.max),
              scaledHeight <= Double(Int.max) else {
            return nil
        }
        width = Int(scaledWidth)
        height = Int(scaledHeight)
    }

    var pixelCount: Int? {
        let result = width.multipliedReportingOverflow(by: height)
        return result.overflow ? nil : result.partialValue
    }
}

/// One generation-bound mapping between system points, DesktopWorld points,
/// and native backing pixels for a physical display.
struct AOSDesktopWorldDisplayGeometry: Equatable, Sendable {
    let desktopWorldBounds: CGRect
    let displayID: UInt32
    let index: Int
    let nativePointBounds: CGRect
    let pixelDimensions: AOSDesktopPixelDimensions
    let pointPixelScale: Double

    init?(
        displayID: UInt32,
        index: Int,
        desktopWorldBounds: CGRect,
        nativePointBounds: CGRect,
        pointPixelScale: Double
    ) {
        guard index >= 0,
              !desktopWorldBounds.isNull,
              !desktopWorldBounds.isInfinite,
              !nativePointBounds.isNull,
              !nativePointBounds.isInfinite,
              desktopWorldBounds.origin.x.isFinite,
              desktopWorldBounds.origin.y.isFinite,
              nativePointBounds.origin.x.isFinite,
              nativePointBounds.origin.y.isFinite,
              desktopWorldBounds.width > 0,
              desktopWorldBounds.height > 0,
              nativePointBounds.width > 0,
              nativePointBounds.height > 0,
              abs(desktopWorldBounds.width - nativePointBounds.width) < 0.001,
              abs(desktopWorldBounds.height - nativePointBounds.height) < 0.001,
              let pixelDimensions = AOSDesktopPixelDimensions(
                pointWidth: Double(nativePointBounds.width),
                pointHeight: Double(nativePointBounds.height),
                pointPixelScale: pointPixelScale
              ) else {
            return nil
        }
        self.desktopWorldBounds = desktopWorldBounds
        self.displayID = displayID
        self.index = index
        self.nativePointBounds = nativePointBounds
        self.pixelDimensions = pixelDimensions
        self.pointPixelScale = pointPixelScale
    }

    func acceptsCaptureSource(
        pointWidth: Int,
        pointHeight: Int,
        pointPixelScale: Float
    ) -> Bool {
        guard abs(Double(pointWidth) - Double(nativePointBounds.width)) < 0.001,
              abs(Double(pointHeight) - Double(nativePointBounds.height)) < 0.001,
              abs(Double(pointPixelScale) - self.pointPixelScale) < 0.001,
              let observed = AOSDesktopPixelDimensions(
                pointWidth: Double(pointWidth),
                pointHeight: Double(pointHeight),
                pointPixelScale: Double(pointPixelScale)
              ) else {
            return false
        }
        return observed == pixelDimensions
    }

    func backingPixelPoint(fromDesktopWorld point: CGPoint) -> CGPoint {
        CGPoint(
            x: (point.x - desktopWorldBounds.minX) * pointPixelScale,
            y: (point.y - desktopWorldBounds.minY) * pointPixelScale
        )
    }

    func desktopWorldPoint(fromBackingPixel point: CGPoint) -> CGPoint {
        CGPoint(
            x: desktopWorldBounds.minX + point.x / pointPixelScale,
            y: desktopWorldBounds.minY + point.y / pointPixelScale
        )
    }

    func backingPixelRect(
        intersectingDesktopWorld rect: CGRect
    ) -> CGRect? {
        let intersection = desktopWorldBounds.intersection(rect)
        guard !intersection.isNull, !intersection.isEmpty else { return nil }
        let origin = backingPixelPoint(fromDesktopWorld: intersection.origin)
        return CGRect(
            x: origin.x,
            y: origin.y,
            width: intersection.width * pointPixelScale,
            height: intersection.height * pointPixelScale
        )
    }

    func backingPixelCount(
        intersectingDesktopWorld rect: CGRect
    ) -> Int? {
        guard let pixels = backingPixelRect(intersectingDesktopWorld: rect) else {
            return nil
        }
        let width = max(1, Int(ceil(pixels.width)))
        let height = max(1, Int(ceil(pixels.height)))
        let result = width.multipliedReportingOverflow(by: height)
        return result.overflow ? nil : result.partialValue
    }
}

/// The canonical ordered mapping for one DesktopWorld topology generation.
/// Consumers use this value instead of reconciling display IDs, coordinate
/// spaces, or backing scales independently.
struct AOSDesktopWorldDisplayLayout: Equatable, Sendable {
    let displays: [AOSDesktopWorldDisplayGeometry]

    init?(displays: [AOSDesktopWorldDisplayGeometry]) {
        let ordered = displays.sorted { left, right in
            left.index == right.index
                ? left.displayID < right.displayID
                : left.index < right.index
        }
        guard !ordered.isEmpty,
              Set(ordered.map(\.displayID)).count == ordered.count,
              Set(ordered.map(\.index)).count == ordered.count,
              ordered.enumerated().allSatisfy({ offset, display in
                  display.index == offset
              }) else {
            return nil
        }
        self.displays = ordered
    }

    var desktopWorldBounds: CGRect {
        displays.dropFirst().reduce(
            displays[0].desktopWorldBounds
        ) { bounds, display in
            bounds.union(display.desktopWorldBounds)
        }
    }

    var displayIDs: [UInt32] {
        displays.map(\.displayID)
    }

    var totalBackingPixelCount: Int? {
        var total = 0
        for display in displays {
            guard let pixels = display.pixelDimensions.pixelCount,
                  total <= Int.max - pixels else {
                return nil
            }
            total += pixels
        }
        return total
    }

    func geometry(displayID: UInt32) -> AOSDesktopWorldDisplayGeometry? {
        displays.first(where: { $0.displayID == displayID })
    }

    func matches(displayIDs: [UInt32]) -> Bool {
        displayIDs.count == displays.count
            && Set(displayIDs).count == displayIDs.count
            && Set(displayIDs) == Set(self.displayIDs)
    }

    func matches(
        indexedDisplays: [(displayID: UInt32, index: Int)]
    ) -> Bool {
        guard indexedDisplays.count == displays.count else { return false }
        let ordered = indexedDisplays.sorted { left, right in
            left.index == right.index
                ? left.displayID < right.displayID
                : left.index < right.index
        }
        return zip(ordered, displays).allSatisfy { pair in
            pair.0.displayID == pair.1.displayID
                && pair.0.index == pair.1.index
        }
    }
}
