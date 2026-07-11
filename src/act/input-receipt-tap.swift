import CoreGraphics
import Foundation

final class AOSInputReceiptTapOwner {
    private let tracker: AOSInputTerminalReceiptTracker
    private let state = NSCondition()
    private var worker: Thread?
    private var runLoop: CFRunLoop?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var startupResult: Bool?
    private var stopping = false

    init(tracker: AOSInputTerminalReceiptTracker) {
        self.tracker = tracker
    }

    func start() -> Bool {
        state.lock()
        if worker == nil {
            startupResult = nil
            stopping = false
            let nextWorker = Thread { [weak self] in
                self?.run()
            }
            nextWorker.name = "aos-input-receipt-tap"
            worker = nextWorker
            nextWorker.start()
        }
        while startupResult == nil {
            state.wait()
        }
        let started = startupResult == true
        state.unlock()
        return started
    }

    var isActive: Bool {
        state.lock()
        defer { state.unlock() }
        return startupResult == true && tap != nil && !stopping
    }

    func stop() {
        state.lock()
        guard let worker else {
            state.unlock()
            return
        }
        stopping = true
        let ownedRunLoop = runLoop
        state.unlock()

        if let ownedRunLoop {
            CFRunLoopStop(ownedRunLoop)
            CFRunLoopWakeUp(ownedRunLoop)
        }

        if Thread.current != worker {
            state.lock()
            while self.worker != nil {
                state.wait()
            }
            state.unlock()
        }
    }

    private func run() {
        autoreleasepool {
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
                    let owner = Unmanaged<AOSInputReceiptTapOwner>
                        .fromOpaque(refcon)
                        .takeUnretainedValue()
                    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                        owner.reenable()
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
                finishStartup(false)
                return
            }

            let runLoop = CFRunLoopGetCurrent()
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            CFRunLoopAddSource(runLoop, source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)

            state.lock()
            self.tap = tap
            self.source = source
            self.runLoop = runLoop
            startupResult = CGEvent.tapIsEnabled(tap: tap)
            let shouldRun = startupResult == true && !stopping
            state.broadcast()
            state.unlock()

            if shouldRun {
                CFRunLoopRun()
            }

            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
            CFRunLoopRemoveSource(runLoop, source, .commonModes)
            finishWorker()
        }
    }

    private func reenable() {
        state.lock()
        let tap = self.tap
        let canEnable = !stopping
        state.unlock()
        if canEnable, let tap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    private func finishStartup(_ result: Bool) {
        state.lock()
        startupResult = result
        worker = nil
        state.broadcast()
        state.unlock()
    }

    private func finishWorker() {
        state.lock()
        tap = nil
        source = nil
        runLoop = nil
        worker = nil
        startupResult = false
        state.broadcast()
        state.unlock()
    }
}
