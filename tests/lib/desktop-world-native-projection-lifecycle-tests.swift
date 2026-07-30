import Foundation

enum DesktopWorldNativeSheetFailure: Error {
    case rendererUnavailable
}

final class FakeProjectionHost: DesktopWorldNativeProjectionHostLifecycle {
    let id: Int
    let nativeProjectionDeviceRegistryID: UInt64?
    var isDormant: Bool
    private(set) var finalizeCount = 0

    init(id: Int, deviceRegistryID: UInt64, isDormant: Bool = true) {
        self.id = id
        nativeProjectionDeviceRegistryID = deviceRegistryID
        self.isDormant = isDormant
    }

    func finalize() {
        finalizeCount += 1
        isDormant = false
    }
}

final class FakeProjectionSegment {
    let id: Int
    let slot = DesktopWorldNativeProjectionHostSlot<FakeProjectionHost>()
    var dormantOnCreation = true
    var failCreation = false

    init(id: Int) {
        self.id = id
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
}

@main
struct DesktopWorldNativeProjectionLifecycleTests {
    static func main() throws {
        let exact = DesktopWorldNativeProjectionGeneration(canvas: 7, topology: 11)
        require(exact.matches(canvas: 7, topology: 11), "exact generation must match")
        require(!exact.matches(canvas: 8, topology: 11), "stale canvas generation must fail")
        require(!exact.matches(canvas: 7, topology: 12), "stale topology generation must fail")

        var nextHostID = 0
        var creationCount = 0
        var createdHosts: [FakeProjectionHost] = []
        func prepare(_ segments: [FakeProjectionSegment], device: UInt64 = 41) throws {
            try DesktopWorldNativeProjectionHostBatch.prepare(
                segments: segments,
                deviceRegistryID: device,
                slot: { $0.slot },
                create: { segment in
                    if segment.failCreation {
                        throw DesktopWorldNativeSheetFailure.rendererUnavailable
                    }
                    nextHostID += 1
                    creationCount += 1
                    let host = FakeProjectionHost(
                        id: nextHostID,
                        deviceRegistryID: device,
                        isDormant: segment.dormantOnCreation
                    )
                    createdHosts.append(host)
                    return host
                }
            )
        }

        let first = FakeProjectionSegment(id: 1)
        let second = FakeProjectionSegment(id: 2)
        try prepare([first, second])
        let firstIdentity = try first.slot.prepared(deviceRegistryID: 41)
        let secondIdentity = try second.slot.prepared(deviceRegistryID: 41)
        for _ in 0..<100 {
            try prepare([first, second])
            let currentFirst = try first.slot.prepared(deviceRegistryID: 41)
            let currentSecond = try second.slot.prepared(deviceRegistryID: 41)
            require(currentFirst === firstIdentity,
                    "first segment host must be reused")
            require(currentSecond === secondIdentity,
                    "second segment host must be reused")
        }
        require(creationCount == 2, "100 preparations must retain two physical hosts")
        require(firstIdentity.finalizeCount == 0 && secondIdentity.finalizeCount == 0,
                "reused hosts must remain live")

        do {
            try prepare([first, second], device: 99)
            preconditionFailure("device mismatch must fail closed")
        } catch {}
        require(first.slot.host === firstIdentity && second.slot.host === secondIdentity,
                "device mismatch must retain the existing aggregate")

        let rollbackFirst = FakeProjectionSegment(id: 3)
        let rollbackSecond = FakeProjectionSegment(id: 4)
        rollbackSecond.failCreation = true
        do {
            try prepare([rollbackFirst, rollbackSecond])
            preconditionFailure("partial preparation must fail")
        } catch {}
        require(rollbackFirst.slot.host == nil && rollbackSecond.slot.host == nil,
                "partial preparation must roll back every new host")
        require(creationCount == 3, "partial preparation must create only its first host")
        require(createdHosts[2].finalizeCount == 1,
                "partial preparation must dispose the rolled-back host")

        let activeCandidate = FakeProjectionSegment(id: 6)
        activeCandidate.dormantOnCreation = false
        do {
            try prepare([activeCandidate])
            preconditionFailure("active candidate must fail preparation")
        } catch {}
        require(activeCandidate.slot.host == nil && createdHosts[3].finalizeCount == 1,
                "invalid candidate must be disposed before publication")

        second.slot.finalize()
        require(secondIdentity.finalizeCount == 1 && second.slot.host == nil,
                "retired topology segment must release its host")
        let replacement = FakeProjectionSegment(id: 5)
        try prepare([first, replacement])
        let replacementIdentity = try replacement.slot.prepared(deviceRegistryID: 41)
        require(first.slot.host === firstIdentity,
                "unchanged topology segment must preserve host identity")
        require(replacementIdentity !== secondIdentity && creationCount == 5,
                "added topology segment must receive one new host")

        first.slot.finalize()
        replacement.slot.finalize()
        first.slot.finalize()
        replacement.slot.finalize()
        require(firstIdentity.finalizeCount == 1 && replacementIdentity.finalizeCount == 1,
                "shutdown must finalize each retained host exactly once")
        require(first.slot.host == nil && replacement.slot.host == nil,
                "shutdown must clear every host slot")
        print("PASS DesktopWorld native projection host lifecycle")
    }
}
