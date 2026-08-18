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
        print("screen-recording-owner-harness: 20 assertions")
    }
}
`

const terminalSupportSource = String.raw`
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

enum AOSDesktopPixelBroker {
    static let defaultRetirementTimeout: TimeInterval = 0.2
}
`

const terminalHarnessSource = String.raw`
import Foundation

enum HarnessFault: Error {
    case link
    case persistLinked
    case removeSource
    case persistReleased
    case removeDestination
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

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission {
        retirement.admitExplicitStop()
    }

    func confirmRetirement() { retirement.observe() }
    func sampleIsReady() throws -> Bool { true }
    func retirementWasObserved() -> Bool { retirement.snapshot() }
    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await retirement.wait(timeout: timeout)
    }
}

final class FakeCustody {
    let fault: HarnessFault?
    var destinationExists = false
    var persistedLinked = false
    var persistedReleased = false
    var persistedResolution: AOSArtifactReleaseResolution?
    var sourceExists = true

    init(fault: HarnessFault?) {
        self.fault = fault
    }

    func execution(
        linked: AOSArtifactReleaseDestinationFileIdentity
    ) -> AOSArtifactReleaseExecutionDependencies {
        AOSArtifactReleaseExecutionDependencies(
            linkDestination: { [self] in
                if fault == .link { throw HarnessFault.link }
                destinationExists = true
                return linked
            },
            persistDestinationLinked: { [self] _ in
                if fault == .persistLinked { throw HarnessFault.persistLinked }
                persistedLinked = true
            },
            removeSource: { [self] in
                if fault == .removeSource { throw HarnessFault.removeSource }
                sourceExists = false
            },
            persistReleased: { [self] _ in
                if fault == .persistReleased { throw HarnessFault.persistReleased }
                persistedReleased = true
            }
        )
    }

    func recover(
        removeFault: Bool = false
    ) throws -> AOSArtifactReleaseResolution {
        try AOSArtifactReleaseCoordinator.recover(
            source: sourceExists ? .exact : .absent,
            destination: destinationExists ? .exact : .absent,
            dependencies: AOSArtifactReleaseRecoveryDependencies(
                removeExactDestination: { [self] in
                    if removeFault { throw HarnessFault.removeDestination }
                    destinationExists = false
                },
                persistResolution: { [self] resolution in
                    persistedResolution = resolution
                }
            )
        )
    }
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

    static func custodyFaultsRecoverExactly() throws {
        let source = AOSArtifactFileIdentity(
            rootIdentityDigest: String(repeating: "1", count: 64),
            relativeLocatorDigest: String(repeating: "2", count: 64),
            device: 7,
            inode: 11,
            byteCount: 512,
            contentDigest: String(repeating: "3", count: 64),
            mediaType: "video/quicktime; codecs=avc1"
        )
        let linked = AOSArtifactReleaseDestinationFileIdentity(
            device: 7,
            inode: 11,
            byteCount: 512,
            contentDigest: String(repeating: "3", count: 64)
        )
        let release = AOSArtifactReleaseRecord(
            releaseGeneration: 13,
            artifact: AOSOperationIdentity(id: "artifact-1", generation: 7),
            daemonGeneration: 5,
            sourceIdentity: source,
            destinationIdentity: AOSArtifactReleaseDestinationIdentity(
                absolutePath: "/private/tmp/recording.mov",
                pathDigest: String(repeating: "4", count: 64),
                parentDevice: 7,
                parentInode: 9
            ),
            phase: .prepared,
            destinationFileIdentity: nil
        )
        require(release.releaseGeneration == 13, "release generation was not exact")
        require(release.sourceIdentity == source, "release source identity drifted")
        require(release.destinationIdentity.parentInode == 9, "destination identity drifted")

        let success = FakeCustody(fault: nil)
        try AOSArtifactReleaseCoordinator.execute(
            release,
            dependencies: success.execution(linked: linked)
        )
        require(!success.sourceExists && success.destinationExists, "release effects were incomplete")
        require(success.persistedLinked && success.persistedReleased, "release phases were not durable")

        let cases: [(HarnessFault, AOSArtifactReleaseResolution)] = [
            (.link, .rolledBack),
            (.persistLinked, .rolledBack),
            (.removeSource, .rolledBack),
            (.persistReleased, .released),
        ]
        for (fault, expected) in cases {
            let fake = FakeCustody(fault: fault)
            do {
                try AOSArtifactReleaseCoordinator.execute(
                    release,
                    dependencies: fake.execution(linked: linked)
                )
                fatalError("fault phase reported success")
            } catch {
            }
            let resolution = try fake.recover()
            require(resolution == expected, "fault phase resolved incorrectly")
            require(fake.persistedResolution == expected, "recovery truth was not durable")
            if expected == .rolledBack {
                require(fake.sourceExists && !fake.destinationExists, "rollback left custody residue")
            } else {
                require(!fake.sourceExists && fake.destinationExists, "release recovery lost custody")
            }
        }

        let cleanupFault = FakeCustody(fault: .removeSource)
        do {
            try AOSArtifactReleaseCoordinator.execute(
                release,
                dependencies: cleanupFault.execution(linked: linked)
            )
            fatalError("cleanup fault setup reported success")
        } catch {
        }
        let cleanupResolution = try cleanupFault.recover(removeFault: true)
        require(cleanupResolution == .residual, "cleanup fault was hidden")
        require(cleanupFault.persistedResolution == .residual, "residual truth was not durable")
        require(AOSArtifactReleaseCoordinator.resolution(
            source: .absent,
            destination: .conflicting
        ) == .residual, "conflicting destination was misclassified")
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
                filePresent: false
            )
            fatalError("missing artifact success admitted")
        } catch AOSOperationCoreError.recordingArtifactMissing {
        }
    }

    static func main() async throws {
        try await callbackLossIsBounded()
        try await startupStopRetainsOwner()
        try await startupTaskCancellationRetainsOwner()
        try await retirementTimeoutRetainsOwner()
        try await retirementFalseSettlementRetainsOwner()
        await frameAdmissionClosesAtomically()
        try custodyFaultsRecoverExactly()
        try decoderAndTerminalTruthAreClosed()
        print("terminal-lifecycle-custody-harness: lifecycle=5 frame=6 custody=7 decoder=8 terminal=2 cleanup=3")
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
    assert.match(run.stdout, /20 assertions/u)
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
  const frameAppend = adapter.indexOf('try encoder.append(sampleBuffer)')
  const frameProgress = adapter.indexOf('try persistProgress(progress)')
  assert.ok(frameValidation >= 0 && frameValidation < frameAppend && frameAppend < frameProgress)
  assert.doesNotMatch(adapter, /try\?\s+aosPersistScreenRecordingProgress/u)
  assert.ok((adapter.match(/try aosPersistScreenRecordingProgress/gu) ?? []).length >= 2)
  assert.match(unified, /aosExactOperationWireIdentity/u)
  assert.match(unified, /aosArtifactReleaseDestinationPath/u)
})

test('runtime-shaped custody validates while false action, state, path, and media pairs fail', () => {
  const schemaPath = path.join(root, 'shared/schemas/aos-artifact-v1.schema.json')
  const python = String.raw`
import copy, json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding="utf-8"))
validator = Draft202012Validator(schema)
base = {
  "schema_version": "aos.artifact.custody-result.v1",
  "action": "reveal",
  "artifact": {"artifact_id": "artifact-1", "artifact_generation": 1},
  "state": "offered", "byte_count": 512,
  "content_digest": "a" * 64,
  "media_type": "video/quicktime; codecs=avc1",
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
  const result = spawnSync('python3', ['-c', python, schemaPath], { encoding: 'utf8' })
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
      path.join(root, 'src/daemon/operation-state.swift'),
      path.join(root, 'src/daemon/operation-owner-root.swift'),
      path.join(root, 'src/daemon/operation-spawn-record.swift'),
      path.join(root, 'src/daemon/desktop-pixel-retirement.swift'),
      path.join(root, 'src/daemon/desktop-pixel-stream-lifecycle.swift'),
      support,
      harness,
      '-o', binary,
    ], { encoding: 'utf8' })
    assert.equal(compile.status, 0, compile.stderr || compile.stdout)
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    assert.match(run.stdout, /lifecycle=5 frame=6 custody=7 decoder=8 terminal=2 cleanup=3/u)

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
