// heads-up — Daemon server
// Listens on Unix socket, dispatches commands to CanvasManager, manages idle timeout.
// Optional status bar icon (configured via ~/.config/heads-up/config.json).

import AppKit
import Foundation

// MARK: - Daemon Config

struct DaemonConfig: Codable {
    var statusItem: StatusItemConfig?

    struct StatusItemConfig: Codable {
        var enabled: Bool?          // false by default — headless daemon is the default
        var icon: String?           // path to 18×18pt template PNG (nil = built-in hexagon)
        var onClick: String?        // "toggle" (future: "popover")
        var toggleId: String?       // canvas ID to toggle (default: "avatar")
        var toggleUrl: String?      // URL to load when creating the toggle canvas
        var toggleAt: [Double]?     // [x, y, w, h] position for the toggle canvas
    }
}

// MARK: - Status Item Manager

/// Manages the menu bar icon. Click = toggle a canvas on/off.
/// The icon, toggle target, and behavior are all configurable via DaemonConfig.
class StatusItemManager: NSObject {
    let canvasManager: CanvasManager
    var statusItem: NSStatusItem?

    let toggleId: String
    let toggleUrl: String
    let toggleAt: [Double]
    let customIconPath: String?

    init(canvasManager: CanvasManager, config: DaemonConfig.StatusItemConfig) {
        self.canvasManager = canvasManager
        self.toggleId = config.toggleId ?? "avatar"
        self.toggleUrl = config.toggleUrl ?? ""
        self.toggleAt = config.toggleAt ?? [200, 200, 300, 300]
        self.customIconPath = config.icon
        super.init()
    }

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
    }

    private var isDismissing = false

    @objc func handleClick(_ sender: Any?) {
        guard !isDismissing else { return }  // ignore clicks during dismiss animation

        if canvasManager.hasCanvas(toggleId) {
            // Egress: play dismissed skin animation + fly back to icon, then remove
            isDismissing = true
            updateIcon()  // switch to outline immediately

            // Tell the skin to play the dismissed transition (shrink to 0 internally)
            var evalReq = CanvasRequest(action: "eval")
            evalReq.id = toggleId
            let msg = "{\"type\":\"behavior\",\"slot\":\"dismissed\"}"
            let b64 = Data(msg.utf8).base64EncodedString()
            evalReq.js = "headsup.receive('\(b64)')"
            _ = canvasManager.handle(evalReq)

            // Simultaneously animate canvas position/size back to the icon
            let iconCG = statusItemCGPosition()
            let endSize: CGFloat = 20

            // Read current canvas position for the animation start
            let listResp = canvasManager.handle(CanvasRequest(action: "list"))
            var fromX: CGFloat = 200, fromY: CGFloat = 200, fromW: CGFloat = 300, fromH: CGFloat = 300
            if let canvases = listResp.canvases {
                for c in canvases where c.id == toggleId {
                    fromX = c.at[0]; fromY = c.at[1]; fromW = c.at[2]; fromH = c.at[3]
                }
            }
            let toX = iconCG.x - endSize / 2, toY = iconCG.y

            let duration = 0.4
            let fps = 60.0
            let totalFrames = Int(duration * fps)

            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                let t0 = Date()
                for i in 0...totalFrames {
                    let t = Double(i) / Double(totalFrames)
                    // easeInBack: accelerate into the icon
                    let c1 = 1.70158, c3 = c1 + 1
                    let e = c3 * t * t * t - c1 * t * t

                    let x = fromX + (toX - fromX) * CGFloat(e)
                    let y = fromY + (toY - fromY) * CGFloat(e)
                    let w = fromW + (endSize - fromW) * CGFloat(e)
                    let h = fromH + (endSize - fromH) * CGFloat(e)

                    DispatchQueue.main.async {
                        var updateReq = CanvasRequest(action: "update")
                        updateReq.id = self?.toggleId
                        updateReq.at = [x, y, w, h]
                        _ = self?.canvasManager.handle(updateReq)
                    }

                    let want = Double(i + 1) / fps
                    let got = Date().timeIntervalSince(t0)
                    if want > got { Thread.sleep(forTimeInterval: want - got) }
                }

                // Remove after animation completes
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    var removeReq = CanvasRequest(action: "remove")
                    removeReq.id = self.toggleId
                    _ = self.canvasManager.handle(removeReq)
                    self.isDismissing = false
                    self.updateIcon()
                }
            }
        } else {
            // Ingress: create canvas at the menu bar icon position (invisible),
            // wait for WKWebView to load, then reveal + animate to target.
            guard !toggleUrl.isEmpty, toggleAt.count == 4 else { return }

            let iconCG = statusItemCGPosition()
            let startSize: CGFloat = 40
            let fromX = iconCG.x - startSize / 2
            let fromY = iconCG.y

            // Target position/size from config
            let targetX = CGFloat(toggleAt[0])
            let targetY = CGFloat(toggleAt[1])
            let targetW = CGFloat(toggleAt[2])
            let targetH = CGFloat(toggleAt[3])

            // Create canvas at icon position — starts INVISIBLE to avoid flash
            var req = CanvasRequest(action: "create")
            req.id = toggleId
            req.url = toggleUrl
            req.at = [fromX, fromY, startSize, startSize]
            _ = canvasManager.handle(req)
            canvasManager.setCanvasAlpha(toggleId, 0)  // hide until ready
            updateIcon()

            // Wait for WKWebView to initialize, then reveal + animate
            let duration = 0.5
            let fps = 60.0
            let totalFrames = Int(duration * fps)

            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                // Give WKWebView time to load + Three.js to initialize
                Thread.sleep(forTimeInterval: 0.35)

                // Reveal the canvas
                DispatchQueue.main.async {
                    self?.canvasManager.setCanvasAlpha(self?.toggleId ?? "", 1)
                }

                // Animate from icon to target
                let t0 = Date()
                for i in 0...totalFrames {
                    let t = Double(i) / Double(totalFrames)
                    let e = 1 - pow(1 - t, 3)  // easeOutCubic

                    let x = fromX + (targetX - fromX) * CGFloat(e)
                    let y = fromY + (targetY - fromY) * CGFloat(e)
                    let w = startSize + (targetW - startSize) * CGFloat(e)
                    let h = startSize + (targetH - startSize) * CGFloat(e)

                    DispatchQueue.main.async {
                        var updateReq = CanvasRequest(action: "update")
                        updateReq.id = self?.toggleId
                        updateReq.at = [x, y, w, h]
                        _ = self?.canvasManager.handle(updateReq)
                    }

                    let want = Double(i + 1) / fps
                    let got = Date().timeIntervalSince(t0)
                    if want > got { Thread.sleep(forTimeInterval: want - got) }
                }
            }
        }
    }

    /// Get the menu bar icon's position in CG coordinates (Y-down).
    func statusItemCGPosition() -> CGPoint {
        guard let button = statusItem?.button,
              let window = button.window else {
            return CGPoint(x: 100, y: 0)  // fallback: top of screen
        }
        let frameInScreen = window.frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        // Center of the icon in CG coords
        let cgX = frameInScreen.midX
        let cgY = primaryHeight - frameInScreen.midY
        return CGPoint(x: cgX, y: cgY)
    }

    func updateIcon() {
        let showing = canvasManager.hasCanvas(toggleId)

        if let iconPath = customIconPath,
           let img = NSImage(contentsOfFile: iconPath) {
            img.isTemplate = true
            img.size = NSSize(width: 18, height: 18)
            statusItem?.button?.image = img
        } else {
            statusItem?.button?.image = drawDefaultIcon(filled: showing)
        }
    }

    /// Draw a small hexagon — geometric, neutral, suggests "display surface."
    /// Filled when the toggle canvas is showing, outline when hidden.
    private func drawDefaultIcon(filled: Bool) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX, cy = rect.midY
            let r: CGFloat = 7.0   // hexagon radius
            let path = NSBezierPath()

            // Regular hexagon (flat-top)
            for i in 0..<6 {
                let angle = CGFloat(Double(i) * .pi / 3.0 - .pi / 6.0)
                let px = cx + r * cos(angle)
                let py = cy + r * sin(angle)
                if i == 0 { path.move(to: NSPoint(x: px, y: py)) }
                else { path.line(to: NSPoint(x: px, y: py)) }
            }
            path.close()

            NSColor.black.setStroke()
            path.lineWidth = 1.2

            if filled {
                NSColor.black.setFill()
                path.fill()
            }
            path.stroke()

            // Inner dot
            let dotR: CGFloat = filled ? 2.0 : 1.5
            let dotRect = NSRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            let dot = NSBezierPath(ovalIn: dotRect)
            if filled {
                NSColor.white.setFill()
            } else {
                NSColor.black.setFill()
            }
            dot.fill()

            return true
        }
        img.isTemplate = true
        return img
    }
}

// MARK: - Daemon Server

class DaemonServer {
    let socketPath: String
    let canvasManager: CanvasManager
    var serverFD: Int32 = -1
    var idleTimer: DispatchSourceTimer?
    var idleTimeout: TimeInterval

    // Subscriber tracking for event relay (thread-safe)
    private var subscriberLock = NSLock()
    private var subscribers: [UUID: Int32] = [:]    // connectionID → FD
    private var activeConnections = Set<UUID>()      // all live connections
    private let eventWriteQueue = DispatchQueue(label: "heads-up.event-write")

    init(socketPath: String, canvasManager: CanvasManager, idleTimeout: TimeInterval = 5.0) {
        self.socketPath = socketPath
        self.canvasManager = canvasManager
        self.idleTimeout = idleTimeout
    }

    /// Create the socket file and start accepting connections.
    /// Call this BEFORE NSApplication.run().
    func start() {
        // Ensure directory exists
        try? FileManager.default.createDirectory(
            atPath: (socketPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true)

        // Remove stale socket
        unlink(socketPath)

        // Create socket
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else {
            exitError("socket() failed: \(errno)", code: "SOCKET_ERROR")
        }

        // Bind
        let bindResult = withSockAddr(socketPath) { addr, len in
            bind(serverFD, addr, len)
        }
        guard bindResult == 0 else {
            exitError("bind() failed: \(errno)", code: "BIND_ERROR")
        }

        // Listen
        guard listen(serverFD, 5) == 0 else {
            exitError("listen() failed: \(errno)", code: "LISTEN_ERROR")
        }

        // Accept connections on a background queue
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.acceptLoop()
        }

        // Start idle timer (daemon starts idle — no canvases yet)
        startIdleTimer()

        // Clean up socket on termination
        setupSignalHandlers()
    }

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

        // Track this connection
        subscriberLock.lock()
        activeConnections.insert(connectionID)
        subscriberLock.unlock()

        defer {
            // Remove from subscribers and active connections
            subscriberLock.lock()
            subscribers.removeValue(forKey: connectionID)
            activeConnections.remove(connectionID)
            subscriberLock.unlock()

            // Remove connection-scoped canvases (synchronous, on main thread)
            let sem = DispatchSemaphore(value: 0)
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { sem.signal(); return }
                self.canvasManager.cleanupConnection(connectionID)
                self.checkIdle()
                sem.signal()
            }
            sem.wait()

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

                guard let request = CanvasRequest.from(lineData) else {
                    let errResp = CanvasResponse.fail("Invalid JSON", code: "PARSE_ERROR")
                    self.sendResponse(to: clientFD, errResp)
                    continue
                }

                // Handle subscribe at the server level (not forwarded to CanvasManager)
                if request.action == "subscribe" {
                    subscriberLock.lock()
                    subscribers[connectionID] = clientFD
                    subscriberLock.unlock()
                    self.sendResponse(to: clientFD, .ok())
                    DispatchQueue.main.async { [weak self] in self?.checkIdle() }
                    continue
                }

                // Handle post at the server level — relay to all subscribers
                if request.action == "post" {
                    if let channel = request.channel {
                        self.relayChannelPost(channel: channel, dataStr: request.data)
                    }
                    self.sendResponse(to: clientFD, .ok())
                    continue
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

                self.sendResponse(to: clientFD, response)
            }
        }
    }

    private func sendResponse(to clientFD: Int32, _ response: CanvasResponse) {
        guard var data = response.toData() else { return }
        data.append(UInt8(ascii: "\n"))
        data.withUnsafeBytes { ptr in
            _ = write(clientFD, ptr.baseAddress!, ptr.count)
        }
    }

    var hasSubscribers: Bool {
        subscriberLock.lock()
        let result = !subscribers.isEmpty
        subscriberLock.unlock()
        return result
    }

    /// If true, the status item keeps the daemon alive regardless of canvas/subscriber count.
    var hasStatusItem: Bool = false

    func checkIdle() {
        // Status item keeps daemon alive — it's a reason to exist
        if hasStatusItem { cancelIdleTimer(); return }
        // Revised idle: no canvases AND no subscriber connections
        if canvasManager.isEmpty && !hasSubscribers {
            startIdleTimer()
        } else {
            cancelIdleTimer()
        }
    }

    /// Relay a canvas JS event to all subscriber connections.
    /// Called on the main thread from CanvasManager.onEvent.
    func relayEvent(canvasID: String, payload: Any) {
        let event: [String: Any] = ["type": "event", "id": canvasID, "payload": payload]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        var data = jsonData
        data.append(contentsOf: "\n".utf8)

        subscriberLock.lock()
        let fds = Array(subscribers.values)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        // Write on background queue to avoid blocking main thread
        let bytes = [UInt8](data)
        eventWriteQueue.async {
            for fd in fds {
                bytes.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    /// Relay a channel post to all subscriber connections.
    /// Format: {"type":"channel","channel":"...","data":{...}}
    func relayChannelPost(channel: String, dataStr: String?) {
        var envelope: [String: Any] = ["type": "channel", "channel": channel]
        if let ds = dataStr,
           let raw = ds.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: raw) {
            envelope["data"] = parsed
        }
        guard let jsonData = try? JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys]) else { return }
        var data = jsonData
        data.append(contentsOf: "\n".utf8)

        subscriberLock.lock()
        let fds = Array(subscribers.values)
        subscriberLock.unlock()

        guard !fds.isEmpty else { return }

        let bytes = [UInt8](data)
        eventWriteQueue.async {
            for fd in fds {
                bytes.withUnsafeBufferPointer { ptr in
                    _ = write(fd, ptr.baseAddress!, ptr.count)
                }
            }
        }
    }

    private func startIdleTimer() {
        guard idleTimeout.isFinite else { return }
        cancelIdleTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + idleTimeout)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.canvasManager.isEmpty else { return }
            self.shutdown()
        }
        timer.resume()
        idleTimer = timer
    }

    private func cancelIdleTimer() {
        idleTimer?.cancel()
        idleTimer = nil
    }

    func shutdown() {
        cancelIdleTimer()
        close(serverFD)
        try? FileManager.default.removeItem(atPath: socketPath)
        exit(0)
    }

    private func setupSignalHandlers() {
        let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        sigterm.setEventHandler { [weak self] in self?.shutdown() }
        sigterm.resume()
        signal(SIGTERM, SIG_IGN)

        let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        sigint.setEventHandler { [weak self] in self?.shutdown() }
        sigint.resume()
        signal(SIGINT, SIG_IGN)

        _sigSources = [sigterm, sigint]
    }
    private var _sigSources: [Any] = []
}

// MARK: - Serve Command

func serveCommand(args: [String]) {
    var idleTimeout: TimeInterval = 5.0
    var configPath: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--idle-timeout":
            i += 1
            guard i < args.count else { exitError("--idle-timeout requires a duration", code: "MISSING_ARG") }
            idleTimeout = parseDuration(args[i])
        case "--config":
            i += 1
            guard i < args.count else { exitError("--config requires a file path", code: "MISSING_ARG") }
            configPath = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    // Load config: explicit --config flag, or auto-load from well-known path
    var config = DaemonConfig()
    let defaultConfigPath = kSocketDir + "/config.json"
    let resolvedConfigPath = configPath ?? (FileManager.default.fileExists(atPath: defaultConfigPath) ? defaultConfigPath : nil)
    if let path = resolvedConfigPath,
       let data = FileManager.default.contents(atPath: path) {
        if let loaded = try? JSONDecoder().decode(DaemonConfig.self, from: data) {
            config = loaded
        } else {
            FileHandle.standardError.write("Warning: could not parse config at \(path)\n".data(using: .utf8)!)
        }
    }

    // Check for existing daemon
    let testSock = socket(AF_UNIX, SOCK_STREAM, 0)
    if testSock >= 0 {
        let result = withSockAddr(kSocketPath) { addr, len in
            connect(testSock, addr, len)
        }
        close(testSock)
        if result == 0 {
            exitError("Daemon already running at \(kSocketPath)", code: "ALREADY_RUNNING")
        }
    }

    let canvasManager = CanvasManager()
    let server = DaemonServer(socketPath: kSocketPath, canvasManager: canvasManager, idleTimeout: idleTimeout)

    // Status item (menu bar icon) — configured via config file
    var statusItemManager: StatusItemManager?
    if config.statusItem?.enabled == true {
        let mgr = StatusItemManager(canvasManager: canvasManager, config: config.statusItem!)
        mgr.setup()
        statusItemManager = mgr
        server.hasStatusItem = true
    }

    canvasManager.onCanvasCountChanged = { [weak server, weak statusItemManager] in
        server?.checkIdle()
        statusItemManager?.updateIcon()
    }

    canvasManager.onEvent = { [weak server] canvasID, payload in
        server?.relayEvent(canvasID: canvasID, payload: payload)
    }

    canvasManager.onCanvasLifecycle = { [weak server] canvasID, action, at in
        var payload: [String: Any] = ["type": "canvas_lifecycle", "id": canvasID, "action": action]
        if let at = at {
            payload["at"] = at.map { Double($0) }
        }
        server?.relayEvent(canvasID: "__lifecycle__", payload: payload)
    }

    server.start()

    // .accessory allows the daemon to become key window target (receive keyboard
    // events for interactive canvases) without appearing in the Dock or app switcher.
    NSApp.setActivationPolicy(.accessory)

    NSApplication.shared.run()
}
