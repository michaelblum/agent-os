import CoreMedia
import CryptoKit
import Darwin
import Foundation
import ScreenCaptureKit

struct AOSScreenRecordingOperationContext {
    let ownerRoot: AOSMechanicalOwnerRoot
    let attribution: AOSOperationAttribution
}

struct AOSScreenRecordingAdmission: Codable, Equatable {
    let operation: AOSOperationIdentity
    let stream: AOSOperationIdentity
    let artifact: AOSOperationIdentity
    let daemonGeneration: UInt64
    let geometryBindingDigest: String

    func publicValue(request: AOSScreenRecordingRequest) -> [String: Any] {
        [
            "schema_version": "aos.screen-recording.admission-result.v1",
            "operation": [
                "operation_id": operation.id,
                "operation_generation": operation.generation,
            ],
            "stream": [
                "stream_id": stream.id,
                "stream_generation": stream.generation,
            ],
            "artifact": [
                "artifact_id": artifact.id,
                "artifact_generation": artifact.generation,
            ],
            "daemon_generation": daemonGeneration,
            "geometry_binding_digest": geometryBindingDigest,
            "tracks": [
                "video": true,
                "system_audio": request.tracks.systemAudio,
                "microphone": request.tracks.microphone,
            ],
            "track_summary": aosScreenRecordingTrackSummaryValue(.initial(
                systemAudioSelected: request.tracks.systemAudio,
                microphoneSelected: request.tracks.microphone
            )),
            "codec": AOSScreenRecordingRequest.codec,
            "container": AOSScreenRecordingRequest.container,
        ]
    }
}

struct AOSScreenRecordingClaimAdmission {
    let publicAdmission: AOSScreenRecordingAdmission
    let claims: [AOSResourceClaimBinding]
}

struct AOSScreenRecordingMicrophoneAuthorizationDependencies {
    let status: () -> AOSMicrophoneAuthorizationState
    let request: (TimeInterval) -> AOSMicrophoneAuthorizationRequestResult

    static func live() -> Self {
        let provider = AOSSystemMicrophoneAuthorization()
        return Self(
            status: { provider.status() },
            request: { provider.request(timeout: $0) }
        )
    }
}

protocol AOSScreenRecordingRuntimeControlling: AnyObject {
    func stop(intent: AOSStopIntent)
    func residualDigest() -> String?
}

protocol AOSScreenRecordingBrokerControlling: AnyObject {
    func acquireExclusiveProducer(ownerID: String) throws -> AOSDesktopPixelExclusiveProducerLease
    func releaseExclusiveProducer(_ lease: AOSDesktopPixelExclusiveProducerLease) -> Bool
}

extension AOSDesktopPixelBroker: AOSScreenRecordingBrokerControlling {}

struct AOSScreenRecordingFileDependencies {
    let validateArtifact: (
        URL,
        URL,
        UInt64,
        AOSScreenRecordingTrackSummary
    ) throws -> AOSArtifactFileIdentity
    let destinationIdentity: (
        URL,
        URL,
        AOSArtifactFileIdentity
    ) throws -> AOSArtifactReleaseDestinationIdentity
    let observe: (
        URL,
        AOSArtifactFileIdentity,
        AOSArtifactReleaseDestinationIdentity?
    ) -> AOSArtifactReleaseObservation
    let linkDestination: (
        URL,
        URL,
        AOSArtifactFileIdentity,
        AOSArtifactReleaseDestinationIdentity
    ) throws -> AOSArtifactReleaseDestinationFileIdentity
    let remove: (URL, Bool) throws -> Void
    let exists: (URL) -> Bool

    static let live = Self(
        validateArtifact: AOSScreenRecordingEncoder.validateArtifact,
        destinationIdentity: aosScreenRecordingReleaseDestinationIdentity,
        observe: aosObserveScreenRecordingReleaseFile,
        linkDestination: aosLinkScreenRecordingReleaseDestination,
        remove: aosRemoveScreenRecordingFile,
        exists: { FileManager.default.fileExists(atPath: $0.path) }
    )
}

struct AOSScreenRecordingNativeSession {
    let encoder: AOSScreenRecordingEncoding
    let lifecycle: AOSDesktopPixelStreamLifecycle
    let signal: AOSDesktopPixelStartupSignal
    let start: AOSDesktopPixelNativeOperation
    let stop: AOSDesktopPixelNativeOperation
    let microphoneSession: (any AOSMicrophoneNativeSessionControlling)?

    init(
        encoder: AOSScreenRecordingEncoding,
        lifecycle: AOSDesktopPixelStreamLifecycle,
        signal: AOSDesktopPixelStartupSignal,
        start: @escaping AOSDesktopPixelNativeOperation,
        stop: @escaping AOSDesktopPixelNativeOperation,
        microphoneSession: (any AOSMicrophoneNativeSessionControlling)? = nil
    ) {
        self.encoder = encoder
        self.lifecycle = lifecycle
        self.signal = signal
        self.start = start
        self.stop = stop
        self.microphoneSession = microphoneSession
    }
}

final class AOSScreenRecordingMicrophoneInput: @unchecked Sendable {
    let session: any AOSMicrophoneNativeSessionControlling

    private let didFail: AOSScreenRecordingFailureSink
    private weak var encoder: (any AOSScreenRecordingEncoding)?
    private let frameAdmission: AOSDesktopPixelFrameAdmissionGate
    private let lock = NSLock()
    private let persistProgress: AOSScreenRecordingProgressSink
    private let startup: AOSDesktopPixelStartupSignal
    private var ready = false

    init(
        session: any AOSMicrophoneNativeSessionControlling,
        encoder: any AOSScreenRecordingEncoding,
        frameAdmission: AOSDesktopPixelFrameAdmissionGate,
        startup: AOSDesktopPixelStartupSignal,
        persistProgress: @escaping AOSScreenRecordingProgressSink,
        didFail: @escaping AOSScreenRecordingFailureSink
    ) {
        self.session = session
        self.encoder = encoder
        self.frameAdmission = frameAdmission
        self.startup = startup
        self.persistProgress = persistProgress
        self.didFail = didFail
    }

    func start() throws {
        do {
            _ = try session.start { [weak self] buffer, time in
                self?.receive(buffer, at: time)
            }
            guard let encoder else {
                throw AOSOperationCoreError.recordingCleanupRequired
            }
            try encoder.markAvailable(.microphone)
            lock.lock()
            ready = true
            lock.unlock()
        } catch {
            lock.lock()
            ready = false
            lock.unlock()
            _ = session.stop()
            throw error
        }
    }

    @discardableResult
    func stop() -> Bool {
        lock.lock()
        ready = false
        lock.unlock()
        return session.stop()
    }

    private func receive(_ buffer: AVAudioPCMBuffer, at time: AVAudioTime) {
        lock.lock()
        let mayAdmit = ready
        lock.unlock()
        guard mayAdmit,
              let encoder,
              let token = frameAdmission.admit() else {
            return
        }
        defer { token.complete() }
        do {
            try encoder.appendMicrophone(buffer, at: time)
            let progress = encoder.progress
            try persistProgress(progress)
            if progress.sessionStarted { startup.succeed() }
        } catch {
            didFail(error)
        }
    }
}

typealias AOSScreenRecordingProgressSink = @Sendable (
    AOSScreenRecordingEncoderProgress
) throws -> Void
typealias AOSScreenRecordingFailureSink = @Sendable (Error) -> Void
typealias AOSScreenRecordingSessionFactory = @Sendable (
    AOSScreenRecordingTracks,
    AOSDesktopPixelFrameAdmissionGate,
    @escaping AOSScreenRecordingProgressSink,
    @escaping AOSScreenRecordingFailureSink
) async throws -> AOSScreenRecordingNativeSession
typealias AOSScreenRecordingMicrophoneSessionFactory = @Sendable () ->
    any AOSMicrophoneNativeSessionControlling

private func aosScreenRecordingReleaseDestinationIdentity(
    _ destination: URL,
    _ source: URL,
    _ sourceIdentity: AOSArtifactFileIdentity
) throws -> AOSArtifactReleaseDestinationIdentity {
    var parentStat = stat()
    var sourceStat = stat()
    guard lstat(destination.deletingLastPathComponent().path, &parentStat) == 0,
          (parentStat.st_mode & S_IFMT) == S_IFDIR,
          parentStat.st_uid == geteuid(),
          lstat(source.path, &sourceStat) == 0,
          UInt64(sourceStat.st_dev) == sourceIdentity.device,
          UInt64(sourceStat.st_ino) == sourceIdentity.inode,
          parentStat.st_dev == sourceStat.st_dev else {
        throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
    }
    return AOSArtifactReleaseDestinationIdentity(
        absolutePath: destination.path,
        pathDigest: AOSScreenRecordingEncoder.digest("destination:\(destination.path)"),
        parentDevice: UInt64(parentStat.st_dev),
        parentInode: UInt64(parentStat.st_ino)
    )
}

private func aosObserveScreenRecordingReleaseFile(
    _ url: URL,
    _ sourceIdentity: AOSArtifactFileIdentity,
    _ expectedParent: AOSArtifactReleaseDestinationIdentity?
) -> AOSArtifactReleaseObservation {
    if let expectedParent {
        let parent = url.deletingLastPathComponent()
        var parentStat = stat()
        guard url.path == expectedParent.absolutePath,
              AOSScreenRecordingEncoder.digest("destination:\(url.path)")
                == expectedParent.pathDigest,
              lstat(parent.path, &parentStat) == 0,
              (parentStat.st_mode & S_IFMT) == S_IFDIR,
              parentStat.st_uid == geteuid(),
              UInt64(parentStat.st_dev) == expectedParent.parentDevice,
              UInt64(parentStat.st_ino) == expectedParent.parentInode else {
            return .conflicting
        }
    }
    var metadata = stat()
    guard lstat(url.path, &metadata) == 0 else {
        return errno == ENOENT ? .absent : .conflicting
    }
    guard (metadata.st_mode & S_IFMT) == S_IFREG,
          metadata.st_uid == geteuid(),
          metadata.st_nlink >= 1,
          metadata.st_nlink <= 2,
          UInt64(metadata.st_dev) == sourceIdentity.device,
          UInt64(metadata.st_ino) == sourceIdentity.inode,
          metadata.st_size >= 0,
          UInt64(metadata.st_size) == sourceIdentity.byteCount,
          let bytes = try? Data(contentsOf: url, options: [.mappedIfSafe]),
          bytes.count == Int(sourceIdentity.byteCount),
          SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined()
            == sourceIdentity.contentDigest else {
        return .conflicting
    }
    return .exact
}

private func aosLinkScreenRecordingReleaseDestination(
    _ source: URL,
    _ destination: URL,
    _ sourceIdentity: AOSArtifactFileIdentity,
    _ destinationIdentity: AOSArtifactReleaseDestinationIdentity
) throws -> AOSArtifactReleaseDestinationFileIdentity {
    guard aosObserveScreenRecordingReleaseFile(source, sourceIdentity, nil) == .exact else {
        throw AOSOperationCoreError.artifactIdentityMismatch
    }
    guard aosObserveScreenRecordingReleaseFile(
        destination,
        sourceIdentity,
        destinationIdentity
    ) == .absent else {
        throw AOSOperationCoreError.artifactDestinationExists
    }
    guard link(source.path, destination.path) == 0 else {
        if errno == EEXIST { throw AOSOperationCoreError.artifactDestinationExists }
        throw AOSOperationCoreError.recordingCleanupRequired
    }
    guard aosObserveScreenRecordingReleaseFile(
        destination,
        sourceIdentity,
        destinationIdentity
    ) == .exact else {
        throw AOSOperationCoreError.artifactIdentityMismatch
    }
    return AOSArtifactReleaseDestinationFileIdentity(
        device: sourceIdentity.device,
        inode: sourceIdentity.inode,
        byteCount: sourceIdentity.byteCount,
        contentDigest: sourceIdentity.contentDigest
    )
}

private func aosRemoveScreenRecordingFile(_ url: URL, _ allowAbsent: Bool) throws {
    if unlink(url.path) == 0 {
        guard !FileManager.default.fileExists(atPath: url.path) else {
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        return
    }
    guard allowAbsent, errno == ENOENT else {
        throw AOSOperationCoreError.recordingCleanupRequired
    }
}

final class AOSScreenRecordingOperationAdapter: AOSOperationControlAdapter {
    typealias ContextResolver = (UUID) throws -> AOSScreenRecordingOperationContext

    static let registrationID = "screen-recording-adapter"
    static let registrationRevision: UInt64 = 1
    static let capabilityID = "screen-recording.video"
    static let operationClass = "screen-recording"
    static let resourceKey = "screen_capture_native_session"

    let registration: AOSOperationAdapterRegistration

    private let artifactRootURL: URL
    private let broker: AOSScreenRecordingBrokerControlling
    private let contextResolver: ContextResolver
    private let files: AOSScreenRecordingFileDependencies
    private let lock = NSLock()
    private let reconcileHostBarrier: () -> Void
    private let registry: AOSOperationRegistry
    private let sessionFactory: AOSScreenRecordingSessionFactory?
    private let microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies
    private let microphoneSessionFactory: AOSScreenRecordingMicrophoneSessionFactory
    private let startupTimeout: TimeInterval
    private var runtimes: [AOSOperationIdentity: AOSScreenRecordingRuntimeControlling] = [:]

    static func makeRegistration() throws -> AOSOperationAdapterRegistration {
        let declaration = try AOSResourceDeclaration.make(
            adapterRegistrationID: registrationID,
            adapterRegistrationRevision: registrationRevision,
            resourceKey: resourceKey,
            admissionMode: .exclusive
        )
        return AOSOperationAdapterRegistration(
            id: registrationID,
            revision: registrationRevision,
            operationClass: operationClass,
            capabilityIDs: [capabilityID],
            resourceDeclarations: [declaration]
        )
    }

    init(
        registry: AOSOperationRegistry,
        registration: AOSOperationAdapterRegistration,
        broker: AOSScreenRecordingBrokerControlling,
        artifactRootURL: URL,
        contextResolver: @escaping ContextResolver,
        files: AOSScreenRecordingFileDependencies = .live,
        sessionFactory: AOSScreenRecordingSessionFactory? = nil,
        microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies = .live(),
        microphoneSessionFactory: @escaping AOSScreenRecordingMicrophoneSessionFactory = {
            AOSMicrophoneNativeSession()
        },
        startupTimeout: TimeInterval = aosDesktopPixelStreamRetirementTimeout,
        reconcileHostBarrier: @escaping () -> Void = {}
    ) throws {
        guard registration == (try Self.makeRegistration()),
              startupTimeout.isFinite,
              startupTimeout > 0,
              startupTimeout <= aosDesktopPixelStreamRetirementTimeout else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        self.registry = registry
        self.registration = registration
        self.broker = broker
        self.artifactRootURL = artifactRootURL
        self.contextResolver = contextResolver
        self.files = files
        self.reconcileHostBarrier = reconcileHostBarrier
        self.sessionFactory = sessionFactory
        self.microphoneAuthorization = microphoneAuthorization
        self.microphoneSessionFactory = microphoneSessionFactory
        self.startupTimeout = startupTimeout
    }

    func start(
        request: AOSScreenRecordingRequest,
        connectionID: UUID
    ) throws -> AOSScreenRecordingAdmission {
        let geometry = try AOSScreenRecordingGeometryValidator.resolve(request)
        let context = try contextResolver(connectionID)
        let claimAdmission = try prepare(
            request: request,
            geometry: geometry,
            context: context
        )
        let runtime = AOSNativeScreenRecordingRuntime(
            adapter: self,
            admission: claimAdmission,
            artifactRootURL: artifactRootURL,
            broker: broker,
            files: files,
            geometry: geometry,
            registry: registry,
            request: request,
            sessionFactory: sessionFactory,
            microphoneAuthorization: microphoneAuthorization,
            microphoneSessionFactory: microphoneSessionFactory,
            startupTimeout: startupTimeout
        )
        lock.lock()
        runtimes[claimAdmission.publicAdmission.operation] = runtime
        lock.unlock()
        runtime.start()
        return claimAdmission.publicAdmission
    }

    func requestStop(operation: AOSOperationIdentity, force: Bool) -> AOSAdapterStopResult {
        guard let record = try? registry.inspect(operation),
              record.adapterRegistrationID == registration.id,
              record.adapterRegistrationRevision == registration.revision else {
            return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
        }
        if record.state == .terminal {
            return AOSAdapterStopResult(disposition: .absent, residualDigest: nil)
        }
        let intent: AOSStopIntent = record.stopIntent
            ?? (force ? .kill : .cancel)
        if [.starting, .active].contains(record.state) {
            _ = try? registry.transitionOperation(operation, to: .stopping, stopIntent: intent)
        }
        lock.lock()
        let runtime = runtimes[operation]
        lock.unlock()
        guard let runtime else {
            return AOSAdapterStopResult(
                disposition: .residual,
                residualDigest: residualDigest(operation: operation)
            )
        }
        runtime.stop(intent: intent)
        return AOSAdapterStopResult(disposition: .accepted, residualDigest: nil)
    }

    func residualDigest(operation: AOSOperationIdentity) -> String? {
        lock.lock()
        let runtime = runtimes[operation]
        lock.unlock()
        if let digest = runtime?.residualDigest() { return digest }
        return registry.snapshot().resourceClaims.first(where: {
            $0.operation == operation && $0.state != .terminal
        })?.reattachTokenDigest
    }

    func revealArtifact(
        _ selector: AOSOperationIdentity,
        ownerRoot: AOSMechanicalOwnerRoot
    ) throws -> [String: Any] {
        let record = try ownedArtifact(selector, ownerRoot: ownerRoot)
        guard record.state == .offered, let expected = record.fileIdentity else {
            throw AOSOperationCoreError.invalidTransition
        }
        let url = artifactURL(selector)
        guard let summary = expected.trackSummary,
              try files.validateArtifact(
                url,
                artifactRootURL,
                expected.byteCount,
                summary
              ) == expected else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        return artifactResult("reveal", record: record, path: url.path)
    }

    func removeArtifact(
        _ selector: AOSOperationIdentity,
        ownerRoot: AOSMechanicalOwnerRoot
    ) throws -> [String: Any] {
        let record = try ownedArtifact(selector, ownerRoot: ownerRoot)
        guard record.state == .offered, let expected = record.fileIdentity else {
            throw AOSOperationCoreError.invalidTransition
        }
        let url = artifactURL(selector)
        guard let summary = expected.trackSummary,
              try files.validateArtifact(
                url,
                artifactRootURL,
                expected.byteCount,
                summary
              ) == expected else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        _ = try registry.updateArtifact(selector, state: .removing, pendingAction: .remove)
        do {
            try files.remove(url, true)
        } catch {
            _ = try? registry.updateArtifact(selector, state: .cleanupRequired)
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        let receipt = AOSArtifactCustodyReceipt(
            action: .remove,
            completedAtNanoseconds: registry.now(),
            destinationIdentityDigest: nil
        )
        let removed = try registry.updateArtifact(
            selector,
            state: .removed,
            custodyReceipt: receipt,
            custodyDigest: custodyDigest(receipt)
        )
        return artifactResult("remove", record: removed, path: nil)
    }

    func releaseArtifact(
        _ selector: AOSOperationIdentity,
        ownerRoot: AOSMechanicalOwnerRoot,
        destinationPath: String
    ) throws -> [String: Any] {
        guard let validatedDestinationPath = aosArtifactReleaseDestinationPath(destinationPath) else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
        }
        let record = try ownedArtifact(selector, ownerRoot: ownerRoot)
        guard record.state == .offered, let expected = record.fileIdentity else {
            throw AOSOperationCoreError.invalidTransition
        }
        let source = artifactURL(selector)
        guard let summary = expected.trackSummary,
              try files.validateArtifact(
                source,
                artifactRootURL,
                expected.byteCount,
                summary
              ) == expected else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        let destination = URL(fileURLWithPath: validatedDestinationPath)
        let destinationIdentity = try files.destinationIdentity(
            destination,
            source,
            expected
        )
        let release = try registry.prepareArtifactRelease(
            selector,
            sourceIdentity: expected,
            destinationIdentity: destinationIdentity
        )
        do {
            try AOSArtifactReleaseCoordinator.execute(
                release,
                dependencies: AOSArtifactReleaseExecutionDependencies(
                    linkDestination: { [self] in
                        try files.linkDestination(
                            source,
                            destination,
                            expected,
                            release.destinationIdentity
                        )
                    },
                    persistDestinationLinked: { [registry] identity in
                        _ = try registry.markArtifactReleaseDestinationLinked(
                            selector,
                            releaseGeneration: release.releaseGeneration,
                            destinationFileIdentity: identity
                        )
                    },
                    removeSource: {
                        try self.files.remove(source, false)
                    },
                    persistReleased: { [self] _ in
                        _ = try resolveRelease(
                            release,
                            resolution: .released
                        )
                    }
                )
            )
        } catch {
            let initiatingError = error
            if initiatingError as? AOSOperationCoreError == .artifactDestinationExists {
                _ = try resolveRelease(release, resolution: .rolledBack)
                throw initiatingError
            }
            let current = registry.snapshot().artifacts.first {
                $0.identity == selector
            }
            guard let current, current.release != nil else { throw initiatingError }
            let resolution: AOSArtifactReleaseResolution
            do {
                resolution = try recoverArtifactRelease(current)
            } catch {
                throw AOSOperationCoreError.recordingCleanupRequired
            }
            if resolution == .released {
                let released = registry.snapshot().artifacts.first {
                    $0.identity == selector
                }
                guard let released else {
                    throw AOSOperationCoreError.recordingCleanupRequired
                }
                return artifactResult("release", record: released, path: destination.path)
            }
            if resolution == .residual {
                throw AOSOperationCoreError.recordingCleanupRequired
            }
            throw initiatingError
        }
        guard let released = registry.snapshot().artifacts.first(where: {
            $0.identity == selector && $0.state == .released
        }) else { throw AOSOperationCoreError.recordingCleanupRequired }
        return artifactResult("release", record: released, path: destination.path)
    }

    func recoverArtifactRelease(
        _ artifact: AOSArtifactRecord
    ) throws -> AOSArtifactReleaseResolution {
        guard let release = artifact.release,
              release.artifact == artifact.identity,
              release.daemonGeneration == artifact.daemonGeneration,
              release.sourceIdentity == artifact.fileIdentity else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_recovery")
        }
        let source = artifactURL(artifact.identity)
        let destination = URL(fileURLWithPath: release.destinationIdentity.absolutePath)
        let sourceObservation = files.observe(source, release.sourceIdentity, nil)
        let destinationObservation = files.observe(
            destination,
            release.sourceIdentity,
            release.destinationIdentity
        )
        return try AOSArtifactReleaseCoordinator.recover(
            source: sourceObservation,
            destination: destinationObservation,
            dependencies: AOSArtifactReleaseRecoveryDependencies(
                removeExactDestination: {
                    try self.files.remove(destination, false)
                },
                persistResolution: { [self] resolution in
                    _ = try resolveRelease(release, resolution: resolution)
                }
            )
        )
    }

    func removeRecoveredRolledBackArtifact(
        _ artifact: AOSArtifactRecord
    ) throws {
        guard artifact.release != nil,
              let expected = artifact.fileIdentity,
              let current = registry.snapshot().artifacts.first(where: {
                  $0.identity == artifact.identity
              }),
              current.state == .offered,
              current.release == nil,
              current.fileIdentity == expected else {
            throw AOSOperationCoreError.invalidRecord(
                "artifact_release_rollback_cleanup"
            )
        }
        let source = artifactURL(artifact.identity)
        switch files.observe(source, expected, nil) {
        case .conflicting:
            _ = try? registry.updateArtifact(
                artifact.identity,
                state: .cleanupRequired
            )
            throw AOSOperationCoreError.recordingCleanupRequired
        case .absent:
            break
        case .exact:
            _ = try registry.updateArtifact(
                artifact.identity,
                state: .removing,
                pendingAction: .remove
            )
            do {
                try files.remove(source, false)
            } catch {
                _ = try? registry.updateArtifact(
                    artifact.identity,
                    state: .cleanupRequired
                )
                throw AOSOperationCoreError.recordingCleanupRequired
            }
            _ = try registry.updateArtifact(artifact.identity, state: .removed)
            return
        }
        _ = try registry.updateArtifact(
            artifact.identity,
            state: .removing,
            pendingAction: .remove
        )
        _ = try registry.updateArtifact(artifact.identity, state: .removed)
    }

    func retainArtifact(_ selector: AOSOperationIdentity) throws -> Never {
        _ = selector
        throw AOSOperationCoreError.artifactRetainUnavailable
    }

    fileprivate func runtimeDidFinish(
        _ admission: AOSScreenRecordingClaimAdmission,
        intent: AOSStopIntent,
        artifactIdentity: AOSArtifactFileIdentity?,
        progress: AOSScreenRecordingEncoderProgress,
        elapsedMilliseconds: UInt64,
        requestedBounds: AOSOperationRequestedBounds,
        authorityAbsent: Bool,
        failure: Error?
    ) {
        defer {
            lock.lock()
            runtimes.removeValue(forKey: admission.publicAdmission.operation)
            lock.unlock()
            reconcileHostBarrier()
        }
        do {
            let publicAdmission = admission.publicAdmission
            let durableProgress = try aosPersistScreenRecordingProgress(
                frameCount: progress.frameCount,
                byteCount: progress.byteCount,
                elapsedMilliseconds: elapsedMilliseconds,
                bounds: requestedBounds,
                trackSummary: progress.trackSummary
            ) { _ in }
            _ = try registry.updateOperationProgress(
                publicAdmission.operation,
                durableProgress
            )
            if let artifactIdentity {
                _ = try registry.updateArtifact(
                    publicAdmission.artifact,
                    state: .offered,
                    fileIdentity: artifactIdentity,
                    trackSummary: progress.trackSummary,
                    custodyDigest: artifactIdentity.contentDigest
                )
            } else {
                _ = try? registry.updateArtifact(
                    publicAdmission.artifact,
                    state: .removing,
                    trackSummary: progress.trackSummary,
                    pendingAction: .remove
                )
                let artifactURL = self.artifactURL(publicAdmission.artifact)
                do {
                    try files.remove(artifactURL, true)
                } catch {
                    throw AOSOperationCoreError.recordingCleanupRequired
                }
                _ = try registry.updateArtifact(publicAdmission.artifact, state: .removed)
            }
            let currentStream = registry.snapshot().streams.first {
                $0.identity == publicAdmission.stream
            }
            if let currentStream, currentStream.state != .terminal {
                if [.starting, .active].contains(currentStream.state) {
                    _ = try registry.transitionStream(publicAdmission.stream, to: .stopping)
                }
                _ = try registry.transitionStream(
                    publicAdmission.stream,
                    to: .terminal,
                    frameCount: progress.frameCount,
                    byteCount: progress.byteCount
                )
            }
            try releaseClaims(admission.claims, authorityAbsent: authorityAbsent)
            let operation = try registry.inspect(publicAdmission.operation)
            if operation.state == .starting || operation.state == .active {
                _ = try registry.transitionOperation(
                    publicAdmission.operation,
                    to: .stopping,
                    stopIntent: intent
                )
            } else if operation.state == .cleanupRequired {
                _ = try registry.transitionOperation(
                    publicAdmission.operation,
                    to: .recovering,
                    stopIntent: intent
                )
            }
            let outcome: AOSOperationOutcome
            if failure != nil {
                outcome = .failed
            } else {
                switch intent {
                case .complete: outcome = .succeeded
                case .cancel, .peerLost, .transportLost: outcome = .cancelled
                case .kill, .ownerKill, .hostStop: outcome = .killed
                case .deadline: outcome = .timedOut
                case .permissionRevoked, .adapterFailed: outcome = .failed
                }
            }
            _ = try registry.terminalizeOperationAfterVerifiedCleanup(
                publicAdmission.operation,
                stopIntent: intent,
                outcome: outcome,
                failureCode: (failure as? AOSOperationCoreError)?.code
            )
        } catch {
            markCleanupRequired(admission.publicAdmission.operation)
        }
    }

    fileprivate func runtimeRetirementRemainsUncertain(
        _ operation: AOSOperationIdentity
    ) {
        markCleanupRequired(operation)
        reconcileHostBarrier()
    }

    private func prepare(
        request: AOSScreenRecordingRequest,
        geometry: AOSScreenRecordingGeometry,
        context: AOSScreenRecordingOperationContext
    ) throws -> AOSScreenRecordingClaimAdmission {
        let initial = registry.snapshot()
        guard initial.barrier.state == .open,
              initial.adapterRegistry.registration(
                id: registration.id,
                revision: registration.revision
              ) == registration,
              let screenDeclaration = initial.adapterRegistry.declaration(
                resourceKey: Self.resourceKey
              ) else {
            throw AOSOperationCoreError.barrierClosed
        }
        let microphoneDeclaration: AOSResourceDeclaration?
        if request.tracks.microphone {
            guard initial.adapterRegistry.registration(
                id: AOSMicrophoneOperationResourceIdentity.adapterRegistrationID,
                revision: AOSMicrophoneOperationResourceIdentity.adapterRegistrationRevision
            ) != nil,
            let declaration = initial.adapterRegistry.declaration(
                resourceKey: AOSMicrophoneOperationResourceIdentity.resourceKey
            ),
            declaration.adapterRegistrationID
                == AOSMicrophoneOperationResourceIdentity.adapterRegistrationID,
            declaration.adapterRegistrationRevision
                == AOSMicrophoneOperationResourceIdentity.adapterRegistrationRevision,
            declaration.admissionMode == .exclusive else {
                throw AOSOperationCoreError.adapterRegistryConflict
            }
            microphoneDeclaration = declaration
        } else {
            microphoneDeclaration = nil
        }
        let initialTrackSummary = AOSScreenRecordingTrackSummary.initial(
            systemAudioSelected: request.tracks.systemAudio,
            microphoneSelected: request.tracks.microphone
        )
        let initialProgress = AOSOperationProgress(
            frameCount: 0,
            byteCount: 0,
            elapsedMilliseconds: 0,
            droppedFrameCount: 0,
            trackSummary: initialTrackSummary
        )
        let operation = try registry.prepareOperation(
            ownerRoot: context.ownerRoot,
            attribution: context.attribution,
            capabilityID: Self.capabilityID,
            adapterRegistrationID: registration.id,
            adapterRegistrationRevision: registration.revision,
            requestedBounds: request.requestedBounds,
            initialProgress: initialProgress
        )
        do {
            let stream = try registry.prepareStream(parent: operation.identity)
            let artifact = try registry.prepareArtifact(
                parent: operation.identity,
                trackSummary: initialTrackSummary
            )
            func request(
                declaration: AOSResourceDeclaration
            ) -> AOSResourceClaimRequest {
                let generation = initial.resourceClaims
                    .filter { $0.resourceKey == declaration.resourceKey }
                    .map(\.resourceGeneration).max() ?? 0
                return AOSResourceClaimRequest(
                    adapterRegistrationID: declaration.adapterRegistrationID,
                    adapterRegistrationRevision: declaration.adapterRegistrationRevision,
                    resourceKey: declaration.resourceKey,
                    admissionMode: .exclusive,
                    resourceDeclarationDigest: declaration.declarationDigest,
                    expectedResourceGeneration: generation,
                    expectedBrokerGeneration: nil,
                    expectedSubscriberSetRevision: nil,
                    expectedSubscriberSetCount: nil,
                    expectedSubscriberSetDigest: nil
                )
            }
            var requests = [request(declaration: screenDeclaration)]
            if let microphoneDeclaration {
                requests.append(request(declaration: microphoneDeclaration))
            }
            let transaction = try AOSOperationResourceTransaction.prepare(
                registry: registry,
                operation: operation.identity,
                expectedBarrierGeneration: initial.barrier.generation,
                expectedAdapterRegistry: initial.adapterRegistry,
                requests: requests
            )
            _ = try AOSOperationResourceTransaction.beginReservation(
                registry: registry,
                transactionID: transaction.transactionID
            )
            let receipt = try AOSOperationResourceTransaction.commit(
                registry: registry,
                transactionID: transaction.transactionID
            )
            _ = try AOSOperationResourceTransaction.completeHandoff(
                registry: registry,
                transactionID: transaction.transactionID
            )
            let expectedResources = Set(requests.map(\.resourceKey))
            let claims = registry.snapshot().resourceClaims.filter {
                receipt.claims.contains($0.claimID)
                    && $0.operation == operation.identity
                    && $0.state == .active
            }
            guard claims.count == requests.count,
                  Set(claims.map(\.resourceKey)) == expectedResources else {
                throw AOSOperationCoreError.resourceDeclarationConflict
            }
            _ = try registry.transitionOperation(operation.identity, to: .starting)
            _ = try registry.transitionStream(stream.identity, to: .starting)
            return AOSScreenRecordingClaimAdmission(
                publicAdmission: AOSScreenRecordingAdmission(
                    operation: operation.identity,
                    stream: stream.identity,
                    artifact: artifact.identity,
                    daemonGeneration: operation.daemonGeneration,
                    geometryBindingDigest: geometry.bindingDigest
                ),
                claims: claims.map {
                    AOSResourceClaimBinding(
                        claimID: $0.claimID,
                        operation: $0.operation,
                        resourceKey: $0.resourceKey,
                        resourceGeneration: $0.resourceGeneration
                    )
                }
            )
        } catch {
            markCleanupRequired(operation.identity)
            throw error
        }
    }

    private func releaseClaims(
        _ claims: [AOSResourceClaimBinding],
        authorityAbsent: Bool
    ) throws {
        guard authorityAbsent else {
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        for claim in claims.sorted(by: { $0.resourceKey > $1.resourceKey }) {
            let state = registry.snapshot().resourceClaims.first {
                $0.claimID == claim.claimID
            }?.state
            if state == .active {
                _ = try AOSOperationResourceClaim.beginExclusiveRelease(
                    registry: registry,
                    binding: claim
                )
            }
            let released = try AOSOperationResourceClaim.finishExclusiveRelease(
                registry: registry,
                binding: claim,
                absenceVerified: true
            )
            guard released.state == .terminal, released.absenceVerified else {
                throw AOSOperationCoreError.recordingCleanupRequired
            }
        }
    }

    private func ownedArtifact(
        _ selector: AOSOperationIdentity,
        ownerRoot: AOSMechanicalOwnerRoot
    ) throws -> AOSArtifactRecord {
        let state = registry.snapshot()
        guard let artifact = state.artifacts.first(where: { $0.identity == selector }),
              let operation = state.operations.first(where: {
                $0.identity == artifact.parentOperation && $0.ownerRoot == ownerRoot
              }) else {
            throw AOSOperationCoreError.operationNotFound
        }
        _ = operation
        return artifact
    }

    private func artifactURL(_ identity: AOSOperationIdentity) -> URL {
        artifactRootURL.appendingPathComponent(
            "\(identity.id)-\(identity.generation).mov",
            isDirectory: false
        )
    }

    private func custodyDigest(_ receipt: AOSArtifactCustodyReceipt) -> String {
        (try? AOSOperationDigest.sha256(domain: .residualSet, receipt)) ?? String(repeating: "0", count: 64)
    }

    private func artifactResult(
        _ action: String,
        record: AOSArtifactRecord,
        path: String?
    ) -> [String: Any] {
        var result: [String: Any] = [
            "schema_version": "aos.artifact.custody-result.v1",
            "action": action,
            "artifact": [
                "artifact_id": record.identity.id,
                "artifact_generation": record.identity.generation,
            ],
            "state": record.state.rawValue,
            "byte_count": record.fileIdentity?.byteCount ?? 0,
            "content_digest": record.fileIdentity?.contentDigest ?? NSNull(),
            "media_type": record.fileIdentity?.mediaType ?? NSNull(),
            "track_summary": record.trackSummary.map(aosScreenRecordingTrackSummaryValue) ?? NSNull(),
        ]
        if let path { result["path"] = path }
        return result
    }

    private func resolveRelease(
        _ release: AOSArtifactReleaseRecord,
        resolution: AOSArtifactReleaseResolution
    ) throws -> AOSArtifactRecord {
        let receipt: AOSArtifactCustodyReceipt?
        let digest: String?
        if resolution == .released {
            let value = AOSArtifactCustodyReceipt(
                action: .release,
                completedAtNanoseconds: registry.now(),
                destinationIdentityDigest: release.destinationIdentity.pathDigest
            )
            receipt = value
            digest = custodyDigest(value)
        } else {
            receipt = nil
            digest = nil
        }
        return try registry.resolveArtifactRelease(
            release.artifact,
            releaseGeneration: release.releaseGeneration,
            resolution: resolution,
            custodyReceipt: receipt,
            custodyDigest: digest
        )
    }

    private func markCleanupRequired(_ operation: AOSOperationIdentity) {
        guard let record = try? registry.inspect(operation),
              ![.cleanupRequired, .recovering, .terminal].contains(record.state) else { return }
        _ = try? registry.transitionOperation(
            operation,
            to: .cleanupRequired,
            residualDigest: residualDigest(operation: operation)
        )
    }
}

private final class AOSScreenRecordingShareableContentCallback:
    @unchecked Sendable
{
    private let completion: (SCShareableContent?, Error?) -> Void

    init(_ completion: @escaping (SCShareableContent?, Error?) -> Void) {
        self.completion = completion
    }

    func resolve(_ content: SCShareableContent?, _ error: Error?) {
        completion(content, error)
    }
}

private final class AOSScreenRecordingStreamOutput: NSObject,
    AOSDesktopPixelStreamLifecycle,
    SCStreamOutput,
    SCStreamDelegate,
    @unchecked Sendable
{
    private let encoder: AOSScreenRecordingEncoding
    private let frameAdmission: AOSDesktopPixelFrameAdmissionGate
    private var failure: Error?
    private let lock = NSLock()
    private let retirement = AOSDesktopPixelRetirementLatch()
    private let startup: AOSDesktopPixelStartupSignal
    private let validateBinding: () throws -> Void
    private let persistProgress: (AOSScreenRecordingEncoderProgress) throws -> Void
    private let didFail: @Sendable (Error) -> Void

    init(
        encoder: AOSScreenRecordingEncoding,
        frameAdmission: AOSDesktopPixelFrameAdmissionGate,
        startup: AOSDesktopPixelStartupSignal,
        validateBinding: @escaping () throws -> Void,
        persistProgress: @escaping (AOSScreenRecordingEncoderProgress) throws -> Void,
        didFail: @escaping @Sendable (Error) -> Void
    ) {
        self.encoder = encoder
        self.frameAdmission = frameAdmission
        self.startup = startup
        self.validateBinding = validateBinding
        self.persistProgress = persistProgress
        self.didFail = didFail
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard let admission = frameAdmission.admit() else { return }
        defer { admission.complete() }
        let track: AOSScreenRecordingTrackKind
        switch outputType {
        case .screen:
            guard CMSampleBufferIsValid(sampleBuffer),
                  CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return }
            track = .video
        case .audio:
            guard CMSampleBufferIsValid(sampleBuffer) else { return }
            track = .systemAudio
        default:
            return
        }
        do {
            if track == .video { try validateBinding() }
            try encoder.append(sampleBuffer, track: track)
            let progress = encoder.progress
            try persistProgress(progress)
            if progress.sessionStarted { startup.succeed() }
        } catch {
            fail(error)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        retirement.observe()
        fail(error)
    }

    func sampleIsReady() throws -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if let failure { throw failure }
        return encoder.progress.sessionStarted
    }

    func admitExplicitStop() -> AOSDesktopPixelStopAdmission { retirement.admitExplicitStop() }
    func confirmRetirement() { retirement.observe() }
    func retirementWasObserved() -> Bool { retirement.snapshot() }
    func waitForRetirement(timeout: TimeInterval) async -> Bool {
        await retirement.wait(timeout: timeout)
    }

    private func fail(_ error: Error) {
        lock.lock()
        guard failure == nil else {
            lock.unlock()
            return
        }
        failure = error
        lock.unlock()
        startup.fail(error)
        didFail(error)
    }
}

private func aosScreenRecordingProgress(
    _ progress: AOSScreenRecordingEncoderProgress,
    applying failure: Error?
) -> AOSScreenRecordingEncoderProgress {
    guard let failure = failure as? AOSOperationCoreError else { return progress }
    let summary = progress.trackSummary
    let videoFailure: String?
    let audioFailure: String?
    let microphoneFailure: String?
    switch failure {
    case .recordingNoFrames:
        videoFailure = failure.code
        audioFailure = summary.systemAudio.selected
                && !summary.systemAudio.firstSamplePresent
            ? AOSOperationCoreError.recordingSystemAudioNoSamples.code : nil
        microphoneFailure = summary.microphone.selected
                && !summary.microphone.firstSamplePresent
            ? AOSOperationCoreError.recordingMicrophoneNoSamples.code : nil
    case .recordingSystemAudioUnavailable,
         .recordingSystemAudioNoSamples,
         .recordingSystemAudioFailed:
        videoFailure = nil
        audioFailure = failure.code
        microphoneFailure = summary.microphone.selected
                && !summary.microphone.firstSamplePresent
            ? AOSOperationCoreError.recordingMicrophoneNoSamples.code : nil
    case .recordingMicrophonePermissionNotDetermined,
         .recordingMicrophonePermissionRestricted,
         .recordingMicrophonePermissionDenied,
         .recordingMicrophonePermissionUnknown,
         .recordingMicrophoneUnavailable,
         .recordingMicrophoneNoSamples,
         .recordingMicrophoneFailed:
        videoFailure = nil
        audioFailure = nil
        microphoneFailure = failure.code
    case .recordingEncoderFailed:
        videoFailure = failure.code
        audioFailure = summary.systemAudio.selected
            ? AOSOperationCoreError.recordingSystemAudioFailed.code : nil
        microphoneFailure = summary.microphone.selected
            ? AOSOperationCoreError.recordingMicrophoneFailed.code : nil
    default:
        return progress
    }
    func truth(
        _ value: AOSScreenRecordingTrackTruth,
        failureCode: String?
    ) -> AOSScreenRecordingTrackTruth {
        AOSScreenRecordingTrackTruth(
            selected: value.selected,
            admitted: value.admitted,
            available: value.available,
            firstSamplePresent: value.firstSamplePresent,
            sampleCount: value.sampleCount,
            sampleByteCount: value.sampleByteCount,
            failureCode: value.failureCode ?? failureCode,
            drained: value.drained,
            finalized: value.finalized
        )
    }
    return AOSScreenRecordingEncoderProgress(
        frameCount: progress.frameCount,
        byteCount: progress.byteCount,
        trackSummary: AOSScreenRecordingTrackSummary(
            selectedTracks: summary.selectedTracks,
            finalizedTracks: summary.finalizedTracks,
            commonMediaEpochNanoseconds: summary.commonMediaEpochNanoseconds,
            video: truth(summary.video, failureCode: videoFailure),
            systemAudio: truth(summary.systemAudio, failureCode: audioFailure),
            microphone: truth(summary.microphone, failureCode: microphoneFailure)
        ),
        sessionStarted: progress.sessionStarted
    )
}

private func aosScreenRecordingSettledFailure(
    _ fallback: Error,
    summary: AOSScreenRecordingTrackSummary
) -> AOSOperationCoreError {
    if let typed = fallback as? AOSOperationCoreError,
       typed == .recordingSystemAudioUnavailable
        || typed == .recordingMicrophoneUnavailable {
        return typed
    }
    if !summary.video.firstSamplePresent {
        return .recordingNoFrames
    }
    if summary.systemAudio.selected,
       !summary.systemAudio.firstSamplePresent {
        return .recordingSystemAudioNoSamples
    }
    if summary.microphone.selected,
       !summary.microphone.firstSamplePresent {
        return .recordingMicrophoneNoSamples
    }
    if let typed = fallback as? AOSOperationCoreError { return typed }
    if fallback as? AOSDesktopPixelStreamLifecycleFailure == .startupDeadlineExceeded {
        return .recordingStartupDeadlineExceeded
    }
    return .recordingEncoderFailed
}

private struct AOSScreenRecordingFailureContext: Error {
    enum Origin {
        case preNativeSetup
        case mediaLifecycle
    }

    let error: Error
    let origin: Origin

    var mayNormalizeFromTrackTruth: Bool { origin == .mediaLifecycle }

    static func preNativeSetup(_ error: Error) -> Self {
        Self(error: error, origin: .preNativeSetup)
    }

    static func mediaLifecycle(_ error: Error) -> Self {
        Self(error: error, origin: .mediaLifecycle)
    }
}

private func aosScreenRecordingTerminalFailure(
    _ failure: AOSScreenRecordingFailureContext?,
    progress: AOSScreenRecordingEncoderProgress
) -> AOSOperationCoreError? {
    guard let failure else { return nil }
    if !failure.mayNormalizeFromTrackTruth {
        return failure.error as? AOSOperationCoreError ?? .recordingEncoderFailed
    }
    if let typed = failure.error as? AOSOperationCoreError {
        switch typed {
        case .recordingStartupDeadlineExceeded,
             .recordingNoFrames,
             .recordingSystemAudioNoSamples,
             .recordingSystemAudioFailed,
             .recordingMicrophoneNoSamples,
             .recordingMicrophoneFailed,
             .recordingTimestampNonMonotonic,
             .recordingBackpressureExceeded,
             .recordingEncoderFailed:
            break
        default:
            return typed
        }
    }
    return aosScreenRecordingSettledFailure(failure.error, summary: progress.trackSummary)
}

final class AOSNativeScreenRecordingRuntime:
    AOSScreenRecordingRuntimeControlling,
    @unchecked Sendable
{
    private weak var adapter: AOSScreenRecordingOperationAdapter?
    private let admission: AOSScreenRecordingClaimAdmission
    private let artifactRootURL: URL
    private let broker: AOSScreenRecordingBrokerControlling
    private var encoder: AOSScreenRecordingEncoding?
    private var discoveryRetirement: AOSDesktopPixelRetirementLatch?
    private let files: AOSScreenRecordingFileDependencies
    private let geometry: AOSScreenRecordingGeometry
    private let frameAdmission = AOSDesktopPixelFrameAdmissionGate()
    private let lock = NSLock()
    private let registry: AOSOperationRegistry
    private let request: AOSScreenRecordingRequest
    private let sessionFactory: AOSScreenRecordingSessionFactory?
    private let microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies
    private let microphoneSessionFactory: AOSScreenRecordingMicrophoneSessionFactory
    private let startupTimeout: TimeInterval
    private var progressTimeline: AOSScreenRecordingProgressTimeline
    private var finishStarted = false
    private var producerLease: AOSDesktopPixelExclusiveProducerLease?
    private let startupCancellation = AOSDesktopPixelStartupCancellation()
    private var startupSettled = false
    private var startupOwner: AOSDesktopPixelStartupOwner?
    private var terminalFailure: AOSScreenRecordingFailureContext?
    private var stopIntent: AOSStopIntent?
    private var stream: SCStream?
    private var microphoneSession: (any AOSMicrophoneNativeSessionControlling)?

    init(
        adapter: AOSScreenRecordingOperationAdapter,
        admission: AOSScreenRecordingClaimAdmission,
        artifactRootURL: URL,
        broker: AOSScreenRecordingBrokerControlling,
        files: AOSScreenRecordingFileDependencies,
        geometry: AOSScreenRecordingGeometry,
        registry: AOSOperationRegistry,
        request: AOSScreenRecordingRequest,
        sessionFactory: AOSScreenRecordingSessionFactory? = nil,
        microphoneAuthorization: AOSScreenRecordingMicrophoneAuthorizationDependencies = .live(),
        microphoneSessionFactory: @escaping AOSScreenRecordingMicrophoneSessionFactory = {
            AOSMicrophoneNativeSession()
        },
        startupTimeout: TimeInterval = aosDesktopPixelStreamRetirementTimeout
    ) {
        self.adapter = adapter
        self.admission = admission
        self.artifactRootURL = artifactRootURL
        self.broker = broker
        self.files = files
        self.geometry = geometry
        self.registry = registry
        self.request = request
        self.sessionFactory = sessionFactory
        self.microphoneAuthorization = microphoneAuthorization
        self.microphoneSessionFactory = microphoneSessionFactory
        self.startupTimeout = startupTimeout
        self.progressTimeline = AOSScreenRecordingProgressTimeline(
            maximumDurationMilliseconds: request.durationMilliseconds
        )
    }

    func start() {
        Task.detached(priority: .userInitiated) { [self] in
            do {
                try await acquireAndStart()
                _ = try registry.transitionStream(admission.publicAdmission.stream, to: .active)
                _ = try registry.transitionOperation(admission.publicAdmission.operation, to: .active)
                if let pendingIntent = settleStartup(failure: nil) {
                    await finish(intent: pendingIntent)
                    return
                }
            } catch {
                let failure = (error as? AOSScreenRecordingFailureContext)
                    ?? .preNativeSetup(error)
                let selectedIntent = settleStartup(failure: failure)
                    ?? (failure.error is AOSOperationCoreError
                        ? .adapterFailed : .permissionRevoked)
                await finish(intent: selectedIntent)
            }
        }
    }

    func stop(intent: AOSStopIntent) {
        stop(intent: intent, failure: nil)
    }

    private func stop(
        intent: AOSStopIntent,
        failure: AOSScreenRecordingFailureContext?
    ) {
        lock.lock()
        _ = frameAdmission.close()
        _ = progressTimeline.admitStop(atNanoseconds: registry.now())
        if terminalFailure == nil { terminalFailure = failure }
        if stopIntent == nil { stopIntent = intent }
        let cancelStartup = !startupSettled
        guard startupSettled, !finishStarted else {
            lock.unlock()
            if cancelStartup { startupCancellation.cancel() }
            return
        }
        finishStarted = true
        let selectedIntent = stopIntent ?? intent
        lock.unlock()
        if cancelStartup { startupCancellation.cancel() }
        Task.detached(priority: .utility) { [self] in
            await finish(intent: selectedIntent)
        }
    }

    func residualDigest() -> String? {
        lock.lock()
        let hasAuthority = producerLease != nil
            || startupOwner != nil
            || stream != nil
            || microphoneSession?.authorityAbsent == false
        lock.unlock()
        guard hasAuthority else { return nil }
        return AOSScreenRecordingEncoder.digest(
            "recording:\(admission.publicAdmission.operation.id):\(admission.publicAdmission.operation.generation)"
        )
    }

    private func settleStartup(
        failure: AOSScreenRecordingFailureContext?
    ) -> AOSStopIntent? {
        lock.lock()
        startupSettled = true
        if terminalFailure == nil { terminalFailure = failure }
        if failure != nil, stopIntent == nil {
            stopIntent = failure?.error is AOSOperationCoreError
                ? .adapterFailed : .permissionRevoked
        }
        guard let selectedIntent = stopIntent, !finishStarted else {
            lock.unlock()
            return nil
        }
        finishStarted = true
        lock.unlock()
        return selectedIntent
    }

    private func acquireAndStart() async throws {
        try requireStartupNotCancelled()
        let lease = try broker.acquireExclusiveProducer(
            ownerID: admission.publicAdmission.operation.id
        )
        installProducerLease(lease)
        try requireStartupNotCancelled()
        try authorizeMicrophoneIfSelected()
        try requireStartupNotCancelled()
        if let sessionFactory {
            let session = try await sessionFactory(
                request.tracks,
                frameAdmission,
                { [weak self] progress in
                    guard let self else {
                        throw AOSOperationCoreError.recordingCleanupRequired
                    }
                    try self.persistProgress(progress)
                },
                { [weak self] error in
                    self?.stop(
                        intent: .adapterFailed,
                        failure: .mediaLifecycle(error)
                    )
                }
            )
            installEncoder(session.encoder)
            try await startSession(session)
            return
        }
        try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
            geometry,
            observedTopology: observeDisplayTopologySnapshot(),
            windowFacts: observeCaptureWindowFacts()
        )
        try createArtifactRoot()
        let outputURL = artifactRootURL.appendingPathComponent(
            "\(admission.publicAdmission.artifact.id)-\(admission.publicAdmission.artifact.generation).mov"
        )
        let encoder = try AOSScreenRecordingEncoder(
            outputURL: outputURL,
            rootURL: artifactRootURL,
            geometry: geometry,
            maximumOutputBytes: request.maximumOutputBytes,
            maximumPendingSamplesPerTrack: Int(request.maximumQueueFrames),
            systemAudioSelected: request.tracks.systemAudio,
            microphoneSelected: request.tracks.microphone
        )
        installEncoder(encoder)
        try requireStartupNotCancelled()
        let content = try await shareableContent()
        try requireStartupNotCancelled()
        let current = observeDisplayTopologySnapshot()
        try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
            geometry,
            observedTopology: current,
            windowFacts: geometry.target.kind == .window ? observeCaptureWindowFacts() : []
        )
        guard let selectedDisplay = current.displays.first(where: {
            $0.ordinal == geometry.target.displayOrdinal
                && $0.memberIdentity == geometry.target.displayMemberIdentity
        }), let nativeDisplay = content.displays.first(where: {
            $0.displayID == selectedDisplay.runtimeDisplayID
        }) else {
            throw AOSOperationCoreError.recordingTargetDrift
        }
        let filter: SCContentFilter
        if geometry.target.kind == .window {
            guard let windowID = geometry.target.windowID,
                  let nativeWindow = content.windows.first(where: {
                    Int($0.windowID) == windowID
                        && $0.owningApplication?.processID == geometry.target.ownerPID
                  }) else {
                throw AOSOperationCoreError.recordingTargetDrift
            }
            filter = SCContentFilter(desktopIndependentWindow: nativeWindow)
        } else {
            filter = SCContentFilter(
                display: nativeDisplay,
                excludingApplications: [],
                exceptingWindows: []
            )
        }
        let configuration = SCStreamConfiguration()
        configuration.width = geometry.pixelWidth
        configuration.height = geometry.pixelHeight
        configuration.minimumFrameInterval = CMTime(
            value: 1,
            timescale: CMTimeScale(request.frameRate)
        )
        configuration.queueDepth = Int(request.maximumQueueFrames)
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.capturesAudio = request.tracks.systemAudio
        if request.tracks.systemAudio {
            configuration.sampleRate = 48_000
            configuration.channelCount = 2
        }
        configuration.showsCursor = true
        if geometry.target.kind == .region {
            configuration.sourceRect = CGRect(
                x: geometry.sourceRect.x - selectedDisplay.nativeBounds.x,
                y: geometry.sourceRect.y - selectedDisplay.nativeBounds.y,
                width: geometry.sourceRect.width,
                height: geometry.sourceRect.height
            )
        }
        let startup = AOSDesktopPixelStartupSignal()
        let output = AOSScreenRecordingStreamOutput(
            encoder: encoder,
            frameAdmission: frameAdmission,
            startup: startup,
            validateBinding: { [geometry] in
                try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
                    geometry,
                    observedTopology: observeDisplayTopologySnapshot(),
                    windowFacts: geometry.target.kind == .window ? observeCaptureWindowFacts() : []
                )
            },
            persistProgress: { [weak self] progress in
                guard let self else {
                    throw AOSOperationCoreError.recordingCleanupRequired
                }
                try self.persistProgress(progress)
            },
            didFail: { [weak self] error in
                self?.stop(
                    intent: .adapterFailed,
                    failure: .mediaLifecycle(error)
                )
            }
        )
        let microphoneSession = request.tracks.microphone
            ? microphoneSessionFactory() : nil
        let microphoneInput = microphoneSession.map {
            AOSScreenRecordingMicrophoneInput(
                session: $0,
                encoder: encoder,
                frameAdmission: frameAdmission,
                startup: startup,
                persistProgress: { [weak self] progress in
                    guard let self else {
                        throw AOSOperationCoreError.recordingCleanupRequired
                    }
                    try self.persistProgress(progress)
                },
                didFail: { [weak self] error in
                    self?.stop(
                        intent: .adapterFailed,
                        failure: .mediaLifecycle(error)
                    )
                }
            )
        }
        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        let videoQueue = DispatchQueue(label: "com.aos.screen-recording.video")
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: videoQueue)
        try encoder.markAvailable(.video)
        if request.tracks.systemAudio {
            let audioQueue = DispatchQueue(label: "com.aos.screen-recording.system-audio")
            do {
                try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: audioQueue)
                try encoder.markAvailable(.systemAudio)
            } catch {
                throw AOSOperationCoreError.recordingSystemAudioUnavailable
            }
        }
        installStream(stream)
        try await startSession(AOSScreenRecordingNativeSession(
            encoder: encoder,
            lifecycle: output,
            signal: startup,
            start: { completion in
                do {
                    try microphoneInput?.start()
                } catch {
                    completion(.failure(error))
                    return
                }
                stream.startCapture { error in
                    if error != nil { _ = microphoneInput?.stop() }
                    completion(error.map(Result.failure) ?? .success(()))
                }
            },
            stop: { completion in
                let microphoneAbsent = microphoneInput?.stop() ?? true
                stream.stopCapture { error in
                    if let error {
                        completion(.failure(error))
                    } else if !microphoneAbsent {
                        completion(.failure(AOSOperationCoreError.recordingCleanupRequired))
                    } else {
                        completion(.success(()))
                    }
                }
            },
            microphoneSession: microphoneSession
        ))
    }

    private func startSession(_ session: AOSScreenRecordingNativeSession) async throws {
        installMicrophoneSession(session.microphoneSession)
        let startedAt = DispatchTime.now().uptimeNanoseconds
        let budgetNanoseconds = UInt64(startupTimeout * 1_000_000_000)
        let deadline = startedAt.addingReportingOverflow(budgetNanoseconds)
        guard !deadline.overflow else {
            throw AOSOperationCoreError.recordingEncoderFailed
        }
        let owner: AOSDesktopPixelStartupOwner
        do {
            owner = try await aosStartDesktopPixelStreams(
                signals: [session.signal],
                lifecycles: [session.lifecycle],
                settlementTimeout: try remainingStartupTime(until: deadline.partialValue),
                ownerGeneration: admission.publicAdmission.operation.generation,
                ownerReady: { [weak self] owner in
                    self?.installStartupOwner(owner)
                },
                cancellation: startupCancellation,
                lateFailure: { [weak self] error in
                    self?.stop(
                        intent: .adapterFailed,
                        failure: .mediaLifecycle(error)
                    )
                },
                start: { [weak self] _, completion in
                    self?.admitCaptureStartAndScheduleDeadline()
                    session.start(completion)
                },
                stop: { _, completion in session.stop(completion) }
            )
        } catch {
            throw AOSScreenRecordingFailureContext.mediaLifecycle(error)
        }
        installStartupOwner(owner)
        if request.tracks.systemAudio || request.tracks.microphone {
            while !session.encoder.progress.sessionStarted {
                try requireStartupNotCancelled()
                let remaining: TimeInterval
                do {
                    remaining = try remainingStartupTime(until: deadline.partialValue)
                } catch {
                    throw AOSScreenRecordingFailureContext.mediaLifecycle(error)
                }
                try await Task.sleep(
                    nanoseconds: min(1_000_000, UInt64(remaining * 1_000_000_000))
                )
            }
        }
        try requireStartupNotCancelled()
    }

    private func remainingStartupTime(until deadline: UInt64) throws -> TimeInterval {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < deadline else {
            throw AOSDesktopPixelStreamLifecycleFailure.startupDeadlineExceeded
        }
        return TimeInterval(deadline - now) / 1_000_000_000
    }

    private func authorizeMicrophoneIfSelected() throws {
        guard request.tracks.microphone else { return }
        var state = microphoneAuthorization.status()
        if state == .notDetermined {
            state = microphoneAuthorization.request(min(30, startupTimeout)).after
        }
        switch state {
        case .authorized:
            return
        case .notDetermined:
            throw AOSOperationCoreError.recordingMicrophonePermissionNotDetermined
        case .restricted:
            throw AOSOperationCoreError.recordingMicrophonePermissionRestricted
        case .denied:
            throw AOSOperationCoreError.recordingMicrophonePermissionDenied
        case .unknown:
            throw AOSOperationCoreError.recordingMicrophonePermissionUnknown
        }
    }

    private func finish(intent: AOSStopIntent) async {
        admitStopIfNeeded()
        let resources = runtimeResources()
        let owner = resources.owner
        let encoder = resources.encoder
        let lease = resources.lease
        let discoveryRetirement = resources.discoveryRetirement
        let retired: Bool
        if let owner {
            retired = await owner.retire(timeout: aosDesktopPixelStreamRetirementTimeout)
        } else {
            retired = true
        }
        let discoveryRetired = if let discoveryRetirement {
            await discoveryRetirement.wait(
                timeout: aosDesktopPixelStreamRetirementTimeout
            )
        } else {
            true
        }
        let microphoneAbsent = resources.microphoneSession?.authorityAbsent ?? true
        guard retired, discoveryRetired, microphoneAbsent else {
            adapter?.runtimeRetirementRemainsUncertain(
                admission.publicAdmission.operation
            )
            retainUntilAuthoritativeRetirement(intent: intent)
            return
        }
        guard await frameAdmission.waitForDrain(
            timeout: aosDesktopPixelStreamRetirementTimeout
        ) else {
            adapter?.runtimeRetirementRemainsUncertain(
                admission.publicAdmission.operation
            )
            retainUntilAuthoritativeRetirement(intent: intent)
            return
        }
        await finishAfterAuthoritativeRetirement(
            intent: intent,
            encoder: encoder,
            lease: lease
        )
    }

    private func finishAfterAuthoritativeRetirement(
        intent: AOSStopIntent,
        encoder: AOSScreenRecordingEncoding?,
        lease: AOSDesktopPixelExclusiveProducerLease?
    ) async {
        var artifact: AOSArtifactFileIdentity?
        var failureContext = terminalFailureSnapshot()
        if let encoder {
            if failureContext != nil {
                encoder.cancel()
            } else {
                do {
                    guard encoder.progress.trackSummary.video.firstSamplePresent else {
                        throw AOSOperationCoreError.recordingNoFrames
                    }
                    let finalized: AOSArtifactFileIdentity = try await withCheckedThrowingContinuation { continuation in
                        encoder.finish { continuation.resume(with: $0) }
                    }
                    try AOSScreenRecordingTerminalTruth.requireFrames(
                        encoder.progress.frameCount
                    )
                    try AOSScreenRecordingTerminalTruth.requireFinalizedArtifact(
                        frameCount: encoder.progress.frameCount,
                        artifact: finalized,
                        filePresent: files.exists(artifactURL()),
                        expectedSummary: encoder.progress.trackSummary
                    )
                    artifact = finalized
                } catch {
                    let artifactURL = self.artifactURL()
                    switch error as? AOSOperationCoreError {
                    case .recordingNoFrames,
                         .recordingSystemAudioUnavailable,
                         .recordingSystemAudioNoSamples,
                         .recordingSystemAudioFailed,
                         .recordingMicrophonePermissionNotDetermined,
                         .recordingMicrophonePermissionRestricted,
                         .recordingMicrophonePermissionDenied,
                         .recordingMicrophonePermissionUnknown,
                         .recordingMicrophoneUnavailable,
                         .recordingMicrophoneNoSamples,
                         .recordingMicrophoneFailed:
                        failureContext = .mediaLifecycle(error)
                    default:
                        failureContext = .mediaLifecycle(
                            files.exists(artifactURL)
                                ? error : AOSOperationCoreError.recordingArtifactMissing
                        )
                    }
                    encoder.cancel()
                }
            }
        } else if failureContext == nil {
            failureContext = .mediaLifecycle(AOSOperationCoreError.recordingNoFrames)
        }
        let leaseReleased = lease.map(broker.releaseExclusiveProducer) ?? true
        guard leaseReleased else {
            adapter?.runtimeRetirementRemainsUncertain(
                admission.publicAdmission.operation
            )
            return
        }
        let rawProgress = encoder?.progress ?? AOSScreenRecordingEncoderProgress(
            frameCount: 0,
            byteCount: 0,
            trackSummary: .initial(
                systemAudioSelected: request.tracks.systemAudio,
                microphoneSelected: request.tracks.microphone
            ),
            sessionStarted: false
        )
        let failure = aosScreenRecordingTerminalFailure(
            failureContext,
            progress: rawProgress
        )
        let progress = aosScreenRecordingProgress(rawProgress, applying: failure)
        let elapsedMilliseconds = admittedElapsedMilliseconds()
        adapter?.runtimeDidFinish(
            admission,
            intent: intent,
            artifactIdentity: artifact,
            progress: progress,
            elapsedMilliseconds: elapsedMilliseconds,
            requestedBounds: request.requestedBounds,
            authorityAbsent: true,
            failure: failure
        )
    }

    private func terminalFailureSnapshot() -> AOSScreenRecordingFailureContext? {
        lock.lock()
        defer { lock.unlock() }
        return terminalFailure
    }

    private func retainUntilAuthoritativeRetirement(intent: AOSStopIntent) {
        Task.detached(priority: .utility) { [self] in
            while true {
                let resources = runtimeResources()
                let retired = if let owner = resources.owner {
                    await owner.retire(timeout: aosDesktopPixelStreamRetirementTimeout)
                } else {
                    true
                }
                let discoveryRetired = if let discovery = resources.discoveryRetirement {
                    await discovery.wait(
                        timeout: aosDesktopPixelStreamRetirementTimeout
                    )
                } else {
                    true
                }
                _ = resources.microphoneSession?.stop()
                let microphoneAbsent = resources.microphoneSession?.authorityAbsent ?? true
                guard retired, discoveryRetired, microphoneAbsent,
                      await frameAdmission.waitForDrain(
                        timeout: aosDesktopPixelStreamRetirementTimeout
                      ) else { continue }
                await finishAfterAuthoritativeRetirement(
                    intent: intent,
                    encoder: resources.encoder,
                    lease: resources.lease
                )
                return
            }
        }
    }

    private func admitCaptureStartAndScheduleDeadline() {
        lock.lock()
        let admitted = progressTimeline.admitCaptureStart(atNanoseconds: registry.now())
        lock.unlock()
        guard admitted else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(
            deadline: .now() + .milliseconds(Int(request.durationMilliseconds))
        ) { [weak self] in
            self?.stop(intent: .complete)
        }
    }

    private func admitStopIfNeeded() {
        lock.lock()
        _ = frameAdmission.close()
        _ = progressTimeline.admitStop(atNanoseconds: registry.now())
        lock.unlock()
    }

    private func admittedElapsedMilliseconds() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return progressTimeline.elapsedMilliseconds(atNanoseconds: registry.now())
    }

    private func persistProgress(_ progress: AOSScreenRecordingEncoderProgress) throws {
        let elapsed = admittedElapsedMilliseconds()
        let durableProgress = try aosPersistScreenRecordingProgress(
            frameCount: progress.frameCount,
            byteCount: progress.byteCount,
            elapsedMilliseconds: elapsed,
            bounds: request.requestedBounds,
            trackSummary: progress.trackSummary
        ) { _ in }
        _ = try registry.updateOperationProgress(
            admission.publicAdmission.operation,
            durableProgress
        )
    }

    private func installProducerLease(_ lease: AOSDesktopPixelExclusiveProducerLease) {
        lock.lock()
        producerLease = lease
        lock.unlock()
    }

    private func installEncoder(_ encoder: AOSScreenRecordingEncoding) {
        lock.lock()
        self.encoder = encoder
        lock.unlock()
    }

    private func installStream(_ stream: SCStream) {
        lock.lock()
        self.stream = stream
        lock.unlock()
    }

    private func installMicrophoneSession(
        _ session: (any AOSMicrophoneNativeSessionControlling)?
    ) {
        lock.lock()
        microphoneSession = session
        lock.unlock()
    }

    private func installStartupOwner(_ owner: AOSDesktopPixelStartupOwner) {
        lock.lock()
        if startupOwner == nil { startupOwner = owner }
        lock.unlock()
    }

    private func artifactURL() -> URL {
        artifactRootURL.appendingPathComponent(
            "\(admission.publicAdmission.artifact.id)-\(admission.publicAdmission.artifact.generation).mov"
        )
    }

    private func runtimeResources() -> (
        owner: AOSDesktopPixelStartupOwner?,
        encoder: AOSScreenRecordingEncoding?,
        lease: AOSDesktopPixelExclusiveProducerLease?,
        discoveryRetirement: AOSDesktopPixelRetirementLatch?,
        microphoneSession: (any AOSMicrophoneNativeSessionControlling)?
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (
            startupOwner,
            encoder,
            producerLease,
            discoveryRetirement,
            microphoneSession
        )
    }

    private func createArtifactRoot() throws {
        if mkdir(artifactRootURL.path, mode_t(0o700)) != 0, errno != EEXIST {
            throw AOSOperationCoreError.storeUnavailable
        }
        var metadata = stat()
        guard lstat(artifactRootURL.path, &metadata) == 0,
              (metadata.st_mode & S_IFMT) == S_IFDIR,
              (metadata.st_mode & mode_t(0o777)) == mode_t(0o700),
              metadata.st_uid == geteuid() else {
            throw AOSOperationCoreError.storeCorrupt
        }
    }

    private func shareableContent() async throws -> SCShareableContent {
        try await withCheckedThrowingContinuation { continuation in
            let token = AOSDesktopPixelRetainedCallbackToken<SCShareableContent>()
            let retirement = AOSDesktopPixelRetirementLatch()
            lock.lock()
            discoveryRetirement = retirement
            lock.unlock()
            token.start(
                deadline: aosDesktopPixelStreamRetirementTimeout,
                nativeStart: { completion in
                    let callback = AOSScreenRecordingShareableContentCallback(
                        completion
                    )
                    SCShareableContent.getExcludingDesktopWindows(
                        false,
                        onScreenWindowsOnly: true,
                        completionHandler: { content, error in
                            callback.resolve(content, error)
                        }
                    )
                },
                authoritativeSettlement: {
                    retirement.observe()
                },
                completion: { result in
                    continuation.resume(with: result)
                }
            )
        }
    }

    private func requireStartupNotCancelled() throws {
        if startupCancellation.isCancelled {
            throw CancellationError()
        }
    }
}
