// playwright-process.swift — Subprocess helper for playwright-cli.
//
// Every browser-target aos verb routes through runPlaywright(). One helper
// owns argv construction, stdin/stdout/stderr capture, exit-code translation,
// and optional --filename=<tmp> allocation for verbs that emit files.

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
    do {
        try proc.run()
    } catch {
        throw PlaywrightInvocationError.launchFailed("\(error)")
    }
    proc.waitUntilExit()
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    return PlaywrightResult(
        exit_code: proc.terminationStatus,
        stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
        stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines),
        filename: tmpPath
    )
}
