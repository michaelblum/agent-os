import Foundation

@MainActor
final class AOSDesktopWorldNativeEffectClock {
    private let expectedDisplayIDs: Set<UInt32>
    private var presentationEpoch: TimeInterval?
    private var presentedDisplayIDs = Set<UInt32>()
    private let uptime: () -> TimeInterval

    init(
        displayIDs: Set<UInt32>,
        uptime: @escaping () -> TimeInterval = {
            ProcessInfo.processInfo.systemUptime
        }
    ) {
        precondition(!displayIDs.isEmpty)
        expectedDisplayIDs = displayIDs
        self.uptime = uptime
    }

    var elapsed: TimeInterval {
        guard let presentationEpoch else { return 0 }
        return max(0, uptime() - presentationEpoch)
    }

    @discardableResult
    func markPresented(displayID: UInt32) -> Bool {
        guard presentationEpoch == nil,
              expectedDisplayIDs.contains(displayID) else { return false }
        presentedDisplayIDs.insert(displayID)
        guard presentedDisplayIDs == expectedDisplayIDs else { return false }
        presentationEpoch = uptime()
        return true
    }
}
