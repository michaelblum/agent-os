import Foundation

private final class NativeCompletionSlot: @unchecked Sendable {
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

func runDesktopPixelStartupCallbackTests() async throws {
    let retainedGate = PixelOperationGate()
    let retainedEntered = DispatchSemaphore(value: 0)
    let retainedSettled = DispatchSemaphore(value: 0)
    let retainedSucceeded = LockedBoolean()
    let retainedOperation = AOSDesktopPixelRetainedAsyncOperation(
        priority: .userInitiated
    )
    require(
        retainedOperation.start(operation: {
            retainedEntered.signal()
            await retainedGate.wait()
        }, completion: { result in
            if case .success = result { retainedSucceeded.set(true) }
            retainedSettled.signal()
        }),
        "retained async operation rejected its first invocation"
    )
    require(
        retainedEntered.wait(timeout: .now() + 1) == .success,
        "retained async operation did not begin"
    )
    require(
        !retainedOperation.start(
            operation: {},
            completion: { _ in }
        ),
        "retained async operation admitted a duplicate invocation"
    )
    Task { await retainedGate.open() }
    require(
        retainedSettled.wait(timeout: .now() + 1) == .success
            && retainedSucceeded.get(),
        "retained async operation did not deliver its authoritative result"
    )

    let firstFrameLifecycle = FakePixelStreamLifecycle()
    let firstFrameSignal = AOSDesktopPixelStartupSignal()
    let firstFrameStart = NativeCompletionSlot()
    let firstFrameStartEntered = DispatchSemaphore(value: 0)
    let firstFrameOwnerReady = DispatchSemaphore(value: 0)
    let firstFrameOwnerRelease = PixelOperationGate()
    let firstFrameSettled = DispatchSemaphore(value: 0)
    let firstFrameSucceeded = LockedBoolean()
    let firstFrameStopCalls = LockedCounter()
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: [firstFrameSignal],
                lifecycles: [firstFrameLifecycle],
                settlementTimeout: 0.1,
                start: { _, completion in
                    firstFrameStart.store(completion)
                    firstFrameStartEntered.signal()
                },
                stop: { _, completion in
                    firstFrameStopCalls.increment()
                    completion(.success(()))
                }
            )
            firstFrameSucceeded.set(true)
            firstFrameOwnerReady.signal()
            await firstFrameOwnerRelease.wait()
            owner.release()
        } catch {}
        firstFrameSettled.signal()
    }
    require(
        firstFrameStartEntered.wait(timeout: .now() + 1) == .success,
        "first-frame startup fixture did not invoke native start"
    )
    firstFrameSignal.succeed()
    require(
        firstFrameOwnerReady.wait(timeout: .now() + 1) == .success
            && firstFrameSucceeded.get()
            && firstFrameStopCalls.get() == 0,
        "first-frame evidence did not publish startup while native start settled"
    )
    firstFrameStart.complete(.success(()))
    Task { await firstFrameOwnerRelease.open() }
    require(
        firstFrameSettled.wait(timeout: .now() + 1) == .success,
        "first-frame startup owner did not release after native start settled"
    )

    let lateFailureLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let lateFailureSignals = lateFailureLifecycles.map { _ in
        AOSDesktopPixelStartupSignal()
    }
    let lateFailureStarts = lateFailureLifecycles.map { _ in
        NativeCompletionSlot()
    }
    let lateFailureStartEntered = DispatchSemaphore(value: 0)
    let lateFailureSettled = DispatchSemaphore(value: 0)
    let lateFailureStarted = LockedBoolean()
    let lateFailureStops = LockedCounter()
    let lateFailures = LockedCounter()
    let lateFailureOwnerRelease = PixelOperationGate()
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: lateFailureSignals,
                lifecycles: lateFailureLifecycles,
                settlementTimeout: 0.2,
                lateFailure: { _ in lateFailures.increment() },
                start: { index, completion in
                    lateFailureStarts[index].store(completion)
                    lateFailureStartEntered.signal()
                },
                stop: { _, completion in
                    lateFailureStops.increment()
                    completion(.success(()))
                }
            )
            lateFailureStarted.set(true)
            lateFailureSettled.signal()
            await lateFailureOwnerRelease.wait()
            owner.release()
        } catch {
            lateFailureSettled.signal()
        }
    }
    require(
        lateFailureStartEntered.wait(timeout: .now() + 1) == .success
            && lateFailureStartEntered.wait(timeout: .now() + 1) == .success,
        "late-failure fixture did not invoke both native starts"
    )
    lateFailureSignals.forEach { $0.succeed() }
    require(
        lateFailureSettled.wait(timeout: .now() + 1) == .success
            && lateFailureStarted.get(),
        "first-frame aggregate did not publish its startup owner"
    )
    lateFailureStarts[0].complete(
        .failure(AOSDesktopFrameCaptureFailure.captureFailed)
    )
    let lateFailurePublishedDeadline = Date().addingTimeInterval(1)
    while lateFailures.get() < 1, Date() < lateFailurePublishedDeadline {
        usleep(1_000)
    }
    require(
        lateFailures.get() == 1
            && lateFailureStops.get() == 0
            && !lateFailureLifecycles[1].retirementWasObserved(),
        "late native failure stopped a sibling whose start was still pending"
    )
    lateFailureStarts[1].complete(.success(()))
    let lateFailureRetirementDeadline = Date().addingTimeInterval(1)
    while !lateFailureLifecycles.allSatisfy({ $0.retirementWasObserved() }),
          Date() < lateFailureRetirementDeadline {
        usleep(1_000)
    }
    require(
        lateFailures.get() == 1
            && lateFailureStops.get() == 1
            && lateFailureLifecycles.allSatisfy({ $0.retirementWasObserved() }),
        "late native start failure did not retire the settled stream aggregate"
    )
    Task { await lateFailureOwnerRelease.open() }

    let canceledLifecycle = FakePixelStreamLifecycle()
    let canceledCompletion = NativeCompletionSlot()
    let canceledSignal = AOSDesktopPixelStartupSignal()
    let canceledStartEntered = DispatchSemaphore(value: 0)
    let canceledStopEntered = DispatchSemaphore(value: 0)
    let canceledSettled = DispatchSemaphore(value: 0)
    let canceledResult = LockedBoolean()
    let canceledStopCalls = LockedCounter()
    let canceledLateFailures = LockedCounter()
    let canceledTask = Task {
        do {
            try await aosStartDesktopPixelStreams(
                signals: [canceledSignal],
                lifecycles: [canceledLifecycle],
                settlementTimeout: 0.2,
                lateFailure: { _ in canceledLateFailures.increment() },
                start: { _, completion in
                    canceledCompletion.store(completion)
                    canceledStartEntered.signal()
                },
                stop: { _, completion in
                    canceledStopCalls.increment()
                    canceledStopEntered.signal()
                    completion(.success(()))
                }
            )
            canceledResult.set(true)
        } catch {
            canceledResult.set(false)
        }
        canceledSettled.signal()
    }
    require(
        canceledStartEntered.wait(timeout: .now() + 1) == .success,
        "caller-cancellation fixture did not enter native startup"
    )
    canceledTask.cancel()
    require(
        canceledStopEntered.wait(timeout: .now() + 0.02) == .timedOut,
        "caller cancellation raced stop against pending native startup"
    )
    canceledSignal.succeed()
    require(
        canceledSettled.wait(timeout: .now() + 0.02) == .timedOut
            && canceledStopEntered.wait(timeout: .now()) == .timedOut
            && !canceledLifecycle.retirementWasObserved(),
        "first-frame evidence raced retirement against pending native startup"
    )
    canceledCompletion.complete(.success(()))
    require(
        canceledSettled.wait(timeout: .now() + 1) == .success
            && !canceledResult.get()
            && canceledStopEntered.wait(timeout: .now()) == .success
            && canceledLifecycle.retirementWasObserved()
            && canceledStopCalls.get() == 1
            && canceledLateFailures.get() == 0,
        "caller cancellation did not retire after native startup settled"
    )

    let integratedLifecycle = FakePixelStreamLifecycle()
    let integratedSignal = AOSDesktopPixelStartupSignal()
    let integratedStartGate = PixelOperationGate()
    let integratedStartEntered = DispatchSemaphore(value: 0)
    let integratedOwnerReady = DispatchSemaphore(value: 0)
    let integratedStopEntered = DispatchSemaphore(value: 0)
    let integratedRetireSettled = DispatchSemaphore(value: 0)
    let integratedRetired = LockedBoolean()
    let integratedStopCalls = LockedCounter()
    let integratedStartOperation = AOSDesktopPixelRetainedAsyncOperation(
        priority: .userInitiated
    )
    let integratedStopOperation = AOSDesktopPixelRetainedAsyncOperation(
        priority: .utility
    )
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: [integratedSignal],
                lifecycles: [integratedLifecycle],
                settlementTimeout: 0.5,
                start: { _, completion in
                    if !integratedStartOperation.start(operation: {
                        integratedStartEntered.signal()
                        await integratedStartGate.wait()
                    }, completion: completion) {
                        completion(.failure(
                            AOSDesktopFrameCaptureFailure.busy
                        ))
                    }
                },
                stop: { _, completion in
                    integratedStopCalls.increment()
                    if !integratedStopOperation.start(operation: {
                        integratedStopEntered.signal()
                    }, completion: completion) {
                        completion(.failure(
                            AOSDesktopFrameCaptureFailure.busy
                        ))
                    }
                }
            )
            integratedOwnerReady.signal()
            integratedRetired.set(await owner.retire(timeout: 0.5))
        } catch {}
        integratedRetireSettled.signal()
    }
    require(
        integratedStartEntered.wait(timeout: .now() + 1) == .success,
        "integrated retained startup did not begin"
    )
    integratedSignal.succeed()
    require(
        integratedOwnerReady.wait(timeout: .now() + 1) == .success,
        "integrated retained startup did not publish first-frame readiness"
    )
    require(
        integratedStopEntered.wait(timeout: .now() + 0.02) == .timedOut
            && integratedRetireSettled.wait(timeout: .now()) == .timedOut,
        "integrated retirement overlapped its pending retained startup"
    )
    Task { await integratedStartGate.open() }
    require(
        integratedStopEntered.wait(timeout: .now() + 1) == .success
            && integratedRetireSettled.wait(timeout: .now() + 1) == .success
            && integratedRetired.get()
            && integratedStopCalls.get() == 1
            && integratedLifecycle.retirementWasObserved(),
        "integrated retained startup did not stop once after settling"
    )

    let retiredLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let retiredSignals = retiredLifecycles.map { _ in
        AOSDesktopPixelStartupSignal()
    }
    let retiredStarts = retiredLifecycles.map { _ in NativeCompletionSlot() }
    let retiredStartEntered = DispatchSemaphore(value: 0)
    let retiredSettled = DispatchSemaphore(value: 0)
    let retiredFailed = LockedBoolean()
    let retiredStopCalls = LockedCounter()
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                signals: retiredSignals,
                lifecycles: retiredLifecycles,
                settlementTimeout: 0.2,
                start: { index, completion in
                    retiredStarts[index].store(completion)
                    retiredStartEntered.signal()
                },
                stop: { _, completion in
                    retiredStopCalls.increment()
                    completion(.success(()))
                }
            )
        } catch {
            retiredFailed.set(true)
        }
        retiredSettled.signal()
    }
    require(
        retiredStartEntered.wait(timeout: .now() + 1) == .success
            && retiredStartEntered.wait(timeout: .now() + 1) == .success,
        "delegate-retirement fixture did not invoke both native starts"
    )
    retiredStarts[0].complete(.success(()))
    retiredLifecycles[0].confirmRetirement()
    retiredStarts[1].complete(
        .failure(AOSDesktopFrameCaptureFailure.captureFailed)
    )
    require(
        retiredSettled.wait(timeout: .now() + 1) == .success
            && retiredFailed.get()
            && retiredStopCalls.get() == 0
            && retiredLifecycles.allSatisfy({ $0.retirementWasObserved() }),
        "delegate retirement issued a redundant compensating stop"
    )
}
