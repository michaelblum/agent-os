import Foundation
import ScreenCaptureKit

final class FakePixelStreamLifecycle: AOSDesktopPixelStreamLifecycle,
    @unchecked Sendable
{
    let latch = AOSDesktopPixelRetirementLatch()
    var readiness: Result<Bool, Error> = .success(false)

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        latch.admitExplicitStop()
    }
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
    let signals = (0..<count).map { _ in AOSDesktopPixelStartupSignal() }
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                signals: signals,
                lifecycles: ownedLifecycles,
                settlementTimeout: settlementTimeout,
                start: { index, completion in
                    Task {
                        do {
                            try await start(index)
                            completion(.success(()))
                        } catch {
                            completion(.failure(error))
                        }
                    }
                },
                stop: { index, completion in
                    Task {
                        do {
                            try await stop(index)
                            completion(.success(()))
                        } catch {
                            completion(.failure(error))
                        }
                    }
                }
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
            timeout: timeout
        ) { completion in
            Task {
                do {
                    try await stop()
                    completion(.success(()))
                } catch {
                    completion(.failure(error))
                }
            }
        }
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
            timeout: timeout
        ) { index, completion in
            Task {
                do {
                    try await stop(index)
                    completion(.success(()))
                } catch {
                    completion(.failure(error))
                }
            }
        }
        result.set(value)
        settled.signal()
    }
    require(
        settled.wait(timeout: .now() + max(1, timeout + 0.5)) == .success,
        "multi-stream retirement settlement did not complete"
    )
    return result.get()
}

func runDesktopPixelNativeLifecycleTests() async throws {
    require(
        AOSDesktopPixelWarmStreamProfile.queueDepth == 3,
        "warm stream profile lost its bounded producer depth"
    )
    guard let scaledProfile = AOSDesktopPixelWarmStreamProfile(
        sourceWidth: 2_560,
        sourceHeight: 1_440,
        maximumPixels: AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay
    ) else {
        require(false, "ordinary warm stream profile was rejected")
        return
    }
    require(
        scaledProfile.width == 1_364 && scaledProfile.height == 768,
        "warm stream profile did not preserve aligned dimensions within the runtime budget"
    )
    guard let consentProfile = AOSDesktopPixelWarmStreamProfile(
        sourceWidth: 1_920,
        sourceHeight: 1_080,
        maximumPixels: AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay
    ) else {
        require(false, "ordinary consent stream profile was rejected")
        return
    }
    require(
        consentProfile.width == 1_364 && consentProfile.height == 768,
        "consent stream profile did not align the scaled IOSurface"
    )
    require(
        consentProfile.width * consentProfile.height
            <= AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay,
        "aligned consent stream profile exceeded its pixel budget"
    )
    guard let boundedProfile = AOSDesktopPixelWarmStreamProfile(
        sourceWidth: 64,
        sourceHeight: 64,
        maximumPixels: AOSDesktopPixelLimits.interactiveMaximumPixelsPerDisplay
    ) else {
        require(false, "bounded warm stream profile was rejected")
        return
    }
    require(
        boundedProfile.width == 64 && boundedProfile.height == 64,
        "warm stream profile upscaled a bounded source"
    )
    guard let oddSourceProfile = AOSDesktopPixelWarmStreamProfile(
        sourceWidth: 65,
        sourceHeight: 63,
        maximumPixels: 65 * 63
    ) else {
        require(false, "odd-sized source profile was rejected")
        return
    }
    require(
        oddSourceProfile.width == 64 && oddSourceProfile.height == 62,
        "odd-sized source profile did not round down to even dimensions"
    )
    require(
        oddSourceProfile.width * oddSourceProfile.height <= 65 * 63,
        "odd-sized source profile exceeded its pixel budget"
    )
    let sourceAspect = 65.0 / 63.0
    let outputAspect = Double(oddSourceProfile.width) / Double(oddSourceProfile.height)
    require(
        abs(sourceAspect - outputAspect) < 0.001,
        "odd-sized source profile exceeded the bounded aspect error"
    )
    require(
        AOSDesktopPixelWarmStreamProfile(
            sourceWidth: 1_920,
            sourceHeight: 1_080,
            maximumPixels: 1
        ) == nil,
        "one-pixel budget produced an invalid warm stream surface"
    )
    require(
        AOSDesktopPixelWarmStreamProfile(
            sourceWidth: 10_000,
            sourceHeight: 2,
            maximumPixels: 4_096
        ) == nil,
        "extreme aspect ratio produced a one-pixel warm stream axis"
    )
    require(
        aosDesktopPixelNativeTraceCode(for: NSError(
            domain: SCStreamErrorDomain,
            code: SCStreamError.Code.invalidParameter.rawValue
        )) == "scstream_-3812",
        "native trace code did not retain the content-free SCStream error identity"
    )
    require(
        aosDesktopPixelNativeTraceCode(for: NSError(
            domain: "io.agent-os.tests",
            code: 1
        )) == "native_other",
        "native trace code exposed an unrelated error identity"
    )
    try await runDesktopPixelTerminalStartupTests()
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

    let failedOnlyLifecycle = FakePixelStreamLifecycle()
    let failedOnlyStopCalls = LockedCounter()
    let failedOnlySettled = DispatchSemaphore(value: 0)
    let failedOnlyPreservedError = LockedBoolean()
    let failedOnlySignal = AOSDesktopPixelStartupSignal()
    Task {
        do {
            try await aosStartDesktopPixelStreams(
                signals: [failedOnlySignal],
                lifecycles: [failedOnlyLifecycle],
                settlementTimeout: 0.1,
                start: { _, completion in
                    completion(.failure(AOSDesktopFrameCaptureFailure.captureFailed))
                },
                stop: { _, completion in
                    failedOnlyStopCalls.increment()
                    completion(.success(()))
                }
            )
        } catch let failure as AOSDesktopFrameCaptureFailure {
            failedOnlyPreservedError.set(failure == .captureFailed)
        } catch {}
        failedOnlySettled.signal()
    }
    require(
        failedOnlySettled.wait(timeout: .now() + 1) == .success
            && failedOnlyPreservedError.get()
            && failedOnlyStopCalls.get() == 0
            && failedOnlyLifecycle.retirementWasObserved(),
        "failed native startup was stopped or lost its initiating error"
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
    let delegateStopRelease = PixelOperationGate()
    let delegateStopFinished = DispatchSemaphore(value: 0)
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
                await delegateStopRelease.wait()
                delegateStopFinished.signal()
            }
        ) { index in
            if index == 1 {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        },
        "delegate-first startup retirement unexpectedly succeeded"
    )
    require(
        delegateStopFinished.wait(timeout: .now()) == .timedOut,
        "delegate retirement waited for the native stop callback"
    )
    Task { await delegateStopRelease.open() }
    require(
        delegateStopFinished.wait(timeout: .now() + 1) == .success,
        "late native stop callback did not retain its owner"
    )

    let startupHungStopLifecycles = [
        FakePixelStreamLifecycle(),
        FakePixelStreamLifecycle(),
    ]
    let startupHungStopEntered = DispatchSemaphore(value: 0)
    let startupHungStopRelease = PixelOperationGate()
    let startupHungStopFinished = DispatchSemaphore(value: 0)
    let startupHungStopCalls = LockedCounter()
    require(
        !startPixelStreams(
            count: startupHungStopLifecycles.count,
            settlementTimeout: 0.05,
            lifecycles: startupHungStopLifecycles,
            stop: { _ in
                startupHungStopCalls.increment()
                startupHungStopEntered.signal()
                await startupHungStopRelease.wait()
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
            && startupHungStopEntered.wait(timeout: .now()) == .timedOut,
        "startup retirement did not isolate the successfully started stream"
    )
    Task { await startupHungStopRelease.open() }
    require(
        startupHungStopFinished.wait(timeout: .now() + 1) == .success
            && startupHungStopFinished.wait(timeout: .now()) == .timedOut
            && startupHungStopCalls.get() == 1,
        "late native stop callback lost ownership or executed twice"
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
        startupLifecycles.allSatisfy { $0.retirementWasObserved() }
            && startupStopCalls.get() == 1,
        "startup compensation did not distinguish failed and active streams"
    )
    require(
        settlePixelRetirements(
            lifecycles: startupLifecycles,
            timeout: 0.1
        ) { _ in
            startupStopCalls.increment()
        } && startupStopCalls.get() == 1,
        "startup compensation stopped a failed stream or retried cleanup"
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
    let hungStopRelease = PixelOperationGate()
    let hungStopFinished = DispatchSemaphore(value: 0)
    let hungStopResult = settlePixelRetirement(
        lifecycle: hungStopLifecycle,
        timeout: 0.02
    ) {
        hungStopEntered.signal()
        await hungStopRelease.wait()
        hungStopFinished.signal()
    }
    require(
        hungStopEntered.wait(timeout: .now()) == .success,
        "hung stop operation was not started"
    )
    require(!hungStopResult, "hung stop operation escaped the retirement deadline")
    Task { await hungStopRelease.open() }
    require(
        hungStopFinished.wait(timeout: .now() + 1) == .success,
        "late native stop result lost its operation owner"
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
