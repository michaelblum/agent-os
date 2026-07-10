import CoreGraphics
import Foundation

struct AOSInputPostReceipt: Hashable {
    let marker: Int64
    let id: String
}

final class AOSCGEventPostingOwner {
    let source = CGEventSource(stateID: .hidSystemState)

    private let tracker = AOSInputTerminalReceiptTracker()
    private var nextReceiptCounter: UInt32 = 0
    private var receiptTap: CFMachPort?
    private var receiptRunLoopSource: CFRunLoopSource?
    private var receiptRunLoop: CFRunLoop?

    func makeReceipt() -> AOSInputPostReceipt? {
        teardownReceiptTap()
        guard ensureReceiptTap() else { return nil }
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
            guard let receipt, receiptTap != nil else { return false }
            tracker.begin(marker: receipt.marker, eventType: event.type.rawValue)
        }
        if let receipt {
            event.setIntegerValueField(.eventSourceUserData, value: receipt.marker)
        }
        event.post(tap: .cghidEventTap)
        guard awaitReceipt, let receipt else { return true }
        defer { teardownReceiptTap() }

        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if tracker.consume(marker: receipt.marker, eventType: event.type.rawValue) { return true }
            CFRunLoopRunInMode(.defaultMode, 0.005, true)
        } while Date() < deadline
        return tracker.consume(marker: receipt.marker, eventType: event.type.rawValue)
    }

    deinit {
        teardownReceiptTap()
    }

    private func teardownReceiptTap() {
        tracker.clearAll()
        if let receiptTap {
            CGEvent.tapEnable(tap: receiptTap, enable: false)
            CFMachPortInvalidate(receiptTap)
        }
        if let receiptRunLoop, let receiptRunLoopSource {
            CFRunLoopRemoveSource(receiptRunLoop, receiptRunLoopSource, .commonModes)
        }
        receiptTap = nil
        receiptRunLoopSource = nil
        receiptRunLoop = nil
    }

    private func ensureReceiptTap() -> Bool {
        if let receiptTap {
            if !CGEvent.tapIsEnabled(tap: receiptTap) {
                CGEvent.tapEnable(tap: receiptTap, enable: true)
            }
            return CGEvent.tapIsEnabled(tap: receiptTap)
        }
        let eventTypes: [CGEventType] = [
            .mouseMoved,
            .leftMouseDown,
            .leftMouseUp,
            .leftMouseDragged,
            .rightMouseDown,
            .rightMouseUp,
            .rightMouseDragged,
            .otherMouseDown,
            .otherMouseUp,
            .otherMouseDragged,
            .scrollWheel,
            .keyDown,
            .keyUp,
        ]
        let eventMask = eventTypes.reduce(CGEventMask(0)) { mask, type in
            mask | CGEventMask(1 << type.rawValue)
        }
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, type, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let owner = Unmanaged<AOSCGEventPostingOwner>
                    .fromOpaque(refcon)
                    .takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let tap = owner.receiptTap {
                        CGEvent.tapEnable(tap: tap, enable: true)
                    }
                    return Unmanaged.passUnretained(event)
                }
                let marker = event.getIntegerValueField(.eventSourceUserData)
                if aosInputReceiptID(marker: marker) != nil {
                    owner.tracker.observe(marker: marker, eventType: type.rawValue)
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: refcon
        ) else {
            return false
        }
        let runLoop = CFRunLoopGetCurrent()
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(runLoop, source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        receiptTap = tap
        receiptRunLoopSource = source
        receiptRunLoop = runLoop
        return true
    }
}
