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

    let request: [String: Any]
    switch subcommand {
    case "list":
        request = ["action": "voice-list"]
    case "leases":
        request = ["action": "voice-leases"]
    case "bind":
        request = voiceBindRequest(args: Array(args.dropFirst()))
    case "final-response":
        request = voiceFinalResponseRequest(args: Array(args.dropFirst()))
    default:
        exitError("Unknown voice command: \(subcommand)", code: "UNKNOWN_COMMAND")
    }

    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
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

private func voiceBindRequest(args: [String]) -> [String: Any] {
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
    return [
        "action": "voice-bind",
        "session_id": sessionID,
        "voice_id": voiceID
    ]
}

private func voiceFinalResponseRequest(args: [String]) -> [String: Any] {
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

    var request: [String: Any] = ["action": "voice-final-response"]
    if let sessionID, !sessionID.isEmpty {
        request["session_id"] = sessionID
    }
    if let harness, !harness.isEmpty {
        request["harness"] = harness
    }

    if let stdinData = try? FileHandle.standardInput.availableData,
       !stdinData.isEmpty {
        guard let stdinText = String(data: stdinData, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !stdinText.isEmpty else {
            return request
        }
        guard let payloadData = stdinText.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: payloadData) else {
            exitError("voice final-response requires JSON hook payload on stdin", code: "INVALID_JSON")
        }
        request["hook_payload"] = payload
    }

    return request
}
