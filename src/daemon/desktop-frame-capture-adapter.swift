import AppKit
import CoreImage
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

private let aosDesktopFrameImageContext = CIContext(options: [
    .cacheIntermediates: false,
])

private func aosDesktopFrameImage(_ frame: AOSDesktopPixelFrame) throws -> CGImage {
    if let image = frame.image { return image }
    guard let pixelBuffer = frame.pixelBuffer else {
        throw AOSDesktopFrameCaptureFailure.frameNotReady
    }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard let rendered = aosDesktopFrameImageContext.createCGImage(
        image,
        from: CGRect(x: 0, y: 0, width: width, height: height)
    ) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    return rendered
}

private func aosDesktopFrameCaptureSetResult(
    _ frameSet: AOSDesktopPixelFrameSet,
    startedAt: Date
) throws -> AOSDesktopFrameCaptureSetResult {
    AOSDesktopFrameCaptureSetResult(
        capturedAt: frameSet.capturedAt,
        durationMilliseconds: max(
            0,
            Int(Date().timeIntervalSince(startedAt) * 1_000)
        ),
        frames: try frameSet.frames.map { frame in
            try autoreleasepool {
                AOSDesktopFrameCaptureResult(
                    data: try aosDesktopFrameEncodedJPEG(try aosDesktopFrameImage(frame)),
                    displayID: frame.displayID,
                    height: frame.height,
                    mimeType: "image/jpeg",
                    width: frame.width
                )
            }
        }
    )
}

enum AOSDesktopFrameCaptureStrategy {
    case prewarmedSnapshot
    case snapshot
}

final class AOSNativeDesktopFrameCapturer:
    AOSDesktopFrameCapturing,
    AOSDesktopFrameRuntimeCapturing,
    AOSDesktopPixelFrameSetCapturing
{
    private let broker: AOSDesktopPixelBroker
    private let strategy: AOSDesktopFrameCaptureStrategy
    private let warmPool: AOSDesktopFrameWarmPool

    init(
        broker: AOSDesktopPixelBroker = AOSDesktopPixelBroker(),
        strategy: AOSDesktopFrameCaptureStrategy = .snapshot
    ) {
        self.broker = broker
        self.strategy = strategy
        self.warmPool = AOSDesktopFrameWarmPool(broker: broker)
    }

    func reconcileWarm(_ configuration: AOSDesktopFrameWarmConfiguration?) {
        guard strategy == .prewarmedSnapshot else { return }
        warmPool.reconcileWarm(configuration)
    }

    func warmStatus() -> AOSDesktopFrameWarmStatus {
        warmPool.warmStatus()
    }

    func setWarmStatusObserver(
        _ observer: ((AOSDesktopFrameWarmStatus) -> Void)?
    ) {
        warmPool.setWarmStatusObserver(observer)
    }

    @discardableResult
    func capturePrewarmedFrames(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopPixelFrameSet, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        guard strategy == .prewarmedSnapshot else {
            completion(.failure(AOSDesktopFrameCaptureFailure.frameNotReady))
            return AOSDesktopFrameCancellation()
        }
        let admission = warmPool.freeze(configuration, completion: completion)
        switch admission {
        case .admitted(let operation):
            return operation
        case .notConfigured, .unavailable:
            let failure: AOSDesktopFrameCaptureFailure
            if case .unavailable(let observed) = admission {
                failure = observed
            } else {
                failure = .frameNotReady
            }
            completion(.failure(failure))
            return AOSDesktopFrameCancellation()
        }
    }

    @discardableResult
    func capturePrewarmed(
        _ configuration: AOSDesktopFrameWarmConfiguration,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) -> AOSDesktopFrameCancelling {
        let startedAt = Date()
        return capturePrewarmedFrames(configuration) { result in
            completion(result.flatMap { frameSet in
                Result {
                    try aosDesktopFrameCaptureSetResult(
                        frameSet,
                        startedAt: startedAt
                    )
                }
            })
        }
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
        if strategy == .prewarmedSnapshot {
            completion(.failure(AOSDesktopFrameCaptureFailure.frameNotReady))
            return AOSDesktopFrameCancellation()
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
                                    data: try aosDesktopFrameEncodedJPEG(try aosDesktopFrameImage(frame)),
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
