// daemon.swift — Perception daemon: CGEventTap + cursor monitor + AX queries + event publishing

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

class PerceptionDaemon {
    let socketPath: String
    var serverFD: Int32 = -1
    let startTime = Date()
    let config: AosConfig
    let attention = AttentionEnvelope()

    // Subscriber tracking
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: SubscriberConnection] = [:]
    private let eventWriteQueue = DispatchQueue(label: "aos.event-write")

    // Cursor state
    private var lastCursorPoint: CGPoint = .zero
    private var lastWindowID: Int = 0
    private var lastAppPID: pid_t = 0
    private var lastAppName: String = ""
    private var lastElementRole: String = ""
    private var lastElementTitle: String = ""
    private var cursorIdleTimer: DispatchSourceTimer?
    private var lastMoveTime: Date = Date()

    // App lookup cache (refreshed periodically)
    private var appLookup: [pid_t: (name: String, bundleID: String?)] = [:]
    private var appLookupStale = true

    struct SubscriberConnection {
        let fd: Int32
        var channelIDs: Set<UUID>
    }

    init(config: AosConfig) {
        self.socketPath = kAosSocketPath
        self.config = config
    }

    // MARK: - Start

    func start() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        // Remove stale socket
        unlink(socketPath)

        // Create socket
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { exitError("socket() failed: \(errno)", code: "SOCKET_ERROR") }

        let bindResult = withSockAddr(socketPath) { addr, len in bind(serverFD, addr, len) }
        guard bindResult == 0 else { exitError("bind() failed: \(errno)", code: "BIND_ERROR") }
        guard listen(serverFD, 10) == 0 else { exitError("listen() failed: \(errno)", code: "LISTEN_ERROR") }

        fputs("aos daemon started on \(socketPath)\n", stderr)

        // Start CGEventTap for cursor monitoring
        startEventTap()

        // Start cursor settle timer
        startSettleTimer()

        // Refresh app lookup periodically
        startAppLookupRefresh()

        // Accept connections on background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Handle clean shutdown
        setupSignalHandlers()
    }

    // MARK: - CGEventTap (Depth 0)

    private func startEventTap() {
        let eventMask: CGEventMask = (1 << CGEventType.mouseMoved.rawValue)
            | (1 << CGEventType.leftMouseDragged.rawValue)
            | (1 << CGEventType.rightMouseDragged.rawValue)
            | (1 << CGEventType.otherMouseDragged.rawValue)

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let daemon = Unmanaged<PerceptionDaemon>.fromOpaque(refcon).takeUnretainedValue()
                daemon.handleMouseEvent(event)
                return Unmanaged.passUnretained(event)
            },
            userInfo: refcon
        ) else {
            fputs("Warning: CGEventTap failed — cursor monitoring unavailable (check Accessibility permissions)\n", stderr)
            return
        }

        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handleMouseEvent(_ event: CGEvent) {
        let point = event.location  // Global CG coordinates
        let now = Date()

        // Compute velocity (pixels per second)
        let dt = now.timeIntervalSince(lastMoveTime)
        let dx = point.x - lastCursorPoint.x
        let dy = point.y - lastCursorPoint.y
        let dist = sqrt(dx * dx + dy * dy)
        let velocity = dt > 0 ? dist / dt : 0

        lastCursorPoint = point
        lastMoveTime = now

        // Reset settle timer
        cursorIdleTimer?.cancel()
        startSettleTimer()

        guard attention.hasSubscribers else { return }

        // -- Depth 0: cursor_moved --
        if attention.wantsContinuousCursor || attention.wantsOnChange {
            let displays = getDisplays()
            let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
                ?? displays.first(where: { $0.isMain })?.ordinal ?? 1

            let data = cursorMovedData(x: point.x, y: point.y, display: displayOrdinal, velocity: velocity)
            broadcastEvent("cursor_moved", data: data)
        }

        // -- Depth 1: window/app change detection --
        if attention.maxDepth >= 1 && attention.wantsOnChange {
            checkWindowAndAppChange(at: point)
        }
    }

    // MARK: - Settle Timer (Depth 2)

    private func startSettleTimer() {
        let threshold = config.perception.settle_threshold_ms
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + .milliseconds(threshold))
        timer.setEventHandler { [weak self] in
            self?.onCursorSettled()
        }
        timer.resume()
        cursorIdleTimer = timer
    }

    private func onCursorSettled() {
        guard attention.hasSubscribers else { return }
        let point = lastCursorPoint
        let displays = getDisplays()
        let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
            ?? displays.first(where: { $0.isMain })?.ordinal ?? 1

        // cursor_settled event (depth 0)
        if attention.wantsOnSettle {
            let idleMs = Int(Date().timeIntervalSince(lastMoveTime) * 1000)
            let data = cursorSettledData(x: point.x, y: point.y, display: displayOrdinal, idle_ms: idleMs)
            broadcastEvent("cursor_settled", data: data)
        }

        // Depth 1 check on settle too
        if attention.maxDepth >= 1 {
            checkWindowAndAppChange(at: point)
        }

        // Depth 2: AX element at cursor
        if attention.maxDepth >= 2 {
            queryAXElementAtCursor(point)
        }
    }

    // MARK: - Depth 1: Window/App Detection

    private func checkWindowAndAppChange(at point: CGPoint) {
        let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

        for info in windowInfoList {
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
            guard rect.contains(point) else { continue }
            let layer = info[kCGWindowLayer as String] as? Int ?? 0
            guard layer == 0 else { continue }
            let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
            guard alpha > 0 else { continue }
            let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
            guard ownerName != "Window Server" else { continue }

            let windowID = info[kCGWindowNumber as String] as? Int ?? 0
            let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0

            // Window changed?
            if windowID != lastWindowID {
                lastWindowID = windowID
                let bundleID = appLookup[pid]?.bundleID
                let data = windowEnteredData(
                    window_id: windowID, app: ownerName, pid: Int(pid),
                    bundle_id: bundleID, bounds: Bounds(from: rect))
                broadcastEvent("window_entered", data: data)
            }

            // App changed?
            if pid != lastAppPID {
                lastAppPID = pid
                lastAppName = ownerName
                let bundleID = appLookup[pid]?.bundleID
                let data = appEnteredData(app: ownerName, pid: Int(pid), bundle_id: bundleID)
                broadcastEvent("app_entered", data: data)
            }

            break
        }
    }

    // MARK: - Depth 2: AX Element Query

    private func queryAXElementAtCursor(_ point: CGPoint) {
        guard AXIsProcessTrusted() else { return }
        guard lastAppPID > 0 else { return }

        if let hit = axElementAtPoint(pid: lastAppPID, point: point) {
            // Only emit if element changed
            let newRole = hit.role
            let newTitle = hit.title ?? ""
            if newRole != lastElementRole || newTitle != lastElementTitle {
                lastElementRole = newRole
                lastElementTitle = newTitle

                let data = elementFocusedData(
                    role: hit.role, title: hit.title, label: hit.label, value: hit.value,
                    bounds: hit.bounds.map { Bounds(from: $0) },
                    context_path: hit.contextPath)
                broadcastEvent("element_focused", data: data)
            }
        }
    }

    // MARK: - App Lookup Refresh

    private func startAppLookupRefresh() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: 5.0)
        timer.setEventHandler { [weak self] in
            self?.refreshAppLookup()
        }
        timer.resume()
        // Store reference to prevent dealloc
        _appRefreshTimer = timer
    }
    private var _appRefreshTimer: DispatchSourceTimer?

    private func refreshAppLookup() {
        var lookup: [pid_t: (name: String, bundleID: String?)] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            lookup[app.processIdentifier] = (name: app.localizedName ?? "unknown", bundleID: app.bundleIdentifier)
        }
        appLookup = lookup
    }

    // MARK: - Event Broadcasting

    private func broadcastEvent(_ event: String, data: [String: Any]) {
        guard let bytes = envelopeBytes(service: "perceive", event: event, data: data) else { return }

        subscriberLock.lock()
        let fds = subscribers.values.map(\.fd)
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

    // MARK: - Connection Handling

    private func acceptLoop() {
        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handleConnection(clientFD)
            }
        }
    }

    private func handleConnection(_ clientFD: Int32) {
        let connectionID = UUID()
        subscriberLock.lock()
        subscribers[connectionID] = SubscriberConnection(fd: clientFD, channelIDs: [])
        subscriberLock.unlock()

        defer {
            subscriberLock.lock()
            if let conn = subscribers[connectionID] {
                attention.removeChannels(conn.channelIDs)
            }
            subscribers.removeValue(forKey: connectionID)
            subscriberLock.unlock()
            close(clientFD)
        }

        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let bytesRead = read(clientFD, &chunk, chunk.count)
            guard bytesRead > 0 else { break }
            buffer.append(contentsOf: chunk[0..<bytesRead])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

                guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let action = json["action"] as? String else {
                    sendJSON(to: clientFD, ["error": "Invalid JSON", "code": "PARSE_ERROR"])
                    continue
                }

                switch action {
                case "subscribe":
                    // Legacy: simple subscribe (default depth from config)
                    let depth = json["depth"] as? Int ?? config.perception.default_depth
                    let scope = json["scope"] as? String ?? "cursor"
                    let rate = json["rate"] as? String ?? "on-settle"
                    let channelID = attention.addChannel(depth: depth, scope: scope, rate: rate)
                    subscriberLock.lock()
                    subscribers[connectionID]?.channelIDs.insert(channelID)
                    subscriberLock.unlock()
                    sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

                case "perceive":
                    // Open a perception channel with specific depth/scope/rate
                    let depth = json["depth"] as? Int ?? config.perception.default_depth
                    let scope = json["scope"] as? String ?? "cursor"
                    let rate = json["rate"] as? String ?? "on-settle"
                    let channelID = attention.addChannel(depth: depth, scope: scope, rate: rate)
                    subscriberLock.lock()
                    subscribers[connectionID]?.channelIDs.insert(channelID)
                    subscriberLock.unlock()
                    sendJSON(to: clientFD, ["status": "ok", "channel_id": channelID.uuidString])

                case "ping":
                    let uptime = Date().timeIntervalSince(startTime)
                    let channels = attention.channelCount
                    sendJSON(to: clientFD, ["status": "ok", "uptime": uptime, "channels": channels])

                default:
                    sendJSON(to: clientFD, ["error": "Unknown action: \(action)", "code": "UNKNOWN_ACTION"])
                }
            }
        }
    }

    // MARK: - Signal Handling

    private func setupSignalHandlers() {
        let handler: @convention(c) (Int32) -> Void = { _ in
            unlink(kAosSocketPath)
            exit(0)
        }
        signal(SIGINT, handler)
        signal(SIGTERM, handler)
    }
}
