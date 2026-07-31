import CoreGraphics
import Foundation

enum AOSDesktopWorldNativeEffectGeometryResolver {
    static func request(
        program: AOSDesktopWorldNativeEffectProgram,
        origin: CGPoint,
        current: CGPoint
    ) -> DesktopWorldNativeSheetGeometryRequest {
        guard program.version != .v1,
              let geometry = program.geometry else {
            return .standard
        }
        let cellSize = CGFloat(geometry.cellSize)
        let padding = CGFloat(geometry.padding)
        let extent = CGFloat(geometry.extent)
        switch geometry.kind {
        case .surface:
            return .adaptive(cellSize: cellSize, regions: nil)
        case .eventPoint:
            return point(
                cellSize: cellSize,
                center: current,
                radius: extent,
                padding: padding
            )
        case .eventEndpoints:
            return .adaptive(
                cellSize: cellSize,
                regions: [origin, current].map {
                    pointRegion(center: $0, radius: extent, padding: padding)
                }
            )
        case .eventSegment:
            return .adaptive(
                cellSize: cellSize,
                regions: [segmentRegion(
                    origin: origin,
                    current: current,
                    width: extent,
                    padding: padding
                )]
            )
        }
    }

    static func point(
        cellSize: CGFloat,
        center: CGPoint,
        radius: CGFloat,
        padding: CGFloat
    ) -> DesktopWorldNativeSheetGeometryRequest {
        .adaptive(
            cellSize: cellSize,
            regions: [pointRegion(
                center: center,
                radius: radius,
                padding: padding
            )]
        )
    }

    private static func pointRegion(
        center: CGPoint,
        radius: CGFloat,
        padding: CGFloat
    ) -> CGRect {
        let reach = radius + padding
        return CGRect(
            x: center.x - reach,
            y: center.y - reach,
            width: reach * 2,
            height: reach * 2
        )
    }

    private static func segmentRegion(
        origin: CGPoint,
        current: CGPoint,
        width: CGFloat,
        padding: CGFloat
    ) -> CGRect {
        let reach = width * 0.5 + padding
        return CGRect(
            x: min(origin.x, current.x) - reach,
            y: min(origin.y, current.y) - reach,
            width: abs(current.x - origin.x) + reach * 2,
            height: abs(current.y - origin.y) + reach * 2
        )
    }
}
