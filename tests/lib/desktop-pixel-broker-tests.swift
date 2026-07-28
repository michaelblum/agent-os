import CoreGraphics
import Foundation

final class FakePixelAcquirer: AOSDesktopPixelAcquiring {
    var canceled = 0
    var captureCount = 0
    var pending: [((Result<AOSDesktopPixelFrameSet, Error>) -> Void)] = []

    @discardableResult
    func snapshot(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        captureCount += 1
        pending.append(completion)
        return AOSDesktopFrameCancellation { self.canceled += 1 }
    }
}

func onePixelImage() -> CGImage {
    let context = CGContext(
        data: nil,
        width: 1,
        height: 1,
        bitsPerComponent: 8,
        bytesPerRow: 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    return context.makeImage()!
}

final class FakeWarmSource: AOSDesktopPixelWarmSource {
    private let lock = NSLock()
    private var storedStopCompletion: ((Result<Void, Error>) -> Void)?
    var canceled = 0
    var completesStopImmediately = true
    var failure: AOSDesktopFrameCaptureFailure?
    var freezeEntered: DispatchSemaphore?
    var freezeRelease: DispatchSemaphore?
    var freezeCount = 0
    var stopCompletion: ((Result<Void, Error>) -> Void)? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return storedStopCompletion
        }
        set {
            lock.lock()
            storedStopCompletion = newValue
            lock.unlock()
        }
    }
    var stopResult: Result<Void, Error> = .success(())

    init(failure: AOSDesktopFrameCaptureFailure? = .captureFailed) {
        self.failure = failure
    }

    func freeze(maximumAge: TimeInterval) throws -> AOSDesktopPixelFrameSet {
        freezeCount += 1
        freezeEntered?.signal()
        freezeRelease?.wait()
        if let failure { throw failure }
        let now = Date()
        return AOSDesktopPixelFrameSet(
            capturedAt: now,
            durationMilliseconds: 1,
            frames: [AOSDesktopPixelFrame(
                capturedAt: now,
                displayID: 42,
                image: onePixelImage()
            )]
        )
    }

    func cancel(completion: @escaping (Result<Void, Error>) -> Void) {
        canceled += 1
        if completesStopImmediately {
            completion(stopResult)
        } else {
            stopCompletion = completion
        }
    }
}

final class FakeWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    var canceled = 0
    var openCount = 0
    let source: FakeWarmSource

    init(source: FakeWarmSource = FakeWarmSource()) {
        self.source = source
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        openCount += 1
        completion(.success(source))
        return AOSDesktopFrameCancellation { self.canceled += 1 }
    }
}

final class StalledWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    var canceled = 0

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        AOSDesktopFrameCancellation { self.canceled += 1 }
    }
}

func runDesktopPixelBrokerTests() throws {
    let pixelAcquirer = FakePixelAcquirer()
    let pixelBroker = AOSDesktopPixelBroker(acquirer: pixelAcquirer)
    let pixelRequest = AOSDesktopPixelSnapshotRequest(
        displayIDs: [42],
        excludingWindowIDs: [900],
        maximumPixelsPerDisplay: 4_096
    )
    let oversizedPixelRequest = AOSDesktopPixelSnapshotRequest(
        displayIDs: [42],
        excludingWindowIDs: [],
        maximumPixelsPerDisplay:
            AOSDesktopPixelLimits.maximumPixelsPerDisplay + 1
    )
    var oversizedPixelResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = pixelBroker.snapshot(oversizedPixelRequest) {
        oversizedPixelResult = $0
    }
    if case .failure(let error) = oversizedPixelResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .captureFailed,
            "pixel broker changed its hard-ceiling failure"
        )
    } else {
        require(false, "pixel broker admitted an oversized native request")
    }
    require(
        pixelAcquirer.captureCount == 0,
        "oversized request reached native acquisition"
    )
    var firstPixelResult: Result<AOSDesktopPixelFrameSet, Error>?
    let firstPixelCapture = pixelBroker.snapshot(pixelRequest) {
        firstPixelResult = $0
    }
    var busyPixelResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = pixelBroker.snapshot(pixelRequest) { busyPixelResult = $0 }
    if case .failure(let error) = busyPixelResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "pixel broker did not serialize acquisition"
        )
    } else {
        require(false, "pixel broker admitted overlapping acquisition")
    }
    require(pixelAcquirer.captureCount == 1, "busy capture reached native acquisition")
    firstPixelCapture.cancel()
    require(pixelAcquirer.canceled == 1, "pixel broker did not cancel native acquisition")
    var retiringPixelResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = pixelBroker.snapshot(pixelRequest) { retiringPixelResult = $0 }
    if case .failure(let error) = retiringPixelResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "canceled native acquisition did not hold the broker closed"
        )
    } else {
        require(false, "new capture overlapped canceled native acquisition")
    }
    require(pixelAcquirer.captureCount == 1, "retiring snapshot reached native acquisition")
    pixelAcquirer.pending[0](.failure(AOSDesktopFrameCaptureFailure.captureFailed))
    require(firstPixelResult == nil, "canceled pixel result escaped the broker")

    _ = pixelBroker.snapshot(pixelRequest) { _ in
        require(false, "shutdown pixel result escaped the broker")
    }
    require(pixelAcquirer.captureCount == 2, "pixel broker did not recover after cancellation")
    pixelBroker.shutdown()
    require(pixelAcquirer.canceled == 2, "pixel broker shutdown retained native acquisition")
    pixelAcquirer.pending[1](.failure(AOSDesktopFrameCaptureFailure.captureFailed))

    let warmSnapshotAcquirer = FakePixelAcquirer()
    let warmAcquirer = FakeWarmAcquirer()
    let warmBroker = AOSDesktopPixelBroker(
        acquirer: warmSnapshotAcquirer,
        warmAcquirer: warmAcquirer
    )
    var warmLease: AOSDesktopPixelWarmLease?
    _ = warmBroker.prepareWarm(pixelRequest, ownerID: "scene-owner") { result in
        warmLease = try? result.get()
    }
    require(warmLease != nil, "warm broker did not return its prepared lease")
    require(warmAcquirer.openCount == 1, "warm broker opened duplicate sources")
    var warmBusyResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = warmBroker.snapshot(pixelRequest) { warmBusyResult = $0 }
    if case .failure(let error) = warmBusyResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "warm lease did not exclude competing snapshots"
        )
    } else {
        require(false, "snapshot overlapped an active warm lease")
    }
    require(
        warmSnapshotAcquirer.captureCount == 0,
        "busy warm snapshot reached native acquisition"
    )
    var wrongOwnerResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = warmBroker.freezeWarm(
        leaseID: warmLease!.id,
        ownerID: "other-owner",
        maximumAge: 0.5
    ) { wrongOwnerResult = $0 }
    if case .failure(let error) = wrongOwnerResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .leaseNotFound,
            "warm lease accepted a different owner"
        )
    } else {
        require(false, "warm lease ownership failed open")
    }
    require(warmAcquirer.source.freezeCount == 0, "wrong owner reached warm pixels")

    let freezeSettled = DispatchSemaphore(value: 0)
    var freezeResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = warmBroker.freezeWarm(
        leaseID: warmLease!.id,
        ownerID: "scene-owner",
        maximumAge: 0.5
    ) {
        freezeResult = $0
        freezeSettled.signal()
    }
    require(
        freezeSettled.wait(timeout: .now() + 1) == .success,
        "warm freeze did not settle"
    )
    if case .failure(let error) = freezeResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .captureFailed,
            "warm freeze changed its native failure"
        )
    } else {
        require(false, "fake warm freeze unexpectedly succeeded")
    }
    require(warmAcquirer.source.freezeCount == 1, "warm freeze was not singular")
    require(
        warmBroker.releaseWarm(
            leaseID: warmLease!.id,
            ownerID: "scene-owner"
        ),
        "warm lease release failed"
    )
    require(warmAcquirer.canceled == 1, "warm startup handle was retained")
    require(warmAcquirer.source.canceled == 1, "warm source was retained")
    require(
        !warmBroker.releaseWarm(
            leaseID: warmLease!.id,
            ownerID: "scene-owner"
        ),
        "warm lease release was not idempotent"
    )

    let releasedFreezeSource = FakeWarmSource(failure: nil)
    releasedFreezeSource.freezeEntered = DispatchSemaphore(value: 0)
    releasedFreezeSource.freezeRelease = DispatchSemaphore(value: 0)
    let releasedFreezeBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: FakeWarmAcquirer(source: releasedFreezeSource)
    )
    var releasedFreezeLease: AOSDesktopPixelWarmLease?
    _ = releasedFreezeBroker.prepareWarm(
        pixelRequest,
        ownerID: "released-freeze-owner"
    ) { releasedFreezeLease = try? $0.get() }
    let releasedFreezeSettled = DispatchSemaphore(value: 0)
    let releasedFreezeLock = NSLock()
    var releasedFreezeCompletions = 0
    var releasedFreezeFailure: AOSDesktopFrameCaptureFailure?
    _ = releasedFreezeBroker.freezeWarm(
        leaseID: releasedFreezeLease!.id,
        ownerID: "released-freeze-owner",
        maximumAge: 0.5
    ) { result in
        releasedFreezeLock.lock()
        releasedFreezeCompletions += 1
        if case .failure(let error) = result {
            releasedFreezeFailure = error as? AOSDesktopFrameCaptureFailure
        }
        releasedFreezeLock.unlock()
        releasedFreezeSettled.signal()
    }
    require(
        releasedFreezeSource.freezeEntered?.wait(timeout: .now() + 1) == .success,
        "release regression did not enter the in-flight freeze"
    )
    require(
        releasedFreezeBroker.releaseWarm(
            leaseID: releasedFreezeLease!.id,
            ownerID: "released-freeze-owner"
        ),
        "release regression did not retire the warm source"
    )
    require(
        releasedFreezeSettled.wait(timeout: .now() + 1) == .success,
        "warm-source release did not settle its in-flight freeze"
    )
    releasedFreezeLock.lock()
    let releasedFailure = releasedFreezeFailure
    releasedFreezeLock.unlock()
    require(
        releasedFailure == .frameNotReady,
        "warm-source release changed the superseded freeze failure"
    )
    releasedFreezeSource.freezeRelease?.signal()
    Thread.sleep(forTimeInterval: 0.03)
    releasedFreezeLock.lock()
    let releaseCompletionCount = releasedFreezeCompletions
    releasedFreezeLock.unlock()
    require(
        releaseCompletionCount == 1,
        "late warm freeze settled twice after source release"
    )

    let shutdownFreezeSource = FakeWarmSource(failure: nil)
    shutdownFreezeSource.freezeEntered = DispatchSemaphore(value: 0)
    shutdownFreezeSource.freezeRelease = DispatchSemaphore(value: 0)
    let shutdownFreezeBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: FakeWarmAcquirer(source: shutdownFreezeSource)
    )
    var shutdownFreezeLease: AOSDesktopPixelWarmLease?
    _ = shutdownFreezeBroker.prepareWarm(
        pixelRequest,
        ownerID: "shutdown-freeze-owner"
    ) { shutdownFreezeLease = try? $0.get() }
    let shutdownFreezeSettled = DispatchSemaphore(value: 0)
    var shutdownFreezeFailure: AOSDesktopFrameCaptureFailure?
    _ = shutdownFreezeBroker.freezeWarm(
        leaseID: shutdownFreezeLease!.id,
        ownerID: "shutdown-freeze-owner",
        maximumAge: 0.5
    ) { result in
        if case .failure(let error) = result {
            shutdownFreezeFailure = error as? AOSDesktopFrameCaptureFailure
        }
        shutdownFreezeSettled.signal()
    }
    require(
        shutdownFreezeSource.freezeEntered?.wait(timeout: .now() + 1) == .success,
        "shutdown regression did not enter the in-flight freeze"
    )
    shutdownFreezeBroker.shutdown()
    require(
        shutdownFreezeSettled.wait(timeout: .now() + 1) == .success,
        "broker shutdown did not settle its in-flight warm freeze"
    )
    require(
        shutdownFreezeFailure == .unauthorized,
        "broker shutdown changed the in-flight freeze failure"
    )
    shutdownFreezeSource.freezeRelease?.signal()

    let consentOwner = UUID(
        uuidString: "33333333-3333-4333-8333-333333333333"
    )!
    let snapshotConsentAcquirer = FakePixelAcquirer()
    let snapshotConsentWarmSource = FakeWarmSource(failure: nil)
    let snapshotConsentWarmAcquirer = FakeWarmAcquirer(
        source: snapshotConsentWarmSource
    )
    let snapshotConsentBroker = AOSDesktopPixelBroker(
        acquirer: snapshotConsentAcquirer,
        warmAcquirer: snapshotConsentWarmAcquirer
    )
    let snapshotConsent = AOSDesktopFrameCaptureConsentController(
        capturer: AOSNativeDesktopFrameCapturer(
            broker: snapshotConsentBroker,
            strategy: .snapshot
        ),
        mainDisplayID: { 42 },
        requestPermission: { completion in
            completion(true)
            return AOSDesktopFrameCancellation()
        },
        scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
    )
    let snapshotConsentSettled = DispatchSemaphore(value: 0)
    var snapshotConsentStatus: String?
    snapshotConsent.prime(owner: consentOwner) {
        snapshotConsentStatus = $0.status.rawValue
        snapshotConsentSettled.signal()
    }
    require(
        snapshotConsentAcquirer.captureCount == 1
            && snapshotConsentAcquirer.pending.count == 1,
        "explicit consent did not use one bounded snapshot"
    )
    var warmBeforeConsent: Result<AOSDesktopPixelWarmLease, Error>?
    _ = snapshotConsentBroker.prepareWarm(
        pixelRequest,
        ownerID: "snapshot-consent-runtime"
    ) { warmBeforeConsent = $0 }
    if case .failure(let error) = warmBeforeConsent {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "runtime warm admission changed its active-consent failure"
        )
    } else {
        require(false, "runtime warm admission overlapped consent capture")
    }
    require(
        snapshotConsentWarmAcquirer.openCount == 0,
        "runtime warm source opened before consent capture settled"
    )
    let snapshotCapturedAt = Date()
    snapshotConsentAcquirer.pending[0](.success(AOSDesktopPixelFrameSet(
        capturedAt: snapshotCapturedAt,
        durationMilliseconds: 1,
        frames: [AOSDesktopPixelFrame(
            capturedAt: snapshotCapturedAt,
            displayID: 42,
            image: onePixelImage()
        )]
    )))
    require(
        snapshotConsentSettled.wait(timeout: .now() + 1) == .success,
        "snapshot consent probe did not settle"
    )
    require(
        snapshotConsentStatus == "ready"
            && snapshotConsent.snapshot().status == .ready,
        "snapshot consent probe did not authorize direct capture"
    )
    var runtimeWarmLease: AOSDesktopPixelWarmLease?
    _ = snapshotConsentBroker.prepareWarm(
        pixelRequest,
        ownerID: "snapshot-consent-runtime"
    ) { runtimeWarmLease = try? $0.get() }
    require(
        runtimeWarmLease != nil && snapshotConsentWarmAcquirer.openCount == 1,
        "settled consent snapshot did not admit the runtime warm source"
    )
    require(
        snapshotConsentBroker.releaseWarm(
            leaseID: runtimeWarmLease!.id,
            ownerID: "snapshot-consent-runtime"
        ),
        "snapshot-to-warm handoff did not release its runtime lease"
    )

    let delayedStopSource = FakeWarmSource()
    delayedStopSource.completesStopImmediately = false
    let delayedStopAcquirer = FakeWarmAcquirer(source: delayedStopSource)
    let postStopSnapshotAcquirer = FakePixelAcquirer()
    let delayedStopBroker = AOSDesktopPixelBroker(
        acquirer: postStopSnapshotAcquirer,
        warmAcquirer: delayedStopAcquirer
    )
    var delayedStopLease: AOSDesktopPixelWarmLease?
    _ = delayedStopBroker.prepareWarm(
        pixelRequest,
        ownerID: "delayed-stop-owner"
    ) { delayedStopLease = try? $0.get() }
    require(
        delayedStopBroker.releaseWarm(
            leaseID: delayedStopLease!.id,
            ownerID: "delayed-stop-owner"
        ),
        "delayed warm source was not released"
    )
    var overlapAfterRelease: Result<AOSDesktopPixelFrameSet, Error>?
    _ = delayedStopBroker.snapshot(pixelRequest) { overlapAfterRelease = $0 }
    if case .failure(let error) = overlapAfterRelease {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "retiring warm source did not hold the broker closed"
        )
    } else {
        require(false, "new capture overlapped asynchronous stream retirement")
    }
    require(
        postStopSnapshotAcquirer.captureCount == 0,
        "retiring stream allowed native acquisition"
    )
    delayedStopSource.stopCompletion?(.success(()))
    let postStopCapture = delayedStopBroker.snapshot(pixelRequest) { _ in }
    require(
        postStopSnapshotAcquirer.captureCount == 1,
        "broker did not reopen after stream retirement"
    )
    postStopCapture.cancel()

    let failedStopSource = FakeWarmSource()
    failedStopSource.stopResult = .failure(
        AOSDesktopFrameCaptureFailure.captureFailed
    )
    let failedStopBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: FakeWarmAcquirer(source: failedStopSource)
    )
    var failedStopLease: AOSDesktopPixelWarmLease?
    _ = failedStopBroker.prepareWarm(
        pixelRequest,
        ownerID: "failed-stop-owner"
    ) { failedStopLease = try? $0.get() }
    require(
        failedStopBroker.releaseWarm(
            leaseID: failedStopLease!.id,
            ownerID: "failed-stop-owner"
        ),
        "failed-stop warm source was not released"
    )
    var postFailureResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = failedStopBroker.snapshot(pixelRequest) { postFailureResult = $0 }
    if case .failure(let error) = postFailureResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .retirementUncertain,
            "failed stream retirement did not fault the broker"
        )
    } else {
        require(false, "failed stream retirement reopened the broker")
    }

    let stalledPixelAcquirer = FakePixelAcquirer()
    let stalledBroker = AOSDesktopPixelBroker(
        acquirer: stalledPixelAcquirer,
        retirementTimeout: 0.02
    )
    let stalledCapture = stalledBroker.snapshot(pixelRequest) { _ in
        require(false, "stalled canceled capture escaped the broker")
    }
    stalledCapture.cancel()
    Thread.sleep(forTimeInterval: 0.05)
    var postTimeoutResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = stalledBroker.snapshot(pixelRequest) { postTimeoutResult = $0 }
    if case .failure(let error) = postTimeoutResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .retirementUncertain,
            "stalled retirement did not fault after its deadline"
        )
    } else {
        require(false, "stalled retirement held or reopened the broker")
    }

    let stalledWarmAcquirer = StalledWarmAcquirer()
    let stalledWarmBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: stalledWarmAcquirer,
        retirementTimeout: 0.02
    )
    let stalledWarmStartup = stalledWarmBroker.prepareWarm(
        pixelRequest,
        ownerID: "stalled-warm-owner"
    ) { _ in
        require(false, "stalled canceled warm startup escaped the broker")
    }
    stalledWarmStartup.cancel()
    require(
        stalledWarmAcquirer.canceled == 1,
        "stalled warm startup was not canceled"
    )
    Thread.sleep(forTimeInterval: 0.05)
    var postWarmTimeoutResult: Result<AOSDesktopPixelFrameSet, Error>?
    _ = stalledWarmBroker.snapshot(pixelRequest) {
        postWarmTimeoutResult = $0
    }
    if case .failure(let error) = postWarmTimeoutResult {
        require(
            error as? AOSDesktopFrameCaptureFailure == .retirementUncertain,
            "stalled warm retirement did not fault after its deadline"
        )
    } else {
        require(false, "stalled warm retirement held or reopened the broker")
    }
}
