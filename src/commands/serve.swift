// serve.swift — aos serve: start the unified daemon

import AppKit
import Foundation

func serveCommand(args: [String]) {
    let config = loadConfig()
    let daemon = PerceptionDaemon(config: config)
    daemon.start()

    // Run the main loop (needed for CGEventTap and NSApplication)
    NSApplication.shared.run()
}
