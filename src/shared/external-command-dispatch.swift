// external-command-dispatch.swift — Manifest-backed command launcher

import Darwin
import Foundation

private let externalCommandManifestRelativePath = "manifests/commands/aos-external-commands.json"

private struct ExternalCommandManifest: Decodable {
    let schemaVersion: Int
    let commands: [ExternalCommand]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case commands
    }
}

private struct ExternalCommand: Decodable {
    let path: [String]
    let executable: String
    let argvPrefix: [String]
    let cwd: String?
    let env: [String: String]?
    let stdio: ExternalCommandStdio?
    let when: ExternalCommandCondition?

    enum CodingKeys: String, CodingKey {
        case path
        case executable
        case argvPrefix = "argv_prefix"
        case cwd
        case env
        case stdio
        case when
    }
}

private struct ExternalCommandCondition: Decodable {
    let childArgIndex: Int?
    let childArgMissing: Bool?
    let prefix: String?
    let excludedPrefixes: [String]?
    let excludedValues: [String]?

    enum CodingKeys: String, CodingKey {
        case childArgIndex = "child_arg_index"
        case childArgMissing = "child_arg_missing"
        case prefix
        case excludedPrefixes = "excluded_prefixes"
        case excludedValues = "excluded_values"
    }
}

private enum ExternalCommandStdio: String, Decodable {
    case capture
    case inherit
}

func runExternalCommandIfMatched(args: [String]) -> Bool {
    if args.contains("--help") || args.contains("-h") {
        return false
    }
    guard let aosRepoRoot = aosCurrentRepoRoot() else {
        return false
    }
    let manifestPath = (aosRepoRoot as NSString).appendingPathComponent(externalCommandManifestRelativePath)
    guard FileManager.default.fileExists(atPath: manifestPath),
          let data = try? Data(contentsOf: URL(fileURLWithPath: manifestPath)) else {
        return false
    }

    let manifest: ExternalCommandManifest
    do {
        manifest = try JSONDecoder().decode(ExternalCommandManifest.self, from: data)
    } catch {
        exitError("Invalid external command manifest \(manifestPath): \(error)", code: "INVALID_MANIFEST")
    }
    guard manifest.schemaVersion == 1 else {
        exitError("Unsupported external command manifest schema_version \(manifest.schemaVersion)", code: "INVALID_MANIFEST")
    }
    guard let command = manifest.commands
        .filter({ externalCommandMatches($0, args: args) })
        .max(by: { $0.path.count < $1.path.count }) else {
        return false
    }

    let repoOverride = rawOptionValue(args, "--repo")
    let commandRepoRoot = resolveExternalRepoRoot(repoOverride)
    let executable = resolveExternalExecutable(
        command.executable,
        repoRoot: commandRepoRoot,
        aosRepoRoot: aosRepoRoot
    )
    let childArgs = Array(args.dropFirst(command.path.count))
    let argv = command.argvPrefix.map {
        resolveExternalArg($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot)
    } + childArgs
    let cwd = command.cwd == "repo"
        ? commandRepoRoot
        : command.cwd.map { resolveExternalArg($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot) }
    let environment = command.env.map {
        resolveExternalEnvironment($0, repoRoot: commandRepoRoot, aosRepoRoot: aosRepoRoot)
    }
    if command.stdio == .inherit {
        exit(runExternalProcessInheritingStdio(executable, arguments: argv, cwd: cwd, environment: environment))
    }
    let result = runExternalProcessCapturingOutput(executable, arguments: argv, cwd: cwd, environment: environment)
    if !result.stdout.isEmpty, let data = result.stdout.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(result.exitCode)
}

private func externalCommandPathMatches(_ path: [String], args: [String]) -> Bool {
    guard !path.isEmpty, args.count >= path.count else {
        return false
    }
    return Array(args.prefix(path.count)) == path
}

private func externalCommandMatches(_ command: ExternalCommand, args: [String]) -> Bool {
    guard externalCommandPathMatches(command.path, args: args) else {
        return false
    }
    guard let condition = command.when else {
        return true
    }
    let childArgs = Array(args.dropFirst(command.path.count))
    if let childArgIndex = condition.childArgIndex {
        guard childArgIndex >= 0 else { return false }
        guard childArgs.indices.contains(childArgIndex) else {
            return condition.childArgMissing == true
        }
        if condition.childArgMissing == true { return false }
        let childArg = childArgs[childArgIndex]
        if let prefix = condition.prefix, !childArg.hasPrefix(prefix) {
            return false
        }
        if condition.excludedPrefixes?.contains(where: { childArg.hasPrefix($0) }) == true {
            return false
        }
        if condition.excludedValues?.contains(childArg) == true { return false }
    }
    return true
}

private func rawOptionValue(_ args: [String], _ token: String) -> String? {
    var i = 0
    while i < args.count {
        if args[i] == token, i + 1 < args.count {
            let value = args[i + 1]
            if !value.hasPrefix("--") {
                return value
            }
        }
        i += 1
    }
    return nil
}

private func resolveExternalRepoRoot(_ requested: String?) -> String {
    let start = NSString(string: requested ?? FileManager.default.currentDirectoryPath).expandingTildeInPath
    let result = runExternalProcessCapturingOutput("/usr/bin/git", arguments: ["rev-parse", "--show-toplevel"], cwd: start)
    if result.exitCode == 0 {
        let root = result.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
        if !root.isEmpty {
            return root
        }
    }
    return NSString(string: start).standardizingPath
}

private func resolveExternalExecutable(_ value: String, repoRoot: String, aosRepoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    return resolveExternalArg(value, repoRoot: repoRoot, aosRepoRoot: aosRepoRoot)
}

private func resolveExternalArg(_ value: String, repoRoot: String, aosRepoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    if value.hasPrefix("$AOS_REPO_ROOT/") {
        return (aosRepoRoot as NSString).appendingPathComponent(String(value.dropFirst("$AOS_REPO_ROOT/".count)))
    }
    if value == "$AOS_REPO_ROOT" {
        return aosRepoRoot
    }
    if value.hasPrefix("$REPO_ROOT/") {
        return (repoRoot as NSString).appendingPathComponent(String(value.dropFirst("$REPO_ROOT/".count)))
    }
    if value == "$REPO_ROOT" {
        return repoRoot
    }
    if value == "$AOS_RUNTIME_MODE" {
        return aosCurrentRuntimeMode().rawValue
    }
    if value == "$AOS_STATE_ROOT" {
        return aosStateRoot()
    }
    if value == "$AOS_PATH" {
        return CommandLine.arguments.first ?? "./aos"
    }
    if value == "$AOS_SESSION_KEY" {
        return aosCurrentSessionKey()
    }
    if value == "$AOS_SESSION_HARNESS" {
        return aosCurrentSessionHarness()
    }
    if value == "$AOS_INVOCATION_DISPLAY_NAME" {
        return aosInvocationDisplayName()
    }
    return value
}

private func resolveExternalEnvironment(
    _ env: [String: String],
    repoRoot: String,
    aosRepoRoot: String
) -> [String: String] {
    var resolved: [String: String] = [:]
    for (key, value) in env {
        resolved[key] = resolveExternalArg(value, repoRoot: repoRoot, aosRepoRoot: aosRepoRoot)
    }
    return resolved
}

private func runExternalProcessInheritingStdio(
    _ executable: String,
    arguments: [String],
    cwd: String? = nil,
    environment: [String: String]? = nil
) -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }
    var merged = ProcessInfo.processInfo.environment
    if let environment {
        for (key, value) in environment {
            merged[key] = value
        }
    }
    merged["AOS_EXTERNAL_DISPATCH_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
    process.environment = merged
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    do {
        try process.run()
    } catch {
        if let data = "\(error)\n".data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
        return 1
    }

    let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM)
    let sigint = DispatchSource.makeSignalSource(signal: SIGINT)
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    sigterm.setEventHandler {
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGTERM)
        }
    }
    sigint.setEventHandler {
        if process.isRunning {
            _ = Darwin.kill(process.processIdentifier, SIGINT)
        }
    }
    sigterm.resume()
    sigint.resume()
    process.waitUntilExit()
    sigterm.cancel()
    sigint.cancel()
    return process.terminationStatus
}

private func runExternalProcessCapturingOutput(
    _ executable: String,
    arguments: [String],
    cwd: String? = nil,
    environment: [String: String]? = nil
) -> ProcessOutput {
    let process = Process()
    let stdoutURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("aos-external-stdout-\(UUID().uuidString)")
    let stderrURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("aos-external-stderr-\(UUID().uuidString)")
    FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
    FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
    guard let stdout = try? FileHandle(forWritingTo: stdoutURL),
          let stderr = try? FileHandle(forWritingTo: stderrURL) else {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "Could not create temporary command output files")
    }
    defer {
        try? stdout.close()
        try? stderr.close()
        try? FileManager.default.removeItem(at: stdoutURL)
        try? FileManager.default.removeItem(at: stderrURL)
    }

    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    if let cwd {
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
    }
    if let environment {
        var merged = ProcessInfo.processInfo.environment
        for (key, value) in environment {
            merged[key] = value
        }
        process.environment = merged
    }
    process.standardOutput = stdout
    process.standardError = stderr

    do {
        try process.run()
    } catch {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "\(error)")
    }

    process.waitUntilExit()
    try? stdout.synchronize()
    try? stderr.synchronize()

    return ProcessOutput(
        exitCode: process.terminationStatus,
        stdout: (try? String(contentsOf: stdoutURL, encoding: .utf8)) ?? "",
        stderr: (try? String(contentsOf: stderrURL, encoding: .utf8)) ?? ""
    )
}
