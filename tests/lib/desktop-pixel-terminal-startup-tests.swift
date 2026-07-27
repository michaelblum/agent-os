import Foundation

private final class TerminalStartupCompletion: @unchecked Sendable {
    private var completion: AOSDesktopPixelNativeCompletion?
    private let lock = NSLock()

    func store(_ completion: @escaping AOSDesktopPixelNativeCompletion) {
        lock.lock()
        self.completion = completion
        lock.unlock()
    }

    func complete(_ result: Result<Void, Error>) {
        lock.lock()
        let current = completion
        completion = nil
        lock.unlock()
        current?(result)
    }
}

private final class TerminalStartupLifetimeProbe: @unchecked Sendable {}

private final class ObservedTerminalPixelStreamLifecycle:
    AOSDesktopPixelStreamLifecycle,
    @unchecked Sendable
{
    private let latch = AOSDesktopPixelRetirementLatch()
    let waitEntered = DispatchSemaphore(value: 0)

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        latch.admitExplicitStop()
    }

    func confirmRetirement() { latch.observe() }

    func retirementWasObserved() -> Bool { latch.snapshot() }

    func sampleIsReady() throws -> Bool { false }

    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        waitEntered.signal()
        return await latch.wait(timeout: timeout)
    }
}

private final class TerminalStartupOwnerBox: @unchecked Sendable {
    private let lock = NSLock()
    private var owner: AOSDesktopPixelStartupOwner?

    func store(_ owner: AOSDesktopPixelStartupOwner) {
        lock.lock()
        self.owner = owner
        lock.unlock()
    }

    func current() -> AOSDesktopPixelStartupOwner? {
        lock.lock()
        defer { lock.unlock() }
        return owner
    }
}

func runDesktopPixelTerminalStartupTests() async throws {
    let retainedGate = PixelOperationGate()
    let retainedEntered = DispatchSemaphore(value: 0)
    let retainedSettled = DispatchSemaphore(value: 0)
    weak var retainedOperation: AOSDesktopPixelRetainedAsyncOperation?
    do {
        let operation = AOSDesktopPixelRetainedAsyncOperation(
            priority: .userInitiated
        )
        retainedOperation = operation
        require(
            operation.start(operation: {
                retainedEntered.signal()
                await retainedGate.wait()
            }, completion: { _ in
                retainedSettled.signal()
            }),
            "retained native operation fixture was not admitted"
        )
    }
    require(
        retainedEntered.wait(timeout: .now() + 1) == .success,
        "retained native operation fixture did not begin"
    )
    let retainedReleaseDeadline = Date().addingTimeInterval(1)
    while retainedOperation != nil, Date() < retainedReleaseDeadline {
        usleep(1_000)
    }
    require(
        retainedOperation == nil,
        "unresolved native operation retained its higher-level owner"
    )
    Task { await retainedGate.open() }
    require(
        retainedSettled.wait(timeout: .now() + 1) == .success,
        "detached native operation did not settle after release"
    )

    let observedLifecycle = ObservedTerminalPixelStreamLifecycle()
    let observedSignal = AOSDesktopPixelStartupSignal()
    let observedStart = TerminalStartupCompletion()
    let observedStartEntered = DispatchSemaphore(value: 0)
    let observedSettled = DispatchSemaphore(value: 0)
    let observedPreservedError = LockedBoolean()
    let observedStopCalls = LockedCounter()
    weak var observedProbe: TerminalStartupLifetimeProbe?
    do {
        let probe = TerminalStartupLifetimeProbe()
        observedProbe = probe
        Task { [probe] in
            do {
                _ = try await aosStartDesktopPixelStreams(
                    signals: [observedSignal],
                    lifecycles: [observedLifecycle],
                    settlementTimeout: 0.2,
                    start: { _, completion in
                        observedStart.store(completion)
                        observedStartEntered.signal()
                    },
                    stop: { _, completion in
                        _ = probe
                        observedStopCalls.increment()
                        completion(.success(()))
                    }
                )
            } catch let failure as AOSDesktopFrameCaptureFailure {
                observedPreservedError.set(failure == .captureFailed)
            } catch {}
            observedSettled.signal()
        }
    }
    require(
        observedStartEntered.wait(timeout: .now() + 1) == .success,
        "observed delegate-terminal fixture did not begin native startup"
    )
    observedSignal.fail(AOSDesktopFrameCaptureFailure.captureFailed)
    require(
        observedLifecycle.waitEntered.wait(timeout: .now() + 1) == .success
            && observedSettled.wait(timeout: .now() + 0.02) == .timedOut
            && observedStopCalls.get() == 0,
        "pending startup did not await delegate retirement evidence"
    )
    observedLifecycle.confirmRetirement()
    require(
        observedSettled.wait(timeout: .now() + 1) == .success
            && observedPreservedError.get()
            && observedStopCalls.get() == 0,
        "delegate retirement did not settle pending startup with its initiating error"
    )
    let observedReleaseDeadline = Date().addingTimeInterval(1)
    while observedProbe != nil, Date() < observedReleaseDeadline {
        usleep(1_000)
    }
    require(
        observedProbe == nil,
        "delegate retirement retained the pending startup coordinator graph"
    )
    observedStart.complete(.success(()))
    usleep(20_000)
    require(
        observedStopCalls.get() == 0,
        "late startup completion stopped a delegate-retired stream"
    )

    let terminalLifecycles = [FakePixelStreamLifecycle(), FakePixelStreamLifecycle()]
    let terminalSignals = [AOSDesktopPixelStartupSignal(), AOSDesktopPixelStartupSignal()]
    let terminalStarts = [TerminalStartupCompletion(), TerminalStartupCompletion()]
    let terminalStartEntered = DispatchSemaphore(value: 0)
    let terminalSettled = DispatchSemaphore(value: 0)
    let terminalPreservedError = LockedBoolean()
    let terminalStopCalls = LockedCounter()
    weak var terminalProbe: TerminalStartupLifetimeProbe?
    do {
        let probe = TerminalStartupLifetimeProbe()
        terminalProbe = probe
        Task { [probe] in
            do {
                _ = try await aosStartDesktopPixelStreams(
                    signals: terminalSignals,
                    lifecycles: terminalLifecycles,
                    settlementTimeout: 0.2,
                    start: { index, completion in
                        terminalStarts[index].store(completion)
                        terminalStartEntered.signal()
                    },
                    stop: { _, completion in
                        _ = probe
                        terminalStopCalls.increment()
                        completion(.success(()))
                    }
                )
            } catch let failure as AOSDesktopFrameCaptureFailure {
                terminalPreservedError.set(failure == .captureFailed)
            } catch {}
            terminalSettled.signal()
        }
    }
    for _ in terminalStarts {
        require(
            terminalStartEntered.wait(timeout: .now() + 1) == .success,
            "delegate-terminal aggregate did not begin every native startup"
        )
    }
    for index in terminalLifecycles.indices {
        terminalLifecycles[index].confirmRetirement()
        terminalSignals[index].fail(AOSDesktopFrameCaptureFailure.captureFailed)
    }
    require(
        terminalSettled.wait(timeout: .now() + 1) == .success
            && terminalPreservedError.get()
            && terminalStopCalls.get() == 0,
        "delegate-proven aggregate retirement did not preserve the initiating error"
    )
    let terminalReleaseDeadline = Date().addingTimeInterval(1)
    while terminalProbe != nil, Date() < terminalReleaseDeadline {
        usleep(1_000)
    }
    require(
        terminalProbe == nil,
        "delegate-proven retirement retained the coordinator ownership graph"
    )
    terminalStarts[0].complete(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    terminalStarts[1].complete(.success(()))
    usleep(20_000)
    require(
        terminalStopCalls.get() == 0,
        "late native startup callbacks duplicated delegate-proven retirement"
    )

    let mixedLifecycles = [FakePixelStreamLifecycle(), FakePixelStreamLifecycle()]
    let mixedSignals = [AOSDesktopPixelStartupSignal(), AOSDesktopPixelStartupSignal()]
    let mixedStarts = [TerminalStartupCompletion(), TerminalStartupCompletion()]
    let mixedStartEntered = DispatchSemaphore(value: 0)
    let mixedSettled = DispatchSemaphore(value: 0)
    let mixedFailedClosed = LockedBoolean()
    let mixedStopCalls = LockedCounter()
    Task {
        do {
            _ = try await aosStartDesktopPixelStreams(
                signals: mixedSignals,
                lifecycles: mixedLifecycles,
                settlementTimeout: 0.03,
                start: { index, completion in
                    mixedStarts[index].store(completion)
                    mixedStartEntered.signal()
                },
                stop: { _, completion in
                    mixedStopCalls.increment()
                    completion(.success(()))
                }
            )
        } catch let failure as AOSDesktopFrameCaptureFailure {
            mixedFailedClosed.set(failure == .retirementUncertain)
        } catch {}
        mixedSettled.signal()
    }
    for _ in mixedStarts {
        require(
            mixedStartEntered.wait(timeout: .now() + 1) == .success,
            "mixed terminal fixture did not begin every native startup"
        )
    }
    mixedLifecycles[0].confirmRetirement()
    mixedSignals[0].fail(AOSDesktopFrameCaptureFailure.captureFailed)
    require(
        mixedSettled.wait(timeout: .now() + 1) == .success
            && mixedFailedClosed.get()
            && mixedStopCalls.get() == 0,
        "missing retirement evidence did not remain fail-closed"
    )
    mixedLifecycles[1].confirmRetirement()
    mixedStarts[0].complete(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    mixedStarts[1].complete(.failure(AOSDesktopFrameCaptureFailure.captureFailed))

    let lateLifecycle = FakePixelStreamLifecycle()
    let lateSignal = AOSDesktopPixelStartupSignal()
    let lateStart = TerminalStartupCompletion()
    let lateStartEntered = DispatchSemaphore(value: 0)
    let lateOwnerReady = DispatchSemaphore(value: 0)
    let lateOwnerRelease = PixelOperationGate()
    let lateSettled = DispatchSemaphore(value: 0)
    let lateFailures = LockedCounter()
    let lateStopCalls = LockedCounter()
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: [lateSignal],
                lifecycles: [lateLifecycle],
                settlementTimeout: 0.2,
                lateFailure: { _ in lateFailures.increment() },
                start: { _, completion in
                    lateStart.store(completion)
                    lateStartEntered.signal()
                },
                stop: { _, completion in
                    lateStopCalls.increment()
                    completion(.success(()))
                }
            )
            lateOwnerReady.signal()
            await lateOwnerRelease.wait()
            owner.release()
        } catch {}
        lateSettled.signal()
    }
    require(
        lateStartEntered.wait(timeout: .now() + 1) == .success,
        "late delegate-terminal fixture did not begin native startup"
    )
    lateStart.complete(.success(()))
    require(
        lateOwnerReady.wait(timeout: .now() + 1) == .success,
        "late delegate-terminal fixture did not publish startup"
    )
    lateLifecycle.confirmRetirement()
    lateSignal.fail(AOSDesktopFrameCaptureFailure.captureFailed)
    let lateFailureDeadline = Date().addingTimeInterval(1)
    while lateFailures.get() < 1, Date() < lateFailureDeadline {
        usleep(1_000)
    }
    require(
        lateFailures.get() == 1
            && lateStopCalls.get() == 0
            && lateLifecycle.retirementWasObserved(),
        "delegate-terminal late failure issued a redundant native stop"
    )
    Task { await lateOwnerRelease.open() }
    require(
        lateSettled.wait(timeout: .now() + 1) == .success,
        "late delegate-terminal owner did not release"
    )

    let retiringLifecycle = FakePixelStreamLifecycle()
    let retiringSignal = AOSDesktopPixelStartupSignal()
    let retiringOwner = TerminalStartupOwnerBox()
    let retiringOwnerReady = DispatchSemaphore(value: 0)
    let retiringStop = TerminalStartupCompletion()
    let retiringStopEntered = DispatchSemaphore(value: 0)
    let retiringStopCalls = LockedCounter()
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: [retiringSignal],
                lifecycles: [retiringLifecycle],
                settlementTimeout: 0.2,
                start: { _, completion in
                    completion(.success(()))
                },
                stop: { _, completion in
                    retiringStopCalls.increment()
                    retiringStop.store(completion)
                    retiringStopEntered.signal()
                }
            )
            retiringOwner.store(owner)
        } catch {}
        retiringOwnerReady.signal()
    }
    require(
        retiringOwnerReady.wait(timeout: .now() + 1) == .success,
        "explicit-retirement fixture did not publish startup"
    )
    let retiringSettled = DispatchSemaphore(value: 0)
    let retiringSucceeded = LockedBoolean()
    Task {
        if let owner = retiringOwner.current() {
            retiringSucceeded.set(await owner.retire(timeout: 0.2))
        }
        retiringSettled.signal()
    }
    require(
        retiringStopEntered.wait(timeout: .now() + 1) == .success
            && retiringStopCalls.get() == 1,
        "explicit retirement did not admit exactly one native stop"
    )
    retiringLifecycle.confirmRetirement()
    require(
        retiringSettled.wait(timeout: .now() + 1) == .success
            && retiringSucceeded.get()
            && retiringStopCalls.get() == 1,
        "delegate retirement did not settle the admitted native stop"
    )
    retiringStop.complete(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    usleep(10_000)
    require(
        retiringStopCalls.get() == 1,
        "late native stop completion reopened retirement admission"
    )
}
