// dev.swift — developer workflow commands for the repo-mode aos control surface

import Foundation

func devCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") || args.isEmpty {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    let sub = args[0]
    let subArgs = Array(args.dropFirst())
    switch sub {
    case "build":
        devBuildCommand(args: subArgs)
    case "classify":
        devClassifyCommand(args: subArgs)
    case "recommend":
        devRecommendCommand(args: subArgs)
    case "surface":
        devSurfaceCommand(args: subArgs)
    default:
        exitError("Unknown dev subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

private struct DevWorkflowManifest: Decodable {
    let id: String
    let version: Int
    let summary: String
    let default_entry_path: String
    let rules: [DevWorkflowRule]
}

private struct DevWorkflowRule: Decodable {
    let id: String
    let summary: String
    let match: DevWorkflowMatch
    let entry_path: String
    let risk_flags: [String]?
    let actions: [DevWorkflowAction]
    let verification: [DevWorkflowVerification]?
    let human_handoff: DevWorkflowHumanHandoff?
    let control_surface: DevWorkflowControlSurface?
}

private struct DevWorkflowMatch: Decodable {
    let paths: [String]
    let commands: [String]?
}

private struct DevWorkflowAction: Decodable {
    let id: String
    let kind: String
    let command: [String]?
    let requires: [String]?
    let required_capabilities: [CapabilityRequirement]?
    let mutates_runtime: Bool?
    let reason: String
}

private struct DevWorkflowVerification: Decodable {
    let id: String
    let command: [String]
    let when: String
}

private struct DevWorkflowHumanHandoff: Decodable {
    let condition: String
    let instruction: String
    let resume_command: [String]
}

private struct DevWorkflowControlSurface: Decodable {
    let preferred: String
    let fallback: String?
    let ui_projection: String?
}

private struct DevClassifyOptions {
    var asJSON = false
    var manifestPath: String?
    var explicitPaths: [String] = []
}

private struct DevSurfaceOptions {
    var asJSON = false
    var id = "aos-dev-command-surface"
    var at = "80,80,560,680"
    var ttl: String?
    var workflow = DevClassifyOptions(asJSON: true, manifestPath: nil, explicitPaths: [])
}

private struct DevWorkflowClassification {
    let manifest: DevWorkflowManifest
    let manifestPath: String
    let changedPaths: [String]
    let matches: [DevMatchedWorkflowRule]
    let unmatchedPaths: [String]
}

private func devSurfaceCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    let options = devParseSurfaceOptions(args)

    do {
        let classification = try devBuildWorkflowClassification(options: options.workflow)
        let recommendation = devRecommendResponse(classification)
        let result = devLaunchCommandSurface(options: options, recommendation: recommendation)
        let ok = (result["status"] as? String) == "ok"
        if options.asJSON {
            devEmitJSONObject(result)
        } else {
            devEmitSurfaceText(result)
        }
        exit(ok ? 0 : 1)
    } catch {
        exitError("Could not open dev command surface: \(error.localizedDescription)", code: "DEV_SURFACE_FAILED")
    }
}

private func devParseSurfaceOptions(_ args: [String]) -> DevSurfaceOptions {
    var options = DevSurfaceOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.asJSON = true
        case "--id":
            i += 1
            guard i < args.count else { exitError("--id requires a value", code: "MISSING_ARG") }
            options.id = args[i]
        case "--at":
            i += 1
            guard i < args.count else { exitError("--at requires x,y,w,h", code: "MISSING_ARG") }
            options.at = args[i]
        case "--ttl":
            i += 1
            guard i < args.count else { exitError("--ttl requires a duration", code: "MISSING_ARG") }
            options.ttl = args[i]
        case "--manifest":
            i += 1
            guard i < args.count else { exitError("--manifest requires a path", code: "MISSING_ARG") }
            options.workflow.manifestPath = args[i]
        case "--paths":
            i += 1
            guard i < args.count else {
                exitError("--paths requires a comma-separated path list", code: "MISSING_ARG")
            }
            options.workflow.explicitPaths.append(contentsOf: args[i].split(separator: ",").map(String.init).filter { !$0.isEmpty })
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev surface option: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.workflow.explicitPaths.append(arg)
        }
        i += 1
    }
    return options
}

private func devClassifyCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    do {
        let options = devParseWorkflowOptions(args, subcommand: "classify")
        let classification = try devBuildWorkflowClassification(options: options)
        let response = devClassifyResponse(classification)
        if options.asJSON {
            devEmitJSONObject(response)
        } else {
            devEmitClassifyText(response)
        }
    } catch {
        exitError("Could not load dev workflow rules: \(error.localizedDescription)", code: "DEV_WORKFLOW_RULES_INVALID")
    }
}

private func devRecommendCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    do {
        let options = devParseWorkflowOptions(args, subcommand: "recommend")
        let classification = try devBuildWorkflowClassification(options: options)
        let response = devRecommendResponse(classification)
        if options.asJSON {
            devEmitJSONObject(response)
        } else {
            devEmitRecommendText(response)
        }
    } catch {
        exitError("Could not load dev workflow rules: \(error.localizedDescription)", code: "DEV_WORKFLOW_RULES_INVALID")
    }
}

private func devBuildWorkflowClassification(options: DevClassifyOptions) throws -> DevWorkflowClassification {
    let repoRoot = findAgentOSRepoRoot()
    let manifestPath = options.manifestPath ?? (repoRoot as NSString).appendingPathComponent("docs/reference/aos-dev-workflow-rules.json")
    let manifest = try devLoadWorkflowManifest(path: manifestPath)
    let changedPaths = options.explicitPaths.isEmpty ? devGitChangedPaths(repoRoot: repoRoot) : options.explicitPaths
    let normalizedPaths = Array(Set(changedPaths.map { devNormalizeRepoPath($0, repoRoot: repoRoot) })).sorted()
    let matchedRules = devMatchedWorkflowRules(manifest.rules, paths: normalizedPaths)
    let matchedPathSet = Set(matchedRules.flatMap { $0.matchedPaths })
    let unmatchedPaths = normalizedPaths.filter { !matchedPathSet.contains($0) }
    return DevWorkflowClassification(
        manifest: manifest,
        manifestPath: devNormalizeRepoPath(manifestPath, repoRoot: repoRoot),
        changedPaths: normalizedPaths,
        matches: matchedRules,
        unmatchedPaths: unmatchedPaths
    )
}

private func devParseWorkflowOptions(_ args: [String], subcommand: String) -> DevClassifyOptions {
    var options = DevClassifyOptions()
    var i = 0
    while i < args.count {
        let arg = args[i]
        switch arg {
        case "--json":
            options.asJSON = true
        case "--manifest":
            i += 1
            guard i < args.count else {
                exitError("--manifest requires a path", code: "MISSING_ARG")
            }
            options.manifestPath = args[i]
        case "--paths":
            i += 1
            guard i < args.count else {
                exitError("--paths requires a comma-separated path list", code: "MISSING_ARG")
            }
            options.explicitPaths.append(contentsOf: args[i].split(separator: ",").map(String.init).filter { !$0.isEmpty })
        default:
            if arg.hasPrefix("--") {
                exitError("Unknown dev \(subcommand) option: \(arg)", code: "UNKNOWN_FLAG")
            }
            options.explicitPaths.append(arg)
        }
        i += 1
    }
    return options
}

private func devLoadWorkflowManifest(path: String) throws -> DevWorkflowManifest {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    let decoder = JSONDecoder()
    return try decoder.decode(DevWorkflowManifest.self, from: data)
}

private func devGitChangedPaths(repoRoot: String) -> [String] {
    let result = runProcess("/usr/bin/git", arguments: ["-C", repoRoot, "status", "--porcelain=v1"])
    guard result.exitCode == 0 else { return [] }

    var paths: [String] = []
    for rawLine in result.stdout.split(separator: "\n", omittingEmptySubsequences: true) {
        let line = String(rawLine)
        guard line.count >= 4 else { continue }
        let status = String(line.prefix(2))
        let pathPart = String(line.dropFirst(3))
        if status.hasPrefix("R") || status.hasPrefix("C") {
            if let newPath = pathPart.components(separatedBy: " -> ").last, !newPath.isEmpty {
                paths.append(newPath)
            }
        } else {
            paths.append(pathPart)
        }
    }
    return paths
}

private struct DevMatchedWorkflowRule {
    let rule: DevWorkflowRule
    let matchedPaths: [String]
    let matchedPatterns: [String]
}

private func devMatchedWorkflowRules(_ rules: [DevWorkflowRule], paths: [String]) -> [DevMatchedWorkflowRule] {
    rules.compactMap { rule in
        var matchedPaths: Set<String> = []
        var matchedPatterns: Set<String> = []
        for pattern in rule.match.paths {
            for path in paths where devGlob(pattern, matches: path) {
                matchedPaths.insert(path)
                matchedPatterns.insert(pattern)
            }
        }
        guard !matchedPaths.isEmpty else { return nil }
        return DevMatchedWorkflowRule(
            rule: rule,
            matchedPaths: Array(matchedPaths).sorted(),
            matchedPatterns: Array(matchedPatterns).sorted()
        )
    }
}

private func devClassifyResponse(
    _ classification: DevWorkflowClassification
) -> [String: Any] {
    [
        "status": "ok",
        "manifest": [
            "id": classification.manifest.id,
            "version": classification.manifest.version,
            "path": classification.manifestPath,
            "summary": classification.manifest.summary
        ],
        "default_entry_path": classification.manifest.default_entry_path,
        "changed_paths": classification.changedPaths,
        "unmatched_paths": classification.unmatchedPaths,
        "matches": classification.matches.map { match in
            var json: [String: Any] = [
                "id": match.rule.id,
                "summary": match.rule.summary,
                "entry_path": match.rule.entry_path,
                "matched_paths": match.matchedPaths,
                "matched_patterns": match.matchedPatterns,
                "risk_flags": match.rule.risk_flags ?? [],
                "actions": match.rule.actions.map { devWorkflowActionJSON($0) },
                "verification": (match.rule.verification ?? []).map(devWorkflowVerificationJSON)
            ]
            if let handoff = match.rule.human_handoff {
                json["human_handoff"] = devWorkflowHumanHandoffJSON(handoff)
            }
            if let surface = match.rule.control_surface {
                json["control_surface"] = devWorkflowControlSurfaceJSON(surface)
            }
            return json
        },
        "recommended_actions": devRecommendedActions(classification.matches),
        "next": classification.matches.isEmpty
            ? "No workflow rules matched. Use the narrowest relevant entry path and update the manifest if this should be deterministic."
            : "Run the matched actions in dependency order using the preferred control surface."
    ]
}

private func devRecommendResponse(_ classification: DevWorkflowClassification) -> [String: Any] {
    let plan = devRecommendedPlan(classification.matches)
    var response: [String: Any] = [
        "status": "ok",
        "manifest": [
            "id": classification.manifest.id,
            "version": classification.manifest.version,
            "path": classification.manifestPath,
            "summary": classification.manifest.summary
        ],
        "default_entry_path": classification.manifest.default_entry_path,
        "changed_paths": classification.changedPaths,
        "unmatched_paths": classification.unmatchedPaths,
        "operating_paths": Array(Set(classification.matches.map { $0.rule.entry_path })).sorted(),
        "matched_rules": classification.matches.map { $0.rule.id },
        "steps": plan.steps,
        "collapsed_actions": plan.collapsedActions,
        "verification": plan.verification,
        "human_handoffs": plan.humanHandoffs,
        "next": plan.steps.isEmpty
            ? "No deterministic workflow recommendation matched. Use the narrowest relevant entry path and update the manifest if this should be repeatable."
            : "Run step_001, then continue in order unless a human handoff condition is hit."
    ]
    if let firstStep = plan.steps.first {
        response["next_step"] = firstStep
    }
    return response
}

private func devWorkflowActionJSON(
    _ action: DevWorkflowAction,
    omittedRequires: Set<String> = []
) -> [String: Any] {
    let requires = (action.requires ?? []).filter { !omittedRequires.contains($0) }
    var json: [String: Any] = [
        "id": action.id,
        "kind": action.kind,
        "requires": requires,
        "mutates_runtime": action.mutates_runtime ?? false,
        "reason": action.reason
    ]
    if let command = action.command {
        json["command"] = command
    }
    if let requiredCapabilities = action.required_capabilities, !requiredCapabilities.isEmpty {
        json["required_capabilities"] = requiredCapabilities.map { $0.toJSON() }
    }
    return json
}

private func devWorkflowVerificationJSON(_ verification: DevWorkflowVerification) -> [String: Any] {
    [
        "id": verification.id,
        "command": verification.command,
        "when": verification.when
    ]
}

private func devWorkflowHumanHandoffJSON(_ handoff: DevWorkflowHumanHandoff) -> [String: Any] {
    [
        "condition": handoff.condition,
        "instruction": handoff.instruction,
        "resume_command": handoff.resume_command
    ]
}

private func devWorkflowControlSurfaceJSON(_ surface: DevWorkflowControlSurface) -> [String: Any] {
    var json: [String: Any] = ["preferred": surface.preferred]
    if let fallback = surface.fallback {
        json["fallback"] = fallback
    }
    if let uiProjection = surface.ui_projection {
        json["ui_projection"] = uiProjection
    }
    return json
}

private func devRecommendedActions(_ matches: [DevMatchedWorkflowRule]) -> [[String: Any]] {
    var seen: Set<String> = []
    var actions: [[String: Any]] = []
    for match in matches {
        for action in match.rule.actions {
            let key = "\(action.kind):\((action.command ?? [action.id]).joined(separator: " "))"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            var json = devWorkflowActionJSON(action)
            json["source_rule"] = match.rule.id
            actions.append(json)
        }
    }
    return actions
}

private struct DevRecommendedPlan {
    let steps: [[String: Any]]
    let collapsedActions: [[String: Any]]
    let verification: [[String: Any]]
    let humanHandoffs: [[String: Any]]
}

private struct DevPlanAction {
    let action: DevWorkflowAction
    var sourceRules: Set<String>
}

private func devRecommendedPlan(_ matches: [DevMatchedWorkflowRule]) -> DevRecommendedPlan {
    var actionsByKey: [String: DevPlanAction] = [:]
    var actionOrder: [String] = []
    var verificationByKey: [String: [String: Any]] = [:]
    var verificationOrder: [String] = []
    var handoffByKey: [String: [String: Any]] = [:]
    var handoffOrder: [String] = []

    for match in matches {
        for action in match.rule.actions where action.kind != "classify_only" {
            let key = devPlanActionKey(action)
            if var existing = actionsByKey[key] {
                existing.sourceRules.insert(match.rule.id)
                if devActionSpecificity(action) > devActionSpecificity(existing.action) {
                    existing = DevPlanAction(action: action, sourceRules: existing.sourceRules)
                }
                actionsByKey[key] = existing
            } else {
                actionsByKey[key] = DevPlanAction(action: action, sourceRules: [match.rule.id])
                actionOrder.append(key)
            }
        }

        for verification in match.rule.verification ?? [] {
            let key = verification.command.joined(separator: "\u{1f}") + ":\(verification.id)"
            if verificationByKey[key] == nil {
                var json = devWorkflowVerificationJSON(verification)
                json["source_rules"] = [match.rule.id]
                verificationByKey[key] = json
                verificationOrder.append(key)
            } else if var json = verificationByKey[key],
                      var sourceRules = json["source_rules"] as? [String],
                      !sourceRules.contains(match.rule.id) {
                sourceRules.append(match.rule.id)
                json["source_rules"] = sourceRules.sorted()
                verificationByKey[key] = json
            }
        }

        if let handoff = match.rule.human_handoff {
            let key = handoff.condition + ":" + handoff.resume_command.joined(separator: "\u{1f}")
            if handoffByKey[key] == nil {
                var json = devWorkflowHumanHandoffJSON(handoff)
                json["source_rules"] = [match.rule.id]
                handoffByKey[key] = json
                handoffOrder.append(key)
            } else if var json = handoffByKey[key],
                      var sourceRules = json["source_rules"] as? [String],
                      !sourceRules.contains(match.rule.id) {
                sourceRules.append(match.rule.id)
                json["source_rules"] = sourceRules.sorted()
                handoffByKey[key] = json
            }
        }
    }

    let collapseMap = devReadyCheckCollapseMap(actionsByKey: actionsByKey, actionOrder: actionOrder)
    let collapsedReadyIDs = Set(collapseMap.keys.compactMap { actionsByKey[$0]?.action.id })

    let orderedKeys = actionOrder.filter { collapseMap[$0] == nil }.sorted { lhs, rhs in
        let left = actionsByKey[lhs]?.action
        let right = actionsByKey[rhs]?.action
        let leftRank = devActionKindRank(left?.kind ?? "")
        let rightRank = devActionKindRank(right?.kind ?? "")
        if leftRank != rightRank { return leftRank < rightRank }
        return actionOrder.firstIndex(of: lhs)! < actionOrder.firstIndex(of: rhs)!
    }

    let steps = orderedKeys.enumerated().compactMap { index, key -> [String: Any]? in
        guard let planAction = actionsByKey[key] else { return nil }
        var json = devWorkflowActionJSON(planAction.action, omittedRequires: collapsedReadyIDs)
        json["step_id"] = String(format: "step_%03d", index + 1)
        json["source_rules"] = Array(planAction.sourceRules).sorted()
        return json
    }

    let collapsedActions = actionOrder.compactMap { key -> [String: Any]? in
        guard let coveringKey = collapseMap[key],
              let planAction = actionsByKey[key],
              let coveringAction = actionsByKey[coveringKey]?.action else { return nil }
        var json = devWorkflowActionJSON(planAction.action)
        json["source_rules"] = Array(planAction.sourceRules).sorted()
        json["collapse_reason"] = "Covered by command-level capability preflight."
        if let command = coveringAction.command {
            json["covered_by_command"] = command
        }
        return json
    }

    return DevRecommendedPlan(
        steps: steps,
        collapsedActions: collapsedActions,
        verification: verificationOrder.compactMap { verificationByKey[$0] },
        humanHandoffs: handoffOrder.compactMap { handoffByKey[$0] }
    )
}

private func devReadyCheckCollapseMap(
    actionsByKey: [String: DevPlanAction],
    actionOrder: [String]
) -> [String: String] {
    var collapsed: [String: String] = [:]
    for readyKey in actionOrder {
        guard let readyAction = actionsByKey[readyKey]?.action,
              readyAction.kind == "ready_check",
              let needed = readyAction.required_capabilities,
              !needed.isEmpty else { continue }
        for candidateKey in actionOrder where candidateKey != readyKey {
            guard let candidate = actionsByKey[candidateKey]?.action,
                  candidate.kind != "ready_check" else { continue }
            let available = devActionRequiredCapabilities(candidate)
            if devCapabilities(available, cover: needed) {
                collapsed[readyKey] = candidateKey
                break
            }
        }
    }
    return collapsed
}

private func devActionRequiredCapabilities(_ action: DevWorkflowAction) -> [CapabilityRequirement] {
    if let requiredCapabilities = action.required_capabilities, !requiredCapabilities.isEmpty {
        return requiredCapabilities
    }
    guard let command = action.command else { return [] }
    return devCommandRequiredCapabilities(command)
}

private func devCommandRequiredCapabilities(_ command: [String]) -> [CapabilityRequirement] {
    guard command.count >= 2 else { return [] }
    let binary = command[0]
    guard binary == "aos" || binary == "./aos" || binary.hasSuffix("/aos") else { return [] }

    let args = Array(command.dropFirst())
    guard !args.isEmpty else { return [] }
    let positionalPrefix = args.prefix { !$0.hasPrefix("-") }
    guard !positionalPrefix.isEmpty else { return [] }

    let maxPathLength = positionalPrefix.count
    for length in stride(from: maxPathLength, through: 1, by: -1) {
        let path = Array(positionalPrefix.prefix(length))
        if let command = findCommand(path: path), command.forms.count == 1 {
            return command.forms[0].execution.requiredCapabilities
        }
    }
    return []
}

private struct DevCapabilityKey: Hashable {
    let id: String
    let scope: String
    let when: String
}

private func devCapabilities(
    _ available: [CapabilityRequirement],
    cover needed: [CapabilityRequirement]
) -> Bool {
    let availableKeys = Set(available.map(devCapabilityKey))
    let neededKeys = Set(needed.map(devCapabilityKey))
    return !neededKeys.isEmpty && neededKeys.isSubset(of: availableKeys)
}

private func devCapabilityKey(_ capability: CapabilityRequirement) -> DevCapabilityKey {
    DevCapabilityKey(
        id: capability.id,
        scope: capability.scope ?? devDefaultCapabilityScope(capability.id),
        when: capability.when ?? ""
    )
}

private func devDefaultCapabilityScope(_ capability: String) -> String {
    switch capability {
    case "runtime.daemon", "perception.ax", "action.input":
        return "daemon"
    case "projection.canvas":
        return "canvas"
    case "perception.screen":
        return "screen"
    case "browser.adapter":
        return "target.session"
    default:
        return capability
    }
}

private func devPlanActionKey(_ action: DevWorkflowAction) -> String {
    if action.kind == "build", let command = action.command, command.count >= 3,
       command[0] == "./aos", command[1] == "dev", command[2] == "build" {
        return "build:./aos dev build"
    }
    if action.kind == "ready_check" {
        return "ready_check:\((action.command ?? ["ready"]).joined(separator: " "))"
    }
    if let command = action.command {
        return "\(action.kind):\(command.joined(separator: " "))"
    }
    return "\(action.kind):\(action.id)"
}

private func devActionSpecificity(_ action: DevWorkflowAction) -> Int {
    var score = action.command?.count ?? 0
    if action.command?.contains("--json") == true { score += 10 }
    return score
}

private func devActionKindRank(_ kind: String) -> Int {
    switch kind {
    case "build": return 10
    case "test": return 20
    case "ready_check": return 30
    case "reload_canvas": return 40
    case "restart_daemon": return 50
    case "human_handoff": return 60
    default: return 90
    }
}

private func devEmitJSONObject(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
          let text = String(data: data, encoding: .utf8) else {
        exitError("Could not serialize dev classify response", code: "JSON_SERIALIZATION_FAILED")
    }
    print(text)
}

private func devEmitClassifyText(_ response: [String: Any]) {
    let paths = response["changed_paths"] as? [String] ?? []
    let matches = response["matches"] as? [[String: Any]] ?? []
    print("AOS dev workflow classification")
    print("Changed paths: \(paths.count)")
    if matches.isEmpty {
        print("Matched rules: 0")
        if let next = response["next"] as? String { print("Next: \(next)") }
        return
    }
    print("Matched rules:")
    for match in matches {
        let id = match["id"] as? String ?? "unknown"
        let entryPath = match["entry_path"] as? String ?? "agent/dev"
        let summary = match["summary"] as? String ?? ""
        print("- \(id) (\(entryPath)): \(summary)")
        if let actions = match["actions"] as? [[String: Any]], !actions.isEmpty {
            let commands = actions.compactMap { action -> String? in
                guard let command = action["command"] as? [String] else { return action["kind"] as? String }
                return command.joined(separator: " ")
            }
            print("  actions: \(commands.joined(separator: " | "))")
        }
    }
}

private func devEmitRecommendText(_ response: [String: Any]) {
    let paths = response["changed_paths"] as? [String] ?? []
    let steps = response["steps"] as? [[String: Any]] ?? []
    print("AOS dev workflow recommendation")
    print("Changed paths: \(paths.count)")
    if steps.isEmpty {
        print("Steps: 0")
        if let next = response["next"] as? String { print("Next: \(next)") }
        return
    }
    print("Steps:")
    for step in steps {
        let stepID = step["step_id"] as? String ?? "step"
        let kind = step["kind"] as? String ?? "action"
        let command = (step["command"] as? [String])?.joined(separator: " ") ?? kind
        print("- \(stepID): \(command)")
    }
    if let handoffs = response["human_handoffs"] as? [[String: Any]], !handoffs.isEmpty {
        print("Human handoff conditions: \(handoffs.count)")
    }
}

private func devLaunchCommandSurface(options: DevSurfaceOptions, recommendation: [String: Any]) -> [String: Any] {
    let repoRoot = findAgentOSRepoRoot()
    let toolkitRoot = (repoRoot as NSString).appendingPathComponent("packages/toolkit")
    let canvasURL = "aos://toolkit/components/command-surface/index.html"
    var steps: [[String: Any]] = []

    func run(_ id: String, _ arguments: [String]) -> ProcessOutput {
        let output = runProcess(aosExecutablePath(), arguments: arguments)
        steps.append(devSurfaceStepResult(id: id, arguments: arguments, output: output))
        return output
    }

    let setRoot = run("set-toolkit-root", ["set", "content.roots.toolkit", toolkitRoot])
    if setRoot.exitCode != 0 {
        return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Failed to set toolkit content root.")
    }

    let contentWait = run("content-wait", ["content", "wait", "--root", "toolkit", "--auto-start", "--json"])
    if contentWait.exitCode != 0 {
        return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Toolkit content root did not become ready.")
    }

    let exists = run("show-exists", ["show", "exists", "--id", options.id])
    let canvasExists = devSurfaceCanvasExists(exists.stdout)
    var showArgs: [String]
    if canvasExists {
        showArgs = [
            "show", "update",
            "--id", options.id,
            "--at", options.at,
            "--url", canvasURL,
            "--window-level", "floating",
            "--focus"
        ]
        if let ttl = options.ttl {
            showArgs += ["--ttl", ttl]
        }
        let update = run("show-update", showArgs)
        if update.exitCode != 0 {
            return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Failed to update command-surface canvas.")
        }
    } else {
        showArgs = [
            "show", "create",
            "--id", options.id,
            "--at", options.at,
            "--url", canvasURL,
            "--interactive",
            "--scope", "global",
            "--window-level", "floating",
            "--focus"
        ]
        if let ttl = options.ttl {
            showArgs += ["--ttl", ttl]
        }
        let create = run("show-create", showArgs)
        if create.exitCode != 0 {
            return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Failed to create command-surface canvas.")
        }
    }

    let wait = run("show-wait", ["show", "wait", "--id", options.id, "--manifest", "command-surface", "--timeout", "5s", "--json"])
    if wait.exitCode != 0 {
        return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Command-surface canvas did not become ready.")
    }

    guard let event = devSurfaceRecommendationEvent(recommendation) else {
        return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Could not serialize command-surface recommendation event.")
    }
    let post = run("show-post", ["show", "post", "--id", options.id, "--event", event])
    if post.exitCode != 0 {
        return devSurfaceResult(status: "failed", canvasID: options.id, steps: steps, recommendation: recommendation, error: "Failed to post recommendation to command-surface canvas.")
    }

    return devSurfaceResult(status: "ok", canvasID: options.id, steps: steps, recommendation: recommendation, error: nil)
}

private func devSurfaceStepResult(id: String, arguments: [String], output: ProcessOutput) -> [String: Any] {
    var result: [String: Any] = [
        "id": id,
        "command": ([aosInvocationDisplayName()] + arguments).joined(separator: " "),
        "exit_code": Int(output.exitCode)
    ]
    if let parsed = devParseJSON(output.stdout) {
        result["stdout_json"] = parsed
    } else if !output.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        result["stdout"] = output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if !output.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        result["stderr"] = output.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return result
}

private func devSurfaceResult(status: String, canvasID: String, steps: [[String: Any]], recommendation: [String: Any], error: String?) -> [String: Any] {
    var result: [String: Any] = [
        "status": status,
        "canvas_id": canvasID,
        "url": "aos://toolkit/components/command-surface/index.html",
        "steps": steps,
        "recommendation": recommendation
    ]
    if let error {
        result["error"] = error
    }
    return result
}

private func devSurfaceCanvasExists(_ stdout: String) -> Bool {
    guard let json = devParseJSON(stdout) as? [String: Any] else { return false }
    return json["exists"] as? Bool == true
}

private func devSurfaceRecommendationEvent(_ recommendation: [String: Any]) -> String? {
    let event: [String: Any] = [
        "type": "command-surface/recommendation",
        "payload": recommendation
    ]
    guard JSONSerialization.isValidJSONObject(event),
          let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else {
        return nil
    }
    return String(data: data, encoding: .utf8)
}

private func devParseJSON(_ text: String) -> Any? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data, options: [])
}

private func devEmitSurfaceText(_ response: [String: Any]) {
    let status = response["status"] as? String ?? "unknown"
    let canvasID = response["canvas_id"] as? String ?? "aos-dev-command-surface"
    print("AOS dev command surface: \(status)")
    print("Canvas: \(canvasID)")
    if let recommendation = response["recommendation"] as? [String: Any],
       let steps = recommendation["steps"] as? [[String: Any]] {
        print("Recommended steps: \(steps.count)")
    }
    if let error = response["error"] as? String {
        print("Error: \(error)")
    }
}

private func devNormalizeRepoPath(_ path: String, repoRoot: String = findAgentOSRepoRoot()) -> String {
    let standardized = NSString(string: path).standardizingPath
    let root = NSString(string: repoRoot).standardizingPath
    if standardized == root { return "." }
    let prefix = root.hasSuffix("/") ? root : "\(root)/"
    if standardized.hasPrefix(prefix) {
        return String(standardized.dropFirst(prefix.count))
    }
    return path.hasPrefix("./") ? String(path.dropFirst(2)) : path
}

private func devGlob(_ pattern: String, matches path: String) -> Bool {
    let regexPattern = "^" + devGlobToRegex(pattern) + "$"
    return path.range(of: regexPattern, options: .regularExpression) != nil
}

private func devGlobToRegex(_ pattern: String) -> String {
    var out = ""
    let chars = Array(pattern)
    var i = 0
    while i < chars.count {
        let ch = chars[i]
        if ch == "*" {
            let next = i + 1 < chars.count ? chars[i + 1] : nil
            let afterNext = i + 2 < chars.count ? chars[i + 2] : nil
            if next == "*" && afterNext == "/" {
                out += "(?:.*/)?"
                i += 3
                continue
            }
            if next == "*" {
                out += ".*"
                i += 2
                continue
            }
            out += "[^/]*"
        } else if ch == "?" {
            out += "[^/]"
        } else {
            out += NSRegularExpression.escapedPattern(for: String(ch))
        }
        i += 1
    }
    return out
}

private func devBuildCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["dev"], json: args.contains("--json"))
        exit(0)
    }

    let asJSON = args.contains("--json")
    var buildArgs: [String] = []
    var passthroughArgs: [String] = []

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--json":
            break
        case "--release", "--force", "--no-restart", "--no-sign":
            buildArgs.append(args[i])
        case "--":
            passthroughArgs.append(contentsOf: args.dropFirst(i + 1))
            i = args.count
            continue
        default:
            exitError("Unknown dev build option: \(args[i])", code: "UNKNOWN_FLAG")
        }
        i += 1
    }
    buildArgs.append(contentsOf: passthroughArgs)

    let repoRoot = findAgentOSRepoRoot()
    let script = "\(repoRoot)/build.sh"
    guard FileManager.default.fileExists(atPath: script) else {
        exitError("build.sh not found at \(script)", code: "BUILD_SCRIPT_MISSING")
    }

    let signingBefore = codesignSummary(path: aosExecutablePath())
    let result = runProcess("/bin/bash", arguments: [script] + buildArgs)
    let signingAfter = codesignSummary(path: aosExecutablePath())

    if asJSON {
        let response: [String: Any] = [
            "status": result.exitCode == 0 ? "ok" : "failed",
            "command": ([script] + buildArgs).joined(separator: " "),
            "exit_code": result.exitCode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "signing_before": signingBefore.json,
            "signing_after": signingAfter.json,
            "permission_note": devBuildPermissionNote(signingBefore: signingBefore, signingAfter: signingAfter)
        ]
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        } else {
            print("{\"status\":\"\(result.exitCode == 0 ? "ok" : "failed")\"}")
        }
        exit(result.exitCode == 0 ? 0 : 1)
    }

    if !result.stdout.isEmpty { print(result.stdout, terminator: result.stdout.hasSuffix("\n") ? "" : "\n") }
    if !result.stderr.isEmpty { fputs(result.stderr, stderr) }

    if result.exitCode == 0 {
        let note = devBuildPermissionNote(signingBefore: signingBefore, signingAfter: signingAfter)
        print("")
        print("Dev build complete.")
        print("Signing: \(signingAfter.display)")
        if !note.isEmpty { print(note) }
        print("Next: ./aos ready")
    }

    exit(result.exitCode == 0 ? 0 : 1)
}

private struct CodeSignSummary {
    let identity: String?
    let teamIdentifier: String?
    let signed: Bool

    var display: String {
        if let identity, !identity.isEmpty {
            if let teamIdentifier, !teamIdentifier.isEmpty {
                return "\(identity) team=\(teamIdentifier)"
            }
            return identity
        }
        return signed ? "signed" : "unsigned"
    }

    var json: [String: Any] {
        [
            "identity": identity as Any,
            "team_identifier": teamIdentifier as Any,
            "signed": signed
        ]
    }
}

private func codesignSummary(path: String) -> CodeSignSummary {
    let result = runProcess("/usr/bin/codesign", arguments: ["-d", "--verbose=4", path])
    let output = result.stderr + result.stdout
    let signature = devFirstCodesignField("Signature", in: output)
    let authority = devFirstCodesignField("Authority", in: output)
    let team = devFirstCodesignField("TeamIdentifier", in: output)
    let identity = authority ?? signature
    return CodeSignSummary(
        identity: identity,
        teamIdentifier: team == "not set" ? nil : team,
        signed: result.exitCode == 0 && (identity != nil || (team != nil && team != "not set"))
    )
}

private func devFirstCodesignField(_ key: String, in output: String) -> String? {
    let prefix = "\(key)="
    for line in output.split(separator: "\n") {
        if line.hasPrefix(prefix) {
            return String(line.dropFirst(prefix.count))
        }
    }
    return nil
}

private func devBuildPermissionNote(signingBefore: CodeSignSummary, signingAfter: CodeSignSummary) -> String {
    if signingAfter.identity == nil || signingAfter.identity == "adhoc" {
        return "Permission note: ./aos is not stably signed. Rebuilding may stale macOS Accessibility/Input Monitoring grants for the daemon."
    }
    if signingBefore.identity != signingAfter.identity || signingBefore.teamIdentifier != signingAfter.teamIdentifier {
        return "Permission note: signing identity changed. If readiness reports daemon_tcc_grant_stale_or_missing, remove/re-add the aos rows once, then run ./aos ready --post-permission."
    }
    return "Permission note: signing identity is stable. If readiness fails, use ./aos ready --post-permission after any manual permission refresh."
}
