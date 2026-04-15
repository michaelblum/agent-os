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
        mgr.setup()
        statusItem.manager = mgr
    }

    // Update status item icon when canvas count changes
    let existingCallback = daemon.canvasManager.onCanvasCountChanged
    daemon.canvasManager.onCanvasCountChanged = { [weak statusItem] in
        existingCallback?()
        statusItem?.manager?.updateIcon()
    }

    // Watch config for status item changes
    daemon.configChangeHandler = { [weak statusItem, weak daemon] newConfig in
        guard let daemon = daemon, let statusItem = statusItem else { return }
        if let siConfig = newConfig.status_item, siConfig.enabled {
            if let mgr = statusItem.manager {
                mgr.updateConfig(siConfig)
            } else {
                let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: siConfig)
                mgr.urlResolver = { [weak daemon] url in daemon?.resolveContentURL(url) ?? url }
                mgr.setup()
                statusItem.manager = mgr
            }
        } else {
            statusItem.manager?.teardown()
            statusItem.manager = nil
        }
    }

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
