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

final class BlockingFirstWarmAcquirer: AOSDesktopPixelWarmAcquiring {
    private let lock = NSLock()
    private var storedOpenCount = 0
    let allowFirstReturn = DispatchSemaphore(value: 0)
    let firstEntered = DispatchSemaphore(value: 0)
    let source: FakeWarmSource

    var openCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return storedOpenCount
    }

    init(source: FakeWarmSource) {
        self.source = source
    }

    @discardableResult
    func openWarm(
        _ request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopPixelWarmSource, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        lock.lock()
        storedOpenCount += 1
        let count = storedOpenCount
        lock.unlock()
        if count == 1 {
            firstEntered.signal()
            allowFirstReturn.wait()
        }
        completion(.success(source))
        return AOSDesktopFrameCancellation()
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

    let successfulWarmSource = FakeWarmSource(failure: nil)
    let successfulWarmAcquirer = FakeWarmAcquirer(source: successfulWarmSource)
    let warmCaptureBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: successfulWarmAcquirer
    )
    let warmCapturer = AOSNativeDesktopFrameCapturer(
        broker: warmCaptureBroker,
        strategy: .oneShotWarmSnapshot
    )
    let warmCaptureSettled = DispatchSemaphore(value: 0)
    var warmCaptureResult: Result<AOSDesktopFrameCaptureSetResult, Error>?
    let warmCaptureCancellation = warmCapturer.capture(
        displayIDs: [42],
        excludingWindowIDs: [900],
        maximumPixelsPerDisplay: 4_096
    ) {
        warmCaptureResult = $0
        warmCaptureSettled.signal()
    }
    require(
        warmCaptureSettled.wait(timeout: .now() + 5) == .success,
        "warm frame adapter did not settle"
    )
    let warmCapture = try warmCaptureResult!.get()
    require(warmCapture.frames.count == 1, "warm frame adapter changed display count")
    require(
        warmCapture.frames[0].data.starts(with: [0xff, 0xd8]),
        "warm frame adapter did not encode at the presentation edge"
    )
    require(successfulWarmSource.freezeCount == 1, "warm frame was not frozen once")
    require(successfulWarmSource.canceled == 1, "warm frame source survived delivery")
    require(successfulWarmAcquirer.canceled == 1, "warm startup survived delivery")
    warmCaptureCancellation.cancel()

    let delayedAdapterStopSource = FakeWarmSource(failure: nil)
    delayedAdapterStopSource.completesStopImmediately = false
    let delayedAdapterStopBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: FakeWarmAcquirer(source: delayedAdapterStopSource)
    )
    let delayedAdapterCapturer = AOSNativeDesktopFrameCapturer(
        broker: delayedAdapterStopBroker,
        strategy: .oneShotWarmSnapshot
    )
    let delayedAdapterSettled = DispatchSemaphore(value: 0)
    var delayedAdapterResult: Result<AOSDesktopFrameCaptureSetResult, Error>?
    let delayedAdapterCancellation = delayedAdapterCapturer.capture(
        displayIDs: [42],
        excludingWindowIDs: [],
        maximumPixelsPerDisplay: 4_096
    ) {
        delayedAdapterResult = $0
        delayedAdapterSettled.signal()
    }
    require(
        delayedAdapterSettled.wait(timeout: .now() + 1) == .success,
        "warm adapter withheld the frozen frame during stream retirement"
    )
    if case .some(.success(let capture)) = delayedAdapterResult {
        require(capture.frames.count == 1, "warm adapter lost its early frame")
    } else {
        require(false, "warm adapter failed before stream retirement")
    }
    let stopRequestDeadline = Date().addingTimeInterval(1)
    while delayedAdapterStopSource.stopCompletion == nil,
          Date() < stopRequestDeadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    require(
        delayedAdapterStopSource.stopCompletion != nil,
        "warm adapter did not request stream retirement"
    )
    var overlapDuringAdapterRetirement: Result<AOSDesktopPixelFrameSet, Error>?
    _ = delayedAdapterStopBroker.snapshot(pixelRequest) {
        overlapDuringAdapterRetirement = $0
    }
    if case .failure(let error) = overlapDuringAdapterRetirement {
        require(
            error as? AOSDesktopFrameCaptureFailure == .busy,
            "early frame delivery reopened the broker before retirement"
        )
    } else {
        require(false, "early frame delivery admitted overlapping capture")
    }
    let delayedAdapterRetired = DispatchSemaphore(value: 0)
    var delayedAdapterRetirement: Result<Void, Error>?
    (delayedAdapterCancellation as? AOSDesktopFrameRetirementAwaiting)?
        .cancelAndAwaitRetirement {
            delayedAdapterRetirement = $0
            delayedAdapterRetired.signal()
        }
    require(
        delayedAdapterRetired.wait(timeout: .now() + 0.02) == .timedOut,
        "retirement waiter escaped before native shutdown"
    )
    delayedAdapterStopSource.stopCompletion?(.success(()))
    require(
        delayedAdapterRetired.wait(timeout: .now() + 1) == .success,
        "warm adapter did not acknowledge stream retirement"
    )
    if case .some(.failure) = delayedAdapterRetirement {
        require(false, "successful native shutdown became retirement failure")
    }

    let canceledRetirementSource = FakeWarmSource(failure: nil)
    canceledRetirementSource.completesStopImmediately = false
    canceledRetirementSource.freezeEntered = DispatchSemaphore(value: 0)
    canceledRetirementSource.freezeRelease = DispatchSemaphore(value: 0)
    let canceledRetirementCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: FakeWarmAcquirer(source: canceledRetirementSource)
        ),
        strategy: .oneShotWarmSnapshot
    )
    let canceledRetirementSettled = DispatchSemaphore(value: 0)
    let canceledRetirement = canceledRetirementCapturer.capture(
        displayIDs: [42],
        excludingWindowIDs: [],
        maximumPixelsPerDisplay: 4_096
    ) { _ in
        canceledRetirementSettled.signal()
    }
    require(
        canceledRetirementSource.freezeEntered?.wait(timeout: .now() + 1)
            == .success,
        "cancel regression did not reach the in-flight freeze"
    )
    let canceledRetired = DispatchSemaphore(value: 0)
    (canceledRetirement as? AOSDesktopFrameRetirementAwaiting)?
        .cancelAndAwaitRetirement { _ in canceledRetired.signal() }
    let canceledStopDeadline = Date().addingTimeInterval(1)
    while canceledRetirementSource.stopCompletion == nil,
          Date() < canceledStopDeadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    require(
        canceledRetirementSource.stopCompletion != nil,
        "cancel regression did not reach stream retirement"
    )
    canceledRetirementSource.stopCompletion?(.success(()))
    require(
        canceledRetired.wait(timeout: .now() + 1) == .success,
        "canceled warm capture did not retire"
    )
    canceledRetirementSource.freezeRelease?.signal()
    require(
        canceledRetirementSettled.wait(timeout: .now() + 0.05) == .timedOut,
        "canceled warm retirement delivered a late frame"
    )

    let consentRetirementSource = FakeWarmSource(failure: nil)
    consentRetirementSource.completesStopImmediately = false
    let consentWarmAcquirer = FakeWarmAcquirer(source: consentRetirementSource)
    let consentCapturer = AOSNativeDesktopFrameCapturer(
        broker: AOSDesktopPixelBroker(
            acquirer: FakePixelAcquirer(),
            warmAcquirer: consentWarmAcquirer
        ),
        strategy: .oneShotWarmSnapshot
    )
    let consent = AOSDesktopFrameCaptureConsentController(
        capturer: consentCapturer,
        mainDisplayID: { 42 },
        requestPermission: { completion in
            completion(true)
            return AOSDesktopFrameCancellation()
        },
        scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
    )
    let consentOwner = UUID(
        uuidString: "33333333-3333-4333-8333-333333333333"
    )!
    let consentSettled = DispatchSemaphore(value: 0)
    var consentStatus: String?
    consent.prime(owner: consentOwner) {
        consentStatus = $0.status.rawValue
        consentSettled.signal()
    }
    let consentStopDeadline = Date().addingTimeInterval(1)
    while consentRetirementSource.stopCompletion == nil,
          Date() < consentStopDeadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    require(
        consentRetirementSource.stopCompletion != nil,
        "integrated consent proof did not reach warm retirement"
    )
    require(
        consentSettled.wait(timeout: .now() + 0.02) == .timedOut,
        "consent became ready before broker retirement acknowledgement"
    )
    require(
        consent.snapshot().status != .ready,
        "passive consent status escaped while the probe was retiring"
    )
    require(
        consentWarmAcquirer.openCount == 1,
        "consent probe opened duplicate native capture"
    )
    consentRetirementSource.stopCompletion?(.success(()))
    require(
        consentSettled.wait(timeout: .now() + 1) == .success,
        "consent did not settle after broker retirement acknowledgement"
    )
    require(
        consentStatus == "ready" && consent.snapshot().status == .ready,
        "retired warm probe did not converge to ready"
    )

    let failedConsentSource = FakeWarmSource(failure: nil)
    failedConsentSource.stopResult = .failure(
        AOSDesktopFrameCaptureFailure.captureFailed
    )
    let failedConsent = AOSDesktopFrameCaptureConsentController(
        capturer: AOSNativeDesktopFrameCapturer(
            broker: AOSDesktopPixelBroker(
                acquirer: FakePixelAcquirer(),
                warmAcquirer: FakeWarmAcquirer(source: failedConsentSource)
            ),
            strategy: .oneShotWarmSnapshot
        ),
        mainDisplayID: { 42 },
        requestPermission: { completion in
            completion(true)
            return AOSDesktopFrameCancellation()
        },
        scheduleDeadline: { _, _ in AOSDesktopFrameCancellation() }
    )
    let failedConsentSettled = DispatchSemaphore(value: 0)
    var failedConsentCode: String?
    failedConsent.prime(owner: consentOwner) {
        failedConsentCode = $0.errorCode
        failedConsentSettled.signal()
    }
    require(
        failedConsentSettled.wait(timeout: .now() + 1) == .success,
        "failed native retirement did not settle consent"
    )
    require(
        failedConsentCode == "DESKTOP_FRAME_RETIREMENT_UNCERTAIN",
        "consent became ready after failed native retirement"
    )
    if case .rejected(.consentRequired) = failedConsent.claimRuntimeCapture() {
    } else {
        require(false, "failed probe retirement admitted runtime capture")
    }

    let installRaceSource = FakeWarmSource(failure: nil)
    installRaceSource.completesStopImmediately = false
    installRaceSource.freezeEntered = DispatchSemaphore(value: 0)
    installRaceSource.freezeRelease = DispatchSemaphore(value: 0)
    let installRaceAcquirer = BlockingFirstWarmAcquirer(
        source: installRaceSource
    )
    let installRaceProbeDeadlineReady = DispatchSemaphore(value: 0)
    var installRaceProbeDeadline: (() -> Void)?
    let installRaceConsent = AOSDesktopFrameCaptureConsentController(
        capturer: AOSNativeDesktopFrameCapturer(
            broker: AOSDesktopPixelBroker(
                acquirer: FakePixelAcquirer(),
                warmAcquirer: installRaceAcquirer
            ),
            strategy: .oneShotWarmSnapshot
        ),
        mainDisplayID: { 42 },
        requestPermission: { completion in
            completion(true)
            return AOSDesktopFrameCancellation()
        },
        scheduleDeadline: { delay, action in
            if delay == AOSDesktopFrameCaptureConsentController.probeLifetime {
                installRaceProbeDeadline = action
                installRaceProbeDeadlineReady.signal()
            }
            return AOSDesktopFrameCancellation()
        }
    )
    let installRacePrimeReturned = DispatchSemaphore(value: 0)
    var installRaceTimeoutCode: String?
    DispatchQueue.global(qos: .userInitiated).async {
        installRaceConsent.prime(owner: consentOwner) {
            installRaceTimeoutCode = $0.errorCode
        }
        installRacePrimeReturned.signal()
    }
    require(
        installRaceAcquirer.firstEntered.wait(timeout: .now() + 1) == .success,
        "capture-install race did not block native startup"
    )
    require(
        installRaceProbeDeadlineReady.wait(timeout: .now() + 1) == .success,
        "capture-install race did not schedule its probe deadline"
    )
    installRaceProbeDeadline?()
    require(
        installRaceTimeoutCode == "DESKTOP_FRAME_PROBE_TIMEOUT",
        "capture-install race lost its timeout response"
    )
    var installRaceQuarantinedCode: String?
    installRaceConsent.prime(owner: consentOwner) {
        installRaceQuarantinedCode = $0.errorCode
    }
    require(
        installRaceQuarantinedCode == "DESKTOP_FRAME_PROBE_TIMEOUT",
        "capture-install race admitted a retry before token installation"
    )
    installRaceAcquirer.allowFirstReturn.signal()
    require(
        installRacePrimeReturned.wait(timeout: .now() + 1) == .success,
        "capture-install race did not return its installed token"
    )
    require(
        installRaceSource.freezeEntered?.wait(timeout: .now() + 1) == .success,
        "capture-install race did not begin its frozen frame"
    )
    let installRaceStopDeadline = Date().addingTimeInterval(1)
    while installRaceSource.stopCompletion == nil,
          Date() < installRaceStopDeadline {
        Thread.sleep(forTimeInterval: 0.01)
    }
    require(
        installRaceSource.stopCompletion != nil,
        "quarantined capture was not retired after token installation"
    )
    require(
        installRaceAcquirer.openCount == 1,
        "capture-install race opened overlapping native capture"
    )
    installRaceSource.stopCompletion?(.success(()))
    installRaceSource.stopCompletion = nil
    installRaceSource.completesStopImmediately = true
    installRaceSource.freezeRelease?.signal()
    installRaceSource.freezeEntered = nil
    installRaceSource.freezeRelease = nil
    let installRaceRetrySettled = DispatchSemaphore(value: 0)
    var installRaceRetryStatus: String?
    installRaceConsent.prime(owner: consentOwner) {
        installRaceRetryStatus = $0.status.rawValue
        installRaceRetrySettled.signal()
    }
    require(
        installRaceRetrySettled.wait(timeout: .now() + 1) == .success,
        "capture-install race did not permit a retired explicit retry"
    )
    require(
        installRaceRetryStatus == "ready" && installRaceAcquirer.openCount == 2,
        "capture-install race did not converge through one replacement capture"
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
