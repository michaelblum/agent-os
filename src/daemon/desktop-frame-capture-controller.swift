import AppKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct AOSDesktopFrameCaptureAuthorization: Equatable {
    let canvasID: String
    let canvasGeneration: UInt64
    let extensionReference: AOSSceneExtensionReference
    let ownerID: String
    let resourceID: String
    let topologyGeneration: UInt64
}

struct AOSDesktopFrameCaptureResult {
    let data: Data
    let displayID: UInt32
    let height: Int
    let mimeType: String
    let width: Int
}

struct AOSDesktopFrameCaptureSetResult {
    let capturedAt: Date
    let durationMilliseconds: Int
    let frames: [AOSDesktopFrameCaptureResult]
}

enum AOSDesktopFrameCaptureFailure: Error {
    case busy
    case captureFailed
    case displayNotFound
    case permissionDenied
    case unauthorized
    case unsupported

    var code: String {
        switch self {
        case .busy: return "DESKTOP_FRAME_BUSY"
        case .captureFailed: return "DESKTOP_FRAME_CAPTURE_FAILED"
        case .displayNotFound: return "DESKTOP_FRAME_DISPLAY_NOT_FOUND"
        case .permissionDenied: return "DESKTOP_FRAME_PERMISSION_DENIED"
        case .unauthorized: return "DESKTOP_FRAME_UNAUTHORIZED"
        case .unsupported: return "DESKTOP_FRAME_UNSUPPORTED"
        }
    }
}

protocol AOSDesktopFrameCapturing {
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    )
}

protocol AOSDesktopFrameCanvasProviding: AnyObject {
    func desktopFrameConsumers(canvasID: String) -> [AOSDesktopFrameConsumerIdentity]
    func windowNumbers(forID id: String) -> [Int]
}

extension CanvasManager: AOSDesktopFrameCanvasProviding {}

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

private actor AOSDesktopFrameCaptureActor {
    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int
    ) async throws -> AOSDesktopFrameCaptureSetResult {
        guard #available(macOS 14.0, *) else {
            throw AOSDesktopFrameCaptureFailure.unsupported
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw AOSDesktopFrameCaptureFailure.permissionDenied
        }

        let startedAt = Date()
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
        } catch {
            throw AOSDesktopFrameCaptureFailure.captureFailed
        }
        let requested = Set(displayIDs)
        let displays = content.displays.filter { requested.contains($0.displayID) }
        guard displays.count == requested.count else {
            throw AOSDesktopFrameCaptureFailure.displayNotFound
        }
        let excluded = Set(excludingWindowIDs)
        let windows = content.windows.filter { excluded.contains(Int($0.windowID)) }

        let frames = try await withThrowingTaskGroup(
            of: AOSDesktopFrameCaptureResult.self
        ) { group in
            for display in displays {
                group.addTask { [self] in
                    let sourceWidth = max(1, display.width)
                    let sourceHeight = max(1, display.height)
                    let sourcePixels = sourceWidth * sourceHeight
                    let scale = sourcePixels > maximumPixelsPerDisplay
                        ? sqrt(Double(maximumPixelsPerDisplay) / Double(sourcePixels))
                        : 1
                    let width = max(1, Int((Double(sourceWidth) * scale).rounded(.down)))
                    let height = max(1, Int((Double(sourceHeight) * scale).rounded(.down)))
                    let configuration = SCStreamConfiguration()
                    configuration.width = width
                    configuration.height = height
                    configuration.showsCursor = false
                    configuration.captureResolution = .best
                    let filter = SCContentFilter(display: display, excludingWindows: windows)
                    let image: CGImage
                    do {
                        image = try await SCScreenshotManager.captureImage(
                            contentFilter: filter,
                            configuration: configuration
                        )
                    } catch {
                        throw AOSDesktopFrameCaptureFailure.captureFailed
                    }
                    return AOSDesktopFrameCaptureResult(
                        data: try aosDesktopFrameEncodedJPEG(image),
                        displayID: display.displayID,
                        height: image.height,
                        mimeType: "image/jpeg",
                        width: image.width
                    )
                }
            }
            var results: [AOSDesktopFrameCaptureResult] = []
            for try await frame in group {
                results.append(frame)
            }
            return results.sorted { $0.displayID < $1.displayID }
        }

        return AOSDesktopFrameCaptureSetResult(
            capturedAt: startedAt,
            durationMilliseconds: max(0, Int(Date().timeIntervalSince(startedAt) * 1_000)),
            frames: frames
        )
    }
}

final class AOSNativeDesktopFrameCapturer: AOSDesktopFrameCapturing {
    private let actor = AOSDesktopFrameCaptureActor()

    func capture(
        displayIDs: [UInt32],
        excludingWindowIDs: [Int],
        maximumPixelsPerDisplay: Int,
        completion: @escaping (Result<AOSDesktopFrameCaptureSetResult, Error>) -> Void
    ) {
        Task { @MainActor in
            do {
                completion(.success(try await actor.capture(
                    displayIDs: displayIDs,
                    excludingWindowIDs: excludingWindowIDs,
                    maximumPixelsPerDisplay: maximumPixelsPerDisplay
                )))
            } catch {
                completion(.failure(error))
            }
        }
    }
}

final class AOSDesktopFrameCaptureController {
    static let maximumPixelsPerDisplay = 1_048_576

    typealias Authorizer = (
        _ payload: [String: Any]
    ) -> AOSDesktopFrameCaptureAuthorization?

    private let allowedCanvasID: String
    private let authorize: Authorizer
    private let canvasManager: AOSDesktopFrameCanvasProviding
    private let capturer: AOSDesktopFrameCapturing
    private let lock = NSLock()
    private let store: AOSDesktopFrameStore
    private var captureGeneration: UInt64 = 0
    private var captureInFlight = false

    init(
        canvasManager: AOSDesktopFrameCanvasProviding,
        store: AOSDesktopFrameStore,
        capturer: AOSDesktopFrameCapturing = AOSNativeDesktopFrameCapturer(),
        allowedCanvasID: String = AOSDesktopWorldSceneTransportController.stageCanvasID,
        authorize: @escaping Authorizer
    ) {
        self.allowedCanvasID = allowedCanvasID
        self.authorize = authorize
        self.canvasManager = canvasManager
        self.capturer = capturer
        self.store = store
    }

    private func consumers(
        callerCanvasID: String,
        authorization: AOSDesktopFrameCaptureAuthorization,
        payload: [String: Any]
    ) -> [AOSDesktopFrameConsumerIdentity]? {
        let values = canvasManager.desktopFrameConsumers(canvasID: callerCanvasID)
        guard !values.isEmpty,
              values.count <= 16,
              Set(values.map(\.displayID)).count == values.count,
              values.allSatisfy({
                  $0.canvasID == callerCanvasID
                      && $0.canvasGeneration == authorization.canvasGeneration
                      && $0.topologyGeneration == authorization.topologyGeneration
              }),
              let callerDisplay = (payload["segment_display_id"] as? NSNumber)?.uint32Value,
              let callerIndex = (payload["segment_index"] as? NSNumber)?.intValue,
              values.contains(where: {
                  $0.displayID == callerDisplay && $0.segmentIndex == callerIndex
              }) else {
            return nil
        }
        return values.sorted { left, right in
            left.segmentIndex == right.segmentIndex
                ? left.displayID < right.displayID
                : left.segmentIndex < right.segmentIndex
        }
    }

    func acquire(
        callerCanvasID: String,
        payload: [String: Any],
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        guard callerCanvasID == allowedCanvasID,
              let authorization = authorize(payload),
              authorization.canvasID == callerCanvasID,
              let initialConsumers = consumers(
                  callerCanvasID: callerCanvasID,
                  authorization: authorization,
                  payload: payload
              ) else {
            completion(.failure(AOSDesktopFrameCaptureFailure.unauthorized))
            return
        }

        lock.lock()
        guard !captureInFlight else {
            lock.unlock()
            completion(.failure(AOSDesktopFrameCaptureFailure.busy))
            return
        }
        captureGeneration &+= 1
        if captureGeneration == 0 { captureGeneration = 1 }
        let generation = captureGeneration
        captureInFlight = true
        lock.unlock()

        capturer.capture(
            displayIDs: initialConsumers.map(\.displayID),
            excludingWindowIDs: canvasManager.windowNumbers(forID: callerCanvasID),
            maximumPixelsPerDisplay: Self.maximumPixelsPerDisplay
        ) { [weak self] result in
            guard let self else { return }
            do {
                let capture = try result.get()
                guard self.authorize(payload) == authorization,
                      let currentConsumers = self.consumers(
                          callerCanvasID: callerCanvasID,
                          authorization: authorization,
                          payload: payload
                      ),
                      currentConsumers == initialConsumers,
                      capture.frames.count == initialConsumers.count,
                      capture.frames.reduce(into: 0, { $0 += $1.data.count })
                          <= AOSDesktopFrameStore.maximumEncodedBytes,
                      Set(capture.frames.map(\.displayID)) == Set(initialConsumers.map(\.displayID)) else {
                    throw AOSDesktopFrameCaptureFailure.unauthorized
                }
                let epochID = UUID().uuidString.lowercased()
                let frameByDisplay = Dictionary(
                    uniqueKeysWithValues: capture.frames.map { ($0.displayID, $0) }
                )
                var leases: [AOSDesktopFrameLeaseSnapshot] = []
                self.lock.lock()
                guard self.captureInFlight, self.captureGeneration == generation else {
                    self.lock.unlock()
                    throw AOSDesktopFrameCaptureFailure.unauthorized
                }
                do {
                    for consumer in currentConsumers {
                        guard let frame = frameByDisplay[consumer.displayID] else {
                            throw AOSDesktopFrameCaptureFailure.displayNotFound
                        }
                        leases.append(try self.store.insert(
                            data: frame.data,
                            mimeType: frame.mimeType,
                            ownerCanvasID: callerCanvasID,
                            consumer: consumer,
                            epochID: epochID,
                            width: frame.width,
                            height: frame.height
                        ))
                    }
                    self.captureInFlight = false
                    self.lock.unlock()
                } catch {
                    self.captureInFlight = false
                    self.lock.unlock()
                    _ = self.store.release(epochID: epochID, ownerCanvasID: callerCanvasID)
                    throw error
                }
                let leaseByDisplay = Dictionary(
                    uniqueKeysWithValues: zip(currentConsumers, leases).map {
                        ($0.0.displayID, ($0.0, $0.1))
                    }
                )
                completion(.success([
                    "capture_duration_ms": capture.durationMilliseconds,
                    "captured_at_epoch_ms": Int(capture.capturedAt.timeIntervalSince1970 * 1_000),
                    "epoch_id": epochID,
                    "extension": authorization.extensionReference.dictionary,
                    "frames": currentConsumers.compactMap { consumer -> [String: Any]? in
                        guard let pair = leaseByDisplay[consumer.displayID] else { return nil }
                        return [
                            "display_id": Int(consumer.displayID),
                            "segment_index": consumer.segmentIndex,
                            "handle": pair.1.handle,
                            "height": pair.1.height,
                            "mime_type": pair.1.mimeType,
                            "url": pair.1.url,
                            "width": pair.1.width,
                        ]
                    },
                    "owner": authorization.ownerID,
                    "resource": authorization.resourceID,
                ]))
            } catch {
                self.lock.lock()
                if self.captureGeneration == generation {
                    self.captureInFlight = false
                }
                self.lock.unlock()
                completion(.failure(error))
            }
        }
    }

    @discardableResult
    func release(callerCanvasID: String, payload: [String: Any]) -> Bool {
        guard callerCanvasID == allowedCanvasID,
              let handle = payload["handle"] as? String else { return false }
        return store.release(handle: handle, ownerCanvasID: callerCanvasID)
    }

    @discardableResult
    func releaseAll(callerCanvasID: String) -> Int {
        lock.lock()
        captureGeneration &+= 1
        if captureGeneration == 0 { captureGeneration = 1 }
        captureInFlight = false
        lock.unlock()
        return store.releaseAll(ownerCanvasID: callerCanvasID)
    }
}
