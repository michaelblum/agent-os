import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

const supportSource = String.raw`
import CoreGraphics
import Foundation

enum AOSOperationCoreError: Error, Equatable, CustomStringConvertible {
    case invalidRecord(String)
    case recordingBoundsExceeded
    case recordingTargetDrift

    var description: String {
        switch self {
        case .invalidRecord(let value): return "OPERATION_RECORD_INVALID:\(value)"
        case .recordingBoundsExceeded: return "SCREEN_RECORDING_BOUNDS_EXCEEDED"
        case .recordingTargetDrift: return "SCREEN_RECORDING_TARGET_DRIFT"
        }
    }
}

struct AOSOperationIdentity: Codable, Equatable {
    let id: String
    let generation: UInt64
}

struct AOSOperationRequestedBounds: Codable, Equatable {
    let durationMilliseconds: UInt64
    let frameRate: UInt64
    let pixelCount: UInt64
    let queueFrames: UInt64
    let maximumOutputBytes: UInt64
}

struct AOSOperationProgress: Codable, Equatable {
    var frameCount: UInt64
    var byteCount: UInt64
    var elapsedMilliseconds: UInt64
    var droppedFrameCount: UInt64
    var trackSummary: AOSScreenRecordingTrackSummary?

    init(
        frameCount: UInt64,
        byteCount: UInt64,
        elapsedMilliseconds: UInt64,
        droppedFrameCount: UInt64,
        trackSummary: AOSScreenRecordingTrackSummary? = nil
    ) {
        self.frameCount = frameCount
        self.byteCount = byteCount
        self.elapsedMilliseconds = elapsedMilliseconds
        self.droppedFrameCount = droppedFrameCount
        self.trackSummary = trackSummary
    }
}

struct AOSScreenRecordingTrackTruth: Codable, Equatable {
    let selected: Bool
    let admitted: Bool
    let available: Bool
    let firstSamplePresent: Bool
    let sampleCount: UInt64
    let sampleByteCount: UInt64
    let failureCode: String?
    let drained: Bool
    let finalized: Bool
}

struct AOSScreenRecordingTrackSummary: Codable, Equatable {
    let selectedTracks: [String]
    let finalizedTracks: [String]
    let commonMediaEpochNanoseconds: UInt64?
    let video: AOSScreenRecordingTrackTruth
    let systemAudio: AOSScreenRecordingTrackTruth
    let microphone: AOSScreenRecordingTrackTruth

    static func selectedTrackNames(systemAudio: Bool, microphone: Bool) -> [String] {
        var names = ["video"]
        if systemAudio { names.append("system_audio") }
        if microphone { names.append("microphone") }
        return names
    }
}

enum AOSOperationDigest {
    static func canonicalData<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
}

struct AOSDisplayTopologyBounds: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AOSDisplayTopologyPoint: Codable, Equatable {
    let x: Double
    let y: Double
}

enum AOSDisplayTopologyMemberIdentity: Codable, Equatable {
    case displayIDFallback(UInt32)
}

struct AOSDisplayTopologyDisplay: Codable, Equatable {
    let runtimeDisplayID: UInt32
    let ordinal: Int
    let isMain: Bool
    let memberIdentity: AOSDisplayTopologyMemberIdentity
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double
}

struct AOSDisplayTopologySnapshot: Codable, Equatable {
    let identity: String
    let usesDisplayIDFallback: Bool
    let screensHaveSeparateSpaces: Bool
    let desktopWorldOriginNative: AOSDisplayTopologyPoint
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let displays: [AOSDisplayTopologyDisplay]
}

func boundsValue(_ value: AOSDisplayTopologyBounds) -> [String: Any] {
    ["x": value.x, "y": value.y, "width": value.width, "height": value.height]
}

func aosDisplayTopologyWireValue(
    _ snapshot: AOSDisplayTopologySnapshot
) throws -> [String: Any] {
    [
        "schema": "aos.display-topology.v1",
        "identity": snapshot.identity,
        "uses_display_id_fallback": snapshot.usesDisplayIDFallback,
        "screens_have_separate_spaces": snapshot.screensHaveSeparateSpaces,
        "desktop_world_origin_native": [
            "x": snapshot.desktopWorldOriginNative.x,
            "y": snapshot.desktopWorldOriginNative.y,
        ],
        "native_bounds": boundsValue(snapshot.nativeBounds),
        "native_visible_bounds": boundsValue(snapshot.nativeVisibleBounds),
        "desktop_world_bounds": boundsValue(snapshot.desktopWorldBounds),
        "visible_desktop_world_bounds": boundsValue(snapshot.visibleDesktopWorldBounds),
        "displays": snapshot.displays.map { display in
            let member: [String: Any]
            switch display.memberIdentity {
            case .displayIDFallback(let id):
                member = ["kind": "display_id_fallback", "display_id_fallback": id]
            }
            return [
                "ordinal": display.ordinal,
                "is_main": display.isMain,
                "member_identity": member,
                "native_bounds": boundsValue(display.nativeBounds),
                "native_visible_bounds": boundsValue(display.nativeVisibleBounds),
                "desktop_world_bounds": boundsValue(display.desktopWorldBounds),
                "visible_desktop_world_bounds": boundsValue(display.visibleDesktopWorldBounds),
                "scale_factor": display.scaleFactor,
                "rotation": display.rotation,
            ]
        },
    ]
}

func validateAOSDisplayTopologyWireValue(_ value: Any) throws -> AOSDisplayTopologySnapshot {
    guard let topology = value as? AOSDisplayTopologySnapshot else {
        throw AOSOperationCoreError.invalidRecord("topology")
    }
    return topology
}

struct CaptureApplicationFact {
    let processID: Int32
}

struct CaptureWindowFact {
    let frame: CGRect
    let owningApplication: CaptureApplicationFact?
    let windowID: Int
}
`

const harnessSource = String.raw`
import Foundation

enum HarnessFailure: Error { case injectedSave }

@main
struct ScreenRecordingOwnerHarness {
    static func display(
        id: UInt32,
        ordinal: Int,
        main: Bool,
        x: Double = 0,
        scale: Double = 2,
        rotation: Double = 0
    ) -> AOSDisplayTopologyDisplay {
        let native = AOSDisplayTopologyBounds(x: x, y: 0, width: 100, height: 80)
        return AOSDisplayTopologyDisplay(
            runtimeDisplayID: id,
            ordinal: ordinal,
            isMain: main,
            memberIdentity: .displayIDFallback(id),
            nativeBounds: native,
            nativeVisibleBounds: native,
            desktopWorldBounds: native,
            visibleDesktopWorldBounds: native,
            scaleFactor: scale,
            rotation: rotation
        )
    }

    static func topology(
        scale: Double = 2,
        rotation: Double = 0,
        peer: Bool = false
    ) -> AOSDisplayTopologySnapshot {
        var displays = [display(id: 1, ordinal: 1, main: true, scale: scale, rotation: rotation)]
        if peer { displays.append(display(id: 2, ordinal: 2, main: false, x: 100)) }
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        return AOSDisplayTopologySnapshot(
            identity: "forged-stable-identity",
            usesDisplayIDFallback: true,
            screensHaveSeparateSpaces: false,
            desktopWorldOriginNative: AOSDisplayTopologyPoint(x: 0, y: 0),
            nativeBounds: bounds,
            nativeVisibleBounds: bounds,
            desktopWorldBounds: bounds,
            visibleDesktopWorldBounds: bounds,
            displays: displays
        )
    }

    static func request(overrides: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = [
            "schema_version": "aos.screen-recording.request.v1",
            "request_id": "recording-1",
            "canonical_parameter_digest": String(repeating: "a", count: 64),
            "topology": topology(),
            "target": ["kind": "display", "display_ordinal": 1],
            "geometry": ["mode": "fixed"],
            "duration_ms": 1_000,
            "frame_rate": 30,
            "max_pixel_count": 1_000_000,
            "max_queue_frames": 3,
            "max_output_bytes": 10_000,
            "tracks": ["video": true, "system_audio": false, "microphone": false],
            "codec": "h264",
            "container": "quicktime",
        ]
        for (key, replacement) in overrides { value[key] = replacement }
        return value
    }

    static func progressSummary(
        videoSamples: UInt64,
        audioSamples: UInt64 = 0,
        microphoneSamples: UInt64 = 0,
        systemAudio: Bool = false,
        microphone: Bool = false
    ) -> AOSScreenRecordingTrackSummary {
        func truth(_ selected: Bool, _ samples: UInt64) -> AOSScreenRecordingTrackTruth {
            AOSScreenRecordingTrackTruth(
                selected: selected,
                admitted: selected,
                available: samples > 0,
                firstSamplePresent: samples > 0,
                sampleCount: samples,
                sampleByteCount: samples * 128,
                failureCode: nil,
                drained: !selected,
                finalized: !selected
            )
        }
        return AOSScreenRecordingTrackSummary(
            selectedTracks: AOSScreenRecordingTrackSummary.selectedTrackNames(
                systemAudio: systemAudio,
                microphone: microphone
            ),
            finalizedTracks: [],
            commonMediaEpochNanoseconds: nil,
            video: truth(true, videoSamples),
            systemAudio: truth(systemAudio, audioSamples),
            microphone: truth(microphone, microphoneSamples)
        )
    }

    static func expectInvalid(_ value: [String: Any]) throws {
        do {
            _ = try AOSScreenRecordingRequest.validatingPublicValue(value)
            fatalError("accepted invalid request")
        } catch AOSOperationCoreError.invalidRecord { return }
    }

    static func expectDrift(
        _ geometry: AOSScreenRecordingGeometry,
        _ observed: AOSDisplayTopologySnapshot
    ) throws {
        do {
            try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
                geometry,
                observedTopology: observed,
                windowFacts: []
            )
            fatalError("accepted topology drift")
        } catch AOSOperationCoreError.recordingTargetDrift { return }
    }

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fatalError(message) }
    }

    static func main() throws {
        let admitted = try AOSScreenRecordingRequest.validatingPublicValue(request())
        let audio = try AOSScreenRecordingRequest.validatingPublicValue(request(overrides: [
            "tracks": ["video": true, "system_audio": true, "microphone": false],
        ]))
        let microphone = try AOSScreenRecordingRequest.validatingPublicValue(request(overrides: [
            "tracks": ["video": true, "system_audio": false, "microphone": true],
        ]))
        require(audio.tracks.systemAudio, "explicit system audio was rejected")
        require(microphone.tracks.microphone, "explicit microphone was rejected")
        let geometry = try AOSScreenRecordingGeometryValidator.resolve(admitted)
        try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
            geometry,
            observedTopology: topology(),
            windowFacts: []
        )
        try expectDrift(geometry, topology(scale: 1.5))
        try expectDrift(geometry, topology(rotation: 90))
        try expectDrift(geometry, topology(peer: true))

        try expectInvalid(request(overrides: ["request_id": "bad id"]))
        try expectInvalid(request(overrides: ["duration_ms": true]))
        try expectInvalid(request(overrides: ["frame_rate": 29.5]))
        try expectInvalid(request(overrides: [
            "tracks": ["video": true, "system_audio": false, "microphone": "yes"],
        ]))
        for key in ["video", "system_audio", "microphone"] {
            for numericBoolean in [NSNumber(value: 0), NSNumber(value: 1)] {
                var tracks: [String: Any] = [
                    "video": true, "system_audio": false, "microphone": false,
                ]
                tracks[key] = numericBoolean
                try expectInvalid(request(overrides: ["tracks": tracks]))
            }
        }
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": true],
        ]))
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": 1.5],
        ]))
        try expectInvalid(request(overrides: [
            "target": ["kind": "display", "display_ordinal": 16],
        ]))

        require(aosExactOperationWireIdentity(
            ["artifact_id": "artifact-1", "artifact_generation": 1],
            idKey: "artifact_id",
            generationKey: "artifact_generation"
        ) == AOSOperationIdentity(id: "artifact-1", generation: 1), "valid selector rejected")
        for invalid: Any in [true, 1.5, NSNumber(value: UInt64.max)] {
            require(aosExactOperationWireIdentity(
                ["artifact_id": "artifact-1", "artifact_generation": invalid],
                idKey: "artifact_id",
                generationKey: "artifact_generation"
            ) == nil, "lossy selector accepted")
        }
        require(aosExactOperationWireIdentity(
            ["artifact_id": "bad id", "artifact_generation": 1],
            idKey: "artifact_id",
            generationKey: "artifact_generation"
        ) == nil, "malformed selector id accepted")
        require(aosArtifactReleaseDestinationPath(
            "/" + String(repeating: "x", count: 4_096)
        ) == nil, "oversized destination accepted")

        var timeline = AOSScreenRecordingProgressTimeline(maximumDurationMilliseconds: 1_000)
        require(timeline.elapsedMilliseconds(atNanoseconds: 4_000_000_000) == 0, "startup counted")
        require(timeline.admitCaptureStart(atNanoseconds: 5_000_000_000), "start not admitted")
        require(timeline.admitStop(atNanoseconds: 6_000_000_000), "stop not admitted")
        require(timeline.elapsedMilliseconds(atNanoseconds: 8_500_000_000) == 1_000, "drain counted")

        let bounds = admitted.requestedBounds
        var stored: [AOSOperationProgress] = []
        let progress = try aosPersistScreenRecordingProgress(
            frameCount: 4,
            byteCount: 512,
            elapsedMilliseconds: 1_000,
            bounds: bounds,
            trackSummary: progressSummary(videoSamples: 4)
        ) { stored.append($0) }
        require(progress.frameCount == 4 && progress.byteCount == 512, "nonzero progress lost")
        require(stored == [progress], "durable progress not published")
        let audioProgress = try aosPersistScreenRecordingProgress(
            frameCount: 0,
            byteCount: 256,
            elapsedMilliseconds: 500,
            bounds: bounds,
            trackSummary: progressSummary(
                videoSamples: 0,
                audioSamples: 2,
                systemAudio: true
            )
        ) { _ in }
        require(audioProgress.frameCount == 0 && audioProgress.byteCount == 256,
                "audio-only global progress was rejected")
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 5,
                byteCount: 512,
                elapsedMilliseconds: 500,
                bounds: bounds,
                trackSummary: progressSummary(videoSamples: 4)
            ) { _ in }
            fatalError("global video count exceeded per-track truth")
        } catch AOSOperationCoreError.recordingBoundsExceeded {}
        var reportedSuccess = false
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 5,
                byteCount: 640,
                elapsedMilliseconds: 1_000,
                bounds: bounds,
                trackSummary: progressSummary(videoSamples: 5)
            ) { _ in throw HarnessFailure.injectedSave }
            reportedSuccess = true
        } catch HarnessFailure.injectedSave {}
        require(!reportedSuccess, "save failure produced false success")
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 34,
                byteCount: 1_024,
                elapsedMilliseconds: 1_000,
                bounds: bounds,
                trackSummary: progressSummary(videoSamples: 34)
            ) { _ in }
            fatalError("unbounded frame progress accepted")
        } catch AOSOperationCoreError.recordingBoundsExceeded {}
        print("screen-recording-owner-harness: 31 assertions")
    }
}
`

const terminalSupportSource = String.raw`
import CoreGraphics
import Foundation

protocol AOSDesktopFrameCancelling: AnyObject {
    func cancel()
}

final class AOSDesktopPixelWarmSource: @unchecked Sendable {
    func cancel(_ completion: @escaping (Result<Void, Error>) -> Void) {
        completion(.success(()))
    }
}

enum AOSDesktopFrameCaptureFailure: Error {
    case captureFailed
    case retirementUncertain
}

struct AOSDesktopPixelExclusiveProducerLease: Equatable {
    let generation: UInt64
    let ownerID: String
}

final class AOSDesktopPixelBroker {
    static let defaultRetirementTimeout: TimeInterval = 1.05

    func acquireExclusiveProducer(ownerID: String) throws -> AOSDesktopPixelExclusiveProducerLease {
        fatalError("live broker unavailable in deterministic harness")
    }

    func releaseExclusiveProducer(_ lease: AOSDesktopPixelExclusiveProducerLease) -> Bool {
        false
    }
}

struct AOSDisplayTopologyBounds: Codable, Equatable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct AOSDisplayTopologyPoint: Codable, Equatable {
    let x: Double
    let y: Double
}

enum AOSDisplayTopologyMemberIdentity: Codable, Equatable {
    case displayIDFallback(UInt32)
}

struct AOSDisplayTopologyDisplay: Codable, Equatable {
    let runtimeDisplayID: UInt32
    let ordinal: Int
    let isMain: Bool
    let memberIdentity: AOSDisplayTopologyMemberIdentity
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let scaleFactor: Double
    let rotation: Double
}

struct AOSDisplayTopologySnapshot: Codable, Equatable {
    let identity: String
    let usesDisplayIDFallback: Bool
    let screensHaveSeparateSpaces: Bool
    let desktopWorldOriginNative: AOSDisplayTopologyPoint
    let nativeBounds: AOSDisplayTopologyBounds
    let nativeVisibleBounds: AOSDisplayTopologyBounds
    let desktopWorldBounds: AOSDisplayTopologyBounds
    let visibleDesktopWorldBounds: AOSDisplayTopologyBounds
    let displays: [AOSDisplayTopologyDisplay]
}

private func terminalBoundsValue(_ value: AOSDisplayTopologyBounds) -> [String: Any] {
    ["x": value.x, "y": value.y, "width": value.width, "height": value.height]
}

func aosDisplayTopologyWireValue(
    _ snapshot: AOSDisplayTopologySnapshot
) throws -> [String: Any] {
    [
        "schema": "aos.display-topology.v1",
        "identity": snapshot.identity,
        "uses_display_id_fallback": snapshot.usesDisplayIDFallback,
        "screens_have_separate_spaces": snapshot.screensHaveSeparateSpaces,
        "desktop_world_origin_native": [
            "x": snapshot.desktopWorldOriginNative.x,
            "y": snapshot.desktopWorldOriginNative.y,
        ],
        "native_bounds": terminalBoundsValue(snapshot.nativeBounds),
        "native_visible_bounds": terminalBoundsValue(snapshot.nativeVisibleBounds),
        "desktop_world_bounds": terminalBoundsValue(snapshot.desktopWorldBounds),
        "visible_desktop_world_bounds": terminalBoundsValue(snapshot.visibleDesktopWorldBounds),
        "displays": snapshot.displays.map { display in
            let member: [String: Any]
            switch display.memberIdentity {
            case .displayIDFallback(let id):
                member = ["kind": "display_id_fallback", "display_id_fallback": id]
            }
            return [
                "ordinal": display.ordinal,
                "is_main": display.isMain,
                "member_identity": member,
                "native_bounds": terminalBoundsValue(display.nativeBounds),
                "native_visible_bounds": terminalBoundsValue(display.nativeVisibleBounds),
                "desktop_world_bounds": terminalBoundsValue(display.desktopWorldBounds),
                "visible_desktop_world_bounds": terminalBoundsValue(display.visibleDesktopWorldBounds),
                "scale_factor": display.scaleFactor,
                "rotation": display.rotation,
            ]
        },
    ]
}

func validateAOSDisplayTopologyWireValue(
    _ value: Any
) throws -> AOSDisplayTopologySnapshot {
    guard let topology = value as? AOSDisplayTopologySnapshot else {
        throw AOSOperationCoreError.invalidRecord("topology")
    }
    return topology
}

struct CaptureApplicationFact { let processID: Int32 }
struct CaptureWindowFact {
    let frame: CGRect
    let owningApplication: CaptureApplicationFact?
    let windowID: Int
}

func observeDisplayTopologySnapshot() -> AOSDisplayTopologySnapshot {
    fatalError("native topology observation unavailable in deterministic harness")
}

func observeCaptureWindowFacts() -> [CaptureWindowFact] {
    fatalError("native window observation unavailable in deterministic harness")
}

func aosRunOnMainSync(_ operation: () -> Void) {
    operation()
}
`

const terminalHarnessSource = String.raw`
import AVFoundation
import CoreMedia
import Foundation

enum HarnessFault: Error {
    case link
    case removeSource
    case removeDestination
}

func harnessTrackSummary(
    systemAudio: Bool,
    microphone: Bool = false,
    videoSamples: UInt64 = 1,
    audioSamples: UInt64 = 0,
    microphoneSamples: UInt64 = 0,
    finalized: Bool = true,
    videoAvailable: Bool? = nil,
    audioAvailable: Bool? = nil,
    microphoneAvailable: Bool? = nil
) -> AOSScreenRecordingTrackSummary {
    func truth(
        selected: Bool,
        samples: UInt64,
        available: Bool?
    ) -> AOSScreenRecordingTrackTruth {
        AOSScreenRecordingTrackTruth(
            selected: selected,
            admitted: selected,
            available: available ?? (samples > 0),
            firstSamplePresent: samples > 0,
            sampleCount: samples,
            sampleByteCount: samples * 128,
            failureCode: nil,
            drained: !selected || finalized,
            finalized: !selected || finalized
        )
    }
    return AOSScreenRecordingTrackSummary(
        selectedTracks: AOSScreenRecordingTrackSummary.selectedTrackNames(
            systemAudio: systemAudio,
            microphone: microphone
        ),
        finalizedTracks: finalized ? AOSScreenRecordingTrackSummary.selectedTrackNames(
            systemAudio: systemAudio,
            microphone: microphone
        ) : [],
        commonMediaEpochNanoseconds: videoSamples > 0
            && (!systemAudio || audioSamples > 0)
            && (!microphone || microphoneSamples > 0)
            ? 1_000_000 : nil,
        video: truth(
            selected: true,
            samples: videoSamples,
            available: videoAvailable
        ),
        systemAudio: truth(
            selected: systemAudio,
            samples: audioSamples,
            available: audioAvailable
        ),
        microphone: truth(
            selected: microphone,
            samples: microphoneSamples,
            available: microphoneAvailable
        )
    )
}

final class OwnerBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: AOSDesktopPixelStartupOwner?

    func set(_ owner: AOSDesktopPixelStartupOwner) {
        lock.lock()
        stored = owner
        lock.unlock()
    }

    func get() -> AOSDesktopPixelStartupOwner? {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }
}

final class FakeLifecycle: AOSDesktopPixelStreamLifecycle, @unchecked Sendable {
    private let retirement = AOSDesktopPixelRetirementLatch()
    private let ready: () -> Bool

    init(ready: @escaping () -> Bool = { true }) { self.ready = ready }

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        retirement.admitExplicitStop()
    }

    func confirmRetirement() { retirement.observe() }
    func sampleIsReady() throws -> Bool { ready() }
    func retirementWasObserved() -> Bool { retirement.snapshot() }
    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await retirement.wait(timeout: timeout)
    }
}

final class NativeInterleaving: @unchecked Sendable {
    private let lock = NSLock()
    private var startCompletion: AOSDesktopPixelNativeCompletion?
    private var stopCompletion: AOSDesktopPixelNativeCompletion?
    private(set) var stopCount = 0

    func start(_ completion: @escaping AOSDesktopPixelNativeCompletion) {
        lock.lock()
        startCompletion = completion
        lock.unlock()
    }

    func stop(_ completion: @escaping AOSDesktopPixelNativeCompletion) {
        lock.lock()
        stopCount += 1
        stopCompletion = completion
        lock.unlock()
    }

    func startWasRequested() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return startCompletion != nil
    }

    func failStart() {
        lock.lock()
        let completion = startCompletion
        startCompletion = nil
        lock.unlock()
        completion?(.failure(HarnessFault.link))
    }

    func settleStop() {
        lock.lock()
        let completion = stopCompletion
        stopCompletion = nil
        lock.unlock()
        completion?(.success(()))
    }
}

final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 5_000_000_000

    func now() -> UInt64 {
        lock.lock()
        value += 1_000_000
        let result = value
        lock.unlock()
        return result
    }
}

final class FakeBroker: AOSScreenRecordingBrokerControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var lease: AOSDesktopPixelExclusiveProducerLease?
    private(set) var acquireCount = 0
    private(set) var releaseCount = 0

    func acquireExclusiveProducer(ownerID: String) throws -> AOSDesktopPixelExclusiveProducerLease {
        lock.lock()
        defer { lock.unlock() }
        guard lease == nil else { throw AOSDesktopFrameCaptureFailure.captureFailed }
        acquireCount += 1
        let admitted = AOSDesktopPixelExclusiveProducerLease(generation: 1, ownerID: ownerID)
        lease = admitted
        return admitted
    }

    func releaseExclusiveProducer(_ expected: AOSDesktopPixelExclusiveProducerLease) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard lease == expected else { return false }
        lease = nil
        releaseCount += 1
        return true
    }

    var retainsAuthority: Bool {
        lock.lock()
        defer { lock.unlock() }
        return lease != nil
    }
}

final class FakeFiles: @unchecked Sendable {
    enum Fault: Hashable { case link, removeSource, removeDestination }

    private let condition = NSCondition()
    private(set) var cleanupCount = 0
    var afterLink: (() -> Void)?
    var afterRemoveSource: (() -> Void)?
    var blockAfterLink = false
    var destinationPath = "/private/tmp/released-recording.mov"
    var destinationPresent = false
    var faults: Set<Fault> = []
    var sourcePresent = false
    private var linked = false
    private var resumeLink = false

    var identity: AOSArtifactFileIdentity { identity(summary: harnessTrackSummary(systemAudio: false)) }

    func identity(summary: AOSScreenRecordingTrackSummary) -> AOSArtifactFileIdentity {
        AOSArtifactFileIdentity(
            rootIdentityDigest: String(repeating: "1", count: 64),
            relativeLocatorDigest: String(repeating: "2", count: 64),
            device: 7,
            inode: 11,
            byteCount: 512,
            contentDigest: String(repeating: "3", count: 64),
            mediaType: summary.expectedMediaType,
            trackSummary: summary
        )
    }

    func dependencies() -> AOSScreenRecordingFileDependencies {
        AOSScreenRecordingFileDependencies(
            validateArtifact: { [self] _, _, _, summary in
                condition.lock(); defer { condition.unlock() }
                guard sourcePresent else { throw AOSOperationCoreError.artifactIdentityMismatch }
                return identity(summary: summary)
            },
            destinationIdentity: { [self] destination, _, source in
                condition.lock(); destinationPath = destination.path; condition.unlock()
                guard source == identity else { throw AOSOperationCoreError.artifactIdentityMismatch }
                return AOSArtifactReleaseDestinationIdentity(
                    absolutePath: destination.path,
                    pathDigest: String(repeating: "4", count: 64),
                    parentDevice: 7,
                    parentInode: 9
                )
            },
            observe: { [self] url, source, _ in
                condition.lock(); defer { condition.unlock() }
                guard source == identity else { return .conflicting }
                if url.path == destinationPath { return destinationPresent ? .exact : .absent }
                return sourcePresent ? .exact : .absent
            },
            linkDestination: { [self] _, destination, source, _ in
                condition.lock()
                guard !faults.contains(.link), source == identity,
                      sourcePresent, !destinationPresent else {
                    condition.unlock()
                    throw faults.contains(.link)
                        ? HarnessFault.link : AOSOperationCoreError.artifactDestinationExists
                }
                destinationPath = destination.path
                destinationPresent = true
                linked = true
                condition.broadcast()
                while blockAfterLink && !resumeLink { condition.wait() }
                condition.unlock()
                afterLink?()
                return AOSArtifactReleaseDestinationFileIdentity(
                    device: source.device,
                    inode: source.inode,
                    byteCount: source.byteCount,
                    contentDigest: source.contentDigest
                )
            },
            remove: { [self] url, allowAbsent in
                condition.lock()
                let destination = url.path == destinationPath
                if destination, faults.contains(.removeDestination) {
                    condition.unlock(); throw HarnessFault.removeDestination
                }
                if !destination, faults.contains(.removeSource) {
                    condition.unlock(); throw HarnessFault.removeSource
                }
                let present = destination ? destinationPresent : sourcePresent
                guard present || allowAbsent else {
                    condition.unlock(); throw AOSOperationCoreError.recordingCleanupRequired
                }
                if destination { destinationPresent = false } else {
                    sourcePresent = false
                    cleanupCount += 1
                }
                condition.unlock()
                if !destination { afterRemoveSource?() }
            },
            exists: { [self] url in
                condition.lock(); defer { condition.unlock() }
                return url.path == destinationPath ? destinationPresent : sourcePresent
            }
        )
    }

    func waitUntilLinked() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(0.2)
        while !linked, condition.wait(until: deadline) {}
        let result = linked
        condition.unlock()
        return result
    }

    func resumeLinkedRelease() {
        condition.lock(); resumeLink = true; condition.broadcast(); condition.unlock()
    }

    func setSourcePresent(_ value: Bool) {
        condition.lock(); sourcePresent = value; condition.unlock()
    }

    func reset(destination: Bool = false, source: Bool = true) {
        condition.lock()
        destinationPresent = destination
        sourcePresent = source
        faults = []
        linked = false
        resumeLink = false
        condition.unlock()
    }
}

final class FakeEncoder: AOSScreenRecordingEncoding, @unchecked Sendable {
    private let files: FakeFiles
    private let lock = NSLock()
    private var frames: UInt64 = 0
    private var audioSamples: UInt64 = 0
    private var microphoneSamples: UInt64 = 0
    private var bytes: UInt64 = 0
    private var systemAudioSelected = false
    private var microphoneSelected = false
    private var videoAvailable = false
    private var audioAvailable = false
    private var microphoneAvailable = false
    private var finalized = false
    var finishFilePresent = true
    private(set) var cancelCount = 0

    init(files: FakeFiles) { self.files = files }

    var progress: AOSScreenRecordingEncoderProgress {
        lock.lock(); defer { lock.unlock() }
        let started = frames > 0
            && (!systemAudioSelected || audioSamples > 0)
            && (!microphoneSelected || microphoneSamples > 0)
        let summary = harnessTrackSummary(
            systemAudio: systemAudioSelected,
            microphone: microphoneSelected,
            videoSamples: frames,
            audioSamples: audioSamples,
            microphoneSamples: microphoneSamples,
            finalized: finalized,
            videoAvailable: videoAvailable,
            audioAvailable: audioAvailable,
            microphoneAvailable: microphoneAvailable
        )
        return AOSScreenRecordingEncoderProgress(
            frameCount: frames,
            byteCount: bytes,
            trackSummary: summary,
            sessionStarted: started
        )
    }

    func configure(_ tracks: AOSScreenRecordingTracks) {
        lock.lock()
        systemAudioSelected = tracks.systemAudio
        microphoneSelected = tracks.microphone
        lock.unlock()
    }

    func markAvailable(_ track: AOSScreenRecordingTrackKind) throws {
        lock.lock()
        switch track {
        case .video: videoAvailable = true
        case .systemAudio: audioAvailable = true
        case .microphone: microphoneAvailable = true
        }
        lock.unlock()
    }

    func record(_ track: AOSScreenRecordingTrackKind) {
        lock.lock()
        switch track {
        case .video: frames += 1
        case .systemAudio: audioSamples += 1
        case .microphone: microphoneSamples += 1
        }
        bytes += 128
        lock.unlock()
    }

    func append(
        _ sampleBuffer: CMSampleBuffer,
        track: AOSScreenRecordingTrackKind
    ) throws { record(track) }

    func appendMicrophone(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) throws {
        record(.microphone)
    }

    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void) {
        lock.lock()
        if systemAudioSelected && audioSamples == 0 {
            lock.unlock()
            completion(.failure(AOSOperationCoreError.recordingSystemAudioNoSamples))
            return
        }
        if microphoneSelected && microphoneSamples == 0 {
            lock.unlock()
            completion(.failure(AOSOperationCoreError.recordingMicrophoneNoSamples))
            return
        }
        finalized = true
        let summary = harnessTrackSummary(
            systemAudio: systemAudioSelected,
            microphone: microphoneSelected,
            videoSamples: frames,
            audioSamples: audioSamples,
            microphoneSamples: microphoneSamples,
            finalized: true,
            videoAvailable: videoAvailable,
            audioAvailable: audioAvailable,
            microphoneAvailable: microphoneAvailable
        )
        lock.unlock()
        files.setSourcePresent(finishFilePresent)
        completion(.success(files.identity(summary: summary)))
    }

    func cancel() { lock.lock(); cancelCount += 1; lock.unlock() }
}

final class FakeMicrophoneBackend: @unchecked Sendable {
    private let lock = NSLock()
    private var running = false
    private var handler: AOSMicrophoneNativeInputHandler?
    private var sampleTime: Int64 = 0
    private(set) var startCount = 0
    private(set) var stopCount = 0
    var startFailure: AOSOperationCoreError?

    func dependencies() -> AOSMicrophoneNativeSessionDependencies {
        AOSMicrophoneNativeSessionDependencies(
            start: { [self] handler in
                lock.lock()
                startCount += 1
                let failure = startFailure
                if failure == nil {
                    running = true
                    self.handler = handler
                }
                lock.unlock()
                if let failure { throw failure }
                _ = publish()
                return format()
            },
            healthy: { [self] in
                lock.lock(); defer { lock.unlock() }; return running
            },
            stop: { [self] in
                lock.lock()
                stopCount += 1
                running = false
                handler = nil
                lock.unlock()
                return true
            }
        )
    }

    func publish() -> Bool {
        lock.lock()
        guard running, let handler else { lock.unlock(); return false }
        sampleTime += 1
        let time = sampleTime
        lock.unlock()
        let value = format()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: value, frameCapacity: 1) else {
            return false
        }
        buffer.frameLength = 1
        handler(buffer, AVAudioTime(sampleTime: time, atRate: value.sampleRate))
        return true
    }

    private func format() -> AVAudioFormat {
        AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
    }
}

final class FakeNativeSession: @unchecked Sendable {
    let encoder: FakeEncoder
    let lifecycle: FakeLifecycle
    let microphone: AOSMicrophoneNativeSession
    let microphoneBackend: FakeMicrophoneBackend
    let signal = AOSDesktopPixelStartupSignal()
    private var frameGate: AOSDesktopPixelFrameAdmissionGate?
    private var failureSink: AOSScreenRecordingFailureSink?
    private var heldFrame: AOSDesktopPixelFrameAdmissionGate.Token?
    private let lock = NSLock()
    private var progress: AOSScreenRecordingProgressSink?
    private var startCompletion: AOSDesktopPixelNativeCompletion?
    private var stopCompletion: AOSDesktopPixelNativeCompletion?
    private(set) var stopCount = 0
    private(set) var geometryUpdateCount = 0
    private(set) var lastGeometry: AOSScreenRecordingGeometry?

    init(files: FakeFiles) {
        let encoder = FakeEncoder(files: files)
        let microphoneBackend = FakeMicrophoneBackend()
        self.encoder = encoder
        self.microphoneBackend = microphoneBackend
        microphone = AOSMicrophoneNativeSession(
            dependencies: microphoneBackend.dependencies()
        )
        lifecycle = FakeLifecycle { encoder.progress.sessionStarted }
    }

    func factory() -> AOSScreenRecordingSessionFactory {
        { [self] tracks, gate, progress, didFail in
            encoder.configure(tracks)
            try encoder.markAvailable(.video)
            if tracks.systemAudio { try encoder.markAvailable(.systemAudio) }
            installFactoryDependencies(
                gate: gate,
                progress: progress,
                failureSink: didFail
            )
            let microphoneInput = tracks.microphone
                ? AOSScreenRecordingMicrophoneInput(
                    session: microphone,
                    encoder: encoder,
                    frameAdmission: gate,
                    startup: signal,
                    persistProgress: progress,
                    didFail: didFail
                ) : nil
            return AOSScreenRecordingNativeSession(
                encoder: encoder,
                lifecycle: lifecycle,
                signal: signal,
                start: { [self] completion in
                    if tracks.microphone {
                        do { try microphoneInput?.start() }
                        catch { completion(.failure(error)); return }
                    }
                    lock.lock(); startCompletion = completion; lock.unlock()
                },
                stop: { [self] completion in
                    if tracks.microphone { _ = microphoneInput?.stop() }
                    lock.lock(); stopCount += 1; stopCompletion = completion; lock.unlock()
                },
                updateGeometry: { [self] geometry, completion in
                    lock.lock()
                    geometryUpdateCount += 1
                    lastGeometry = geometry
                    lock.unlock()
                    completion(.success(()))
                },
                microphoneSession: tracks.microphone ? microphone : nil
            )
        }
    }

    private func installFactoryDependencies(
        gate: AOSDesktopPixelFrameAdmissionGate,
        progress: @escaping AOSScreenRecordingProgressSink,
        failureSink: @escaping AOSScreenRecordingFailureSink
    ) {
        lock.lock()
        frameGate = gate
        self.progress = progress
        self.failureSink = failureSink
        lock.unlock()
    }

    func startWasRequested() -> Bool {
        lock.lock(); defer { lock.unlock() }; return startCompletion != nil
    }

    func settleStart(_ result: Result<Void, Error>) {
        lock.lock(); let completion = startCompletion; startCompletion = nil; lock.unlock()
        completion?(result)
    }

    func settleStop(_ result: Result<Void, Error>) {
        lock.lock(); let completion = stopCompletion; stopCompletion = nil; lock.unlock()
        completion?(result)
    }

    func publishFrame(hold: Bool = false) throws -> Bool {
        try publish(.video, hold: hold)
    }

    func publishAudio(hold: Bool = false) throws -> Bool {
        try publish(.systemAudio, hold: hold)
    }

    func publishMicrophone(hold: Bool = false) throws -> Bool {
        precondition(!hold, "microphone callback holding is not supported")
        let before = encoder.progress.trackSummary.microphone.sampleCount
        guard microphoneBackend.publish() else { return false }
        return encoder.progress.trackSummary.microphone.sampleCount > before
    }

    private func publish(
        _ track: AOSScreenRecordingTrackKind,
        hold: Bool
    ) throws -> Bool {
        lock.lock(); let gate = frameGate; let progress = self.progress; lock.unlock()
        guard let token = gate?.admit() else { return false }
        encoder.record(track)
        try progress?(encoder.progress)
        if encoder.progress.sessionStarted { signal.succeed() }
        if hold { lock.lock(); heldFrame = token; lock.unlock() } else { token.complete() }
        return true
    }

    func completeHeldFrame() {
        lock.lock(); let token = heldFrame; heldFrame = nil; lock.unlock(); token?.complete()
    }

    func injectCallbackFailure(_ error: Error) {
        lock.lock(); let sink = failureSink; lock.unlock()
        sink?(error)
    }
}

final class AdmissionFaultStore: AOSOperationStateStore, @unchecked Sendable {
    private let lock = NSLock()
    private let failingSaveCalls: Set<Int>
    private var saveCallCount = 0
    private var value: AOSOperationDurableState?
    private(set) var savedStates: [AOSOperationDurableState] = []

    init(failingSaveCall: Int) {
        failingSaveCalls = [failingSaveCall]
    }

    init(failingSaveCalls: Set<Int>) {
        self.failingSaveCalls = failingSaveCalls
    }

    func load() throws -> AOSOperationDurableState? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        saveCallCount += 1
        if failingSaveCalls.contains(saveCallCount) {
            throw AOSOperationCoreError.storeUnavailable
        }
        value = state
        savedStates.append(state)
    }
}

final class StopGeometryFaultStore: AOSOperationStateStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: AOSOperationDurableState?
    private(set) var geometryFailureCount = 0

    func load() throws -> AOSOperationDurableState? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        if geometryFailureCount == 0,
           state.operations.contains(where: { candidate in
               candidate.screenRecordingGeometry?.deadlineState == .stopped
                   && value?.operations.first(where: {
                       $0.identity == candidate.identity
                   })?.screenRecordingGeometry?.deadlineState != .stopped
           }) {
            geometryFailureCount += 1
            throw AOSOperationCoreError.storeUnavailable
        }
        value = state
    }
}

final class StopAdmissionBarrierStore: AOSOperationStateStore, @unchecked Sendable {
    private let condition = NSCondition()
    private let firstIntent: AOSStopIntent
    private var admissionEntered = false
    private var admissionReleased = false
    private var value: AOSOperationDurableState?

    init(firstIntent: AOSStopIntent) {
        self.firstIntent = firstIntent
    }

    func load() throws -> AOSOperationDurableState? {
        condition.lock()
        defer { condition.unlock() }
        return value
    }

    func save(_ state: AOSOperationDurableState) throws {
        condition.lock()
        if !admissionEntered, state.operations.contains(where: { candidate in
            candidate.stopIntent == firstIntent
                && value?.operations.first(where: {
                    $0.identity == candidate.identity
                })?.stopIntent == nil
        }) {
            admissionEntered = true
            condition.broadcast()
            while !admissionReleased { condition.wait() }
        }
        value = state
        condition.unlock()
    }

    func waitForAdmission() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while !admissionEntered, condition.wait(until: deadline) {}
        let result = admissionEntered
        condition.unlock()
        return result
    }

    func releaseAdmission() {
        condition.lock()
        admissionReleased = true
        condition.broadcast()
        condition.unlock()
    }
}

final class FakeMicrophoneRegistrationAdapter: AOSOperationControlAdapter {
    let registration: AOSOperationAdapterRegistration

    init() throws {
        registration = AOSOperationAdapterRegistration(
            id: AOSMicrophoneOperationResourceIdentity.adapterRegistrationID,
            revision: AOSMicrophoneOperationResourceIdentity.adapterRegistrationRevision,
            operationClass: "audio-capture",
            capabilityIDs: ["microphone-capture-adapter"],
            resourceDeclarations: [try AOSResourceDeclaration.make(
                adapterRegistrationID: AOSMicrophoneOperationResourceIdentity.adapterRegistrationID,
                adapterRegistrationRevision: AOSMicrophoneOperationResourceIdentity.adapterRegistrationRevision,
                resourceKey: AOSMicrophoneOperationResourceIdentity.resourceKey,
                admissionMode: .exclusive
            )]
        )
    }

    func admitStop(
        operation: AOSOperationIdentity,
        admission: AOSOperationStopAdmissionTransaction
    ) throws -> AOSAdapterStopResult {
        _ = try admission.commit()
        return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? { nil }
}

final class FakeMicrophoneAuthorization: @unchecked Sendable {
    private let lock = NSLock()
    private var state: AOSMicrophoneAuthorizationState
    private let requestedState: AOSMicrophoneAuthorizationState
    private(set) var requestCount = 0

    init(
        state: AOSMicrophoneAuthorizationState,
        requestedState: AOSMicrophoneAuthorizationState = .authorized
    ) {
        self.state = state
        self.requestedState = requestedState
    }

    func dependencies() -> AOSScreenRecordingMicrophoneAuthorizationDependencies {
        AOSScreenRecordingMicrophoneAuthorizationDependencies(
            status: { [self] in lock.lock(); defer { lock.unlock() }; return state },
            request: { [self] _ in
                lock.lock()
                let before = state
                requestCount += 1
                state = requestedState
                lock.unlock()
                return AOSMicrophoneAuthorizationRequestResult(
                    before: before,
                    after: requestedState,
                    attempted: true,
                    completed: true
                )
            }
        )
    }
}

final class FakeOperationEventCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [[String: Any]] = []

    func receive(event: String, data: [String: Any]) {
        let bytes = envelopeBytes(service: "operation", event: event, data: data)!
        let envelope = try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        lock.lock(); values.append(envelope); lock.unlock()
    }

    func snapshot() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }; return values
    }
}

final class FollowActivationBarrier: @unchecked Sendable {
    private let condition = NSCondition()
    private var activationEntered = false
    private var activationReleased = false
    private var stopAttempted = false

    func observe() {
        condition.lock()
        activationEntered = true
        condition.broadcast()
        while !activationReleased { condition.wait() }
        condition.unlock()
    }

    func waitForActivation() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while !activationEntered, condition.wait(until: deadline) {}
        let result = activationEntered
        condition.unlock()
        return result
    }

    func markStopAttempted() {
        condition.lock(); stopAttempted = true; condition.broadcast(); condition.unlock()
    }

    func waitForStopAttempt() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while !stopAttempted, condition.wait(until: deadline) {}
        let result = stopAttempted
        condition.unlock()
        return result
    }

    func releaseActivation() {
        condition.lock(); activationReleased = true; condition.broadcast(); condition.unlock()
    }
}

final class RuntimeInstallationBarrier: @unchecked Sendable {
    private let condition = NSCondition()
    private var installationEntered = false
    private var installationReleased = false
    private var runtimeStartCount = 0

    func observe() {
        condition.lock()
        installationEntered = true
        condition.broadcast()
        while !installationReleased { condition.wait() }
        condition.unlock()
    }

    func waitForInstallation() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while !installationEntered, condition.wait(until: deadline) {}
        let result = installationEntered
        condition.unlock()
        return result
    }

    func releaseInstallation() {
        condition.lock()
        installationReleased = true
        condition.broadcast()
        condition.unlock()
    }

    func observeRuntimeStart() {
        condition.lock()
        runtimeStartCount += 1
        condition.unlock()
    }

    func observedRuntimeStartCount() -> Int {
        condition.lock()
        defer { condition.unlock() }
        return runtimeStartCount
    }
}

final class PreparedPublicationBarrier: @unchecked Sendable {
    private let condition = NSCondition()
    private var operation: AOSOperationIdentity?
    private var publicationReleased = false
    private var stopAdmissionEntered = false
    private var stopCompleted = false

    func observePublication(_ value: AOSOperationIdentity) {
        condition.lock()
        operation = value
        condition.broadcast()
        while !publicationReleased { condition.wait() }
        condition.unlock()
    }

    func waitForPublication() -> AOSOperationIdentity? {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while operation == nil, condition.wait(until: deadline) {}
        let result = operation
        condition.unlock()
        return result
    }

    func observeStopAdmission() {
        condition.lock()
        stopAdmissionEntered = true
        condition.broadcast()
        condition.unlock()
    }

    func waitForStopAdmission() -> Bool {
        condition.lock()
        let deadline = Date().addingTimeInterval(1)
        while !stopAdmissionEntered, condition.wait(until: deadline) {}
        let result = stopAdmissionEntered
        condition.unlock()
        return result
    }

    func markStopCompleted() {
        condition.lock()
        stopCompleted = true
        condition.broadcast()
        condition.unlock()
    }

    func didStopComplete() -> Bool {
        condition.lock()
        defer { condition.unlock() }
        return stopCompleted
    }

    func releasePublication() {
        condition.lock()
        publicationReleased = true
        condition.broadcast()
        condition.unlock()
    }
}

final class RecordingEnvironment {
    let adapter: AOSScreenRecordingOperationAdapter
    let broker = FakeBroker()
    let clock = FakeClock()
    let control: AOSOperationControlPlane
    let events: FakeOperationEventCapture
    let files: FakeFiles
    let native: FakeNativeSession
    let microphoneAdapter: FakeMicrophoneRegistrationAdapter
    let microphoneAuthorization: FakeMicrophoneAuthorization
    let owner = AOSMechanicalOwnerRoot(
        ownerID: "recording-owner", effectiveUID: 501, pid: 100, pidGeneration: 3,
        executableIdentityDigest: String(repeating: "a", count: 64)
    )
    let registry: AOSOperationRegistry
    let store: AOSOperationStateStore

    init(
        store existingStore: AOSOperationStateStore? = nil,
        files existingFiles: FakeFiles? = nil,
        sessionFailure: AOSOperationCoreError? = nil,
        microphoneAuthorizationState: AOSMicrophoneAuthorizationState = .authorized,
        requestedMicrophoneAuthorizationState: AOSMicrophoneAuthorizationState = .authorized,
        startupTimeout: TimeInterval = aosDesktopPixelStreamRetirementTimeout,
        followActivationObserver: @escaping () -> Void = {},
        preparedPublicationObserver: @escaping (AOSOperationIdentity) -> Void = { _ in },
        runtimeInstallationObserver: @escaping () -> Void = {},
        runtimeStartObserver: @escaping () -> Void = {},
        stopAdmissionObserver: @escaping () -> Void = {}
    ) throws {
        let eventCapture = FakeOperationEventCapture()
        events = eventCapture
        files = existingFiles ?? FakeFiles()
        native = FakeNativeSession(files: files)
        microphoneAdapter = try FakeMicrophoneRegistrationAdapter()
        microphoneAuthorization = FakeMicrophoneAuthorization(
            state: microphoneAuthorizationState,
            requestedState: requestedMicrophoneAuthorizationState
        )
        let registration = try AOSScreenRecordingOperationAdapter.makeRegistration()
        let registrations = try AOSAdapterRegistrySnapshot.make(
            revision: 2,
            registrations: [microphoneAdapter.registration, registration]
        )
        store = existingStore ?? AOSInMemoryOperationStateStore()
        var nextID = 0
        registry = try AOSOperationRegistry(
            store: store,
            daemonGeneration: 7,
            adapterRegistry: registrations,
            clock: { [clock] in clock.now() },
            idFactory: { nextID += 1; return "recording-\(nextID)" }
        )
        if registry.snapshot().barrier.state == .bootReconciling {
            _ = try registry.mutateDurably { state in
                let generation = state.allocateGeneration()
                state.barrier.state = .open
                state.barrier.generation = generation
                state.barrier.openSnapshot = try AOSOpenBarrierSnapshot.make(
                    barrierGeneration: generation,
                    registry: state.adapterRegistry
                )
            }
        }
        control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
        let selectedFactory: AOSScreenRecordingSessionFactory
        if let sessionFailure {
            selectedFactory = { _, _, _, _ in throw sessionFailure }
        } else {
            selectedFactory = native.factory()
        }
        adapter = try AOSScreenRecordingOperationAdapter(
            registry: registry,
            registration: registration,
            broker: broker,
            artifactRootURL: URL(fileURLWithPath: "/private/tmp/aos-recording-artifacts"),
            contextResolver: { [owner] _ in
                AOSScreenRecordingOperationContext(
                    ownerRoot: owner,
                    attribution: AOSOperationAttribution(taskID: "recording-task")
                )
            },
            files: files.dependencies(),
            sessionFactory: selectedFactory,
            microphoneAuthorization: microphoneAuthorization.dependencies(),
            startupTimeout: startupTimeout,
            topologyObserver: Self.topology,
            windowObserver: Self.windows,
            followActivationObserver: followActivationObserver,
            preparedPublicationObserver: preparedPublicationObserver,
            runtimeInstallationObserver: runtimeInstallationObserver,
            runtimeStartObserver: runtimeStartObserver,
            stopAdmissionObserver: stopAdmissionObserver,
            operationEventSink: { event, data in
                eventCapture.receive(event: event, data: data)
            }
        )
        try registry.installRuntimeAdapters([microphoneAdapter, adapter])
    }

    func controlContext() -> AOSOrdinaryControlContext {
        AOSOrdinaryControlContext(
            expectedDaemonGeneration: 7,
            connectionEpoch: 9,
            caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
                auditTokenDigest: String(repeating: "c", count: 64),
                effectiveUID: 501,
                pid: owner.pid,
                pidGeneration: owner.pidGeneration
            )),
            authenticatedOwnerRoot: owner
        )
    }

    func cancel(_ operation: AOSOperationIdentity) throws -> AOSOperationControlReceipt {
        try control.cancel(context: controlContext(), operation: operation)
    }

    func kill(_ operation: AOSOperationIdentity) throws -> AOSOperationControlReceipt {
        try control.kill(context: controlContext(), operation: operation)
    }

    func settlePreviouslyAdmittedStop(
        _ operation: AOSOperationIdentity
    ) throws -> AOSAdapterStopResult {
        try adapter.admitStop(
            operation: operation,
            admission: AOSOperationStopAdmissionTransaction { [registry] in
                AOSOperationStopAdmissionResult(
                    operation: try registry.inspect(operation),
                    wasAlreadyAdmitted: true
                )
            }
        )
    }

    func request(
        systemAudio: Bool = false,
        microphone: Bool = false,
        followed: Bool = false
    ) throws -> AOSScreenRecordingRequest {
        let topology = Self.topology()
        let target: [String: Any] = followed
            ? [
                "kind": "region", "display_ordinal": 1,
                "global_bounds": ["x": 10, "y": 10, "width": 40, "height": 30],
            ]
            : ["kind": "display", "display_ordinal": 1]
        let geometry: [String: Any] = followed
            ? [
                "mode": "caller_followed",
                "binding": Self.binding(observation: 1, state: 1),
                "update_interval_ms": 16,
                "update_deadline_ms": 500,
            ]
            : ["mode": "fixed"]
        return try AOSScreenRecordingRequest.validatingPublicValue([
            "schema_version": "aos.screen-recording.request.v1",
            "request_id": "recording-request",
            "canonical_parameter_digest": String(repeating: "b", count: 64),
            "topology": topology,
            "target": target,
            "geometry": geometry,
            "duration_ms": 1_000, "frame_rate": 30,
            "max_pixel_count": 1_000_000, "max_queue_frames": 3,
            "max_output_bytes": 10_000,
            "tracks": [
                "video": true,
                "system_audio": systemAudio,
                "microphone": microphone,
            ],
            "codec": "h264", "container": "quicktime",
        ])
    }

    static func topology() -> AOSDisplayTopologySnapshot {
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        return AOSDisplayTopologySnapshot(
            identity: "topology", usesDisplayIDFallback: true,
            screensHaveSeparateSpaces: false,
            desktopWorldOriginNative: AOSDisplayTopologyPoint(x: 0, y: 0),
            nativeBounds: bounds, nativeVisibleBounds: bounds,
            desktopWorldBounds: bounds, visibleDesktopWorldBounds: bounds,
            displays: [AOSDisplayTopologyDisplay(
                runtimeDisplayID: 1, ordinal: 1, isMain: true,
                memberIdentity: .displayIDFallback(1), nativeBounds: bounds,
                nativeVisibleBounds: bounds, desktopWorldBounds: bounds,
                visibleDesktopWorldBounds: bounds, scaleFactor: 2, rotation: 0
            )]
        )
    }

    static func binding(observation: Int, state: Int) -> [String: Any] {
        func identity(_ id: String, _ generation: Int) -> [String: Any] {
            ["id": id, "generation": generation]
        }
        return [
            "target": identity("target", 1),
            "observation": identity("observation", observation),
            "state": identity("state", state),
            "session": identity("session", 1),
            "navigation": identity("navigation", 1),
            "frame": identity("frame", 1),
            "source_window": ["window_id": 77, "owner_pid": 700],
        ]
    }

    static func windows() -> [CaptureWindowFact] {
        [CaptureWindowFact(
            frame: CGRect(x: 0, y: 0, width: 100, height: 80),
            owningApplication: CaptureApplicationFact(processID: 700),
            windowID: 77
        )]
    }

    func offeredArtifact() throws -> AOSOperationIdentity {
        let operation = try registry.prepareOperation(
            ownerRoot: owner,
            attribution: AOSOperationAttribution(taskID: "custody-task"),
            capabilityID: AOSScreenRecordingOperationAdapter.capabilityID,
            adapterRegistrationID: adapter.registration.id,
            adapterRegistrationRevision: adapter.registration.revision
        )
        let summary = harnessTrackSummary(systemAudio: false)
        let artifact = try registry.prepareArtifact(
            parent: operation.identity,
            trackSummary: summary
        )
        files.setSourcePresent(true)
        _ = try registry.updateArtifact(
            artifact.identity,
            state: .offered,
            fileIdentity: files.identity,
            trackSummary: summary,
            custodyDigest: files.identity.contentDigest
        )
        return artifact.identity
    }

    func holdStandaloneMicrophoneClaim() throws -> AOSOperationIdentity {
        let initial = registry.snapshot()
        guard let declaration = initial.adapterRegistry.declaration(
            resourceKey: AOSMicrophoneOperationResourceIdentity.resourceKey
        ) else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        let operation = try registry.prepareOperation(
            ownerRoot: owner,
            attribution: AOSOperationAttribution(taskID: "standalone-microphone-task"),
            capabilityID: "microphone-capture-adapter",
            adapterRegistrationID: microphoneAdapter.registration.id,
            adapterRegistrationRevision: microphoneAdapter.registration.revision
        )
        let resourceGeneration = initial.resourceClaims
            .filter { $0.resourceKey == declaration.resourceKey }
            .map(\.resourceGeneration).max() ?? 0
        let transaction = try AOSOperationResourceTransaction.prepare(
            registry: registry,
            operation: operation.identity,
            expectedBarrierGeneration: initial.barrier.generation,
            expectedAdapterRegistry: initial.adapterRegistry,
            requests: [AOSResourceClaimRequest(
                adapterRegistrationID: declaration.adapterRegistrationID,
                adapterRegistrationRevision: declaration.adapterRegistrationRevision,
                resourceKey: declaration.resourceKey,
                admissionMode: declaration.admissionMode,
                resourceDeclarationDigest: declaration.declarationDigest,
                expectedResourceGeneration: resourceGeneration,
                expectedBrokerGeneration: nil,
                expectedSubscriberSetRevision: nil,
                expectedSubscriberSetCount: nil,
                expectedSubscriberSetDigest: nil
            )]
        )
        _ = try AOSOperationResourceTransaction.beginReservation(
            registry: registry,
            transactionID: transaction.transactionID
        )
        _ = try AOSOperationResourceTransaction.commit(
            registry: registry,
            transactionID: transaction.transactionID
        )
        _ = try AOSOperationResourceTransaction.completeHandoff(
            registry: registry,
            transactionID: transaction.transactionID
        )
        _ = try registry.transitionOperation(operation.identity, to: .starting)
        return operation.identity
    }
}

final class FakeMultitrackWriter: @unchecked Sendable {
    private let lock = NSLock()
    private var ready: [AOSScreenRecordingTrackKind: Bool] = [
        .video: true, .systemAudio: true, .microphone: true,
    ]
    private(set) var appended: [AOSScreenRecordingTrackKind: [CMTime]] = [
        .video: [], .systemAudio: [], .microphone: [],
    ]
    private(set) var finishCount = 0
    private(set) var inputFinishCount: [AOSScreenRecordingTrackKind: Int] = [
        .video: 0, .systemAudio: 0, .microphone: 0,
    ]
    private(set) var sessionEpoch: CMTime?
    private(set) var startCount = 0
    var startSucceeds = true
    var finishSucceeds = true
    private var writing = false

    func setReady(_ kind: AOSScreenRecordingTrackKind, _ value: Bool) {
        lock.lock(); ready[kind] = value; lock.unlock()
    }

    func forceNotWriting() {
        lock.lock(); writing = false; lock.unlock()
    }

    func writerDependencies() -> AOSScreenRecordingWriterDependencies {
        AOSScreenRecordingWriterDependencies(
            startWriting: { [self] in
                lock.lock(); defer { lock.unlock() }
                startCount += 1
                writing = startSucceeds
                return startSucceeds
            },
            startSession: { [self] epoch in
                lock.lock(); sessionEpoch = epoch; lock.unlock()
            },
            isWriting: { [self] in
                lock.lock(); defer { lock.unlock() }; return writing
            },
            finish: { [self] completion in
                lock.lock(); finishCount += 1; writing = false; lock.unlock()
                completion(finishSucceeds)
            },
            cancel: { [self] in
                lock.lock(); writing = false; lock.unlock()
            }
        )
    }

    func input(_ kind: AOSScreenRecordingTrackKind) -> AOSScreenRecordingWriterInputDependencies {
        AOSScreenRecordingWriterInputDependencies(
            isReady: { [self] in
                lock.lock(); defer { lock.unlock() }; return ready[kind] == true
            },
            append: { [self] buffer in
                lock.lock()
                appended[kind, default: []].append(
                    CMSampleBufferGetPresentationTimeStamp(buffer)
                )
                lock.unlock()
                return true
            },
            markFinished: { [self] in
                lock.lock(); inputFinishCount[kind, default: 0] += 1; lock.unlock()
            }
        )
    }
}

func harnessSample(_ value: Int64, byteCount: Int = 16) -> CMSampleBuffer {
    var block: CMBlockBuffer?
    let blockStatus = CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: max(byteCount, 1),
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: max(byteCount, 1),
        flags: 0,
        blockBufferOut: &block
    )
    precondition(blockStatus == noErr, "sample block creation failed")
    var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: 1_000),
        presentationTimeStamp: CMTime(value: value, timescale: 1_000),
        decodeTimeStamp: .invalid
    )
    var size = byteCount
    var sample: CMSampleBuffer?
    let sampleStatus = CMSampleBufferCreateReady(
        allocator: kCFAllocatorDefault,
        dataBuffer: block,
        formatDescription: nil,
        sampleCount: 1,
        sampleTimingEntryCount: 1,
        sampleTimingArray: &timing,
        sampleSizeEntryCount: 1,
        sampleSizeArray: &size,
        sampleBufferOut: &sample
    )
    precondition(sampleStatus == noErr && sample != nil, "sample creation failed")
    return sample!
}

func multitrackCoordinator(
    _ writer: FakeMultitrackWriter,
    systemAudio: Bool = true,
    microphone: Bool = false,
    maximumPending: Int = 3,
    omitAudioInput: Bool = false,
    omitMicrophoneInput: Bool = false
) throws -> AOSScreenRecordingMultitrackCoordinator {
    var inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies] = [
        .video: writer.input(.video),
    ]
    if !omitAudioInput { inputs[.systemAudio] = writer.input(.systemAudio) }
    if !omitMicrophoneInput { inputs[.microphone] = writer.input(.microphone) }
    let coordinator = try AOSScreenRecordingMultitrackCoordinator(
        systemAudioSelected: systemAudio,
        microphoneSelected: microphone,
        maximumPendingSamplesPerTrack: maximumPending,
        writer: writer.writerDependencies(),
        inputs: inputs,
        observeOutputBytes: { 512 }
    )
    try coordinator.markAvailable(.video)
    if systemAudio { try coordinator.markAvailable(.systemAudio) }
    if microphone { try coordinator.markAvailable(.microphone) }
    return coordinator
}

@main
struct TerminalLifecycleCustodyHarness {
    static func require(
        _ condition: @autoclosure () -> Bool,
        _ message: String
    ) {
        if !condition() { fatalError(message) }
    }

    static func expectInvalid(_ body: () throws -> Void) {
        do {
            try body()
            fatalError("invalid artifact action accepted")
        } catch AOSOperationCoreError.invalidRecord {
        } catch {
            fatalError("unexpected decoder error: \(error)")
        }
    }

    static func actionData(
        destination: Any? = nil,
        generation: Any = NSNumber(value: 7),
        extra: Bool = false,
        selectorExtra: Bool = false
    ) -> [String: Any] {
        var selector: [String: Any] = [
            "artifact_id": "artifact-1",
            "artifact_generation": generation,
        ]
        if selectorExtra { selector["extra"] = true }
        var value: [String: Any] = [
            "request_id": "request-1",
            "canonical_parameter_digest": String(repeating: "a", count: 64),
            "selector": selector,
        ]
        if let destination { value["destination"] = destination }
        if extra { value["extra"] = true }
        return value
    }

    static func wait(
        _ message: String,
        _ condition: @escaping () -> Bool
    ) async throws {
        for _ in 0..<500 {
            if condition() { return }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        fatalError(message)
    }

    static func operation(
        _ admission: AOSScreenRecordingAdmission,
        in environment: RecordingEnvironment
    ) -> AOSOperationRecord {
        environment.registry.snapshot().operations.first {
            $0.identity == admission.operation
        }!
    }

    static func projectionRow(
        phase: String,
        systemAudioSelected: Bool,
        microphoneSelected: Bool,
        operation: AOSOperationRecord,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let checkedAt = "2026-08-18T12:00:00.000Z"
        let selector: [String: Any] = [
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
        ]
        let snapshot = AOSOperationPublicProjection.snapshot(operation, state: state)
        let list = AOSOperationPublicProjection.list(
            action: operation.state == .terminal ? "recent" : "list",
            filters: [:],
            operations: [operation],
            state: state,
            checkedAt: checkedAt
        )
        let inspect = AOSOperationPublicProjection.inspect(
            action: "inspect",
            selector: selector,
            operation: operation,
            state: state,
            checkedAt: checkedAt
        )
        return [
            "phase": phase,
            "system_audio_selected": systemAudioSelected,
            "microphone_selected": microphoneSelected,
            "snapshot": snapshot,
            "list": list,
            "inspect": inspect,
        ]
    }

    static func withFailureCodes(
        _ value: AOSScreenRecordingTrackSummary,
        videoFailure: String?,
        systemAudioFailure: String?,
        microphoneFailure: String?
    ) -> AOSScreenRecordingTrackSummary {
        func track(
            _ truth: AOSScreenRecordingTrackTruth,
            failureCode: String?
        ) -> AOSScreenRecordingTrackTruth {
            AOSScreenRecordingTrackTruth(
                selected: truth.selected,
                admitted: truth.admitted,
                available: truth.available,
                firstSamplePresent: truth.firstSamplePresent,
                sampleCount: truth.sampleCount,
                sampleByteCount: truth.sampleByteCount,
                failureCode: failureCode,
                drained: truth.drained,
                finalized: truth.finalized
            )
        }
        return AOSScreenRecordingTrackSummary(
            selectedTracks: value.selectedTracks,
            finalizedTracks: value.finalizedTracks,
            commonMediaEpochNanoseconds: value.commonMediaEpochNanoseconds,
            video: track(value.video, failureCode: videoFailure),
            systemAudio: track(value.systemAudio, failureCode: systemAudioFailure),
            microphone: track(value.microphone, failureCode: microphoneFailure)
        )
    }

    static func requirePublicSummary(
        _ value: Any?,
        equals expected: AOSScreenRecordingTrackSummary,
        _ message: String
    ) throws {
        guard let actual = value as? [String: Any] else {
            fatalError("\(message): track summary missing")
        }
        let expectedValue = aosScreenRecordingTrackSummaryValue(expected)
        let actualData = try JSONSerialization.data(
            withJSONObject: actual,
            options: [.sortedKeys]
        )
        let expectedData = try JSONSerialization.data(
            withJSONObject: expectedValue,
            options: [.sortedKeys]
        )
        require(actualData == expectedData,
                "\(message): exact public per-track values drifted")
    }

    static func productionAtomicInitialSummaryAdmission() throws {
        var projections: [[String: Any]] = []
        let scenarios: [(Bool, Bool, Int)] = [
            (false, false, 4), (true, false, 4),
            (false, true, 4), (true, true, 4),
        ] + (5...11).map { (false, false, $0) }
        for (systemAudioSelected, microphoneSelected, failingSaveCall) in scenarios {
            let store = AdmissionFaultStore(failingSaveCall: failingSaveCall)
            let environment = try RecordingEnvironment(store: store)
            do {
                _ = try environment.adapter.start(
                    request: environment.request(
                        systemAudio: systemAudioSelected,
                        microphone: microphoneSelected
                    ),
                    connectionID: UUID()
                )
                fatalError("post-admission durable fault did not fail start")
            } catch AOSOperationCoreError.storeUnavailable {
            }

            guard let preparedState = store.savedStates.first(where: {
                $0.operations.count == 1
                    && $0.operations[0].state == .prepared
                    && $0.streams.isEmpty
                    && $0.artifacts.isEmpty
                    && $0.resourceTransactions.isEmpty
                    && $0.resourceClaims.isEmpty
            }) else {
                fatalError("atomic prepared state was not durably observable")
            }
            let expectedSummary = AOSScreenRecordingTrackSummary.initial(
                systemAudioSelected: systemAudioSelected,
                microphoneSelected: microphoneSelected
            )
            func terminalTruth(
                _ value: AOSScreenRecordingTrackTruth
            ) -> AOSScreenRecordingTrackTruth {
                AOSScreenRecordingTrackTruth(
                    selected: value.selected,
                    admitted: value.admitted,
                    available: value.available,
                    firstSamplePresent: value.firstSamplePresent,
                    sampleCount: value.sampleCount,
                    sampleByteCount: value.sampleByteCount,
                    failureCode: value.failureCode ?? (value.selected
                        ? AOSOperationCoreError.storeUnavailable.code : nil),
                    drained: value.selected ? true : value.drained,
                    finalized: value.finalized
                )
            }
            let expectedTerminalSummary = AOSScreenRecordingTrackSummary(
                selectedTracks: expectedSummary.selectedTracks,
                finalizedTracks: [],
                commonMediaEpochNanoseconds: nil,
                video: terminalTruth(expectedSummary.video),
                systemAudio: terminalTruth(expectedSummary.systemAudio),
                microphone: terminalTruth(expectedSummary.microphone)
            )
            let prepared = preparedState.operations[0]
            require(prepared.progress?.frameCount == 0
                        && prepared.progress?.byteCount == 0
                        && prepared.progress?.elapsedMilliseconds == 0
                        && prepared.progress?.droppedFrameCount == 0,
                    "atomic prepared state did not persist zero progress")
            require(prepared.progress?.trackSummary == expectedSummary,
                    "atomic prepared state lost exact selected-track truth")
            projections.append(projectionRow(
                phase: "prepared",
                systemAudioSelected: systemAudioSelected,
                microphoneSelected: microphoneSelected,
                operation: prepared,
                state: preparedState
            ))

            let terminalState = environment.registry.snapshot()
            let terminal = terminalState.operations[0]
            require(terminal.state == .terminal
                        && terminal.stopIntent == .adapterFailed
                        && terminal.outcome == .failed
                        && terminal.failureCode
                            == AOSOperationCoreError.storeUnavailable.code,
                    "post-publication durable fault did not terminal-clean")
            require(terminal.progress?.trackSummary == expectedTerminalSummary,
                    "terminal failure erased exact selected-track truth")
            let expectedStreamCount = failingSaveCall >= 5 ? 1 : 0
            let expectedArtifactCount = failingSaveCall >= 6 ? 1 : 0
            let expectedTransactionCount = failingSaveCall >= 7 ? 1 : 0
            let expectedClaimCount = failingSaveCall >= 9 ? 1 : 0
            require(terminalState.streams.count == expectedStreamCount
                        && terminalState.streams.allSatisfy { $0.state == .terminal }
                        && terminalState.artifacts.count == expectedArtifactCount
                        && terminalState.artifacts.allSatisfy { $0.state == .removed }
                        && terminalState.resourceTransactions.count
                            == expectedTransactionCount
                        && terminalState.resourceTransactions.allSatisfy {
                            $0.state == .terminal
                        }
                        && terminalState.resourceClaims.count == expectedClaimCount
                        && terminalState.resourceClaims.allSatisfy {
                            $0.state == .terminal
                        }
                        && !AOSOperationRegistry.hasNonterminalChildren(
                            in: terminalState,
                            operation: terminal.identity
                        ),
                    "post-publication fault did not close exact prepared children")
            require(!environment.broker.retainsAuthority,
                    "post-admission fault acquired broker authority")
            projections.append(projectionRow(
                phase: "terminal",
                systemAudioSelected: systemAudioSelected,
                microphoneSelected: microphoneSelected,
                operation: terminal,
                state: terminalState
            ))
        }
        do {
            let store = AdmissionFaultStore(failingSaveCalls: [4, 5])
            let environment = try RecordingEnvironment(store: store)
            do {
                _ = try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
                fatalError("consecutive preparation/cleanup faults did not fail start")
            } catch AOSOperationCoreError.storeUnavailable {
            }
            let state = environment.registry.snapshot()
            guard let operation = state.operations.first else {
                fatalError("consecutive preparation/cleanup faults lost operation")
            }
            require(operation.state == .terminal
                        && operation.stopIntent == .adapterFailed
                        && operation.outcome == .failed
                        && operation.failureCode
                            == AOSOperationCoreError.storeUnavailable.code
                        && operation.screenRecordingGeometry?.deadlineState == .stopped
                        && !AOSOperationRegistry.hasNonterminalChildren(
                            in: state,
                            operation: operation.identity
                        ),
                    "consecutive preparation/cleanup faults lost exact settlement")
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "consecutive preparation/cleanup faults acquired authority")
        }
        let data = try JSONSerialization.data(withJSONObject: projections, options: [.sortedKeys])
        print("atomic-initial-summary-projections:\(String(data: data, encoding: .utf8)!)")
    }

    static func productionAdmissionResponses() async throws {
        var responses: [[String: Any]] = []
        for (systemAudio, microphone) in [
            (false, false), (true, false), (false, true), (true, true),
        ] {
            let environment = try RecordingEnvironment()
            let request = try environment.request(
                systemAudio: systemAudio,
                microphone: microphone
            )
            let admission = try environment.adapter.start(
                request: request,
                connectionID: UUID()
            )
            responses.append(admission.publicValue(request: request))
            try await wait("admission-response native start missing") {
                environment.native.startWasRequested()
            }
            environment.native.settleStart(.success(()))
            _ = try environment.native.publishFrame()
            if systemAudio { _ = try environment.native.publishAudio() }
            if microphone { _ = try environment.native.publishMicrophone() }
            try await wait("admission-response operation inactive") {
                operation(admission, in: environment).state == .active
            }
            _ = try environment.cancel(admission.operation)
            try await wait("admission-response stop missing") {
                environment.native.stopCount == 1
            }
            environment.native.settleStop(.success(()))
            try await wait("admission-response operation did not close") {
                operation(admission, in: environment).state == .terminal
            }
        }
        let data = try JSONSerialization.data(withJSONObject: responses, options: [.sortedKeys])
        print("production-admission-responses:\(String(data: data, encoding: .utf8)!)")
    }

    static func requireWriterFailureTruth(
        _ summary: AOSScreenRecordingTrackSummary,
        sessionStarted: Bool,
        microphoneSelected: Bool
    ) {
        require(summary.selectedTracks == AOSScreenRecordingTrackSummary.selectedTrackNames(
            systemAudio: true,
            microphone: microphoneSelected
        ),
                "writer failure lost the selected set")
        require(summary.finalizedTracks.isEmpty,
                "writer failure claimed finalized tracks")
        require((summary.commonMediaEpochNanoseconds != nil) == sessionStarted,
                "writer failure common-epoch truth drifted")
        var failures = [
            (summary.video, AOSOperationCoreError.recordingEncoderFailed.code),
            (summary.systemAudio, AOSOperationCoreError.recordingSystemAudioFailed.code),
        ]
        if microphoneSelected {
            failures.append(
                (summary.microphone, AOSOperationCoreError.recordingMicrophoneFailed.code)
            )
        }
        for (truth, failureCode) in failures {
            require(truth.selected && truth.admitted && truth.available,
                    "writer failure lost selected/admitted/available truth")
            require(truth.firstSamplePresent,
                    "writer failure lost positive first-sample truth")
            require(truth.sampleCount > 0 && truth.sampleByteCount > 0,
                    "writer failure lost admitted positive-byte sample truth")
            require(truth.failureCode == failureCode,
                    "writer failure omitted a selected-track failure")
            require(!truth.drained && !truth.finalized,
                    "writer failure claimed drain or finalization")
        }
    }

    static func productionMultitrackCoordination() throws {
        let videoOnlyWriter = FakeMultitrackWriter()
        let videoOnly = try multitrackCoordinator(videoOnlyWriter, systemAudio: false)
        try videoOnly.append(harnessSample(1), track: .video)
        var videoOnlyIdentity: AOSArtifactFileIdentity?
        videoOnly.finish(identity: { summary in
            FakeFiles().identity(summary: summary)
        }) { result in
            if case .success(let value) = result { videoOnlyIdentity = value }
        }
        require(videoOnlyIdentity?.trackSummary?.selectedTracks == ["video"],
                "video-only selected tracks drifted")
        require(videoOnlyIdentity?.trackSummary?.systemAudio.selected == false,
                "unselected audio became selected")
        require(videoOnlyIdentity?.trackSummary?.systemAudio.admitted == false,
                "unselected audio became admitted")
        require(videoOnlyIdentity?.trackSummary?.systemAudio.drained == true,
                "unselected audio was not vacuously drained")
        require(videoOnlyIdentity?.trackSummary?.systemAudio.finalized == true,
                "unselected audio was not vacuously finalized")
        require(videoOnlyIdentity?.trackSummary?.microphone.selected == false
                    && videoOnlyIdentity?.trackSummary?.microphone.admitted == false,
                "unselected microphone became selected or admitted")
        require(videoOnlyIdentity?.trackSummary?.microphone.drained == true
                    && videoOnlyIdentity?.trackSummary?.microphone.finalized == true,
                "unselected microphone was not vacuously settled")
        require(videoOnlyWriter.inputFinishCount[.systemAudio] == 0,
                "unselected audio input was finished")
        require(videoOnlyWriter.inputFinishCount[.microphone] == 0,
                "unselected microphone input was finished")

        for audioFirst in [true, false] {
            let writer = FakeMultitrackWriter()
            let coordinator = try multitrackCoordinator(writer)
            if audioFirst {
                try coordinator.append(harnessSample(20), track: .systemAudio)
                require(!coordinator.progress.sessionStarted, "audio-first started early")
                try coordinator.append(harnessSample(10), track: .video)
            } else {
                try coordinator.append(harnessSample(10), track: .video)
                require(!coordinator.progress.sessionStarted, "video-first started early")
                try coordinator.append(harnessSample(20), track: .systemAudio)
            }
            require(coordinator.progress.sessionStarted, "common barrier did not open")
            require(writer.startCount == 1, "writer session started more than once")
            require(writer.sessionEpoch == CMTime(value: 10, timescale: 1_000),
                    "common epoch did not select earliest first sample")
            require(coordinator.progress.trackSummary.video.sampleCount == 1,
                    "video count missing")
            require(coordinator.progress.trackSummary.systemAudio.sampleCount == 1,
                    "audio count missing")
        }

        let threeTrackOrders: [[AOSScreenRecordingTrackKind]] = [
            [.video, .systemAudio, .microphone],
            [.video, .microphone, .systemAudio],
            [.systemAudio, .video, .microphone],
            [.systemAudio, .microphone, .video],
            [.microphone, .video, .systemAudio],
            [.microphone, .systemAudio, .video],
        ]
        for order in threeTrackOrders {
            let writer = FakeMultitrackWriter()
            let coordinator = try multitrackCoordinator(writer, microphone: true)
            for (index, track) in order.enumerated() {
                let timestamp: Int64
                switch track {
                case .video: timestamp = 10
                case .systemAudio: timestamp = 20
                case .microphone: timestamp = 30
                }
                try coordinator.append(harnessSample(timestamp), track: track)
                if index < 2 {
                    require(!coordinator.progress.sessionStarted,
                            "three-track barrier opened before every first sample")
                }
            }
            require(coordinator.progress.sessionStarted,
                    "three-track barrier did not open for a first-sample order")
            require(writer.startCount == 1,
                    "three-track writer started more than once")
            require(writer.sessionEpoch == CMTime(value: 10, timescale: 1_000),
                    "three-track epoch did not select earliest sample")
            require(coordinator.progress.trackSummary.selectedTracks
                        == ["video", "system_audio", "microphone"],
                    "three-track selected set drifted")
            require(coordinator.progress.trackSummary.video.sampleCount == 1
                        && coordinator.progress.trackSummary.systemAudio.sampleCount == 1
                        && coordinator.progress.trackSummary.microphone.sampleCount == 1,
                    "three-track first-sample order lost independent progress")
        }

        let monotonicWriter = FakeMultitrackWriter()
        let monotonic = try multitrackCoordinator(monotonicWriter, microphone: true)
        try monotonic.append(harnessSample(10), track: .video)
        try monotonic.append(harnessSample(10), track: .systemAudio)
        try monotonic.append(harnessSample(10), track: .microphone)
        do {
            try monotonic.append(harnessSample(9), track: .microphone)
            fatalError("nonmonotonic microphone accepted")
        } catch AOSOperationCoreError.recordingTimestampNonMonotonic {
        }

        let boundedWriter = FakeMultitrackWriter()
        let bounded = try multitrackCoordinator(boundedWriter, maximumPending: 2)
        try bounded.append(harnessSample(1), track: .systemAudio)
        try bounded.append(harnessSample(2), track: .systemAudio)
        do {
            try bounded.append(harnessSample(3), track: .systemAudio)
            fatalError("pre-start queue exceeded bound")
        } catch AOSOperationCoreError.recordingBackpressureExceeded {
        }

        do {
            _ = try multitrackCoordinator(
                FakeMultitrackWriter(),
                omitAudioInput: true
            )
            fatalError("selected unavailable audio input admitted")
        } catch AOSOperationCoreError.recordingSystemAudioUnavailable {
        }
        do {
            _ = try multitrackCoordinator(
                FakeMultitrackWriter(),
                systemAudio: false,
                microphone: true,
                omitMicrophoneInput: true
            )
            fatalError("selected unavailable microphone input admitted")
        } catch AOSOperationCoreError.recordingMicrophoneUnavailable {
        }

        let missingWriter = FakeMultitrackWriter()
        let missing = try multitrackCoordinator(missingWriter)
        try missing.append(harnessSample(1), track: .video)
        var missingError: Error?
        missing.finish(identity: { summary in
            FakeFiles().identity(summary: summary)
        }) { result in
            if case .failure(let error) = result { missingError = error }
        }
        require(missingError as? AOSOperationCoreError == .recordingSystemAudioNoSamples,
                "missing selected audio was not typed")
        require(missing.progress.trackSummary.systemAudio.available,
                "registered silent audio was marked unavailable")
        require(!missing.progress.trackSummary.systemAudio.firstSamplePresent,
                "silent audio claimed a first sample")
        require(missing.progress.trackSummary.systemAudio.sampleCount == 0,
                "silent audio claimed a sample count")
        require(missing.progress.trackSummary.systemAudio.failureCode
                    == AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                "silent audio omitted its typed track failure")
        require(missing.progress.trackSummary.video.firstSamplePresent
                    && missing.progress.trackSummary.video.sampleCount == 1
                    && missing.progress.trackSummary.video.sampleByteCount > 0,
                "video-first truth lost its positive admitted sample")
        require(missing.progress.trackSummary.video.failureCode == nil,
                "silent audio falsely failed mandatory video")

        let bothSilentWriter = FakeMultitrackWriter()
        let bothSilent = try multitrackCoordinator(bothSilentWriter, microphone: true)
        var bothSilentError: Error?
        bothSilent.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { bothSilentError = error }
        }
        require(bothSilentError as? AOSOperationCoreError == .recordingNoFrames,
                "both-silent settlement did not prefer mandatory video")
        require(bothSilent.progress.trackSummary.video.failureCode
                    == AOSOperationCoreError.recordingNoFrames.code,
                "both-silent settlement omitted video failure")
        require(bothSilent.progress.trackSummary.systemAudio.failureCode
                    == AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                "both-silent settlement omitted audio failure")
        require(bothSilent.progress.trackSummary.microphone.failureCode
                    == AOSOperationCoreError.recordingMicrophoneNoSamples.code,
                "all-silent settlement omitted microphone failure")
        require(bothSilent.progress.trackSummary.video.available
                    && bothSilent.progress.trackSummary.systemAudio.available
                    && bothSilent.progress.trackSummary.microphone.available,
                "both-silent settlement confused registration with samples")
        require(!bothSilent.progress.trackSummary.video.firstSamplePresent
                    && !bothSilent.progress.trackSummary.systemAudio.firstSamplePresent
                    && !bothSilent.progress.trackSummary.microphone.firstSamplePresent,
                "both-silent settlement invented first samples")

        let missingMicrophoneWriter = FakeMultitrackWriter()
        let missingMicrophone = try multitrackCoordinator(
            missingMicrophoneWriter,
            systemAudio: true,
            microphone: true
        )
        try missingMicrophone.append(harnessSample(1), track: .video)
        try missingMicrophone.append(harnessSample(2), track: .systemAudio)
        var missingMicrophoneError: Error?
        missingMicrophone.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { missingMicrophoneError = error }
        }
        require(missingMicrophoneError as? AOSOperationCoreError
                    == .recordingMicrophoneNoSamples,
                "missing selected microphone was not typed")

        let backpressuredWriter = FakeMultitrackWriter()
        backpressuredWriter.setReady(.video, false)
        let backpressured = try multitrackCoordinator(backpressuredWriter)
        try backpressured.append(harnessSample(1), track: .video)
        try backpressured.append(harnessSample(2), track: .systemAudio)
        let audioProgress = backpressured.progress
        require(audioProgress.sessionStarted, "backpressured video blocked the common epoch")
        require(audioProgress.frameCount == 0,
                "backpressured video falsely advanced global frame progress")
        require(audioProgress.byteCount > 0,
                "ready audio did not advance global byte progress")
        require(audioProgress.trackSummary.video.sampleCount == 1
                    && audioProgress.trackSummary.video.sampleByteCount > 0,
                "backpressured video lost admitted sample truth")
        require(audioProgress.trackSummary.systemAudio.sampleCount == 1
                    && audioProgress.trackSummary.systemAudio.sampleByteCount > 0,
                "ready audio lost positive sample truth")
        _ = try aosPersistScreenRecordingProgress(
            frameCount: audioProgress.frameCount,
            byteCount: audioProgress.byteCount,
            elapsedMilliseconds: 1,
            bounds: AOSOperationRequestedBounds(
                durationMilliseconds: 1_000,
                frameRate: 30,
                pixelCount: 1_000_000,
                queueFrames: 3,
                maximumOutputBytes: 10_000
            ),
            trackSummary: audioProgress.trackSummary
        ) { _ in }
        backpressuredWriter.setReady(.video, true)
        try backpressured.append(harnessSample(3), track: .video)
        require(backpressured.progress.frameCount == 2,
                "later mandatory video did not drain admitted frames")
        var backpressuredIdentity: AOSArtifactFileIdentity?
        backpressured.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .success(let value) = result { backpressuredIdentity = value }
        }
        require(backpressuredIdentity?.trackSummary?.isSuccessful == true,
                "later mandatory video did not permit successful finalization")

        let blockedWriter = FakeMultitrackWriter()
        blockedWriter.setReady(.video, false)
        let blocked = try multitrackCoordinator(blockedWriter)
        try blocked.append(harnessSample(1), track: .video)
        try blocked.append(harnessSample(2), track: .systemAudio)
        var blockedError: Error?
        blocked.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { blockedError = error }
        }
        require(blockedError as? AOSOperationCoreError == .recordingBackpressureExceeded,
                "permanently backpressured mandatory video falsely succeeded")
        require(blocked.progress.trackSummary.video.failureCode
                    == AOSOperationCoreError.recordingBackpressureExceeded.code,
                "mandatory-video backpressure failure was not persisted")
        require(blocked.progress.trackSummary.systemAudio.failureCode == nil,
                "mandatory-video backpressure falsely failed admitted audio")

        let microphoneBlockedWriter = FakeMultitrackWriter()
        microphoneBlockedWriter.setReady(.microphone, false)
        let microphoneBlocked = try multitrackCoordinator(
            microphoneBlockedWriter,
            microphone: true
        )
        try microphoneBlocked.append(harnessSample(1), track: .video)
        try microphoneBlocked.append(harnessSample(2), track: .systemAudio)
        try microphoneBlocked.append(harnessSample(3), track: .microphone)
        require(microphoneBlocked.progress.sessionStarted,
                "microphone backpressure blocked the common epoch")
        require(microphoneBlocked.progress.trackSummary.systemAudio.sampleCount == 1
                    && microphoneBlocked.progress.trackSummary.microphone.sampleCount == 1,
                "system and microphone admitted progress were not independent")
        var microphoneBlockedError: Error?
        microphoneBlocked.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { microphoneBlockedError = error }
        }
        require(microphoneBlockedError as? AOSOperationCoreError
                    == .recordingBackpressureExceeded,
                "permanently backpressured microphone falsely succeeded")
        require(microphoneBlocked.progress.trackSummary.microphone.failureCode
                    == AOSOperationCoreError.recordingBackpressureExceeded.code,
                "microphone backpressure failure was not isolated")
        require(microphoneBlocked.progress.trackSummary.video.failureCode == nil
                    && microphoneBlocked.progress.trackSummary.systemAudio.failureCode == nil,
                "microphone backpressure falsely failed other tracks")

        let zeroByteWriter = FakeMultitrackWriter()
        let zeroByte = try multitrackCoordinator(zeroByteWriter)
        try zeroByte.append(harnessSample(1, byteCount: 0), track: .systemAudio)
        try zeroByte.append(harnessSample(2), track: .video)
        require(!zeroByte.progress.sessionStarted,
                "zero-byte audio opened the common epoch")
        var zeroByteError: Error?
        zeroByte.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { zeroByteError = error }
        }
        require(zeroByteError as? AOSOperationCoreError == .recordingSystemAudioNoSamples,
                "zero-byte audio did not terminalize as no samples")
        require(zeroByte.progress.trackSummary.systemAudio.available,
                "zero-byte registered audio became unavailable")
        require(!zeroByte.progress.trackSummary.systemAudio.firstSamplePresent,
                "zero-byte audio established first-sample truth")
        require(zeroByte.progress.trackSummary.systemAudio.sampleByteCount == 0,
                "zero-byte audio established byte truth")

        let startFailingWriter = FakeMultitrackWriter()
        startFailingWriter.startSucceeds = false
        let startFailing = try multitrackCoordinator(
            startFailingWriter,
            microphone: true
        )
        do {
            try startFailing.append(harnessSample(1), track: .video)
            try startFailing.append(harnessSample(2), track: .systemAudio)
            try startFailing.append(harnessSample(3), track: .microphone)
            fatalError("writer start failure was accepted")
        } catch AOSOperationCoreError.recordingEncoderFailed {
        }
        requireWriterFailureTruth(
            startFailing.progress.trackSummary,
            sessionStarted: false,
            microphoneSelected: true
        )

        let stoppedWriter = FakeMultitrackWriter()
        let stopped = try multitrackCoordinator(stoppedWriter, microphone: true)
        try stopped.append(harnessSample(1), track: .video)
        try stopped.append(harnessSample(2), track: .systemAudio)
        try stopped.append(harnessSample(3), track: .microphone)
        stoppedWriter.forceNotWriting()
        do {
            try stopped.append(harnessSample(3), track: .video)
            fatalError("post-start writer failure was accepted")
        } catch AOSOperationCoreError.recordingEncoderFailed {
        }
        requireWriterFailureTruth(
            stopped.progress.trackSummary,
            sessionStarted: true,
            microphoneSelected: true
        )

        let finalWriter = FakeMultitrackWriter()
        let final = try multitrackCoordinator(finalWriter)
        try final.append(harnessSample(2), track: .systemAudio)
        try final.append(harnessSample(1), track: .video)
        var identity: AOSArtifactFileIdentity?
        final.finish(identity: { summary in
            FakeFiles().identity(summary: summary)
        }) { result in
            if case .success(let value) = result { identity = value }
        }
        require(identity?.trackSummary?.isSuccessful == true,
                "final artifact did not bind finalized tracks")
        require(finalWriter.finishCount == 1, "writer finalized more than once")
        require(finalWriter.inputFinishCount[.video] == 1,
                "video input finish count drifted")
        require(finalWriter.inputFinishCount[.systemAudio] == 1,
                "audio input finish count drifted")
        final.finish(identity: { FakeFiles().identity(summary: $0) }) { _ in }
        require(finalWriter.finishCount == 1, "duplicate finish reached writer")

        let failingWriter = FakeMultitrackWriter()
        failingWriter.finishSucceeds = false
        let failing = try multitrackCoordinator(failingWriter, microphone: true)
        try failing.append(harnessSample(2), track: .systemAudio)
        try failing.append(harnessSample(1), track: .video)
        try failing.append(harnessSample(3), track: .microphone)
        var finalizationError: Error?
        failing.finish(identity: { FakeFiles().identity(summary: $0) }) { result in
            if case .failure(let error) = result { finalizationError = error }
        }
        require(
            finalizationError as? AOSOperationCoreError == .recordingEncoderFailed,
            "writer-global finalization failure was not typed"
        )
        require(
            failing.progress.trackSummary.video.failureCode
                == AOSOperationCoreError.recordingEncoderFailed.code,
            "writer finalization failure was omitted from video truth"
        )
        require(
            failing.progress.trackSummary.systemAudio.failureCode
                == AOSOperationCoreError.recordingSystemAudioFailed.code,
            "writer finalization failure was omitted from audio truth"
        )
        require(
            failing.progress.trackSummary.microphone.failureCode
                == AOSOperationCoreError.recordingMicrophoneFailed.code,
            "writer finalization failure was omitted from microphone truth"
        )
        require(failingWriter.finishCount == 1, "failing writer finalized more than once")
        require(failingWriter.inputFinishCount[.video] == 1,
                "failing writer did not finish video input once")
        require(failingWriter.inputFinishCount[.systemAudio] == 1,
                "failing writer did not finish audio input once")
        require(failingWriter.inputFinishCount[.microphone] == 1,
                "failing writer did not finish microphone input once")

        let concurrentWriter = FakeMultitrackWriter()
        let concurrent = try multitrackCoordinator(concurrentWriter, maximumPending: 8)
        let group = DispatchGroup()
        let errors = NSLock()
        var errorCount = 0
        for _ in 0..<8 {
            for track in [AOSScreenRecordingTrackKind.video, .systemAudio] {
                group.enter()
                DispatchQueue.global().async {
                    do { try concurrent.append(harnessSample(1), track: track) }
                    catch { errors.lock(); errorCount += 1; errors.unlock() }
                    group.leave()
                }
            }
        }
        group.wait()
        require(errorCount == 0, "concurrent track callbacks failed")
        require(concurrent.progress.trackSummary.video.sampleCount == 8,
                "concurrent video samples lost")
        require(concurrent.progress.trackSummary.systemAudio.sampleCount == 8,
                "concurrent audio samples lost")
    }

    static func productionLateFailureRetainsAuthority() async throws {
        let environment = try RecordingEnvironment()
        let admission = try environment.adapter.start(
            request: environment.request(), connectionID: UUID()
        )
        try await wait("native start was not admitted") {
            environment.native.startWasRequested()
        }
        let firstFrame = try environment.native.publishFrame()
        require(firstFrame, "first frame was rejected")
        try await wait("active evidence was not published") {
            operation(admission, in: environment).state == .active
        }
        environment.native.settleStart(.failure(HarnessFault.link))
        _ = try environment.cancel(admission.operation)
        try await wait("late failure did not request retirement") {
            environment.native.stopCount == 1
        }
        require(environment.broker.retainsAuthority, "broker released before retirement")
        require(operation(admission, in: environment).state != .terminal,
                "operation terminalized before retirement")
        require(environment.registry.snapshot().resourceClaims.contains {
            $0.operation == admission.operation && $0.state != .terminal
        }, "claim released before retirement")
        environment.native.settleStop(.success(()))
        try await wait("late-failure operation did not terminalize") {
            operation(admission, in: environment).state == .terminal
        }
        require(environment.native.stopCount == 1, "late failure stopped twice")
        require(!environment.broker.retainsAuthority, "retired broker stayed live")
    }

    static func productionAdapterFollowGeometry() async throws {
        for (systemAudio, microphone) in [
            (false, false), (true, false), (false, true), (true, true),
        ] {
            let selection = try RecordingEnvironment()
            let selectedRequest = try selection.request(
                systemAudio: systemAudio,
                microphone: microphone,
                followed: true
            )
            let selectedAdmission = try selection.adapter.start(
                request: selectedRequest,
                connectionID: UUID()
            )
            require(
                operation(selectedAdmission, in: selection).progress?.trackSummary?.selectedTracks
                    == AOSScreenRecordingTrackSummary.selectedTrackNames(
                        systemAudio: systemAudio,
                        microphone: microphone
                    ),
                "follow admission lost one of four exact track selections"
            )
            try await wait("follow selection native start missing") {
                selection.native.startWasRequested()
            }
            selection.native.settleStart(.success(()))
            _ = try selection.cancel(selectedAdmission.operation)
            try await wait("follow selection stop missing") {
                selection.native.stopCount == 1
            }
            selection.native.settleStop(.success(()))
            try await wait("follow selection did not clean up") {
                operation(selectedAdmission, in: selection).state == .terminal
            }
        }

        let environment = try RecordingEnvironment()
        let connectionID = UUID()
        let admission = try environment.adapter.start(
            request: environment.request(followed: true),
            connectionID: connectionID
        )
        require(admission.geometry.accepted.mode == .callerFollowed,
                "follow admission lost geometry mode")
        do {
            try aosValidateScreenRecordingProductionFrameBinding(
                admission.geometry.accepted,
                observedTopology: RecordingEnvironment.topology(),
                windowFacts: [CaptureWindowFact(
                    frame: CGRect(x: 0, y: 0, width: 20, height: 20),
                    owningApplication: CaptureApplicationFact(processID: 700),
                    windowID: 77
                )]
            )
            fatalError("production frame validation accepted containment loss")
        } catch AOSOperationCoreError.recordingTargetDrift {}
        try await wait("follow native start missing") {
            environment.native.startWasRequested()
        }
        let frameAccepted = try environment.native.publishFrame()
        require(frameAccepted, "follow startup frame rejected")
        environment.native.settleStart(.success(()))
        try await wait("follow operation did not activate") {
            operation(admission, in: environment).state == .active
                && operation(admission, in: environment)
                    .screenRecordingGeometry?.deadlineState == .armed
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let update = try AOSScreenRecordingFollowUpdateRequest.validatingPublicValue([
            "request_id": "follow-update-1",
            "canonical_parameter_digest": String(repeating: "d", count: 64),
            "selector": [
                "operation_id": admission.operation.id,
                "operation_generation": admission.operation.generation,
            ],
            "expected_geometry_generation": 1,
            "topology": RecordingEnvironment.topology(),
            "target": [
                "kind": "region", "display_ordinal": 1,
                "global_bounds": ["x": 20, "y": 10, "width": 40, "height": 30],
            ],
            "binding": RecordingEnvironment.binding(observation: 2, state: 2),
        ])
        var result: Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?
        try environment.adapter.updateFollowGeometry(
            request: update,
            connectionID: connectionID
        ) { result = $0 }
        try await wait("follow update response missing") { result != nil }
        guard case .success(let accepted)? = result else {
            fatalError("follow update was not accepted")
        }
        require(environment.native.geometryUpdateCount == 1,
                "adapter did not call the native crop seam exactly once")
        require(environment.native.lastGeometry?.sourceRect.x == 20,
                "native crop seam lost the new source rect")
        require(accepted.accepted.geometryGeneration == 2,
                "adapter projected a false geometry generation")
        let record = operation(admission, in: environment)
        let projected = AOSOperationPublicProjection.snapshot(
            record,
            state: environment.registry.snapshot()
        )
        require((projected["geometry"] as? [String: Any])?["geometry_generation"]
                    as? UInt64 == 2,
                "operation projection lost accepted geometry")
        require(((projected["progress"] as? [String: Any])?["geometry"]
                    as? [String: Any])?["geometry_generation"] as? UInt64 == 2,
                "progress projection lost accepted geometry")
        require((projected["progress"] as? [String: Any])?["last_event_sequence"]
                    as? UInt64 == accepted.eventSequence,
                "progress projection lost durable geometry event sequence")
        let acceptedEvents = environment.events.snapshot()
        require(acceptedEvents.compactMap {
            ($0["data"] as? [String: Any])?["sequence"] as? UInt64
        } == [1, 2, 3, 4], "production geometry events were not monotonic")
        let captured = [
            "event": acceptedEvents.last!["data"] as! [String: Any],
            "envelope": acceptedEvents.last!,
        ]
        let capturedData = try JSONSerialization.data(
            withJSONObject: captured,
            options: [.sortedKeys]
        )
        let capturedJSON = String(data: capturedData, encoding: .utf8)!
        print("production-geometry-event-envelope:\(capturedJSON)")
        var driftBinding = RecordingEnvironment.binding(observation: 3, state: 3)
        driftBinding["source_window"] = ["window_id": 88, "owner_pid": 700]
        let drift = try AOSScreenRecordingFollowUpdateRequest.validatingPublicValue([
            "request_id": "follow-update-drift",
            "canonical_parameter_digest": String(repeating: "e", count: 64),
            "selector": [
                "operation_id": admission.operation.id,
                "operation_generation": admission.operation.generation,
            ],
            "expected_geometry_generation": 2,
            "topology": RecordingEnvironment.topology(),
            "target": [
                "kind": "region", "display_ordinal": 1,
                "global_bounds": ["x": 30, "y": 10, "width": 40, "height": 30],
            ],
            "binding": driftBinding,
        ])
        var driftResult: Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?
        try environment.adapter.updateFollowGeometry(
            request: drift,
            connectionID: connectionID
        ) { driftResult = $0 }
        try await wait("follow drift response missing") { driftResult != nil }
        guard case .failure(.recordingTargetDrift)? = driftResult else {
            fatalError("follow drift lost its exact failure")
        }
        try await wait("follow adapter drift stop missing") {
            environment.native.stopCount == 1
        }
        environment.native.settleStop(.success(()))
        try await wait("follow adapter did not terminalize") {
            operation(admission, in: environment).state == .terminal
        }
        let terminalRecord = operation(admission, in: environment)
        require(terminalRecord.failureCode == AOSOperationCoreError.recordingTargetDrift.code,
                "follow drift terminal lost exact failure")
        let terminalProjection = AOSOperationPublicProjection.snapshot(
            terminalRecord,
            state: environment.registry.snapshot()
        )
        require((((terminalProjection["terminal"] as? [String: Any])?["geometry"]
                    as? [String: Any])?["geometry_generation"] as? UInt64) == 2,
                "terminal projection lost the last accepted geometry")
        require(!environment.registry.snapshot().resourceClaims.contains {
            $0.operation == admission.operation && $0.state != .terminal
        }, "follow drift leaked a resource claim")
    }

    static func productionFollowStopInterleavings() async throws {
        struct StopCase {
            let action: AOSOrdinaryControlAction
            let intent: AOSStopIntent
            let outcome: AOSOperationOutcome

            var opposite: AOSOrdinaryControlAction {
                action == .cancel ? .kill : .cancel
            }
        }
        let cases = [
            StopCase(action: .cancel, intent: .cancel, outcome: .cancelled),
            StopCase(action: .kill, intent: .kill, outcome: .killed),
        ]
        func issue(
            _ action: AOSOrdinaryControlAction,
            _ environment: RecordingEnvironment,
            _ operation: AOSOperationIdentity
        ) throws -> AOSOperationControlReceipt {
            switch action {
            case .cancel: return try environment.cancel(operation)
            case .kill: return try environment.kill(operation)
            case .killOwner: fatalError("unexpected test action")
            }
        }
        func requireReceipt(
            _ receipt: AOSOperationControlReceipt,
            _ testCase: StopCase,
            _ operation: AOSOperationIdentity,
            _ environment: RecordingEnvironment,
            _ phase: String
        ) {
            require(receipt.action == testCase.action
                        && receipt.ownerRootID == environment.owner.ownerID
                        && receipt.selectedOperations == [operation]
                        && receipt.selectedOperationCount == 1
                        && receipt.selectedOperationDigest.range(
                            of: "^[0-9a-f]{64}$", options: .regularExpression
                        ) != nil
                        && receipt.stopIntent == testCase.intent
                        && receipt.terminalOutcome == testCase.outcome,
                    "\(phase) public receipt drifted")
        }
        func requireRejected(
            _ action: AOSOrdinaryControlAction,
            _ environment: RecordingEnvironment,
            _ operation: AOSOperationIdentity,
            _ phase: String
        ) {
            do {
                _ = try issue(action, environment, operation)
                fatalError("\(phase) different stop action was accepted")
            } catch let error as AOSOperationCoreError {
                require(error == .invalidTransition,
                        "\(phase) different stop action returned \(error)")
            } catch {
                fatalError("\(phase) different stop action returned \(error)")
            }
        }
        func requireStopped(
            _ admission: AOSScreenRecordingAdmission,
            _ environment: RecordingEnvironment,
            _ testCase: StopCase,
            _ phase: String
        ) {
            let record = operation(admission, in: environment)
            require(record.stopIntent == testCase.intent && record.outcome == testCase.outcome,
                    "\(phase) durable first writer drifted")
            require(record.failureCode == nil, "\(phase) invented adapter failure")
            require(record.screenRecordingGeometry?.deadlineState == .stopped,
                    "\(phase) left follow timer armed")
        }
        func requireClean(
            _ admission: AOSScreenRecordingAdmission,
            _ environment: RecordingEnvironment,
            _ phase: String
        ) {
            require(!environment.registry.snapshot().resourceClaims.contains {
                $0.operation == admission.operation && $0.state != .terminal
            }, "\(phase) leaked a resource claim")
        }

        for testCase in cases {
            let phase = "prepared-publication \(testCase.action.rawValue)"
            let barrier = PreparedPublicationBarrier()
            let runtimeCounter = RuntimeInstallationBarrier()
            let environment = try RecordingEnvironment(
                preparedPublicationObserver: barrier.observePublication,
                runtimeStartObserver: runtimeCounter.observeRuntimeStart,
                stopAdmissionObserver: barrier.observeStopAdmission
            )
            let startTask = Task.detached {
                try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
            }
            guard let operationIdentity = barrier.waitForPublication() else {
                fatalError("\(phase) durable prepared publication missing")
            }
            let preparedState = environment.registry.snapshot()
            let prepared = try environment.registry.inspect(operationIdentity)
            require(prepared.state == .prepared
                        && prepared.stopIntent == nil
                        && prepared.outcome == nil,
                    "\(phase) did not stop at the first prepared publication")
            require(preparedState.streams.isEmpty
                        && preparedState.artifacts.isEmpty
                        && preparedState.resourceTransactions.isEmpty
                        && preparedState.resourceClaims.isEmpty,
                    "\(phase) created children before provisional ownership")

            let stopTask = Task.detached {
                defer { barrier.markStopCompleted() }
                return try issue(testCase.action, environment, operationIdentity)
            }
            require(barrier.waitForStopAdmission(),
                    "\(phase) public control did not reach the adapter")
            require(!barrier.didStopComplete(),
                    "\(phase) public control completed before owner insertion")
            let stillPrepared = try environment.registry.inspect(operationIdentity)
            require(stillPrepared.state == .prepared
                        && stillPrepared.stopIntent == nil,
                    "\(phase) stop admission bypassed the lifecycle owner")

            barrier.releasePublication()
            let receipt = try await stopTask.value
            requireReceipt(receipt, testCase, operationIdentity, environment, phase)
            let admission = try await startTask.value
            require(admission.operation == operationIdentity,
                    "\(phase) start returned a different operation")
            let stopped = try environment.registry.inspect(operationIdentity)
            require(stopped.state == .terminal
                        && stopped.stopIntent == testCase.intent
                        && stopped.outcome == testCase.outcome
                        && stopped.failureCode == nil
                        && stopped.residualDigest == nil
                        && stopped.screenRecordingGeometry?.deadlineState == .stopped,
                    "\(phase) did not publish exact terminal stop truth")
            let stoppedState = environment.registry.snapshot()
            let streams = stoppedState.streams.filter {
                $0.parentOperation == operationIdentity
            }
            let artifacts = stoppedState.artifacts.filter {
                $0.parentOperation == operationIdentity
            }
            let transactions = stoppedState.resourceTransactions.filter {
                $0.operation == operationIdentity
            }
            let claims = stoppedState.resourceClaims.filter {
                $0.operation == operationIdentity
            }
            require(streams.count == 1
                        && streams.allSatisfy { $0.state == .terminal }
                        && artifacts.count == 1
                        && artifacts.allSatisfy { $0.state == .removed }
                        && transactions.count == 1
                        && transactions.allSatisfy { $0.state == .terminal }
                        && claims.count == 1
                        && claims.allSatisfy { $0.state == .terminal },
                    "\(phase) did not terminal-clean exact prepared children")
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && runtimeCounter.observedRuntimeStartCount() == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) admitted a later runtime, broker, or native effect")
            let replay = try issue(
                testCase.action, environment, operationIdentity
            )
            require(replay == receipt, "\(phase) same-action replay drifted")
            requireRejected(
                testCase.opposite, environment, operationIdentity, phase
            )
        }

        do {
            let testCase = cases[0]
            let phase = "waiting-stop-preparation-failure"
            let store = AdmissionFaultStore(failingSaveCall: 4)
            let barrier = PreparedPublicationBarrier()
            let environment = try RecordingEnvironment(
                store: store,
                preparedPublicationObserver: barrier.observePublication,
                stopAdmissionObserver: barrier.observeStopAdmission
            )
            let startTask = Task.detached {
                try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
            }
            guard let operationIdentity = barrier.waitForPublication() else {
                fatalError("\(phase) durable publication missing")
            }
            let stopTask = Task.detached {
                defer { barrier.markStopCompleted() }
                return try issue(testCase.action, environment, operationIdentity)
            }
            require(barrier.waitForStopAdmission(),
                    "\(phase) public stop did not reach the adapter")
            barrier.releasePublication()
            do {
                _ = try await startTask.value
                fatalError("\(phase) preparation fault did not fail start")
            } catch AOSOperationCoreError.storeUnavailable {
            }
            let receipt = try await stopTask.value
            requireReceipt(receipt, testCase, operationIdentity, environment, phase)
            let state = environment.registry.snapshot()
            let stopped = try environment.registry.inspect(operationIdentity)
            require(stopped.state == .terminal
                        && stopped.stopIntent == testCase.intent
                        && stopped.outcome == testCase.outcome
                        && stopped.failureCode == nil
                        && stopped.screenRecordingGeometry?.deadlineState == .stopped
                        && !AOSOperationRegistry.hasNonterminalChildren(
                            in: state,
                            operation: operationIdentity
                        ),
                    "\(phase) lost exact public terminal truth")
            require(state.streams.isEmpty
                        && state.artifacts.isEmpty
                        && state.resourceTransactions.isEmpty
                        && state.resourceClaims.isEmpty
                        && !environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) created a later child or authority effect")
            let replay = try issue(testCase.action, environment, operationIdentity)
            require(replay == receipt, "\(phase) replay drifted")
            requireRejected(testCase.opposite, environment, operationIdentity, phase)
        }

        do {
            let testCase = cases[0]
            let phase = "post-admission-geometry-save-failure"
            let store = StopGeometryFaultStore()
            let barrier = RuntimeInstallationBarrier()
            let environment = try RecordingEnvironment(
                store: store,
                runtimeInstallationObserver: barrier.observe,
                runtimeStartObserver: barrier.observeRuntimeStart
            )
            let startTask = Task.detached {
                try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
            }
            require(barrier.waitForInstallation(), "\(phase) boundary missing")
            guard let operationIdentity = environment.registry.snapshot().operations.first(
                where: { $0.state == .starting }
            )?.identity else {
                fatalError("\(phase) starting operation missing")
            }
            let receipt = try issue(testCase.action, environment, operationIdentity)
            requireReceipt(receipt, testCase, operationIdentity, environment, phase)
            let state = environment.registry.snapshot()
            let stopped = try environment.registry.inspect(operationIdentity)
            require(store.geometryFailureCount == 1
                        && stopped.state == .terminal
                        && stopped.stopIntent == testCase.intent
                        && stopped.outcome == testCase.outcome
                        && stopped.failureCode == nil
                        && stopped.screenRecordingGeometry?.deadlineState == .stopped
                        && !AOSOperationRegistry.hasNonterminalChildren(
                            in: state,
                            operation: operationIdentity
                        ),
                    "\(phase) suppressed stopped-geometry persistence failure")
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && barrier.observedRuntimeStartCount() == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) created a later authority effect")
            barrier.releaseInstallation()
            let admission = try await startTask.value
            require(admission.operation == operationIdentity
                        && !environment.native.startWasRequested(),
                    "\(phase) resumed native handoff after stop")
            let replay = try issue(testCase.action, environment, operationIdentity)
            require(replay == receipt, "\(phase) replay drifted")
            requireRejected(testCase.opposite, environment, operationIdentity, phase)
        }

        do {
            let testCase = cases[0]
            let phase = "blocked-stop-store"
            let store = StopAdmissionBarrierStore(firstIntent: testCase.intent)
            let barrier = PreparedPublicationBarrier()
            let runtimeCounter = RuntimeInstallationBarrier()
            let environment = try RecordingEnvironment(
                store: store,
                startupTimeout: 0.05,
                preparedPublicationObserver: barrier.observePublication,
                runtimeStartObserver: runtimeCounter.observeRuntimeStart,
                stopAdmissionObserver: barrier.observeStopAdmission
            )
            let startTask = Task.detached {
                try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
            }
            guard let operationIdentity = barrier.waitForPublication() else {
                fatalError("\(phase) durable prepared publication missing")
            }
            let stopTask = Task.detached {
                defer { barrier.markStopCompleted() }
                return try issue(testCase.action, environment, operationIdentity)
            }
            require(barrier.waitForStopAdmission(),
                    "\(phase) public control did not reach the adapter")
            barrier.releasePublication()
            require(store.waitForAdmission(),
                    "\(phase) durable stop save did not block")
            let admission = try await startTask.value
            require(admission.operation == operationIdentity,
                    "\(phase) bounded start returned a different operation")
            require(!barrier.didStopComplete()
                        && !environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && runtimeCounter.observedRuntimeStartCount() == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) hung admission leaked a later authority effect")
            store.releaseAdmission()
            let receipt = try await stopTask.value
            requireReceipt(receipt, testCase, operationIdentity, environment, phase)
            requireStopped(admission, environment, testCase, phase)
            requireClean(admission, environment, phase)
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && runtimeCounter.observedRuntimeStartCount() == 0
                        && environment.broker.acquireCount == 0
                        && environment.broker.releaseCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) resumed into a later authority effect")
        }

        for testCase in cases {
            let phase = "pre-install \(testCase.action.rawValue)"
            let barrier = RuntimeInstallationBarrier()
            let environment = try RecordingEnvironment(
                runtimeInstallationObserver: barrier.observe,
                runtimeStartObserver: barrier.observeRuntimeStart
            )
            let startTask = Task.detached {
                try environment.adapter.start(
                    request: environment.request(followed: true),
                    connectionID: UUID()
                )
            }
            require(barrier.waitForInstallation(), "\(phase) boundary missing")
            let starting = environment.registry.snapshot().operations.filter {
                $0.state == .starting
            }
            require(starting.count == 1, "\(phase) starting operation missing")
            let operationIdentity = starting[0].identity
            let receipt = try issue(
                testCase.action, environment, operationIdentity
            )
            requireReceipt(
                receipt, testCase, operationIdentity, environment, phase
            )
            let stopped = try environment.registry.inspect(operationIdentity)
            require(stopped.state == .terminal
                        && stopped.stopIntent == testCase.intent
                        && stopped.outcome == testCase.outcome
                        && stopped.failureCode == nil
                        && stopped.residualDigest == nil
                        && stopped.screenRecordingGeometry?.deadlineState == .stopped,
                    "\(phase) did not settle exact stopped geometry")
            let stoppedState = environment.registry.snapshot()
            let streams = stoppedState.streams.filter {
                $0.parentOperation == operationIdentity
            }
            require(streams.count == 1
                        && streams.allSatisfy { $0.state == .terminal },
                    "\(phase) left a stream child")
            let artifacts = stoppedState.artifacts.filter {
                $0.parentOperation == operationIdentity
            }
            require(artifacts.count == 1
                        && artifacts.allSatisfy { $0.state == .removed },
                    "\(phase) left an artifact child")
            let claims = stoppedState.resourceClaims.filter {
                $0.operation == operationIdentity
            }
            require(claims.count == 1
                        && claims.allSatisfy { $0.state == .terminal },
                    "\(phase) left a claim child")
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && environment.broker.acquireCount == 0
                        && !environment.broker.retainsAuthority
                        && environment.broker.releaseCount == 0,
                    "\(phase) created unowned startup authority")
            let replay = try issue(
                testCase.action, environment, operationIdentity
            )
            require(replay == receipt, "\(phase) same-action replay drifted")
            requireRejected(
                testCase.opposite, environment, operationIdentity, phase
            )
            barrier.releaseInstallation()
            let admission = try await startTask.value
            require(admission.operation == operationIdentity,
                    "\(phase) start returned a different operation")
            require(!environment.native.startWasRequested()
                        && environment.native.stopCount == 0
                        && barrier.observedRuntimeStartCount() == 0
                        && environment.broker.acquireCount == 0
                        && !environment.broker.retainsAuthority,
                    "\(phase) started after durable stop")
        }

        for testCase in cases {
            let phase = "pre-activation \(testCase.action.rawValue)"
            let runtimeCounter = RuntimeInstallationBarrier()
            let environment = try RecordingEnvironment(
                runtimeStartObserver: runtimeCounter.observeRuntimeStart
            )
            let admission = try environment.adapter.start(
                request: environment.request(followed: true), connectionID: UUID()
            )
            require(runtimeCounter.observedRuntimeStartCount() == 1,
                    "\(phase) runtime start handoff was not exactly once")
            try await wait("\(phase) start missing") { environment.native.startWasRequested() }
            let admittedFrame = try environment.native.publishFrame()
            require(admittedFrame, "\(phase) startup frame rejected")
            let receipt = try issue(testCase.action, environment, admission.operation)
            requireReceipt(receipt, testCase, admission.operation, environment, phase)
            let replay = try issue(testCase.action, environment, admission.operation)
            require(replay == receipt, "\(phase) same-action replay drifted")
            requireRejected(testCase.opposite, environment, admission.operation, phase)
            requireStopped(admission, environment, testCase, phase)
            environment.native.settleStart(.failure(CancellationError()))
            try await wait("\(phase) native stop missing") {
                environment.native.stopCount == 1
            }
            environment.native.settleStop(.success(()))
            try await wait("\(phase) did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            requireStopped(admission, environment, testCase, phase)
            require(environment.native.stopCount == 1, "\(phase) native stop was not once")
            requireClean(admission, environment, phase)
        }

        for testCase in cases {
            let phase = "activation-contention \(testCase.action.rawValue)"
            let barrier = FollowActivationBarrier()
            let environment = try RecordingEnvironment(
                followActivationObserver: barrier.observe
            )
            let admission = try environment.adapter.start(
                request: environment.request(followed: true), connectionID: UUID()
            )
            try await wait("\(phase) start missing") { environment.native.startWasRequested() }
            let admittedFrame = try environment.native.publishFrame()
            require(admittedFrame, "\(phase) startup frame rejected")
            environment.native.settleStart(.success(()))
            require(barrier.waitForActivation(), "\(phase) activation boundary missing")
            let stopTask = Task.detached {
                barrier.markStopAttempted()
                return try issue(testCase.action, environment, admission.operation)
            }
            require(barrier.waitForStopAttempt(), "\(phase) did not contend with activation")
            require(operation(admission, in: environment).stopIntent == nil,
                    "\(phase) persisted before the runtime owner")
            barrier.releaseActivation()
            let receipt = try await stopTask.value
            requireReceipt(receipt, testCase, admission.operation, environment, phase)
            let replay = try issue(testCase.action, environment, admission.operation)
            require(replay == receipt, "\(phase) same-action replay drifted")
            requireRejected(testCase.opposite, environment, admission.operation, phase)
            try await wait("\(phase) native stop missing") {
                environment.native.stopCount == 1
            }
            requireStopped(admission, environment, testCase, phase)
            environment.native.settleStop(.success(()))
            try await wait("\(phase) did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            requireStopped(admission, environment, testCase, phase)
            require(environment.native.stopCount == 1, "\(phase) native stop was not once")
            requireClean(admission, environment, phase)
        }

        for testCase in cases {
            let phase = "post-activation \(testCase.action.rawValue)"
            let environment = try RecordingEnvironment()
            let admission = try environment.adapter.start(
                request: environment.request(followed: true), connectionID: UUID()
            )
            try await wait("\(phase) start missing") { environment.native.startWasRequested() }
            let admittedFrame = try environment.native.publishFrame()
            require(admittedFrame, "\(phase) startup frame rejected")
            environment.native.settleStart(.success(()))
            try await wait("\(phase) timer did not arm") {
                operation(admission, in: environment)
                    .screenRecordingGeometry?.deadlineState == .armed
            }
            let receipt = try issue(testCase.action, environment, admission.operation)
            requireReceipt(receipt, testCase, admission.operation, environment, phase)
            let replay = try issue(testCase.action, environment, admission.operation)
            require(replay == receipt, "\(phase) same-action replay drifted")
            requireRejected(testCase.opposite, environment, admission.operation, phase)
            try await wait("\(phase) native stop missing") {
                environment.native.stopCount == 1
            }
            requireStopped(admission, environment, testCase, phase)
            environment.native.settleStop(.success(()))
            try await wait("\(phase) did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            requireStopped(admission, environment, testCase, phase)
            require(environment.native.stopCount == 1, "\(phase) native stop was not once")
            requireClean(admission, environment, phase)
        }

        for first in cases {
            let second = cases.first { $0.action == first.opposite }!
            let phase = "first-writer \(first.action.rawValue)"
            let store = StopAdmissionBarrierStore(firstIntent: first.intent)
            let environment = try RecordingEnvironment(store: store)
            let admission = try environment.adapter.start(
                request: environment.request(followed: true), connectionID: UUID()
            )
            try await wait("\(phase) start missing") { environment.native.startWasRequested() }
            let admittedFrame = try environment.native.publishFrame()
            require(admittedFrame, "\(phase) startup frame rejected")
            environment.native.settleStart(.success(()))
            try await wait("\(phase) timer did not arm") {
                operation(admission, in: environment)
                    .screenRecordingGeometry?.deadlineState == .armed
            }
            let firstTask = Task.detached {
                try issue(first.action, environment, admission.operation)
            }
            require(store.waitForAdmission(), "\(phase) durable admission boundary missing")
            let secondTask = Task.detached { () -> String in
                do {
                    _ = try issue(second.action, environment, admission.operation)
                    return "accepted"
                } catch let error as AOSOperationCoreError {
                    return error.code
                } catch {
                    return "unexpected"
                }
            }
            store.releaseAdmission()
            let receipt = try await firstTask.value
            requireReceipt(receipt, first, admission.operation, environment, phase)
            let competingResult = await secondTask.value
            require(competingResult == AOSOperationCoreError.invalidTransition.code,
                    "\(phase) competing action did not reject")
            let replay = try issue(first.action, environment, admission.operation)
            require(replay == receipt, "\(phase) same-action replay drifted")
            try await wait("\(phase) native stop missing") {
                environment.native.stopCount == 1
            }
            requireStopped(admission, environment, first, phase)
            environment.native.settleStop(.success(()))
            try await wait("\(phase) did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            requireStopped(admission, environment, first, phase)
            require(environment.native.stopCount == 1, "\(phase) native stop was not once")
            requireClean(admission, environment, phase)
        }
    }

    static func productionAdapterAudioTracks() async throws {
        for audioFirst in [true, false] {
            let environment = try RecordingEnvironment()
            let admission = try environment.adapter.start(
                request: environment.request(systemAudio: true),
                connectionID: UUID()
            )
            try await wait("audio adapter start missing") {
                environment.native.startWasRequested()
            }
            environment.native.settleStart(.success(()))
            if audioFirst {
                let audioAccepted = try environment.native.publishAudio()
                require(audioAccepted, "audio-first callback rejected")
                require(operation(admission, in: environment).state == .starting,
                        "audio-first opened startup alone")
                let videoAccepted = try environment.native.publishFrame()
                require(videoAccepted, "audio-first video rejected")
            } else {
                let videoAccepted = try environment.native.publishFrame()
                require(videoAccepted, "video-first callback rejected")
                require(operation(admission, in: environment).state == .starting,
                        "video-first opened startup alone")
                let audioAccepted = try environment.native.publishAudio()
                require(audioAccepted, "video-first audio rejected")
            }
            try await wait("selected tracks did not activate together") {
                operation(admission, in: environment).state == .active
            }
            let active = operation(admission, in: environment)
            require(active.progress?.trackSummary?.selectedTracks == ["video", "system_audio"],
                    "operation progress lost selected tracks")
            require(active.progress?.trackSummary?.video.sampleCount == 1,
                    "operation progress lost video")
            require(active.progress?.trackSummary?.systemAudio.sampleCount == 1,
                    "operation progress lost system audio")
            _ = try environment.cancel(admission.operation)
            try await wait("audio adapter stop missing") { environment.native.stopCount == 1 }
            environment.native.settleStop(.success(()))
            let postStopAudio = try environment.native.publishAudio()
            require(!postStopAudio, "post-stop audio admitted")
            try await wait("audio adapter did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            let artifact = environment.registry.snapshot().artifacts.first {
                $0.identity == admission.artifact
            }
            require(artifact?.trackSummary?.isSuccessful == true,
                    "artifact did not bind both finalized tracks")
        }

        for (permissionState, expectedFailure) in [
            (AOSMicrophoneAuthorizationState.denied,
             AOSOperationCoreError.recordingMicrophonePermissionDenied),
            (.restricted, .recordingMicrophonePermissionRestricted),
            (.unknown, .recordingMicrophonePermissionUnknown),
        ] {
            let denied = try RecordingEnvironment(
                microphoneAuthorizationState: permissionState
            )
            let deniedAdmission = try denied.adapter.start(
                request: denied.request(microphone: true),
                connectionID: UUID()
            )
            try await wait("microphone permission failure did not terminalize") {
                operation(deniedAdmission, in: denied).state == .terminal
            }
            require(operation(deniedAdmission, in: denied).failureCode
                        == expectedFailure.code,
                    "microphone permission state lost its exact failure")
            require(!denied.native.startWasRequested()
                        && denied.native.microphoneBackend.startCount == 0,
                    "microphone permission failure acquired native authority")
            require(denied.microphoneAuthorization.requestCount == 0,
                    "settled microphone permission state was requested again")
        }

        let standaloneConflict = try RecordingEnvironment()
        _ = try standaloneConflict.holdStandaloneMicrophoneClaim()
        do {
            _ = try standaloneConflict.adapter.start(
                request: standaloneConflict.request(microphone: true),
                connectionID: UUID()
            )
            fatalError("standalone microphone claim did not conflict")
        } catch AOSOperationCoreError.resourceBusy {
        }
        require(!standaloneConflict.broker.retainsAuthority
                    && !standaloneConflict.native.startWasRequested()
                    && standaloneConflict.native.microphoneBackend.startCount == 0,
                "resource conflict acquired screen or microphone native authority")

        let microphone = try RecordingEnvironment(
            microphoneAuthorizationState: .notDetermined
        )
        let microphoneAdmission = try microphone.adapter.start(
            request: microphone.request(microphone: true),
            connectionID: UUID()
        )
        try await wait("microphone adapter start missing") {
            microphone.native.startWasRequested()
        }
        require(microphone.microphoneAuthorization.requestCount == 1,
                "not-determined microphone permission was not requested once")
        let claimed = microphone.registry.snapshot()
        let microphoneClaims = claimed.resourceClaims.filter {
            $0.operation == microphoneAdmission.operation && $0.state != .terminal
        }
        require(microphoneClaims.count == 2,
                "microphone selection did not atomically admit two claims")
        require(Set(microphoneClaims.map(\.transactionID)).count == 1,
                "microphone selection split its claim set")
        require(Set(microphoneClaims.map(\.resourceKey)) == Set([
            AOSScreenRecordingOperationAdapter.resourceKey,
            AOSMicrophoneOperationResourceIdentity.resourceKey,
        ]), "microphone selection claimed the wrong resources")
        require(microphone.native.microphoneBackend.startCount == 1
                    && microphone.native.microphone.healthy,
                "shared microphone session did not start exactly once")
        require(microphone.native.encoder.progress.trackSummary.microphone.available
                    && microphone.native.encoder.progress.trackSummary.microphone.sampleCount == 0,
                "microphone was admitted before successful startup availability")
        microphone.native.settleStart(.success(()))
        let microphoneAccepted = try microphone.native.publishMicrophone()
        require(microphoneAccepted, "microphone-first callback rejected")
        require(operation(microphoneAdmission, in: microphone).state == .starting,
                "microphone-first opened startup alone")
        let microphoneVideoAccepted = try microphone.native.publishFrame()
        require(microphoneVideoAccepted, "microphone video rejected")
        try await wait("microphone-selected tracks did not activate together") {
            operation(microphoneAdmission, in: microphone).state == .active
        }
        let activeMicrophone = operation(microphoneAdmission, in: microphone)
        require(activeMicrophone.progress?.trackSummary?.selectedTracks
                    == ["video", "microphone"],
                "operation progress lost microphone selection")
        _ = try microphone.cancel(microphoneAdmission.operation)
        try await wait("microphone adapter stop missing") {
            microphone.native.stopCount == 1
        }
        require(microphone.native.microphone.authorityAbsent,
                "microphone authority survived stop request")
        require(microphone.registry.snapshot().resourceClaims.contains {
            $0.operation == microphoneAdmission.operation && $0.state != .terminal
        }, "claims released before aggregate retirement")
        microphone.native.settleStop(.success(()))
        try await wait("microphone adapter did not terminalize") {
            operation(microphoneAdmission, in: microphone).state == .terminal
        }
        require(microphone.native.microphoneBackend.stopCount == 1,
                "shared microphone session stopped more than once")
        require(!microphone.registry.snapshot().resourceClaims.contains {
            $0.operation == microphoneAdmission.operation && $0.state != .terminal
        }, "claims remained after aggregate authority absence")

        for (intent, expectedOutcome) in [
            (AOSStopIntent.peerLost, AOSOperationOutcome.cancelled),
            (.deadline, .timedOut),
        ] {
            let interrupted = try RecordingEnvironment()
            let interruptedAdmission = try interrupted.adapter.start(
                request: interrupted.request(microphone: true),
                connectionID: UUID()
            )
            try await wait("interrupted microphone start missing") {
                interrupted.native.startWasRequested()
            }
            interrupted.native.settleStart(.success(()))
            _ = try interrupted.native.publishMicrophone()
            _ = try interrupted.native.publishFrame()
            try await wait("interrupted microphone operation inactive") {
                operation(interruptedAdmission, in: interrupted).state == .active
            }
            _ = try interrupted.registry.transitionOperation(
                interruptedAdmission.operation,
                to: .stopping,
                stopIntent: intent
            )
            _ = try interrupted.settlePreviouslyAdmittedStop(
                interruptedAdmission.operation
            )
            try await wait("interrupted microphone stop missing") {
                interrupted.native.stopCount == 1
            }
            require(interrupted.native.microphone.authorityAbsent,
                    "interrupted microphone authority outlived stop admission")
            require(interrupted.registry.snapshot().resourceClaims.contains {
                $0.operation == interruptedAdmission.operation && $0.state != .terminal
            }, "interrupted microphone claims released before aggregate retirement")
            interrupted.native.settleStop(.success(()))
            try await wait("interrupted microphone operation did not close") {
                operation(interruptedAdmission, in: interrupted).state == .terminal
            }
            require(operation(interruptedAdmission, in: interrupted).outcome
                        == expectedOutcome,
                    "interrupted microphone intent \(intent) produced "
                        + "\(String(describing: operation(interruptedAdmission, in: interrupted).outcome)) "
                        + "failure \(String(describing: operation(interruptedAdmission, in: interrupted).failureCode))")
            require(!interrupted.registry.snapshot().resourceClaims.contains {
                $0.operation == interruptedAdmission.operation && $0.state != .terminal
            }, "interrupted microphone claims survived verified absence")
        }

        let microphoneStartFailure = try RecordingEnvironment()
        microphoneStartFailure.native.microphoneBackend.startFailure =
            .recordingMicrophoneUnavailable
        let microphoneStartFailureAdmission = try microphoneStartFailure.adapter.start(
            request: microphoneStartFailure.request(microphone: true),
            connectionID: UUID()
        )
        try await wait("microphone start failure did not terminalize") {
            operation(microphoneStartFailureAdmission, in: microphoneStartFailure).state
                == .terminal
        }
        let failedMicrophone = operation(
            microphoneStartFailureAdmission,
            in: microphoneStartFailure
        )
        require(failedMicrophone.failureCode
                    == AOSOperationCoreError.recordingMicrophoneUnavailable.code,
                "microphone start failure produced \(String(describing: failedMicrophone.failureCode))")
        require(failedMicrophone.progress?.trackSummary?.microphone.available == false
                    && failedMicrophone.progress?.trackSummary?.microphone.sampleCount == 0
                    && failedMicrophone.progress?.trackSummary?.microphone.failureCode
                        == AOSOperationCoreError.recordingMicrophoneUnavailable.code,
                "microphone start failure published false availability or sample truth")
        require(microphoneStartFailure.native.microphone.authorityAbsent,
                "failed real microphone session retained authority")

        let unavailable = try RecordingEnvironment(
            sessionFailure: .recordingSystemAudioUnavailable
        )
        let unavailableAdmission = try unavailable.adapter.start(
            request: unavailable.request(systemAudio: true),
            connectionID: UUID()
        )
        try await wait("audio unavailability did not terminalize") {
            operation(unavailableAdmission, in: unavailable).state == .terminal
        }
        let unavailableOperation = operation(unavailableAdmission, in: unavailable)
        require(
            unavailableOperation.failureCode
                == AOSOperationCoreError.recordingSystemAudioUnavailable.code,
            "typed audio unavailability was overwritten"
        )
        require(
            unavailableOperation.progress?.trackSummary?.systemAudio.failureCode
                == AOSOperationCoreError.recordingSystemAudioUnavailable.code,
            "audio unavailability was omitted from track truth"
        )
        require(
            unavailableOperation.progress?.trackSummary?.systemAudio.available == false,
            "unregistered audio was marked available"
        )
        let unavailableArtifact = unavailable.registry.snapshot().artifacts.first {
            $0.identity == unavailableAdmission.artifact
        }
        require(
            unavailableArtifact?.trackSummary?.systemAudio.failureCode
                == AOSOperationCoreError.recordingSystemAudioUnavailable.code,
            "audio unavailability was omitted from artifact truth"
        )
        require(
            unavailableArtifact?.trackSummary?.systemAudio.available == false,
            "unavailable artifact truth claimed registered audio"
        )

        let bounded = try RecordingEnvironment(startupTimeout: 0.05)
        let boundedStartedAt = DispatchTime.now().uptimeNanoseconds
        let boundedAdmission = try bounded.adapter.start(
            request: bounded.request(systemAudio: true, microphone: true),
            connectionID: UUID()
        )
        try await wait("bounded audio start missing") {
            bounded.native.startWasRequested()
        }
        let boundedVideo = try bounded.native.publishFrame()
        let boundedAudio = try bounded.native.publishAudio()
        require(boundedVideo && boundedAudio, "bounded three-track callbacks rejected")
        try await Task.sleep(nanoseconds: 30_000_000)
        bounded.native.settleStart(.success(()))
        try await wait("bounded audio timeout did not request retirement") {
            bounded.native.stopCount == 1
        }
        let boundedElapsed = DispatchTime.now().uptimeNanoseconds - boundedStartedAt
        require(boundedElapsed < 70_000_000,
                "native startup and media barrier received separate budgets")
        bounded.native.settleStop(.success(()))
        try await wait("bounded audio timeout did not terminalize") {
            operation(boundedAdmission, in: bounded).state == .terminal
        }
        let boundedOperation = operation(boundedAdmission, in: bounded)
        require(
            boundedOperation.failureCode
                == AOSOperationCoreError.recordingMicrophoneNoSamples.code,
            "bounded silent microphone lost its typed failure"
        )
        require(boundedOperation.progress?.trackSummary?.microphone.available == true,
                "bounded silent microphone lost registration availability")
        require(boundedOperation.progress?.trackSummary?.microphone.firstSamplePresent == false,
                "bounded silent microphone claimed a first sample")
        require(boundedOperation.progress?.trackSummary?.microphone.sampleCount == 0,
                "bounded silent microphone claimed samples")
        require(
            boundedOperation.progress?.trackSummary?.microphone.failureCode
                == AOSOperationCoreError.recordingMicrophoneNoSamples.code,
            "bounded silent microphone omitted its track failure"
        )

        let bothSilent = try RecordingEnvironment(startupTimeout: 0.04)
        let bothSilentAdmission = try bothSilent.adapter.start(
            request: bothSilent.request(systemAudio: true, microphone: true),
            connectionID: UUID()
        )
        try await wait("both-silent start missing") {
            bothSilent.native.startWasRequested()
        }
        bothSilent.native.settleStart(.success(()))
        try await wait("both-silent settlement did not request retirement") {
            bothSilent.native.stopCount == 1
        }
        bothSilent.native.settleStop(.success(()))
        try await wait("both-silent settlement did not terminalize") {
            operation(bothSilentAdmission, in: bothSilent).state == .terminal
        }
        let bothSilentOperation = operation(bothSilentAdmission, in: bothSilent)
        require(bothSilentOperation.failureCode
                    == AOSOperationCoreError.recordingNoFrames.code,
                "both-silent terminal code did not prefer mandatory video")
        require(bothSilentOperation.failureCode == "SCREEN_RECORDING_NO_VIDEO_FRAMES",
                "mandatory-video public code drifted")
        require(bothSilentOperation.progress?.trackSummary?.video.failureCode
                    == AOSOperationCoreError.recordingNoFrames.code,
                "both-silent operation omitted video failure")
        require(bothSilentOperation.progress?.trackSummary?.systemAudio.failureCode
                    == AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                "both-silent operation omitted audio failure")
        require(bothSilentOperation.progress?.trackSummary?.microphone.failureCode
                    == AOSOperationCoreError.recordingMicrophoneNoSamples.code,
                "both-silent operation omitted microphone failure")
        require(bothSilentOperation.progress?.trackSummary?.video.available == true
                    && bothSilentOperation.progress?.trackSummary?.systemAudio.available == true
                    && bothSilentOperation.progress?.trackSummary?.microphone.available == true,
                "both-silent operation confused availability with samples")
        require(bothSilentOperation.progress?.trackSummary?.video.firstSamplePresent == false
                    && bothSilentOperation.progress?.trackSummary?.systemAudio.firstSamplePresent == false
                    && bothSilentOperation.progress?.trackSummary?.microphone.firstSamplePresent == false,
                "both-silent operation invented first samples")

        let audioOnly = try RecordingEnvironment(startupTimeout: 0.05)
        let audioOnlyAdmission = try audioOnly.adapter.start(
            request: audioOnly.request(systemAudio: true),
            connectionID: UUID()
        )
        try await wait("audio-only start missing") {
            audioOnly.native.startWasRequested()
        }
        let audioOnlyAccepted = try audioOnly.native.publishAudio()
        require(audioOnlyAccepted, "audio-only callback rejected")
        let audioProgress = operation(audioOnlyAdmission, in: audioOnly).progress
        require(audioProgress?.frameCount == 0 && audioProgress?.byteCount == 128,
                "audio-only global progress was not persisted")
        require(audioProgress?.trackSummary?.systemAudio.firstSamplePresent == true
                    && audioProgress?.trackSummary?.systemAudio.sampleCount == 1
                    && audioProgress?.trackSummary?.systemAudio.sampleByteCount == 128,
                "audio-only positive-byte truth was not persisted")
        audioOnly.native.settleStart(.success(()))
        try await wait("audio-only video timeout did not request retirement") {
            audioOnly.native.stopCount == 1
        }
        audioOnly.native.settleStop(.success(()))
        try await wait("audio-only video timeout did not terminalize") {
            operation(audioOnlyAdmission, in: audioOnly).state == .terminal
        }
        let audioOnlyOperation = operation(audioOnlyAdmission, in: audioOnly)
        require(audioOnlyOperation.failureCode
                    == AOSOperationCoreError.recordingNoFrames.code,
                "later mandatory-video absence did not control terminal failure")
        require(audioOnlyOperation.progress?.trackSummary?.video.failureCode
                    == AOSOperationCoreError.recordingNoFrames.code,
                "later mandatory-video failure was not persisted")
        require(audioOnlyOperation.progress?.trackSummary?.systemAudio.failureCode == nil,
                "valid audio was falsely failed by missing mandatory video")
    }

    static func productionPreEpochCallbackTruth() async throws {
        struct CallbackCase {
            let name: String
            let publishVideo: Bool
            let publishSystemAudio: Bool
            let failures: [AOSOperationCoreError]
            let terminal: AOSOperationCoreError
            let videoFailure: String?
            let systemAudioFailure: String?
            let microphoneFailure: String?
        }

        let cases = [
            CallbackCase(
                name: "microphone_then_system_all_missing",
                publishVideo: false,
                publishSystemAudio: false,
                failures: [.recordingMicrophoneFailed, .recordingSystemAudioFailed],
                terminal: .recordingNoFrames,
                videoFailure: AOSOperationCoreError.recordingNoFrames.code,
                systemAudioFailure: AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                microphoneFailure: AOSOperationCoreError.recordingMicrophoneNoSamples.code
            ),
            CallbackCase(
                name: "system_then_microphone_all_missing",
                publishVideo: false,
                publishSystemAudio: false,
                failures: [.recordingSystemAudioFailed, .recordingMicrophoneFailed],
                terminal: .recordingNoFrames,
                videoFailure: AOSOperationCoreError.recordingNoFrames.code,
                systemAudioFailure: AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                microphoneFailure: AOSOperationCoreError.recordingMicrophoneNoSamples.code
            ),
            CallbackCase(
                name: "microphone_then_system_video_present",
                publishVideo: true,
                publishSystemAudio: false,
                failures: [.recordingMicrophoneFailed, .recordingSystemAudioFailed],
                terminal: .recordingSystemAudioNoSamples,
                videoFailure: nil,
                systemAudioFailure: AOSOperationCoreError.recordingSystemAudioNoSamples.code,
                microphoneFailure: AOSOperationCoreError.recordingMicrophoneNoSamples.code
            ),
            CallbackCase(
                name: "system_then_microphone_audio_present",
                publishVideo: true,
                publishSystemAudio: true,
                failures: [.recordingSystemAudioFailed, .recordingMicrophoneFailed],
                terminal: .recordingMicrophoneNoSamples,
                videoFailure: nil,
                systemAudioFailure: nil,
                microphoneFailure: AOSOperationCoreError.recordingMicrophoneNoSamples.code
            ),
        ]
        var projections: [[String: Any]] = []
        for value in cases {
            let environment = try RecordingEnvironment()
            let admission = try environment.adapter.start(
                request: environment.request(systemAudio: true, microphone: true),
                connectionID: UUID()
            )
            try await wait("pre-epoch callback start missing") {
                environment.native.startWasRequested()
            }
            if value.publishVideo {
                let accepted = try environment.native.publishFrame()
                require(accepted,
                        "pre-epoch video callback was rejected")
            }
            if value.publishSystemAudio {
                let accepted = try environment.native.publishAudio()
                require(accepted,
                        "pre-epoch system-audio callback was rejected")
            }
            require(!environment.native.encoder.progress.sessionStarted,
                    "callback failure was injected after common-epoch settlement")
            for failure in value.failures {
                environment.native.injectCallbackFailure(failure)
            }
            environment.native.settleStart(.success(()))
            try await wait("pre-epoch callback cleanup did not request retirement") {
                environment.native.stopCount == 1
            }
            environment.native.settleStop(.success(()))
            try await wait("pre-epoch callback failure did not terminalize") {
                operation(admission, in: environment).state == .terminal
            }
            let state = environment.registry.snapshot()
            let record = operation(admission, in: environment)
            guard let summary = record.progress?.trackSummary else {
                fatalError("pre-epoch callback terminal omitted track truth")
            }
            let expectedSummary = withFailureCodes(
                harnessTrackSummary(
                    systemAudio: true,
                    microphone: true,
                    videoSamples: value.publishVideo ? 1 : 0,
                    audioSamples: value.publishSystemAudio ? 1 : 0,
                    microphoneSamples: 0,
                    finalized: false,
                    videoAvailable: true,
                    audioAvailable: true,
                    microphoneAvailable: true
                ),
                videoFailure: value.videoFailure,
                systemAudioFailure: value.systemAudioFailure,
                microphoneFailure: value.microphoneFailure
            )
            require(record.failureCode == value.terminal.code,
                    "\(value.name) terminal precedence drifted to \(String(describing: record.failureCode))")
            require(summary == expectedSummary,
                    "\(value.name) exact durable per-track truth drifted")
            let artifact = state.artifacts.first { $0.identity == admission.artifact }
            require(artifact?.state == .removed,
                    "\(value.name) failed artifact was not removed")
            require(artifact?.trackSummary == summary,
                    "\(value.name) artifact truth diverged from terminal progress")
            let row = projectionRow(
                phase: "pre_epoch_\(value.name)",
                systemAudioSelected: true,
                microphoneSelected: true,
                operation: record,
                state: state
            )
            let snapshot = row["snapshot"] as? [String: Any]
            let terminal = snapshot?["terminal"] as? [String: Any]
            let progress = snapshot?["progress"] as? [String: Any]
            require(terminal?["failure_code"] as? String == value.terminal.code,
                    "\(value.name) public terminal truth drifted")
            try requirePublicSummary(
                progress?["track_summary"],
                equals: expectedSummary,
                "\(value.name) public snapshot progress"
            )
            try requirePublicSummary(
                terminal?["track_summary"],
                equals: expectedSummary,
                "\(value.name) public snapshot terminal"
            )
            projections.append(row)
        }

        let setup = try RecordingEnvironment(sessionFailure: .recordingEncoderFailed)
        let setupAdmission = try setup.adapter.start(
            request: setup.request(),
            connectionID: UUID()
        )
        try await wait("pre-native encoder setup failure did not terminalize") {
            operation(setupAdmission, in: setup).state == .terminal
        }
        let setupState = setup.registry.snapshot()
        let setupRecord = operation(setupAdmission, in: setup)
        let setupExpectedSummary = withFailureCodes(
            .initial(systemAudioSelected: false),
            videoFailure: AOSOperationCoreError.recordingEncoderFailed.code,
            systemAudioFailure: nil,
            microphoneFailure: nil
        )
        require(setupRecord.failureCode == AOSOperationCoreError.recordingEncoderFailed.code,
                "pre-native encoder setup failure was normalized")
        require(setupRecord.progress?.trackSummary == setupExpectedSummary,
                "pre-native encoder setup durable per-track truth drifted")
        let setupRow = projectionRow(
            phase: "pre_native_encoder_setup_failure",
            systemAudioSelected: false,
            microphoneSelected: false,
            operation: setupRecord,
            state: setupState
        )
        let setupSnapshot = setupRow["snapshot"] as? [String: Any]
        let setupTerminal = setupSnapshot?["terminal"] as? [String: Any]
        let setupProgress = setupSnapshot?["progress"] as? [String: Any]
        require(setupTerminal?["failure_code"] as? String
                    == AOSOperationCoreError.recordingEncoderFailed.code,
                "public pre-native encoder setup failure was normalized")
        try requirePublicSummary(
            setupProgress?["track_summary"],
            equals: setupExpectedSummary,
            "pre-native encoder public snapshot progress"
        )
        try requirePublicSummary(
            setupTerminal?["track_summary"],
            equals: setupExpectedSummary,
            "pre-native encoder public snapshot terminal"
        )
        projections.append(setupRow)
        let data = try JSONSerialization.data(withJSONObject: projections, options: [.sortedKeys])
        print("pre-epoch-callback-projections:\(String(data: data, encoding: .utf8)!)")
    }

    static func productionStartupUncertaintyRetainsAuthority() async throws {
        let stopped = try RecordingEnvironment()
        let admission = try stopped.adapter.start(
            request: stopped.request(microphone: true), connectionID: UUID()
        )
        try await wait("startup-stop native start missing") { stopped.native.startWasRequested() }
        require(stopped.native.microphone.healthy,
                "startup-cancel microphone authority was not established")
        _ = try stopped.cancel(admission.operation)
        try await Task.sleep(nanoseconds: 5_000_000)
        require(stopped.broker.retainsAuthority, "startup stop released uncertain broker")
        require(stopped.registry.snapshot().resourceClaims.contains {
            $0.operation == admission.operation && $0.state != .terminal
        }, "startup cancel released microphone claim before native settlement")
        require(stopped.native.stopCount == 0, "pending startup was stopped as active")
        stopped.native.settleStart(.failure(CancellationError()))
        try await wait("startup stop did not terminalize") {
            operation(admission, in: stopped).state == .terminal
        }
        require(stopped.native.microphone.authorityAbsent,
                "startup-cancel microphone authority survived terminal settlement")

        let lost = try RecordingEnvironment()
        let lostAdmission = try lost.adapter.start(
            request: lost.request(), connectionID: UUID()
        )
        try await wait("callback-loss native start missing") { lost.native.startWasRequested() }
        try await wait("callback loss was not bounded") {
            operation(lostAdmission, in: lost).state == .cleanupRequired
        }
        require(lost.broker.retainsAuthority, "callback loss released uncertain broker")
        lost.native.settleStart(.failure(HarnessFault.link))
        try await wait("callback-loss cleanup did not converge") {
            operation(lostAdmission, in: lost).state == .terminal
        }
    }

    static func productionRetirementAndFrameDrainAreAuthoritative() async throws {
        let uncertain = try RecordingEnvironment()
        let uncertainAdmission = try uncertain.adapter.start(
            request: uncertain.request(microphone: true), connectionID: UUID()
        )
        try await wait("false-retirement start missing") { uncertain.native.startWasRequested() }
        uncertain.native.settleStart(.success(()))
        _ = try uncertain.native.publishMicrophone()
        _ = try uncertain.native.publishFrame()
        try await wait("false-retirement operation inactive") {
            operation(uncertainAdmission, in: uncertain).state == .active
        }
        _ = try uncertain.cancel(uncertainAdmission.operation)
        try await wait("false-retirement stop missing") { uncertain.native.stopCount == 1 }
        uncertain.native.settleStop(.failure(HarnessFault.removeSource))
        try await wait("false retirement was not retained") {
            operation(uncertainAdmission, in: uncertain).state == .cleanupRequired
        }
        require(uncertain.broker.retainsAuthority, "false retirement released broker")
        require(uncertain.native.microphone.authorityAbsent,
                "false screen retirement retained microphone authority")
        require(uncertain.registry.snapshot().resourceClaims.contains {
            $0.operation == uncertainAdmission.operation && $0.state != .terminal
        }, "false screen retirement released claims before convergence")
        uncertain.native.lifecycle.confirmRetirement()
        try await wait("observed retirement did not converge") {
            operation(uncertainAdmission, in: uncertain).state == .terminal
        }

        let draining = try RecordingEnvironment()
        let drainingAdmission = try draining.adapter.start(
            request: draining.request(), connectionID: UUID()
        )
        try await wait("drain start missing") { draining.native.startWasRequested() }
        draining.native.settleStart(.success(()))
        try await wait("drain operation inactive") {
            operation(drainingAdmission, in: draining).state == .active
        }
        let admittedFrame = try draining.native.publishFrame(hold: true)
        require(admittedFrame, "pre-stop frame rejected")
        let before = operation(drainingAdmission, in: draining).progress
        _ = try draining.cancel(drainingAdmission.operation)
        try await wait("drain stop missing") { draining.native.stopCount == 1 }
        draining.native.settleStop(.success(()))
        let postStopFrame = try draining.native.publishFrame()
        require(!postStopFrame, "post-stop frame admitted")
        require(operation(drainingAdmission, in: draining).progress == before,
                "post-stop progress mutated")
        try await Task.sleep(nanoseconds: 5_000_000)
        require(draining.broker.retainsAuthority, "pre-boundary frame was not drained")
        draining.native.completeHeldFrame()
        try await wait("frame drain did not terminalize") {
            operation(drainingAdmission, in: draining).state == .terminal
        }
    }

    static func productionTerminalArtifactFailuresCleanUp() async throws {
        for missing in [false, true] {
            let environment = try RecordingEnvironment()
            let admission = try environment.adapter.start(
                request: environment.request(), connectionID: UUID()
            )
            try await wait("terminal-failure start missing") {
                environment.native.startWasRequested()
            }
            environment.native.settleStart(.success(()))
            try await wait("terminal-failure operation inactive") {
                operation(admission, in: environment).state == .active
            }
            if missing {
                let admittedFrame = try environment.native.publishFrame()
                require(admittedFrame, "missing-artifact frame rejected")
                environment.native.encoder.finishFilePresent = false
            }
            _ = try environment.cancel(admission.operation)
            try await wait("terminal-failure stop missing") {
                environment.native.stopCount == 1
            }
            environment.native.settleStop(.success(()))
            try await wait("terminal artifact failure did not close") {
                operation(admission, in: environment).state == .terminal
            }
            let state = environment.registry.snapshot()
            let terminal = operation(admission, in: environment)
            require(terminal.stopIntent == .cancel && terminal.outcome == .cancelled,
                    "adapter failure overwrote public stop writer")
            require(terminal.failureCode == nil,
                    "adapter failure published after public stop writer")
            require(state.artifacts.first { $0.identity == admission.artifact }?.state == .removed,
                    "failed artifact was not removed")
            require(environment.files.cleanupCount == 1, "failed artifact cleanup count drifted")
        }
    }

    static func productionCustodyAdmissionIsAtomic() async throws {
        let retainUnavailable = try RecordingEnvironment()
        let retainedArtifact = try retainUnavailable.offeredArtifact()
        do {
            try retainUnavailable.adapter.retainArtifact(retainedArtifact)
        } catch AOSOperationCoreError.artifactRetainUnavailable {
        }
        require(retainUnavailable.registry.snapshot().artifacts.first {
            $0.identity == retainedArtifact
        }?.state == .offered, "retain-unavailable mutated producer custody")
        require(AOSOperationCoreError.artifactRetainUnavailable.code
                    == "OPERATION_ARTIFACT_RETAIN_UNAVAILABLE",
                "retain-unavailable public code drifted")

        let releaseWins = try RecordingEnvironment()
        let artifact = try releaseWins.offeredArtifact()
        releaseWins.files.blockAfterLink = true
        let releasing = Task.detached {
            try releaseWins.adapter.releaseArtifact(
                artifact,
                ownerRoot: releaseWins.owner,
                destinationPath: "/private/tmp/released-recording.mov"
            )
        }
        require(releaseWins.files.waitUntilLinked(), "release link barrier was not reached")
        do {
            _ = try releaseWins.adapter.removeArtifact(artifact, ownerRoot: releaseWins.owner)
            fatalError("remove admitted during live release")
        } catch AOSOperationCoreError.invalidTransition {
        }
        let live = releaseWins.registry.snapshot().artifacts.first { $0.identity == artifact }!
        require(live.state == .offered && live.release != nil,
                "generic transition cleared live release")
        releaseWins.files.resumeLinkedRelease()
        _ = try await releasing.value
        let released = releaseWins.registry.snapshot().artifacts.first {
            $0.identity == artifact
        }!
        require(released.state == .released && released.release == nil,
                "release winner did not converge")
        require(released.custodyReceipt?.destinationIdentityDigest == String(repeating: "4", count: 64),
                "release winner lost exact destination")

        let removeWins = try RecordingEnvironment()
        let removedArtifact = try removeWins.offeredArtifact()
        _ = try removeWins.adapter.removeArtifact(removedArtifact, ownerRoot: removeWins.owner)
        do {
            _ = try removeWins.adapter.releaseArtifact(
                removedArtifact,
                ownerRoot: removeWins.owner,
                destinationPath: "/private/tmp/released-recording.mov"
            )
            fatalError("release admitted after remove")
        } catch AOSOperationCoreError.invalidTransition {
        }
        let removed = removeWins.registry.snapshot().artifacts.first {
            $0.identity == removedArtifact
        }!
        require(removed.state == .removed && removed.release == nil,
                "remove winner retained release state")
        require(!removeWins.files.destinationPresent,
                "removed artifact coexisted with exact destination")
    }

    static func productionCustodyFaultsRecoverDurably() async throws {
        for fault in [FakeFiles.Fault.link, .removeSource] {
            let environment = try RecordingEnvironment()
            let artifact = try environment.offeredArtifact()
            environment.files.faults = [fault]
            do {
                _ = try environment.adapter.releaseArtifact(
                    artifact, ownerRoot: environment.owner,
                    destinationPath: "/private/tmp/released-recording.mov"
                )
                fatalError("custody fault reported success")
            } catch {
            }
            let recovered = environment.registry.snapshot().artifacts.first {
                $0.identity == artifact
            }!
            require(recovered.state == .offered && recovered.release == nil,
                    "custody fault did not roll back")
        }

        let persistLinked = try RecordingEnvironment()
        let linkedArtifact = try persistLinked.offeredArtifact()
        persistLinked.files.afterLink = {
            (persistLinked.store as! AOSInMemoryOperationStateStore).failNextSave = true
        }
        do {
            _ = try persistLinked.adapter.releaseArtifact(
                linkedArtifact, ownerRoot: persistLinked.owner,
                destinationPath: "/private/tmp/released-recording.mov"
            )
            fatalError("linked-phase persistence fault reported success")
        } catch {
        }
        require(persistLinked.registry.snapshot().artifacts.first {
            $0.identity == linkedArtifact
        }?.state == .offered, "linked-phase persistence fault did not roll back")

        let persistReleased = try RecordingEnvironment()
        let releasedArtifact = try persistReleased.offeredArtifact()
        persistReleased.files.afterRemoveSource = {
            (persistReleased.store as! AOSInMemoryOperationStateStore).failNextSave = true
        }
        _ = try persistReleased.adapter.releaseArtifact(
            releasedArtifact, ownerRoot: persistReleased.owner,
            destinationPath: "/private/tmp/released-recording.mov"
        )
        require(persistReleased.registry.snapshot().artifacts.first {
            $0.identity == releasedArtifact
        }?.state == .released, "released-phase persistence recovery lost custody")

        let residual = try RecordingEnvironment()
        let residualArtifact = try residual.offeredArtifact()
        residual.files.faults = [.removeSource, .removeDestination]
        do {
            _ = try residual.adapter.releaseArtifact(
                residualArtifact, ownerRoot: residual.owner,
                destinationPath: "/private/tmp/released-recording.mov"
            )
            fatalError("custody residual reported success")
        } catch AOSOperationCoreError.recordingCleanupRequired {
        }
        let residualRecord = residual.registry.snapshot().artifacts.first {
            $0.identity == residualArtifact
        }!
        require(residualRecord.state == .cleanupRequired && residualRecord.release != nil,
                "custody residual truth was not durable")

        residual.files.faults = []
        let restarted = try RecordingEnvironment(store: residual.store, files: residual.files)
        let recovery = try AOSOperationRecovery.beginBootRecovery(
            registry: restarted.registry,
            newDaemonGeneration: 8,
            claimTokenDigest: String(repeating: "c", count: 64)
        )
        let recoveryRecord = restarted.registry.snapshot().artifacts.first {
            $0.identity == residualArtifact
        }!
        let resolution = try restarted.adapter.recoverArtifactRelease(recoveryRecord)
        require(resolution == .rolledBack,
                "restart recovery did not roll back exact duplicate")
        try restarted.adapter.removeRecoveredRolledBackArtifact(recoveryRecord)
        let summary = try AOSOperationRecovery.reconcile(
            registry: restarted.registry,
            recoveryGeneration: recovery.recoveryGeneration,
            claimTokenDigest: String(repeating: "c", count: 64),
            mechanicallyAbsentOperationIDs: [recoveryRecord.parentOperation],
            mechanicallyAbsentClaimIDs: [], mechanicallyAbsentBrokerIDs: []
        )
        require(summary.residualCount == 0 && summary.state == .terminal,
                "restart recovery did not reach explicit residual truth")
    }

    static func callbackLossIsBounded() async throws {
        let lifecycle = FakeLifecycle()
        let box = OwnerBox()
        let started = Date()
        do {
            _ = try await aosStartDesktopPixelStreams(
                signals: [AOSDesktopPixelStartupSignal()],
                lifecycles: [lifecycle],
                settlementTimeout: 0.03,
                ownerGeneration: 41,
                ownerReady: { box.set($0) },
                start: { _, _ in },
                stop: { _, _ in }
            )
            fatalError("missing callback reported startup success")
        } catch {
            require(Date().timeIntervalSince(started) < 0.3, "startup deadline was not finite")
        }
        guard let owner = box.get() else { fatalError("owner not handed off") }
        require(owner.generation == 41, "owner generation drifted")
        require(owner.retainsAuthority, "callback-loss owner was discarded")
        lifecycle.confirmRetirement()
        let retired = await owner.retire(timeout: 0.05)
        require(retired, "late retirement was not observed")
        require(!owner.retainsAuthority, "retired owner was not released")
    }

    static func startupStopRetainsOwner() async throws {
        let lifecycle = FakeLifecycle()
        let box = OwnerBox()
        let cancellation = AOSDesktopPixelStartupCancellation()
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.005) {
            cancellation.cancel()
        }
        do {
            _ = try await aosStartDesktopPixelStreams(
                signals: [AOSDesktopPixelStartupSignal()],
                lifecycles: [lifecycle],
                settlementTimeout: 0.03,
                ownerGeneration: 42,
                ownerReady: { box.set($0) },
                cancellation: cancellation,
                start: { _, _ in },
                stop: { _, _ in }
            )
            fatalError("startup cancellation reported success")
        } catch {
        }
        guard let owner = box.get() else { fatalError("cancel owner not handed off") }
        require(owner.retainsAuthority, "cancel discarded uncertain authority")
        lifecycle.confirmRetirement()
        let retired = await owner.retire(timeout: 0.05)
        require(retired, "startup-stop retirement did not converge")
    }

    static func startupTaskCancellationRetainsOwner() async throws {
        let lifecycle = FakeLifecycle()
        let box = OwnerBox()
        let startup = Task {
            try await aosStartDesktopPixelStreams(
                signals: [AOSDesktopPixelStartupSignal()],
                lifecycles: [lifecycle],
                settlementTimeout: 0.03,
                ownerGeneration: 44,
                ownerReady: { box.set($0) },
                start: { _, _ in },
                stop: { _, _ in }
            )
        }
        try await Task.sleep(nanoseconds: 5_000_000)
        startup.cancel()
        do {
            _ = try await startup.value
            fatalError("task cancellation reported startup success")
        } catch {
        }
        guard let owner = box.get() else { fatalError("task-cancel owner not handed off") }
        require(owner.retainsAuthority, "task cancellation discarded uncertain authority")
        lifecycle.confirmRetirement()
        let retired = await owner.retire(timeout: 0.05)
        require(retired, "task-cancel retirement did not converge")
    }

    static func retirementTimeoutRetainsOwner() async throws {
        let lifecycle = FakeLifecycle()
        let owner = try await aosStartDesktopPixelStreams(
            signals: [AOSDesktopPixelStartupSignal()],
            lifecycles: [lifecycle],
            settlementTimeout: 0.05,
            ownerGeneration: 43,
            start: { _, completion in completion(.success(())) },
            stop: { _, _ in }
        )
        let uncertain = await owner.retire(timeout: 0.02)
        require(!uncertain, "unknown stop reported retirement")
        require(owner.retainsAuthority, "timeout discarded native owner")
        lifecycle.confirmRetirement()
        let retired = await owner.retire(timeout: 0.05)
        require(retired, "observed retirement did not settle")
    }

    static func retirementFalseSettlementRetainsOwner() async throws {
        let lifecycle = FakeLifecycle()
        let owner = try await aosStartDesktopPixelStreams(
            signals: [AOSDesktopPixelStartupSignal()],
            lifecycles: [lifecycle],
            settlementTimeout: 0.05,
            ownerGeneration: 45,
            start: { _, completion in completion(.success(())) },
            stop: { _, completion in completion(.failure(HarnessFault.removeSource)) }
        )
        let falseSettlement = await owner.retire(timeout: 0.02)
        require(!falseSettlement, "false stop settlement reported retirement")
        require(owner.retainsAuthority, "false stop settlement discarded native owner")
        lifecycle.confirmRetirement()
        let retired = await owner.retire(timeout: 0.05)
        require(retired, "late retirement after false settlement did not converge")
    }

    static func lateStartFailureAfterActiveEvidenceRequiresStop() async throws {
        let lifecycle = FakeLifecycle()
        let signal = AOSDesktopPixelStartupSignal()
        let native = NativeInterleaving()
        let startup = Task {
            try await aosStartDesktopPixelStreams(
                signals: [signal],
                lifecycles: [lifecycle],
                settlementTimeout: 0.1,
                ownerGeneration: 46,
                start: { _, completion in native.start(completion) },
                stop: { _, completion in native.stop(completion) }
            )
        }
        while !native.startWasRequested() {
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        signal.succeed()
        let owner = try await startup.value
        native.failStart()
        let retirement = Task { await owner.retire(timeout: 0.1) }
        try await Task.sleep(nanoseconds: 5_000_000)
        require(native.stopCount == 1, "active evidence was misclassified as inactive")
        require(owner.retainsAuthority, "late start failure released active authority")
        native.settleStop()
        let didRetire = await retirement.value
        require(didRetire, "authoritative retirement did not settle")
        require(native.stopCount == 1, "late start failure stopped more than once")
        require(!owner.retainsAuthority, "retired late-failure owner was retained")
    }

    static func frameAdmissionClosesAtomically() async {
        let gate = AOSDesktopPixelFrameAdmissionGate()
        guard let first = gate.admit() else { fatalError("open gate rejected frame") }
        require(gate.close() == 1, "stop did not bind the in-flight frame")
        require(gate.admit() == nil, "post-stop frame was admitted")
        let premature = await gate.waitForDrain(timeout: 0.01)
        require(!premature, "in-flight frame did not block drain")
        first.complete()
        first.complete()
        let drained = await gate.waitForDrain(timeout: 0.05)
        require(drained, "pre-stop frame did not drain once")
        require(!gate.isOpen, "closed frame gate reopened")
    }

    static func decoderAndTerminalTruthAreClosed() throws {
        for action in ["artifact_reveal", "artifact_remove", "artifact_retain"] {
            let decoded = try aosDecodeArtifactActionRequest(
                action: action,
                data: actionData()
            )
            require(decoded.selector.generation == 7, "selector generation drifted")
            require(decoded.destinationPath == nil, "selector action admitted destination")
        }
        let release = try aosDecodeArtifactActionRequest(
            action: "artifact_release",
            data: actionData(destination: "/private/tmp/recording.mov")
        )
        require(release.destinationPath == "/private/tmp/recording.mov", "release destination lost")
        expectInvalid {
            _ = try aosDecodeArtifactActionRequest(
                action: "artifact_reveal", data: actionData(extra: true)
            )
        }
        expectInvalid {
            _ = try aosDecodeArtifactActionRequest(
                action: "artifact_remove", data: actionData(destination: "/private/tmp/x")
            )
        }
        expectInvalid {
            _ = try aosDecodeArtifactActionRequest(
                action: "artifact_release",
                data: actionData(destination: "/private/tmp/x", extra: true)
            )
        }
        expectInvalid {
            _ = try aosDecodeArtifactActionRequest(
                action: "artifact_release", data: actionData(destination: true)
            )
        }
        for generation: Any in [true, 1.5, NSNumber(value: UInt64(9_007_199_254_740_992))] {
            expectInvalid {
                _ = try aosDecodeArtifactActionRequest(
                    action: "artifact_reveal", data: actionData(generation: generation)
                )
            }
        }
        expectInvalid {
            _ = try aosDecodeArtifactActionRequest(
                action: "artifact_reveal", data: actionData(selectorExtra: true)
            )
        }

        do {
            try AOSScreenRecordingTerminalTruth.requireFrames(0)
            fatalError("zero-frame success admitted")
        } catch AOSOperationCoreError.recordingNoFrames {
        }
        do {
            try AOSScreenRecordingTerminalTruth.requireFinalizedArtifact(
                frameCount: 1,
                artifact: nil,
                filePresent: false,
                expectedSummary: harnessTrackSummary(systemAudio: false)
            )
            fatalError("missing artifact success admitted")
        } catch AOSOperationCoreError.recordingArtifactMissing {
        }
    }

    static func main() async throws {
        try productionAtomicInitialSummaryAdmission()
        try await productionAdmissionResponses()
        try productionMultitrackCoordination()
        try await productionAdapterAudioTracks()
        try await productionAdapterFollowGeometry()
        try await productionFollowStopInterleavings()
        try await productionPreEpochCallbackTruth()
        try await productionLateFailureRetainsAuthority()
        try await productionStartupUncertaintyRetainsAuthority()
        try await productionRetirementAndFrameDrainAreAuthoritative()
        try await productionTerminalArtifactFailuresCleanUp()
        try await productionCustodyAdmissionIsAtomic()
        try await productionCustodyFaultsRecoverDurably()
        try await callbackLossIsBounded()
        try await startupStopRetainsOwner()
        try await startupTaskCancellationRetainsOwner()
        try await retirementTimeoutRetainsOwner()
        try await retirementFalseSettlementRetainsOwner()
        try await lateStartFailureAfterActiveEvidenceRequiresStop()
        await frameAdmissionClosesAtomically()
        try decoderAndTerminalTruthAreClosed()
        print("terminal-lifecycle-custody-harness: atomic-admission=22 consecutive-preparation-cleanup-fault=1 pre-epoch-callbacks=4 pre-native-encoder=1 microphone-claim-set=1 standalone-conflict=1 three-track-orders=6 microphone-backpressure=1 multitrack=three-track adapter-microphone=1 prepared-publication-public-stop=2 waiting-stop-preparation-failure=1 post-admission-geometry-save-failure=1 blocked-stop-store=1 pre-install-public-stop=2 production-lifecycle=6 production-terminal=2 production-custody=10 lifecycle=6 frame=6 decoder=8 terminal=2 cleanup=6")
    }
}
`

test('production request, geometry, timeline, and progress owners reject lossy state', async () => {
  const temporaryRoot = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'aos-screen-recording-owner-'))
  try {
    const support = path.join(temporaryRoot, 'Support.swift')
    const harness = path.join(temporaryRoot, 'Harness.swift')
    const binary = path.join(temporaryRoot, 'screen-recording-owner-harness')
    await Promise.all([writeFile(support, supportSource), writeFile(harness, harnessSource)])
    const compile = spawnSync('swiftc', [
      path.join(root, 'src/daemon/public-capture-transfer.swift'),
      support,
      path.join(root, 'src/daemon/screen-recording-geometry.swift'),
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
    assert.match(run.stdout, /31 assertions/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('runtime ownership wires topology validation and throwing progress before effects', async () => {
  const [adapter, geometry, unified] = await Promise.all([
    readFile(path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/screen-recording-geometry.swift'), 'utf8'),
    readFile(path.join(root, 'src/daemon/unified.swift'), 'utf8'),
  ])
  assert.match(geometry, /let admittedTopology: AOSDisplayTopologySnapshot/u)
  assert.match(geometry, /canonicalTopologyData\(observedTopology\)[\s\S]*canonicalTopologyData\(geometry\.admittedTopology\)/u)
  const streamOutput = adapter.slice(adapter.indexOf(
    'private final class AOSScreenRecordingStreamOutput',
  ))
  const frameValidation = streamOutput.indexOf('try validateBinding()')
  const frameAppend = streamOutput.indexOf('try encoder.append(sampleBuffer, track: track)')
  const frameProgress = streamOutput.indexOf('try persistProgress(progress)')
  assert.ok(frameValidation >= 0 && frameValidation < frameAppend && frameAppend < frameProgress)
  assert.doesNotMatch(adapter, /try\?\s+aosPersistScreenRecordingProgress/u)
  assert.ok((adapter.match(/try aosPersistScreenRecordingProgress/gu) ?? []).length >= 2)
  assert.match(unified, /aosExactOperationWireIdentity/u)
  assert.match(unified, /aosArtifactReleaseDestinationPath/u)
})

test('runtime-shaped custody validates while false action, state, path, and media pairs fail', () => {
  const schemaPath = path.join(root, 'shared/schemas/aos-artifact-v1.schema.json')
  const recordingSchemaPath = path.join(root, 'shared/schemas/aos-screen-recording-v1.schema.json')
  const python = String.raw`
import copy, json, sys
from jsonschema import Draft202012Validator, RefResolver
schema = json.load(open(sys.argv[1], encoding="utf-8"))
recording = json.load(open(sys.argv[2], encoding="utf-8"))
validator = Draft202012Validator(schema, resolver=RefResolver.from_schema(schema, store={recording["$id"]: recording}))
track = lambda selected, count, finalized: {
  "selected": selected, "admitted": selected, "available": count > 0,
  "first_sample_present": count > 0, "sample_count": count,
  "sample_byte_count": count * 128, "failure_code": None,
  "drained": (not selected) or finalized, "finalized": (not selected) or finalized,
}
summary = {
  "selected_tracks": ["video"], "finalized_tracks": ["video"],
  "common_media_epoch_ns": 1, "video": track(True, 1, True),
  "system_audio": track(False, 0, True),
  "microphone": track(False, 0, True),
}
base = {
  "schema_version": "aos.artifact.custody-result.v1",
  "action": "reveal",
  "artifact": {"artifact_id": "artifact-1", "artifact_generation": 1},
  "state": "offered", "byte_count": 512,
  "content_digest": "a" * 64,
  "media_type": "video/quicktime; codecs=avc1",
  "track_summary": summary,
  "path": "/tmp/artifact.mov"
}
assert validator.is_valid(base)
audio = copy.deepcopy(base)
audio["media_type"] = "video/quicktime; codecs=avc1,mp4a.40.2"
audio["track_summary"]["selected_tracks"] = ["video", "system_audio"]
audio["track_summary"]["finalized_tracks"] = ["video", "system_audio"]
audio["track_summary"]["system_audio"] = track(True, 1, True)
assert validator.is_valid(audio)
microphone = copy.deepcopy(base)
microphone["media_type"] = "video/quicktime; codecs=avc1,mp4a.40.2"
microphone["track_summary"]["selected_tracks"] = ["video", "microphone"]
microphone["track_summary"]["finalized_tracks"] = ["video", "microphone"]
microphone["track_summary"]["microphone"] = track(True, 1, True)
assert validator.is_valid(microphone)
bad = []
value = copy.deepcopy(base); value.update(action="remove", state="offered"); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value.update(action="remove", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.update(action="release", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value["media_type"] = "video/quicktime; codecs=hevc"; bad.append(value)
value = copy.deepcopy(audio); value["media_type"] = "video/quicktime; codecs=avc1"; bad.append(value)
assert all(not validator.is_valid(value) for value in bad)
print("custody-schema: 3 positive, 6 negative")
`
  const result = spawnSync('python3', ['-c', python, schemaPath, recordingSchemaPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /3 positive, 6 negative/u)
})

test('production lifecycle and custody owners close terminal fault phases with fake dependencies', async () => {
  const temporaryRoot = await mkdtemp(path.join(
    process.env.TMPDIR ?? os.tmpdir(),
    'aos-screen-recording-terminal-',
  ))
  try {
    const support = path.join(temporaryRoot, 'Support.swift')
    const harness = path.join(temporaryRoot, 'Harness.swift')
    const binary = path.join(temporaryRoot, 'terminal-lifecycle-custody-harness')
    await Promise.all([
      writeFile(support, terminalSupportSource),
      writeFile(harness, terminalHarnessSource),
    ])
    const compile = spawnSync('swiftc', [
      '-module-cache-path', path.join(temporaryRoot, 'module-cache'),
      path.join(root, 'src/daemon/operation-owner-root.swift'),
      path.join(root, 'src/daemon/operation-spawn-record.swift'),
      path.join(root, 'src/daemon/operation-state.swift'),
      path.join(root, 'src/daemon/operation-store.swift'),
      path.join(root, 'src/daemon/operation-registry.swift'),
      path.join(root, 'src/daemon/operation-resource-broker.swift'),
      path.join(root, 'src/daemon/operation-resource-transaction.swift'),
      path.join(root, 'src/daemon/operation-resource-claim.swift'),
      path.join(root, 'src/daemon/operation-control.swift'),
      path.join(root, 'src/daemon/operation-recovery.swift'),
      path.join(root, 'src/daemon/desktop-pixel-retirement.swift'),
      path.join(root, 'src/daemon/desktop-pixel-native-operation.swift'),
      path.join(root, 'src/daemon/desktop-pixel-stream-lifecycle.swift'),
      path.join(root, 'src/daemon/public-capture-transfer.swift'),
      path.join(root, 'src/daemon/microphone-authorization.swift'),
      path.join(root, 'src/daemon/microphone-native-session.swift'),
      path.join(root, 'src/daemon/screen-recording-geometry.swift'),
      path.join(root, 'src/daemon/screen-recording-follow-geometry.swift'),
      path.join(root, 'src/daemon/screen-recording-encoder.swift'),
      path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'),
      path.join(root, 'src/shared/envelope.swift'),
      support,
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
    assert.match(run.stdout, /atomic-admission=22 consecutive-preparation-cleanup-fault=1 pre-epoch-callbacks=4 pre-native-encoder=1 microphone-claim-set=1 standalone-conflict=1 three-track-orders=6 microphone-backpressure=1 multitrack=three-track adapter-microphone=1 prepared-publication-public-stop=2 waiting-stop-preparation-failure=1 post-admission-geometry-save-failure=1 blocked-stop-store=1 pre-install-public-stop=2/u)
    const projectionLine = run.stdout.split('\n').find((line) => (
      line.startsWith('atomic-initial-summary-projections:')
    ))
    assert.ok(projectionLine, run.stdout)
    const projections = JSON.parse(projectionLine.slice(
      'atomic-initial-summary-projections:'.length,
    ))
    assert.equal(projections.length, 22)
    assert.deepEqual(projections.map((value) => value.phase), Array.from(
      { length: 11 }, () => ['prepared', 'terminal'],
    ).flat())
    const callbackProjectionLine = run.stdout.split('\n').find((line) => (
      line.startsWith('pre-epoch-callback-projections:')
    ))
    assert.ok(callbackProjectionLine, run.stdout)
    const callbackProjections = JSON.parse(callbackProjectionLine.slice(
      'pre-epoch-callback-projections:'.length,
    ))
    assert.deepEqual(callbackProjections.map((value) => value.phase), [
      'pre_epoch_microphone_then_system_all_missing',
      'pre_epoch_system_then_microphone_all_missing',
      'pre_epoch_microphone_then_system_video_present',
      'pre_epoch_system_then_microphone_audio_present',
      'pre_native_encoder_setup_failure',
    ])
    const admissionLine = run.stdout.split('\n').find((line) => (
      line.startsWith('production-admission-responses:')
    ))
    assert.ok(admissionLine, run.stdout)
    const admissionResponses = JSON.parse(admissionLine.slice(
      'production-admission-responses:'.length,
    ))
    assert.equal(admissionResponses.length, 4)
    const geometryEventLine = run.stdout.split('\n').find((line) => (
      line.startsWith('production-geometry-event-envelope:')
    ))
    assert.ok(geometryEventLine, run.stdout)
    const geometryEvent = JSON.parse(geometryEventLine.slice(
      'production-geometry-event-envelope:'.length,
    ))
    const schemaValidation = spawnSync('python3', ['-c', String.raw`
import json, os, sys
from jsonschema import Draft202012Validator, FormatChecker, RefResolver

schema_dir = sys.argv[1]
schemas = []
for name in os.listdir(schema_dir):
    if not name.endswith('.schema.json'):
        continue
    with open(os.path.join(schema_dir, name), encoding='utf-8') as handle:
        value = json.load(handle)
    if '$id' in value:
        schemas.append(value)
store = {value['$id']: value for value in schemas}
operation_id = next(key for key in store if key.endswith('/aos-operation-v1.schema.json'))

def validator(definition):
    target = {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$ref': operation_id + '#/$defs/' + definition,
    }
    return Draft202012Validator(
        target,
        resolver=RefResolver.from_schema(target, store=store),
        format_checker=FormatChecker(),
    )

rows = json.load(sys.stdin)
snapshot_validator = validator('operation_snapshot')
list_validator = validator('operation_list_result')
inspect_validator = validator('operation_inspect_result')
for row in rows['projections']:
    snapshot = row['snapshot']
    list_result = row['list']
    inspect_result = row['inspect']
    snapshot_errors = list(snapshot_validator.iter_errors(snapshot))
    list_errors = list(list_validator.iter_errors(list_result))
    inspect_errors = list(inspect_validator.iter_errors(inspect_result))
    assert not snapshot_errors, (row['phase'], row['system_audio_selected'], [
        error.message for error in snapshot_errors
    ])
    assert not list_errors, (row['phase'], row['system_audio_selected'], [
        error.message for error in list_errors
    ])
    assert not inspect_errors, (row['phase'], row['system_audio_selected'], [
        error.message for error in inspect_errors
    ])
    assert list_result['operations'] == [snapshot]
    assert inspect_result['snapshot'] == snapshot
recording_id = next(key for key in store if key.endswith('/aos-screen-recording-v1.schema.json'))
target = {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$ref': recording_id + '#/$defs/admission_result',
}
admission_validator = Draft202012Validator(
    target,
    resolver=RefResolver.from_schema(target, store=store),
    format_checker=FormatChecker(),
)
for response in rows['admissions']:
    errors = list(admission_validator.iter_errors(response))
    assert not errors, [error.message for error in errors]
operation_event_id = next(key for key in store if key.endswith('/aos-operation-event-v1.schema.json'))
daemon_event_id = next(key for key in store if key.endswith('/daemon-event.schema.json'))
operation_event_validator = Draft202012Validator(
    store[operation_event_id],
    resolver=RefResolver.from_schema(store[operation_event_id], store=store),
    format_checker=FormatChecker(),
)
daemon_event_validator = Draft202012Validator(
    store[daemon_event_id],
    resolver=RefResolver.from_schema(store[daemon_event_id], store=store),
    format_checker=FormatChecker(),
)
event_errors = list(operation_event_validator.iter_errors(rows['geometry_event']['event']))
envelope_errors = list(daemon_event_validator.iter_errors(rows['geometry_event']['envelope']))
assert not event_errors, [error.message for error in event_errors]
assert not envelope_errors, [error.message for error in envelope_errors]
assert rows['geometry_event']['envelope']['data'] == rows['geometry_event']['event']
print('atomic-operation-schema: snapshots=17 list=17 inspect=17 admissions=4 events=1 envelopes=1')
`, path.join(root, 'shared/schemas')], {
      encoding: 'utf8',
      input: JSON.stringify({
        projections: [...projections, ...callbackProjections],
        admissions: admissionResponses,
        geometry_event: geometryEvent,
      }),
      timeout: 20_000,
    })
    assert.equal(
      schemaValidation.status,
      0,
      `${schemaValidation.stdout}\n${schemaValidation.stderr}`,
    )
    assert.match(
      schemaValidation.stdout,
      /snapshots=17 list=17 inspect=17 admissions=4 events=1 envelopes=1/u,
    )

    const [lifecycle, state, adapter, unified] = await Promise.all([
      readFile(path.join(root, 'src/daemon/desktop-pixel-stream-lifecycle.swift'), 'utf8'),
      readFile(path.join(root, 'src/daemon/operation-state.swift'), 'utf8'),
      readFile(path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'), 'utf8'),
      readFile(path.join(root, 'src/daemon/unified.swift'), 'utf8'),
    ])
    assert.match(lifecycle, /AOSDesktopPixelFrameAdmissionGate/u)
    assert.match(lifecycle, /ownerReady/u)
    assert.match(state, /AOSArtifactReleaseCoordinator/u)
    assert.match(state, /aosDecodeArtifactActionRequest/u)
    assert.match(adapter, /AOSArtifactReleaseCoordinator/u)
    assert.match(adapter, /aosValidateScreenRecordingProductionFrameBinding/u)
    assert.match(unified, /aosDecodeArtifactActionRequest/u)
    assert.match(unified, /admission\.publicValue\(request: request\)/u)
    assert.match(
      unified,
      /broadcastEvent\(service: "operation", event: event, data: data\)/u,
    )
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
