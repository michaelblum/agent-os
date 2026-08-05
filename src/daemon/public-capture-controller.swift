import Foundation
import ImageIO
import UniformTypeIdentifiers

private struct AOSPublicCaptureWireRequest {
    let captureID: String
    let request: AOSDesktopPixelSnapshotRequest
    let topologyIdentity: String

    init(payload: [String: Any]) throws {
        guard let captureID = payload["capture_id"] as? String,
              UUID(uuidString: captureID) != nil,
              let topologyIdentity = payload["topology_identity"] as? String,
              topologyIdentity.range(
                of: #"^sha256:[a-f0-9]{64}$"#,
                options: .regularExpression
              ) != nil,
              let rawDisplays = payload["displays"] as? [[String: Any]],
              !rawDisplays.isEmpty,
              rawDisplays.count <= AOSDesktopPixelLimits.maximumDisplayCount,
              let rawSelected = payload["display_ids"] as? [NSNumber],
              !rawSelected.isEmpty,
              let maximumPixels = payload["maximum_pixels_per_display"] as? NSNumber,
              let showsCursor = payload["shows_cursor"] as? Bool,
              let rawExcluded = payload["excluded_window_ids"] as? [NSNumber],
              let rawWindows = payload["window_targets"] as? [[String: Any]] else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        var geometries: [AOSDesktopWorldDisplayGeometry] = []
        for item in rawDisplays {
            guard let displayID = (item["display_id"] as? NSNumber)?.uint32Value,
                  let index = (item["index"] as? NSNumber)?.intValue,
                  let native = item["native_bounds"] as? [NSNumber], native.count == 4,
                  let desktop = item["desktop_world_bounds"] as? [NSNumber], desktop.count == 4,
                  let scale = (item["scale_factor"] as? NSNumber)?.doubleValue,
                  let geometry = AOSDesktopWorldDisplayGeometry(
                    displayID: displayID,
                    index: index,
                    desktopWorldBounds: CGRect(
                        x: desktop[0].doubleValue,
                        y: desktop[1].doubleValue,
                        width: desktop[2].doubleValue,
                        height: desktop[3].doubleValue
                    ),
                    nativePointBounds: CGRect(
                        x: native[0].doubleValue,
                        y: native[1].doubleValue,
                        width: native[2].doubleValue,
                        height: native[3].doubleValue
                    ),
                    pointPixelScale: scale
                  ) else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            geometries.append(geometry)
        }
        guard let layout = AOSDesktopWorldDisplayLayout(displays: geometries) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        let selected = rawSelected.map(\.uint32Value)
        guard layout.matches(displayIDs: selected) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        var windowIDsByDisplay: [UInt32: Int] = [:]
        for target in rawWindows {
            guard let displayID = (target["display_id"] as? NSNumber)?.uint32Value,
                  let windowID = (target["window_id"] as? NSNumber)?.intValue,
                  windowIDsByDisplay.updateValue(windowID, forKey: displayID) == nil else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        }
        self.captureID = captureID.lowercased()
        self.topologyIdentity = topologyIdentity
        request = AOSDesktopPixelSnapshotRequest(
            displayIDs: selected,
            displayLayout: layout,
            excludingWindowIDs: rawExcluded.map(\.intValue),
            maximumPixelsPerDisplay: maximumPixels.intValue,
            sizingPolicy: .exactWithinBudget,
            capturePolicy: .publicExplicitExclusions,
            showsCursor: showsCursor,
            windowIDsByDisplay: windowIDsByDisplay
        )
        guard aosDesktopPixelRequestIsValid(request) else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
    }
}

private func aosPublicCapturePNG(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        data as CFMutableData,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw AOSDesktopFrameCaptureFailure.captureFailed
    }
    return data as Data
}

private final class AOSPublicCaptureOperation: AOSDesktopFrameCancelling {
    private let lock = NSLock()
    private var native: AOSDesktopFrameCancelling?
    private var canceled = false

    func install(_ native: AOSDesktopFrameCancelling) {
        lock.lock()
        self.native = native
        let canceled = self.canceled
        lock.unlock()
        if canceled { native.cancel() }
    }

    func cancel() {
        lock.lock()
        canceled = true
        let native = self.native
        lock.unlock()
        native?.cancel()
    }

    var isCanceled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return canceled
    }
}

final class AOSPublicCaptureController {
    typealias ChunkEmitter = (_ data: [String: Any]) -> Bool

    private let capturer: AOSNativeDesktopFrameCapturer

    init(capturer: AOSNativeDesktopFrameCapturer) {
        self.capturer = capturer
    }

    @discardableResult
    func capture(
        payload: [String: Any],
        emitChunk: @escaping ChunkEmitter,
        completion: @escaping ([String: Any]) -> Void
    ) -> AOSDesktopFrameCancelling {
        let wire: AOSPublicCaptureWireRequest
        do {
            wire = try AOSPublicCaptureWireRequest(payload: payload)
        } catch {
            DispatchQueue.global(qos: .userInitiated).async {
                completion([
                    "error": "Capture request is invalid",
                    "code": "INVALID_ARG",
                ])
            }
            return AOSDesktopFrameCancellation()
        }
        let operation = AOSPublicCaptureOperation()
        let native = capturer.captureExclusiveStill(wire.request) { result in
            DispatchQueue.global(qos: .userInitiated).async {
                guard !operation.isCanceled else { return }
                switch result {
                case .failure(let error):
                    let failure = (error as? AOSDesktopFrameCaptureFailure)
                        ?? .captureFailed
                    completion([
                        "error": "Native capture failed",
                        "code": failure.code,
                    ])
                case .success(let frameSet):
                    do {
                        let response = try self.stream(
                            frameSet,
                            wire: wire,
                            operation: operation,
                            emitChunk: emitChunk
                        )
                        if !operation.isCanceled { completion(response) }
                    } catch let failure as AOSDesktopFrameCaptureFailure {
                        if !operation.isCanceled {
                            completion([
                                "error": "Capture transfer failed",
                                "code": failure.code,
                            ])
                        }
                    } catch {
                        if !operation.isCanceled {
                            completion([
                                "error": "Capture transfer failed",
                                "code": AOSDesktopFrameCaptureFailure.captureFailed.code,
                            ])
                        }
                    }
                }
            }
        }
        operation.install(native)
        return operation
    }

    private func stream(
        _ frameSet: AOSDesktopPixelFrameSet,
        wire: AOSPublicCaptureWireRequest,
        operation: AOSPublicCaptureOperation,
        emitChunk: ChunkEmitter
    ) throws -> [String: Any] {
        guard frameSet.frames.count == wire.request.displayIDs.count else {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        var byID: [UInt32: AOSDesktopPixelFrame] = [:]
        for frame in frameSet.frames {
            guard byID.updateValue(frame, forKey: frame.displayID) == nil else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
        }
        var metadata: [[String: Any]] = []
        for (frameIndex, displayID) in wire.request.displayIDs.enumerated() {
            guard !operation.isCanceled,
                  let frame = byID[displayID],
                  let image = frame.image else {
                throw AOSDesktopFrameCaptureFailure.captureFailed
            }
            let encoded = try autoreleasepool { try aosPublicCapturePNG(image) }
            let transfer = try aosStreamPublicCaptureData(
                encoded,
                captureID: wire.captureID,
                topologyIdentity: wire.topologyIdentity,
                displayID: displayID,
                frameIndex: frameIndex,
                emitChunk: { data in
                    !operation.isCanceled && emitChunk(data)
                }
            )
            metadata.append([
                "display_id": NSNumber(value: displayID),
                "frame_index": frameIndex,
                "chunk_count": transfer.chunkCount,
                "byte_count": transfer.byteCount,
                "sha256": transfer.sha256,
                "width": frame.width,
                "height": frame.height,
            ])
        }
        return [
            "status": "ok",
            "capture_id": wire.captureID,
            "topology_identity": wire.topologyIdentity,
            "frames": metadata,
        ]
    }
}
