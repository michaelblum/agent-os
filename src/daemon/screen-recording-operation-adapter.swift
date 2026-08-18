import CoreMedia
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
}

private struct AOSScreenRecordingClaimAdmission {
    let publicAdmission: AOSScreenRecordingAdmission
    let claim: AOSResourceClaimBinding
}

private protocol AOSScreenRecordingRuntimeControlling: AnyObject {
    func stop(intent: AOSStopIntent)
    func residualDigest() -> String?
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
    private let broker: AOSDesktopPixelBroker
    private let contextResolver: ContextResolver
    private let lock = NSLock()
    private let reconcileHostBarrier: () -> Void
    private let registry: AOSOperationRegistry
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
        broker: AOSDesktopPixelBroker,
        artifactRootURL: URL,
        contextResolver: @escaping ContextResolver,
        reconcileHostBarrier: @escaping () -> Void = {}
    ) throws {
        guard registration == (try Self.makeRegistration()) else {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        self.registry = registry
        self.registration = registration
        self.broker = broker
        self.artifactRootURL = artifactRootURL
        self.contextResolver = contextResolver
        self.reconcileHostBarrier = reconcileHostBarrier
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
            geometry: geometry,
            registry: registry,
            request: request
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
            $0.operation == operation && $0.resourceKey == Self.resourceKey && $0.state != .terminal
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
        guard try AOSScreenRecordingEncoder.validateArtifact(
            url,
            rootURL: artifactRootURL,
            maximumOutputBytes: expected.byteCount
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
        guard try AOSScreenRecordingEncoder.validateArtifact(
            url,
            rootURL: artifactRootURL,
            maximumOutputBytes: expected.byteCount
        ) == expected else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        _ = try registry.updateArtifact(selector, state: .removing, pendingAction: .remove)
        guard unlink(url.path) == 0 || errno == ENOENT,
              !FileManager.default.fileExists(atPath: url.path) else {
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
        let record = try ownedArtifact(selector, ownerRoot: ownerRoot)
        guard record.state == .offered, let expected = record.fileIdentity,
              destinationPath.hasPrefix("/"), !destinationPath.isEmpty else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
        }
        let source = artifactURL(selector)
        guard try AOSScreenRecordingEncoder.validateArtifact(
            source,
            rootURL: artifactRootURL,
            maximumOutputBytes: expected.byteCount
        ) == expected else {
            throw AOSOperationCoreError.artifactIdentityMismatch
        }
        let destination = URL(fileURLWithPath: destinationPath).standardizedFileURL
        guard destination.path == destinationPath,
              destination.lastPathComponent != ".",
              destination.lastPathComponent != ".." else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
        }
        var parentStat = stat()
        var sourceStat = stat()
        guard lstat(destination.deletingLastPathComponent().path, &parentStat) == 0,
              (parentStat.st_mode & S_IFMT) == S_IFDIR,
              parentStat.st_uid == geteuid(),
              lstat(source.path, &sourceStat) == 0,
              parentStat.st_dev == sourceStat.st_dev else {
            throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
        }
        let destinationDigest = AOSScreenRecordingEncoder.digest("destination:\(destination.path)")
        _ = try registry.updateArtifact(
            selector,
            state: .offered,
            pendingAction: .release,
            pendingDestinationIdentityDigest: destinationDigest
        )
        guard link(source.path, destination.path) == 0 else {
            let failure = errno
            _ = try? registry.updateArtifact(selector, state: .offered)
            if failure == EEXIST { throw AOSOperationCoreError.artifactDestinationExists }
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        guard unlink(source.path) == 0 else {
            let rollbackSucceeded = unlink(destination.path) == 0
            if !rollbackSucceeded {
                _ = try? registry.updateArtifact(selector, state: .cleanupRequired)
            }
            throw AOSOperationCoreError.recordingCleanupRequired
        }
        let receipt = AOSArtifactCustodyReceipt(
            action: .release,
            completedAtNanoseconds: registry.now(),
            destinationIdentityDigest: destinationDigest
        )
        let released = try registry.updateArtifact(
            selector,
            state: .released,
            custodyReceipt: receipt,
            custodyDigest: custodyDigest(receipt)
        )
        return artifactResult("release", record: released, path: destination.path)
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
            _ = try? registry.updateOperationProgress(
                publicAdmission.operation,
                AOSOperationProgress(
                    frameCount: progress.frameCount,
                    byteCount: progress.byteCount,
                    elapsedMilliseconds: elapsedMilliseconds,
                    droppedFrameCount: 0
                )
            )
            if let artifactIdentity {
                _ = try registry.updateArtifact(
                    publicAdmission.artifact,
                    state: .offered,
                    fileIdentity: artifactIdentity,
                    custodyDigest: artifactIdentity.contentDigest
                )
            } else {
                _ = try? registry.updateArtifact(
                    publicAdmission.artifact,
                    state: .removing,
                    pendingAction: .remove
                )
                let artifactURL = self.artifactURL(publicAdmission.artifact)
                let absent = unlink(artifactURL.path) == 0 || errno == ENOENT
                guard absent && !FileManager.default.fileExists(atPath: artifactURL.path) else {
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
            try releaseClaim(admission.claim, authorityAbsent: authorityAbsent)
            let operation = try registry.inspect(publicAdmission.operation)
            if operation.state == .starting || operation.state == .active {
                _ = try registry.transitionOperation(
                    publicAdmission.operation,
                    to: .stopping,
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
                outcome: outcome
            )
        } catch {
            markCleanupRequired(admission.publicAdmission.operation)
        }
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
              let declaration = initial.adapterRegistry.declaration(resourceKey: Self.resourceKey) else {
            throw AOSOperationCoreError.barrierClosed
        }
        let operation = try registry.prepareOperation(
            ownerRoot: context.ownerRoot,
            attribution: context.attribution,
            capabilityID: Self.capabilityID,
            adapterRegistrationID: registration.id,
            adapterRegistrationRevision: registration.revision,
            requestedBounds: request.requestedBounds
        )
        do {
            let stream = try registry.prepareStream(parent: operation.identity)
            let artifact = try registry.prepareArtifact(parent: operation.identity)
            let generation = initial.resourceClaims
                .filter { $0.resourceKey == Self.resourceKey }
                .map(\.resourceGeneration).max() ?? 0
            let transaction = try AOSOperationResourceTransaction.prepare(
                registry: registry,
                operation: operation.identity,
                expectedBarrierGeneration: initial.barrier.generation,
                expectedAdapterRegistry: initial.adapterRegistry,
                requests: [AOSResourceClaimRequest(
                    adapterRegistrationID: registration.id,
                    adapterRegistrationRevision: registration.revision,
                    resourceKey: Self.resourceKey,
                    admissionMode: .exclusive,
                    resourceDeclarationDigest: declaration.declarationDigest,
                    expectedResourceGeneration: generation,
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
            let receipt = try AOSOperationResourceTransaction.commit(
                registry: registry,
                transactionID: transaction.transactionID
            )
            _ = try AOSOperationResourceTransaction.completeHandoff(
                registry: registry,
                transactionID: transaction.transactionID
            )
            guard let claimID = receipt.claims.first,
                  receipt.claims.count == 1,
                  let claim = registry.snapshot().resourceClaims.first(where: {
                    $0.claimID == claimID && $0.state == .active
                  }) else {
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
                claim: AOSResourceClaimBinding(
                    claimID: claim.claimID,
                    operation: claim.operation,
                    resourceKey: claim.resourceKey,
                    resourceGeneration: claim.resourceGeneration
                )
            )
        } catch {
            markCleanupRequired(operation.identity)
            throw error
        }
    }

    private func releaseClaim(
        _ claim: AOSResourceClaimBinding,
        authorityAbsent: Bool
    ) throws {
        let state = registry.snapshot().resourceClaims.first { $0.claimID == claim.claimID }?.state
        if state == .active {
            _ = try AOSOperationResourceClaim.beginExclusiveRelease(
                registry: registry,
                binding: claim
            )
        }
        let released = try AOSOperationResourceClaim.finishExclusiveRelease(
            registry: registry,
            binding: claim,
            absenceVerified: authorityAbsent
        )
        guard released.state == .terminal, released.absenceVerified else {
            throw AOSOperationCoreError.recordingCleanupRequired
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
        ]
        if let path { result["path"] = path }
        return result
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

private final class AOSScreenRecordingStreamOutput: NSObject,
    AOSDesktopPixelStreamLifecycle,
    SCStreamOutput,
    SCStreamDelegate,
    @unchecked Sendable
{
    private let encoder: AOSScreenRecordingEncoding
    private var failure: Error?
    private var firstFrame = false
    private let lock = NSLock()
    private let retirement = AOSDesktopPixelRetirementLatch()
    private let startup: AOSDesktopPixelStartupSignal
    private let validateBinding: () throws -> Void
    private let didFail: @Sendable (Error) -> Void

    init(
        encoder: AOSScreenRecordingEncoding,
        startup: AOSDesktopPixelStartupSignal,
        validateBinding: @escaping () throws -> Void,
        didFail: @escaping @Sendable (Error) -> Void
    ) {
        self.encoder = encoder
        self.startup = startup
        self.validateBinding = validateBinding
        self.didFail = didFail
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              CMSampleBufferIsValid(sampleBuffer),
              CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return }
        do {
            try validateBinding()
            try encoder.append(sampleBuffer)
            lock.lock()
            let publishStartup = !firstFrame
            firstFrame = true
            lock.unlock()
            if publishStartup { startup.succeed() }
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
        return firstFrame
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

private final class AOSNativeScreenRecordingRuntime:
    AOSScreenRecordingRuntimeControlling,
    @unchecked Sendable
{
    private weak var adapter: AOSScreenRecordingOperationAdapter?
    private let admission: AOSScreenRecordingClaimAdmission
    private let artifactRootURL: URL
    private let broker: AOSDesktopPixelBroker
    private var encoder: AOSScreenRecordingEncoding?
    private let geometry: AOSScreenRecordingGeometry
    private let lock = NSLock()
    private let registry: AOSOperationRegistry
    private let request: AOSScreenRecordingRequest
    private let startedAtNanoseconds: UInt64
    private var finishStarted = false
    private var producerLease: AOSDesktopPixelExclusiveProducerLease?
    private var startupSettled = false
    private var startupOwner: AOSDesktopPixelStartupOwner?
    private var stopIntent: AOSStopIntent?
    private var stream: SCStream?

    init(
        adapter: AOSScreenRecordingOperationAdapter,
        admission: AOSScreenRecordingClaimAdmission,
        artifactRootURL: URL,
        broker: AOSDesktopPixelBroker,
        geometry: AOSScreenRecordingGeometry,
        registry: AOSOperationRegistry,
        request: AOSScreenRecordingRequest
    ) {
        self.adapter = adapter
        self.admission = admission
        self.artifactRootURL = artifactRootURL
        self.broker = broker
        self.geometry = geometry
        self.registry = registry
        self.request = request
        self.startedAtNanoseconds = registry.now()
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
                DispatchQueue.global(qos: .utility).asyncAfter(
                    deadline: .now() + .milliseconds(Int(request.durationMilliseconds))
                ) { [weak self] in self?.stop(intent: .complete) }
            } catch {
                let selectedIntent = settleStartup(failure: error)
                    ?? (error is AOSOperationCoreError ? .adapterFailed : .permissionRevoked)
                await finish(intent: selectedIntent)
            }
        }
    }

    func stop(intent: AOSStopIntent) {
        lock.lock()
        if stopIntent == nil { stopIntent = intent }
        guard startupSettled, !finishStarted else {
            lock.unlock()
            return
        }
        finishStarted = true
        let selectedIntent = stopIntent ?? intent
        lock.unlock()
        Task.detached(priority: .utility) { [self] in
            await finish(intent: selectedIntent)
        }
    }

    func residualDigest() -> String? {
        lock.lock()
        let hasAuthority = producerLease != nil || startupOwner != nil || stream != nil
        lock.unlock()
        guard hasAuthority else { return nil }
        return AOSScreenRecordingEncoder.digest(
            "recording:\(admission.publicAdmission.operation.id):\(admission.publicAdmission.operation.generation)"
        )
    }

    private func settleStartup(failure: Error?) -> AOSStopIntent? {
        lock.lock()
        startupSettled = true
        if failure != nil, stopIntent == nil {
            stopIntent = failure is AOSOperationCoreError ? .adapterFailed : .permissionRevoked
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
        let lease = try broker.acquireExclusiveProducer(
            ownerID: admission.publicAdmission.operation.id
        )
        installProducerLease(lease)
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
            maximumOutputBytes: request.maximumOutputBytes
        )
        installEncoder(encoder)
        let content = try await shareableContent()
        let current = observeDisplayTopologySnapshot()
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
        configuration.capturesAudio = false
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
            startup: startup,
            validateBinding: { [geometry] in
                try AOSScreenRecordingGeometryValidator.validateCurrentBinding(
                    geometry,
                    observedTopology: observeDisplayTopologySnapshot(),
                    windowFacts: geometry.target.kind == .window ? observeCaptureWindowFacts() : []
                )
            },
            didFail: { [weak self] _ in self?.stop(intent: .adapterFailed) }
        )
        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        let queue = DispatchQueue(label: "com.aos.screen-recording.sample")
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
        installStream(stream)
        let owner = try await aosStartDesktopPixelStreams(
            signals: [startup],
            lifecycles: [output],
            settlementTimeout: aosDesktopPixelStreamRetirementTimeout,
            lateFailure: { [weak self] _ in self?.stop(intent: .adapterFailed) },
            start: { _, completion in
                stream.startCapture { error in
                    completion(error.map(Result.failure) ?? .success(()))
                }
            },
            stop: { _, completion in
                stream.stopCapture { error in
                    completion(error.map(Result.failure) ?? .success(()))
                }
            }
        )
        installStartupOwner(owner)
    }

    private func finish(intent: AOSStopIntent) async {
        let resources = runtimeResources()
        let owner = resources.owner
        let encoder = resources.encoder
        let lease = resources.lease
        let retired: Bool
        if let owner {
            retired = await owner.retire(timeout: aosDesktopPixelStreamRetirementTimeout)
        } else {
            retired = true
        }
        var artifact: AOSArtifactFileIdentity?
        var failure: Error?
        if retired, let encoder, encoder.progress.frameCount > 0 {
            do {
                artifact = try await withCheckedThrowingContinuation { continuation in
                    encoder.finish { continuation.resume(with: $0) }
                }
            } catch {
                failure = error
                encoder.cancel()
            }
        } else {
            encoder?.cancel()
            if !retired { failure = AOSOperationCoreError.recordingCleanupRequired }
        }
        let leaseReleased = lease.map(broker.releaseExclusiveProducer) ?? true
        if !leaseReleased { failure = AOSOperationCoreError.recordingCleanupRequired }
        let progress = encoder?.progress ?? AOSScreenRecordingEncoderProgress(
            frameCount: 0,
            byteCount: 0
        )
        let finishedAtNanoseconds = registry.now()
        let elapsedMilliseconds = finishedAtNanoseconds >= startedAtNanoseconds
            ? (finishedAtNanoseconds - startedAtNanoseconds) / 1_000_000
            : 0
        adapter?.runtimeDidFinish(
            admission,
            intent: intent,
            artifactIdentity: artifact,
            progress: progress,
            elapsedMilliseconds: elapsedMilliseconds,
            authorityAbsent: retired && leaseReleased,
            failure: failure
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

    private func installStartupOwner(_ owner: AOSDesktopPixelStartupOwner) {
        lock.lock()
        startupOwner = owner
        lock.unlock()
    }

    private func runtimeResources() -> (
        owner: AOSDesktopPixelStartupOwner?,
        encoder: AOSScreenRecordingEncoding?,
        lease: AOSDesktopPixelExclusiveProducerLease?
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (startupOwner, encoder, producerLease)
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
            SCShareableContent.getExcludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            ) { content, error in
                if let content { continuation.resume(returning: content) }
                else { continuation.resume(throwing: error ?? AOSOperationCoreError.recordingTargetDrift) }
            }
        }
    }
}
