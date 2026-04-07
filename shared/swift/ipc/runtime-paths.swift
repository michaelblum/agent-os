// runtime-paths.swift — runtime mode, identity, and state path helpers.

import Foundation

enum AOSRuntimeMode: String, CaseIterable, Codable {
    case repo
    case installed

    var other: AOSRuntimeMode {
        switch self {
        case .repo:
            return .installed
        case .installed:
            return .repo
        }
    }
}

struct AOSRuntimeIdentity: Encodable {
    let program: String
    let mode: String
    let executable_path: String
    let state_dir: String
    let socket_path: String
    let build_timestamp: String?
    let repo_root: String?
    let git_commit: String?
    let bundle_version: String?
    let bundle_build: String?
}

func aosHomeDir() -> String {
    FileManager.default.homeDirectoryForCurrentUser.path
}

func aosInstallAppPath() -> String {
    ProcessInfo.processInfo.environment["AOS_INSTALL_PATH"] ?? "\(aosHomeDir())/Applications/AOS.app"
}

func aosExecutablePath() -> String {
    NSString(string: CommandLine.arguments[0]).standardizingPath
}

func aosCurrentRuntimeMode(executablePath: String = aosExecutablePath()) -> AOSRuntimeMode {
    if let override = ProcessInfo.processInfo.environment["AOS_RUNTIME_MODE"]?.lowercased() {
        if override == "repo" { return .repo }
        if override == "installed" { return .installed }
    }

    let standardized = NSString(string: executablePath).standardizingPath
    if standardized.contains(".app/Contents/MacOS/") {
        return .installed
    }
    return .repo
}

func aosLegacyStateDir() -> String {
    NSString(string: "~/.config/aos").expandingTildeInPath
}

func aosStateDir(for mode: AOSRuntimeMode? = nil) -> String {
    let resolved = mode ?? aosCurrentRuntimeMode()
    return "\(aosLegacyStateDir())/\(resolved.rawValue)"
}

func aosSocketPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/sock"
}

func aosConfigPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/config.json"
}

func aosProfilesDir(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/profiles"
}

func aosPermissionsMarkerPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/permissions-onboarding.json"
}

func aosDaemonLogPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/daemon.log"
}

func aosDaemonStdoutLogPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/daemon.stdout.log"
}

func aosSigilLogPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/sigil.log"
}

func aosSigilStdoutLogPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/sigil.stdout.log"
}

// MARK: - Launchd Labels (mode-scoped)

func aosServiceLabel(for mode: AOSRuntimeMode? = nil) -> String {
    let resolved = mode ?? aosCurrentRuntimeMode()
    return "com.agent-os.aos.\(resolved.rawValue)"
}

func aosSigilServiceLabel(for mode: AOSRuntimeMode? = nil) -> String {
    let resolved = mode ?? aosCurrentRuntimeMode()
    return "com.agent-os.sigil.\(resolved.rawValue)"
}

func aosServicePlistPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosHomeDir())/Library/LaunchAgents/\(aosServiceLabel(for: mode)).plist"
}

func aosSigilPlistPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosHomeDir())/Library/LaunchAgents/\(aosSigilServiceLabel(for: mode)).plist"
}

/// All known launchd labels (both modes, both services) for cleanup/doctor.
func aosAllServiceLabels() -> [String] {
    AOSRuntimeMode.allCases.flatMap { mode in
        [aosServiceLabel(for: mode), aosSigilServiceLabel(for: mode)]
    }
}

/// Legacy labels that may still be loaded from before the mode split.
let aosLegacyServiceLabels = ["com.agent-os.aos", "com.agent-os.sigil", "com.agent-os.heads-up"]

func aosInstalledBinaryPath(_ executableName: String) -> String {
    "\(aosInstallAppPath())/Contents/MacOS/\(executableName)"
}

func aosInstalledSigilWorkDir() -> String {
    "\(aosInstallAppPath())/Contents/Resources/agent-os/apps/sigil"
}

func aosRepoRootFromBases(_ bases: [String]) -> String? {
    if let override = ProcessInfo.processInfo.environment["AOS_REPO_ROOT"], !override.isEmpty {
        let path = NSString(string: override).standardizingPath
        if FileManager.default.fileExists(atPath: (path as NSString).appendingPathComponent("packages/toolkit/components/inspector-panel.html")) {
            return path
        }
    }

    let sentinel = "packages/toolkit/components/inspector-panel.html"
    let suffixes = ["", "..", "../..", "../../.."]

    for base in bases {
        for suffix in suffixes {
            let candidate = NSString(string: (base as NSString).appendingPathComponent(suffix)).standardizingPath
            let sentinelPath = (candidate as NSString).appendingPathComponent(sentinel)
            if FileManager.default.fileExists(atPath: sentinelPath) {
                return candidate
            }
        }
    }

    return nil
}

func aosBundledRepoRoot(executablePath: String = aosExecutablePath()) -> String? {
    let executableURL = URL(fileURLWithPath: executablePath).standardizedFileURL
    let bundleURL = executableURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let resourcesRoot = bundleURL.appendingPathComponent("Contents/Resources/agent-os").path
    let sentinel = (resourcesRoot as NSString).appendingPathComponent("packages/toolkit/components/inspector-panel.html")
    return FileManager.default.fileExists(atPath: sentinel) ? resourcesRoot : nil
}

func aosCurrentRepoRoot(executablePath: String = aosExecutablePath()) -> String? {
    if aosCurrentRuntimeMode(executablePath: executablePath) == .installed,
       let bundled = aosBundledRepoRoot(executablePath: executablePath) {
        return bundled
    }

    return aosRepoRootFromBases([
        URL(fileURLWithPath: executablePath).standardizedFileURL.deletingLastPathComponent().path,
        FileManager.default.currentDirectoryPath
    ])
}

func aosExpectedBinaryPath(program: String, mode: AOSRuntimeMode) -> String {
    switch mode {
    case .installed:
        return aosInstalledBinaryPath(program)
    case .repo:
        if let repoRoot = aosCurrentRepoRoot() {
            let relative = program == "avatar-sub" ? "apps/sigil/build/avatar-sub" : program
            return NSString(string: (repoRoot as NSString).appendingPathComponent(relative)).standardizingPath
        }
        return NSString(string: FileManager.default.currentDirectoryPath).appendingPathComponent(program)
    }
}

func aosIdentityLogLine(program: String) -> String {
    let identity = aosCurrentRuntimeIdentity(program: program)
    let data = try? JSONEncoder().encode(identity)
    let payload = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    return "runtime_identity \(payload)"
}

func aosCurrentRuntimeIdentity(program: String) -> AOSRuntimeIdentity {
    let executablePath = aosExecutablePath()
    let mode = aosCurrentRuntimeMode(executablePath: executablePath)
    let buildTimestamp = executableBuildTimestamp(path: executablePath)
    let repoRoot = aosCurrentRepoRoot(executablePath: executablePath)
    let gitCommit = repoRoot.flatMap(executableGitCommit(repoRoot:))
    let bundleInfo = executableBundleInfo(executablePath: executablePath)

    return AOSRuntimeIdentity(
        program: program,
        mode: mode.rawValue,
        executable_path: executablePath,
        state_dir: aosStateDir(for: mode),
        socket_path: aosSocketPath(for: mode),
        build_timestamp: buildTimestamp,
        repo_root: repoRoot,
        git_commit: gitCommit,
        bundle_version: bundleInfo.version,
        bundle_build: bundleInfo.build
    )
}

private func executableBuildTimestamp(path: String) -> String? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let modified = attrs[.modificationDate] as? Date else {
        return nil
    }
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime]
    return fmt.string(from: modified)
}

private func executableGitCommit(repoRoot: String) -> String? {
    let output = tinyProcessOutput(
        executable: "/usr/bin/git",
        arguments: ["-C", repoRoot, "rev-parse", "--short", "HEAD"]
    )?.trimmingCharacters(in: .whitespacesAndNewlines)
    return output?.isEmpty == false ? output : nil
}

private func executableBundleInfo(executablePath: String) -> (version: String?, build: String?) {
    let executableURL = URL(fileURLWithPath: executablePath).standardizedFileURL
    let bundleURL = executableURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let infoPlistPath = bundleURL.appendingPathComponent("Contents/Info.plist").path

    guard FileManager.default.fileExists(atPath: infoPlistPath),
          let data = FileManager.default.contents(atPath: infoPlistPath),
          let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
        return (nil, nil)
    }

    return (
        plist["CFBundleShortVersionString"] as? String,
        plist["CFBundleVersion"] as? String
    )
}

private func tinyProcessOutput(executable: String, arguments: [String]) -> String? {
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
        return nil
    }

    guard process.terminationStatus == 0 else { return nil }
    let data = stdout.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)
}
