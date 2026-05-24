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

private enum DevWorkflowManifestReadResult {
    case success(DevWorkflowManifest)
    case failure(String)
}

private struct DevOptions {
    var json = false
    var repo: String?
    var base: String?
    var manifest: String?
    var files: [String] = []
}

private struct DevAuditOptions {
    var json = false
    var repo: String?
    var manifest: String?
}

private struct DevCapabilitiesOptions {
    var json = false
    var repo: String?
    var manifest: String?
    var role: String?
    var entryPath: String?
    var positionals: [String] = []
}

private struct DevDocksOptions {
    var json = false
    var repo: String?
    var dockRoot: String?
    var capabilitiesManifest: String?
    var entryPath: String?
    var positionals: [String] = []
}

private struct DevGhOptions {
    var json = false
    var repo: String?
    var cwd: String?
    var bodyFile: String?
    var prNumber: String?
    var positionals: [String] = []
}

private struct DevAfkDryRunOptions {
    var json = false
    var packet: String?
    var provider: String?
    var dock: String?
    var repo: String?
    var timestamp: String?
    var out: String?
}

private struct DevAfkLaunchAttemptOptions {
    var json = false
    var duplicateInProcess = false
    var packet: String?
    var provider: String?
    var dock: String?
    var repo: String?
    var timestamp: String?
    var out: String?
    var catalogFixture: String?
    var bridgeVisibilityFixture: String?
    var providerSessionId: String?
    var launchObservedAt: String?
    var codexHomeFixture: String?
    var codexHome: String?
}

private struct DevAfkSessionTriggerOptions {
    var json = false
    var dryRun = false
    var supervisedLiveLaunch = false
    var sleepLeaseLiveLaunch = false
    var warmDockTuiReuse = false
    var iAmPresent = false
    var providerLaunchDryRun = false
    var packet: String?
    var sleepLease: String?
    var provider: String?
    var dock: String?
    var repo: String?
    var timestamp: String?
    var out: String?
    var resultRoute: String?
    var idempotenceSalt: String?
    var existingReceipt: String?
    var replacementFor: String?
    var bridgeVisibilityFixture: String?
    var cleanupProofFixture: String?
    var providerSessionId: String?
    var launchObservedAt: String?
    var codexHomeFixture: String?
    var codexHome: String?
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

private struct DevAuditClaim {
    let id: String
    let claim: String
    let status: String
    let expected: String
    let observed: String
    let evidence: [String]
    let next: String?

    func toJSON() -> [String: Any] {
        var out: [String: Any] = [
            "id": id,
            "claim": claim,
            "status": status,
            "expected": expected,
            "observed": observed,
            "evidence": evidence,
        ]
        if let next, !next.isEmpty {
            out["next"] = next
        }
        return out
    }
}

private let devWorkflowDefaultManifestRelativePath = "docs/dev/workflow-rules.json"
private let devCapabilitiesDefaultManifestRelativePath = "docs/dev/agent-capabilities.json"
private let devDocksDefaultRootRelativePath = ".docks"
private let devWorkflowRuleID = "dev-workflow-manifest"

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
    case "afk-dry-run":
        devAfkDryRunCommand(args: subArgs)
    case "afk-launch-attempt":
        devAfkLaunchAttemptCommand(args: subArgs)
    case "afk-session-trigger":
        devAfkSessionTriggerCommand(args: subArgs)
    case "audit":
        devAuditCommand(args: subArgs)
    case "capabilities":
        devCapabilitiesCommand(args: subArgs)
    case "docks":
        devDocksCommand(args: subArgs)
    case "gh":
        devGhCommand(args: subArgs)
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

private func devAuditCommand(args: [String]) {
    let options = parseDevAuditOptions(args)
    let result = buildDevAudit(options: options)
    if options.json {
        printDevJSON(result)
    } else {
        printDevAuditText(result)
    }

    let summary = result["summary"] as? [String: Any] ?? [:]
    let failed = summary["failed"] as? Int ?? 0
    exit(failed == 0 ? 0 : 1)
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

    let permissionNote = """
    aos dev build wraps build.sh; rebuilt repo binaries may require a fresh macOS Accessibility/Input Monitoring grant if readiness later reports stale TCC identity.
    Preferred reset sequence if readiness reports stale TCC/input tap:
    1. ./aos permissions reset-runtime --mode repo
    2. ./aos permissions setup --once
    3. ./aos ready --post-permission
    reset-runtime stops the managed daemon before running a real targeted reset or classifying targeted reset as unavailable. Service-wide TCC reset is emergency-only and requires an explicit break-glass request plus --allow-service-reset --emergency-ack-other-apps.
    """
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

private func devAfkDryRunCommand(args: [String]) {
    let options = parseDevAfkDryRunOptions(args)
    guard let packet = options.packet else {
        exitError("dev afk-dry-run requires --packet <path>", code: "MISSING_ARG")
    }

    let repoRoot = resolveRepoRoot(options.repo)
    let script = (repoRoot as NSString).appendingPathComponent("scripts/afk-dry-run-prototype.mjs")
    guard FileManager.default.fileExists(atPath: script) else {
        exitError("Missing AFK dry-run prototype script: \(script)", code: "MISSING_SCRIPT")
    }

    var scriptArgs = [script, "--packet", packet]
    if let provider = options.provider {
        scriptArgs += ["--provider", provider]
    }
    if let dock = options.dock {
        scriptArgs += ["--dock", dock]
    }
    if let repo = options.repo {
        scriptArgs += ["--repo", repo]
    }
    if let timestamp = options.timestamp {
        scriptArgs += ["--timestamp", timestamp]
    }
    if let out = options.out {
        scriptArgs += ["--out", out]
    }
    if options.json {
        scriptArgs.append("--json")
    }

    let result = runProcessCapturingOutput("/usr/bin/env", arguments: ["node"] + scriptArgs, cwd: repoRoot)
    if !result.stdout.isEmpty {
        print(result.stdout, terminator: result.stdout.hasSuffix("\n") ? "" : "\n")
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(result.exitCode)
}

private func devAfkLaunchAttemptCommand(args: [String]) {
    let options = parseDevAfkLaunchAttemptOptions(args)
    guard let packet = options.packet else {
        exitError("dev afk-launch-attempt requires --packet <path>", code: "MISSING_ARG")
    }

    let repoRoot = resolveRepoRoot(options.repo)
    let script = (repoRoot as NSString).appendingPathComponent("scripts/afk-launch-attempt-prototype.mjs")
    guard FileManager.default.fileExists(atPath: script) else {
        exitError("Missing AFK launch-attempt prototype script: \(script)", code: "MISSING_SCRIPT")
    }

    var scriptArgs = [script, "--packet", packet]
    if let provider = options.provider {
        scriptArgs += ["--provider", provider]
    }
    if let dock = options.dock {
        scriptArgs += ["--dock", dock]
    }
    if let repo = options.repo {
        scriptArgs += ["--repo", repo]
    }
    if let timestamp = options.timestamp {
        scriptArgs += ["--timestamp", timestamp]
    }
    if let out = options.out {
        scriptArgs += ["--out", out]
    }
    if options.duplicateInProcess {
        scriptArgs.append("--duplicate-in-process")
    }
    if let catalogFixture = options.catalogFixture {
        scriptArgs += ["--catalog-fixture", catalogFixture]
    }
    if let bridgeVisibilityFixture = options.bridgeVisibilityFixture {
        scriptArgs += ["--bridge-visibility-fixture", bridgeVisibilityFixture]
    }
    if let providerSessionId = options.providerSessionId {
        scriptArgs += ["--provider-session-id", providerSessionId]
    }
    if let launchObservedAt = options.launchObservedAt {
        scriptArgs += ["--launch-observed-at", launchObservedAt]
    }
    if let codexHomeFixture = options.codexHomeFixture {
        scriptArgs += ["--codex-home-fixture", codexHomeFixture]
    }
    if let codexHome = options.codexHome {
        scriptArgs += ["--codex-home", codexHome]
    }
    if options.json {
        scriptArgs.append("--json")
    }

    let result = runProcessCapturingOutput("/usr/bin/env", arguments: ["node"] + scriptArgs, cwd: repoRoot)
    if !result.stdout.isEmpty {
        print(result.stdout, terminator: result.stdout.hasSuffix("\n") ? "" : "\n")
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(result.exitCode)
}

private func devAfkSessionTriggerCommand(args: [String]) {
    let options = parseDevAfkSessionTriggerOptions(args)
    guard let packet = options.packet else {
        exitError("dev afk-session-trigger requires --packet <path>", code: "MISSING_ARG")
    }
    guard options.dryRun || options.supervisedLiveLaunch || options.sleepLeaseLiveLaunch || options.warmDockTuiReuse else {
        exitError("dev afk-session-trigger requires --dry-run, --supervised-live-launch, --afk-live-launch, or --warm-dock-tui-reuse", code: "MISSING_ARG")
    }

    let repoRoot = resolveRepoRoot(options.repo)
    let script = (repoRoot as NSString).appendingPathComponent("scripts/afk-session-trigger-prototype.mjs")
    guard FileManager.default.fileExists(atPath: script) else {
        exitError("Missing AFK session-trigger prototype script: \(script)", code: "MISSING_SCRIPT")
    }

    var scriptArgs = [script, "--packet", packet]
    if options.dryRun {
        scriptArgs.append("--dry-run")
    }
    if options.supervisedLiveLaunch {
        scriptArgs.append("--supervised-live-launch")
    }
    if options.sleepLeaseLiveLaunch {
        scriptArgs.append("--sleep-lease-live-launch")
    }
    if options.warmDockTuiReuse {
        scriptArgs.append("--warm-dock-tui-reuse")
    }
    if options.iAmPresent {
        scriptArgs.append("--i-am-present")
    }
    if options.providerLaunchDryRun {
        scriptArgs.append("--provider-launch-dry-run")
    }
    if let sleepLease = options.sleepLease {
        scriptArgs += ["--sleep-lease", sleepLease]
    }
    if let provider = options.provider {
        scriptArgs += ["--provider", provider]
    }
    if let dock = options.dock {
        scriptArgs += ["--dock", dock]
    }
    if let repo = options.repo {
        scriptArgs += ["--repo", repo]
    }
    if let timestamp = options.timestamp {
        scriptArgs += ["--timestamp", timestamp]
    }
    if let out = options.out {
        scriptArgs += ["--out", out]
    }
    if let resultRoute = options.resultRoute {
        scriptArgs += ["--result-route", resultRoute]
    }
    if let idempotenceSalt = options.idempotenceSalt {
        scriptArgs += ["--idempotence-salt", idempotenceSalt]
    }
    if let existingReceipt = options.existingReceipt {
        scriptArgs += ["--existing-receipt", existingReceipt]
    }
    if let replacementFor = options.replacementFor {
        scriptArgs += ["--replacement-for", replacementFor]
    }
    if let bridgeVisibilityFixture = options.bridgeVisibilityFixture {
        scriptArgs += ["--bridge-visibility-fixture", bridgeVisibilityFixture]
    }
    if let cleanupProofFixture = options.cleanupProofFixture {
        scriptArgs += ["--cleanup-proof-fixture", cleanupProofFixture]
    }
    if let providerSessionId = options.providerSessionId {
        scriptArgs += ["--provider-session-id", providerSessionId]
    }
    if let launchObservedAt = options.launchObservedAt {
        scriptArgs += ["--launch-observed-at", launchObservedAt]
    }
    if let codexHomeFixture = options.codexHomeFixture {
        scriptArgs += ["--codex-home-fixture", codexHomeFixture]
    }
    if let codexHome = options.codexHome {
        scriptArgs += ["--codex-home", codexHome]
    }
    if options.json {
        scriptArgs.append("--json")
    }

    let result = runProcessCapturingOutput("/usr/bin/env", arguments: ["node"] + scriptArgs, cwd: repoRoot)
    if !result.stdout.isEmpty {
        print(result.stdout, terminator: result.stdout.hasSuffix("\n") ? "" : "\n")
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
    exit(result.exitCode)
}

private func devCapabilitiesCommand(args: [String]) {
    guard let action = args.first else {
        printCommandHelp(["dev", "capabilities"], json: false)
        exit(0)
    }

    let options = parseDevCapabilitiesOptions(Array(args.dropFirst()))
    switch action {
    case "list":
        devCapabilitiesListCommand(options: options)
    case "explain":
        devCapabilitiesExplainCommand(options: options)
    default:
        exitError("Unknown dev capabilities subcommand: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devCapabilitiesListCommand(options: DevCapabilitiesOptions) {
    guard options.positionals.isEmpty else {
        exitError("dev capabilities list does not accept positional arguments", code: "UNKNOWN_ARG")
    }
    let loaded = loadDevCapabilityManifest(options: options)
    let capabilities = filterDevCapabilities(loaded.capabilities, options: options)
    let payload: [String: Any] = [
        "status": "success",
        "manifest": normalizeRepoRelativePath(loaded.path, repoRoot: loaded.repoRoot),
        "manifest_id": loaded.manifest["id"] ?? NSNull(),
        "manifest_schema_version": loaded.manifest["schema_version"] ?? NSNull(),
        "role": devGhNullable(options.role),
        "entry_path": devGhNullable(options.entryPath),
        "count": capabilities.count,
        "capabilities": capabilities.map { compactDevCapability($0) },
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevCapabilitiesListText(payload)
    }
}

private func devCapabilitiesExplainCommand(options: DevCapabilitiesOptions) {
    guard options.positionals.count == 1, let capabilityID = options.positionals.first else {
        exitError("dev capabilities explain requires exactly one capability id", code: "MISSING_ARG")
    }
    let loaded = loadDevCapabilityManifest(options: options)
    guard let capability = loaded.capabilities.first(where: { ($0["id"] as? String) == capabilityID }) else {
        exitError("Unknown capability id: \(capabilityID)", code: "UNKNOWN_CAPABILITY")
    }
    let payload: [String: Any] = [
        "status": "success",
        "manifest": normalizeRepoRelativePath(loaded.path, repoRoot: loaded.repoRoot),
        "manifest_id": loaded.manifest["id"] ?? NSNull(),
        "manifest_schema_version": loaded.manifest["schema_version"] ?? NSNull(),
        "capability": capability,
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevCapabilityExplainText(payload)
    }
}

private func devDocksCommand(args: [String]) {
    guard let action = args.first else {
        printCommandHelp(["dev", "docks"], json: false)
        exit(0)
    }

    let options = parseDevDocksOptions(Array(args.dropFirst()))
    switch action {
    case "list":
        devDocksListCommand(options: options)
    case "explain":
        devDocksExplainCommand(options: options)
    case "capabilities":
        devDocksCapabilitiesCommand(options: options)
    default:
        exitError("Unknown dev docks subcommand: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devDocksListCommand(options: DevDocksOptions) {
    guard options.positionals.isEmpty else {
        exitError("dev docks list does not accept positional arguments", code: "UNKNOWN_ARG")
    }
    let loaded = loadDevDockProfiles(options: options)
    let profiles = loaded.profiles.map { compactDevDockProfile($0) }
    let payload: [String: Any] = [
        "status": "success",
        "dock_root": normalizeRepoRelativePath(loaded.dockRoot, repoRoot: loaded.repoRoot),
        "count": profiles.count,
        "docks": profiles,
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevDocksListText(payload)
    }
}

private func devDocksExplainCommand(options: DevDocksOptions) {
    guard options.positionals.count == 1, let dockName = options.positionals.first else {
        exitError("dev docks explain requires exactly one dock name", code: "MISSING_ARG")
    }
    let loaded = loadDevDockProfiles(options: options)
    guard let profile = loaded.profiles.first(where: { devString($0["name"]) == dockName }) else {
        exitError("Unknown dock profile: \(dockName)", code: "UNKNOWN_DOCK")
    }
    let payload: [String: Any] = [
        "status": "success",
        "dock_root": normalizeRepoRelativePath(loaded.dockRoot, repoRoot: loaded.repoRoot),
        "profile": profile,
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevDockExplainText(payload)
    }
}

private func devDocksCapabilitiesCommand(options: DevDocksOptions) {
    guard options.positionals.count == 1, let dockName = options.positionals.first else {
        exitError("dev docks capabilities requires exactly one dock name", code: "MISSING_ARG")
    }
    let loaded = loadDevDockProfiles(options: options)
    guard let profile = loaded.profiles.first(where: { devString($0["name"]) == dockName }) else {
        exitError("Unknown dock profile: \(dockName)", code: "UNKNOWN_DOCK")
    }

    let defaultEntryPath = devString(profile["default_entry_path"]) ?? "agent_harness"
    let activeEntryPath = options.entryPath ?? defaultEntryPath
    let allowedEntryPaths = devStringArray(profile["allowed_entry_paths"])
    guard allowedEntryPaths.contains(activeEntryPath) else {
        exitError("Dock \(dockName) does not allow entry path: \(activeEntryPath)", code: "ENTRY_PATH_NOT_ALLOWED")
    }

    var capabilityOptions = DevCapabilitiesOptions()
    capabilityOptions.repo = options.repo
    capabilityOptions.manifest = options.capabilitiesManifest ?? devString(profile["capability_manifest"])
    let capabilityManifest = loadDevCapabilityManifest(options: capabilityOptions)
    let capabilities = resolveDevDockCapabilities(
        profile: profile,
        capabilities: capabilityManifest.capabilities,
        entryPath: activeEntryPath)
    let payload: [String: Any] = [
        "status": "success",
        "dock": dockName,
        "role": devGhNullable(devString(profile["role"])),
        "dock_root": normalizeRepoRelativePath(loaded.dockRoot, repoRoot: loaded.repoRoot),
        "default_entry_path": defaultEntryPath,
        "active_entry_path": activeEntryPath,
        "allowed_entry_paths": allowedEntryPaths,
        "allowed_capability_classes": devStringArray(profile["allowed_capability_classes"]),
        "capability_manifest": normalizeRepoRelativePath(capabilityManifest.path, repoRoot: capabilityManifest.repoRoot),
        "count": capabilities.count,
        "capabilities": capabilities.map { compactDevCapability($0) },
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevDockCapabilitiesText(payload)
    }
}

private func devGhCommand(args: [String]) {
    guard let group = args.first else {
        printCommandHelp(["dev", "gh"], json: false)
        exit(0)
    }

    let remaining = Array(args.dropFirst())
    switch group {
    case "context":
        devGhContextCommand(args: remaining)
    case "issue":
        devGhIssueCommand(args: remaining)
    case "pr":
        devGhPRCommand(args: remaining)
    case "ci":
        devGhCICommand(args: remaining)
    case "review-comments":
        devGhReviewCommentsCommand(args: remaining)
    default:
        exitError("Unknown dev gh group: \(group)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devGhContextCommand(args: [String]) {
    let options = parseDevGhOptions(args)
    if !options.positionals.isEmpty {
        exitError("dev gh context does not accept positional arguments", code: "UNKNOWN_ARG")
    }

    let repoRoot = resolveRepoRoot(options.cwd)
    let repoFullName = devGhRepositoryFullName(options: options, repoRoot: repoRoot)
    let ghPath = findExecutable("gh")
    let auth = runGh(["auth", "status"], cwd: repoRoot)
    let repoInfo = devGhRepositoryInfo(repoFullName: repoFullName, repoRoot: repoRoot)
    let prInfo = devGhCurrentPRInfo(repoFullName: repoFullName, repoRoot: repoRoot)
    let branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd: repoRoot).stdoutLines.first
    let upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd: repoRoot).stdoutLines.first
    let dirtyFiles = gitStatusFiles(repoRoot: repoRoot, untrackedOnly: false)
    let defaultBranch = (repoInfo?["defaultBranchRef"] as? [String: Any])?["name"] as? String

    let status: String
    if ghPath == nil {
        status = "error"
    } else if auth.exitCode == 0 {
        status = "success"
    } else {
        status = "degraded"
    }

    let payload: [String: Any] = [
        "status": status,
        "authority": "gh_cli",
        "tool": "gh",
        "repo_root": repoRoot,
        "repository": devGhNullable(repoFullName ?? (repoInfo?["nameWithOwner"] as? String)),
        "branch": devGhNullable(branch),
        "upstream": devGhNullable(upstream),
        "default_branch": devGhNullable(defaultBranch),
        "gh": [
            "available": ghPath != nil,
            "path": devGhNullable(ghPath),
            "auth_exit_code": Int(auth.exitCode),
            "authenticated": auth.exitCode == 0,
            "auth_stdout": devGhSanitizeAuthStatus(auth.stdout),
            "auth_stderr": devGhSanitizeAuthStatus(auth.stderr),
        ],
        "current_pr": devGhNullable(prInfo),
        "dirty": [
            "count": dirtyFiles.count,
            "files": dirtyFiles,
        ],
    ]

    if options.json {
        printDevJSON(payload)
    } else {
        printDevGhContextText(payload)
    }
}

private func devGhIssueCommand(args: [String]) {
    guard let action = args.first else {
        exitError("dev gh issue requires a subcommand: view or comment", code: "MISSING_SUBCOMMAND")
    }
    let options = parseDevGhOptions(Array(args.dropFirst()))
    let repoRoot = resolveRepoRoot(options.cwd)
    let repoFullName = devGhRepositoryFullName(options: options, repoRoot: repoRoot)

    switch action {
    case "view":
        guard options.positionals.count == 1, let number = options.positionals.first else {
            exitError("dev gh issue view requires exactly one issue number", code: "MISSING_ARG")
        }
        var ghArgs = ["issue", "view", number]
        devGhAppendRepo(&ghArgs, repoFullName: repoFullName)
        if options.json {
            ghArgs += ["--json", "number,title,state,url,body,labels,comments"]
        }
        devGhRunAndExit(ghArgs, cwd: repoRoot)
    case "comment":
        guard options.positionals.count == 1, let number = options.positionals.first else {
            exitError("dev gh issue comment requires exactly one issue number", code: "MISSING_ARG")
        }
        guard let bodyFile = options.bodyFile else {
            exitError("dev gh issue comment requires --body-file <path>", code: "MISSING_ARG")
        }
        let absoluteBodyFile = devGhResolveUserPath(bodyFile)
        guard FileManager.default.fileExists(atPath: absoluteBodyFile) else {
            exitError("Missing issue comment body file: \(absoluteBodyFile)", code: "MISSING_BODY_FILE")
        }
        var ghArgs = ["issue", "comment", number]
        devGhAppendRepo(&ghArgs, repoFullName: repoFullName)
        ghArgs += ["--body-file", absoluteBodyFile]
        devGhRunAndExit(ghArgs, cwd: repoRoot)
    default:
        exitError("Unknown dev gh issue subcommand: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devGhPRCommand(args: [String]) {
    guard let action = args.first else {
        exitError("dev gh pr requires a subcommand: view, checks, or comment", code: "MISSING_SUBCOMMAND")
    }
    let options = parseDevGhOptions(Array(args.dropFirst()))
    let repoRoot = resolveRepoRoot(options.cwd)
    let repoFullName = devGhRepositoryFullName(options: options, repoRoot: repoRoot)

    switch action {
    case "view":
        guard options.positionals.count <= 1 else {
            exitError("dev gh pr view accepts at most one PR number", code: "UNKNOWN_ARG")
        }
        var ghArgs = ["pr", "view"]
        if let number = options.positionals.first {
            ghArgs.append(number)
        }
        devGhAppendRepo(&ghArgs, repoFullName: repoFullName)
        if options.json {
            ghArgs += ["--json", "number,title,state,url,headRefName,baseRefName,isDraft,body,comments,reviews"]
        }
        devGhRunAndExit(ghArgs, cwd: repoRoot)
    case "checks":
        guard options.positionals.count <= 1 else {
            exitError("dev gh pr checks accepts at most one PR number", code: "UNKNOWN_ARG")
        }
        var ghArgs = ["pr", "checks"]
        if let number = options.positionals.first {
            ghArgs.append(number)
        }
        devGhAppendRepo(&ghArgs, repoFullName: repoFullName)
        if options.json {
            ghArgs += ["--json", "name,state,bucket,link,startedAt,completedAt,workflow"]
        }
        devGhRunAndExit(ghArgs, cwd: repoRoot)
    case "comment":
        guard options.positionals.count == 1, let number = options.positionals.first else {
            exitError("dev gh pr comment requires exactly one PR number", code: "MISSING_ARG")
        }
        guard let bodyFile = options.bodyFile else {
            exitError("dev gh pr comment requires --body-file <path>", code: "MISSING_ARG")
        }
        let absoluteBodyFile = devGhResolveUserPath(bodyFile)
        guard FileManager.default.fileExists(atPath: absoluteBodyFile) else {
            exitError("Missing PR comment body file: \(absoluteBodyFile)", code: "MISSING_BODY_FILE")
        }
        var ghArgs = ["pr", "comment", number]
        devGhAppendRepo(&ghArgs, repoFullName: repoFullName)
        ghArgs += ["--body-file", absoluteBodyFile]
        devGhRunAndExit(ghArgs, cwd: repoRoot)
    default:
        exitError("Unknown dev gh pr subcommand: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private func devGhCICommand(args: [String]) {
    guard let action = args.first else {
        exitError("dev gh ci requires a subcommand: inspect", code: "MISSING_SUBCOMMAND")
    }
    guard action == "inspect" else {
        exitError("Unknown dev gh ci subcommand: \(action)", code: "UNKNOWN_SUBCOMMAND")
    }

    let options = parseDevGhOptions(Array(args.dropFirst()))
    guard options.positionals.count <= 1 else {
        exitError("dev gh ci inspect accepts at most one PR number", code: "UNKNOWN_ARG")
    }

    let repoRoot = resolveRepoRoot(options.cwd)
    let repoFullName = devGhRepositoryFullName(options: options, repoRoot: repoRoot)
    let prNumber = devGhResolvePRNumber(options.prNumber ?? options.positionals.first, repoFullName: repoFullName, repoRoot: repoRoot, json: options.json)
    var checksArgs = ["pr", "checks", prNumber]
    devGhAppendRepo(&checksArgs, repoFullName: repoFullName)
    checksArgs += ["--json", "name,state,bucket,link,startedAt,completedAt,workflow"]

    let checksResult = runGh(checksArgs, cwd: repoRoot)
    guard checksResult.exitCode == 0 else {
        devGhEmitCompositeErrorAndExit(command: checksArgs, result: checksResult, json: options.json)
    }
    let checks = parseDevGhJSON(checksResult.stdout) as? [[String: Any]] ?? []
    var failedLogs: [[String: Any]] = []
    for check in checks where devGhCheckFailed(check) {
        let link = check["link"] as? String ?? ""
        guard let runID = devGhActionsRunID(from: link) else {
            failedLogs.append([
                "check": check,
                "source": "external",
                "status": "report_only",
                "reason": "check link is not a GitHub Actions run URL",
            ])
            continue
        }

        var logArgs = ["run", "view", runID]
        devGhAppendRepo(&logArgs, repoFullName: repoFullName)
        logArgs.append("--log-failed")
        let logResult = runGh(logArgs, cwd: repoRoot)
        failedLogs.append([
            "check": check,
            "source": "github_actions",
            "run_id": runID,
            "status": logResult.exitCode == 0 ? "success" : "error",
            "exit_code": Int(logResult.exitCode),
            "stdout": logResult.stdout,
            "stderr": logResult.stderr,
        ])
    }

    let payload: [String: Any] = [
        "status": "success",
        "authority": "gh_cli",
        "pr": prNumber,
        "repository": devGhNullable(repoFullName),
        "checks": checks,
        "failed_logs": failedLogs,
    ]
    if options.json {
        printDevJSON(payload)
    } else {
        printDevGhCIText(payload)
    }
}

private func devGhReviewCommentsCommand(args: [String]) {
    let options = parseDevGhOptions(args)
    guard options.positionals.count <= 1 else {
        exitError("dev gh review-comments accepts at most one PR number", code: "UNKNOWN_ARG")
    }

    let repoRoot = resolveRepoRoot(options.cwd)
    let repoFullName = devGhRepositoryFullName(options: options, repoRoot: repoRoot)
    guard let repoFullName else {
        exitError("Could not infer GitHub repository. Pass --repo owner/name.", code: "MISSING_REPO")
    }
    guard let repoParts = devGhSplitRepoFullName(repoFullName) else {
        exitError("Invalid GitHub repository '\(repoFullName)'. Expected owner/name.", code: "INVALID_REPO")
    }

    let prNumber = devGhResolvePRNumber(options.prNumber ?? options.positionals.first, repoFullName: repoFullName, repoRoot: repoRoot, json: options.json)
    guard Int(prNumber) != nil else {
        exitError("PR number must be numeric for review-comments: \(prNumber)", code: "INVALID_PR")
    }

    let query = """
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          number
          url
          reviewThreads(first: 100) {
            nodes {
              isResolved
              isOutdated
              path
              line
              startLine
              comments(first: 50) {
                nodes {
                  id
                  url
                  body
                  createdAt
                  author { login }
                }
              }
            }
          }
        }
      }
    }
    """

    let graphQLArgs = [
        "api", "graphql",
        "-f", "owner=\(repoParts.owner)",
        "-f", "name=\(repoParts.name)",
        "-F", "number=\(prNumber)",
        "-f", "query=\(query)",
    ]
    let result = runGh(graphQLArgs, cwd: repoRoot)
    guard result.exitCode == 0 else {
        devGhEmitCompositeErrorAndExit(command: graphQLArgs, result: result, json: options.json)
    }

    let raw = parseDevGhJSON(result.stdout) as? [String: Any] ?? [:]
    let threads = devGhFlattenReviewThreads(raw)
    let unresolved = threads.filter { ($0["is_resolved"] as? Bool) == false }
    let payload: [String: Any] = [
        "status": "success",
        "authority": "gh_cli",
        "repository": repoFullName,
        "pr": prNumber,
        "thread_count": threads.count,
        "unresolved_count": unresolved.count,
        "threads": threads,
    ]

    if options.json {
        printDevJSON(payload)
    } else {
        printDevGhReviewCommentsText(payload)
    }
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

private func parseDevCapabilitiesOptions(_ args: [String]) -> DevCapabilitiesOptions {
    var options = DevCapabilitiesOptions()
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
        case "--manifest":
            guard i + 1 < args.count else {
                exitError("--manifest requires a path", code: "MISSING_ARG")
            }
            options.manifest = args[i + 1]
            i += 2
        case "--role":
            guard i + 1 < args.count else {
                exitError("--role requires a dock role", code: "MISSING_ARG")
            }
            options.role = args[i + 1]
            i += 2
        case "--entry-path":
            guard i + 1 < args.count else {
                exitError("--entry-path requires an entry path", code: "MISSING_ARG")
            }
            options.entryPath = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev capabilities flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.positionals.append(arg)
            i += 1
        }
    }
    return options
}

private func parseDevDocksOptions(_ args: [String]) -> DevDocksOptions {
    var options = DevDocksOptions()
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
        case "--dock-root":
            guard i + 1 < args.count else {
                exitError("--dock-root requires a path", code: "MISSING_ARG")
            }
            options.dockRoot = args[i + 1]
            i += 2
        case "--capabilities-manifest":
            guard i + 1 < args.count else {
                exitError("--capabilities-manifest requires a path", code: "MISSING_ARG")
            }
            options.capabilitiesManifest = args[i + 1]
            i += 2
        case "--entry-path":
            guard i + 1 < args.count else {
                exitError("--entry-path requires an entry path", code: "MISSING_ARG")
            }
            options.entryPath = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev docks flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.positionals.append(arg)
            i += 1
        }
    }
    return options
}

private func parseDevAfkDryRunOptions(_ args: [String]) -> DevAfkDryRunOptions {
    var options = DevAfkDryRunOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.json = true
            i += 1
        case "--packet":
            guard i + 1 < args.count else {
                exitError("--packet requires a path", code: "MISSING_ARG")
            }
            options.packet = args[i + 1]
            i += 2
        case "--provider":
            guard i + 1 < args.count else {
                exitError("--provider requires a provider name", code: "MISSING_ARG")
            }
            options.provider = args[i + 1]
            i += 2
        case "--dock":
            guard i + 1 < args.count else {
                exitError("--dock requires a dock name", code: "MISSING_ARG")
            }
            options.dock = args[i + 1]
            i += 2
        case "--repo":
            guard i + 1 < args.count else {
                exitError("--repo requires a path", code: "MISSING_ARG")
            }
            options.repo = args[i + 1]
            i += 2
        case "--timestamp":
            guard i + 1 < args.count else {
                exitError("--timestamp requires an ISO timestamp", code: "MISSING_ARG")
            }
            options.timestamp = args[i + 1]
            i += 2
        case "--out":
            guard i + 1 < args.count else {
                exitError("--out requires a path", code: "MISSING_ARG")
            }
            options.out = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev afk-dry-run flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            exitError("dev afk-dry-run does not accept positional arguments: \(arg)", code: "UNKNOWN_ARG")
        }
    }
    return options
}

private func parseDevAfkLaunchAttemptOptions(_ args: [String]) -> DevAfkLaunchAttemptOptions {
    var options = DevAfkLaunchAttemptOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.json = true
            i += 1
        case "--duplicate-in-process":
            options.duplicateInProcess = true
            i += 1
        case "--packet":
            guard i + 1 < args.count else {
                exitError("--packet requires a path", code: "MISSING_ARG")
            }
            options.packet = args[i + 1]
            i += 2
        case "--provider":
            guard i + 1 < args.count else {
                exitError("--provider requires a provider name", code: "MISSING_ARG")
            }
            options.provider = args[i + 1]
            i += 2
        case "--dock":
            guard i + 1 < args.count else {
                exitError("--dock requires a dock name", code: "MISSING_ARG")
            }
            options.dock = args[i + 1]
            i += 2
        case "--repo":
            guard i + 1 < args.count else {
                exitError("--repo requires a path", code: "MISSING_ARG")
            }
            options.repo = args[i + 1]
            i += 2
        case "--timestamp":
            guard i + 1 < args.count else {
                exitError("--timestamp requires an ISO timestamp", code: "MISSING_ARG")
            }
            options.timestamp = args[i + 1]
            i += 2
        case "--out":
            guard i + 1 < args.count else {
                exitError("--out requires a path", code: "MISSING_ARG")
            }
            options.out = args[i + 1]
            i += 2
        case "--catalog-fixture":
            guard i + 1 < args.count else {
                exitError("--catalog-fixture requires a path", code: "MISSING_ARG")
            }
            options.catalogFixture = args[i + 1]
            i += 2
        case "--bridge-visibility-fixture":
            guard i + 1 < args.count else {
                exitError("--bridge-visibility-fixture requires a path", code: "MISSING_ARG")
            }
            options.bridgeVisibilityFixture = args[i + 1]
            i += 2
        case "--provider-session-id":
            guard i + 1 < args.count else {
                exitError("--provider-session-id requires an id", code: "MISSING_ARG")
            }
            options.providerSessionId = args[i + 1]
            i += 2
        case "--launch-observed-at":
            guard i + 1 < args.count else {
                exitError("--launch-observed-at requires an ISO timestamp", code: "MISSING_ARG")
            }
            options.launchObservedAt = args[i + 1]
            i += 2
        case "--codex-home-fixture":
            guard i + 1 < args.count else {
                exitError("--codex-home-fixture requires a path", code: "MISSING_ARG")
            }
            options.codexHomeFixture = args[i + 1]
            i += 2
        case "--codex-home":
            guard i + 1 < args.count else {
                exitError("--codex-home requires a path", code: "MISSING_ARG")
            }
            options.codexHome = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev afk-launch-attempt flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            exitError("dev afk-launch-attempt does not accept positional arguments: \(arg)", code: "UNKNOWN_ARG")
        }
    }
    return options
}

private func parseDevAfkSessionTriggerOptions(_ args: [String]) -> DevAfkSessionTriggerOptions {
    var options = DevAfkSessionTriggerOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.json = true
            i += 1
        case "--dry-run":
            options.dryRun = true
            i += 1
        case "--supervised-live-launch":
            options.supervisedLiveLaunch = true
            i += 1
        case "--afk-live-launch", "--sleep-lease-live-launch":
            options.sleepLeaseLiveLaunch = true
            i += 1
        case "--warm-dock-tui-reuse":
            options.warmDockTuiReuse = true
            i += 1
        case "--i-am-present":
            options.iAmPresent = true
            i += 1
        case "--provider-launch-dry-run":
            options.providerLaunchDryRun = true
            i += 1
        case "--packet":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--packet requires a path", code: "MISSING_ARG")
            }
            options.packet = args[i + 1]
            i += 2
        case "--afk-authorization", "--sleep-lease":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("\(arg) requires a path", code: "MISSING_ARG")
            }
            options.sleepLease = args[i + 1]
            i += 2
        case "--provider":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--provider requires a provider name", code: "MISSING_ARG")
            }
            options.provider = args[i + 1]
            i += 2
        case "--dock":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--dock requires a dock name", code: "MISSING_ARG")
            }
            options.dock = args[i + 1]
            i += 2
        case "--repo":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--repo requires a path", code: "MISSING_ARG")
            }
            options.repo = args[i + 1]
            i += 2
        case "--timestamp":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--timestamp requires an ISO timestamp", code: "MISSING_ARG")
            }
            options.timestamp = args[i + 1]
            i += 2
        case "--out":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--out requires a path", code: "MISSING_ARG")
            }
            options.out = args[i + 1]
            i += 2
        case "--result-route":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--result-route requires a ref", code: "MISSING_ARG")
            }
            options.resultRoute = args[i + 1]
            i += 2
        case "--idempotence-salt":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--idempotence-salt requires a value", code: "MISSING_ARG")
            }
            options.idempotenceSalt = args[i + 1]
            i += 2
        case "--existing-receipt":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--existing-receipt requires a path", code: "MISSING_ARG")
            }
            options.existingReceipt = args[i + 1]
            i += 2
        case "--replacement-for":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--replacement-for requires an id", code: "MISSING_ARG")
            }
            options.replacementFor = args[i + 1]
            i += 2
        case "--bridge-visibility-fixture":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--bridge-visibility-fixture requires a path", code: "MISSING_ARG")
            }
            options.bridgeVisibilityFixture = args[i + 1]
            i += 2
        case "--cleanup-proof-fixture":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--cleanup-proof-fixture requires a path", code: "MISSING_ARG")
            }
            options.cleanupProofFixture = args[i + 1]
            i += 2
        case "--provider-session-id":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--provider-session-id requires an id", code: "MISSING_ARG")
            }
            options.providerSessionId = args[i + 1]
            i += 2
        case "--launch-observed-at":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--launch-observed-at requires an ISO timestamp", code: "MISSING_ARG")
            }
            options.launchObservedAt = args[i + 1]
            i += 2
        case "--codex-home-fixture":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--codex-home-fixture requires a path", code: "MISSING_ARG")
            }
            options.codexHomeFixture = args[i + 1]
            i += 2
        case "--codex-home":
            guard i + 1 < args.count, !args[i + 1].hasPrefix("--") else {
                exitError("--codex-home requires a path", code: "MISSING_ARG")
            }
            options.codexHome = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev afk-session-trigger flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            exitError("dev afk-session-trigger does not accept positional arguments: \(arg)", code: "UNKNOWN_ARG")
        }
    }
    return options
}

private func parseDevGhOptions(_ args: [String]) -> DevGhOptions {
    var options = DevGhOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.json = true
            i += 1
        case "--repo":
            guard i + 1 < args.count else {
                exitError("--repo requires a GitHub repository in owner/name form", code: "MISSING_ARG")
            }
            options.repo = args[i + 1]
            i += 2
        case "--cwd":
            guard i + 1 < args.count else {
                exitError("--cwd requires a local checkout path", code: "MISSING_ARG")
            }
            options.cwd = args[i + 1]
            i += 2
        case "--body-file":
            guard i + 1 < args.count else {
                exitError("--body-file requires a path", code: "MISSING_ARG")
            }
            options.bodyFile = args[i + 1]
            i += 2
        case "--pr":
            guard i + 1 < args.count else {
                exitError("--pr requires a PR number", code: "MISSING_ARG")
            }
            options.prNumber = args[i + 1]
            i += 2
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev gh flag: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.positionals.append(arg)
            i += 1
        }
    }
    return options
}

private func parseDevAuditOptions(_ args: [String]) -> DevAuditOptions {
    var options = DevAuditOptions()
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
        case "--manifest":
            guard i + 1 < args.count else {
                exitError("--manifest requires a path", code: "MISSING_ARG")
            }
            options.manifest = args[i + 1]
            i += 2
        default:
            exitError("Unknown dev audit flag: \(arg)", code: "UNKNOWN_FLAG")
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
    let classified = classifyDevFiles(files, manifest: manifest, repoRoot: repoRoot)

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
        "manifest": classification["manifest"] ?? devWorkflowDefaultManifestRelativePath,
        "repo": classification["repo"] ?? FileManager.default.currentDirectoryPath,
        "diff_base": classification["diff_base"] ?? NSNull(),
        "changed_files": classification["changed_files"] ?? [],
        "next_commands": commands,
        "verification": verification,
        "notes": notes,
        "summary": summary,
    ]
}

private func loadDevCapabilityManifest(options: DevCapabilitiesOptions) -> (
    repoRoot: String,
    path: String,
    manifest: [String: Any],
    capabilities: [[String: Any]]
) {
    let repoRoot = resolveRepoRoot(options.repo)
    let manifestPath = resolveCapabilityManifestPath(options.manifest, repoRoot: repoRoot)
    guard let data = FileManager.default.contents(atPath: manifestPath) else {
        exitError("Missing dev capability manifest: \(manifestPath)", code: "MISSING_MANIFEST")
    }
    do {
        guard let manifest = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            exitError("Invalid dev capability manifest \(manifestPath): expected JSON object", code: "INVALID_MANIFEST")
        }
        let capabilities = manifest["capabilities"] as? [[String: Any]] ?? []
        return (repoRoot, manifestPath, manifest, capabilities)
    } catch {
        exitError("Invalid dev capability manifest \(manifestPath): \(error)", code: "INVALID_MANIFEST")
    }
}

private func filterDevCapabilities(_ capabilities: [[String: Any]], options: DevCapabilitiesOptions) -> [[String: Any]] {
    capabilities.filter { capability in
        if let role = options.role {
            let roles = capability["roles"] as? [String] ?? []
            if !roles.isEmpty && !roles.contains(role) {
                return false
            }
        }
        if let entryPath = options.entryPath {
            let entryPaths = capability["entry_paths"] as? [String] ?? []
            if !entryPaths.contains(entryPath) {
                return false
            }
        }
        return true
    }
}

private func compactDevCapability(_ capability: [String: Any]) -> [String: Any] {
    let adapter = capability["adapter"] as? [String: Any] ?? [:]
    let mutability = capability["mutability"] as? [String: Any] ?? [:]
    let execution = capability["execution"] as? [String: Any] ?? [:]
    return [
        "id": capability["id"] ?? NSNull(),
        "label": capability["label"] ?? NSNull(),
        "summary": capability["summary"] ?? NSNull(),
        "status": capability["status"] ?? NSNull(),
        "roles": capability["roles"] ?? [],
        "entry_paths": capability["entry_paths"] ?? [],
        "adapter_kind": adapter["kind"] ?? NSNull(),
        "command": adapter["command"] ?? [],
        "mutability_class": mutability["class"] ?? NSNull(),
        "requires_explicit_assignment": mutability["requires_explicit_assignment"] ?? NSNull(),
        "requires_human_approval": mutability["requires_human_approval"] ?? NSNull(),
        "requires_body_file": mutability["requires_body_file"] ?? NSNull(),
        "raw_process": execution["raw_process"] ?? NSNull(),
        "cwd_policy": execution["cwd_policy"] ?? NSNull(),
        "timeout_seconds": execution["timeout_seconds"] ?? NSNull(),
        "audit": execution["audit"] ?? NSNull(),
    ]
}

private func loadDevDockProfiles(options: DevDocksOptions) -> (
    repoRoot: String,
    dockRoot: String,
    profiles: [[String: Any]]
) {
    let repoRoot = resolveRepoRoot(options.repo)
    let dockRoot = resolveDockRootPath(options.dockRoot, repoRoot: repoRoot)
    var isDirectory: ObjCBool = false
    guard FileManager.default.fileExists(atPath: dockRoot, isDirectory: &isDirectory), isDirectory.boolValue else {
        exitError("Missing dock root: \(dockRoot)", code: "MISSING_DOCK_ROOT")
    }

    let entries: [String]
    do {
        entries = try FileManager.default.contentsOfDirectory(atPath: dockRoot).sorted()
    } catch {
        exitError("Unable to read dock root \(dockRoot): \(error)", code: "DOCK_ROOT_UNREADABLE")
    }

    var profiles: [[String: Any]] = []
    for entry in entries {
        let entryPath = (dockRoot as NSString).appendingPathComponent(entry)
        var entryIsDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: entryPath, isDirectory: &entryIsDirectory),
              entryIsDirectory.boolValue else {
            continue
        }
        let profilePath = (entryPath as NSString).appendingPathComponent("dock.json")
        guard FileManager.default.fileExists(atPath: profilePath) else {
            continue
        }
        profiles.append(loadDevJSONObject(path: profilePath, missingCode: "MISSING_DOCK_PROFILE", invalidCode: "INVALID_DOCK_PROFILE"))
    }

    return (repoRoot, dockRoot, profiles.sorted { (devString($0["name"]) ?? "") < (devString($1["name"]) ?? "") })
}

private func resolveDevDockCapabilities(
    profile: [String: Any],
    capabilities: [[String: Any]],
    entryPath: String
) -> [[String: Any]] {
    let role = devString(profile["role"])
    let allowedClasses = Set(devStringArray(profile["allowed_capability_classes"]))
    let allowedIDs = Set(devStringArray(profile["allowed_capabilities"]))
    return capabilities.filter { capability in
        if let status = devString(capability["status"]), status == "deprecated" {
            return false
        }
        guard let capabilityID = devString(capability["id"]) else {
            return false
        }
        if !allowedIDs.isEmpty && !allowedIDs.contains(capabilityID) {
            return false
        }
        let capabilityRoles = devStringArray(capability["roles"])
        if let role, !capabilityRoles.isEmpty, !capabilityRoles.contains(role) {
            return false
        }
        let capabilityEntryPaths = devStringArray(capability["entry_paths"])
        if !capabilityEntryPaths.contains(entryPath) {
            return false
        }
        let mutability = capability["mutability"] as? [String: Any] ?? [:]
        guard let capabilityClass = devString(mutability["class"]),
              allowedClasses.contains(capabilityClass) else {
            return false
        }
        return true
    }
}

private func compactDevDockProfile(_ profile: [String: Any]) -> [String: Any] {
    return [
        "name": profile["name"] ?? NSNull(),
        "role": profile["role"] ?? NSNull(),
        "harness": profile["harness"] ?? NSNull(),
        "summary": profile["summary"] ?? NSNull(),
        "default_entry_path": profile["default_entry_path"] ?? NSNull(),
        "allowed_entry_paths": profile["allowed_entry_paths"] ?? [],
        "allowed_capability_classes": profile["allowed_capability_classes"] ?? [],
        "allowed_capabilities": profile["allowed_capabilities"] ?? [],
        "requires_explicit_assignment_for": profile["requires_explicit_assignment_for"] ?? [],
        "requires_goal_prefix": (profile["handoff"] as? [String: Any])?["requires_goal_prefix"] ?? NSNull(),
    ]
}

private func buildDevAudit(options: DevAuditOptions) -> [String: Any] {
    let repoRoot = resolveRepoRoot(options.repo)
    let defaultManifestPath = resolveManifestPath(nil, repoRoot: repoRoot)
    let selectedManifestPath = resolveManifestPath(options.manifest, repoRoot: repoRoot)
    let selectedManifestRelative = normalizeRepoRelativePath(selectedManifestPath, repoRoot: repoRoot)

    var claims: [DevAuditClaim] = []

    let defaultManifestRelative = normalizeRepoRelativePath(defaultManifestPath, repoRoot: repoRoot)
    claims.append(auditClaim(
        id: "dev-default-manifest-path",
        claim: "The dev workflow router default manifest path is canonical.",
        passed: defaultManifestRelative == devWorkflowDefaultManifestRelativePath,
        expected: devWorkflowDefaultManifestRelativePath,
        observed: defaultManifestRelative,
        evidence: ["src/commands/dev.swift:resolveManifestPath"],
        next: "Update resolveManifestPath to use \(devWorkflowDefaultManifestRelativePath)."))

    let manifestExists = FileManager.default.fileExists(atPath: selectedManifestPath)
    claims.append(auditClaim(
        id: "dev-manifest-readable",
        claim: "The selected dev workflow manifest exists on disk.",
        passed: manifestExists,
        expected: "exists=true at \(selectedManifestRelative)",
        observed: "exists=\(manifestExists)",
        evidence: [selectedManifestRelative],
        next: "Restore the manifest or pass --manifest <path> to a valid rules file."))

    let manifestResult = readDevWorkflowManifest(path: selectedManifestPath)
    let manifest: DevWorkflowManifest?
    switch manifestResult {
    case .success(let decoded):
        manifest = decoded
        claims.append(auditClaim(
            id: "dev-manifest-decodes",
            claim: "The selected dev workflow manifest decodes as schema version 1.",
            passed: decoded.schemaVersion == 1,
            expected: "schema_version=1",
            observed: "schema_version=\(decoded.schemaVersion)",
            evidence: [selectedManifestRelative, "shared/schemas/dev-workflow-rules.schema.json"],
            next: "Run node --test tests/schemas/dev-workflow-rules.test.mjs."))
    case .failure(let error):
        manifest = nil
        claims.append(auditClaim(
            id: "dev-manifest-decodes",
            claim: "The selected dev workflow manifest decodes as schema version 1.",
            passed: false,
            expected: "valid schema_version=1 manifest",
            observed: error,
            evidence: [selectedManifestRelative, "shared/schemas/dev-workflow-rules.schema.json"],
            next: "Run node --test tests/schemas/dev-workflow-rules.test.mjs."))
    }

    claims.append(contentsOf: auditCommandRegistryClaims())

    if let manifest {
        claims.append(contentsOf: auditDevWorkflowManifestClaims(manifest))
        claims.append(contentsOf: auditExplicitRecommendationClaims(manifest: manifest, repoRoot: repoRoot))
    } else {
        claims.append(auditClaim(
            id: "dev-workflow-self-routes",
            claim: "The dev workflow manifest routes its own command, registry, and tests.",
            passed: false,
            expected: "decoded manifest with \(devWorkflowRuleID) rule",
            observed: "manifest did not decode",
            evidence: [selectedManifestRelative],
            next: "Fix the manifest before trusting dev workflow routing."))
        claims.append(auditClaim(
            id: "dev-recommend-explicit-files",
            claim: "The router can classify explicit docs-only file input without runtime work.",
            passed: false,
            expected: "docs-only route with no commands or verification",
            observed: "manifest did not decode",
            evidence: [selectedManifestRelative],
            next: "Fix the manifest before trusting dev recommend."))
    }

    let passed = claims.filter { $0.status == "passed" }.count
    let failed = claims.count - passed
    return [
        "status": failed == 0 ? "success" : "failed",
        "subject": "dev-grammar",
        "repo": repoRoot,
        "manifest": selectedManifestRelative,
        "claims": claims.map { $0.toJSON() },
        "summary": [
            "total": claims.count,
            "passed": passed,
            "failed": failed,
        ],
        "next": failed == 0 ? "No dev grammar repair needed." : "./aos dev build --force --no-restart && bash tests/dev-audit.sh",
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
    return (repoRoot as NSString).appendingPathComponent(devWorkflowDefaultManifestRelativePath)
}

private func resolveCapabilityManifestPath(_ requested: String?, repoRoot: String) -> String {
    if let requested = requested {
        let expanded = NSString(string: requested).expandingTildeInPath
        if expanded.hasPrefix("/") {
            return NSString(string: expanded).standardizingPath
        }
        return NSString(string: (repoRoot as NSString).appendingPathComponent(expanded)).standardizingPath
    }
    return (repoRoot as NSString).appendingPathComponent(devCapabilitiesDefaultManifestRelativePath)
}

private func resolveDockRootPath(_ requested: String?, repoRoot: String) -> String {
    if let requested = requested {
        let expanded = NSString(string: requested).expandingTildeInPath
        if expanded.hasPrefix("/") {
            return NSString(string: expanded).standardizingPath
        }
        return NSString(string: (repoRoot as NSString).appendingPathComponent(expanded)).standardizingPath
    }
    return (repoRoot as NSString).appendingPathComponent(devDocksDefaultRootRelativePath)
}

private func loadDevJSONObject(path: String, missingCode: String, invalidCode: String) -> [String: Any] {
    guard let data = FileManager.default.contents(atPath: path) else {
        exitError("Missing JSON file: \(path)", code: missingCode)
    }
    do {
        guard let object = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else {
            exitError("Invalid JSON file \(path): expected object", code: invalidCode)
        }
        return object
    } catch {
        exitError("Invalid JSON file \(path): \(error)", code: invalidCode)
    }
}

private func loadDevWorkflowManifest(path: String) -> DevWorkflowManifest {
    switch readDevWorkflowManifest(path: path) {
    case .success(let manifest):
        return manifest
    case .failure(let error):
        if error.hasPrefix("missing:") {
            exitError("Missing dev workflow manifest: \(path)", code: "MISSING_MANIFEST")
        }
        exitError("Invalid dev workflow manifest \(path): \(error)", code: "INVALID_MANIFEST")
    }
}

private func readDevWorkflowManifest(path: String) -> DevWorkflowManifestReadResult {
    guard let data = FileManager.default.contents(atPath: path) else {
        return .failure("missing: \(path)")
    }
    do {
        return .success(try JSONDecoder().decode(DevWorkflowManifest.self, from: data))
    } catch {
        return .failure("\(error)")
    }
}

private func auditCommandRegistryClaims() -> [DevAuditClaim] {
    guard let dev = findCommand(path: ["dev"]) else {
        return [auditClaim(
            id: "dev-help-registry-present",
            claim: "The command registry exposes the dev command.",
            passed: false,
            expected: "command path dev",
            observed: "missing",
            evidence: ["src/shared/command-registry-data.swift"],
            next: "Register the dev command before trusting parser/help alignment.")]
    }

    var claims: [DevAuditClaim] = []
    let forms = Dictionary(uniqueKeysWithValues: dev.forms.map { ($0.id, $0) })
    let expectedForms = ["dev-classify", "dev-recommend", "dev-build", "dev-afk-dry-run", "dev-afk-launch-attempt", "dev-afk-session-trigger", "dev-audit", "dev-capabilities", "dev-docks", "dev-gh"]
    let observedForms = dev.forms.map { $0.id }.sorted()
    claims.append(auditClaim(
        id: "dev-help-forms",
        claim: "Help registry exposes the complete dev command surface.",
        passed: Set(expectedForms).isSubset(of: Set(observedForms)),
        expected: expectedForms.sorted().joined(separator: ","),
        observed: observedForms.joined(separator: ","),
        evidence: ["src/shared/command-registry-data.swift", "./aos help dev --json"],
        next: "Add the missing dev InvocationForm so agents can discover the command."))

    let workflowFlags = ["--paths", "--files", "--manifest", "--base", "--repo", "--json"]
    claims.append(auditFormFlagClaim(
        id: "dev-classify-help-flags",
        form: forms["dev-classify"],
        expectedFlags: workflowFlags,
        defaultManifestRequired: true))
    claims.append(auditFormFlagClaim(
        id: "dev-recommend-help-flags",
        form: forms["dev-recommend"],
        expectedFlags: workflowFlags,
        defaultManifestRequired: true))
    claims.append(auditFormFlagClaim(
        id: "dev-afk-dry-run-help-flags",
        form: forms["dev-afk-dry-run"],
        expectedFlags: ["--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json"],
        defaultManifestRequired: false))
    claims.append(auditFormFlagClaim(
        id: "dev-afk-launch-attempt-help-flags",
        form: forms["dev-afk-launch-attempt"],
        expectedFlags: ["--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json", "--duplicate-in-process", "--catalog-fixture", "--bridge-visibility-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home"],
        defaultManifestRequired: false))
    claims.append(auditFormFlagClaim(
        id: "dev-afk-session-trigger-help-flags",
        form: forms["dev-afk-session-trigger"],
        expectedFlags: ["--packet", "--afk-authorization", "--sleep-lease", "--provider", "--dock", "--repo", "--timestamp", "--out", "--result-route", "--idempotence-salt", "--existing-receipt", "--replacement-for", "--dry-run", "--supervised-live-launch", "--afk-live-launch", "--sleep-lease-live-launch", "--i-am-present", "--provider-launch-dry-run", "--bridge-visibility-fixture", "--cleanup-proof-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home", "--json"],
        defaultManifestRequired: false))
    claims.append(auditFormFlagClaim(
        id: "dev-audit-help-flags",
        form: forms["dev-audit"],
        expectedFlags: ["--manifest", "--repo", "--json"],
        defaultManifestRequired: true))
    claims.append(auditFormFlagClaim(
        id: "dev-capabilities-help-flags",
        form: forms["dev-capabilities"],
        expectedFlags: ["--manifest", "--repo", "--role", "--entry-path", "--json"],
        defaultManifestRequired: false))
    claims.append(auditFormFlagClaim(
        id: "dev-docks-help-flags",
        form: forms["dev-docks"],
        expectedFlags: ["--dock-root", "--capabilities-manifest", "--entry-path", "--repo", "--json"],
        defaultManifestRequired: false))
    claims.append(auditFormFlagClaim(
        id: "dev-gh-help-flags",
        form: forms["dev-gh"],
        expectedFlags: ["--repo", "--cwd", "--json", "--body-file", "--pr"],
        defaultManifestRequired: false))
    return claims
}

private func auditFormFlagClaim(
    id: String,
    form: InvocationForm?,
    expectedFlags: [String],
    defaultManifestRequired: Bool
) -> DevAuditClaim {
    guard let form else {
        return auditClaim(
            id: id,
            claim: "The help registry exposes required flags for \(id).",
            passed: false,
            expected: expectedFlags.joined(separator: ","),
            observed: "missing form",
            evidence: ["src/shared/command-registry-data.swift"],
            next: "Restore the missing help form.")
    }

    let tokens = Set(form.args.compactMap { $0.token })
    let hasFlags = Set(expectedFlags).isSubset(of: tokens)
    let manifestDefault = form.args.first { $0.token == "--manifest" }?.defaultValue?.toJSON() as? String
    let hasManifestDefault = !defaultManifestRequired || manifestDefault == devWorkflowDefaultManifestRelativePath
    let observed = Array(tokens).sorted().joined(separator: ",")
        + "; manifest_default=\(manifestDefault ?? "nil")"
    return auditClaim(
        id: id,
        claim: "The help registry exposes required flags and defaults for \(form.id).",
        passed: hasFlags && hasManifestDefault,
        expected: expectedFlags.sorted().joined(separator: ",")
            + (defaultManifestRequired ? "; manifest_default=\(devWorkflowDefaultManifestRelativePath)" : ""),
        observed: observed,
        evidence: ["src/shared/command-registry-data.swift", "./aos help dev --json"],
        next: "Align InvocationForm args with the parser in src/commands/dev.swift.")
}

private func auditDevWorkflowManifestClaims(_ manifest: DevWorkflowManifest) -> [DevAuditClaim] {
    guard let rule = manifest.rules.first(where: { $0.id == devWorkflowRuleID }) else {
        return [auditClaim(
            id: "dev-workflow-self-routes",
            claim: "The dev workflow manifest routes its own command, registry, and tests.",
            passed: false,
            expected: devWorkflowRuleID,
            observed: "missing",
            evidence: [devWorkflowDefaultManifestRelativePath],
            next: "Add a \(devWorkflowRuleID) rule to the workflow manifest.")]
    }

    let expectedPatterns = [
        "docs/dev/workflow-rules.json",
        "src/commands/dev.swift",
        "src/shared/command-registry-data.swift",
        "tests/dev-workflow-router.sh",
        "tests/dev-audit.sh",
        "tests/schemas/dev-workflow-rules.test.mjs",
    ]
    let observedPatterns = Set(rule.patterns)
    let expectedCommands = [
        "node --test tests/schemas/dev-workflow-rules.test.mjs",
        "bash tests/dev-workflow-router.sh",
        "bash tests/dev-audit.sh",
    ]
    let observedCommands = Set((rule.commands ?? []).map { $0.command })

    return [
        auditClaim(
            id: "dev-workflow-self-routes",
            claim: "The dev workflow manifest routes its own command, registry, and tests.",
            passed: Set(expectedPatterns).isSubset(of: observedPatterns),
            expected: expectedPatterns.sorted().joined(separator: ","),
            observed: Array(observedPatterns).sorted().joined(separator: ","),
            evidence: [devWorkflowDefaultManifestRelativePath],
            next: "Add missing dev workflow source/test patterns to \(devWorkflowDefaultManifestRelativePath)."),
        auditClaim(
            id: "dev-workflow-self-verifies",
            claim: "The dev workflow rule recommends schema, router, and audit verification.",
            passed: Set(expectedCommands).isSubset(of: observedCommands),
            expected: expectedCommands.sorted().joined(separator: ","),
            observed: Array(observedCommands).sorted().joined(separator: ","),
            evidence: [devWorkflowDefaultManifestRelativePath],
            next: "Add missing verification commands to the \(devWorkflowRuleID) rule.")
    ]
}

private func auditExplicitRecommendationClaims(manifest: DevWorkflowManifest, repoRoot: String) -> [DevAuditClaim] {
    let classified = classifyDevFiles(["docs/recipes/example.md"], manifest: manifest, repoRoot: repoRoot)
    let summary = aggregateDevWorkflow(classified)
    let ruleIDs = summary["rule_ids"] as? [String] ?? []
    let commands = summary["commands"] as? [[String: Any]] ?? []
    let verification = summary["verification"] as? [[String: Any]] ?? []
    let passed = ruleIDs == ["docs-only"] && commands.isEmpty && verification.isEmpty
    return [auditClaim(
        id: "dev-recommend-explicit-files",
        claim: "The router can classify explicit docs-only file input without runtime work.",
        passed: passed,
        expected: "rule_ids=docs-only; commands=0; verification=0",
        observed: "rule_ids=\(ruleIDs.joined(separator: ",")); commands=\(commands.count); verification=\(verification.count)",
        evidence: ["./aos dev recommend --json --files docs/recipes/example.md"],
        next: "Fix dev workflow matching so explicit file input does not trigger unrelated runtime loops.")]
}

private func classifyDevFiles(_ files: [String], manifest: DevWorkflowManifest, repoRoot: String) -> [DevClassifiedFile] {
    return uniquePreservingOrder(files.map { normalizeRepoRelativePath($0, repoRoot: repoRoot) })
        .filter { !$0.isEmpty }
        .map { path -> DevClassifiedFile in
            let matches = manifest.rules.filter { rule in
                rule.patterns.contains { globMatches(pattern: $0, path: path) }
            }
            if matches.isEmpty, let fallback = manifest.fallback {
                return DevClassifiedFile(path: path, rules: [fallback])
            }
            return DevClassifiedFile(path: path, rules: matches)
        }
}

private func auditClaim(
    id: String,
    claim: String,
    passed: Bool,
    expected: String,
    observed: String,
    evidence: [String],
    next: String?
) -> DevAuditClaim {
    DevAuditClaim(
        id: id,
        claim: claim,
        status: passed ? "passed" : "failed",
        expected: expected,
        observed: observed,
        evidence: evidence,
        next: passed ? nil : next)
}

private func printDevAuditText(_ payload: [String: Any]) {
    let status = payload["status"] as? String ?? "unknown"
    let summary = payload["summary"] as? [String: Any] ?? [:]
    let failed = summary["failed"] as? Int ?? 0
    print("dev audit: \(status)")
    for claim in payload["claims"] as? [[String: Any]] ?? [] {
        let marker = (claim["status"] as? String) == "passed" ? "PASS" : "FAIL"
        let id = claim["id"] as? String ?? "unknown"
        let text = claim["claim"] as? String ?? ""
        print("\(marker) \(id) - \(text)")
        if marker == "FAIL", let next = claim["next"] as? String {
            print("  Next: \(next)")
        }
    }
    if failed > 0, let next = payload["next"] as? String {
        print("Next: \(next)")
    }
}

private func printDevCapabilitiesListText(_ payload: [String: Any]) {
    let count = payload["count"] as? Int ?? 0
    print("dev capabilities: \(count)")
    if let manifest = payload["manifest"] as? String {
        print("Manifest: \(manifest)")
    }
    for capability in payload["capabilities"] as? [[String: Any]] ?? [] {
        let id = capability["id"] as? String ?? "unknown"
        let label = capability["label"] as? String ?? id
        let adapter = capability["adapter_kind"] as? String ?? "unknown"
        let mutability = capability["mutability_class"] as? String ?? "unknown"
        let raw = capability["raw_process"] as? Bool ?? false
        print("- \(id) (\(label)): adapter=\(adapter) mutability=\(mutability) raw_process=\(raw)")
    }
}

private func printDevCapabilityExplainText(_ payload: [String: Any]) {
    guard let capability = payload["capability"] as? [String: Any] else {
        print("dev capability: missing")
        return
    }
    let id = capability["id"] as? String ?? "unknown"
    let label = capability["label"] as? String ?? id
    print("\(id) - \(label)")
    if let summary = capability["summary"] as? String {
        print(summary)
    }
    let adapter = capability["adapter"] as? [String: Any] ?? [:]
    let mutability = capability["mutability"] as? [String: Any] ?? [:]
    let execution = capability["execution"] as? [String: Any] ?? [:]
    print("Adapter: \(adapter["kind"] as? String ?? "unknown")")
    if let command = adapter["command"] as? [String], !command.isEmpty {
        print("Command: \(command.joined(separator: " "))")
    }
    print("Mutability: \(mutability["class"] as? String ?? "unknown")")
    print("Raw process: \(execution["raw_process"] as? Bool ?? false)")
    print("Audit: \(execution["audit"] as? String ?? "unknown")")
}

private func printDevDocksListText(_ payload: [String: Any]) {
    let count = payload["count"] as? Int ?? 0
    print("dev docks: \(count)")
    if let dockRoot = payload["dock_root"] as? String {
        print("Dock root: \(dockRoot)")
    }
    for dock in payload["docks"] as? [[String: Any]] ?? [] {
        let name = dock["name"] as? String ?? "unknown"
        let role = dock["role"] as? String ?? "unknown"
        let defaultEntryPath = dock["default_entry_path"] as? String ?? "unknown"
        let classes = (dock["allowed_capability_classes"] as? [String] ?? []).joined(separator: ",")
        print("- \(name): role=\(role) default_entry_path=\(defaultEntryPath) classes=\(classes)")
    }
}

private func printDevDockExplainText(_ payload: [String: Any]) {
    guard let profile = payload["profile"] as? [String: Any] else {
        print("dev dock: missing")
        return
    }
    let name = profile["name"] as? String ?? "unknown"
    let role = profile["role"] as? String ?? "unknown"
    print("\(name) - \(role)")
    if let summary = profile["summary"] as? String {
        print(summary)
    }
    print("Default entry path: \(profile["default_entry_path"] as? String ?? "unknown")")
    print("Allowed entry paths: \((profile["allowed_entry_paths"] as? [String] ?? []).joined(separator: ", "))")
    print("Allowed classes: \((profile["allowed_capability_classes"] as? [String] ?? []).joined(separator: ", "))")
}

private func printDevDockCapabilitiesText(_ payload: [String: Any]) {
    let dock = payload["dock"] as? String ?? "unknown"
    let activeEntryPath = payload["active_entry_path"] as? String ?? "unknown"
    let count = payload["count"] as? Int ?? 0
    print("dev dock capabilities: \(dock) entry_path=\(activeEntryPath) count=\(count)")
    for capability in payload["capabilities"] as? [[String: Any]] ?? [] {
        let id = capability["id"] as? String ?? "unknown"
        let adapter = capability["adapter_kind"] as? String ?? "unknown"
        let mutability = capability["mutability_class"] as? String ?? "unknown"
        let raw = capability["raw_process"] as? Bool ?? false
        print("- \(id): adapter=\(adapter) mutability=\(mutability) raw_process=\(raw)")
    }
}

private func printDevGhContextText(_ payload: [String: Any]) {
    let status = payload["status"] as? String ?? "unknown"
    print("dev gh context: \(status)")
    print("Authority: gh CLI")
    print("Repo root: \(payload["repo_root"] as? String ?? "unknown")")
    if let repository = payload["repository"] as? String {
        print("Repository: \(repository)")
    }
    if let branch = payload["branch"] as? String {
        print("Branch: \(branch)")
    }
    if let gh = payload["gh"] as? [String: Any] {
        let available = gh["available"] as? Bool ?? false
        let authenticated = gh["authenticated"] as? Bool ?? false
        print("gh: available=\(available) authenticated=\(authenticated)")
    }
    if let currentPR = payload["current_pr"] as? [String: Any],
       let number = currentPR["number"] {
        print("Current PR: #\(number)")
    }
    if let dirty = payload["dirty"] as? [String: Any],
       let count = dirty["count"] as? Int {
        print("Dirty files: \(count)")
    }
}

private func printDevGhCIText(_ payload: [String: Any]) {
    let pr = payload["pr"] as? String ?? "unknown"
    let checks = payload["checks"] as? [[String: Any]] ?? []
    let failedLogs = payload["failed_logs"] as? [[String: Any]] ?? []
    print("dev gh ci inspect: PR #\(pr)")
    print("Checks: \(checks.count)")
    for check in checks {
        let name = check["name"] as? String ?? "unknown"
        let state = check["state"] as? String ?? check["bucket"] as? String ?? "unknown"
        print("- \(name): \(state)")
    }
    if !failedLogs.isEmpty {
        print("Failed check evidence:")
        for item in failedLogs {
            let check = item["check"] as? [String: Any] ?? [:]
            let name = check["name"] as? String ?? "unknown"
            let source = item["source"] as? String ?? "unknown"
            print("- \(name): \(source)")
            if let stdout = item["stdout"] as? String, !stdout.isEmpty {
                print(devGhTruncate(stdout.trimmingCharacters(in: .whitespacesAndNewlines), limit: 2000))
            }
            if let stderr = item["stderr"] as? String, !stderr.isEmpty {
                print(devGhTruncate(stderr.trimmingCharacters(in: .whitespacesAndNewlines), limit: 2000))
            }
        }
    }
}

private func printDevGhReviewCommentsText(_ payload: [String: Any]) {
    let pr = payload["pr"] as? String ?? "unknown"
    let count = payload["thread_count"] as? Int ?? 0
    let unresolved = payload["unresolved_count"] as? Int ?? 0
    print("dev gh review-comments: PR #\(pr)")
    print("Threads: \(count), unresolved: \(unresolved)")
    for thread in payload["threads"] as? [[String: Any]] ?? [] {
        guard (thread["is_resolved"] as? Bool) == false else { continue }
        let path = thread["path"] as? String ?? "unknown"
        let line = thread["line"] ?? thread["start_line"] ?? "?"
        let comments = thread["comments"] as? [[String: Any]] ?? []
        let first = comments.first
        let author = first?["author"] as? String ?? "unknown"
        let body = devGhOneLine(first?["body"] as? String ?? "", limit: 140)
        print("- \(path):\(line) @\(author) \(body)")
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

private func runGh(_ args: [String], cwd: String) -> ProcessOutput {
    guard let gh = findExecutable("gh") else {
        return ProcessOutput(exitCode: 127, stdout: "", stderr: "gh CLI not found in PATH\n")
    }
    return runProcessCapturingOutput(gh, arguments: args, cwd: cwd)
}

private func devGhRunAndExit(_ args: [String], cwd: String) -> Never {
    let result = runGh(args, cwd: cwd)
    devGhWriteProcessOutput(result)
    exit(result.exitCode)
}

private func devGhWriteProcessOutput(_ result: ProcessOutput) {
    if !result.stdout.isEmpty, let data = result.stdout.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
    if !result.stderr.isEmpty, let data = result.stderr.data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
}

private func devGhEmitCompositeErrorAndExit(command: [String], result: ProcessOutput, json: Bool) -> Never {
    if json {
        printDevJSON([
            "status": "error",
            "authority": "gh_cli",
            "command": (["gh"] + command).joined(separator: " "),
            "exit_code": Int(result.exitCode),
            "stdout": result.stdout,
            "stderr": result.stderr,
        ])
    } else {
        devGhWriteProcessOutput(result)
    }
    exit(result.exitCode)
}

private func findExecutable(_ name: String) -> String? {
    let pathValue = ProcessInfo.processInfo.environment["PATH"] ?? ""
    for dir in pathValue.split(separator: ":").map(String.init) {
        let candidate = (dir as NSString).appendingPathComponent(name)
        if FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
    }
    return nil
}

private func devGhRepositoryFullName(options: DevGhOptions, repoRoot: String) -> String? {
    if let repo = options.repo, !repo.isEmpty {
        return repo
    }
    let remote = runGit(["remote", "get-url", "origin"], cwd: repoRoot)
    if remote.status == 0,
       let value = remote.stdoutLines.first,
       let parsed = devGhParseGitHubRemote(value) {
        return parsed
    }
    if let info = devGhRepositoryInfo(repoFullName: nil, repoRoot: repoRoot),
       let nameWithOwner = info["nameWithOwner"] as? String {
        return nameWithOwner
    }
    return nil
}

private func devGhRepositoryInfo(repoFullName: String?, repoRoot: String) -> [String: Any]? {
    var args = ["repo", "view"]
    if let repoFullName, !repoFullName.isEmpty {
        args.append(repoFullName)
    }
    args += ["--json", "nameWithOwner,defaultBranchRef"]
    let result = runGh(args, cwd: repoRoot)
    guard result.exitCode == 0 else { return nil }
    return parseDevGhJSON(result.stdout) as? [String: Any]
}

private func devGhCurrentPRInfo(repoFullName: String?, repoRoot: String) -> [String: Any]? {
    var args = ["pr", "view"]
    devGhAppendRepo(&args, repoFullName: repoFullName)
    args += ["--json", "number,url,headRefName,baseRefName,state"]
    let result = runGh(args, cwd: repoRoot)
    guard result.exitCode == 0 else { return nil }
    return parseDevGhJSON(result.stdout) as? [String: Any]
}

private func devGhResolvePRNumber(_ requested: String?, repoFullName: String?, repoRoot: String, json: Bool = false) -> String {
    if let requested, !requested.isEmpty {
        return requested
    }
    var args = ["pr", "view"]
    devGhAppendRepo(&args, repoFullName: repoFullName)
    args += ["--json", "number,url"]
    let result = runGh(args, cwd: repoRoot)
    guard result.exitCode == 0 else {
        devGhEmitCompositeErrorAndExit(command: args, result: result, json: json)
    }
    guard let payload = parseDevGhJSON(result.stdout) as? [String: Any],
          let number = payload["number"] else {
        exitError("Could not infer current PR number from gh pr view", code: "MISSING_PR")
    }
    return "\(number)"
}

private func devGhAppendRepo(_ args: inout [String], repoFullName: String?) {
    if let repoFullName, !repoFullName.isEmpty {
        args += ["--repo", repoFullName]
    }
}

private func parseDevGhJSON(_ text: String) -> Any? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else {
        return nil
    }
    return try? JSONSerialization.jsonObject(with: data, options: [])
}

private func devGhParseGitHubRemote(_ remote: String) -> String? {
    var value = remote.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasSuffix(".git") {
        value = String(value.dropLast(4))
    }
    if value.hasPrefix("git@github.com:") {
        let tail = String(value.dropFirst("git@github.com:".count))
        return devGhNormalizeRepoTail(tail)
    }
    if let range = value.range(of: "github.com/") {
        let tail = String(value[range.upperBound...])
        return devGhNormalizeRepoTail(tail)
    }
    return nil
}

private func devGhNormalizeRepoTail(_ tail: String) -> String? {
    var clean = tail
    if let query = clean.firstIndex(of: "?") {
        clean = String(clean[..<query])
    }
    if let fragment = clean.firstIndex(of: "#") {
        clean = String(clean[..<fragment])
    }
    let parts = clean.split(separator: "/").map(String.init)
    guard parts.count >= 2 else { return nil }
    return "\(parts[0])/\(parts[1])"
}

private func devGhSplitRepoFullName(_ value: String) -> (owner: String, name: String)? {
    let parts = value.split(separator: "/").map(String.init)
    guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else {
        return nil
    }
    return (parts[0], parts[1])
}

private func devGhResolveUserPath(_ value: String) -> String {
    let expanded = NSString(string: value).expandingTildeInPath
    if expanded.hasPrefix("/") {
        return NSString(string: expanded).standardizingPath
    }
    return NSString(string: (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent(expanded)).standardizingPath
}

private func devGhNullable(_ value: Any?) -> Any {
    value ?? NSNull()
}

private func devString(_ value: Any?) -> String? {
    value as? String
}

private func devStringArray(_ value: Any?) -> [String] {
    value as? [String] ?? []
}

private func devGhSanitizeAuthStatus(_ value: String) -> String {
    value
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("- Token") }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

private func devGhCheckFailed(_ check: [String: Any]) -> Bool {
    let state = (check["state"] as? String ?? "").lowercased()
    let bucket = (check["bucket"] as? String ?? "").lowercased()
    let failed = ["fail", "failure", "failed", "cancelled", "timed_out", "action_required"]
    return failed.contains(state) || failed.contains(bucket)
}

private func devGhActionsRunID(from link: String) -> String? {
    guard let range = link.range(of: #"/actions/runs/[0-9]+"#, options: .regularExpression) else {
        return nil
    }
    return link[range].split(separator: "/").last.map(String.init)
}

private func devGhFlattenReviewThreads(_ raw: [String: Any]) -> [[String: Any]] {
    let data = raw["data"] as? [String: Any] ?? [:]
    let repository = data["repository"] as? [String: Any] ?? [:]
    let pullRequest = repository["pullRequest"] as? [String: Any] ?? [:]
    let reviewThreads = pullRequest["reviewThreads"] as? [String: Any] ?? [:]
    let nodes = reviewThreads["nodes"] as? [[String: Any]] ?? []
    return nodes.map { node in
        let commentsNode = node["comments"] as? [String: Any] ?? [:]
        let comments = (commentsNode["nodes"] as? [[String: Any]] ?? []).map { comment -> [String: Any] in
            let author = comment["author"] as? [String: Any] ?? [:]
            return [
                "id": devGhNullable(comment["id"]),
                "url": devGhNullable(comment["url"]),
                "body": devGhNullable(comment["body"]),
                "created_at": devGhNullable(comment["createdAt"]),
                "author": devGhNullable(author["login"]),
            ]
        }
        return [
            "is_resolved": node["isResolved"] as? Bool ?? false,
            "is_outdated": node["isOutdated"] as? Bool ?? false,
            "path": devGhNullable(node["path"]),
            "line": devGhNullable(node["line"]),
            "start_line": devGhNullable(node["startLine"]),
            "comments": comments,
        ]
    }
}

private func devGhOneLine(_ value: String, limit: Int) -> String {
    let collapsed = value
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\t", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return devGhTruncate(collapsed, limit: limit)
}

private func devGhTruncate(_ value: String, limit: Int) -> String {
    if value.count <= limit {
        return value
    }
    return String(value.prefix(max(0, limit - 3))) + "..."
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
