import Foundation

struct DesktopWorldNativeProjectionGeneration: Equatable, Sendable {
    let canvas: UInt64
    let topology: UInt64

    func matches(canvas: UInt64, topology: UInt64) -> Bool {
        self.canvas == canvas && self.topology == topology
    }
}

protocol DesktopWorldNativeProjectionHostLifecycle: AnyObject {
    var nativeProjectionDeviceRegistryID: UInt64? { get }
    var isDormant: Bool { get }

    func finalize()
}

final class DesktopWorldNativeProjectionHostSlot<Host: DesktopWorldNativeProjectionHostLifecycle> {
    private(set) var host: Host?

    func ensure(
        deviceRegistryID: UInt64,
        create: () throws -> Host
    ) throws -> (host: Host, created: Bool) {
        if let host {
            guard host.nativeProjectionDeviceRegistryID == deviceRegistryID else {
                throw DesktopWorldNativeSheetFailure.rendererUnavailable
            }
            return (host, false)
        }
        let candidate = try create()
        guard candidate.nativeProjectionDeviceRegistryID == deviceRegistryID,
              candidate.isDormant else {
            candidate.finalize()
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        host = candidate
        return (candidate, true)
    }

    func prepared(deviceRegistryID: UInt64) throws -> Host {
        guard let host,
              host.nativeProjectionDeviceRegistryID == deviceRegistryID else {
            throw DesktopWorldNativeSheetFailure.rendererUnavailable
        }
        return host
    }

    func remove(_ expected: Host) {
        guard host === expected else { return }
        expected.finalize()
        host = nil
    }

    func finalize() {
        guard let host else { return }
        host.finalize()
        self.host = nil
    }
}

enum DesktopWorldNativeProjectionHostBatch {
    static func prepare<Segment, Host>(
        segments: [Segment],
        deviceRegistryID: UInt64,
        slot: (Segment) -> DesktopWorldNativeProjectionHostSlot<Host>,
        create: (Segment) throws -> Host
    ) throws where Host: DesktopWorldNativeProjectionHostLifecycle {
        var created: [(DesktopWorldNativeProjectionHostSlot<Host>, Host)] = []
        do {
            for segment in segments {
                let owner = slot(segment)
                let result = try owner.ensure(
                    deviceRegistryID: deviceRegistryID,
                    create: { try create(segment) }
                )
                if result.created {
                    created.append((owner, result.host))
                }
            }
        } catch {
            for (owner, host) in created.reversed() {
                owner.remove(host)
            }
            throw error
        }
    }
}
