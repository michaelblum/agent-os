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

    for nativeResult: Result<Void, Error> in [
        .failure(AOSDesktopFrameCaptureFailure.captureFailed),
        .success(()),
    ] {
        let lifecycle = FakePixelStreamLifecycle()
        let signal = AOSDesktopPixelStartupSignal()
        let nativeStart = TerminalStartupCompletion()
        let startEntered = DispatchSemaphore(value: 0)
        let settled = DispatchSemaphore(value: 0)
        let preservedError = LockedBoolean()
        let stopCalls = LockedCounter()
        Task {
            do {
                try await aosStartDesktopPixelStreams(
                    signals: [signal],
                    lifecycles: [lifecycle],
                    settlementTimeout: 0.2,
                    start: { _, completion in
                        nativeStart.store(completion)
                        startEntered.signal()
                    },
                    stop: { _, completion in
                        stopCalls.increment()
                        completion(.success(()))
                    }
                )
            } catch let failure as AOSDesktopFrameCaptureFailure {
                preservedError.set(failure == .captureFailed)
            } catch {}
            settled.signal()
        }
        require(
            startEntered.wait(timeout: .now() + 1) == .success,
            "delegate-terminal fixture did not begin native startup"
        )
        lifecycle.confirmRetirement()
        signal.fail(AOSDesktopFrameCaptureFailure.captureFailed)
        require(
            settled.wait(timeout: .now() + 0.02) == .timedOut
                && stopCalls.get() == 0,
            "delegate-terminal startup settled before native startup ownership"
        )
        nativeStart.complete(nativeResult)
        require(
            settled.wait(timeout: .now() + 1) == .success
                && preservedError.get()
                && stopCalls.get() == 0
                && lifecycle.retirementWasObserved(),
            "delegate-terminal startup lost its error or duplicated retirement"
        )
    }

    let abandonedLifecycle = FakePixelStreamLifecycle()
    let abandonedSignal = AOSDesktopPixelStartupSignal()
    let abandonedStart = TerminalStartupCompletion()
    let abandonedStartEntered = DispatchSemaphore(value: 0)
    let abandonedSettled = DispatchSemaphore(value: 0)
    let abandonedFailedClosed = LockedBoolean()
    let abandonedStopCalls = LockedCounter()
    weak var abandonedProbe: TerminalStartupLifetimeProbe?
    do {
        let probe = TerminalStartupLifetimeProbe()
        abandonedProbe = probe
        Task { [probe] in
            do {
                _ = try await aosStartDesktopPixelStreams(
                    signals: [abandonedSignal],
                    lifecycles: [abandonedLifecycle],
                    settlementTimeout: 0.03,
                    start: { _, completion in
                        abandonedStart.store(completion)
                        abandonedStartEntered.signal()
                    },
                    stop: { _, completion in
                        _ = probe
                        abandonedStopCalls.increment()
                        completion(.success(()))
                    }
                )
            } catch let failure as AOSDesktopFrameCaptureFailure {
                abandonedFailedClosed.set(failure == .retirementUncertain)
            } catch {}
            abandonedSettled.signal()
        }
    }
    require(
        abandonedStartEntered.wait(timeout: .now() + 1) == .success,
        "abandoned native startup fixture did not begin"
    )
    abandonedLifecycle.confirmRetirement()
    abandonedSignal.fail(AOSDesktopFrameCaptureFailure.captureFailed)
    require(
        abandonedSettled.wait(timeout: .now() + 1) == .success
            && abandonedFailedClosed.get()
            && abandonedStopCalls.get() == 0,
        "unresolved native startup did not fail closed without stopping"
    )
    let abandonedReleaseDeadline = Date().addingTimeInterval(1)
    while abandonedProbe != nil, Date() < abandonedReleaseDeadline {
        usleep(1_000)
    }
    require(
        abandonedProbe == nil,
        "unresolved native startup retained the coordinator ownership graph"
    )
    abandonedStart.complete(.success(()))

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
