import CoreGraphics
import Foundation

struct AOSInputPostReceipt: Hashable {
    let marker: Int64
    let id: String
}

final class AOSCGEventPostingOwner {
    let source = CGEventSource(stateID: .hidSystemState)

    private let tracker: AOSInputTerminalReceiptTracker
    private let receiptTapOwner: AOSInputReceiptTapOwner
    private var nextReceiptCounter: UInt32 = 0

    init() {
        let tracker = AOSInputTerminalReceiptTracker()
        self.tracker = tracker
        receiptTapOwner = AOSInputReceiptTapOwner(tracker: tracker)
    }

    func makeReceipt() -> AOSInputPostReceipt? {
        guard receiptTapOwner.start() else { return nil }
        nextReceiptCounter &+= 1
        if nextReceiptCounter == 0 { nextReceiptCounter = 1 }
        let marker = aosInputReceiptMarker(
            processID: ProcessInfo.processInfo.processIdentifier,
            counter: nextReceiptCounter
        )
        guard let id = aosInputReceiptID(marker: marker) else { return nil }
        return AOSInputPostReceipt(marker: marker, id: id)
    }

    @discardableResult
    func post(
        _ event: CGEvent,
        receipt: AOSInputPostReceipt? = nil,
        awaitReceipt: Bool = false,
        timeout: TimeInterval = 1.0
    ) -> Bool {
        if awaitReceipt {
            guard let receipt, receiptTapOwner.isActive else { return false }
            tracker.begin(marker: receipt.marker, eventType: event.type.rawValue)
        }
        if let receipt {
            event.setIntegerValueField(.eventSourceUserData, value: receipt.marker)
        }
        event.post(tap: .cghidEventTap)
        guard awaitReceipt, let receipt else { return true }
        defer { tracker.clearAll() }
        return tracker.waitAndConsume(
            marker: receipt.marker,
            eventType: event.type.rawValue,
            timeout: timeout
        )
    }

    deinit {
        tracker.clearAll()
        receiptTapOwner.stop()
    }
}
