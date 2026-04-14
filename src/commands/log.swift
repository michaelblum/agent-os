// log.swift — aos log: visible log console panel
//
// Creates a scrolling log overlay. Two modes:
//   aos log                — stream: reads stdin, pushes each line to console
//   aos log push "msg"     — one-shot: pushes a single message and exits
//   aos log clear           — clears the log console

import Foundation
import CoreGraphics

private let LOG_CANVAS_ID = "__log__"
private let LOG_URL = "aos://toolkit/components/log-console/index.html"

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

    // Stream mode
    let session = DaemonSession()
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped log canvas
    session.sendAndReceive([
        "action": "create",
        "id": LOG_CANVAS_ID,
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "url": LOG_URL,
        "scope": "connection"
    ])

    fputs("Log console active. Reading stdin. Ctrl-C to stop.\n", stderr)

    pushLogEntry(session: session, message: "Log console started", level: "debug")

    // Read stdin line by line
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }

        if line.hasPrefix("{"),
           let data = line.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? String {
            let lvl = json["level"] as? String ?? level
            pushLogEntry(session: session, message: msg, level: lvl)
        } else {
            pushLogEntry(session: session, message: line, level: level)
        }
    }

    session.disconnect()
}

// MARK: - Helpers

private func pushLogEntry(session: DaemonSession, message: String, level: String) {
    sendHeadsupMessage(session: session, canvasID: LOG_CANVAS_ID, payload: [
        "type": "log",
        "message": message,
        "level": level
    ])
}

private func logPushMessage(_ message: String, level: String) {
    let session = DaemonSession()
    guard session.connect() else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    pushLogEntry(session: session, message: message, level: level)
    _ = session.readOneJSON()
    session.disconnect()
    print("{\"status\":\"ok\"}")
}

private func logClearConsole() {
    if sendHeadsupMessageOneShot(canvasID: LOG_CANVAS_ID, payload: ["type": "clear"]) != nil {
        print("{\"status\":\"ok\"}")
    } else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
}
