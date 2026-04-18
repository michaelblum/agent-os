// tell.swift — aos tell: outbound communication command
//
// Usage:
//   aos tell <audience> "message"                         Post text to audience(s)
//   aos tell --session-id <id> "message"                 Post directly to a session channel
//   aos tell <audience> --json <data>                    Post structured JSON to audience(s)
//   aos tell human --from-session-id <id> --purpose final_response [text|stdin]
//   aos tell --register --session-id <id> [--name <n>]   Register session presence
//   aos tell --unregister --session-id <id>              Remove session presence
//   aos tell --who                                       List online sessions
//
// Audiences: human, <channel-name>, <session-id>, comma-separated mix

import Foundation

func tellCommand(args: [String]) {
    // Subcommands
    if args.contains("--who") {
        tellWho()
        return
    }
    if let idx = args.firstIndex(of: "--register") {
        let legacyName = tellLegacyValue(args, flagIndex: idx)
        let sessionID = tellGetArg(args, "--session-id") ??
            ProcessInfo.processInfo.environment["AOS_SESSION_ID"]
        let name = tellGetArg(args, "--name") ?? legacyName
        let role = tellGetArg(args, "--role") ?? "worker"
        let harness = tellGetArg(args, "--harness") ?? "unknown"
        guard let sessionID, !sessionID.isEmpty else {
            exitError("--register requires --session-id <id>", code: "MISSING_ARG")
        }
        tellRegister(sessionID: sessionID, name: name, role: role, harness: harness)
        return
    }
    if let idx = args.firstIndex(of: "--unregister") {
        let legacyName = tellLegacyValue(args, flagIndex: idx)
        let sessionID = tellGetArg(args, "--session-id") ??
            ProcessInfo.processInfo.environment["AOS_SESSION_ID"]
        guard sessionID != nil || legacyName != nil else {
            exitError("--unregister requires --session-id <id> or a legacy name argument", code: "MISSING_ARG")
        }
        tellUnregister(sessionID: sessionID, name: legacyName)
        return
    }

    // Main form: aos tell <audience> [--json <data>] [text...]
    let explicitSessionAudience = tellGetArg(args, "--session-id")
    var audience: String? = explicitSessionAudience
    var jsonData: String? = nil
    var textParts: [String] = []
    var from: String? = nil
    var fromSessionID: String? = nil
    var purpose: String? = nil

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--json":
            i += 1
            guard i < args.count else { exitError("--json requires a value", code: "MISSING_ARG") }
            jsonData = args[i]
        case "--from":
            i += 1
            guard i < args.count else { exitError("--from requires a value", code: "MISSING_ARG") }
            from = args[i]
        case "--from-session-id":
            i += 1
            guard i < args.count else { exitError("--from-session-id requires a value", code: "MISSING_ARG") }
            fromSessionID = args[i]
        case "--purpose":
            i += 1
            guard i < args.count else { exitError("--purpose requires a value", code: "MISSING_ARG") }
            purpose = args[i]
        case "--session-id":
            i += 1
            guard i < args.count else { exitError("--session-id requires a value", code: "MISSING_ARG") }
        default:
            if !args[i].hasPrefix("--") {
                if explicitSessionAudience == nil && audience == nil {
                    audience = args[i]
                } else {
                    textParts.append(args[i])
                }
            }
        }
        i += 1
    }

    guard let audience, !audience.isEmpty else {
        exitError("tell requires an audience. Usage: aos tell <audience>|--session-id <id> [text|--json <data>]",
                  code: "MISSING_ARG")
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
        exitError("tell requires text or --json. Usage: aos tell <audience>|--session-id <id> [text|--json <data>]",
                  code: "MISSING_ARG")
    }

    // Build v1 envelope data. Audience becomes an array (split comma-string if needed).
    let audienceArray = audience.split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }

    var data: [String: Any] = ["audience": audienceArray]
    if !text.isEmpty { data["text"] = text }
    if let from = from { data["from"] = from }
    if let fromSessionID = fromSessionID, !fromSessionID.isEmpty { data["from_session_id"] = fromSessionID }
    if let purpose = purpose, !purpose.isEmpty { data["purpose"] = purpose }
    if let jd = jsonData {
        // Parse JSON string into object for structured payload
        if let jdData = jd.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: jdData) {
            data["payload"] = parsed
        } else {
            exitError("Invalid JSON: \(jd)", code: "INVALID_JSON")
        }
    }

    // Send to daemon via v1 envelope
    guard let response = sendEnvelopeRequest(service: "tell", action: "send", data: data, autoStartBinary: CommandLine.arguments[0]) else {
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

private func tellRegister(sessionID: String, name: String?, role: String, harness: String) {
    var data: [String: Any] = ["session_id": sessionID, "role": role, "harness": harness]
    if let name, !name.isEmpty { data["name"] = name }
    guard let response = sendEnvelopeRequest(service: "session", action: "register", data: data, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let d = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}

private func tellUnregister(sessionID: String?, name: String?) {
    var data: [String: Any] = [:]
    if let sid = sessionID, !sid.isEmpty { data["session_id"] = sid }
    if let name, !name.isEmpty { data["name"] = name }
    guard let response = sendEnvelopeRequest(service: "session", action: "unregister", data: data, autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let d = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}

private func tellWho() {
    guard let response = sendEnvelopeRequest(service: "session", action: "who", data: [:], autoStartBinary: CommandLine.arguments[0]) else {
        exitError("Cannot connect to daemon", code: "DAEMON_UNREACHABLE")
    }
    if let d = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}

/// Arg parser helper: find --key and return next arg
private func tellGetArg(_ args: [String], _ key: String) -> String? {
    guard let idx = args.firstIndex(of: key), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

private func tellLegacyValue(_ args: [String], flagIndex: Int) -> String? {
    let valueIndex = flagIndex + 1
    guard valueIndex < args.count else { return nil }
    let value = args[valueIndex]
    return value.hasPrefix("--") ? nil : value
}
