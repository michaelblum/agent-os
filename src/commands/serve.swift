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
    // Accessory policy: no dock icon, no menu bar, but can own key windows
    // and receive mouse/keyboard events. Required for interactive canvases.
    // The daemon socket is deliberately opened from the first queued AppKit
    // turn after launch. Clients must not observe a ready daemon before native
    // hosts such as ScreenCaptureKit can establish their application connection.
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)

    let daemon = UnifiedDaemon(config: config, idleTimeout: idleTimeout)
    let lifecycle = AOSDaemonApplicationLifecycle {
        daemon.start()
    }
    application.delegate = lifecycle

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    withExtendedLifetime(lifecycle) {
        application.run()
    }
}
