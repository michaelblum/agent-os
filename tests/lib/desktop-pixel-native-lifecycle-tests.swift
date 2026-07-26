import Foundation
import ScreenCaptureKit

final class FakePixelStreamLifecycle: AOSDesktopPixelStreamLifecycle,
    @unchecked Sendable
{
    let latch = AOSDesktopPixelRetirementLatch()
    var readiness: Result<Bool, Error> = .success(false)

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

actor PixelStopBarrier {
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

    let delegateFirst = FakePixelStreamLifecycle()
    delegateFirst.latch.observe()
    require(
        settlePixelRetirement(lifecycle: delegateFirst) {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        },
        "delegate-first retirement was rejected"
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
    let stopBarrier = PixelStopBarrier()
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
