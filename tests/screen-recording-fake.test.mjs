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
        print("screen-recording-owner-harness: 25 assertions")
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
    private(set) var releaseCount = 0

    func acquireExclusiveProducer(ownerID: String) throws -> AOSDesktopPixelExclusiveProducerLease {
        lock.lock()
        defer { lock.unlock() }
        guard lease == nil else { throw AOSDesktopFrameCaptureFailure.captureFailed }
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
            mediaType: summary.selectedSystemAudio
                ? "video/quicktime; codecs=avc1,mp4a.40.2"
                : "video/quicktime; codecs=avc1",
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

final class FakeMicrophoneSession: AOSMicrophoneNativeSessionControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var running = false
    private(set) var startCount = 0
    private(set) var stopCount = 0

    var healthy: Bool { lock.lock(); defer { lock.unlock() }; return running }
    var authorityAbsent: Bool { !healthy }

    func start(_ handler: @escaping AOSMicrophoneNativeInputHandler) throws -> AVAudioFormat {
        lock.lock(); running = true; startCount += 1; lock.unlock()
        return AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
    }

    func stop() -> Bool {
        lock.lock(); running = false; stopCount += 1; lock.unlock()
        return true
    }
}

final class FakeNativeSession: @unchecked Sendable {
    let encoder: FakeEncoder
    let lifecycle: FakeLifecycle
    let microphone = FakeMicrophoneSession()
    let signal = AOSDesktopPixelStartupSignal()
    private var frameGate: AOSDesktopPixelFrameAdmissionGate?
    private var heldFrame: AOSDesktopPixelFrameAdmissionGate.Token?
    private let lock = NSLock()
    private var progress: AOSScreenRecordingProgressSink?
    private var startCompletion: AOSDesktopPixelNativeCompletion?
    private var stopCompletion: AOSDesktopPixelNativeCompletion?
    private(set) var stopCount = 0

    init(files: FakeFiles) {
        let encoder = FakeEncoder(files: files)
        self.encoder = encoder
        lifecycle = FakeLifecycle { encoder.progress.sessionStarted }
    }

    func factory() -> AOSScreenRecordingSessionFactory {
        { [self] tracks, gate, progress, _ in
            encoder.configure(tracks)
            try encoder.markAvailable(.video)
            if tracks.systemAudio { try encoder.markAvailable(.systemAudio) }
            if tracks.microphone { try encoder.markAvailable(.microphone) }
            lock.lock(); frameGate = gate; self.progress = progress; lock.unlock()
            return AOSScreenRecordingNativeSession(
                encoder: encoder,
                lifecycle: lifecycle,
                signal: signal,
                start: { [self] completion in
                    if tracks.microphone {
                        do { _ = try microphone.start { _, _ in } }
                        catch { completion(.failure(error)); return }
                    }
                    lock.lock(); startCompletion = completion; lock.unlock()
                },
                stop: { [self] completion in
                    if tracks.microphone { _ = microphone.stop() }
                    lock.lock(); stopCount += 1; stopCompletion = completion; lock.unlock()
                },
                microphoneSession: tracks.microphone ? microphone : nil
            )
        }
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
        try publish(.microphone, hold: hold)
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
}

final class AdmissionFaultStore: AOSOperationStateStore, @unchecked Sendable {
    private let lock = NSLock()
    private let failingSaveCall: Int
    private var saveCallCount = 0
    private var value: AOSOperationDurableState?
    private(set) var savedStates: [AOSOperationDurableState] = []

    init(failingSaveCall: Int) {
        self.failingSaveCall = failingSaveCall
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
        if saveCallCount == failingSaveCall {
            throw AOSOperationCoreError.storeUnavailable
        }
        value = state
        savedStates.append(state)
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

    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? { nil }
}

final class RecordingEnvironment {
    let adapter: AOSScreenRecordingOperationAdapter
    let broker = FakeBroker()
    let clock = FakeClock()
    let files: FakeFiles
    let native: FakeNativeSession
    let microphoneAdapter: FakeMicrophoneRegistrationAdapter
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
        startupTimeout: TimeInterval = aosDesktopPixelStreamRetirementTimeout
    ) throws {
        files = existingFiles ?? FakeFiles()
        native = FakeNativeSession(files: files)
        microphoneAdapter = try FakeMicrophoneRegistrationAdapter()
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
            microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies(
                status: { .authorized },
                request: { _ in
                    AOSMicrophoneAuthorizationRequestResult(
                        before: .authorized,
                        after: .authorized,
                        attempted: false,
                        completed: true
                    )
                }
            ),
            startupTimeout: startupTimeout
        )
        try registry.installRuntimeAdapters([microphoneAdapter, adapter])
    }

    func request(
        systemAudio: Bool = false,
        microphone: Bool = false
    ) throws -> AOSScreenRecordingRequest {
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        let topology = AOSDisplayTopologySnapshot(
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
        return try AOSScreenRecordingRequest.validatingPublicValue([
            "schema_version": "aos.screen-recording.request.v1",
            "request_id": "recording-request",
            "canonical_parameter_digest": String(repeating: "b", count: 64),
            "topology": topology,
            "target": ["kind": "display", "display_ordinal": 1],
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

    static func productionAtomicInitialSummaryAdmission() throws {
        var projections: [[String: Any]] = []
        for (systemAudioSelected, microphoneSelected) in [
            (false, false), (true, false), (false, true), (true, true),
        ] {
            let store = AdmissionFaultStore(failingSaveCall: 4)
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

            let cleanupState = environment.registry.snapshot()
            let cleanup = cleanupState.operations[0]
            require(cleanup.state == .cleanupRequired,
                    "post-admission durable fault did not enter cleanup")
            require(cleanup.progress?.trackSummary == expectedSummary,
                    "cleanup erased exact selected-track truth")
            require(cleanupState.streams.isEmpty
                        && cleanupState.artifacts.isEmpty
                        && cleanupState.resourceTransactions.isEmpty
                        && cleanupState.resourceClaims.isEmpty,
                    "post-admission fault created later preparation authority")
            require(!environment.broker.retainsAuthority,
                    "post-admission fault acquired broker authority")
            projections.append(projectionRow(
                phase: "cleanup",
                systemAudioSelected: systemAudioSelected,
                microphoneSelected: microphoneSelected,
                operation: cleanup,
                state: cleanupState
            ))

            let recoveredRegistry = try AOSOperationRegistry(
                store: store,
                daemonGeneration: 8,
                adapterRegistry: cleanupState.adapterRegistry,
                clock: { environment.clock.now() },
                idFactory: { "recovery-unused" }
            )
            let recovery = try AOSOperationRecovery.beginBootRecovery(
                registry: recoveredRegistry,
                newDaemonGeneration: 8,
                claimTokenDigest: String(repeating: "d", count: 64)
            )
            let recovering = recoveredRegistry.snapshot().operations[0]
            require(recovering.progress?.trackSummary == expectedSummary,
                    "boot recovery changed selected-track truth")
            _ = try AOSOperationRecovery.reconcile(
                registry: recoveredRegistry,
                recoveryGeneration: recovery.recoveryGeneration,
                claimTokenDigest: String(repeating: "d", count: 64),
                mechanicallyAbsentOperationIDs: [recovering.identity],
                mechanicallyAbsentClaimIDs: [],
                mechanicallyAbsentBrokerIDs: []
            )
            let recoveredState = recoveredRegistry.snapshot()
            let recovered = recoveredState.operations[0]
            require(recovered.state == .terminal,
                    "boot recovery did not terminalize absent preparation")
            require(recovered.progress?.trackSummary == expectedSummary,
                    "recovered operation changed selected-track truth")
            let recoveredSnapshot = AOSOperationPublicProjection.snapshot(
                recovered,
                state: recoveredState
            )
            let recoveredTerminal = recoveredSnapshot["terminal"] as? [String: Any]
            require(recoveredTerminal?["track_summary"] is [String: Any],
                    "terminal projection omitted selected-track truth")
            projections.append(projectionRow(
                phase: "recovered",
                systemAudioSelected: systemAudioSelected,
                microphoneSelected: microphoneSelected,
                operation: recovered,
                state: recoveredState
            ))
        }
        let data = try JSONSerialization.data(withJSONObject: projections, options: [.sortedKeys])
        print("atomic-initial-summary-projections:\(String(data: data, encoding: .utf8)!)")
    }

    static func requireWriterFailureTruth(
        _ summary: AOSScreenRecordingTrackSummary,
        sessionStarted: Bool
    ) {
        require(summary.selectedTracks == ["video", "system_audio"],
                "writer failure lost the selected set")
        require(summary.finalizedTracks.isEmpty,
                "writer failure claimed finalized tracks")
        require((summary.commonMediaEpochNanoseconds != nil) == sessionStarted,
                "writer failure common-epoch truth drifted")
        for (truth, failureCode) in [
            (summary.video, AOSOperationCoreError.recordingEncoderFailed.code),
            (summary.systemAudio, AOSOperationCoreError.recordingSystemAudioFailed.code),
        ] {
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

        let threeTrackWriter = FakeMultitrackWriter()
        let threeTrack = try multitrackCoordinator(threeTrackWriter, microphone: true)
        try threeTrack.append(harnessSample(30), track: .microphone)
        try threeTrack.append(harnessSample(10), track: .video)
        require(!threeTrack.progress.sessionStarted,
                "three-track barrier opened before system audio")
        try threeTrack.append(harnessSample(20), track: .systemAudio)
        require(threeTrack.progress.sessionStarted,
                "three-track barrier did not open")
        require(threeTrackWriter.sessionEpoch == CMTime(value: 10, timescale: 1_000),
                "three-track epoch did not select earliest sample")
        require(threeTrack.progress.trackSummary.selectedTracks
                    == ["video", "system_audio", "microphone"],
                "three-track selected set drifted")

        let monotonicWriter = FakeMultitrackWriter()
        let monotonic = try multitrackCoordinator(monotonicWriter)
        try monotonic.append(harnessSample(10), track: .video)
        try monotonic.append(harnessSample(10), track: .systemAudio)
        do {
            try monotonic.append(harnessSample(9), track: .systemAudio)
            fatalError("nonmonotonic audio accepted")
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

        for audioFirst in [true, false] {
            let writer = FakeMultitrackWriter()
            writer.startSucceeds = false
            let coordinator = try multitrackCoordinator(writer)
            do {
                if audioFirst {
                    try coordinator.append(harnessSample(2), track: .systemAudio)
                    try coordinator.append(harnessSample(1), track: .video)
                } else {
                    try coordinator.append(harnessSample(1), track: .video)
                    try coordinator.append(harnessSample(2), track: .systemAudio)
                }
                fatalError("writer start failure was accepted")
            } catch AOSOperationCoreError.recordingEncoderFailed {
            }
            requireWriterFailureTruth(
                coordinator.progress.trackSummary,
                sessionStarted: false
            )
        }

        let stoppedWriter = FakeMultitrackWriter()
        let stopped = try multitrackCoordinator(stoppedWriter)
        try stopped.append(harnessSample(1), track: .video)
        try stopped.append(harnessSample(2), track: .systemAudio)
        stoppedWriter.forceNotWriting()
        do {
            try stopped.append(harnessSample(3), track: .video)
            fatalError("post-start writer failure was accepted")
        } catch AOSOperationCoreError.recordingEncoderFailed {
        }
        requireWriterFailureTruth(
            stopped.progress.trackSummary,
            sessionStarted: true
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
        let failing = try multitrackCoordinator(failingWriter)
        try failing.append(harnessSample(2), track: .systemAudio)
        try failing.append(harnessSample(1), track: .video)
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
        require(failingWriter.finishCount == 1, "failing writer finalized more than once")
        require(failingWriter.inputFinishCount[.video] == 1,
                "failing writer did not finish video input once")
        require(failingWriter.inputFinishCount[.systemAudio] == 1,
                "failing writer did not finish audio input once")

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
        _ = environment.adapter.requestStop(operation: admission.operation, force: false)
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
            _ = environment.adapter.requestStop(operation: admission.operation, force: false)
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

        let microphone = try RecordingEnvironment()
        let microphoneAdmission = try microphone.adapter.start(
            request: microphone.request(microphone: true),
            connectionID: UUID()
        )
        try await wait("microphone adapter start missing") {
            microphone.native.startWasRequested()
        }
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
        require(microphone.native.microphone.startCount == 1
                    && microphone.native.microphone.healthy,
                "shared microphone session did not start exactly once")
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
        _ = microphone.adapter.requestStop(
            operation: microphoneAdmission.operation,
            force: false
        )
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
        require(microphone.native.microphone.stopCount == 1,
                "shared microphone session stopped more than once")
        require(!microphone.registry.snapshot().resourceClaims.contains {
            $0.operation == microphoneAdmission.operation && $0.state != .terminal
        }, "claims remained after aggregate authority absence")

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
            request: bounded.request(systemAudio: true),
            connectionID: UUID()
        )
        try await wait("bounded audio start missing") {
            bounded.native.startWasRequested()
        }
        let boundedVideo = try bounded.native.publishFrame()
        require(boundedVideo, "bounded audio video callback rejected")
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
                == AOSOperationCoreError.recordingSystemAudioNoSamples.code,
            "bounded silent audio lost its typed failure"
        )
        require(boundedOperation.progress?.trackSummary?.systemAudio.available == true,
                "bounded silent audio lost registration availability")
        require(boundedOperation.progress?.trackSummary?.systemAudio.firstSamplePresent == false,
                "bounded silent audio claimed a first sample")
        require(boundedOperation.progress?.trackSummary?.systemAudio.sampleCount == 0,
                "bounded silent audio claimed samples")
        require(
            boundedOperation.progress?.trackSummary?.systemAudio.failureCode
                == AOSOperationCoreError.recordingSystemAudioNoSamples.code,
            "bounded silent audio omitted its track failure"
        )

        let bothSilent = try RecordingEnvironment(startupTimeout: 0.04)
        let bothSilentAdmission = try bothSilent.adapter.start(
            request: bothSilent.request(systemAudio: true),
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
        require(bothSilentOperation.progress?.trackSummary?.video.available == true
                    && bothSilentOperation.progress?.trackSummary?.systemAudio.available == true,
                "both-silent operation confused availability with samples")
        require(bothSilentOperation.progress?.trackSummary?.video.firstSamplePresent == false
                    && bothSilentOperation.progress?.trackSummary?.systemAudio.firstSamplePresent == false,
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

    static func productionStartupUncertaintyRetainsAuthority() async throws {
        let stopped = try RecordingEnvironment()
        let admission = try stopped.adapter.start(
            request: stopped.request(), connectionID: UUID()
        )
        try await wait("startup-stop native start missing") { stopped.native.startWasRequested() }
        _ = stopped.adapter.requestStop(operation: admission.operation, force: false)
        try await Task.sleep(nanoseconds: 5_000_000)
        require(stopped.broker.retainsAuthority, "startup stop released uncertain broker")
        require(stopped.native.stopCount == 0, "pending startup was stopped as active")
        stopped.native.settleStart(.failure(CancellationError()))
        try await wait("startup stop did not terminalize") {
            operation(admission, in: stopped).state == .terminal
        }

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
            request: uncertain.request(), connectionID: UUID()
        )
        try await wait("false-retirement start missing") { uncertain.native.startWasRequested() }
        uncertain.native.settleStart(.success(()))
        try await wait("false-retirement operation inactive") {
            operation(uncertainAdmission, in: uncertain).state == .active
        }
        _ = uncertain.adapter.requestStop(operation: uncertainAdmission.operation, force: false)
        try await wait("false-retirement stop missing") { uncertain.native.stopCount == 1 }
        uncertain.native.settleStop(.failure(HarnessFault.removeSource))
        try await wait("false retirement was not retained") {
            operation(uncertainAdmission, in: uncertain).state == .cleanupRequired
        }
        require(uncertain.broker.retainsAuthority, "false retirement released broker")
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
        _ = draining.adapter.requestStop(operation: drainingAdmission.operation, force: false)
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
            _ = environment.adapter.requestStop(operation: admission.operation, force: false)
            try await wait("terminal-failure stop missing") {
                environment.native.stopCount == 1
            }
            environment.native.settleStop(.success(()))
            try await wait("terminal artifact failure did not close") {
                operation(admission, in: environment).state == .terminal
            }
            let state = environment.registry.snapshot()
            require(operation(admission, in: environment).outcome == .failed,
                    "terminal artifact failure was not typed")
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
        try productionMultitrackCoordination()
        try await productionAdapterAudioTracks()
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
        print("terminal-lifecycle-custody-harness: atomic-admission=12 microphone-claim-set=1 multitrack=three-track adapter-microphone=1 production-lifecycle=6 production-terminal=2 production-custody=10 lifecycle=6 frame=6 decoder=8 terminal=2 cleanup=6")
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
    assert.match(run.stdout, /25 assertions/u)
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
  const frameValidation = adapter.indexOf('try validateBinding()')
  const frameAppend = adapter.indexOf('try encoder.append(sampleBuffer, track: track)')
  const frameProgress = adapter.indexOf('try persistProgress(progress)')
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
      path.join(root, 'src/daemon/operation-recovery.swift'),
      path.join(root, 'src/daemon/desktop-pixel-retirement.swift'),
      path.join(root, 'src/daemon/desktop-pixel-native-operation.swift'),
      path.join(root, 'src/daemon/desktop-pixel-stream-lifecycle.swift'),
      path.join(root, 'src/daemon/public-capture-transfer.swift'),
      path.join(root, 'src/daemon/microphone-authorization.swift'),
      path.join(root, 'src/daemon/microphone-native-session.swift'),
      path.join(root, 'src/daemon/screen-recording-geometry.swift'),
      path.join(root, 'src/daemon/screen-recording-encoder.swift'),
      path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'),
      support,
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
    assert.match(run.stdout, /atomic-admission=12 microphone-claim-set=1 multitrack=three-track adapter-microphone=1/u)
    const projectionLine = run.stdout.split('\n').find((line) => (
      line.startsWith('atomic-initial-summary-projections:')
    ))
    assert.ok(projectionLine, run.stdout)
    const projections = JSON.parse(projectionLine.slice(
      'atomic-initial-summary-projections:'.length,
    ))
    assert.equal(projections.length, 12)
    assert.deepEqual(projections.map((value) => value.phase), [
      'prepared', 'cleanup', 'recovered', 'prepared', 'cleanup', 'recovered',
      'prepared', 'cleanup', 'recovered', 'prepared', 'cleanup', 'recovered',
    ])
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
for row in rows:
    snapshot = row['snapshot']
    list_result = row['list']
    inspect_result = row['inspect']
    snapshot_errors = list(validator('operation_snapshot').iter_errors(snapshot))
    list_errors = list(validator('operation_list_result').iter_errors(list_result))
    inspect_errors = list(validator('operation_inspect_result').iter_errors(inspect_result))
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
print('atomic-operation-schema: snapshots=12 list=12 inspect=12')
`, path.join(root, 'shared/schemas')], {
      encoding: 'utf8',
      input: JSON.stringify(projections),
      timeout: 20_000,
    })
    assert.equal(
      schemaValidation.status,
      0,
      `${schemaValidation.stdout}\n${schemaValidation.stderr}`,
    )
    assert.match(schemaValidation.stdout, /snapshots=12 list=12 inspect=12/u)

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
    assert.match(unified, /aosDecodeArtifactActionRequest/u)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
