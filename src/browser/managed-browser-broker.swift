import Darwin
import Foundation

struct ManagedBrowserBrokerError: Error {
    let code: String
    let message: String
}

private let managedBrowserBrokerMaxBytes = 48 * 1024 * 1024
private let managedBrowserBrokerTimeout: TimeInterval = 40

private func brokerScriptPath() throws -> String {
    guard let root = aosCurrentRepoRoot() else {
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_UNAVAILABLE", message: "managed browser resource root is unavailable")
    }
    let script = (root as NSString).appendingPathComponent("scripts/aos-browser-broker.mjs")
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: script, isDirectory: &isDirectory), !isDirectory.boolValue else {
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_UNAVAILABLE", message: "managed browser broker is unavailable")
    }
    return script
}

private func brokerEnvironment() -> [String: String] {
    let source = ProcessInfo.processInfo.environment
    var environment: [String: String] = [
        "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "AOS_RUNTIME_MODE": aosCurrentRuntimeMode().rawValue,
        "AOS_STATE_ROOT": aosStateRoot(),
    ]
    for key in ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL"] {
        if let value = source[key], !value.isEmpty { environment[key] = value }
    }
    return environment
}

func managedBrowserBrokerRequest(
    operation: String,
    session: String,
    input: [String: Any] = [:]
) throws -> [String: Any] {
    let request: [String: Any] = [
        "operation": operation,
        "session_id": session,
        "input": input,
    ]
    let requestData = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", try brokerScriptPath()]
    process.environment = brokerEnvironment()
    let stdinPipe = Pipe(), stdoutPipe = Pipe(), stderrPipe = Pipe()
    process.standardInput = stdinPipe
    process.standardOutput = stdoutPipe
    process.standardError = stderrPipe
    do { try process.run() } catch {
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_UNAVAILABLE", message: "managed browser broker could not start")
    }
    stdinPipe.fileHandleForWriting.write(requestData)
    stdinPipe.fileHandleForWriting.write(Data("\n".utf8))
    try? stdinPipe.fileHandleForWriting.close()

    let group = DispatchGroup()
    let lock = NSLock()
    var stdout = Data(), stderr = Data(), exceeded = false
    func drain(_ handle: FileHandle, intoStdout: Bool) {
        group.enter()
        DispatchQueue.global().async {
            while true {
                let data = handle.availableData
                if data.isEmpty { break }
                lock.lock()
                if stdout.count + stderr.count + data.count > managedBrowserBrokerMaxBytes {
                    exceeded = true
                } else if intoStdout {
                    stdout.append(data)
                } else {
                    stderr.append(data)
                }
                lock.unlock()
            }
            group.leave()
        }
    }
    drain(stdoutPipe.fileHandleForReading, intoStdout: true)
    drain(stderrPipe.fileHandleForReading, intoStdout: false)
    let deadline = Date().addingTimeInterval(managedBrowserBrokerTimeout)
    while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    if process.isRunning {
        process.terminate()
        let grace = Date().addingTimeInterval(2)
        while process.isRunning && Date() < grace { Thread.sleep(forTimeInterval: 0.01) }
        if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
        group.wait()
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_TIMEOUT", message: "managed browser broker timed out")
    }
    group.wait()
    if exceeded { throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_OUTPUT_LIMIT", message: "managed browser broker output exceeded its limit") }
    let selected = process.terminationStatus == 0 ? stdout : stderr
    guard let value = try? JSONSerialization.jsonObject(with: selected) as? [String: Any] else {
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_OUTPUT_INVALID", message: "managed browser broker returned invalid JSON")
    }
    if process.terminationStatus != 0 {
        throw ManagedBrowserBrokerError(
            code: value["code"] as? String ?? "BROWSER_BROKER_FAILED",
            message: value["error"] as? String ?? "managed browser broker failed"
        )
    }
    guard value["status"] as? String == "ok" else {
        throw ManagedBrowserBrokerError(code: "BROWSER_BROKER_OUTPUT_INVALID", message: "managed browser broker success shape differs")
    }
    return value
}
