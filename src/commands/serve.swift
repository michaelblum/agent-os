// serve.swift — aos serve: start the unified daemon

import AppKit
import Foundation

func serveCommand(args: [String]) {
    // Parse idle timeout
    var idleTimeout: TimeInterval = 300  // 5 minutes default
    var i = 0
    while i < args.count {
        if args[i] == "--idle-timeout" {
            i += 1
            if i < args.count { idleTimeout = parseDuration(args[i]) }
        }
        i += 1
    }

    let config = loadConfig()
    let daemon = UnifiedDaemon(config: config, idleTimeout: idleTimeout)
    daemon.start()

    func ensurePersistentToggleCanvas(_ manager: StatusItemManager?) {
        guard let manager, manager.usesPersistentCanvas, !manager.toggleUrl.isEmpty else { return }
        guard !daemon.canvasManager.hasCanvas(manager.toggleId) else { return }
        var req = CanvasRequest(action: "create")
        req.id = manager.toggleId
        req.url = manager.toggleUrl
        req.interactive = false
        if let track = manager.toggleTrack { req.track = track }
        _ = daemon.canvasManager.handle(req)
        manager.setPersistentVisible(false)
    }

    // Accessory policy: no dock icon, no menu bar, but can own key windows
    // and receive mouse/keyboard events. Required for interactive canvases.
    //
    // Note: use NSApplication.shared (not the NSApp global) to force
    // initialization of the singleton. Accessing NSApp before NSApplication.shared
    // has been evaluated traps, because NSApp is an implicitly-unwrapped optional
    // that is only assigned as a side effect of NSApplication.shared's first access.
    NSApplication.shared.setActivationPolicy(.accessory)

    // Status item (menu bar icon) — holder class provides explicit ownership
    // and ensures onCanvasCountChanged always reaches the current manager.
    class StatusItemHolder { var manager: StatusItemManager? }
    let statusItem = StatusItemHolder()
    if let siConfig = config.status_item, siConfig.enabled {
        let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: siConfig)
        mgr.urlResolver = { [weak daemon] url in daemon?.resolveContentURL(url) ?? url }
        mgr.lastPositionResolver = { [weak daemon] key in daemon?.getLastPosition(key: key) }
        mgr.setup()
        statusItem.manager = mgr
        ensurePersistentToggleCanvas(mgr)
    }

    // Update status item icon when canvas count changes
    let existingCallback = daemon.canvasManager.onCanvasCountChanged
    daemon.canvasManager.onCanvasCountChanged = { [weak statusItem] in
        existingCallback?()
        statusItem?.manager?.updateIcon()
    }

    let existingCanvasEvent = daemon.canvasManager.onEvent
    daemon.canvasManager.onEvent = { [weak statusItem] canvasID, payload in
        existingCanvasEvent?(canvasID, payload)
        guard let manager = statusItem?.manager,
              canvasID == manager.toggleId,
              let dict = payload as? [String: Any],
              let type = dict["type"] as? String,
              type == "status_item.state",
              let inner = dict["payload"] as? [String: Any],
              let visible = inner["visible"] as? Bool else { return }
        DispatchQueue.main.async {
            manager.setPersistentVisible(visible)
        }
    }

    // Route canvas-provided menu items to status item
    daemon.canvasManager.onMenuItems = { [weak statusItem] canvasID, items in
        DispatchQueue.main.async {
            guard let mgr = statusItem?.manager, canvasID == mgr.toggleId else { return }
            mgr.setMenuItems(items)
        }
    }

    // Watch config for status item changes.
    // ConfigWatcher fires on a background queue; NSStatusBar requires main thread.
    daemon.configChangeHandler = { [weak statusItem, weak daemon] newConfig in
        DispatchQueue.main.async { [weak statusItem, weak daemon] in
            guard let daemon = daemon, let statusItem = statusItem else { return }
            if let siConfig = newConfig.status_item, siConfig.enabled {
                if let mgr = statusItem.manager {
                    mgr.updateConfig(siConfig)
                    ensurePersistentToggleCanvas(mgr)
                } else {
                    let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: siConfig)
                    mgr.urlResolver = { [weak daemon] url in daemon?.resolveContentURL(url) ?? url }
                    mgr.lastPositionResolver = { [weak daemon] key in daemon?.getLastPosition(key: key) }
                    mgr.setup()
                    statusItem.manager = mgr
                    ensurePersistentToggleCanvas(mgr)
                }
            } else {
                statusItem.manager?.teardown()
                statusItem.manager = nil
            }
        }
    }

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
