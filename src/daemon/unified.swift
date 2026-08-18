// unified.swift — UnifiedDaemon: single socket hosting perception + display

import AppKit
import CryptoKit
import Darwin
import Foundation

private let inputSafetyLogCanvasID = "__log__"
private let inputSafetyLogConsoleURL = "aos://toolkit/components/log-console/index.html"
private var aosNativeCursorSuppressionSignalActive: Int32 = 0

private struct AOSInputRegionAdmissionFailure: Error {
    let code: String
    let message: String
}

private func aosSetNativeCursorSuppressionSignalActive(_ active: Bool) {
    aosNativeCursorSuppressionSignalActive = active ? 1 : 0
}

private func aosRestoreNativeCursorSuppressionForSignalExit() {
    if aosNativeCursorSuppressionSignalActive != 0 {
        CGDisplayShowCursor(CGMainDisplayID())
        aosNativeCursorSuppressionSignalActive = 0
    }
}

private final class DaemonInputSafetyVisualFeedbackRuntime: InputSafetyVisualFeedbackRuntime {
    private let canvasManager: CanvasManager

    init(canvasManager: CanvasManager) {
        self.canvasManager = canvasManager
    }

    func logConsoleExists() -> Bool {
        canvasManager.hasCanvas(inputSafetyLogCanvasID)
    }

    func createLogConsole() -> Bool {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        let width: CGFloat = 450
        let height: CGFloat = 300
        var request = CanvasRequest(
            action: "create",
            id: inputSafetyLogCanvasID,
            at: [20, mainBounds.height - height - 20, width, height],
            url: inputSafetyLogConsoleURL,
            interactive: false,
            focus: false,
            scope: "global",
            owner: CanvasOwnerInfo(
                consumerID: "daemon.input-safety",
                harness: "daemon",
                pid: Int(getpid()),
                cwd: FileManager.default.currentDirectoryPath,
                worktreeRoot: aosRepoRootFromBases([FileManager.default.currentDirectoryPath]),
                runtimeMode: aosCurrentRuntimeMode().rawValue
            )
        )
        request.windowLevel = "floating"
        let response = canvasManager.handle(request)
        return response.status == "success"
    }

    func resumeLogConsole() {
        let request = CanvasRequest(action: "resume", id: inputSafetyLogCanvasID)
        _ = canvasManager.handle(request)
    }

    func bringLogConsoleForward() {
        let request = CanvasRequest(action: "to-front", id: inputSafetyLogCanvasID)
        _ = canvasManager.handle(request)
    }

    func sendCountdown(remaining: Int, deadline: Date, active: Bool) {
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: inputSafetyLogCanvasID, payload: [
            "type": "log/input_safety_countdown",
            "payload": [
                "title": "AOS input passthrough",
                "remaining": remaining,
                "deadline": ISO8601DateFormatter().string(from: deadline),
                "active": active,
            ],
        ])
    }

    func removeLogConsole() {
        let request = CanvasRequest(action: "remove", id: inputSafetyLogCanvasID)
        _ = canvasManager.handle(request)
    }
}

class UnifiedDaemon {
    let socketPath: String
    let config: AosConfig
    private(set) var currentConfig: AosConfig
    private let configWatcher = ConfigWatcher()
    // Constructed lazily because it needs the bus's VoicePolicyStore (see below).
    private var voicePolicyWatcher: VoicePolicyWatcher?
    let startTime = Date()

    // Modules
    let perception: PerceptionEngine
    let spatial = SpatialModel()
    let canvasManager = CanvasManager()
    private lazy var inputSafetyVisualFeedbackPresenter = InputSafetyVisualFeedbackPresenter(
        runtime: DaemonInputSafetyVisualFeedbackRuntime(canvasManager: canvasManager)
    )
    private var inputSafetyPassthroughTimer: DispatchSourceTimer?
    private var inputSafetyPassthroughDeadline: Date?
    private var inputSafetyEmergencyExitScheduled = false
    private var speechEngine: SpeechEngine?
    private var speechCancelTap: CFMachPort?
    private var speechCancelTapSource: CFRunLoopSource?
    private lazy var voiceTransport = AOSVoiceTransport(
        emit: { [weak self] owner, event, data, ref in
            self?.emitVoiceTransportEvent(to: owner, event: event, data: data, ref: ref)
        },
        microphoneOperations: operationMicrophoneAdapter
    )
    private lazy var annotationSelection = AOSAnnotationSelectionTransport { [weak self] owner, event, data, ref in
        self?.emitConnectionEvent(service: "annotation", to: owner, event: event, data: data, ref: ref)
    }
    private lazy var statusItemHostController = AOSStatusItemHostController(
        manager: StatusItemManager(),
        emit: { [weak self] owner, event, data, ref in
            self?.emitConnectionEvent(service: "status_item", to: owner, event: event, data: data, ref: ref) ?? false
        },
        terminate: { [weak self] owner, reason in
            self?.terminateConnection(owner, reason: reason)
        }
    )
    private var contentServer: ContentServer?
    private let desktopFrameStore = AOSDesktopFrameStore()
    private let desktopPixelBroker = AOSDesktopPixelBroker()
    private lazy var desktopFrameProbeCapturer = AOSNativeDesktopFrameCapturer(
        broker: desktopPixelBroker,
        strategy: .snapshot
    )
    private lazy var desktopFrameCapturer = AOSNativeDesktopFrameCapturer(
        broker: desktopPixelBroker,
        strategy: .prewarmedSnapshot
    )
    private lazy var publicCaptureController = AOSPublicCaptureController(
        capturer: desktopFrameCapturer
    )
    private lazy var desktopFrameCaptureConsent = AOSDesktopFrameCaptureConsentController(
        capturer: desktopFrameProbeCapturer,
        preflightPermission: { CGPreflightScreenCaptureAccess() }
    )
    private lazy var desktopFrameCapture = AOSDesktopFrameCaptureController(
        canvasManager: canvasManager,
        store: desktopFrameStore,
        capturer: desktopFrameCapturer,
        consent: desktopFrameCaptureConsent,
        reauthorize: { [weak self] authorization in
            self?.reauthorizeDesktopFrame(authorization) ?? false
        },
        handleAbort: { [weak self] abort in
            self?.deliverDesktopFrameAbort(abort)
        },
        authorize: { [weak self] payload in
            self?.authorizeDesktopFrame(payload)
        }
    )
    private lazy var desktopWorldNativeFeedbackHost =
        AOSDesktopWorldNativeFeedbackHost(canvasManager: canvasManager)
    private lazy var desktopWorldNativeFeedback =
        AOSDesktopWorldNativeFeedbackController(
            host: desktopWorldNativeFeedbackHost,
            capturer: desktopFrameCapturer,
            authorize: { [weak self] request in
                self?.authorizeNativeSheetEffect(request) ?? false
            }
        )
    private lazy var desktopWorldSceneEffectTrigger =
        AOSDesktopWorldSceneEffectTriggerCommandController(
            execute: { [weak self] input in
                guard let self else {
                    return .failure(
                        code: "SCENE_EFFECT_TRIGGER_STAGE_UNAVAILABLE",
                        message: "DesktopWorld scene stage is unavailable"
                    )
                }
                return self.desktopWorldSceneTransport.executeNativeEffectTrigger(
                    input,
                    prepare: {
                        operation -> AOSDesktopWorldNativeFeedbackPreparedAdmission? in
                        switch operation {
                        case .trigger(let request):
                            guard let configuration = self.desktopWorldNativeFeedback
                                .prepareTriggerAfterSceneAuthorization(request) else {
                                return nil
                            }
                            return AOSDesktopWorldNativeFeedbackPreparedAdmission
                                .trigger(request, configuration: configuration)
                        case .gesture(let event, let replacement):
                            return AOSDesktopWorldNativeFeedbackPreparedAdmission
                                .gesture(event, replacement: replacement)
                        }
                    },
                    admit: {
                        (prepared: AOSDesktopWorldNativeFeedbackPreparedAdmission) in
                        switch prepared {
                        case .trigger(let request, let configuration):
                            return self.desktopWorldNativeFeedback
                                .admitPreparedTriggerAfterSceneAuthorization(
                                    request,
                                    configuration: configuration
                                )
                        case .gesture(let event, let replacement):
                            return self.desktopWorldNativeFeedback
                                .handleGestureAfterSceneAuthorization(
                                    event,
                                    replacement: replacement
                                )
                        }
                    }
                )
            }
        )
    private lazy var desktopFrameSchemeHandler = AOSDesktopFrameSchemeHandler(
        store: desktopFrameStore,
        authorize: { [weak self] authorization in
            self?.desktopWorldSceneTransport.authorizesDesktopFrame(authorization) ?? false
        },
        identityResolver: { [weak self] webView in
            self?.canvasManager.desktopFrameConsumer(
                canvasID: AOSDesktopWorldSceneTransportController.stageCanvasID,
                webViewID: ObjectIdentifier(webView)
            )
        }
    )
    private lazy var sceneExtensionStore = AOSSceneExtensionStore()
    private lazy var sceneExtensionSchemeHandler = AOSSceneExtensionSchemeHandler(store: sceneExtensionStore)
    private let desktopWorldSceneEventRouting = AOSDesktopWorldSceneEventRouteDiagnostics()
    let coordination = CoordinationBus()

    // Socket server
    var serverFD: Int32 = -1
    private var daemonLockFD: Int32 = -1
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private let operationConnectionEpochLock = NSLock()
    private var operationNextConnectionEpoch: UInt64 = 1
    private var operationStore: AOSFileOperationStateStore?
    private var operationRegistry: AOSOperationRegistry?
    private var operationControlPlane: AOSOperationControlPlane?
    private var operationMicrophoneAdapter: AOSMicrophoneOperationAdapter?
    private var operationScreenRecordingAdapter: AOSScreenRecordingOperationAdapter?
    private var operationDaemonGeneration: UInt64 = 0
    private let operationImageProvider = AOSDarwinProcessImageProvider()
    private let operationStatusHostLease = AOSOperationStatusHostLease()
    private var operationCanvasProjection: AOSOperationCanvasProjection?
    private var operationStatusItemProjection: AOSOperationStatusItemProjection?
    private var operationControlCanvasIdentity: AOSOperationCanvasIdentity?
    private var operationExternalSpawnExpiryTimer: DispatchSourceTimer?
    private let operationExternalSpawnIntentTTLNanoseconds: UInt64 = 30_000_000_000
    private let operationControlCanvasID = "aos-operation-control"
    private var sceneStageCanvasID: String { AOSDesktopWorldSceneTransportController.stageCanvasID }
    private lazy var desktopWorldSceneTransport = AOSDesktopWorldSceneTransportController(
        canvasManager: canvasManager,
        extensionStore: sceneExtensionStore,
        eventDiagnostics: desktopWorldSceneEventRouting,
        nativeFeedback: { [weak self] request in
            self?.triggerNativeSheetEffect(request)
        },
        nativeGestureFeedback: { [weak self] event, replacement in
            self?.updateNativeSheetEffect(
                event,
                replacement: replacement
            )
        },
        resolveContentURL: { [weak self] value in self?.resolveContentURL(value) ?? value },
        clearReadyManifest: { [weak self] in
            guard let self else { return }
            self.canvasSubscriptionLock.lock()
            self.canvasReadyManifests.removeValue(forKey: self.sceneStageCanvasID)
            self.canvasSubscriptionLock.unlock()
        },
        authorizationChanged: { [weak self] in
            self?.desktopFrameAuthorizationChanged()
        },
        emit: { [weak self] route, event, data in
            self?.emitConnectionEvent(
                service: "scene",
                to: route.connectionID,
                event: event,
                data: data,
                ref: route.ref
            ) ?? false
        }
    )

    private lazy var desktopWorldDevTools = AOSDesktopWorldDevToolsController(
        canvasManager: canvasManager,
        sceneStageCanvasID: sceneStageCanvasID,
        ensureSceneStage: { [weak self] in self?.desktopWorldSceneTransport.ensureStage() != nil },
        hasSceneMonitor: { [weak self] in self?.hasDesktopWorldSceneMonitor() ?? false },
        nativeStageFacts: { [weak self] in
            guard let self else { return .idle }
            let status = self.desktopFrameCapture.warmStatus()
            let nativeEffect = self.desktopWorldNativeFeedback.snapshot()
            return AOSDesktopWorldDevToolsNativeStageFacts(
                displayCount: status?.displayCount ?? 0,
                errorCode: status?.errorCode,
                generation: status?.generation ?? 0,
                nativeEffectActiveInstanceCount: nativeEffect.activeInstanceCount,
                nativeEffectActiveSheetCount: nativeEffect.activeSheetCount,
                nativeEffectAcceptedCount: nativeEffect.acceptedCount,
                nativeEffectAttemptedCount: nativeEffect.attemptedCount,
                nativeEffectCompletedCount: nativeEffect.completedCount,
                nativeEffectDisposedCount: nativeEffect.disposedCount,
                nativeEffectFailedCount: nativeEffect.failedCount,
                nativeEffectLastErrorCode: nativeEffect.lastErrorCode,
                nativeEffectLastOwnerID: nativeEffect.lastOwnerID,
                nativeEffectLastPresentationLatencyMilliseconds:
                    nativeEffect.lastPresentationLatencyMilliseconds,
                nativeEffectLastRenderBackingPixelCount:
                    nativeEffect.lastRenderBackingPixelCount,
                nativeEffectLastRenderBackingPixelPercentage:
                    nativeEffect.lastRenderBackingPixelPercentage,
                nativeEffectLastRenderTriangleCount:
                    nativeEffect.lastRenderTriangleCount,
                nativeEffectLastProgramDigest: nativeEffect.lastProgramDigest,
                nativeEffectLastProgramID: nativeEffect.lastProgramID,
                nativeEffectLastProgramRevision: nativeEffect.lastProgramRevision,
                nativeEffectLastResourceID: nativeEffect.lastResourceID,
                nativeEffectLastResourceRevision: nativeEffect.lastResourceRevision,
                nativeEffectPresentedCount: nativeEffect.presentedCount,
                nativeEffectRejectedCount: nativeEffect.rejectedCount,
                nativeEffectRetainedBufferCount: nativeEffect.retainedBufferCount,
                nativeEffectRetainedTextureCount: nativeEffect.retainedTextureCount,
                nativeEffectRetainedViewCount: nativeEffect.retainedViewCount,
                nativeEffectState: nativeEffect.state,
                state: status?.state.rawValue ?? "idle"
            )
        },
        observeNativeStageFacts: { [weak self] changed in
            self?.desktopFrameCapture.setWarmStatusObserver { _ in changed() }
        },
        resolveContentURL: { [weak self] value in self?.resolveContentURL(value) ?? value }
    )
    private let voiceTelemetryLock = NSLock()
    let canvasInspectorBundleLock = NSLock()
    var canvasInspectorBundleInFlight = false
    var canvasInspectorBundleLastTriggerAt = Date.distantPast

    struct CanvasEventSubscription {
        let target: CanvasLifecycleGeneration
        var events: Set<String>
    }

    // Canvas-side event subscriptions retain the generation that established
    // ownership so queued fanout cannot retarget a same-ID replacement.
    // Populated when a canvas posts {type: 'subscribe', payload: {events: [...]}}.
    var canvasEventSubscriptions: [String: CanvasEventSubscription] = [:]
    var canvasPerceptionChannels: [String: CanvasPerceptionChannel] = [:]
    var canvasObjectRegistries: [String: [String: Any]] = [:]
    var canvasReadyManifests: [String: [String: Any]] = [:]
    let canvasSubscriptionLock = NSLock()
    private let surfaceTransportProbeLock = NSLock()
    private var inputFanoutDeliveriesByCanvas: [String: Int] = [:]
    private var inputFanoutRecentDeliveriesByCanvas: [String: [Date]] = [:]
    private var lastInputFanoutTargets: [String] = []
    private var canvasSendMessagesByType: [String: Int] = [:]
    private var canvasSendMessagesByTargetAndType: [String: [String: Int]] = [:]

    // Canvas ownership: child canvas ID → parent canvas ID.
    // Populated when a canvas creates another canvas via postMessage(canvas.create).
    // CLI-originated canvases have no entry here (nil parent), which the permission
    // check treats as "mutable by anyone" for debugging predictability.
    var canvasCreatedBy: [String: String] = [:]

    // Inverse of canvasCreatedBy: parent canvas ID → set of direct child IDs.
    // Maintained alongside canvasCreatedBy so cascade-remove doesn't need a scan.
    var canvasChildren: [String: Set<String>] = [:]
    private var activeConnections = Set<UUID>()
    private var signalSources: [DispatchSourceSignal] = []
    private var isShuttingDown = false
    private let inputRegionLock = NSLock()
    private var inputRegions = AOSInputRegionRegistry()
    private var inputKeyLeases = AOSInputKeyLeaseRegistry()
    private let inputRegionCursorPresentation = AOSInputRegionCursorPresentationCoordinator()

    // Wiki FSEvents watcher
    private var wikiWatcher: WikiWatcher?

    // Idle management
    var idleTimeout: TimeInterval
    private let idleShutdownTimer = AOSDaemonIdleTimer()

    // Coalesce display_geometry rebroadcasts — didChangeScreenParameters can
    // storm during display reconfig; we only need one broadcast per quiet burst.
    private var displayGeometryBroadcastScheduled = false
    private let displayGeometryCoalesceMs: Int = 100

    // Caller-published last-known surface positions. In-memory only — wiped on
    // daemon restart. Written by a renderer on every transition to IDLE; read
    // by the same renderer on boot to resume where the user last left it.
    var configChangeHandler: ((AosConfig) -> Void)?
    private var lastPositions: [String: (x: Double, y: Double)] = [:]
    private let lastPositionsLock = NSLock()

    struct SubscriberConnection {
        let outbound: AOSConnectionOutboundWriter
        var publicCapture: AOSDesktopFrameCancelling?
        var publicCaptureToken: UUID?
        var perceptionChannelIDs: Set<UUID>
        var isSubscribed: Bool  // subscribed to display events too
        var wantsInputEvents: Bool
        var sceneMonitorResource: String?
        var sceneMonitorRef: String?
        var sceneMonitorReady: Bool
        let operationConnectionEpoch: UInt64
        let operationSocketFD: Int32
        let operationPeer: AOSSocketPeerIdentity
        var operationOwnerRoot: AOSMechanicalOwnerRoot
        var externalBoundOperation: AOSOperationIdentity?
    }

    struct CanvasPerceptionChannel {
        let id: UUID
        let depth: Int
        let rate: String
    }

    init(config: AosConfig, idleTimeout: TimeInterval = 300) {
        self.socketPath = kDefaultSocketPath
        self.config = config
        self.currentConfig = config
        self.idleTimeout = idleTimeout
        self.perception = PerceptionEngine(config: config)
    }

    private func initializeOperationControlPlane() throws {
        let registration = try AOSMicrophoneOperationAdapter.makeRegistration()
        let screenRecordingRegistration = try AOSScreenRecordingOperationAdapter.makeRegistration()
        let adapterRegistry = try AOSAdapterRegistrySnapshot.make(
            revision: 2,
            registrations: [registration, screenRecordingRegistration]
        )
        let storeRoot = URL(fileURLWithPath: aosStateDir(), isDirectory: true)
            .appendingPathComponent("operation-control", isDirectory: true)
        let store = try AOSFileOperationStateStore(rootURL: storeRoot)
        let prior = try store.load()
        if let prior, prior.adapterRegistry != adapterRegistry {
            throw AOSOperationCoreError.adapterRegistryConflict
        }
        let nextDaemonGeneration: UInt64
        if let prior {
            guard prior.daemonGeneration < UInt64.max else {
                throw AOSOperationCoreError.generationConflict
            }
            nextDaemonGeneration = prior.daemonGeneration + 1
        } else {
            nextDaemonGeneration = 1
        }
        let registry = try AOSOperationRegistry(
            store: store,
            daemonGeneration: nextDaemonGeneration,
            adapterRegistry: adapterRegistry
        )
        let control = AOSOperationControlPlane(
            registry: registry,
            daemonEffectiveUID: geteuid()
        )
        let adapter = try AOSMicrophoneOperationAdapter(
            registry: registry,
            registration: registration,
            contextResolver: { [weak self] owner in
                guard let self else { throw AOSOperationCoreError.callerNotAuthenticated }
                return try self.operationContext(for: owner)
            },
            reconcileHostBarrier: { [weak control] in
                guard let control else { return }
                let state = registry.snapshot().barrier.state
                guard [.closing, .cleanupRequired, .recovering].contains(state) else { return }
                _ = control.reconcileHostBarrierWithBoundedRetry()
            }
        )
        let screenRecordingAdapter = try AOSScreenRecordingOperationAdapter(
            registry: registry,
            registration: screenRecordingRegistration,
            broker: desktopPixelBroker,
            artifactRootURL: storeRoot.appendingPathComponent("artifacts", isDirectory: true),
            contextResolver: { [weak self] owner in
                guard let self else { throw AOSOperationCoreError.callerNotAuthenticated }
                let context = try self.operationContext(for: owner)
                return AOSScreenRecordingOperationContext(
                    ownerRoot: context.ownerRoot,
                    attribution: context.attribution
                )
            },
            reconcileHostBarrier: { [weak control] in
                guard let control else { return }
                let state = registry.snapshot().barrier.state
                guard [.closing, .cleanupRequired, .recovering].contains(state) else { return }
                _ = control.reconcileHostBarrierWithBoundedRetry()
            }
        )
        try registry.installRuntimeAdapters([adapter, screenRecordingAdapter])

        operationStore = store
        operationRegistry = registry
        operationControlPlane = control
        operationMicrophoneAdapter = adapter
        operationScreenRecordingAdapter = screenRecordingAdapter
        operationDaemonGeneration = nextDaemonGeneration

        let recoveryToken = AOSSHA256Digest.hashing(
            domain: .externalBindingToken,
            data: Data(UUID().uuidString.utf8)
        ).value
        let recovery = try AOSOperationRecovery.beginBootRecovery(
            registry: registry,
            newDaemonGeneration: nextDaemonGeneration,
            claimTokenDigest: recoveryToken
        )
        try reconcileOperationBootRecoveryExternalChildren(
            registry: registry,
            control: control,
            recoveryGeneration: recovery.recoveryGeneration,
            claimTokenDigest: recoveryToken
        )
        try initializeOperationProjections(
            registrations: [registration, screenRecordingRegistration],
            registry: registry,
            control: control
        )
        startOperationExternalSpawnExpiryTimer(
            bootRecoveryGeneration: recovery.recoveryGeneration,
            bootRecoveryClaimTokenDigest: recoveryToken
        )
    }

    private func reconcileOperationBootRecoveryExternalChildren(
        registry: AOSOperationRegistry,
        control: AOSOperationControlPlane,
        recoveryGeneration: UInt64,
        claimTokenDigest: String
    ) throws {
        let recovering = registry.snapshot()
        guard recovering.recovery.generation == recoveryGeneration,
              recovering.recovery.claimTokenDigest == claimTokenDigest else { return }
        if recovering.recovery.state == .terminal {
            if recovering.barrier.state == .bootReconciling {
                _ = try control.completeBootReconciliation(.open)
            }
            return
        }
        var absentSpawnRecords = Set<String>()
        for finalized in recovering.finalizedExternalSpawnRecords {
            if operationExternalChildIsMechanicallyAbsent(finalized) {
                absentSpawnRecords.insert(finalized.skipRecord.spawnRecordID)
            }
        }
        let externallyLiveOperations = Set(recovering.finalizedExternalSpawnRecords.compactMap {
            absentSpawnRecords.contains($0.skipRecord.spawnRecordID) ? nil : AOSOperationIdentity(
                id: $0.skipRecord.operationID,
                generation: $0.skipRecord.operationGeneration
            )
        })
        let externallyLiveClaims = recovering.resourceClaims.filter {
            externallyLiveOperations.contains($0.operation)
        }
        let externallyLiveBrokerIDs = Set(externallyLiveClaims.compactMap(\.brokerID))
        let artifactRoot = URL(fileURLWithPath: aosStateDir(), isDirectory: true)
            .appendingPathComponent("operation-control/artifacts", isDirectory: true)
        var removedArtifacts = Set<AOSOperationIdentity>()
        var releasedArtifacts = Set<AOSOperationIdentity>()
        for artifact in recovering.artifacts {
            let url = artifactRoot.appendingPathComponent(
                "\(artifact.identity.id)-\(artifact.identity.generation).mov"
            )
            switch artifact.recoveryDisposition {
            case .releaseVerification:
                if !FileManager.default.fileExists(atPath: url.path) {
                    releasedArtifacts.insert(artifact.identity)
                }
            case .removalVerification, .none:
                if unlink(url.path) == 0 || errno == ENOENT,
                   !FileManager.default.fileExists(atPath: url.path) {
                    removedArtifacts.insert(artifact.identity)
                }
            case .retentionVerification:
                break
            }
        }
        let reconciled = try AOSOperationRecovery.reconcile(
            registry: registry,
            recoveryGeneration: recoveryGeneration,
            claimTokenDigest: claimTokenDigest,
            mechanicallyAbsentOperationIDs: Set(recovering.operations.compactMap {
                externallyLiveOperations.contains($0.identity) ? nil : $0.identity
            }),
            mechanicallyAbsentStreamIDs: Set(recovering.streams.map(\.identity)),
            mechanicallyAbsentTapIDs: Set(recovering.taps.map(\.identity)),
            mechanicallyAbsentTransactionIDs: Set(recovering.resourceTransactions.compactMap {
                externallyLiveOperations.contains($0.operation) ? nil : $0.transactionID
            }),
            mechanicallyAbsentClaimIDs: Set(recovering.resourceClaims.compactMap {
                externallyLiveOperations.contains($0.operation) ? nil : $0.claimID
            }),
            mechanicallyAbsentBrokerIDs: Set(recovering.resourceBrokers.compactMap {
                externallyLiveBrokerIDs.contains($0.brokerID) ? nil : $0.brokerID
            }),
            mechanicallyAbsentSpawnRecordIDs: absentSpawnRecords,
            mechanicallyRemovedArtifactIDs: removedArtifacts,
            mechanicallyReleasedArtifactIDs: releasedArtifacts
        )
        if reconciled.residualCount == 0, reconciled.barrierState == .bootReconciling {
            _ = try control.completeBootReconciliation(.open)
        }
    }

    private func initializeOperationProjections(
        registrations: [AOSOperationAdapterRegistration],
        registry: AOSOperationRegistry,
        control: AOSOperationControlPlane
    ) throws {
        let statusBinding = AOSOperationStatusHostBinding(
            daemonGeneration: operationDaemonGeneration,
            effectiveUID: UInt32(geteuid()),
            statusHostID: "aos.internal.operation-status",
            statusHostGeneration: operationDaemonGeneration,
            connectionEpoch: operationDaemonGeneration
        )
        guard let microphoneRegistration = registrations.first(where: {
            $0.id == AOSMicrophoneOperationAdapter.registrationID
        }), let screenRecordingRegistration = registrations.first(where: {
            $0.id == AOSScreenRecordingOperationAdapter.registrationID
        }) else { throw AOSOperationCoreError.adapterRegistryConflict }
        let indicators = try AOSOperationStatusIndicatorRegistry(bindings: [
            try AOSOperationStatusIndicatorBinding(
                registration: microphoneRegistration,
                capabilityID: AOSMicrophoneOperationAdapter.capabilityID,
                indicatorClass: .recording
            ),
            try AOSOperationStatusIndicatorBinding(
                registration: screenRecordingRegistration,
                capabilityID: AOSScreenRecordingOperationAdapter.capabilityID,
                indicatorClass: .recording
            ),
        ])
        let canvasHost = AOSClosureOperationCanvasHost(
            open: { [weak self] in
                guard let self else { throw AOSOperationProjectionError.canvasDeliveryFailed }
                let open = { () throws -> AOSOperationCanvasIdentity in
                    if self.canvasManager.hasCanvas(self.operationControlCanvasID) {
                        let response = self.canvasManager.handle(CanvasRequest(
                            action: "resume",
                            id: self.operationControlCanvasID
                        ))
                        guard response.status == "success" else {
                            throw AOSOperationProjectionError.canvasDeliveryFailed
                        }
                    } else {
                        let response = self.canvasManager.handle(CanvasRequest(
                            action: "create",
                            id: self.operationControlCanvasID,
                            url: "aos://toolkit/components/operation-control/index.html",
                            interactive: true,
                            focus: true,
                            scope: "global"
                        ))
                        guard response.status == "success" else {
                            throw AOSOperationProjectionError.canvasDeliveryFailed
                        }
                    }
                    guard let target = self.canvasManager.deliveryTarget(
                        forCanvasID: self.operationControlCanvasID
                    ) else {
                        throw AOSOperationProjectionError.canvasDeliveryFailed
                    }
                    let identity = AOSOperationCanvasIdentity(
                        id: target.canvasID,
                        generation: target.value
                    )
                    self.operationControlCanvasIdentity = identity
                    return identity
                }
                return try Thread.isMainThread ? open() : DispatchQueue.main.sync(execute: open)
            },
            post: { [weak self] canvas, payload in
                guard let self else { return false }
                let post = { () -> Bool in
                    guard let current = self.canvasManager.deliveryTarget(forCanvasID: canvas.id),
                          current.value == canvas.generation else { return false }
                    self.canvasManager.postMessageAsync(to: current, payload: payload)
                    return true
                }
                return Thread.isMainThread ? post() : DispatchQueue.main.sync(execute: post)
            }
        )
        try operationStatusHostLease.install(statusBinding)
        let canvasProjection = try AOSOperationCanvasProjection(
            controlPlane: control,
            readState: { registry.snapshot() },
            indicatorRegistry: indicators,
            canvasHost: canvasHost,
            statusHostLease: operationStatusHostLease,
            checkedAt: { [weak self] in
                self?.operationTimestamp(registry.now()) ?? "1970-01-01T00:00:00.000Z"
            }
        )
        operationCanvasProjection = canvasProjection
        let statusProjection = try AOSOperationStatusItemProjection(
            controlPlane: control,
            readState: { registry.snapshot() },
            indicatorRegistry: indicators,
            statusHost: statusBinding,
            itemGeneration: operationDaemonGeneration,
            statusHostLease: operationStatusHostLease,
            openCanvas: { [weak self] leaseIdentity in
                _ = try? self?.operationCanvasProjection?.openStatusCanvas(
                    statusHostLeaseIdentity: leaseIdentity
                )
            }
        )
        operationStatusItemProjection = statusProjection
        if Thread.isMainThread {
            statusProjection.start()
        } else {
            DispatchQueue.main.sync { statusProjection.start() }
        }
    }

    private func operationExternalChildIsMechanicallyAbsent(
        _ record: AOSFinalizedExternalDispatchSpawnRecord
    ) -> Bool {
        var processInfo = proc_bsdinfo()
        let expected = MemoryLayout<proc_bsdinfo>.size
        let count = withUnsafeMutablePointer(to: &processInfo) { pointer in
            proc_pidinfo(
                record.skipRecord.child.pid,
                PROC_PIDTBSDINFO,
                0,
                pointer,
                Int32(expected)
            )
        }
        guard count == expected else { return true }
        let current = AOSProcessGenerationIdentity(
            pid: record.skipRecord.child.pid,
            effectiveUID: processInfo.pbi_uid,
            parentPID: pid_t(bitPattern: processInfo.pbi_ppid),
            startTimeSeconds: processInfo.pbi_start_tvsec,
            startTimeMicroseconds: processInfo.pbi_start_tvusec
        )
        return current != record.skipRecord.child
    }

    private func scheduleExternalSpawnRetirement(
        operation: AOSOperationIdentity,
        attempt: Int
    ) {
        guard attempt < 20, operationRegistry != nil else { return }
        let delay = DispatchTimeInterval.milliseconds(attempt == 0 ? 50 : 100)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay) {
            [weak self] in
            guard let self, let registry = self.operationRegistry else { return }
            let records = registry.snapshot().finalizedExternalSpawnRecords.filter {
                $0.skipRecord.operationID == operation.id
                    && $0.skipRecord.operationGeneration == operation.generation
            }
            var unresolved = false
            for record in records {
                guard self.operationExternalChildIsMechanicallyAbsent(record) else {
                    unresolved = true
                    continue
                }
                _ = try? registry.retireFinalizedExternalSpawnRecord(
                    spawnRecordID: record.skipRecord.spawnRecordID,
                    operation: operation,
                    child: record.skipRecord.child,
                    mechanicalAbsenceVerified: true
                )
            }
            let remaining = registry.snapshot().finalizedExternalSpawnRecords.contains {
                $0.skipRecord.operationID == operation.id
                    && $0.skipRecord.operationGeneration == operation.generation
            }
            if remaining || unresolved {
                self.scheduleExternalSpawnRetirement(operation: operation, attempt: attempt + 1)
                return
            }
            self.scheduleExternalSpawnSettlement(operation: operation, attempt: 0)
        }
    }

    private func scheduleExternalSpawnSettlement(
        operation: AOSOperationIdentity,
        attempt: Int
    ) {
        guard attempt < 20 else { return }
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .milliseconds(100)) {
            [weak self] in
            guard let self else { return }
            do {
                _ = try self.operationControlPlane?.externalSpawnRetirementDidSettle(
                    operation: operation
                )
            } catch {
                // Post-removal settlement has an independent retry budget so a
                // record that disappears on the final polling attempt cannot
                // strand its parent or host barrier after a durable save fault.
                self.scheduleExternalSpawnSettlement(
                    operation: operation,
                    attempt: attempt + 1
                )
            }
        }
    }

    private func operationContext(
        for owner: UUID,
        attribution: AOSOperationAttribution = AOSOperationAttribution()
    ) throws -> AOSMicrophoneOperationContext {
        subscriberLock.lock()
        defer { subscriberLock.unlock() }
        guard let connection = subscribers[owner] else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        return AOSMicrophoneOperationContext(
            ownerRoot: connection.operationOwnerRoot,
            attribution: attribution
        )
    }

    private func authorizeDesktopFrame(
        _ payload: [String: Any]
    ) -> AOSDesktopFrameCaptureAuthorization? {
        desktopWorldSceneTransport.authorizeDesktopFrame(payload)
    }

    private func reauthorizeDesktopFrame(
        _ authorization: AOSDesktopFrameLeaseIdentity
    ) -> Bool {
        desktopWorldSceneTransport.authorizesDesktopFrame(authorization)
    }

    private func authorizeNativeSheetEffect(
        _ request: AOSDesktopWorldNativeEffectRequest
    ) -> Bool {
        desktopWorldSceneTransport.authorizesNativeEffect(request)
    }

    private func triggerNativeSheetEffect(
        _ request: AOSDesktopWorldNativeEffectRequest
    ) {
        _ = desktopWorldNativeFeedback.trigger(request)
    }

    private func updateNativeSheetEffect(
        _ event: AOSDesktopWorldNativeEffectGestureEvent,
        replacement: AOSDesktopWorldNativeEffectRequest?
    ) {
        desktopWorldNativeFeedback.handleGesture(
            event,
            replacement: replacement
        )
    }

    private func desktopFrameAuthorizationChanged() {
        _ = desktopFrameCapture.cancelUnauthorized()
        let nativePresentation = desktopWorldSceneTransport.hasNativeEffectAuthorization()
        desktopFrameCapture.reconcileWarm(
            authorization: desktopWorldSceneTransport
                .desktopFrameTextureAuthorization(),
            nativePresentation: nativePresentation
        )
        desktopWorldNativeFeedback.reconcileAvailability(
            nativePresentation,
            programs: desktopWorldSceneTransport.nativeEffectPrograms()
        )
        desktopWorldNativeFeedback.reconcileAuthorization()
    }

    // MARK: - Start

    func start() {
        initializeNativeHosts()
        let mode = aosCurrentRuntimeMode()
        let otherSocketPath = aosSocketPath(for: mode.other)
        if socketIsReachable(otherSocketPath, timeoutMs: 250) {
            exitError(
                "Mixed runtime state detected: \(mode.other.rawValue) daemon is reachable at \(otherSocketPath). Stop it before starting the \(mode.rawValue) daemon.",
                code: "MIXED_RUNTIME_STATE"
            )
        }

        // Ensure directory
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        acquireDaemonLock(mode: mode)

        do {
            try initializeOperationControlPlane()
        } catch let error as AOSOperationCoreError {
            exitError(
                "Operation control initialization failed: \(error.code)",
                code: error.code
            )
        } catch {
            exitError(
                "Operation control initialization failed.",
                code: "OPERATION_STORE_UNAVAILABLE"
            )
        }

        unlink(socketPath)

        let policyWatcher = VoicePolicyWatcher(store: coordination.voicePolicyStore)
        policyWatcher.onChange = { [weak self] policy in
            guard let self else { return }
            self.coordination.handlePolicyReload(policy)
        }
        policyWatcher.start()
        voicePolicyWatcher = policyWatcher

        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { exitError("socket() failed: \(errno)", code: "SOCKET_ERROR") }
        _ = disableSigPipe(serverFD)

        let bindResult = withSocketAddress(socketPath) { addr, len in bind(serverFD, addr, len) }
        guard bindResult == 0 else { exitError("bind() failed: \(errno)", code: "BIND_ERROR") }
        guard listen(serverFD, 10) == 0 else { exitError("listen() failed: \(errno)", code: "LISTEN_ERROR") }

        fputs("aos daemon started on \(socketPath)\n", stderr)
        fputs("\(aosIdentityLogLine(program: "aos"))\n", stderr)

        // Wire perception events -> broadcast
        perception.onEvent = { [weak self] event, data in
            self?.broadcastEvent(service: "perceive", event: event, data: data)
            self?.forwardSubscribedEventToCanvases(type: event, data: data)
        }
        perception.onInputEvent = { [weak self] event, data in
            self?.handleInputEvent(event: event, data: data) ?? false
        }
        perception.onVoiceHotkeyInput = { [weak self] input in
            self?.voiceTransport.handleHotkey(input) ?? false
        }
        perception.onInputSafetyHotkeyTriggered = { [weak self] deadline in
            self?.activateInputSafetyEmergencyExit(until: deadline)
        }
        perception.onInputTapPermissionLost = { [weak self] in
            self?.releaseInputRegionCaptureAfterPermissionLoss()
        }

        // Wire canvas events -> broadcast
        canvasManager.onEvent = { [weak self] target, payload in
            guard let self = self else { return }
            let canvasID = target.canvasID

            // Intercept subscribe/unsubscribe before relay — these configure daemon
            // state, not events for other subscribers to observe.
            if let dict = payload as? [String: Any],
               let type = dict["type"] as? String {
                let inner = dict["payload"] as? [String: Any]
                if let operationMessage = inner,
                   operationMessage["schema_version"] as? String
                    == "aos.canvas-operation-control.request.v1" {
                    let routed = self.operationCanvasProjection?.routeMessage(
                        canvasID: target.canvasID,
                        canvasGeneration: target.value,
                        message: operationMessage
                    ) ?? .notHandled
                    switch routed {
                    case .handled, .rejected:
                        return
                    case .notHandled:
                        break
                    }
                }
                switch type {
                case "subscribe", "unsubscribe":
                    let events = self.subscriptionEvents(from: inner)
                    let wantsSnapshot = (inner?["snapshot"] as? Bool) ?? false
                    self.handleCanvasSubscription(
                        target: target,
                        type: type,
                        events: events,
                        snapshot: wantsSnapshot
                    )
                    return
                case "canvas.create":
                    self.handleCanvasCreate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "aos.action":
                    self.handleAosAction(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.update":
                    self.handleCanvasUpdate(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.remove":
                    self.handleCanvasRemove(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.eval":
                    self.handleCanvasEval(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.info":
                    self.handleCanvasInfo(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.send":
                    self.handleCanvasSend(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.suspend":
                    self.handleCanvasSuspend(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.resume":
                    self.handleCanvasResume(callerID: canvasID, payload: inner ?? [:])
                    return
                case "input_region.register":
                    self.handleInputRegionRegister(caller: target, payload: inner ?? [:])
                    return
                case "input_region.update":
                    self.handleInputRegionRegister(
                        caller: target,
                        payload: inner ?? [:],
                        updateOnly: true
                    )
                    return
                case "input_region.replace_generation":
                    self.handleInputRegionReplaceGeneration(caller: target, payload: inner ?? [:])
                    return
                case "input_region.remove":
                    self.handleInputRegionRemove(callerID: canvasID, payload: inner ?? [:])
                    return
                case "input_key_lease.register":
                    self.handleInputKeyLeaseRegister(caller: target, payload: inner ?? [:])
                    return
                case "gate.submit":
                    self.handleGateSubmit(callerID: canvasID, payload: inner ?? [:])
                    return
                case "lifecycle.ready":
                    self.recordCanvasReadyManifest(target: target, payload: inner)
                    return
                case "position.get":
                    self.handlePositionGet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "position.set":
                    self.handlePositionSet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_world_stage.scene.result":
                    self.desktopWorldSceneTransport.handleResult(target: target, payload: inner ?? [:])
                    return
                case "desktop_world_stage.scene.fault":
                    self.desktopWorldSceneTransport.handleFault(target: target, payload: inner ?? [:])
                    return
                case "desktop_world_stage.scene.event":
                    self.desktopWorldSceneTransport.handleEvent(target: target, payload: inner ?? [:])
                    return
                case "desktop_world_stage.devtools.snapshot":
                    if canvasID == self.sceneStageCanvasID {
                        self.handleDesktopWorldDevToolsStageSnapshot(inner ?? [:])
                    }
                    return
                case "desktop_world_devtools.host.ready":
                    self.publishDesktopWorldDevToolsSnapshots(hostID: canvasID)
                    return
                case "desktop_world_devtools.host.command":
                    self.handleDesktopWorldDevToolsHostCommand(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_frame.acquire":
                    self.handleDesktopFrameAcquire(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_frame.cancel":
                    _ = self.desktopFrameCapture.cancel(callerCanvasID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_frame.ready":
                    self.handleDesktopFrameReady(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_frame.presented":
                    self.handleDesktopFramePresented(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_frame.release":
                    self.handleDesktopFrameRelease(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas_object.marks":
                    // Fan out to any canvas that subscribed; don't echo back to sender.
                    var markPayload: [String: Any] = [:]
                    if let inner = inner {
                        for (k, v) in inner { markPayload[k] = v }
                    }
                    markPayload["source_id"] = canvasID
                    self.forwardCanvasObjectMarks(data: markPayload)
                    return
                case "canvas_object.registry":
                    var registryPayload: [String: Any] = [:]
                    if let inner = inner {
                        for (k, v) in inner { registryPayload[k] = v }
                    }
                    let registryCanvasID = (registryPayload["canvas_id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? canvasID
                    registryPayload["canvas_id"] = registryCanvasID
                    registryPayload["source_id"] = canvasID
                    self.forwardCanvasObjectRegistry(canvasID: registryCanvasID, data: registryPayload)
                    return
                case "canvas_object.transform.result":
                    var resultPayload: [String: Any] = [:]
                    if let inner = inner {
                        for (k, v) in inner { resultPayload[k] = v }
                    }
                    resultPayload["source_id"] = canvasID
                    self.forwardCanvasObjectControlMessage(type: type, data: resultPayload)
                    return
                case "canvas_inspector.capture_bundle":
                    self.triggerCanvasInspectorSeeBundle(
                        sourceCanvasID: canvasID,
                        trigger: inner?["trigger"] as? String ?? "canvas",
                        contextPayload: inner
                    )
                    return
                case "canvas_inspector.request_bundle_config":
                    self.sendCanvasInspectorSeeBundleConfig(canvasID: canvasID)
                    return
                case "clipboard.read":
                    let text = NSPasteboard.general.string(forType: .string) ?? ""
                    self.dispatchCanvasResponse(to: canvasID, requestID: inner?["request_id"] as? String,
                        status: "ok", extra: ["text": text])
                    return
                case "clipboard.write":
                    self.handleClipboardWrite(canvasID: canvasID, payload: inner ?? [:])
                    return
                default:
                    if type == "ready" {
                        self.recordCanvasReadyManifest(target: target, payload: inner)
                    }
                    break
                }
            }

            let data: [String: Any] = ["id": canvasID, "payload": payload]
            self.broadcastEvent(service: "display", event: "canvas_message", data: data)
        }

        canvasManager.onCanvasLifecycle = { [weak self] canvasInfo, action in
            guard let self = self else { return }
            self.publishCanvasLifecycle(action: action, canvasInfo: canvasInfo)
            if action == "removed" {
                if let operationCanvas = self.operationControlCanvasIdentity,
                   operationCanvas.id == canvasInfo.id {
                    self.operationCanvasProjection?.detachCanvas(operationCanvas)
                    self.operationControlCanvasIdentity = nil
                }
                self.removeInputRegionsOwned(by: canvasInfo.id, includeSuspendRetained: true)
                self.desktopWorldDevTools.detachHost(id: canvasInfo.id)
                if canvasInfo.id == self.sceneStageCanvasID {
                    _ = self.desktopFrameCapture.releaseAll(
                        callerCanvasID: self.sceneStageCanvasID
                    )
                    self.desktopWorldSceneTransport.stageRemoved()
                }
            } else if canvasInfo.suspended == true {
                self.removeInputRegionsOwned(by: canvasInfo.id, includeSuspendRetained: false)
            }

            // Drop event subscriptions when the canvas is gone.
            if action == "removed" {
                let canvasID = canvasInfo.id
                self.canvasSubscriptionLock.lock()
                let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
                let canvasPerceptionChannel = self.canvasPerceptionChannels.removeValue(forKey: canvasID)
                let hadRegistry = self.canvasObjectRegistries.removeValue(forKey: canvasID) != nil
                self.canvasReadyManifests.removeValue(forKey: canvasID)
                let children = self.canvasChildren.removeValue(forKey: canvasID) ?? []
                // Detach this canvas from its parent's child set.
                if let parent = self.canvasCreatedBy.removeValue(forKey: canvasID) {
                    if var peers = self.canvasChildren[parent] {
                        peers.remove(canvasID)
                        if peers.isEmpty {
                            self.canvasChildren.removeValue(forKey: parent)
                        } else {
                            self.canvasChildren[parent] = peers
                        }
                    }
                }
                self.canvasSubscriptionLock.unlock()
                if let channel = canvasPerceptionChannel {
                    self.perception.attention.removeChannel(channel.id)
                    fputs("[canvas-sub] removed perception channel for removed canvas=\(canvasID) channel=\(channel.id.uuidString)\n", stderr)
                }
                if had {
                    fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
                }
                if hadRegistry {
                    fputs("[canvas-object] cleared registry for removed canvas=\(canvasID)\n", stderr)
                }
                // Cascade: children with cascade=true are removed; cascade=false are orphaned.
                for child in children {
                    if let childCanvas = self.canvasManager.canvas(forID: child),
                       !childCanvas.cascadeFromParent {
                        // Orphan: detach parent but don't remove
                        childCanvas.parent = nil
                        let orphanInfo = childCanvas.toInfo()
                        self.canvasSubscriptionLock.lock()
                        self.canvasCreatedBy.removeValue(forKey: child)
                        self.canvasSubscriptionLock.unlock()
                        fputs("[canvas-mut] orphaned child=\(child) (parent=\(canvasID) removed)\n", stderr)
                        self.publishCanvasLifecycle(action: "updated", canvasInfo: orphanInfo)
                    } else {
                        let req = CanvasRequest(action: "remove", id: child)
                        _ = self.canvasManager.handle(req)
                        fputs("[canvas-mut] cascade-removed child=\(child) (parent=\(canvasID))\n", stderr)
                    }
                }
            }

        }

        canvasManager.onCanvasGeometry = { [weak self] payload in
            self?.publishCanvasGeometry(payload)
        }

        canvasManager.onCanvasSurfaceEvent = { [weak self] event, data in
            if event == "canvas_topology_settled",
               data["canvas_id"] as? String == self?.sceneStageCanvasID {
                self?.desktopWorldSceneTransport.topologySettled(data)
            }
            self?.publishCanvasSurfaceEvent(event: event, data: data)
        }

        canvasManager.onCanvasCountChanged = { [weak self] in
            self?.checkIdle()
        }

        // Start perception after the app's main queue is live. A synchronous
        // pre-run-loop tap install can still race and come up dead-on-arrival
        // even after NSApplication.shared has been initialized.
        DispatchQueue.main.async { [weak self] in
            self?.perception.start()
        }

        // Wire spatial model events -> broadcast
        spatial.onChannelUpdated = { [weak self] id in
            self?.broadcastEvent(service: "perceive", event: "channel_updated", data: ["id": id])
        }
        spatial.onWindowMoved = { [weak self] windowID, bounds in
            guard let data = try? JSONSerialization.jsonObject(
                with: JSONEncoder().encode(bounds)) as? [String: Any] else { return }
            self?.broadcastEvent(service: "perceive", event: "window_moved",
                                data: ["window_id": windowID, "bounds": data])
        }
        spatial.onFocusChanged = { [weak self] pid, app in
            self?.broadcastEvent(service: "perceive", event: "focus_changed",
                                data: ["pid": pid, "app": app])
        }

        // Observe display arrangement changes -> rebroadcast geometry to
        // every canvas subscribed to display_geometry. Coalesce bursts —
        // didChangeScreenParameters can storm during display reconfig.
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.scheduleDisplayGeometryBroadcast()
        }

        spatial.startPolling()

        // Relocate legacy flat layout into aos/ namespace. Idempotent, creates backup.
        let wikiRoot = URL(fileURLWithPath: aosStateDir()).appendingPathComponent("wiki")
        do {
            if try WikiMigrate.migrateIfNeeded(wikiRoot: wikiRoot) {
                fputs("wiki: migrated flat layout into aos/ namespace (backup at wiki.pre-namespace-bak)\n", stderr)
            }
        } catch {
            fputs("wiki: migration failed: \(error) — continuing with current layout\n", stderr)
        }

        let extensionHandler = sceneExtensionSchemeHandler

        // Start content server
        if let contentConfig = currentConfig.content, !contentConfig.roots.isEmpty {
            let repoRoot = aosCurrentRepoRoot()
            contentServer = ContentServer(
                config: contentConfig,
                repoRoot: repoRoot,
                stateDir: aosStateDir(),
                sceneExtensionModuleProvider: { url in
                    return try extensionHandler.moduleData(for: url)
                }
            )
            contentServer?.start()
        }

        // Register aos:// scheme handler on all WKWebViews — safety net that
        // prevents the custom scheme from leaking to macOS if resolveContentURL
        // fails to rewrite the URL (e.g. content server not yet ready).
        let schemeHandler = AosSchemeHandler()
        schemeHandler.portProvider = { [weak self] in self?.contentServer?.assignedPort ?? 0 }
        schemeHandler.desktopFrameHandler = desktopFrameSchemeHandler
        schemeHandler.sceneExtensionHandler = extensionHandler
        canvasManager.aosSchemeHandler = schemeHandler

        // Start wiki FSEvents watcher and wire change bus
        WikiChangeBus.shared.daemon = self
        let wikiWatchRoot = URL(fileURLWithPath: aosStateDir()).appendingPathComponent("wiki")
        let watcher = WikiWatcher(wikiRoot: wikiWatchRoot)
        watcher.start()
        self.wikiWatcher = watcher

        // Accept connections
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer
        startIdleTimer()
        setupSignalHandlers()

        // Watch config for changes
        configWatcher.onChange = { [weak self] newConfig in
            guard let self = self else { return }
            let oldConfig = self.currentConfig
            self.currentConfig = newConfig
            self.onConfigChanged(old: oldConfig, new: newConfig)
        }
        configWatcher.start()

        // Initialize voice if enabled
        if currentConfig.voice.enabled {
            initSpeechEngine()
        }
    }

    private func initializeNativeHosts() {
        _ = statusItemHostController
    }

    // MARK: - Event Broadcasting

    func broadcastEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let writers = subscribers.values.filter(\.isSubscribed).map(\.outbound)
        subscriberLock.unlock()

        for writer in writers { writer.enqueue(bytes) }
    }

    private func emitVoiceTransportEvent(
        to connectionID: UUID,
        event: String,
        data: [String: Any],
        ref: String?
    ) {
        emitConnectionEvent(service: "voice", to: connectionID, event: event, data: data, ref: ref)
    }

    @discardableResult
    func emitConnectionEvent(
        service: String,
        to connectionID: UUID,
        event: String,
        data: [String: Any],
        ref: String?
    ) -> Bool {
        guard let bytes = envelopeBytes(service: service, event: event, data: data, ref: ref) else { return false }
        subscriberLock.lock()
        let writer = subscribers[connectionID]?.outbound
        subscriberLock.unlock()
        return writer?.enqueue(bytes) ?? false
    }

    private func terminateConnection(_ connectionID: UUID, reason: String) {
        subscriberLock.lock()
        let writer = subscribers[connectionID]?.outbound
        subscriberLock.unlock()
        writer?.close(reason: reason)
    }

    private func sendVoiceTransportError(
        to writer: AOSConnectionOutboundWriter,
        message: String,
        code: String,
        envelopeActive: Bool,
        envelopeRef: String?
    ) {
        sendResponseJSON(
            to: writer,
            ["error": message, "code": code],
            envelopeActive: envelopeActive,
            envelopeRef: envelopeRef
        )
    }

    private func encodedObject<T: Encodable>(_ value: T) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(value),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object
    }

    private func canvasLifecyclePayload(action: String, canvasInfo: CanvasInfo) -> [String: Any]? {
        guard var canvas = encodedObject(canvasInfo) else { return nil }

        canvas["id"] = canvasInfo.id
        canvas["at"] = canvasInfo.at

        var payload: [String: Any] = [
            "canvas_id": canvasInfo.id,
            "action": action,
            "at": canvasInfo.at,
            "interactive": canvasInfo.interactive,
            "canvas": canvas,
        ]
        if let windowLevel = canvasInfo.windowLevel { payload["window_level"] = windowLevel }
        if let parent = canvasInfo.parent { payload["parent"] = parent }
        if let track = canvasInfo.track { payload["track"] = track }
        if let scope = canvasInfo.scope { payload["scope"] = scope }
        if let ttl = canvasInfo.ttl { payload["ttl"] = ttl }
        if let cascade = canvasInfo.cascade { payload["cascade"] = cascade }
        if let suspended = canvasInfo.suspended { payload["suspended"] = suspended }
        if let lifecycleState = canvasInfo.lifecycleState {
            payload["lifecycle_state"] = lifecycleState
            canvas["lifecycle_state"] = lifecycleState
        }
        if let windowNumbers = canvasInfo.windowNumbers { payload["windowNumbers"] = windowNumbers }
        if let owner = canvasInfo.owner, let ownerObject = encodedObject(owner) { payload["owner"] = ownerObject }
        if let segments = canvasInfo.segments {
            payload["segments"] = segments.map { segment in
                [
                    "display_id": Int(segment.displayID),
                    "index": segment.index,
                    "dw_bounds": segment.dwBounds,
                    "native_bounds": segment.nativeBounds,
                    "scale_factor": segment.scaleFactor,
                ] as [String: Any]
            }
        }
        return payload
    }

    private func publishCanvasLifecycle(action: String, canvasInfo: CanvasInfo) {
        guard let data = canvasLifecyclePayload(action: action, canvasInfo: canvasInfo) else { return }
        broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
        fanOutCanvasLifecycle(data)
    }

    private func publishCanvasGeometry(_ data: [String: Any]) {
        broadcastEvent(service: "display", event: "canvas_geometry", data: data)
        forwardSubscribedEventToCanvases(type: "canvas_geometry", data: data)
    }

    private func publishCanvasSurfaceEvent(event: String, data: [String: Any]) {
        broadcastEvent(service: "display", event: event, data: data)
        fanOutCanvasLifecycleSubEvent(event: event, data: data)
    }

    private func subscriptionEvents(from payload: [String: Any]?) -> [String] {
        guard let payload else { return [] }
        if let events = payload["events"] as? [String] {
            return events.filter { !$0.isEmpty }
        }
        if let event = payload["event"] as? String, !event.isEmpty {
            return [event]
        }
        return []
    }

    private func handleCanvasSubscription(
        target: CanvasLifecycleGeneration,
        type: String,
        events: [String],
        snapshot: Bool
    ) {
        guard !events.isEmpty else { return }
        let canvasID = target.canvasID

        canvasSubscriptionLock.lock()
        if type == "subscribe" {
            var current = canvasEventSubscriptions[canvasID]?.target == target
                ? canvasEventSubscriptions[canvasID]!.events
                : []
            for ev in events { current.insert(ev) }
            canvasEventSubscriptions[canvasID] = CanvasEventSubscription(
                target: target,
                events: current
            )
        } else {  // unsubscribe
            if var current = canvasEventSubscriptions[canvasID], current.target == target {
                for ev in events { current.events.remove(ev) }
                if current.events.isEmpty {
                    canvasEventSubscriptions.removeValue(forKey: canvasID)
                } else {
                    canvasEventSubscriptions[canvasID] = current
                }
            }
        }
        let currentEvents = canvasEventSubscriptions[canvasID]?.events
        canvasSubscriptionLock.unlock()
        reconcileCanvasPerceptionChannel(canvasID: canvasID, currentEvents: currentEvents)
        fputs("[canvas-sub] \(type) canvas=\(canvasID) events=\(events) current=\(currentEvents ?? [])\n", stderr)

        if type == "subscribe" && (snapshot || events.contains("display_geometry")) {
            dispatchCanvasSubscriptionSnapshots(to: target, events: events)
        }
    }

    private func canvasSubscriptionTargets(for event: String) -> [CanvasLifecycleGeneration] {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions.values
            .filter { $0.events.contains(event) }
            .map(\.target)
        canvasSubscriptionLock.unlock()
        return targets
    }

    private func canvasSubscriptionTarget(
        canvasID: String,
        event: String
    ) -> CanvasLifecycleGeneration? {
        canvasSubscriptionLock.lock()
        let subscription = canvasEventSubscriptions[canvasID]
        let target = subscription?.events.contains(event) == true ? subscription?.target : nil
        canvasSubscriptionLock.unlock()
        return target
    }

    private func canvasPerceptionRequest(for events: Set<String>?) -> (depth: Int, rate: String)? {
        guard let events else { return nil }
        var depth: Int?
        var rateRank = 0

        func require(depth requiredDepth: Int, rate requiredRate: String) {
            depth = max(depth ?? requiredDepth, requiredDepth)
            switch requiredRate {
            case "continuous":
                rateRank = max(rateRank, 3)
            case "on-change":
                rateRank = max(rateRank, 2)
            case "on-settle":
                rateRank = max(rateRank, 1)
            default:
                break
            }
        }

        if events.contains("cursor_settled") {
            require(depth: 0, rate: "on-settle")
        }
        if events.contains("window_entered") || events.contains("app_entered") {
            require(depth: 1, rate: "on-change")
        }
        if events.contains("element_focused") {
            require(depth: 2, rate: "on-settle")
        }
        if events.contains("cursor_moved") {
            require(depth: 0, rate: "continuous")
        }

        guard let requestedDepth = depth else { return nil }
        let rate: String
        switch rateRank {
        case 3:
            rate = "continuous"
        case 2:
            rate = "on-change"
        default:
            rate = "on-settle"
        }
        return (requestedDepth, rate)
    }

    private func reconcileCanvasPerceptionChannel(canvasID: String, currentEvents: Set<String>?) {
        let requested = canvasPerceptionRequest(for: currentEvents)

        canvasSubscriptionLock.lock()
        let existing = canvasPerceptionChannels[canvasID]
        if existing?.depth == requested?.depth && existing?.rate == requested?.rate {
            canvasSubscriptionLock.unlock()
            return
        }

        if existing != nil {
            canvasPerceptionChannels.removeValue(forKey: canvasID)
        }
        let newChannel: CanvasPerceptionChannel?
        if let requested {
            let channelID = perception.attention.addChannel(depth: requested.depth, scope: "cursor", rate: requested.rate)
            let channel = CanvasPerceptionChannel(id: channelID, depth: requested.depth, rate: requested.rate)
            canvasPerceptionChannels[canvasID] = channel
            newChannel = channel
        } else {
            newChannel = nil
        }
        canvasSubscriptionLock.unlock()

        if let existing {
            perception.attention.removeChannel(existing.id)
            fputs("[canvas-sub] removed perception channel canvas=\(canvasID) channel=\(existing.id.uuidString)\n", stderr)
        }
        if let newChannel {
            fputs("[canvas-sub] added perception channel canvas=\(canvasID) channel=\(newChannel.id.uuidString) depth=\(newChannel.depth) rate=\(newChannel.rate)\n", stderr)
        }
    }

    private func canvasPerceptionChannelSnapshot() -> [[String: Any]] {
        canvasSubscriptionLock.lock()
        let snapshot = canvasPerceptionChannels
            .map { canvasID, channel in
                [
                    "canvas_id": canvasID,
                    "channel_id": channel.id.uuidString,
                    "depth": channel.depth,
                    "scope": "cursor",
                    "rate": channel.rate,
                ] as [String: Any]
            }
            .sorted { ($0["canvas_id"] as? String ?? "") < ($1["canvas_id"] as? String ?? "") }
        canvasSubscriptionLock.unlock()
        return snapshot
    }

    private func canvasEventSubscriptionSnapshot() -> [[String: Any]] {
        canvasSubscriptionLock.lock()
        let snapshot = canvasEventSubscriptions
            .map { canvasID, subscription in
                [
                    "canvas_id": canvasID,
                    "lifecycle_generation": subscription.target.value,
                    "events": Array(subscription.events).sorted(),
                    "input_event": subscription.events.contains("input_event"),
                ] as [String: Any]
            }
            .sorted { ($0["canvas_id"] as? String ?? "") < ($1["canvas_id"] as? String ?? "") }
        canvasSubscriptionLock.unlock()
        return snapshot
    }

    private func canvasMessageType(_ message: Any) -> String {
        if let dict = message as? [String: Any],
           let type = dict["type"] as? String,
           !type.isEmpty {
            return type
        }
        return "unknown"
    }

    private func recordInputFanoutDelivery(targets: [String]) {
        let now = Date()
        let cutoff = now.addingTimeInterval(-1.0)
        surfaceTransportProbeLock.lock()
        lastInputFanoutTargets = targets.sorted()
        for canvasID in targets {
            inputFanoutDeliveriesByCanvas[canvasID, default: 0] += 1
            var recent = inputFanoutRecentDeliveriesByCanvas[canvasID] ?? []
            recent.append(now)
            inputFanoutRecentDeliveriesByCanvas[canvasID] = recent.filter { $0 >= cutoff }
        }
        for canvasID in Array(inputFanoutRecentDeliveriesByCanvas.keys) where !targets.contains(canvasID) {
            inputFanoutRecentDeliveriesByCanvas[canvasID] = (inputFanoutRecentDeliveriesByCanvas[canvasID] ?? []).filter { $0 >= cutoff }
        }
        surfaceTransportProbeLock.unlock()
    }

    private func recordCanvasSendMessage(targetID: String, message: Any) {
        let type = canvasMessageType(message)
        surfaceTransportProbeLock.lock()
        canvasSendMessagesByType[type, default: 0] += 1
        var targetCounts = canvasSendMessagesByTargetAndType[targetID] ?? [:]
        targetCounts[type, default: 0] += 1
        canvasSendMessagesByTargetAndType[targetID] = targetCounts
        surfaceTransportProbeLock.unlock()
    }

    private func surfaceTransportProbeSnapshot(inputEventSubscriberCount: Int) -> [String: Any] {
        let cutoff = Date().addingTimeInterval(-1.0)
        surfaceTransportProbeLock.lock()
        var recentPerSecond: [String: Int] = [:]
        for (canvasID, deliveries) in inputFanoutRecentDeliveriesByCanvas {
            recentPerSecond[canvasID] = deliveries.filter { $0 >= cutoff }.count
        }
        let snapshot: [String: Any] = [
            "input_event": [
                "subscriber_count": inputEventSubscriberCount,
                "subscribers": canvasEventSubscriptionSnapshot().filter {
                    ($0["input_event"] as? Bool) == true
                },
                "last_fanout_targets": lastInputFanoutTargets,
                "deliveries_total_by_canvas": inputFanoutDeliveriesByCanvas,
                "deliveries_last_1s_by_canvas": recentPerSecond,
            ],
            "canvas_send": [
                "messages_by_type": canvasSendMessagesByType,
                "messages_by_target_and_type": canvasSendMessagesByTargetAndType,
            ],
        ]
        surfaceTransportProbeLock.unlock()
        return snapshot
    }

    private func dispatchCanvasSubscriptionSnapshots(
        to target: CanvasLifecycleGeneration,
        events: [String]
    ) {
        // Dispatch async to avoid reentering the canvas message handler from inside
        // the subscribe path.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let requested = Set(events)
            if requested.contains("display_geometry") {
                self.broadcastDisplayGeometry(to: target)
            }
            if requested.contains("canvas_lifecycle") {
                self.broadcastCanvasLifecycleSnapshot(to: target)
            }
            if requested.contains("input_event") {
                self.canvasManager.postMessageAsync(
                    to: target,
                    payload: self.currentInputEventSnapshot()
                )
            }
            if requested.contains("canvas_object.registry") {
                self.broadcastCanvasObjectRegistrySnapshot(to: target)
            }
            if requested.contains("input_region") {
                self.broadcastInputRegionSnapshot(to: target)
            }
        }
    }

    private func forwardInputEventToCanvases(data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: "input_event")

        guard !targets.isEmpty else { return }

        recordInputFanoutDelivery(targets: targets.map(\.canvasID))
        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: data)
        }
    }

    private func forwardSubscribedEventToCanvases(type: String, data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: type)

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": type]
        for (key, value) in data { msg[key] = value }

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: msg)
        }
    }

    /// Fan out a wiki_page_changed event to every canvas that has subscribed
    /// to the `wiki_page_changed` channel. Caller (WikiChangeBus.emit) is
    /// responsible for shaping `data` so that `data["type"]` is the event
    /// name ("wiki_page_changed"), since live-js canvas dispatch routes by
    /// msg.type.
    func forwardWikiPageChangedToCanvases(data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: "wiki_page_changed")

        guard !targets.isEmpty else { return }

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: data)
        }
    }

    /// Fan out a canvas_lifecycle event to every canvas that has subscribed
    /// to the `canvas_lifecycle` channel. Wraps `data` in a `{type, ...}`
    /// envelope since live-js canvas dispatch routes by msg.type and the
    /// broadcast site does not include `type` in the data dict.
    /// Mirror of forwardWikiPageChangedToCanvases.
    func fanOutCanvasLifecycle(_ data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: "canvas_lifecycle")

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": "canvas_lifecycle"]
        for (k, v) in data { msg[k] = v }

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: msg)
        }
    }

    func fanOutCanvasLifecycleSubEvent(event: String, data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: "canvas_lifecycle")

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = [
            "type": "canvas_lifecycle",
            "event": event,
        ]
        for (k, v) in data { msg[k] = v }

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: msg)
        }
    }

    /// Fan out `canvas_object.marks` to every canvas subscribed to that
    /// event name. Mirror of fanOutCanvasLifecycle. Wraps `data`
    /// in a `{type: "canvas_object.marks", ...}` envelope since live-js
    /// canvas dispatch routes by `msg.type`.
    private func forwardCanvasObjectMarks(data: [String: Any]) {
        forwardCanvasObjectControlMessage(type: "canvas_object.marks", data: data)
    }

    private func forwardCanvasObjectRegistry(canvasID: String, data: [String: Any]) {
        guard let objects = data["objects"] as? [Any] else {
            fputs("[canvas-object] registry dropped source=\(data["source_id"] ?? "?") canvas=\(canvasID) reason=missing-objects\n", stderr)
            return
        }

        canvasSubscriptionLock.lock()
        if objects.isEmpty {
            canvasObjectRegistries.removeValue(forKey: canvasID)
        } else {
            canvasObjectRegistries[canvasID] = data
        }
        canvasSubscriptionLock.unlock()

        forwardCanvasObjectControlMessage(type: "canvas_object.registry", data: data)
    }

    private func broadcastCanvasObjectRegistrySnapshot(to target: CanvasLifecycleGeneration) {
        canvasSubscriptionLock.lock()
        let subscribed = canvasEventSubscriptions[target.canvasID]?.target == target
            && canvasEventSubscriptions[target.canvasID]?.events.contains("canvas_object.registry") == true
        let snapshots = Array(canvasObjectRegistries.values)
        canvasSubscriptionLock.unlock()

        guard subscribed, !snapshots.isEmpty else { return }

        for snapshot in snapshots {
            var msg: [String: Any] = ["type": "canvas_object.registry"]
            for (k, v) in snapshot { msg[k] = v }
            canvasManager.postMessageAsync(to: target, payload: msg)
        }
    }

    private func forwardCanvasObjectControlMessage(type: String, data: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: type)

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": type]
        for (k, v) in data { msg[k] = v }

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: msg)
        }
    }

    private func broadcastInputRegionSnapshot(to target: CanvasLifecycleGeneration) {
        canvasSubscriptionLock.lock()
        let subscribed = canvasEventSubscriptions[target.canvasID]?.target == target
            && canvasEventSubscriptions[target.canvasID]?.events.contains("input_region") == true
        canvasSubscriptionLock.unlock()
        guard subscribed else { return }

        inputRegionLock.lock()
        let regions = inputRegions.snapshot()
        inputRegionLock.unlock()

        canvasManager.postMessageAsync(to: target, payload: [
            "type": "input_region.snapshot",
            "regions": regions.map { inputRegionPayload($0) },
        ])
    }

    private func publishInputRegionStateEvent(action: String, region: AOSInputRegionRecord) {
        let payload: [String: Any] = [
            "type": "input_region",
            "action": action,
            "region": inputRegionPayload(region),
        ]
        broadcastEvent(service: "display", event: "input_region", data: payload)
        forwardInputRegionStateEvent(payload)
    }

    private func forwardInputRegionStateEvent(_ payload: [String: Any]) {
        let targets = canvasSubscriptionTargets(for: "input_region")
        guard !targets.isEmpty else { return }
        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: payload)
        }
    }

    private func inputRegionPayload(_ region: AOSInputRegionRecord) -> [String: Any] {
        [
            "id": region.id,
            "owner_canvas_id": region.ownerCanvasID,
            "frame": [
                Double(region.nativeFrame.origin.x),
                Double(region.nativeFrame.origin.y),
                Double(region.nativeFrame.width),
                Double(region.nativeFrame.height),
            ],
            "coordinate_space": region.coordinateSpace,
            "semantic_label": region.semanticLabel,
            "priority": region.priority,
            "consume_policy": region.consumePolicy,
            "metadata": region.metadata,
            "remove_on_owner_suspend": region.removeOnOwnerSuspend,
            "enabled": region.enabled,
        ]
    }

    private func broadcastCanvasLifecycleSnapshot(to target: CanvasLifecycleGeneration) {
        let infos = canvasManager.handle(CanvasRequest(action: "list")).canvases ?? []
        for info in infos {
            if let descriptor = canvasManager.desktopWorldSceneBarrierTopology(canvasID: info.id) {
                var topology = canvasManager.topologySettledPayload(
                    canvasID: info.id,
                    segments: descriptor.segments,
                    canvasGeneration: descriptor.canvasGeneration,
                    topologyGeneration: descriptor.generation
                )
                topology["type"] = "canvas_lifecycle"
                topology["event"] = "canvas_topology_settled"
                canvasManager.postMessageAsync(to: target, payload: topology)
            }
            guard var payload = canvasLifecyclePayload(action: "created", canvasInfo: info) else { continue }
            payload["type"] = "canvas_lifecycle"
            canvasManager.postMessageAsync(to: target, payload: payload)
        }
    }

    /// Fan out the current display geometry snapshot to every canvas
    /// subscribed to `display_geometry`. Invoked on subscribe (single
    /// target) and on `NSApplication.didChangeScreenParametersNotification`
    /// (all subscribers).
    private func broadcastDisplayGeometry(to specificTarget: CanvasLifecycleGeneration? = nil) {
        let targets: [CanvasLifecycleGeneration]
        if let specificTarget {
            targets = canvasSubscriptionTarget(
                canvasID: specificTarget.canvasID,
                event: "display_geometry"
            ) == specificTarget ? [specificTarget] : []
        } else {
            targets = canvasSubscriptionTargets(for: "display_geometry")
        }

        guard !targets.isEmpty else { return }
        fputs("[canvas-sub] display_geometry change -> broadcasting to \(targets.count) canvas(es)\n", stderr)

        let snapshot = snapshotDisplayGeometry()

        for target in targets {
            canvasManager.postMessageAsync(to: target, payload: snapshot)
        }
    }

    /// Coalesced entry point for didChangeScreenParameters. Collapses a burst
    /// of notifications into a single broadcast after a short quiet window.
    ///
    /// Order matters: retarget tracked canvases FIRST, then broadcast. Renderers
    /// subscribed to display_geometry should see their canvas already sitting
    /// in the new bounds by the time they receive the event, not a transient
    /// "stale rect + new topology" state.
    private func scheduleDisplayGeometryBroadcast() {
        if displayGeometryBroadcastScheduled { return }
        displayGeometryBroadcastScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(displayGeometryCoalesceMs)) { [weak self] in
            guard let self = self else { return }
            self.displayGeometryBroadcastScheduled = false
            let retargeted = self.canvasManager.retargetTrackedCanvases()
            self.canvasManager.syncCanvasFrames(excluding: retargeted)
            self.broadcastDisplayGeometry()
            self.reconcileCursorPresentationAfterDisplayGeometryChange()
        }
    }

    private func reconcileCursorPresentationAfterDisplayGeometryChange() {
        inputRegionLock.lock()
        inputRegions.refreshPointerTarget()
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: false
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)
    }

    /// Send an async response to a canvas that made a mutation request with a request_id.
    /// Reuses the headsup.receive dispatch path — the canvas differentiates by msg.type.
    /// If requestID is nil, this is a no-op (fire-and-forget path).
    private func dispatchCanvasResponse(
        to canvasID: String,
        requestID: String?,
        status: String,
        code: String? = nil,
        message: String? = nil,
        createdID: String? = nil,
        extra: [String: Any] = [:]
    ) {
        guard let requestID = requestID else { return }
        var obj: [String: Any] = [
            "type": "canvas.response",
            "request_id": requestID,
            "status": status
        ]
        if let code = code { obj["code"] = code }
        if let message = message { obj["message"] = message }
        if let createdID = createdID { obj["id"] = createdID }
        let reserved: Set<String> = ["type", "request_id", "status", "code", "message"]
        for (k, v) in extra {
            if reserved.contains(k) {
                fputs("[canvas-response] dropping extra key '\(k)' — shadows reserved response field\n", stderr)
                continue
            }
            obj[k] = v
        }
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: canvasID, payload: obj)
    }

    private func dispatchCanvasErrorResponse(
        to canvasID: String,
        requestID: String?,
        code: String,
        message: String
    ) {
        let obj: [String: Any] = [
            "type": "canvas.response",
            "request_id": requestID ?? "",
            "status": "error",
            "code": code,
            "message": message
        ]
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: canvasID, payload: obj)
    }

    private func handleClipboardWrite(canvasID: String, payload: [String: Any]) {
        guard let requestID = payload["request_id"] as? String, !requestID.isEmpty else {
            dispatchCanvasErrorResponse(
                to: canvasID,
                requestID: payload["request_id"] as? String,
                code: "INVALID_REQUEST",
                message: "clipboard.write requires non-empty request_id"
            )
            return
        }
        guard let text = payload["text"] as? String else {
            dispatchCanvasErrorResponse(
                to: canvasID,
                requestID: requestID,
                code: "INVALID_PAYLOAD",
                message: "clipboard.write requires plain text"
            )
            return
        }

        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        dispatchCanvasResponse(to: canvasID, requestID: requestID, status: "ok")
    }

    private func handleAosAction(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let action = (payload["action"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ACTION", message: "aos.action requires action")
            return
        }

        switch action {
        case "canvas.create":
            handleCanvasCreate(callerID: callerID, payload: payload)
        case "canvas.send":
            handleCanvasSend(callerID: callerID, payload: payload)
        case "panel.open":
            handlePanelAction(callerID: callerID, action: action, payload: payload, mode: "open")
        case "panel.toggle":
            handlePanelAction(callerID: callerID, action: action, payload: payload, mode: "toggle")
        case "panel.close":
            handlePanelAction(callerID: callerID, action: action, payload: payload, mode: "close")
        case "macos.open_url":
            handleMacOSOpenURLAction(callerID: callerID, payload: payload)
        case "app.quit":
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "ok", extra: aosActionResponseExtra(callerID: callerID, action: action, payload: payload))
            DispatchQueue.main.async {
                NSApp.terminate(nil)
            }
        default:
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "UNKNOWN_ACTION", message: "unknown aos.action '\(action)'")
        }
    }

    private func aosActionResponseExtra(callerID: String, action: String, payload: [String: Any], extra: [String: Any] = [:]) -> [String: Any] {
        var out: [String: Any] = [
            "action": action,
            "source_canvas_id": callerID,
        ]
        if let source = payload["source"] { out["source"] = source }
        if let control = payload["control"] { out["control"] = control }
        for (key, value) in extra { out[key] = value }
        return out
    }

    private func actionTargetID(_ payload: [String: Any]) -> String? {
        for key in ["id", "panel_id", "target", "target_id"] {
            if let value = (payload[key] as? String).flatMap({ $0.isEmpty ? nil : $0 }) {
                return value
            }
        }
        return nil
    }

    private func actionURL(_ payload: [String: Any]) -> String? {
        for key in ["url", "href"] {
            if let value = (payload[key] as? String).flatMap({ $0.isEmpty ? nil : $0 }) {
                return value
            }
        }
        return nil
    }

    private func rectDictionary(_ value: Any?) -> [String: Double]? {
        guard let dict = value as? [String: Any] else { return nil }
        let x = numberValue(dict["x"])
        let y = numberValue(dict["y"])
        let w = numberValue(dict["w"]) ?? numberValue(dict["width"])
        let h = numberValue(dict["h"]) ?? numberValue(dict["height"])
        guard let x, let y, let w, let h, w.isFinite, h.isFinite, w > 0, h > 0 else { return nil }
        return ["x": x, "y": y, "w": w, "h": h]
    }

    private func pointDictionary(_ value: Any?) -> [String: Double]? {
        guard let dict = value as? [String: Any] else { return nil }
        guard let x = numberValue(dict["x"]),
              let y = numberValue(dict["y"]) else { return nil }
        return ["x": x, "y": y]
    }

    private func rectContainsPoint(_ rect: [String: Double], _ point: [String: Double]) -> Bool {
        let x = rect["x"] ?? 0
        let y = rect["y"] ?? 0
        let w = rect["w"] ?? 0
        let h = rect["h"] ?? 0
        let px = point["x"] ?? 0
        let py = point["y"] ?? 0
        return px >= x && py >= y && px < x + w && py < y + h
    }

    private func displayRectForPoint(_ point: [String: Double], coordinateSpace: String, geometry: [String: Any]) -> [String: Double]? {
        let displayRectKeys = coordinateSpace == "desktop_world"
            ? ["visible_desktop_world_bounds", "desktop_world_bounds", "visible_bounds", "bounds"]
            : ["native_visible_bounds", "visible_bounds", "native_bounds", "bounds"]
        if let displays = geometry["displays"] as? [[String: Any]] {
            for key in displayRectKeys {
                for display in displays {
                    guard let rect = rectDictionary(display[key]) else { continue }
                    if rectContainsPoint(rect, point) { return rect }
                }
            }
        }
        let topLevelKeys = coordinateSpace == "desktop_world"
            ? ["visible_desktop_world_bounds", "desktop_world_bounds", "global_bounds"]
            : ["global_bounds"]
        for key in topLevelKeys {
            if let rect = rectDictionary(geometry[key]) { return rect }
        }
        return nil
    }

    private func clampFrame(_ frame: [Double], to rect: [String: Double]?) -> [Double] {
        guard let rect else { return frame }
        let areaX = rect["x"] ?? 0
        let areaY = rect["y"] ?? 0
        let areaW = max(1, rect["w"] ?? 1)
        let areaH = max(1, rect["h"] ?? 1)
        let width = min(max(1, frame[2]), areaW)
        let height = min(max(1, frame[3]), areaH)
        let maxX = max(areaX, areaX + areaW - width)
        let maxY = max(areaY, areaY + areaH - height)
        let x = min(max(frame[0], areaX), maxX)
        let y = min(max(frame[1], areaY), maxY)
        return [x, y, width, height]
    }

    private func nativePointFromDesktopWorld(_ point: [String: Double], geometry: [String: Any]) -> [String: Double] {
        let global = rectDictionary(geometry["global_bounds"]) ?? ["x": 0, "y": 0, "w": 0, "h": 0]
        return [
            "x": (point["x"] ?? 0) + (global["x"] ?? 0),
            "y": (point["y"] ?? 0) + (global["y"] ?? 0),
        ]
    }

    private func resolveActionFrame(_ payload: [String: Any], required: Bool) -> (frame: [CGFloat]?, code: String?, message: String?) {
        if payload["frame"] != nil {
            return parseCanvasFrame(payload["frame"], required: required)
        }
        if payload["at"] != nil {
            return parseCanvasFrame(payload["at"], required: required)
        }

        guard let anchor = payload["anchor"] as? [String: Any] else {
            if required {
                return (nil, "INVALID_FRAME", "panel action requires frame, at, or anchor")
            }
            return (nil, nil, nil)
        }

        let point = pointDictionary(anchor["point"])
            ?? pointDictionary(anchor["desktop_world"])
            ?? pointDictionary(anchor["desktopWorld"])
            ?? pointDictionary(anchor)
        guard let point else {
            if required {
                return (nil, "INVALID_ANCHOR", "anchor requires numeric x and y")
            }
            return (nil, nil, nil)
        }

        let width = numberValue(payload["width"]) ?? numberValue(anchor["width"]) ?? numberValue(anchor["w"])
        let height = numberValue(payload["height"]) ?? numberValue(anchor["height"]) ?? numberValue(anchor["h"])
        guard let width, let height, width > 0, height > 0 else {
            if required {
                return (nil, "INVALID_FRAME", "anchor panel action requires width and height")
            }
            return (nil, nil, nil)
        }

        let offset = pointDictionary(anchor["offset"]) ?? [
            "x": numberValue(anchor["offset_x"]) ?? numberValue(anchor["offsetX"]) ?? 0.0,
            "y": numberValue(anchor["offset_y"]) ?? numberValue(anchor["offsetY"]) ?? 0.0,
        ]
        let coordinateSpace = (anchor["coordinate_space"] as? String)
            ?? (anchor["coordinateSpace"] as? String)
            ?? (payload["coordinate_space"] as? String)
            ?? "native"
        let normalizedSpace = coordinateSpace == "desktopWorld" ? "desktop_world" : coordinateSpace
        let geometry = snapshotDisplayGeometry()

        var frame = [
            (point["x"] ?? 0) + (offset["x"] ?? 0),
            (point["y"] ?? 0) + (offset["y"] ?? 0),
            width,
            height,
        ]
        let area = displayRectForPoint(point, coordinateSpace: normalizedSpace, geometry: geometry)
        frame = clampFrame(frame, to: area)

        if normalizedSpace == "desktop_world" {
            let native = nativePointFromDesktopWorld(["x": frame[0], "y": frame[1]], geometry: geometry)
            frame[0] = native["x"] ?? frame[0]
            frame[1] = native["y"] ?? frame[1]
        } else if normalizedSpace != "native" {
            return (nil, "INVALID_COORDINATE_SPACE", "unsupported anchor coordinate_space '\(coordinateSpace)'")
        }

        return (frame.map { CGFloat($0) }, nil, nil)
    }

    private func canvasCreateRequestFromActionPayload(_ payload: [String: Any], id: String, frame: [CGFloat]?, callerID: String) -> CanvasRequest {
        var request = CanvasRequest(action: "create")
        request.id = id
        request.at = frame
        request.url = actionURL(payload).map { resolveContentURL($0) }
        request.interactive = payload["interactive"] as? Bool ?? true
        request.windowLevel = payload["window_level"] as? String
        request.focus = payload["focus"] as? Bool
        request.scope = payload["scope"] as? String
        request.track = payload["track"] as? String
        request.surface = payload["surface"] as? String
        request.parent = (payload["parent"] as? String) ?? callerID
        request.cascade = payload["cascade"] as? Bool
        request.suspended = payload["suspended"] as? Bool
        if let geometry = payload["geometry"] as? [String: Any],
           let converted = JSONValue(geometry)?.objectValue {
            request.geometry = converted
        }
        return request
    }

    private func canvasUpdateRequestFromActionPayload(_ payload: [String: Any], id: String, frame: [CGFloat]?) -> CanvasRequest {
        var request = CanvasRequest(action: "update")
        request.id = id
        request.at = frame
        request.interactive = payload["interactive"] as? Bool
        request.windowLevel = payload["window_level"] as? String
        request.geometryChange = payload["geometry_change"] as? String ?? (frame == nil ? nil : "frame")
        request.geometryCause = payload["geometry_cause"] as? String ?? "aos.action"
        request.geometryPhase = payload["geometry_phase"] as? String ?? (frame == nil ? nil : "settled")
        request.geometryTransactionID = payload["geometry_transaction_id"] as? String
        if let geometry = payload["geometry"] as? [String: Any],
           let converted = JSONValue(geometry)?.objectValue {
            request.geometry = converted
        }
        return request
    }

    private func handlePanelAction(callerID: String, action: String, payload: [String: Any], mode: String) {
        let requestID = payload["request_id"] as? String
        guard let panelID = actionTargetID(payload) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "\(action) requires id")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let exists = self.canvasManager.hasCanvas(panelID)
            if mode == "close" || (mode == "toggle" && exists && (payload["toggle_behavior"] as? String) == "close") {
                if !exists {
                    self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok",
                        extra: self.aosActionResponseExtra(callerID: callerID, action: action, payload: payload, extra: [
                            "panel": ["id": panelID, "exists": false, "operation": "noop"],
                        ]))
                    return
                }
                let response = self.canvasManager.handle(CanvasRequest(action: "remove", id: panelID))
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: response.status == "success" ? "ok" : "error",
                    code: response.code, message: response.error,
                    extra: self.aosActionResponseExtra(callerID: callerID, action: action, payload: payload, extra: [
                        "panel": ["id": panelID, "operation": "close"],
                    ]))
                return
            }

            let parsedFrame = self.resolveActionFrame(payload, required: !exists)
            if let code = parsedFrame.code {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: code, message: parsedFrame.message)
                return
            }

            if exists {
                let update = self.canvasUpdateRequestFromActionPayload(payload, id: panelID, frame: parsedFrame.frame)
                let updateResponse = self.canvasManager.handle(update)
                if updateResponse.status != "success" {
                    self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                        status: "error", code: updateResponse.code, message: updateResponse.error)
                    return
                }
                let resumeResponse = self.canvasManager.handle(CanvasRequest(action: "resume", id: panelID))
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: resumeResponse.status == "success" ? "ok" : "error",
                    code: resumeResponse.code, message: resumeResponse.error,
                    extra: self.aosActionResponseExtra(callerID: callerID, action: action, payload: payload, extra: [
                        "panel": ["id": panelID, "operation": parsedFrame.frame == nil ? "resume" : "reposition"],
                    ]))
                return
            }

            guard actionURL(payload) != nil else {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "MISSING_URL", message: "\(action) requires url when creating a panel")
                return
            }
            let create = self.canvasCreateRequestFromActionPayload(payload, id: panelID, frame: parsedFrame.frame, callerID: callerID)
            let createResponse = self.canvasManager.handle(create)
            if createResponse.status == "success" {
                self.canvasSubscriptionLock.lock()
                self.canvasCreatedBy[panelID] = callerID
                var siblings = self.canvasChildren[callerID] ?? []
                siblings.insert(panelID)
                self.canvasChildren[callerID] = siblings
                self.canvasSubscriptionLock.unlock()
            }
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: createResponse.status == "success" ? "ok" : "error",
                code: createResponse.code, message: createResponse.error,
                createdID: createResponse.status == "success" ? panelID : nil,
                extra: self.aosActionResponseExtra(callerID: callerID, action: action, payload: payload, extra: [
                    "panel": ["id": panelID, "operation": "open"],
                ]))
        }
    }

    private func handleMacOSOpenURLAction(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let rawURL = actionURL(payload) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_URL", message: "macos.open_url requires url")
            return
        }
        let resolved = resolveContentURL(rawURL)
        guard let url = URL(string: resolved),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "URL_SCHEME_NOT_ALLOWED",
                message: "macos.open_url allows http, https, and browser-safe resolved AOS URLs")
            return
        }

        if let logPath = ProcessInfo.processInfo.environment["AOS_OPEN_URL_LOG"], !logPath.isEmpty {
            let line = resolved + "\n"
            let data = Data(line.utf8)
            FileManager.default.createFile(atPath: logPath, contents: nil)
            if let handle = FileHandle(forWritingAtPath: logPath) {
                handle.seekToEndOfFile()
                handle.write(data)
                handle.closeFile()
            }
            dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok",
                extra: aosActionResponseExtra(callerID: callerID, action: "macos.open_url", payload: payload, extra: [
                    "url": resolved,
                    "opened": true,
                    "opener": "log",
                ]))
            return
        }

        let opened = NSWorkspace.shared.open(url)
        dispatchCanvasResponse(to: callerID, requestID: requestID,
            status: opened ? "ok" : "error",
            code: opened ? nil : "OPEN_URL_FAILED",
            message: opened ? nil : "NSWorkspace failed to open \(resolved)",
            extra: aosActionResponseExtra(callerID: callerID, action: "macos.open_url", payload: payload, extra: [
                "url": resolved,
                "opened": opened,
                "opener": "NSWorkspace",
            ]))
    }

    private func canvasMutationPermitted(callerID: String, targetID: String) -> Bool {
        if targetID == callerID { return true }
        canvasSubscriptionLock.lock()
        defer { canvasSubscriptionLock.unlock() }
        if let owner = canvasCreatedBy[targetID] { return owner == callerID }
        return true  // no recorded owner = CLI-origin = open per mutation-api rule 3
    }

    private func parseCanvasFrame(_ value: Any?, required: Bool) -> (frame: [CGFloat]?, code: String?, message: String?) {
        guard let value = value else {
            if required {
                return (nil, "INVALID_FRAME", "frame must be [x,y,w,h]")
            }
            return (nil, nil, nil)
        }
        guard let frameArr = value as? [Any], frameArr.count == 4 else {
            return (nil, "INVALID_FRAME", "frame must be [x,y,w,h]")
        }
        let parsedFrame: [CGFloat] = frameArr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
        guard parsedFrame.count == 4 else {
            return (nil, "INVALID_FRAME", "frame values must be numeric")
        }
        guard parsedFrame.allSatisfy({ $0.isFinite }) else {
            return (nil, "INVALID_FRAME", "frame values must be finite")
        }
        return (parsedFrame, nil, nil)
    }

    private func recordCanvasReadyManifest(
        target: CanvasLifecycleGeneration,
        payload: [String: Any]?
    ) {
        guard let payload = payload else { return }
        let canvasID = target.canvasID
        if canvasID == sceneStageCanvasID {
            guard let publicManifest = desktopWorldSceneTransport.recordReady(
                target: target,
                payload: payload
            ) else { return }
            canvasSubscriptionLock.lock()
            canvasReadyManifests[canvasID] = publicManifest
            canvasSubscriptionLock.unlock()
            return
        }
        canvasSubscriptionLock.lock()
        canvasReadyManifests[canvasID] = payload
        canvasSubscriptionLock.unlock()
    }

    private func readyManifest(for canvasID: String) -> [String: Any]? {
        canvasSubscriptionLock.lock()
        defer { canvasSubscriptionLock.unlock() }
        return canvasReadyManifests[canvasID]
    }

    private func numberValue(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private func handleCanvasCreate(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String

        guard let newID = payload["id"] as? String, !newID.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "canvas.create requires id")
            return
        }
        guard let url = payload["url"] as? String, !url.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_URL", message: "canvas.create requires url")
            return
        }
        let surface = payload["surface"] as? String
        let parsedFrame = parseCanvasFrame(payload["frame"], required: surface == nil)
        if let code = parsedFrame.code {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: code, message: parsedFrame.message)
            return
        }
        let at = parsedFrame.frame
        let interactive = payload["interactive"] as? Bool
        let windowLevel = payload["window_level"] as? String

        let resolvedURL = resolveContentURL(url)

        let resolvedParent = (payload["parent"] as? String) ?? callerID

        let req = CanvasRequest(
            action: "create",
            id: newID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: resolvedURL,
            interactive: interactive,
            windowLevel: windowLevel,
            focus: payload["focus"] as? Bool, ttl: nil, js: nil, scope: payload["scope"] as? String,
            autoProject: nil,
            track: payload["track"] as? String,
            surface: surface,
            parent: resolvedParent,
            cascade: payload["cascade"] as? Bool,
            suspended: payload["suspended"] as? Bool,
            channel: nil, data: nil
        )

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let response = self.canvasManager.handle(req)
            if response.status == "success" {
                self.canvasSubscriptionLock.lock()
                self.canvasCreatedBy[newID] = callerID
                var siblings = self.canvasChildren[callerID] ?? []
                siblings.insert(newID)
                self.canvasChildren[callerID] = siblings
                self.canvasSubscriptionLock.unlock()
                fputs("[canvas-mut] create ok caller=\(callerID) new=\(newID)\n", stderr)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "ok", createdID: newID)
            } else {
                fputs("[canvas-mut] create fail caller=\(callerID) new=\(newID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: response.code, message: response.error)
            }
        }
    }

    private func handleCanvasUpdate(callerID: String, payload: [String: Any]) {
        // Default to self-mutation when id is missing or empty: the daemon already
        // knows the caller from the postMessage source. Explicit id is still
        // accepted for cross-canvas mutation (subject to ownership checks below).
        let providedID = payload["id"] as? String
        let targetID = (providedID?.isEmpty == false) ? providedID! : callerID

        guard canvasMutationPermitted(callerID: callerID, targetID: targetID) else {
            fputs("[canvas-mut] update forbidden caller=\(callerID) target=\(targetID)\n", stderr)
            return
        }

        // Build the CanvasRequest. `geometry` carries generic audit/placement metadata.
        let requestID = payload["request_id"] as? String
        let parsedFrame = parseCanvasFrame(payload["frame"], required: false)
        if let code = parsedFrame.code {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: code, message: parsedFrame.message)
            return
        }
        let at = parsedFrame.frame
        let interactive = payload["interactive"] as? Bool
        let windowLevel = payload["window_level"] as? String
        let geometry = payload["geometry"] as? [String: Any]
        let convertedGeometry = geometry.flatMap { JSONValue($0)?.objectValue }

        guard at != nil || interactive != nil || windowLevel != nil || convertedGeometry != nil else {
            fputs("[canvas-mut] update dropped caller=\(callerID) target=\(targetID) reason=no-fields\n", stderr)
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "NO_FIELDS", message: "canvas.update requires frame, interactive, window_level, or geometry")
            return
        }

        let req = CanvasRequest(
            action: "update",
            id: targetID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil,
            interactive: interactive,
            windowLevel: windowLevel,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil,
            geometryChange: geometry?["change"] as? String ?? payload["geometry_change"] as? String,
            geometryCause: geometry?["cause"] as? String ?? payload["geometry_cause"] as? String,
            geometryPhase: geometry?["phase"] as? String ?? payload["geometry_phase"] as? String,
            geometryTransactionID: geometry?["transaction_id"] as? String ?? payload["geometry_transaction_id"] as? String,
            geometry: convertedGeometry
        )

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let response = self.canvasManager.handle(req)
            if response.status != "success" {
                fputs("[canvas-mut] update fail caller=\(callerID) target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
            }
            // Success path is intentionally silent — update is the 60Hz hot path.
        }
    }

    private func handleCanvasRemove(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let orphanChildren = (payload["orphan_children"] as? Bool) ?? false

        // Default to self-removal when id is missing or empty.
        let providedID = payload["id"] as? String
        let targetID = (providedID?.isEmpty == false) ? providedID! : callerID

        guard canvasMutationPermitted(callerID: callerID, targetID: targetID) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "FORBIDDEN",
                message: "caller \(callerID) may not remove \(targetID)")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.performCascadeRemove(targetID: targetID, orphanChildren: orphanChildren)

            // Check whether the target still exists. If yes, the remove failed.
            let targetExisted = self.canvasManager.handle(
                CanvasRequest(action: "list", id: nil, at: nil,
                              anchorWindow: nil, anchorChannel: nil, offset: nil,
                              html: nil, url: nil, interactive: nil, windowLevel: nil, focus: nil,
                              ttl: nil, js: nil, scope: nil, autoProject: nil,
                              channel: nil, data: nil)
            ).canvases?.contains(where: { $0.id == targetID }) ?? false
            if targetExisted {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "REMOVE_FAILED",
                    message: "target \(targetID) still exists after remove")
            } else {
                _ = self.desktopFrameCapture.releaseAll(callerCanvasID: targetID)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok")
            }
        }
    }

    private func handleCanvasEval(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let providedID = payload["id"] as? String
        let targetID = (providedID?.isEmpty == false) ? providedID! : callerID

        guard canvasMutationPermitted(callerID: callerID, targetID: targetID) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "FORBIDDEN",
                message: "caller \(callerID) may not eval \(targetID)")
            return
        }
        guard let js = payload["js"] as? String else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_JS",
                message: "canvas.eval requires js")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let req = CanvasRequest(
                action: "eval",
                id: targetID,
                at: nil,
                anchorWindow: nil, anchorChannel: nil, offset: nil,
                html: nil, url: nil,
                interactive: nil,
                windowLevel: nil,
                focus: nil, ttl: nil, js: js, scope: nil,
                autoProject: nil, channel: nil, data: nil
            )
            let response = self.canvasManager.handle(req)
            if response.status == "success" {
                var extra: [String: Any] = [:]
                if let result = response.result { extra["result"] = result }
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "ok", extra: extra)
            } else {
                fputs("[canvas-mut] eval fail caller=\(callerID) target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: response.code, message: response.error)
            }
        }
    }

    private func handleCanvasInfo(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let providedID = payload["id"] as? String
        let targetID = (providedID?.isEmpty == false) ? providedID! : callerID

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let canvas = self.canvasManager.canvas(forID: targetID) else {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "NOT_FOUND", message: "Canvas '\(targetID)' not found")
                return
            }
            let info = canvas.toInfo()
            var canvasObject = self.encodedObject(info) ?? ["id": targetID]
            let manifest = self.readyManifest(for: targetID)
            if let manifest {
                canvasObject["ready_manifest"] = manifest
                canvasObject["manifest"] = manifest
            }
            let lifecycleState = info.lifecycleState ?? (info.suspended == true ? "suspended" : "active")
            var ready: [String: Any] = [
                "ready": manifest != nil,
                "lifecycle_state": lifecycleState,
            ]
            if let manifest { ready["manifest"] = manifest }
            if let suspended = info.suspended { ready["suspended"] = suspended }
            self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok", extra: [
                "canvas": canvasObject,
                "exists": true,
                "ready": ready,
            ])
        }
    }

    /// Relay an arbitrary message from one canvas to another via headsup.receive.
    /// Payload: { target: "canvas-id", message: { ... } }
    private func handleCanvasSend(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let targetID = payload["target"] as? String, !targetID.isEmpty else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_TARGET", message: "canvas.send requires target")
            return
        }
        guard let message = payload["message"] else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_MESSAGE", message: "canvas.send requires message")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.recordCanvasSendMessage(targetID: targetID, message: message)
            self.canvasManager.postMessageToCurrentCanvasAsync(canvasID: targetID, payload: message)
            self.dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok", extra: [
                "target": targetID,
                "source_canvas_id": callerID,
            ])
        }
    }

    private func handleInputRegionRegister(
        caller: CanvasLifecycleGeneration,
        payload: [String: Any],
        updateOnly: Bool = false
    ) {
        let callerID = caller.canvasID
        let requestID = payload["request_id"] as? String
        let region: AOSInputRegionRecord
        do {
            region = try admittedInputRegion(caller: caller, payload: payload)
        } catch let failure as AOSInputRegionAdmissionFailure {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: failure.code, message: failure.message)
            return
        } catch {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_INPUT_REGION", message: "input region admission failed")
            return
        }
        let id = region.id

        inputRegionLock.lock()
        let existed = inputRegions.snapshot().contains { $0.id == id }
        if updateOnly && !existed {
            inputRegionLock.unlock()
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "NOT_FOUND", message: "input region \(id) not found")
            return
        }
        inputRegions.register(region)
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: true
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)

        let action = existed ? "updated" : "registered"
        publishInputRegionStateEvent(action: action, region: region)
        dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok", extra: ["region": inputRegionPayload(region)])
    }

    private func admittedInputRegion(
        caller: CanvasLifecycleGeneration,
        payload: [String: Any],
        requireCallerOwnership: Bool = false
    ) throws -> AOSInputRegionRecord {
        let callerID = caller.canvasID
        guard let id = (payload["id"] as? String).flatMap({
            $0.isEmpty || $0.utf8.count > 512 ? nil : $0
        }) else {
            throw AOSInputRegionAdmissionFailure(code: "MISSING_ID", message: "input region requires a bounded id")
        }
        let ownerCanvasID = (payload["owner_canvas_id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID
        guard !requireCallerOwnership || ownerCanvasID == callerID else {
            throw AOSInputRegionAdmissionFailure(code: "FORBIDDEN", message: "atomic input region replacement requires caller ownership")
        }
        guard canvasMutationPermitted(callerID: callerID, targetID: ownerCanvasID) else {
            throw AOSInputRegionAdmissionFailure(code: "FORBIDDEN", message: "caller may not own the input region")
        }
        guard let ownerTarget = ownerCanvasID == callerID
            ? caller
            : canvasManager.deliveryTarget(forCanvasID: ownerCanvasID) else {
            throw AOSInputRegionAdmissionFailure(code: "NOT_FOUND", message: "input region owner canvas was not found")
        }
        guard let frame = inputRegionFrame(from: payload),
              frame.origin.x.isFinite,
              frame.origin.y.isFinite else {
            throw AOSInputRegionAdmissionFailure(code: "INVALID_FRAME", message: "input region frame must be finite [x,y,w,h]")
        }
        let coordinateSpace = normalizedInputRegionCoordinateSpace(payload["coordinate_space"] as? String)
        guard let nativeFrame = nativeInputRegionFrame(frame, coordinateSpace: coordinateSpace),
              nativeFrame.origin.x.isFinite,
              nativeFrame.origin.y.isFinite,
              nativeFrame.width.isFinite,
              nativeFrame.height.isFinite else {
            throw AOSInputRegionAdmissionFailure(code: "INVALID_COORDINATE_SPACE", message: "input region coordinate space is invalid")
        }
        let rawMetadata = payload["metadata"] as? [String: Any] ?? [:]
        guard rawMetadata.count <= 16 else {
            throw AOSInputRegionAdmissionFailure(code: "INVALID_METADATA", message: "input region metadata exceeds its entry limit")
        }
        var metadata: [String: String] = [:]
        for (key, value) in rawMetadata {
            guard !key.isEmpty, key.utf8.count <= 128 else {
                throw AOSInputRegionAdmissionFailure(code: "INVALID_METADATA", message: "input region metadata key is invalid")
            }
            let encoded: String?
            if let string = value as? String { encoded = string }
            else if let bool = value as? Bool { encoded = bool ? "true" : "false" }
            else if let number = value as? NSNumber { encoded = number.stringValue }
            else { encoded = nil }
            guard let encoded, encoded.utf8.count <= 256 else {
                throw AOSInputRegionAdmissionFailure(code: "INVALID_METADATA", message: "input region metadata value is invalid")
            }
            metadata[key] = encoded
        }
        let priority = (payload["priority"] as? NSNumber)?.intValue ?? 0
        guard (-10_000...10_000).contains(priority) else {
            throw AOSInputRegionAdmissionFailure(code: "INVALID_PRIORITY", message: "input region priority is out of range")
        }
        let semanticLabel = payload["semantic_label"] as? String ?? payload["label"] as? String ?? id
        guard aosValidInputRegionSemanticLabel(semanticLabel) else {
            throw AOSInputRegionAdmissionFailure(code: "INVALID_LABEL", message: "input region label is invalid")
        }
        return AOSInputRegionRecord(
            id: id,
            ownerCanvasGeneration: ownerTarget,
            nativeFrame: nativeFrame,
            coordinateSpace: coordinateSpace,
            semanticLabel: semanticLabel,
            priority: priority,
            consumePolicy: normalizedInputRegionConsumePolicy(payload["consume_policy"] as? String),
            metadata: metadata,
            removeOnOwnerSuspend: (payload["remove_on_owner_suspend"] as? Bool) ?? true,
            enabled: (payload["enabled"] as? Bool) ?? true
        )
    }

    private func handleInputRegionReplaceGeneration(
        caller: CanvasLifecycleGeneration,
        payload: [String: Any]
    ) {
        let callerID = caller.canvasID
        let requestID = payload["request_id"] as? String
        guard let activationPayloads = payload["activate"] as? [[String: Any]],
              let retiredIDs = payload["retire"] as? [String],
              !activationPayloads.isEmpty || !retiredIDs.isEmpty,
              activationPayloads.count <= 128,
              retiredIDs.count <= 128,
              activationPayloads.count + retiredIDs.count <= 256,
              retiredIDs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_INPUT_REGION_GENERATION", message: "input region generation payload is invalid")
            return
        }
        let candidates: [AOSInputRegionRecord]
        do {
            candidates = try activationPayloads.map {
                try admittedInputRegion(caller: caller, payload: $0, requireCallerOwnership: true)
            }
        } catch let failure as AOSInputRegionAdmissionFailure {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: failure.code, message: failure.message)
            return
        } catch {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_INPUT_REGION_GENERATION", message: "input region generation admission failed")
            return
        }

        inputRegionLock.lock()
        let replacement = inputRegions.replaceGeneration(
            activate: candidates,
            retire: retiredIDs,
            owner: caller
        )
        let cursorResult = replacement.map { _ in
            inputRegionCursorPresentation.reconcile(
                target: inputRegions.cursorPresentationSnapshot(),
                emitMove: true
            )
        }
        inputRegionLock.unlock()
        guard let replacement, let cursorResult else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INPUT_REGION_GENERATION_CONFLICT", message: "input region generation could not be replaced atomically")
            return
        }
        publishInputRegionCursorPresentation(cursorResult)
        if !replacement.idempotent {
            for region in replacement.retired { publishInputRegionStateEvent(action: "removed", region: region) }
            for region in replacement.activated { publishInputRegionStateEvent(action: "updated", region: region) }
        }
        dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok", extra: [
            "activated": replacement.activated.count,
            "idempotent": replacement.idempotent,
            "retired": replacement.retired.count,
        ])
    }

    private func handleInputRegionRemove(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let id = (payload["id"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "input_region.remove requires id")
            return
        }

        inputRegionLock.lock()
        let existing = inputRegions.snapshot().first { $0.id == id }
        if let existing, !canvasMutationPermitted(callerID: callerID, targetID: existing.ownerCanvasID) {
            inputRegionLock.unlock()
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "FORBIDDEN", message: "caller \(callerID) may not remove region \(id)")
            return
        }
        let removed = inputRegions.remove(id: id)
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: false
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)

        if let removed {
            publishInputRegionStateEvent(action: "removed", region: removed)
        }
        dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok")
    }

    private func handleInputKeyLeaseRegister(
        caller: CanvasLifecycleGeneration,
        payload: [String: Any]
    ) {
        let requestID = payload["request_id"] as? String
        guard let id = (payload["id"] as? String).flatMap({ $0.isEmpty || $0.count > 256 ? nil : $0 }) else {
            dispatchCanvasResponse(to: caller.canvasID, requestID: requestID,
                status: "error", code: "INVALID_ID", message: "input_key_lease.register requires a bounded id")
            return
        }
        guard payload["key"] as? String == "Escape" else {
            dispatchCanvasResponse(to: caller.canvasID, requestID: requestID,
                status: "error", code: "UNSUPPORTED_KEY", message: "input key leases support exact Escape only")
            return
        }

        inputRegionLock.lock()
        let registered = inputKeyLeases.register(AOSInputKeyLeaseRecord(
            id: id,
            ownerCanvasGeneration: caller,
            logicalKey: "Escape"
        ))
        inputRegionLock.unlock()
        guard registered else {
            dispatchCanvasResponse(to: caller.canvasID, requestID: requestID,
                status: "error", code: "LEASE_OWNED", message: "input key lease id is owned by another canvas generation")
            return
        }
        dispatchCanvasResponse(to: caller.canvasID, requestID: requestID, status: "ok")
    }

    private func isValidGateContinuationID(_ id: String) -> Bool {
        let pattern = #"^gate-cont-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"#
        return id.range(of: pattern, options: .regularExpression) != nil
    }

    private func handleGateSubmit(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        guard let continuationID = (payload["continuation_id"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_CONTINUATION_ID",
                message: "gate.submit requires continuation_id")
            return
        }
        guard isValidGateContinuationID(continuationID) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_CONTINUATION_ID",
                message: "gate.submit received an invalid continuation_id")
            return
        }

        let submission: [String: Any] = [
            "response": payload["response"] ?? NSNull(),
            "submitted_by": payload["submitted_by"] ?? NSNull(),
        ]
        guard JSONSerialization.isValidJSONObject(submission),
              let submissionData = try? JSONSerialization.data(withJSONObject: submission, options: []) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_SUBMISSION",
                message: "gate.submit response must be JSON-serializable")
            return
        }

        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("aos-gate-submit-\(UUID().uuidString).json")
        do {
            try submissionData.write(to: tempURL, options: .atomic)
        } catch {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "SUBMISSION_WRITE_FAILED",
                message: "failed to prepare gate.submit submission")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            defer { try? FileManager.default.removeItem(at: tempURL) }

            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            var args = [
                "node",
                aosRepoPath("packages/cli/verbs/gate-submit.js"),
                "--continuation-id",
                continuationID,
                "--request",
                tempURL.path,
                "--json",
            ]
            if (payload["store_response"] as? Bool) == true {
                args.append("--store-response")
            }
            task.arguments = args
            var environment = ProcessInfo.processInfo.environment
            environment["AOS_RUNTIME_MODE"] = aosCurrentRuntimeMode().rawValue
            task.environment = environment

            let stdout = Pipe()
            let stderr = Pipe()
            task.standardOutput = stdout
            task.standardError = stderr

            do {
                try task.run()
            } catch {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "SPAWN_FAILED",
                    message: "failed to run gate submit handler: \(error.localizedDescription)")
                return
            }
            task.waitUntilExit()

            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            let stderrText = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard task.terminationStatus == 0 else {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "GATE_SUBMIT_FAILED",
                    message: stderrText?.isEmpty == false ? stderrText : "gate submit failed")
                return
            }
            do {
                let obj = try JSONSerialization.jsonObject(with: stdoutData, options: []) as? [String: Any]
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "ok", extra: ["gate_submit": obj ?? [:]])
            } catch {
                self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "INVALID_GATE_SUBMIT_RESPONSE",
                    message: "gate submit handler returned invalid JSON")
            }
        }
    }

    private func handleCanvasSuspend(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let targetID = (payload["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let req = CanvasRequest(action: "suspend", id: targetID)
            let response = self.canvasManager.handle(req)
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: response.status == "success" ? "ok" : "error",
                code: response.code, message: response.error)
        }
    }

    private func handleCanvasResume(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let targetID = (payload["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let req = CanvasRequest(action: "resume", id: targetID)
            let response = self.canvasManager.handle(req)
            self.dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: response.status == "success" ? "ok" : "error",
                code: response.code, message: response.error)
        }
    }

    /// Must be called on the main thread. Removes children (recursively) before the target.
    /// If orphanChildren is true, children are detached (createdBy[child] = nil) but not removed.
    /// Updates ownership maps atomically under canvasSubscriptionLock.
    private func performCascadeRemove(targetID: String, orphanChildren: Bool) {
        if orphanChildren {
            canvasSubscriptionLock.lock()
            let children = canvasChildren.removeValue(forKey: targetID) ?? []
            for child in children {
                canvasCreatedBy.removeValue(forKey: child)
            }
            canvasSubscriptionLock.unlock()
        }
        // If not orphaning, the lifecycle handler does the cascade automatically
        // when handle(remove) fires below.

        let req = CanvasRequest(
            action: "remove", id: targetID, at: nil,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil, interactive: nil, windowLevel: nil,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
        )
        let response = canvasManager.handle(req)
        if response.status != "success" {
            fputs("[canvas-mut] remove fail target=\(targetID) code=\(response.code ?? "?") err=\(response.error ?? "?")\n", stderr)
        } else {
            fputs("[canvas-mut] remove ok target=\(targetID) orphan=\(orphanChildren)\n", stderr)
        }
    }

    func getLastPosition(key: String) -> (x: Double, y: Double)? {
        lastPositionsLock.lock()
        let pos = lastPositions[key]
        lastPositionsLock.unlock()
        return pos
    }

    /// Request/response: return the stored lastPosition for `key` or
    /// null if none. Required payload field: key (String). Optional:
    /// request_id (String) for correlation.
    private func handlePositionGet(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        if requestID == nil {
            fputs("[position] get from canvas=\(callerID) missing request_id — no response can be delivered\n", stderr)
        }
        guard let key = payload["key"] as? String, !key.isEmpty else {
            if let rid = requestID {
                dispatchCanvasResponse(to: callerID, requestID: rid,
                    status: "error", code: "MISSING_KEY",
                    message: "position.get requires key")
            }
            return
        }
        lastPositionsLock.lock()
        let pos = lastPositions[key]
        lastPositionsLock.unlock()

        var extra: [String: Any] = ["key": key]
        if let p = pos {
            extra["position"] = ["x": p.x, "y": p.y]
        } else {
            extra["position"] = NSNull()
        }
        if let rid = requestID {
            dispatchCanvasResponse(to: callerID, requestID: rid,
                status: "ok", extra: extra)
        }
    }

    /// Fire-and-forget: record the current position for `key`. Required
    /// payload fields: key (String), x (Double), y (Double). No response
    /// emitted; caller is expected to treat this as eventually-consistent.
    private func handlePositionSet(callerID: String, payload: [String: Any]) {
        guard let key = payload["key"] as? String, !key.isEmpty,
              let x = (payload["x"] as? NSNumber)?.doubleValue,
              let y = (payload["y"] as? NSNumber)?.doubleValue else {
            fputs("[position] malformed set from canvas=\(callerID); ignoring\n", stderr)
            return
        }
        lastPositionsLock.lock()
        lastPositions[key] = (x: x, y: y)
        lastPositionsLock.unlock()
    }

    private func handleDesktopFrameAcquire(callerID: String, payload: [String: Any]) {
        desktopFrameCapture.acquire(
            callerCanvasID: callerID,
            payload: payload,
            admitted: { [weak self] (request: AOSDesktopFrameCaptureRequest) -> Bool in
                guard let self else { return false }
                return self.canvasManager.postMessage(
                    canvasID: callerID,
                    exactDesktopFrameConsumers: request.consumers,
                    payload: [
                        "type": "desktop_frame.started",
                        "status": "ok",
                        "request_id": request.requestID,
                        "owner": request.authorization.ownerID,
                        "resource": request.authorization.resourceID,
                        "revision": request.authorization.resourceRevision,
                        "extension": request.authorization.extensionReference.dictionary,
                    ]
                )
            }
        ) { [weak self] outcome in
            guard let self else { return }
            switch outcome {
            case .available(let delivery):
                var response = delivery.payload
                response["type"] = "desktop_frame.available"
                response["status"] = "ok"
                response["request_id"] = delivery.requestID
                guard self.canvasManager.postMessage(
                    canvasID: callerID,
                    exactDesktopFrameConsumers: delivery.consumers,
                    payload: response
                ) else {
                    _ = self.desktopFrameCapture.cancel(
                        callerCanvasID: callerID,
                        payload: ["request_id": delivery.requestID]
                    )
                    return
                }
            case .rejected(let request, let code):
                guard let request else { return }
                _ = self.canvasManager.postMessage(
                    canvasID: callerID,
                    exactDesktopFrameConsumers: request.consumers,
                    payload: [
                        "type": "desktop_frame.available",
                        "status": "error",
                        "code": code,
                        "request_id": request.requestID,
                        "owner": request.authorization.ownerID,
                        "resource": request.authorization.resourceID,
                        "revision": request.authorization.resourceRevision,
                        "extension": request.authorization.extensionReference.dictionary,
                    ]
                )
            }
        }
    }

    private func handleDesktopFrameReady(callerID: String, payload: [String: Any]) {
        guard case .commit(let delivery) = desktopFrameCapture.ready(
            callerCanvasID: callerID,
            payload: payload
        ) else { return }
        var response = delivery.payload
        response["type"] = "desktop_frame.commit"
        response["status"] = "ok"
        response["request_id"] = delivery.requestID
        guard canvasManager.postMessage(
            canvasID: callerID,
            exactDesktopFrameConsumers: delivery.consumers,
            payload: response
        ) else {
            _ = desktopFrameCapture.release(delivery)
            return
        }
    }

    private func deliverDesktopFrameAbort(_ abort: AOSDesktopFrameCaptureAbort) {
        var response = abort.payload
        response["type"] = "desktop_frame.abort"
        response["status"] = "ok"
        response["request_id"] = abort.requestID
        _ = canvasManager.postMessage(
            canvasID: sceneStageCanvasID,
            exactDesktopFrameConsumers: abort.consumers,
            payload: response
        )
    }

    private func handleDesktopFramePresented(callerID: String, payload: [String: Any]) {
        guard case .complete(let delivery) = desktopFrameCapture.presented(
            callerCanvasID: callerID,
            payload: payload
        ) else { return }
        var response = delivery.payload
        response["type"] = "desktop_frame.complete"
        response["status"] = "ok"
        response["request_id"] = delivery.requestID
        _ = canvasManager.postMessage(
            canvasID: callerID,
            exactDesktopFrameConsumers: delivery.consumers,
            payload: response
        )
    }

    private func handleDesktopFrameRelease(callerID: String, payload: [String: Any]) {
        _ = desktopFrameCapture.release(callerCanvasID: callerID, payload: payload)
    }

    // MARK: - Connection Handling

    private func acceptLoop() {
        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }
            _ = disableSigPipe(clientFD)
            let accepted: (AOSOwnerRootBinding, UInt64)
            do {
                accepted = try operationAcceptedPeer(socketFD: clientFD)
            } catch {
                close(clientFD)
                continue
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(
                    clientFD,
                    ownerBinding: accepted.0,
                    connectionEpoch: accepted.1
                )
            }
        }
    }

    private func operationAcceptedPeer(
        socketFD: Int32
    ) throws -> (AOSOwnerRootBinding, UInt64) {
        let binding = try operationResolveOwner(socketFD: socketFD)
        guard binding.immediatePeer.effectiveUID == geteuid() else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        operationConnectionEpochLock.lock()
        defer { operationConnectionEpochLock.unlock() }
        guard operationNextConnectionEpoch < UInt64.max else {
            throw AOSOperationCoreError.generationConflict
        }
        let epoch = operationNextConnectionEpoch
        operationNextConnectionEpoch += 1
        return (binding, epoch)
    }

    private func operationResolveOwner(
        socketFD: Int32
    ) throws -> AOSOwnerRootBinding {
        guard let registry = operationRegistry else {
            throw AOSOperationCoreError.storeUnavailable
        }
        let currentImage = try operationImageProvider.imageEvidence(for: getpid())
        let classifier = AOSRuntimeOwnerRootClassifier(
            currentAOSImage: currentImage,
            adapterRegistrationID: AOSMicrophoneOperationAdapter.registrationID,
            adapterRegistrationRevision: AOSMicrophoneOperationAdapter.registrationRevision,
            spawnRecordLookup: { observation in
                registry.exactExternalSpawnSkipRecord(observation: observation)
            }
        )
        let resolver = AOSOwnerRootResolver(
            observer: AOSDarwinOwnerRootObserver(imageProvider: operationImageProvider),
            classifier: classifier,
            unverifiedAdapterDisposition: .reject
        )
        let binding = try resolver.resolve(socketFD: socketFD)
        return binding
    }

    private func handleConnection(
        _ clientFD: Int32,
        ownerBinding: AOSOwnerRootBinding,
        connectionEpoch: UInt64
    ) {
        let connectionID = UUID()
        let outbound = AOSConnectionOutboundWriter(connectionID: connectionID, fd: clientFD)

        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscribers[connectionID] = SubscriberConnection(
            outbound: outbound,
            publicCapture: nil,
            publicCaptureToken: nil,
            perceptionChannelIDs: [],
            isSubscribed: false,
            wantsInputEvents: false,
            sceneMonitorResource: nil,
            sceneMonitorRef: nil,
            sceneMonitorReady: false,
            operationConnectionEpoch: connectionEpoch,
            operationSocketFD: clientFD,
            operationPeer: ownerBinding.immediatePeer,
            operationOwnerRoot: AOSMechanicalOwnerRoot(verified: ownerBinding),
            externalBoundOperation: nil
        )
        subscriberLock.unlock()

        defer {
            subscriberLock.lock()
            let publicCapture = subscribers[connectionID]?.publicCapture
            let externalBoundOperation = subscribers[connectionID]?.externalBoundOperation
            subscribers[connectionID]?.publicCapture = nil
            subscribers[connectionID]?.publicCaptureToken = nil
            subscriberLock.unlock()
            publicCapture?.cancel()
            operationMicrophoneAdapter?.connectionClosedBeforeAuthority(owner: connectionID)
            voiceTransport.connectionClosed(connectionID)
            annotationSelection.connectionClosed(connectionID)
            desktopFrameCaptureConsent.connectionClosed(connectionID)
            statusItemHostController.connectionClosed(connectionID)
            desktopWorldSceneTransport.cleanupConnection(connectionID)
            subscriberLock.lock()
            let hadSceneMonitor = subscribers[connectionID]?.sceneMonitorResource != nil
            if let conn = subscribers[connectionID] {
                perception.attention.removeChannels(conn.perceptionChannelIDs)
            }
            subscribers.removeValue(forKey: connectionID)
            activeConnections.remove(connectionID)
            subscriberLock.unlock()
            if hadSceneMonitor { _ = configureDesktopWorldDevToolsStage() }

            // Clean up connection-scoped canvases on main thread
            DispatchQueue.main.async { [weak self] in
                self?.canvasManager.cleanupConnection(connectionID)
                self?.checkIdle()
            }

            outbound.closeAndWait()
            close(clientFD)
            if let externalBoundOperation {
                scheduleExternalSpawnRetirement(operation: externalBoundOperation, attempt: 0)
            }
        }

        cancelIdleTimer()

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            if bytesRead == 0 { break }
            if bytesRead < 0 {
                if errno == EINTR { continue }
                if errno == EAGAIN || errno == EWOULDBLOCK {
                    var descriptor = pollfd(fd: clientFD, events: Int16(POLLIN), revents: 0)
                    let pollResult = poll(&descriptor, 1, 1_000)
                    if pollResult < 0 {
                        if errno == EINTR { continue }
                        break
                    }
                    if pollResult == 0 { continue }
                    if descriptor.revents & Int16(POLLIN) != 0 { continue }
                    let failedEvents = Int16(POLLERR | POLLHUP | POLLNVAL)
                    if descriptor.revents & failedEvents != 0 { break }
                    continue
                }
                break
            }
            buffer.append(contentsOf: chunk[0..<bytesRead])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else {
                    sendResponseJSON(to: outbound, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
                    continue
                }

                handleRequest(json: json, connectionID: connectionID, outbound: outbound)
            }
        }
    }

    // MARK: - Envelope Helpers (v1 IPC)

    /// Returns true if the JSON has the v:1 version marker that signals an envelope request.
    private func isEnvelopeShape(_ json: [String: Any]) -> Bool {
        return json["v"] as? Int == 1
    }

    /// Strict parser for a v1 envelope with invocation-scoped attribution.
    private func parseEnvelope(
        _ json: [String: Any]
    ) -> (
        service: String,
        action: String,
        data: [String: Any],
        ref: String?,
        attribution: AOSOperationAttribution
    )? {
        let requiredKeys: Set<String> = ["v", "service", "action", "data"]
        let allowedKeys = requiredKeys.union(["ref", "asserted_attribution"])
        guard requiredKeys.isSubset(of: Set(json.keys)),
              Set(json.keys).isSubset(of: allowedKeys) else { return nil }
        guard let v = json["v"] as? Int, v == 1 else { return nil }
        guard let service = json["service"] as? String, !service.isEmpty else { return nil }
        guard let action = json["action"] as? String, !action.isEmpty else { return nil }
        guard let data = json["data"] as? [String: Any] else { return nil }
        let ref: String?
        if json.keys.contains("ref") {
            guard let value = json["ref"] as? String else { return nil }
            ref = value
        } else {
            ref = nil
        }
        let hasAttribution = json.keys.contains("asserted_attribution")
        guard !hasAttribution
                || (service == "operation" && action == "external_spawn_intent"),
              let attribution = try? AOSOperationAttribution.validatingPublicValue(
                json["asserted_attribution"]
              ) else { return nil }
        return (service, action, data, ref, attribution)
    }

    private func pointFromAuditRequest(_ json: [String: Any]) -> CGPoint? {
        if let point = json["point"] as? [Double], point.count >= 2 {
            return CGPoint(x: point[0], y: point[1])
        }
        if let point = json["point"] as? [CGFloat], point.count >= 2 {
            return CGPoint(x: point[0], y: point[1])
        }
        guard let x = json["x"], let y = json["y"] else { return nil }
        func number(_ value: Any) -> CGFloat? {
            if let value = value as? CGFloat { return value }
            if let value = value as? Double { return CGFloat(value) }
            if let value = value as? Int { return CGFloat(value) }
            if let value = value as? NSNumber { return CGFloat(truncating: value) }
            if let value = value as? String, let parsed = Double(value) { return CGFloat(parsed) }
            return nil
        }
        guard let px = number(x), let py = number(y) else { return nil }
        return CGPoint(x: px, y: py)
    }

    private func hasDesktopWorldSceneMonitor() -> Bool {
        subscriberLock.lock()
        defer { subscriberLock.unlock() }
        return subscribers.values.contains(where: { $0.sceneMonitorResource != nil })
    }

    private func handleDesktopWorldDevToolsStageSnapshot(_ payload: [String: Any]) {
        guard desktopWorldDevTools.handleStageSnapshot(payload) == .committed else { return }
        publishDesktopWorldSceneMonitorSnapshots()
    }

    private func publishDesktopWorldDevToolsSnapshots(hostID: String? = nil) {
        desktopWorldDevTools.publishSnapshots(hostID: hostID)
    }

    private func configureDesktopWorldDevToolsStage() -> Bool {
        desktopWorldDevTools.configureStage()
    }

    private func publishDesktopWorldSceneMonitorSnapshots() {
        subscriberLock.lock()
        let monitors = subscribers.compactMap { _, connection -> (AOSConnectionOutboundWriter, String, String?)? in
            guard connection.sceneMonitorReady,
                  let resource = connection.sceneMonitorResource else { return nil }
            return (connection.outbound, resource, connection.sceneMonitorRef)
        }
        subscriberLock.unlock()
        for (outbound, resource, ref) in monitors {
            guard let snapshot = desktopWorldDevTools.stageSnapshot(resourceID: resource),
                  let bytes = envelopeBytes(
                    service: "scene",
                    event: "monitor",
                    data: ["resource": resource, "snapshot": snapshot],
                    ref: ref
                  ) else { continue }
            outbound.enqueue(bytes)
        }
    }

    private func handleDesktopWorldSceneMonitor(
        json: [String: Any],
        connectionID: UUID,
        outbound: AOSConnectionOutboundWriter,
        envelopeActive: Bool,
        envelopeRef: String?
    ) {
        guard let resource = json["resource"] as? String,
              desktopWorldSceneTransport.validResourceIdentifier(resource) else {
            sendResponseJSON(to: outbound, ["error": "Invalid DesktopWorld resource", "code": "INVALID_SCENE_RESOURCE"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        subscriberLock.lock()
        subscribers[connectionID]?.sceneMonitorResource = resource
        subscribers[connectionID]?.sceneMonitorRef = envelopeRef
        subscribers[connectionID]?.sceneMonitorReady = false
        subscriberLock.unlock()
        guard configureDesktopWorldDevToolsStage() else {
            subscriberLock.lock()
            subscribers[connectionID]?.sceneMonitorResource = nil
            subscribers[connectionID]?.sceneMonitorRef = nil
            subscribers[connectionID]?.sceneMonitorReady = false
            subscriberLock.unlock()
            sendResponseJSON(to: outbound, ["error": "DesktopWorld scene stage is unavailable", "code": "SCENE_STAGE_UNAVAILABLE"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        sendResponseJSON(to: outbound, ["status": "ok", "resource": resource, "following": true], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
        subscriberLock.lock()
        subscribers[connectionID]?.sceneMonitorReady = true
        subscriberLock.unlock()
        publishDesktopWorldSceneMonitorSnapshots()
    }

    private func handleDesktopWorldDevToolsHostCommand(callerID: String, payload: [String: Any]) {
        desktopWorldDevTools.handleHostCommand(callerID: callerID, payload: payload)
    }

    private func handleDesktopWorldDevToolsCommand(
        action: String,
        json: [String: Any],
        outbound: AOSConnectionOutboundWriter,
        envelopeActive: Bool,
        envelopeRef: String?
    ) {
        let response = desktopWorldDevTools.handleCommand(action: action, payload: json)
        sendResponseJSON(
            to: outbound,
            response,
            envelopeActive: envelopeActive,
            envelopeRef: envelopeRef
        )
    }

    /// Map a v1 envelope pair to the internal switch action. Returns nil when
    /// the pair is outside the current v1 catalog.
    private func internalActionName(service: String, action: String) -> String? {
        switch (service, action) {
        case ("see", "observe"):              return "subscribe"
        case ("show", "create"):              return "create"
        case ("show", "update"):              return "update"
        case ("show", "eval"):                return "eval"
        case ("show", "remove"):              return "remove"
        case ("show", "remove_all"):          return "remove-all"
        case ("show", "list"):                return "list"
        case ("show", "audit"):               return "audit"
        case ("show", "post"):                return "post"
        case ("see", "snapshot"):             return "snapshot"
        case ("see", "capture"):              return "capture"
        case ("tell", "send"):                return "tell"
        case ("listen", "read"):              return "coord-read"
        case ("listen", "channels"):          return "coord-channels"
        case ("listen", "hotkey"):            return "voice-hotkey"
        case ("listen", "microphone"):        return "voice-microphone"
        case ("listen", "microphone_segmented"):
                                                return "voice-microphone-segmented"
        case ("listen", "stop"):              return "voice-capture-stop"
        case ("listen", "cancel"):            return "voice-capture-cancel"
        case ("session", "register"):         return "coord-register"
        case ("session", "unregister"):       return "coord-unregister"
        case ("session", "who"):              return "coord-who"
        case ("voice", "list"):               return "voice-list"
        case ("voice", "microphone_authorization_status"):
                                                return "voice-microphone-authorization-status"
        case ("voice", "microphone_authorization_request"):
                                                return "voice-microphone-authorization-request"
        case ("permissions", "screen_capture_direct_status"):
                                                return "permissions-screen-capture-direct-status"
        case ("permissions", "screen_capture_direct_prime"):
                                                return "permissions-screen-capture-direct-prime"
        case ("voice", "assignments"):        return "voice-assignments"
        case ("voice", "refresh"):            return "voice-refresh"
        case ("voice", "providers"):          return "voice-providers"
        case ("voice", "bind"):               return "voice-bind"
        case ("voice", "next"):               return "voice-next"
        case ("voice", "final_response"):     return "voice-final-response"
        case ("voice", "speak"):              return "voice-speak"
        case ("voice", "playback"):           return "voice-playback"
        case ("voice", "cancel"):             return "voice-speech-cancel"
        case ("annotation", "select"):        return "annotation-select"
        case ("annotation", "cancel"):        return "annotation-select-cancel"
        case ("status_item", "register"):     return "status-item-register"
        case ("status_item", "update"):       return "status-item-update"
        case ("status_item", "inspect"):      return "status-item-inspect"
        case ("status_item", "invoke"):       return "status-item-invoke"
        case ("status_item", "invoke_dry_run"):
                                                return "status-item-invoke-dry-run"
        case ("scene", "follow"):             return "scene-follow"
        case ("scene", "devtools_open"):      return "scene-devtools-open"
        case ("scene", "devtools_status"):    return "scene-devtools-status"
        case ("scene", "devtools_update"):    return "scene-devtools-update"
        case ("scene", "devtools_transfer"):  return "scene-devtools-transfer"
        case ("scene", "devtools_close"):     return "scene-devtools-close"
        case ("scene", "devtools_monitor"):   return "scene-devtools-monitor"
        case ("scene", "effect_trigger"):     return "scene-effect-trigger"
        case ("system", "ping"):              return "ping"
        // Content server actions
        case ("content", "status"):           return "content_status"
        // Focus channel actions
        case ("focus", "list"):               return "focus-list"
        case ("focus", "create"):             return "focus-create"
        case ("focus", "update"):             return "focus-update"
        case ("focus", "remove"):             return "focus-remove"
        // Graph navigation actions
        case ("graph", "displays"):           return "graph-displays"
        case ("graph", "windows"):            return "graph-windows"
        case ("graph", "deepen"):             return "graph-deepen"
        case ("graph", "collapse"):           return "graph-collapse"
        default:                               return nil
        }
    }

    /// Convert a CanvasResponse to a plain dictionary suitable for sendResponseJSON.
    private func canvasResponseDict(_ r: CanvasResponse) -> [String: Any] {
        var d: [String: Any] = [:]
        if let status = r.status { d["status"] = status }
        if let error = r.error   { d["error"] = error }
        if let code = r.code     { d["code"] = code }
        if let result = r.result { d["result"] = result }
        if let uptime = r.uptime { d["uptime"] = uptime }
        if let canvases = r.canvases,
           let data = try? JSONEncoder().encode(canvases),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            d["canvases"] = arr
        }
        return d
    }

    /// Build an envelope error response dict.
    private func envelopeError(error: String, code: String, ref: String?) -> [String: Any] {
        var out: [String: Any] = ["v": 1, "status": "error", "error": error, "code": code]
        if let ref = ref { out["ref"] = ref }
        return out
    }

    // MARK: - Sovereign operation control

    private func handleOperationAction(
        action: String,
        data: [String: Any],
        attribution: AOSOperationAttribution,
        connectionID: UUID,
        outbound: AOSConnectionOutboundWriter,
        envelopeRef: String?
    ) {
        defer { _ = operationStatusItemProjection?.refresh() }
        do {
            reapExpiredExternalSpawnIntents()
            if action == "external_spawn_intent" {
                let result = try prepareExternalSpawnIntent(
                    data: data,
                    attribution: attribution,
                    connectionID: connectionID
                )
                sendResponseJSON(
                    to: outbound,
                    result,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
                return
            }
            if action == "external_spawn_child_admit" {
                let result = try admitExternalSpawnChild(
                    data: data,
                    connectionID: connectionID
                )
                sendResponseJSON(
                    to: outbound,
                    result,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
                return
            }
            if action == "external_spawn_abandon" {
                let result = try abandonExternalSpawn(
                    data: data,
                    connectionID: connectionID
                )
                sendResponseJSON(
                    to: outbound,
                    result,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
                return
            }
            if action == "external_spawn_finalize" {
                let result = try finalizeExternalSpawn(
                    data: data,
                    connectionID: connectionID
                )
                sendResponseJSON(
                    to: outbound,
                    result,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
                return
            }
            guard [
                "list", "inspect", "status", "recent", "cancel", "kill", "kill_owner",
                "record_screen",
                "tap", "artifact_reveal", "artifact_remove", "artifact_release",
                "artifact_retain", "stop_all", "barrier_status", "reopen",
            ].contains(action) else {
                throw AOSOperationCoreError.invalidRecord("operation_action")
            }
            try validateOperationParameterDigest(action: action, data: data)
            let identity = try operationConnectionIdentity(
                connectionID: connectionID,
                revalidate: true
            )
            guard let registry = operationRegistry,
                  let control = operationControlPlane else {
                throw AOSOperationCoreError.storeUnavailable
            }
            let ordinary = AOSOrdinaryControlContext(
                expectedDaemonGeneration: operationDaemonGeneration,
                connectionEpoch: identity.connectionEpoch,
                caller: identity.caller,
                authenticatedOwnerRoot: identity.ownerRoot
            )
            let host = AOSHostControlContext(
                expectedDaemonGeneration: operationDaemonGeneration,
                connectionEpoch: identity.connectionEpoch,
                caller: identity.caller
            )
            let checkedAt = operationTimestamp(registry.now())

            switch action {
            case "record_screen":
                guard let adapter = operationScreenRecordingAdapter else {
                    throw AOSOperationCoreError.adapterRegistryConflict
                }
                let request = try AOSScreenRecordingRequest.validatingPublicValue(data)
                let admission = try adapter.start(request: request, connectionID: connectionID)
                sendResponseJSON(
                    to: outbound,
                    [
                        "schema_version": "aos.screen-recording.admission-result.v1",
                        "operation": [
                            "operation_id": admission.operation.id,
                            "operation_generation": admission.operation.generation,
                        ],
                        "stream": [
                            "stream_id": admission.stream.id,
                            "stream_generation": admission.stream.generation,
                        ],
                        "artifact": [
                            "artifact_id": admission.artifact.id,
                            "artifact_generation": admission.artifact.generation,
                        ],
                        "daemon_generation": admission.daemonGeneration,
                        "geometry_binding_digest": admission.geometryBindingDigest,
                        "tracks": [
                            "video": true,
                            "system_audio": false,
                            "microphone": false,
                        ],
                        "codec": AOSScreenRecordingRequest.codec,
                        "container": AOSScreenRecordingRequest.container,
                    ],
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "list", "recent":
                let filterPayload = data["filters"] as? [String: Any] ?? [:]
                let filter = operationFilter(filterPayload)
                var operations = try control.list(context: ordinary, filter: filter)
                operations = operations.filter {
                    action == "recent" ? $0.state == .terminal : $0.state != .terminal
                }
                if action == "recent" {
                    operations.sort { $0.updatedAtNanoseconds > $1.updatedAtNanoseconds }
                }
                let state = registry.snapshot()
                sendResponseJSON(
                    to: outbound,
                    [
                        "schema_version": "aos.operation.list-result.v1",
                        "operation": action,
                        "filters": filterPayload,
                        "operations": operations.prefix(4_096).map {
                            operationSnapshot($0, state: state)
                        },
                        "checked_at": checkedAt,
                    ],
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "inspect", "status":
                let selectorPayload = try operationSelectorPayload(data)
                let selector = try operationSelector(selectorPayload)
                let operation = try control.inspect(context: ordinary, operation: selector)
                sendResponseJSON(
                    to: outbound,
                    [
                        "schema_version": "aos.operation.inspect-result.v1",
                        "operation": action,
                        "selector": selectorPayload,
                        "snapshot": operationSnapshot(operation, state: registry.snapshot()),
                        "checked_at": checkedAt,
                    ],
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "cancel", "kill":
                let selector = try operationSelector(try operationSelectorPayload(data))
                let receipt = action == "cancel"
                    ? try control.cancel(context: ordinary, operation: selector)
                    : try control.kill(context: ordinary, operation: selector)
                sendResponseJSON(
                    to: outbound,
                    operationControlResult(receipt, registry: registry),
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "kill_owner":
                let receipt = try control.killOwner(
                    context: ordinary,
                    filter: operationFilter(data["filters"] as? [String: Any] ?? [:])
                )
                sendResponseJSON(
                    to: outbound,
                    operationControlResult(receipt, registry: registry),
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "stop_all", "barrier_status", "reopen":
                let request = try hostControlRequest(action: action, data: data)
                let response: [String: Any]
                if action == "stop_all" {
                    let receipt = try control.stopAll(context: host, request: request)
                    response = stopAllPayload(receipt)
                } else if action == "barrier_status" {
                    let receipt = try control.barrierStatus(context: host, request: request)
                    response = barrierStatusPayload(receipt, state: registry.snapshot())
                } else {
                    let receipt = try control.reopen(context: host, request: request)
                    response = reopenPayload(receipt)
                }
                sendResponseJSON(
                    to: outbound,
                    response,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            case "tap":
                throw AOSOperationCoreError.tapUnavailable
            case "artifact_reveal", "artifact_remove", "artifact_release", "artifact_retain":
                guard let adapter = operationScreenRecordingAdapter else {
                    throw AOSOperationCoreError.adapterRegistryConflict
                }
                let selector = try artifactSelector(data)
                let result: [String: Any]
                switch action {
                case "artifact_reveal":
                    result = try adapter.revealArtifact(selector, ownerRoot: identity.ownerRoot)
                case "artifact_remove":
                    result = try adapter.removeArtifact(selector, ownerRoot: identity.ownerRoot)
                case "artifact_release":
                    guard let destination = aosArtifactReleaseDestinationPath(
                        data["destination"]
                    ) else {
                        throw AOSOperationCoreError.invalidRecord("artifact_release_destination")
                    }
                    result = try adapter.releaseArtifact(
                        selector,
                        ownerRoot: identity.ownerRoot,
                        destinationPath: destination
                    )
                default:
                    try adapter.retainArtifact(selector)
                }
                sendResponseJSON(
                    to: outbound,
                    result,
                    envelopeActive: true,
                    envelopeRef: envelopeRef
                )
            default:
                throw AOSOperationCoreError.invalidRecord("operation_action")
            }
        } catch let error as AOSOperationCoreError {
            sendResponseJSON(
                to: outbound,
                ["error": error.description, "code": error.code],
                envelopeActive: true,
                envelopeRef: envelopeRef
            )
        } catch {
            sendResponseJSON(
                to: outbound,
                ["error": "Operation request failed.", "code": "OPERATION_RECORD_INVALID"],
                envelopeActive: true,
                envelopeRef: envelopeRef
            )
        }
    }

    private func validateOperationParameterDigest(
        action: String,
        data: [String: Any]
    ) throws {
        guard let requestID = aosOperationWireIdentifier(data["request_id"]),
              let supplied = data["canonical_parameter_digest"] as? String else {
            throw AOSOperationCoreError.invalidRecord("operation_request_identity")
        }
        _ = requestID
        var parameters = data
        parameters.removeValue(forKey: "request_id")
        parameters.removeValue(forKey: "canonical_parameter_digest")
        let input: [String: Any] = ["action": action, "parameters": parameters]
        guard JSONSerialization.isValidJSONObject(input),
              let canonical = try? JSONSerialization.data(
                  withJSONObject: input,
                  options: [.sortedKeys, .withoutEscapingSlashes]
              ) else {
            throw AOSOperationCoreError.invalidRecord("canonical_parameter_digest")
        }
        var material = Data("aos:operation-request:v1\n".utf8)
        material.append(canonical)
        let expected = SHA256.hash(data: material)
            .map { String(format: "%02x", $0) }.joined()
        guard supplied == expected else {
            throw AOSOperationCoreError.invalidRecord("canonical_parameter_digest")
        }
    }

    private func operationConnectionIdentity(
        connectionID: UUID,
        revalidate: Bool
    ) throws -> (
        connectionEpoch: UInt64,
        caller: AOSCallerEvidence,
        ownerRoot: AOSMechanicalOwnerRoot,
        binding: AOSOwnerRootBinding
    ) {
        subscriberLock.lock()
        guard let connection = subscribers[connectionID],
              let binding = connection.operationOwnerRoot.verifiedBinding else {
            subscriberLock.unlock()
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let socketFD = connection.operationSocketFD
        let epoch = connection.operationConnectionEpoch
        subscriberLock.unlock()
        let current = revalidate ? try operationResolveOwner(socketFD: socketFD) : binding
        guard current == binding, current.immediatePeer.effectiveUID == geteuid() else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let owner = AOSMechanicalOwnerRoot(verified: current)
        let peerGeneration = current.ancestorEdges.first?.child.generation
        guard let peerGeneration,
              peerGeneration.pid == current.immediatePeer.pid,
              peerGeneration.effectiveUID == current.immediatePeer.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let caller = AOSCallerEvidence.liveTransportPeer(AOSLiveTransportPeerEvidence(
            auditTokenDigest: try AOSOperationDigest.sha256(
                domain: .callerEvidence,
                current.immediatePeer.auditToken.words
            ),
            effectiveUID: current.immediatePeer.effectiveUID,
            pid: current.immediatePeer.pid,
            pidGeneration: operationPIDGeneration(peerGeneration)
        ))
        return (epoch, caller, owner, current)
    }

    private func operationPIDGeneration(_ identity: AOSProcessGenerationIdentity) -> UInt64 {
        let seconds = identity.startTimeSeconds.multipliedReportingOverflow(by: 1_000_000)
        guard !seconds.overflow else { return UInt64.max }
        let value = seconds.partialValue.addingReportingOverflow(identity.startTimeMicroseconds)
        return value.overflow ? UInt64.max : max(1, value.partialValue)
    }

    private func operationFilter(_ payload: [String: Any]) -> AOSOperationFilter {
        AOSOperationFilter(
            capabilityID: payload["capability_id"] as? String,
            clientID: payload["client_id"] as? String,
            agentID: payload["agent_id"] as? String,
            projectID: payload["project_id"] as? String,
            taskID: payload["task_id"] as? String,
            runID: payload["run_id"] as? String,
            skillID: payload["skill_id"] as? String,
            targetID: payload["target_id"] as? String,
            capabilityLabel: payload["capability_label"] as? String
        )
    }

    private func operationSelectorPayload(_ data: [String: Any]) throws -> [String: Any] {
        guard let selector = data["selector"] as? [String: Any] else {
            throw AOSOperationCoreError.invalidRecord("operation_selector")
        }
        return selector
    }

    private func operationSelector(_ selector: [String: Any]) throws -> AOSOperationIdentity {
        guard let identity = aosExactOperationWireIdentity(
            selector,
            idKey: "operation_id",
            generationKey: "operation_generation"
        ) else {
            throw AOSOperationCoreError.invalidRecord("operation_selector")
        }
        return identity
    }

    private func artifactSelector(_ data: [String: Any]) throws -> AOSOperationIdentity {
        guard let identity = aosExactOperationWireIdentity(
            data["selector"],
            idKey: "artifact_id",
            generationKey: "artifact_generation"
        ) else {
            throw AOSOperationCoreError.invalidRecord("artifact_selector")
        }
        return identity
    }

    private func hostControlRequest(
        action: String,
        data: [String: Any]
    ) throws -> AOSHostControlRequest {
        guard let requestID = data["request_id"] as? String,
              let digest = data["canonical_parameter_digest"] as? String,
              let hostAction = AOSHostControlAction(rawValue: action) else {
            throw AOSOperationCoreError.invalidRecord("host_control_request")
        }
        let expected = (data["expected_barrier_generation"] as? NSNumber)?.uint64Value
        return AOSHostControlRequest(
            requestID: requestID,
            action: hostAction,
            canonicalParameterDigest: digest,
            expectedBarrierGeneration: expected
        )
    }

    private func prepareExternalSpawnIntent(
        data: [String: Any],
        attribution: AOSOperationAttribution,
        connectionID: UUID
    ) throws -> [String: Any] {
        let requiredKeys: Set<String> = [
            "schema_version", "request_id", "route_source_id", "route_source_revision",
            "adapter_registration_id", "adapter_registration_revision", "resolved_executable",
            "expected_script_identity_digest", "expected_script_digest",
            "canonical_argv_shape_digest", "reviewed_dependency_set_digest",
        ]
        guard Set(data.keys) == requiredKeys,
              data["schema_version"] as? String
                == "aos.operation.external-spawn-intent-request.v1",
              let requestID = data["request_id"] as? String, !requestID.isEmpty,
              let routeSourceID = data["route_source_id"] as? String,
              let routeSourceRevisionRaw = data["route_source_revision"] as? String,
              let adapterID = data["adapter_registration_id"] as? String,
              let adapterRevision = (data["adapter_registration_revision"] as? NSNumber)?.uint64Value,
              let executablePayload = data["resolved_executable"] as? [String: Any],
              let expectedScriptIdentityRaw = data["expected_script_identity_digest"] as? String,
              let expectedScriptRaw = data["expected_script_digest"] as? String,
              let argvShapeRaw = data["canonical_argv_shape_digest"] as? String,
              let reviewedDependenciesRaw = data["reviewed_dependency_set_digest"] as? String,
              adapterID == AOSMicrophoneOperationAdapter.registrationID,
              adapterRevision == AOSMicrophoneOperationAdapter.registrationRevision,
              try reviewedExternalSpawnRegistrationMatches(data),
              let adapter = operationMicrophoneAdapter,
              let registry = operationRegistry else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_intent")
        }
        let routeSourceRevision = try AOSSHA256Digest(routeSourceRevisionRaw)
        let expectedScriptIdentity = try AOSSHA256Digest(expectedScriptIdentityRaw)
        let expectedScript = try AOSSHA256Digest(expectedScriptRaw)
        let argvShape = try AOSSHA256Digest(argvShapeRaw)
        let reviewedDependencies = try AOSSHA256Digest(reviewedDependenciesRaw)
        let executable = try operationResolvedExecutable(executablePayload)
        try validateResolvedExecutableTuple(executable)
        let identity = try operationConnectionIdentity(
            connectionID: connectionID,
            revalidate: true
        )
        try requireExternalSpawnDispatcher(identity.binding)
        guard let parent = identity.binding.ancestorEdges.first?.child.generation,
              parent.pid == identity.binding.immediatePeer.pid,
              parent.effectiveUID == identity.binding.immediatePeer.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let context = try operationContext(for: connectionID, attribution: attribution)
        let operation = try adapter.prepareExternalCapture(context: context)
        var tokenBytes = [UInt8](repeating: 0, count: 32)
        arc4random_buf(&tokenBytes, tokenBytes.count)
        let tokenData = Data(tokenBytes)
        let spawnRecordID = UUID().uuidString.lowercased()
        let intent = AOSExternalDispatchSpawnIntent(
            spawnRecordID: spawnRecordID,
            oneTimeBindingTokenDigest: .hashing(
                domain: .externalBindingToken,
                data: tokenData
            ),
            parent: parent,
            operationID: operation.id,
            operationGeneration: operation.generation,
            adapterID: adapterID,
            adapterRegistrationRevision: adapterRevision,
            routeSourceID: routeSourceID,
            routeSourceRevision: routeSourceRevision,
            executable: executable,
            expectedScriptIdentityDigest: expectedScriptIdentity,
            expectedScriptDigest: expectedScript,
            canonicalArgvShapeDigest: argvShape,
            reviewedDependencySetDigest: reviewedDependencies,
            daemonGeneration: operationDaemonGeneration,
            createdAtMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds,
            expiresAtMonotonicNanoseconds: try operationExternalSpawnExpiryDeadline(),
            admittedChild: nil
        )
        do {
            _ = try registry.installPendingExternalSpawnIntent(intent)
        } catch {
            adapter.abandonPreparedCapture(operation: operation)
            throw error
        }
        let token = tokenData.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return [
            "schema_version": "aos.operation.external-spawn-intent-response.v1",
            "request_id": requestID,
            "spawn_record_id": spawnRecordID,
            "one_time_binding_token": token,
            "operation_id": operation.id,
            "operation_generation": operation.generation,
            "adapter_registration_id": adapterID,
            "adapter_registration_revision": adapterRevision,
        ]
    }

    private func admitExternalSpawnChild(
        data: [String: Any],
        connectionID: UUID
    ) throws -> [String: Any] {
        guard Set(data.keys) == Set([
            "schema_version", "request_id", "one_time_binding_token", "child_pid",
        ]),
              data["schema_version"] as? String
                == "aos.operation.external-spawn-child-admit-request.v1",
              let requestID = data["request_id"] as? String, !requestID.isEmpty,
              let encodedToken = data["one_time_binding_token"] as? String,
              let token = operationDecodeBindingToken(encodedToken),
              let childPIDNumber = data["child_pid"] as? NSNumber,
              childPIDNumber.int64Value > 0,
              childPIDNumber.int64Value <= Int64(Int32.max),
              let registry = operationRegistry else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_child_admit")
        }
        let identity = try operationConnectionIdentity(
            connectionID: connectionID,
            revalidate: true
        )
        try requireExternalSpawnDispatcher(identity.binding)
        guard let authenticatedParent = identity.binding.ancestorEdges.first?.child.generation,
              authenticatedParent.pid == identity.binding.immediatePeer.pid,
              authenticatedParent.effectiveUID == identity.binding.immediatePeer.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let tokenDigest = AOSSHA256Digest.hashing(
            domain: .externalBindingToken,
            data: token
        )
        let intent = try registry.pendingExternalSpawnIntent(
            bindingTokenDigest: tokenDigest
        )
        guard intent.parent == authenticatedParent,
              let routeSourceID = intent.routeSourceID else {
            throw AOSOperationCoreError.ownerMismatch
        }
        let childPID = pid_t(childPIDNumber.int32Value)
        let edge = try operationImageProvider.stableProcessEdge(childPID: childPID)
        let evidence = try operationImageProvider.externalChildBootstrapEvidence(
            for: childPID,
            routeSourceID: routeSourceID
        )
        guard evidence.canonicalArgvShapeDigest == intent.canonicalArgvShapeDigest else {
            throw AOSExternalDispatchSpawnBindingError.argvShapeMismatch
        }
        let admitted = try registry.admitPendingExternalSpawnIntent(
            bindingTokenDigest: tokenDigest,
            oneTimeBindingToken: token,
            authenticatedParent: authenticatedParent,
            childEdge: edge,
            runningExecutable: evidence.runningExecutable,
            admittedAtMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds
        )
        guard let admission = admitted.admittedChild else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_child_admit")
        }
        return [
            "schema_version": "aos.operation.external-spawn-child-admit-response.v1",
            "request_id": requestID,
            "spawn_record_id": admitted.spawnRecordID,
            "operation_id": admitted.operationID,
            "operation_generation": admitted.operationGeneration,
            "child_pid": admission.child.pid,
            "child_pid_generation": try checkedOperationPIDGeneration(admission.child),
            "parent_edge_digest": admission.parentEdgeReceipt.digest.value,
            "platform_code_directory_hash": admission.runningExecutable
                .platformCodeDirectoryHash.value,
            "platform_code_directory_hash_algorithm": AOSPlatformCodeDirectoryHash.algorithm,
            "outcome": "generation_bound_spawn_child_admitted",
        ]
    }

    private func abandonExternalSpawn(
        data: [String: Any],
        connectionID: UUID
    ) throws -> [String: Any] {
        guard Set(data.keys) == Set([
            "schema_version", "request_id", "one_time_binding_token",
        ]),
              data["schema_version"] as? String
                == "aos.operation.external-spawn-abandon-request.v1",
              let requestID = data["request_id"] as? String, !requestID.isEmpty,
              let encodedToken = data["one_time_binding_token"] as? String,
              let token = operationDecodeBindingToken(encodedToken),
              let registry = operationRegistry,
              let adapter = operationMicrophoneAdapter else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_abandon")
        }
        let identity = try operationConnectionIdentity(
            connectionID: connectionID,
            revalidate: true
        )
        try requireExternalSpawnDispatcher(identity.binding)
        guard let authenticatedParent = identity.binding.ancestorEdges.first?.child.generation,
              authenticatedParent.pid == identity.binding.immediatePeer.pid,
              authenticatedParent.effectiveUID == identity.binding.immediatePeer.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let closed = try registry.abandonPendingExternalSpawnIntent(
            bindingTokenDigest: .hashing(domain: .externalBindingToken, data: token),
            authenticatedParent: authenticatedParent,
            closedAtMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds
        )
        let operation = AOSOperationIdentity(
            id: closed.operationID,
            generation: closed.operationGeneration
        )
        adapter.abandonPreparedCapture(operation: operation)
        return [
            "schema_version": "aos.operation.external-spawn-abandon-response.v1",
            "request_id": requestID,
            "spawn_record_id": closed.spawnRecordID,
            "operation_id": closed.operationID,
            "operation_generation": closed.operationGeneration,
            "outcome": closed.reason.rawValue,
        ]
    }

    private func finalizeExternalSpawn(
        data: [String: Any],
        connectionID: UUID
    ) throws -> [String: Any] {
        guard Set(data.keys) == Set(["schema_version", "request_id"]),
              data["schema_version"] as? String
                == "aos.operation.external-spawn-finalize-request.v1",
              let requestID = data["request_id"] as? String, !requestID.isEmpty,
              let registry = operationRegistry,
              let adapter = operationMicrophoneAdapter else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_finalize")
        }
        let identity = try operationConnectionIdentity(
            connectionID: connectionID,
            revalidate: true
        )
        guard let peerEdge = identity.binding.ancestorEdges.first,
              peerEdge.child.generation.pid == identity.binding.immediatePeer.pid,
              peerEdge.child.generation.effectiveUID
                == identity.binding.immediatePeer.effectiveUID else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        let intent = try registry.pendingExternalSpawnIntent(
            admittedChild: peerEdge.child.generation
        )
        guard let routeSourceID = intent.routeSourceID,
              intent.routeSourceRevision != nil,
              intent.admittedChild?.parentEdgeReceipt == peerEdge.receipt else {
            throw AOSOperationCoreError.invalidRecord("external_spawn_finalize")
        }
        do {
            let evidence = try operationImageProvider.externalChildBootstrapEvidence(
                for: identity.binding.immediatePeer.pid,
                routeSourceID: routeSourceID
            )
            let observation = AOSExternalDispatchFinalizationObservation(
                spawnRecordID: intent.spawnRecordID,
                peer: identity.binding.immediatePeer,
                parentEdge: peerEdge,
                runningExecutable: evidence.runningExecutable,
                operationID: intent.operationID,
                operationGeneration: intent.operationGeneration,
                adapterID: intent.adapterID,
                adapterRegistrationRevision: intent.adapterRegistrationRevision,
                canonicalArgvShapeDigest: evidence.canonicalArgvShapeDigest,
                finalizedAtMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds
            )
            let finalized = try registry.finalizePendingExternalSpawnIntent(
                observation: observation
            )
            let operation = AOSOperationIdentity(
                id: finalized.skipRecord.operationID,
                generation: finalized.skipRecord.operationGeneration
            )
            subscriberLock.lock()
            subscribers[connectionID]?.externalBoundOperation = operation
            subscriberLock.unlock()
            let updatedBinding = try operationResolveOwner(
                socketFD: operationSocketFD(connectionID)
            )
            guard AOSMechanicalOwnerRoot(verified: updatedBinding)
                    == (try registry.inspect(operation)).ownerRoot else {
                throw AOSOperationCoreError.ownerMismatch
            }
            try adapter.bindPrepreparedCapture(owner: connectionID, operation: operation)
            subscriberLock.lock()
            subscribers[connectionID]?.operationOwnerRoot = AOSMechanicalOwnerRoot(
                verified: updatedBinding
            )
            subscriberLock.unlock()
            return [
                "schema_version": "aos.operation.external-spawn-finalize-response.v1",
                "request_id": requestID,
                "spawn_record_id": finalized.skipRecord.spawnRecordID,
                "operation_id": finalized.skipRecord.operationID,
                "operation_generation": finalized.skipRecord.operationGeneration,
                "adapter_registration_id": finalized.skipRecord.adapterID,
                "adapter_registration_revision": finalized.skipRecord.adapterRegistrationRevision,
                "outcome": finalized.receipt.outcome.rawValue,
                "receipt": externalSpawnReceipt(finalized.receipt),
            ]
        } catch {
            _ = try? registry.rejectPendingExternalSpawnIntent(
                spawnRecordID: intent.spawnRecordID,
                operation: AOSOperationIdentity(
                    id: intent.operationID,
                    generation: intent.operationGeneration
                ),
                closedAtMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds
            )
            adapter.abandonPreparedCapture(operation: AOSOperationIdentity(
                id: intent.operationID,
                generation: intent.operationGeneration
            ))
            throw error
        }
    }

    private func operationSocketFD(_ connectionID: UUID) throws -> Int32 {
        subscriberLock.lock()
        defer { subscriberLock.unlock() }
        guard let descriptor = subscribers[connectionID]?.operationSocketFD else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
        return descriptor
    }

    private func operationDecodeBindingToken(_ value: String) -> Data? {
        guard value.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
            return nil
        }
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64), data.count == 32 else { return nil }
        return data
    }

    private func operationExternalSpawnExpiryDeadline() throws -> UInt64 {
        let now = DispatchTime.now().uptimeNanoseconds
        let result = now.addingReportingOverflow(operationExternalSpawnIntentTTLNanoseconds)
        guard !result.overflow else { throw AOSOperationCoreError.generationConflict }
        return result.partialValue
    }

    private func requireExternalSpawnDispatcher(
        _ binding: AOSOwnerRootBinding
    ) throws {
        guard let skipped = binding.skippedNodes.first,
              skipped.kind == .exactAOSImage,
              skipped.child.pid == binding.immediatePeer.pid,
              skipped.child.effectiveUID == binding.immediatePeer.effectiveUID,
              let proof = skipped.exactImageProof,
              proof.child == skipped.child,
              proof.immediatePeerAuditToken == binding.immediatePeer.auditToken,
              proof.adapterRegistrationID
                == AOSMicrophoneOperationAdapter.registrationID,
              proof.adapterRegistrationRevision
                == AOSMicrophoneOperationAdapter.registrationRevision else {
            throw AOSOperationCoreError.callerNotAuthenticated
        }
    }

    private func checkedOperationPIDGeneration(
        _ identity: AOSProcessGenerationIdentity
    ) throws -> UInt64 {
        let seconds = identity.startTimeSeconds.multipliedReportingOverflow(by: 1_000_000)
        guard !seconds.overflow else { throw AOSOperationCoreError.generationConflict }
        let value = seconds.partialValue.addingReportingOverflow(
            identity.startTimeMicroseconds
        )
        guard !value.overflow, value.partialValue > 0 else {
            throw AOSOperationCoreError.generationConflict
        }
        return value.partialValue
    }

    private func reapExpiredExternalSpawnIntents() {
        guard let registry = operationRegistry,
              let adapter = operationMicrophoneAdapter,
              operationDaemonGeneration > 0,
              let expired = try? registry.expirePendingExternalSpawnIntents(
                  daemonGeneration: operationDaemonGeneration,
                  nowMonotonicNanoseconds: DispatchTime.now().uptimeNanoseconds
              ) else { return }
        for intent in expired {
            adapter.abandonPreparedCapture(
                operation: AOSOperationIdentity(
                    id: intent.operationID,
                    generation: intent.operationGeneration
                ),
                trigger: .deadline
            )
        }
    }

    private func startOperationExternalSpawnExpiryTimer(
        bootRecoveryGeneration: UInt64,
        bootRecoveryClaimTokenDigest: String
    ) {
        operationExternalSpawnExpiryTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + .seconds(1), repeating: .seconds(1))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            self.reapExpiredExternalSpawnIntents()
            guard let registry = self.operationRegistry,
                  let control = self.operationControlPlane else { return }
            try? self.reconcileOperationBootRecoveryExternalChildren(
                registry: registry,
                control: control,
                recoveryGeneration: bootRecoveryGeneration,
                claimTokenDigest: bootRecoveryClaimTokenDigest
            )
        }
        operationExternalSpawnExpiryTimer = timer
        timer.resume()
    }

    private func operationResolvedExecutable(
        _ payload: [String: Any]
    ) throws -> AOSResolvedExecutableObservation {
        guard Set(payload.keys) == Set([
            "resolved_path_digest", "executable_identity_digest", "device", "inode",
            "code_identity_digest", "file_digest", "platform_code_directory_hash",
            "signing_identifier", "signing_team_identifier",
        ]),
              let path = payload["resolved_path_digest"] as? String,
              let identity = payload["executable_identity_digest"] as? String,
              let device = (payload["device"] as? NSNumber)?.uint64Value,
              let inode = (payload["inode"] as? NSNumber)?.uint64Value,
              inode > 0,
              let code = payload["code_identity_digest"] as? String,
              let file = payload["file_digest"] as? String,
              let platformCodeDirectoryHash
                = payload["platform_code_directory_hash"] as? String,
              payload["signing_identifier"] as? String == "node",
              payload["signing_team_identifier"] as? String == "HX7739G8FX" else {
            throw AOSOperationCoreError.invalidRecord("resolved_executable")
        }
        return AOSResolvedExecutableObservation(
            resolvedPathDigest: try AOSSHA256Digest(path),
            executableIdentityDigest: try AOSSHA256Digest(identity),
            device: device,
            inode: inode,
            codeIdentityDigest: try AOSSHA256Digest(code),
            fileDigest: try AOSSHA256Digest(file),
            platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
                platformCodeDirectoryHash
            ),
            signingIdentifier: "node",
            signingTeamIdentifier: "HX7739G8FX"
        )
    }

    private func validateResolvedExecutableTuple(
        _ executable: AOSResolvedExecutableObservation
    ) throws {
        let code = AOSSHA256Digest.hashing(
            domain: .executableCodeIdentity,
            data: Data(executable.fileDigest.value.utf8)
        )
        let identity = [
            String(executable.device), String(executable.inode),
            code.value, executable.fileDigest.value,
        ].joined(separator: "\u{1f}")
        guard code == executable.codeIdentityDigest,
              AOSSHA256Digest.hashing(
                  domain: .executableIdentity,
                  data: Data(identity.utf8)
              ) == executable.executableIdentityDigest else {
            throw AOSOperationCoreError.invalidRecord("resolved_executable")
        }
    }

    private func reviewedExternalSpawnRegistrationMatches(
        _ request: [String: Any]
    ) throws -> Bool {
        guard let repositoryRoot = aosCurrentRepoRoot() else { return false }
        let manifestURL = URL(fileURLWithPath: repositoryRoot, isDirectory: true)
            .appendingPathComponent("manifests/commands/aos-external-commands.json")
        let bytes = try Data(contentsOf: manifestURL, options: [.mappedIfSafe])
        guard let manifest = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let commands = manifest["commands"] as? [[String: Any]],
              let routeSourceID = request["route_source_id"] as? String,
              let route = commands.first(where: {
                  ($0["spawn_registration"] as? [String: Any])?["route_source_id"] as? String
                    == routeSourceID
              }),
              let registration = route["spawn_registration"] as? [String: Any],
              route["stdio"] as? String == "registered_bundle",
              route["argv_prefix"] as? [String]
                == ["node", "--input-type=module", "-", routeSourceID],
              let activation = registration["activation_predicate"] as? [String: Any],
              Set(activation.keys) == Set(["grammar"]),
              activation["grammar"] as? String == "listen_microphone_v1",
              let expectedIdentity = registration["expected_script_identity"] as? String,
              let expectedIdentityDigest = try? AOSExternalDispatchSpawnBinder
                .digestScriptIdentity(expectedIdentity).value else {
            return false
        }
        return registration["route_source_revision"] as? String
                == request["route_source_revision"] as? String
            && registration["adapter_registration_id"] as? String
                == request["adapter_registration_id"] as? String
            && (registration["adapter_registration_revision"] as? NSNumber)?.uint64Value
                == (request["adapter_registration_revision"] as? NSNumber)?.uint64Value
            && expectedIdentityDigest == request["expected_script_identity_digest"] as? String
            && registration["expected_script_digest"] as? String
                == request["expected_script_digest"] as? String
            && registration["canonical_argv_shape_digest"] as? String
                == request["canonical_argv_shape_digest"] as? String
            && registration["reviewed_dependency_set_digest"] as? String
                == request["reviewed_dependency_set_digest"] as? String
    }

    private func externalSpawnReceipt(
        _ receipt: AOSExternalDispatchSpawnReceipt
    ) -> [String: Any] {
        [
            "spawn_record_id": receipt.spawnRecordID,
            "operation_id": receipt.operationID,
            "operation_generation": receipt.operationGeneration,
            "adapter_registration_id": receipt.adapterID,
            "adapter_registration_revision": receipt.adapterRegistrationRevision,
            "resolved_executable_path_digest": receipt.resolvedExecutablePathDigest.value,
            "executable_identity_digest": receipt.executableIdentityDigest.value,
            "executable_file_digest": receipt.executableFileDigest.value,
            "platform_code_directory_hash": receipt.platformCodeDirectoryHash.value,
            "platform_code_directory_hash_algorithm": receipt.platformCodeDirectoryHashAlgorithm,
            "expected_script_identity_digest": receipt.expectedScriptIdentityDigest.value,
            "script_identity_digest": receipt.scriptIdentityDigest.value,
            "script_digest": receipt.scriptDigest.value,
            "canonical_argv_shape_digest": receipt.canonicalArgvShapeDigest.value,
            "reviewed_dependency_set_digest": receipt.reviewedDependencySetDigest.value,
            "outcome": receipt.outcome.rawValue,
        ]
    }

    private func operationTimestamp(_ nanoseconds: UInt64) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date(
            timeIntervalSince1970: Double(nanoseconds) / 1_000_000_000
        ))
    }

    private func operationSnapshot(
        _ operation: AOSOperationRecord,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let transactions = state.resourceTransactions.filter {
            $0.operation == operation.identity
        }
        let claims = state.resourceClaims.filter { $0.operation == operation.identity }
        let brokerIDs = Set(claims.compactMap(\.brokerID))
        let brokers = state.resourceBrokers.filter { brokerIDs.contains($0.brokerID) }
        let streams = state.streams.filter { $0.parentOperation == operation.identity }
        let taps = state.taps.filter { $0.parentOperation == operation.identity }
        let artifacts = state.artifacts.filter { $0.parentOperation == operation.identity }
        var residuals: [String] = []
        residuals += transactions.filter { $0.state != .terminal }.map {
            "claim-set:\($0.transactionID)"
        }
        residuals += claims.filter { $0.state != .terminal }.map {
            "claim:\($0.claimID):\($0.resourceGeneration)"
        }
        residuals += brokers.filter { $0.state != .terminal }.map {
            "broker:\($0.brokerID):\($0.brokerGeneration)"
        }
        residuals += streams.filter { $0.state != .terminal }.map {
            "stream:\($0.identity.id):\($0.identity.generation)"
        }
        residuals += taps.filter { $0.state != .terminal }.map {
            "tap:\($0.identity.id):\($0.identity.generation)"
        }
        residuals += artifacts.filter {
            ![AOSArtifactLifecycleState.offered, .released, .retained, .removed].contains($0.state)
        }.map { "artifact:\($0.identity.id):\($0.identity.generation)" }
        residuals += state.finalizedExternalSpawnRecords.filter {
            $0.skipRecord.operationID == operation.identity.id
                && $0.skipRecord.operationGeneration == operation.identity.generation
        }.map { "external-spawn:\($0.skipRecord.spawnRecordID)" }
        residuals.sort()
        let residualDigest = (try? AOSOperationDigest.sha256(
            domain: .residualSet,
            residuals
        )) ?? AOSOperationDigest.empty(.residualSet)
        let terminalAllowed = operation.state == .terminal && residuals.isEmpty
        let cleanupResult: String
        if terminalAllowed {
            cleanupResult = "zero_residuals"
        } else if [.cleanupRequired, .recovering].contains(operation.state) {
            cleanupResult = residuals.isEmpty ? "recovery_active" : "residuals_present"
        } else if [.stopping].contains(operation.state) {
            cleanupResult = "pending"
        } else {
            cleanupResult = "not_started"
        }
        let wireState = operation.state == .terminal && !residuals.isEmpty
            ? AOSOperationLifecycleState.cleanupRequired.rawValue
            : operation.state.rawValue
        let completedAt: Any = terminalAllowed
            ? operationTimestamp(operation.updatedAtNanoseconds) : NSNull()
        let terminal: Any = terminalAllowed
            ? operationTerminalFacts(operation) : NSNull()
        let startedAt: Any = operation.state == .prepared
            ? NSNull() : operationTimestamp(operation.updatedAtNanoseconds)
        return [
            "schema_version": "aos.operation.v1",
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
            "daemon_generation": operation.daemonGeneration,
            "adapter_registry_revision": state.adapterRegistry.revision,
            "adapter_registration": [
                "adapter_registration_id": operation.adapterRegistrationID,
                "adapter_registration_revision": operation.adapterRegistrationRevision,
            ],
            "capability_id": operation.capabilityID,
            "status_indicator_class": operation.state == .active ? "recording" : "neutral",
            "state": wireState,
            "lineage": operationLineage(operation),
            "requested_bounds": operation.requestedBounds.map {
                [
                    "max_duration_ms": $0.durationMilliseconds,
                    "frame_rate": $0.frameRate,
                    "max_pixel_count": $0.pixelCount,
                    "max_queue_items": $0.queueFrames,
                    "max_bytes": $0.maximumOutputBytes,
                ]
            } ?? [:],
            "progress": [
                "items": operation.progress?.frameCount ?? 0,
                "bytes": operation.progress?.byteCount ?? 0,
                "duration_ms": operation.progress?.elapsedMilliseconds ?? 0,
                "last_event_sequence": operation.progress?.frameCount ?? 0,
            ],
            "claim_set_transactions": transactions.map {
                operationClaimSetTransaction($0, state: state)
            },
            "resource_claims": claims.map(operationResourceClaim),
            "multiplex_brokers": brokers.map(operationBroker),
            "streams": streams.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "taps": taps.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "artifacts": artifacts.map {
                ["id": $0.identity.id, "generation": $0.identity.generation]
            },
            "cleanup": [
                "result": cleanupResult,
                "residual": [
                    "classification": residuals.isEmpty ? "none" : "present",
                    "count": residuals.count,
                    "digest": residualDigest,
                ],
                "completed_at": completedAt,
            ],
            "terminal": terminal,
            "prepared_at": operationTimestamp(operation.createdAtNanoseconds),
            "started_at": startedAt,
            "updated_at": operationTimestamp(operation.updatedAtNanoseconds),
        ]
    }

    private func operationLineage(_ operation: AOSOperationRecord) -> [String: Any] {
        let binding = operation.ownerRoot.verifiedBinding
        let immediate: [String: Any]
        let boundary: [String: Any]
        let edges: [[String: Any]]
        let proofs: [[String: Any]]
        let outcome: String
        if let binding {
            let peerGeneration = binding.ancestorEdges.first?.child.generation
                ?? binding.ownerRoot.generation
            immediate = [
                "audit_token": (try? AOSOperationDigest.sha256(
                    domain: .callerEvidence,
                    binding.immediatePeer.auditToken.words
                )) ?? AOSOperationDigest.empty(.callerEvidence),
                "effective_uid": binding.immediatePeer.effectiveUID,
                "pid": binding.immediatePeer.pid,
                "pid_generation": operationPIDGeneration(peerGeneration),
            ]
            boundary = operationProcessBoundary(binding.ownerRoot)
            edges = binding.ancestorEdges.map(operationAncestorEdge)
            proofs = binding.skippedNodes.compactMap(operationSkipProof)
            outcome = binding.outcome.rawValue
        } else {
            immediate = [
                "audit_token": AOSOperationDigest.empty(.callerEvidence),
                "effective_uid": operation.ownerRoot.effectiveUID,
                "pid": operation.ownerRoot.pid,
                "pid_generation": max(1, operation.ownerRoot.pidGeneration),
            ]
            boundary = [
                "effective_uid": operation.ownerRoot.effectiveUID,
                "pid": operation.ownerRoot.pid,
                "pid_generation": max(1, operation.ownerRoot.pidGeneration),
                "executable_identity_digest": operation.ownerRoot.executableIdentityDigest,
                "executable_file_digest": operation.ownerRoot.executableIdentityDigest,
            ]
            edges = []
            proofs = []
            outcome = "conservative_immediate_peer_boundary"
        }
        var attribution: [String: Any] = [:]
        let values: [(String, String?)] = [
            ("client_id", operation.attribution.clientID),
            ("agent_id", operation.attribution.agentID),
            ("project_id", operation.attribution.projectID),
            ("task_id", operation.attribution.taskID),
            ("run_id", operation.attribution.runID),
            ("skill_id", operation.attribution.skillID),
            ("target_id", operation.attribution.targetID),
            ("capability_label", operation.attribution.capabilityLabel),
            ("retry_id", operation.attribution.retryID),
        ]
        for (key, value) in values { if let value { attribution[key] = value } }
        return [
            "schema_version": "aos.operation-lineage.v1",
            "operation_id": operation.identity.id,
            "operation_generation": operation.identity.generation,
            "owner_root": [
                "capture_phase": "local_socket_accept",
                "resolver_outcome": outcome,
                "immediate_peer": immediate,
                "selected_boundary": boundary,
                "ancestor_edges": edges,
                "adapter_skip_proofs": proofs,
                "captured_at": operationTimestamp(operation.createdAtNanoseconds),
            ],
            "parent_operation": NSNull(),
            "mechanically_bound_scopes": [],
            "asserted_attribution": attribution,
        ]
    }

    private func operationProcessBoundary(
        _ observation: AOSProcessObservation
    ) -> [String: Any] {
        [
            "effective_uid": observation.generation.effectiveUID,
            "pid": observation.generation.pid,
            "pid_generation": operationPIDGeneration(observation.generation),
            "executable_identity_digest": observation.image.executableIdentityDigest.value,
            "executable_file_digest": observation.image.executableDigest.value,
        ]
    }

    private func operationStartTime(
        _ identity: AOSProcessGenerationIdentity
    ) -> [String: Any] {
        [
            "seconds": identity.startTimeSeconds,
            "microseconds": identity.startTimeMicroseconds,
        ]
    }

    private func operationAncestorEdge(_ edge: AOSStableProcessEdge) -> [String: Any] {
        [
            "child_pid": edge.child.generation.pid,
            "child_effective_uid": edge.child.generation.effectiveUID,
            "child_proc_start_time_sample_1": operationStartTime(edge.child.generation),
            "child_proc_start_time_sample_2": operationStartTime(edge.child.generation),
            "parent_pid": edge.parent.generation.pid,
            "parent_effective_uid": edge.parent.generation.effectiveUID,
            "parent_proc_start_time_sample_1": operationStartTime(edge.parent.generation),
            "parent_proc_start_time_sample_2": operationStartTime(edge.parent.generation),
            "same_observation_parent_edge_receipt": edge.receipt.digest.value,
            "executable_identity_digest": edge.child.image.executableIdentityDigest.value,
            "executable_file_digest": edge.child.image.executableDigest.value,
        ]
    }

    private func operationSkipProof(
        _ skipped: AOSOwnerRootSkippedNode
    ) -> [String: Any]? {
        if let proof = skipped.exactImageProof {
            return [
                "kind": "exact_aos_image",
                "evidence_scope": "verified_ancestor",
                "child_pid": proof.child.pid,
                "child_effective_uid": proof.child.effectiveUID,
                "child_pid_generation": operationPIDGeneration(proof.child),
                "parent_pid": proof.parent.pid,
                "parent_pid_generation": operationPIDGeneration(proof.parent),
                "same_observation_parent_edge_receipt": proof.parentEdgeReceipt.digest.value,
                "adapter_registration": [
                    "adapter_registration_id": proof.adapterRegistrationID,
                    "adapter_registration_revision": proof.adapterRegistrationRevision,
                ],
                "executable_identity_digest": proof.image.executableIdentityDigest.value,
                "executable_file_digest": proof.image.executableDigest.value,
            ]
        }
        if let record = skipped.spawnRecord {
            var result: [String: Any] = [
                "kind": "generation_bound_daemon_spawn_record",
                "evidence_scope": record.evidenceScope.rawValue,
                "spawn_record_id": record.spawnRecordID,
                "child_pid": record.child.pid,
                "child_effective_uid": record.child.effectiveUID,
                "child_pid_generation": operationPIDGeneration(record.child),
                "parent_pid": record.parent.pid,
                "parent_pid_generation": operationPIDGeneration(record.parent),
                "same_observation_parent_edge_receipt": record.parentEdgeReceipt.digest.value,
                "operation_id": record.operationID,
                "operation_generation": record.operationGeneration,
                "adapter_registration": [
                    "adapter_registration_id": record.adapterID,
                    "adapter_registration_revision": record.adapterRegistrationRevision,
                ],
                "executable_identity_digest": record.executableIdentityDigest.value,
                "executable_file_digest": record.executableDigest.value,
            ]
            if let token = record.childAuditToken {
                result["child_audit_token"] = (try? AOSOperationDigest.sha256(
                    domain: .callerEvidence,
                    token.words
                )) ?? AOSOperationDigest.empty(.callerEvidence)
            }
            return result
        }
        return nil
    }

    private func operationClaimRequest(_ request: AOSResourceClaimRequest) -> [String: Any] {
        var result: [String: Any] = [
            "adapter_registration_id": request.adapterRegistrationID,
            "adapter_registration_revision": request.adapterRegistrationRevision,
            "resource_key": request.resourceKey,
            "admission_mode": request.admissionMode.rawValue,
            "resource_declaration_digest": request.resourceDeclarationDigest,
            "expected_resource_generation": request.expectedResourceGeneration,
        ]
        if request.admissionMode == .multiplexable {
            result["expected_broker_generation"] = request.expectedBrokerGeneration ?? 0
            result["expected_subscriber_set_revision"] = request.expectedSubscriberSetRevision ?? 0
            result["expected_subscriber_set_count"] = request.expectedSubscriberSetCount ?? 0
            result["expected_subscriber_set_digest"] = request.expectedSubscriberSetDigest
                ?? AOSOperationDigest.empty(.subscriberSet)
        }
        return result
    }

    private func operationClaimSetTransaction(
        _ transaction: AOSResourceTransactionRecord,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let publishedCount = state.resourceClaims.filter {
            $0.transactionID == transaction.transactionID
        }.count
        return [
            "transaction_id": transaction.transactionID,
            "attempt_sequence": transaction.attemptSequence,
            "operation_id": transaction.operation.id,
            "operation_generation": transaction.operation.generation,
            "daemon_generation": transaction.daemonGeneration,
            "expected_barrier_generation": transaction.expectedBarrierGeneration,
            "expected_adapter_registry_revision": transaction.expectedAdapterRegistryRevision,
            "expected_resource_declaration_set_count": transaction.expectedResourceDeclarationSetCount,
            "expected_resource_declaration_set_digest": transaction.expectedResourceDeclarationSetDigest,
            "adapter_registry_revision": state.adapterRegistry.revision,
            "resource_declaration_set_count": state.adapterRegistry.resourceDeclarationSetCount,
            "resource_declaration_set_digest": state.adapterRegistry.resourceDeclarationSetDigest,
            "canonical_request_array": transaction.canonicalRequests.map(operationClaimRequest),
            "claim_set_digest": transaction.claimSetDigest,
            "state": transaction.state.rawValue,
            "recovery_disposition": transaction.recoveryDisposition?.rawValue ?? NSNull(),
            "receipt": [
                "outcome": publishedCount > 0 ? "committed" : "rejected",
                "attempt_sequence": transaction.attemptSequence,
                "conflict_resource_key": NSNull(),
                "published_claim_count": publishedCount,
            ],
        ]
    }

    private func operationResourceClaim(_ claim: AOSResourceClaimRecord) -> [String: Any] {
        var result: [String: Any] = [
            "claim_id": claim.claimID,
            "transaction_id": claim.transactionID,
            "operation_id": claim.operation.id,
            "operation_generation": claim.operation.generation,
            "resource_key": claim.resourceKey,
            "resource_generation": claim.resourceGeneration,
            "admission_mode": claim.admissionMode.rawValue,
            "adapter_registration_id": claim.adapterRegistrationID,
            "adapter_registration_revision": claim.adapterRegistrationRevision,
            "resource_declaration_digest": claim.resourceDeclarationDigest,
            "adapter_registry_revision": claim.adapterRegistryRevision,
            "resource_declaration_set_count": claim.resourceDeclarationSetCount,
            "resource_declaration_set_digest": claim.resourceDeclarationSetDigest,
            "committed_claim_set_transaction_id": claim.transactionID,
            "committed_claim_set_digest": claim.committedClaimSetDigest,
            "state": claim.state.rawValue,
            "reattach_binding": [
                "operation_generation": claim.operation.generation,
                "resource_generation": claim.resourceGeneration,
                "token_digest": claim.reattachTokenDigest,
            ],
        ]
        if claim.admissionMode == .multiplexable {
            result["broker_id"] = claim.brokerID
            result["broker_generation"] = claim.brokerGeneration
            result["subscriber_id"] = claim.subscriberID
        }
        return result
    }

    private func operationBroker(_ broker: AOSResourceBrokerRecord) -> [String: Any] {
        [
            "broker_id": broker.brokerID,
            "broker_generation": broker.brokerGeneration,
            "resource_key": broker.resourceKey,
            "resource_generation": broker.resourceGeneration,
            "adapter_registration_id": broker.adapterRegistrationID,
            "adapter_registration_revision": broker.adapterRegistrationRevision,
            "resource_declaration_digest": broker.resourceDeclarationDigest,
            "adapter_registry_revision": broker.adapterRegistryRevision,
            "resource_declaration_set_count": broker.resourceDeclarationSetCount,
            "resource_declaration_set_digest": broker.resourceDeclarationSetDigest,
            "committed_claim_set_transaction_id": broker.committedClaimSetTransactionID,
            "committed_claim_set_digest": broker.committedClaimSetDigest,
            "fanout_bound": broker.fanoutBound,
            "subscriber_set_count": broker.subscribers.count,
            "subscriber_set_revision": broker.subscriberSetRevision,
            "subscriber_set_digest": broker.subscriberSetDigest,
            "state": broker.state.rawValue,
        ]
    }

    private func operationTerminalFacts(_ operation: AOSOperationRecord) -> [String: Any] {
        let trigger: String
        let blame: String
        switch operation.stopIntent {
        case .complete: trigger = "adapter_complete"; blame = "adapter"
        case .cancel: trigger = "caller_cancel"; blame = "caller"
        case .kill: trigger = "kill_one"; blame = "aos_control_plane"
        case .ownerKill: trigger = "owner_kill"; blame = "aos_control_plane"
        case .hostStop: trigger = "host_stop_all"; blame = "host_shutdown"
        case .deadline: trigger = "deadline"; blame = "adapter"
        case .peerLost: trigger = "peer_lost"; blame = "caller"
        case .transportLost: trigger = "transport_lost"; blame = "caller"
        case .permissionRevoked: trigger = "permission_failure"; blame = "permission"
        case .adapterFailed: trigger = "adapter_failure"; blame = "adapter"
        case nil: trigger = "start_rejected"; blame = "unknown"
        }
        return [
            "outcome": (operation.outcome ?? .failed).rawValue,
            "trigger": trigger,
            "blame": blame,
            "duration_ms": (operation.updatedAtNanoseconds - operation.createdAtNanoseconds)
                / 1_000_000,
            "completed_at": operationTimestamp(operation.updatedAtNanoseconds),
        ]
    }

    private func operationControlResult(
        _ receipt: AOSOperationControlReceipt,
        registry: AOSOperationRegistry
    ) -> [String: Any] {
        let current = receipt.selectedOperations.compactMap { try? registry.inspect($0) }
        let cleanupRequired = current.contains {
            [.cleanupRequired, .recovering].contains($0.state)
        }
        return [
            "schema_version": "aos.operation.control-result.v1",
            "operation": receipt.action.rawValue,
            "outcome": receipt.selectedOperations.isEmpty
                ? "empty_selection" : (cleanupRequired ? "cleanup_required" : "accepted"),
            "selected_operation_count": receipt.selectedOperationCount,
            "selected_operation_digest": receipt.selectedOperationDigest,
            "results": current.map {
                [
                    "operation_id": $0.identity.id,
                    "operation_generation": $0.identity.generation,
                    "resulting_state": $0.state.rawValue,
                    "cleanup_result": [.cleanupRequired, .recovering].contains($0.state)
                        ? "residuals_present"
                        : ($0.state == .terminal ? "zero_residuals" : "pending"),
                ]
            },
            "completed_at": operationTimestamp(registry.now()),
        ]
    }

    private func callerEvidencePayload(_ caller: AOSCallerEvidence) -> [String: Any] {
        switch caller {
        case let .liveTransportPeer(value):
            return [
                "audit_token": value.auditTokenDigest,
                "effective_uid": value.effectiveUID,
                "pid": value.pid,
                "pid_generation": value.pidGeneration,
            ]
        case let .ordinaryCanvasCapturedPeer(value):
            return [
                "canvas_instance_id": value.canvasInstanceID,
                "canvas_generation": value.canvasGeneration,
                "capture_id": value.captureID,
                "captured_connection_epoch": value.capturedConnectionEpoch,
                "audit_token": value.auditTokenDigest,
                "effective_uid": value.effectiveUID,
                "pid": value.pid,
                "pid_generation": value.pidGeneration,
                "capture_is_live": value.captureIsLive,
            ]
        case let .statusItemHost(value):
            return [
                "status_host_id": value.statusHostID,
                "status_host_generation": value.statusHostGeneration,
                "daemon_generation": value.daemonGeneration,
                "effective_uid": value.effectiveUID,
            ]
        case let .statusOpenedCanvasHost(value):
            return [
                "canvas_instance_id": value.canvasInstanceID,
                "canvas_generation": value.canvasGeneration,
                "parent_status_host_id": value.parentStatusHostID,
                "parent_status_host_generation": value.parentStatusHostGeneration,
                "daemon_generation": value.daemonGeneration,
                "effective_uid": value.effectiveUID,
            ]
        }
    }

    private func stopAllPayload(_ receipt: AOSStopAllReceipt) -> [String: Any] {
        let snapshot = receipt.snapshot
        return [
            "schema_version": "aos.host-stop-barrier.stop-all-receipt.v1",
            "request_id": receipt.requestID,
            "canonical_parameter_digest": receipt.canonicalParameterDigest,
            "expected_barrier_generation": receipt.expectedBarrierGeneration,
            "daemon_generation": receipt.daemonGeneration,
            "stop_operation_id": snapshot.stopOperation.id,
            "stop_operation_generation": snapshot.stopOperation.generation,
            "caller_origin": receipt.callerOrigin.rawValue,
            "caller_origin_evidence": callerEvidencePayload(receipt.callerOriginEvidence),
            "scope": receipt.scope,
            "prior_barrier_state": receipt.priorBarrierState.rawValue,
            "prior_barrier_generation": receipt.priorBarrierGeneration,
            "resulting_barrier_state": receipt.resultingBarrierState.rawValue,
            "resulting_barrier_generation": receipt.resultingBarrierGeneration,
            "adapter_registry_revision": snapshot.adapterRegistryRevision,
            "registered_operation_set_count": snapshot.registeredOperationSetCount,
            "registered_operation_set_digest": snapshot.registeredOperationSetDigest,
            "selected_operation_count": snapshot.selectedOperationCount,
            "selected_operation_digest": snapshot.selectedOperationDigest,
            "barrier_snapshot_digest": snapshot.barrierSnapshotDigest,
            "outcome": receipt.outcome.rawValue,
            "residual_count": receipt.residualCount,
            "residual_digest": receipt.residualDigest,
            "cleanup_result": receipt.cleanupResult.rawValue,
        ]
    }

    private func barrierStatusPayload(
        _ receipt: AOSBarrierStatusReceipt,
        state: AOSOperationDurableState
    ) -> [String: Any] {
        let stop = receipt.stopSnapshot
        let registry = stop.map {
            ($0.adapterRegistryRevision, $0.registeredOperationSetCount, $0.registeredOperationSetDigest)
        } ?? (
            receipt.openSnapshot?.adapterRegistryRevision ?? state.adapterRegistry.revision,
            receipt.openSnapshot?.registeredOperationSetCount
                ?? state.adapterRegistry.registeredOperationSetCount,
            receipt.openSnapshot?.registeredOperationSetDigest
                ?? state.adapterRegistry.registeredOperationSetDigest
        )
        return [
            "schema_version": "aos.host-stop-barrier.status-receipt.v1",
            "request_id": receipt.requestID,
            "canonical_parameter_digest": receipt.canonicalParameterDigest,
            "daemon_generation": receipt.daemonGeneration,
            "caller_origin": receipt.callerOrigin.rawValue,
            "caller_origin_evidence": callerEvidencePayload(receipt.callerOriginEvidence),
            "barrier_generation": receipt.barrierGeneration,
            "barrier_state": receipt.barrierState.rawValue,
            "admission_open": receipt.admissionOpen,
            "stop_operation_id": stop?.stopOperation.id ?? NSNull(),
            "stop_operation_generation": stop?.stopOperation.generation ?? NSNull(),
            "adapter_registry_revision": registry.0,
            "registered_operation_set_count": registry.1,
            "registered_operation_set_digest": registry.2,
            "selected_operation_count": stop?.selectedOperationCount ?? 0,
            "selected_operation_digest": stop?.selectedOperationDigest
                ?? AOSOperationDigest.empty(.selectedOperationSet),
            "barrier_snapshot_digest": stop?.barrierSnapshotDigest ?? NSNull(),
            "residual_count": receipt.residualCount,
            "residual_digest": receipt.residualDigest,
            "reconciliation_state": operationReconciliationState(receipt.reconciliationState),
        ]
    }

    private func reopenPayload(_ receipt: AOSReopenReceipt) -> [String: Any] {
        let prior = receipt.priorSnapshot
        let opened = receipt.resultingOpenSnapshot
        return [
            "schema_version": "aos.host-stop-barrier.reopen-receipt.v1",
            "request_id": receipt.requestID,
            "canonical_parameter_digest": receipt.canonicalParameterDigest,
            "expected_barrier_generation": receipt.expectedBarrierGeneration,
            "caller_origin": receipt.callerOrigin.rawValue,
            "caller_origin_evidence": callerEvidencePayload(receipt.callerOriginEvidence),
            "prior_barrier_state": receipt.priorBarrierState.rawValue,
            "prior_barrier_generation": prior.barrierGeneration,
            "prior_stop_operation_id": prior.stopOperation.id,
            "prior_stop_operation_generation": prior.stopOperation.generation,
            "prior_adapter_registry_revision": prior.adapterRegistryRevision,
            "prior_registered_operation_set_count": prior.registeredOperationSetCount,
            "prior_registered_operation_set_digest": prior.registeredOperationSetDigest,
            "prior_selected_operation_count": prior.selectedOperationCount,
            "prior_selected_operation_digest": prior.selectedOperationDigest,
            "prior_barrier_snapshot_digest": prior.barrierSnapshotDigest,
            "prior_residual_count": receipt.priorResidualCount,
            "prior_residual_digest": receipt.priorResidualDigest,
            "resulting_barrier_state": receipt.resultingBarrierState.rawValue,
            "resulting_barrier_generation": receipt.resultingBarrierGeneration,
            "daemon_generation": receipt.daemonGeneration,
            "resulting_adapter_registry_revision": opened.adapterRegistryRevision,
            "resulting_registered_operation_set_count": opened.registeredOperationSetCount,
            "resulting_registered_operation_set_digest": opened.registeredOperationSetDigest,
            "resulting_open_snapshot_digest": opened.snapshotDigest,
            "outcome": receipt.outcome.rawValue,
            "cleanup_result": receipt.cleanupResult.rawValue,
            "reconciliation_state": operationReconciliationState(receipt.reconciliationState),
        ]
    }

    private func operationReconciliationState(_ value: String) -> String {
        switch value {
        case "complete": return "complete"
        case "blocked_unresolved", "residuals_present": return "blocked"
        case "pending": return "not_started"
        default: return "in_progress"
        }
    }

    // MARK: - Request Routing

    /// Top-level request gatekeeper. Enforces the v1 envelope contract.
    private func handleRequest(
        json: [String: Any],
        connectionID: UUID,
        outbound: AOSConnectionOutboundWriter
    ) {
        if isEnvelopeShape(json) {
            // Envelope request: routeAction will parse and dispatch it.
            routeAction("", json: json, outbound: outbound, connectionID: connectionID)
            return
        }
        // Non-envelope requests are rejected.
        sendResponseJSON(to: outbound, [
            "error": "Request envelope required ({v:1, service, action, data}).",
            "code": "PARSE_ERROR"
        ])
    }

    private func routeAction(
        _ action: String,
        json: [String: Any],
        outbound: AOSConnectionOutboundWriter,
        connectionID: UUID
    ) {
        // Envelope dispatch: translate (service, action) to the internal switch
        // action and reshape `data` into the handler input dictionary.
        if isEnvelopeShape(json) {
            guard let env = parseEnvelope(json) else {
                sendResponseJSON(to: outbound, envelopeError(
                    error: "Request envelope has v:1 but malformed fields",
                    code: "PARSE_ERROR",
                    ref: json["ref"] as? String
                ))
                return
            }
            // Check that the service is one of the known namespaces.
            let knownServices: Set<String> = ["see", "do", "show", "tell", "listen", "session", "voice", "permissions", "annotation", "status_item", "scene", "system", "focus", "graph", "content", "operation"]
            if !knownServices.contains(env.service) {
                sendResponseJSON(to: outbound, envelopeError(
                    error: "Unknown service: \(env.service)",
                    code: "UNKNOWN_SERVICE",
                    ref: env.ref
                ))
                return
            }
            if env.service == "operation" {
                handleOperationAction(
                    action: env.action,
                    data: env.data,
                    attribution: env.attribution,
                    connectionID: connectionID,
                    outbound: outbound,
                    envelopeRef: env.ref
                )
                return
            }
            let internalAction = internalActionName(service: env.service, action: env.action)
            guard let internalAction else {
                sendResponseJSON(to: outbound, envelopeError(
                    error: "Unknown (service, action): (\(env.service), \(env.action))",
                    code: "UNKNOWN_ACTION",
                    ref: env.ref
                ))
                return
            }
            if internalAction == "status-item-invoke" || internalAction == "status-item-invoke-dry-run" {
                statusItemHostController.handleCommand(
                    action: internalAction,
                    payload: env.data,
                    connectionID: connectionID,
                    ref: env.ref
                ) { result in
                    sendResponseJSON(to: outbound, result.response, envelopeActive: true, envelopeRef: env.ref)
                    result.afterResponse?()
                }
                return
            }
            // Reshape: merge `data` into a flat dict and set `action`.
            var flat = env.data
            flat["action"] = internalAction
            flat["__envelope_ref"] = env.ref ?? ""
            flat["__envelope_active"] = true
            if internalAction == "capture" {
                flat["__capture_payload"] = env.data
            }
            routeAction(internalAction, json: flat, outbound: outbound, connectionID: connectionID)
            return
        }

        let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
        let envelopeRef = json["__envelope_ref"] as? String

        switch action {

        // -- Perception actions --
        case "capture":
            let captureToken = UUID()
            subscriberLock.lock()
            let captureAdmitted: Bool
            if subscribers[connectionID]?.publicCaptureToken == nil {
                subscribers[connectionID]?.publicCaptureToken = captureToken
                captureAdmitted = true
            } else {
                captureAdmitted = false
            }
            subscriberLock.unlock()
            guard captureAdmitted else {
                sendResponseJSON(
                    to: outbound,
                    ["error": "Capture is already active", "code": "DESKTOP_FRAME_BUSY"],
                    envelopeActive: envelopeActive,
                    envelopeRef: envelopeRef
                )
                return
            }
            let capture = publicCaptureController.capture(
                payload: (json["__capture_payload"] as? [String: Any]) ?? [:],
                emitChunk: { data in
                    guard let bytes = envelopeBytes(
                        service: "see",
                        event: "capture_chunk",
                        data: data,
                        ref: envelopeRef
                    ) else { return false }
                    return outbound.enqueueAndWait(bytes)
                },
                completion: { [weak self, weak outbound] response in
                    guard let self else { return }
                    self.subscriberLock.lock()
                    let ownsCapture = self.subscribers[connectionID]?
                        .publicCaptureToken == captureToken
                    if ownsCapture {
                        self.subscribers[connectionID]?.publicCapture = nil
                        self.subscribers[connectionID]?.publicCaptureToken = nil
                    }
                    self.subscriberLock.unlock()
                    guard ownsCapture, let outbound else { return }
                    sendResponseJSON(
                        to: outbound,
                        response,
                        envelopeActive: envelopeActive,
                        envelopeRef: envelopeRef
                    )
                }
            )
            subscriberLock.lock()
            let ownsCapture = subscribers[connectionID]?
                .publicCaptureToken == captureToken
            if ownsCapture {
                subscribers[connectionID]?.publicCapture = capture
            }
            subscriberLock.unlock()
            if !ownsCapture { capture.cancel() }

        case "subscribe":
            let depth = json["depth"] as? Int ?? config.perception.default_depth
            let scope = json["scope"] as? String ?? "cursor"
            let rate = json["rate"] as? String ?? "on-settle"
            let events = json["events"] as? [String] ?? []
            let wantsSnapshot = (json["snapshot"] as? Bool) ?? false
            let channelID = perception.attention.addChannel(depth: depth, scope: scope, rate: rate)
            let wantsInputEvents = requestedInputEvents(json)
            subscriberLock.lock()
            subscribers[connectionID]?.perceptionChannelIDs.insert(channelID)
            subscribers[connectionID]?.isSubscribed = true
            subscribers[connectionID]?.wantsInputEvents = wantsInputEvents
            subscriberLock.unlock()
            sendResponseJSON(to: outbound, ["status": "ok", "channel_id": channelID.uuidString], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            if wantsSnapshot { sendSubscriberSnapshots(to: outbound, events: events) }

        case "scene-follow":
            let response = desktopWorldSceneTransport.follow(
                json: json,
                connectionID: connectionID,
                ref: envelopeRef
            )
            sendResponseJSON(
                to: outbound,
                response.payload,
                envelopeActive: envelopeActive,
                envelopeRef: envelopeRef
            )

        case "scene-devtools-open", "scene-devtools-status", "scene-devtools-update",
             "scene-devtools-transfer", "scene-devtools-close":
            handleDesktopWorldDevToolsCommand(
                action: action,
                json: json,
                outbound: outbound,
                envelopeActive: envelopeActive,
                envelopeRef: envelopeRef
            )

        case "scene-devtools-monitor":
            handleDesktopWorldSceneMonitor(
                json: json,
                connectionID: connectionID,
                outbound: outbound,
                envelopeActive: envelopeActive,
                envelopeRef: envelopeRef
            )

        case "scene-effect-trigger":
            sendResponseJSON(
                to: outbound,
                desktopWorldSceneEffectTrigger.handle(json),
                envelopeActive: envelopeActive,
                envelopeRef: envelopeRef
            )

        case "status-item-register", "status-item-update", "status-item-inspect":
            statusItemHostController.handleCommand(
                action: action,
                payload: json,
                connectionID: connectionID,
                ref: envelopeRef
            ) { result in
                sendResponseJSON(to: outbound, result.response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                result.afterResponse?()
            }

        // -- Display actions (dispatch to CanvasManager on main thread) --
        case "audit":
            let point = pointFromAuditRequest(json)
            let semaphore = DispatchSemaphore(value: 0)
            var audit: [String: Any] = ["status": "error", "error": "Internal error", "code": "INTERNAL"]
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { semaphore.signal(); return }
                audit = self.canvasManager.visibleSurfaceAudit(point: point)
                self.checkIdle()
                semaphore.signal()
            }
            semaphore.wait()
            sendResponseJSON(to: outbound, audit, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "create", "update", "remove", "remove-all", "list", "eval", "to-front":
            let requestData = lineData(from: json)
            guard var request = CanvasRequest.from(requestData) else {
                sendResponseJSON(to: outbound, ["error": "Failed to parse request", "code": "PARSE_ERROR"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }

            // Rewrite aos:// URLs
            if let url = request.url {
                request.url = resolveContentURL(url)
            }

            let semaphore = DispatchSemaphore(value: 0)
            var response = CanvasResponse.fail("Internal error", code: "INTERNAL")
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { semaphore.signal(); return }
                response = self.canvasManager.handle(request, connectionID: connectionID)
                self.checkIdle()
                semaphore.signal()
            }
            semaphore.wait()

            sendResponseJSON(to: outbound, canvasResponseDict(response), envelopeActive: envelopeActive, envelopeRef: envelopeRef)

            if action == "create",
               response.status == "success",
               json["url"] as? String
                == "aos://toolkit/components/operation-control/index.html",
               let canvasID = json["id"] as? String {
                attachOrdinaryOperationCanvas(
                    canvasID: canvasID,
                    connectionID: connectionID
                )
            }

            // Announce display actions
            if currentConfig.voice.enabled && currentConfig.voice.announce_actions {
                switch action {
                case "create":
                    if let id = json["id"] as? String {
                        announce("\(spokenCanvasName(id)) displayed")
                    }
                case "remove":
                    if let id = json["id"] as? String {
                        announce("\(spokenCanvasName(id)) removed")
                    }
                case "remove-all":
                    announce("All surfaces removed")
                default:
                    break
                }
            }

        // -- Post: canvas message delivery --
        // Reachable only via the show.post -> "post" internal action mapping,
        // which is exercised by sendHeadsupMessage / sendHeadsupMessageOneShot
        // in helpers.swift. Channel relay was removed; use tell.send for channels.
        case "post":
            let requestData = lineData(from: json)
            guard let request = CanvasRequest.from(requestData) else {
                sendResponseJSON(to: outbound, ["error": "Failed to parse request", "code": "PARSE_ERROR"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let postSemaphore = DispatchSemaphore(value: 0)
            var postResponse = CanvasResponse.fail("Internal error", code: "INTERNAL")
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { postSemaphore.signal(); return }
                postResponse = self.canvasManager.handle(request, connectionID: connectionID)
                postSemaphore.signal()
            }
            postSemaphore.wait()
            sendResponseJSON(to: outbound, canvasResponseDict(postResponse), envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        // -- Coordination actions --
        case "tell":
            handleTellAction(json: json, outbound: outbound)

        case "coord-register":
            let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let canonicalSessionID = sessionID, !canonicalSessionID.isEmpty else {
                sendResponseJSON(to: outbound, ["error": "session_id required for registration", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let legacyName = name?.isEmpty == false ? name : nil
            let role = json["role"] as? String ?? "worker"
            let harness = json["harness"] as? String ?? "unknown"
            let result = coordination.registerSession(sessionID: canonicalSessionID, name: legacyName, role: role, harness: harness)
            sendResponseJSON(to: outbound, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-unregister":
            let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedName = name?.isEmpty == false ? name : nil
            let normalizedSessionID = sessionID?.isEmpty == false ? sessionID : nil
            guard normalizedSessionID != nil || normalizedName != nil else {
                sendResponseJSON(to: outbound, ["error": "session_id or name required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let result = coordination.unregisterSession(sessionID: normalizedSessionID, name: normalizedName)
            sendResponseJSON(to: outbound, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-who":
            let sessions = coordination.whoIsOnline()
            sendResponseJSON(to: outbound, ["status": "ok", "sessions": sessions], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-list":
            var voices = coordination.voiceCatalog()
            if let provider = json["provider"] as? String, !provider.isEmpty {
                voices = voices.filter { ($0["provider"] as? String) == provider }
            }
            if (json["speakable_only"] as? Bool) == true {
                voices = voices.filter { rec in
                    let cap = rec["capabilities"] as? [String: Any]
                    let avail = rec["availability"] as? [String: Any]
                    return (cap?["speak_supported"] as? Bool) == true
                        && (avail?["enabled"] as? Bool) == true
                        && (avail?["installed"] as? Bool) == true
                        && (avail?["reachable"] as? Bool) == true
                }
            }
            sendResponseJSON(to: outbound, ["voices": voices], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-microphone-authorization-status":
            let authorization = voiceTransport.microphoneAuthorizationStatus()
            sendResponseJSON(to: outbound, [
                "status": authorization.isAuthorized ? "ok" : "degraded",
                "microphone_authorization": authorization.statusDictionary(),
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-microphone-authorization-request":
            let result = voiceTransport.requestMicrophoneAuthorization()
            sendResponseJSON(to: outbound, [
                "status": result.after.isAuthorized ? "ok" : "degraded",
                "microphone_authorization": result.dictionary(),
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "permissions-screen-capture-direct-status":
            sendResponseJSON(
                to: outbound,
                AOSDesktopFrameDirectCaptureWireContract.responsePayload(
                    desktopFrameCaptureConsent.snapshot()
                ),
                envelopeActive: envelopeActive,
                envelopeRef: envelopeRef
            )

        case "permissions-screen-capture-direct-prime":
            desktopFrameCaptureConsent.prime(owner: connectionID) {
                [weak self, weak outbound] snapshot in
                if snapshot.status == .ready {
                    self?.desktopFrameAuthorizationChanged()
                }
                guard let outbound else { return }
                sendResponseJSON(
                    to: outbound,
                    AOSDesktopFrameDirectCaptureWireContract.responsePayload(snapshot),
                    envelopeActive: envelopeActive,
                    envelopeRef: envelopeRef
                )
            }

        case "voice-hotkey":
            guard let shortcut = json["shortcut"] as? String, !shortcut.isEmpty else {
                sendVoiceTransportError(to: outbound, message: "shortcut required", code: "MISSING_ARG", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            do {
                try voiceTransport.acquireHotkey(owner: connectionID, shortcut: shortcut, ref: envelopeRef)
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "voice hotkey setup failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-microphone":
            guard let outputPath = json["output"] as? String, !outputPath.isEmpty else {
                sendVoiceTransportError(to: outbound, message: "output required", code: "MISSING_ARG", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let maximumDuration = (json["max_duration_seconds"] as? NSNumber)?.doubleValue
                ?? aosVoiceCaptureMaximumDuration
            do {
                try voiceTransport.startCapture(
                    owner: connectionID,
                    outputPath: outputPath,
                    maximumDuration: maximumDuration,
                    ref: envelopeRef
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "microphone capture failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-microphone-segmented":
            guard let directoryPath = json["segments_directory"] as? String,
                  !directoryPath.isEmpty else {
                sendVoiceTransportError(to: outbound, message: "segments directory required", code: "MISSING_ARG", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let segmentDuration = (json["segment_duration_seconds"] as? NSNumber)?.doubleValue
                ?? aosVoiceSegmentDefaultDuration
            let maximumDuration = (json["max_duration_seconds"] as? NSNumber)?.doubleValue
                ?? aosVoiceCaptureMaximumDuration
            if let value = json["ready_cue"], !(value is String) {
                sendVoiceTransportError(to: outbound, message: "ready cue must be a string", code: "INVALID_READY_CUE", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            do {
                let readyCue = try AOSCaptureReadyCue.parse(json["ready_cue"] as? String)
                let beginCapture = try voiceTransport.prepareSegmentedCapture(
                    owner: connectionID,
                    directoryPath: directoryPath,
                    segmentDuration: segmentDuration,
                    maximumDuration: maximumDuration,
                    readyCue: readyCue,
                    ref: envelopeRef
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                beginCapture()
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "segmented microphone capture failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-capture-stop", "voice-capture-cancel":
            do {
                try voiceTransport.stopCapture(
                    owner: connectionID,
                    finalize: action == "voice-capture-stop",
                    reason: action == "voice-capture-stop" ? "explicit_stop" : "canceled"
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "microphone capture control failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-speak":
            guard let text = json["text"] as? String else {
                sendVoiceTransportError(to: outbound, message: "speech text required", code: "MISSING_ARG", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let voiceID = json["voice_id"] as? String
            let rateWPM = (json["rate_wpm"] as? NSNumber)?.doubleValue
            do {
                try voiceTransport.startSpeech(
                    owner: connectionID,
                    text: text,
                    voiceID: voiceID,
                    rateWPM: rateWPM,
                    ref: envelopeRef
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "speech playback failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-playback":
            guard let inputPath = json["audio_path"] as? String, !inputPath.isEmpty else {
                sendVoiceTransportError(to: outbound, message: "audio path required", code: "MISSING_ARG", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            do {
                try voiceTransport.startPlayback(
                    owner: connectionID,
                    inputPath: inputPath,
                    ref: envelopeRef
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "audio playback failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-speech-cancel":
            do {
                try voiceTransport.stopSpeech(owner: connectionID, reason: "canceled")
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSVoiceTransportFailure {
                sendVoiceTransportError(to: outbound, message: failure.message, code: failure.code, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendVoiceTransportError(to: outbound, message: "speech cancellation failed", code: "VOICE_TRANSPORT_FAILED", envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "annotation-select":
            guard let mode = json["mode"] as? String, !mode.isEmpty else {
                sendResponseJSON(to: outbound, ["error": "annotation mode required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            do {
                try annotationSelection.start(owner: connectionID, mode: mode, ref: envelopeRef)
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSAnnotationSelectionFailure {
                sendResponseJSON(to: outbound, ["error": failure.message, "code": failure.code], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendResponseJSON(to: outbound, ["error": "annotation selection failed", "code": "ANNOTATION_SELECTION_FAILED"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "annotation-select-cancel":
            do {
                try annotationSelection.cancel(owner: connectionID, reason: "canceled")
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch let failure as AOSAnnotationSelectionFailure {
                sendResponseJSON(to: outbound, ["error": failure.message, "code": failure.code], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } catch {
                sendResponseJSON(to: outbound, ["error": "annotation cancellation failed", "code": "ANNOTATION_SELECTION_FAILED"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        case "voice-assignments":
            sendResponseJSON(to: outbound, [
                "assignments": coordination.voiceAssignments()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-refresh":
            sendResponseJSON(to: outbound, [
                "voices": coordination.voiceRefresh()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-providers":
            sendResponseJSON(to: outbound, [
                "providers": coordination.voiceProviders()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-bind":
            guard let sessionID = json["session_id"] as? String, !sessionID.isEmpty else {
                sendResponseJSON(to: outbound, ["error": "session_id required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            var filter = VoiceFilter()
            filter.provider = json["provider"] as? String
            filter.gender = json["gender"] as? String
            filter.locale = json["locale"] as? String
            filter.language = json["language"] as? String
            filter.region = json["region"] as? String
            filter.kind = json["kind"] as? String
            filter.quality_tier = json["quality_tier"] as? String
            filter.tags = json["tags"] as? [String] ?? []
            let result = coordination.bindVoice(sessionID: sessionID, voiceID: json["voice_id"] as? String, filter: filter)
            sendResponseJSON(to: outbound, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-next":
            guard let sessionID = json["session_id"] as? String, !sessionID.isEmpty else {
                sendResponseJSON(to: outbound, ["error": "session_id required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let result = coordination.rotateSessionVoice(sessionID: sessionID)
            if result["error"] == nil,
               let voice = result["voice"] as? [String: Any],
               let providerVoiceID = voice["provider_voice_id"] as? String {
                let name = (voice["name"] as? String) ?? providerVoiceID
                if speechEngine == nil { initSpeechEngine() }
                if let engine = speechEngine {
                    engine.stop()
                    engine.setVoice(providerVoiceID)
                    engine.speak("Hi, I'm \(name).")
                }
            }
            sendResponseJSON(to: outbound, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-final-response":
            handleVoiceFinalResponseAction(json: json, outbound: outbound)

        case "coord-read":
            guard let channel = json["channel"] as? String else {
                sendResponseJSON(to: outbound, ["error": "channel required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let since = json["since"] as? String
            let limit = json["limit"] as? Int ?? 50
            let msgs = coordination.readMessages(channel: channel, since: since, limit: limit)
            sendResponseJSON(to: outbound, ["status": "ok", "channel": channel, "messages": msgs], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-channels":
            let channels = coordination.listChannels()
            sendResponseJSON(to: outbound, ["status": "ok", "channels": channels], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        // -- Unified ping --
        case "ping":
            let uptime = Date().timeIntervalSince(startTime)
            let perceptionChannels = perception.attention.channelCount
            let canvasPerceptionChannelDetails = canvasPerceptionChannelSnapshot()
            subscriberLock.lock()
            let subscriberCount = subscribers.count
            subscriberLock.unlock()
            let canvasDiagnostics: [String: Any]
            if Thread.isMainThread {
                canvasDiagnostics = canvasManager.diagnosticsSnapshot()
            } else {
                canvasDiagnostics = DispatchQueue.main.sync {
                    canvasManager.diagnosticsSnapshot()
                }
            }
            canvasSubscriptionLock.lock()
            var subscriptionEventCounts: [String: Int] = [:]
            for subscription in canvasEventSubscriptions.values {
                for event in subscription.events {
                    subscriptionEventCounts[event, default: 0] += 1
                }
            }
            let canvasSubscriptionCanvasCount = canvasEventSubscriptions.count
            let canvasReadyManifestCount = canvasReadyManifests.count
            let canvasObjectRegistryCount = canvasObjectRegistries.count
            canvasSubscriptionLock.unlock()
            let canvasSubscriptionDetails = canvasEventSubscriptionSnapshot()
            let inputEventSubscriberCount = subscriptionEventCounts["input_event"] ?? 0
            inputRegionLock.lock()
            let inputRegionSnapshot = inputRegions.snapshot()
            let activeInputCapture: Any = inputRegions.activeCaptureSnapshot() ?? NSNull()
            inputRegionLock.unlock()
            let nativeCursorSnapshot = inputRegionCursorPresentation.snapshot()
            let nativeCursorErrorCode: Any = nativeCursorSnapshot.errorCode
                .map { NSNumber(value: $0) } ?? NSNull()
            let mode = aosCurrentRuntimeMode()
            let pid = Int(getpid())
            let startedAt = ISO8601DateFormatter().string(from: startTime)

            let lastErrorAt: Any
            if let date = perception.inputTapLastErrorAt {
                lastErrorAt = ISO8601DateFormatter().string(from: date)
            } else {
                lastErrorAt = NSNull()
            }
            let safetyShortcutSnapshot = perception.inputSafetyHotkeySnapshot
            let panicUntil: Any
            if let until = safetyShortcutSnapshot.until {
                panicUntil = ISO8601DateFormatter().string(from: until)
            } else {
                panicUntil = NSNull()
            }
            let panicTrigger: Any
            if let trigger = safetyShortcutSnapshot.trigger {
                panicTrigger = trigger
            } else {
                panicTrigger = NSNull()
            }
            let visualSnapshot = inputSafetyVisualFeedbackPresenter.snapshot()
            let visualDeadline: Any
            if let deadline = visualSnapshot.deadline {
                visualDeadline = ISO8601DateFormatter().string(from: deadline)
            } else {
                visualDeadline = NSNull()
            }
            let visualLastRemaining: Any = visualSnapshot.lastDisplayedRemaining ?? NSNull()

            let microphoneAuthorization = voiceTransport.microphoneAuthorizationStatus()
            var response: [String: Any] = [
                "status": "ok",
                "uptime": uptime,
                "pid": pid,
                "mode": mode.rawValue,
                "socket_path": socketPath,
                "started_at": startedAt,
                "perception_channels": perceptionChannels,
                "canvas_perception_channels": canvasPerceptionChannelDetails,
                "subscribers": subscriberCount,
                "runtime_resources": [
                    "canvases": canvasDiagnostics,
                    "canvas_event_subscriptions": [
                        "canvas_count": canvasSubscriptionCanvasCount,
                        "by_event": subscriptionEventCounts,
                        "canvases": canvasSubscriptionDetails,
                    ],
                    "canvas_perception_channel_count": canvasPerceptionChannelDetails.count,
                    "canvas_ready_manifest_count": canvasReadyManifestCount,
                    "canvas_object_registry_count": canvasObjectRegistryCount,
                    "input_regions": [
                        "count": inputRegionSnapshot.count,
                        "active_capture": activeInputCapture,
                        "native_cursor": [
                            "requested_hidden": nativeCursorSnapshot.requestedHidden,
                            "applied_hidden": nativeCursorSnapshot.appliedHidden,
                            "error_code": nativeCursorErrorCode,
                        ],
                    ],
                    "desktop_world_scene_event_routing": desktopWorldSceneEventRouting.snapshot(),
                    "surface_transport_probe": surfaceTransportProbeSnapshot(
                        inputEventSubscriberCount: inputEventSubscriberCount
                    ),
                ] as [String: Any],
                // Structured daemon-owned input-tap state.
                "input_tap": [
                    "status": perception.inputTapStatus,
                    "attempts": perception.inputTapAttempts,
                    "listen_access": perception.inputTapListenAccess,
                    "post_access": perception.inputTapPostAccess,
                    "last_error_at": lastErrorAt,
                    // Current input-safety state fields.
                    "panic_passthrough_active": safetyShortcutSnapshot.active,
                    "panic_passthrough_until": panicUntil,
                    "panic_trigger": panicTrigger,
                    "panic_trigger_count": safetyShortcutSnapshot.triggerCount,
                    "input_safety_visual_feedback": [
                        "active": visualSnapshot.active,
                        "reused_existing_log_console": visualSnapshot.reusedExistingLogConsole,
                        "created_log_console": visualSnapshot.createdLogConsole,
                        "countdown_deadline": visualDeadline,
                        "last_displayed_remaining": visualLastRemaining,
                        "cleanup_pending": visualSnapshot.cleanupPending,
                        "cleanup_complete": visualSnapshot.cleanupComplete,
                    ],
                    "canvas_input_passthrough_active": canvasManager.inputPassthroughActive,
                ] as [String: Any],
                // New nested permissions block (daemon-sourced)
                "permissions": [
                    "accessibility": perception.daemonAccessibilityGranted,
                    "microphone": microphoneAuthorization.isAuthorized,
                    "microphone_state": microphoneAuthorization.rawValue,
                    "screen_capture_direct": desktopFrameCaptureConsent.snapshot().dictionary,
                ] as [String: Any],
            ]
            if let lockOwnerPID = aosDaemonLockOwnerPID(for: mode) {
                response["lock_owner_pid"] = lockOwnerPID
            }
            if let port = contentServer?.assignedPort, port > 0 {
                response["content_port"] = Int(port)
            }
            sendResponseJSON(to: outbound, response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "content_status":
            if let server = contentServer {
                var result = server.statusDict()
                result["status"] = "ok"
                sendResponseJSON(to: outbound, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } else {
                sendResponseJSON(to: outbound, ["status": "ok", "port": 0, "roots": [String: String](), "note": "content server not configured"] as [String: Any], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        // -- Spatial / focus / graph actions --
        case "focus-create", "focus-update", "focus-remove", "focus-list",
             "graph-displays", "graph-windows", "graph-deepen", "graph-collapse",
             "snapshot":
            let response = spatial.handleAction(action, json: json)
            sendResponseJSON(to: outbound, response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        default:
            sendResponseJSON(to: outbound, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
        }
    }

    private func attachOrdinaryOperationCanvas(
        canvasID: String,
        connectionID: UUID
    ) {
        guard let projection = operationCanvasProjection else { return }
        let target: CanvasLifecycleGeneration? = Thread.isMainThread
            ? canvasManager.deliveryTarget(forCanvasID: canvasID)
            : DispatchQueue.main.sync {
                canvasManager.deliveryTarget(forCanvasID: canvasID)
            }
        guard let target else { return }
        let canvas = AOSOperationCanvasIdentity(id: target.canvasID, generation: target.value)
        let captureID = UUID().uuidString.lowercased()
        do {
            try projection.attachOrdinaryCanvas(canvas) { [weak self] in
                guard let self,
                      let identity = try? self.operationConnectionIdentity(
                          connectionID: connectionID,
                          revalidate: true
                      ),
                      case let .liveTransportPeer(live) = identity.caller else {
                    return nil
                }
                return AOSOrdinaryControlContext(
                    expectedDaemonGeneration: self.operationDaemonGeneration,
                    connectionEpoch: identity.connectionEpoch,
                    caller: .ordinaryCanvasCapturedPeer(AOSOrdinaryCanvasPeerEvidence(
                        canvasInstanceID: canvas.id,
                        canvasGeneration: canvas.generation,
                        captureID: captureID,
                        capturedConnectionEpoch: identity.connectionEpoch,
                        auditTokenDigest: live.auditTokenDigest,
                        effectiveUID: live.effectiveUID,
                        pid: live.pid,
                        pidGeneration: live.pidGeneration,
                        captureIsLive: true
                    )),
                    authenticatedOwnerRoot: identity.ownerRoot
                )
            }
            operationControlCanvasIdentity = canvas
        } catch {
            projection.detachCanvas(canvas)
        }
    }

    // MARK: - Config Hot-Reload

    private func onConfigChanged(old: AosConfig, new: AosConfig) {
        if old.voice.enabled != new.voice.enabled {
            fputs("Config: voice.enabled = \(new.voice.enabled)\n", stderr)
        }
        if old.perception.default_depth != new.perception.default_depth {
            fputs("Config: perception.default_depth = \(new.perception.default_depth)\n", stderr)
        }
        if old.perception.settle_threshold_ms != new.perception.settle_threshold_ms {
            fputs("Config: perception.settle_threshold_ms = \(new.perception.settle_threshold_ms)\n", stderr)
        }
        if old.content?.roots != new.content?.roots {
            fputs("Config: content.roots changed — restart daemon to apply\n", stderr)
        }
        // Broadcast config change event to subscribers
        let data: [String: Any] = [
            "voice_enabled": new.voice.enabled,
            "perception_depth": new.perception.default_depth,
            "settle_threshold_ms": new.perception.settle_threshold_ms
        ]
        broadcastEvent(service: "system", event: "config_changed", data: data)
        sendCanvasInspectorSeeBundleConfig(canvasID: "surface-inspector")

        // Voice engine lifecycle
        if new.voice.enabled && !old.voice.enabled {
            initSpeechEngine()
        } else if !new.voice.enabled && old.voice.enabled {
            stopSpeechEngine()
        }
        // Voice settings change while enabled
        if new.voice.enabled {
            if old.voice.voice != new.voice.voice {
                if let voiceID = new.voice.voice {
                    let rawVoiceID = VoiceID.parse(voiceID)?.providerVoiceID ?? voiceID
                    speechEngine?.setVoice(rawVoiceID)
                }
            }
            if old.voice.rate != new.voice.rate, let rate = new.voice.rate {
                speechEngine?.setRate(rate)
            }
            if effectiveSpeechCancelKeyCode(config: old) != effectiveSpeechCancelKeyCode(config: new) {
                configureSpeechCancelTap()
            }
        }
        configChangeHandler?(new)
    }

    // MARK: - Autonomic Voice

    private func initSpeechEngine() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let voiceID = self.currentConfig.voice.voice.map { VoiceID.parse($0)?.providerVoiceID ?? $0 }
            self.speechEngine = SpeechEngine(voice: voiceID)
            if let rate = self.currentConfig.voice.rate {
                self.speechEngine?.setRate(rate)
            }
            self.configureSpeechCancelTap()
            fputs("Voice engine initialized\n", stderr)
        }
    }

    private func stopSpeechEngine() {
        DispatchQueue.main.async { [weak self] in
            self?.speechEngine?.stop()
            self?.teardownSpeechCancelTap()
            self?.speechEngine = nil
            fputs("Voice engine stopped\n", stderr)
        }
    }

    /// Speak text if voice is enabled. Non-blocking.
    func announce(_ text: String, voiceID: String? = nil) {
        guard currentConfig.voice.enabled, let engine = speechEngine else { return }
        DispatchQueue.main.async {
            let configuredVoiceID = voiceID ?? self.currentConfig.voice.voice
            let rawVoiceID = configuredVoiceID.map { VoiceID.parse($0)?.providerVoiceID ?? $0 }
                ?? SpeechEngine.resolvedDefaultVoiceID
            if !rawVoiceID.isEmpty {
                engine.setVoice(rawVoiceID)
            }
            if let rate = self.currentConfig.voice.rate {
                engine.setRate(rate)
            }
            engine.speak(text)
        }
    }

    private func spokenCanvasName(_ id: String) -> String {
        switch id {
        case "surface-inspector":
            return "Surface Inspector"
        case "__log__", "log-console":
            return "Log Console"
        default:
            return "Canvas \(id.replacingOccurrences(of: "-", with: " "))"
        }
    }

    private func appendVoiceTelemetry(_ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload) else { return }
        voiceTelemetryLock.lock()
        defer { voiceTelemetryLock.unlock() }

        let logPath = aosVoiceEventLogPath()
        let dir = (logPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
        guard let handle = FileHandle(forWritingAtPath: logPath) ?? {
            FileManager.default.createFile(atPath: logPath, contents: nil)
            return FileHandle(forWritingAtPath: logPath)
        }() else { return }
        defer { handle.closeFile() }
        do {
            try handle.seekToEnd()
            handle.write(data)
            handle.write("\n".data(using: .utf8)!)
        } catch {
            return
        }
    }

    private func recordVoiceTelemetry(
        event: String,
        session: [String: Any]? = nil,
        voice: [String: Any]? = nil,
        purpose: String? = nil,
        rendered: VoiceRenderResult? = nil,
        delivered: Bool? = nil,
        reason: String? = nil,
        source: [String: Any]? = nil,
        code: String? = nil
    ) {
        var payload: [String: Any] = [
            "event": event,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "mode": aosCurrentRuntimeMode().rawValue
        ]
        if let sessionID = session?["session_id"] as? String {
            payload["session_id"] = sessionID
        }
        if let sessionName = session?["name"] as? String {
            payload["session_name"] = sessionName
        }
        if let harness = session?["harness"] as? String {
            payload["harness"] = harness
        } else if let sourceHarness = source?["harness"] as? String {
            payload["harness"] = sourceHarness
        }
        if let purpose {
            payload["purpose"] = purpose
        }
        if let rendered {
            payload["rendered"] = rendered.dictionary()
        }
        if let delivered {
            payload["delivered"] = delivered
        }
        if let reason {
            payload["reason"] = reason
        }
        if let code {
            payload["code"] = code
        }
        if let source, !source.isEmpty {
            payload["source"] = source
        }
        if let voice, !voice.isEmpty {
            payload["voice"] = voice
        }
        appendVoiceTelemetry(payload)
    }

    private func configureSpeechCancelTap() {
        teardownSpeechCancelTap()
        guard speechEngine != nil else { return }
        guard effectiveSpeechCancelKeyCode(config: currentConfig) != nil else { return }

        let daemonRef = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon else { return Unmanaged.passUnretained(event) }
                let daemon = Unmanaged<UnifiedDaemon>.fromOpaque(refcon).takeUnretainedValue()
                let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
                if keyCode == effectiveSpeechCancelKeyCode(config: daemon.currentConfig) {
                    daemon.speechEngine?.stop()
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: daemonRef
        ) else {
            fputs("Voice cancel tap unavailable\n", stderr)
            return
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)
        CGEvent.tapEnable(tap: tap, enable: true)
        speechCancelTap = tap
        speechCancelTapSource = source
    }

    private func teardownSpeechCancelTap() {
        if let tap = speechCancelTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        if let source = speechCancelTapSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .defaultMode)
        }
        speechCancelTapSource = nil
        speechCancelTap = nil
    }

    // MARK: - Tell (Coordination)

    private func deliverHumanVoiceRoute(
        rawText: String,
        purpose: String?,
        sendingSession: [String: Any]?,
        source: [String: Any]? = nil
    ) -> [String: Any] {
        let routeConfig = loadConfig()
        let rendered = renderSpeechText(rawText: rawText, purpose: purpose, config: routeConfig)
        let sessionVoice = sendingSession?["voice"] as? [String: Any]
        let voiceID = sessionVoice?["id"] as? String ?? routeConfig.voice.voice ?? SpeechEngine.resolvedDefaultVoiceID
        if routeConfig.voice.enabled {
            announce(rendered.text, voiceID: voiceID)
        }
        var route: [String: Any] = [
            "audience": "human",
            "route": "voice",
            "delivered": routeConfig.voice.enabled,
            "rendered": rendered.dictionary()
        ]
        if let purpose {
            route["purpose"] = purpose
        }
        if let sessionVoice {
            route["voice"] = sessionVoice
        } else if let record = coordination.voiceLookup(id: voiceID) {
            route["voice"] = SessionVoiceDescriptor(record: record).dictionary()
        } else {
            route["voice"] = SessionVoiceDescriptor(
                provider: "system",
                id: voiceID,
                name: voiceID,
                locale: "unknown",
                gender: "unknown",
                quality_tier: "unknown",
                available: false
            ).dictionary()
        }
        if let source, !source.isEmpty {
            route["source"] = source
        }
        if !routeConfig.voice.enabled {
            route["reason"] = "voice.enabled is false"
        }
        recordVoiceTelemetry(
            event: "voice_route",
            session: sendingSession,
            voice: route["voice"] as? [String: Any],
            purpose: purpose,
            rendered: rendered,
            delivered: route["delivered"] as? Bool,
            reason: route["reason"] as? String,
            source: source
        )
        return route
    }

    private func handleTellAction(
        json: [String: Any],
        outbound: AOSConnectionOutboundWriter
    ) {
        let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
        let envelopeRef = json["__envelope_ref"] as? String
        guard let audiences = json["audience"] as? [String], !audiences.isEmpty else {
            sendResponseJSON(to: outbound, ["error": "audience required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }

        let text = json["text"] as? String
        let jsonPayload = json["payload"]  // structured data alternative
        let fromSessionID = json["from_session_id"] as? String
        let purpose = json["purpose"] as? String
        let sendingSession = fromSessionID.flatMap { coordination.sessionInfo(sessionID: $0) }
        if let fromSessionID, sendingSession == nil {
            sendResponseJSON(to: outbound, [
                "error": "from_session_id not found: \(fromSessionID)",
                "code": "SESSION_NOT_FOUND"
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        let from = json["from"] as? String
            ?? sendingSession?["name"] as? String
            ?? fromSessionID.flatMap { coordination.sessionDisplayName(sessionID: $0) }
            ?? "cli"

        guard text != nil || jsonPayload != nil else {
            sendResponseJSON(to: outbound, ["error": "text or payload required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        var routes: [[String: Any]] = []

        for aud in audiences {
            if aud == "human" {
                // Route to TTS
                if let t = text {
                    routes.append(deliverHumanVoiceRoute(rawText: t, purpose: purpose, sendingSession: sendingSession))
                }
            } else {
                // Route to coordination bus channel
                let payload: Any = jsonPayload ?? (text as Any)
                let msg = coordination.postMessage(channel: aud, from: from, payload: payload)
                // Broadcast as event so `listen` subscribers get it
                broadcastEvent(service: "coordination", event: "message", data: [
                    "channel": aud,
                    "id": msg.id,
                    "from": from,
                    "payload": msg.payload,
                    "created_at": msg.createdAt
                ])
                var route: [String: Any] = ["audience": aud, "route": "channel", "delivered": true, "id": msg.id]
                if let session = coordination.sessionInfo(sessionID: aud) {
                    route["session"] = session
                }
                routes.append(route)
            }
        }

        sendResponseJSON(to: outbound, ["status": "ok", "routes": routes], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
    }

    private func handleVoiceFinalResponseAction(
        json: [String: Any],
        outbound: AOSConnectionOutboundWriter
    ) {
        let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
        let envelopeRef = json["__envelope_ref"] as? String
        let explicitSessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let explicitHarness = (json["harness"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let ingress = resolveFinalResponseIngress(
            explicitSessionID: explicitSessionID?.isEmpty == false ? explicitSessionID : nil,
            explicitHarness: explicitHarness?.isEmpty == false ? explicitHarness : nil,
            hookPayload: json["hook_payload"]
        )

        guard let sessionID = ingress.sessionID, !sessionID.isEmpty else {
            recordVoiceTelemetry(
                event: "final_response_ingress_failed",
                voice: nil,
                purpose: "final_response",
                source: ingress.dictionary(),
                code: "MISSING_SESSION_ID"
            )
            sendResponseJSON(to: outbound, [
                "error": "final-response event could not resolve a session_id",
                "code": "MISSING_SESSION_ID",
                "source": ingress.dictionary()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        guard let sendingSession = coordination.sessionInfo(sessionID: sessionID) else {
            recordVoiceTelemetry(
                event: "final_response_ingress_failed",
                purpose: "final_response",
                source: ingress.dictionary(),
                code: "SESSION_NOT_FOUND"
            )
            sendResponseJSON(to: outbound, [
                "error": "session not found: \(sessionID)",
                "code": "SESSION_NOT_FOUND",
                "source": ingress.dictionary()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        guard let message = ingress.message, !message.isEmpty else {
            recordVoiceTelemetry(
                event: "final_response_ingress_failed",
                session: sendingSession,
                purpose: "final_response",
                source: ingress.dictionary(),
                code: "FINAL_RESPONSE_UNAVAILABLE"
            )
            sendResponseJSON(to: outbound, [
                "error": "final-response event did not contain readable assistant text",
                "code": "FINAL_RESPONSE_UNAVAILABLE",
                "source": ingress.dictionary()
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }

        let route = deliverHumanVoiceRoute(
            rawText: message,
            purpose: "final_response",
            sendingSession: sendingSession,
            source: ingress.dictionary()
        )
        sendResponseJSON(to: outbound, [
            "status": "ok",
            "session_id": sessionID,
            "routes": [route]
        ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
    }

    // MARK: - Helpers

    private func waitForContentServerPort(timeoutMs: Int = 10000, pollMs: Int = 25) -> UInt16? {
        guard let server = contentServer else { return nil }
        if server.assignedPort > 0 { return server.assignedPort }
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while server.assignedPort == 0 && Date() < deadline {
            Thread.sleep(forTimeInterval: Double(pollMs) / 1000)
        }
        return server.assignedPort > 0 ? server.assignedPort : nil
    }

    /// Rewrite `aos://` URLs to the content server's localhost address.
    func resolveContentURL(_ urlString: String) -> String {
        guard urlString.hasPrefix("aos://"),
              let port = waitForContentServerPort() else {
            return urlString
        }
        let path = String(urlString.dropFirst("aos://".count))
        return "http://127.0.0.1:\(port)/\(path)"
    }

    /// Convert a dictionary back to Data for CanvasRequest parsing.
    private func lineData(from json: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: json, options: [])) ?? Data()
    }

    private func relayChannelPost(channel: String, dataStr: String?) {
        var payload: Any = [String: Any]()
        if let str = dataStr, let data = str.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) {
            payload = parsed
        }
        let eventData: [String: Any] = ["channel": channel, "payload": payload]
        broadcastEvent(service: "display", event: "channel_post", data: eventData)
    }

    private func sendSnapshotEvent(
        to outbound: AOSConnectionOutboundWriter,
        service: String,
        event: String,
        data: [String: Any]
    ) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }
        outbound.enqueue(bytes)
    }

    private func sendSubscriberSnapshots(
        to outbound: AOSConnectionOutboundWriter,
        events: [String]
    ) {
        let requested = Set(events)
        DispatchQueue.main.sync {
            if requested.contains("display_geometry") {
                sendSnapshotEvent(to: outbound, service: "display", event: "display_geometry", data: snapshotDisplayGeometry())
            }
            if requested.contains("canvas_lifecycle") {
                let infos = canvasManager.handle(CanvasRequest(action: "list")).canvases ?? []
                for info in infos {
                    guard let data = canvasLifecyclePayload(action: "created", canvasInfo: info) else { continue }
                    sendSnapshotEvent(
                        to: outbound,
                        service: "display",
                        event: "canvas_lifecycle",
                        data: data
                    )
                }
            }
            if requested.contains("input_event") {
                sendSnapshotEvent(
                    to: outbound,
                    service: "input",
                    event: "input_event",
                    data: currentInputEventSnapshot()
                )
            }
        }
    }

    private func currentInputEventSnapshot() -> [String: Any] {
        let point = mouseInCGCoords()
        return inputEventData(
            type: "mouse_moved",
            x: Double(point.x),
            y: Double(point.y),
            flags: [
                "shift": false,
                "ctrl": false,
                "cmd": false,
                "opt": false,
                "fn": false,
                "caps_lock": false,
            ]
        )
    }

    private func requestedInputEvents(_ json: [String: Any]) -> Bool {
        guard let events = json["events"] as? [String] else { return false }
        return events.contains("input_event")
    }

    private func activateInputSafetyEmergencyExit(until deadline: Date) {
        guard !inputSafetyEmergencyExitScheduled else { return }
        inputSafetyEmergencyExitScheduled = true
        inputSafetyPassthroughDeadline = deadline
        inputSafetyPassthroughTimer?.cancel()
        inputSafetyPassthroughTimer = nil
        canvasManager.setInputPassthrough(true)
        teardownSpeechCancelTap()
        perception.stop()
        restoreNativeCursorSuppressionForExit()
        fputs("AOS input safety escape hatch triggered; released input ownership and exiting daemon\n", stderr)
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(50)) {
            NSApp.terminate(nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(500)) {
            Darwin.exit(0)
        }
    }

    private func handleInputEvent(event: String, data: [String: Any]) -> Bool {
        let annotationConsumed = maybeHandleCanvasInspectorAnnotationHotkey(event: event, data: data)
        let inspectorConsumed = maybeHandleCanvasInspectorSeeBundleHotkey(event: event, data: data)
        let genericConsumed = shouldConsumeGenericAOSInputEvent(event: event, data: data)
        if !inspectorConsumed && !annotationConsumed && !genericConsumed {
            broadcastInputEvent(service: "input", event: "input_event", data: data)
        }
        return annotationConsumed || inspectorConsumed || genericConsumed
    }

    private func releaseInputRegionCaptureAfterPermissionLoss() {
        inputRegionLock.lock()
        let decision = inputRegions.cancelActiveCapture(reason: .osCancelled)
        inputRegions.clearPointerState()
        let cursorResult = inputRegionCursorPresentation.reconcile(target: nil, emitMove: false)
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)

        guard case .deliver(let delivery) = decision else { return }
        canvasManager.postMessageAsync(
            to: delivery.ownerCanvasGeneration,
            payload: delivery.payload
        )
    }

    private func shouldConsumeGenericAOSInputEvent(event: String, data: [String: Any]) -> Bool {
        if let escapeConsumed = routeInputEscapeCancellation(event: event, data: data) {
            return escapeConsumed
        }
        if let regionConsumed = routeInputRegionEvent(event: event, data: data) {
            return regionConsumed
        }

        guard ProcessInfo.processInfo.environment["AOS_GENERIC_INPUT_CONSUME"] == "1" else { return false }
        guard event == "left_mouse_down" || event == "right_mouse_down" || event == "middle_mouse_down" || event == "other_mouse_down" else { return false }
        guard let point = inputPoint(from: data) else { return false }
        let decision = canvasManager.frontmostHittableInputSurface(
            at: point,
            frontToBackWindowNumbers: currentFrontToBackWindowNumbers()
        )
        if ProcessInfo.processInfo.environment["AOS_INPUT_SURFACE_DIAGNOSTICS"] == "1" {
            fputs("[input-surface] event=\(event) point=\(Int(point.x)),\(Int(point.y)) decision=\(decision)\n", stderr)
        }
        return decision.shouldConsume
    }

    private func routeInputEscapeCancellation(event: String, data: [String: Any]) -> Bool? {
        guard event == "key_down",
              let canonicalEvent = AOSCanonicalInputEvent(canonicalData: data),
              let key = data["key"] as? [String: Any],
              (key["physical_key_code"] as? Int) == 53 else { return nil }
        let sourceSequence = inputEventSourceSequenceString(data)
        inputRegionLock.lock()
        let decision = inputRegions.cancelActiveCapture(
            reason: .escape,
            sourceSequence: sourceSequence,
            gestureID: sourceSequence.map { "escape:\($0)" }
        )
        let keyTargets = decision == nil
            ? inputKeyLeases.targets(logicalKey: "Escape")
            : []
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: false
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)
        if let decision {
            switch decision {
            case .failOpen:
                return false
            case .deliver(let delivery):
                canvasManager.postMessageAsync(
                    to: delivery.ownerCanvasGeneration,
                    payload: delivery.payload
                )
                return true
            }
        }
        let deliveries = keyTargets.compactMap { lease -> AOSInputKeyLeaseDelivery? in
            return AOSInputKeyLeaseDelivery(
                event: canonicalEvent,
                canonicalData: data,
                lease: lease,
                sourceSequence: sourceSequence
            )
        }
        for delivery in deliveries {
            canvasManager.postMessageAsync(
                to: delivery.ownerCanvasGeneration,
                payload: delivery.payload
            )
        }
        return deliveries.first?.consume
    }

    private func currentFrontToBackWindowNumbers() -> [Int] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        return list.compactMap { entry in
            if let number = entry[kCGWindowNumber as String] as? Int { return number }
            if let number = entry[kCGWindowNumber as String] as? NSNumber { return number.intValue }
            return nil
        }
    }

    private func broadcastInputEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let writers = subscribers.values
            .filter { $0.isSubscribed && $0.wantsInputEvents }
            .map(\.outbound)
        subscriberLock.unlock()

        for writer in writers { writer.enqueue(bytes) }

        // Forward to subscribed canvases via JS eval. Non-blocking; no response required.
        forwardInputEventToCanvases(data: data)
    }

    private func inputPoint(from data: [String: Any]) -> CGPoint? {
        if let x = data["x"] as? Double, let y = data["y"] as? Double {
            return CGPoint(x: x, y: y)
        }
        if let native = data["native"] as? [String: Any],
           let x = native["x"] as? Double,
           let y = native["y"] as? Double {
            return CGPoint(x: x, y: y)
        }
        return nil
    }

    private func routeInputRegionEvent(event: String, data: [String: Any]) -> Bool? {
        let triggeredAt = ProcessInfo.processInfo.systemUptime
        guard let descriptor = AOSInputEventDescriptor(type: event) else { return nil }
        let parsedEvent = AOSCanonicalInputEvent(canonicalData: data)
        let canonicalEvent = parsedEvent?.descriptor == descriptor ? parsedEvent : nil
        let point = inputPoint(from: data)
        let sourceSequence = inputEventSourceSequenceString(data)
        let gestureID = data["gesture_id"] as? String
        let desktopWorld: CGPoint?
        if let point {
            desktopWorld = inputRegionNativeToDesktopWorldPoint(point)
        } else {
            desktopWorld = nil
        }
        inputRegionLock.lock()
        let decision = inputRegions.resolveDelivery(
            descriptor: descriptor,
            event: canonicalEvent,
            point: point,
            desktopWorld: desktopWorld,
            sourceSequence: sourceSequence,
            gestureID: gestureID
        )
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: point != nil
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)
        guard let decision else { return nil }

        switch decision {
        case .failOpen:
            if ProcessInfo.processInfo.environment["AOS_INPUT_REGION_DIAGNOSTICS"] == "1" {
                fputs("[input-region] event=\(event) canonical_routed_input=false consume=false\n", stderr)
            }
            return false
        case .deliver(let delivery):
            if let desktopWorld,
               let pointerSessionID = delivery.pointerSessionID,
               let request = desktopWorldSceneTransport.nativePointerEffectRequest(
                region: delivery.region,
                phase: delivery.phase,
                button: delivery.button,
                desktopWorld: desktopWorld,
                pointerSessionID: pointerSessionID,
                triggeredAt: triggeredAt
               ) {
                triggerNativeSheetEffect(request)
            }
            canvasManager.postMessageAsync(
                to: delivery.ownerCanvasGeneration,
                payload: delivery.payload
            )
            if ProcessInfo.processInfo.environment["AOS_INPUT_REGION_DIAGNOSTICS"] == "1" {
                let detail = "event=\(event) phase=\(delivery.phase.rawValue) region=\(delivery.regionID) owner=\(delivery.ownerCanvasID) consume=\(delivery.consume)"
                fputs("[input-region] \(detail)\n", stderr)
            }
            return delivery.consume
        }
    }

    private func inputEventSourceSequenceString(_ data: [String: Any]) -> String? {
        guard let sequence = data["sequence"] as? [String: Any],
              let source = sequence["source"] as? String else { return nil }
        if let value = sequence["value"] as? Int { return "\(source):\(value)" }
        if let value = sequence["value"] as? UInt64 { return "\(source):\(value)" }
        if let value = sequence["value"] as? String, !value.isEmpty { return "\(source):\(value)" }
        return nil
    }

    private func inputRegionFrame(from payload: [String: Any]) -> CGRect? {
        let raw = payload["frame"] ?? payload["rect"]
        guard let arr = raw as? [Any], arr.count == 4 else { return nil }
        let parsed = arr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
        guard parsed.count == 4, parsed[2] > 0, parsed[3] > 0 else { return nil }
        return CGRect(x: parsed[0], y: parsed[1], width: parsed[2], height: parsed[3])
    }

    private func normalizedInputRegionCoordinateSpace(_ value: String?) -> String {
        let normalized = value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        switch normalized {
        case "desktop_world", "desktopworld":
            return "desktop_world"
        default:
            return "native"
        }
    }

    private func normalizedInputRegionConsumePolicy(_ value: String?) -> String {
        let normalized = value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        switch normalized {
        case "never", "down_only", "captured":
            return normalized!
        default:
            return "always"
        }
    }

    private func nativeInputRegionFrame(_ frame: CGRect, coordinateSpace: String) -> CGRect? {
        switch coordinateSpace {
        case "native":
            return frame
        case "desktop_world":
            let origin = allDisplaysBounds().origin
            return CGRect(
                x: frame.origin.x + origin.x,
                y: frame.origin.y + origin.y,
                width: frame.width,
                height: frame.height
            )
        default:
            return nil
        }
    }

    private func inputRegionNativeToDesktopWorldPoint(_ point: CGPoint) -> CGPoint {
        let origin = allDisplaysBounds().origin
        return CGPoint(x: point.x - origin.x, y: point.y - origin.y)
    }

    private func publishInputRegionCursorPresentation(
        _ result: AOSInputRegionCursorPresentationReconcileResult
    ) {
        if result.native.didHide { aosSetNativeCursorSuppressionSignalActive(true) }
        if result.native.didShow { aosSetNativeCursorSuppressionSignalActive(false) }
        for delivery in result.deliveries {
            canvasManager.postMessageAsync(
                to: delivery.ownerCanvasGeneration,
                payload: delivery.payload
            )
        }
    }

    private func restoreNativeCursorSuppressionForExit() {
        inputRegionLock.lock()
        inputRegions.clearPointerState()
        var result = inputRegionCursorPresentation.restore()
        if result.native.appliedHidden {
            result = inputRegionCursorPresentation.restore()
        }
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(result)
    }

    private func removeInputRegionsOwned(by ownerCanvasID: String, includeSuspendRetained: Bool) {
        inputRegionLock.lock()
        let removed = inputRegions.removeOwned(by: ownerCanvasID, includeSuspendRetained: includeSuspendRetained)
        if includeSuspendRetained {
            _ = inputKeyLeases.removeOwned(by: ownerCanvasID)
        }
        let cursorResult = inputRegionCursorPresentation.reconcile(
            target: inputRegions.cursorPresentationSnapshot(),
            emitMove: false
        )
        inputRegionLock.unlock()
        publishInputRegionCursorPresentation(cursorResult)
        for region in removed {
            publishInputRegionStateEvent(action: "removed", region: region)
        }
    }

    // MARK: - Idle Management

    var hasSubscribers: Bool {
        subscriberLock.lock()
        let result = !subscribers.isEmpty
        subscriberLock.unlock()
        return result
    }

    func checkIdle() {
        if !canvasManager.isEmpty || hasSubscribers || !spatial.isEmpty {
            cancelIdleTimer()
        } else {
            startIdleTimer()
        }
    }

    private func startIdleTimer() {
        guard idleTimeout.isFinite else {
            fputs("aos daemon invalid idle timeout (must be finite)\n", stderr)
            exit(1)
        }
        idleShutdownTimer.schedule(after: idleTimeout) { [weak self] in
            guard let self = self else { return }
            if self.canvasManager.isEmpty && !self.hasSubscribers {
                self.shutdown()
            }
        }
    }

    private func cancelIdleTimer() {
        idleShutdownTimer.cancel()
    }

    func shutdown(reason: String = "idle") {
        guard !isShuttingDown else { return }
        isShuttingDown = true
        fputs("aos daemon shutting down (\(reason))\n", stderr)
        idleShutdownTimer.cancel()
        operationExternalSpawnExpiryTimer?.cancel()
        operationExternalSpawnExpiryTimer = nil
        operationStatusItemProjection?.teardown()
        voiceTransport.shutdown()
        annotationSelection.shutdown()
        desktopFrameCaptureConsent.shutdown()
        _ = desktopFrameCapture.releaseAll(callerCanvasID: sceneStageCanvasID)
        desktopWorldNativeFeedback.shutdown()
        desktopPixelBroker.shutdown()
        perception.stop()
        restoreNativeCursorSuppressionForExit()
        spatial.stopPolling()
        unlink(socketPath)
        releaseDaemonLock()
        exit(0)
    }

    private func setupSignalHandlers() {
        signal(SIGPIPE, SIG_IGN)
        for signalNumber in [SIGINT, SIGTERM] {
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                self?.shutdown(reason: "signal")
            }
            source.resume()
            signalSources.append(source)
        }
    }

    private func acquireDaemonLock(mode: AOSRuntimeMode) {
        let lockPath = aosDaemonLockPath(for: mode)
        let fd = open(lockPath, O_CREAT | O_RDWR, 0o644)
        guard fd >= 0 else {
            exitError("open(\(lockPath)) failed: \(errno)", code: "LOCK_ERROR")
        }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            let owner = daemonLockOwnerDescription(fd: fd)
            close(fd)
            exitError(
                "Another \(mode.rawValue) daemon is already running\(owner). Stop it before starting a second \(mode.rawValue) daemon.",
                code: "DAEMON_ALREADY_RUNNING"
            )
        }
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        daemonLockFD = fd
        let payload = """
        {"pid":\(getpid()),"mode":"\(mode.rawValue)","socket_path":"\(socketPath)"}
        """
        _ = ftruncate(fd, 0)
        _ = lseek(fd, 0, SEEK_SET)
        payload.withCString { ptr in
            _ = write(fd, ptr, strlen(ptr))
        }
    }

    private func releaseDaemonLock() {
        guard daemonLockFD >= 0 else { return }
        _ = flock(daemonLockFD, LOCK_UN)
        close(daemonLockFD)
        daemonLockFD = -1
    }

    private func daemonLockOwnerDescription(fd: Int32) -> String {
        var buffer = [UInt8](repeating: 0, count: 256)
        _ = lseek(fd, 0, SEEK_SET)
        let n = read(fd, &buffer, buffer.count - 1)
        guard n > 0 else { return "" }
        let text = String(decoding: buffer.prefix(Int(n)), as: UTF8.self)
        guard let data = text.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pid = dict["pid"] as? Int else {
            return ""
        }
        return " (pid \(pid))"
    }
}
