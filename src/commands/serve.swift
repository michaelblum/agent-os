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

    // Run the main loop (needed for CGEventTap, NSWindow, WKWebView)
    NSApplication.shared.run()
}
