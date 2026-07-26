import Foundation

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
    capturer.reconcileWarm(configuration)
    let initialStatus = waitForWarmState(capturer, .ready)
    require(initialStatus.state == .ready, "warm pool did not become ready")
    require(acquirer.openCount == 1, "warm pool opened duplicate native sources")

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
    require(
        waitForWarmState(capturer, .ready).state == .ready
            && acquirer.openCount == 3
            && source.canceled == 2,
        "warm configuration replacement overlapped native sources"
    )
    capturer.reconcileWarm(nil)
    require(
        waitForWarmState(capturer, .idle).state == .idle
            && source.canceled == 3,
        "warm pool disable retained its native source"
    )

    let firstFailedSource = FakeWarmSource(failure: .captureFailed)
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
        .captureFailed,
        "runtime source failure changed its caller result"
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
}
