import AppKit
import Foundation
import WebKit

protocol CanvasLike: CanvasNativeRetirable {
    var id: String { get }
    var isInteractive: Bool { get set }
    var anchorWindowID: CGWindowID? { get set }
    var anchorChannelID: String? { get set }
    var offset: CGRect? { get set }
    var scope: String { get set }
    var connectionID: UUID? { get set }
    var autoProjectMode: String? { get set }
    var trackTarget: TrackTarget? { get set }
    var windowLevel: String? { get set }
    var focusOnReady: Bool { get set }
    var suspended: Bool { get set }
    var lifecycleState: String { get set }
    var lifecycleGeneration: UInt64 { get set }
    var cascadeFromParent: Bool { get set }
    var parent: String? { get set }
    var owner: CanvasOwnerInfo? { get set }
    var placement: [String: JSONValue]? { get set }
    var logicalSurfaceKey: String? { get set }
    var sourceURL: String? { get }
    var onMessage: ((Any) -> Void)? { get set }
    var onTTLExpired: (() -> Void)? { get set }
    var remainingTTL: Double? { get }
    var cgFrame: CGRect { get }
    var windowNumbers: [Int] { get }

    func setTTL(_ seconds: Double?)
    func loadHTML(_ html: String)
    func loadURL(_ urlString: String)
    func show()
    func grabFocus()
    func quiesceForRetirement()
    func finalizeRetirement()
    func updatePosition(cgRect: CGRect)
    func finalizeDragPosition()
    func toInfo() -> CanvasInfo
    func evaluateJavaScript(_ script: String, completion: ((Any?, Error?) -> Void)?)
    func setAlpha(_ alpha: CGFloat)
    func refreshWindowLevel()
    func setInputPassthrough(_ enabled: Bool)
    func orderFront()
    func orderOut()
}

extension CanvasLike {
    var nativeRetirementID: String { id }
}

struct DesktopWorldSurfaceSegment: Codable, Equatable {
    let displayID: UInt32          // CGDirectDisplayID
    let index: Int                 // position in the ordered topology
    let dwBounds: [CGFloat]        // [x, y, w, h] in DesktopWorld coords
    let nativeBounds: [CGFloat]    // [x, y, w, h] in native CG coords

    init(displayID: UInt32, index: Int, dwBounds: [CGFloat], nativeBounds: [CGFloat]) {
        precondition(dwBounds.count == 4,
                     "dwBounds must have exactly 4 elements [x, y, w, h]")
        precondition(nativeBounds.count == 4,
                     "nativeBounds must have exactly 4 elements [x, y, w, h]")
        self.displayID = displayID
        self.index = index
        self.dwBounds = dwBounds
        self.nativeBounds = nativeBounds
    }

    enum CodingKeys: String, CodingKey {
        case displayID = "display_id"
        case index
        case dwBounds = "dw_bounds"
        case nativeBounds = "native_bounds"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let displayID    = try c.decode(UInt32.self,    forKey: .displayID)
        let index        = try c.decode(Int.self,       forKey: .index)
        let dwBounds     = try c.decode([CGFloat].self, forKey: .dwBounds)
        let nativeBounds = try c.decode([CGFloat].self, forKey: .nativeBounds)
        guard dwBounds.count == 4 else {
            throw DecodingError.dataCorruptedError(
                forKey: .dwBounds,
                in: c,
                debugDescription: "dw_bounds must have exactly 4 elements [x, y, w, h]"
            )
        }
        guard nativeBounds.count == 4 else {
            throw DecodingError.dataCorruptedError(
                forKey: .nativeBounds,
                in: c,
                debugDescription: "native_bounds must have exactly 4 elements [x, y, w, h]"
            )
        }
        self.init(displayID: displayID, index: index,
                  dwBounds: dwBounds, nativeBounds: nativeBounds)
    }
}

struct DesktopWorldSceneBarrierTopology: Equatable {
    let canvasGeneration: UInt64
    let generation: UInt64
    let segments: [DesktopWorldSurfaceSegment]
}

/// Orders segments by (dwBounds.y asc, dwBounds.x asc, displayID asc).
/// Total order; always yields a unique first segment when at least one
/// segment exists.
func orderSegments(_ unordered: [DesktopWorldSurfaceSegment]) -> [DesktopWorldSurfaceSegment] {
    let sorted = unordered.sorted { a, b in
        if a.dwBounds[1] != b.dwBounds[1] { return a.dwBounds[1] < b.dwBounds[1] }
        if a.dwBounds[0] != b.dwBounds[0] { return a.dwBounds[0] < b.dwBounds[0] }
        return a.displayID < b.displayID
    }
    return sorted.enumerated().map { (i, s) in
        DesktopWorldSurfaceSegment(displayID: s.displayID, index: i,
                                    dwBounds: s.dwBounds, nativeBounds: s.nativeBounds)
    }
}

final class DesktopWorldSurfaceCanvas: CanvasLike {
    final class Segment: CanvasNativeRetirable {
        let displayID: UInt32
        var index: Int
        var nativeBounds: CGRect
        var dwBounds: CGRect
        let window: CanvasWindow
        let webView: WKWebView
        let messageHandler: CanvasMessageHandler
        let nativeRetirementID: String
        private var retirementQuiesced = false
        private var retirementFinalized = false

        init(displayID: UInt32, index: Int, nativeBounds: CGRect, dwBounds: CGRect,
             window: CanvasWindow, webView: WKWebView, messageHandler: CanvasMessageHandler,
             nativeRetirementID: String) {
            self.displayID = displayID
            self.index = index
            self.nativeBounds = nativeBounds
            self.dwBounds = dwBounds
            self.window = window
            self.webView = webView
            self.messageHandler = messageHandler
            self.nativeRetirementID = nativeRetirementID
        }

        func quiesceForRetirement() {
            precondition(Thread.isMainThread, "segment quiesce must run on the main thread")
            guard !retirementQuiesced else { return }
            retirementQuiesced = true
            messageHandler.onMessage = nil
            window.ignoresMouseEvents = true
            window.isInteractiveCanvas = false
            window.orderOut(nil)
            webView.stopLoading()
        }

        func finalizeRetirement() {
            precondition(Thread.isMainThread, "segment finalization must run on the main thread")
            guard !retirementFinalized else { return }
            retirementFinalized = true
            quiesceForRetirement()
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "headsup")
            webView.navigationDelegate = nil
            webView.uiDelegate = nil
            webView.removeFromSuperview()
            window.contentView = nil
            window.close()
        }
    }

    struct TopologyDelta {
        let added: [DesktopWorldSurfaceSegment]
        let removed: [DesktopWorldSurfaceSegment]
        let changed: [DesktopWorldSurfaceSegment]
        let settled: [DesktopWorldSurfaceSegment]
    }

    let id: String
    var isInteractive: Bool {
        didSet {
            applyMouseEventPolicy()
            applyWindowLevel()
        }
    }
    var anchorWindowID: CGWindowID? = nil
    var anchorChannelID: String? = nil
    var offset: CGRect? = nil
    var scope: String = "global"
    var connectionID: UUID? = nil
    var autoProjectMode: String? = nil
    var trackTarget: TrackTarget? = .union
    var windowLevel: String? {
        didSet { applyWindowLevel() }
    }
    var focusOnReady: Bool = false
    var suspended: Bool = false
    var lifecycleState: String = "active"
    var lifecycleGeneration: UInt64 = 0
    var cascadeFromParent: Bool = true
    var parent: String? = nil
    var owner: CanvasOwnerInfo? = nil
    var placement: [String: JSONValue]? = nil
    var logicalSurfaceKey: String? = nil
    var onTTLExpired: (() -> Void)?
    var onMessage: ((Any) -> Void)? {
        didSet {
            for segment in segments {
                installMessageHandler(for: segment)
            }
        }
    }
    private var ttlTimer: DispatchSourceTimer?
    private var ttlDeadline: Date?
    private let aosSchemeHandler: WKURLSchemeHandler?
    private let sceneExtensionSchemeHandler: WKURLSchemeHandler?
    private let lifecycleCoordinator: CanvasLifecycleCoordinator
    private var htmlContent: String?
    private var urlString: String?
    var sourceURL: String? { urlString }
    private var hasShown = false
    private var inputPassthrough = false
    private var retirementQuiesced = false
    private var retirementFinalized = false
    private(set) var segments: [Segment] = []
    private(set) var lastDelta: TopologyDelta?
    private(set) var topologyGeneration: UInt64 = 0

    init(
        id: String,
        interactive: Bool,
        windowLevel: String? = nil,
        aosSchemeHandler: WKURLSchemeHandler? = nil,
        sceneExtensionSchemeHandler: WKURLSchemeHandler? = nil,
        lifecycleCoordinator: CanvasLifecycleCoordinator
    ) {
        self.id = id
        self.isInteractive = interactive
        self.windowLevel = normalizeCanvasWindowLevel(windowLevel)
        self.aosSchemeHandler = aosSchemeHandler
        self.sceneExtensionSchemeHandler = sceneExtensionSchemeHandler
        self.lifecycleCoordinator = lifecycleCoordinator
        _ = rebuildSegments()
    }

    var remainingTTL: Double? {
        guard let deadline = ttlDeadline else { return nil }
        return max(0, deadline.timeIntervalSinceNow)
    }

    var cgFrame: CGRect {
        guard let first = segments.first else { return allDisplaysBounds() }
        return segments.dropFirst().reduce(first.nativeBounds) { $0.union($1.nativeBounds) }
    }

    var windowNumbers: [Int] {
        segments.map { $0.window.windowNumber }
    }

    private func applyWindowLevel() {
        for segment in segments {
            segment.window.level = resolveCanvasWindowLevel(windowLevel, interactive: isInteractive)
        }
    }

    private func applyMouseEventPolicy() {
        for segment in segments {
            segment.window.ignoresMouseEvents = inputPassthrough || !isInteractive
            segment.window.isInteractiveCanvas = !inputPassthrough && isInteractive
        }
    }

    func refreshWindowLevel() {
        applyWindowLevel()
    }

    func setInputPassthrough(_ enabled: Bool) {
        inputPassthrough = enabled
        applyMouseEventPolicy()
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

    func loadHTML(_ html: String) {
        htmlContent = html
        urlString = nil
        for segment in segments {
            segment.webView.loadHTMLString(html, baseURL: nil)
        }
    }

    func loadURL(_ urlString: String) {
        self.urlString = urlString
        htmlContent = nil
        guard let url = URL(string: urlString) else { return }
        for segment in segments {
            segment.webView.load(URLRequest(url: url))
        }
    }

    func show() {
        hasShown = true
        for segment in segments {
            if isInteractive {
                segment.window.makeKeyAndOrderFront(nil)
            } else {
                segment.window.orderFront(nil)
            }
        }
    }

    func grabFocus() {
        guard isInteractive, let first = segments.first else { return }
        NSApp.activate(ignoringOtherApps: true)
        first.window.makeKeyAndOrderFront(nil)
    }

    func quiesceForRetirement() {
        precondition(Thread.isMainThread, "canvas quiesce must run on the main thread")
        guard !retirementQuiesced else { return }
        retirementQuiesced = true
        onMessage = nil
        onTTLExpired = nil
        ttlTimer?.cancel()
        ttlTimer = nil
        for segment in segments {
            segment.quiesceForRetirement()
        }
        hasShown = false
    }

    func finalizeRetirement() {
        precondition(Thread.isMainThread, "canvas finalization must run on the main thread")
        guard !retirementFinalized else { return }
        retirementFinalized = true
        quiesceForRetirement()
        for segment in segments {
            segment.finalizeRetirement()
        }
        segments = []
        lastDelta = nil
        ttlDeadline = nil
    }

    func updatePosition(cgRect: CGRect) {
        // DesktopWorld surfaces are topology-owned. Repositioning one logical
        // surface is expressed by display reconfiguration, not by moving a
        // single native window.
    }

    func finalizeDragPosition() {}

    func toInfo() -> CanvasInfo {
        let f = cgFrame
        return CanvasInfo(
            id: id,
            url: sourceURL,
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
            requestedFrame: nil,
            placement: nil,
            anchorWindow: nil,
            anchorChannel: nil,
            offset: nil,
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
            segments: segmentMetadata(),
            owner: owner,
            logicalSurfaceKey: logicalSurfaceKey
        )
    }

    func evaluateJavaScript(_ script: String, completion: ((Any?, Error?) -> Void)?) {
        guard let primary = segments.first else {
            completion?(nil, NSError(
                domain: "DesktopWorldSurface",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "no segments active"]
            ))
            return
        }

        guard completion != nil else {
            for segment in segments {
                segment.webView.evaluateJavaScript(script, completionHandler: nil)
            }
            return
        }

        for segment in segments {
            if segment.displayID == primary.displayID {
                segment.webView.evaluateJavaScript(script, completionHandler: completion)
            } else {
                segment.webView.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }

    func setAlpha(_ alpha: CGFloat) {
        for segment in segments {
            segment.window.alphaValue = alpha
        }
    }

    func orderFront() {
        for segment in segments {
            segment.window.orderFront(nil)
        }
    }

    func orderOut() {
        for segment in segments {
            segment.window.orderOut(nil)
        }
    }

    @discardableResult
    func rebuildSegments() -> Bool {
        let displays = getDisplays()
        let nativeUnion = allDisplaysBounds()
        let unordered = displays.map { display -> DesktopWorldSurfaceSegment in
            DesktopWorldSurfaceSegment(
                displayID: display.id,
                index: 0,
                dwBounds: [
                    display.bounds.minX - nativeUnion.minX,
                    display.bounds.minY - nativeUnion.minY,
                    display.bounds.width,
                    display.bounds.height,
                ],
                nativeBounds: [
                    display.bounds.minX,
                    display.bounds.minY,
                    display.bounds.width,
                    display.bounds.height,
                ]
            )
        }
        return applyOrderedSegments(orderSegments(unordered))
    }

    func segmentMetadata() -> [DesktopWorldSurfaceSegment] {
        segments.map(segmentMetadata)
    }

    func sceneBarrierTopology() -> DesktopWorldSceneBarrierTopology {
        precondition(lifecycleGeneration > 0, "DesktopWorld scene topology requires an active canvas generation")
        return DesktopWorldSceneBarrierTopology(
            canvasGeneration: lifecycleGeneration,
            generation: topologyGeneration,
            segments: segmentMetadata()
        )
    }

    private func applyOrderedSegments(_ ordered: [DesktopWorldSurfaceSegment]) -> Bool {
        var byDisplay = Dictionary(uniqueKeysWithValues: segments.map { ($0.displayID, $0) })
        var nextSegments: [Segment] = []
        var added: [DesktopWorldSurfaceSegment] = []
        var removed: [DesktopWorldSurfaceSegment] = []
        var changed: [DesktopWorldSurfaceSegment] = []

        for meta in ordered {
            let nativeRect = rect(from: meta.nativeBounds)
            let dwRect = rect(from: meta.dwBounds)
            if let existing = byDisplay.removeValue(forKey: meta.displayID) {
                let changedBounds = existing.nativeBounds != nativeRect || existing.dwBounds != dwRect
                let changedIndex = existing.index != meta.index
                if changedBounds || changedIndex {
                    existing.index = meta.index
                    existing.nativeBounds = nativeRect
                    existing.dwBounds = dwRect
                    existing.window.setFrame(canvasScreenFrame(nativeRect), display: true)
                    changed.append(segmentMetadata(existing))
                }
                nextSegments.append(existing)
            } else {
                let segment = makeSegmentWindow(meta: meta, nativeRect: nativeRect, dwRect: dwRect)
                nextSegments.append(segment)
                if hasShown && !suspended {
                    segment.window.orderFront(nil)
                }
                added.append(segmentMetadata(segment))
            }
        }

        for orphan in byDisplay.values {
            removed.append(segmentMetadata(orphan))
            lifecycleCoordinator.retireNativeResource(
                orphan,
                ownerGeneration: CanvasLifecycleGeneration(
                    canvasID: id,
                    value: lifecycleGeneration
                )
            )
        }

        segments = nextSegments
        let settled = segmentMetadata()
        let hasChanges = !added.isEmpty || !removed.isEmpty || !changed.isEmpty
        if hasChanges { topologyGeneration &+= 1 }
        lastDelta = hasChanges
            ? TopologyDelta(added: added, removed: removed, changed: changed, settled: settled)
            : nil
        return hasChanges
    }

    private func makeSegmentWindow(meta: DesktopWorldSurfaceSegment, nativeRect: CGRect, dwRect: CGRect) -> Segment {
        let screenFrame = canvasScreenFrame(nativeRect)
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
        window.level = resolveCanvasWindowLevel(windowLevel, interactive: isInteractive)
        window.ignoresMouseEvents = inputPassthrough || !isInteractive
        window.isInteractiveCanvas = !inputPassthrough && isInteractive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        if let handler = aosSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos")
        }
        if let handler = sceneExtensionSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos-scene-extension")
        }
        let controller = WKUserContentController()
        let messageHandler = CanvasMessageHandler()
        controller.add(messageHandler, name: "headsup")
        controller.addUserScript(WKUserScript(
            source: aosCanvasBootstrapScript("window.__aosSegmentDisplayId = \(meta.displayID); window.__aosSurfaceCanvasId = \(jsStringLiteral(id));"),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = controller

        let webView: WKWebView = isInteractive
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

        let segment = Segment(
            displayID: meta.displayID,
            index: meta.index,
            nativeBounds: nativeRect,
            dwBounds: dwRect,
            window: window,
            webView: webView,
            messageHandler: messageHandler,
            nativeRetirementID: "\(id):segment:\(meta.displayID):\(UUID().uuidString)"
        )
        installMessageHandler(for: segment)
        loadCurrentContent(into: webView)
        return segment
    }

    private func installMessageHandler(for segment: Segment) {
        segment.messageHandler.onMessage = { [weak self, weak segment] message in
            guard let self, let segment else { return }
            guard var envelope = message as? [String: Any],
                  let type = envelope["type"] as? String else {
                self.onMessage?(message)
                return
            }
            if type == "desktop_world_stage.scene.result"
                || type == "desktop_world_stage.scene.fault"
                || type == "desktop_world_stage.scene.event"
                || type == "ready"
                || type == "lifecycle.ready" {
                guard self.segments.contains(where: { $0 === segment }) else { return }
                var payload = envelope["payload"] as? [String: Any] ?? [:]
                payload["segment_display_id"] = Int(segment.displayID)
                payload["segment_index"] = segment.index
                payload["topology_generation"] = self.topologyGeneration
                payload["canvas_generation"] = self.lifecycleGeneration
                envelope["payload"] = payload
                self.onMessage?(envelope)
                return
            }
            self.onMessage?(message)
        }
    }

    private func loadCurrentContent(into webView: WKWebView) {
        if let html = htmlContent {
            webView.loadHTMLString(html, baseURL: nil)
        } else if let urlString, let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }
    }

    private func segmentMetadata(_ segment: Segment) -> DesktopWorldSurfaceSegment {
        DesktopWorldSurfaceSegment(
            displayID: segment.displayID,
            index: segment.index,
            dwBounds: [
                segment.dwBounds.minX,
                segment.dwBounds.minY,
                segment.dwBounds.width,
                segment.dwBounds.height,
            ],
            nativeBounds: [
                segment.nativeBounds.minX,
                segment.nativeBounds.minY,
                segment.nativeBounds.width,
                segment.nativeBounds.height,
            ]
        )
    }

    private func rect(from values: [CGFloat]) -> CGRect {
        CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
    }
}
