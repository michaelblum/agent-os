import CoreGraphics
import Foundation
import Metal

@MainActor
final class DesktopWorldNativeSheet {
    static let ownerID = "io.agent-os"
    static let resourceID = "native-sheet/main"

    struct Endpoint {
        let displayID: CGDirectDisplayID
        let host: DesktopWorldNativeProjectionHost
        let segment: DesktopWorldSurfaceCanvas.Segment
    }

    enum State: String {
        case registered
        case active
        case suspended
        case disposed
    }

    let identity: AOSDesktopWorldResourceIdentity
    private(set) var endpoints: [Endpoint]
    private(set) var state: State = .registered

    init(segments: [DesktopWorldSurfaceCanvas.Segment], device: MTLDevice) throws {
        identity = try AOSDesktopWorldResourceIdentity(
            ownerID: Self.ownerID,
            resourceID: Self.resourceID
        )
        var created: [Endpoint] = []
        do {
            for segment in segments {
                created.append(Endpoint(
                    displayID: segment.displayID,
                    host: try segment.ensureNativeProjectionHost(device: device),
                    segment: segment
                ))
            }
        } catch {
            created.forEach { $0.segment.removeNativeProjectionHost($0.host) }
            throw error
        }
        endpoints = created
    }

    func present() {
        guard state != .disposed else { return }
        endpoints.forEach { $0.host.present() }
        state = .active
    }

    func suspend() {
        guard state != .disposed else { return }
        endpoints.forEach { $0.host.suspend() }
        state = .suspended
    }

    func dispose() {
        guard state != .disposed else { return }
        state = .disposed
        endpoints.forEach { $0.segment.removeNativeProjectionHost($0.host) }
        endpoints = []
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
    private let segments: [DesktopWorldSurfaceCanvas.Segment]
    private var installed: DesktopWorldNativeSheet?

    init(segments: [DesktopWorldSurfaceCanvas.Segment], device: MTLDevice) {
        self.segments = segments
        self.device = device
    }

    func install() throws -> DesktopWorldNativeSheet {
        guard installed == nil else { throw RegistryError.occupied }
        let sheet = try DesktopWorldNativeSheet(segments: segments, device: device)
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
