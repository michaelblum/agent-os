// unified.swift — UnifiedDaemon: single socket hosting perception + display

import AppKit
import Darwin
import Foundation

private let inputSafetyLogCanvasID = "__log__"
private let inputSafetyLogConsoleURL = "aos://toolkit/components/log-console/index.html"
private var aosNativeCursorSuppressionSignalActive: Int32 = 0

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
    private lazy var voiceTransport = AOSVoiceTransport { [weak self] owner, event, data, ref in
        self?.emitVoiceTransportEvent(to: owner, event: event, data: data, ref: ref)
    }
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
    let coordination = CoordinationBus()

    // Socket server
    var serverFD: Int32 = -1
    private var daemonLockFD: Int32 = -1
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private let sceneLeases = AOSSceneLeaseRegistry()
    private lazy var desktopWorldDevTools = AOSDesktopWorldDevToolsController(
        canvasManager: canvasManager,
        sceneStageCanvasID: sceneStageCanvasID,
        ensureSceneStage: { [weak self] in self?.ensureSceneStage() ?? false },
        hasSceneMonitor: { [weak self] in self?.hasDesktopWorldSceneMonitor() ?? false },
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
    private let nativeCursorSuppressionLock = NSLock()
    private let nativeCursorSuppressionReconciler = AOSNativeCursorSuppressionReconciler()

    // Wiki FSEvents watcher
    private var wikiWatcher: WikiWatcher?

    // Idle management
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?

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
        var perceptionChannelIDs: Set<UUID>
        var isSubscribed: Bool  // subscribed to display events too
        var wantsInputEvents: Bool
        var sceneMonitorResource: String?
        var sceneMonitorRef: String?
        var sceneMonitorReady: Bool
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

        // Wire canvas events -> broadcast
        canvasManager.onEvent = { [weak self] target, payload in
            guard let self = self else { return }
            let canvasID = target.canvasID

            // Intercept subscribe/unsubscribe before relay — these configure daemon
            // state, not events for other subscribers to observe.
            if let dict = payload as? [String: Any],
               let type = dict["type"] as? String {
                let inner = dict["payload"] as? [String: Any]
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
                    self.recordCanvasReadyManifest(canvasID: canvasID, payload: inner)
                    return
                case "position.get":
                    self.handlePositionGet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "position.set":
                    self.handlePositionSet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "desktop_world_stage.scene.result":
                    self.handleSceneStageResult(inner ?? [:])
                    return
                case "desktop_world_stage.scene.event":
                    self.handleSceneStageEvent(inner ?? [:])
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
                case "capture.region":
                    self.handleCaptureRegion(callerID: canvasID, payload: inner ?? [:])
                    return
                case "browser_dom.element_target":
                    self.handleBrowserDomElementTarget(callerID: canvasID, payload: inner ?? [:])
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
                        self.recordCanvasReadyManifest(canvasID: canvasID, payload: inner)
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
                self.removeInputRegionsOwned(by: canvasInfo.id, includeSuspendRetained: true)
                self.desktopWorldDevTools.detachHost(id: canvasInfo.id)
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

        // Start content server
        if let contentConfig = currentConfig.content, !contentConfig.roots.isEmpty {
            let repoRoot = aosCurrentRepoRoot()
            contentServer = ContentServer(config: contentConfig, repoRoot: repoRoot, stateDir: aosStateDir())
            contentServer?.start()
        }

        // Register aos:// scheme handler on all WKWebViews — safety net that
        // prevents the custom scheme from leaking to macOS if resolveContentURL
        // fails to rewrite the URL (e.g. content server not yet ready).
        let schemeHandler = AosSchemeHandler()
        schemeHandler.portProvider = { [weak self] in self?.contentServer?.assignedPort ?? 0 }
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
            if let segments = info.segments {
                var topology = canvasManager.topologySettledPayload(canvasID: info.id, segments: segments)
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
            self.reconcileNativeCursorSuppressionAfterDisplayGeometryChange()
        }
    }

    private func reconcileNativeCursorSuppressionAfterDisplayGeometryChange() {
        inputRegionLock.lock()
        let cursorSuppressionActive = inputRegions.nativeCursorSuppressionActive()
        inputRegionLock.unlock()
        guard cursorSuppressionActive else { return }
        reconcileNativeCursorSuppression(active: cursorSuppressionActive)
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

    private func recordCanvasReadyManifest(canvasID: String, payload: [String: Any]?) {
        guard let payload = payload else { return }
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

    private func rectPayload(_ value: Any?) -> BrowserDomContentRect? {
        guard let dict = value as? [String: Any],
              let x = numberValue(dict["x"] ?? dict["left"]),
              let y = numberValue(dict["y"] ?? dict["top"]),
              let w = numberValue(dict["w"] ?? dict["width"]),
              let h = numberValue(dict["h"] ?? dict["height"]),
              w > 0,
              h > 0
        else { return nil }
        return BrowserDomContentRect(x: x, y: y, w: w, h: h)
    }

    private func handleBrowserDomElementTarget(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let sessionID = ((payload["browser_session_id"] as? String) ?? (payload["session_id"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let requestedWindowID = numberValue(payload["browser_window_id"] ?? payload["window_id"]).map(Int.init)
        guard !sessionID.isEmpty || requestedWindowID != nil else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "BROWSER_SESSION_UNRESOLVED", message: "browser_dom.element_target requires browser_session_id or browser_window_id")
            return
        }
        guard let pointDict = payload["point"] as? [String: Any],
              let x = numberValue(pointDict["x"]),
              let y = numberValue(pointDict["y"])
        else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "BROWSER_DOM_POINT_UNRESOLVED", message: "browser_dom.element_target requires point.x and point.y")
            return
        }
        guard let contentRect = rectPayload(payload["browser_content_rect"] ?? payload["content_rect"]) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "BROWSER_CONTENT_INSET_UNRESOLVED", message: "browser content rect evidence is required")
            return
        }

        do {
            let record = try sessionID.isEmpty
                ? readRegistry().first { $0.browser_window_id == requestedWindowID }
                : findRegistryRecord(id: sessionID)
            guard let record else {
                dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "BROWSER_SESSION_UNRESOLVED", message: "browser session is not registered for the supplied evidence")
                return
            }
            if let expectedWindow = requestedWindowID,
               let actualWindow = record.browser_window_id,
               expectedWindow != actualWindow {
                dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "NATIVE_AX_ROOT_MISMATCH", message: "browser session window does not match active native window")
                return
            }
            guard record.browser_window_id != nil else {
                dispatchCanvasResponse(to: callerID, requestID: requestID,
                    status: "error", code: "BROWSER_SESSION_NOT_LOCAL", message: "browser session has no local window evidence")
                return
            }

            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                do {
                    let target = BrowserTarget(session: record.id, ref: nil)
                    let body = try seeCaptureBrowserDomElementTarget(
                        target: target,
                        point: BrowserDomHitTestPoint(x: x, y: y),
                        contentRect: contentRect
                    )
                    guard var object = try JSONSerialization.jsonObject(with: Data(body.utf8), options: []) as? [String: Any] else {
                        self?.dispatchCanvasResponse(to: callerID, requestID: requestID,
                            status: "error", code: "BROWSER_DOM_TARGET_INVALID_JSON", message: "browser DOM element target response was not an object")
                        return
                    }
                    object["browser_session_id"] = record.id
                    object["browser_window_id"] = record.browser_window_id as Any
                    self?.dispatchCanvasResponse(to: callerID, requestID: requestID,
                        status: "ok", extra: object)
                } catch {
                    self?.dispatchCanvasResponse(to: callerID, requestID: requestID,
                        status: "error", code: "BROWSER_DOM_TARGET_FAILED", message: "\(error)")
                }
            }
        } catch {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "BROWSER_SESSION_UNRESOLVED", message: "\(error)")
        }
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
        guard let id = (payload["id"] as? String).flatMap({ $0.isEmpty ? nil : $0 }) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "MISSING_ID", message: "input_region.register requires id")
            return
        }
        let ownerCanvasID = (payload["owner_canvas_id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? callerID
        guard canvasMutationPermitted(callerID: callerID, targetID: ownerCanvasID) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "FORBIDDEN", message: "caller \(callerID) may not own region \(id) for \(ownerCanvasID)")
            return
        }
        guard let ownerTarget = ownerCanvasID == callerID
            ? caller
            : canvasManager.deliveryTarget(forCanvasID: ownerCanvasID) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "NOT_FOUND", message: "owner canvas \(ownerCanvasID) not found")
            return
        }
        guard let frame = inputRegionFrame(from: payload) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_FRAME", message: "input region frame must be [x,y,w,h]")
            return
        }

        let coordinateSpace = normalizedInputRegionCoordinateSpace(payload["coordinate_space"] as? String)
        guard let nativeFrame = nativeInputRegionFrame(frame, coordinateSpace: coordinateSpace) else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_COORDINATE_SPACE", message: "coordinate_space must be native or desktop_world")
            return
        }
        let metadata = (payload["metadata"] as? [String: Any])?.compactMapValues { value -> String? in
            if let string = value as? String { return string }
            if let number = value as? NSNumber { return number.stringValue }
            if let bool = value as? Bool { return bool ? "true" : "false" }
            return nil
        } ?? [:]
        let priority = (payload["priority"] as? NSNumber)?.intValue ?? 0
        let consumePolicy = normalizedInputRegionConsumePolicy(payload["consume_policy"] as? String)
        let semanticLabel = payload["semantic_label"] as? String ?? payload["label"] as? String ?? id
        let removeOnOwnerSuspend = (payload["remove_on_owner_suspend"] as? Bool) ?? true
        let enabled = (payload["enabled"] as? Bool) ?? true
        let region = AOSInputRegionRecord(
            id: id,
            ownerCanvasGeneration: ownerTarget,
            nativeFrame: nativeFrame,
            coordinateSpace: coordinateSpace,
            semanticLabel: semanticLabel,
            priority: priority,
            consumePolicy: consumePolicy,
            metadata: metadata,
            removeOnOwnerSuspend: removeOnOwnerSuspend,
            enabled: enabled
        )

        inputRegionLock.lock()
        let existed = inputRegions.snapshot().contains { $0.id == id }
        if updateOnly && !existed {
            inputRegionLock.unlock()
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "NOT_FOUND", message: "input region \(id) not found")
            return
        }
        inputRegions.register(region)
        let cursorSuppressionActive = inputRegions.nativeCursorSuppressionActive()
        inputRegionLock.unlock()
        reconcileNativeCursorSuppression(active: cursorSuppressionActive)

        let action = existed ? "updated" : "registered"
        publishInputRegionStateEvent(action: action, region: region)
        dispatchCanvasResponse(to: callerID, requestID: requestID, status: "ok", extra: ["region": inputRegionPayload(region)])
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
        let cursorSuppressionActive = inputRegions.nativeCursorSuppressionActive()
        inputRegionLock.unlock()
        reconcileNativeCursorSuppression(active: cursorSuppressionActive)

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

    /// Request/response: capture a CG-coordinate region and return a base64 image.
    /// Intended for small renderer-side sampling windows such as transition FX.
    private func handleCaptureRegion(callerID: String, payload: [String: Any]) {
        let requestID = payload["request_id"] as? String
        let number: (String) -> Double? = { key in
            if let raw = payload[key] as? NSNumber { return raw.doubleValue }
            if let raw = payload[key] as? Double { return raw }
            if let raw = payload[key] as? Int { return Double(raw) }
            if let raw = payload[key] as? String { return Double(raw) }
            return nil
        }

        guard let x = number("x"),
              let y = number("y"),
              let width = number("width") ?? number("w"),
              let height = number("height") ?? number("h"),
              x.isFinite, y.isFinite, width.isFinite, height.isFinite,
              width > 0, height > 0 else {
            dispatchCanvasResponse(
                to: callerID,
                requestID: requestID,
                status: "error",
                code: "INVALID_REGION",
                message: "capture.region requires finite x, y, width, height"
            )
            return
        }

        let format = (payload["format"] as? String)?.lowercased() ?? "jpg"
        let quality = (payload["quality"] as? String)?.lowercased() ?? "med"
        let excludeCanvasIDs = (payload["exclude_canvas_ids"] as? [String] ?? [])
            .filter { !$0.isEmpty }

        let excludeWindowIDs: [Int] = {
            guard !excludeCanvasIDs.isEmpty else { return [] }
            if Thread.isMainThread {
                return excludeCanvasIDs.flatMap { self.canvasManager.windowNumbers(forID: $0) }
            }
            var ids: [Int] = []
            DispatchQueue.main.sync {
                ids = excludeCanvasIDs.flatMap { self.canvasManager.windowNumbers(forID: $0) }
            }
            return ids
        }()

        let region = String(format: "%.3f,%.3f,%.3f,%.3f", x, y, width, height)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }

            var arguments = [
                "see", "capture",
                "--region", region,
                "--base64",
                "--format", format,
                "--quality", quality,
            ]
            for windowID in excludeWindowIDs {
                arguments.append(contentsOf: ["--exclude-window", String(windowID)])
            }

            let process = runProcess(
                aosExecutablePath(),
                arguments: arguments,
                environment: ["AOS_BYPASS_PERMISSIONS_SETUP": "1"]
            )
            guard process.exitCode == 0 else {
                self.dispatchCanvasResponse(
                    to: callerID,
                    requestID: requestID,
                    status: "error",
                    code: "CAPTURE_FAILED",
                    message: process.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "capture.region failed with exit code \(process.exitCode)"
                        : process.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                return
            }

            guard let data = process.stdout.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
                  let dict = parsed as? [String: Any],
                  let imageBase64 = (dict["base64"] as? [String])?.first else {
                self.dispatchCanvasResponse(
                    to: callerID,
                    requestID: requestID,
                    status: "error",
                    code: "INVALID_CAPTURE_RESPONSE",
                    message: "capture.region returned malformed JSON"
                )
                return
            }

            let mimeType: String = {
                switch format {
                case "png": return "image/png"
                case "heic": return "image/heic"
                default: return "image/jpeg"
                }
            }()

            self.dispatchCanvasResponse(
                to: callerID,
                requestID: requestID,
                status: "ok",
                extra: [
                    "base64": imageBase64,
                    "mime_type": mimeType,
                    "region": [
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                    ],
                ]
            )
        }
    }

    // MARK: - Connection Handling

    private func acceptLoop() {
        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }
            _ = disableSigPipe(clientFD)
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(clientFD)
            }
        }
    }

    private func handleConnection(_ clientFD: Int32) {
        let connectionID = UUID()
        let outbound = AOSConnectionOutboundWriter(connectionID: connectionID, fd: clientFD)

        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscribers[connectionID] = SubscriberConnection(
            outbound: outbound,
            perceptionChannelIDs: [],
            isSubscribed: false,
            wantsInputEvents: false,
            sceneMonitorResource: nil,
            sceneMonitorRef: nil,
            sceneMonitorReady: false
        )
        subscriberLock.unlock()

        defer {
            voiceTransport.connectionClosed(connectionID)
            annotationSelection.connectionClosed(connectionID)
            statusItemHostController.connectionClosed(connectionID)
            cleanupSceneLeases(connectionID)
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

    /// Strict parser for a v1 envelope `{v:1, service, action, data, ref?}`.
    /// Returns `(service, action, data, ref)` if all required fields are valid, `nil` if any field is malformed.
    private func parseEnvelope(_ json: [String: Any]) -> (service: String, action: String, data: [String: Any], ref: String?)? {
        guard let v = json["v"] as? Int, v == 1 else { return nil }
        guard let service = json["service"] as? String, !service.isEmpty else { return nil }
        guard let action = json["action"] as? String, !action.isEmpty else { return nil }
        guard let data = json["data"] as? [String: Any] else { return nil }
        let ref = json["ref"] as? String
        return (service, action, data, ref)
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

    private let sceneStageCanvasID = "aos-desktop-world-stage"

    private func sceneLeaseKey(owner: String, resource: String) -> String {
        return "\(owner)::\(resource)"
    }

    private func validSceneIdentifier(_ value: String, allowSlash: Bool) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard !scalars.isEmpty, scalars.count <= 128 else { return false }
        func alphaNumeric(_ scalar: UnicodeScalar) -> Bool {
            return (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57)
        }
        guard let first = scalars.first, alphaNumeric(first) else { return false }
        guard scalars.allSatisfy({ scalar in
            alphaNumeric(scalar)
                || scalar == "."
                || scalar == "_"
                || scalar == "-"
                || (allowSlash && scalar == "/")
        }) else { return false }
        return !allowSlash || !value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
            $0.isEmpty || $0 == "." || $0 == ".."
        })
    }

    private func cleanupSceneLeases(_ connectionID: UUID) {
        for key in sceneLeases.releaseAll(connectionID: connectionID) {
            canvasManager.postMessageToCurrentCanvasAsync(canvasID: sceneStageCanvasID, payload: [
                "type": "desktop_world_stage.scene.release",
                "payload": ["lease_key": key, "reason": "owner_disconnected"],
            ])
        }
    }

    private func handleSceneStageResult(_ payload: [String: Any]) {
        guard let key = payload["lease_key"] as? String else { return }
        guard let route = sceneLeases.routeResult(key: key) else { return }
        var eventData = payload
        eventData.removeValue(forKey: "lease_key")
        guard let bytes = envelopeBytes(
                service: "scene",
                event: "result",
                data: eventData,
                ref: route.ref
              ) else { return }
        subscriberLock.lock()
        let writer = subscribers[route.connectionID]?.outbound
        subscriberLock.unlock()
        writer?.enqueue(bytes)
    }

    private func handleSceneStageEvent(_ payload: [String: Any]) {
        guard let key = payload["lease_key"] as? String,
              let eventType = payload["event_type"] as? String,
              let event = payload["event"] as? [String: Any] else { return }
        guard let canonicalEvent = aosCanonicalSceneEvent(event),
              let route = sceneLeases.routeEvent(key: key, event: eventType),
              eventType == "gesture",
              canonicalEvent["type"] as? String == eventType,
              let ownerID = canonicalEvent["ownerId"] as? String,
              let resourceID = canonicalEvent["resourceId"] as? String,
              sceneLeaseKey(owner: ownerID, resource: resourceID) == key,
              let bytes = envelopeBytes(
                service: "scene",
                event: eventType,
                data: canonicalEvent,
                ref: route.ref
              ) else { return }
        subscriberLock.lock()
        let writer = subscribers[route.connectionID]?.outbound
        subscriberLock.unlock()
        writer?.enqueue(bytes)
    }

    private func hasDesktopWorldSceneMonitor() -> Bool {
        subscriberLock.lock()
        defer { subscriberLock.unlock() }
        return subscribers.values.contains(where: { $0.sceneMonitorResource != nil })
    }

    private func handleDesktopWorldDevToolsStageSnapshot(_ payload: [String: Any]) {
        guard desktopWorldDevTools.handleStageSnapshot(payload) else { return }
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
              validSceneIdentifier(resource, allowSlash: true) else {
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

    private func ensureSceneStage() -> Bool {
        let semaphore = DispatchSemaphore(value: 0)
        var available = false
        DispatchQueue.main.async { [weak self] in
            guard let self else { semaphore.signal(); return }
            if self.canvasManager.hasCanvas(self.sceneStageCanvasID) {
                available = true
                semaphore.signal()
                return
            }
            var request = CanvasRequest(action: "create", id: self.sceneStageCanvasID)
            request.url = self.resolveContentURL("aos://toolkit/components/desktop-world-stage/index.html")
            request.surface = "desktop-world"
            request.interactive = false
            request.scope = "global"
            request.cascade = false
            // DesktopWorld windows span every display. Keep them hidden until
            // the toolkit manifest follows transparent renderer initialization.
            request.suspended = true
            available = self.canvasManager.handle(request).status == "success"
            semaphore.signal()
        }
        semaphore.wait()
        guard available else { return false }
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if let manifest = readyManifest(for: sceneStageCanvasID),
               manifest["name"] as? String == "desktop-world-stage" {
                let resumeSemaphore = DispatchSemaphore(value: 0)
                var resumed = false
                DispatchQueue.main.async { [weak self] in
                    guard let self else { resumeSemaphore.signal(); return }
                    resumed = self.canvasManager.handle(CanvasRequest(
                        action: "resume",
                        id: self.sceneStageCanvasID
                    )).status == "success"
                    resumeSemaphore.signal()
                }
                resumeSemaphore.wait()
                return resumed
            }
            usleep(20_000)
        }
        return false
    }

    private func handleSceneFollow(
        json: [String: Any],
        connectionID: UUID,
        outbound: AOSConnectionOutboundWriter,
        envelopeActive: Bool,
        envelopeRef: String?
    ) {
        guard json["stage"] as? String == "desktop-world/main",
              let owner = json["owner"] as? String,
              let resource = json["resource"] as? String,
              let operation = json["operation"] as? [String: Any],
              let op = operation["op"] as? String else {
            sendResponseJSON(to: outbound, ["error": "Invalid scene request", "code": "INVALID_SCENE_OPERATION"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        guard validSceneIdentifier(owner, allowSlash: false),
              validSceneIdentifier(resource, allowSlash: true) else {
            sendResponseJSON(to: outbound, ["error": "Invalid scene owner or resource", "code": "INVALID_SCENE_IDENTITY"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        let allowed = Set(["mount", "transact", "signal", "play", "suspend", "resume", "inspect", "remove", "close", "subscribe", "unsubscribe"])
        guard allowed.contains(op) else {
            sendResponseJSON(to: outbound, ["error": "Unsupported scene operation", "code": "INVALID_SCENE_OPERATION"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        let supportedSceneEvents = Set(["gesture"])
        let requestedSceneEvents = operation["events"] as? [String] ?? []
        if op == "subscribe" || op == "unsubscribe" {
            guard Set(operation.keys).isSubset(of: Set(["op", "events"])),
                  requestedSceneEvents.count <= 8,
                  requestedSceneEvents.allSatisfy({ supportedSceneEvents.contains($0) }),
                  op != "subscribe" || !requestedSceneEvents.isEmpty else {
                sendResponseJSON(to: outbound, ["error": "Invalid scene event subscription", "code": "INVALID_SCENE_SUBSCRIPTION"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
        }
        let key = sceneLeaseKey(owner: owner, resource: resource)
        let acquisition = sceneLeases.acquire(
            key: key,
            connectionID: connectionID,
            ref: envelopeRef
        )
        guard case .acquired(let isNewLease) = acquisition else {
            sendResponseJSON(to: outbound, ["error": "Scene resource already has an active lease", "code": "SCENE_LEASE_BUSY"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        if op == "subscribe" || op == "unsubscribe" {
            let requested = Set(requestedSceneEvents)
            let events = sceneLeases.updateSubscriptions(
                key: key,
                connectionID: connectionID,
                adding: op == "subscribe" ? requested : [],
                removing: op == "unsubscribe" ? requested : [],
                removeAll: op == "unsubscribe" && requested.isEmpty
            ) ?? []
            sendResponseJSON(to: outbound, [
                "status": "ok",
                "operation": op,
                "resource": resource,
                "events": events.sorted(),
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        guard ensureSceneStage() else {
            if isNewLease { _ = sceneLeases.release(key: key, connectionID: connectionID) }
            sendResponseJSON(to: outbound, ["error": "DesktopWorld scene stage is unavailable", "code": "SCENE_STAGE_UNAVAILABLE"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }
        canvasManager.postMessageToCurrentCanvasAsync(canvasID: sceneStageCanvasID, payload: [
            "type": "desktop_world_stage.scene.operation",
            "payload": [
                "lease_key": key,
                "owner": owner,
                "resource": resource,
                "operation": operation,
            ],
        ])
        if op == "close" {
            _ = sceneLeases.release(key: key, connectionID: connectionID)
        }
        sendResponseJSON(to: outbound, [
            "status": "ok",
            "operation": op,
            "resource": resource,
        ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
    }

    /// Map v1 envelope (service, action) to the legacy flat action string
    /// used by the existing switch. Returns nil if the pair is not in the v1 catalog.
    private func legacyActionName(service: String, action: String) -> String? {
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

    // MARK: - Request Routing

    /// Top-level request gatekeeper. Enforces the v1 envelope contract.
    ///
    /// Non-envelope requests return PARSE_ERROR, with one explicit transitional
    /// carve-out: bare `{"action":"subscribe"}` is still accepted for streaming
    /// event-bus consumers (`listen --follow`, `see observe`, `event-stream.swift`)
    /// that hold a persistent socket and cannot use sendEnvelopeRequest's
    /// one-shot API. This carve-out will be cleaned up when a `listen.subscribe`
    /// v1 action is defined (tracked separately).
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
        // Non-envelope: allow only the explicit legacy carve-out for streaming subscribers.
        if let action = json["action"] as? String, action == "subscribe" {
            routeAction(action, json: json, outbound: outbound, connectionID: connectionID)
            return
        }
        // All other non-envelope requests are rejected.
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
        // Envelope dispatch: translate (service, action) to the legacy flat action
        // string and reshape `data` back into the top-level JSON the legacy
        // handlers expect. This keeps handler bodies untouched.
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
            let knownServices: Set<String> = ["see", "do", "show", "tell", "listen", "session", "voice", "annotation", "status_item", "scene", "system", "focus", "graph", "content"]
            if !knownServices.contains(env.service) {
                sendResponseJSON(to: outbound, envelopeError(
                    error: "Unknown service: \(env.service)",
                    code: "UNKNOWN_SERVICE",
                    ref: env.ref
                ))
                return
            }
            let legacyAction = legacyActionName(service: env.service, action: env.action)
            guard let legacy = legacyAction else {
                sendResponseJSON(to: outbound, envelopeError(
                    error: "Unknown (service, action): (\(env.service), \(env.action))",
                    code: "UNKNOWN_ACTION",
                    ref: env.ref
                ))
                return
            }
            // Reshape: merge `data` into a flat dict and set `action`.
            var flat = env.data
            flat["action"] = legacy
            flat["__envelope_ref"] = env.ref ?? ""
            flat["__envelope_active"] = true
            routeAction(legacy, json: flat, outbound: outbound, connectionID: connectionID)
            return
        }

        let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
        let envelopeRef = json["__envelope_ref"] as? String

        switch action {

        // -- Perception actions --
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
            handleSceneFollow(
                json: json,
                connectionID: connectionID,
                outbound: outbound,
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

        case "status-item-register", "status-item-update", "status-item-inspect", "status-item-invoke",
             "status-item-invoke-dry-run":
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
        // Reachable only via the show.post -> "post" legacyActionName mapping,
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
            do {
                try voiceTransport.startSegmentedCapture(
                    owner: connectionID,
                    directoryPath: directoryPath,
                    segmentDuration: segmentDuration,
                    maximumDuration: maximumDuration,
                    ref: envelopeRef
                )
                sendResponseJSON(to: outbound, ["status": "ok"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
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
                    ],
                    "surface_transport_probe": surfaceTransportProbeSnapshot(
                        inputEventSubscriberCount: inputEventSubscriberCount
                    ),
                ] as [String: Any],
                // Legacy flat fields preserved
                "input_tap_status": perception.inputTapStatus,
                "input_tap_attempts": perception.inputTapAttempts,
                // New nested input_tap block
                "input_tap": [
                    "status": perception.inputTapStatus,
                    "attempts": perception.inputTapAttempts,
                    "listen_access": perception.inputTapListenAccess,
                    "post_access": perception.inputTapPostAccess,
                    "last_error_at": lastErrorAt,
                    // Compatibility fields: historically named panic_*.
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
        // Accept audience as [String] array (v1 envelope) or comma-string (legacy).
        let audiences: [String]
        if let arr = json["audience"] as? [String], !arr.isEmpty {
            audiences = arr
        } else if let str = json["audience"] as? String, !str.isEmpty {
            audiences = str.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        } else {
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
        inputRegionLock.unlock()
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
        inputRegionLock.unlock()
        guard let decision else { return nil }

        switch decision {
        case .failOpen:
            if ProcessInfo.processInfo.environment["AOS_INPUT_REGION_DIAGNOSTICS"] == "1" {
                fputs("[input-region] event=\(event) canonical_routed_input=false consume=false\n", stderr)
            }
            return false
        case .deliver(let delivery):
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

    private func reconcileNativeCursorSuppression(active: Bool) {
        nativeCursorSuppressionLock.lock()
        let result = nativeCursorSuppressionReconciler.reconcile(active: active)
        nativeCursorSuppressionLock.unlock()
        guard result.hideNativeCursor || result.showNativeCursor else { return }
        DispatchQueue.main.async {
            if result.showNativeCursor {
                CGDisplayShowCursor(CGMainDisplayID())
                aosSetNativeCursorSuppressionSignalActive(false)
            }
            if result.hideNativeCursor {
                CGDisplayHideCursor(CGMainDisplayID())
                aosSetNativeCursorSuppressionSignalActive(true)
            }
        }
    }

    private func restoreNativeCursorSuppressionForExit() {
        nativeCursorSuppressionLock.lock()
        let result = nativeCursorSuppressionReconciler.restore()
        nativeCursorSuppressionLock.unlock()
        guard result.showNativeCursor else { return }
        CGDisplayShowCursor(CGMainDisplayID())
        aosSetNativeCursorSuppressionSignalActive(false)
    }

    private func removeInputRegionsOwned(by ownerCanvasID: String, includeSuspendRetained: Bool) {
        inputRegionLock.lock()
        let removed = inputRegions.removeOwned(by: ownerCanvasID, includeSuspendRetained: includeSuspendRetained)
        if includeSuspendRetained {
            _ = inputKeyLeases.removeOwned(by: ownerCanvasID)
        }
        let cursorSuppressionActive = inputRegions.nativeCursorSuppressionActive()
        inputRegionLock.unlock()
        reconcileNativeCursorSuppression(active: cursorSuppressionActive)
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
        idleTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            if self.canvasManager.isEmpty && !self.hasSubscribers {
                self.shutdown()
            }
        }
        timer.resume()
        idleTimer = timer
    }

    private func cancelIdleTimer() {
        idleTimer?.cancel()
        idleTimer = nil
    }

    func shutdown(reason: String = "idle") {
        guard !isShuttingDown else { return }
        isShuttingDown = true
        fputs("aos daemon shutting down (\(reason))\n", stderr)
        voiceTransport.shutdown()
        annotationSelection.shutdown()
        restoreNativeCursorSuppressionForExit()
        perception.stop()
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
