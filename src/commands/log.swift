// log.swift — aos log: visible log console panel
//
// Creates a scrolling log overlay. Two modes:
//   aos log                — stream: reads stdin, pushes each line to console
//   aos log push "msg"     — one-shot: pushes a single message and exits
//   aos log clear           — clears the log console

import Foundation
import CoreGraphics

func logCommand(args: [String]) {
    let sub = args.first

    // Parse position
    var panelWidth: Double = 450
    var panelHeight: Double = 300
    var panelX: Double? = nil
    var panelY: Double? = nil
    var level = "info"

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--at":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 4 {
                    panelX = parts[0]; panelY = parts[1]
                    panelWidth = parts[2]; panelHeight = parts[3]
                }
            }
        case "--level":
            i += 1
            if i < args.count { level = args[i] }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-left with margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = 20
        panelY = mainBounds.height - panelHeight - 20
    }

    switch sub {
    case "push":
        let message = args.dropFirst().filter { !$0.hasPrefix("--") && $0 != "push" }.joined(separator: " ")
        guard !message.isEmpty else {
            exitError("Usage: aos log push <message>", code: "MISSING_TEXT")
        }
        logPushMessage(message, level: level)
        return

    case "clear":
        logClearConsole()
        return

    default:
        break
    }

    // Stream mode: create console and read stdin
    let htmlPath = findLogHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read log-console.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    let session = DaemonSession()
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped log canvas
    session.sendAndReceive([
        "action": "create",
        "id": "__log__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ])

    fputs("Log console active. Reading stdin. Ctrl-C to stop.\n", stderr)

    evalLog(session: session, message: "Log console started", level: "debug")

    // Read stdin line by line
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }

        if line.hasPrefix("{"),
           let data = line.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? String {
            let lvl = json["level"] as? String ?? level
            evalLog(session: session, message: msg, level: lvl)
        } else {
            evalLog(session: session, message: line, level: level)
        }
    }

    session.disconnect()
}

// MARK: - Helpers

private func evalLog(session: DaemonSession, message: String, level: String) {
    let escaped = message
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: "\\n")
    let js = "pushLog('\(escaped)','\(level)')"
    session.sendOnly(["action": "eval", "id": "__log__", "js": js])
}

private func logPushMessage(_ message: String, level: String) {
    let session = DaemonSession()
    guard session.connect() else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    evalLog(session: session, message: message, level: level)
    // Read response to flush
    _ = session.readOneJSON()
    session.disconnect()
    print("{\"status\":\"ok\"}")
}

private func logClearConsole() {
    let result = daemonOneShot(
        ["action": "eval", "id": "__log__", "js": "clearLog()"]
    )
    if result != nil {
        print("{\"status\":\"ok\"}")
    } else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
}

private func findLogHTML() -> String {
    let candidates = [
        aosRepoPath("packages/toolkit/components/log-console.html"),
        "packages/toolkit/components/log-console.html",
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!
}
