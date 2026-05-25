// external-command-dispatch.swift — Manifest-backed command launcher

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

    enum CodingKeys: String, CodingKey {
        case path
        case executable
        case argvPrefix = "argv_prefix"
        case cwd
    }
}

func runExternalCommandIfMatched(args: [String]) -> Bool {
    if args.contains("--help") || args.contains("-h") {
        return false
    }
    guard let repoRoot = aosCurrentRepoRoot() else {
        return false
    }
    let manifestPath = (repoRoot as NSString).appendingPathComponent(externalCommandManifestRelativePath)
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
        .filter({ externalCommandPathMatches($0.path, args: args) })
        .max(by: { $0.path.count < $1.path.count }) else {
        return false
    }

    let repoOverride = rawOptionValue(args, "--repo")
    let commandRepoRoot = resolveRepoRoot(repoOverride)
    let executable = resolveExternalExecutable(command.executable, repoRoot: commandRepoRoot)
    let childArgs = Array(args.dropFirst(command.path.count))
    let argv = command.argvPrefix.map { resolveExternalArg($0, repoRoot: commandRepoRoot) } + childArgs
    let cwd = command.cwd == "repo" ? commandRepoRoot : command.cwd.map { resolveExternalArg($0, repoRoot: commandRepoRoot) }
    let result = runExternalProcessCapturingOutput(executable, arguments: argv, cwd: cwd)
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

private func rawOptionValue(_ args: [String], _ token: String) -> String? {
    var i = 0
    while i < args.count {
        if args[i] == token, i + 1 < args.count {
            return args[i + 1]
        }
        i += 1
    }
    return nil
}

private func resolveExternalExecutable(_ value: String, repoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    return resolveExternalArg(value, repoRoot: repoRoot)
}

private func resolveExternalArg(_ value: String, repoRoot: String) -> String {
    if value.hasPrefix("/") {
        return value
    }
    if value.hasPrefix("$REPO_ROOT/") {
        return (repoRoot as NSString).appendingPathComponent(String(value.dropFirst("$REPO_ROOT/".count)))
    }
    return value
}

private func runExternalProcessCapturingOutput(_ executable: String, arguments: [String], cwd: String? = nil) -> ProcessOutput {
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
