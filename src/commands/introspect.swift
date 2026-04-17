// introspect.swift — review recent ./aos usage for the current session.

import Foundation

private struct AgentUsageEvent: Codable {
    let timestamp: String
    let session: String
    let harness: String?
    let source: String?
    let command: String?
    let command_path: [String]?
    let outcome: String?
    let exit_code: Int?
    let error_code: String?
    let duration_ms: Int?
    let blocked_reason: String?
}

private struct AgentSessionState: Codable {
    let session: String
    let harness: String?
    let consecutive_failures: Int?
    let total_events: Int?
    let last_updated: String?
}

private struct IntrospectRecentEntry: Encodable {
    let timestamp: String
    let command: String
    let outcome: String
    let error_code: String?
}

private struct IntrospectReviewResponse: Encodable {
    let status: String
    let session: String
    let harness: String
    let total_attempts: Int
    let successes: Int
    let failures: Int
    let blocked: Int
    let consecutive_failures: Int
    let mastered_commands: [String]
    let repeated_failure_commands: [String]
    let learnings: [String]
    let recommendations: [String]
    let recent: [IntrospectRecentEntry]
    let log_path: String
}

func introspectCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") || args.isEmpty {
        printCommandHelp(["introspect"], json: args.contains("--json"))
        exit(0)
    }

    let sub = args[0]
    switch sub {
    case "review":
        introspectReviewCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown introspect subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func introspectReviewCommand(args: [String]) {
    var asJSON = false
    var sessionKey = aosCurrentSessionKey()
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--json":
            asJSON = true
        case "--session":
            i += 1
            guard i < args.count else {
                exitError("--session requires a value", code: "MISSING_ARG")
            }
            sessionKey = aosSanitizeSessionComponent(args[i])
        default:
            exitError("Unknown flag: \(args[i]). Usage: \(aosInvocationDisplayName()) introspect review [--session <key>] [--json]", code: "UNKNOWN_FLAG")
        }
        i += 1
    }

    let logPath = aosAgentUsageLogPath()
    let events = loadAgentUsageEvents().filter { $0.session == sessionKey }
    let state = loadAgentSessionState(sessionKey: sessionKey)
    let harness = state?.harness ?? events.compactMap(\.harness).last ?? aosCurrentSessionHarness()

    var successes = 0
    var failures = 0
    var blocked = 0
    var mastered: Set<String> = []
    var failureCounts: [String: Int] = [:]
    var errorCounts: [String: Int] = [:]
    var recent: [IntrospectRecentEntry] = []
    var usedStatus = false
    var usedDoctor = false
    var usedDaemonSnapshot = false
    var usedClean = false
    var misuseRepoBinary = false
    var invalidCommandLoops = false

    for event in events {
        let path = commandPathString(from: event)
        switch event.outcome {
        case "success":
            successes += 1
            if !path.isEmpty {
                mastered.insert(path)
            }
        case "blocked":
            blocked += 1
            failures += 1
            if !path.isEmpty {
                failureCounts[path, default: 0] += 1
            }
        case "error":
            failures += 1
            if !path.isEmpty {
                failureCounts[path, default: 0] += 1
            }
        default:
            break
        }

        if let errorCode = event.error_code, !errorCode.isEmpty {
            errorCounts[errorCode, default: 0] += 1
            if errorCode == "USE_REPO_AOS" {
                misuseRepoBinary = true
            }
            if errorCode == "UNKNOWN_COMMAND" || errorCode == "UNKNOWN_ARG" || errorCode == "UNKNOWN_FLAG" || errorCode == "MISSING_ARG" {
                invalidCommandLoops = true
            }
        }

        if path == "status" { usedStatus = true }
        if path == "doctor" { usedDoctor = true }
        if path == "daemon-snapshot" { usedDaemonSnapshot = true }
        if path == "clean" { usedClean = true }

        recent.append(IntrospectRecentEntry(
            timestamp: event.timestamp,
            command: path.isEmpty ? (event.command ?? "(unknown)") : path,
            outcome: event.outcome ?? "unknown",
            error_code: event.error_code
        ))
    }

    recent = Array(Array(recent.suffix(8)).reversed())

    var learnings: [String] = []
    if misuseRepoBinary {
        learnings.append("In repo mode, invoke the binary as `./aos`, not `aos`.")
    }
    if (usedDoctor || usedDaemonSnapshot || usedClean) && !usedStatus {
        learnings.append("`\(aosInvocationDisplayName()) status` is the primary runtime entrypoint; use it before dropping to `doctor`, `daemon-snapshot`, or `clean`.")
    }
    if invalidCommandLoops {
        learnings.append("When commands or flags miss, recover with `\(aosInvocationDisplayName()) help <command> [--json]` before retrying.")
    }
    if !mastered.isEmpty {
        learnings.append("Successful command paths so far: \(mastered.sorted().joined(separator: ", ")).")
    }

    var recommendations: [String] = []
    if events.isEmpty {
        recommendations.append("Start with `\(aosInvocationDisplayName()) status`.")
        recommendations.append("Use `\(aosInvocationDisplayName()) help <command> [--json]` to inspect a specific surface.")
    }
    if misuseRepoBinary {
        recommendations.append("Replace bare `aos` invocations with `\(aosInvocationDisplayName())`.")
    }
    if (usedDoctor || usedDaemonSnapshot || usedClean) && !usedStatus {
        recommendations.append("Use `\(aosInvocationDisplayName()) status` for routine runtime checks instead of chaining `doctor`, `daemon-snapshot`, and `clean` manually.")
    }
    if invalidCommandLoops {
        recommendations.append("Use `\(aosInvocationDisplayName()) help <command>` before another retry loop.")
    }
    if recommendations.isEmpty {
        recommendations.append("Keep using `\(aosInvocationDisplayName()) status` as the point of entry and `\(aosInvocationDisplayName()) introspect review` for self-review.")
    }

    let repeatedFailures = failureCounts
        .filter { $0.value > 1 }
        .sorted { lhs, rhs in
            if lhs.value == rhs.value { return lhs.key < rhs.key }
            return lhs.value > rhs.value
        }
        .map { "\($0.key) (\($0.value))" }

    let response = IntrospectReviewResponse(
        status: failures == 0 ? "ok" : "review",
        session: sessionKey,
        harness: harness,
        total_attempts: events.count,
        successes: successes,
        failures: failures,
        blocked: blocked,
        consecutive_failures: state?.consecutive_failures ?? 0,
        mastered_commands: mastered.sorted(),
        repeated_failure_commands: repeatedFailures,
        learnings: learnings,
        recommendations: recommendations,
        recent: recent,
        log_path: logPath
    )

    if asJSON {
        print(jsonString(response))
        return
    }

    print("status=\(response.status) session=\(response.session) harness=\(response.harness) attempts=\(response.total_attempts) successes=\(response.successes) failures=\(response.failures) blocked=\(response.blocked) streak=\(response.consecutive_failures)")
    print("Mastered: \(response.mastered_commands.isEmpty ? "(none yet)" : response.mastered_commands.joined(separator: ", "))")
    print("Repeated failures: \(response.repeated_failure_commands.isEmpty ? "(none)" : response.repeated_failure_commands.joined(separator: ", "))")
    print("Learnings:")
    if response.learnings.isEmpty {
        print("- No issues detected yet.")
    } else {
        for line in response.learnings {
            print("- \(line)")
        }
    }
    print("Recommendations:")
    for line in response.recommendations {
        print("- \(line)")
    }
    print("Recent:")
    for entry in response.recent {
        let errorSuffix = entry.error_code.map { " [\($0)]" } ?? ""
        print("- \(entry.timestamp) \(entry.outcome) \(entry.command)\(errorSuffix)")
    }
    print("log_path=\(response.log_path)")
}

private func loadAgentUsageEvents() -> [AgentUsageEvent] {
    let path = aosAgentUsageLogPath()
    guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else {
        return []
    }
    let decoder = JSONDecoder()
    return raw
        .split(whereSeparator: \.isNewline)
        .compactMap { line in
            guard let data = line.data(using: .utf8) else { return nil }
            return try? decoder.decode(AgentUsageEvent.self, from: data)
        }
}

private func loadAgentSessionState(sessionKey: String) -> AgentSessionState? {
    let path = aosAgentSessionStatePath(sessionKey: sessionKey)
    guard let data = FileManager.default.contents(atPath: path) else { return nil }
    return try? JSONDecoder().decode(AgentSessionState.self, from: data)
}

private func commandPathString(from event: AgentUsageEvent) -> String {
    if let path = event.command_path, !path.isEmpty {
        return path.joined(separator: "/")
    }
    return ""
}
