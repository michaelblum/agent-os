// serve.swift — aos serve: start the unified daemon

import AppKit
import Foundation

func serveCommand(args: [String]) {
    // Temporary: PerceptionEngine doesn't own a socket anymore.
    // UnifiedDaemon (Task 5) will replace this.
    fputs("Error: serve requires UnifiedDaemon (not yet implemented)\n", stderr)
    exit(1)
}
