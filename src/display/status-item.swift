// status-item.swift — Generic menu bar icon for a warm target canvas.
//
// Config-driven: status_item.enabled, toggle_id, toggle_url, toggle_at, toggle_track, icon.
// Left-click sends toggle intent to a persistent canvas instead of managing
// the canvas lifecycle itself.

import AppKit
import Foundation

class StatusItemManager {
    private static let accessibilityLabel = "AOS status item"
    private let lifecycleTimeout: TimeInterval = 1.0
    private let visibilityTimeout: TimeInterval = 8.0
    private let canvasInspectorId = "surface-inspector"
    private let logConsoleId = "__log__"
    private let canvasInspectorUrl = "aos://toolkit/components/surface-inspector/index.html"
    private let logConsoleUrl = "aos://toolkit/components/log-console/index.html"

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
    private var canvasInspectorAnnotationModeActive = false
    private var filledIcon: NSImage?
    private var unfilledIcon: NSImage?
    private let positionFile: String
    private let utilityStateFile: String
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
        self.utilityStateFile = (kAosConfigPath as NSString)
            .deletingLastPathComponent
            .appending("/status-item-utility-panels.json")
    }

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
        statusItem?.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem?.button?.toolTip = Self.accessibilityLabel
        statusItem?.button?.setAccessibilityLabel(Self.accessibilityLabel)
        restoreUtilityPanels()
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
        }
        if !usesPersistentCanvas {
            hasPersistentStateSource = false
            persistentVisible = canvasManager.hasCanvas(toggleId) && !isCanvasSuspended()
        } else if !canvasManager.hasCanvas(toggleId) {
            persistentVisible = false
        }
        updateIcon()
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

    func setMenuItems(_ items: [[String: String]]) {
        customMenuItems = items
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
        let logItem = NSMenuItem(title: "Console Log", action: #selector(menuLogConsole), keyEquivalent: "")
        logItem.target = self
        logItem.state = isUtilityCanvasVisible(id: logConsoleId) ? .on : .off
        menu.addItem(logItem)

        let inspectorItem = NSMenuItem(title: "Surface Inspector", action: #selector(menuCanvasInspector), keyEquivalent: "")
        inspectorItem.target = self
        inspectorItem.state = isUtilityCanvasVisible(id: canvasInspectorId) ? .on : .off
        menu.addItem(inspectorItem)

        let annotateItem = NSMenuItem(title: "Annotation Mode", action: #selector(menuCanvasInspectorAnnotateMode), keyEquivalent: "")
        annotateItem.target = self
        annotateItem.state = isCanvasInspectorAnnotationModeVisibleAndActive ? .on : .off
        menu.addItem(annotateItem)

        if !toggleUrl.isEmpty {
            menu.addItem(NSMenuItem.separator())
            let reloadItem = NSMenuItem(title: "Reload", action: #selector(menuReload), keyEquivalent: "r")
            reloadItem.target = self
            reloadItem.isEnabled = !isAnimating
            menu.addItem(reloadItem)
        }

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
        let pos = NSPoint(x: 0, y: button.bounds.minY)
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

    @objc private func menuReload() {
        reloadCanvas()
    }

    @objc private func menuCanvasInspector() {
        toggleUtilityCanvas(
            id: canvasInspectorId,
            url: canvasInspectorUrl,
            frame: canvasInspectorFrame()
        )
    }

    @objc private func menuCanvasInspectorAnnotateMode() {
        showUtilityCanvas(
            id: canvasInspectorId,
            url: canvasInspectorUrl,
            frame: canvasInspectorFrame()
        )
        canvasManager.postMessageAsync(canvasID: canvasInspectorId, payload: [
            "type": "canvas_inspector.annotation_toggle",
            "reason": "status_item_menu",
        ])
    }

    @objc private func menuLogConsole() {
        toggleUtilityCanvas(
            id: logConsoleId,
            url: logConsoleUrl,
            frame: logConsoleFrame()
        )
    }

    @objc private func menuQuit() {
        NSApp.terminate(nil)
    }

    private func toggleUtilityCanvas(id: String, url: String, frame: [CGFloat], restoring: Bool = false) {
        if canvasManager.hasCanvas(id) {
            if isUtilityCanvasSuspended(id: id) {
                var resume = CanvasRequest(action: "resume")
                resume.id = id
                _ = canvasManager.handle(resume)
                if !restoring {
                    canvasManager.canvas(forID: id)?.grabFocus()
                }
                persistUtilityCanvasVisible(id: id, visible: true)
            } else {
                var suspend = CanvasRequest(action: "suspend")
                suspend.id = id
                _ = canvasManager.handle(suspend)
                persistUtilityCanvasVisible(id: id, visible: false)
                if id == canvasInspectorId {
                    resetCanvasInspectorAnnotationMode()
                }
            }
            return
        }

        var req = CanvasRequest(action: "create")
        req.id = id
        req.url = urlResolver?(url) ?? url
        req.at = frame
        req.interactive = true
        req.focus = !restoring
        req.suspended = false
        _ = canvasManager.handle(req)
        persistUtilityCanvasVisible(id: id, visible: true)
    }

    private func showUtilityCanvas(id: String, url: String, frame: [CGFloat]) {
        if canvasManager.hasCanvas(id) {
            if isUtilityCanvasSuspended(id: id) {
                var resume = CanvasRequest(action: "resume")
                resume.id = id
                _ = canvasManager.handle(resume)
            }
            canvasManager.canvas(forID: id)?.grabFocus()
            persistUtilityCanvasVisible(id: id, visible: true)
            return
        }

        var req = CanvasRequest(action: "create")
        req.id = id
        req.url = urlResolver?(url) ?? url
        req.at = frame
        req.interactive = true
        req.focus = true
        req.suspended = false
        _ = canvasManager.handle(req)
        persistUtilityCanvasVisible(id: id, visible: true)
    }

    private func restoreUtilityPanels() {
        let state = loadUtilityPanelState()
        if state[logConsoleId] == true {
            toggleUtilityCanvas(
                id: logConsoleId,
                url: logConsoleUrl,
                frame: logConsoleFrame(),
                restoring: true
            )
        }
        if state[canvasInspectorId] == true {
            toggleUtilityCanvas(
                id: canvasInspectorId,
                url: canvasInspectorUrl,
                frame: canvasInspectorFrame(),
                restoring: true
            )
        }
    }

    private func isUtilityCanvasVisible(id: String) -> Bool {
        canvasManager.hasCanvas(id) && !isUtilityCanvasSuspended(id: id)
    }

    private var isCanvasInspectorAnnotationModeVisibleAndActive: Bool {
        isUtilityCanvasVisible(id: canvasInspectorId) && canvasInspectorAnnotationModeActive
    }

    func setCanvasInspectorAnnotationModeActive(_ active: Bool) {
        canvasInspectorAnnotationModeActive = active && isUtilityCanvasVisible(id: canvasInspectorId)
    }

    func resetCanvasInspectorAnnotationMode() {
        canvasInspectorAnnotationModeActive = false
    }

    private func isUtilityCanvasSuspended(id: String) -> Bool {
        canvasManager.canvas(forID: id)?.suspended == true
    }

    private func createUtilityCanvas(id: String, url: String, frame: [CGFloat], suspended: Bool, focus: Bool) {
        var req = CanvasRequest(action: "create")
        req.id = id
        req.url = urlResolver?(url) ?? url
        req.at = frame
        req.interactive = true
        req.focus = focus
        req.suspended = suspended
        _ = canvasManager.handle(req)
    }

    private func loadUtilityPanelState() -> [String: Bool] {
        guard let data = FileManager.default.contents(atPath: utilityStateFile),
              let dict = try? JSONDecoder().decode([String: Bool].self, from: data) else {
            return [:]
        }
        return dict
    }

    private func persistUtilityCanvasVisible(id: String, visible: Bool) {
        var dict = loadUtilityPanelState()
        dict[id] = visible

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(dict) {
            try? data.write(to: URL(fileURLWithPath: utilityStateFile))
        }
    }

    private func canvasInspectorFrame() -> [CGFloat] {
        let visible = mainVisibleFrameInCG()
        let width = min(CGFloat(360.0), max(CGFloat(320.0), visible.width * 0.26))
        let height = min(CGFloat(520.0), max(CGFloat(420.0), visible.height * 0.55))
        let x = visible.x + visible.width - width - 20.0
        let y = visible.y + 20.0
        return [x, y, width, height]
    }

    private func logConsoleFrame() -> [CGFloat] {
        let visible = mainVisibleFrameInCG()
        let width = min(CGFloat(520.0), max(CGFloat(420.0), visible.width * 0.32))
        let height = min(CGFloat(320.0), max(CGFloat(260.0), visible.height * 0.32))
        let x = visible.x + 20.0
        let y = visible.y + visible.height - height - 20.0
        return [x, y, width, height]
    }

    private func mainVisibleFrameInCG() -> (x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            return (0, 0, 1512, 875)
        }
        let visible = screen.visibleFrame
        let screenHeight = screen.frame.height
        let cgY = screenHeight - visible.origin.y - visible.height
        return (
            visible.origin.x,
            cgY,
            visible.width,
            visible.height
        )
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

    // MARK: - Dismiss (hard remove — daemon restart / full teardown)

    private func removeCanvasTree(_ rootId: String) {
        for id in canvasManager.collectTree(rootId).reversed() {
            guard canvasManager.hasCanvas(id) else { continue }
            var rm = CanvasRequest(action: "remove")
            rm.id = id
            _ = canvasManager.handle(rm)
        }
    }

    private func reloadCanvas() {
        guard !toggleUrl.isEmpty else { return }
        let origin = statusItemCGPosition()
        let modifiers = modifierNames(from: NSApp.currentEvent?.modifierFlags ?? [])
        let existed = canvasManager.hasCanvas(toggleId)
        log("reload target=\(toggleId) existed=\(existed) persistent=\(usesPersistentCanvas)")

        isAnimating = true
        updateIcon()
        if existed {
            removeCanvasTree(toggleId)
        }
        hasPersistentStateSource = false
        persistentVisible = false
        summonCanvas()

        if usesPersistentCanvas {
            waitUntilPersistentCanvasReady(timeout: visibilityTimeout) { [weak self] ready in
                guard let self = self else { return }
                if !ready {
                    self.log("reload target=\(self.toggleId) readiness timed out; posting visible intent fallback")
                }
                self.isAnimating = false
                self.showPersistentCanvas(origin: origin, modifiers: modifiers)
            }
        }
    }

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
