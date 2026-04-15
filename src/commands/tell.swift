// tell.swift — aos tell: outbound communication command
//
// Usage:
//   aos tell <audience> "message"       Post text to audience(s)
//   aos tell <audience> --json <data>   Post structured JSON to audience(s)
//   aos tell --register <name>          Register session presence
//   aos tell --who                      List online sessions
//
// Audiences: human, <channel-name>, <session-name>, comma-separated mix

import Foundation

func tellCommand(args: [String]) {
    // Subcommands
    if args.contains("--who") {
        tellWho()
        return
    }
    if let idx = args.firstIndex(of: "--register") {
        guard idx + 1 < args.count else {
            exitError("--register requires a session name", code: "MISSING_ARG")
        }
        let name = args[idx + 1]
        let role = tellGetArg(args, "--role") ?? "worker"
        let harness = tellGetArg(args, "--harness") ?? "unknown"
        tellRegister(name: name, role: role, harness: harness)
        return
    }

    // Main form: aos tell <audience> [--json <data>] [text...]
    guard let audience = args.first, !audience.hasPrefix("--") else {
        exitError("Usage: aos tell <audience> \"message\" | aos tell --register <name> | aos tell --who", code: "MISSING_ARG")
    }

    let rest = Array(args.dropFirst())
    var jsonData: String? = nil
    var textParts: [String] = []
    var from: String? = nil

    var i = 0
    while i < rest.count {
        switch rest[i] {
        case "--json":
            i += 1
            guard i < rest.count else { exitError("--json requires a value", code: "MISSING_ARG") }
            jsonData = rest[i]
        case "--from":
            i += 1
            guard i < rest.count else { exitError("--from requires a value", code: "MISSING_ARG") }
            from = rest[i]
        default:
            if !rest[i].hasPrefix("--") {
                textParts.append(rest[i])
            }
        }
        i += 1
    }

    // Check stdin if no text args and no --json
    var text = textParts.joined(separator: " ")
    if text.isEmpty && jsonData == nil {
        if let stdinData = try? FileHandle.standardInput.availableData,
           !stdinData.isEmpty,
           let stdinText = String(data: stdinData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !stdinText.isEmpty {
            text = stdinText
        }
    }

    guard !text.isEmpty || jsonData != nil else {
        exitError("Usage: aos tell <audience> \"message\"", code: "MISSING_TEXT")
    }

    // Build daemon request
    var request: [String: Any] = [
        "action": "tell",
        "audience": audience
    ]
    if !text.isEmpty { request["text"] = text }
    if let from = from { request["from"] = from }
    if let jd = jsonData {
        // Parse JSON string into object for structured payload
        if let data = jd.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) {
            request["payload"] = parsed
        } else {
            exitError("Invalid JSON: \(jd)", code: "INVALID_JSON")
        }
    }

    // Send to daemon
    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }

    // Output response
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

// MARK: - Subcommands

private func tellRegister(name: String, role: String, harness: String) {
    let request: [String: Any] = [
        "action": "coord-register",
        "name": name,
        "role": role,
        "harness": harness
    ]
    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

private func tellWho() {
    let request: [String: Any] = ["action": "coord-who"]
    guard let response = daemonOneShot(request, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

/// Arg parser helper: find --key and return next arg
private func tellGetArg(_ args: [String], _ key: String) -> String? {
    guard let idx = args.firstIndex(of: key), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}
