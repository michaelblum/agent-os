// inspect.swift — aos inspect: live AX element inspector overlay
//
// Combines perception (depth 2) + display (inspector canvas) into one command.
// Creates a floating overlay showing element details under the cursor.
// Ctrl-C to stop. Canvas is connection-scoped and auto-removes.

import Foundation
import CoreGraphics

func inspectCommand(args: [String]) {
    // Parse position (default: bottom-right corner of main display)
    var panelWidth: Double = 320
    var panelHeight: Double = 250
    var panelX: Double? = nil  // nil = auto-position
    var panelY: Double? = nil

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
                } else if parts.count >= 2 {
                    panelX = parts[0]; panelY = parts[1]
                }
            }
        case "--size":
            i += 1
            if i < args.count {
                let parts = args[i].split(separator: ",").compactMap { Double($0) }
                if parts.count >= 2 { panelWidth = parts[0]; panelHeight = parts[1] }
            }
        default:
            break
        }
        i += 1
    }

    // Auto-position: bottom-right of main display with 20px margin
    if panelX == nil || panelY == nil {
        let mainBounds = CGDisplayBounds(CGMainDisplayID())
        panelX = mainBounds.width - panelWidth - 20
        panelY = mainBounds.height - panelHeight - 20
    }

    // Read the inspector HTML from the toolkit
    let htmlPath = findInspectorHTML()
    guard let htmlData = FileManager.default.contents(atPath: htmlPath),
          let html = String(data: htmlData, encoding: .utf8) else {
        exitError("Cannot read inspector-panel.html at \(htmlPath)", code: "FILE_NOT_FOUND")
    }

    // Connect to daemon
    let fd = connectInspectDaemon()

    // Set up signal handler for clean exit
    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped inspector canvas
    let createReq: [String: Any] = [
        "action": "create",
        "id": "__inspector__",
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "html": html,
        "scope": "connection"
    ]
    sendInspectJSONAndReadResponse(fd: fd, json: createReq)

    // Subscribe to perception at depth 2
    let subReq: [String: Any] = [
        "action": "perceive",
        "depth": 2,
        "scope": "cursor",
        "rate": "on-settle"
    ]
    sendInspectJSONAndReadResponse(fd: fd, json: subReq)

    fputs("Inspector active. Move cursor to inspect elements. Ctrl-C to stop.\n", stderr)

    // Read event loop
    var buffer = Data()
    var chunk = [UInt8](repeating: 0, count: 4096)

    while true {
        let bytesRead = read(fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection lost.\n", stderr)
            break
        }
        buffer.append(contentsOf: chunk[0..<bytesRead])

        while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
            let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
            buffer = Data(buffer[(buffer.index(after: newlineIndex))...])

            guard let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any] else { continue }

            // Only process envelope events (have "v" field)
            guard json["v"] != nil,
                  let event = json["event"] as? String,
                  let data = json["data"] as? [String: Any] else { continue }

            switch event {
            case "element_focused":
                // Push element data to inspector canvas
                let jsData = inspectJsonStringForJS(data)
                let evalReq: [String: Any] = [
                    "action": "eval",
                    "id": "__inspector__",
                    "js": "updateElement(\(jsData))"
                ]
                sendInspectJSONNoResponse(fd: fd, json: evalReq)

            case "cursor_moved", "cursor_settled":
                if let x = data["x"] as? Double,
                   let y = data["y"] as? Double,
                   let display = data["display"] as? Int {
                    let evalReq: [String: Any] = [
                        "action": "eval",
                        "id": "__inspector__",
                        "js": "updateCursor(\(x),\(y),\(display))"
                    ]
                    sendInspectJSONNoResponse(fd: fd, json: evalReq)
                }

            default:
                break
            }
        }
    }

    close(fd)
}

// MARK: - Helpers

/// Find the inspector HTML file. Checks relative to binary, then fallback paths.
private func findInspectorHTML() -> String {
    let candidates = [
        // Relative to binary location
        (CommandLine.arguments[0] as NSString).deletingLastPathComponent + "/../packages/toolkit/components/inspector-panel.html",
        // Relative to working directory
        "packages/toolkit/components/inspector-panel.html",
        // Absolute fallback
        NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/inspector-panel.html").expandingTildeInPath
    ]
    for path in candidates {
        let resolved = (path as NSString).standardizingPath
        if FileManager.default.fileExists(atPath: resolved) { return resolved }
    }
    return candidates.last!  // Will fail with a clear error
}

/// Connect to daemon socket with retry.
private func connectInspectDaemon() -> Int32 {
    // Try connecting; if daemon not running, try starting it
    var fd = tryInspectConnect()
    if fd < 0 {
        // Try to auto-start daemon
        fputs("Starting daemon...\n", stderr)
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        proc.arguments = ["serve", "--idle-timeout", "5m"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try? proc.run()

        // Wait up to 3 seconds for daemon to start
        for _ in 0..<30 {
            usleep(100_000)
            fd = tryInspectConnect()
            if fd >= 0 { break }
        }
    }
    guard fd >= 0 else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }
    return fd
}

private func tryInspectConnect() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    let result = withSockAddr(kAosSocketPath) { addr, len in connect(fd, addr, len) }
    if result != 0 { close(fd); return -1 }
    return fd
}

/// Send JSON and read one response line.
private func sendInspectJSONAndReadResponse(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }

    // Read response (single line)
    var buf = [UInt8](repeating: 0, count: 4096)
    let n = read(fd, &buf, buf.count)
    // Response consumed — don't need to parse it for the orchestrator
    _ = n
}

/// Send JSON without reading response (fire-and-forget for eval).
private func sendInspectJSONNoResponse(fd: Int32, json: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    data.append(contentsOf: "\n".utf8)
    data.withUnsafeBytes { ptr in _ = write(fd, ptr.baseAddress!, ptr.count) }
}

/// Convert a dictionary to a JSON string safe for embedding in JS.
private func inspectJsonStringForJS(_ dict: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
          let str = String(data: data, encoding: .utf8) else { return "{}" }
    return str
}
