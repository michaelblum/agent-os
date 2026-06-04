// status-item.swift — Generic menu bar icon for a warm target canvas.
//
// Config-driven: status_item.enabled, toggle_id, toggle_url, toggle_at, toggle_track, icon.
// Left-click sends toggle intent to a persistent canvas instead of managing
// the canvas lifecycle itself.

import AppKit
import Foundation

private struct StatusItemMenuDescriptor {
    let id: String
    let title: String
    let keyEquivalent: String
    let enabled: Bool
    let state: NSControl.StateValue
    let isSeparator: Bool

    init?(raw: [String: Any]) {
        let kind = ((raw["type"] as? String) ?? (raw["kind"] as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if kind == "separator" {
            id = ""
            title = ""
            keyEquivalent = ""
            enabled = false
            state = .off
            isSeparator = true
            return
        }

        guard let rawId = raw["id"] as? String,
              let rawTitle = raw["title"] as? String else {
            return nil
        }
        let trimmedId = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTitle = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedId.isEmpty, !trimmedTitle.isEmpty else { return nil }

        id = trimmedId
        title = trimmedTitle
        keyEquivalent = (raw["key_equivalent"] as? String)
            ?? (raw["keyEquivalent"] as? String)
            ?? (raw["key"] as? String)
            ?? ""
        enabled = Self.boolValue(raw["enabled"], defaultValue: true)
        if Self.boolValue(raw["checked"], defaultValue: false) {
            state = .on
        } else {
            switch ((raw["state"] as? String) ?? "").lowercased() {
            case "on", "checked", "true":
                state = .on
            case "mixed":
                state = .mixed
            default:
                state = .off
            }
        }
        isSeparator = false
    }

    private static func boolValue(_ value: Any?, defaultValue: Bool) -> Bool {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "1", "true", "yes", "on":
                return true
            case "0", "false", "no", "off":
                return false
            default:
                break
            }
        }
        return defaultValue
    }
}

class StatusItemManager {
    private static let accessibilityLabel = "AOS status item"
    private let lifecycleTimeout: TimeInterval = 1.0
    private let visibilityTimeout: TimeInterval = 8.0

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
    private var persistentVisible = false
    private var hasPersistentStateSource = false
    private var persistentWarmupStarted = false
    private var filledIcon: NSImage?
    private var unfilledIcon: NSImage?
    private let positionFile: String
    private var statusMenuItems: [StatusItemMenuDescriptor] = []

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
        statusItem?.button?.toolTip = Self.accessibilityLabel
        statusItem?.button?.setAccessibilityLabel(Self.accessibilityLabel)
        DispatchQueue.main.async { [weak self] in
            self?.primePersistentCanvas(reason: "setup")
        }
    }

    func teardown() {
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func updateConfig(_ config: AosConfig.StatusItemConfig) {
        let targetChanged = toggleId != config.toggle_id
            || toggleUrl != config.toggle_url
            || toggleTrack != config.toggle_track
        toggleId = config.toggle_id
        toggleUrl = config.toggle_url
        toggleAt = config.toggle_at
        toggleTrack = config.toggle_track
        iconStyle = config.icon
        if targetChanged {
            hasPersistentStateSource = false
            persistentWarmupStarted = false
            statusMenuItems = []
        }
        if !usesPersistentCanvas {
            hasPersistentStateSource = false
            persistentVisible = canvasManager.hasCanvas(toggleId) && !isCanvasSuspended()
        } else if !canvasManager.hasCanvas(toggleId) {
            persistentVisible = false
        }
        updateIcon()
        primePersistentCanvas(reason: "config")
    }

    @objc func handleClick(_ sender: Any?) {
        guard !isAnimating else { return }
        let event = NSApp.currentEvent
        let eventType = event.map { "\($0.type)" } ?? "unknown"
        let modifiers = modifierNames(from: event?.modifierFlags ?? [])
        let origin = statusItemCGPosition()

        if event?.type == .rightMouseUp {
            log("click entry event=\(eventType) modifiers=\(modifiers.joined(separator: ",")) path=context_menu")
            showContextMenu()
            return
        }

        if event?.modifierFlags.contains(.option) == true {
            log("click entry event=\(eventType) modifiers=\(modifiers.joined(separator: ",")) path=context_menu")
            showContextMenu()
            return
        }

        if usesPersistentCanvas {
            let visible = persistentVisible
            let exists = canvasManager.hasCanvas(toggleId)
            log(
                "click entry event=\(eventType) modifiers=\(modifiers.joined(separator: ",")) path=persistent_deferred target=\(toggleId) exists=\(exists) visible=\(visible) stateSource=\(hasPersistentStateSource)"
            )
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.log(
                    "deferred click execution target=\(self.toggleId) exists=\(self.canvasManager.hasCanvas(self.toggleId)) visible=\(self.persistentVisible) stateSource=\(self.hasPersistentStateSource)"
                )
                self.togglePersistentCanvas(origin: origin, modifiers: modifiers)
            }
            return
        }

        log("click entry event=\(eventType) modifiers=\(modifiers.joined(separator: ",")) path=legacy_canvas")
        if canvasManager.hasCanvas(toggleId) {
            if isCanvasSuspended() {
                log("fallback resume target=\(toggleId) reason=non_persistent_click")
                resumeCanvas()
            } else {
                log("fallback suspend target=\(toggleId) reason=non_persistent_click")
                suspendCanvas()
            }
        } else {
            log("fallback summon target=\(toggleId) reason=non_persistent_missing")
            summonCanvas()  // cold boot
        }
    }

    func setMenuItems(_ items: [[String: Any]]) {
        statusMenuItems = items.compactMap(StatusItemMenuDescriptor.init(raw:))
    }

    func setPersistentVisible(_ visible: Bool) {
        guard usesPersistentCanvas else { return }
        hasPersistentStateSource = true
        persistentVisible = visible
        updateIcon()
    }

    var usesPersistentCanvas: Bool {
        toggleTrack != nil
    }

    private func togglePersistentCanvas(origin: CGPoint, modifiers: [String]) {
        if !canvasManager.hasCanvas(toggleId) {
            log("missing persistent target=\(toggleId); recreating via warm canvas path")
            isAnimating = true
            updateIcon()
            summonCanvas()
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.waitUntilPersistentCanvasReady(timeout: self.visibilityTimeout) { [weak self] ready in
                    guard let self = self else { return }
                    if !ready {
                        self.log("recreated persistent target=\(self.toggleId) did not become ready before timeout")
                    } else {
                        self.log("recreated persistent target=\(self.toggleId) ready; posting visible intent")
                    }
                    self.isAnimating = false
                    self.showPersistentCanvas(origin: origin, modifiers: modifiers)
                }
            }
            return
        }
        if !persistentVisible && !hasPersistentStateSource {
            log("persistent target=\(toggleId) has no state source; waiting for renderer readiness before posting visible intent")
            isAnimating = true
            updateIcon()
            waitUntilPersistentCanvasReady(timeout: visibilityTimeout) { [weak self] ready in
                guard let self = self else { return }
                if !ready {
                    self.log("persistent target=\(self.toggleId) readiness timed out; posting visible intent fallback")
                } else {
                    self.log("persistent target=\(self.toggleId) ready without state source; posting visible intent")
                }
                self.isAnimating = false
                self.showPersistentCanvas(origin: origin, modifiers: modifiers)
            }
            return
        }
        if persistentVisible { hidePersistentCanvas(origin: origin, modifiers: modifiers) }
        else { showPersistentCanvas(origin: origin, modifiers: modifiers) }
    }

    private func sendToggleIntent(targetState: String, origin: CGPoint, modifiers: [String]) {
        log("posting persistent \(targetState) intent target=\(toggleId) origin=\(Int(origin.x)),\(Int(origin.y)) modifiers=\(modifiers.joined(separator: ","))")
        canvasManager.postMessageAsync(canvasID: toggleId, payload: [
            "type": "status_item.toggle",
            "target_state": targetState,
            "source": "status_item",
            "origin_x": Int(origin.x),
            "origin_y": Int(origin.y),
            "modifiers": modifiers,
        ])
    }

    private func showContextMenu() {
        let menu = NSMenu()

        if statusMenuItems.isEmpty {
            let loading = NSMenuItem(title: "Loading...", action: nil, keyEquivalent: "")
            loading.isEnabled = false
            menu.addItem(loading)
        } else {
            for (index, item) in statusMenuItems.enumerated() {
                if item.isSeparator {
                    menu.addItem(NSMenuItem.separator())
                    continue
                }
                let mi = NSMenuItem(title: item.title, action: #selector(menuExternalItem(_:)), keyEquivalent: item.keyEquivalent)
                mi.target = self
                mi.tag = index
                mi.isEnabled = item.enabled && !isAnimating
                mi.state = item.state
                menu.addItem(mi)
            }
        }

        guard let button = statusItem?.button else { return }
        let pos = NSPoint(x: 0, y: button.bounds.minY)
        menu.popUp(positioning: nil, at: pos, in: button)
    }

    @objc private func menuExternalItem(_ sender: NSMenuItem) {
        let index = sender.tag
        guard index < statusMenuItems.count else { return }
        let item = statusMenuItems[index]
        guard !item.isSeparator else { return }
        sendMenuAction(itemID: item.id)
    }

    private func sendMenuAction(itemID: String) {
        let origin = statusItemCGPosition()
        let modifiers = modifierNames(from: NSApp.currentEvent?.modifierFlags ?? [])
        canvasManager.postMessageAsync(canvasID: toggleId, payload: [
            "type": "status_item.menu_action",
            "id": itemID,
            "action_id": itemID,
            "source": "status_item",
            "origin_x": Int(origin.x),
            "origin_y": Int(origin.y),
            "modifiers": modifiers,
        ])
    }

    private func isCanvasSuspended() -> Bool {
        guard let canvas = canvasManager.canvas(forID: toggleId) else { return false }
        return canvas.suspended
    }

    private func waitUntilCanvasVisible(
        timeout: TimeInterval,
        poll: TimeInterval = 0.05,
        completion: @escaping () -> Void
    ) {
        let deadline = Date().addingTimeInterval(timeout)

        func pollOnce() {
            guard canvasManager.hasCanvas(toggleId) else {
                isAnimating = false
                updateIcon()
                return
            }
            if !isCanvasSuspended() {
                completion()
                return
            }
            guard Date() < deadline else {
                fputs("[status-item] canvas did not become visible before timeout\n", stderr)
                isAnimating = false
                updateIcon()
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + poll) {
                pollOnce()
            }
        }

        pollOnce()
    }

    private func waitUntilPersistentCanvasReady(
        timeout: TimeInterval,
        poll: TimeInterval = 0.05,
        completion: @escaping (Bool) -> Void
    ) {
        let deadline = Date().addingTimeInterval(timeout)

        func pollOnce() {
            guard let canvas = canvasManager.canvas(forID: toggleId) else {
                completion(false)
                return
            }
            canvas.evaluateJavaScript("""
                (() => {
                  const bridgeReady = Boolean(
                    window.headsup &&
                    typeof window.headsup.receive === "function" &&
                    (document.readyState === "interactive" || document.readyState === "complete")
                  );
                  if (!bridgeReady) return false;
                  if (Object.prototype.hasOwnProperty.call(window.headsup, "statusItemReady")) {
                    return window.headsup.statusItemReady === true;
                  }
                  return true;
                })()
                """) { result, _ in
                if (result as? Bool) == true {
                    completion(true)
                    return
                }
                guard Date() < deadline else {
                    completion(false)
                    return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + poll) {
                    pollOnce()
                }
            }
        }

        pollOnce()
    }

    private func primePersistentCanvas(reason: String) {
        guard usesPersistentCanvas, !toggleUrl.isEmpty else { return }
        guard !persistentWarmupStarted, !canvasManager.hasCanvas(toggleId) else { return }
        persistentWarmupStarted = true
        log("front-load persistent target=\(toggleId) reason=\(reason)")
        summonCanvas()
        guard canvasManager.hasCanvas(toggleId) else {
            persistentWarmupStarted = false
            return
        }
        waitUntilPersistentCanvasReady(timeout: visibilityTimeout) { [weak self] ready in
            guard let self = self else { return }
            if ready {
                self.log("front-loaded persistent target=\(self.toggleId) ready")
            } else {
                self.log("front-loaded persistent target=\(self.toggleId) readiness timed out")
            }
        }
    }

    // MARK: - Summon

    private func summonCanvas() {
        guard !toggleUrl.isEmpty else { return }

        if usesPersistentCanvas {
            var req = CanvasRequest(action: "create")
            req.id = toggleId
            req.url = urlResolver?(toggleUrl) ?? toggleUrl
            req.interactive = false
            if let track = toggleTrack { req.track = track }
            _ = canvasManager.handle(req)
            persistentVisible = false
            updateIcon()
            return
        }

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
            // the icon position to the resolved toggled-surface position.
            _ = canvasManager.handle(req)
            updateIcon()
        }
    }

    // MARK: - Persistent Intent Flow

    private func showPersistentCanvas(origin: CGPoint, modifiers: [String]) {
        persistentVisible = true
        updateIcon()
        sendToggleIntent(targetState: "visible", origin: origin, modifiers: modifiers)
    }

    private func hidePersistentCanvas(origin: CGPoint, modifiers: [String]) {
        persistentVisible = false
        updateIcon()
        sendToggleIntent(targetState: "hidden", origin: origin, modifiers: modifiers)
    }

    // MARK: - Suspend / Resume

    private func suspendCanvas() {
        if toggleTrack == nil { saveCurrentPosition() }

        let iconPos = statusItemCGPosition()

        if toggleTrack != nil {
            // Tracked canvas: wait on the renderer's real exit-complete ACK
            // instead of guessing with a fixed sleep.
            isAnimating = true
            _ = canvasManager.awaitLifecycleCompletion(
                canvasIDs: Set([toggleId]),
                action: "exit",
                timeout: lifecycleTimeout
            ) { [weak self] completed in
                guard let self = self else { return }
                guard self.canvasManager.hasCanvas(self.toggleId) else {
                    self.isAnimating = false
                    self.updateIcon()
                    return
                }
                if !completed {
                    fputs("[status-item] exit lifecycle timeout; suspending anyway\n", stderr)
                }
                var req = CanvasRequest(action: "suspend")
                req.id = self.toggleId
                _ = self.canvasManager.handle(req)
                self.isAnimating = false
                self.updateIcon()
            }

            canvasManager.postMessageAsync(canvasID: toggleId, payload: [
                "type": "lifecycle",
                "action": "exit",
                "origin_x": Int(iconPos.x),
                "origin_y": Int(iconPos.y),
            ])
            updateIcon()
        } else {
            var req = CanvasRequest(action: "suspend")
            req.id = toggleId
            _ = canvasManager.handle(req)
            updateIcon()
        }
    }

    private func resumeCanvas() {
        if toggleTrack != nil {
            isAnimating = true
            updateIcon()
        }

        var req = CanvasRequest(action: "resume")
        req.id = toggleId
        _ = canvasManager.handle(req)
        updateIcon()

        if toggleTrack != nil {
            let iconPos = statusItemCGPosition()
            waitUntilCanvasVisible(timeout: visibilityTimeout) { [weak self] in
                guard let self = self else { return }
                _ = self.canvasManager.awaitLifecycleCompletion(
                    canvasIDs: Set([self.toggleId]),
                    action: "enter",
                    timeout: self.lifecycleTimeout
                ) { [weak self] completed in
                    if !completed {
                        fputs("[status-item] enter lifecycle timeout; clearing animation state\n", stderr)
                    }
                    self?.isAnimating = false
                    self?.updateIcon()
                }
                self.canvasManager.postMessageAsync(canvasID: self.toggleId, payload: [
                    "type": "lifecycle",
                    "action": "enter",
                    "origin_x": Int(iconPos.x),
                    "origin_y": Int(iconPos.y),
                ])
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

    private func modifierNames(from flags: NSEvent.ModifierFlags) -> [String] {
        var names: [String] = []
        if flags.contains(.command) { names.append("command") }
        if flags.contains(.option) { names.append("option") }
        if flags.contains(.control) { names.append("control") }
        if flags.contains(.shift) { names.append("shift") }
        return names
    }

    func updateIcon() {
        let image = cachedHexagonIcon(filled: persistentIconFilled)
        statusItem?.button?.image = image
    }

    private var persistentIconFilled: Bool {
        if usesPersistentCanvas {
            return persistentVisible || isAnimating
        }
        let exists = canvasManager.hasCanvas(toggleId)
        let suspended = isCanvasSuspended()
        // Filled = active or animating. Unfilled = suspended, absent, or idle.
        return (exists && !suspended) || isAnimating
    }

    private func cachedHexagonIcon(filled: Bool) -> NSImage {
        if filled {
            if let filledIcon { return filledIcon }
            let image = drawHexagonIcon(filled: true)
            filledIcon = image
            return image
        }
        if let unfilledIcon { return unfilledIcon }
        let image = drawHexagonIcon(filled: false)
        unfilledIcon = image
        return image
    }

    private func log(_ message: String) {
        fputs("[status-item] \(message)\n", stderr)
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
