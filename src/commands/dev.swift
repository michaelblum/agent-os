// dev.swift - repo development workflow router and build wrapper

import Foundation

private struct DevWorkflowManifest: Decodable {
    let schemaVersion: Int
    let summary: String?
    let rules: [DevWorkflowRule]
    let fallback: DevWorkflowRule?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case summary
        case rules
        case fallback
    }
}

private struct DevWorkflowRule: Decodable {
    let id: String
    let summary: String
    let patterns: [String]
    let classes: [String]
    let actions: [String]
    let hotSwappable: Bool?
    let tccIdentitySensitive: Bool?
    let commands: [DevWorkflowStep]?
    let verification: [DevWorkflowStep]?
    let notes: [String]?

    enum CodingKeys: String, CodingKey {
        case id
        case summary
        case patterns
        case classes
        case actions
        case hotSwappable = "hot_swappable"
        case tccIdentitySensitive = "tcc_identity_sensitive"
        case commands
        case verification
        case notes
    }
}

private struct DevWorkflowStep: Decodable {
    let id: String?
    let command: String
    let reason: String
}

private struct DevOptions {
    var json = false
    var repo: String?
    var base: String?
    var manifest: String?
    var files: [String] = []
}

private struct DevClassifiedFile {
    let path: String
    let rules: [DevWorkflowRule]
}

private struct DevAggregatedStep {
    let id: String?
    let command: String
    let reason: String
    var sourceRules: [String]

    func toJSON() -> [String: Any] {
        var out: [String: Any] = [
            "command": command,
            "reason": reason,
            "source_rules": sourceRules,
        ]
        if let id = id, !id.isEmpty {
            out["id"] = id
        }
        return out
    }
}

func devCommand(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["dev"], json: false)
        exit(0)
    }

    if sub == "--help" || sub == "-h" {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    let subArgs = Array(args.dropFirst())
    if subArgs.contains("--help") || subArgs.contains("-h") {
        printCommandHelp(["dev", sub], json: subArgs.contains("--json"))
        exit(0)
    }

    switch sub {
    case "classify":
        devClassifyCommand(args: subArgs)
    case "recommend":
        devRecommendCommand(args: subArgs)
    case "build":
        devBuildCommand(args: subArgs)
    default:
        exitError("Unknown dev subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devClassifyCommand(args: [String]) {
    let options = parseDevOptions(args)
    let result = buildDevClassification(options: options)
    if options.json {
        printDevJSON(result)
    } else {
        printDevClassificationText(result)
    }
}

private func devRecommendCommand(args: [String]) {
    let options = parseDevOptions(args)
    let classification = buildDevClassification(options: options)
    let result = buildDevRecommendation(from: classification)
    if options.json {
        printDevJSON(result)
    } else {
        printDevRecommendationText(result)
    }
}

private func devBuildCommand(args: [String]) {
    let asJSON = args.contains("--json")
    let passthrough = args.filter { $0 != "--help" && $0 != "-h" && $0 != "--json" }
    for arg in passthrough {
        if !["--release", "--force", "--no-restart"].contains(arg) {
            exitError("Unknown dev build argument: \(arg)", code: "UNKNOWN_FLAG")
        }
    }

    let repoRoot = findAgentOSRepoRoot()
    let buildScript = (repoRoot as NSString).appendingPathComponent("build.sh")
    guard FileManager.default.fileExists(atPath: buildScript) else {
        exitError("Missing build script: \(buildScript)", code: "MISSING_BUILD_SCRIPT")
    }

    let permissionNote = "aos dev build wraps build.sh; rebuilt repo binaries may require a fresh macOS Accessibility/Input Monitoring grant if readiness later reports stale TCC identity."
    let result = runProcessCapturingOutput("/bin/bash", arguments: [buildScript] + passthrough, cwd: repoRoot)

    if asJSON {
        printDevJSON([
            "status": result.exitCode == 0 ? "success" : "error",
            "command": (["bash", "build.sh"] + passthrough).joined(separator: " "),
            "exit_code": Int(result.exitCode),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "permission_note": permissionNote,
            "next": "./aos ready",
        ])
    } else {
        FileHandle.standardError.write(Data("\(permissionNote)\n".utf8))
        if !result.stdout.isEmpty {
            print(result.stdout, terminator: result.stdout.hasSuffix("\n") ? "" : "\n")
        }
        if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
            FileHandle.standardError.write(data)
        }
        if result.exitCode == 0 {
            print("Next: ./aos ready")
        }
    }
    exit(result.exitCode)
}

private func runProcessCapturingOutput(_ executable: String, arguments: [String], cwd: String? = nil) -> ProcessOutput {
    let process = Process()
    let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    let token = UUID().uuidString
    let stdoutURL = tempDir.appendingPathComponent("aos-dev-build-\(token).out")
    let stderrURL = tempDir.appendingPathComponent("aos-dev-build-\(token).err")
    FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
    FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
    guard let stdout = try? FileHandle(forWritingTo: stdoutURL),
          let stderr = try? FileHandle(forWritingTo: stderrURL) else {
        return ProcessOutput(exitCode: 1, stdout: "", stderr: "Could not create temporary build output files")
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

private func parseDevOptions(_ args: [String]) -> DevOptions {
    var options = DevOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.json = true
            i += 1
        case "--repo":
            guard i + 1 < args.count else {
                exitError("--repo requires a path", code: "MISSING_ARG")
            }
            options.repo = args[i + 1]
            i += 2
        case "--base":
            guard i + 1 < args.count else {
                exitError("--base requires a ref", code: "MISSING_ARG")
            }
            options.base = args[i + 1]
            i += 2
        case "--manifest":
            guard i + 1 < args.count else {
                exitError("--manifest requires a path", code: "MISSING_ARG")
            }
            options.manifest = args[i + 1]
            i += 2
        case "--paths":
            guard i + 1 < args.count else {
                exitError("--paths requires a comma-separated path list", code: "MISSING_ARG")
            }
            options.files.append(contentsOf: args[i + 1].split(separator: ",").map(String.init).filter { !$0.isEmpty })
            i += 2
        case "--files":
            i += 1
            var consumed = false
            while i < args.count && !args[i].hasPrefix("--") {
                options.files.append(args[i])
                consumed = true
                i += 1
            }
            if !consumed {
                exitError("--files requires at least one path", code: "MISSING_ARG")
            }
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.files.append(arg)
            i += 1
        }
    }
    return options
}

private func buildDevClassification(options: DevOptions) -> [String: Any] {
    let repoRoot = resolveRepoRoot(options.repo)
    let manifestPath = resolveManifestPath(options.manifest, repoRoot: repoRoot)
    let manifest = loadDevWorkflowManifest(path: manifestPath)
    let changed = resolveChangedFiles(options: options, repoRoot: repoRoot)
    let files = uniquePreservingOrder(changed.files.map { normalizeRepoRelativePath($0, repoRoot: repoRoot) })
        .filter { !$0.isEmpty }

    let classified = files.map { path -> DevClassifiedFile in
        let matches = manifest.rules.filter { rule in
            rule.patterns.contains { globMatches(pattern: $0, path: path) }
        }
        if matches.isEmpty, let fallback = manifest.fallback {
            return DevClassifiedFile(path: path, rules: [fallback])
        }
        return DevClassifiedFile(path: path, rules: matches)
    }

    let aggregate = aggregateDevWorkflow(classified)
    return [
        "status": "success",
        "manifest": normalizeRepoRelativePath(manifestPath, repoRoot: repoRoot),
        "manifest_schema_version": manifest.schemaVersion,
        "repo": repoRoot,
        "diff_base": changed.base as Any,
        "changed_files": files,
        "files": classified.map { classifiedFileJSON($0) },
        "summary": aggregate,
    ]
}

private func buildDevRecommendation(from classification: [String: Any]) -> [String: Any] {
    let summary = classification["summary"] as? [String: Any] ?? [:]
    let commands = summary["commands"] as? [[String: Any]] ?? []
    let verification = summary["verification"] as? [[String: Any]] ?? []
    let notes = summary["notes"] as? [String] ?? []

    return [
        "status": "success",
        "manifest": classification["manifest"] ?? "docs/dev/workflow-rules.json",
        "repo": classification["repo"] ?? FileManager.default.currentDirectoryPath,
        "diff_base": classification["diff_base"] ?? NSNull(),
        "changed_files": classification["changed_files"] ?? [],
        "next_commands": commands,
        "verification": verification,
        "notes": notes,
        "summary": summary,
    ]
}

private func aggregateDevWorkflow(_ files: [DevClassifiedFile]) -> [String: Any] {
    let allRules = files.flatMap { $0.rules }
    let ruleIDs = uniquePreservingOrder(allRules.map { $0.id })
    let classes = uniquePreservingOrder(allRules.flatMap { $0.classes })
    let actions = uniquePreservingOrder(allRules.flatMap { $0.actions })
    let hotSwappable = !allRules.contains { ($0.hotSwappable ?? true) == false }
    let tccSensitive = allRules.contains { ($0.tccIdentitySensitive ?? false) == true }
    let commands = aggregateSteps(allRules.flatMap { rule in
        (rule.commands ?? []).map { (step: $0, ruleID: rule.id) }
    })
    let verification = aggregateSteps(allRules.flatMap { rule in
        (rule.verification ?? []).map { (step: $0, ruleID: rule.id) }
    })
    let notes = uniquePreservingOrder(allRules.flatMap { $0.notes ?? [] })

    return [
        "changed_file_count": files.count,
        "rule_ids": ruleIDs,
        "classes": classes,
        "actions": actions,
        "hot_swappable": hotSwappable,
        "requires_swift_build": actions.contains("swift_build"),
        "tcc_identity_sensitive": tccSensitive,
        "commands": commands.map { $0.toJSON() },
        "verification": verification.map { $0.toJSON() },
        "notes": notes,
    ]
}

private func aggregateSteps(_ input: [(step: DevWorkflowStep, ruleID: String)]) -> [DevAggregatedStep] {
    var order: [String] = []
    var map: [String: DevAggregatedStep] = [:]
    for item in input {
        let command = item.step.command
        if command.isEmpty {
            continue
        }
        if var existing = map[command] {
            if !existing.sourceRules.contains(item.ruleID) {
                existing.sourceRules.append(item.ruleID)
            }
            map[command] = existing
        } else {
            order.append(command)
            map[command] = DevAggregatedStep(
                id: item.step.id,
                command: command,
                reason: item.step.reason,
                sourceRules: [item.ruleID])
        }
    }
    return order.compactMap { map[$0] }
}

private func classifiedFileJSON(_ file: DevClassifiedFile) -> [String: Any] {
    let classes = uniquePreservingOrder(file.rules.flatMap { $0.classes })
    let actions = uniquePreservingOrder(file.rules.flatMap { $0.actions })
    return [
        "path": file.path,
        "rules": file.rules.map { $0.id },
        "classes": classes,
        "actions": actions,
        "hot_swappable": !file.rules.contains { ($0.hotSwappable ?? true) == false },
        "tcc_identity_sensitive": file.rules.contains { ($0.tccIdentitySensitive ?? false) == true },
    ]
}

private func resolveRepoRoot(_ requested: String?) -> String {
    let start = NSString(string: requested ?? FileManager.default.currentDirectoryPath).expandingTildeInPath
    if let root = runGit(["rev-parse", "--show-toplevel"], cwd: start).stdoutLines.first, !root.isEmpty {
        return NSString(string: root).standardizingPath
    }
    return NSString(string: start).standardizingPath
}

private func resolveManifestPath(_ requested: String?, repoRoot: String) -> String {
    if let requested = requested {
        let expanded = NSString(string: requested).expandingTildeInPath
        if expanded.hasPrefix("/") {
            return NSString(string: expanded).standardizingPath
        }
        return NSString(string: (repoRoot as NSString).appendingPathComponent(expanded)).standardizingPath
    }
    return (repoRoot as NSString).appendingPathComponent("docs/dev/workflow-rules.json")
}

private func loadDevWorkflowManifest(path: String) -> DevWorkflowManifest {
    guard let data = FileManager.default.contents(atPath: path) else {
        exitError("Missing dev workflow manifest: \(path)", code: "MISSING_MANIFEST")
    }
    do {
        return try JSONDecoder().decode(DevWorkflowManifest.self, from: data)
    } catch {
        exitError("Invalid dev workflow manifest \(path): \(error)", code: "INVALID_MANIFEST")
    }
}

private func resolveChangedFiles(options: DevOptions, repoRoot: String) -> (files: [String], base: String?) {
    if !options.files.isEmpty {
        return (options.files, "explicit")
    }

    if let base = options.base {
        let diff = gitDiffFiles(base: base, repoRoot: repoRoot, strict: true)
        let untracked = gitStatusFiles(repoRoot: repoRoot, untrackedOnly: true)
        return (uniquePreservingOrder(diff + untracked), base)
    }

    let dirty = gitStatusFiles(repoRoot: repoRoot, untrackedOnly: false)
    if !dirty.isEmpty {
        return (dirty, "working-tree")
    }

    if runGit(["rev-parse", "--verify", "--quiet", "origin/main"], cwd: repoRoot).status == 0,
       let mergeBase = runGit(["merge-base", "HEAD", "origin/main"], cwd: repoRoot).stdoutLines.first,
       !mergeBase.isEmpty {
        return (gitDiffFiles(base: mergeBase, repoRoot: repoRoot), mergeBase)
    }

    if let upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd: repoRoot).stdoutLines.first,
       !upstream.isEmpty,
       let mergeBase = runGit(["merge-base", "HEAD", upstream], cwd: repoRoot).stdoutLines.first,
       !mergeBase.isEmpty {
        return (gitDiffFiles(base: mergeBase, repoRoot: repoRoot), mergeBase)
    }

    return (gitDiffFiles(base: "HEAD", repoRoot: repoRoot), "HEAD")
}

private func gitDiffFiles(base: String, repoRoot: String, strict: Bool = false) -> [String] {
    let result = runGit(["diff", "--name-only", "-z", "--diff-filter=ACDMRTUXB", base, "--"], cwd: repoRoot)
    guard result.status == 0 else {
        if strict {
            let detail = result.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
            exitError("Invalid dev workflow diff base '\(base)'\(detail.isEmpty ? "." : ": \(detail)")", code: "INVALID_BASE_REF")
        }
        return []
    }
    return splitNul(result.stdout)
}

private func gitStatusFiles(repoRoot: String, untrackedOnly: Bool) -> [String] {
    let result = runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd: repoRoot)
    guard result.status == 0 else { return [] }
    let parts = splitNul(result.stdout)
    var out: [String] = []
    var i = 0
    while i < parts.count {
        let record = parts[i]
        guard record.count >= 4 else {
            i += 1
            continue
        }
        let status = String(record.prefix(2))
        let pathStart = record.index(record.startIndex, offsetBy: 3)
        let path = String(record[pathStart...])
        let isUntracked = status == "??"
        if status.contains("R") || status.contains("C") {
            if i + 1 < parts.count {
                if !untrackedOnly || isUntracked {
                    out.append(path)
                }
                i += 2
                continue
            }
        }
        if !untrackedOnly || isUntracked {
            out.append(path)
        }
        i += 1
    }
    return uniquePreservingOrder(out)
}

private func runGit(_ args: [String], cwd: String) -> (status: Int32, stdout: String, stderr: String, stdoutLines: [String]) {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    proc.arguments = ["-C", cwd] + args
    let out = Pipe()
    let err = Pipe()
    proc.standardOutput = out
    proc.standardError = err
    do {
        try proc.run()
    } catch {
        return (127, "", error.localizedDescription, [])
    }
    proc.waitUntilExit()
    let outData = out.fileHandleForReading.readDataToEndOfFile()
    let errData = err.fileHandleForReading.readDataToEndOfFile()
    let stdout = String(data: outData, encoding: .utf8) ?? ""
    let stderr = String(data: errData, encoding: .utf8) ?? ""
    let lines = stdout.split(whereSeparator: \.isNewline).map(String.init)
    return (proc.terminationStatus, stdout, stderr, lines)
}

private func splitNul(_ value: String) -> [String] {
    value.split(separator: "\u{0}", omittingEmptySubsequences: true).map(String.init)
}

private func normalizeRepoRelativePath(_ value: String, repoRoot: String) -> String {
    let expanded = NSString(string: value).expandingTildeInPath
    let standardized = NSString(string: expanded).standardizingPath
    let root = NSString(string: repoRoot).standardizingPath
    if standardized == root {
        return "."
    }
    let prefix = root.hasSuffix("/") ? root : root + "/"
    if standardized.hasPrefix(prefix) {
        return String(standardized.dropFirst(prefix.count))
    }
    if value.hasPrefix("./") {
        return String(value.dropFirst(2))
    }
    return value
}

private func globMatches(pattern: String, path: String) -> Bool {
    if pattern == "**" {
        return true
    }
    let regex = "^" + globToRegex(pattern) + "$"
    return path.range(of: regex, options: .regularExpression) != nil
}

private func globToRegex(_ pattern: String) -> String {
    let chars = Array(pattern)
    var out = ""
    var i = 0
    while i < chars.count {
        let ch = chars[i]
        if ch == "*" {
            if i + 1 < chars.count && chars[i + 1] == "*" {
                if i + 2 < chars.count && chars[i + 2] == "/" {
                    out += "(?:.*/)?"
                    i += 3
                } else {
                    out += ".*"
                    i += 2
                }
            } else {
                out += "[^/]*"
                i += 1
            }
        } else if ch == "?" {
            out += "[^/]"
            i += 1
        } else {
            out += NSRegularExpression.escapedPattern(for: String(ch))
            i += 1
        }
    }
    return out
}

private func uniquePreservingOrder(_ input: [String]) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    for item in input where !item.isEmpty {
        if seen.insert(item).inserted {
            out.append(item)
        }
    }
    return out
}

private func printDevJSON(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        exitError("Unable to serialize dev workflow response", code: "SERIALIZATION_FAILED")
    }
    print(text)
}

private func printDevClassificationText(_ payload: [String: Any]) {
    let files = payload["changed_files"] as? [String] ?? []
    let summary = payload["summary"] as? [String: Any] ?? [:]
    print("Changed files: \(files.count)")
    print("Classes: \((summary["classes"] as? [String] ?? []).joined(separator: ", "))")
    print("Actions: \((summary["actions"] as? [String] ?? []).joined(separator: ", "))")
    if (summary["tcc_identity_sensitive"] as? Bool) == true {
        print("Risk: tcc_identity_sensitive")
    }
}

private func printDevRecommendationText(_ payload: [String: Any]) {
    let commands = payload["next_commands"] as? [[String: Any]] ?? []
    let verification = payload["verification"] as? [[String: Any]] ?? []
    let notes = payload["notes"] as? [String] ?? []

    if commands.isEmpty {
        print("Next commands: none")
    } else {
        print("Next commands:")
        for item in commands {
            print("- \(item["command"] as? String ?? "")")
        }
    }

    if verification.isEmpty {
        print("Verification: none")
    } else {
        print("Verification:")
        for item in verification {
            print("- \(item["command"] as? String ?? "")")
        }
    }

    for note in notes {
        print("Note: \(note)")
    }
}
