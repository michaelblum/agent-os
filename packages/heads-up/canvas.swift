// heads-up — Canvas: transparent NSWindow + WKWebView
// Each canvas is an (id, bounds, content) tuple rendered on screen.

import AppKit
import WebKit

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

/// NSWindow subclass that disables frame constraining.
/// By default macOS may reposition or resize windows to fit within a single display.
/// Canvases need to span multiple displays, so we return the proposed frame unchanged.
class CanvasWindow: NSWindow {
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        return frameRect
    }
}

// MARK: - Canvas

class Canvas {
    let id: String
    let window: NSWindow
    let webView: WKWebView
    var anchorWindowID: CGWindowID?
    var offset: CGRect?
    var isInteractive: Bool
    var ttlTimer: DispatchSourceTimer?
    var ttlDeadline: Date?
    var onTTLExpired: (() -> Void)?

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
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]

        let config = WKWebViewConfiguration()
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
        window.orderFront(nil)
    }

    func close() {
        ttlTimer?.cancel()
        ttlTimer = nil
        window.orderOut(nil)
        window.close()
    }

    func updatePosition(cgRect: CGRect) {
        let screenFrame = cgToScreen(cgRect)
        window.setFrame(screenFrame, display: true)
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
            offset: offset.map { [$0.origin.x, $0.origin.y, $0.size.width, $0.size.height] },
            interactive: isInteractive,
            ttl: remainingTTL
        )
    }
}

// MARK: - Canvas Manager

class CanvasManager {
    private var canvases: [String: Canvas] = [:]
    private var anchorTimer: DispatchSourceTimer?
    var onCanvasCountChanged: (() -> Void)?
    let startTime = Date()

    var isEmpty: Bool { canvases.isEmpty }
    var hasAnchoredCanvases: Bool { canvases.values.contains { $0.anchorWindowID != nil } }

    func removeByTTL(_ id: String) {
        guard let canvas = canvases.removeValue(forKey: id) else { return }
        canvas.close()
        if !hasAnchoredCanvases { stopAnchorPolling() }
        onCanvasCountChanged?()
    }

    func handle(_ request: CanvasRequest) -> CanvasResponse {
        switch request.action {
        case "create":  return handleCreate(request)
        case "update":  return handleUpdate(request)
        case "remove":  return handleRemove(request)
        case "remove-all": return handleRemoveAll()
        case "list":    return handleList()
        case "ping":    return handlePing()
        default:
            return .fail("Unknown action: \(request.action)", code: "UNKNOWN_ACTION")
        }
    }

    private func handleCreate(_ req: CanvasRequest) -> CanvasResponse {
        guard let id = req.id else {
            return .fail("create requires --id", code: "MISSING_ID")
        }
        if canvases[id] != nil {
            return .fail("Canvas '\(id)' already exists. Use update or remove first.", code: "DUPLICATE_ID")
        }

        let cgFrame: CGRect
        if let at = req.at, at.count == 4 {
            cgFrame = CGRect(x: at[0], y: at[1], width: at[2], height: at[3])
        } else if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            guard let windowBounds = getWindowBounds(CGWindowID(anchorWin)) else {
                return .fail("Window \(anchorWin) not found", code: "WINDOW_NOT_FOUND")
            }
            cgFrame = CGRect(
                x: windowBounds.origin.x + off[0],
                y: windowBounds.origin.y + off[1],
                width: off[2], height: off[3]
            )
        } else {
            return .fail("create requires --at x,y,w,h or --anchor-window + --offset", code: "MISSING_POSITION")
        }

        let interactive = req.interactive ?? false
        let canvas = Canvas(id: id, cgFrame: cgFrame, interactive: interactive)

        if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            canvas.anchorWindowID = CGWindowID(anchorWin)
            canvas.offset = CGRect(x: off[0], y: off[1], width: off[2], height: off[3])
        }

        if let html = req.html {
            canvas.loadHTML(html)
        } else if let url = req.url {
            canvas.loadURL(url)
        } else {
            canvas.close()
            return .fail("create requires --html, --file, --url, or stdin content", code: "NO_CONTENT")
        }

        canvas.show()
        canvases[id] = canvas

        if let ttl = req.ttl {
            canvas.onTTLExpired = { [weak self] in
                self?.removeByTTL(id)
            }
            canvas.setTTL(ttl)
        }

        if hasAnchoredCanvases { startAnchorPolling() }

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
            canvas.offset = nil
        }

        if let anchorWin = req.anchorWindow, let off = req.offset, off.count == 4 {
            canvas.anchorWindowID = CGWindowID(anchorWin)
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
        var anyAnchored = false
        for (_, canvas) in canvases {
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
        if !anyAnchored { stopAnchorPolling() }
    }
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
