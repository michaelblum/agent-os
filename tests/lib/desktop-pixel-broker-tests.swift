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
    var canceled = 0
    var completesStopImmediately = true
    let failure: AOSDesktopFrameCaptureFailure?
    var freezeCount = 0
    var stopCompletion: ((Result<Void, Error>) -> Void)?
    var stopResult: Result<Void, Error> = .success(())

    init(failure: AOSDesktopFrameCaptureFailure? = .captureFailed) {
        self.failure = failure
    }

    func freeze(maximumAge: TimeInterval) throws -> AOSDesktopPixelFrameSet {
        freezeCount += 1
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

    let successfulWarmSource = FakeWarmSource(failure: nil)
    let successfulWarmAcquirer = FakeWarmAcquirer(source: successfulWarmSource)
    let warmCaptureBroker = AOSDesktopPixelBroker(
        acquirer: FakePixelAcquirer(),
        warmAcquirer: successfulWarmAcquirer
    )
    let warmCapturer = AOSNativeDesktopFrameCapturer(
        broker: warmCaptureBroker,
        strategy: .warmSnapshot
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
