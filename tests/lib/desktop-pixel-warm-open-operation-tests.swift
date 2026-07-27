import Foundation

private final class FakeWarmOpenSource: AOSDesktopPixelWarmSource,
    @unchecked Sendable
{
    private var cancelCount = 0
    private let lock = NSLock()
    private var retirement: ((Result<Void, Error>) -> Void)?

    func freeze(maximumAge: TimeInterval) throws -> AOSDesktopPixelFrameSet {
        throw AOSDesktopFrameCaptureFailure.frameNotReady
    }

    func cancel(completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        cancelCount += 1
        retirement = completion
        lock.unlock()
    }

    func cancellations() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return cancelCount
    }

    func settleRetirement(_ result: Result<Void, Error>) {
        lock.lock()
        let completion = retirement
        retirement = nil
        lock.unlock()
        completion?(result)
    }
}

func runDesktopPixelWarmOpenOperationTests() throws {
    let deferredGate = PixelOperationGate()
    let deferredEntered = DispatchSemaphore(value: 0)
    let deferredCompleted = DispatchSemaphore(value: 0)
    let deferredSource = FakeWarmOpenSource()
    let deferredTaskWasCanceled = LockedBoolean()
    let deferredReturnedCancellation = LockedBoolean()
    let deferred = AOSDesktopPixelWarmOpenOperation(
        open: { _ in
            deferredEntered.signal()
            await deferredGate.wait()
            deferredTaskWasCanceled.set(Task.isCancelled)
            return deferredSource
        },
        completion: { result in
            if case .failure(let error) = result,
               error is CancellationError {
                deferredReturnedCancellation.set(true)
            }
            deferredCompleted.signal()
        }
    )
    deferred.start()
    require(
        deferredEntered.wait(timeout: .now() + 1) == .success,
        "deferred warm-open fixture did not enter startup"
    )
    deferred.cancel()
    require(
        deferredCompleted.wait(timeout: .now() + 0.02) == .timedOut
            && deferredSource.cancellations() == 0,
        "warm-open cancellation escaped before native startup settled"
    )
    Task { await deferredGate.open() }
    let retirementDeadline = Date().addingTimeInterval(1)
    while deferredSource.cancellations() == 0, Date() < retirementDeadline {
        usleep(1_000)
    }
    require(
        !deferredTaskWasCanceled.get()
            && deferredSource.cancellations() == 1
            && deferredCompleted.wait(timeout: .now()) == .timedOut,
        "warm-open cancellation interrupted startup or skipped retirement"
    )
    deferredSource.settleRetirement(.success(()))
    require(
        deferredCompleted.wait(timeout: .now() + 1) == .success
            && deferredReturnedCancellation.get(),
        "warm-open cancellation settled before acknowledged retirement"
    )
    deferred.cancel()
    require(
        deferredSource.cancellations() == 1,
        "repeated warm-open cancellation retried source retirement"
    )

    let failedGate = PixelOperationGate()
    let failedEntered = DispatchSemaphore(value: 0)
    let failedCompleted = DispatchSemaphore(value: 0)
    let failedPreservedError = LockedBoolean()
    let failed = AOSDesktopPixelWarmOpenOperation(
        open: { _ in
            failedEntered.signal()
            await failedGate.wait()
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        completion: { result in
            if case .failure(let error) = result {
                failedPreservedError.set(
                    error as? AOSDesktopFrameCaptureFailure == .captureFailed
                )
            }
            failedCompleted.signal()
        }
    )
    failed.start()
    require(
        failedEntered.wait(timeout: .now() + 1) == .success,
        "failed warm-open fixture did not enter startup"
    )
    failed.cancel()
    Task { await failedGate.open() }
    require(
        failedCompleted.wait(timeout: .now() + 1) == .success
            && failedPreservedError.get(),
        "warm-open cancellation replaced the initiating startup error"
    )

    let publishedSource = FakeWarmOpenSource()
    let publishedCompleted = DispatchSemaphore(value: 0)
    let publishedSucceeded = LockedBoolean()
    let published = AOSDesktopPixelWarmOpenOperation(
        open: { _ in publishedSource },
        completion: { result in
            if case .success = result { publishedSucceeded.set(true) }
            publishedCompleted.signal()
        }
    )
    published.start()
    require(
        publishedCompleted.wait(timeout: .now() + 1) == .success
            && publishedSucceeded.get(),
        "completed warm open did not publish its source"
    )
    published.cancel()
    require(
        publishedSource.cancellations() == 0,
        "late cancellation revoked an already published source"
    )

    let partialLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let partialPendingEntered = DispatchSemaphore(value: 0)
    let partialPendingGate = PixelOperationGate()
    let partialStarted = DispatchSemaphore(value: 0)
    let partialStopCalls = LockedCounter()
    let partialStopEntered = DispatchSemaphore(value: 0)
    let partialCompleted = DispatchSemaphore(value: 0)
    let partialRetirementUncertain = LockedBoolean()
    let partialSignals = partialLifecycles.map { _ in
        AOSDesktopPixelStartupSignal()
    }
    let partial = AOSDesktopPixelWarmOpenOperation(
        open: { cancellation in
            try await aosStartDesktopPixelStreams(
                signals: partialSignals,
                lifecycles: partialLifecycles,
                settlementTimeout: 0.05,
                cancellation: cancellation,
                start: { index, completion in
                    Task {
                        if index == 0 {
                            partialStarted.signal()
                        } else {
                            partialPendingEntered.signal()
                            await partialPendingGate.wait()
                        }
                        completion(.success(()))
                    }
                },
                stop: { _, completion in
                    partialStopCalls.increment()
                    partialStopEntered.signal()
                    completion(.success(()))
                }
            )
            return FakeWarmOpenSource()
        },
        completion: { result in
            if case .failure(let error) = result {
                partialRetirementUncertain.set(
                    error as? AOSDesktopFrameCaptureFailure == .retirementUncertain
                )
            }
            partialCompleted.signal()
        }
    )
    partial.start()
    require(
        partialStarted.wait(timeout: .now() + 1) == .success
            && partialPendingEntered.wait(timeout: .now() + 1) == .success,
        "partial warm-open fixture did not begin both starts"
    )
    partial.cancel()
    require(
        partialStopEntered.wait(timeout: .now() + 1) == .success
            && partialStopCalls.get() == 1,
        "logical cancellation did not retire the started sibling"
    )
    require(
        partialCompleted.wait(timeout: .now() + 1) == .success
            && partialRetirementUncertain.get(),
        "hung sibling startup did not fail closed after bounded retirement"
    )
    Task { await partialPendingGate.open() }
    require(
        partialStopEntered.wait(timeout: .now() + 1) == .success
            && partialStopCalls.get() == 2,
        "late successful sibling escaped compensating retirement"
    )
    let partialRetirementDeadline = Date().addingTimeInterval(1)
    while !partialLifecycles.allSatisfy({ $0.retirementWasObserved() }),
          Date() < partialRetirementDeadline {
        usleep(1_000)
    }
    require(
        partialLifecycles.allSatisfy { $0.retirementWasObserved() },
        "partial startup left a stream lifecycle unretired"
    )
}
