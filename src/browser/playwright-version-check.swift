// playwright-version-check.swift — Detect and validate @playwright/cli.
//
// The adapter depends on `playwright-cli attach --extension` and
// `playwright-cli attach --cdp`, both introduced in 0.1.8. Older releases
// don't expose those flags (the adapter design was written against the 0.1.x
// line that shipped them). Probe the installed binary's `--version` and
// fail fast with an actionable install/upgrade message when missing or
// below minimum.

import Foundation

// Pinned from the 2026-04-23 probe of `npx @playwright/cli@latest`:
//   $ npx @playwright/cli@latest --version        -> 0.1.8
//   $ npx @playwright/cli@latest attach --help    -> lists --extension and --cdp
// Bump this when the adapter starts depending on newer CLI surface.
let kMinPlaywrightCLIVersion = "0.1.8"

enum PlaywrightVersionError: Error {
    case notFound
    case tooOld(found: String, minimum: String)
    case probeFailed(String)
}

struct PlaywrightVersionOK: Encodable {
    let status: String  // "ok"
    let version: String
    let minimum: String
}

func probePlaywrightVersion() throws -> PlaywrightVersionOK {
    let proc = Process()
    proc.launchPath = "/usr/bin/env"
    proc.arguments = ["playwright-cli", "--version"]
    let out = Pipe(), err = Pipe()
    proc.standardOutput = out
    proc.standardError = err
    do {
        try proc.run()
    } catch {
        throw PlaywrightVersionError.notFound
    }
    proc.waitUntilExit()
    let stderrStr = String(
        data: err.fileHandleForReading.readDataToEndOfFile(),
        encoding: .utf8
    ) ?? ""
    if proc.terminationStatus != 0 {
        // `/usr/bin/env` returns 127 with a "No such file or directory"
        // message when the requested binary isn't on PATH. Treat that
        // specifically as NOT_FOUND so the caller can surface an install
        // hint rather than a generic probe failure.
        if proc.terminationStatus == 127
            || stderrStr.contains("No such file or directory")
            || stderrStr.contains("command not found")
        {
            throw PlaywrightVersionError.notFound
        }
        throw PlaywrightVersionError.probeFailed(stderrStr)
    }
    let stdoutStr = String(
        data: out.fileHandleForReading.readDataToEndOfFile(),
        encoding: .utf8
    ) ?? ""
    let version = stdoutStr.trimmingCharacters(in: .whitespacesAndNewlines)
    guard compareVersions(version, kMinPlaywrightCLIVersion) >= 0 else {
        throw PlaywrightVersionError.tooOld(
            found: version,
            minimum: kMinPlaywrightCLIVersion
        )
    }
    return PlaywrightVersionOK(
        status: "ok",
        version: version,
        minimum: kMinPlaywrightCLIVersion
    )
}

// Semver-ish integer-by-integer compare. Pre-release suffixes (e.g. "1.2.3-rc.1")
// are dropped and the numeric part compared.
func compareVersions(_ a: String, _ b: String) -> Int {
    func parse(_ s: String) -> [Int] {
        let base = s.split(separator: "-").first.map(String.init) ?? s
        return base.split(separator: ".").compactMap { Int($0) }
    }
    let pa = parse(a), pb = parse(b)
    let n = max(pa.count, pb.count)
    for i in 0..<n {
        let ai = i < pa.count ? pa[i] : 0
        let bi = i < pb.count ? pb[i] : 0
        if ai < bi { return -1 }
        if ai > bi { return 1 }
    }
    return 0
}
