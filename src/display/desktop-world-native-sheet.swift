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
    let displayLayout: AOSDesktopWorldDisplayLayout
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
        let geometries = segments.compactMap(\.displayGeometry)
        guard geometries.count == segments.count,
              let displayLayout = AOSDesktopWorldDisplayLayout(displays: geometries),
              displayLayout.matches(indexedDisplays: segments.map {
                  (displayID: $0.displayID, index: $0.index)
              }) else {
            throw DesktopWorldNativeSheetFailure.invalidGeometry
        }
        guard let totalBackingPixels = displayLayout.totalBackingPixelCount else {
            throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
        }
        self.displayLayout = displayLayout
        worldBounds = displayLayout.desktopWorldBounds
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
        renderBackingPixelCount = try planned.reduce(0) { total, entry in
            guard let pixels = displayLayout.geometry(
                displayID: entry.0.displayID
            )?.backingPixelCount(
                intersectingDesktopWorld: entry.1.renderBounds
            ), total <= Int.max - pixels else {
                throw DesktopWorldNativeSheetFailure.geometryBudgetExceeded
            }
            return total + pixels
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
}
