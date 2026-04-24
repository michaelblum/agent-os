// playwright-version-check.swift — Detect and validate @playwright/cli.
//
// The adapter depends on `playwright-cli attach --extension` and
// `playwright-cli attach --cdp`, both introduced in @playwright/cli 0.1.8.
// Older releases don't expose those flags.
//
// Version source: the `playwright-cli --version` output reports the internal
// PLAYWRIGHT engine version (e.g. `1.59.0-alpha-…`), NOT the `@playwright/cli`
// npm package version. Comparing that string against `0.1.8` would always
// pass — masking a real old-CLI install. We therefore detect the version
// from the binary's own `package.json`: resolve the PATH binary's symlinks
// to its actual script, walk up to find a `package.json` with
// `name == "@playwright/cli"`, and read its `version`.
//
// Fall back to `--version` stdout only if we cannot locate a package.json
// (e.g. standalone bash shims in tests, non-npm installs). The fallback is
// advisory: any parseable semver that satisfies the minimum still passes.

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
    let source: String  // "package.json" | "binary-version"
}

func probePlaywrightVersion() throws -> PlaywrightVersionOK {
    guard let binaryPath = findPlaywrightCLIOnPath() else {
        throw PlaywrightVersionError.notFound
    }

    let version: String
    let source: String
    if let pkgVersion = detectPackageVersion(fromBinary: binaryPath) {
        version = pkgVersion
        source = "package.json"
    } else {
        version = try runBinaryVersion()
        source = "binary-version"
    }

    if parseVersionSegments(version).isEmpty {
        throw PlaywrightVersionError.probeFailed("unparseable version: \(version)")
    }
    guard compareVersions(version, kMinPlaywrightCLIVersion) >= 0 else {
        throw PlaywrightVersionError.tooOld(
            found: version,
            minimum: kMinPlaywrightCLIVersion
        )
    }
    return PlaywrightVersionOK(
        status: "ok",
        version: version,
        minimum: kMinPlaywrightCLIVersion,
        source: source
    )
}

// Iterate PATH ourselves — avoids shelling out to `which` and gives us the
// exact resolved path we need for symlink walking below.
private func findPlaywrightCLIOnPath() -> String? {
    let env = ProcessInfo.processInfo.environment
    let path = env["PATH"] ?? ""
    for dir in path.split(separator: ":", omittingEmptySubsequences: true) {
        let candidate = "\(dir)/playwright-cli"
        if FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
    }
    return nil
}

// Resolve symlinks fully (Foundation's destinationOfSymbolicLink returns the
// raw link target, which may be relative and may point to another symlink).
// Bound to 16 hops to refuse pathological setups.
private func resolveSymlinks(_ path: String) -> String {
    var current = path
    let fm = FileManager.default
    for _ in 0..<16 {
        guard let target = try? fm.destinationOfSymbolicLink(atPath: current) else {
            break
        }
        if (target as NSString).isAbsolutePath {
            current = target
        } else {
            let parent = (current as NSString).deletingLastPathComponent
            let joined = (parent as NSString).appendingPathComponent(target)
            current = (joined as NSString).standardizingPath
        }
    }
    return current
}

// Walk up from the resolved binary's directory, looking for a package.json
// whose `name` is `@playwright/cli`. Returns its `version` or nil.
private func detectPackageVersion(fromBinary path: String) -> String? {
    let resolved = resolveSymlinks(path)
    var dir = (resolved as NSString).deletingLastPathComponent
    let fm = FileManager.default
    for _ in 0..<20 {
        let pj = "\(dir)/package.json"
        if fm.fileExists(atPath: pj),
           let data = try? Data(contentsOf: URL(fileURLWithPath: pj)),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let name = obj["name"] as? String,
           name == "@playwright/cli",
           let v = obj["version"] as? String {
            return v
        }
        let parent = (dir as NSString).deletingLastPathComponent
        if parent == dir || parent == "/" || parent.isEmpty { break }
        dir = parent
    }
    return nil
}

// Fallback: read the binary's own `--version`. The output is the PLAYWRIGHT
// engine version, not the CLI package version, so this is advisory.
private func runBinaryVersion() throws -> String {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
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
    return stdoutStr.trimmingCharacters(in: .whitespacesAndNewlines)
}

// Split a version string into integer segments. Pre-release suffixes
// (e.g. "1.2.3-rc.1") are dropped and only the numeric part retained.
// Returns an empty array when no numeric segment can be parsed.
private func parseVersionSegments(_ s: String) -> [Int] {
    let base = s.split(separator: "-").first.map(String.init) ?? s
    return base.split(separator: ".").compactMap { Int($0) }
}

// Semver-ish integer-by-integer compare. Pre-release suffixes (e.g. "1.2.3-rc.1")
// are dropped and the numeric part compared.
func compareVersions(_ a: String, _ b: String) -> Int {
    let pa = parseVersionSegments(a), pb = parseVersionSegments(b)
    let n = max(pa.count, pb.count)
    for i in 0..<n {
        let ai = i < pa.count ? pa[i] : 0
        let bi = i < pb.count ? pb[i] : 0
        if ai < bi { return -1 }
        if ai > bi { return 1 }
    }
    return 0
}
