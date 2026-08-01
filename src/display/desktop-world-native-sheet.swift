import CoreGraphics
import Foundation
import Metal

final class DesktopWorldNativeSheet {
    static let ownerID = "io.agent-os"
    static let resourceID = "native-sheet/main"

    struct SegmentSheet {
        let displayID: CGDirectDisplayID
        let host: DesktopWorldNativeProjectionHost
        let mesh: DesktopWorldNativeSheetMesh
        let segment: DesktopWorldSurfaceCanvas.Segment
    }

    enum State: String {
        case registered
        case active
        case suspended
        case disposed
    }

    let geometryRequest: DesktopWorldNativeSheetGeometryRequest
    let identity: AOSDesktopWorldResourceIdentity
    let metrics: DesktopWorldNativeSheetGeometryMetrics
    let renderBackingPixelCount: Int
    let renderBackingPixelPercentage: Double
    private(set) var segmentSheets: [SegmentSheet]
    private(set) var state: State = .registered
    let topologyGeneration: UInt64
    let worldBounds: CGRect

    init(
        segments: [DesktopWorldSurfaceCanvas.Segment],
        device: MTLDevice,
        geometryRequest: DesktopWorldNativeSheetGeometryRequest,
        topologyGeneration: UInt64
    ) throws {
        precondition(Thread.isMainThread, "native sheet creation must run on the main thread")
        identity = try AOSDesktopWorldResourceIdentity(
            ownerID: Self.ownerID,
            resourceID: Self.resourceID
        )
        self.geometryRequest = geometryRequest
        self.topologyGeneration = topologyGeneration
        worldBounds = segments.reduce(CGRect.null) { $0.union($1.dwBounds) }
        guard !worldBounds.isNull, !worldBounds.isEmpty else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        let planned = try segments.compactMap { segment -> (
            DesktopWorldSurfaceCanvas.Segment,
            DesktopWorldNativeSheetGeometryPlan
        )? in
            guard let plan = try geometryRequest.plan(segmentBounds: segment.dwBounds) else {
                return nil
            }
            return (segment, plan)
        }
        guard !planned.isEmpty else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        metrics = try DesktopWorldNativeSheetGeometryRequest.aggregate(
            planned.map { $0.1.metrics },
            segmentCount: planned.count
        )
        let totalBackingPixels = segments.reduce(0) { total, segment in
            total + Self.backingPixels(
                bounds: segment.dwBounds,
                scaleFactor: segment.scaleFactor
            )
        }
        renderBackingPixelCount = planned.reduce(0) { total, entry in
            total + Self.backingPixels(
                bounds: entry.1.renderBounds,
                scaleFactor: entry.0.scaleFactor
            )
        }
        renderBackingPixelPercentage = totalBackingPixels > 0
            ? min(100, Double(renderBackingPixelCount) / Double(totalBackingPixels) * 100)
            : 0
        var created: [SegmentSheet] = []
        do {
            for (segment, plan) in planned {
                let host = try segment.preparedNativeProjectionHost(device: device)
                try host.configure(plan: plan)
                let mesh = try DesktopWorldNativeSheetMesh(
                    plan: plan,
                    device: device
                )
                created.append(SegmentSheet(
                    displayID: segment.displayID,
                    host: host,
                    mesh: mesh,
                    segment: segment
                ))
            }
        } catch {
            created.forEach {
                $0.mesh.dispose()
            }
            throw error
        }
        segmentSheets = created
    }

    func present() {
        precondition(Thread.isMainThread, "native sheet presentation must run on the main thread")
        guard state != .disposed else { return }
        segmentSheets.forEach { $0.host.present() }
        state = .active
    }

    func suspend() {
        precondition(Thread.isMainThread, "native sheet suspension must run on the main thread")
        guard state != .disposed else { return }
        segmentSheets.forEach { $0.host.suspend() }
        state = .suspended
    }

    func dispose() {
        precondition(Thread.isMainThread, "native sheet disposal must run on the main thread")
        guard state != .disposed else { return }
        state = .disposed
        segmentSheets.forEach {
            $0.host.detachRenderer()
            $0.mesh.dispose()
        }
        segmentSheets = []
    }

    var retainedGeometryBufferCount: Int {
        segmentSheets.reduce(0) { $0 + $1.mesh.retainedBufferCount }
    }

    private static func backingPixels(bounds: CGRect, scaleFactor: CGFloat) -> Int {
        let width = max(1, Int(ceil(bounds.width * scaleFactor)))
        let height = max(1, Int(ceil(bounds.height * scaleFactor)))
        let (pixels, overflow) = width.multipliedReportingOverflow(by: height)
        return overflow ? Int.max : pixels
    }
}
