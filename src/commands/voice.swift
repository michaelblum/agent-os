import Foundation

func voiceCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        if let subcommand = args.first, !subcommand.hasPrefix("--") {
            printCommandHelp(["voice", subcommand], json: args.contains("--json"))
            exit(0)
        }
        printCommandHelp(["voice"], json: args.contains("--json"))
        exit(0)
    }

    guard let subcommand = args.first else {
        printCommandHelp(["voice"], json: false)
        exit(0)
    }

    let response: [String: Any]?
    switch subcommand {
    case "list":
        response = sendEnvelopeRequest(service: "voice", action: "list", data: [:], autoStartBinary: CommandLine.arguments[0])
    case "leases":
        response = sendEnvelopeRequest(service: "voice", action: "leases", data: [:], autoStartBinary: CommandLine.arguments[0])
    case "bind":
        response = voiceBindEnvelope(args: Array(args.dropFirst()))
    case "final-response":
        response = voiceFinalResponseEnvelope(args: Array(args.dropFirst()))
    default:
        exitError("Unknown voice command: \(subcommand)", code: "UNKNOWN_COMMAND")
    }

    guard let response else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }

    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        if response["error"] != nil {
            FileHandle.standardError.write(s.data(using: .utf8)!)
            FileHandle.standardError.write("\n".data(using: .utf8)!)
            exit(1)
        } else {
            print(s)
        }
    }
}

private func voiceBindEnvelope(args: [String]) -> [String: Any]? {
    var sessionID: String?
    var voiceID: String?

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
            sessionID = args[i]
        case "--voice":
            i += 1
            guard i < args.count else { exitError("--voice requires a value", code: "MISSING_ARG") }
            voiceID = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    guard let sessionID, !sessionID.isEmpty else {
        exitError("bind requires --session-id <id>", code: "MISSING_ARG")
    }
    guard let voiceID, !voiceID.isEmpty else {
        exitError("bind requires --voice <id>", code: "MISSING_ARG")
    }
    return sendEnvelopeRequest(service: "voice", action: "bind", data: [
        "session_id": sessionID,
        "voice_id": voiceID
    ], autoStartBinary: CommandLine.arguments[0])
}

private func voiceFinalResponseEnvelope(args: [String]) -> [String: Any]? {
    var sessionID: String?
    var harness: String?

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
            sessionID = args[i]
        case "--harness":
            i += 1
            guard i < args.count else { exitError("--harness requires a value", code: "MISSING_ARG") }
            harness = args[i]
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    var hookPayload: Any = [String: Any]()
    if let stdinData = try? FileHandle.standardInput.availableData,
       !stdinData.isEmpty {
        guard let stdinText = String(data: stdinData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !stdinText.isEmpty else {
            // empty stdin — keep empty dict
            hookPayload = [String: Any]()
            return buildFinalResponseEnvelope(hookPayload: hookPayload, sessionID: sessionID, harness: harness)
        }
        guard let payloadData = stdinText.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: payloadData) else {
            exitError("voice final-response requires JSON hook payload on stdin", code: "INVALID_JSON")
        }
        hookPayload = parsed
    }

    return buildFinalResponseEnvelope(hookPayload: hookPayload, sessionID: sessionID, harness: harness)
}

private func buildFinalResponseEnvelope(hookPayload: Any, sessionID: String?, harness: String?) -> [String: Any]? {
    var data: [String: Any] = ["hook_payload": hookPayload]
    if let sid = sessionID, !sid.isEmpty { data["session_id"] = sid }
    if let h = harness, !h.isEmpty { data["harness"] = h }
    return sendEnvelopeRequest(service: "voice", action: "final_response", data: data, autoStartBinary: CommandLine.arguments[0])
}
