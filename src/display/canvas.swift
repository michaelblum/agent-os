// display — Canvas: transparent NSWindow + WKWebView
// Each canvas is an (id, bounds, content) tuple rendered on screen.
// Includes WKScriptMessageHandler relay for canvas→host events.

import AppKit
import WebKit

// MARK: - AOS URL Scheme Handler

/// Intercepts `aos://` URL loads in WKWebView and proxies them to the content server.
/// Safety net: prevents the custom scheme from leaking to macOS's system URL handler
/// if resolveContentURL() fails to rewrite the URL before it reaches WKWebView.
class AosSchemeHandler: NSObject, WKURLSchemeHandler {
    var portProvider: () -> UInt16 = { 0 }
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)

        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let port = portProvider()
        guard port > 0 else {
            fputs("[aos-scheme] content server unavailable for \(url.absoluteString)\n", stderr)
            let html = "<html><body style=\"font-family:system-ui;color:#fff;background:#1a1a2e;padding:2em\"><h2>aos:// content server unavailable</h2><pre>aos content status --json</pre><p>\(url.absoluteString)</p></body></html>"
            let data = html.data(using: .utf8)!
            let response = URLResponse(url: url, mimeType: "text/html",
                                       expectedContentLength: data.count, textEncodingName: "utf-8")
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
            return
        }

        let host = url.host ?? ""
        let path = url.path
        let query = url.query.map { "?\($0)" } ?? ""
        let resolvedString = "http://127.0.0.1:\(port)/\(host)\(path)\(query)"
        guard let resolvedURL = URL(string: resolvedString) else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        fputs("[aos-scheme] \(url.absoluteString) → \(resolvedString)\n", stderr)

        URLSession.shared.dataTask(with: resolvedURL) { [weak self] data, response, error in
            guard let self = self else { return }
            self.lock.lock()
            let wasStopped = self.stopped.remove(taskID) != nil
            self.lock.unlock()
            if wasStopped { return }

            if let error = error {
                urlSchemeTask.didFailWithError(error)
                return
            }
            if let response = response { urlSchemeTask.didReceive(response) }
            if let data = data { urlSchemeTask.didReceive(data) }
            urlSchemeTask.didFinish()
        }.resume()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        lock.lock()
        stopped.insert(taskID)
        lock.unlock()
    }
}

// MARK: - Script Message Handler

/// Receives postMessage calls from canvas JS: window.webkit.messageHandlers.headsup.postMessage({...})
class CanvasMessageHandler: NSObject, WKScriptMessageHandler {
    var onMessage: ((Any) -> Void)?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        onMessage?(message.body)
    }
}

// MARK: - Coordinate Conversion

/// Convert CG coordinates (top-left origin, Y-down) to NSScreen coordinates (bottom-left origin, Y-up).
func cgToScreen(_ cgRect: CGRect) -> NSRect {
    guard let screen = NSScreen.screens.first else {
        return NSRect(x: cgRect.origin.x, y: cgRect.origin.y,
                      width: cgRect.size.width, height: cgRect.size.height)
    }
    let screenHeight = screen.frame.height
    return NSRect(
        x: cgRect.origin.x,
        y: screenHeight - cgRect.origin.y - cgRect.size.height,
        width: cgRect.size.width,
        height: cgRect.size.height
    )
}

/// Convert NSScreen coordinates back to CG coordinates.
func screenToCG(_ nsRect: NSRect) -> CGRect {
    guard let screen = NSScreen.screens.first else {
        return CGRect(x: nsRect.origin.x, y: nsRect.origin.y,
                      width: nsRect.size.width, height: nsRect.size.height)
    }
    let screenHeight = screen.frame.height
    return CGRect(
        x: nsRect.origin.x,
        y: screenHeight - nsRect.origin.y - nsRect.size.height,
        width: nsRect.size.width,
        height: nsRect.size.height
    )
}

// MARK: - CanvasWindow (unconstrained NSWindow)

/// NSWindow subclass that disables frame constraining and enables keyboard input for interactive canvases.
/// By default macOS may reposition or resize windows to fit within a single display.
/// Canvases need to span multiple displays, so we return the proposed frame unchanged.
/// Borderless windows return false for canBecomeKey by default, which prevents text input.
/// Interactive canvases override this to accept keyboard focus.
class CanvasWindow: NSWindow {
    var isInteractiveCanvas: Bool = false

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        return frameRect
    }

    override var canBecomeKey: Bool {
        return isInteractiveCanvas
    }

    override var canBecomeMain: Bool {
        return false  // Never steal main window status from the user's app
    }

    /// Intercept all events so we can grab keyboard focus before the WKWebView
    /// processes the click. Without this, clicks on text inputs show a cursor
    /// but keystrokes go to whatever app macOS considers "active".
    override func sendEvent(_ event: NSEvent) {
        if isInteractiveCanvas && event.type == .leftMouseDown && !isKeyWindow {
            // Activate the aos daemon process so macOS routes keystrokes here
            NSApp.activate(ignoringOtherApps: true)
            makeKey()
        }
        super.sendEvent(event)
    }

}

// MARK: - CanvasWebView (accept-first-mouse WKWebView)

/// WKWebView subclass that delivers the first mousedown immediately — no
/// "click to focus, click again to interact" dance.  Also keeps cursor
/// tracking active when the window is in the background so CSS `cursor:`
/// rules (e.g. `cursor: grab` on a drag handle) render without prior focus.
class CanvasWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }
}

// MARK: - Track Target

/// A canvas's tracking target. When set, the daemon resolves bounds from the
/// target on create and re-resolves on relevant change events. v1 supports
/// only `.union` (bounds = union of all displays). Future target types
/// (window:<wid>, channel:<cid>, display:<n>, static:<rect>) land via #60.
enum TrackTarget: String {
    case union
}

// MARK: - Canvas

class Canvas {
    let id: String
    let window: NSWindow
    let webView: WKWebView
    var anchorWindowID: CGWindowID?
    var anchorChannelID: String?
    var offset: CGRect?
    var isInteractive: Bool
    /// When true, the canvas should grab focus (app activation + key window)
    /// and — if set via handleCreate — the next 'ready' event from the page
    /// will trigger a focusInput() eval. Cleared after the ready handler fires
    /// so the focus request is one-shot per set.
    var focusOnReady: Bool = false
    var ttlTimer: DispatchSourceTimer?
    var ttlDeadline: Date?
    var onTTLExpired: (() -> Void)?
    var scope: String = "global"        // "global" or "connection"
    var connectionID: UUID?             // which connection owns this canvas (if connection-scoped)
    let messageHandler = CanvasMessageHandler()
    var onMessage: ((Any) -> Void)? {
        get { messageHandler.onMessage }
        set { messageHandler.onMessage = newValue }
    }
    var autoProjectMode: String?
    var trackTarget: TrackTarget?

    func setTTL(_ seconds: Double?) {
        ttlTimer?.cancel()
        ttlTimer = nil
        ttlDeadline = nil
        guard let seconds = seconds else { return }
        ttlDeadline = Date().addingTimeInterval(seconds)
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + seconds)
        timer.setEventHandler { [weak self] in
            self?.onTTLExpired?()
        }
        timer.resume()
        ttlTimer = timer
    }

    var remainingTTL: Double? {
        guard let deadline = ttlDeadline else { return nil }
        return max(0, deadline.timeIntervalSinceNow)
    }

    init(id: String, cgFrame: CGRect, interactive: Bool, aosSchemeHandler: WKURLSchemeHandler? = nil) {
        self.id = id
        self.isInteractive = interactive

        let screenFrame = cgToScreen(cgFrame)

        let window = CanvasWindow(
            contentRect: screenFrame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        // Interactive canvases (studio, menus) use .floating so other apps
        // can be brought in front. Non-interactive canvases (avatar overlay)
        // use .statusBar to stay above everything while passing clicks through.
        window.level = interactive ? .floating : .statusBar
        window.ignoresMouseEvents = !interactive
        window.isInteractiveCanvas = interactive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        if let handler = aosSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos")
        }
        let controller = WKUserContentController()
        controller.add(messageHandler, name: "headsup")
        config.userContentController = controller
        // Interactive canvases use CanvasWebView so the first mousedown
        // starts a drag immediately (no "click to focus" delay) and CSS
        // cursors render without prior focus.
        let webView: WKWebView = interactive
            ? CanvasWebView(frame: NSRect(origin: .zero, size: screenFrame.size), configuration: config)
            : WKWebView(frame: NSRect(origin: .zero, size: screenFrame.size), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        webView.layer?.isOpaque = false
        webView.autoresizingMask = [.width, .height]

        window.contentView = webView

        self.window = window
        self.webView = webView
    }

    func loadHTML(_ html: String) {
        webView.loadHTMLString(html, baseURL: nil)
    }

    func loadURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        webView.load(URLRequest(url: url))
    }

    func show() {
        if isInteractive {
            window.makeKeyAndOrderFront(nil)
        } else {
            window.orderFront(nil)
        }
    }

    /// Activate the aos process and make this window key so keystrokes route
    /// here immediately, without the user needing to click into the canvas.
    /// macOS debounces click-based activation for .accessory apps, so callers
    /// that need instant keyboard focus must invoke this explicitly.
    func grabFocus() {
        guard isInteractive else { return }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "headsup")
        ttlTimer?.cancel()
        ttlTimer = nil
        window.orderOut(nil)
        window.close()
    }

    private var pendingCGFrame: CGRect?

    func updatePosition(cgRect: CGRect) {
        let screenFrame = cgToScreen(cgRect)
        window.setFrame(screenFrame, display: true)
        // macOS window server may reject cross-display moves on the first frame.
        // Store the intended position and retry on the next run loop cycle.
        let actual = screenToCG(window.frame)
        if abs(actual.origin.x - cgRect.origin.x) > 2 || abs(actual.origin.y - cgRect.origin.y) > 2 {
            pendingCGFrame = cgRect
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                guard let self = self, let pending = self.pendingCGFrame else { return }
                self.pendingCGFrame = nil
                let retry = cgToScreen(pending)
                self.window.setFrame(retry, display: true)
                // Double-tap: some display transitions need two attempts
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                    self?.window.setFrame(retry, display: true)
                }
            }
        }
    }

    var cgFrame: CGRect {
        return screenToCG(window.frame)
    }

    func toInfo() -> CanvasInfo {
        let f = cgFrame
        return CanvasInfo(
            id: id,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            anchorWindow: anchorWindowID.map { Int($0) },
            anchorChannel: anchorChannelID,
            offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
            interactive: isInteractive,
            ttl: remainingTTL,
            scope: scope,
            autoProject: autoProjectMode,
            track: trackTarget?.rawValue
        )
    }
}

// MARK: - Canvas Manager

class CanvasManager {
    private var canvases: [String: Canvas] = [:]
    private var anchorTimer: DispatchSourceTimer?
    var aosSchemeHandler: WKURLSchemeHandler?
    var onCanvasCountChanged: (() -> Void)?
    var onEvent: ((String, Any) -> Void)?   // (canvasID, payload) — relayed to subscribers
    /// (canvasID, action, at?) — relayed to subscribers as canvas_lifecycle events
    var onCanvasLifecycle: ((String, String, [CGFloat]?) -> Void)?
    let startTime = Date()
    private var lastChannelReRead: Date = .distantPast
    private var lastAutoProjectUpdate: Date = .distantPast
    private var lastCursorTrailUpdate: Date = .distantPast

    var isEmpty: Bool { canvases.isEmpty }
    func hasCanvas(_ id: String) -> Bool { canvases[id] != nil }

    func setCanvasAlpha(_ id: String, _ alpha: CGFloat) {
        guard let canvas = canvases[id] else { return }
        canvas.window.alphaValue = alpha
    }

    var hasAnchoredCanvases: Bool { canvases.values.contains { $0.anchorWindowID != nil } }
    var hasAutoProjectCanvases: Bool { canvases.values.contains { $0.autoProjectMode != nil } }
    var hasTrackedCanvases: Bool { canvases.values.contains { $0.trackTarget != nil } }

    /// Re-resolve bounds for every canvas with a tracking target and apply
    /// the new bounds. Called from the daemon's coalesced display_geometry
    /// handler on topology change. Failures on individual canvases are logged
    /// but never block the rest of the iteration — a broken canvas must not
    /// stall the topology-change broadcast.
    func retargetTrackedCanvases() {
        let unionBounds = allDisplaysBounds()
        guard unionBounds.width > 0, unionBounds.height > 0 else {
            fputs("[canvas] retargetTrackedCanvases: no displays, skipping\n", stderr)
            return
        }

        for canvas in canvases.values {
            guard let target = canvas.trackTarget else { continue }
            switch target {
            case .union:
                canvas.updatePosition(cgRect: unionBounds)
                let atArr: [CGFloat] = [unionBounds.origin.x, unionBounds.origin.y, unionBounds.size.width, unionBounds.size.height]
                onCanvasLifecycle?(canvas.id, "updated", atArr)
            }
        }
    }

    func removeByTTL(_ id: String) {
        guard let canvas = canvases.removeValue(forKey: id) else { return }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasLifecycle?(id, "removed", nil)
        onCanvasCountChanged?()
    }

    /// Remove all connection-scoped canvases owned by the given connection.
    func cleanupConnection(_ connectionID: UUID) {
        let toRemove = canvases.values
            .filter { $0.connectionID == connectionID && $0.scope == "connection" }
            .map { $0.id }
        for id in toRemove {
            if let canvas = canvases.removeValue(forKey: id) {
                canvas.close()
                onCanvasLifecycle?(id, "removed", nil)
            }
        }
        if !toRemove.isEmpty {
            if !hasAnchoredCanvases { stopAnchorPolling() }
            onCanvasCountChanged?()
        }
    }

    func handle(_ request: CanvasRequest, connectionID: UUID = UUID()) -> CanvasResponse {
        switch request.action {
        case "create":  return handleCreate(request, connectionID: connectionID)
        case "update":  return handleUpdate(request)
        case "remove":  return handleRemove(request)
        case "remove-all": return handleRemoveAll()
        case "list":    return handleList()
        case "ping":    return handlePing()
        case "eval":    return handleEval(request)
        case "to-front": return handleToFront(request)
        default:
            return .fail("Unknown action: \(request.action)", code: "UNKNOWN_ACTION")
        }
    }

    private func handleCreate(_ req: CanvasRequest, connectionID: UUID) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("create requires --id", code: "MISSING_ID")
        }
        if canvases[id] != nil {
            return .fail("Canvas '\(id)' already exists. Use update or remove first.", code: "DUPLICATE_ID")
        }

        let trackTarget: TrackTarget?
        if let trackStr = req.track {
            guard let t = TrackTarget(rawValue: trackStr) else {
                return .fail("Unknown track target: \(trackStr)", code: "INVALID_TRACK")
            }
            trackTarget = t
        } else {
            trackTarget = nil
        }

        // Resolve anchorChannel → anchorWindow + window_bounds
        var resolvedAnchorWindow = req.anchorWindow
        var channelWindowBounds: CGRect? = nil
        let channelID: String? = req.anchorChannel
        var channelData: ChannelData? = nil

        if let chanID = req.anchorChannel {
            guard let channel = readChannelFile(id: chanID) else {
                if !channelFileExists(id: chanID) {
                    return .fail("Channel '\(chanID)' not found", code: "CHANNEL_NOT_FOUND")
                }
                return .fail("Channel '\(chanID)' could not be parsed", code: "CHANNEL_NOT_FOUND")
            }
            if isChannelStale(channel) {
                return .fail("Channel '\(chanID)' is stale (>10s since last update)", code: "CHANNEL_STALE")
            }
            channelData = channel
            resolvedAnchorWindow = channel.target.window_id
            let wb = channel.window_bounds
            channelWindowBounds = CGRect(x: wb.x, y: wb.y, width: wb.w, height: wb.h)
        }

        // Resolve auto-projection mode
        let autoMode = req.autoProject
        if let mode = autoMode {
            let validModes = ["cursor_trail", "highlight_focused", "label_elements"]
            guard validModes.contains(mode) else {
                return .fail("Unknown auto-project mode: \(mode). Valid: \(validModes.joined(separator: ", "))", code: "INVALID_AUTO_PROJECT")
            }
            if mode != "cursor_trail" && channelID == nil {
                return .fail("auto-project '\(mode)' requires --anchor-channel", code: "MISSING_CHANNEL")
            }
        }

        let cgFrame: CGRect
        if trackTarget == .union {
            // Resolve union bounds from the current display topology.
            // Uses allDisplaysBounds() which calls CGDisplayBounds directly,
            // matching `aos runtime display-union` and `snapshotDisplayGeometry`.
            let bounds = allDisplaysBounds()
            guard bounds.width > 0, bounds.height > 0 else {
                return .fail("--track union requires at least one connected display", code: "NO_DISPLAYS")
            }
            cgFrame = bounds
        } else if autoMode == "cursor_trail" {
            // cursor_trail spans all displays
            cgFrame = allDisplaysBounds()
        } else if let at = req.at, at.count == 4 {
            cgFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
        } else if let anchorWin = resolvedAnchorWindow, let off = req.offset, off.count == 4 {
            let winBounds: CGRect
            if let chanBounds = channelWindowBounds {
                winBounds = chanBounds
            } else {
                guard let wb = getWindowBounds(CGWindowID(anchorWin)) else {
                    return .fail("Window \(anchorWin) not found", code: "WINDOW_NOT_FOUND")
                }
                winBounds = wb
            }
            cgFrame = CGRect(
                x: winBounds.origin.x + off[0],
                y: winBounds.origin.y + off[1],
                width: off[2], height: off[3]
            )
        } else if resolvedAnchorWindow != nil, channelWindowBounds != nil {
            // Channel-anchored without explicit offset: cover the whole window
            cgFrame = channelWindowBounds!
        } else if autoMode != nil && channelWindowBounds != nil {
            // Auto-project with channel: cover the whole window
            cgFrame = channelWindowBounds!
        } else {
            return .fail("create requires --at x,y,w,h, --anchor-window + --offset, --anchor-channel, or --track <target>", code: "MISSING_POSITION")
        }

        let interactive = req.interactive ?? false
        let canvas = Canvas(id: id, cgFrame: cgFrame, interactive: interactive, aosSchemeHandler: aosSchemeHandler)
        canvas.trackTarget = trackTarget
        // --focus on create: activate immediately and arm a one-shot
        // focusInput() eval for when the page emits 'ready'. The OS-level
        // activation avoids the click-to-focus delay macOS applies to
        // .accessory apps; the JS call lands keystrokes in the right field.
        if req.focus == true && interactive {
            canvas.focusOnReady = true
        }

        // Connection-scoped lifecycle
        let scope = req.scope ?? "global"
        canvas.scope = scope
        if scope == "connection" {
            canvas.connectionID = connectionID
        }

        // Message handler relay: canvas JS → orchestrator
        // Drag handling: absolute positioning via NSEvent.mouseLocation for
        // reliable cross-display dragging. JS sends screenX/screenY + the
        // mouse offset within the canvas at drag start. We convert the
        // absolute mouse position to CG coords and subtract the offset.
        canvas.onMessage = { [weak self] body in
            // Handle close before the type guard — close uses {action: "close"}
            if let dict = body as? [String: Any],
               (dict["action"] as? String) == "close" || (dict["type"] as? String) == "close" {
                DispatchQueue.main.async { [weak self] in
                    _ = self?.handleRemove(CanvasRequest(action: "remove", id: id))
                }
                return
            }

            if let dict = body as? [String: Any],
               let type = dict["type"] as? String {

                if type == "move_abs",
                   let _ = dict["screenX"] as? Double,
                   let _ = dict["screenY"] as? Double,
                   let offsetX = dict["offsetX"] as? Double,
                   let offsetY = dict["offsetY"] as? Double {
                    DispatchQueue.main.async {
                        let mouse = NSEvent.mouseLocation
                        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
                        let cgMouseX = mouse.x
                        let cgMouseY = primaryHeight - mouse.y
                        let newX = cgMouseX - CGFloat(offsetX)
                        let newY = cgMouseY - CGFloat(offsetY)
                        let cg = canvas.cgFrame

                        // No display-snap: let the canvas straddle displays freely,
                        // same as the avatar animation path. updatePosition's retry
                        // logic handles any single-frame OS rejection at boundaries.
                        canvas.updatePosition(cgRect: CGRect(x: newX, y: newY, width: cg.width, height: cg.height))
                    }
                    return
                }

                // Legacy relative move (for backward compat)
                if type == "move",
                   let dx = dict["dx"] as? Double,
                   let dy = dict["dy"] as? Double {
                    DispatchQueue.main.async {
                        var cg = canvas.cgFrame
                        cg.origin.x += CGFloat(dx)
                        cg.origin.y += CGFloat(dy)
                        canvas.updatePosition(cgRect: cg)
                    }
                    return
                }

                // drag_start and drag_end — don't relay, just consume
                if type == "drag_start" || type == "drag_end" {
                    return
                }

                // Page signaled it's loaded. If the canvas was created with
                // --focus, tell the page to focus its input field. One-shot:
                // clear the flag so we don't re-focus on subsequent ready
                // emits (the page can re-emit after navigation).
                if type == "ready" && canvas.focusOnReady {
                    canvas.focusOnReady = false
                    DispatchQueue.main.async {
                        canvas.webView.evaluateJavaScript(
                            "typeof focusInput === 'function' && focusInput()",
                            completionHandler: nil
                        )
                    }
                    // fall through to relay
                }

                // Config IPC: read/write daemon config from canvas JS
                if type == "get_config" {
                    DispatchQueue.main.async {
                        let config = loadConfig()
                        let encoder = JSONEncoder()
                        encoder.outputFormatting = [.sortedKeys]
                        if let data = try? encoder.encode(config),
                           let jsonStr = String(data: data, encoding: .utf8) {
                            canvas.webView.evaluateJavaScript("window.__aosConfigLoaded?.(\(jsonStr))", completionHandler: nil)
                        }
                    }
                    return
                }

                if type == "set_config",
                   let key = dict["key"] as? String,
                   let value = dict["value"] as? String {
                    DispatchQueue.main.async {
                        var config = loadConfig()
                        switch key {
                        case "voice.enabled":
                            config.voice.enabled = (value == "true" || value == "1")
                        case "voice.announce_actions":
                            config.voice.announce_actions = (value == "true" || value == "1")
                        case "feedback.visual":
                            config.feedback.visual = (value == "true" || value == "1")
                        case "feedback.sound":
                            config.feedback.sound = (value == "true" || value == "1")
                        default:
                            canvas.webView.evaluateJavaScript(
                                "window.__aosConfigError?.('Unknown config key: \(key)')", completionHandler: nil)
                            return
                        }
                        saveConfig(config)
                        let encoder = JSONEncoder()
                        encoder.outputFormatting = [.sortedKeys]
                        if let data = try? encoder.encode(config),
                           let jsonStr = String(data: data, encoding: .utf8) {
                            canvas.webView.evaluateJavaScript("window.__aosConfigLoaded?.(\(jsonStr))", completionHandler: nil)
                        }
                    }
                    return
                }

                // Skin-requested resize: expand/shrink canvas from center.
                // The skin declares how much space it needs (e.g. for aura spread).
                // { type: "request_resize", width: 450, height: 450 }
                if type == "request_resize",
                   let w = dict["width"] as? Double,
                   let h = dict["height"] as? Double {
                    DispatchQueue.main.async {
                        let cg = canvas.cgFrame
                        let cx = cg.origin.x + cg.size.width / 2
                        let cy = cg.origin.y + cg.size.height / 2
                        let newFrame = CGRect(
                            x: cx - CGFloat(w) / 2,
                            y: cy - CGFloat(h) / 2,
                            width: CGFloat(w),
                            height: CGFloat(h)
                        )
                        canvas.updatePosition(cgRect: newFrame)
                    }
                    return
                }
            }
            self?.onEvent?(id, body)
        }

        if let anchorWin = resolvedAnchorWindow {
            canvas.anchorWindowID = CGWindowID(anchorWin)
            if let off = req.offset, off.count == 4 {
                canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
            } else if channelWindowBounds != nil && autoMode != "cursor_trail" {
                // Channel-anchored without explicit offset: offset covers the whole window (0,0,w,h)
                canvas.offset = CGRect(x: 0, y: 0, width: channelWindowBounds!.width, height: channelWindowBounds!.height)
            }
        }

        canvas.anchorChannelID = channelID
        canvas.autoProjectMode = autoMode

        // Resolve content: auto-projection generates HTML, otherwise use user-supplied
        if let mode = autoMode, let cd = channelData {
            canvas.loadHTML(generateAutoProjectHTML(mode: mode, channelData: cd))
        } else if let mode = autoMode, mode == "cursor_trail" {
            canvas.loadHTML(generateAutoProjectHTML(mode: mode, channelData: nil))
        } else if let html = req.html {
            canvas.loadHTML(html)
        } else if let url = req.url {
            canvas.loadURL(url)
        } else {
            canvas.close()
            return .fail("create requires --html, --file, --url, --auto-project, or stdin content", code: "NO_CONTENT")
        }

        canvas.show()
        if req.focus == true && interactive {
            canvas.grabFocus()
        }
        canvases[id] = canvas

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl)
        }

        if hasAnchoredCanvases || autoMode != nil { startAnchorPolling() }

        onCanvasCountChanged?()
        let at: [CGFloat] = [cgFrame.origin.x, cgFrame.origin.y, cgFrame.size.width, cgFrame.size.height]
        onCanvasLifecycle?(id, "created", at)

        return .ok()
    }

    private func handleUpdate(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("update requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }

        if let at = req.at, at.count == 4 {
            let newFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
            canvas.updatePosition(cgRect: newFrame)
            canvas.anchorWindowID = nil
            canvas.anchorChannelID = nil
            canvas.offset = nil
            let atArr: [CGFloat] = [at[0], at[1], at[2], at[3]]
            onCanvasLifecycle?(id, "updated", atArr)
        }

        if let trackStr = req.track {
            guard let t = TrackTarget(rawValue: trackStr) else {
                return .fail("Unknown track target: \(trackStr)", code: "INVALID_TRACK")
            }
            canvas.trackTarget = t

            // Resolve new bounds from the target immediately so the retarget
            // is visible without waiting for the next topology-change event.
            if t == .union {
                let bounds = allDisplaysBounds()
                if bounds.width > 0 && bounds.height > 0 {
                    canvas.updatePosition(cgRect: bounds)
                    let atArr: [CGFloat] = [bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height]
                    onCanvasLifecycle?(id, "updated", atArr)
                }
            }

            // Clear conflicting anchor state — track supersedes anchors.
            canvas.anchorWindowID = nil
            canvas.anchorChannelID = nil
            canvas.offset = nil
        }

        // anchorChannel on update: re-read channel, update anchor
        if let chanID = req.anchorChannel {
            guard let channel = readChannelFile(id: chanID) else {
                if !channelFileExists(id: chanID) {
                    return .fail("Channel '\(chanID)' not found", code: "CHANNEL_NOT_FOUND")
                }
                return .fail("Channel '\(chanID)' could not be parsed", code: "CHANNEL_NOT_FOUND")
            }
            if isChannelStale(channel) {
                return .fail("Channel '\(chanID)' is stale (>10s since last update)", code: "CHANNEL_STALE")
            }
            canvas.anchorChannelID = chanID
            canvas.anchorWindowID = CGWindowID(channel.target.window_id)
            let wb = channel.window_bounds
            let winBounds = CGRect(x: wb.x, y: wb.y, width: wb.w, height: wb.h)

            if let off = req.offset, off.count == 4 {
                canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
                let newFrame = CGRect(
                    x: winBounds.origin.x + off[0],
                    y: winBounds.origin.y + off[1],
                    width: off[2], height: off[3]
                )
                canvas.updatePosition(cgRect: newFrame)
                let atArr: [CGFloat] = [newFrame.origin.x, newFrame.origin.y, newFrame.size.width, newFrame.size.height]
                onCanvasLifecycle?(id, "updated", atArr)
            } else {
                canvas.offset = CGRect(x: 0, y: 0, width: winBounds.width, height: winBounds.height)
                canvas.updatePosition(cgRect: winBounds)
                let atArr: [CGFloat] = [winBounds.origin.x, winBounds.origin.y, winBounds.size.width, winBounds.size.height]
                onCanvasLifecycle?(id, "updated", atArr)
            }
            startAnchorPolling()
        } else if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            canvas.anchorWindowID = CGWindowID(anchorWin)
            canvas.anchorChannelID = nil
            canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
            if let windowBounds = getWindowBounds(CGWindowID(anchorWin)) {
                let newFrame = CGRect(
                    x: windowBounds.origin.x + off[0],
                    y: windowBounds.origin.y + off[1],
                    width: off[2], height: off[3]
                )
                canvas.updatePosition(cgRect: newFrame)
                let atArr: [CGFloat] = [newFrame.origin.x, newFrame.origin.y, newFrame.size.width, newFrame.size.height]
                onCanvasLifecycle?(id, "updated", atArr)
            }
            startAnchorPolling()
        }

        if let html = req.html {
            canvas.loadHTML(html)
        } else if let url = req.url {
            canvas.loadURL(url)
        }

        if let interactive = req.interactive {
            canvas.isInteractive = interactive
            canvas.window.ignoresMouseEvents = !interactive
            // The CanvasWindow reads isInteractiveCanvas to decide canBecomeKey
            // and whether sendEvent should activate on first click. Without
            // updating it, flipped-to-interactive canvases can receive mouse
            // events but never become key window, so keyboard input bounces
            // back to the previously-active app (system bonk on every keystroke).
            (canvas.window as? CanvasWindow)?.isInteractiveCanvas = interactive
            canvas.window.level = interactive ? .floating : .statusBar
            // NOTE: the WKWebView subclass (CanvasWebView vs plain WKWebView)
            // is chosen at construction time and cannot be swapped at runtime.
            // The only behavioral difference is acceptsFirstMouse, which only
            // affects the first-click-starts-drag ergonomic. A flipped canvas
            // may require one extra click to activate; recreate the canvas with
            // --interactive at creation time for full first-mouse behavior.
        }

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl > 0 ? ttl : nil)  // ttl=0 clears the TTL
        }

        // --focus on update: the canvas is already loaded, so we can both
        // activate at the OS level and eval focusInput() right away.
        if req.focus == true && canvas.isInteractive {
            canvas.grabFocus()
            DispatchQueue.main.async {
                canvas.webView.evaluateJavaScript(
                    "typeof focusInput === 'function' && focusInput()",
                    completionHandler: nil
                )
            }
        }

        return .ok()
    }

    private func handleRemove(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("remove requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases.removeValue(forKey: id) else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasCountChanged?()
        onCanvasLifecycle?(id, "removed", nil)
        return .ok()
    }

    private func handleRemoveAll() -> CanvasResponse {
        let removedIds = Array(canvases.keys)
        for (_, canvas) in canvases {
            canvas.close()
        }
        canvases.removeAll()
        stopAnchorPolling()
        for id in removedIds {
            onCanvasLifecycle?(id, "removed", nil)
        }
        onCanvasCountChanged?()
        return .ok()
    }

    private func handleList() -> CanvasResponse {
        let infos = canvases.values.map { $0.toInfo() }.sorted { $0.id < $1.id }
        return CanvasResponse(status: "success", canvases: infos)
    }

    private func handlePing() -> CanvasResponse {
        var resp = CanvasResponse.ok()
        resp.uptime = Date().timeIntervalSince(startTime)
        return resp
    }

    private func handleEval(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("eval requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        guard let js = req.js else {
            return .fail("eval requires --js", code: "MISSING_JS")
        }

        var evalResult: String? = nil
        var evalDone = false

        canvas.webView.evaluateJavaScript(js) { result, error in
            if let error = error {
                evalResult = "error: \(error.localizedDescription)"
            } else if let result = result {
                if JSONSerialization.isValidJSONObject(result),
                   let data = try? JSONSerialization.data(withJSONObject: result),
                   let str = String(data: data, encoding: .utf8) {
                    evalResult = str
                } else {
                    evalResult = "\(result)"
                }
            }
            evalDone = true
        }

        let deadline = Date().addingTimeInterval(5.0)
        while !evalDone && Date() < deadline {
            CFRunLoopRunInMode(.defaultMode, 0.01, true)
        }

        if !evalDone {
            return .fail("eval timed out after 5 seconds", code: "EVAL_TIMEOUT")
        }

        var response = CanvasResponse.ok()
        response.result = evalResult
        return response
    }

    /// Fire-and-forget JavaScript evaluation on a canvas. Non-blocking.
    /// Used by the broadcast paths that fan out input events to subscribed canvases at
    /// high frequency. Unlike `handleEval`, this does not wait for a result or return
    /// a value — callers should not rely on ordering or completion.
    func evalAsync(canvasID: String, js: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self,
                  let canvas = self.canvases[canvasID] else { return }
            canvas.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func handleToFront(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("to-front requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        canvas.window.orderFront(nil)
        return .ok()
    }

    // MARK: - Window Anchoring

    func startAnchorPolling() {
        guard anchorTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: 1.0 / 30.0)
        timer.setEventHandler { [weak self] in
            self?.updateAnchoredCanvases()
        }
        timer.resume()
        anchorTimer = timer
    }

    func stopAnchorPolling() {
        anchorTimer?.cancel()
        anchorTimer = nil
    }

    private func updateAnchoredCanvases() {
        let now = Date()
        var anyAnchored = false
        var anyAutoProject = false

        // Re-read channel files every 1s (not every frame)
        let shouldReReadChannels = now.timeIntervalSince(lastChannelReRead) >= 1.0
        if shouldReReadChannels { lastChannelReRead = now }

        // Update auto-projection content every 500ms
        let shouldUpdateAutoProject = now.timeIntervalSince(lastAutoProjectUpdate) >= 0.5
        if shouldUpdateAutoProject { lastAutoProjectUpdate = now }

        // Update cursor trail at 30fps (every frame)
        let shouldUpdateCursorTrail = now.timeIntervalSince(lastCursorTrailUpdate) >= (1.0 / 30.0)
        if shouldUpdateCursorTrail { lastCursorTrailUpdate = now }

        for (_, canvas) in canvases {
            // Handle cursor_trail auto-projection (30fps, no anchor needed)
            if canvas.autoProjectMode == "cursor_trail" {
                anyAutoProject = true
                if shouldUpdateCursorTrail {
                    let loc = NSEvent.mouseLocation
                    // Convert from NSScreen coords (Y-up) to CG coords (Y-down)
                    let screenHeight = NSScreen.screens.first?.frame.height ?? 0
                    let cgX = loc.x
                    let cgY = screenHeight - loc.y
                    let js = "if(typeof addPoint==='function')addPoint(\(cgX),\(cgY),\(now.timeIntervalSince1970*1000))"
                    canvas.webView.evaluateJavaScript(js, completionHandler: nil)
                }
                continue
            }

            // Channel re-read: check if window_id changed
            if shouldReReadChannels, let chanID = canvas.anchorChannelID {
                if let channel = readChannelFile(id: chanID) {
                    let newWindowID = CGWindowID(channel.target.window_id)
                    if newWindowID != canvas.anchorWindowID {
                        canvas.anchorWindowID = newWindowID
                        // Update offset to match new window dimensions
                        if canvas.offset != nil && canvas.autoProjectMode != nil {
                            let wb = channel.window_bounds
                            canvas.offset = CGRect(x: 0, y: 0, width: wb.w, height: wb.h)
                        }
                    }
                }
            }

            // Auto-projection content updates (highlight_focused, label_elements)
            if shouldUpdateAutoProject, let mode = canvas.autoProjectMode, let chanID = canvas.anchorChannelID {
                anyAutoProject = true
                if let channel = readChannelFile(id: chanID) {
                    let js = generateAutoProjectUpdate(mode: mode, channelData: channel)
                    if !js.isEmpty {
                        canvas.webView.evaluateJavaScript(js, completionHandler: nil)
                    }
                }
            }

            // Standard anchor position tracking
            guard let wid = canvas.anchorWindowID, let offset = canvas.offset else { continue }
            anyAnchored = true
            guard let windowBounds = getWindowBounds(wid) else { continue }
            let newFrame = CGRect(
                x: windowBounds.origin.x + offset.origin.x,
                y: windowBounds.origin.y + offset.origin.y,
                width: offset.size.width,
                height: offset.size.height
            )
            canvas.updatePosition(cgRect: newFrame)
        }
        if !anyAnchored && !anyAutoProject { stopAnchorPolling() }
    }
}

// MARK: - Display Bounds Helper

/// Compute the bounding rect of all connected displays in CG coordinates.
/// Uses CGDisplayBounds directly (top-left origin, Y-down) to avoid the
/// broken NSScreen→screenToCG conversion that assumes primary display height
/// for all screens (see #65).
func allDisplaysBounds() -> CGRect {
    let displays = getDisplays()
    guard !displays.isEmpty else {
        return CGRect(x: 0, y: 0, width: 1920, height: 1080) // fallback
    }
    var result = displays[0].bounds
    for d in displays.dropFirst() {
        result = result.union(d.bounds)
    }
    return result
}

// MARK: - CGWindowList Helper

func getWindowBounds(_ windowID: CGWindowID) -> CGRect? {
    guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowID) as? [[String: Any]],
          let info = list.first,
          let boundsDict = info[kCGWindowBounds as String] as? NSDictionary else {
        return nil
    }
    var rect = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(boundsDict as CFDictionary, &rect) else { return nil }
    return rect
}
