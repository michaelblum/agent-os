// playwright-process.swift — Subprocess helper for playwright-cli.
//
// Every browser-target aos verb routes through runPlaywright(). One helper
// owns argv construction, concurrent stdout/stderr draining (to avoid
// pipe-buffer deadlock on large outputs), exit-code translation, and
// optional --filename=<tmp> allocation for verbs that emit files.
//
// Caller cleanup: when PlaywrightInvocation.withTempFilename is true,
// result.filename points at a /tmp/aos-pw-<uuid>.md file owned by the
// caller. runPlaywright() does not delete it. Consumers (e.g.
// snapshot-parser.swift) are responsible for reading and unlinking.

import Foundation

struct PlaywrightInvocation {
    let session: String
    let verb: String
    let args: [String]            // additional positional/flag args (verb args, not -s=)
    let withTempFilename: Bool    // when true, append --filename=<tmp> and return its path
}

struct PlaywrightResult: Encodable {
    let exit_code: Int32
    let stdout: String
    let stderr: String
    let filename: String?         // tmp path when withTempFilename was set
}

enum PlaywrightInvocationError: Error {
    case launchFailed(String)
}

func runPlaywright(_ inv: PlaywrightInvocation) throws -> PlaywrightResult {
    var argv: [String] = ["-s=\(inv.session)", inv.verb]
    argv.append(contentsOf: inv.args)

    var tmpPath: String? = nil
    if inv.withTempFilename {
        let path = "/tmp/aos-pw-\(UUID().uuidString).md"
        argv.append("--filename=\(path)")
        tmpPath = path
    }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = ["playwright-cli"] + argv
    let out = Pipe(), err = Pipe()
    proc.standardOutput = out
    proc.standardError = err

    // Accumulate stdout/stderr concurrently so a child that writes more than
    // a pipe buffer worth of data doesn't deadlock on `write()` while we wait
    // on `waitUntilExit()`. `readabilityHandler` fires on an arbitrary queue
    // whenever data is available.
    var stdoutData = Data()
    var stderrData = Data()
    let stdoutLock = NSLock()
    let stderrLock = NSLock()

    out.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        if chunk.isEmpty { return }
        stdoutLock.lock()
        stdoutData.append(chunk)
        stdoutLock.unlock()
    }
    err.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        if chunk.isEmpty { return }
        stderrLock.lock()
        stderrData.append(chunk)
        stderrLock.unlock()
    }

    do {
        try proc.run()
    } catch {
        // Detach handlers so they don't fire on a torn-down pipe.
        out.fileHandleForReading.readabilityHandler = nil
        err.fileHandleForReading.readabilityHandler = nil
        throw PlaywrightInvocationError.launchFailed("\(error)")
    }
    proc.waitUntilExit()

    // Drain any remaining bytes that landed after the final readability signal.
    let finalStdout = out.fileHandleForReading.readDataToEndOfFile()
    let finalStderr = err.fileHandleForReading.readDataToEndOfFile()
    stdoutLock.lock(); stdoutData.append(finalStdout); stdoutLock.unlock()
    stderrLock.lock(); stderrData.append(finalStderr); stderrLock.unlock()

    // Detach handlers.
    out.fileHandleForReading.readabilityHandler = nil
    err.fileHandleForReading.readabilityHandler = nil

    let stdout = (String(data: stdoutData, encoding: .utf8) ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let stderr = (String(data: stderrData, encoding: .utf8) ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    return PlaywrightResult(
        exit_code: proc.terminationStatus,
        stdout: stdout,
        stderr: stderr,
        filename: tmpPath
    )
}
