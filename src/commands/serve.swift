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

    // Status item (menu bar icon) — configured via config file
    var statusItemManager: StatusItemManager?
    if config.status_item?.enabled == true {
        let mgr = StatusItemManager(canvasManager: daemon.canvasManager, config: config.status_item!)
        mgr.setup()
        mgr.urlResolver = { [weak daemon] url in
            daemon?.resolveContentURL(url) ?? url
        }
        statusItemManager = mgr
        // Chain onto the existing onCanvasCountChanged (which handles idle checking)
        let existingHandler = daemon.canvasManager.onCanvasCountChanged
        daemon.canvasManager.onCanvasCountChanged = { [weak statusItemManager] in
            existingHandler?()
            statusItemManager?.updateIcon()
        }
    }
    _ = statusItemManager  // retain

    // Accessory policy: no dock icon, no menu bar, but can own key windows
    // and receive mouse/keyboard events. Required for interactive canvases.
    NSApp.setActivationPolicy(.accessory)

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
