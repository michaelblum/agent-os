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

    private func waitForPort(timeoutMs: Int = 10000, pollMs: Int = 25) -> UInt16 {
        var port = portProvider()
        if port > 0 { return port }
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while port == 0 && Date() < deadline {
            Thread.sleep(forTimeInterval: Double(pollMs) / 1000)
            port = portProvider()
        }
        return port
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)

        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let port = waitForPort()
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

func canvasScreenFrame(_ cgRect: CGRect) -> NSRect {
    return cgToScreen(cgRect)
}

private func canvasCGFrame(_ screenFrame: NSRect) -> CGRect {
    return screenToCG(screenFrame)
}

// MARK: - CanvasWindow (unconstrained NSWindow)

/// NSWindow subclass that disables frame constraining and enables keyboard input for interactive canvases.
/// By default macOS may reposition or resize windows to fit within a single display.
/// Canvases need to span multiple displays, so we return the proposed frame unchanged.
/// Borderless windows return false for canBecomeKey by default, which prevents text input.
/// Interactive canvases override this to accept keyboard focus.
class CanvasWindow: NSWindow {
    var isInteractiveCanvas: Bool = false
    var isActivelyDraggingCanvas: Bool = false

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
    case none
}

// MARK: - Canvas Window Level

private let canvasWindowLevelValues: Set<String> = [
    "automatic",
    "floating",
    "status_bar",
    "screen_saver",
]

func normalizeCanvasWindowLevel(_ value: String?) -> String? {
    guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
    let normalized = raw.lowercased().replacingOccurrences(of: "-", with: "_")
    if normalized == "auto" { return "automatic" }
    return canvasWindowLevelValues.contains(normalized) ? normalized : nil
}

func validCanvasWindowLevelsDescription() -> String {
    return canvasWindowLevelValues.sorted().joined(separator: ", ")
}

func resolveCanvasWindowLevel(_ level: String?, interactive: Bool) -> NSWindow.Level {
    switch normalizeCanvasWindowLevel(level) {
    case "floating":
        return .floating
    case "status_bar":
        return .statusBar
    case "screen_saver":
        return .screenSaver
    default:
        return interactive ? .floating : .statusBar
    }
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
    var windowLevel: String? {
        didSet { applyWindowLevel() }
    }
    var suspended: Bool = false
    var cascadeFromParent: Bool = true
    var parent: String?

    /// Direct create/update into a mixed-DPI straddling rect can still land at
    /// `frame + externalScreen.frame.origin` for specific ratios, while
    /// incremental drag updates land correctly and smoothly. Keep the re-home
    /// fallback only for non-drag placements; drag stays on the direct path.
    private func needsMixedDPIStraddleFallback(_ rect: NSRect) -> Bool {
        var intersectingScaleFactors = Set<CGFloat>()
        var intersectionCount = 0
        for screen in NSScreen.screens {
            let intersection = rect.intersection(screen.frame)
            guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { continue }
            intersectionCount += 1
            intersectingScaleFactors.insert(screen.backingScaleFactor)
        }
        return intersectionCount > 1 && intersectingScaleFactors.count > 1
    }

    /// Place the window at `screenFrame` in global NSScreen coordinates.
    private func applyScreenFrame(_ screenFrame: NSRect, allowMixedDPIFallback: Bool) {
        if allowMixedDPIFallback && needsMixedDPIStraddleFallback(screenFrame) {
            window.setFrame(
                NSRect(x: screenFrame.minX, y: screenFrame.minY, width: 1, height: 1),
                display: false
            )
        }
        window.setFrame(screenFrame, display: true)
    }

    private func schedulePlacementRetry(for cgRect: CGRect) {
        pendingCGFrame = cgRect
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self, let pending = self.pendingCGFrame else { return }
            self.pendingCGFrame = nil
            let retry = canvasScreenFrame(pending)
            self.applyScreenFrame(retry, allowMixedDPIFallback: true)
            // Double-tap: some display transitions need two attempts.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.applyScreenFrame(retry, allowMixedDPIFallback: true)
            }
        }
    }

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

    private func applyWindowLevel() {
        window.level = resolveCanvasWindowLevel(windowLevel, interactive: isInteractive)
    }

    func refreshWindowLevel() {
        applyWindowLevel()
    }

    init(id: String, cgFrame: CGRect, interactive: Bool, windowLevel: String? = nil, aosSchemeHandler: WKURLSchemeHandler? = nil) {
        self.id = id
        self.isInteractive = interactive
        self.windowLevel = normalizeCanvasWindowLevel(windowLevel)
        self.desiredCGFrame = cgFrame

        let screenFrame = canvasScreenFrame(cgFrame)

        let window = CanvasWindow(
            contentRect: screenFrame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.level = resolveCanvasWindowLevel(windowLevel, interactive: interactive)
        window.ignoresMouseEvents = !interactive
        window.isInteractiveCanvas = interactive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        if let handler = aosSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos")
        }
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: "window.__aosCanvasId = \(jsStringLiteral(id));",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
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

        let contentView = NSView(frame: NSRect(origin: .zero, size: screenFrame.size))
        contentView.autoresizingMask = [.width, .height]
        webView.frame = contentView.bounds
        contentView.addSubview(webView)
        window.contentView = contentView

        self.window = window
        self.webView = webView
        applyScreenFrame(screenFrame, allowMixedDPIFallback: true)
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
        let target = desiredCGFrame
        DispatchQueue.main.async { [weak self] in
            self?.updatePosition(cgRect: target)
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
    private var desiredCGFrame: CGRect

    func updatePosition(cgRect: CGRect) {
        desiredCGFrame = cgRect
        let screenFrame = canvasScreenFrame(cgRect)
        let isDragging = (window as? CanvasWindow)?.isActivelyDraggingCanvas == true
        applyScreenFrame(screenFrame, allowMixedDPIFallback: !isDragging)
        if isDragging {
            return
        }
        let actual = canvasCGFrame(window.frame)
        if abs(actual.origin.x - cgRect.origin.x) > 2 || abs(actual.origin.y - cgRect.origin.y) > 2 {
            schedulePlacementRetry(for: cgRect)
        }
    }

    func finalizeDragPosition() {
        let screenFrame = canvasScreenFrame(desiredCGFrame)
        applyScreenFrame(screenFrame, allowMixedDPIFallback: false)
    }

    var cgFrame: CGRect {
        return canvasCGFrame(window.frame)
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
            windowLevel: windowLevel,
            ttl: remainingTTL,
            scope: scope,
            autoProject: autoProjectMode,
            track: trackTarget?.rawValue,
            parent: parent,
            cascade: cascadeFromParent,
            suspended: suspended,
            segments: nil
        )
    }
}

extension Canvas: CanvasLike {
    var windowNumbers: [Int] { [window.windowNumber] }

    func evaluateJavaScript(_ script: String, completion: ((Any?, Error?) -> Void)?) {
        webView.evaluateJavaScript(script, completionHandler: completion)
    }

    func setAlpha(_ alpha: CGFloat) {
        window.alphaValue = alpha
    }

    func orderFront() {
        window.orderFront(nil)
    }

    func orderOut() {
        window.orderOut(nil)
    }
}

// MARK: - Canvas Manager

class CanvasManager {
    private var canvases: [String: CanvasLike] = [:]
    private var anchorTimer: DispatchSourceTimer?
    var aosSchemeHandler: WKURLSchemeHandler?
    var onCanvasCountChanged: (() -> Void)?
    var onEvent: ((String, Any) -> Void)?   // (canvasID, payload) — relayed to subscribers
    var onMenuItems: ((String, [[String: String]]) -> Void)?  // (canvasID, items)
    /// (canvasInfo, action) — relayed to subscribers as canvas_lifecycle events
    var onCanvasLifecycle: ((CanvasInfo, String) -> Void)?
    /// (eventName, payload) — relayed to subscribers as desktop-world surface topology events.
    var onCanvasSurfaceEvent: ((String, [String: Any]) -> Void)?
    let startTime = Date()
    private var lastChannelReRead: Date = .distantPast
    private var lastAutoProjectUpdate: Date = .distantPast
    private var lastCursorTrailUpdate: Date = .distantPast

    var isEmpty: Bool { canvases.isEmpty }
    func hasCanvas(_ id: String) -> Bool { canvases[id] != nil }

    func setCanvasAlpha(_ id: String, _ alpha: CGFloat) {
        guard let canvas = canvases[id] else { return }
        canvas.setAlpha(alpha)
    }

    var hasAnchoredCanvases: Bool { canvases.values.contains { $0.anchorWindowID != nil } }
    var hasAutoProjectCanvases: Bool { canvases.values.contains { $0.autoProjectMode != nil } }
    var hasTrackedCanvases: Bool { canvases.values.contains { $0.trackTarget != nil } }

    private func framesDiffer(_ lhs: CGRect, _ rhs: CGRect, tolerance: CGFloat = 0.5) -> Bool {
        abs(lhs.origin.x - rhs.origin.x) > tolerance ||
        abs(lhs.origin.y - rhs.origin.y) > tolerance ||
        abs(lhs.size.width - rhs.size.width) > tolerance ||
        abs(lhs.size.height - rhs.size.height) > tolerance
    }

    private func emitLifecycle(_ canvas: CanvasLike, action: String) {
        onCanvasLifecycle?(canvas.toInfo(), action)
    }

    @discardableResult
    private func moveCanvas(_ canvas: CanvasLike, to cgRect: CGRect) -> Bool {
        let current = canvas.cgFrame
        guard framesDiffer(current, cgRect) else { return false }
        canvas.updatePosition(cgRect: cgRect)
        emitLifecycle(canvas, action: "updated")
        return true
    }

    private func emitSegmentDeltas(_ surface: DesktopWorldSurfaceCanvas) {
        guard let delta = surface.lastDelta else { return }
        for segment in delta.added {
            onCanvasSurfaceEvent?(
                "canvas_segment_added",
                segmentEventPayload(canvasID: surface.id, segment: segment, action: "added")
            )
        }
        for segment in delta.removed {
            onCanvasSurfaceEvent?(
                "canvas_segment_removed",
                [
                    "canvas_id": surface.id,
                    "display_id": Int(segment.displayID),
                ]
            )
        }
        for segment in delta.changed {
            onCanvasSurfaceEvent?(
                "canvas_segment_changed",
                segmentEventPayload(canvasID: surface.id, segment: segment, action: "changed")
            )
        }
        onCanvasSurfaceEvent?(
            "canvas_topology_settled",
            topologySettledPayload(canvasID: surface.id, segments: delta.settled)
        )
    }

    private func segmentEventPayload(canvasID: String, segment: DesktopWorldSurfaceSegment, action: String) -> [String: Any] {
        [
            "canvas_id": canvasID,
            "action": action,
            "display_id": Int(segment.displayID),
            "index": segment.index,
            "dw_bounds": segment.dwBounds,
            "native_bounds": segment.nativeBounds,
        ]
    }

    func topologySettledPayload(canvasID: String, segments: [DesktopWorldSurfaceSegment]) -> [String: Any] {
        [
            "canvas_id": canvasID,
            "segments": segments.map { segment in
                [
                    "display_id": Int(segment.displayID),
                    "index": segment.index,
                    "dw_bounds": segment.dwBounds,
                    "native_bounds": segment.nativeBounds,
                ] as [String: Any]
            },
        ]
    }

    /// Expose a canvas for external callers (daemon layer) that need to set parent.
    func canvas(forID id: String) -> CanvasLike? { canvases[id] }

    func windowNumbers(forID id: String) -> [Int] {
        canvases[id]?.windowNumbers ?? []
    }

    func inputSurfaceRecords() -> [AOSInputSurfaceRecord] {
        canvases.values.flatMap { canvas -> [AOSInputSurfaceRecord] in
            let info = canvas.toInfo()
            let windowNumbers = canvas.windowNumbers
            let suspended = info.suspended == true
            if let segments = info.segments, !segments.isEmpty {
                let ordered = segments.sorted { $0.index < $1.index }
                return ordered.enumerated().map { offset, segment in
                    AOSInputSurfaceRecord(
                        id: "\(info.id)#display:\(segment.displayID)",
                        nativeFrame: CGRect(
                            x: segment.nativeBounds[0],
                            y: segment.nativeBounds[1],
                            width: segment.nativeBounds[2],
                            height: segment.nativeBounds[3]
                        ),
                        interactive: info.interactive,
                        suspended: suspended,
                        clickThrough: !info.interactive,
                        windowLevel: info.windowLevel,
                        windowNumber: offset < windowNumbers.count ? windowNumbers[offset] : nil
                    )
                }
            }

            guard info.at.count >= 4 else { return [] }
            return [
                AOSInputSurfaceRecord(
                    id: info.id,
                    nativeFrame: CGRect(x: info.at[0], y: info.at[1], width: info.at[2], height: info.at[3]),
                    interactive: info.interactive,
                    suspended: suspended,
                    clickThrough: !info.interactive,
                    windowLevel: info.windowLevel,
                    windowNumber: windowNumbers.first
                ),
            ]
        }
    }

    func frontmostHittableInputSurface(
        at point: CGPoint,
        frontToBackWindowNumbers: [Int] = []
    ) -> AOSInputSurfaceHitDecision {
        frontmostHittableAOSSurface(
            at: point,
            surfaces: inputSurfaceRecords(),
            frontToBackWindowNumbers: frontToBackWindowNumbers
        )
    }

    /// Collect a canvas and all its cascade-eligible descendants (recursive).
    func collectTree(_ rootID: String) -> [String] {
        var result = [rootID]
        for canvas in canvases.values where canvas.parent == rootID && canvas.cascadeFromParent {
            result.append(contentsOf: collectTree(canvas.id))
        }
        return result
    }

    private final class LifecycleWaiter {
        let id = UUID()
        let action: String
        var pendingCanvasIDs: Set<String>
        let completion: (Bool) -> Void
        var timeoutWorkItem: DispatchWorkItem?

        init(action: String, pendingCanvasIDs: Set<String>, completion: @escaping (Bool) -> Void) {
            self.action = action
            self.pendingCanvasIDs = pendingCanvasIDs
            self.completion = completion
        }
    }

    /// Lifecycle-complete waiters keyed by action. Renderers ACK transitions
    /// with `lifecycle.complete`, letting daemon-side flows wait on real
    /// transition completion instead of fixed sleeps.
    private var lifecycleWaiters: [UUID: LifecycleWaiter] = [:]

    @discardableResult
    func awaitLifecycleCompletion(
        canvasIDs: Set<String>,
        action: String,
        timeout: TimeInterval? = nil,
        completion: @escaping (Bool) -> Void
    ) -> UUID? {
        guard !canvasIDs.isEmpty else {
            completion(true)
            return nil
        }

        let waiter = LifecycleWaiter(action: action, pendingCanvasIDs: canvasIDs, completion: completion)
        lifecycleWaiters[waiter.id] = waiter

        if let timeout, timeout.isFinite {
            let workItem = DispatchWorkItem { [weak self] in
                guard let self,
                      let pending = self.lifecycleWaiters.removeValue(forKey: waiter.id) else { return }
                pending.timeoutWorkItem = nil
                pending.completion(false)
            }
            waiter.timeoutWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: workItem)
        }

        return waiter.id
    }

    private func completeLifecycleWaiter(_ waiterID: UUID, success: Bool) {
        guard let waiter = lifecycleWaiters.removeValue(forKey: waiterID) else { return }
        waiter.timeoutWorkItem?.cancel()
        waiter.timeoutWorkItem = nil
        waiter.completion(success)
    }

    private func abandonLifecycleCompletions(forCanvasID canvasID: String) {
        let waiterIDs = lifecycleWaiters.compactMap { id, waiter in
            waiter.pendingCanvasIDs.contains(canvasID) ? id : nil
        }

        for waiterID in waiterIDs {
            guard let waiter = lifecycleWaiters[waiterID] else { continue }
            waiter.pendingCanvasIDs.remove(canvasID)
            if waiter.pendingCanvasIDs.isEmpty {
                completeLifecycleWaiter(waiterID, success: false)
            }
        }
    }

    /// Re-resolve bounds for every canvas with a tracking target and apply
    /// the new bounds. Called from the daemon's coalesced display_geometry
    /// handler on topology change. Failures on individual canvases are logged
    /// but never block the rest of the iteration — a broken canvas must not
    /// stall the topology-change broadcast.
    func retargetTrackedCanvases() -> Set<String> {
        let unionBounds = allDisplaysBounds()
        guard unionBounds.width > 0, unionBounds.height > 0 else {
            fputs("[canvas] retargetTrackedCanvases: no displays, skipping\n", stderr)
            return []
        }

        var updated: Set<String> = []
        for canvas in canvases.values {
            guard let target = canvas.trackTarget else { continue }
            switch target {
            case .union:
                if let surface = canvas as? DesktopWorldSurfaceCanvas {
                    if surface.rebuildSegments() {
                        emitSegmentDeltas(surface)
                        emitLifecycle(surface, action: "updated")
                        updated.insert(surface.id)
                    }
                } else if moveCanvas(canvas, to: unionBounds) {
                    updated.insert(canvas.id)
                }
            case .none:
                break  // no-op; .none is transient (used to temporarily untrack during animation)
            }
        }
        return updated
    }

    func syncCanvasFrames(excluding excludedIDs: Set<String> = []) {
        for canvas in canvases.values where !excludedIDs.contains(canvas.id) {
            emitLifecycle(canvas, action: "updated")
        }
    }

    func removeByTTL(_ id: String) {
        guard let canvas = canvases.removeValue(forKey: id) else { return }
        let info = canvas.toInfo()
        canvas.close()
        abandonLifecycleCompletions(forCanvasID: id)
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasLifecycle?(info, "removed")
        onCanvasCountChanged?()
    }

    /// Remove all connection-scoped canvases owned by the given connection.
    func cleanupConnection(_ connectionID: UUID) {
        let toRemove = canvases.values
            .filter { $0.connectionID == connectionID && $0.scope == "connection" }
            .map { $0.id }
        for id in toRemove {
            if let canvas = canvases.removeValue(forKey: id) {
                let info = canvas.toInfo()
                canvas.close()
                abandonLifecycleCompletions(forCanvasID: id)
                onCanvasLifecycle?(info, "removed")
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
        case "post":    return handlePost(request)
        case "to-front": return handleToFront(request)
        case "suspend": return handleSuspend(request)
        case "resume":  return handleResume(request)
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

        let interactive = req.interactive ?? false
        if let requestedWindowLevel = req.windowLevel,
           normalizeCanvasWindowLevel(requestedWindowLevel) == nil {
            return .fail("Unknown window_level '\(requestedWindowLevel)'. Valid: \(validCanvasWindowLevelsDescription())", code: "INVALID_WINDOW_LEVEL")
        }
        let windowLevel = normalizeCanvasWindowLevel(req.windowLevel)
        let surfaceTarget = req.surface
        if let surfaceTarget, surfaceTarget != "desktop-world" {
            return .fail("Unknown surface target: \(surfaceTarget)", code: "INVALID_SURFACE")
        }
        if surfaceTarget != nil {
            let hasConflictingPlacement =
                req.at != nil ||
                req.track != nil ||
                req.anchorWindow != nil ||
                req.anchorChannel != nil ||
                req.offset != nil ||
                req.autoProject != nil
            if hasConflictingPlacement {
                return .fail("--surface desktop-world cannot be combined with --at, --track, anchors, offsets, or --auto-project", code: "INVALID_ARG")
            }
        }

        let isDesktopWorldSurface = surfaceTarget == "desktop-world" || trackTarget == .union
        let canvas: CanvasLike
        if isDesktopWorldSurface {
            let bounds = allDisplaysBounds()
            guard bounds.width > 0, bounds.height > 0 else {
                return .fail("desktop-world surface requires at least one connected display", code: "NO_DISPLAYS")
            }
            let surface = DesktopWorldSurfaceCanvas(id: id, interactive: interactive, windowLevel: windowLevel, aosSchemeHandler: aosSchemeHandler)
            surface.trackTarget = .union
            canvas = surface
        } else {
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
                return .fail("create requires --at x,y,w,h, --anchor-window + --offset, --anchor-channel, --track union, or --surface desktop-world", code: "MISSING_POSITION")
            }

            let single = Canvas(id: id, cgFrame: cgFrame, interactive: interactive, windowLevel: windowLevel, aosSchemeHandler: aosSchemeHandler)
            single.trackTarget = trackTarget
            canvas = single
        }
        canvas.cascadeFromParent = req.cascade ?? true
        // Explicit parent from request (implicit parent set by daemon layer)
        if let explicitParent = req.parent {
            guard canvases[explicitParent] != nil else {
                canvas.close()
                return .fail("Parent canvas '\(explicitParent)' not found", code: "PARENT_NOT_FOUND")
            }
            canvas.parent = explicitParent
        }
        // Born suspended: if explicitly requested, or if parent is suspended
        // and cascade is true, start hidden while still allowing the web view
        // to load and warm its runtime.
        let bornSuspended: Bool = {
            if req.suspended == true { return true }
            guard canvas.cascadeFromParent, let pid = canvas.parent,
                  let parentCanvas = canvases[pid] else { return false }
            return parentCanvas.suspended
        }()
        if bornSuspended {
            canvas.suspended = true
        }

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
                    DispatchQueue.main.async { [weak self] in
                        guard let self = self else { return }
                        let mouse = mouseInCGCoords()
                        let cgMouseX = mouse.x
                        let cgMouseY = mouse.y
                        let newX = cgMouseX - CGFloat(offsetX)
                        let newY = cgMouseY - CGFloat(offsetY)
                        let cg = canvas.cgFrame

                        // No display-snap: let the canvas straddle displays freely,
                        // same as the avatar animation path. updatePosition's retry
                        // logic handles any single-frame OS rejection at boundaries.
                        self.moveCanvas(canvas, to: CGRect(x: newX, y: newY, width: cg.width, height: cg.height))
                    }
                    return
                }

                // Legacy relative move (for backward compat)
                if type == "move",
                   let dx = dict["dx"] as? Double,
                   let dy = dict["dy"] as? Double {
                    DispatchQueue.main.async { [weak self] in
                        guard let self = self else { return }
                        var cg = canvas.cgFrame
                        cg.origin.x += CGFloat(dx)
                        cg.origin.y += CGFloat(dy)
                        self.moveCanvas(canvas, to: cg)
                    }
                    return
                }

                if type == "drag_start" {
                    DispatchQueue.main.async {
                        ((canvas as? Canvas)?.window as? CanvasWindow)?.isActivelyDraggingCanvas = true
                    }
                    return
                }

                if type == "drag_end" {
                    DispatchQueue.main.async {
                        ((canvas as? Canvas)?.window as? CanvasWindow)?.isActivelyDraggingCanvas = false
                        canvas.finalizeDragPosition()
                    }
                    return
                }

                // Page signaled it's loaded. If the canvas was created with
                // --focus, tell the page to focus its input field. One-shot:
                // clear the flag so we don't re-focus on subsequent ready
                // emits (the page can re-emit after navigation).
                if type == "ready" && canvas.focusOnReady {
                    canvas.focusOnReady = false
                    DispatchQueue.main.async {
                        canvas.evaluateJavaScript("typeof focusInput === 'function' && focusInput()", completion: nil)
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
                            canvas.evaluateJavaScript("window.__aosConfigLoaded?.(\(jsonStr))", completion: nil)
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
                            canvas.evaluateJavaScript("window.__aosConfigError?.('Unknown config key: \(key)')", completion: nil)
                            return
                        }
                        saveConfig(config)
                        let encoder = JSONEncoder()
                        encoder.outputFormatting = [.sortedKeys]
                        if let data = try? encoder.encode(config),
                           let jsonStr = String(data: data, encoding: .utf8) {
                            canvas.evaluateJavaScript("window.__aosConfigLoaded?.(\(jsonStr))", completion: nil)
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
                    DispatchQueue.main.async { [weak self] in
                        guard let self = self else { return }
                        let cg = canvas.cgFrame
                        let cx = cg.origin.x + cg.size.width / 2
                        let cy = cg.origin.y + cg.size.height / 2
                        let newFrame = CGRect(
                            x: cx - CGFloat(w) / 2,
                            y: cy - CGFloat(h) / 2,
                            width: CGFloat(w),
                            height: CGFloat(h)
                        )
                        self.moveCanvas(canvas, to: newFrame)
                    }
                    return
                }

                // Canvas-provided menu items for the status bar right-click menu.
                // { type: "set_menu_items", items: [{title: "...", id: "..."}, ...] }
                if type == "set_menu_items",
                   let rawItems = dict["items"] as? [[String: String]] {
                    self?.onMenuItems?(id, rawItems)
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

        if !bornSuspended {
            canvas.show()
            if req.focus == true && interactive {
                canvas.grabFocus()
            }
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
        emitLifecycle(canvas, action: "created")
        if let surface = canvas as? DesktopWorldSurfaceCanvas {
            emitSegmentDeltas(surface)
        }

        return .ok()
    }

    private func handleUpdate(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("update requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        var lifecycleDirty = false
        let isDesktopWorldSurface = canvas is DesktopWorldSurfaceCanvas

        if req.surface != nil {
            return .fail("--surface is create-only; remove and recreate the canvas as a desktop-world surface", code: "INVALID_ARG")
        }
        if !isDesktopWorldSurface && req.track == TrackTarget.union.rawValue {
            return .fail("cannot convert an existing canvas to a desktop-world surface with update; remove and recreate it", code: "INVALID_ARG")
        }
        if isDesktopWorldSurface {
            let hasPlacementMutation =
                req.at != nil ||
                req.anchorWindow != nil ||
                req.anchorChannel != nil ||
                req.offset != nil ||
                req.autoProject != nil
            if hasPlacementMutation {
                return .fail("desktop-world surface placement is topology-owned; update content or interactivity only", code: "INVALID_ARG")
            }
            if let track = req.track, track != TrackTarget.union.rawValue {
                return .fail("desktop-world surfaces cannot change tracking target", code: "INVALID_ARG")
            }
        }

        if let at = req.at, at.count == 4 {
            let newFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
            if moveCanvas(canvas, to: newFrame) {
                lifecycleDirty = false
            }
            canvas.anchorWindowID = nil
            canvas.anchorChannelID = nil
            canvas.offset = nil
        }

        if let trackStr = req.track {
            guard let t = TrackTarget(rawValue: trackStr) else {
                return .fail("Unknown track target: \(trackStr)", code: "INVALID_TRACK")
            }
            canvas.trackTarget = (t == .none) ? nil : t
            lifecycleDirty = true

            // Resolve new bounds from the target immediately so the retarget
            // is visible without waiting for the next topology-change event.
            if t == .union {
                let bounds = allDisplaysBounds()
                if bounds.width > 0 && bounds.height > 0 {
                    if moveCanvas(canvas, to: bounds) {
                        lifecycleDirty = false
                    }
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
                moveCanvas(canvas, to: newFrame)
            } else {
                canvas.offset = CGRect(x: 0, y: 0, width: winBounds.width, height: winBounds.height)
                moveCanvas(canvas, to: winBounds)
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
                moveCanvas(canvas, to: newFrame)
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
            lifecycleDirty = true
            canvas.refreshWindowLevel()
            if let single = canvas as? Canvas {
                single.window.ignoresMouseEvents = !interactive
                // The CanvasWindow reads isInteractiveCanvas to decide canBecomeKey
                // and whether sendEvent should activate on first click. Without
                // updating it, flipped-to-interactive canvases can receive mouse
                // events but never become key window, so keyboard input bounces
                // back to the previously-active app (system bonk on every keystroke).
                (single.window as? CanvasWindow)?.isInteractiveCanvas = interactive
                // NOTE: the WKWebView subclass (CanvasWebView vs plain WKWebView)
                // is chosen at construction time and cannot be swapped at runtime.
                // The only behavioral difference is acceptsFirstMouse, which only
                // affects the first-click-starts-drag ergonomic. A flipped canvas
                // may require one extra click to activate; recreate the canvas with
                // --interactive at creation time for full first-mouse behavior.
            }
        }

        if let requestedWindowLevel = req.windowLevel {
            guard let normalizedWindowLevel = normalizeCanvasWindowLevel(requestedWindowLevel) else {
                return CanvasResponse.fail("Unknown window_level '\(requestedWindowLevel)'. Valid: \(validCanvasWindowLevelsDescription())", code: "INVALID_WINDOW_LEVEL")
            }
            canvas.windowLevel = normalizedWindowLevel
            lifecycleDirty = true
        }

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl > 0 ? ttl : nil)  // ttl=0 clears the TTL
            lifecycleDirty = true
        }

        // --focus on update: the canvas is already loaded, so we can both
        // activate at the OS level and eval focusInput() right away.
        if req.focus == true && canvas.isInteractive {
            canvas.grabFocus()
            DispatchQueue.main.async {
                canvas.evaluateJavaScript("typeof focusInput === 'function' && focusInput()", completion: nil)
            }
        }

        if lifecycleDirty {
            emitLifecycle(canvas, action: "updated")
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
        let info = canvas.toInfo()
        canvas.close()
        abandonLifecycleCompletions(forCanvasID: id)
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasCountChanged?()
        onCanvasLifecycle?(info, "removed")
        return .ok()
    }

    private func handleRemoveAll() -> CanvasResponse {
        let removedCanvases = Array(canvases.values)
        let removedInfos = removedCanvases.map { $0.toInfo() }
        let removedIds = removedCanvases.map(\.id)
        for canvas in removedCanvases {
            canvas.close()
        }
        canvases.removeAll()
        for id in removedIds {
            abandonLifecycleCompletions(forCanvasID: id)
        }
        stopAnchorPolling()
        for info in removedInfos {
            onCanvasLifecycle?(info, "removed")
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

        canvas.evaluateJavaScript(js) { result, error in
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
            canvas.evaluateJavaScript(js, completion: nil)
        }
    }

    private func headsupEvalJS(forBase64 b64: String) -> String {
        "window.headsup && window.headsup.receive && window.headsup.receive(\(jsStringLiteral(b64)))"
    }

    @discardableResult
    func postMessage(canvasID: String, payload: Any) -> CanvasResponse {
        guard canvases[canvasID] != nil else {
            return .fail("Canvas '\(canvasID)' not found", code: "NOT_FOUND")
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let json = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let payloadStr = String(data: json, encoding: .utf8) else {
            return .fail("post payload must be valid JSON", code: "INVALID_JSON")
        }
        let b64 = Data(payloadStr.utf8).base64EncodedString()
        evalAsync(canvasID: canvasID, js: headsupEvalJS(forBase64: b64))
        return .ok()
    }

    func postMessageAsync(canvasID: String, payload: Any) {
        _ = postMessage(canvasID: canvasID, payload: payload)
    }

    private func handlePost(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("post requires --id", code: "MISSING_ID")
        }
        guard let dataStr = req.data, !dataStr.isEmpty else {
            return .fail("post requires --event", code: "MISSING_EVENT")
        }
        guard let data = dataStr.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data, options: []) else {
            return .fail("post requires valid JSON payload", code: "INVALID_JSON")
        }
        return postMessage(canvasID: id, payload: payload)
    }

    private func handleToFront(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("to-front requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        canvas.orderFront()
        return .ok()
    }

    // MARK: - Suspend / Resume

    private func handleSuspend(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("suspend requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        if canvas.suspended { return .ok() }

        // Phase 1: atomic hide — collect tree, orderOut all windows
        let tree = collectTree(id)
        for cid in tree {
            guard let c = canvases[cid] else { continue }
            c.orderOut()
            c.suspended = true
            emitLifecycle(c, action: "updated")
        }

        // Phase 2: notify renderers (async, best-effort, no ACK needed)
        for cid in tree {
            postMessageAsync(canvasID: cid, payload: ["type": "lifecycle", "action": "suspend"])
        }

        onCanvasCountChanged?()
        return .ok()
    }

    private func handleResume(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("resume requires --id", code: "MISSING_ID")
        }
        guard let canvas = canvases[id] else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        if !canvas.suspended { return .ok() }

        // Phase 1: notify renderers to wake up, collect ACKs
        let tree = collectTree(id)
        let suspendedInTree = tree.filter { canvases[$0]?.suspended == true }

        let showWindows: () -> Void = { [weak self] in
            guard let self = self else { return }
            // Phase 2: atomic show
            for cid in suspendedInTree {
                guard let c = self.canvases[cid] else { continue }
                c.show()
                c.suspended = false
                self.emitLifecycle(c, action: "updated")
            }
            self.onCanvasCountChanged?()
        }

        _ = awaitLifecycleCompletion(
            canvasIDs: Set(suspendedInTree),
            action: "resume",
            timeout: 1.0
        ) { completed in
            if !completed {
                fputs("[canvas] resume lifecycle ACK timeout; showing windows anyway\n", stderr)
            }
            showWindows()
        }

        // Send lifecycle:resume to each renderer
        for cid in suspendedInTree {
            postMessageAsync(canvasID: cid, payload: ["type": "lifecycle", "action": "resume"])
        }

        return .ok()
    }

    /// Back-compat alias for older renderers that still post lifecycle.ready.
    func receiveLifecycleReady(_ canvasID: String) {
        receiveLifecycleComplete(canvasID, action: "resume")
    }

    /// Called when a renderer sends lifecycle.complete ACK for an action.
    func receiveLifecycleComplete(_ canvasID: String, action: String) {
        guard !action.isEmpty else { return }

        let waiterIDs = lifecycleWaiters.compactMap { id, waiter in
            waiter.action == action && waiter.pendingCanvasIDs.contains(canvasID) ? id : nil
        }

        for waiterID in waiterIDs {
            guard let waiter = lifecycleWaiters[waiterID] else { continue }
            waiter.pendingCanvasIDs.remove(canvasID)
            if waiter.pendingCanvasIDs.isEmpty {
                completeLifecycleWaiter(waiterID, success: true)
            }
        }
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
                    let point = mouseInCGCoords()
                    let cgX = point.x
                    let cgY = point.y
                    let js = "if(typeof addPoint==='function')addPoint(\(cgX),\(cgY),\(now.timeIntervalSince1970*1000))"
                    canvas.evaluateJavaScript(js, completion: nil)
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
                        canvas.evaluateJavaScript(js, completion: nil)
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
            moveCanvas(canvas, to: newFrame)
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
