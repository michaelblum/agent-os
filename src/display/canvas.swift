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

    private func currentContentPort() -> UInt16 {
        return portProvider()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)

        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let port = currentContentPort()
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

func aosCanvasBootstrapScript(_ prelude: String) -> String {
    return """
\(prelude)
(function () {
  if (window.__aosStatsBootstrapInstalled) return;
  window.__aosStatsBootstrapInstalled = true;
  const controller = window.aosStats && typeof window.aosStats === 'object' ? window.aosStats : {};
  const queue = Array.isArray(controller.__aosStatsQueue) ? controller.__aosStatsQueue : [];
  let loading = null;

  function status() {
    return {
      available: !!controller.available,
      enabled: false,
      mode: controller.__aosStatsOptions?.mode || 'auto',
      panel: controller.__aosStatsOptions?.panel || 0,
      canvasId: controller.canvasId || null,
      segmentDisplayId: controller.segmentDisplayId ?? null,
      connected: false,
      error: controller.error || null
    };
  }

  function load() {
    if (loading) return loading;
    loading = import('aos://toolkit/runtime/canvas-stats.js').then(function (module) {
      if (module && typeof module.attachCanvasStats === 'function') {
        module.attachCanvasStats(controller);
      }
      controller.__aosStatsStub = false;
      return controller;
    }).catch(function (error) {
      controller.available = false;
      controller.error = String(error && error.message ? error.message : error);
      return controller;
    });
    return loading;
  }

  function queued(method, shouldLoad) {
    return function () {
      if (controller.available && !controller.__aosStatsStub && typeof controller[method] === 'function') {
        return controller[method].apply(controller, arguments);
      }
      queue.push([method, Array.prototype.slice.call(arguments)]);
      if (shouldLoad) load();
      return status();
    };
  }

  Object.assign(controller, {
    __aosStatsStub: true,
    __aosStatsQueue: queue,
    available: false,
    error: null,
    canvasId: window.__aosCanvasId || window.__aosSurfaceCanvasId || null,
    segmentDisplayId: typeof window.__aosSegmentDisplayId === 'undefined' ? null : window.__aosSegmentDisplayId,
    load,
    status,
    configure: queued('configure', true),
    enable: queued('enable', true),
    disable: queued('disable', true),
    toggle: queued('toggle', true),
    begin: queued('begin', false),
    end: queued('end', false),
    update: queued('update', false),
    showPanel: queued('showPanel', true)
  });
  window.aosStats = controller;
  window.__aosStats = controller;
})();
"""
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
    var lifecycleState: String = "active"
    var lifecycleGeneration: UInt64 = 0
    var cascadeFromParent: Bool = true
    var parent: String?
    var owner: CanvasOwnerInfo?
    private(set) var sourceURL: String?
    var placement: [String: JSONValue]?
    var logicalSurfaceKey: String?
    private var inputPassthrough = false
    private var retirementQuiesced = false
    private var retirementFinalized = false

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
        let generation = lifecycleGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self,
                  self.acceptsLifecycleCallback(generation: generation),
                  let pending = self.pendingCGFrame else { return }
            self.pendingCGFrame = nil
            let retry = canvasScreenFrame(pending)
            self.applyScreenFrame(retry, allowMixedDPIFallback: true)
            // Double-tap: some display transitions need two attempts.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                guard let self, self.acceptsLifecycleCallback(generation: generation) else { return }
                self.applyScreenFrame(retry, allowMixedDPIFallback: true)
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

    private func applyMouseEventPolicy() {
        window.ignoresMouseEvents = inputPassthrough || !isInteractive
        (window as? CanvasWindow)?.isInteractiveCanvas = !inputPassthrough && isInteractive
    }

    func refreshWindowLevel() {
        applyWindowLevel()
    }

    func setInputPassthrough(_ enabled: Bool) {
        inputPassthrough = enabled
        applyMouseEventPolicy()
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
        window.isReleasedWhenClosed = false
        window.animationBehavior = .none
        window.isOpaque = false
        window.hasShadow = false
        window.level = resolveCanvasWindowLevel(windowLevel, interactive: interactive)
        window.ignoresMouseEvents = inputPassthrough || !interactive
        window.isInteractiveCanvas = !inputPassthrough && interactive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        if let handler = aosSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos")
        }
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: aosCanvasBootstrapScript("""
window.__aosCanvasId = \(jsStringLiteral(id));
window.__aosInitialFrame = [\(cgFrame.origin.x), \(cgFrame.origin.y), \(cgFrame.size.width), \(cgFrame.size.height)];
"""),
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
        sourceURL = nil
        webView.loadHTMLString(html, baseURL: nil)
    }

    func loadURL(_ urlString: String) {
        sourceURL = urlString
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
        let generation = lifecycleGeneration
        DispatchQueue.main.async { [weak self] in
            guard let self, self.acceptsLifecycleCallback(generation: generation) else { return }
            self.updatePosition(cgRect: target)
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

    func quiesceForRetirement() {
        precondition(Thread.isMainThread, "canvas quiesce must run on the main thread")
        guard !retirementQuiesced else { return }
        retirementQuiesced = true
        onMessage = nil
        onTTLExpired = nil
        ttlTimer?.cancel()
        ttlTimer = nil
        pendingCGFrame = nil
        window.ignoresMouseEvents = true
        (window as? CanvasWindow)?.isInteractiveCanvas = false
        window.orderOut(nil)
        webView.stopLoading()
    }

    func finalizeRetirement() {
        precondition(Thread.isMainThread, "canvas finalization must run on the main thread")
        guard !retirementFinalized else { return }
        retirementFinalized = true
        quiesceForRetirement()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "headsup")
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        window.contentView = nil
        window.close()
        ttlDeadline = nil
    }

    private func acceptsLifecycleCallback(generation: UInt64) -> Bool {
        generation == lifecycleGeneration &&
            lifecycleState != "retiring" &&
            lifecycleState != "removed"
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
            url: sourceURL,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            requestedFrame: [desiredCGFrame.origin.x, desiredCGFrame.origin.y, desiredCGFrame.size.width, desiredCGFrame.size.height],
            placement: placement,
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
            lifecycleState: lifecycleState,
            windowNumbers: windowNumbers,
            segments: nil,
            owner: owner,
            logicalSurfaceKey: logicalSurfaceKey
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
    private let lifecycleCoordinator = CanvasLifecycleCoordinator()
    private let lifecycleCompletions = CanvasLifecycleCompletionTracker()
    private var anchorTimer: DispatchSourceTimer?
    var aosSchemeHandler: WKURLSchemeHandler?
    var sceneExtensionSchemeHandler: WKURLSchemeHandler?
    var onCanvasCountChanged: (() -> Void)?
    var onEvent: ((CanvasLifecycleGeneration, Any) -> Void)?
    var onMenuItems: ((String, [[String: Any]]) -> Void)?  // (canvasID, items)
    /// (canvasInfo, action) — relayed to subscribers as canvas_lifecycle events
    var onCanvasLifecycle: ((CanvasInfo, String) -> Void)?
    /// (payload) — relayed to subscribers as canvas_geometry events
    var onCanvasGeometry: (([String: Any]) -> Void)?
    /// (eventName, payload) — relayed to subscribers as desktop-world surface topology events.
    var onCanvasSurfaceEvent: ((String, [String: Any]) -> Void)?
    let startTime = Date()
    private var lastChannelReRead: Date = .distantPast
    private var lastAutoProjectUpdate: Date = .distantPast
    private var lastCursorTrailUpdate: Date = .distantPast
    private var activeGeometryTransactions: [String: [String: Any]] = [:]
    private var inputPassthroughOverride = false

    var isEmpty: Bool { canvases.isEmpty }
    func hasCanvas(_ id: String) -> Bool { canvases[id] != nil }
    var inputPassthroughActive: Bool { inputPassthroughOverride }

    private func lease(for canvas: CanvasLike) -> CanvasLifecycleGeneration {
        CanvasLifecycleGeneration(canvasID: canvas.id, value: canvas.lifecycleGeneration)
    }

    func deliveryTarget(forCanvasID id: String) -> CanvasLifecycleGeneration? {
        precondition(Thread.isMainThread, "canvas delivery target capture must run on the main thread")
        guard let canvas = canvases[id] else { return nil }
        return lease(for: canvas)
    }

    @discardableResult
    func awaitLifecycleCompletion(
        for generations: Set<CanvasLifecycleGeneration>,
        action: String,
        timeout: TimeInterval? = nil,
        completion: @escaping (Bool) -> Void
    ) -> UUID? {
        lifecycleCompletions.await(
            generations: generations,
            action: action,
            timeout: timeout,
            completion: completion
        )
    }

    private func currentCanvas(for generation: CanvasLifecycleGeneration) -> CanvasLike? {
        precondition(Thread.isMainThread, "canvas lookup must run on the main thread")
        guard let canvas = canvases[generation.canvasID],
              lifecycleCoordinator.matches(canvas, generation: generation) else {
            return nil
        }
        return canvas
    }

    private func enqueue(
        for generation: CanvasLifecycleGeneration,
        _ operation: @escaping (CanvasManager, CanvasLike) -> Void
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let canvas = self.currentCanvas(for: generation) else { return }
            operation(self, canvas)
        }
    }

    @discardableResult
    private func retireCanvas(
        id: String,
        emitLifecycle: Bool = true,
        notifyCountChanged: Bool = true
    ) -> CanvasInfo? {
        precondition(Thread.isMainThread, "canvas retirement must run on the main thread")
        guard let canvas = canvases.removeValue(forKey: id) else { return nil }

        activeGeometryTransactions.removeValue(forKey: id)
        let generation = lease(for: canvas)
        canvas.lifecycleState = "retiring"
        canvas.lifecycleState = "removed"
        let removedInfo = canvas.toInfo()
        lifecycleCoordinator.retainUntilNextRunLoop(canvas, generation: generation)
        lifecycleCompletions.abandon(generation)
        if !hasAnchoredCanvases { stopAnchorPolling() }
        if notifyCountChanged { onCanvasCountChanged?() }
        if emitLifecycle { onCanvasLifecycle?(removedInfo, "removed") }
        return removedInfo
    }

    func setInputPassthrough(_ enabled: Bool) {
        inputPassthroughOverride = enabled
        for canvas in canvases.values {
            canvas.setInputPassthrough(enabled)
        }
    }

    func diagnosticsSnapshot() -> [String: Any] {
        var lifecycleStates: [String: Int] = [:]
        var surfaceTypes: [String: Int] = [:]
        var windowLevels: [String: Int] = [:]
        var nativeWindowCount = 0
        var interactiveActiveCount = 0
        var fullDesktopActiveCount = 0
        var desktopWorldSegmentCount = 0
        var registeredWindowNumbers = Set<Int>()

        for canvas in canvases.values {
            let info = canvas.toInfo()
            let lifecycleState = info.lifecycleState ?? (info.suspended == true ? "suspended" : "active")
            let isActive = lifecycleState == "active" && info.suspended != true
            lifecycleStates[lifecycleState, default: 0] += 1
            if isActive && info.interactive {
                interactiveActiveCount += 1
            }
            if isActive && info.track == TrackTarget.union.rawValue {
                fullDesktopActiveCount += 1
            }
            if let segments = info.segments, !segments.isEmpty {
                surfaceTypes["desktop_world", default: 0] += 1
                desktopWorldSegmentCount += segments.count
            } else {
                surfaceTypes["window", default: 0] += 1
            }
            let windowCount = info.windowNumbers?.count ?? 0
            nativeWindowCount += windowCount
            registeredWindowNumbers.formUnion(info.windowNumbers ?? [])
            let level = info.windowLevel ?? "default"
            windowLevels[level, default: 0] += windowCount
        }

        let unregisteredCanvasWindows = NSApp.windows
            .compactMap { $0 as? CanvasWindow }
            .filter { !registeredWindowNumbers.contains($0.windowNumber) }
            .map(\.windowNumber)
            .sorted()

        return [
            "total": canvases.count,
            "by_lifecycle_state": lifecycleStates,
            "by_surface_type": surfaceTypes,
            "native_window_count": nativeWindowCount,
            "window_levels": windowLevels,
            "interactive_active": interactiveActiveCount,
            "full_desktop_active": fullDesktopActiveCount,
            "desktop_world_segments": desktopWorldSegmentCount,
            "pending_lifecycle_waiters": lifecycleCompletions.pendingCount,
            "pending_retirements": lifecycleCoordinator.pendingFinalizationCount,
            "pending_retirement_ids": lifecycleCoordinator.pendingFinalizationIDs,
            "unregistered_canvas_window_count": unregisteredCanvasWindows.count,
            "unregistered_canvas_window_numbers": unregisteredCanvasWindows,
        ]
    }

    func visibleSurfaceAudit(point: CGPoint? = nil) -> [String: Any] {
        let registeredInfos = canvases.values.map { $0.toInfo() }.sorted { $0.id < $1.id }
        let registeredWindowNumbers = Set(registeredInfos.flatMap { $0.windowNumbers ?? [] })
        let currentPID = Int(getpid())
        var allNativeWindows = nativeWindowServerEntries()
        allNativeWindows.append(contentsOf: testFixtureNativeWindowServerEntries())
        let nativeWindows = allNativeWindows.filter { ($0["owner_pid"] as? Int) == currentPID }
        let externalAOSWindows = externalAOSNativeWindows(from: allNativeWindows, currentPID: currentPID)
        let nativeByWindowNumber = Dictionary(uniqueKeysWithValues: nativeWindows.map { (($0["window_number"] as? Int) ?? -1, $0) })

        let registered = registeredInfos.map { info -> [String: Any] in
            var row = canvasInfoDictionary(info)
            let windowNumbers = info.windowNumbers ?? []
            row["join_key"] = ["window_numbers": windowNumbers]
            if let requestedFrame = info.requestedFrame {
                row["requested_frame"] = requestedFrame
                row["requested_frame_source"] = "Canvas.desiredCGFrame"
            } else {
                row["requested_frame_unavailable_reason"] = "canvas type does not expose a single requested frame"
            }
            if let placement = info.placement {
                row["placement"] = jsonDictionary(placement)
            } else {
                row["placement_unavailable_reason"] = "canvas has not reported toolkit placement metadata"
            }
            let actualNativeWindows = windowNumbers.compactMap { nativeByWindowNumber[$0] }
            row["actual_native_windows"] = actualNativeWindows
            if let actualNativeFrame = (actualNativeWindows.first?["actual_frame"] as? [String: Any]) {
                row["actual_native_frame"] = actualNativeFrame
            }
            row["native_join_status"] = windowNumbers.isEmpty
                ? "no_window_numbers"
                : (windowNumbers.allSatisfy { nativeByWindowNumber[$0] != nil } ? "matched" : "missing_native_window")
            if let logicalSurfaceKey = info.logicalSurfaceKey {
                row["logical_surface_key"] = logicalSurfaceKey
            }
            return row
        }

        let unmatchedNativeWindows = nativeWindows.filter { native in
            guard let windowNumber = native["window_number"] as? Int else { return true }
            return !registeredWindowNumbers.contains(windowNumber)
        }
        let orphanNativeWindows = unmatchedNativeWindows.filter { native in
            (native["visible"] as? Bool) == true && (native["on_screen"] as? Bool) == true
        }
        let nonVisibleUnmatchedNativeWindows = unmatchedNativeWindows.filter { native in
            !((native["visible"] as? Bool) == true && (native["on_screen"] as? Bool) == true)
        }

        let registeredMissingNative = registered.filter { row in
            (row["native_join_status"] as? String) == "missing_native_window"
        }

        var groups: [String: [[String: Any]]] = [:]
        for row in registered {
            guard let key = row["logical_surface_key"] as? String, !key.isEmpty else { continue }
            let visibleNative = (row["actual_native_windows"] as? [[String: Any]] ?? []).contains { native in
                (native["on_screen"] as? Bool) == true
            }
            if visibleNative {
                groups[key, default: []].append(row)
            }
        }
        let duplicates = groups
            .filter { $0.value.count > 1 }
            .map { key, rows in
                [
                    "logical_surface_key": key,
                    "count": rows.count,
                    "canvas_ids": rows.compactMap { $0["id"] as? String },
                    "entries": rows,
                ] as [String: Any]
            }
            .sorted { (($0["logical_surface_key"] as? String) ?? "") < (($1["logical_surface_key"] as? String) ?? "") }

        var inputTarget: [String: Any] = [
            "available": point != nil,
            "method": "native_window_front_to_back_order_with_registry_interactivity",
        ]
        if let point {
            inputTarget["point"] = [point.x, point.y]
            inputTarget["winner"] = inputTargetWinner(
                at: point,
                nativeWindows: nativeWindows,
                externalAOSWindows: externalAOSWindows,
                registeredInfos: registeredInfos
            )
        } else {
            inputTarget["unavailable_reason"] = "pass --point x,y to evaluate a native point"
        }

        let worktreeRoot: Any = aosRepoRootFromBases([FileManager.default.currentDirectoryPath]) ?? NSNull()
        return [
            "status": "success",
            "schema_version": 1,
            "runtime": [
                "pid": Int(getpid()),
                "mode": aosCurrentRuntimeMode().rawValue,
                "worktree_root": worktreeRoot,
                "cwd": FileManager.default.currentDirectoryPath,
                "native_window_scope": "current_daemon_process",
                "current_daemon_pid": currentPID,
                "cross_process_aos_window_discovery": [
                    "ran": true,
                    "native_window_scope": "visible_on_screen_aos_owned_windows_not_owned_by_current_daemon_process",
                    "candidate_identification": [
                        "CGWindow owner PID differs from current daemon PID",
                        "native window is visible and on screen",
                        "owner name, executable path, or command line indicates an AOS runtime",
                    ],
                    "native_source": "CGWindowListCopyWindowInfo(kCGWindowListOptionAll)",
                    "process_metadata_source": "NSRunningApplication plus one batched ps command for prefiltered unique candidate PIDs; git provenance is unavailable in the live audit fast path",
                    "stale_daemon_model": "same aos (serve|__serve) process pattern used by ./aos clean --dry-run --json",
                    "cleanup_command": "./aos clean --dry-run --json",
                    "inspect_command": "./aos status --json",
                ] as [String: Any],
            ],
            "join": [
                "key": "CanvasInfo.windowNumbers[] == CGWindowListCopyWindowInfo[kCGWindowNumber]",
                "native_source": "CGWindowListCopyWindowInfo(kCGWindowListOptionAll)",
                "registry_source": "CanvasManager.canvases.toInfo()",
            ],
            "registered_canvases": registered,
            "native_windows": nativeWindows,
            "orphan_native_windows": orphanNativeWindows,
            "non_visible_unmatched_native_windows": nonVisibleUnmatchedNativeWindows,
            "external_aos_native_windows": externalAOSWindows,
            "registered_without_native_window": registeredMissingNative,
            "duplicate_logical_surfaces": duplicates,
            "input_target_winner": inputTarget,
            "unavailable": [
                "orphan_synthesis": "read-only audit cannot synthesize a native daemon window without a registry entry",
            ],
        ]
    }

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

    private func frameArray(_ rect: CGRect) -> [CGFloat] {
        [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height]
    }

    private func jsonDictionary(_ object: [String: JSONValue]) -> [String: Any] {
        object.mapValues { $0.anyValue }
    }

    private func canvasInfoDictionary(_ info: CanvasInfo) -> [String: Any] {
        var row: [String: Any] = [
            "id": info.id,
            "at": info.at,
            "interactive": info.interactive,
        ]
        if let url = info.url { row["url"] = url }
        if let anchorWindow = info.anchorWindow { row["anchor_window"] = anchorWindow }
        if let anchorChannel = info.anchorChannel { row["anchor_channel"] = anchorChannel }
        if let offset = info.offset { row["offset"] = offset }
        if let windowLevel = info.windowLevel { row["window_level"] = windowLevel }
        if let ttl = info.ttl { row["ttl"] = ttl }
        if let scope = info.scope { row["scope"] = scope }
        if let autoProject = info.autoProject { row["auto_project"] = autoProject }
        if let track = info.track { row["track"] = track }
        if let parent = info.parent { row["parent"] = parent }
        if let cascade = info.cascade { row["cascade"] = cascade }
        if let suspended = info.suspended { row["suspended"] = suspended }
        if let lifecycleState = info.lifecycleState { row["lifecycleState"] = lifecycleState }
        if let windowNumbers = info.windowNumbers { row["windowNumbers"] = windowNumbers }
        if let placement = info.placement {
            row["placement"] = jsonDictionary(placement)
        }
        if let segments = info.segments {
            row["segments"] = segments.map { segment in
                [
                    "display_id": Int(segment.displayID),
                    "index": segment.index,
                    "dw_bounds": segment.dwBounds,
                    "native_bounds": segment.nativeBounds,
                ] as [String: Any]
            }
        }
        if let owner = info.owner, let ownerDict = owner.dictionary() {
            row["owner"] = ownerDict
        }
        if let logicalSurfaceKey = info.logicalSurfaceKey {
            row["logical_surface_key"] = logicalSurfaceKey
        }
        return row
    }

    private func frameDictionary(_ rect: CGRect) -> [String: Any] {
        [
            "x": rect.origin.x,
            "y": rect.origin.y,
            "w": rect.size.width,
            "h": rect.size.height,
        ]
    }

    private func displayRelationships(for frame: CGRect) -> [[String: Any]] {
        NSScreen.screens.compactMap { screen in
            let cgFrame = canvasCGFrame(screen.frame)
            let intersection = frame.intersection(cgFrame)
            guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return nil }
            let displayID = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
            return [
                "display_id": displayID ?? -1,
                "frame": frameDictionary(cgFrame),
                "intersection": frameDictionary(intersection),
            ] as [String: Any]
        }
    }

    private func nativeWindowServerEntries(ownerPID: Int? = nil) -> [[String: Any]] {
        guard let infos = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        return infos.enumerated().compactMap { index, info in
            let actualOwnerPID = info[kCGWindowOwnerPID as String] as? Int ?? -1
            if let ownerPID, actualOwnerPID != ownerPID { return nil }
            let boundsDict = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
            let frame = CGRect(
                x: numberValue(boundsDict["X"]) ?? 0,
                y: numberValue(boundsDict["Y"]) ?? 0,
                width: numberValue(boundsDict["Width"]) ?? 0,
                height: numberValue(boundsDict["Height"]) ?? 0
            )
            let alpha = numberValue(info[kCGWindowAlpha as String]) ?? 1
            let onScreen = (info[kCGWindowIsOnscreen as String] as? Bool) ?? false
            let windowNumber = info[kCGWindowNumber as String] as? Int
            let layer = info[kCGWindowLayer as String] as? Int
            let isVisible = onScreen && alpha > 0 && frame.width > 0 && frame.height > 0
            return [
                "window_number": windowNumber ?? -1,
                "owner_pid": actualOwnerPID,
                "owner_name": info[kCGWindowOwnerName as String] as? String ?? "",
                "name": info[kCGWindowName as String] as? String ?? "",
                "actual_frame": frameDictionary(frame),
                "window_layer": layer ?? 0,
                "alpha": alpha,
                "on_screen": onScreen,
                "visible": isVisible,
                "front_to_back_index": index,
                "display_relationship": displayRelationships(for: frame),
                "focus": [
                    "is_key_window": NSApp.keyWindow?.windowNumber == windowNumber,
                    "source": "NSApp.keyWindow for registered daemon process windows; unavailable for unrelated native windows",
                ],
            ] as [String: Any]
        }
    }

    private func testFixtureNativeWindowServerEntries() -> [[String: Any]] {
        guard let raw = ProcessInfo.processInfo.environment["AOS_TEST_VISIBLE_SURFACE_AUDIT_NATIVE_WINDOWS_JSON"],
              let data = raw.data(using: .utf8),
              let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return rows
    }

    private func externalAOSNativeWindows(from nativeWindows: [[String: Any]], currentPID: Int) -> [[String: Any]] {
        let staleDaemonPIDs = Set(aosCleanStaleDaemonCandidatePIDs(currentPID: currentPID))
        let candidates = nativeWindows.filter { native in
            guard let ownerPID = native["owner_pid"] as? Int, ownerPID != currentPID else { return false }
            guard (native["visible"] as? Bool) == true, (native["on_screen"] as? Bool) == true else { return false }
            return isCheapExternalAOSWindowCandidate(native: native, staleDaemonPIDs: staleDaemonPIDs)
        }
        let commandLines = processCommandLines(pids: Set(candidates.compactMap { $0["owner_pid"] as? Int }))
        let processIdentities = Dictionary(uniqueKeysWithValues: Set(candidates.compactMap { $0["owner_pid"] as? Int }).map { pid in
            (pid, externalAOSProcessIdentity(pid: pid, commandLine: commandLines[pid]))
        })

        return candidates.compactMap { native in
            guard let ownerPID = native["owner_pid"] as? Int,
                  let processIdentity = processIdentities[ownerPID],
                  isExternalAOSWindowCandidate(native: native, processIdentity: processIdentity, staleDaemonPIDs: staleDaemonPIDs) else { return nil }

            var row = native
            let classification = externalAOSWindowClassification(
                processIdentity: processIdentity,
                appearsInStaleDaemonModel: staleDaemonPIDs.contains(ownerPID)
            )
            row["classification"] = classification
            row["process_identity"] = processIdentity
            row["appears_in_aos_clean_stale_daemons"] = staleDaemonPIDs.contains(ownerPID)
            row["current_daemon_pid"] = currentPID
            row["scope"] = "external_process"
            row["reason"] = "visible on-screen AOS-owned native window is not owned by current daemon process"
            return row
        }
        .sorted { (($0["front_to_back_index"] as? Int) ?? Int.max) < (($1["front_to_back_index"] as? Int) ?? Int.max) }
    }

    private func isCheapExternalAOSWindowCandidate(
        native: [String: Any],
        staleDaemonPIDs: Set<Int>
    ) -> Bool {
        if let ownerPID = native["owner_pid"] as? Int, staleDaemonPIDs.contains(ownerPID) { return true }
        let ownerName = ((native["owner_name"] as? String) ?? "").lowercased()
        if ownerName == "aos" || ownerName == "agent-os" || ownerName.contains("aos") { return true }
        if let ownerPID = native["owner_pid"] as? Int,
           let runningApp = NSRunningApplication(processIdentifier: pid_t(ownerPID)) {
            let executablePath = runningApp.executableURL?.path.lowercased() ?? ""
            let bundlePath = runningApp.bundleURL?.path.lowercased() ?? ""
            return executablePath.hasSuffix("/aos") || bundlePath.contains("/aos.app/")
        }
        return false
    }

    private func isExternalAOSWindowCandidate(
        native: [String: Any],
        processIdentity: [String: Any],
        staleDaemonPIDs: Set<Int>
    ) -> Bool {
        if let ownerPID = native["owner_pid"] as? Int, staleDaemonPIDs.contains(ownerPID) { return true }
        let ownerName = ((native["owner_name"] as? String) ?? "").lowercased()
        let executablePath = ((processIdentity["executable_path"] as? String) ?? "").lowercased()
        let commandLine = ((processIdentity["command_line"] as? String) ?? "").lowercased()
        return ownerName == "aos"
            || ownerName == "agent-os"
            || ownerName.contains("aos")
            || executablePath.hasSuffix("/aos")
            || executablePath.contains("/aos.app/")
            || commandLine.contains("/aos serve")
            || commandLine.contains("/aos __serve")
            || commandLine.contains("aos serve")
            || commandLine.contains("aos __serve")
    }

    private func externalAOSWindowClassification(
        processIdentity: [String: Any],
        appearsInStaleDaemonModel: Bool
    ) -> String {
        if appearsInStaleDaemonModel { return "stale_aos_daemon_window" }
        if (processIdentity["runtime_mode"] as? String) == "installed" { return "installed_mode_window" }
        let commandLine = ((processIdentity["command_line"] as? String) ?? "").lowercased()
        if commandLine.contains(" serve") || commandLine.contains(" __serve") {
            return "external_aos_daemon_window"
        }
        return "unknown_aos_runtime_window"
    }

    private func externalAOSProcessIdentity(pid: Int, commandLine: String?) -> [String: Any] {
        let runningApp = NSRunningApplication(processIdentifier: pid_t(pid))
        let executablePath = runningApp?.executableURL?.path
        let bundlePath = runningApp?.bundleURL?.path
        let inferredMode = inferAOSRuntimeMode(executablePath: executablePath, bundlePath: bundlePath, commandLine: commandLine)
        let worktreeRoot = inferProcessWorktreeRoot(executablePath: executablePath, commandLine: commandLine)
        var row: [String: Any] = [
            "pid": pid,
            "owner_name": runningApp?.localizedName ?? NSNull(),
            "executable_path": executablePath ?? NSNull(),
            "executable_path_unavailable_reason": executablePath == nil ? "NSRunningApplication did not expose executableURL for PID \(pid)" : NSNull(),
            "bundle_path": bundlePath ?? NSNull(),
            "bundle_path_unavailable_reason": bundlePath == nil ? "NSRunningApplication did not expose bundleURL for PID \(pid)" : NSNull(),
            "command_line": commandLine ?? NSNull(),
            "command_line_unavailable_reason": commandLine == nil ? "ps did not return command line for PID \(pid)" : NSNull(),
            "runtime_mode": inferredMode ?? NSNull(),
            "runtime_mode_unavailable_reason": inferredMode == nil ? "runtime mode was not inferable from executable path or command line" : NSNull(),
            "state_root": NSNull(),
            "state_root_unavailable_reason": "not available from native window-server or process command-line metadata",
            "socket_path": NSNull(),
            "socket_path_unavailable_reason": "not available from native window-server or process command-line metadata",
            "worktree_root": worktreeRoot ?? NSNull(),
            "worktree_root_unavailable_reason": worktreeRoot == nil ? "no enclosing git worktree could be inferred from executable path or command line" : NSNull(),
            "branch": NSNull(),
            "branch_unavailable_reason": "git branch lookup is not run in the live audit fast path" as Any,
            "repo_git_commit": NSNull(),
            "repo_git_commit_unavailable_reason": "git commit lookup is not run in the live audit fast path" as Any,
        ]
        if worktreeRoot == nil {
            row["branch_unavailable_reason"] = "no worktree root available"
            row["repo_git_commit_unavailable_reason"] = "no worktree root available"
        }
        return row
    }

    private func inferAOSRuntimeMode(executablePath: String?, bundlePath: String?, commandLine: String?) -> String? {
        let haystack = [executablePath, bundlePath, commandLine]
            .compactMap { $0?.lowercased() }
            .joined(separator: " ")
        if haystack.contains("aos_runtime_mode=installed") || haystack.contains("/applications/aos.app/") {
            return "installed"
        }
        if haystack.contains("aos_runtime_mode=repo") || haystack.contains("/code/agent-os/aos") || haystack.contains("/agent-os/aos") {
            return "repo"
        }
        return nil
    }

    private func inferProcessWorktreeRoot(executablePath: String?, commandLine: String?) -> String? {
        var bases: [String] = []
        if let executablePath {
            bases.append(URL(fileURLWithPath: executablePath).deletingLastPathComponent().path)
        }
        if let commandLine {
            for token in commandLine.split(separator: " ") {
                let value = String(token)
                if value.hasPrefix("/") {
                    bases.append(URL(fileURLWithPath: value).deletingLastPathComponent().path)
                }
            }
        }
        return aosRepoRootFromBases(bases)
    }

    private func processCommandLines(pids: Set<Int>) -> [Int: String] {
        let sortedPIDs = pids.sorted()
        guard !sortedPIDs.isEmpty else { return [:] }
        let output = runProcess("/bin/ps", arguments: ["-p", sortedPIDs.map(String.init).joined(separator: ","), "-o", "pid=,args="])
        guard output.exitCode == 0 else { return [:] }
        var rows: [Int: String] = [:]
        for rawLine in output.stdout.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard let firstSpace = line.firstIndex(where: { $0 == " " || $0 == "\t" }) else { continue }
            let pidText = line[..<firstSpace].trimmingCharacters(in: .whitespaces)
            guard let pid = Int(pidText) else { continue }
            let commandLine = line[firstSpace...].trimmingCharacters(in: .whitespaces)
            if !commandLine.isEmpty {
                rows[pid] = commandLine
            }
        }
        return rows
    }

    private func aosCleanStaleDaemonCandidatePIDs(currentPID: Int) -> [Int] {
        let output = runProcess("/usr/bin/pgrep", arguments: ["-f", "aos (serve|__serve)"])
        guard output.exitCode == 0 else { return [] }
        return output.stdout
            .split(whereSeparator: \.isNewline)
            .compactMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .filter { $0 != currentPID }
    }

    private func numberValue(_ value: Any?) -> CGFloat? {
        if let value = value as? CGFloat { return value }
        if let value = value as? Double { return CGFloat(value) }
        if let value = value as? Int { return CGFloat(value) }
        if let value = value as? NSNumber { return CGFloat(truncating: value) }
        return nil
    }

    private func logicalSurfaceKey(from metadata: [String: JSONValue]?) -> String? {
        guard let value = metadata?["logical_surface_key"] else { return nil }
        guard case .string(let raw) = value else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func inputTargetWinner(
        at point: CGPoint,
        nativeWindows: [[String: Any]],
        externalAOSWindows: [[String: Any]],
        registeredInfos: [CanvasInfo]
    ) -> [String: Any] {
        let byWindowNumber: [Int: CanvasInfo] = Dictionary(
            registeredInfos.flatMap { info in
                (info.windowNumbers ?? []).map { ($0, info) }
            },
            uniquingKeysWith: { first, _ in first }
        )
        let externalByWindowNumber: [Int: [String: Any]] = Dictionary(
            uniqueKeysWithValues: externalAOSWindows.compactMap { native in
                guard let windowNumber = native["window_number"] as? Int else { return nil }
                return (windowNumber, native)
            }
        )

        let frontToBackWindows = (nativeWindows + externalAOSWindows)
            .sorted { (($0["front_to_back_index"] as? Int) ?? Int.max) < (($1["front_to_back_index"] as? Int) ?? Int.max) }

        for native in frontToBackWindows {
            guard let frameDict = native["actual_frame"] as? [String: Any],
                  let x = numberValue(frameDict["x"]),
                  let y = numberValue(frameDict["y"]),
                  let w = numberValue(frameDict["w"]),
                  let h = numberValue(frameDict["h"]) else { continue }
            let frame = CGRect(x: x, y: y, width: w, height: h)
            guard frame.contains(point), (native["visible"] as? Bool) == true else { continue }
            let windowNumber = native["window_number"] as? Int ?? -1
            if let external = externalByWindowNumber[windowNumber] {
                return [
                    "status": "external_aos_native_window",
                    "scope": "external_process",
                    "window_number": windowNumber,
                    "owner_pid": external["owner_pid"] ?? NSNull(),
                    "classification": external["classification"] ?? "unknown_aos_runtime_window",
                    "native": external,
                    "process_identity": external["process_identity"] ?? NSNull(),
                    "reason": "frontmost visible AOS-owned native window at point is owned by another process",
                ] as [String: Any]
            }
            if let info = byWindowNumber[windowNumber] {
                return [
                    "status": info.interactive && info.suspended != true ? "matched_registered_surface" : "matched_noninteractive_or_suspended_surface",
                    "canvas_id": info.id,
                    "window_number": windowNumber,
                    "interactive": info.interactive,
                    "suspended": info.suspended ?? false,
                    "lifecycleState": info.lifecycleState ?? "unknown",
                    "window_level": info.windowLevel ?? "default",
                    "native": native,
                    "reason": "first visible daemon-owned native window containing point in CGWindowList front-to-back order",
                ] as [String: Any]
            }
            return [
                "status": "orphan_native_window",
                "window_number": windowNumber,
                "native": native,
                "reason": "frontmost visible daemon-owned native window at point is not joined to a registered canvas",
            ] as [String: Any]
        }

        return [
            "status": "none",
            "reason": "no visible daemon-owned native window contains point",
        ]
    }

    private func geometryChange(from previous: CGRect, to next: CGRect) -> String {
        let originChanged = abs(previous.origin.x - next.origin.x) > 0.5 || abs(previous.origin.y - next.origin.y) > 0.5
        let sizeChanged = abs(previous.size.width - next.size.width) > 0.5 || abs(previous.size.height - next.size.height) > 0.5
        if originChanged && sizeChanged { return "frame" }
        if sizeChanged { return "size" }
        return "origin"
    }

    private func geometryContext(
        change: String? = nil,
        cause: String? = nil,
        phase: String? = nil,
        transactionID: String? = nil,
        metadata: [String: JSONValue]? = nil
    ) -> [String: Any] {
        var context: [String: Any] = [
            "change": change ?? "frame",
            "cause": cause ?? "unknown",
            "phase": phase ?? "settled",
            "transaction_id": transactionID ?? UUID().uuidString,
        ]
        if let metadata {
            for (key, value) in metadata {
                context[key] = value
            }
        }
        return context
    }

    private func emitGeometry(_ canvas: CanvasLike, previousFrame: CGRect?, currentFrame: CGRect, context: [String: Any]) {
        let info = canvas.toInfo()
        var canvasPayload: [String: Any] = [
            "id": info.id,
            "at": info.at,
            "interactive": info.interactive,
        ]
        if let parent = info.parent { canvasPayload["parent"] = parent }
        if let track = info.track { canvasPayload["track"] = track }
        if let scope = info.scope { canvasPayload["scope"] = scope }
        if let lifecycleState = info.lifecycleState { canvasPayload["lifecycle_state"] = lifecycleState }
        if let windowLevel = info.windowLevel { canvasPayload["window_level"] = windowLevel }
        if let windowNumbers = info.windowNumbers { canvasPayload["windowNumbers"] = windowNumbers }
        if let segments = info.segments {
            canvasPayload["segments"] = segments.map { segment in
                [
                    "display_id": Int(segment.displayID),
                    "index": segment.index,
                    "dw_bounds": segment.dwBounds,
                    "native_bounds": segment.nativeBounds,
                ] as [String: Any]
            }
        }

        var payload: [String: Any] = [
            "canvas_id": info.id,
            "change": context["change"] as? String ?? (previousFrame.map { geometryChange(from: $0, to: currentFrame) } ?? "frame"),
            "cause": context["cause"] as? String ?? "unknown",
            "phase": context["phase"] as? String ?? "settled",
            "transaction_id": context["transaction_id"] as? String ?? UUID().uuidString,
            "frame": frameArray(currentFrame),
            "at": frameArray(currentFrame),
            "canvas": canvasPayload,
        ]
        if let placement = context["placement"] as? [String: JSONValue] {
            payload["placement"] = jsonDictionary(placement)
        }
        if let previousFrame {
            payload["previous_frame"] = frameArray(previousFrame)
        }
        onCanvasGeometry?(payload)
    }

    @discardableResult
    private func moveCanvas(
        _ canvas: CanvasLike,
        to cgRect: CGRect,
        geometry context: [String: Any]? = nil,
        emitCompatibilityLifecycle: Bool = false
    ) -> Bool {
        let current = canvas.cgFrame
        guard framesDiffer(current, cgRect) else { return false }
        canvas.updatePosition(cgRect: cgRect)
        let resolvedContext = context ?? geometryContext(
            change: geometryChange(from: current, to: cgRect),
            cause: "unknown",
            phase: "settled"
        )
        emitGeometry(canvas, previousFrame: current, currentFrame: canvas.cgFrame, context: resolvedContext)
        if emitCompatibilityLifecycle || ((resolvedContext["phase"] as? String) == "settled") {
            emitLifecycle(canvas, action: "updated")
        }
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
            topologySettledPayload(
                canvasID: surface.id,
                segments: delta.settled,
                canvasGeneration: surface.lifecycleGeneration,
                topologyGeneration: surface.topologyGeneration
            )
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

    func topologySettledPayload(
        canvasID: String,
        segments: [DesktopWorldSurfaceSegment],
        canvasGeneration: UInt64? = nil,
        topologyGeneration: UInt64? = nil
    ) -> [String: Any] {
        var payload: [String: Any] = [
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
        if let canvasGeneration { payload["canvas_generation"] = canvasGeneration }
        if let topologyGeneration { payload["topology_generation"] = topologyGeneration }
        return payload
    }

    /// Expose a canvas for external callers (daemon layer) that need to set parent.
    func canvas(forID id: String) -> CanvasLike? { canvases[id] }

    func desktopWorldSceneBarrierTopology(canvasID: String) -> DesktopWorldSceneBarrierTopology? {
        let read = { [weak self] in
            (self?.canvases[canvasID] as? DesktopWorldSurfaceCanvas)?.sceneBarrierTopology()
        }
        return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    }

    /// Delivers only to the exact stage and topology generation captured by a
    /// scene barrier. A same-ID replacement or topology rebuild is never used
    /// as an implicit target.
    @discardableResult
    func postMessageToDesktopWorldSceneStage(
        _ topology: DesktopWorldSceneBarrierTopology,
        canvasID: String,
        payload: Any
    ) -> Bool {
        let post = { [weak self] () -> Bool in
            guard let self,
                  let surface = self.canvases[canvasID] as? DesktopWorldSurfaceCanvas,
                  surface.lifecycleGeneration == topology.canvasGeneration,
                  surface.topologyGeneration == topology.generation,
                  surface.sceneBarrierTopology() == topology else { return false }
            return self.postMessage(
                for: CanvasLifecycleGeneration(canvasID: canvasID, value: topology.canvasGeneration),
                payload: payload
            ).status == "success"
        }
        return Thread.isMainThread ? post() : DispatchQueue.main.sync(execute: post)
    }

    func retireDesktopWorldSceneStageAsync(
        canvasID: String,
        canvasGeneration: UInt64,
        topologyGeneration: UInt64,
        completion: ((AOSDesktopWorldSceneStageRetirementOutcome) -> Void)? = nil
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                completion?(.failed)
                return
            }
            guard let surface = self.canvases[canvasID] as? DesktopWorldSurfaceCanvas else {
                completion?(.alreadyAbsent)
                return
            }
            guard surface.lifecycleGeneration == canvasGeneration,
                  surface.topologyGeneration == topologyGeneration else {
                completion?(.superseded)
                return
            }
            completion?(self.retireCanvas(id: canvasID) == nil ? .failed : .retired)
        }
    }

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

    private func statusMenuItems(from dict: [String: Any]) -> [[String: Any]]? {
        let payload = dict["payload"] as? [String: Any]
        let rawItems = dict["items"] ?? payload?["items"]
        if let items = rawItems as? [[String: Any]] {
            return items
        }
        if let items = rawItems as? [[String: String]] {
            return items.map { item in item.mapValues { $0 as Any } }
        }
        return nil
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
                } else if moveCanvas(canvas, to: unionBounds, geometry: geometryContext(
                    change: "frame",
                    cause: "display.topology",
                    phase: "settled"
                )) {
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
        _ = retireCanvas(id: id)
    }

    /// Remove all connection-scoped canvases owned by the given connection.
    func cleanupConnection(_ connectionID: UUID) {
        let toRemove = canvases.values
            .filter { $0.connectionID == connectionID && $0.scope == "connection" }
            .map { $0.id }
        for id in toRemove {
            _ = retireCanvas(id: id, notifyCountChanged: false)
        }
        if !toRemove.isEmpty {
            if !hasAnchoredCanvases { stopAnchorPolling() }
            onCanvasCountChanged?()
        }
    }

    func handle(_ request: CanvasRequest, connectionID: UUID = UUID()) -> CanvasResponse {
        // The daemon's AppKit run loop is long-lived; keep command-created
        // Objective-C temporaries inside the command transaction.
        autoreleasepool {
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
        let creationFrame: CGRect?
        if isDesktopWorldSurface {
            let bounds = allDisplaysBounds()
            guard bounds.width > 0, bounds.height > 0 else {
                return .fail("desktop-world surface requires at least one connected display", code: "NO_DISPLAYS")
            }
            creationFrame = nil
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
            creationFrame = cgFrame
        }

        let contentHTML: String?
        let contentURL: String?
        if let mode = autoMode, let channelData {
            contentHTML = generateAutoProjectHTML(mode: mode, channelData: channelData)
            contentURL = nil
        } else if let mode = autoMode, mode == "cursor_trail" {
            contentHTML = generateAutoProjectHTML(mode: mode, channelData: nil)
            contentURL = nil
        } else if let html = req.html {
            contentHTML = html
            contentURL = nil
        } else if let url = req.url {
            guard URL(string: url) != nil else {
                return .fail("create requires a valid --url", code: "INVALID_URL")
            }
            contentHTML = nil
            contentURL = url
        } else {
            return .fail("create requires --html, --file, --url, --auto-project, or stdin content", code: "NO_CONTENT")
        }

        let explicitParentCanvas: CanvasLike?
        if let explicitParent = req.parent {
            guard let parentCanvas = canvases[explicitParent] else {
                return .fail("Parent canvas '\(explicitParent)' not found", code: "PARENT_NOT_FOUND")
            }
            explicitParentCanvas = parentCanvas
        } else {
            explicitParentCanvas = nil
        }

        let cascadeFromParent = req.cascade ?? true
        let bornSuspended = req.suspended == true ||
            (cascadeFromParent && explicitParentCanvas?.suspended == true)

        let canvas: CanvasLike
        if isDesktopWorldSurface {
            let surface = DesktopWorldSurfaceCanvas(
                id: id,
                interactive: interactive,
                windowLevel: windowLevel,
                aosSchemeHandler: aosSchemeHandler,
                sceneExtensionSchemeHandler: sceneExtensionSchemeHandler,
                lifecycleCoordinator: lifecycleCoordinator
            )
            surface.trackTarget = .union
            canvas = surface
        } else {
            guard let creationFrame else {
                preconditionFailure("validated window canvas is missing its creation frame")
            }
            let single = Canvas(
                id: id,
                cgFrame: creationFrame,
                interactive: interactive,
                windowLevel: windowLevel,
                aosSchemeHandler: aosSchemeHandler
            )
            single.trackTarget = trackTarget
            canvas = single
        }

        canvas.lifecycleState = "creating"
        let generation = lifecycleCoordinator.issueGeneration(for: canvas)
        canvases[id] = canvas
        var creationCommitted = false
        defer {
            if !creationCommitted {
                _ = retireCanvas(id: id, emitLifecycle: false, notifyCountChanged: false)
            }
        }

        canvas.cascadeFromParent = cascadeFromParent
        canvas.owner = req.owner
        if let logicalSurfaceKey = logicalSurfaceKey(from: req.geometry) {
            canvas.logicalSurfaceKey = logicalSurfaceKey
        }
        if let explicitParent = req.parent, let parentCanvas = explicitParentCanvas {
            canvas.parent = explicitParent
            if canvas.owner == nil {
                canvas.owner = parentCanvas.owner
            }
        }
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
            guard let canvas = self?.currentCanvas(for: generation) else { return }
            // Handle close before the type guard — close uses {action: "close"}
            if let dict = body as? [String: Any],
               (dict["action"] as? String) == "close" || (dict["type"] as? String) == "close" {
                self?.enqueue(for: generation) { manager, _ in
                    _ = manager.handleRemove(CanvasRequest(action: "remove", id: id))
                }
                return
            }

            if let dict = body as? [String: Any],
               let type = dict["type"] as? String {
                let messagePayload = dict["payload"] as? [String: Any]

                if type == "lifecycle.complete" {
                    let action = (messagePayload?["action"] as? String)
                        ?? (messagePayload?["reason"] as? String)
                        ?? ""
                    self?.lifecycleCompletions.receive(generation, action: action)
                    return
                }
                if type == "lifecycle.ready" {
                    self?.lifecycleCompletions.receive(generation, action: "resume")
                    self?.onEvent?(generation, body)
                    return
                }

                func messageString(_ key: String) -> String? {
                    (dict[key] as? String) ?? (messagePayload?[key] as? String)
                }

                if type == "move_abs",
                   let _ = dict["screenX"] as? Double,
                   let _ = dict["screenY"] as? Double,
                   let offsetX = dict["offsetX"] as? Double,
                   let offsetY = dict["offsetY"] as? Double {
                    let change = messageString("geometry_change")
                    let cause = messageString("geometry_cause")
                    let phase = messageString("geometry_phase")
                    let transactionID = messageString("geometry_transaction_id")
                    self?.enqueue(for: generation) { manager, canvas in
                        let mouse = mouseInCGCoords()
                        let cgMouseX = mouse.x
                        let cgMouseY = mouse.y
                        let newX = cgMouseX - CGFloat(offsetX)
                        let newY = cgMouseY - CGFloat(offsetY)
                        let cg = canvas.cgFrame

                        // No display-snap: let the canvas straddle displays freely,
                        // same as the renderer animation path. updatePosition's retry
                        // logic handles any single-frame OS rejection at boundaries.
                        manager.moveCanvas(canvas, to: CGRect(x: newX, y: newY, width: cg.width, height: cg.height), geometry: manager.geometryContext(
                            change: change,
                            cause: cause ?? "placement.drag",
                            phase: phase ?? "update",
                            transactionID: transactionID
                        ))
                    }
                    return
                }

                // Legacy relative move (for backward compat)
                if type == "move",
                   let dx = dict["dx"] as? Double,
                   let dy = dict["dy"] as? Double {
                    self?.enqueue(for: generation) { manager, canvas in
                        var cg = canvas.cgFrame
                        cg.origin.x += CGFloat(dx)
                        cg.origin.y += CGFloat(dy)
                        manager.moveCanvas(canvas, to: cg, geometry: manager.geometryContext(
                            change: "origin",
                            cause: "unknown",
                            phase: "settled"
                        ))
                    }
                    return
                }

                if type == "drag_start" {
                    let transactionID = messageString("geometry_transaction_id") ?? UUID().uuidString
                    self?.enqueue(for: generation) { manager, canvas in
                        ((canvas as? Canvas)?.window as? CanvasWindow)?.isActivelyDraggingCanvas = true
                        let context = manager.geometryContext(
                            change: messageString("geometry_change") ?? "origin",
                            cause: messageString("geometry_cause") ?? "placement.drag",
                            phase: "start",
                            transactionID: transactionID
                        )
                        manager.activeGeometryTransactions[id] = context
                        manager.emitGeometry(canvas, previousFrame: nil, currentFrame: canvas.cgFrame, context: context)
                    }
                    return
                }

                if type == "drag_end" {
                    let transactionID = messageString("geometry_transaction_id")
                    self?.enqueue(for: generation) { manager, canvas in
                        ((canvas as? Canvas)?.window as? CanvasWindow)?.isActivelyDraggingCanvas = false
                        canvas.finalizeDragPosition()
                        let existing = manager.activeGeometryTransactions.removeValue(forKey: id)
                        let context = manager.geometryContext(
                            change: messageString("geometry_change") ?? existing?["change"] as? String ?? "origin",
                            cause: messageString("geometry_cause") ?? existing?["cause"] as? String ?? "placement.drag",
                            phase: messageString("geometry_phase") ?? "settled",
                            transactionID: transactionID ?? existing?["transaction_id"] as? String
                        )
                        manager.emitGeometry(canvas, previousFrame: nil, currentFrame: canvas.cgFrame, context: context)
                        manager.emitLifecycle(canvas, action: "updated")
                    }
                    return
                }

                if type == "resize_start" {
                    let transactionID = messageString("geometry_transaction_id") ?? UUID().uuidString
                    self?.enqueue(for: generation) { manager, canvas in
                        let context = manager.geometryContext(
                            change: messageString("geometry_change") ?? "frame",
                            cause: messageString("geometry_cause") ?? "resize.drag",
                            phase: "start",
                            transactionID: transactionID
                        )
                        manager.activeGeometryTransactions[id] = context
                        manager.emitGeometry(canvas, previousFrame: nil, currentFrame: canvas.cgFrame, context: context)
                    }
                    return
                }

                if type == "resize_end" {
                    let transactionID = messageString("geometry_transaction_id")
                    self?.enqueue(for: generation) { manager, canvas in
                        let existing = manager.activeGeometryTransactions.removeValue(forKey: id)
                        let context = manager.geometryContext(
                            change: messageString("geometry_change") ?? existing?["change"] as? String ?? "frame",
                            cause: messageString("geometry_cause") ?? existing?["cause"] as? String ?? "resize.drag",
                            phase: messageString("geometry_phase") ?? "settled",
                            transactionID: transactionID ?? existing?["transaction_id"] as? String
                        )
                        manager.emitGeometry(canvas, previousFrame: nil, currentFrame: canvas.cgFrame, context: context)
                        manager.emitLifecycle(canvas, action: "updated")
                    }
                    return
                }

                // Page signaled it's loaded. If the canvas was created with
                // --focus, tell the page to focus its input field. One-shot:
                // clear the flag so we don't re-focus on subsequent ready
                // emits (the page can re-emit after navigation).
                if type == "ready" && canvas.focusOnReady {
                    canvas.focusOnReady = false
                    self?.enqueue(for: generation) { _, canvas in
                        canvas.evaluateJavaScript("typeof focusInput === 'function' && focusInput()", completion: nil)
                    }
                    // fall through to relay
                }

                // Config IPC: read/write daemon config from canvas JS
                if type == "get_config" {
                    self?.enqueue(for: generation) { _, canvas in
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
                    self?.enqueue(for: generation) { _, canvas in
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
                    self?.enqueue(for: generation) { manager, canvas in
                        let cg = canvas.cgFrame
                        let cx = cg.origin.x + cg.size.width / 2
                        let cy = cg.origin.y + cg.size.height / 2
                        let newFrame = CGRect(
                            x: cx - CGFloat(w) / 2,
                            y: cy - CGFloat(h) / 2,
                            width: CGFloat(w),
                            height: CGFloat(h)
                        )
                        manager.moveCanvas(canvas, to: newFrame)
                    }
                    return
                }

                // Canvas-provided menu items for the status bar right-click menu.
                // { type: "set_menu_items", payload: {items: [{title: "...", id: "..."}]} }
                if type == "set_menu_items",
                   let rawItems = self?.statusMenuItems(from: dict) {
                    self?.onMenuItems?(id, rawItems)
                    return
                }
            }
            self?.onEvent?(generation, body)
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

        if let html = contentHTML {
            canvas.loadHTML(html)
        } else if let url = contentURL {
            canvas.loadURL(url)
        } else {
            preconditionFailure("validated canvas content is missing")
        }

        canvas.setInputPassthrough(inputPassthroughOverride)
        canvas.lifecycleState = bornSuspended ? "warm_suspended" : "active"

        if !bornSuspended {
            canvas.show()
            if req.focus == true && interactive {
                canvas.grabFocus()
            }
        }

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl)
        }

        if hasAnchoredCanvases || autoMode != nil { startAnchorPolling() }

        creationCommitted = true
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

        if let placement = req.geometry?["placement"]?.objectValue {
            canvas.placement = placement
        }
        if let logicalSurfaceKey = logicalSurfaceKey(from: req.geometry) {
            canvas.logicalSurfaceKey = logicalSurfaceKey
        }

        if let at = req.at, at.count == 4 {
            let newFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
            if moveCanvas(canvas, to: newFrame, geometry: geometryContext(
                change: req.geometryChange,
                cause: req.geometryCause,
                phase: req.geometryPhase,
                transactionID: req.geometryTransactionID,
                metadata: req.geometry
            )) {
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
                    if moveCanvas(canvas, to: bounds, geometry: geometryContext(
                        change: "frame",
                        cause: "track.retarget",
                        phase: "settled"
                    )) {
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
                moveCanvas(canvas, to: newFrame, geometry: geometryContext(change: "frame", cause: "anchor.follow", phase: "settled"))
            } else {
                canvas.offset = CGRect(x: 0, y: 0, width: winBounds.width, height: winBounds.height)
                moveCanvas(canvas, to: winBounds, geometry: geometryContext(change: "frame", cause: "anchor.follow", phase: "settled"))
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
                moveCanvas(canvas, to: newFrame, geometry: geometryContext(change: "frame", cause: "anchor.follow", phase: "settled"))
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
                single.setInputPassthrough(inputPassthroughOverride)
                // The CanvasWindow reads isInteractiveCanvas to decide canBecomeKey
                // and whether sendEvent should activate on first click. Without
                // updating it, flipped-to-interactive canvases can receive mouse
                // events but never become key window, so keyboard input bounces
                // back to the previously-active app (system bonk on every keystroke).
                // NOTE: the WKWebView subclass (CanvasWebView vs plain WKWebView)
                // is chosen at construction time and cannot be swapped at runtime.
                // The only behavioral difference is acceptsFirstMouse, which only
                // affects the first-click-starts-drag ergonomic. A flipped canvas
                // may require one extra click to activate; recreate the canvas with
                // --interactive at creation time for full first-mouse behavior.
            } else {
                canvas.setInputPassthrough(inputPassthroughOverride)
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
            enqueue(for: lease(for: canvas)) { _, canvas in
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
        guard retireCanvas(id: id) != nil else {
            return .fail("Canvas '\(id)' not found", code: "NOT_FOUND")
        }
        return .ok()
    }

    private func handleRemoveAll() -> CanvasResponse {
        let removedIDs = Array(canvases.keys)
        for id in removedIDs {
            _ = retireCanvas(id: id, notifyCountChanged: false)
        }
        stopAnchorPolling()
        if !removedIDs.isEmpty { onCanvasCountChanged?() }
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

    private func headsupEvalJS(forBase64 b64: String) -> String {
        "window.headsup && window.headsup.receive && window.headsup.receive(\(jsStringLiteral(b64)))"
    }

    private func postMessage(
        for generation: CanvasLifecycleGeneration,
        payload: Any
    ) -> CanvasResponse {
        guard let canvas = currentCanvas(for: generation) else {
            return .fail("Canvas '\(generation.canvasID)' not found", code: "NOT_FOUND")
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let json = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let payloadStr = String(data: json, encoding: .utf8) else {
            return .fail("post payload must be valid JSON", code: "INVALID_JSON")
        }
        let b64 = Data(payloadStr.utf8).base64EncodedString()
        canvas.evaluateJavaScript(headsupEvalJS(forBase64: b64), completion: nil)
        return .ok()
    }

    @discardableResult
    func postMessage(canvasID: String, payload: Any) -> CanvasResponse {
        guard let canvas = canvases[canvasID] else {
            return .fail("Canvas '\(canvasID)' not found", code: "NOT_FOUND")
        }
        return postMessage(for: lease(for: canvas), payload: payload)
    }

    func postMessageToCurrentCanvasAsync(canvasID: String, payload: Any) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let canvas = self.canvases[canvasID] else { return }
            _ = self.postMessage(for: self.lease(for: canvas), payload: payload)
        }
    }

    func postMessageAsync(
        to generation: CanvasLifecycleGeneration,
        payload: Any
    ) {
        enqueue(for: generation) { manager, _ in
            _ = manager.postMessage(for: generation, payload: payload)
        }
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
        var suspendedGenerations: [CanvasLifecycleGeneration] = []
        for cid in tree {
            guard let c = canvases[cid] else { continue }
            suspendedGenerations.append(lease(for: c))
            c.orderOut()
            c.suspended = true
            c.lifecycleState = c.lifecycleState == "warm_suspended" ? "warm_suspended" : "suspended"
            emitLifecycle(c, action: "updated")
        }

        // Phase 2: notify renderers (async, best-effort, no ACK needed)
        for generation in suspendedGenerations {
            postMessageAsync(to: generation, payload: ["type": "lifecycle", "action": "suspend"])
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
        let suspendedGenerations = tree.compactMap { cid -> CanvasLifecycleGeneration? in
            guard let canvas = canvases[cid], canvas.suspended else { return nil }
            return lease(for: canvas)
        }

        let showWindows: () -> Void = { [weak self] in
            guard let self = self else { return }
            // Phase 2: atomic show
            for generation in suspendedGenerations {
                guard let c = self.currentCanvas(for: generation) else { continue }
                c.show()
                c.suspended = false
                c.lifecycleState = "active"
                self.emitLifecycle(c, action: "updated")
            }
            self.onCanvasCountChanged?()
        }

        _ = lifecycleCompletions.await(
            generations: Set(suspendedGenerations),
            action: "resume",
            timeout: 1.0
        ) { completed in
            if !completed {
                fputs("[canvas] resume lifecycle ACK timeout; showing windows anyway\n", stderr)
            }
            showWindows()
        }

        // Send lifecycle:resume to each renderer
        for generation in suspendedGenerations {
            postMessageAsync(to: generation, payload: ["type": "lifecycle", "action": "resume"])
        }

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
            moveCanvas(canvas, to: newFrame, geometry: geometryContext(
                change: "frame",
                cause: "anchor.follow",
                phase: "update"
            ))
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
