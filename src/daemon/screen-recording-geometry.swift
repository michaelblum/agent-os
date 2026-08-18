import CoreGraphics
import CryptoKit
import Foundation

enum AOSScreenRecordingLimits {
    static let minimumDurationMilliseconds: UInt64 = 1
    static let maximumDurationMilliseconds: UInt64 = 300_000
    static let minimumFrameRate: UInt64 = 1
    static let maximumFrameRate: UInt64 = 60
    static let minimumPixelCount: UInt64 = 4
    static let maximumPixelCount: UInt64 = 33_177_600
    static let minimumQueueFrames: UInt64 = 1
    static let maximumQueueFrames: UInt64 = 8
    static let minimumOutputBytes: UInt64 = 1_024
    static let maximumOutputBytes: UInt64 = 1_073_741_824
}

func aosOperationWireIdentifier(_ value: Any?) -> String? {
    guard let identifier = value as? String,
          !identifier.isEmpty,
          identifier.utf8.count <= 128,
          let matchedRange = identifier.range(
            of: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            options: .regularExpression
          ),
          matchedRange == identifier.startIndex..<identifier.endIndex else {
        return nil
    }
    return identifier
}

func aosExactOperationWireIdentity(
    _ value: Any?,
    idKey: String,
    generationKey: String
) -> AOSOperationIdentity? {
    guard let selector = value as? [String: Any],
          Set(selector.keys) == [idKey, generationKey],
          let identifier = aosOperationWireIdentifier(selector[idKey]),
          let generationValue = selector[generationKey],
          let generation = aosExactJSONInteger(
            generationValue,
            minimum: 1,
            maximum: Int(aosMaximumExactJSONInteger)
          ) else {
        return nil
    }
    return AOSOperationIdentity(id: identifier, generation: UInt64(generation))
}

func aosArtifactReleaseDestinationPath(_ value: Any?) -> String? {
    guard let destination = value as? String,
          !destination.isEmpty,
          destination.utf8.count <= 4_096,
          !destination.contains("\0"),
          destination.hasPrefix("/") else {
        return nil
    }
    let standardized = URL(fileURLWithPath: destination).standardizedFileURL.path
    guard standardized == destination,
          standardized != "/",
          URL(fileURLWithPath: standardized).lastPathComponent != ".",
          URL(fileURLWithPath: standardized).lastPathComponent != ".." else {
        return nil
    }
    return standardized
}

struct AOSScreenRecordingProgressTimeline {
    let maximumDurationMilliseconds: UInt64
    private(set) var captureStartedAtNanoseconds: UInt64?
    private(set) var stopAdmittedAtNanoseconds: UInt64?

    init(maximumDurationMilliseconds: UInt64) {
        self.maximumDurationMilliseconds = maximumDurationMilliseconds
    }

    @discardableResult
    mutating func admitCaptureStart(atNanoseconds now: UInt64) -> Bool {
        guard captureStartedAtNanoseconds == nil else { return false }
        captureStartedAtNanoseconds = now
        return true
    }

    @discardableResult
    mutating func admitStop(atNanoseconds now: UInt64) -> Bool {
        guard captureStartedAtNanoseconds != nil,
              stopAdmittedAtNanoseconds == nil else {
            return false
        }
        stopAdmittedAtNanoseconds = now
        return true
    }

    func elapsedMilliseconds(atNanoseconds now: UInt64) -> UInt64 {
        guard let start = captureStartedAtNanoseconds else { return 0 }
        let end = stopAdmittedAtNanoseconds ?? now
        guard end >= start else { return 0 }
        return min(maximumDurationMilliseconds, (end - start) / 1_000_000)
    }
}

@discardableResult
func aosPersistScreenRecordingProgress(
    frameCount: UInt64,
    byteCount: UInt64,
    elapsedMilliseconds: UInt64,
    bounds: AOSOperationRequestedBounds,
    trackSummary: AOSScreenRecordingTrackSummary,
    persist: (AOSOperationProgress) throws -> Void
) throws -> AOSOperationProgress {
    let multipliedFrames = bounds.durationMilliseconds.multipliedReportingOverflow(
        by: bounds.frameRate
    )
    let roundedFrames = multipliedFrames.partialValue.addingReportingOverflow(999)
    let durationFrameLimit = roundedFrames.partialValue / 1_000
    let frameLimit = durationFrameLimit.addingReportingOverflow(bounds.queueFrames)
    guard !multipliedFrames.overflow,
          !roundedFrames.overflow,
          !frameLimit.overflow,
          frameCount <= frameLimit.partialValue,
          elapsedMilliseconds <= bounds.durationMilliseconds,
          byteCount <= bounds.maximumOutputBytes,
          validProgressSummary(
            trackSummary,
            frameCount: frameCount,
            byteCount: byteCount
          ) else {
        throw AOSOperationCoreError.recordingBoundsExceeded
    }
    let progress = AOSOperationProgress(
        frameCount: frameCount,
        byteCount: byteCount,
        elapsedMilliseconds: elapsedMilliseconds,
        droppedFrameCount: 0,
        trackSummary: trackSummary
    )
    try persist(progress)
    return progress
}

private func validProgressSummary(
    _ summary: AOSScreenRecordingTrackSummary,
    frameCount: UInt64,
    byteCount: UInt64
) -> Bool {
    let selected = summary.systemAudio.selected
        ? ["video", "system_audio"] : ["video"]
    guard summary.selectedTracks == selected,
          summary.video.selected,
          summary.video.admitted,
          summary.systemAudio.selected == summary.systemAudio.admitted,
          frameCount <= summary.video.sampleCount,
          byteCount == 0
            || summary.video.firstSamplePresent
            || summary.systemAudio.firstSamplePresent,
          validTrackTruth(summary.video) else {
        return false
    }
    if summary.systemAudio.selected {
        guard validTrackTruth(summary.systemAudio) else { return false }
    } else {
        guard !summary.systemAudio.available,
              !summary.systemAudio.firstSamplePresent,
              summary.systemAudio.sampleCount == 0,
              summary.systemAudio.sampleByteCount == 0,
              summary.systemAudio.failureCode == nil,
              summary.systemAudio.drained,
              summary.systemAudio.finalized else {
            return false
        }
    }
    let finalized = selected.filter {
        $0 == "video" ? summary.video.finalized : summary.systemAudio.finalized
    }
    return summary.finalizedTracks == finalized
}

private func validTrackTruth(_ truth: AOSScreenRecordingTrackTruth) -> Bool {
    let hasPositiveSample = truth.sampleCount > 0 && truth.sampleByteCount > 0
    guard truth.firstSamplePresent == hasPositiveSample,
          !truth.firstSamplePresent || truth.available,
          !truth.finalized || truth.drained else {
        return false
    }
    if truth.finalized && truth.selected {
        return truth.admitted
            && truth.available
            && truth.failureCode == nil
    }
    return true
}

struct AOSScreenRecordingTracks: Codable, Equatable {
    let video: Bool
    let systemAudio: Bool
    let microphone: Bool

    static func fixed(systemAudio: Bool) -> Self {
        Self(video: true, systemAudio: systemAudio, microphone: false)
    }
}

enum AOSScreenRecordingTargetKind: String, Codable {
    case display, window, region
}

struct AOSScreenRecordingTarget: Codable, Equatable {
    let kind: AOSScreenRecordingTargetKind
    let displayOrdinal: Int
    let displayMemberIdentity: AOSDisplayTopologyMemberIdentity
    let windowID: Int?
    let ownerPID: Int32?
    let globalBounds: AOSDisplayTopologyBounds?
}

struct AOSScreenRecordingGeometry: Codable, Equatable {
    let admittedTopology: AOSDisplayTopologySnapshot
    let target: AOSScreenRecordingTarget
    let sourceRect: AOSDisplayTopologyBounds
    let pixelWidth: Int
    let pixelHeight: Int
    let pixelCount: UInt64
    let bindingDigest: String
}

struct AOSScreenRecordingRequest: Codable, Equatable {
    static let schemaVersion = "aos.screen-recording.request.v1"
    static let codec = "h264"
    static let container = "quicktime"

    let requestID: String
    let canonicalParameterDigest: String
    let topology: AOSDisplayTopologySnapshot
    let target: AOSScreenRecordingTarget
    let durationMilliseconds: UInt64
    let frameRate: UInt64
    let maximumPixelCount: UInt64
    let maximumQueueFrames: UInt64
    let maximumOutputBytes: UInt64
    let tracks: AOSScreenRecordingTracks
    let codec: String
    let container: String

    var requestedBounds: AOSOperationRequestedBounds {
        AOSOperationRequestedBounds(
            durationMilliseconds: durationMilliseconds,
            frameRate: frameRate,
            pixelCount: maximumPixelCount,
            queueFrames: maximumQueueFrames,
            maximumOutputBytes: maximumOutputBytes
        )
    }

    static func validatingPublicValue(_ value: [String: Any]) throws -> Self {
        let expected: Set<String> = [
            "schema_version", "request_id", "canonical_parameter_digest",
            "topology", "target", "duration_ms", "frame_rate",
            "max_pixel_count", "max_queue_frames", "max_output_bytes",
            "tracks", "codec", "container",
        ]
        guard Set(value.keys) == expected,
              value["schema_version"] as? String == schemaVersion,
              let requestID = aosOperationWireIdentifier(value["request_id"]),
              let digest = value["canonical_parameter_digest"] as? String,
              digest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let topologyValue = value["topology"],
              let targetValue = value["target"] as? [String: Any],
              let duration = uint64(value["duration_ms"]),
              let frameRate = uint64(value["frame_rate"]),
              let maximumPixels = uint64(value["max_pixel_count"]),
              let queueFrames = uint64(value["max_queue_frames"]),
              let maximumBytes = uint64(value["max_output_bytes"]),
              let tracksValue = value["tracks"] as? [String: Any],
              Set(tracksValue.keys) == ["video", "system_audio", "microphone"],
              tracksValue["video"] as? Bool == true,
              let systemAudio = tracksValue["system_audio"] as? Bool,
              tracksValue["microphone"] as? Bool == false,
              value["codec"] as? String == codec,
              value["container"] as? String == container,
              (AOSScreenRecordingLimits.minimumDurationMilliseconds
                ... AOSScreenRecordingLimits.maximumDurationMilliseconds).contains(duration),
              (AOSScreenRecordingLimits.minimumFrameRate
                ... AOSScreenRecordingLimits.maximumFrameRate).contains(frameRate),
              (AOSScreenRecordingLimits.minimumPixelCount
                ... AOSScreenRecordingLimits.maximumPixelCount).contains(maximumPixels),
              (AOSScreenRecordingLimits.minimumQueueFrames
                ... AOSScreenRecordingLimits.maximumQueueFrames).contains(queueFrames),
              (AOSScreenRecordingLimits.minimumOutputBytes
                ... AOSScreenRecordingLimits.maximumOutputBytes).contains(maximumBytes) else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_request")
        }
        let topology = try validateAOSDisplayTopologyWireValue(topologyValue)
        let target = try parseTarget(targetValue, topology: topology)
        return Self(
            requestID: requestID,
            canonicalParameterDigest: digest,
            topology: topology,
            target: target,
            durationMilliseconds: duration,
            frameRate: frameRate,
            maximumPixelCount: maximumPixels,
            maximumQueueFrames: queueFrames,
            maximumOutputBytes: maximumBytes,
            tracks: .fixed(systemAudio: systemAudio),
            codec: codec,
            container: container
        )
    }

    private static func parseTarget(
        _ value: [String: Any],
        topology: AOSDisplayTopologySnapshot
    ) throws -> AOSScreenRecordingTarget {
        guard let kindRaw = value["kind"] as? String,
              let kind = AOSScreenRecordingTargetKind(rawValue: kindRaw),
              let ordinalValue = value["display_ordinal"],
              let ordinal = aosExactJSONInteger(ordinalValue, minimum: 0, maximum: 15),
              let display = topology.displays.first(where: { $0.ordinal == ordinal }) else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_target")
        }
        switch kind {
        case .display:
            guard Set(value.keys) == ["kind", "display_ordinal"] else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_target")
            }
            return Self.target(kind, display: display)
        case .window:
            guard Set(value.keys) == [
                "kind", "display_ordinal", "window_id", "owner_pid", "global_bounds",
            ], let windowValue = value["window_id"],
               let ownerValue = value["owner_pid"],
               let windowID = aosExactJSONInteger(
                windowValue,
                minimum: 1,
                maximum: Int(Int32.max)
               ),
               let ownerPIDValue = aosExactJSONInteger(
                ownerValue,
                minimum: 1,
                maximum: Int(Int32.max)
               ),
               let bounds = try? bounds(value["global_bounds"]) else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_target")
            }
            guard contains(display.nativeBounds, bounds) else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_geometry")
            }
            return Self.target(
                kind,
                display: display,
                windowID: windowID,
                ownerPID: Int32(ownerPIDValue),
                bounds: bounds
            )
        case .region:
            guard Set(value.keys) == ["kind", "display_ordinal", "global_bounds"],
                  let bounds = try? bounds(value["global_bounds"]),
                  contains(display.nativeBounds, bounds) else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_geometry")
            }
            return Self.target(kind, display: display, bounds: bounds)
        }
    }

    private static func target(
        _ kind: AOSScreenRecordingTargetKind,
        display: AOSDisplayTopologyDisplay,
        windowID: Int? = nil,
        ownerPID: Int32? = nil,
        bounds: AOSDisplayTopologyBounds? = nil
    ) -> AOSScreenRecordingTarget {
        AOSScreenRecordingTarget(
            kind: kind,
            displayOrdinal: display.ordinal,
            displayMemberIdentity: display.memberIdentity,
            windowID: windowID,
            ownerPID: ownerPID,
            globalBounds: bounds
        )
    }

    private static func uint64(_ value: Any?) -> UInt64? {
        guard let value,
              let integer = aosExactJSONInteger(
                value,
                minimum: 0,
                maximum: Int(aosMaximumExactJSONInteger)
              ) else {
            return nil
        }
        return UInt64(integer)
    }

    private static func bounds(_ value: Any?) throws -> AOSDisplayTopologyBounds {
        guard let object = value as? [String: Any],
              Set(object.keys) == ["x", "y", "width", "height"],
              let x = finiteNumber(object["x"]),
              let y = finiteNumber(object["y"]),
              let width = finiteNumber(object["width"]),
              let height = finiteNumber(object["height"]),
              [x, y, width, height].allSatisfy(\.isFinite),
              width > 0, height > 0 else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_bounds")
        }
        return AOSDisplayTopologyBounds(x: x, y: y, width: width, height: height)
    }

    private static func finiteNumber(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else {
            return nil
        }
        return number.doubleValue
    }

    private static func contains(
        _ container: AOSDisplayTopologyBounds,
        _ candidate: AOSDisplayTopologyBounds
    ) -> Bool {
        let outer = CGRect(
            x: container.x,
            y: container.y,
            width: container.width,
            height: container.height
        )
        let inner = CGRect(
            x: candidate.x,
            y: candidate.y,
            width: candidate.width,
            height: candidate.height
        )
        return outer.contains(inner)
    }
}

enum AOSScreenRecordingGeometryValidator {
    static func resolve(_ request: AOSScreenRecordingRequest) throws -> AOSScreenRecordingGeometry {
        guard request.tracks.video,
              !request.tracks.microphone,
              request.codec == AOSScreenRecordingRequest.codec,
              request.container == AOSScreenRecordingRequest.container,
              let display = request.topology.displays.first(where: {
                  $0.ordinal == request.target.displayOrdinal
                    && $0.memberIdentity == request.target.displayMemberIdentity
              }) else {
            throw AOSOperationCoreError.recordingTargetDrift
        }
        let source = request.target.globalBounds ?? display.nativeBounds
        guard source.width > 0, source.height > 0, display.scaleFactor > 0 else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_geometry")
        }
        let rawWidth = Int((source.width * display.scaleFactor).rounded(.down))
        let rawHeight = Int((source.height * display.scaleFactor).rounded(.down))
        let width = rawWidth - (rawWidth % 2)
        let height = rawHeight - (rawHeight % 2)
        let multiplied = width.multipliedReportingOverflow(by: height)
        guard width >= 2, height >= 2, !multiplied.overflow,
              UInt64(multiplied.partialValue) <= request.maximumPixelCount else {
            throw AOSOperationCoreError.recordingBoundsExceeded
        }
        struct Binding: Codable {
            let topology: AOSDisplayTopologySnapshot
            let target: AOSScreenRecordingTarget
            let sourceRect: AOSDisplayTopologyBounds
            let width: Int
            let height: Int
        }
        let input = Binding(
            topology: request.topology,
            target: request.target,
            sourceRect: source,
            width: width,
            height: height
        )
        var material = Data("aos:screen-recording-binding:v1\n".utf8)
        material.append(try AOSOperationDigest.canonicalData(input))
        let digest = SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
        return AOSScreenRecordingGeometry(
            admittedTopology: request.topology,
            target: request.target,
            sourceRect: source,
            pixelWidth: width,
            pixelHeight: height,
            pixelCount: UInt64(multiplied.partialValue),
            bindingDigest: digest
        )
    }

    static func validateCurrentBinding(
        _ geometry: AOSScreenRecordingGeometry,
        observedTopology: AOSDisplayTopologySnapshot,
        windowFacts: [CaptureWindowFact]
    ) throws {
        guard try canonicalTopologyData(observedTopology)
                == canonicalTopologyData(geometry.admittedTopology),
              let display = observedTopology.displays.first(where: {
            $0.ordinal == geometry.target.displayOrdinal
                && $0.memberIdentity == geometry.target.displayMemberIdentity
        }) else {
            throw AOSOperationCoreError.recordingTargetDrift
        }
        if geometry.target.kind == .window {
            guard let windowID = geometry.target.windowID,
                  let ownerPID = geometry.target.ownerPID,
                  let expected = geometry.target.globalBounds,
                  windowFacts.filter({ $0.windowID == windowID }).count == 1,
                  let window = windowFacts.first(where: { $0.windowID == windowID }),
                  window.owningApplication?.processID == ownerPID,
                  window.frame.integral == CGRect(
                    x: expected.x,
                    y: expected.y,
                    width: expected.width,
                    height: expected.height
                  ).integral else {
                throw AOSOperationCoreError.recordingTargetDrift
            }
        }
        let bounds = geometry.target.globalBounds ?? display.nativeBounds
        guard bounds == geometry.sourceRect else {
            throw AOSOperationCoreError.recordingTargetDrift
        }
    }

    private static func canonicalTopologyData(
        _ topology: AOSDisplayTopologySnapshot
    ) throws -> Data {
        let value = try aosDisplayTopologyWireValue(topology)
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}
