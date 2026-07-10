import Foundation

final class AOSInputTerminalReceiptTracker {
    private struct Expectation: Equatable {
        let marker: Int64
        let eventType: UInt32
    }

    private let lock = NSLock()
    private var pending: Expectation?
    private var observed = false

    func begin(marker: Int64, eventType: UInt32) {
        lock.lock()
        pending = Expectation(marker: marker, eventType: eventType)
        observed = false
        lock.unlock()
    }

    func observe(marker: Int64, eventType: UInt32) {
        lock.lock()
        if pending == Expectation(marker: marker, eventType: eventType) {
            observed = true
        }
        lock.unlock()
    }

    func consume(marker: Int64, eventType: UInt32) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard pending == Expectation(marker: marker, eventType: eventType), observed else {
            return false
        }
        pending = nil
        observed = false
        return true
    }

    func clearAll() {
        lock.lock()
        pending = nil
        observed = false
        lock.unlock()
    }
}

struct AOSModifierDeliveryTransition {
    let before: Set<String>
    let after: Set<String>

    var provisionalState: Set<String> { after }
    var uncertainState: Set<String> { before.union(after) }
}
