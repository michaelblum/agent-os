import CoreGraphics
import Foundation
import Metal

@MainActor
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

    init(
        segments: [DesktopWorldSurfaceCanvas.Segment],
        device: MTLDevice,
        geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor
    ) throws {
        identity = try AOSDesktopWorldResourceIdentity(
            ownerID: Self.ownerID,
            resourceID: Self.resourceID
        )
        self.geometryDescriptor = geometryDescriptor
        metrics = try geometryDescriptor.metrics(segmentCount: segments.count)
        var created: [SegmentSheet] = []
        do {
            for segment in segments {
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
        guard state != .disposed else { return }
        segmentSheets.forEach { $0.host.present() }
        state = .active
    }

    func suspend() {
        guard state != .disposed else { return }
        segmentSheets.forEach { $0.host.suspend() }
        state = .suspended
    }

    func dispose() {
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

@MainActor
final class DesktopWorldNativeSheetRegistry {
    enum RegistryError: Error {
        case occupied
        case missing
        case identityMismatch
    }

    private let device: MTLDevice
    private let geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor
    private let segments: [DesktopWorldSurfaceCanvas.Segment]
    private var installed: DesktopWorldNativeSheet?

    init(
        segments: [DesktopWorldSurfaceCanvas.Segment],
        device: MTLDevice,
        geometryDescriptor: DesktopWorldNativeSheetGeometryDescriptor = .standard
    ) {
        self.segments = segments
        self.device = device
        self.geometryDescriptor = geometryDescriptor
    }

    func install() throws -> DesktopWorldNativeSheet {
        guard installed == nil else { throw RegistryError.occupied }
        let sheet = try DesktopWorldNativeSheet(
            segments: segments,
            device: device,
            geometryDescriptor: geometryDescriptor
        )
        installed = sheet
        return sheet
    }

    func sheet(for identity: AOSDesktopWorldResourceIdentity) throws -> DesktopWorldNativeSheet {
        guard let sheet = installed else { throw RegistryError.missing }
        guard sheet.identity == identity else { throw RegistryError.identityMismatch }
        return sheet
    }

    func remove(_ identity: AOSDesktopWorldResourceIdentity) throws {
        guard let sheet = installed else { throw RegistryError.missing }
        guard sheet.identity == identity else { throw RegistryError.identityMismatch }
        installed = nil
        sheet.dispose()
    }

    func discardImmediately() {
        installed?.dispose()
        installed = nil
    }

    var count: Int {
        installed == nil ? 0 : 1
    }
}
