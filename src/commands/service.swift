// service.swift — launchd-backed service control for aos.

import Foundation

private func serviceLabel(for mode: AOSRuntimeMode) -> String {
    aosServiceLabel(for: mode)
}

private struct ServiceInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    // Optional: a legacy daemon (lacking the structured `input_tap` block)
    // doesn't expose these. Emitted with `encodeIfPresent` so consumers see
    // the field absent rather than a fabricated `false`.
    let listen_access: Bool?
    let post_access: Bool?

    private enum CodingKeys: String, CodingKey {
        case status, attempts, listen_access, post_access
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(attempts, forKey: .attempts)
        try c.encodeIfPresent(listen_access, forKey: .listen_access)
        try c.encodeIfPresent(post_access, forKey: .post_access)
    }
}

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
    let reason: String?
    let input_tap: ServiceInputTapBlock?
    let recovery: [String]?
    let notes: [String]

    private enum CodingKeys: String, CodingKey {
        case status, mode, installed, running, pid, launchd_label
        case actual_binary_path, expected_binary_path
        case actual_log_path, expected_log_path
        case plist_path, state_dir
        case reason, input_tap, recovery, notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(mode, forKey: .mode)
        try c.encode(installed, forKey: .installed)
        try c.encode(running, forKey: .running)
        try c.encodeIfPresent(pid, forKey: .pid)
        try c.encode(launchd_label, forKey: .launchd_label)
        try c.encodeIfPresent(actual_binary_path, forKey: .actual_binary_path)
        try c.encode(expected_binary_path, forKey: .expected_binary_path)
        try c.encodeIfPresent(actual_log_path, forKey: .actual_log_path)
        try c.encode(expected_log_path, forKey: .expected_log_path)
        try c.encode(plist_path, forKey: .plist_path)
        try c.encode(state_dir, forKey: .state_dir)
        try c.encodeIfPresent(reason, forKey: .reason)
        try c.encodeIfPresent(input_tap, forKey: .input_tap)
        try c.encodeIfPresent(recovery, forKey: .recovery)
        try c.encode(notes, forKey: .notes)
    }
}

func serviceCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["service"], json: args.contains("--json"))
        exit(0)
    }
    guard let sub = args.first else {
        exitError("service requires a subcommand. Usage: aos service <install|start|stop|restart|status|logs> ...",
                  code: "MISSING_SUBCOMMAND")
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
        let paths = aosServicePaths(mode: options.mode)
        guardBinaryExists(paths.binaryPath)
        if !FileManager.default.fileExists(atPath: paths.plistPath) {
            installAOSService(asJSON: options.asJSON, mode: options.mode)
            return
        }
        if !isServiceLoaded(label: serviceLabel(for: options.mode)) {
            launchctlBootstrap(paths.plistPath)
        }
        launchctlKickstart(serviceLabel(for: options.mode))
        let outcome = verifyServiceReadiness(mode: options.mode)
        emitReadinessAndExit(
            outcome: outcome,
            mode: options.mode,
            context: .afterServiceRestart,
            asJSON: options.asJSON
        )
    case "status":
        let options = parseServiceOptions(subArgs, usage: "aos service status [--mode repo|installed] [--json]")
        emitAOSServiceStatus(asJSON: options.asJSON, mode: options.mode)
    case "logs":
        serviceLogsCommand(args: subArgs)
    case "_verify-readiness":
        let options = parseServiceOptions(subArgs, usage: "aos service _verify-readiness [--mode repo|installed] [--json] [--budget-ms N]", extraFlags: ["--budget-ms"])
        let outcome = verifyServiceReadiness(mode: options.mode, budgetMs: options.budgetMs)
        emitReadinessAndExit(outcome: outcome, mode: options.mode, context: .default, asJSON: options.asJSON)
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
    launchctlKickstart(serviceLabel(for: mode))

    let outcome = verifyServiceReadiness(mode: mode)
    emitReadinessAndExit(outcome: outcome, mode: mode, context: .default, asJSON: asJSON)
}

private func startAOSService(asJSON: Bool, mode: AOSRuntimeMode) {
    let paths = aosServicePaths(mode: mode)
    guardBinaryExists(paths.binaryPath)
    if !FileManager.default.fileExists(atPath: paths.plistPath) {
        // First-run: install + bootstrap + kickstart, then run the same
        // readiness probe. installAOSService exits via emitReadinessAndExit,
        // so control does not return.
        installAOSService(asJSON: asJSON, mode: mode)
        return
    }
    if !isServiceLoaded(label: serviceLabel(for: mode)) {
        launchctlBootstrap(paths.plistPath)
    }
    launchctlKickstart(serviceLabel(for: mode))

    let outcome = verifyServiceReadiness(mode: mode)
    emitReadinessAndExit(outcome: outcome, mode: mode, context: .default, asJSON: asJSON)
}

private func stopAOSService(asJSON: Bool, mode: AOSRuntimeMode, emitStatus: Bool) {
    let paths = aosServicePaths(mode: mode)
    if FileManager.default.fileExists(atPath: paths.plistPath) && isServiceLoaded(label: serviceLabel(for: mode)) {
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
    let pid = servicePID(label: serviceLabel(for: mode))
    let running = pid != nil
    let actualBinaryPath = installed ? plistValue(paths.plistPath, keyPath: ":ProgramArguments:0") : nil
    let actualLogPath = installed ? plistValue(paths.plistPath, keyPath: ":StandardErrorPath") : nil

    var notes: [String] = []
    if !installed {
        notes.append("Launch agent plist is not installed.")
    }
    if installed && !isServiceLoaded(label: serviceLabel(for: mode)) {
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
        launchd_label: serviceLabel(for: mode),
        actual_binary_path: actualBinaryPath,
        expected_binary_path: paths.binaryPath,
        actual_log_path: actualLogPath,
        expected_log_path: paths.stderrLogPath,
        plist_path: paths.plistPath,
        state_dir: paths.logDir,
        reason: nil,
        input_tap: nil,
        recovery: nil,
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
        plistPath: "\(launchAgentsDir)/\(serviceLabel(for: mode)).plist",
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
        "Label": serviceLabel(for: paths.mode),
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
    let budgetMs: Int
}

private func parseServiceOptions(_ args: [String], usage: String, extraFlags: [String] = []) -> ServiceCommandOptions {
    var asJSON = false
    var mode: AOSRuntimeMode? = nil
    var tailCount = 200
    var budgetMs = 5000
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
        case "--budget-ms" where extraFlags.contains("--budget-ms"):
            i += 1
            guard i < args.count, let value = Int(args[i]), value > 0 else {
                exitError("--budget-ms requires a positive integer", code: "INVALID_ARG")
            }
            budgetMs = value
        default:
            exitError("Unknown flag: \(args[i])", code: "UNKNOWN_FLAG")
        }
        i += 1
    }

    return ServiceCommandOptions(
        mode: mode ?? aosCurrentRuntimeMode(),
        asJSON: asJSON,
        tailCount: tailCount,
        budgetMs: budgetMs
    )
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

// MARK: - Readiness Probe

/// Block-and-poll the daemon socket for up to `budgetMs` milliseconds,
/// classifying the daemon's input-tap subsystem.
///
/// - Returns:
///   - `.ok(view)` when the socket is reachable and `input_tap.status == "active"`.
///   - `.inputTapInactive(view)` when the socket is reachable but the tap is
///     `retrying` or `unavailable` after the budget.
///   - `.socketUnreachable` when the budget elapses without any successful ping.
func verifyServiceReadiness(mode: AOSRuntimeMode, budgetMs: Int = 5000) -> ServiceReadinessOutcome {
    let socketPath = aosSocketPath(for: mode)
    let deadline = Date().addingTimeInterval(Double(budgetMs) / 1000.0)
    let pollIntervalUs: UInt32 = 100_000  // 100 ms

    var lastView: DaemonHealthView? = nil

    while Date() < deadline {
        if let response = sendEnvelopeRequest(
            service: "system",
            action: "ping",
            data: [:],
            socketPath: socketPath,
            timeoutMs: 250
        ), let view = parseDaemonHealthView(from: response) {
            lastView = view
            if view.inputTap.status == "active" {
                return .ok(view: view)
            }
        }
        usleep(pollIntervalUs)
    }

    if let view = lastView {
        return .inputTapInactive(view: view)
    }
    return .socketUnreachable
}

/// Build a ServiceStatusResponse from a readiness outcome by overlaying
/// readiness fields onto the launchd-state response.
private func readinessResponse(
    outcome: ServiceReadinessOutcome,
    mode: AOSRuntimeMode,
    context: RecoveryGuidanceContext
) -> ServiceStatusResponse {
    let base = currentAOSServiceStatus(mode: mode)
    let inputTap: ServiceInputTapBlock?
    if let view = outcome.view {
        inputTap = ServiceInputTapBlock(
            status: view.inputTap.status,
            attempts: view.inputTap.attempts,
            listen_access: view.inputTap.listenAccess,
            post_access: view.inputTap.postAccess
        )
    } else {
        inputTap = nil
    }

    var notes = base.notes
    if case .inputTapInactive(let view) = outcome {
        notes.append(inputTapRecoveryGuidance(
            context: context,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        ))
        if view.inputTap.listenAccess == false || view.inputTap.postAccess == false {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    } else if case .socketUnreachable = outcome {
        notes.append("Daemon socket was not reachable within the readiness budget.")
    }

    let recovery: [String]?
    if case .inputTapInactive = outcome {
        recovery = inputTapRecoveryCommands(context: context)
    } else {
        recovery = nil
    }

    // An .ok readiness outcome confirms tap state but must not upgrade a
    // base launchd-degraded status (e.g., plist binary mismatch). Only
    // override toward "degraded".
    let mergedStatus = outcome.statusString == "ok" ? base.status : outcome.statusString

    return ServiceStatusResponse(
        status: mergedStatus,
        mode: base.mode,
        installed: base.installed,
        running: base.running,
        pid: base.pid,
        launchd_label: base.launchd_label,
        actual_binary_path: base.actual_binary_path,
        expected_binary_path: base.expected_binary_path,
        actual_log_path: base.actual_log_path,
        expected_log_path: base.expected_log_path,
        plist_path: base.plist_path,
        state_dir: base.state_dir,
        reason: outcome.reason,
        input_tap: inputTap,
        recovery: recovery,
        notes: notes
    )
}

private func emitReadinessAndExit(
    outcome: ServiceReadinessOutcome,
    mode: AOSRuntimeMode,
    context: RecoveryGuidanceContext,
    asJSON: Bool
) -> Never {
    let response = readinessResponse(outcome: outcome, mode: mode, context: context)
    if asJSON {
        print(jsonString(response))
    } else {
        print("mode=\(response.mode) installed=\(response.installed) running=\(response.running) pid=\(response.pid?.description ?? "none") label=\(response.launchd_label) status=\(response.status)\(response.reason.map { " reason=\($0)" } ?? "")")
        if let tap = response.input_tap {
            let listen = tap.listen_access.map { $0 ? "true" : "false" } ?? "unknown"
            let post = tap.post_access.map { $0 ? "true" : "false" } ?? "unknown"
            print("input_tap status=\(tap.status) attempts=\(tap.attempts) listen=\(listen) post=\(post)")
        }
        for note in response.notes where !note.isEmpty {
            print(note)
        }
    }
    exit(Int32(outcome.exitCode))
}
