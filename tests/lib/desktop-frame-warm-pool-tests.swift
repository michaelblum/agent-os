import Foundation

final class LockedWarmStatuses: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [AOSDesktopFrameWarmStatus] = []

    func append(_ value: AOSDesktopFrameWarmStatus) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    func contains(_ state: AOSDesktopFrameWarmState) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return values.contains(where: { $0.state == state })
    }
}

final class SequencedWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    private let lock = NSLock()
    private var nextIndex = 0
    private let steps: [Result<AOSDesktopPixelWarmSource, AOSDesktopFrameCaptureFailure>]

    var openCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return nextIndex
    }

    init(sources: [FakeWarmSource]) {
        steps = sources.map { .success($0) }
    }

    init(steps: [Result<AOSDesktopPixelWarmSource, AOSDesktopFrameCaptureFailure>]) {
        self.steps = steps
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lock.lock()
        guard nextIndex < steps.count else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
            return AOSDesktopFrameCancellation()
        }
        let step = steps[nextIndex]
        nextIndex += 1
        lock.unlock()
        switch step {
        case .success(let source): completion(.success(source))
        case .failure(let failure): completion(.failure(failure))
        }
        return AOSDesktopFrameCancellation()
    }
}

final class DeferredWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    private var completion: ((Result<AOSDesktopPixelWarmSource, Error>) -> Void)?
    private let lock = NSLock()
    private var storedOpenCount = 0

    var openCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedOpenCount
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lock.lock()
        storedOpenCount += 1
        self.completion = completion
        lock.unlock()
        return AOSDesktopFrameCancellation()
    }

    func complete(_ result: Result<AOSDesktopPixelWarmSource, Error>) {
        lock.lock()
        let completion = self.completion
        self.completion = nil
        lock.unlock()
        completion?(result)
    }
}

final class FirstReadyThenDeferredWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    private var completion: ((Result<AOSDesktopPixelWarmSource, Error>) -> Void)?
    private let lock = NSLock()
    private var storedOpenCount = 0
    private let source: FakeWarmSource

    init(source: FakeWarmSource) {
        self.source = source
    }

    var openCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedOpenCount
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lock.lock()
        storedOpenCount += 1
        let openCount = storedOpenCount
        if openCount > 1 { self.completion = completion }
        lock.unlock()
        if openCount == 1 { completion(.success(source)) }
        return AOSDesktopFrameCancellation()
    }

    func completeRestore() {
        lock.lock()
        let completion = self.completion
        self.completion = nil
        lock.unlock()
        completion?(.success(source))
    }
}

private func waitForWarmState(
    _ capturer: AOSNativeDesktopFrameCapturer,
    _ expected: AOSDesktopFrameWarmState,
    timeout: TimeInterval = 1
) -> AOSDesktopFrameWarmStatus {
    let deadline = Date().addingTimeInterval(timeout)
    var status = capturer.warmStatus()
    while status.state != expected, Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
        status = capturer.warmStatus()
    }
    return status
}

private func waitForCondition(
    timeout: TimeInterval = 1,
    _ condition: () -> Bool
) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition(), Date() < deadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    return condition()
}

private func freeze(
    _ capturer: AOSNativeDesktopFrameCapturer,
    configuration: AOSDesktopFrameWarmConfiguration
) -> Result<AOSDesktopFrameCaptureSetResult, Error> {
    let settled = DispatchSemaphore(value: 0)
    var observed: Result<AOSDesktopFrameCaptureSetResult, Error>?
    _ = capturer.capturePrewarmed(configuration) {
        observed = $0
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + 1) == .success,
        "warm-pool freeze did not settle"
    )
    return observed ?? .failure(AOSDesktopFrameCaptureFailure.captureFailed)
}

private func requireFailure(
    _ result: Result<AOSDesktopFrameCaptureSetResult, Error>,
    _ expected: AOSDesktopFrameCaptureFailure,
    _ message: String
) {
    if case .failure(let error) = result {
        require(error as? AOSDesktopFrameCaptureFailure == expected, message)
    } else {
        require(false, message)
    }
}

func runDesktopFrameWarmPoolTests() throws {
    let configuration = AOSDesktopFrameWarmConfiguration(
        canvasGeneration: 7,
        displayIDs: [42],
        excludingWindowIDs: [900],
        maximumPixelsPerDisplay: 4_096,
        topologyGeneration: 11
    )
    let source = FakeWarmSource(failure: nil)
    let acquirer = FakeWarmAcquirer(source: source)
    let capturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: acquirer
        ),
        strategy: .prewarmedSnapshot
    )
    let observedWarmStatuses = LockedWarmStatuses()
    capturer.setWarmStatusObserver { observedWarmStatuses.append($0) }
    capturer.reconcileWarm(configuration)
    let initialStatus = waitForWarmState(capturer, .ready)
    require(initialStatus.state == .ready, "warm pool did not become ready")
    require(acquirer.openCount == 1, "warm pool opened duplicate native sources")
    require(
        waitForCondition {
            observedWarmStatuses.contains(.warming)
                && observedWarmStatuses.contains(.ready)
        },
        "warm pool did not publish its bounded lifecycle transitions"
    )

    for _ in 0..<2 {
        require(
            (try? freeze(capturer, configuration: configuration).get().frames.count) == 1,
            "warm pool did not encode the latest display frame"
        )
    }
    require(
        acquirer.openCount == 1 && source.freezeCount == 2 && source.canceled == 0,
        "repeated freezes recreated or retired the warm source"
    )

    var genericResult: Result<AOSDesktopFrameCaptureSetResult, Error>?
    _ = capturer.capture(
        displayIDs: [42],
        excludingWindowIDs: [900],
        maximumPixelsPerDisplay: 4_096
    ) { genericResult = $0 }
    requireFailure(
        genericResult ?? .failure(AOSDesktopFrameCaptureFailure.captureFailed),
        .frameNotReady,
        "generic runtime path did not fail closed"
    )
    require(acquirer.openCount == 1, "generic runtime path cold-started capture")

    let successor = AOSDesktopFrameWarmConfiguration(
        canvasGeneration: 8,
        displayIDs: [42],
        excludingWindowIDs: [900],
        maximumPixelsPerDisplay: 4_096,
        topologyGeneration: 12
    )
    capturer.reconcileWarm(successor)
    let successorStatus = waitForWarmState(capturer, .ready)
    require(
        successorStatus.generation > initialStatus.generation
            && acquirer.openCount == 2
            && source.canceled == 1,
        "scene generation transition reused the previous warm lease"
    )
    requireFailure(
        freeze(capturer, configuration: configuration),
        .frameNotReady,
        "old scene generation retained warm-capture authority"
    )

    let replacement = AOSDesktopFrameWarmConfiguration(
        canvasGeneration: 8,
        displayIDs: [42],
        excludingWindowIDs: [901],
        maximumPixelsPerDisplay: 4_096,
        topologyGeneration: 12
    )
    requireFailure(
        freeze(capturer, configuration: replacement),
        .frameNotReady,
        "mismatched warm request did not fail closed"
    )
    capturer.reconcileWarm(replacement)
    let replacementStatus = waitForWarmState(capturer, .ready)
    require(
        replacementStatus.state == .ready
            && replacementStatus.generation > successorStatus.generation
            && acquirer.openCount == 3
            && source.canceled == 2,
        "stage-window replacement did not restart the exact-window native source"
    )
    requireFailure(
        freeze(capturer, configuration: successor),
        .frameNotReady,
        "superseded stage-window authorization remained current"
    )
    require(
        (try? freeze(capturer, configuration: replacement).get().frames.count) == 1,
        "updated stage-window authorization could not freeze the retained source"
    )
    capturer.reconcileWarm(nil)
    require(
        waitForWarmState(capturer, .idle).state == .idle
            && source.canceled == 3,
        "warm pool disable retained its native source"
    )

    let deferredSource = FakeWarmSource(failure: nil)
    let deferredAcquirer = DeferredWarmAcquirer()
    let deferredCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: deferredAcquirer
        ),
        strategy: .prewarmedSnapshot
    )
    deferredCapturer.reconcileWarm(successor)
    require(
        waitForCondition { deferredAcquirer.openCount == 1 },
        "deferred warm source did not begin"
    )
    deferredCapturer.reconcileWarm(replacement)
    _ = deferredCapturer.warmStatus()
    deferredAcquirer.complete(.success(deferredSource))
    require(
        waitForCondition { deferredAcquirer.openCount == 2 },
        "window authorization replacement did not reopen the warming native source"
    )
    deferredAcquirer.complete(.success(deferredSource))
    require(
        waitForWarmState(deferredCapturer, .ready).state == .ready,
        "replacement window authorization did not become ready"
    )
    requireFailure(
        freeze(deferredCapturer, configuration: successor),
        .frameNotReady,
        "deferred startup restored stale window authorization"
    )
    require(
        (try? freeze(
            deferredCapturer,
            configuration: replacement
        ).get().frames.count) == 1,
        "deferred startup did not adopt current window authorization"
    )
    deferredCapturer.reconcileWarm(nil)
    require(
        waitForWarmState(deferredCapturer, .idle).state == .idle
            && deferredSource.canceled == 2,
        "deferred warm source did not retire"
    )

    let inFlightSource = FakeWarmSource(failure: nil)
    inFlightSource.freezeEntered = DispatchSemaphore(value: 0)
    inFlightSource.freezeRelease = DispatchSemaphore(value: 0)
    let inFlightAcquirer = FakeWarmAcquirer(source: inFlightSource)
    let inFlightCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: inFlightAcquirer
        ),
        strategy: .prewarmedSnapshot
    )
    inFlightCapturer.reconcileWarm(successor)
    require(
        waitForWarmState(inFlightCapturer, .ready).state == .ready,
        "in-flight authorization fixture did not start"
    )
    let inFlightSettled = DispatchSemaphore(value: 0)
    var inFlightCompletionState: AOSDesktopFrameWarmState?
    var inFlightResult: Result<AOSDesktopFrameCaptureSetResult, Error>?
    _ = inFlightCapturer.capturePrewarmed(successor) {
        inFlightCompletionState = inFlightCapturer.warmStatus().state
        inFlightResult = $0
        inFlightSettled.signal()
    }
    require(
        inFlightSource.freezeEntered?.wait(timeout: .now() + 1) == .success,
        "in-flight freeze did not enter its source"
    )
    inFlightCapturer.reconcileWarm(replacement)
    _ = inFlightCapturer.warmStatus()
    inFlightSource.freezeRelease?.signal()
    require(
        inFlightSettled.wait(timeout: .now() + 1) == .success,
        "in-flight freeze did not settle after authorization changed"
    )
    requireFailure(
        inFlightResult ?? .failure(AOSDesktopFrameCaptureFailure.captureFailed),
        .frameNotReady,
        "in-flight freeze escaped superseded window authorization"
    )
    require(
        inFlightCompletionState != nil,
        "warm-pool completion did not execute outside its serialized state queue"
    )
    inFlightSource.freezeEntered = nil
    inFlightSource.freezeRelease = nil
    require(
        waitForCondition {
            inFlightAcquirer.openCount == 2 && inFlightSource.canceled == 1
        },
        "window authorization update did not replace the active native source"
    )
    require(
        (try? freeze(
            inFlightCapturer,
            configuration: replacement
        ).get().frames.count) == 1,
        "current authorization could not freeze after stale completion"
    )
    inFlightCapturer.reconcileWarm(nil)
    require(
        waitForWarmState(inFlightCapturer, .idle).state == .idle
            && inFlightSource.canceled == 2,
        "in-flight authorization fixture did not retire"
    )

    let firstFailedSource = FakeWarmSource(failure: .connectionInterrupted)
    let recoveredSource = FakeWarmSource(failure: nil)
    let recoveringAcquirer = SequencedWarmAcquirer(
        sources: [firstFailedSource, recoveredSource]
    )
    let recoveringCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: recoveringAcquirer
        ),
        strategy: .prewarmedSnapshot
    )
    recoveringCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(recoveringCapturer, .ready).state == .ready,
        "recovering warm-pool fixture did not start"
    )
    requireFailure(
        freeze(recoveringCapturer, configuration: configuration),
        .connectionInterrupted,
        "runtime connection interruption changed its caller result"
    )
    require(
        waitForCondition {
            recoveringAcquirer.openCount == 2
                && firstFailedSource.canceled == 1
                && recoveringCapturer.warmStatus().state == .ready
        },
        "failed runtime source was not retired and reopened once"
    )
    require(
        (try? freeze(
            recoveringCapturer,
            configuration: configuration
        ).get().frames.count) == 1,
        "replacement runtime source did not serve a frame"
    )
    recoveredSource.failure = .captureFailed
    requireFailure(
        freeze(recoveringCapturer, configuration: configuration),
        .captureFailed,
        "repeated runtime failure changed its caller result"
    )
    require(
        waitForCondition {
            recoveringCapturer.warmStatus().state == .failed
                && recoveredSource.canceled == 1
        } && recoveringAcquirer.openCount == 2,
        "warm pool reopened indefinitely after repeated source failure"
    )

    let startupFailedSource = FakeWarmSource(failure: .captureFailed)
    let startupFailureAcquirer = SequencedWarmAcquirer(steps: [
        .success(startupFailedSource),
        .failure(.captureFailed),
    ])
    let startupFailureCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: startupFailureAcquirer
        ),
        strategy: .prewarmedSnapshot
    )
    startupFailureCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(startupFailureCapturer, .ready).state == .ready,
        "startup-failure fixture did not open its first source"
    )
    requireFailure(
        freeze(startupFailureCapturer, configuration: configuration),
        .captureFailed,
        "startup-failure fixture did not fail its first source"
    )
    require(
        waitForWarmState(startupFailureCapturer, .failed).state == .failed
            && startupFailureAcquirer.openCount == 2,
        "replacement startup failure did not settle honestly"
    )
    for _ in 0..<3 { startupFailureCapturer.reconcileWarm(configuration) }
    Thread.sleep(forTimeInterval: 0.03)
    require(
        startupFailureAcquirer.openCount == 2,
        "same-generation reconciliation reopened after recovery exhaustion"
    )

    let uncertainSource = FakeWarmSource(failure: nil)
    uncertainSource.stopResult = .failure(AOSDesktopFrameCaptureFailure.captureFailed)
    let uncertainAcquirer = FakeWarmAcquirer(source: uncertainSource)
    let uncertainCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: uncertainAcquirer
        ),
        strategy: .prewarmedSnapshot
    )
    uncertainCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(uncertainCapturer, .ready).state == .ready,
        "uncertain-retirement fixture did not start"
    )
    uncertainCapturer.reconcileWarm(nil)
    require(
        waitForWarmState(uncertainCapturer, .failed).errorCode
            == "DESKTOP_FRAME_RETIREMENT_UNCERTAIN",
        "failed warm retirement did not become terminal"
    )
    uncertainCapturer.reconcileWarm(configuration)
    Thread.sleep(forTimeInterval: 0.02)
    require(
        uncertainAcquirer.openCount == 1,
        "uncertain retirement admitted a replacement source"
    )

    let publicRequest = AOSDesktopPixelSnapshotRequest(
        displayIDs: [42],
        excludingWindowIDs: [901],
        maximumPixelsPerDisplay: 4_096,
        capturePolicy: .publicExplicitExclusions
    )
    let transactionSource = FakeWarmSource(failure: nil)
    transactionSource.completesStopImmediately = false
    let transactionWarm = FakeWarmAcquirer(source: transactionSource)
    let transactionStill = FakePixelAcquirer()
    let transactionCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: transactionStill,
            warmAcquirer: transactionWarm
        ),
        strategy: .prewarmedSnapshot
    )
    transactionCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(transactionCapturer, .ready).state == .ready,
        "exclusive-still fixture did not warm"
    )
    let transactionSettled = DispatchSemaphore(value: 0)
    var transactionResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = transactionCapturer.captureExclusiveStill(publicRequest) {
        transactionResult = $0
        transactionSettled.signal()
    }
    require(
        waitForCondition { transactionSource.stopCompletion != nil },
        "exclusive still did not request authoritative warm retirement"
    )
    require(
        transactionStill.captureCount == 0,
        "exclusive still overlapped unacknowledged warm retirement"
    )
    transactionSource.completesStopImmediately = true
    transactionSource.stopCompletion?(.success(()))
    require(
        waitForCondition { transactionStill.captureCount == 1 },
        "exclusive still did not start after all retirement acknowledgements"
    )
    let transactionNow = Date()
    transactionStill.pending[0](.success(AOSDesktopPixelFrameSet(
        capturedAt: transactionNow,
        durationMilliseconds: 1,
        frames: [AOSDesktopPixelFrame(
            capturedAt: transactionNow,
            displayID: 42,
            image: onePixelImage()
        )]
    )))
    require(
        transactionSettled.wait(timeout: .now() + 1) == .success,
        "exclusive still did not settle after exact warm restoration"
    )
    let transactionFrameCount: Int
    if case .success(let frames)? = transactionResult {
        transactionFrameCount = frames.frames.count
    } else {
        transactionFrameCount = 0
    }
    require(
        transactionFrameCount == 1
            && transactionWarm.openCount == 2
            && waitForWarmState(transactionCapturer, .ready).state == .ready,
        "exclusive still returned before the prior warm identity was ready"
    )

    let coldStill = FakePixelAcquirer()
    let coldWarm = FakeWarmAcquirer(source: FakeWarmSource(failure: nil))
    let coldCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: coldStill,
            warmAcquirer: coldWarm
        ),
        strategy: .prewarmedSnapshot
    )
    let coldSettled = DispatchSemaphore(value: 0)
    _ = coldCapturer.captureExclusiveStill(publicRequest) { _ in
        coldSettled.signal()
    }
    require(
        waitForCondition { coldStill.captureCount == 1 }
            && coldWarm.openCount == 0,
        "cold public still synthesized a warm owner"
    )
    coldStill.pending[0](.success(AOSDesktopPixelFrameSet(
        capturedAt: transactionNow,
        durationMilliseconds: 1,
        frames: [AOSDesktopPixelFrame(
            capturedAt: transactionNow,
            displayID: 42,
            image: onePixelImage()
        )]
    )))
    require(
        coldSettled.wait(timeout: .now() + 1) == .success
            && coldCapturer.warmStatus().state == .idle,
        "cold public still did not settle without warm restoration"
    )

    let failureSource = FakeWarmSource(failure: nil)
    let failureWarm = FakeWarmAcquirer(source: failureSource)
    let failedStill = FakePixelAcquirer()
    let failureCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: failedStill,
            warmAcquirer: failureWarm
        ),
        strategy: .prewarmedSnapshot
    )
    failureCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(failureCapturer, .ready).state == .ready,
        "settled-failure fixture did not warm"
    )
    let failureSettled = DispatchSemaphore(value: 0)
    var failureCompletionState: AOSDesktopFrameWarmState?
    var failureResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = failureCapturer.captureExclusiveStill(publicRequest) {
        failureCompletionState = failureCapturer.warmStatus().state
        failureResult = $0
        failureSettled.signal()
    }
    require(
        waitForCondition { failedStill.captureCount == 1 },
        "settled-failure still did not start"
    )
    failedStill.pending[0](.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    require(
        failureSettled.wait(timeout: .now() + 1) == .success,
        "settled snapshot failure did not complete"
    )
    require(
        failureCompletionState == .ready
            && failureWarm.openCount == 2,
        "settled snapshot failure escaped before warm restoration"
    )
    if case .failure(let error) = failureResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .captureFailed,
            "settled snapshot failure changed its stable projection"
        )
    } else {
        require(false, "settled snapshot failure unexpectedly succeeded")
    }

    let interruptedSource = FakeWarmSource(failure: nil)
    let recoveredTerminalSource = FakeWarmSource(failure: nil)
    let terminalWarm = SequencedWarmAcquirer(sources: [
        interruptedSource,
        recoveredTerminalSource,
    ])
    let terminalCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: terminalWarm
        ),
        strategy: .prewarmedSnapshot
    )
    terminalCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(terminalCapturer, .ready).state == .ready,
        "terminal observer fixture did not warm"
    )
    interruptedSource.emitTerminal(
        AOSDesktopFrameCaptureFailure.connectionInterrupted
    )
    require(
        waitForCondition {
            terminalWarm.openCount == 2
                && terminalCapturer.warmStatus().state == .ready
        },
        "first post-ready interruption did not perform one confirmed reopen"
    )
    interruptedSource.emitTerminal(
        AOSDesktopFrameCaptureFailure.connectionInterrupted
    )
    Thread.sleep(forTimeInterval: 0.03)
    require(
        terminalCapturer.warmStatus().state == .ready,
        "stale terminal callback retired the replacement generation"
    )
    recoveredTerminalSource.emitTerminal(
        AOSDesktopFrameCaptureFailure.connectionInterrupted
    )
    require(
        waitForWarmState(terminalCapturer, .failed).state == .failed
            && terminalWarm.openCount == 2,
        "second post-ready interruption reopened more than once"
    )

    let bufferedTerminalSource = FakeWarmSource(failure: nil)
    bufferedTerminalSource.emitTerminal(
        AOSDesktopFrameCaptureFailure.connectionInterrupted
    )
    let bufferedRecoverySource = FakeWarmSource(failure: nil)
    let bufferedTerminalWarm = SequencedWarmAcquirer(sources: [
        bufferedTerminalSource,
        bufferedRecoverySource,
    ])
    let bufferedTerminalCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: bufferedTerminalWarm
        ),
        strategy: .prewarmedSnapshot
    )
    bufferedTerminalCapturer.reconcileWarm(configuration)
    require(
        waitForCondition {
            bufferedTerminalWarm.openCount == 2
                && bufferedTerminalCapturer.warmStatus().state == .ready
        },
        "buffered terminal failure was dropped before ready lease binding"
    )

    let quiesceCancelSource = FakeWarmSource(failure: nil)
    quiesceCancelSource.completesStopImmediately = false
    let quiesceCancelWarm = FakeWarmAcquirer(source: quiesceCancelSource)
    let quiesceCancelStill = FakePixelAcquirer()
    let quiesceCancelCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: quiesceCancelStill,
            warmAcquirer: quiesceCancelWarm
        ),
        strategy: .prewarmedSnapshot
    )
    quiesceCancelCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(quiesceCancelCapturer, .ready).state == .ready,
        "quiescing cancellation fixture did not warm"
    )
    let quiesceCompletion = DispatchSemaphore(value: 0)
    let quiesceRetirement = DispatchSemaphore(value: 0)
    var quiesceResult: Result<AOSDesktopPixelFrameSet, Error>?
    let quiesceOperation = quiesceCancelCapturer.captureExclusiveStill(
        publicRequest
    ) {
        quiesceResult = $0
        quiesceCompletion.signal()
    }
    require(
        waitForCondition { quiesceCancelSource.stopCompletion != nil },
        "quiescing cancellation did not await warm retirement"
    )
    (quiesceOperation as? AOSDesktopFrameRetirementAwaiting)?
        .cancelAndAwaitRetirement { _ in quiesceRetirement.signal() }
    quiesceCancelSource.completesStopImmediately = true
    quiesceCancelSource.stopCompletion?(.success(()))
    require(
        quiesceCompletion.wait(timeout: .now() + 1) == .success
            && quiesceRetirement.wait(timeout: .now() + 1) == .success
            && quiesceCancelStill.captureCount == 0
            && quiesceCancelWarm.openCount == 2,
        "quiescing cancellation escaped before exact warm restoration"
    )
    if case .failure(let error) = quiesceResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .unauthorized,
            "quiescing cancellation changed its caller result"
        )
    } else {
        require(false, "quiescing cancellation unexpectedly succeeded")
    }

    let capturingCancelStill = FakePixelAcquirer()
    let capturingCancelCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: capturingCancelStill,
            warmAcquirer: FakeWarmAcquirer(source: FakeWarmSource(failure: nil))
        ),
        strategy: .prewarmedSnapshot
    )
    let capturingCompletion = DispatchSemaphore(value: 0)
    let capturingRetirement = DispatchSemaphore(value: 0)
    var capturingResult: Result<AOSDesktopPixelFrameSet, Error>?
    let capturingOperation = capturingCancelCapturer.captureExclusiveStill(
        publicRequest
    ) {
        capturingResult = $0
        capturingCompletion.signal()
    }
    require(
        waitForCondition { capturingCancelStill.captureCount == 1 },
        "capturing cancellation fixture did not admit its still"
    )
    (capturingOperation as? AOSDesktopFrameRetirementAwaiting)?
        .cancelAndAwaitRetirement { _ in capturingRetirement.signal() }
    require(
        waitForCondition { capturingCancelStill.canceled == 1 },
        "capturing cancellation did not reach native ownership"
    )
    capturingCancelStill.pending[0](
        .failure(AOSDesktopFrameCaptureFailure.unauthorized)
    )
    require(
        capturingCompletion.wait(timeout: .now() + 1) == .success,
        "capturing cancellation did not settle its caller"
    )
    require(
        capturingRetirement.wait(timeout: .now() + 1) == .success,
        "capturing cancellation did not settle its retirement waiter"
    )
    require(
        capturingCancelStill.canceled == 1,
        "capturing cancellation did not cancel native ownership exactly once (\(capturingCancelStill.canceled))"
    )
    if case .failure(let error) = capturingResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .unauthorized,
            "capturing cancellation changed its caller result"
        )
    } else {
        require(false, "capturing cancellation unexpectedly succeeded")
    }

    let restoringCancelSource = FakeWarmSource(failure: nil)
    let restoringCancelWarm = FirstReadyThenDeferredWarmAcquirer(
        source: restoringCancelSource
    )
    let restoringCancelStill = FakePixelAcquirer()
    let restoringCancelCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: restoringCancelStill,
            warmAcquirer: restoringCancelWarm
        ),
        strategy: .prewarmedSnapshot
    )
    restoringCancelCapturer.reconcileWarm(configuration)
    require(
        waitForWarmState(restoringCancelCapturer, .ready).state == .ready,
        "restoring cancellation fixture did not warm"
    )
    let restoringCompletion = DispatchSemaphore(value: 0)
    let restoringRetirement = DispatchSemaphore(value: 0)
    var restoringResult: Result<AOSDesktopPixelFrameSet, Error>?
    let restoringOperation = restoringCancelCapturer.captureExclusiveStill(
        publicRequest
    ) {
        restoringResult = $0
        restoringCompletion.signal()
    }
    require(
        waitForCondition { restoringCancelStill.captureCount == 1 },
        "restoring cancellation fixture did not admit its still"
    )
    restoringCancelStill.pending[0](.success(AOSDesktopPixelFrameSet(
        capturedAt: transactionNow,
        durationMilliseconds: 1,
        frames: [AOSDesktopPixelFrame(
            capturedAt: transactionNow,
            displayID: 42,
            image: onePixelImage()
        )]
    )))
    require(
        waitForCondition { restoringCancelWarm.openCount == 2 },
        "restoring cancellation fixture did not enter restore"
    )
    (restoringOperation as? AOSDesktopFrameRetirementAwaiting)?
        .cancelAndAwaitRetirement { _ in restoringRetirement.signal() }
    restoringCancelWarm.completeRestore()
    require(
        restoringCompletion.wait(timeout: .now() + 1) == .success
            && restoringRetirement.wait(timeout: .now() + 1) == .success
            && restoringCancelCapturer.warmStatus().state == .ready,
        "restoring cancellation escaped before warm readiness"
    )
    if case .failure(let error) = restoringResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .unauthorized,
            "restoring cancellation delivered stale success"
        )
    } else {
        require(false, "restoring cancellation unexpectedly succeeded")
    }
}
