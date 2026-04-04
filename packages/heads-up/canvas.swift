// heads-up — Canvas: transparent NSWindow + WKWebView
// Each canvas is an (id, bounds, content) tuple rendered on screen.
// Includes WKScriptMessageHandler relay for canvas→host events.

import AppKit
import WebKit

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
            // Activate the heads-up process so macOS routes keystrokes here
            NSApp.activate(ignoringOtherApps: true)
            makeKey()
        }
        super.sendEvent(event)
    }

    // Note: acceptsFirstMouse is an NSView method, not NSWindow.
    // WKWebView handles first-mouse internally.
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

    init(id: String, cgFrame: CGRect, interactive: Bool) {
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
        window.level = .statusBar
        window.ignoresMouseEvents = !interactive
        window.isInteractiveCanvas = interactive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        controller.add(messageHandler, name: "headsup")
        config.userContentController = controller
        let webView = WKWebView(frame: NSRect(origin: .zero, size: screenFrame.size), configuration: config)
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
            autoProject: autoProjectMode
        )
    }
}

// MARK: - Canvas Manager

class CanvasManager {
    private var canvases: [String: Canvas] = [:]
    private var anchorTimer: DispatchSourceTimer?
    var onCanvasCountChanged: (() -> Void)?
    var onEvent: ((String, Any) -> Void)?   // (canvasID, payload) — relayed to subscribers
    let startTime = Date()
    private var lastChannelReRead: Date = .distantPast
    private var lastAutoProjectUpdate: Date = .distantPast
    private var lastCursorTrailUpdate: Date = .distantPast

    var isEmpty: Bool { canvases.isEmpty }
    var hasAnchoredCanvases: Bool { canvases.values.contains { $0.anchorWindowID != nil } }
    var hasAutoProjectCanvases: Bool { canvases.values.contains { $0.autoProjectMode != nil } }

    func removeByTTL(_ id: String) {
        guard let canvas = canvases.removeValue(forKey: id) else { return }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
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
        if autoMode == "cursor_trail" {
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
            return .fail("create requires --at x,y,w,h, --anchor-window + --offset, or --anchor-channel", code: "MISSING_POSITION")
        }

        let interactive = req.interactive ?? false
        let canvas = Canvas(id: id, cgFrame: cgFrame, interactive: interactive)

        // Connection-scoped lifecycle
        let scope = req.scope ?? "global"
        canvas.scope = scope
        if scope == "connection" {
            canvas.connectionID = connectionID
        }

        // Message handler relay: canvas JS → orchestrator
        // Special handling for "move" messages: update via CG coordinate path
        // so dragging works across display boundaries (setFrameOrigin alone doesn't).
        canvas.onMessage = { [weak self] body in
            if let dict = body as? [String: Any],
               let type = dict["type"] as? String, type == "move",
               let dx = dict["dx"] as? Double,
               let dy = dict["dy"] as? Double {
                DispatchQueue.main.async {
                    var cg = canvas.cgFrame
                    cg.origin.x += CGFloat(dx)
                    cg.origin.y += CGFloat(dy)  // CG Y-down, same direction as screen drag
                    canvas.updatePosition(cgRect: cg)
                }
                return  // Don't relay move events to subscribers
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
        canvases[id] = canvas

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl)
        }

        if hasAnchoredCanvases || autoMode != nil { startAnchorPolling() }

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
            } else {
                canvas.offset = CGRect(x: 0, y: 0, width: winBounds.width, height: winBounds.height)
                canvas.updatePosition(cgRect: winBounds)
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
        }

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl > 0 ? ttl : nil)  // ttl=0 clears the TTL
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
        return .ok()
    }

    private func handleRemoveAll() -> CanvasResponse {
        for (_, canvas) in canvases {
            canvas.close()
        }
        canvases.removeAll()
        stopAnchorPolling()
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
func allDisplaysBounds() -> CGRect {
    var result = CGRect.zero
    for screen in NSScreen.screens {
        let cgFrame = screenToCG(screen.frame)
        result = result.isEmpty ? cgFrame : result.union(cgFrame)
    }
    if result.isEmpty {
        return CGRect(x: 0, y: 0, width: 1920, height: 1080) // fallback
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
