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
        require(audio.tracks.systemAudio, "explicit system audio was rejected")
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
            "tracks": ["video": true, "system_audio": false, "microphone": true],
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
            bounds: bounds
        ) { stored.append($0) }
        require(progress.frameCount == 4 && progress.byteCount == 512, "nonzero progress lost")
        require(stored == [progress], "durable progress not published")
        var reportedSuccess = false
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 5,
                byteCount: 640,
                elapsedMilliseconds: 1_000,
                bounds: bounds
            ) { _ in throw HarnessFailure.injectedSave }
            reportedSuccess = true
        } catch HarnessFailure.injectedSave {}
        require(!reportedSuccess, "save failure produced false success")
        do {
            try aosPersistScreenRecordingProgress(
                frameCount: 34,
                byteCount: 1_024,
                elapsedMilliseconds: 1_000,
                bounds: bounds
            ) { _ in }
            fatalError("unbounded frame progress accepted")
        } catch AOSOperationCoreError.recordingBoundsExceeded {}
        print("screen-recording-owner-harness: 22 assertions")
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
`

const terminalHarnessSource = String.raw`
import CoreMedia
import Foundation

enum HarnessFault: Error {
    case link
    case removeSource
    case removeDestination
}

func harnessTrackSummary(
    systemAudio: Bool,
    videoSamples: UInt64 = 1,
    audioSamples: UInt64 = 0,
    finalized: Bool = true
) -> AOSScreenRecordingTrackSummary {
    func truth(selected: Bool, samples: UInt64) -> AOSScreenRecordingTrackTruth {
        AOSScreenRecordingTrackTruth(
            selected: selected,
            admitted: selected,
            available: samples > 0,
            firstSamplePresent: samples > 0,
            sampleCount: samples,
            sampleByteCount: samples * 128,
            failureCode: nil,
            drained: !selected || finalized,
            finalized: !selected || finalized
        )
    }
    return AOSScreenRecordingTrackSummary(
        selectedTracks: systemAudio ? ["video", "system_audio"] : ["video"],
        finalizedTracks: finalized
            ? (systemAudio ? ["video", "system_audio"] : ["video"]) : [],
        commonMediaEpochNanoseconds: videoSamples > 0 && (!systemAudio || audioSamples > 0)
            ? 1_000_000 : nil,
        video: truth(selected: true, samples: videoSamples),
        systemAudio: truth(selected: systemAudio, samples: audioSamples)
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
    private var bytes: UInt64 = 0
    private var systemAudioSelected = false
    private var finalized = false
    var finishFilePresent = true
    private(set) var cancelCount = 0

    init(files: FakeFiles) { self.files = files }

    var progress: AOSScreenRecordingEncoderProgress {
        lock.lock(); defer { lock.unlock() }
        let started = frames > 0 && (!systemAudioSelected || audioSamples > 0)
        let summary = harnessTrackSummary(
            systemAudio: systemAudioSelected,
            videoSamples: started ? frames : 0,
            audioSamples: started ? audioSamples : 0,
            finalized: finalized
        )
        return AOSScreenRecordingEncoderProgress(
            frameCount: started ? frames : 0,
            byteCount: started ? bytes : 0,
            trackSummary: summary,
            sessionStarted: started
        )
    }

    func configure(_ tracks: AOSScreenRecordingTracks) {
        lock.lock(); systemAudioSelected = tracks.systemAudio; lock.unlock()
    }

    func record(_ track: AOSScreenRecordingTrackKind) {
        lock.lock()
        if track == .video { frames += 1 } else { audioSamples += 1 }
        bytes += 128
        lock.unlock()
    }

    func append(
        _ sampleBuffer: CMSampleBuffer,
        track: AOSScreenRecordingTrackKind
    ) throws { record(track) }

    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void) {
        lock.lock()
        if systemAudioSelected && audioSamples == 0 {
            lock.unlock()
            completion(.failure(AOSOperationCoreError.recordingSystemAudioNoSamples))
            return
        }
        finalized = true
        let summary = harnessTrackSummary(
            systemAudio: systemAudioSelected,
            videoSamples: frames,
            audioSamples: audioSamples,
            finalized: true
        )
        lock.unlock()
        files.setSourcePresent(finishFilePresent)
        completion(.success(files.identity(summary: summary)))
    }

    func cancel() { lock.lock(); cancelCount += 1; lock.unlock() }
}

final class FakeNativeSession: @unchecked Sendable {
    let encoder: FakeEncoder
    let lifecycle: FakeLifecycle
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
            lock.lock(); frameGate = gate; self.progress = progress; lock.unlock()
            return AOSScreenRecordingNativeSession(
                encoder: encoder,
                lifecycle: lifecycle,
                signal: signal,
                start: { [self] completion in
                    lock.lock(); startCompletion = completion; lock.unlock()
                },
                stop: { [self] completion in
                    lock.lock(); stopCount += 1; stopCompletion = completion; lock.unlock()
                }
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

final class RecordingEnvironment {
    let adapter: AOSScreenRecordingOperationAdapter
    let broker = FakeBroker()
    let clock = FakeClock()
    let files: FakeFiles
    let native: FakeNativeSession
    let owner = AOSMechanicalOwnerRoot(
        ownerID: "recording-owner", effectiveUID: 501, pid: 100, pidGeneration: 3,
        executableIdentityDigest: String(repeating: "a", count: 64)
    )
    let registry: AOSOperationRegistry
    let store: AOSInMemoryOperationStateStore

    init(
        store existingStore: AOSInMemoryOperationStateStore? = nil,
        files existingFiles: FakeFiles? = nil,
        sessionFailure: AOSOperationCoreError? = nil
    ) throws {
        files = existingFiles ?? FakeFiles()
        native = FakeNativeSession(files: files)
        let registration = try AOSScreenRecordingOperationAdapter.makeRegistration()
        let registrations = try AOSAdapterRegistrySnapshot.make(
            revision: 1,
            registrations: [registration]
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
            sessionFactory: selectedFactory
        )
        try registry.installRuntimeAdapters([adapter])
    }

    func request(systemAudio: Bool = false) throws -> AOSScreenRecordingRequest {
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
            "tracks": ["video": true, "system_audio": systemAudio, "microphone": false],
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
    private var ready: [AOSScreenRecordingTrackKind: Bool] = [.video: true, .systemAudio: true]
    private(set) var appended: [AOSScreenRecordingTrackKind: [CMTime]] = [
        .video: [], .systemAudio: [],
    ]
    private(set) var finishCount = 0
    private(set) var inputFinishCount: [AOSScreenRecordingTrackKind: Int] = [
        .video: 0, .systemAudio: 0,
    ]
    private(set) var sessionEpoch: CMTime?
    private(set) var startCount = 0
    var finishSucceeds = true
    private var writing = false

    func setReady(_ kind: AOSScreenRecordingTrackKind, _ value: Bool) {
        lock.lock(); ready[kind] = value; lock.unlock()
    }

    func writerDependencies() -> AOSScreenRecordingWriterDependencies {
        AOSScreenRecordingWriterDependencies(
            startWriting: { [self] in
                lock.lock(); defer { lock.unlock() }
                startCount += 1
                writing = true
                return true
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

func harnessSample(_ value: Int64) -> CMSampleBuffer {
    var block: CMBlockBuffer?
    let blockStatus = CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: 16,
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: 16,
        flags: 0,
        blockBufferOut: &block
    )
    precondition(blockStatus == noErr, "sample block creation failed")
    var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: 1_000),
        presentationTimeStamp: CMTime(value: value, timescale: 1_000),
        decodeTimeStamp: .invalid
    )
    var size = 16
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
    maximumPending: Int = 3,
    omitAudioInput: Bool = false
) throws -> AOSScreenRecordingMultitrackCoordinator {
    var inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies] = [
        .video: writer.input(.video),
    ]
    if !omitAudioInput { inputs[.systemAudio] = writer.input(.systemAudio) }
    return try AOSScreenRecordingMultitrackCoordinator(
        systemAudioSelected: systemAudio,
        maximumPendingSamplesPerTrack: maximumPending,
        writer: writer.writerDependencies(),
        inputs: inputs,
        observeOutputBytes: { 512 }
    )
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
        require(videoOnlyWriter.inputFinishCount[.systemAudio] == 0,
                "unselected audio input was finished")

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
            finalizationError as? AOSOperationCoreError == .recordingSystemAudioFailed,
            "selected-audio finalization failure was not typed"
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
        let unavailableArtifact = unavailable.registry.snapshot().artifacts.first {
            $0.identity == unavailableAdmission.artifact
        }
        require(
            unavailableArtifact?.trackSummary?.systemAudio.failureCode
                == AOSOperationCoreError.recordingSystemAudioUnavailable.code,
            "audio unavailability was omitted from artifact truth"
        )
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
        persistLinked.files.afterLink = { persistLinked.store.failNextSave = true }
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
            persistReleased.store.failNextSave = true
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
        print("terminal-lifecycle-custody-harness: multitrack=40 adapter-audio=26 production-lifecycle=6 production-terminal=2 production-custody=8 lifecycle=6 frame=6 decoder=8 terminal=2 cleanup=6")
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
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /22 assertions/u)
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
bad = []
value = copy.deepcopy(base); value.update(action="remove", state="offered"); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value.update(action="remove", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.update(action="release", state="removed"); bad.append(value)
value = copy.deepcopy(base); value.pop("path"); bad.append(value)
value = copy.deepcopy(base); value["media_type"] = "video/quicktime; codecs=hevc"; bad.append(value)
assert all(not validator.is_valid(value) for value in bad)
print("custody-schema: 1 positive, 5 negative")
`
  const result = spawnSync('python3', ['-c', python, schemaPath, recordingSchemaPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /1 positive, 5 negative/u)
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
      path.join(root, 'src/daemon/screen-recording-geometry.swift'),
      path.join(root, 'src/daemon/screen-recording-encoder.swift'),
      path.join(root, 'src/daemon/screen-recording-operation-adapter.swift'),
      support,
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /multitrack=40 adapter-audio=26 production-lifecycle=6 production-terminal=2 production-custody=8 lifecycle=6 frame=6 decoder=8 terminal=2 cleanup=6/u)

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
