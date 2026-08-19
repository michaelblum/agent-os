import CoreGraphics
import CryptoKit
import Foundation

enum AOSScreenRecordingGeometryMode: String, Codable {
    case fixed
    case callerFollowed = "caller_followed"
}

struct AOSScreenRecordingBindingIdentity: Codable, Equatable {
    let id: String
    let generation: UInt64

    static func validatingPublicValue(_ value: Any?) throws -> Self {
        guard let object = value as? [String: Any],
              Set(object.keys) == ["id", "generation"],
              let id = aosOperationWireIdentifier(object["id"]),
              let generationValue = object["generation"],
              let generation = aosExactJSONInteger(
                generationValue,
                minimum: 1,
                maximum: Int(aosMaximumExactJSONInteger)
              ) else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_follow_binding")
        }
        return Self(id: id, generation: UInt64(generation))
    }
}

struct AOSScreenRecordingFollowBinding: Codable, Equatable {
    let target: AOSScreenRecordingBindingIdentity
    let observation: AOSScreenRecordingBindingIdentity
    let state: AOSScreenRecordingBindingIdentity
    let session: AOSScreenRecordingBindingIdentity
    let navigation: AOSScreenRecordingBindingIdentity
    let frame: AOSScreenRecordingBindingIdentity
    let sourceWindowID: Int
    let sourceOwnerPID: Int32

    static func validatingPublicValue(_ value: Any?) throws -> Self {
        guard let object = value as? [String: Any],
              Set(object.keys) == [
                "target", "observation", "state", "session", "navigation", "frame",
                "source_window",
              ],
              let source = object["source_window"] as? [String: Any],
              Set(source.keys) == ["window_id", "owner_pid"],
              let windowIDValue = source["window_id"],
              let ownerPIDValue = source["owner_pid"],
              let windowID = aosExactJSONInteger(
                windowIDValue, minimum: 1, maximum: Int(Int32.max)
              ),
              let ownerPID = aosExactJSONInteger(
                ownerPIDValue, minimum: 1, maximum: Int(Int32.max)
              ) else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_follow_binding")
        }
        return Self(
            target: try .validatingPublicValue(object["target"]),
            observation: try .validatingPublicValue(object["observation"]),
            state: try .validatingPublicValue(object["state"]),
            session: try .validatingPublicValue(object["session"]),
            navigation: try .validatingPublicValue(object["navigation"]),
            frame: try .validatingPublicValue(object["frame"]),
            sourceWindowID: windowID,
            sourceOwnerPID: Int32(ownerPID)
        )
    }
}

struct AOSScreenRecordingGeometryConfiguration: Codable, Equatable {
    static let minimumUpdateIntervalMilliseconds: UInt64 = 16
    static let maximumUpdateIntervalMilliseconds: UInt64 = 10_000
    static let maximumUpdateDeadlineMilliseconds: UInt64 = 60_000

    let mode: AOSScreenRecordingGeometryMode
    let followBinding: AOSScreenRecordingFollowBinding?
    let updateIntervalMilliseconds: UInt64?
    let updateDeadlineMilliseconds: UInt64?

    static func validatingPublicValue(
        _ value: [String: Any],
        target: AOSScreenRecordingTarget
    ) throws -> Self {
        guard let modeRaw = value["mode"] as? String,
              let mode = AOSScreenRecordingGeometryMode(rawValue: modeRaw) else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_geometry_mode")
        }
        switch mode {
        case .fixed:
            guard Set(value.keys) == ["mode"] else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_geometry")
            }
            return Self(
                mode: .fixed,
                followBinding: nil,
                updateIntervalMilliseconds: nil,
                updateDeadlineMilliseconds: nil
            )
        case .callerFollowed:
            guard target.kind == .region,
                  Set(value.keys) == [
                    "mode", "binding", "update_interval_ms", "update_deadline_ms",
                  ],
                  let interval = AOSScreenRecordingRequest.uint64(value["update_interval_ms"]),
                  let deadline = AOSScreenRecordingRequest.uint64(value["update_deadline_ms"]),
                  (minimumUpdateIntervalMilliseconds...maximumUpdateIntervalMilliseconds)
                    .contains(interval),
                  interval <= deadline,
                  deadline <= maximumUpdateDeadlineMilliseconds else {
                throw AOSOperationCoreError.invalidRecord("screen_recording_follow_geometry")
            }
            return Self(
                mode: .callerFollowed,
                followBinding: try .validatingPublicValue(value["binding"]),
                updateIntervalMilliseconds: interval,
                updateDeadlineMilliseconds: deadline
            )
        }
    }
}

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
    let selected = AOSScreenRecordingTrackSummary.selectedTrackNames(
        systemAudio: summary.systemAudio.selected,
        microphone: summary.microphone.selected
    )
    guard summary.selectedTracks == selected,
          summary.video.selected,
          summary.video.admitted,
          summary.systemAudio.selected == summary.systemAudio.admitted,
          summary.microphone.selected == summary.microphone.admitted,
          frameCount <= summary.video.sampleCount,
          byteCount == 0
            || summary.video.firstSamplePresent
            || summary.systemAudio.firstSamplePresent
            || summary.microphone.firstSamplePresent,
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
    if summary.microphone.selected {
        guard validTrackTruth(summary.microphone) else { return false }
    } else {
        guard !summary.microphone.available,
              !summary.microphone.firstSamplePresent,
              summary.microphone.sampleCount == 0,
              summary.microphone.sampleByteCount == 0,
              summary.microphone.failureCode == nil,
              summary.microphone.drained,
              summary.microphone.finalized else {
            return false
        }
    }
    let finalized = selected.filter {
        switch $0 {
        case "video": return summary.video.finalized
        case "system_audio": return summary.systemAudio.finalized
        default: return summary.microphone.finalized
        }
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

    static func fixed(systemAudio: Bool, microphone: Bool = false) -> Self {
        Self(video: true, systemAudio: systemAudio, microphone: microphone)
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
    let mode: AOSScreenRecordingGeometryMode
    let geometryGeneration: UInt64
    let admittedTopology: AOSDisplayTopologySnapshot
    let target: AOSScreenRecordingTarget
    let sourceRect: AOSDisplayTopologyBounds
    let pixelWidth: Int
    let pixelHeight: Int
    let pixelCount: UInt64
    let bindingDigest: String
    let followBinding: AOSScreenRecordingFollowBinding?
    let updateIntervalMilliseconds: UInt64?
    let updateDeadlineMilliseconds: UInt64?
}

struct AOSScreenRecordingRequest: Codable, Equatable {
    static let schemaVersion = "aos.screen-recording.request.v1"
    static let codec = "h264"
    static let container = "quicktime"

    let requestID: String
    let canonicalParameterDigest: String
    let topology: AOSDisplayTopologySnapshot
    let target: AOSScreenRecordingTarget
    let geometry: AOSScreenRecordingGeometryConfiguration
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
            "tracks", "codec", "container", "geometry",
        ]
        guard Set(value.keys) == expected,
              value["schema_version"] as? String == schemaVersion,
              let requestID = aosOperationWireIdentifier(value["request_id"]),
              let digest = value["canonical_parameter_digest"] as? String,
              digest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let topologyValue = value["topology"],
              let targetValue = value["target"] as? [String: Any],
              let geometryValue = value["geometry"] as? [String: Any],
              let duration = uint64(value["duration_ms"]),
              let frameRate = uint64(value["frame_rate"]),
              let maximumPixels = uint64(value["max_pixel_count"]),
              let queueFrames = uint64(value["max_queue_frames"]),
              let maximumBytes = uint64(value["max_output_bytes"]),
              let tracksValue = value["tracks"] as? [String: Any],
              Set(tracksValue.keys) == ["video", "system_audio", "microphone"],
              exactBoolean(tracksValue["video"]) == true,
              let systemAudio = exactBoolean(tracksValue["system_audio"]),
              let microphone = exactBoolean(tracksValue["microphone"]),
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
        let geometry = try AOSScreenRecordingGeometryConfiguration.validatingPublicValue(
            geometryValue,
            target: target
        )
        return Self(
            requestID: requestID,
            canonicalParameterDigest: digest,
            topology: topology,
            target: target,
            geometry: geometry,
            durationMilliseconds: duration,
            frameRate: frameRate,
            maximumPixelCount: maximumPixels,
            maximumQueueFrames: queueFrames,
            maximumOutputBytes: maximumBytes,
            tracks: .fixed(
                systemAudio: systemAudio,
                microphone: microphone
            ),
            codec: codec,
            container: container
        )
    }

    static func parseTarget(
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

    static func uint64(_ value: Any?) -> UInt64? {
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

    static func exactBoolean(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) == CFBooleanGetTypeID() else {
            return nil
        }
        return number.boolValue
    }

    static func bounds(_ value: Any?) throws -> AOSDisplayTopologyBounds {
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

    static func finiteNumber(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else {
            return nil
        }
        return number.doubleValue
    }

    static func contains(
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
        struct DigestBinding: Codable {
            let mode: AOSScreenRecordingGeometryMode
            let geometryGeneration: UInt64
            let topology: AOSDisplayTopologySnapshot
            let target: AOSScreenRecordingTarget
            let sourceRect: AOSDisplayTopologyBounds
            let width: Int
            let height: Int
            let followBinding: AOSScreenRecordingFollowBinding?
            let updateIntervalMilliseconds: UInt64?
            let updateDeadlineMilliseconds: UInt64?
        }
        let input = DigestBinding(
            mode: request.geometry.mode,
            geometryGeneration: 1,
            topology: request.topology,
            target: request.target,
            sourceRect: source,
            width: width,
            height: height,
            followBinding: request.geometry.followBinding,
            updateIntervalMilliseconds: request.geometry.updateIntervalMilliseconds,
            updateDeadlineMilliseconds: request.geometry.updateDeadlineMilliseconds
        )
        var material = Data("aos:screen-recording-binding:v1\n".utf8)
        material.append(try AOSOperationDigest.canonicalData(input))
        let digest = SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
        return AOSScreenRecordingGeometry(
            mode: request.geometry.mode,
            geometryGeneration: 1,
            admittedTopology: request.topology,
            target: request.target,
            sourceRect: source,
            pixelWidth: width,
            pixelHeight: height,
            pixelCount: UInt64(multiplied.partialValue),
            bindingDigest: digest,
            followBinding: request.geometry.followBinding,
            updateIntervalMilliseconds: request.geometry.updateIntervalMilliseconds,
            updateDeadlineMilliseconds: request.geometry.updateDeadlineMilliseconds
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
        if geometry.mode == .callerFollowed {
            guard geometry.target.kind == .region,
                  let binding = geometry.followBinding,
                  windowFacts.filter({ $0.windowID == binding.sourceWindowID }).count == 1,
                  let window = windowFacts.first(where: {
                      $0.windowID == binding.sourceWindowID
                  }),
                  window.owningApplication?.processID == binding.sourceOwnerPID else {
                throw AOSOperationCoreError.recordingTargetDrift
            }
            let windowBounds = AOSDisplayTopologyBounds(
                x: window.frame.origin.x,
                y: window.frame.origin.y,
                width: window.frame.width,
                height: window.frame.height
            )
            guard AOSScreenRecordingRequest.contains(windowBounds, geometry.sourceRect) else {
                throw AOSOperationCoreError.recordingTargetDrift
            }
        }
        let bounds = geometry.target.globalBounds ?? display.nativeBounds
        guard bounds == geometry.sourceRect else {
            throw AOSOperationCoreError.recordingTargetDrift
        }
    }

    static func canonicalTopologyData(
        _ topology: AOSDisplayTopologySnapshot
    ) throws -> Data {
        let value = try aosDisplayTopologyWireValue(topology)
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}
