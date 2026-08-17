import CryptoKit
import Foundation

private let operationFilterFlags: [String: String] = [
    "--capability-id": "capability_id",
    "--client-id": "client_id",
    "--agent-id": "agent_id",
    "--project-id": "project_id",
    "--task-id": "task_id",
    "--run-id": "run_id",
    "--skill-id": "skill_id",
    "--target-id": "target_id",
    "--capability-label": "capability_label",
]

private let operationIntegerFlags: [String: ClosedRange<Int>] = [
    "--generation": 1...Int.max,
    "--barrier-generation": 1...Int.max,
    "--rate": 1...60,
    "--sample-every": 1...10_000,
    "--max-queue-items": 1...1_024,
    "--max-items": 1...10_000,
    "--max-bytes": 1...10_485_760,
    "--timeout": 1...300_000,
    "--duration-ms": 1...300_000,
]

private struct AOSOperationCLIRequest {
    let action: String
    var data: [String: Any]
    let follow: Bool
    let followTimeoutMilliseconds: Int32
}

func operationCommand(args: [String]) {
    let request = parseOperationCommand(args: args)
    let socketPath = aosSocketPath(for: aosCurrentRuntimeMode())
    let session = DaemonSession(socketPath: socketPath)
    guard session.connectWithAutoStart(binaryPath: CommandLine.arguments[0], timeoutMs: 1_000) else {
        exitError("The AOS daemon operation plane is unavailable.", code: "DAEMON_UNREACHABLE")
    }
    defer { session.disconnect() }

    let ping: [String: Any] = [
        "v": 1,
        "service": "system",
        "action": "ping",
        "data": [:],
        "ref": "operation-bootstrap-\(UUID().uuidString.lowercased())",
    ]
    let bootstrap = session.sendAndReceive(ping)
    guard bootstrap != nil, bootstrap?["error"] == nil else {
        exitError(
            bootstrap?["error"] as? String ?? "The daemon bootstrap response was unavailable.",
            code: bootstrap?["code"] as? String ?? "DAEMON_BOOTSTRAP_FAILED"
        )
    }

    let requestID = UUID().uuidString.lowercased()
    var requestData = request.data
    requestData["request_id"] = requestID
    requestData["canonical_parameter_digest"] = operationParameterDigest(
        action: request.action,
        parameters: request.data
    )
    let envelope: [String: Any] = [
        "v": 1,
        "service": "operation",
        "action": request.action,
        "data": requestData,
        "ref": requestID,
    ]
    session.sendOnly(envelope)
    guard let response = session.readOneJSON(timeoutMs: 5_000) else {
        exitError("The daemon operation response was unavailable.", code: "OPERATION_RESPONSE_UNAVAILABLE")
    }
    writeOperationJSON(response)
    if response["status"] as? String == "error" || response["error"] != nil {
        exit(1)
    }

    guard request.follow else { return }
    while let event = session.readOneJSON(timeoutMs: request.followTimeoutMilliseconds) {
        writeOperationJSON(event)
        guard event["service"] as? String == "operation" else { continue }
        let name = event["event"] as? String
        if name == "terminal" || name == "residual" { return }
    }
    exitError("The bounded operation tap ended without a terminal event.", code: "OPERATION_FOLLOW_INCOMPLETE")
}

private func parseOperationCommand(args: [String]) -> AOSOperationCLIRequest {
    guard args.last == "--json" else {
        operationUsageError()
    }
    var values = Array(args.dropLast())
    guard let command = values.first else { operationUsageError() }
    values.removeFirst()

    switch command {
    case "list", "recent", "kill-owner":
        let filters = parseOperationFilters(values)
        return AOSOperationCLIRequest(
            action: command.replacingOccurrences(of: "-", with: "_"),
            data: ["filters": filters],
            follow: false,
            followTimeoutMilliseconds: 0
        )
    case "inspect", "status", "cancel", "kill":
        guard let operationID = values.first, !operationID.hasPrefix("--") else { operationUsageError() }
        let flags = parseOperationFlags(Array(values.dropFirst()), allowed: ["--generation"])
        return AOSOperationCLIRequest(
            action: command,
            data: [
                "selector": [
                    "operation_id": operationID,
                    "operation_generation": requiredInteger(flags, "--generation"),
                ],
            ],
            follow: false,
            followTimeoutMilliseconds: 0
        )
    case "tap":
        guard let operationID = values.first, !operationID.hasPrefix("--") else { operationUsageError() }
        var tapArgs = Array(values.dropFirst())
        let follow = removeBooleanFlag("--follow", from: &tapArgs)
        let required = [
            "--generation", "--channel", "--rate", "--sample-every", "--max-queue-items",
            "--max-items", "--max-bytes", "--timeout", "--duration-ms",
        ]
        let flags = parseOperationFlags(tapArgs, allowed: Set(required))
        guard flags.count == required.count,
              let channel = flags["--channel"], ["metadata", "data"].contains(channel) else {
            operationUsageError()
        }
        let idleTimeout = requiredInteger(flags, "--timeout")
        let duration = requiredInteger(flags, "--duration-ms")
        let followBudget = min(Int(Int32.max), max(idleTimeout, duration) + 5_000)
        return AOSOperationCLIRequest(
            action: "tap",
            data: [
                "selector": [
                    "operation_id": operationID,
                    "operation_generation": requiredInteger(flags, "--generation"),
                ],
                "tap": [
                    "channel": channel,
                    "bounds": [
                        "rate_items_per_second": requiredInteger(flags, "--rate"),
                        "sample_every": requiredInteger(flags, "--sample-every"),
                        "max_queue_items": requiredInteger(flags, "--max-queue-items"),
                        "max_items": requiredInteger(flags, "--max-items"),
                        "max_bytes": requiredInteger(flags, "--max-bytes"),
                        "idle_timeout_milliseconds": idleTimeout,
                        "duration_milliseconds": duration,
                    ],
                    "follow": follow,
                ],
            ],
            follow: follow,
            followTimeoutMilliseconds: Int32(followBudget)
        )
    case "artifact":
        guard values.count >= 2,
              ["reveal", "remove", "release", "retain"].contains(values[0]),
              !values[1].hasPrefix("--") else {
            operationUsageError()
        }
        let action = values[0]
        let artifactID = values[1]
        let flags = parseOperationFlags(Array(values.dropFirst(2)), allowed: ["--generation"])
        return AOSOperationCLIRequest(
            action: "artifact_\(action)",
            data: [
                "selector": [
                    "artifact_id": artifactID,
                    "artifact_generation": requiredInteger(flags, "--generation"),
                ],
                "action": action,
            ],
            follow: false,
            followTimeoutMilliseconds: 0
        )
    case "stop-all", "reopen":
        let flags = parseOperationFlags(values, allowed: ["--barrier-generation"])
        let action = command.replacingOccurrences(of: "-", with: "_")
        return AOSOperationCLIRequest(
            action: action,
            data: [
                "schema_version": action == "stop_all"
                    ? "aos.host-stop-barrier.stop-all-request.v1"
                    : "aos.host-stop-barrier.reopen-request.v1",
                "action": action,
                "expected_barrier_generation": requiredInteger(flags, "--barrier-generation"),
            ],
            follow: false,
            followTimeoutMilliseconds: 0
        )
    case "barrier-status":
        guard values.isEmpty else { operationUsageError() }
        return AOSOperationCLIRequest(
            action: "barrier_status",
            data: [
                "schema_version": "aos.host-stop-barrier.status-request.v1",
                "action": "barrier_status",
            ],
            follow: false,
            followTimeoutMilliseconds: 0
        )
    default:
        operationUsageError()
    }
}

private func parseOperationFilters(_ args: [String]) -> [String: Any] {
    let flags = parseOperationFlags(args, allowed: Set(operationFilterFlags.keys))
    var result: [String: Any] = [:]
    for (flag, value) in flags {
        guard let field = operationFilterFlags[flag] else { operationUsageError() }
        result[field] = value
    }
    return result
}

private func parseOperationFlags(_ args: [String], allowed: Set<String>) -> [String: String] {
    var result: [String: String] = [:]
    var index = 0
    while index < args.count {
        let flag = args[index]
        guard allowed.contains(flag), result[flag] == nil, index + 1 < args.count else {
            operationUsageError()
        }
        let value = args[index + 1]
        guard !value.isEmpty, !value.hasPrefix("--") else { operationUsageError() }
        result[flag] = value
        index += 2
    }
    return result
}

private func removeBooleanFlag(_ flag: String, from args: inout [String]) -> Bool {
    let indexes = args.indices.filter { args[$0] == flag }
    guard indexes.count <= 1 else { operationUsageError() }
    guard let index = indexes.first else { return false }
    args.remove(at: index)
    return true
}

private func requiredInteger(_ values: [String: String], _ flag: String) -> Int {
    guard let raw = values[flag], let value = Int(raw),
          let range = operationIntegerFlags[flag], range.contains(value) else {
        operationUsageError()
    }
    return value
}

private func operationParameterDigest(action: String, parameters: [String: Any]) -> String {
    let input: [String: Any] = ["action": action, "parameters": parameters]
    guard JSONSerialization.isValidJSONObject(input),
          let canonical = try? JSONSerialization.data(
              withJSONObject: input,
              options: [.sortedKeys, .withoutEscapingSlashes]
          ) else {
        exitError("The operation request could not be canonicalized.", code: "OPERATION_REQUEST_INVALID")
    }
    var material = Data("aos:operation-request:v1\n".utf8)
    material.append(canonical)
    return SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
}

private func writeOperationJSON(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else {
        exitError("The daemon returned a malformed operation envelope.", code: "OPERATION_RESPONSE_INVALID")
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

private func operationUsageError() -> Never {
    exitError(
        "__operation requires one reviewed operation form ending in --json.",
        code: "INVALID_ARG"
    )
}
