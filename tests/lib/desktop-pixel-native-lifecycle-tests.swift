import Foundation
import ScreenCaptureKit

final class FakePixelStreamLifecycle: AOSDesktopPixelStreamLifecycle,
    @unchecked Sendable
{
    let latch = AOSDesktopPixelRetirementLatch()
    var readiness: Result<Bool, Error> = .success(false)

    func confirmRetirement() { latch.observe() }
    func sampleIsReady() throws -> Bool { try readiness.get() }
    func retirementWasObserved() -> Bool { latch.snapshot() }
    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await latch.wait(timeout: timeout)
    }
}

final class LockedBoolean: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false

    func set(_ value: Bool) {
        lock.lock()
        self.value = value
        lock.unlock()
    }

    func get() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

final class LockedCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    func get() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

actor PixelOperationBarrier {
    private var arrivals = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func arrive(expected: Int) async {
        arrivals += 1
        if arrivals == expected {
            let pending = waiters
            waiters = []
            pending.forEach { $0.resume() }
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }
}

func startPixelStreams(
    count: Int,
    settlementTimeout: TimeInterval = 0.1,
    compensate: @escaping @Sendable (_ index: Int) async -> Bool = { _ in true },
    start: @escaping @Sendable (_ index: Int) async throws -> Void
) -> Bool {
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                count: count,
                settlementTimeout: settlementTimeout,
                start: start,
                compensate: compensate
            )
            result.set(true)
        } catch {
            result.set(false)
        }
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + 1) == .success,
        "multi-stream startup did not complete"
    )
    return result.get()
}

func startupCompensationRequired(
    _ decision: AOSDesktopPixelStartupDecision
) -> Bool {
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    Task {
        result.set(await decision.compensationIsRequired())
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + 1) == .success,
        "startup decision did not settle"
    )
    return result.get()
}

func waitForStartupSettlementFromCanceledTask(
    _ settlement: AOSDesktopPixelStartupSettlement,
    timeout: TimeInterval
) -> Bool {
    let began = DispatchSemaphore(value: 0)
    let proceed = DispatchSemaphore(value: 0)
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    let task = Task {
        began.signal()
        proceed.wait()
        result.set(await settlement.wait(timeout: timeout))
        settled.signal()
    }
    require(
        began.wait(timeout: .now() + 1) == .success,
        "canceled startup-settlement fixture did not start"
    )
    task.cancel()
    proceed.signal()
    require(
        settled.wait(timeout: .now() + max(1, timeout + 0.5)) == .success,
        "canceled startup-settlement fixture did not complete"
    )
    return result.get()
}

func settlePixelRetirement(
    lifecycle: AOSDesktopPixelStreamLifecycle,
    timeout: TimeInterval = 0.05,
    stop: @escaping () async throws -> Void
) -> Bool {
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    Task {
        let value = await aosSettleDesktopPixelStreamRetirement(
            lifecycle: lifecycle,
            timeout: timeout,
            stop: stop
        )
        result.set(value)
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + max(1, timeout + 0.5)) == .success,
        "stream-retirement settlement did not complete"
    )
    return result.get()
}

func settlePixelRetirements(
    lifecycles: [AOSDesktopPixelStreamLifecycle],
    timeout: TimeInterval,
    stop: @escaping (_ index: Int) async throws -> Void
) -> Bool {
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    Task {
        let value = await aosSettleDesktopPixelStreamRetirements(
            lifecycles: lifecycles,
            timeout: timeout,
            stop: stop
        )
        result.set(value)
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + max(1, timeout + 0.5)) == .success,
        "multi-stream retirement settlement did not complete"
    )
    return result.get()
}

func runDesktopPixelNativeLifecycleTests() throws {
    require(
        aosDesktopPixelStreamRetirementTimeout >= 1
            && aosDesktopPixelStreamRetirementTimeout
                < AOSDesktopPixelBroker.defaultRetirementTimeout,
        "native stream retirement must leave margin inside the broker deadline"
    )
    require(
        aosDesktopPixelStopErrorConfirmsRetirement(NSError(
            domain: SCStreamErrorDomain,
            code: SCStreamError.Code.attemptToStopStreamState.rawValue
        )),
        "already-stopped ScreenCaptureKit state was not treated as retired"
    )
    require(
        aosDesktopPixelStopErrorConfirmsRetirement(NSError(
            domain: SCStreamErrorDomain,
            code: SCStreamError.Code.userStopped.rawValue
        )),
        "user-stopped ScreenCaptureKit state was not treated as retired"
    )
    if #available(macOS 15.0, *) {
        require(
            aosDesktopPixelStopErrorConfirmsRetirement(NSError(
                domain: SCStreamErrorDomain,
                code: SCStreamError.Code.systemStoppedStream.rawValue
            )),
            "system-stopped ScreenCaptureKit state was not treated as retired"
        )
    }
    require(
        !aosDesktopPixelStopErrorConfirmsRetirement(NSError(
            domain: SCStreamErrorDomain,
            code: SCStreamError.Code.invalidParameter.rawValue
        )),
        "unknown ScreenCaptureKit stop failure was accepted as retirement"
    )
    require(
        !aosDesktopPixelStopErrorConfirmsRetirement(NSError(
            domain: "io.agent-os.unrelated",
            code: SCStreamError.Code.attemptToStopStreamState.rawValue
        )),
        "non-ScreenCaptureKit stop failure was accepted as retirement"
    )

    let readyLifecycle = FakePixelStreamLifecycle()
    readyLifecycle.readiness = .success(true)
    let pendingLifecycle = FakePixelStreamLifecycle()
    let pendingReady = try aosDesktopPixelStreamsAreReady([
        readyLifecycle,
        pendingLifecycle,
    ])
    require(!pendingReady, "pending stream sample was accepted as ready")

    let failedLifecycle = FakePixelStreamLifecycle()
    failedLifecycle.readiness = .failure(
        AOSDesktopFrameCaptureFailure.permissionDenied
    )
    do {
        _ = try aosDesktopPixelStreamsAreReady([failedLifecycle])
        require(false, "terminal stream failure was swallowed as pending")
    } catch let failure as AOSDesktopFrameCaptureFailure {
        require(
            failure == .permissionDenied,
            "stream readiness changed its terminal failure"
        )
    }
    do {
        _ = try aosDesktopPixelStreamsAreReady([
            pendingLifecycle,
            failedLifecycle,
        ])
        require(false, "pending display hid a later terminal stream failure")
    } catch let failure as AOSDesktopFrameCaptureFailure {
        require(
            failure == .permissionDenied,
            "multi-display readiness changed its terminal failure"
        )
    }

    let startBarrier = PixelOperationBarrier()
    require(
        !startPixelStreams(count: 0) { _ in },
        "empty multi-display startup was accepted"
    )
    require(
        startPixelStreams(count: 2) { _ in
            await startBarrier.arrive(expected: 2)
        },
        "multi-display stream startup did not execute concurrently"
    )

    let failedStartBarrier = PixelOperationBarrier()
    let stalledStartCanceled = DispatchSemaphore(value: 0)
    let failedStartBegan = Date()
    require(
        !startPixelStreams(count: 2) { index in
            await failedStartBarrier.arrive(expected: 2)
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            do {
                try await Task.sleep(nanoseconds: 60_000_000_000)
            } catch is CancellationError {
                stalledStartCanceled.signal()
                throw CancellationError()
            }
        },
        "multi-display startup failure was swallowed"
    )
    require(
        Date().timeIntervalSince(failedStartBegan) < 0.5,
        "failed display waited for a stalled sibling startup"
    )
    require(
        stalledStartCanceled.wait(timeout: .now() + 1) == .success,
        "failed display did not cancel a stalled sibling startup"
    )

    let orderedFailure = AOSDesktopPixelStartupDecision(count: 2)
    orderedFailure.complete(.success(()))
    orderedFailure.complete(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    require(
        startupCompensationRequired(orderedFailure),
        "early success did not adopt the later aggregate failure"
    )

    let canceledStartupSettlement = AOSDesktopPixelStartupSettlement(count: 1)
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.01) {
        canceledStartupSettlement.complete(retired: true)
    }
    require(
        waitForStartupSettlementFromCanceledTask(
            canceledStartupSettlement,
            timeout: 0.1
        ),
        "caller cancellation defeated bounded startup compensation"
    )

    let lateStartBarrier = PixelOperationBarrier()
    let releaseLateStart = DispatchSemaphore(value: 0)
    let lateStartCompensated = DispatchSemaphore(value: 0)
    require(
        !startPixelStreams(
            count: 2,
            settlementTimeout: 0.05,
            compensate: { index in
                if index == 0 { lateStartCompensated.signal() }
                return true
            }
        ) { index in
            await lateStartBarrier.arrive(expected: 2)
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            releaseLateStart.wait()
        },
        "cancellation-insensitive startup escaped the settlement deadline"
    )
    releaseLateStart.signal()
    require(
        lateStartCompensated.wait(timeout: .now() + 1) == .success,
        "late successful startup was not compensated after aggregate failure"
    )

    let startupLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let startupStopCalls = LockedCounter()
    require(
        !startPixelStreams(
            count: startupLifecycles.count,
            compensate: { index in
                await aosSettleDesktopPixelStreamRetirement(
                    lifecycle: startupLifecycles[index],
                    timeout: 0.1
                ) {
                    startupStopCalls.increment()
                }
            }
        ) { index in
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        },
        "startup-compensation fixture unexpectedly succeeded"
    )
    require(
        startupLifecycles.allSatisfy { $0.retirementWasObserved() },
        "startup compensation did not retain explicit stream retirement"
    )
    require(
        settlePixelRetirements(
            lifecycles: startupLifecycles,
            timeout: 0.1
        ) { _ in
            startupStopCalls.increment()
        } && startupStopCalls.get() == startupLifecycles.count,
        "outer cleanup stopped streams already retired by startup compensation"
    )

    let delegateFirst = FakePixelStreamLifecycle()
    delegateFirst.latch.observe()
    require(
        settlePixelRetirement(lifecycle: delegateFirst) {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        "delegate-first retirement was rejected"
    )

    let explicitStop = FakePixelStreamLifecycle()
    let explicitStopCalls = LockedCounter()
    require(
        settlePixelRetirement(lifecycle: explicitStop) {
            explicitStopCalls.increment()
        },
        "successful explicit stop was not accepted as retirement"
    )
    require(
        explicitStop.retirementWasObserved(),
        "successful explicit stop was not retained by the retirement latch"
    )
    require(
        settlePixelRetirement(lifecycle: explicitStop) {
            explicitStopCalls.increment()
            throw AOSDesktopFrameCaptureFailure.captureFailed
        } && explicitStopCalls.get() == 1,
        "repeated cleanup retried an explicitly retired stream"
    )

    let errorFirst = FakePixelStreamLifecycle()
    let errorFirstLatch = errorFirst.latch
    require(
        settlePixelRetirement(lifecycle: errorFirst) {
            DispatchQueue.global(qos: .utility).asyncAfter(
                deadline: .now() + 0.01
            ) {
                errorFirstLatch.observe()
            }
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        "error-first retirement did not await its delegate acknowledgement"
    )

    let missingAcknowledgement = FakePixelStreamLifecycle()
    require(
        !settlePixelRetirement(lifecycle: missingAcknowledgement, timeout: 0.02) {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        "missing retirement acknowledgement failed open"
    )

    let delayedAcknowledgement = FakePixelStreamLifecycle()
    let delayedAcknowledgementLatch = delayedAcknowledgement.latch
    require(
        settlePixelRetirement(
            lifecycle: delayedAcknowledgement,
            timeout: 1.3
        ) {
            DispatchQueue.global(qos: .utility).asyncAfter(
                deadline: .now() + 1.1
            ) {
                delayedAcknowledgementLatch.observe()
            }
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        "delegate acknowledgement inside the configured timeout was rejected"
    )

    let canceledWaitLifecycle = FakePixelStreamLifecycle()
    let canceledWaitSettled = DispatchSemaphore(value: 0)
    let canceledWaitResult = LockedBoolean()
    let canceledWaitTask = Task {
        canceledWaitResult.set(await canceledWaitLifecycle.waitForRetirement(
            timeout: aosDesktopPixelStreamRetirementTimeout
        ))
        canceledWaitSettled.signal()
    }
    usleep(10_000)
    canceledWaitTask.cancel()
    require(
        canceledWaitSettled.wait(timeout: .now() + 0.5) == .success,
        "canceling a retirement wait retained it until the full timeout"
    )
    require(
        !canceledWaitResult.get(),
        "canceling a retirement wait reported retirement"
    )

    let hungStopLifecycle = FakePixelStreamLifecycle()
    let hungStopEntered = DispatchSemaphore(value: 0)
    let hungStopCanceled = DispatchSemaphore(value: 0)
    let hungStopResult = settlePixelRetirement(
        lifecycle: hungStopLifecycle,
        timeout: 0.02
    ) {
        hungStopEntered.signal()
        do {
            try await Task.sleep(nanoseconds: 60_000_000_000)
        } catch is CancellationError {
            hungStopCanceled.signal()
            throw CancellationError()
        }
    }
    require(
        hungStopEntered.wait(timeout: .now()) == .success,
        "hung stop operation was not started"
    )
    require(!hungStopResult, "hung stop operation escaped the retirement deadline")
    require(
        hungStopCanceled.wait(timeout: .now() + 1) == .success,
        "retirement deadline did not cancel the hung stop operation"
    )

    let firstDisplay = FakePixelStreamLifecycle()
    let secondDisplay = FakePixelStreamLifecycle()
    let stopBarrier = PixelOperationBarrier()
    require(
        settlePixelRetirements(
            lifecycles: [firstDisplay, secondDisplay],
            timeout: 0.5
        ) { _ in
            await stopBarrier.arrive(expected: 2)
        },
        "multi-display stream retirement did not execute concurrently"
    )
}
