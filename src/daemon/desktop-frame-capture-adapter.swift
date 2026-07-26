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
    private let broker: AOSDesktopPixelBroker
    private let completion: (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    private var completed = false
    private var freeze: AOSDesktopFrameCancelling = AOSDesktopFrameCancellation()
    private var lease: AOSDesktopPixelWarmLease?
    private let lock = NSLock()
    private let ownerID = "desktop-frame-\(UUID().uuidString.lowercased())"
    private let request: AOSDesktopPixelSnapshotRequest
    private let startedAt = Date()
    private var startup: AOSDesktopFrameCancelling = AOSDesktopFrameCancellation()

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
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        let startup = startup
        let freeze = freeze
        let lease = lease
        lock.unlock()
        startup.cancel()
        freeze.cancel()
        if let lease {
            _ = broker.releaseWarm(leaseID: lease.id, ownerID: ownerID)
        }
    }

    private func prepared(
        _ result: Result<AOSDesktopPixelWarmLease, Error>
    ) {
        switch result {
        case .failure(let error):
            finish(.failure(error))
        case .success(let lease):
            lock.lock()
            guard !completed else {
                lock.unlock()
                _ = broker.releaseWarm(leaseID: lease.id, ownerID: ownerID)
                return
            }
            self.lease = lease
            lock.unlock()
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
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        let lease = lease
        lock.unlock()
        if let lease {
            _ = broker.releaseWarm(leaseID: lease.id, ownerID: ownerID)
        }
        completion(result)
    }

    private func installStartup(_ operation: AOSDesktopFrameCancelling) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            operation.cancel()
            return
        }
        startup = operation
        lock.unlock()
    }

    private func installFreeze(_ operation: AOSDesktopFrameCancelling) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            operation.cancel()
            return
        }
        freeze = operation
        lock.unlock()
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
            return AOSDesktopFrameCancellation { operation.cancel() }
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
