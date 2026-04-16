// status-item.swift — Generic menu bar icon that toggles a canvas on/off.
//
// Config-driven: status_item.enabled, toggle_id, toggle_url, toggle_at, toggle_track, icon.
// The daemon creates/removes a canvas. The canvas handles its own behaviors.

import AppKit
import Foundation

class StatusItemManager {
    let canvasManager: CanvasManager
    var statusItem: NSStatusItem?

    private(set) var toggleId: String
    private(set) var toggleUrl: String
    private(set) var toggleAt: [Double]
    private(set) var toggleTrack: String?
    private(set) var iconStyle: String  // stored for future multi-icon support; updateIcon does not branch on it yet
    var urlResolver: ((String) -> String)?
    var lastPositionResolver: ((String) -> (x: Double, y: Double)?)?

    // handleClick is always called on main; isAnimating is read/written on main only.
    private var isAnimating = false
    private let positionFile: String
    private var customMenuItems: [[String: String]] = []  // [{title, id}, ...]

    init(canvasManager: CanvasManager, config: AosConfig.StatusItemConfig) {
        self.canvasManager = canvasManager
        self.toggleId = config.toggle_id
        self.toggleUrl = config.toggle_url
        self.toggleAt = config.toggle_at
        self.toggleTrack = config.toggle_track
        self.iconStyle = config.icon
        self.positionFile = (kAosConfigPath as NSString)
            .deletingLastPathComponent
            .appending("/status-item-position.json")
    }

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
        statusItem?.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    func teardown() {
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func updateConfig(_ config: AosConfig.StatusItemConfig) {
        toggleId = config.toggle_id
        toggleUrl = config.toggle_url
        toggleAt = config.toggle_at
        toggleTrack = config.toggle_track
        iconStyle = config.icon
        updateIcon()
    }

    @objc func handleClick(_ sender: Any?) {
        guard !isAnimating else { return }

        if NSApp.currentEvent?.type == .rightMouseUp {
            showContextMenu()
            return
        }

        if canvasManager.hasCanvas(toggleId) {
            if isCanvasSuspended() {
                resumeCanvas()
            } else {
                suspendCanvas()
            }
        } else {
            summonCanvas()  // cold boot
        }
    }

    func setMenuItems(_ items: [[String: String]]) {
        customMenuItems = items
    }

    private func showContextMenu() {
        let menu = NSMenu()

        // App-provided items first
        for (index, item) in customMenuItems.enumerated() {
            guard let title = item["title"] else { continue }
            let mi = NSMenuItem(title: title, action: #selector(menuCustomItem(_:)), keyEquivalent: "")
            mi.target = self
            mi.tag = index
            menu.addItem(mi)
        }

        if !customMenuItems.isEmpty {
            menu.addItem(NSMenuItem.separator())
        }

        // Daemon-owned items
        if canvasManager.hasCanvas(toggleId) {
            let removeItem = NSMenuItem(title: "Remove", action: #selector(menuRemove), keyEquivalent: "")
            removeItem.target = self
            menu.addItem(removeItem)
        }

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit AOS", action: #selector(menuQuit), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)

        guard let button = statusItem?.button else { return }
        let pos = NSPoint(x: 0, y: button.bounds.maxY + 5)
        menu.popUp(positioning: nil, at: pos, in: button)
    }

    @objc private func menuCustomItem(_ sender: NSMenuItem) {
        let index = sender.tag
        guard index < customMenuItems.count,
              let id = customMenuItems[index]["id"] else { return }
        // Relay the selection back to the canvas
        canvasManager.evalAsync(canvasID: toggleId, js: "window.__aosMenuAction?.(\"\(id)\")")
    }

    @objc private func menuRemove() {
        dismissCanvas()
    }

    @objc private func menuQuit() {
        NSApp.terminate(nil)
    }

    private func isCanvasSuspended() -> Bool {
        guard let canvas = canvasManager.canvas(forID: toggleId) else { return false }
        return canvas.suspended
    }

    private func waitUntilCanvasVisible(timeout: TimeInterval = 0.5, poll: TimeInterval = 0.05, completion: @escaping () -> Void) {
        let deadline = Date().addingTimeInterval(timeout)

        func pollOnce() {
            if !isCanvasSuspended() {
                completion()
                return
            }
            guard Date() < deadline else {
                completion()
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + poll) {
                pollOnce()
            }
        }

        pollOnce()
    }

    // MARK: - Summon

    private func summonCanvas() {
        guard !toggleUrl.isEmpty else { return }

        let iconPos = statusItemCGPosition()
        let resolvedUrl = urlResolver?(toggleUrl) ?? toggleUrl
        // Pass icon origin to the canvas so it can animate entrance from there
        let separator = resolvedUrl.contains("?") ? "&" : "?"
        let urlWithOrigin = "\(resolvedUrl)\(separator)origin_x=\(Int(iconPos.x))&origin_y=\(Int(iconPos.y))"

        var req = CanvasRequest(action: "create")
        req.id = toggleId
        req.url = urlWithOrigin
        if let track = toggleTrack { req.track = track }

        let isTracked = toggleTrack != nil

        if !isTracked {
            // Fixed-position canvas: animate frame from icon to target
            let target = loadSavedPosition() ?? toggleAt
            guard target.count == 4 else { return }

            let startSize: CGFloat = 40
            let fromX = iconPos.x - startSize / 2
            let fromY = iconPos.y

            req.at = [fromX, fromY, startSize, startSize]
            _ = canvasManager.handle(req)
            canvasManager.setCanvasAlpha(toggleId, 0)
            updateIcon()

            isAnimating = true
            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                Thread.sleep(forTimeInterval: 0.35)

                DispatchQueue.main.async {
                    self?.canvasManager.setCanvasAlpha(self?.toggleId ?? "", 1)
                }

                self?.animateFrame(
                    from: [fromX, fromY, startSize, startSize],
                    to: target.map { CGFloat($0) },
                    duration: 0.5,
                    easing: { t in 1 - pow(1 - t, 3) }  // easeOutCubic
                )

                DispatchQueue.main.async { [weak self] in
                    self?.isAnimating = false
                    self?.updateIcon()
                }
            }
        } else {
            // Tracked canvas (e.g. union): Sigil owns the entrance animation.
            // The origin is passed via query params so Sigil can animate from
            // the icon position to the resolved avatar position.
            _ = canvasManager.handle(req)
            updateIcon()
        }
    }

    // MARK: - Suspend / Resume

    private func suspendCanvas() {
        if toggleTrack == nil { saveCurrentPosition() }

        let iconPos = statusItemCGPosition()

        if toggleTrack != nil {
            // Tracked canvas: tell Sigil to animate back to icon, then suspend
            // after the animation completes (or after a timeout).
            canvasManager.postMessageAsync(canvasID: toggleId, payload: [
                "type": "lifecycle",
                "action": "exit",
                "origin_x": Int(iconPos.x),
                "origin_y": Int(iconPos.y),
            ])
            updateIcon()

            // Suspend after animation duration + margin
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) { [weak self] in
                guard let self = self else { return }
                var req = CanvasRequest(action: "suspend")
                req.id = self.toggleId
                _ = self.canvasManager.handle(req)
            }
        } else {
            var req = CanvasRequest(action: "suspend")
            req.id = toggleId
            _ = canvasManager.handle(req)
            updateIcon()
        }
    }

    private func resumeCanvas() {
        var req = CanvasRequest(action: "resume")
        req.id = toggleId
        _ = canvasManager.handle(req)
        updateIcon()

        if toggleTrack != nil {
            let iconPos = statusItemCGPosition()
            waitUntilCanvasVisible { [weak self] in
                guard let self = self else { return }
                self.canvasManager.postMessageAsync(canvasID: self.toggleId, payload: [
                    "type": "lifecycle",
                    "action": "enter",
                    "origin_x": Int(iconPos.x),
                    "origin_y": Int(iconPos.y),
                ])
            }
        }
    }

    // MARK: - Dismiss (hard remove — daemon restart / full teardown)

    private func dismissCanvas() {
        let isTracked = toggleTrack != nil

        if !isTracked { saveCurrentPosition() }

        // Cascade remove handles children — no dismissed eval needed.

        if !isTracked {
            // Fixed-position canvas: animate frame to icon, then remove
            let iconPos = statusItemCGPosition()
            let endSize: CGFloat = 20
            let toX = iconPos.x - endSize / 2
            let toY = iconPos.y

            var fromX: CGFloat = 200, fromY: CGFloat = 200
            var fromW: CGFloat = 300, fromH: CGFloat = 300
            let listResp = canvasManager.handle(CanvasRequest(action: "list"))
            if let canvases = listResp.canvases {
                for c in canvases where c.id == toggleId {
                    fromX = c.at[0]; fromY = c.at[1]; fromW = c.at[2]; fromH = c.at[3]
                }
            }

            isAnimating = true
            updateIcon()

            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                self?.animateFrame(
                    from: [fromX, fromY, fromW, fromH],
                    to: [toX, toY, endSize, endSize],
                    duration: 0.4,
                    easing: { t in
                        let c1 = 1.70158, c3 = c1 + 1
                        return c3 * t * t * t - c1 * t * t  // easeInBack
                    }
                )

                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    var rm = CanvasRequest(action: "remove")
                    rm.id = self.toggleId
                    _ = self.canvasManager.handle(rm)
                    self.isAnimating = false
                    self.updateIcon()
                }
            }
        } else {
            // Tracked canvas: remove real canvas, animate dot back to icon.
            let dotSize: CGFloat = 80
            let landingCenter = mainDisplayNonantCenter(column: 2, row: 2)
            let fromCG = CGRect(
                x: landingCenter.x - dotSize / 2,
                y: landingCenter.y - dotSize / 2,
                width: dotSize, height: dotSize
            )

            var rm = CanvasRequest(action: "remove")
            rm.id = toggleId
            _ = canvasManager.handle(rm)

            let iconPos = statusItemCGPosition()
            let endSize: CGFloat = 20
            let toCG = CGRect(
                x: iconPos.x - endSize / 2, y: iconPos.y,
                width: endSize, height: endSize
            )

            isAnimating = true
            updateIcon()

            animateDot(from: fromCG, to: toCG, duration: 0.35) { [weak self] in
                self?.isAnimating = false
                self?.updateIcon()
            }
        }
    }

    // MARK: - Animation

    private func animateFrame(
        id animId: String? = nil,
        from: [CGFloat], to: [CGFloat],
        duration: Double, easing: @escaping (Double) -> Double
    ) {
        guard from.count == 4, to.count == 4 else { return }
        let targetId = animId ?? toggleId
        let fps = 60.0
        let totalFrames = Int(duration * fps)
        let t0 = Date()

        for i in 0...totalFrames {
            let t = Double(i) / Double(totalFrames)
            let e = CGFloat(easing(t))

            let x = from[0] + (to[0] - from[0]) * e
            let y = from[1] + (to[1] - from[1]) * e
            let w = from[2] + (to[2] - from[2]) * e
            let h = from[3] + (to[3] - from[3]) * e

            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                var updateReq = CanvasRequest(action: "update")
                updateReq.id = targetId
                updateReq.at = [x, y, w, h]
                _ = self.canvasManager.handle(updateReq)
            }

            let want = Double(i + 1) / fps
            let got = Date().timeIntervalSince(t0)
            if want > got { Thread.sleep(forTimeInterval: want - got) }
        }
    }

    // MARK: - Dot Animation (lightweight, no WKWebView)

    /// Animate a small colored dot between two CG-coordinate rects using
    /// Core Animation (NSAnimationContext). Much faster and smoother than
    /// creating a WKWebView canvas or manual frame-by-frame updates.
    private func animateDot(
        from fromCG: CGRect, to toCG: CGRect,
        duration: TimeInterval, completion: @escaping () -> Void
    ) {
        let fromScreen = cgToScreen(fromCG)

        let dot = NSWindow(
            contentRect: fromScreen,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        dot.level = .floating
        dot.isOpaque = false
        dot.backgroundColor = .clear
        dot.hasShadow = false
        dot.ignoresMouseEvents = true

        // Use a view that keeps itself circular as the window resizes
        let circle = OvalView(
            frame: NSRect(origin: .zero, size: fromScreen.size),
            color: NSColor(red: 0.5, green: 0.35, blue: 1.0, alpha: 0.7)
        )
        circle.autoresizingMask = [.width, .height]
        dot.contentView = circle
        dot.orderFrontRegardless()

        let toScreen = cgToScreen(toCG)

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = duration
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            dot.animator().setFrame(toScreen, display: true)
            dot.animator().alphaValue = 0.0
        }, completionHandler: {
            dot.orderOut(nil)
            completion()
        })
    }

    // MARK: - Display Geometry

    /// Return the CG-coordinate center of a nonant on the main display.
    /// Column 0 = left, 1 = center, 2 = right.  Row 0 = top, 1 = middle, 2 = bottom.
    private func mainDisplayNonantCenter(column: Int, row: Int) -> CGPoint {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            return CGPoint(x: 400, y: 400)
        }
        let visible = screen.visibleFrame
        let screenH = screen.frame.height
        // Convert NSScreen visible frame to CG coordinates
        let cgX = visible.origin.x
        let cgY = screenH - visible.origin.y - visible.height
        let cgW = visible.width
        let cgH = visible.height

        let cx = cgX + cgW * (CGFloat(column) * 2 + 1) / 6
        let cy = cgY + cgH * (CGFloat(row) * 2 + 1) / 6
        return CGPoint(x: cx, y: cy)
    }

    // MARK: - Position Persistence

    private func loadSavedPosition() -> [Double]? {
        guard let data = FileManager.default.contents(atPath: positionFile),
              let dict = try? JSONDecoder().decode([String: PositionEntry].self, from: data),
              let entry = dict[toggleId] else {
            return nil
        }
        return entry.at
    }

    private func saveCurrentPosition() {
        let listResp = canvasManager.handle(CanvasRequest(action: "list"))
        guard let canvases = listResp.canvases else { return }
        guard let canvas = canvases.first(where: { $0.id == toggleId }) else { return }
        let at = canvas.at.map { Double($0) }

        var dict: [String: PositionEntry] = [:]
        if let data = FileManager.default.contents(atPath: positionFile),
           let existing = try? JSONDecoder().decode([String: PositionEntry].self, from: data) {
            dict = existing
        }
        dict[toggleId] = PositionEntry(at: at)

        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? enc.encode(dict) {
            try? data.write(to: URL(fileURLWithPath: positionFile))
        }
    }

    // MARK: - Icon

    private func statusItemCGPosition() -> CGPoint {
        guard let button = statusItem?.button,
              let window = button.window else {
            return CGPoint(x: 100, y: 0)
        }
        let frame = window.frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: frame.midX, y: primaryHeight - frame.midY)
    }

    func updateIcon() {
        let exists = canvasManager.hasCanvas(toggleId)
        let suspended = isCanvasSuspended()
        // Filled = active or animating. Unfilled = suspended, absent, or idle.
        statusItem?.button?.image = drawHexagonIcon(filled: (exists && !suspended) || isAnimating)
    }

    private func drawHexagonIcon(filled: Bool) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX, cy = rect.midY
            let r: CGFloat = 7.0
            let path = NSBezierPath()

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
            if filled { NSColor.black.setFill(); path.fill() }
            path.stroke()

            let dotR: CGFloat = filled ? 2.0 : 1.5
            let dotRect = NSRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            let dot = NSBezierPath(ovalIn: dotRect)
            if filled { NSColor.white.setFill() } else { NSColor.black.setFill() }
            dot.fill()

            return true
        }
        img.isTemplate = true
        return img
    }
}

// MARK: - OvalView

private class OvalView: NSView {
    let color: NSColor

    init(frame: NSRect, color: NSColor) {
        self.color = color
        super.init(frame: frame)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        NSBezierPath(ovalIn: bounds).fill()
    }
}

// MARK: - Persistence Types

private struct PositionEntry: Codable {
    let at: [Double]
}
