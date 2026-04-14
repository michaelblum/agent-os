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

func exitError(_ message: String, code: String) -> Never {
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
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else { return }
    sendResponse(to: fd, data)
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

// MARK: - Canvas Bridge Helpers

/// Deliver a JSON payload to a canvas component's `window.headsup.receive(b64)`
/// handler via daemon `eval`. Mirrors the pattern used by component launchers
/// and matches what `AosComponent.onMessage` expects.
func sendHeadsupMessage(session: DaemonSession, canvasID: String, payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
    let b64 = data.base64EncodedString()
    session.sendOnly([
        "action": "eval",
        "id": canvasID,
        "js": "window.headsup.receive(\"\(b64)\")"
    ])
}

/// One-shot variant for contexts without a persistent `DaemonSession`.
/// Returns the raw response dict or nil if the daemon is unreachable.
@discardableResult
func sendHeadsupMessageOneShot(canvasID: String, payload: [String: Any]) -> [String: Any]? {
    guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return nil }
    let b64 = data.base64EncodedString()
    return daemonOneShot([
        "action": "eval",
        "id": canvasID,
        "js": "window.headsup.receive(\"\(b64)\")"
    ])
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
