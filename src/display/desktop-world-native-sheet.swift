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

    let geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor
    let identity: AOSDesktopWorldResourceIdentity
    let metrics: DesktopWorldNativeSheetGeometryMetrics
    private(set) var segmentSheets: [SegmentSheet]
    private(set) var state: State = .registered
    let topologyGeneration: UInt64

    init(
        segments: [DesktopWorldSurfaceCanvas.Segment],
        device: MTLDevice,
        geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor,
        topologyGeneration: UInt64
    ) throws {
        precondition(Thread.isMainThread, "native sheet creation must run on the main thread")
        identity = try AOSDesktopWorldResourceIdentity(
            ownerID: Self.ownerID,
            resourceID: Self.resourceID
        )
        self.geometryDescriptor = geometryDescriptor
        self.topologyGeneration = topologyGeneration
        metrics = try geometryDescriptor.metrics(segmentCount: segments.count)
        var created: [SegmentSheet] = []
        do {
            for segment in segments {
                guard segment.nativeProjectionHost == nil else {
                    throw DesktopWorldNativeSheetFailure.projectionOccupied
                }
                let host = try segment.ensureNativeProjectionHost(device: device)
                do {
                    let mesh = try DesktopWorldNativeSheetMesh(
                        descriptor: geometryDescriptor,
                        device: device,
                        worldBounds: segment.dwBounds
                    )
                    created.append(SegmentSheet(
                        displayID: segment.displayID,
                        host: host,
                        mesh: mesh,
                        segment: segment
                    ))
                } catch {
                    segment.removeNativeProjectionHost(host)
                    throw error
                }
            }
        } catch {
            created.forEach {
                $0.mesh.dispose()
                $0.segment.removeNativeProjectionHost($0.host)
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
            $0.segment.removeNativeProjectionHost($0.host)
        }
        segmentSheets = []
    }

    var retainedGeometryBufferCount: Int {
        segmentSheets.reduce(0) { $0 + $1.mesh.retainedBufferCount }
    }
}
