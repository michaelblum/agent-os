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
        // One-shot: push a single message to existing log console
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

    let fd = connectToLogDaemon()

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped log canvas
    let createReq: [String: Any] = [
        "action": "create",
        "id": "__log__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ]
    sendLogJSON(fd: fd, json: createReq)
    // Read response
    var respBuf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &respBuf, respBuf.count)

    fputs("Log console active. Reading stdin. Ctrl-C to stop.\n", stderr)

    // Push initial entry
    evalLog(fd: fd, message: "Log console started", level: "debug")

    // Read stdin line by line
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }

        // Try to parse as JSON {message, level}
        if line.hasPrefix("{"),
           let data = line.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let msg = json["message"] as? String {
            let lvl = json["level"] as? String ?? level
            evalLog(fd: fd, message: msg, level: lvl)
        } else {
            evalLog(fd: fd, message: line, level: level)
        }
    }

    close(fd)
}

// MARK: - Helpers

private func evalLog(fd: Int32, message: String, level: String) {
    let escaped = message
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: "\\n")
    let js = "pushLog('\(escaped)','\(level)')"
    let evalReq: [String: Any] = ["action": "eval", "id": "__log__", "js": js]
    sendLogJSON(fd: fd, json: evalReq)
    // Don't read response — fire and forget for streaming
}

private func logPushMessage(_ message: String, level: String) {
    // Connect to daemon and eval on existing __log__ canvas
    let fd = tryLogConnect()
    guard fd >= 0 else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    evalLog(fd: fd, message: message, level: level)
    // Read response to flush
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
    close(fd)
    print("{\"status\":\"ok\"}")
}

private func logClearConsole() {
    let fd = tryLogConnect()
    guard fd >= 0 else {
        exitError("Daemon not running or no log console active", code: "CONNECT_ERROR")
    }
    let evalReq: [String: Any] = ["action": "eval", "id": "__log__", "js": "clearLog()"]
    sendLogJSON(fd: fd, json: evalReq)
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
    close(fd)
    print("{\"status\":\"ok\"}")
}

private func findLogHTML() -> String {
    let candidates = [
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/log-console.html",
        "packages/toolkit/components/log-console.html",
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/log-console.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!
}

private func connectToLogDaemon() -> Int32 {
    var fd = tryLogConnect()
    if fd < 0 {
        fputs("Starting daemon...\n", stderr)
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()
        for _ in 0..<30 {
            usleep(100_000)
            fd = tryLogConnect()
            if fd >= 0 { break }
        }
    }
    guard fd >= 0 else {
        exitError("Cannot connect to daemon", code: "CONNECT_ERROR")
    }
    return fd
}

private func tryLogConnect() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    let result = withSocketAddress(kDefaultSocketPath) { addr, len in connect(fd, addr, len) }
    if result != 0 { close(fd); return -1 }
    return fd
}

private func sendLogJSON(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }
}
