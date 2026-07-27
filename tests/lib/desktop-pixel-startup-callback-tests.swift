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
    let firstFrameLifecycle = FakePixelStreamLifecycle()
    let firstFrameSignal = AOSDesktopPixelStartupSignal()
    let firstFrameStartEntered = DispatchSemaphore(value: 0)
    let firstFrameSettled = DispatchSemaphore(value: 0)
    let firstFrameSucceeded = LockedBoolean()
    let firstFrameStopCalls = LockedCounter()
    Task {
        do {
            let owner = try await aosStartDesktopPixelStreams(
                signals: [firstFrameSignal],
                lifecycles: [firstFrameLifecycle],
                settlementTimeout: 0.1,
                start: { _, _ in firstFrameStartEntered.signal() },
                stop: { _, completion in
                    firstFrameStopCalls.increment()
                    completion(.success(()))
                }
            )
            firstFrameSucceeded.set(true)
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
        firstFrameSettled.wait(timeout: .now() + 1) == .success
            && firstFrameSucceeded.get()
            && firstFrameStopCalls.get() == 0,
        "first-frame evidence did not complete startup without native callback"
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
    let lateFailureDeadline = Date().addingTimeInterval(1)
    while lateFailureStops.get() < 2, Date() < lateFailureDeadline {
        usleep(1_000)
    }
    require(
        lateFailures.get() == 1
            && lateFailureStops.get() == 2
            && lateFailureLifecycles.allSatisfy({ $0.retirementWasObserved() }),
        "late native start failure did not retire the full stream aggregate once"
    )
    lateFailureStarts[1].complete(.success(()))
    require(
        lateFailureStops.get() == 2,
        "late sibling start callback issued another compensating stop"
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
        canceledSettled.wait(timeout: .now() + 1) == .success
            && !canceledResult.get()
            && canceledStopEntered.wait(timeout: .now()) == .success
            && canceledLifecycle.retirementWasObserved(),
        "caller cancellation did not retire once after first-frame evidence"
    )
    canceledCompletion.complete(
        .failure(AOSDesktopFrameCaptureFailure.captureFailed)
    )
    require(
        canceledStopCalls.get() == 1 && canceledLateFailures.get() == 0,
        "late callback escaped a canceled and retired startup generation"
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
