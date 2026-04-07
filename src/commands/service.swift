// service.swift — launchd-backed service control for aos.

import Foundation

private let kAOSServiceLabel = "com.agent-os.aos"

private struct ServiceStatusResponse: Encodable {
    let status: String
    let mode: String
    let installed: Bool
    let running: Bool
    let pid: Int?
    let launchd_label: String
    let actual_binary_path: String?
    let expected_binary_path: String
    let actual_log_path: String?
    let expected_log_path: String
    let plist_path: String
    let state_dir: String
    let notes: [String]
}

func serviceCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos service <install|start|stop|restart|status|logs>", code: "MISSING_SUBCOMMAND")
    }

    let subArgs = Array(args.dropFirst())
    switch sub {
    case "install":
        let options = parseServiceOptions(subArgs, usage: "aos service install [--mode repo|installed] [--json]")
        installAOSService(asJSON: options.asJSON, mode: options.mode)
    case "start":
        let options = parseServiceOptions(subArgs, usage: "aos service start [--mode repo|installed] [--json]")
        startAOSService(asJSON: options.asJSON, mode: options.mode)
    case "stop":
        let options = parseServiceOptions(subArgs, usage: "aos service stop [--mode repo|installed] [--json]")
        stopAOSService(asJSON: options.asJSON, mode: options.mode, emitStatus: true)
    case "restart":
        let options = parseServiceOptions(subArgs, usage: "aos service restart [--mode repo|installed] [--json]")
        stopAOSService(asJSON: false, mode: options.mode, emitStatus: false)
        startAOSService(asJSON: options.asJSON, mode: options.mode)
    case "status":
        let options = parseServiceOptions(subArgs, usage: "aos service status [--mode repo|installed] [--json]")
        emitAOSServiceStatus(asJSON: options.asJSON, mode: options.mode)
    case "logs":
        serviceLogsCommand(args: subArgs)
    default:
        exitError("Unknown service subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

// MARK: - Launchctl Helpers

private func launchDomain() -> String {
    "gui/\(getuid())"
}

private func launchctlBootstrap(_ plistPath: String, tolerateAlreadyBootstrapped: Bool = false) {
    let result = runProcess("/bin/launchctl", arguments: ["bootstrap", launchDomain(), plistPath])
    if result.exitCode != 0 {
        if tolerateAlreadyBootstrapped && result.stderr.contains("already bootstrapped") { return }
        exitError("launchctl bootstrap failed: \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }
}

private func launchctlKickstart(_ label: String) {
    let result = runProcess("/bin/launchctl", arguments: ["kickstart", "-k", "\(launchDomain())/\(label)"])
    if result.exitCode != 0 {
        exitError("launchctl kickstart failed: \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }
}

private func launchctlBootout(_ plistPath: String) {
    let result = runProcess("/bin/launchctl", arguments: ["bootout", launchDomain(), plistPath])
    if result.exitCode != 0 &&
        !result.stderr.contains("No such process") &&
        !result.stderr.contains("service could not be found") {
        exitError("launchctl bootout failed: \(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }
}

private func guardBinaryExists(_ path: String) {
    guard FileManager.default.isExecutableFile(atPath: path) else {
        exitError("Service binary is missing or not executable: \(path)", code: "FILE_NOT_FOUND")
    }
}

private func isServiceLoaded(label: String) -> Bool {
    runProcess("/bin/launchctl", arguments: ["print", "\(launchDomain())/\(label)"]).exitCode == 0
}

private func servicePID(label: String) -> Int? {
    let output = runProcess("/bin/launchctl", arguments: ["print", "\(launchDomain())/\(label)"])
    guard output.exitCode == 0 else { return nil }
    for rawLine in output.stdout.split(whereSeparator: \.isNewline) {
        let line = rawLine.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("pid = ") {
            return Int(line.replacingOccurrences(of: "pid = ", with: ""))
        }
    }
    return nil
}

// MARK: - Service Lifecycle

private func installAOSService(asJSON: Bool, mode: AOSRuntimeMode) {
    let paths = aosServicePaths(mode: mode)
    guardBinaryExists(paths.binaryPath)
    do {
        try FileManager.default.createDirectory(atPath: paths.logDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: paths.launchAgentsDir, withIntermediateDirectories: true)
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: aosServicePlist(paths: paths),
            format: .xml,
            options: 0
        )
        try plistData.write(to: URL(fileURLWithPath: paths.plistPath))
    } catch {
        exitError("Failed to write launch agent plist: \(error)", code: "WRITE_ERROR")
    }
    launchctlBootstrap(paths.plistPath, tolerateAlreadyBootstrapped: true)
    launchctlKickstart(kAOSServiceLabel)
    emitAOSServiceStatus(asJSON: asJSON, mode: mode)
}

private func startAOSService(asJSON: Bool, mode: AOSRuntimeMode) {
    let paths = aosServicePaths(mode: mode)
    guardBinaryExists(paths.binaryPath)
    if !FileManager.default.fileExists(atPath: paths.plistPath) {
        installAOSService(asJSON: asJSON, mode: mode)
        return
    }
    if !isServiceLoaded(label: kAOSServiceLabel) {
        launchctlBootstrap(paths.plistPath)
    }
    launchctlKickstart(kAOSServiceLabel)
    emitAOSServiceStatus(asJSON: asJSON, mode: mode)
}

private func stopAOSService(asJSON: Bool, mode: AOSRuntimeMode, emitStatus: Bool) {
    let paths = aosServicePaths(mode: mode)
    if FileManager.default.fileExists(atPath: paths.plistPath) && isServiceLoaded(label: kAOSServiceLabel) {
        launchctlBootout(paths.plistPath)
    }
    if emitStatus {
        emitAOSServiceStatus(asJSON: asJSON, mode: mode)
    }
}

// MARK: - Status & Logs

private func emitAOSServiceStatus(asJSON: Bool, mode: AOSRuntimeMode) {
    let response = currentAOSServiceStatus(mode: mode)
    if asJSON {
        print(jsonString(response))
    } else {
        print("mode=\(response.mode) installed=\(response.installed) running=\(response.running) pid=\(response.pid?.description ?? "none") label=\(response.launchd_label)")
    }
}

private func serviceLogsCommand(args: [String]) {
    let options = parseServiceOptions(args, usage: "aos service logs [--mode repo|installed] [--tail N]", extraFlags: ["--tail"])
    let logPath = aosServicePaths(mode: options.mode).stderrLogPath
    guard let contents = try? String(contentsOfFile: logPath, encoding: .utf8) else {
        exitError("No service log found at \(logPath)", code: "FILE_NOT_FOUND")
    }
    let lines = contents.split(separator: "\n", omittingEmptySubsequences: false)
    print(lines.suffix(options.tailCount).joined(separator: "\n"))
}

private func currentAOSServiceStatus(mode: AOSRuntimeMode) -> ServiceStatusResponse {
    let paths = aosServicePaths(mode: mode)
    let installed = FileManager.default.fileExists(atPath: paths.plistPath)
    let pid = servicePID(label: kAOSServiceLabel)
    let running = pid != nil
    let actualBinaryPath = installed ? plistValue(paths.plistPath, keyPath: ":ProgramArguments:0") : nil
    let actualLogPath = installed ? plistValue(paths.plistPath, keyPath: ":StandardErrorPath") : nil

    var notes: [String] = []
    if !installed {
        notes.append("Launch agent plist is not installed.")
    }
    if installed && !isServiceLoaded(label: kAOSServiceLabel) {
        notes.append("Launch agent is installed but not loaded in launchd.")
    }
    if installed && !running {
        notes.append("Service is not running.")
    }
    if let actualBinaryPath, actualBinaryPath != paths.binaryPath {
        notes.append("Launch agent target differs from the expected \(mode.rawValue) binary.")
    }
    if let actualLogPath, actualLogPath != paths.stderrLogPath {
        notes.append("Launch agent log path differs from the expected \(mode.rawValue) state directory.")
    }
    if !FileManager.default.isExecutableFile(atPath: paths.binaryPath) {
        notes.append("Expected \(mode.rawValue) service binary is missing or not executable.")
    }

    return ServiceStatusResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        mode: mode.rawValue,
        installed: installed,
        running: running,
        pid: pid,
        launchd_label: kAOSServiceLabel,
        actual_binary_path: actualBinaryPath,
        expected_binary_path: paths.binaryPath,
        actual_log_path: actualLogPath,
        expected_log_path: paths.stderrLogPath,
        plist_path: paths.plistPath,
        state_dir: paths.logDir,
        notes: notes
    )
}

// MARK: - Paths & Plist

private struct AOSServicePaths {
    let mode: AOSRuntimeMode
    let launchAgentsDir: String
    let plistPath: String
    let stdoutLogPath: String
    let stderrLogPath: String
    let logDir: String
    let binaryPath: String
}

private func aosServicePaths(mode: AOSRuntimeMode) -> AOSServicePaths {
    let home = aosHomeDir()
    let launchAgentsDir = "\(home)/Library/LaunchAgents"
    let logDir = aosStateDir(for: mode)
    return AOSServicePaths(
        mode: mode,
        launchAgentsDir: launchAgentsDir,
        plistPath: "\(launchAgentsDir)/\(kAOSServiceLabel).plist",
        stdoutLogPath: aosDaemonStdoutLogPath(for: mode),
        stderrLogPath: aosDaemonLogPath(for: mode),
        logDir: logDir,
        binaryPath: aosServiceBinaryPath(mode: mode)
    )
}

private func aosServiceBinaryPath(mode: AOSRuntimeMode) -> String {
    if let override = ProcessInfo.processInfo.environment["AOS_SERVICE_BINARY"], !override.isEmpty {
        return absolutePath(override)
    }
    return aosExpectedBinaryPath(program: "aos", mode: mode)
}

private func aosServicePlist(paths: AOSServicePaths) -> [String: Any] {
    [
        "Label": kAOSServiceLabel,
        "ProgramArguments": [paths.binaryPath, "serve", "--idle-timeout", "none"],
        "RunAtLoad": true,
        "KeepAlive": true,
        "WorkingDirectory": (paths.binaryPath as NSString).deletingLastPathComponent,
        "StandardOutPath": paths.stdoutLogPath,
        "StandardErrorPath": paths.stderrLogPath
    ]
}

// MARK: - Argument Parsing

private struct ServiceCommandOptions {
    let mode: AOSRuntimeMode
    let asJSON: Bool
    let tailCount: Int
}

private func parseServiceOptions(_ args: [String], usage: String, extraFlags: [String] = []) -> ServiceCommandOptions {
    var asJSON = false
    var mode: AOSRuntimeMode? = nil
    var tailCount = 200
    var i = 0

    while i < args.count {
        switch args[i] {
        case "--json":
            asJSON = true
        case "--mode":
            i += 1
            guard i < args.count, let parsed = AOSRuntimeMode(rawValue: args[i]) else {
                exitError("--mode must be 'repo' or 'installed'", code: "INVALID_ARG")
            }
            mode = parsed
        case "--tail" where extraFlags.contains("--tail"):
            i += 1
            guard i < args.count, let value = Int(args[i]) else {
                exitError("--tail requires an integer", code: "INVALID_ARG")
            }
            tailCount = value
        default:
            exitError("Usage: \(usage)", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    return ServiceCommandOptions(mode: mode ?? aosCurrentRuntimeMode(), asJSON: asJSON, tailCount: tailCount)
}

// MARK: - Utility

private func absolutePath(_ path: String) -> String {
    if path.hasPrefix("/") {
        return NSString(string: path).standardizingPath
    }
    return NSString(string: FileManager.default.currentDirectoryPath.appending("/\(path)")).standardizingPath
}

private func plistValue(_ plistPath: String, keyPath: String) -> String? {
    let output = runProcess("/usr/libexec/PlistBuddy", arguments: ["-c", "Print \(keyPath)", plistPath])
    guard output.exitCode == 0 else { return nil }
    let value = output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
}
