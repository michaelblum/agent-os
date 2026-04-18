// helpers.swift — Shared utilities for the aos binary

import Foundation

// MARK: - JSON Helpers

func jsonString<T: Encodable>(_ value: T, pretty: Bool = true) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = pretty ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
    guard let data = try? enc.encode(value), let s = String(data: data, encoding: .utf8) else { return "{}" }
    return s
}

func jsonCompact<T: Encodable>(_ value: T) -> String {
    jsonString(value, pretty: false)
}

// MARK: - Error Output

private func recordCLIError(message: String, code: String) {
    let env = ProcessInfo.processInfo.environment
    let logPath = aosCLIErrorLogPath()
    let dir = (logPath as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

    var record: [String: Any] = [
        "timestamp": iso8601Now(),
        "code": code,
        "error": message,
        "argv": CommandLine.arguments,
        "cwd": FileManager.default.currentDirectoryPath,
        "mode": aosCurrentRuntimeMode().rawValue,
    ]
    if let sessionID = env["AOS_SESSION_ID"], !sessionID.isEmpty {
        record["session_id"] = sessionID
    }
    if let sessionName = env["AOS_SESSION_NAME"], !sessionName.isEmpty {
        record["session_name"] = sessionName
    }
    if let harness = env["AOS_SESSION_HARNESS"], !harness.isEmpty {
        record["harness"] = harness
    }

    guard JSONSerialization.isValidJSONObject(record),
          let data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else {
        return
    }

    if !FileManager.default.fileExists(atPath: logPath) {
        FileManager.default.createFile(atPath: logPath, contents: nil)
    }

    guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logPath)) else { return }
    defer { try? handle.close() }
    do {
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data("\n".utf8))
    } catch {
        return
    }
}

func exitError(_ message: String, code: String) -> Never {
    recordCLIError(message: message, code: code)
    let obj: [String: String] = ["error": message, "code": code]
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(s.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Duration Parser

func parseDuration(_ str: String) -> TimeInterval {
    if str == "none" { return .infinity }
    let s = str.lowercased()
    if s.hasSuffix("s"), let n = Double(s.dropLast()) { return n }
    if s.hasSuffix("m"), let n = Double(s.dropLast()) { return n * 60 }
    if s.hasSuffix("h"), let n = Double(s.dropLast()) { return n * 3600 }
    if let n = Double(s) { return n }
    exitError("Invalid duration: \(str). Use format like 5s, 10m, 1h, or 'none'.", code: "INVALID_DURATION")
}

// MARK: - ISO 8601

func iso8601Now() -> String {
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: Date())
}

// MARK: - Response Helpers

func sendResponse(to fd: Int32, _ data: Data) {
    var buf = data
    buf.append(contentsOf: "\n".utf8)
    buf.withUnsafeBytes { ptr in
        _ = write(fd, ptr.baseAddress!, ptr.count)
    }
}

func sendResponseJSON(to fd: Int32, _ dict: [String: Any]) {
    sendResponseJSON(to: fd, dict, envelopeActive: false, envelopeRef: nil)
}

func sendResponseJSON(to fd: Int32, _ dict: [String: Any], envelopeActive: Bool, envelopeRef: String?) {
    let payload: [String: Any]
    if envelopeActive {
        if let err = dict["error"] as? String, let code = dict["code"] as? String {
            var out: [String: Any] = ["v": 1, "status": "error", "error": err, "code": code]
            if let r = envelopeRef, !r.isEmpty { out["ref"] = r }
            payload = out
        } else {
            var data = dict
            data.removeValue(forKey: "status")
            let status = (dict["status"] as? String) ?? "success"
            var out: [String: Any] = ["v": 1, "status": status == "ok" ? "success" : status, "data": data]
            if let r = envelopeRef, !r.isEmpty { out["ref"] = r }
            payload = out
        }
    } else {
        payload = dict
    }
    guard let serialized = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
    sendResponse(to: fd, serialized)
}

// MARK: - Repo Paths

func aosExecutableDir() -> String {
    URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().path
}

func findAgentOSRepoRoot() -> String {
    aosCurrentRepoRoot(executablePath: aosExecutablePath()) ?? FileManager.default.currentDirectoryPath
}

func aosRepoPath(_ relativePath: String) -> String {
    NSString(string: (findAgentOSRepoRoot() as NSString).appendingPathComponent(relativePath)).standardizingPath
}

func jsStringLiteral(_ value: String) -> String {
    var out = "\""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04X", scalar.value)
            } else {
                out.append(String(scalar))
            }
        }
    }
    out += "\""
    return out
}

// MARK: - Canvas Bridge Helpers

/// Deliver a JSON payload to a canvas via the daemon's typed `post` action.
/// The daemon serializes and dispatches the payload through the Layer 1a
/// bridge (`runtime/bridge.js`) without the caller constructing raw JS.
func sendHeadsupMessage(session: DaemonSession, canvasID: String, payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
          let json = String(data: data, encoding: .utf8) else { return }
    session.sendOnly([
        "action": "post",
        "id": canvasID,
        "data": json
    ])
}

/// One-shot variant for contexts without a persistent `DaemonSession`.
/// Returns the raw response dict or nil if the daemon is unreachable.
@discardableResult
func sendHeadsupMessageOneShot(canvasID: String, payload: [String: Any]) -> [String: Any]? {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return daemonOneShot([
        "action": "post",
        "id": canvasID,
        "data": json
    ])
}

func waitForCanvasCondition(
    session: DaemonSession,
    canvasID: String,
    jsCondition: String,
    timeoutMs: Int = 5000,
    pollMs: useconds_t = 100_000
) -> Bool {
    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
    let js = "(\(jsCondition)) ? 'ready' : 'wait'"

    while Date() < deadline {
        if let response = session.sendAndReceive([
            "action": "eval",
            "id": canvasID,
            "js": js
        ]),
           let result = response["result"] as? String,
           result == "ready" {
            return true
        }
        usleep(pollMs)
    }
    return false
}

func waitForCanvasBridge(
    session: DaemonSession,
    canvasID: String,
    manifestName: String? = nil,
    timeoutMs: Int = 5000
) -> Bool {
    var condition = "window.headsup && typeof window.headsup.receive === 'function'"
    if let manifestName = manifestName {
        condition += " && window.headsup.manifest && window.headsup.manifest.name === \(jsStringLiteral(manifestName))"
    }
    return waitForCanvasCondition(session: session, canvasID: canvasID, jsCondition: condition, timeoutMs: timeoutMs)
}

func contentStatusIsReady(_ response: [String: Any], requiredRoots: [String] = []) -> Bool {
    let port = response["port"] as? Int ?? 0
    guard port > 0 else { return false }
    let roots = response["roots"] as? [String: String] ?? [:]
    return requiredRoots.allSatisfy { roots[$0] != nil }
}

func waitForContentStatus(
    session: DaemonSession,
    requiredRoots: [String] = [],
    timeoutMs: Int = 10000,
    pollMs: useconds_t = 100_000
) -> [String: Any]? {
    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
    while Date() < deadline {
        if let response = session.sendAndReceive(["action": "content_status"]),
           contentStatusIsReady(response, requiredRoots: requiredRoots) {
            return response
        }
        usleep(pollMs)
    }
    return nil
}

// MARK: - Process Helpers

struct ProcessOutput {
    let exitCode: Int32
    let stdout: String
    let stderr: String
}

@discardableResult
func runProcess(_ executable: String, arguments: [String]) -> ProcessOutput {
    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = stdout
    process.standardError = stderr

    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "\(error)")
    }

    let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
    let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
    return ProcessOutput(
        exitCode: process.terminationStatus,
        stdout: String(data: stdoutData, encoding: .utf8) ?? "",
        stderr: String(data: stderrData, encoding: .utf8) ?? ""
    )
}
