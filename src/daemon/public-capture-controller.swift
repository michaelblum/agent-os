import Foundation
import ImageIO
import UniformTypeIdentifiers

private enum AOSPublicCaptureWireError: Error {
    case invalid
    case topologyMismatch
}

private func aosPublicCapturePositiveUInt32(_ value: Any) -> UInt32? {
    aosExactJSONUInt32(value, minimum: 1)
}

private func aosPublicCaptureFiniteDouble(_ value: Any) -> Double? {
    guard let number = value as? NSNumber,
          CFGetTypeID(number) != CFBooleanGetTypeID(),
          number.doubleValue.isFinite else {
        return nil
    }
    return number.doubleValue
}

private func aosPublicCaptureWindowBounds(_ value: Any) -> CGRect? {
    guard let raw = value as? [String: Any],
          Set(raw.keys) == ["x", "y", "width", "height"],
          let x = aosPublicCaptureFiniteDouble(raw["x"] as Any),
          let y = aosPublicCaptureFiniteDouble(raw["y"] as Any),
          let width = aosPublicCaptureFiniteDouble(raw["width"] as Any),
          let height = aosPublicCaptureFiniteDouble(raw["height"] as Any),
          width >= 10,
          height >= 10 else {
        return nil
    }
    let bounds = CGRect(x: x, y: y, width: width, height: height)
    guard !bounds.isNull, !bounds.isInfinite else { return nil }
    return bounds
}

private struct AOSPublicCaptureWireRequest {
    let captureID: String
    let request: AOSDesktopPixelSnapshotRequest
    let topologyIdentity: String

    init(payload: [String: Any]) throws {
        guard Set(payload.keys) == [
                "capture_id", "display_topology", "displays", "display_ids",
                "excluded_window_ids", "window_targets",
                "maximum_pixels_per_display", "shows_cursor",
              ],
              let captureID = payload["capture_id"] as? String,
              UUID(uuidString: captureID) != nil,
              let rawDisplays = payload["displays"] as? [[String: Any]],
              !rawDisplays.isEmpty,
              rawDisplays.count <= AOSDesktopPixelLimits.maximumDisplayCount,
              let rawSelected = payload["display_ids"] as? [Any],
              !rawSelected.isEmpty,
              rawSelected.count <= AOSDesktopPixelLimits.maximumDisplayCount,
              let maximumPixels = aosExactJSONInteger(
                payload["maximum_pixels_per_display"] as Any,
                minimum: 4,
                maximum: AOSDesktopPixelLimits.publicCaptureMaximumPixelsPerDisplay
              ),
              let showsCursor = payload["shows_cursor"] as? Bool,
              let rawExcluded = payload["excluded_window_ids"] as? [Any],
              rawExcluded.count <= 256,
              let rawWindows = payload["window_targets"] as? [[String: Any]] else {
            throw AOSPublicCaptureWireError.invalid
        }
        let topology: AOSDisplayTopologySnapshot
        do {
            topology = try validateAOSDisplayTopologyWireValue(
                payload["display_topology"] as Any
            )
        } catch {
            throw AOSPublicCaptureWireError.topologyMismatch
        }
        guard topology.displays.count <= AOSDesktopPixelLimits.maximumDisplayCount else {
            throw AOSPublicCaptureWireError.invalid
        }
        var geometries: [AOSDesktopWorldDisplayGeometry] = []
        var selectedMemberByDisplayID: [UInt32: AOSDisplayTopologyMemberIdentity] = [:]
        var mappedOrdinals = Set<Int>()
        for item in rawDisplays {
            guard Set(item.keys) == ["display_id", "index", "topology_ordinal"],
                  let displayID = aosPublicCapturePositiveUInt32(
                    item["display_id"] as Any
                  ),
                  let index = aosExactJSONInteger(
                    item["index"] as Any,
                    minimum: 0,
                    maximum: AOSDesktopPixelLimits.maximumDisplayCount - 1
                  ),
                  let ordinal = aosExactJSONInteger(
                    item["topology_ordinal"] as Any,
                    minimum: 1,
                    maximum: AOSDesktopPixelLimits.maximumDisplayCount
                  ),
                  let canonical = topology.displays.first(where: {
                    $0.ordinal == ordinal
                  }),
                  mappedOrdinals.insert(ordinal).inserted,
                  {
                    if case .displayIDFallback(let fallbackID) = canonical.memberIdentity {
                        return fallbackID == displayID
                    }
                    return true
                  }(),
                  let geometry = AOSDesktopWorldDisplayGeometry(
                    displayID: displayID,
                    index: index,
                    desktopWorldBounds: CGRect(
                        x: canonical.desktopWorldBounds.x,
                        y: canonical.desktopWorldBounds.y,
                        width: canonical.desktopWorldBounds.width,
                        height: canonical.desktopWorldBounds.height
                    ),
                    nativePointBounds: CGRect(
                        x: canonical.nativeBounds.x,
                        y: canonical.nativeBounds.y,
                        width: canonical.nativeBounds.width,
                        height: canonical.nativeBounds.height
                    ),
                    pointPixelScale: canonical.scaleFactor
                  ) else {
                throw AOSPublicCaptureWireError.invalid
            }
            geometries.append(geometry)
            guard selectedMemberByDisplayID.updateValue(
                canonical.memberIdentity,
                forKey: displayID
            ) == nil else {
                throw AOSPublicCaptureWireError.invalid
            }
        }
        guard let layout = AOSDesktopWorldDisplayLayout(displays: geometries) else {
            throw AOSPublicCaptureWireError.invalid
        }
        let selections = try layout.displayIDs.map { displayID in
            guard let memberIdentity = selectedMemberByDisplayID[displayID] else {
                throw AOSPublicCaptureWireError.invalid
            }
            return AOSDisplayCaptureSelection(
                runtimeDisplayID: displayID,
                memberIdentity: memberIdentity
            )
        }
        let selected = try rawSelected.map { value -> UInt32 in
            guard let displayID = aosPublicCapturePositiveUInt32(value) else {
                throw AOSPublicCaptureWireError.invalid
            }
            return displayID
        }
        guard Set(selected).count == selected.count,
              selected == layout.displays.map(\.displayID) else {
            throw AOSPublicCaptureWireError.invalid
        }
        let excluded = try rawExcluded.map { value -> Int in
            guard let exactWindowID = aosExactJSONUInt32(value, minimum: 1) else {
                throw AOSPublicCaptureWireError.invalid
            }
            return Int(exactWindowID)
        }
        guard Set(excluded).count == excluded.count,
              rawWindows.count <= AOSDesktopPixelLimits.maximumDisplayCount else {
            throw AOSPublicCaptureWireError.invalid
        }
        var windowTargetsByDisplay: [UInt32: AOSDesktopPixelWindowTarget] = [:]
        for target in rawWindows {
            guard Set(target.keys) == [
                    "display_id", "window_id", "owner_pid",
                    "expected_bounds", "fallback",
                  ],
                  let displayID = aosPublicCapturePositiveUInt32(
                    target["display_id"] as Any
                  ),
                  let exactWindowID = aosExactJSONUInt32(
                    target["window_id"] as Any,
                    minimum: 1
                  ),
                  let ownerPID = aosExactJSONInteger(
                    target["owner_pid"] as Any,
                    minimum: 1,
                    maximum: Int(Int32.max)
                  ),
                  let expectedBounds = aosPublicCaptureWindowBounds(
                    target["expected_bounds"] as Any
                  ),
                  let fallbackRaw = target["fallback"] as? String,
                  let fallback = AOSDesktopPixelWindowFallback(
                    rawValue: fallbackRaw
                  ),
                  selected.contains(displayID) else {
                throw AOSPublicCaptureWireError.invalid
            }
            let windowID = Int(exactWindowID)
            guard !excluded.contains(windowID),
                  windowTargetsByDisplay.updateValue(
                    AOSDesktopPixelWindowTarget(
                        windowID: windowID,
                        ownerPID: ownerPID,
                        expectedBounds: expectedBounds,
                        fallback: fallback
                    ),
                    forKey: displayID
                  ) == nil else {
                throw AOSPublicCaptureWireError.invalid
            }
        }
        guard Set(windowTargetsByDisplay.values.map(\.windowID)).count
                == windowTargetsByDisplay.count else {
            throw AOSPublicCaptureWireError.invalid
        }
        self.captureID = captureID.lowercased()
        self.topologyIdentity = topology.identity
        request = AOSDesktopPixelSnapshotRequest(
            displayIDs: selected,
            displayLayout: layout,
            excludingWindowIDs: excluded,
            maximumPixelsPerDisplay: maximumPixels,
            sizingPolicy: .exactWithinBudget,
            capturePolicy: .publicExplicitExclusions,
            publicCaptureSelections: selections,
            publicCaptureTopology: topology,
            showsCursor: showsCursor,
            windowTargetsByDisplay: windowTargetsByDisplay
        )
        guard aosDesktopPixelRequestIsValid(request) else {
            throw AOSPublicCaptureWireError.invalid
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

    private let capturer: AOSDesktopPixelExclusiveStillCapturing

    init(capturer: AOSDesktopPixelExclusiveStillCapturing) {
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
        } catch AOSPublicCaptureWireError.topologyMismatch {
            DispatchQueue.global(qos: .userInitiated).async {
                completion([
                    "error": "Capture topology is invalid",
                    "code": AOSDesktopFrameCaptureFailure.topologyMismatch.code,
                ])
            }
            return AOSDesktopFrameCancellation()
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
            let windowTarget = wire.request.windowTargetsByDisplay[displayID]
            let requestedWindowID = windowTarget?.windowID
            switch frame.source {
            case .display:
                guard frame.usedWindowFallback == (requestedWindowID != nil),
                      windowTarget.map(\.fallback) != .some(.none) else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
            case .window(let windowID):
                guard !frame.usedWindowFallback,
                      requestedWindowID == windowID else {
                    throw AOSDesktopFrameCaptureFailure.captureFailed
                }
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
            var item: [String: Any] = [
                "display_id": NSNumber(value: displayID),
                "frame_index": frameIndex,
                "chunk_count": transfer.chunkCount,
                "byte_count": transfer.byteCount,
                "sha256": transfer.sha256,
                "width": frame.width,
                "height": frame.height,
                "capture_source": {
                    if case .window = frame.source { return "window" }
                    return "display"
                }(),
                "window_fallback": frame.usedWindowFallback,
            ]
            if case .window(let windowID) = frame.source {
                item["window_id"] = windowID
            }
            metadata.append(item)
        }
        return [
            "status": "ok",
            "capture_id": wire.captureID,
            "topology_identity": wire.topologyIdentity,
            "frames": metadata,
        ]
    }
}
