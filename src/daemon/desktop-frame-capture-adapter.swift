import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

private func aosDesktopFrameEncodedJPEG(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        data as CFMutableData,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    let properties = [
        kCGImageDestinationLossyCompressionQuality: 0.82,
    ] as CFDictionary
    CGImageDestinationAddImage(destination, image, properties)
    guard CGImageDestinationFinalize(destination) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    return data as Data
}

enum AOSDesktopFrameCaptureStrategy {
    case snapshot
    case warmSnapshot
}

private final class AOSDesktopFrameWarmSnapshotOperation {
    private enum RetirementAction {
        case lease(AOSDesktopPixelWarmLease)
        case startup(AOSDesktopFrameCancelling)
    }

    private let broker: AOSDesktopPixelBroker
    private var cancelRequested = false
    private var cancellationWaiters: [(Result<Void, Error>) -> Void] = []
    private let completion: (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    private var deliveryCompleted = false
    private var freeze: AOSDesktopFrameCancelling = AOSDesktopFrameCancellation()
    private var lease: AOSDesktopPixelWarmLease?
    private let lock = NSLock()
    private let ownerID = "desktop-frame-\(UUID().uuidString.lowercased())"
    private var pendingResult: Result<AOSDesktopFrameCaptureSetResult, Error>?
    private let request: AOSDesktopPixelSnapshotRequest
    private var retirementResult: Result<Void, Error>?
    private var retirementStarted = false
    private let startedAt = Date()
    private var startup: AOSDesktopFrameCancelling?

    init(
        broker: AOSDesktopPixelBroker,
        request: AOSDesktopPixelSnapshotRequest,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) {
        self.broker = broker
        self.request = request
        self.completion = completion
    }

    func start() {
        let operation = broker.prepareWarm(
            request,
            ownerID: ownerID
        ) { [weak self] result in
            self?.prepared(result)
        }
        installStartup(operation)
    }

    func cancel() {
        cancelAndAwaitRetirement { _ in }
    }

    func cancelAndAwaitRetirement(
        _ completion: @escaping (Result<Void, Error>) -> Void
    ) {
        lock.lock()
        if let retirementResult {
            lock.unlock()
            completion(retirementResult)
            return
        }
        cancelRequested = true
        cancellationWaiters.append(completion)
        let freeze = freeze
        let action = takeRetirementActionLocked()
        lock.unlock()
        freeze.cancel()
        performRetirement(action)
    }

    private func prepared(
        _ result: Result<AOSDesktopPixelWarmLease, Error>
    ) {
        switch result {
        case .failure(let error):
            finish(.failure(error))
        case .success(let lease):
            lock.lock()
            self.lease = lease
            let action = cancelRequested ? takeRetirementActionLocked() : nil
            let shouldFreeze = !cancelRequested && !deliveryCompleted
            lock.unlock()
            if let action {
                performRetirement(action)
                return
            }
            guard shouldFreeze else { return }
            let operation = broker.freezeWarm(
                leaseID: lease.id,
                ownerID: ownerID,
                maximumAge: 0.5
            ) { [weak self] result in
                self?.frozen(result)
            }
            installFreeze(operation)
        }
    }

    private func frozen(_ result: Result<AOSDesktopPixelFrameSet, Error>) {
        let encoded = result.flatMap { frameSet in
            Result {
                AOSDesktopFrameCaptureSetResult(
                    capturedAt: frameSet.capturedAt,
                    durationMilliseconds: max(
                        0,
                        Int(Date().timeIntervalSince(startedAt) * 1_000)
                    ),
                    frames: try frameSet.frames.map { frame in
                        try autoreleasepool {
                            AOSDesktopFrameCaptureResult(
                                data: try aosDesktopFrameEncodedJPEG(frame.image),
                                displayID: frame.displayID,
                                height: frame.height,
                                mimeType: "image/jpeg",
                                width: frame.width
                            )
                        }
                    }
                )
            }
        }
        finish(encoded)
    }

    private func finish(
        _ result: Result<AOSDesktopFrameCaptureSetResult, Error>
    ) {
        lock.lock()
        guard !deliveryCompleted, pendingResult == nil else {
            lock.unlock()
            return
        }
        pendingResult = result
        let action = takeRetirementActionLocked()
        let shouldDeliver = !cancelRequested
        if shouldDeliver { deliveryCompleted = true }
        lock.unlock()
        performRetirement(action)
        if shouldDeliver { completion(result) }
    }

    private func retire(_ result: Result<Void, Error>) {
        lock.lock()
        guard retirementResult == nil else {
            lock.unlock()
            return
        }
        retirementResult = result
        let waiters = cancellationWaiters
        cancellationWaiters = []
        lock.unlock()
        waiters.forEach { $0(result) }
    }

    private func installStartup(_ operation: AOSDesktopFrameCancelling) {
        lock.lock()
        if retirementResult != nil {
            lock.unlock()
            operation.cancel()
            return
        }
        startup = operation
        let action = (cancelRequested || pendingResult != nil)
            ? takeRetirementActionLocked()
            : nil
        lock.unlock()
        performRetirement(action)
    }

    private func installFreeze(_ operation: AOSDesktopFrameCancelling) {
        lock.lock()
        guard !cancelRequested, !deliveryCompleted, !retirementStarted else {
            lock.unlock()
            operation.cancel()
            return
        }
        freeze = operation
        lock.unlock()
    }

    private func takeRetirementActionLocked() -> RetirementAction? {
        guard !retirementStarted else { return nil }
        if let lease {
            retirementStarted = true
            return .lease(lease)
        }
        if let startup {
            retirementStarted = true
            return .startup(startup)
        }
        return nil
    }

    private func performRetirement(_ action: RetirementAction?) {
        guard let action else { return }
        switch action {
        case .lease(let lease):
            let released = broker.releaseWarm(
                leaseID: lease.id,
                ownerID: ownerID,
                completion: retire
            )
            if !released {
                retire(.failure(AOSDesktopFrameCaptureFailure.leaseNotFound))
            }
        case .startup(let startup):
            if let retiring = startup as? AOSDesktopFrameRetirementAwaiting {
                retiring.cancelAndAwaitRetirement(retire)
            } else {
                startup.cancel()
                retire(.success(()))
            }
        }
    }
}

final class AOSNativeDesktopFrameCapturer: AOSDesktopFrameCapturing {
    private let broker: AOSDesktopPixelBroker
    private let strategy: AOSDesktopFrameCaptureStrategy

    init(
        broker: AOSDesktopPixelBroker = AOSDesktopPixelBroker(),
        strategy: AOSDesktopFrameCaptureStrategy = .snapshot
    ) {
        self.broker = broker
        self.strategy = strategy
    }

    @discardableResult
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        let request = AOSDesktopPixelSnapshotRequest(
            displayIDs: displayIDs,
            excludingWindowIDs: excludingWindowIDs,
            maximumPixelsPerDisplay: maximumPixelsPerDisplay
        )
        if strategy == .warmSnapshot {
            let operation = AOSDesktopFrameWarmSnapshotOperation(
                broker: broker,
                request: request,
                completion: completion
            )
            operation.start()
            return AOSDesktopFrameRetirementCancellation { completion in
                operation.cancelAndAwaitRetirement(completion)
            }
        }
        return broker.snapshot(request) { result in
            completion(result.flatMap { frameSet in
                Result {
                    AOSDesktopFrameCaptureSetResult(
                        capturedAt: frameSet.capturedAt,
                        durationMilliseconds: frameSet.durationMilliseconds,
                        frames: try frameSet.frames.map { frame in
                            try autoreleasepool {
                                AOSDesktopFrameCaptureResult(
                                    data: try aosDesktopFrameEncodedJPEG(frame.image),
                                    displayID: frame.displayID,
                                    height: frame.height,
                                    mimeType: "image/jpeg",
                                    width: frame.width
                                )
                            }
                        }
                    )
                }
            })
        }
    }
}
