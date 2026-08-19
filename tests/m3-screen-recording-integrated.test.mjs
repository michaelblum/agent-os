import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')

const productionSources = [
  'src/daemon/operation-owner-root.swift',
  'src/daemon/operation-spawn-record.swift',
  'src/daemon/operation-state.swift',
  'src/daemon/operation-store.swift',
  'src/daemon/operation-registry.swift',
  'src/daemon/operation-resource-broker.swift',
  'src/daemon/operation-resource-transaction.swift',
  'src/daemon/operation-resource-claim.swift',
  'src/daemon/operation-control.swift',
  'src/daemon/operation-recovery.swift',
  'src/daemon/desktop-pixel-retirement.swift',
  'src/daemon/desktop-pixel-native-operation.swift',
  'src/daemon/desktop-pixel-stream-lifecycle.swift',
  'src/daemon/public-capture-transfer.swift',
  'src/daemon/microphone-authorization.swift',
  'src/daemon/microphone-native-session.swift',
  'src/daemon/microphone-operation-adapter.swift',
  'src/daemon/screen-recording-geometry.swift',
  'src/daemon/screen-recording-follow-geometry.swift',
  'src/daemon/screen-recording-encoder.swift',
  'src/daemon/screen-recording-operation-adapter.swift',
  'src/shared/envelope.swift',
  'src/shared/response-envelope.swift',
].map((value) => path.join(repoRoot, value))

const supportSource = String.raw`
import CoreGraphics
import Foundation

protocol AOSDesktopFrameCancelling: AnyObject { func cancel() }

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
    func acquireExclusiveProducer(ownerID: String) throws
        -> AOSDesktopPixelExclusiveProducerLease {
        fatalError("native broker is unavailable in the offline harness")
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

private func boundsValue(_ value: AOSDisplayTopologyBounds) -> [String: Any] {
    ["x": value.x, "y": value.y, "width": value.width, "height": value.height]
}

func aosDisplayTopologyWireValue(_ snapshot: AOSDisplayTopologySnapshot) throws
    -> [String: Any] {
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
            case .displayIDFallback(let value):
                member = ["kind": "display_id_fallback", "display_id_fallback": value]
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

func validateAOSDisplayTopologyWireValue(_ value: Any) throws
    -> AOSDisplayTopologySnapshot {
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
    fatalError("native topology observation is unavailable in the offline harness")
}

func observeCaptureWindowFacts() -> [CaptureWindowFact] {
    fatalError("native window observation is unavailable in the offline harness")
}

func aosRunOnMainSync(_ body: () -> Void) { body() }

enum AOSMicrophoneCaptureTerminalTrigger: String, Equatable {
    case completed
    case cancelled
    case killed
    case ownerDisconnected = "owner_disconnected"
    case daemonShutdown = "daemon_shutdown"
    case deadline
    case permissionRevoked = "permission_revoked"
    case adapterFailed = "adapter_failed"
}

struct AOSMicrophoneCaptureTermination: Equatable {
    let token: UUID
    let trigger: AOSMicrophoneCaptureTerminalTrigger
    let authorityAbsent: Bool
}

protocol AOSMicrophoneOperationClaimLease: AnyObject {
    func bindAuthority(
        stop: @escaping (_ force: Bool) -> Void,
        residualDigest: @escaping () -> String?
    ) throws
    func markAuthorityStarted() throws
    func noteStop(trigger: AOSMicrophoneCaptureTerminalTrigger) throws
    func authorityDidTerminate(_ termination: AOSMicrophoneCaptureTermination)
}

protocol AOSMicrophoneOperationClaiming: AnyObject {
    func prepareCapture(owner: UUID) throws -> any AOSMicrophoneOperationClaimLease
}
`

const harnessSource = String.raw`
import AVFoundation
import CoreMedia
import Foundation

enum HarnessFault: Error { case injected, nativeUpdate }

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

func wait(
    _ message: String,
    timeout: TimeInterval = 1,
    _ condition: () -> Bool
) {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.001)
    }
    require(condition(), message)
}

final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func read() -> Value { lock.lock(); defer { lock.unlock() }; return value }
    func write(_ body: (inout Value) -> Void) { lock.lock(); body(&value); lock.unlock() }
}

final class HarnessClock: @unchecked Sendable {
    private let value = LockedBox<UInt64>(5_000_000_000)
    func now() -> UInt64 {
        var result: UInt64 = 0
        value.write { $0 += 1_000_000; result = $0 }
        return result
    }
}

final class FaultStore: AOSOperationStateStore, @unchecked Sendable {
    enum Family: String, CaseIterable {
        case admission, childPreparation, trackProgress, followPending,
             followCommit, followStopped, terminalCleanup, artifactCustody
    }

    private let lock = NSLock()
    private var value: AOSOperationDurableState?
    private var remaining: [Family: Int] = [:]
    private(set) var observed = Set<Family>()
    private(set) var saves = 0

    func load() throws -> AOSOperationDurableState? {
        lock.lock(); defer { lock.unlock() }; return value
    }

    func arm(_ family: Family, count: Int = 1) {
        lock.lock(); remaining[family] = count; lock.unlock()
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        saves += 1
        if let family = classify(previous: value, candidate: state) {
            observed.insert(family)
            if let count = remaining[family], count > 0 {
                remaining[family] = count - 1
                throw AOSOperationCoreError.storeUnavailable
            }
        }
        value = state
    }

    private func classify(
        previous: AOSOperationDurableState?,
        candidate: AOSOperationDurableState
    ) -> Family? {
        guard let previous else { return nil }
        if candidate.operations.count > previous.operations.count { return .admission }
        if candidate.streams.count > previous.streams.count
            || candidate.artifacts.count > previous.artifacts.count
            || candidate.resourceTransactions.count > previous.resourceTransactions.count
            || candidate.resourceClaims.count > previous.resourceClaims.count {
            return .childPreparation
        }
        for operation in candidate.operations {
            guard let before = previous.operations.first(where: { $0.identity == operation.identity })
            else { continue }
            if operation.progress != before.progress { return .trackProgress }
            let priorGeometry = before.screenRecordingGeometry
            let geometry = operation.screenRecordingGeometry
            if priorGeometry?.pendingUpdate == nil && geometry?.pendingUpdate != nil {
                return .followPending
            }
            if priorGeometry?.accepted.geometryGeneration
                != geometry?.accepted.geometryGeneration {
                return .followCommit
            }
            if priorGeometry?.deadlineState != .stopped
                && geometry?.deadlineState == .stopped {
                return .followStopped
            }
        }
        if candidate.artifacts.contains(where: { artifact in
            guard let before = previous.artifacts.first(where: {
                $0.identity == artifact.identity
            }) else { return false }
            return artifact.state != before.state
                && [.removing, .released, .removed, .cleanupRequired].contains(artifact.state)
        }) { return .artifactCustody }
        if candidate.streams.contains(where: { stream in
            previous.streams.first(where: { $0.identity == stream.identity })?.state
                != stream.state && stream.state == .terminal
        }) || candidate.resourceClaims.contains(where: { claim in
            previous.resourceClaims.first(where: { $0.claimID == claim.claimID })?.state
                != claim.state && claim.state == .terminal
        }) { return .terminalCleanup }
        return nil
    }
}

final class FakeBroker: AOSScreenRecordingBrokerControlling, @unchecked Sendable {
    private let lock = NSLock()
    private var lease: AOSDesktopPixelExclusiveProducerLease?
    var admissionCheck: () -> Bool = { false }
    private(set) var acquisitions = 0
    private(set) var releases = 0

    func acquireExclusiveProducer(ownerID: String) throws
        -> AOSDesktopPixelExclusiveProducerLease {
        lock.lock(); defer { lock.unlock() }
        require(admissionCheck(), "broker authority preceded durable admission")
        guard lease == nil else { throw AOSDesktopFrameCaptureFailure.captureFailed }
        let result = AOSDesktopPixelExclusiveProducerLease(generation: 1, ownerID: ownerID)
        lease = result
        acquisitions += 1
        return result
    }

    func releaseExclusiveProducer(_ expected: AOSDesktopPixelExclusiveProducerLease) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard lease == expected else { return false }
        lease = nil
        releases += 1
        return true
    }

    var retainsAuthority: Bool {
        lock.lock(); defer { lock.unlock() }; return lease != nil
    }
}

final class FakeFiles: @unchecked Sendable {
    enum Fault { case link, removeSource, removeDestination }
    private let lock = NSLock()
    private var source = false
    private var destination = false
    var fault: Fault?
    var destinationPath = "/private/tmp/m3e-release.mov"

    func identity(_ summary: AOSScreenRecordingTrackSummary) -> AOSArtifactFileIdentity {
        AOSArtifactFileIdentity(
            rootIdentityDigest: String(repeating: "1", count: 64),
            relativeLocatorDigest: String(repeating: "2", count: 64),
            device: 7,
            inode: 11,
            byteCount: max(1, summary.video.sampleByteCount
                + summary.systemAudio.sampleByteCount + summary.microphone.sampleByteCount),
            contentDigest: String(repeating: "3", count: 64),
            mediaType: summary.expectedMediaType,
            trackSummary: summary
        )
    }

    func markSource() { lock.lock(); source = true; lock.unlock() }

    func dependencies() -> AOSScreenRecordingFileDependencies {
        AOSScreenRecordingFileDependencies(
            validateArtifact: { [self] _, _, _, summary in
                lock.lock(); defer { lock.unlock() }
                guard source else { throw AOSOperationCoreError.artifactIdentityMismatch }
                return identity(summary)
            },
            destinationIdentity: { [self] url, _, expected in
                lock.lock(); destinationPath = url.path; lock.unlock()
                return AOSArtifactReleaseDestinationIdentity(
                    absolutePath: url.path,
                    pathDigest: String(repeating: "4", count: 64),
                    parentDevice: expected.device,
                    parentInode: 9
                )
            },
            observe: { [self] url, _, _ in
                lock.lock(); defer { lock.unlock() }
                return (url.path == destinationPath ? destination : source) ? .exact : .absent
            },
            linkDestination: { [self] _, url, expected, _ in
                lock.lock(); defer { lock.unlock() }
                if fault == .link { throw HarnessFault.injected }
                guard source, !destination else {
                    throw AOSOperationCoreError.artifactDestinationExists
                }
                destinationPath = url.path
                destination = true
                return AOSArtifactReleaseDestinationFileIdentity(
                    device: expected.device,
                    inode: expected.inode,
                    byteCount: expected.byteCount,
                    contentDigest: expected.contentDigest
                )
            },
            remove: { [self] url, allowAbsent in
                lock.lock(); defer { lock.unlock() }
                let isDestination = url.path == destinationPath
                if (!isDestination && fault == .removeSource)
                    || (isDestination && fault == .removeDestination) {
                    throw HarnessFault.injected
                }
                let present = isDestination ? destination : source
                guard present || allowAbsent else {
                    throw AOSOperationCoreError.recordingCleanupRequired
                }
                if isDestination { destination = false } else { source = false }
            },
            exists: { [self] url in
                lock.lock(); defer { lock.unlock() }
                return url.path == destinationPath ? destination : source
            }
        )
    }
}

final class FakeWriter: @unchecked Sendable {
    private let lock = NSLock()
    private var ready: [AOSScreenRecordingTrackKind: Bool] = [
        .video: true, .systemAudio: true, .microphone: true,
    ]
    private var writing = false
    private(set) var epoch: CMTime?
    private(set) var appended: [AOSScreenRecordingTrackKind: Int] = [:]
    private(set) var finalized: [AOSScreenRecordingTrackKind: Int] = [:]

    func setReady(_ track: AOSScreenRecordingTrackKind, _ value: Bool) {
        lock.lock(); ready[track] = value; lock.unlock()
    }

    func writer() -> AOSScreenRecordingWriterDependencies {
        AOSScreenRecordingWriterDependencies(
            startWriting: { [self] in lock.lock(); writing = true; lock.unlock(); return true },
            startSession: { [self] value in lock.lock(); epoch = value; lock.unlock() },
            isWriting: { [self] in lock.lock(); defer { lock.unlock() }; return writing },
            finish: { [self] completion in
                lock.lock(); writing = false; lock.unlock(); completion(true)
            },
            cancel: { [self] in lock.lock(); writing = false; lock.unlock() }
        )
    }

    func input(_ track: AOSScreenRecordingTrackKind)
        -> AOSScreenRecordingWriterInputDependencies {
        AOSScreenRecordingWriterInputDependencies(
            isReady: { [self] in
                lock.lock(); defer { lock.unlock() }; return ready[track] == true
            },
            append: { [self] _ in
                lock.lock(); appended[track, default: 0] += 1; lock.unlock(); return true
            },
            markFinished: { [self] in
                lock.lock(); finalized[track, default: 0] += 1; lock.unlock()
            }
        )
    }
}

func sample(_ value: Int64, bytes: Int = 32) -> CMSampleBuffer {
    var block: CMBlockBuffer?
    precondition(CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault,
        memoryBlock: nil,
        blockLength: max(1, bytes),
        blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil,
        offsetToData: 0,
        dataLength: max(1, bytes),
        flags: 0,
        blockBufferOut: &block
    ) == noErr)
    var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: 1_000),
        presentationTimeStamp: CMTime(value: value, timescale: 1_000),
        decodeTimeStamp: .invalid
    )
    var size = bytes
    var result: CMSampleBuffer?
    precondition(CMSampleBufferCreateReady(
        allocator: kCFAllocatorDefault,
        dataBuffer: block,
        formatDescription: nil,
        sampleCount: 1,
        sampleTimingEntryCount: 1,
        sampleTimingArray: &timing,
        sampleSizeEntryCount: 1,
        sampleSizeArray: &size,
        sampleBufferOut: &result
    ) == noErr)
    return result!
}

final class IntegratedEncoder: AOSScreenRecordingEncoding, @unchecked Sendable {
    let coordinator: AOSScreenRecordingMultitrackCoordinator
    let files: FakeFiles
    let writer: FakeWriter
    private let microphoneSequence = LockedBox<Int64>(20)

    init(tracks: AOSScreenRecordingTracks, files: FakeFiles) throws {
        self.files = files
        writer = FakeWriter()
        var inputs: [AOSScreenRecordingTrackKind: AOSScreenRecordingWriterInputDependencies] = [
            .video: writer.input(.video),
        ]
        if tracks.systemAudio { inputs[.systemAudio] = writer.input(.systemAudio) }
        if tracks.microphone { inputs[.microphone] = writer.input(.microphone) }
        coordinator = try AOSScreenRecordingMultitrackCoordinator(
            systemAudioSelected: tracks.systemAudio,
            microphoneSelected: tracks.microphone,
            maximumPendingSamplesPerTrack: 3,
            writer: writer.writer(),
            inputs: inputs,
            observeOutputBytes: { 512 }
        )
    }

    var progress: AOSScreenRecordingEncoderProgress { coordinator.progress }
    func markAvailable(_ track: AOSScreenRecordingTrackKind) throws {
        try coordinator.markAvailable(track)
    }
    func append(_ buffer: CMSampleBuffer, track: AOSScreenRecordingTrackKind) throws {
        try coordinator.append(buffer, track: track)
    }
    func appendMicrophone(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) throws {
        var value: Int64 = 0
        microphoneSequence.write { $0 += 1; value = $0 }
        try coordinator.append(sample(value), track: .microphone)
    }
    func finish(_ completion: @escaping (Result<AOSArtifactFileIdentity, Error>) -> Void) {
        coordinator.finish(identity: { [files] summary in
            files.markSource()
            return files.identity(summary)
        }, completion: completion)
    }
    func cancel() { coordinator.cancel() }
}

final class FakeLifecycle: AOSDesktopPixelStreamLifecycle, @unchecked Sendable {
    private let latch = AOSDesktopPixelRetirementLatch()
    private let ready: () -> Bool
    init(ready: @escaping () -> Bool) { self.ready = ready }
    func admitExplicitStop() -> AOSDesktopPixelStopAdmission { latch.admitExplicitStop() }
    func confirmRetirement() { latch.observe() }
    func sampleIsReady() throws -> Bool { ready() }
    func retirementWasObserved() -> Bool { latch.snapshot() }
    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await latch.wait(timeout: timeout)
    }
}

final class FakeMicrophoneBackend: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: AOSMicrophoneNativeInputHandler?
    private var running = false
    private var time: Int64 = 0
    private(set) var starts = 0
    private(set) var stops = 0

    func dependencies() -> AOSMicrophoneNativeSessionDependencies {
        AOSMicrophoneNativeSessionDependencies(
            start: { [self] callback in
                lock.lock(); starts += 1; handler = callback; running = true; lock.unlock()
                return format()
            },
            healthy: { [self] in lock.lock(); defer { lock.unlock() }; return running },
            stop: { [self] in
                lock.lock(); stops += 1; running = false; handler = nil; lock.unlock()
                return true
            }
        )
    }

    func publish() -> Bool {
        lock.lock()
        guard running, let handler else { lock.unlock(); return false }
        time += 1
        let stamp = time
        lock.unlock()
        let format = format()
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1)!
        buffer.frameLength = 1
        handler(buffer, AVAudioTime(sampleTime: stamp, atRate: format.sampleRate))
        return true
    }

    private func format() -> AVAudioFormat {
        AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
    }
}

final class SessionDriver: @unchecked Sendable {
    private let lock = NSLock()
    private var gate: AOSDesktopPixelFrameAdmissionGate?
    private var progressSink: AOSScreenRecordingProgressSink?
    private var failureSink: AOSScreenRecordingFailureSink?
    private var startCompletion: AOSDesktopPixelNativeCompletion?
    private var startupSignal: AOSDesktopPixelStartupSignal?
    private(set) var stopCount = 0
    private(set) var geometryUpdates = 0
    var failGeometryUpdate = false
    let backend = FakeMicrophoneBackend()
    let files: FakeFiles
    private(set) var encoder: IntegratedEncoder?
    private(set) var microphone: AOSMicrophoneNativeSession?
    private var sequence: Int64 = 1

    init(files: FakeFiles) { self.files = files }

    private func install(
        gate: AOSDesktopPixelFrameAdmissionGate,
        progress: @escaping AOSScreenRecordingProgressSink,
        failure: @escaping AOSScreenRecordingFailureSink,
        encoder: IntegratedEncoder,
        microphone: AOSMicrophoneNativeSession?,
        signal: AOSDesktopPixelStartupSignal
    ) {
        lock.lock()
        self.gate = gate
        progressSink = progress
        failureSink = failure
        self.encoder = encoder
        self.microphone = microphone
        startupSignal = signal
        lock.unlock()
    }

    func factory() -> AOSScreenRecordingSessionFactory {
        { [self] tracks, gate, progress, failure in
            let encoder = try IntegratedEncoder(tracks: tracks, files: files)
            try encoder.markAvailable(.video)
            if tracks.systemAudio { try encoder.markAvailable(.systemAudio) }
            let signal = AOSDesktopPixelStartupSignal()
            let microphone = tracks.microphone
                ? AOSMicrophoneNativeSession(dependencies: backend.dependencies()) : nil
            let input = microphone.map {
                AOSScreenRecordingMicrophoneInput(
                    session: $0,
                    encoder: encoder,
                    frameAdmission: gate,
                    startup: signal,
                    persistProgress: progress,
                    didFail: failure
                )
            }
            install(
                gate: gate,
                progress: progress,
                failure: failure,
                encoder: encoder,
                microphone: microphone,
                signal: signal
            )
            return AOSScreenRecordingNativeSession(
                encoder: encoder,
                lifecycle: FakeLifecycle { encoder.progress.sessionStarted },
                signal: signal,
                start: { [self] completion in
                    do { try input?.start() }
                    catch { completion(.failure(error)); return }
                    lock.lock(); startCompletion = completion; lock.unlock()
                },
                stop: { [self] completion in
                    _ = input?.stop()
                    lock.lock(); stopCount += 1; lock.unlock()
                    completion(.success(()))
                },
                updateGeometry: { [self] _, completion in
                    lock.lock(); geometryUpdates += 1; let fail = failGeometryUpdate; lock.unlock()
                    completion(fail ? .failure(HarnessFault.nativeUpdate) : .success(()))
                },
                microphoneSession: microphone
            )
        }
    }

    func startWasRequested() -> Bool {
        lock.lock(); defer { lock.unlock() }; return startCompletion != nil
    }
    func settleStart() {
        lock.lock(); let value = startCompletion; startCompletion = nil; lock.unlock()
        value?(.success(()))
    }
    func setVideoReady(_ value: Bool) { encoder?.writer.setReady(.video, value) }
    func publish(_ track: AOSScreenRecordingTrackKind) throws {
        if track == .microphone {
            require(backend.publish(), "microphone callback was not admitted")
            return
        }
        lock.lock()
        let gate = self.gate
        let progress = progressSink
        sequence += 1
        let value = sequence
        let encoder = self.encoder
        let startupSignal = self.startupSignal
        lock.unlock()
        guard let token = gate?.admit(), let encoder else {
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        defer { token.complete() }
        try encoder.append(sample(value), track: track)
        try progress?(encoder.progress)
        if encoder.progress.sessionStarted {
            startupSignal?.succeed()
        }
    }
    func injectFailure(_ error: Error) {
        lock.lock(); let sink = failureSink; lock.unlock(); sink?(error)
    }
}

final class EventCapture: @unchecked Sendable {
    private let values = LockedBox<[[String: Any]]>([])
    func receive(event: String, data: [String: Any]) {
        let bytes = envelopeBytes(service: "operation", event: event, data: data)!
        let envelope = try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        values.write { $0.append(envelope) }
    }
    func snapshot() -> [[String: Any]] { values.read() }
}

final class Barrier: @unchecked Sendable {
    private let condition = NSCondition()
    private var entered = false
    private var released = false
    func block() {
        condition.lock(); entered = true; condition.broadcast()
        while !released { condition.wait() }
        condition.unlock()
    }
    func waitUntilEntered() {
        let deadline = Date().addingTimeInterval(1)
        condition.lock()
        while !entered && condition.wait(until: deadline) {}
        let value = entered
        condition.unlock()
        require(value, "barrier was not entered")
    }
    func release() { condition.lock(); released = true; condition.broadcast(); condition.unlock() }
}

final class Environment {
    let owner = AOSMechanicalOwnerRoot(
        ownerID: "m3e-owner",
        effectiveUID: 501,
        pid: 101,
        pidGeneration: 7,
        executableIdentityDigest: String(repeating: "a", count: 64)
    )
    let store: FaultStore
    let registry: AOSOperationRegistry
    let microphoneAdapter: AOSMicrophoneOperationAdapter
    let screenAdapter: AOSScreenRecordingOperationAdapter
    let control: AOSOperationControlPlane
    let broker = FakeBroker()
    let files = FakeFiles()
    let driver: SessionDriver
    let events = EventCapture()
    let clock = HarnessClock()

    init(
        store: FaultStore = FaultStore(),
        prepared: @escaping (AOSOperationIdentity) -> Void = { _ in },
        preinstall: @escaping () -> Void = {}
    ) throws {
        self.store = store
        driver = SessionDriver(files: files)
        let microphoneRegistration = try AOSMicrophoneOperationAdapter.makeRegistration()
        let screenRegistration = try AOSScreenRecordingOperationAdapter.makeRegistration()
        let registrations = try AOSAdapterRegistrySnapshot.make(
            revision: 2,
            registrations: [microphoneRegistration, screenRegistration]
        )
        var nextID = 0
        registry = try AOSOperationRegistry(
            store: store,
            daemonGeneration: 7,
            adapterRegistry: registrations,
            clock: { [clock] in clock.now() },
            idFactory: { nextID += 1; return "m3e-\(nextID)" }
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
        microphoneAdapter = try AOSMicrophoneOperationAdapter(
            registry: registry,
            registration: microphoneRegistration,
            contextResolver: { [owner] _ in
                AOSMicrophoneOperationContext(
                    ownerRoot: owner,
                    attribution: AOSOperationAttribution(taskID: "m3e-microphone")
                )
            }
        )
        screenAdapter = try AOSScreenRecordingOperationAdapter(
            registry: registry,
            registration: screenRegistration,
            broker: broker,
            artifactRootURL: URL(fileURLWithPath: "/private/tmp/m3e-artifacts"),
            contextResolver: { [owner] _ in
                AOSScreenRecordingOperationContext(
                    ownerRoot: owner,
                    attribution: AOSOperationAttribution(taskID: "m3e-screen")
                )
            },
            files: files.dependencies(),
            sessionFactory: driver.factory(),
            microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies(
                status: { .authorized },
                request: { _ in AOSMicrophoneAuthorizationRequestResult(
                    before: .authorized,
                    after: .authorized,
                    attempted: false,
                    completed: true
                ) }
            ),
            startupTimeout: 0.04,
            topologyObserver: { Self.topology() },
            windowObserver: Self.windows,
            preparedPublicationObserver: prepared,
            runtimeInstallationObserver: preinstall,
            operationEventSink: { [events] event, data in
                events.receive(event: event, data: data)
            }
        )
        try registry.installRuntimeAdapters([microphoneAdapter, screenAdapter])
        broker.admissionCheck = { [registry] in
            let state = registry.snapshot()
            guard let operation = state.operations.last,
                  [.starting, .active, .stopping].contains(operation.state),
                  operation.progress?.trackSummary != nil,
                  state.streams.contains(where: { $0.parentOperation == operation.identity }),
                  state.artifacts.contains(where: { $0.parentOperation == operation.identity })
            else { return false }
            let claims = state.resourceClaims.filter {
                $0.operation == operation.identity && $0.state == .active
            }
            return claims.count == (operation.progress?.trackSummary?.microphone.selected == true ? 2 : 1)
        }
        control = AOSOperationControlPlane(registry: registry, daemonEffectiveUID: 501)
    }

    func context() -> AOSOrdinaryControlContext {
        AOSOrdinaryControlContext(
            expectedDaemonGeneration: 7,
            connectionEpoch: 1,
            caller: .liveTransportPeer(AOSLiveTransportPeerEvidence(
                auditTokenDigest: String(repeating: "c", count: 64),
                effectiveUID: 501,
                pid: owner.pid,
                pidGeneration: owner.pidGeneration
            )),
            authenticatedOwnerRoot: owner
        )
    }

    func request(
        systemAudio: Bool,
        microphone: Bool,
        followed: Bool,
        duration: Int = 40,
        followDeadline: Int = 80
    ) throws -> AOSScreenRecordingRequest {
        let target: [String: Any] = followed ? [
            "kind": "region", "display_ordinal": 1,
            "global_bounds": ["x": 10, "y": 10, "width": 40, "height": 30],
        ] : ["kind": "display", "display_ordinal": 1]
        let geometry: [String: Any] = followed ? [
            "mode": "caller_followed",
            "binding": Self.binding(observation: 1, state: 1),
            "update_interval_ms": 16,
            "update_deadline_ms": followDeadline,
        ] : ["mode": "fixed"]
        return try AOSScreenRecordingRequest.validatingPublicValue([
            "schema_version": "aos.screen-recording.request.v1",
            "request_id": "m3e-request",
            "canonical_parameter_digest": String(repeating: "b", count: 64),
            "topology": Self.topology(),
            "target": target,
            "geometry": geometry,
            "duration_ms": duration,
            "frame_rate": 30,
            "max_pixel_count": 1_000_000,
            "max_queue_frames": 3,
            "max_output_bytes": 10_000,
            "tracks": [
                "video": true,
                "system_audio": systemAudio,
                "microphone": microphone,
            ],
            "codec": "h264",
            "container": "quicktime",
        ])
    }

    func update(
        _ admission: AOSScreenRecordingAdmission,
        expected: Int = 1,
        observation: Int = 2,
        state: Int = 2,
        bounds: [String: Int] = ["x": 12, "y": 12, "width": 38, "height": 28]
    ) throws -> AOSScreenRecordingFollowUpdateRequest {
        try AOSScreenRecordingFollowUpdateRequest.validatingPublicValue([
            "request_id": "update-\(observation)-\(state)",
            "canonical_parameter_digest": String(repeating: "d", count: 64),
            "selector": [
                "operation_id": admission.operation.id,
                "operation_generation": admission.operation.generation,
            ],
            "expected_geometry_generation": expected,
            "topology": Self.topology(),
            "target": [
                "kind": "region", "display_ordinal": 1, "global_bounds": bounds,
            ],
            "binding": Self.binding(observation: observation, state: state),
        ])
    }

    static func topology(scale: Double = 2) -> AOSDisplayTopologySnapshot {
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        return AOSDisplayTopologySnapshot(
            identity: "m3e-topology",
            usesDisplayIDFallback: true,
            screensHaveSeparateSpaces: false,
            desktopWorldOriginNative: AOSDisplayTopologyPoint(x: 0, y: 0),
            nativeBounds: bounds,
            nativeVisibleBounds: bounds,
            desktopWorldBounds: bounds,
            visibleDesktopWorldBounds: bounds,
            displays: [AOSDisplayTopologyDisplay(
                runtimeDisplayID: 1,
                ordinal: 1,
                isMain: true,
                memberIdentity: .displayIDFallback(1),
                nativeBounds: bounds,
                nativeVisibleBounds: bounds,
                desktopWorldBounds: bounds,
                visibleDesktopWorldBounds: bounds,
                scaleFactor: scale,
                rotation: 0
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
}

func responseEnvelope(_ data: [String: Any]) -> [String: Any] {
    let bytes = responseJSONBytes(data, envelopeActive: true, envelopeRef: "m3e")!
    return try! JSONSerialization.jsonObject(with: bytes) as! [String: Any]
}

func projection(
    _ operation: AOSOperationRecord,
    state: AOSOperationDurableState
) -> ([String: Any], [String: Any]) {
    let list = AOSOperationPublicProjection.list(
        action: "list",
        filters: [:],
        operations: [operation],
        state: state,
        checkedAt: "2026-08-19T00:00:00.000Z"
    )
    let inspect = AOSOperationPublicProjection.inspect(
        action: "inspect",
        selector: [
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
        ],
        operation: operation,
        state: state,
        checkedAt: "2026-08-19T00:00:00.000Z"
    )
    return (list, inspect)
}

@main
struct IntegratedHarness {
    static var evidence: [String: Any] = [
        "admissions": [], "lists": [], "inspects": [], "events": [], "custody": [],
        "responses": [], "requests": [], "controls": [],
    ]

    static func append(_ key: String, _ value: Any) {
        var values = evidence[key] as! [Any]
        values.append(value)
        evidence[key] = values
    }

    static func selectedOrder(systemAudio: Bool, microphone: Bool, reversed: Bool)
        -> [AOSScreenRecordingTrackKind] {
        var values: [AOSScreenRecordingTrackKind] = [.video]
        if systemAudio { values.append(.systemAudio) }
        if microphone { values.append(.microphone) }
        return reversed ? Array(values.reversed()) : values
    }

    static func operation(
        _ admission: AOSScreenRecordingAdmission,
        _ environment: Environment
    ) -> AOSOperationRecord {
        try! environment.registry.inspect(admission.operation)
    }

    static func runMatrix() throws {
        for followed in [false, true] {
            for selection in [(false, false), (true, false), (false, true), (true, true)] {
                let label = "followed=\(followed),system=\(selection.0),microphone=\(selection.1)"
                let environment: Environment
                do { environment = try Environment() }
                catch { fatalError("environment \(label): \(error)") }
                let request = try environment.request(
                    systemAudio: selection.0,
                    microphone: selection.1,
                    followed: followed,
                    duration: 60,
                    followDeadline: 200
                )
                let admission: AOSScreenRecordingAdmission
                do {
                    admission = try environment.screenAdapter.start(
                        request: request,
                        connectionID: UUID()
                    )
                } catch { fatalError("admission \(label): \(error)") }
                append("admissions", admission.publicValue(request: request))
                append("responses", responseEnvelope(admission.publicValue(request: request)))
                wait("native start missing") { environment.driver.startWasRequested() }
                environment.driver.setVideoReady(false)
                for track in selectedOrder(
                    systemAudio: selection.0,
                    microphone: selection.1,
                    reversed: followed
                ) { try environment.driver.publish(track) }
                let preDrain = environment.driver.encoder!.progress
                require(preDrain.sessionStarted, "selected tracks did not share one epoch")
                require(preDrain.trackSummary.commonMediaEpochNanoseconds != nil,
                        "common epoch was not published")
                require(preDrain.frameCount == 0, "backpressured video falsely advanced")
                require(preDrain.trackSummary.video.sampleCount == 1,
                        "backpressured video lost admitted truth")
                environment.driver.setVideoReady(true)
                try environment.driver.publish(.video)
                environment.driver.settleStart()
                wait("operation did not become active") {
                    operation(admission, environment).state == .active
                }
                let active = operation(admission, environment)
                let activeSummary = active.progress!.trackSummary!
                require(activeSummary.selectedTracks
                    == AOSScreenRecordingTrackSummary.selectedTrackNames(
                        systemAudio: selection.0,
                        microphone: selection.1
                    ), "selected track projection drifted")
                require(activeSummary.video.sampleCount > 0
                    && (!selection.0 || activeSummary.systemAudio.sampleCount > 0)
                    && (!selection.1 || activeSummary.microphone.sampleCount > 0),
                    "selected positive sample truth missing")
                require(!activeSummary.systemAudio.selected || selection.0,
                        "unselected system audio became admitted")
                require(!activeSummary.microphone.selected || selection.1,
                        "unselected microphone became admitted")
                wait("duration completion did not terminalize", timeout: 2) {
                    operation(admission, environment).state == .terminal
                }
                let terminal = operation(admission, environment)
                let state = environment.registry.snapshot()
                require(terminal.outcome == .succeeded, "duration completion did not succeed")
                require(terminal.progress?.trackSummary?.isSuccessful == true,
                        "selected tracks did not finalize")
                require(state.adapterRegistry.revision == 2
                    && state.adapterRegistry.registrations.count == 2,
                    "adapter registry revision drifted")
                require(!state.resourceClaims.contains {
                    $0.operation == admission.operation && $0.state != .terminal
                }, "terminal claim remained")
                let artifact = state.artifacts.first { $0.identity == admission.artifact }!
                require(artifact.state == .offered
                    && artifact.fileIdentity?.mediaType
                        == terminal.progress?.trackSummary?.expectedMediaType,
                    "QuickTime artifact media identity drifted")
                let values = projection(terminal, state: state)
                append("lists", values.0)
                append("inspects", values.1)
                append("responses", responseEnvelope(values.0))
                append("responses", responseEnvelope(values.1))
                environment.events.snapshot().forEach { append("events", $0) }
                require(environment.broker.acquisitions == 1
                    && environment.broker.releases == 1
                    && !environment.broker.retainsAuthority,
                    "producer authority did not settle exactly once")
            }
        }
    }

    static func runSharedMicrophoneConflict() throws {
        let environment = try Environment()
        let held = try environment.microphoneAdapter.prepareExternalCapture(
            context: AOSMicrophoneOperationContext(
                ownerRoot: environment.owner,
                attribution: AOSOperationAttribution(taskID: "standalone-microphone")
            )
        )
        do {
            _ = try environment.screenAdapter.start(
                request: environment.request(
                    systemAudio: false,
                    microphone: true,
                    followed: false
                ),
                connectionID: UUID()
            )
            fatalError("shared microphone resource conflict was not enforced")
        } catch AOSOperationCoreError.resourceBusy {}
        environment.microphoneAdapter.abandonPreparedCapture(operation: held)
        wait("standalone microphone claim did not settle") {
            (try? environment.registry.inspect(held).state) == .terminal
        }
    }

    static func main() throws {
        try runMatrix()
        try runSharedMicrophoneConflict()
        let bytes = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
        print("m3e-evidence:\(String(data: bytes, encoding: .utf8)!)")
        print("m3e-integrated: matrix=8 registry=2 actual-writer=1 shared-microphone=1")
    }
}
`

function requirePrivateEnvironment() {
  const temporary = process.env.TMPDIR
  const stateRoot = process.env.AOS_STATE_ROOT
  assert.ok(path.isAbsolute(temporary ?? ''), 'TMPDIR must be an explicit absolute private root')
  assert.ok(path.isAbsolute(stateRoot ?? ''), 'AOS_STATE_ROOT must be an explicit absolute private root')
  assert.notEqual(temporary, stateRoot)
  assert.equal(path.dirname(temporary), path.dirname(stateRoot))
  return { stateRoot, temporary }
}

test('complete landed M3 recording executes as one production-attached offline system', async () => {
  const { stateRoot, temporary } = requirePrivateEnvironment()
  const [temporaryMode, stateMode] = await Promise.all([stat(temporary), stat(stateRoot)])
  assert.equal(temporaryMode.mode & 0o077, 0)
  assert.equal(stateMode.mode & 0o077, 0)
  const buildRoot = await mkdtemp(path.join(temporary, 'compiled-'))
  try {
    const support = path.join(buildRoot, 'Support.swift')
    const harness = path.join(buildRoot, 'Harness.swift')
    const binary = path.join(buildRoot, 'm3e-integrated')
    await Promise.all([
      writeFile(support, supportSource),
      writeFile(harness, harnessSource),
    ])
    const compile = spawnSync('swiftc', [
      '-warnings-as-errors',
      '-module-cache-path', path.join(buildRoot, 'module-cache'),
      ...productionSources,
      support,
      harness,
      '-o', binary,
    ], { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 })
    assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`)
    const run = spawnSync(binary, [], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, AOS_STATE_ROOT: stateRoot, TMPDIR: temporary },
      timeout: 30_000,
    })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /m3e-integrated: matrix=8 registry=2 actual-writer=1 shared-microphone=1/u)
    const line = run.stdout.split('\n').find((value) => value.startsWith('m3e-evidence:'))
    assert.ok(line, run.stdout)
    const evidence = JSON.parse(line.slice('m3e-evidence:'.length))
    assert.equal(evidence.admissions.length, 8)
    assert.equal(evidence.lists.length, 8)
    assert.equal(evidence.inspects.length, 8)
    assert.ok(evidence.events.length >= 8)
    assert.equal(evidence.responses.length, 24)
  } finally {
    await rm(buildRoot, { recursive: true, force: true })
  }
})

test('integrated proof source closure remains production-owned and offline', async () => {
  const [self, wrapper, unified] = await Promise.all([
    readFile(new URL(import.meta.url), 'utf8'),
    readFile(path.join(repoRoot, 'tests/m3-screen-recording-integrated.sh'), 'utf8')
      .catch(() => ''),
    readFile(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8'),
  ])
  for (const source of productionSources) {
    assert.match(self, new RegExp(path.basename(source).replaceAll('.', '\\.')), source)
  }
  assert.match(unified, /AOSAdapterRegistrySnapshot\.make\(\s*revision: 2/su)
  assert.doesNotMatch(self, /execFileSync\([^\n]*\.\/aos|spawnSync\([^\n]*\.\/aos/u)
  assert.doesNotMatch(wrapper, /\.\/aos|build\.sh|daemon|ScreenCaptureKit|AVAssetWriter/u)
})
