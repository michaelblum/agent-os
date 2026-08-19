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
  'src/perceive/display-topology.swift',
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
    func advance(_ nanoseconds: UInt64) { value.write { $0 += nanoseconds } }
}

final class FaultStore: AOSOperationStateStore, @unchecked Sendable {
    enum Family: String, CaseIterable {
        case admission, childPreparation, activation, trackProgress, followPending,
             followCommit, followStopped, terminalOutcome, terminalCleanup,
             artifactCustody
    }

    private let lock = NSLock()
    private let production: AOSFileOperationStateStore
    private var remaining: [Family: Int] = [:]
    private(set) var observed = Set<Family>()
    private(set) var saves = 0

    init() throws {
        let stateRoot = ProcessInfo.processInfo.environment["AOS_STATE_ROOT"]!
        production = try AOSFileOperationStateStore(rootURL:
            URL(fileURLWithPath: stateRoot, isDirectory: true)
                .appendingPathComponent("m3e-\(UUID().uuidString.lowercased())", isDirectory: true)
        )
    }

    func load() throws -> AOSOperationDurableState? {
        lock.lock(); defer { lock.unlock() }; return try production.load()
    }

    func arm(_ family: Family, count: Int = 1) {
        lock.lock(); remaining[family] = count; lock.unlock()
    }

    func saw(_ family: Family) -> Bool {
        lock.lock(); defer { lock.unlock() }; return observed.contains(family)
    }

    func save(_ state: AOSOperationDurableState) throws {
        lock.lock()
        defer { lock.unlock() }
        saves += 1
        if let family = classify(previous: try production.load(), candidate: state) {
            observed.insert(family)
            if let count = remaining[family], count > 0 {
                remaining[family] = count - 1
                throw AOSOperationCoreError.storeUnavailable
            }
        }
        try production.save(state)
    }

    func productionReadback() throws -> AOSOperationDurableState? { try production.load() }

    private func classify(
        previous: AOSOperationDurableState?,
        candidate: AOSOperationDurableState
    ) -> Family? {
        guard let previous else { return nil }
        var matches: [Family] = []
        if candidate.operations.count > previous.operations.count { matches.append(.admission) }
        if candidate.streams.count > previous.streams.count
            || candidate.artifacts.count > previous.artifacts.count
            || candidate.resourceTransactions.count > previous.resourceTransactions.count
            || candidate.resourceClaims.count > previous.resourceClaims.count {
            matches.append(.childPreparation)
        }
        for operation in candidate.operations {
            guard let before = previous.operations.first(where: { $0.identity == operation.identity })
            else { continue }
            if before.state == .prepared && operation.state == .starting {
                matches.append(.activation)
            }
            if operation.progress != before.progress { matches.append(.trackProgress) }
            let priorGeometry = before.screenRecordingGeometry
            let geometry = operation.screenRecordingGeometry
            if priorGeometry?.pendingUpdate == nil && geometry?.pendingUpdate != nil {
                matches.append(.followPending)
            }
            if priorGeometry?.accepted.geometryGeneration
                != geometry?.accepted.geometryGeneration {
                matches.append(.followCommit)
            }
            if priorGeometry?.deadlineState != .stopped
                && geometry?.deadlineState == .stopped {
                matches.append(.followStopped)
            }
            if before.state != operation.state
                && [.terminal, .cleanupRequired].contains(operation.state) {
                matches.append(.terminalOutcome)
            }
        }
        if candidate.artifacts.contains(where: { artifact in
            guard let before = previous.artifacts.first(where: {
                $0.identity == artifact.identity
            }) else { return false }
            return artifact.state != before.state
                && [.removing, .released, .removed, .cleanupRequired].contains(artifact.state)
        }) { matches.append(.artifactCustody) }
        if candidate.streams.contains(where: { stream in
            previous.streams.first(where: { $0.identity == stream.identity })?.state
                != stream.state && stream.state == .terminal
        }) || candidate.resourceClaims.contains(where: { claim in
            previous.resourceClaims.first(where: { $0.claimID == claim.claimID })?.state
                != claim.state && claim.state == .terminal
        }) { matches.append(.terminalCleanup) }
        let unique = Array(Set(matches))
        return unique.first(where: { (remaining[$0] ?? 0) > 0 }) ?? matches.first
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
    enum Fault: Hashable { case link, removeSource, removeDestination }
    private let lock = NSLock()
    private var source = false
    private var destination = false
    var faults = Set<Fault>()
    var linkBarrier: Barrier?
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
                lock.lock()
                if faults.contains(.link) { lock.unlock(); throw HarnessFault.injected }
                guard source, !destination else {
                    lock.unlock()
                    throw AOSOperationCoreError.artifactDestinationExists
                }
                destinationPath = url.path
                destination = true
                let barrier = linkBarrier
                lock.unlock()
                barrier?.block()
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
                if (!isDestination && faults.contains(.removeSource))
                    || (isDestination && faults.contains(.removeDestination)) {
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

    var sourcePresent: Bool {
        lock.lock(); defer { lock.unlock() }; return source
    }

    var destinationPresent: Bool {
        lock.lock(); defer { lock.unlock() }; return destination
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
    var holdGeometryUpdate = false
    private var geometryCompletion: ((Result<Void, Error>) -> Void)?
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
                    lock.lock()
                    geometryUpdates += 1
                    let fail = failGeometryUpdate
                    if holdGeometryUpdate { geometryCompletion = completion }
                    let held = holdGeometryUpdate
                    lock.unlock()
                    if held { return }
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

    func settleGeometry(_ result: Result<Void, Error>) {
        lock.lock(); let completion = geometryCompletion; geometryCompletion = nil; lock.unlock()
        completion?(result)
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

final class Environment: @unchecked Sendable {
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
        store: FaultStore? = nil,
        prepared: @escaping (AOSOperationIdentity) -> Void = { _ in },
        preinstall: @escaping () -> Void = {},
        runtimeStart: @escaping () -> Void = {},
        stopAdmission: @escaping () -> Void = {}
    ) throws {
        let durableStore = try store ?? FaultStore()
        self.store = durableStore
        driver = SessionDriver(files: files)
        let microphoneRegistration = try AOSMicrophoneOperationAdapter.makeRegistration()
        let screenRegistration = try AOSScreenRecordingOperationAdapter.makeRegistration()
        let registrations = try AOSAdapterRegistrySnapshot.make(
            revision: 2,
            registrations: [microphoneRegistration, screenRegistration]
        )
        var nextID = 0
        registry = try AOSOperationRegistry(
            store: durableStore,
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
            runtimeStartObserver: runtimeStart,
            stopAdmissionObserver: stopAdmission,
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

    func cancel(_ operation: AOSOperationIdentity) throws -> AOSOperationControlReceipt {
        try control.cancel(context: context(), operation: operation)
    }

    func kill(_ operation: AOSOperationIdentity) throws -> AOSOperationControlReceipt {
        try control.kill(context: context(), operation: operation)
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
            "topology": try aosDisplayTopologyWireValue(Self.topology()),
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
        expected: Int? = nil,
        observation: Int = 2,
        state: Int = 2,
        bounds: [String: Int] = ["x": 12, "y": 12, "width": 38, "height": 28],
        topology: AOSDisplayTopologySnapshot? = nil,
        binding: [String: Any]? = nil
    ) throws -> AOSScreenRecordingFollowUpdateRequest {
        try AOSScreenRecordingFollowUpdateRequest.validatingPublicValue([
            "request_id": "update-\(observation)-\(state)",
            "canonical_parameter_digest": String(repeating: "d", count: 64),
            "selector": [
                "operation_id": admission.operation.id,
                "operation_generation": admission.operation.generation,
            ],
            "expected_geometry_generation": expected
                ?? Int(operationGeometryGeneration(admission)),
            "topology": try aosDisplayTopologyWireValue(topology ?? Self.topology()),
            "target": [
                "kind": "region", "display_ordinal": 1, "global_bounds": bounds,
            ],
            "binding": binding ?? Self.binding(observation: observation, state: state),
        ])
    }

    private func operationGeometryGeneration(
        _ admission: AOSScreenRecordingAdmission
    ) -> UInt64 {
        (try? registry.inspect(admission.operation)
            .screenRecordingGeometry?.accepted.geometryGeneration) ?? 1
    }

    static func topology(scale: Double = 2) -> AOSDisplayTopologySnapshot {
        let bounds = AOSDisplayTopologyBounds(x: 0, y: 0, width: 100, height: 80)
        let built = try! buildAOSDisplayTopologySnapshot(
            observation: [AOSDisplayTopologyObservationMember(
                runtimeDisplayID: 1,
                displayUUID: nil,
                label: "injected",
                isMain: true,
                isMirrored: false,
                nativeBounds: bounds,
                nativeVisibleBounds: bounds,
                scaleFactor: scale,
                rotation: 0
            )],
            screensHaveSeparateSpaces: false
        )
        return try! validateAOSDisplayTopologyWireValue(
            try! aosDisplayTopologyWireValue(built)
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

func codableValue<T: Encodable>(_ value: T) -> [String: Any] {
    let data = try! JSONEncoder().encode(value)
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
}

func canonicalJSON(_ value: Any) -> Data {
    try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
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
        "responses": [], "requests": [], "follow_updates": [], "controls": [], "faults": [],
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

    static func requireZeroProgress(_ operation: AOSOperationRecord) {
        let progress = operation.progress!
        let summary = progress.trackSummary!
        require(progress.frameCount == 0 && progress.byteCount == 0
            && progress.elapsedMilliseconds == 0 && progress.droppedFrameCount == 0
            && summary.selectedTracks == ["video"] && summary.finalizedTracks.isEmpty
            && summary.commonMediaEpochNanoseconds == nil
            && summary.video.selected && summary.video.admitted
            && !summary.video.available && !summary.video.firstSamplePresent
            && summary.video.sampleCount == 0 && summary.video.sampleByteCount == 0,
            "initial selected-track truth was not exact zero progress")
    }

    static func requirePreAuthorityTerminal(
        _ admission: AOSScreenRecordingAdmission,
        _ environment: Environment
    ) {
        let state = environment.registry.snapshot()
        let terminal = operation(admission, environment)
        let summary = terminal.progress!.trackSummary!
        require(terminal.state == .terminal
            && terminal.screenRecordingGeometry?.deadlineState == .stopped
            && !AOSOperationRegistry.hasNonterminalChildren(
                in: state, operation: admission.operation
            ) && !environment.broker.retainsAuthority
            && !environment.driver.startWasRequested(),
            "pre-authority control did not settle geometry, children, and authority")
        require(summary.finalizedTracks == summary.selectedTracks
            && summary.video.drained && summary.video.finalized,
            "pre-authority control left selected tracks unsettled")
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
                let stored = try environment.store.productionReadback()!
                let storedTerminal = stored.operations.first {
                    $0.identity == admission.operation
                }!
                require(stored.schema == state.schema
                    && stored.daemonGeneration == state.daemonGeneration
                    && canonicalJSON(projection(storedTerminal, state: stored).1)
                        == canonicalJSON(projection(terminal, state: state).1),
                        "production operation-store readback drifted")
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

    static func activate(
        _ environment: Environment,
        followed: Bool,
        duration: Int = 1_000,
        deadline: Int = 500
    ) throws -> (AOSScreenRecordingAdmission, UUID) {
        let connection = UUID()
        let admission = try environment.screenAdapter.start(
            request: environment.request(
                systemAudio: false,
                microphone: false,
                followed: followed,
                duration: duration,
                followDeadline: deadline
            ),
            connectionID: connection
        )
        wait("activation start missing") { environment.driver.startWasRequested() }
        try environment.driver.publish(.video)
        environment.driver.settleStart()
        wait("operation did not activate") {
            operation(admission, environment).state == .active
        }
        return (admission, connection)
    }

    static func issue(
        _ action: AOSOrdinaryControlAction,
        _ environment: Environment,
        _ operation: AOSOperationIdentity
    ) throws -> AOSOperationControlReceipt {
        switch action {
        case .cancel: return try environment.cancel(operation)
        case .kill: return try environment.kill(operation)
        case .killOwner: fatalError("unexpected single-operation action")
        }
    }

    static func runPublicControl() throws {
        for action in [AOSOrdinaryControlAction.cancel, .kill] {
            let expectedIntent: AOSStopIntent = action == .cancel ? .cancel : .kill
            let expectedOutcome: AOSOperationOutcome = action == .cancel ? .cancelled : .killed

            let active = try Environment()
            let activeAdmission = try activate(active, followed: true).0
            let receipt = try issue(action, active, activeAdmission.operation)
            wait("active control did not terminalize") {
                operation(activeAdmission, active).state == .terminal
            }
            let terminal = operation(activeAdmission, active)
            require(receipt.stopIntent == expectedIntent
                && receipt.terminalOutcome == expectedOutcome
                && terminal.stopIntent == expectedIntent
                && terminal.outcome == expectedOutcome,
                "active public control lost first-writer truth")
            let replayedReceipt = try issue(action, active, activeAdmission.operation)
            require(replayedReceipt == receipt, "same-action replay drifted")
            do {
                _ = try issue(action == .cancel ? .kill : .cancel, active,
                              activeAdmission.operation)
                fatalError("opposite action overwrote terminal truth")
            } catch AOSOperationCoreError.invalidTransition {}
            let activeState = active.registry.snapshot()
            require(terminal.screenRecordingGeometry?.deadlineState == .stopped
                && !AOSOperationRegistry.hasNonterminalChildren(
                    in: activeState, operation: activeAdmission.operation
                )
                && !active.broker.retainsAuthority,
                "active stop left geometry, children, or authority")
            append("controls", codableValue(receipt))

            let preparedBarrier = Barrier()
            let stopObserved = LockedBox(false)
            let prepared = try Environment(
                prepared: { _ in preparedBarrier.block() },
                stopAdmission: { stopObserved.write { $0 = true } }
            )
            let preparedRequest = try prepared.request(
                systemAudio: false, microphone: false, followed: true,
                duration: 1_000, followDeadline: 500
            )
            let startResult = LockedBox<Result<AOSScreenRecordingAdmission, Error>?>(nil)
            DispatchQueue.global().async {
                do {
                    let value = try prepared.screenAdapter.start(
                        request: preparedRequest, connectionID: UUID()
                    )
                    startResult.write { $0 = .success(value) }
                } catch { startResult.write { $0 = .failure(error) } }
            }
            preparedBarrier.waitUntilEntered()
            let preparedState = prepared.registry.snapshot()
            let identity = preparedState.operations.last!.identity
            require(preparedState.operations.count == 1
                && preparedState.streams.isEmpty && preparedState.artifacts.isEmpty
                && preparedState.resourceTransactions.isEmpty
                && preparedState.resourceClaims.isEmpty
                && preparedState.resourceBrokers.isEmpty,
                "prepared barrier published child authority")
            requireZeroProgress(preparedState.operations[0])
            let stopResult = LockedBox<Result<AOSOperationControlReceipt, Error>?>(nil)
            DispatchQueue.global().async {
                do {
                    let value = try issue(action, prepared, identity)
                    stopResult.write { $0 = .success(value) }
                } catch { stopResult.write { $0 = .failure(error) } }
            }
            wait("prepared stop admission missing") { stopObserved.read() }
            require(!prepared.broker.retainsAuthority
                && !prepared.driver.startWasRequested(),
                "prepared stop leaked later authority")
            preparedBarrier.release()
            wait("prepared control did not settle") {
                startResult.read() != nil && stopResult.read() != nil
            }
            guard case .success(let preparedAdmission)? = startResult.read(),
                  case .success(let preparedReceipt)? = stopResult.read() else {
                fatalError("prepared interleaving failed")
            }
            require(preparedReceipt.action == action
                && operation(preparedAdmission, prepared).state == .terminal
                && !prepared.broker.retainsAuthority
                && !prepared.driver.startWasRequested(),
                "prepared interleaving resumed after stop")
            requirePreAuthorityTerminal(preparedAdmission, prepared)

            let installBarrier = Barrier()
            let preinstall = try Environment(preinstall: { installBarrier.block() })
            let installRequest = try preinstall.request(
                systemAudio: false, microphone: false, followed: true,
                duration: 1_000, followDeadline: 500
            )
            let installStart = LockedBox<Result<AOSScreenRecordingAdmission, Error>?>(nil)
            DispatchQueue.global().async {
                do {
                    let value = try preinstall.screenAdapter.start(
                        request: installRequest, connectionID: UUID()
                    )
                    installStart.write { $0 = .success(value) }
                } catch { installStart.write { $0 = .failure(error) } }
            }
            installBarrier.waitUntilEntered()
            let installingState = preinstall.registry.snapshot()
            let installing = installingState.operations.last!.identity
            require(installingState.operations.count == 1
                && installingState.streams.count == 1
                && installingState.artifacts.count == 1
                && installingState.resourceTransactions.count == 1
                && installingState.resourceClaims.count == 1
                && installingState.resourceBrokers.isEmpty,
                "pre-install child cardinality drifted")
            requireZeroProgress(installingState.operations[0])
            let installReceipt = try issue(action, preinstall, installing)
            require(!preinstall.broker.retainsAuthority
                && !preinstall.driver.startWasRequested(),
                "pre-install stop leaked later authority")
            installBarrier.release()
            wait("pre-install start did not return") { installStart.read() != nil }
            guard case .success(let installAdmission)? = installStart.read() else {
                fatalError("pre-install start failed")
            }
            require(operation(installAdmission, preinstall).state == .terminal
                && installReceipt.action == action
                && !preinstall.driver.startWasRequested(),
                "pre-install stop resumed native start")
            requirePreAuthorityTerminal(installAdmission, preinstall)
        }

        for pair in [(AOSOrdinaryControlAction.cancel, AOSOrdinaryControlAction.kill),
                     (AOSOrdinaryControlAction.kill, AOSOrdinaryControlAction.cancel)] {
            let firstBarrier = Barrier()
            let stopCalls = LockedBox(0)
            let race = try Environment(stopAdmission: {
                var isFirst = false
                stopCalls.write { $0 += 1; isFirst = $0 == 1 }
                if isFirst { firstBarrier.block() }
            })
            let admission = try activate(race, followed: true).0
            let firstResult = LockedBox<Result<AOSOperationControlReceipt, Error>?>(nil)
            DispatchQueue.global().async {
                do {
                    let value = try issue(pair.0, race, admission.operation)
                    firstResult.write { $0 = .success(value) }
                } catch { firstResult.write { $0 = .failure(error) } }
            }
            firstBarrier.waitUntilEntered()
            let winner = try issue(pair.1, race, admission.operation)
            firstBarrier.release()
            wait("blocked first-writer race did not settle") { firstResult.read() != nil }
            guard case .failure(let firstError)? = firstResult.read(),
                  (firstError as? AOSOperationCoreError) == .invalidTransition else {
                fatalError("blocked race loser overwrote the winner")
            }
            require(winner.action == pair.1
                && operation(admission, race).stopIntent == winner.stopIntent
                && operation(admission, race).outcome == winner.terminalOutcome,
                "control race lost deterministic second-writer winner")
        }
    }

    static func submit(
        _ update: AOSScreenRecordingFollowUpdateRequest,
        environment: Environment,
        connection: UUID
    ) throws -> LockedBox<Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>?> {
        let result = LockedBox<Result<AOSScreenRecordingGeometryState,
            AOSOperationCoreError>?>(nil)
        try environment.screenAdapter.updateFollowGeometry(
            request: update,
            connectionID: connection
        ) { value in result.write { $0 = value } }
        return result
    }

    static func runFollowGeometryAndRecovery() throws {
        let environment = try Environment()
        let activated = try activate(environment, followed: true)
        let admission = activated.0
        wait("follow deadline was not armed") {
            operation(admission, environment).screenRecordingGeometry?.deadlineState == .armed
        }
        environment.clock.advance(20_000_000)
        Thread.sleep(forTimeInterval: 0.02)
        let update = try environment.update(admission)
        let accepted = try submit(
            update, environment: environment, connection: activated.1
        )
        wait("follow update did not settle") { accepted.read() != nil }
        guard case .success(let geometry)? = accepted.read() else {
            fatalError("valid follow update failed: \(String(describing: accepted.read()))")
        }
        require(geometry.accepted.geometryGeneration == 2
            && geometry.pendingUpdate == nil
            && environment.driver.geometryUpdates == 1,
            "follow commit did not cross the native seam exactly once")
        let followValue = aosScreenRecordingFollowUpdatePublicValue(
            operation: admission.operation,
            geometry: geometry
        )
        append("follow_updates", followValue)
        append("responses", responseEnvelope(followValue))
        let replay = try submit(
            update, environment: environment, connection: activated.1
        )
        wait("follow replay did not settle") { replay.read() != nil }
        guard case .failure(.generationConflict)? = replay.read() else {
            fatalError("duplicate follow update was accepted")
        }
        let stale = try submit(
            environment.update(admission, expected: 1, observation: 3, state: 3),
            environment: environment,
            connection: activated.1
        )
        wait("stale update did not settle") { stale.read() != nil }
        guard case .failure(.generationConflict)? = stale.read() else {
            fatalError("stale follow generation was accepted")
        }
        let sequences = environment.events.snapshot().compactMap {
            ($0["data"] as? [String: Any])?["sequence"] as? UInt64
        }
        require(sequences == sequences.sorted() && Set(sequences).count == sequences.count,
                "follow events were not monotonic")
        append("events", environment.events.snapshot().last!)
        _ = try environment.cancel(admission.operation)

        do {
            try aosValidateScreenRecordingProductionFrameBinding(
                admission.geometry.accepted,
                observedTopology: Environment.topology(),
                windowFacts: [CaptureWindowFact(
                    frame: CGRect(x: 0, y: 0, width: 20, height: 20),
                    owningApplication: CaptureApplicationFact(processID: 700),
                    windowID: 77
                )]
            )
            fatalError("off-source frame geometry was accepted")
        } catch AOSOperationCoreError.recordingTargetDrift {}
        do {
            _ = try environment.update(
                admission,
                expected: 2,
                observation: 4,
                state: 4,
                bounds: ["x": 95, "y": 10, "width": 40, "height": 30]
            )
            fatalError("out-of-bounds geometry was accepted")
        } catch AOSOperationCoreError.invalidRecord {}

        let topologyDrift = try Environment()
        let driftActive = try activate(topologyDrift, followed: true)
        Thread.sleep(forTimeInterval: 0.02)
        let drift = try submit(
            topologyDrift.update(
                driftActive.0,
                topology: Environment.topology(scale: 3)
            ),
            environment: topologyDrift,
            connection: driftActive.1
        )
        wait("immutable topology drift did not settle") { drift.read() != nil }
        guard case .failure(.recordingTargetDrift)? = drift.read() else {
            fatalError("immutable topology drift lost exact failure")
        }
        wait("topology drift did not stop") {
            operation(driftActive.0, topologyDrift).state == .terminal
        }

        let nativeFailure = try Environment()
        let nativeActive = try activate(nativeFailure, followed: true)
        Thread.sleep(forTimeInterval: 0.02)
        nativeFailure.driver.failGeometryUpdate = true
        let failed = try submit(
            nativeFailure.update(nativeActive.0),
            environment: nativeFailure,
            connection: nativeActive.1
        )
        wait("native update failure did not settle") { failed.read() != nil }
        guard case .failure(.recordingFollowUpdateFailed)? = failed.read() else {
            fatalError("native update failure lost exact code")
        }
        wait("native update failure did not terminalize") {
            operation(nativeActive.0, nativeFailure).state == .terminal
        }
        require(operation(nativeActive.0, nativeFailure)
            .screenRecordingGeometry?.pendingUpdate != nil,
            "native failure erased durable pending geometry truth")

        let deadline = try Environment()
        let deadlineActive = try activate(
            deadline, followed: true, duration: 1_000, deadline: 40
        )
        wait("follow deadline did not time out", timeout: 1) {
            operation(deadlineActive.0, deadline).state == .terminal
        }
        require(operation(deadlineActive.0, deadline).failureCode
            == AOSOperationCoreError.recordingFollowTimeout.code,
            "deadline timeout lost exact terminal code")

        let store = try FaultStore()
        let prior = try Environment(store: store)
        let priorActive = try activate(
            prior, followed: true, duration: 10_000, deadline: 5_000
        )
        Thread.sleep(forTimeInterval: 0.02)
        prior.driver.holdGeometryUpdate = true
        let pending = try submit(
            prior.update(priorActive.0),
            environment: prior,
            connection: priorActive.1
        )
        wait("pending native update was not installed") {
            prior.driver.geometryUpdates == 1
                && operation(priorActive.0, prior)
                    .screenRecordingGeometry?.pendingUpdate != nil
        }
        require(pending.read() == nil, "held native update completed early")
        let livePrior = operation(priorActive.0, prior)
        let storedPrior = try store.productionReadback()!
        let persistedPrior = storedPrior.operations.first {
            $0.identity == priorActive.0.operation
        }!
        require(persistedPrior.state == livePrior.state
            && persistedPrior.progress == livePrior.progress
            && persistedPrior.screenRecordingGeometry?.accepted.bindingDigest
                == livePrior.screenRecordingGeometry?.accepted.bindingDigest
            && persistedPrior.screenRecordingGeometry?.pendingUpdate?.requestID
                == livePrior.screenRecordingGeometry?.pendingUpdate?.requestID,
                "restart fixture was not read back from the production store")
        let restarted = try Environment(store: store)
        let token = String(repeating: "9", count: 64)
        let recovery = try AOSOperationRecovery.beginBootRecovery(
            registry: restarted.registry,
            newDaemonGeneration: 8,
            claimTokenDigest: token
        )
        let residual = restarted.registry.snapshot()
        require(residual.operations.first?.screenRecordingGeometry?.deadlineState == .stopped
            && residual.operations.first?.screenRecordingGeometry?.pendingUpdate != nil,
            "boot recovery lost stopped pending-update truth")
        let reconciled = try AOSOperationRecovery.reconcile(
            registry: restarted.registry,
            recoveryGeneration: recovery.recoveryGeneration,
            claimTokenDigest: token,
            mechanicallyAbsentOperationIDs: Set(residual.operations.map(\.identity)),
            mechanicallyAbsentStreamIDs: Set(residual.streams.map(\.identity)),
            mechanicallyAbsentTransactionIDs: Set(
                residual.resourceTransactions.map(\.transactionID)
            ),
            mechanicallyAbsentClaimIDs: Set(residual.resourceClaims.map(\.claimID)),
            mechanicallyAbsentBrokerIDs: Set(residual.resourceBrokers.map(\.brokerID)),
            mechanicallyRemovedArtifactIDs: Set(residual.artifacts.map(\.identity))
        )
        require(reconciled.state == .terminal && reconciled.residualCount == 0,
                "boot recovery did not settle all prior-generation children")
    }

    static func completedArtifact(
        _ environment: Environment
    ) throws -> AOSScreenRecordingAdmission {
        let admission = try activate(
            environment, followed: false, duration: 60
        ).0
        wait("duration artifact did not complete", timeout: 1) {
            operation(admission, environment).state == .terminal
        }
        let artifact = environment.registry.snapshot().artifacts.first {
            $0.identity == admission.artifact
        }
        require(artifact?.state == .offered
            && artifact?.trackSummary?.isSuccessful == true,
            "duration result did not offer finalized artifact")
        return admission
    }

    static func runCustody() throws {
        let revealed = try Environment()
        let revealAdmission = try completedArtifact(revealed)
        let reveal = try revealed.screenAdapter.revealArtifact(
            revealAdmission.artifact, ownerRoot: revealed.owner
        )
        require(reveal["action"] as? String == "reveal"
            && reveal["state"] as? String == "offered",
            "reveal projected false custody")
        append("custody", reveal)
        append("responses", responseEnvelope(reveal))
        do {
            _ = try revealed.screenAdapter.retainArtifact(revealAdmission.artifact)
        } catch AOSOperationCoreError.artifactRetainUnavailable {}
        require(revealed.registry.snapshot().artifacts.first {
            $0.identity == revealAdmission.artifact
        }?.state == .offered, "retain-unavailable mutated custody")

        let removed = try Environment()
        let removeAdmission = try completedArtifact(removed)
        let remove = try removed.screenAdapter.removeArtifact(
            removeAdmission.artifact, ownerRoot: removed.owner
        )
        require(remove["action"] as? String == "remove"
            && remove["state"] as? String == "removed"
            && !removed.files.sourcePresent,
            "remove did not settle fake source authority")
        append("custody", remove)
        append("responses", responseEnvelope(remove))

        let released = try Environment()
        let releaseAdmission = try completedArtifact(released)
        let release = try released.screenAdapter.releaseArtifact(
            releaseAdmission.artifact,
            ownerRoot: released.owner,
            destinationPath: "/private/tmp/m3e-release.mov"
        )
        require(release["action"] as? String == "release"
            && release["state"] as? String == "released"
            && !released.files.sourcePresent
            && released.files.destinationPresent,
            "release did not transfer fake custody")
        append("custody", release)
        append("responses", responseEnvelope(release))

        let racing = try Environment()
        let racingAdmission = try completedArtifact(racing)
        let linkBarrier = Barrier()
        racing.files.linkBarrier = linkBarrier
        let releaseResult = LockedBox<Result<[String: Any], Error>?>(nil)
        DispatchQueue.global().async {
            do {
                let value = try racing.screenAdapter.releaseArtifact(
                    racingAdmission.artifact,
                    ownerRoot: racing.owner,
                    destinationPath: "/private/tmp/m3e-race.mov"
                )
                releaseResult.write { $0 = .success(value) }
            } catch { releaseResult.write { $0 = .failure(error) } }
        }
        linkBarrier.waitUntilEntered()
        do {
            _ = try racing.screenAdapter.removeArtifact(
                racingAdmission.artifact, ownerRoot: racing.owner
            )
            fatalError("remove admitted during release CAS")
        } catch AOSOperationCoreError.invalidTransition {}
        linkBarrier.release()
        wait("release CAS did not settle") { releaseResult.read() != nil }
        guard case .success? = releaseResult.read() else {
            fatalError("release CAS winner failed")
        }
        require(racing.registry.snapshot().artifacts.first {
            $0.identity == racingAdmission.artifact
        }?.state == .released, "release CAS did not preserve winner")

        let store = try FaultStore()
        let recovery = try Environment(store: store)
        let recoveryAdmission = try completedArtifact(recovery)
        recovery.files.faults = [.removeSource, .removeDestination]
        do {
            _ = try recovery.screenAdapter.releaseArtifact(
                recoveryAdmission.artifact,
                ownerRoot: recovery.owner,
                destinationPath: "/private/tmp/m3e-recovery.mov"
            )
            fatalError("consecutive custody faults reported release success")
        } catch AOSOperationCoreError.recordingCleanupRequired {}
        let pending = recovery.registry.snapshot().artifacts.first {
            $0.identity == recoveryAdmission.artifact
        }!
        require(pending.state == .cleanupRequired && pending.release != nil,
                "custody fault lost pending release recovery truth")
        let token = String(repeating: "8", count: 64)
        let boot = try AOSOperationRecovery.beginBootRecovery(
            registry: recovery.registry,
            newDaemonGeneration: 8,
            claimTokenDigest: token
        )
        recovery.files.faults = []
        let resolution = try recovery.screenAdapter.recoverArtifactRelease(pending)
        require(resolution == .rolledBack,
                "custody recovery did not roll back exact duplicate")
        try recovery.screenAdapter.removeRecoveredRolledBackArtifact(pending)
        let state = recovery.registry.snapshot()
        let summary = try AOSOperationRecovery.reconcile(
            registry: recovery.registry,
            recoveryGeneration: boot.recoveryGeneration,
            claimTokenDigest: token,
            mechanicallyAbsentOperationIDs: [],
            mechanicallyAbsentClaimIDs: [],
            mechanicallyAbsentBrokerIDs: []
        )
        require(summary.residualCount == 0
            && state.artifacts.first { $0.identity == recoveryAdmission.artifact }?.state
                == .removed,
            "custody recovery did not reach zero residuals")

        let custodyFaultStore = try FaultStore()
        let custodyFault = try Environment(store: custodyFaultStore)
        let custodyFaultAdmission = try completedArtifact(custodyFault)
        custodyFaultStore.arm(.artifactCustody)
        do {
            _ = try custodyFault.screenAdapter.removeArtifact(
                custodyFaultAdmission.artifact, ownerRoot: custodyFault.owner
            )
            fatalError("custody CAS store fault reported removal")
        } catch AOSOperationCoreError.storeUnavailable {}
        require(custodyFault.files.sourcePresent
            && custodyFault.registry.snapshot().artifacts.first {
                $0.identity == custodyFaultAdmission.artifact
            }?.state == .offered,
            "failed custody CAS changed file or durable state")
    }

    static func runStoreFaults() throws {
        for family in [FaultStore.Family.admission, .childPreparation, .activation] {
            let store = try FaultStore()
            let environment = try Environment(store: store)
            store.arm(family)
            do {
                _ = try environment.screenAdapter.start(
                    request: environment.request(
                        systemAudio: true,
                        microphone: true,
                        followed: true,
                        duration: 1_000,
                        followDeadline: 500
                    ),
                    connectionID: UUID()
                )
                fatalError("\(family.rawValue) store fault reported admission")
            } catch {}
            require(store.saw(family)
                && !environment.broker.retainsAuthority
                && !environment.driver.startWasRequested(),
                "\(family.rawValue) fault leaked authority")
            append("faults", family.rawValue)
        }

        let progressStore = try FaultStore()
        let progress = try Environment(store: progressStore)
        let progressAdmission = try progress.screenAdapter.start(
            request: progress.request(
                systemAudio: false, microphone: false, followed: false,
                duration: 1_000, followDeadline: 500
            ),
            connectionID: UUID()
        )
        wait("progress-fault start missing") { progress.driver.startWasRequested() }
        progressStore.arm(.trackProgress)
        do { try progress.driver.publish(.video) }
        catch {
            progress.driver.injectFailure(error)
            progress.driver.settleStart()
        }
        wait("progress fault did not settle", timeout: 1) {
            [.terminal, .cleanupRequired].contains(operation(progressAdmission, progress).state)
        }
        require(progressStore.saw(.trackProgress), "track progress fault was not reached")
        append("faults", FaultStore.Family.trackProgress.rawValue)

        let pendingStore = try FaultStore()
        let pending = try Environment(store: pendingStore)
        let pendingActive = try activate(pending, followed: true)
        Thread.sleep(forTimeInterval: 0.02)
        pendingStore.arm(.followPending)
        let pendingResult = try submit(
            pending.update(pendingActive.0),
            environment: pending,
            connection: pendingActive.1
        )
        wait("follow-pending fault did not return") { pendingResult.read() != nil }
        guard case .failure(.storeUnavailable)? = pendingResult.read() else {
            fatalError("follow-pending fault lost exact error")
        }
        require(pendingStore.saw(.followPending), "follow pending save was not reached")
        _ = try pending.cancel(pendingActive.0.operation)
        append("faults", FaultStore.Family.followPending.rawValue)

        let commitStore = try FaultStore()
        let commit = try Environment(store: commitStore)
        let commitActive = try activate(commit, followed: true)
        Thread.sleep(forTimeInterval: 0.02)
        commitStore.arm(.followCommit)
        let commitResult = try submit(
            commit.update(commitActive.0),
            environment: commit,
            connection: commitActive.1
        )
        wait("follow-commit fault did not return") { commitResult.read() != nil }
        guard case .failure(.storeUnavailable)? = commitResult.read() else {
            fatalError("follow-commit fault lost exact error")
        }
        wait("follow-commit fault did not terminalize") {
            operation(commitActive.0, commit).state == .terminal
        }
        require(commitStore.saw(.followCommit), "follow commit save was not reached")
        append("faults", FaultStore.Family.followCommit.rawValue)

        for family in [FaultStore.Family.followStopped,
                       .terminalOutcome, .terminalCleanup] {
            let store = try FaultStore()
            let environment = try Environment(store: store)
            let active = try activate(environment, followed: family == .followStopped)
            store.arm(family)
            do { _ = try environment.cancel(active.0.operation) } catch {}
            wait("\(family.rawValue) fault did not converge", timeout: 1) {
                [.terminal, .cleanupRequired].contains(operation(active.0, environment).state)
            }
            require(store.saw(family), "\(family.rawValue) save was not reached")
            append("faults", family.rawValue)
        }

        let consecutiveStore = try FaultStore()
        let consecutive = try Environment(store: consecutiveStore)
        let consecutiveActive = try activate(
            consecutive, followed: false, duration: 10_000
        )
        consecutiveStore.arm(.terminalCleanup, count: 8)
        let started = Date()
        do { _ = try consecutive.cancel(consecutiveActive.0.operation) } catch {}
        require(Date().timeIntervalSince(started) < 3
            && consecutiveStore.saw(.terminalCleanup)
            && operation(consecutiveActive.0, consecutive).outcome != .succeeded,
            "consecutive cleanup failure mismatch elapsed=\(Date().timeIntervalSince(started)) saw=\(consecutiveStore.saw(.terminalCleanup)) outcome=\(String(describing: operation(consecutiveActive.0, consecutive).outcome))")
        append("faults", "consecutive_terminal_cleanup")
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
        try runPublicControl()
        try runFollowGeometryAndRecovery()
        try runCustody()
        try runStoreFaults()
        try runSharedMicrophoneConflict()
        let bytes = try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys])
        print("m3e-evidence:\(String(data: bytes, encoding: .utf8)!)")
        let faultCount = (evidence["faults"] as! [Any]).count
        print("m3e-integrated: matrix=8 registry=2 actual-writer=1 shared-microphone=1 control-boundaries=3 follow-recovery=1 custody=1 store-faults=\(faultCount)")
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
    assert.equal(evidence.responses.length, 28)
    const validate = spawnSync('python3', ['-c', String.raw`
import json, os, sys
from jsonschema import Draft202012Validator, FormatChecker, RefResolver
root=sys.argv[1]
schemas=[]
for name in os.listdir(root):
    if name.endswith('.schema.json'):
        value=json.load(open(os.path.join(root,name),encoding='utf-8'))
        if '$id' in value: schemas.append(value)
store={value['$id']:value for value in schemas}
def by_name(name): return next(value for key,value in store.items() if key.endswith('/'+name))
def definition(name, member):
    schema=by_name(name)
    target={'$schema':'https://json-schema.org/draft/2020-12/schema','$ref':schema['$id']+'#/$defs/'+member}
    return Draft202012Validator(target,resolver=RefResolver.from_schema(target,store=store),format_checker=FormatChecker())
rows=json.load(sys.stdin)
checks=[
  (definition('aos-screen-recording-v1.schema.json','admission_result'),rows['admissions']),
  (definition('aos-screen-recording-v1.schema.json','follow_update_result'),rows['follow_updates']),
  (definition('aos-operation-v1.schema.json','operation_list_result'),rows['lists']),
  (definition('aos-operation-v1.schema.json','operation_inspect_result'),rows['inspects']),
  (definition('aos-artifact-v1.schema.json','artifact_custody_result'),rows['custody']),
  (Draft202012Validator(by_name('daemon-event.schema.json'),resolver=RefResolver.from_schema(by_name('daemon-event.schema.json'),store=store),format_checker=FormatChecker()),rows['events']),
  (Draft202012Validator(by_name('daemon-response.schema.json'),resolver=RefResolver.from_schema(by_name('daemon-response.schema.json'),store=store),format_checker=FormatChecker()),rows['responses']),
]
for validator, values in checks:
    for value in values:
        errors=list(validator.iter_errors(value))
        assert not errors,[error.message for error in errors]
print('m3e-schemas: admissions=8 follow=1 list=8 inspect=8 custody=3 responses=28')
`, path.join(repoRoot, 'shared/schemas')], {
      encoding: 'utf8', input: JSON.stringify(evidence), timeout: 20_000,
    })
    assert.equal(validate.status, 0, `${validate.stdout}\n${validate.stderr}`)
    assert.match(validate.stdout, /m3e-schemas: admissions=8 follow=1 list=8 inspect=8 custody=3 responses=28/u)
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
  assert.doesNotMatch(self, /^struct AOSDisplayTopology(?:Bounds|Point|Display|Snapshot)/mu)
  assert.doesNotMatch(self, /^func (?:aosDisplayTopologyWireValue|validateAOSDisplayTopologyWireValue)/mu)
  assert.doesNotMatch(self, /execFileSync\([^\n]*\.\/aos|spawnSync\([^\n]*\.\/aos/u)
  assert.doesNotMatch(wrapper, /\.\/aos|build\.sh|daemon|ScreenCaptureKit|AVAssetWriter/u)
})
