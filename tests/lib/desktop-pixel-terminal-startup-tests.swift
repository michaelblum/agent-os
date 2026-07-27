import Foundation

func runDesktopPixelTerminalStartupTests() async throws {
    let canceledStartEntered = DispatchSemaphore(value: 0)
    let canceledStartSettled = DispatchSemaphore(value: 0)
    let canceledStartPreserved = LockedBoolean()
    let canceledStart = AOSDesktopPixelRetainedAsyncOperation(
        priority: .userInitiated
    )
    require(
        canceledStart.start(operation: {
            canceledStartEntered.signal()
            try await Task.sleep(nanoseconds: 60_000_000_000)
        }, completion: { result in
            if case .failure(let error) = result,
               error is CancellationError {
                canceledStartPreserved.set(true)
            }
            canceledStartSettled.signal()
        }),
        "retained native startup fixture was not admitted"
    )
    require(
        canceledStartEntered.wait(timeout: .now() + 1) == .success,
        "retained native startup fixture did not begin"
    )
    canceledStart.cancel()
    require(
        canceledStartSettled.wait(timeout: .now() + 1) == .success
            && canceledStartPreserved.get(),
        "terminal delegate cleanup did not cancel the stale Swift startup waiter"
    )

    let delegateFailedLifecycle = FakePixelStreamLifecycle()
    let delegateFailedSignal = AOSDesktopPixelStartupSignal()
    let delegateFailedSettled = DispatchSemaphore(value: 0)
    let delegateFailedPreservedError = LockedBoolean()
    let delegateFailedStopCalls = LockedCounter()
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                signals: [delegateFailedSignal],
                lifecycles: [delegateFailedLifecycle],
                settlementTimeout: 0.1,
                start: { _, _ in
                    delegateFailedSignal.fail(
                        AOSDesktopFrameCaptureFailure.captureFailed
                    )
                },
                stop: { _, completion in
                    delegateFailedStopCalls.increment()
                    completion(.success(()))
                }
            )
        } catch let failure as AOSDesktopFrameCaptureFailure {
            delegateFailedPreservedError.set(failure == .captureFailed)
        } catch {}
        delegateFailedSettled.signal()
    }
    require(
        delegateFailedSettled.wait(timeout: .now() + 1) == .success
            && delegateFailedPreservedError.get()
            && delegateFailedStopCalls.get() == 0
            && delegateFailedLifecycle.retirementWasObserved(),
        "delegate-terminal startup retained a pending owner or changed its failure"
    )
}
