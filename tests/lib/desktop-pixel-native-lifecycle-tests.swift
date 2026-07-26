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

    @discardableResult
    func increment() -> Int {
        lock.lock()
        value += 1
        let current = value
        lock.unlock()
        return current
    }

    func get() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

final class LockedConcurrencyProbe: @unchecked Sendable {
    private var active = 0
    private let lock = NSLock()
    private var maximum = 0

    func enter() {
        lock.lock()
        active += 1
        maximum = max(maximum, active)
        lock.unlock()
    }

    func leave() {
        lock.lock()
        active -= 1
        lock.unlock()
    }

    func maximumObserved() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return maximum
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

actor PixelOperationGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func open() {
        guard !opened else { return }
        opened = true
        let pending = waiters
        waiters = []
        pending.forEach { $0.resume() }
    }

    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }
}

func startPixelStreams(
    count: Int,
    settlementTimeout: TimeInterval = 0.1,
    lifecycles: [AOSDesktopPixelStreamLifecycle]? = nil,
    stop: @escaping @Sendable (_ index: Int) async throws -> Void = { _ in },
    start: @escaping @Sendable (_ index: Int) async throws -> Void
) -> Bool {
    let settled = DispatchSemaphore(value: 0)
    let result = LockedBoolean()
    let ownedLifecycles = lifecycles
        ?? (0..<count).map { _ in FakePixelStreamLifecycle() }
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                lifecycles: ownedLifecycles,
                settlementTimeout: settlementTimeout,
                start: start,
                stop: stop
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

func waitForAggregateSettlementFromCanceledTask(
    _ settlement: AOSDesktopPixelAggregateSettlement,
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
    var frameAdvancement = AOSDesktopPixelFrameAdvancement()
    let firstFrameTime = CMTime(value: 1, timescale: 30)
    let secondFrameTime = CMTime(value: 2, timescale: 30)
    require(!frameAdvancement.isReady, "empty stream was reported ready")
    require(
        frameAdvancement.observe(presentationTime: firstFrameTime),
        "first complete frame was not observed"
    )
    require(
        !frameAdvancement.isReady,
        "warm stream was ready before proving frame advancement"
    )
    require(
        !frameAdvancement.observe(presentationTime: firstFrameTime),
        "duplicate frame timestamp advanced warm readiness"
    )
    require(
        !frameAdvancement.observe(presentationTime: .zero),
        "out-of-order frame timestamp advanced warm readiness"
    )
    require(
        frameAdvancement.observe(presentationTime: secondFrameTime),
        "second distinct frame was not observed"
    )
    require(
        frameAdvancement.isReady,
        "two distinct producer timestamps did not prove advancement"
    )
    require(
        !frameAdvancement.observe(presentationTime: .indefinite),
        "indefinite frame timestamp advanced warm readiness"
    )
    require(
        !frameAdvancement.observe(presentationTime: .positiveInfinity),
        "infinite frame timestamp advanced warm readiness"
    )

    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.complete.rawValue,
            presentationTime: firstFrameTime,
            hasImageBuffer: true
        ) == .frame,
        "complete image frame was not admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.started.rawValue,
            presentationTime: firstFrameTime,
            hasImageBuffer: true
        ) == .frame,
        "started image frame was not admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.idle.rawValue,
            presentationTime: secondFrameTime,
            hasImageBuffer: false
        ) == .heartbeat,
        "idle producer heartbeat was not admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: nil,
            presentationTime: secondFrameTime,
            hasImageBuffer: true
        ) == nil,
        "sample without status metadata was admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.complete.rawValue,
            presentationTime: secondFrameTime,
            hasImageBuffer: false
        ) == nil,
        "complete sample without image data was admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.blank.rawValue,
            presentationTime: secondFrameTime,
            hasImageBuffer: true
        ) == nil,
        "blank sample was admitted"
    )
    require(
        aosDesktopPixelSampleAdmission(
            statusRawValue: SCFrameStatus.complete.rawValue,
            presentationTime: .indefinite,
            hasImageBuffer: true
        ) == nil,
        "sample with nonnumeric timestamp was admitted"
    )

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
    let stalledStartSettled = DispatchSemaphore(value: 0)
    let failedStartBegan = Date()
    require(
        !startPixelStreams(count: 2) { index in
            await failedStartBarrier.arrive(expected: 2)
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            do {
                try await Task.sleep(nanoseconds: 30_000_000)
            } catch is CancellationError {
                stalledStartCanceled.signal()
                throw CancellationError()
            }
            stalledStartSettled.signal()
        },
        "multi-display startup failure was swallowed"
    )
    require(
        Date().timeIntervalSince(failedStartBegan) < 0.5,
        "failed display waited for a stalled sibling startup"
    )
    require(
        stalledStartCanceled.wait(timeout: .now() + 0.02) == .timedOut,
        "failed display interrupted an in-flight sibling startup"
    )
    require(
        stalledStartSettled.wait(timeout: .now()) == .success,
        "failed display did not retain sibling startup ownership"
    )

    let canceledStartupSettlement = AOSDesktopPixelAggregateSettlement(count: 1)
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.01) {
        canceledStartupSettlement.complete(success: true)
    }
    require(
        waitForAggregateSettlementFromCanceledTask(
            canceledStartupSettlement,
            timeout: 0.1
        ),
        "caller cancellation defeated bounded startup compensation"
    )

    let callerCancellationLifecycle = FakePixelStreamLifecycle()
    let callerCancellationGate = PixelOperationGate()
    let callerCancellationStartEntered = DispatchSemaphore(value: 0)
    let callerCancellationStopEntered = DispatchSemaphore(value: 0)
    let callerCancellationSettled = DispatchSemaphore(value: 0)
    let callerCancellationResult = LockedBoolean()
    let callerCancellationTask = Task {
        do {
            try await aosStartDesktopPixelStreams(
                lifecycles: [callerCancellationLifecycle],
                settlementTimeout: 0.2,
                start: { _ in
                    callerCancellationStartEntered.signal()
                    await callerCancellationGate.wait()
                },
                stop: { _ in callerCancellationStopEntered.signal() }
            )
            callerCancellationResult.set(true)
        } catch {
            callerCancellationResult.set(false)
        }
        callerCancellationSettled.signal()
    }
    require(
        callerCancellationStartEntered.wait(timeout: .now() + 1) == .success,
        "caller-cancellation fixture did not enter native startup"
    )
    callerCancellationTask.cancel()
    require(
        callerCancellationStopEntered.wait(timeout: .now() + 0.02) == .timedOut,
        "caller cancellation raced stop against pending native startup"
    )
    Task { await callerCancellationGate.open() }
    require(
        callerCancellationSettled.wait(timeout: .now() + 1) == .success
            && !callerCancellationResult.get()
            && callerCancellationStopEntered.wait(timeout: .now()) == .success
            && callerCancellationLifecycle.retirementWasObserved(),
        "caller cancellation did not retire once after native startup settled"
    )

    let stalledLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let stalledGate = PixelOperationGate()
    let stalledStopEntered = DispatchSemaphore(value: 0)
    let stalledBegan = Date()
    require(
        !startPixelStreams(
            count: stalledLifecycles.count,
            settlementTimeout: 0.02,
            lifecycles: stalledLifecycles,
            stop: { index in
                if index == 0 { stalledStopEntered.signal() }
            },
            start: { index in
                if index == 1 {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
                await stalledGate.wait()
            }
        ),
        "stalled startup escaped its settlement deadline"
    )
    require(
        Date().timeIntervalSince(stalledBegan) < 0.5
            && stalledStopEntered.wait(timeout: .now()) == .timedOut,
        "stalled startup either blocked the caller or raced an early stop"
    )
    Task { await stalledGate.open() }
    require(
        stalledStopEntered.wait(timeout: .now() + 1) == .success,
        "late startup completion did not retain retirement ownership"
    )

    let lateStartBarrier = PixelOperationBarrier()
    let releaseLateStart = DispatchSemaphore(value: 0)
    let lateStartCompensated = DispatchSemaphore(value: 0)
    let lateStartCompleted = LockedBoolean()
    let lateStartStoppedBeforeCompletion = LockedBoolean()
    let lateStartStopCalls = LockedCounter()
    let lateStartStopConcurrency = LockedConcurrencyProbe()
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.03) {
        releaseLateStart.signal()
    }
    let lateStartResult = startPixelStreams(
        count: 2,
        settlementTimeout: 0.2,
        stop: { index in
            if index == 0 {
                lateStartStopConcurrency.enter()
                defer { lateStartStopConcurrency.leave() }
                if !lateStartCompleted.get() {
                    lateStartStoppedBeforeCompletion.set(true)
                }
                lateStartStopCalls.increment()
                lateStartCompensated.signal()
            }
        }
    ) { index in
        await lateStartBarrier.arrive(expected: 2)
        if index == 1 {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        releaseLateStart.wait()
        lateStartCompleted.set(true)
    }
    require(
        !lateStartResult,
        "cancellation-insensitive startup escaped the settlement deadline"
    )
    require(
        !lateStartStoppedBeforeCompletion.get(),
        "aggregate failure stopped a sibling before native startup settled"
    )
    require(
        lateStartStopCalls.get() == 1
            && lateStartCompensated.wait(timeout: .now()) == .success,
        "settled sibling startup did not receive exactly one compensating stop"
    )
    require(
        lateStartStopConcurrency.maximumObserved() == 1,
        "startup retirement allowed overlapping stop owners"
    )

    let delegateRetirementLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let delegateStopEntered = DispatchSemaphore(value: 0)
    let delegateStopCanceled = DispatchSemaphore(value: 0)
    DispatchQueue.global(qos: .utility).async {
        _ = delegateStopEntered.wait(timeout: .now() + 1)
        delegateRetirementLifecycles[0].confirmRetirement()
    }
    require(
        !startPixelStreams(
            count: delegateRetirementLifecycles.count,
            settlementTimeout: 0.2,
            lifecycles: delegateRetirementLifecycles,
            stop: { index in
                guard index == 0 else { return }
                delegateStopEntered.signal()
                while !Task.isCancelled { await Task.yield() }
                delegateStopCanceled.signal()
            }
        ) { index in
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        },
        "delegate-first startup retirement unexpectedly succeeded"
    )
    require(
        delegateStopCanceled.wait(timeout: .now()) == .success,
        "native retirement did not cancel and join its pending stop task"
    )

    let startupHungStopLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let startupHungStopEntered = DispatchSemaphore(value: 0)
    let startupHungStopRelease = PixelOperationGate()
    let startupHungStopFinished = DispatchSemaphore(value: 0)
    let canceledStartupHungStops = LockedCounter()
    require(
        !startPixelStreams(
            count: startupHungStopLifecycles.count,
            settlementTimeout: 0.05,
            lifecycles: startupHungStopLifecycles,
            stop: { _ in
                startupHungStopEntered.signal()
                await startupHungStopRelease.wait()
                if Task.isCancelled { canceledStartupHungStops.increment() }
                startupHungStopFinished.signal()
            }
        ) { index in
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        },
        "cancellation-insensitive stop escaped the retirement deadline"
    )
    require(
        startupHungStopEntered.wait(timeout: .now()) == .success
            && startupHungStopEntered.wait(timeout: .now()) == .success,
        "startup retirement did not begin every stop attempt"
    )
    Task { await startupHungStopRelease.open() }
    require(
        startupHungStopFinished.wait(timeout: .now() + 1) == .success
            && startupHungStopFinished.wait(timeout: .now() + 1) == .success
            && canceledStartupHungStops.get() == startupHungStopLifecycles.count,
        "retirement timeout did not cancel every tracked stop task"
    )

    let startupLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let startupStopCalls = LockedCounter()
    require(
        !startPixelStreams(
            count: startupLifecycles.count,
            lifecycles: startupLifecycles,
            stop: { _ in startupStopCalls.increment() }
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
