// unified.swift — UnifiedDaemon: single socket hosting perception + display

import AppKit
import Darwin
import Foundation

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
    private var speechEngine: SpeechEngine?
    private var speechCancelTap: CFMachPort?
    private var speechCancelTapSource: CFRunLoopSource?
    private var contentServer: ContentServer?
    let coordination = CoordinationBus()

    // Socket server
    var serverFD: Int32 = -1
    private var daemonLockFD: Int32 = -1
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private let voiceTelemetryLock = NSLock()
    let canvasInspectorBundleLock = NSLock()
    var canvasInspectorBundleInFlight = false
    var canvasInspectorBundleLastTriggerAt = Date.distantPast

    // Canvas-side event subscriptions: canvas ID → set of event-type names it wants.
    // Populated when a canvas posts {type: 'subscribe', payload: {events: [...]}}.
    var canvasEventSubscriptions: [String: Set<String>] = [:]
    let canvasSubscriptionLock = NSLock()

    // Canvas ownership: child canvas ID → parent canvas ID.
    // Populated when a canvas creates another canvas via postMessage(canvas.create).
    // CLI-originated canvases have no entry here (nil parent), which the permission
    // check treats as "mutable by anyone" for debugging predictability.
    var canvasCreatedBy: [String: String] = [:]

    // Inverse of canvasCreatedBy: parent canvas ID → set of direct child IDs.
    // Maintained alongside canvasCreatedBy so cascade-remove doesn't need a scan.
    var canvasChildren: [String: Set<String>] = [:]
    private var activeConnections = Set<UUID>()
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")
    private let sigilInputLock = NSLock()
    private var sigilInputState = SigilInputState()

    // Wiki FSEvents watcher
    private var wikiWatcher: WikiWatcher?

    // Idle management
    var idleTimeout: TimeInterval
    var idleTimer: DispatchSourceTimer?

    // Coalesce display_geometry rebroadcasts — didChangeScreenParameters can
    // storm during display reconfig; we only need one broadcast per quiet burst.
    private var displayGeometryBroadcastScheduled = false
    private let displayGeometryCoalesceMs: Int = 100

    // Per-agent last-known position, keyed by agent id (e.g. "default" from
    // `sigil/agents/default.md`). In-memory only — wiped on daemon restart.
    // Written by the renderer on every transition to IDLE; read by the
    // renderer on boot to resume the avatar where the user last left it.
    // Spec: docs/superpowers/specs/2026-04-13-sigil-birthplace-and-lastposition.md
    var configChangeHandler: ((AosConfig) -> Void)?
    private var lastPositions: [String: (x: Double, y: Double)] = [:]
    private let lastPositionsLock = NSLock()

    struct SubscriberConnection {
        let fd: Int32
        var perceptionChannelIDs: Set<UUID>
        var isSubscribed: Bool  // subscribed to display events too
        var wantsInputEvents: Bool
    }

    private struct SigilInputState {
        var mode: String = "idle"
        var avatarRect: CGRect?
        var chatRect: CGRect?
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
        }
        perception.onInputEvent = { [weak self] event, data in
            self?.handleInputEvent(event: event, data: data) ?? false
        }

        // Wire canvas events -> broadcast
        canvasManager.onEvent = { [weak self] canvasID, payload in
            guard let self = self else { return }

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
                        canvasID: canvasID,
                        type: type,
                        events: events,
                        snapshot: wantsSnapshot
                    )
                    return
                case "canvas.create":
                    self.handleCanvasCreate(callerID: canvasID, payload: inner ?? [:])
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
                case "canvas.send":
                    self.handleCanvasSend(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.suspend":
                    self.handleCanvasSuspend(callerID: canvasID, payload: inner ?? [:])
                    return
                case "canvas.resume":
                    self.handleCanvasResume(callerID: canvasID, payload: inner ?? [:])
                    return
                case "lifecycle.ready":
                    DispatchQueue.main.async { [weak self] in
                        self?.canvasManager.receiveLifecycleReady(canvasID)
                    }
                    return
                case "lifecycle.complete":
                    let action = (inner?["action"] as? String)
                        ?? (inner?["reason"] as? String)
                        ?? ""
                    DispatchQueue.main.async { [weak self] in
                        self?.canvasManager.receiveLifecycleComplete(canvasID, action: action)
                    }
                    return
                case "position.get":
                    self.handlePositionGet(callerID: canvasID, payload: inner ?? [:])
                    return
                case "position.set":
                    self.handlePositionSet(callerID: canvasID, payload: inner ?? [:])
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
                case "canvas_inspector.capture_bundle":
                    self.triggerCanvasInspectorSeeBundle(sourceCanvasID: canvasID, trigger: inner?["trigger"] as? String ?? "canvas")
                    return
                case "canvas_inspector.request_bundle_config":
                    self.sendCanvasInspectorSeeBundleConfig(canvasID: canvasID)
                    return
                default:
                    break
                }
            }

            let data: [String: Any] = ["id": canvasID, "payload": payload]
            self.broadcastEvent(service: "display", event: "canvas_message", data: data)
        }

        canvasManager.onCanvasLifecycle = { [weak self] canvasInfo, action in
            guard let self = self else { return }
            self.publishCanvasLifecycle(action: action, canvasInfo: canvasInfo)

            // Drop event subscriptions when the canvas is gone.
            if action == "removed" {
                let canvasID = canvasInfo.id
                self.canvasSubscriptionLock.lock()
                let had = self.canvasEventSubscriptions.removeValue(forKey: canvasID) != nil
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
                if had {
                    fputs("[canvas-sub] cleared subscriptions for removed canvas=\(canvasID)\n", stderr)
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

        let policyWatcher = VoicePolicyWatcher(store: coordination.voicePolicyStore)
        policyWatcher.onChange = { [weak self] policy in
            guard let self else { return }
            self.coordination.handlePolicyReload(policy)
        }
        policyWatcher.start()
        voicePolicyWatcher = policyWatcher

        // Initialize voice if enabled
        if currentConfig.voice.enabled {
            initSpeechEngine()
        }
    }

    // MARK: - Event Broadcasting

    func broadcastEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.filter(\.isSubscribed).map(\.fd)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        let byteArray = [UInt8](bytes)
        eventWriteQueue.async {
            for fd in fds {
                byteArray.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
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
        if let parent = canvasInfo.parent { payload["parent"] = parent }
        if let track = canvasInfo.track { payload["track"] = track }
        if let scope = canvasInfo.scope { payload["scope"] = scope }
        if let ttl = canvasInfo.ttl { payload["ttl"] = ttl }
        if let cascade = canvasInfo.cascade { payload["cascade"] = cascade }
        if let suspended = canvasInfo.suspended { payload["suspended"] = suspended }
        return payload
    }

    private func publishCanvasLifecycle(action: String, canvasInfo: CanvasInfo) {
        updateSigilCanvasState(canvasID: canvasInfo.id, action: action, at: canvasInfo.at)
        guard let data = canvasLifecyclePayload(action: action, canvasInfo: canvasInfo) else { return }
        broadcastEvent(service: "display", event: "canvas_lifecycle", data: data)
        fanOutCanvasLifecycle(data)
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

    private func handleCanvasSubscription(canvasID: String, type: String, events: [String], snapshot: Bool) {
        guard !events.isEmpty else { return }

        canvasSubscriptionLock.lock()
        if type == "subscribe" {
            var current = canvasEventSubscriptions[canvasID] ?? []
            for ev in events { current.insert(ev) }
            canvasEventSubscriptions[canvasID] = current
        } else {  // unsubscribe
            if var current = canvasEventSubscriptions[canvasID] {
                for ev in events { current.remove(ev) }
                if current.isEmpty {
                    canvasEventSubscriptions.removeValue(forKey: canvasID)
                } else {
                    canvasEventSubscriptions[canvasID] = current
                }
            }
        }
        let currentEvents = canvasEventSubscriptions[canvasID]
        canvasSubscriptionLock.unlock()
        fputs("[canvas-sub] \(type) canvas=\(canvasID) events=\(events) current=\(currentEvents ?? [])\n", stderr)

        if type == "subscribe" && (snapshot || events.contains("display_geometry")) {
            dispatchCanvasSubscriptionSnapshots(to: canvasID, events: events)
        }
    }

    private func dispatchCanvasSubscriptionSnapshots(to canvasID: String, events: [String]) {
        // Dispatch async to avoid reentering the canvas message handler from inside
        // the subscribe path.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let requested = Set(events)
            if requested.contains("display_geometry") {
                self.broadcastDisplayGeometry(to: canvasID)
            }
            if requested.contains("canvas_lifecycle") {
                self.broadcastCanvasLifecycleSnapshot(to: canvasID)
            }
            if requested.contains("input_event") {
                self.canvasManager.postMessageAsync(
                    canvasID: canvasID,
                    payload: self.currentInputEventSnapshot()
                )
            }
        }
    }

    private func forwardInputEventToCanvases(data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("input_event") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: data)
        }
    }

    /// Fan out a wiki_page_changed event to every canvas that has subscribed
    /// to the `wiki_page_changed` channel. Caller (WikiChangeBus.emit) is
    /// responsible for shaping `data` so that `data["type"]` is the event
    /// name ("wiki_page_changed"), since live-js canvas dispatch routes by
    /// msg.type.
    func forwardWikiPageChangedToCanvases(data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("wiki_page_changed") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: data)
        }
    }

    /// Fan out a canvas_lifecycle event to every canvas that has subscribed
    /// to the `canvas_lifecycle` channel. Wraps `data` in a `{type, ...}`
    /// envelope since live-js canvas dispatch routes by msg.type and the
    /// broadcast site does not include `type` in the data dict.
    /// Mirror of forwardWikiPageChangedToCanvases.
    func fanOutCanvasLifecycle(_ data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("canvas_lifecycle") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": "canvas_lifecycle"]
        for (k, v) in data { msg[k] = v }

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: msg)
        }
    }

    /// Fan out `canvas_object.marks` to every canvas subscribed to that
    /// event name. Mirror of fanOutCanvasLifecycle. Wraps `data`
    /// in a `{type: "canvas_object.marks", ...}` envelope since live-js
    /// canvas dispatch routes by `msg.type`.
    private func forwardCanvasObjectMarks(data: [String: Any]) {
        canvasSubscriptionLock.lock()
        let targets = canvasEventSubscriptions
            .filter { $0.value.contains("canvas_object.marks") }
            .map { $0.key }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }

        var msg: [String: Any] = ["type": "canvas_object.marks"]
        for (k, v) in data { msg[k] = v }

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: msg)
        }
    }

    private func broadcastCanvasLifecycleSnapshot(to specificCanvas: String) {
        let infos = canvasManager.handle(CanvasRequest(action: "list")).canvases ?? []
        for info in infos {
            guard var payload = canvasLifecyclePayload(action: "created", canvasInfo: info) else { continue }
            payload["type"] = "canvas_lifecycle"
            canvasManager.postMessageAsync(canvasID: specificCanvas, payload: payload)
        }
    }

    /// Fan out the current display geometry snapshot to every canvas
    /// subscribed to `display_geometry`. Invoked on subscribe (single
    /// target) and on `NSApplication.didChangeScreenParametersNotification`
    /// (all subscribers).
    private func broadcastDisplayGeometry(to specificCanvas: String? = nil) {
        canvasSubscriptionLock.lock()
        let targets: [String]
        if let one = specificCanvas {
            targets = canvasEventSubscriptions[one]?.contains("display_geometry") == true ? [one] : []
        } else {
            targets = canvasEventSubscriptions
                .filter { $0.value.contains("display_geometry") }
                .map { $0.key }
        }
        canvasSubscriptionLock.unlock()

        guard !targets.isEmpty else { return }
        fputs("[canvas-sub] display_geometry change -> broadcasting to \(targets.count) canvas(es)\n", stderr)

        let snapshot = snapshotDisplayGeometry()

        for canvasID in targets {
            canvasManager.postMessageAsync(canvasID: canvasID, payload: snapshot)
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
        }
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
        canvasManager.postMessageAsync(canvasID: canvasID, payload: obj)
    }

    private func canvasMutationPermitted(callerID: String, targetID: String) -> Bool {
        if targetID == callerID { return true }
        canvasSubscriptionLock.lock()
        defer { canvasSubscriptionLock.unlock() }
        if let owner = canvasCreatedBy[targetID] { return owner == callerID }
        return true  // no recorded owner = CLI-origin = open per mutation-api rule 3
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
        guard let frameArr = payload["frame"] as? [Any], frameArr.count == 4 else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_FRAME", message: "frame must be [x,y,w,h]")
            return
        }
        let at: [CGFloat] = frameArr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
        guard at.count == 4 else {
            dispatchCanvasResponse(to: callerID, requestID: requestID,
                status: "error", code: "INVALID_FRAME", message: "frame values must be numeric")
            return
        }
        let interactive = payload["interactive"] as? Bool

        let resolvedURL = resolveContentURL(url)

        let resolvedParent = (payload["parent"] as? String) ?? callerID

        let req = CanvasRequest(
            action: "create",
            id: newID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: resolvedURL,
            interactive: interactive,
            focus: payload["focus"] as? Bool, ttl: nil, js: nil, scope: nil,
            autoProject: nil,
            track: payload["track"] as? String,
            parent: resolvedParent,
            cascade: payload["cascade"] as? Bool,
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

        // Build the CanvasRequest. Only `frame` and `interactive` are accepted for update.
        var at: [CGFloat]? = nil
        if let arr = payload["frame"] as? [Any], arr.count == 4 {
            let parsed: [CGFloat] = arr.compactMap { ($0 as? NSNumber).map { CGFloat(truncating: $0) } }
            if parsed.count == 4 { at = parsed }
        }
        let interactive = payload["interactive"] as? Bool

        guard at != nil || interactive != nil else {
            fputs("[canvas-mut] update dropped caller=\(callerID) target=\(targetID) reason=no-fields\n", stderr)
            return
        }

        let req = CanvasRequest(
            action: "update",
            id: targetID,
            at: at,
            anchorWindow: nil, anchorChannel: nil, offset: nil,
            html: nil, url: nil,
            interactive: interactive,
            focus: nil, ttl: nil, js: nil, scope: nil,
            autoProject: nil, channel: nil, data: nil
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
                              html: nil, url: nil, interactive: nil, focus: nil,
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

    /// Relay an arbitrary message from one canvas to another via headsup.receive.
    /// Payload: { target: "canvas-id", message: { ... } }
    private func handleCanvasSend(callerID: String, payload: [String: Any]) {
        guard let targetID = payload["target"] as? String, !targetID.isEmpty else { return }
        guard let message = payload["message"] else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.canvasManager.postMessageAsync(canvasID: targetID, payload: message)
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
            html: nil, url: nil, interactive: nil,
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

        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscribers[connectionID] = SubscriberConnection(fd: clientFD, perceptionChannelIDs: [], isSubscribed: false, wantsInputEvents: false)
        subscriberLock.unlock()

        defer {
            subscriberLock.lock()
            if let conn = subscribers[connectionID] {
                perception.attention.removeChannels(conn.perceptionChannelIDs)
            }
            subscribers.removeValue(forKey: connectionID)
            activeConnections.remove(connectionID)
            subscriberLock.unlock()

            // Clean up connection-scoped canvases on main thread
            DispatchQueue.main.async { [weak self] in
                self?.canvasManager.cleanupConnection(connectionID)
                self?.checkIdle()
            }

            close(clientFD)
        }

        cancelIdleTimer()

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            guard bytesRead > 0 else { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else {
                    sendResponseJSON(to: clientFD, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
                    continue
                }

                handleRequest(json: json, connectionID: connectionID, clientFD: clientFD)
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
        case ("show", "post"):                return "post"
        case ("see", "snapshot"):             return "snapshot"
        case ("tell", "send"):                return "tell"
        case ("listen", "read"):              return "coord-read"
        case ("listen", "channels"):          return "coord-channels"
        case ("session", "register"):         return "coord-register"
        case ("session", "unregister"):       return "coord-unregister"
        case ("session", "who"):              return "coord-who"
        case ("voice", "list"):               return "voice-list"
        case ("voice", "leases"):             return "voice-leases"
        case ("voice", "bind"):               return "voice-bind"
        case ("voice", "final_response"):     return "voice-final-response"
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
    private func handleRequest(json: [String: Any], connectionID: UUID, clientFD: Int32) {
        if isEnvelopeShape(json) {
            // Envelope request: routeAction will parse and dispatch it.
            routeAction("", json: json, clientFD: clientFD, connectionID: connectionID)
            return
        }
        // Non-envelope: allow only the explicit legacy carve-out for streaming subscribers.
        if let action = json["action"] as? String, action == "subscribe" {
            routeAction(action, json: json, clientFD: clientFD, connectionID: connectionID)
            return
        }
        // All other non-envelope requests are rejected.
        sendResponseJSON(to: clientFD, [
            "error": "Request envelope required ({v:1, service, action, data}).",
            "code": "PARSE_ERROR"
        ])
    }

    private func routeAction(_ action: String, json: [String: Any], clientFD: Int32, connectionID: UUID) {
        // Envelope dispatch: translate (service, action) to the legacy flat action
        // string and reshape `data` back into the top-level JSON the legacy
        // handlers expect. This keeps handler bodies untouched.
        if isEnvelopeShape(json) {
            guard let env = parseEnvelope(json) else {
                sendResponseJSON(to: clientFD, envelopeError(
                    error: "Request envelope has v:1 but malformed fields",
                    code: "PARSE_ERROR",
                    ref: json["ref"] as? String
                ))
                return
            }
            // Check that the service is one of the known namespaces.
            let knownServices: Set<String> = ["see", "do", "show", "tell", "listen", "session", "voice", "system", "focus", "graph", "content"]
            if !knownServices.contains(env.service) {
                sendResponseJSON(to: clientFD, envelopeError(
                    error: "Unknown service: \(env.service)",
                    code: "UNKNOWN_SERVICE",
                    ref: env.ref
                ))
                return
            }
            let legacyAction = legacyActionName(service: env.service, action: env.action)
            guard let legacy = legacyAction else {
                sendResponseJSON(to: clientFD, envelopeError(
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
            routeAction(legacy, json: flat, clientFD: clientFD, connectionID: connectionID)
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
            sendResponseJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            if wantsSnapshot { sendSubscriberSnapshots(to: clientFD, events: events) }

        case "sigil_input_mode":
            guard let mode = json["mode"] as? String, !mode.isEmpty else {
                sendResponseJSON(to: clientFD, ["error": "sigil_input_mode requires mode", "code": "INVALID_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            setSigilInputMode(mode)
            sendResponseJSON(to: clientFD, ["status": "ok", "mode": mode], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        // -- Display actions (dispatch to CanvasManager on main thread) --
        case "create", "update", "remove", "remove-all", "list", "eval", "to-front":
            let requestData = lineData(from: json)
            guard var request = CanvasRequest.from(requestData) else {
                sendResponseJSON(to: clientFD, ["error": "Failed to parse request", "code": "PARSE_ERROR"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
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

            sendResponseJSON(to: clientFD, canvasResponseDict(response), envelopeActive: envelopeActive, envelopeRef: envelopeRef)

            // Announce display actions
            if currentConfig.voice.enabled && currentConfig.voice.announce_actions {
                switch action {
                case "create":
                    if let id = json["id"] as? String {
                        announce("Canvas \(id) created")
                    }
                case "remove":
                    if let id = json["id"] as? String {
                        announce("Canvas \(id) removed")
                    }
                case "remove-all":
                    announce("All canvases removed")
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
                sendResponseJSON(to: clientFD, ["error": "Failed to parse request", "code": "PARSE_ERROR"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
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
            sendResponseJSON(to: clientFD, canvasResponseDict(postResponse), envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        // -- Coordination actions --
        case "tell":
            handleTellAction(json: json, clientFD: clientFD)

        case "coord-register":
            let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let canonicalSessionID = sessionID, !canonicalSessionID.isEmpty else {
                sendResponseJSON(to: clientFD, ["error": "session_id required for registration", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let legacyName = name?.isEmpty == false ? name : nil
            let role = json["role"] as? String ?? "worker"
            let harness = json["harness"] as? String ?? "unknown"
            let result = coordination.registerSession(sessionID: canonicalSessionID, name: legacyName, role: role, harness: harness)
            sendResponseJSON(to: clientFD, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-unregister":
            let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedName = name?.isEmpty == false ? name : nil
            let normalizedSessionID = sessionID?.isEmpty == false ? sessionID : nil
            guard normalizedSessionID != nil || normalizedName != nil else {
                sendResponseJSON(to: clientFD, ["error": "session_id or name required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let result = coordination.unregisterSession(sessionID: normalizedSessionID, name: normalizedName)
            sendResponseJSON(to: clientFD, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-who":
            let sessions = coordination.whoIsOnline()
            sendResponseJSON(to: clientFD, ["status": "ok", "sessions": sessions], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-list":
            let voices = coordination.voiceCatalog()
            let leases = voices.filter { $0["lease_session_id"] != nil }
            sendResponseJSON(to: clientFD, [
                "status": "ok",
                "voices": voices,
                "voice_count": voices.count,
                "leased_count": leases.count
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-leases":
            let leases = coordination.voiceLeases()
            sendResponseJSON(to: clientFD, [
                "status": "ok",
                "leases": leases,
                "lease_count": leases.count
            ], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-bind":
            guard let sessionID = json["session_id"] as? String, !sessionID.isEmpty else {
                sendResponseJSON(to: clientFD, ["error": "session_id required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            guard let voiceID = json["voice_id"] as? String, !voiceID.isEmpty else {
                sendResponseJSON(to: clientFD, ["error": "voice_id required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let result = coordination.bindVoice(sessionID: sessionID, voiceID: voiceID)
            sendResponseJSON(to: clientFD, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "voice-final-response":
            handleVoiceFinalResponseAction(json: json, clientFD: clientFD)

        case "coord-read":
            guard let channel = json["channel"] as? String else {
                sendResponseJSON(to: clientFD, ["error": "channel required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
                return
            }
            let since = json["since"] as? String
            let limit = json["limit"] as? Int ?? 50
            let msgs = coordination.readMessages(channel: channel, since: since, limit: limit)
            sendResponseJSON(to: clientFD, ["status": "ok", "channel": channel, "messages": msgs], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "coord-channels":
            let channels = coordination.listChannels()
            sendResponseJSON(to: clientFD, ["status": "ok", "channels": channels], envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        // -- Unified ping --
        case "ping":
            let uptime = Date().timeIntervalSince(startTime)
            let perceptionChannels = perception.attention.channelCount
            subscriberLock.lock()
            let subscriberCount = subscribers.count
            subscriberLock.unlock()
            let mode = aosCurrentRuntimeMode()
            let pid = Int(getpid())
            let startedAt = ISO8601DateFormatter().string(from: startTime)
            var response: [String: Any] = [
                "status": "ok",
                "uptime": uptime,
                "pid": pid,
                "mode": mode.rawValue,
                "socket_path": socketPath,
                "started_at": startedAt,
                "perception_channels": perceptionChannels,
                "subscribers": subscriberCount,
                "input_tap_status": perception.inputTapStatus,
                "input_tap_attempts": perception.inputTapAttempts,
            ]
            if let lockOwnerPID = aosDaemonLockOwnerPID(for: mode) {
                response["lock_owner_pid"] = lockOwnerPID
            }
            if let port = contentServer?.assignedPort, port > 0 {
                response["content_port"] = Int(port)
            }
            sendResponseJSON(to: clientFD, response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        case "content_status":
            if let server = contentServer {
                var result = server.statusDict()
                result["status"] = "ok"
                sendResponseJSON(to: clientFD, result, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            } else {
                sendResponseJSON(to: clientFD, ["status": "ok", "port": 0, "roots": [String: String](), "note": "content server not configured"] as [String: Any], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            }

        // -- Spatial / focus / graph actions --
        case "focus-create", "focus-update", "focus-remove", "focus-list",
             "graph-displays", "graph-windows", "graph-deepen", "graph-collapse",
             "snapshot":
            let response = spatial.handleAction(action, json: json)
            sendResponseJSON(to: clientFD, response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)

        default:
            sendResponseJSON(to: clientFD, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
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
        sendCanvasInspectorSeeBundleConfig(canvasID: "canvas-inspector")

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
                    speechEngine?.setVoice(voiceID)
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
            self.speechEngine = SpeechEngine(voice: self.currentConfig.voice.voice)
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
            let resolvedVoiceID = voiceID ?? self.currentConfig.voice.voice ?? SpeechEngine.resolvedDefaultVoiceID
            if !resolvedVoiceID.isEmpty {
                engine.setVoice(resolvedVoiceID)
            }
            if let rate = self.currentConfig.voice.rate {
                engine.setRate(rate)
            }
            engine.speak(text)
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
        let rendered = renderSpeechText(rawText: rawText, purpose: purpose, config: currentConfig)
        let sessionVoice = sendingSession?["voice"] as? [String: Any]
        let voiceID = sessionVoice?["id"] as? String ?? currentConfig.voice.voice ?? SpeechEngine.resolvedDefaultVoiceID
        if currentConfig.voice.enabled {
            announce(rendered.text, voiceID: voiceID)
        }
        var route: [String: Any] = [
            "audience": "human",
            "route": "voice",
            "delivered": currentConfig.voice.enabled,
            "rendered": rendered.dictionary()
        ]
        if let purpose {
            route["purpose"] = purpose
        }
        if let sessionVoice {
            route["voice"] = sessionVoice
        } else if let discovered = SpeechEngine.availableVoice(id: voiceID) {
            route["voice"] = SessionVoiceDescriptor(voiceInfo: discovered).dictionary()
        } else {
            route["voice"] = SessionVoiceDescriptor(
                provider: "system",
                id: voiceID,
                name: voiceID,
                locale: "unknown",
                gender: "unknown",
                quality_tier: SpeechEngine.qualityTier(forVoiceID: voiceID),
                available: false
            ).dictionary()
        }
        if let source, !source.isEmpty {
            route["source"] = source
        }
        if !currentConfig.voice.enabled {
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

    private func handleTellAction(json: [String: Any], clientFD: Int32) {
        let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
        let envelopeRef = json["__envelope_ref"] as? String
        // Accept audience as [String] array (v1 envelope) or comma-string (legacy).
        let audiences: [String]
        if let arr = json["audience"] as? [String], !arr.isEmpty {
            audiences = arr
        } else if let str = json["audience"] as? String, !str.isEmpty {
            audiences = str.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        } else {
            sendResponseJSON(to: clientFD, ["error": "audience required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
            return
        }

        let text = json["text"] as? String
        let jsonPayload = json["payload"]  // structured data alternative
        let fromSessionID = json["from_session_id"] as? String
        let purpose = json["purpose"] as? String
        let sendingSession = fromSessionID.flatMap { coordination.sessionInfo(sessionID: $0) }
        if let fromSessionID, sendingSession == nil {
            sendResponseJSON(to: clientFD, [
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
            sendResponseJSON(to: clientFD, ["error": "text or payload required", "code": "MISSING_ARG"], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
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

        sendResponseJSON(to: clientFD, ["status": "ok", "routes": routes], envelopeActive: envelopeActive, envelopeRef: envelopeRef)
    }

    private func handleVoiceFinalResponseAction(json: [String: Any], clientFD: Int32) {
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
            sendResponseJSON(to: clientFD, [
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
            sendResponseJSON(to: clientFD, [
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
            sendResponseJSON(to: clientFD, [
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
        sendResponseJSON(to: clientFD, [
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

    private func sendSnapshotEvent(to fd: Int32, service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }
        let byteArray = [UInt8](bytes)
        byteArray.withUnsafeBufferPointer { ptr in
            _ = write(fd, ptr.baseAddress!, ptr.count)
        }
    }

    private func sendSubscriberSnapshots(to fd: Int32, events: [String]) {
        let requested = Set(events)
        DispatchQueue.main.sync {
            if requested.contains("display_geometry") {
                sendSnapshotEvent(to: fd, service: "display", event: "display_geometry", data: snapshotDisplayGeometry())
            }
            if requested.contains("canvas_lifecycle") {
                let infos = canvasManager.handle(CanvasRequest(action: "list")).canvases ?? []
                for info in infos {
                    guard let data = canvasLifecyclePayload(action: "created", canvasInfo: info) else { continue }
                    sendSnapshotEvent(
                        to: fd,
                        service: "display",
                        event: "canvas_lifecycle",
                        data: data
                    )
                }
            }
            if requested.contains("input_event") {
                sendSnapshotEvent(
                    to: fd,
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
            ]
        )
    }

    private func requestedInputEvents(_ json: [String: Any]) -> Bool {
        guard let events = json["events"] as? [String] else { return false }
        return events.contains("input_event")
    }

    private func handleInputEvent(event: String, data: [String: Any]) -> Bool {
        let inspectorConsumed = maybeHandleCanvasInspectorSeeBundleHotkey(event: event, data: data)
        let shouldConsume = shouldConsumeSigilInputEvent(event: event, data: data)
        if !inspectorConsumed {
            broadcastInputEvent(service: "input", event: "input_event", data: data)
        }
        return inspectorConsumed || shouldConsume
    }

    private func broadcastInputEvent(service: String, event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: service, event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.filter { $0.isSubscribed && $0.wantsInputEvents }.map(\.fd)
        subscriberLock.unlock()

        if !fds.isEmpty {
            let byteArray = [UInt8](bytes)
            eventWriteQueue.async {
                for fd in fds {
                    byteArray.withUnsafeBufferPointer { ptr in
                        _ = write(fd, ptr.baseAddress!, ptr.count)
                    }
                }
            }
        }

        // Forward to subscribed canvases via JS eval. Non-blocking; no response required.
        forwardInputEventToCanvases(data: data)
    }

    private func updateSigilCanvasState(canvasID: String, action: String, at: [CGFloat]?) {
        sigilInputLock.lock()
        defer { sigilInputLock.unlock() }

        switch canvasID {
        case "avatar":
            sigilInputState.avatarRect = rectForSigilCanvasAction(action: action, at: at)
        case "agent-chat":
            sigilInputState.chatRect = rectForSigilCanvasAction(action: action, at: at)
        default:
            break
        }
    }

    private func rectForSigilCanvasAction(action: String, at: [CGFloat]?) -> CGRect? {
        guard action == "created" || action == "updated" else { return nil }
        guard let at, at.count >= 4 else { return nil }
        return CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
    }

    private func setSigilInputMode(_ mode: String) {
        sigilInputLock.lock()
        sigilInputState.mode = mode
        sigilInputLock.unlock()
    }

    private func shouldConsumeSigilInputEvent(event: String, data: [String: Any]) -> Bool {
        sigilInputLock.lock()
        let state = sigilInputState
        sigilInputLock.unlock()

        switch event {
        case "left_mouse_down":
            guard let point = sigilPoint(from: data) else { return false }
            let onAvatar = isPointOnSigilAvatar(point, avatarRect: state.avatarRect)
            switch state.mode {
            case "idle", "roaming", "followMe":
                return onAvatar
            default:
                return false
            }
        case "left_mouse_dragged", "left_mouse_up":
            return state.mode == "stellating" || state.mode == "radialMenuOpen"
        default:
            return false
        }
    }

    private func sigilPoint(from data: [String: Any]) -> CGPoint? {
        guard let x = data["x"] as? Double, let y = data["y"] as? Double else { return nil }
        return CGPoint(x: x, y: y)
    }

    private func isPointOnSigilAvatar(_ point: CGPoint, avatarRect: CGRect?) -> Bool {
        guard let avatarRect else { return false }
        let center = CGPoint(x: avatarRect.midX, y: avatarRect.midY)
        let radius = avatarRect.width * 0.35
        let dx = point.x - center.x
        let dy = point.y - center.y
        return sqrt(dx * dx + dy * dy) <= radius
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
        guard idleTimeout.isFinite else { return }
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

    func shutdown() {
        fputs("aos daemon shutting down (idle)\n", stderr)
        spatial.stopPolling()
        unlink(socketPath)
        releaseDaemonLock()
        exit(0)
    }

    private func setupSignalHandlers() {
        let handler: @convention(c) (Int32) -> Void = { _ in
            unlink(kDefaultSocketPath)
            exit(0)
        }
        signal(SIGPIPE, SIG_IGN)
        signal(SIGINT, handler)
        signal(SIGTERM, handler)
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
