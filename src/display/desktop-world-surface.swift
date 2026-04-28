import AppKit
import Foundation
import WebKit

protocol CanvasLike: AnyObject {
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
    var cascadeFromParent: Bool { get set }
    var parent: String? { get set }
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
    func close()
    func updatePosition(cgRect: CGRect)
    func finalizeDragPosition()
    func toInfo() -> CanvasInfo
    func evaluateJavaScript(_ script: String, completion: ((Any?, Error?) -> Void)?)
    func setAlpha(_ alpha: CGFloat)
    func refreshWindowLevel()
    func orderFront()
    func orderOut()
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
    final class Segment {
        let displayID: UInt32
        var index: Int
        var nativeBounds: CGRect
        var dwBounds: CGRect
        let window: CanvasWindow
        let webView: WKWebView
        let messageHandler: CanvasMessageHandler

        init(displayID: UInt32, index: Int, nativeBounds: CGRect, dwBounds: CGRect,
             window: CanvasWindow, webView: WKWebView, messageHandler: CanvasMessageHandler) {
            self.displayID = displayID
            self.index = index
            self.nativeBounds = nativeBounds
            self.dwBounds = dwBounds
            self.window = window
            self.webView = webView
            self.messageHandler = messageHandler
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
            for segment in segments {
                segment.window.ignoresMouseEvents = !isInteractive
                segment.window.isInteractiveCanvas = isInteractive
            }
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
    var cascadeFromParent: Bool = true
    var parent: String? = nil
    var onTTLExpired: (() -> Void)?
    var onMessage: ((Any) -> Void)? {
        didSet {
            for segment in segments {
                segment.messageHandler.onMessage = onMessage
            }
        }
    }
    private var ttlTimer: DispatchSourceTimer?
    private var ttlDeadline: Date?
    private let aosSchemeHandler: WKURLSchemeHandler?
    private var htmlContent: String?
    private var urlString: String?
    private var hasShown = false
    private(set) var segments: [Segment] = []
    private(set) var lastDelta: TopologyDelta?

    init(id: String, interactive: Bool, windowLevel: String? = nil, aosSchemeHandler: WKURLSchemeHandler? = nil) {
        self.id = id
        self.isInteractive = interactive
        self.windowLevel = normalizeCanvasWindowLevel(windowLevel)
        self.aosSchemeHandler = aosSchemeHandler
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

    func refreshWindowLevel() {
        applyWindowLevel()
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

    func close() {
        ttlTimer?.cancel()
        ttlTimer = nil
        for segment in segments {
            segment.webView.configuration.userContentController.removeScriptMessageHandler(forName: "headsup")
            segment.window.orderOut(nil)
            segment.window.close()
        }
        segments = []
        lastDelta = nil
        hasShown = false
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
            at: [f.origin.x, f.origin.y, f.size.width, f.size.height],
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
            segments: segmentMetadata()
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
            orphan.webView.configuration.userContentController.removeScriptMessageHandler(forName: "headsup")
            orphan.window.orderOut(nil)
            orphan.window.close()
        }

        segments = nextSegments
        let settled = segmentMetadata()
        let hasChanges = !added.isEmpty || !removed.isEmpty || !changed.isEmpty
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
        window.isOpaque = false
        window.hasShadow = false
        window.level = resolveCanvasWindowLevel(windowLevel, interactive: isInteractive)
        window.ignoresMouseEvents = !isInteractive
        window.isInteractiveCanvas = isInteractive
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
        if let handler = aosSchemeHandler {
            config.setURLSchemeHandler(handler, forURLScheme: "aos")
        }
        let controller = WKUserContentController()
        let messageHandler = CanvasMessageHandler()
        messageHandler.onMessage = onMessage
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
            messageHandler: messageHandler
        )
        loadCurrentContent(into: webView)
        return segment
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
