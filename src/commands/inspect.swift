// inspect.swift — aos inspect: live AX element inspector overlay
//
// Combines perception (depth 2) + display (inspector canvas) into one command.
// Creates a floating overlay showing element details under the cursor.
// Ctrl-C to stop. Canvas is connection-scoped and auto-removes.

import Foundation
import CoreGraphics

private let INSPECTOR_CANVAS_ID = "__inspector__"
private let INSPECTOR_URL = "aos://toolkit/components/inspector-panel/index.html"

func inspectCommand(args: [String]) {
    ensureInteractivePreflight(command: "aos inspect")

    // Parse position (default: bottom-right corner of main display)
    var panelWidth: Double = 320
    var panelHeight: Double = 250
    var panelX: Double? = nil
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

    // Connect to daemon (persistent session for the lifetime of the command)
    let session = DaemonSession()
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon. Run 'aos serve' first.", code: "CONNECT_ERROR")
    }

    signal(SIGINT) { _ in exit(0) }
    signal(SIGTERM) { _ in exit(0) }

    // Create connection-scoped inspector canvas
    session.sendAndReceive([
        "action": "create",
        "id": INSPECTOR_CANVAS_ID,
        "at": [panelX!, panelY!, panelWidth, panelHeight],
        "url": INSPECTOR_URL,
        "scope": "connection"
    ])

    // Subscribe to perception at depth 2
    session.sendAndReceive([
        "action": "perceive",
        "depth": 2,
        "scope": "cursor",
        "rate": "on-settle"
    ])

    fputs("Inspector active. Move cursor to inspect elements. Ctrl-C to stop.\n", stderr)

    // Event loop: read ndjson from the subscribed connection.
    // This fd now receives both perception events and eval responses.
    // We filter for envelope events (have "v" field) and discard eval responses.
    var reader = NDJSONReader()
    var chunk = [UInt8](repeating: 0, count: 4096)

    while true {
        let bytesRead = read(session.fd, &chunk, chunk.count)
        guard bytesRead > 0 else {
            fputs("Daemon connection lost.\n", stderr)
            break
        }
        reader.append(chunk, count: bytesRead)

        while let json = reader.nextJSON() {
            // Only process envelope events
            guard let envelope = decodeEnvelope(json) else { continue }

            switch envelope.event {
            case "element_focused":
                sendHeadsupMessage(session: session, canvasID: INSPECTOR_CANVAS_ID, payload: [
                    "type": "inspector/element",
                    "payload": envelope.data
                ])

            case "cursor_moved", "cursor_settled":
                if let x = envelope.data["x"] as? Double,
                   let y = envelope.data["y"] as? Double,
                   let display = envelope.data["display"] as? Int {
                    sendHeadsupMessage(session: session, canvasID: INSPECTOR_CANVAS_ID, payload: [
                        "type": "inspector/cursor",
                        "payload": [
                            "x": x,
                            "y": y,
                            "display": display
                        ]
                    ])
                }

            default:
                break
            }
        }
    }

    session.disconnect()
}
