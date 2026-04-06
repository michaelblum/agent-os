// service.swift — launchd-backed service control for aos.

import Foundation

private let kAOSServiceLabel = "com.agent-os.aos"

private struct ServiceStatusResponse: Encodable {
    let status: String
    let installed: Bool
    let running: Bool
    let pid: Int?
    let launchd_label: String
    let binary_path: String
    let plist_path: String
    let log_path: String
    let notes: [String]
}

func serviceCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos service <install|start|stop|restart|status|logs>", code: "MISSING_SUBCOMMAND")
    }

    switch sub {
    case "install":
        let asJSON = parseJSONFlag(Array(args.dropFirst()), usage: "aos service install [--json]")
        installAOSService(asJSON: asJSON)
    case "start":
        let asJSON = parseJSONFlag(Array(args.dropFirst()), usage: "aos service start [--json]")
        startAOSService(asJSON: asJSON)
    case "stop":
        let asJSON = parseJSONFlag(Array(args.dropFirst()), usage: "aos service stop [--json]")
        stopAOSService(asJSON: asJSON, emitStatus: true)
    case "restart":
        let asJSON = parseJSONFlag(Array(args.dropFirst()), usage: "aos service restart [--json]")
        restartAOSService(asJSON: asJSON)
    case "status":
        let asJSON = parseJSONFlag(Array(args.dropFirst()), usage: "aos service status [--json]")
        emitAOSServiceStatus(asJSON: asJSON)
    case "logs":
        serviceLogsCommand(args: Array(args.dropFirst()))
    default:
        exitError("Unknown service subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func installAOSService(asJSON: Bool) {
    let paths = aosServicePaths()
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

    let bootstrap = runProcess("/bin/launchctl", arguments: ["bootstrap", launchDomain(), paths.plistPath])
    if bootstrap.exitCode != 0 && !bootstrap.stderr.contains("already bootstrapped") {
        exitError("launchctl bootstrap failed: \(bootstrap.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }

    let kickstart = runProcess("/bin/launchctl", arguments: ["kickstart", "-k", "\(launchDomain())/\(kAOSServiceLabel)"])
    if kickstart.exitCode != 0 {
        exitError("launchctl kickstart failed: \(kickstart.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }

    emitAOSServiceStatus(asJSON: asJSON)
}

private func startAOSService(asJSON: Bool) {
    let paths = aosServicePaths()
    if !FileManager.default.fileExists(atPath: paths.plistPath) {
        installAOSService(asJSON: asJSON)
        return
    }

    if !isServiceLoaded(label: kAOSServiceLabel) {
        let bootstrap = runProcess("/bin/launchctl", arguments: ["bootstrap", launchDomain(), paths.plistPath])
        if bootstrap.exitCode != 0 {
            exitError("launchctl bootstrap failed: \(bootstrap.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
        }
    }

    let kickstart = runProcess("/bin/launchctl", arguments: ["kickstart", "-k", "\(launchDomain())/\(kAOSServiceLabel)"])
    if kickstart.exitCode != 0 {
        exitError("launchctl kickstart failed: \(kickstart.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
    }

    emitAOSServiceStatus(asJSON: asJSON)
}

private func stopAOSService(asJSON: Bool, emitStatus: Bool) {
    let paths = aosServicePaths()
    if FileManager.default.fileExists(atPath: paths.plistPath) && isServiceLoaded(label: kAOSServiceLabel) {
        let bootout = runProcess("/bin/launchctl", arguments: ["bootout", launchDomain(), paths.plistPath])
        if bootout.exitCode != 0 &&
            !bootout.stderr.contains("No such process") &&
            !bootout.stderr.contains("service could not be found") {
            exitError("launchctl bootout failed: \(bootout.stderr.trimmingCharacters(in: .whitespacesAndNewlines))", code: "LAUNCHCTL_ERROR")
        }
    }
    if emitStatus {
        emitAOSServiceStatus(asJSON: asJSON)
    }
}

private func restartAOSService(asJSON: Bool) {
    stopAOSService(asJSON: false, emitStatus: false)
    startAOSService(asJSON: asJSON)
}

private func emitAOSServiceStatus(asJSON: Bool) {
    let response = currentAOSServiceStatus()
    if asJSON {
        print(jsonString(response))
    } else {
        print("installed=\(response.installed) running=\(response.running) pid=\(response.pid.map(String.init) ?? "none") label=\(response.launchd_label)")
    }
}

private func serviceLogsCommand(args: [String]) {
    var tailCount = 200
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--tail":
            i += 1
            guard i < args.count, let value = Int(args[i]) else {
                exitError("--tail requires an integer", code: "INVALID_ARG")
            }
            tailCount = value
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }

    let logPath = aosServicePaths().stderrLogPath
    guard let contents = try? String(contentsOfFile: logPath, encoding: .utf8) else {
        exitError("No service log found at \(logPath)", code: "FILE_NOT_FOUND")
    }
    let lines = contents.split(separator: "\n", omittingEmptySubsequences: false)
    let tail = lines.suffix(max(0, tailCount))
    print(tail.joined(separator: "\n"))
}

private func currentAOSServiceStatus() -> ServiceStatusResponse {
    let paths = aosServicePaths()
    let installed = FileManager.default.fileExists(atPath: paths.plistPath)
    let pid = servicePID(label: kAOSServiceLabel)
    let running = pid != nil

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

    return ServiceStatusResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        installed: installed,
        running: running,
        pid: pid,
        launchd_label: kAOSServiceLabel,
        binary_path: paths.binaryPath,
        plist_path: paths.plistPath,
        log_path: paths.stderrLogPath,
        notes: notes
    )
}

private struct AOSServicePaths {
    let launchAgentsDir: String
    let plistPath: String
    let stdoutLogPath: String
    let stderrLogPath: String
    let logDir: String
    let binaryPath: String
}

private func aosServicePaths() -> AOSServicePaths {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let launchAgentsDir = "\(home)/Library/LaunchAgents"
    let logDir = "\(home)/.config/aos"
    let binaryPath = preferredAOSServiceBinaryPath(homeDir: home)
    return AOSServicePaths(
        launchAgentsDir: launchAgentsDir,
        plistPath: "\(launchAgentsDir)/\(kAOSServiceLabel).plist",
        stdoutLogPath: "\(logDir)/daemon.stdout.log",
        stderrLogPath: "\(logDir)/daemon.log",
        logDir: logDir,
        binaryPath: binaryPath
    )
}

private func preferredAOSServiceBinaryPath(homeDir: String) -> String {
    if let override = ProcessInfo.processInfo.environment["AOS_SERVICE_BINARY"], !override.isEmpty {
        return absolutePath(override)
    }

    let installedRuntime = "\(homeDir)/Applications/AOS.app/Contents/MacOS/aos"
    if FileManager.default.isExecutableFile(atPath: installedRuntime) {
        return installedRuntime
    }

    return absolutePath(CommandLine.arguments[0])
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

private func parseJSONFlag(_ args: [String], usage: String) -> Bool {
    var asJSON = false
    for arg in args {
        if arg == "--json" {
            asJSON = true
        } else {
            exitError("Usage: \(usage)", code: "UNKNOWN_ARG")
        }
    }
    return asJSON
}

private func launchDomain() -> String {
    "gui/\(getuid())"
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

private func absolutePath(_ path: String) -> String {
    if path.hasPrefix("/") {
        return NSString(string: path).standardizingPath
    }
    return NSString(string: FileManager.default.currentDirectoryPath.appending("/\(path)")).standardizingPath
}
