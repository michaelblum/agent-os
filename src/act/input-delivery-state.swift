import CoreGraphics
import Foundation

final class AOSInputTerminalReceiptTracker {
    private struct Expectation: Equatable {
        let marker: Int64
        let eventType: UInt32
    }

    private let condition = NSCondition()
    private var pending: Expectation?
    private var observed = false

    func begin(marker: Int64, eventType: UInt32) {
        condition.lock()
        pending = Expectation(marker: marker, eventType: eventType)
        observed = false
        condition.unlock()
    }

    func observe(marker: Int64, eventType: UInt32) {
        condition.lock()
        if pending == Expectation(marker: marker, eventType: eventType) {
            observed = true
            condition.broadcast()
        }
        condition.unlock()
    }

    func consume(marker: Int64, eventType: UInt32) -> Bool {
        condition.lock()
        defer { condition.unlock() }
        guard pending == Expectation(marker: marker, eventType: eventType), observed else {
            return false
        }
        pending = nil
        observed = false
        return true
    }

    func waitAndConsume(marker: Int64, eventType: UInt32, timeout: TimeInterval) -> Bool {
        let expectation = Expectation(marker: marker, eventType: eventType)
        let deadline = Date().addingTimeInterval(timeout)
        condition.lock()
        defer { condition.unlock() }
        guard pending == expectation else { return false }
        while pending == expectation && !observed {
            if !condition.wait(until: deadline) { break }
        }
        guard pending == expectation, observed else { return false }
        pending = nil
        observed = false
        return true
    }

    func clearAll() {
        condition.lock()
        pending = nil
        observed = false
        condition.broadcast()
        condition.unlock()
    }
}

struct AOSModifierDeliveryTransition {
    let before: Set<String>
    let after: Set<String>

    var provisionalState: Set<String> { after }
    var uncertainState: Set<String> { before.union(after) }
}

struct AOSPointerReleaseObligation {
    private(set) var point: CGPoint
    private(set) var isPending = true

    mutating func advance(to point: CGPoint) {
        self.point = point
    }

    mutating func fulfill() {
        isPending = false
    }
}
