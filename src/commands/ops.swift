// ops.swift — Source-backed operator recipes.

import Foundation

private struct OpsFailure: Error {
    let message: String
    let code: String
}

private struct OpsRecipe {
    let id: String
    let version: Int
    let summary: String
    let owner: String
    let path: String
    let sourceKind: String
    let manifest: [String: Any]
}

private struct OpsStepPlan {
    let id: String
    let commandPath: [String]
    let formID: String
    let argv: [String]
    let timeoutMs: Int
    let mutates: Bool
    let finally: Bool
    let supportsDelegateDryRun: Bool
    let assertions: [[String: Any]]
}

private enum OpsValueLookupResult {
    case found(Any)
    case missing
}

func opsCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["ops"], json: args.contains("--json"))
        exit(0)
    }

    guard let subcommand = args.first else {
        printCommandHelp(["ops"], json: false)
        exit(0)
    }

    let rest = Array(args.dropFirst())
    let asJSON = rest.contains("--json")
    let unexpectedFlag = rest.first { $0.hasPrefix("--") && $0 != "--json" }
    if let unexpectedFlag {
        exitError("Unknown flag: \(unexpectedFlag)", code: "UNKNOWN_FLAG")
    }
    let positional = rest.filter { $0 != "--json" }

    do {
        switch subcommand {
        case "list":
            guard positional.isEmpty else {
                throw OpsFailure(message: "Usage: \(aosInvocationDisplayName()) ops list [--json]", code: "INVALID_ARG")
            }
            let recipes = try opsLoadRecipes()
            opsEmitList(recipes: recipes, asJSON: asJSON)
        case "explain":
            let id = try opsSingleRecipeID(positional, usage: "ops explain <id> [--json]")
            let recipe = try opsFindRecipe(id)
            let plan = try opsPlan(recipe: recipe)
            opsEmitExplain(recipe: recipe, plan: plan, asJSON: asJSON)
        case "dry-run":
            let id = try opsSingleRecipeID(positional, usage: "ops dry-run <id> [--json]")
            let recipe = try opsFindRecipe(id)
            let plan = try opsPlan(recipe: recipe)
            let result = opsResult(
                status: "dry_run",
                code: "OK",
                error: nil,
                recipe: recipe,
                dryRun: true,
                steps: plan.map { opsStepResult($0, status: "planned", durationMs: nil, observed: nil) },
                mutatedResources: [],
                cleanup: ["status": "not_needed", "steps": []]
            )
            opsEmitJSON(result, toStderr: false)
        case "run":
            let id = try opsSingleRecipeID(positional, usage: "ops run <id> [--json]")
            let recipe = try opsFindRecipe(id)
            let plan = try opsPlan(recipe: recipe)
            try opsRun(recipe: recipe, plan: plan)
        default:
            throw OpsFailure(message: "Unknown ops subcommand: \(subcommand)", code: "UNKNOWN_SUBCOMMAND")
        }
    } catch let failure as OpsFailure {
        opsExitFailure(message: failure.message, code: failure.code)
    } catch {
        opsExitFailure(message: "\(error)", code: "INTERNAL")
    }
}

private func opsSingleRecipeID(_ positional: [String], usage: String) throws -> String {
    guard positional.count == 1, let id = positional.first, !id.isEmpty else {
        throw OpsFailure(message: "Usage: \(aosInvocationDisplayName()) \(usage)", code: "INVALID_ARG")
    }
    return id
}

private func opsFindRecipe(_ id: String) throws -> OpsRecipe {
    let recipes = try opsLoadRecipes()
    guard let recipe = recipes.first(where: { $0.id == id }) else {
        throw OpsFailure(message: "Recipe not found: \(id)", code: "RECIPE_NOT_FOUND")
    }
    return recipe
}

private func opsLoadRecipes() throws -> [OpsRecipe] {
    let env = ProcessInfo.processInfo.environment
    let mode = aosCurrentRuntimeMode()

    let recipes: [OpsRecipe]
    if let indexPath = env["AOS_OPS_RECIPE_INDEX"], !indexPath.isEmpty {
        recipes = try opsLoadRecipeIndex(path: indexPath)
    } else if mode == .installed {
        guard let indexPath = opsBundledRecipeIndexPath(), FileManager.default.fileExists(atPath: indexPath) else {
            throw OpsFailure(
                message: "Installed-mode ops recipe index not found in packaged resources",
                code: "RECIPE_DISCOVERY_FAILED"
            )
        }
        recipes = try opsLoadRecipeIndex(path: indexPath)
    } else {
        recipes = try opsDiscoverSourceRecipes()
    }

    var seen: [String: OpsRecipe] = [:]
    for recipe in recipes {
        if let existing = seen[recipe.id] {
            throw OpsFailure(
                message: "Duplicate ops recipe id '\(recipe.id)' in \(existing.path) and \(recipe.path)",
                code: "DUPLICATE_RECIPE_ID"
            )
        }
        seen[recipe.id] = recipe
    }

    return recipes.sorted { $0.id < $1.id }
}

private func opsDiscoverSourceRecipes() throws -> [OpsRecipe] {
    let env = ProcessInfo.processInfo.environment
    if let override = env["AOS_OPS_RECIPE_ROOTS"], !override.isEmpty {
        let roots = override.split(separator: ":").map(String.init)
        return try roots.flatMap { root in
            try opsLoadRecipeFiles(root: root, owner: root, sourceKind: "fixture")
        }
    }

    guard let repoRoot = aosCurrentRepoRoot() else {
        throw OpsFailure(message: "Could not locate agent-os repo root for ops recipe discovery", code: "RECIPE_DISCOVERY_FAILED")
    }

    var recipes: [OpsRecipe] = []
    let repoRecipes = (repoRoot as NSString).appendingPathComponent("recipes")
    recipes += try opsLoadRecipeFiles(root: repoRecipes, owner: "repo", sourceKind: "repo")

    let toolkitRecipes = (repoRoot as NSString).appendingPathComponent("packages/toolkit/recipes")
    recipes += try opsLoadRecipeFiles(root: toolkitRecipes, owner: "packages/toolkit", sourceKind: "toolkit")

    let appsRoot = (repoRoot as NSString).appendingPathComponent("apps")
    if let appNames = try? FileManager.default.contentsOfDirectory(atPath: appsRoot) {
        for appName in appNames.sorted() {
            let recipeRoot = ((appsRoot as NSString).appendingPathComponent(appName) as NSString).appendingPathComponent("recipes")
            recipes += try opsLoadRecipeFiles(root: recipeRoot, owner: "apps/\(appName)", sourceKind: "app")
        }
    }
    return recipes
}

private func opsLoadRecipeFiles(root: String, owner: String, sourceKind: String) throws -> [OpsRecipe] {
    let fm = FileManager.default
    var isDir: ObjCBool = false
    guard fm.fileExists(atPath: root, isDirectory: &isDir), isDir.boolValue else { return [] }
    guard let enumerator = fm.enumerator(atPath: root) else { return [] }

    var recipes: [OpsRecipe] = []
    for case let relative as String in enumerator {
        guard relative.hasSuffix(".json") else { continue }
        let path = (root as NSString).appendingPathComponent(relative)
        let manifest = try opsReadJSONObject(path: path)
        recipes.append(try opsRecipe(from: manifest, owner: owner, path: path, sourceKind: sourceKind))
    }
    return recipes
}

private func opsBundledRecipeIndexPath() -> String? {
    let executableURL = URL(fileURLWithPath: aosExecutablePath()).standardizedFileURL
    let bundleURL = executableURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let candidate = bundleURL
        .appendingPathComponent("Contents")
        .appendingPathComponent("Resources")
        .appendingPathComponent("agent-os")
        .appendingPathComponent("recipes-index.json")
        .path
    return candidate
}

private func opsLoadRecipeIndex(path: String) throws -> [OpsRecipe] {
    let root = try opsReadJSONObject(path: path)
    guard let entries = root["recipes"] as? [[String: Any]] else {
        throw OpsFailure(message: "Recipe index missing recipes array: \(path)", code: "INVALID_RECIPE_INDEX")
    }
    return try entries.map { entry in
        let manifest = (entry["manifest"] as? [String: Any]) ?? entry
        let owner = entry["owner"] as? String ?? "package"
        let recipePath = entry["path"] as? String ?? path
        let sourceKind = entry["source_kind"] as? String ?? "package"
        return try opsRecipe(from: manifest, owner: owner, path: recipePath, sourceKind: sourceKind)
    }
}

private func opsReadJSONObject(path: String) throws -> [String: Any] {
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw OpsFailure(message: "Expected JSON object at \(path)", code: "INVALID_RECIPE")
        }
        return object
    } catch let failure as OpsFailure {
        throw failure
    } catch {
        throw OpsFailure(message: "Could not read \(path): \(error.localizedDescription)", code: "RECIPE_READ_FAILED")
    }
}

private func opsRecipe(from manifest: [String: Any], owner: String, path: String, sourceKind: String) throws -> OpsRecipe {
    guard let id = manifest["id"] as? String, !id.isEmpty else {
        throw OpsFailure(message: "Recipe missing id: \(path)", code: "INVALID_RECIPE")
    }
    let versionValue = manifest["version"]
    let version = (versionValue as? Int) ?? Int((versionValue as? Double) ?? 0)
    guard version > 0 else {
        throw OpsFailure(message: "Recipe \(id) must declare positive integer version", code: "INVALID_RECIPE")
    }
    let summary = manifest["summary"] as? String ?? ""
    return OpsRecipe(id: id, version: version, summary: summary, owner: owner, path: path, sourceKind: sourceKind, manifest: manifest)
}

private func opsPlan(recipe: OpsRecipe) throws -> [OpsStepPlan] {
    guard let steps = recipe.manifest["steps"] as? [[String: Any]], !steps.isEmpty else {
        throw OpsFailure(message: "Recipe \(recipe.id) must declare at least one step", code: "INVALID_RECIPE")
    }

    var planned: [OpsStepPlan] = []
    for step in steps {
        guard let id = step["id"] as? String, !id.isEmpty else {
            throw OpsFailure(message: "Recipe \(recipe.id) contains a step without id", code: "INVALID_RECIPE")
        }
        guard let command = step["command"] as? [String: Any],
              let path = command["path"] as? [String],
              let formID = command["form_id"] as? String else {
            throw OpsFailure(message: "Step \(id) must use command.path and command.form_id", code: "INVALID_RECIPE")
        }
        guard let form = findCommand(path: path)?.forms.first(where: { $0.id == formID }) else {
            throw OpsFailure(message: "Step \(id) references unknown command form \(path.joined(separator: " "))/\(formID)", code: "UNKNOWN_COMMAND_FORM")
        }

        let argv = step["argv"] as? [String] ?? []
        let timeoutMs = (step["timeout_ms"] as? Int) ?? 5000
        guard timeoutMs > 0 else {
            throw OpsFailure(message: "Step \(id) timeout_ms must be positive", code: "INVALID_RECIPE")
        }
        let stepMutates = (step["mutates"] as? Bool) ?? form.execution.mutatesState
        let assertions = step["assertions"] as? [[String: Any]] ?? []
        try opsValidateAssertions(assertions, stepID: id)

        planned.append(OpsStepPlan(
            id: id,
            commandPath: path,
            formID: formID,
            argv: argv,
            timeoutMs: timeoutMs,
            mutates: stepMutates || form.execution.mutatesState,
            finally: step["finally"] as? Bool ?? false,
            supportsDelegateDryRun: form.execution.supportsDryRun,
            assertions: assertions
        ))
    }
    return planned
}

private func opsValidateAssertions(_ assertions: [[String: Any]], stepID: String) throws {
    for assertion in assertions {
        let hasPath = assertion["path"] is [String]
        let hasSelect = assertion["select"] is [String: Any]
        guard hasPath || hasSelect else {
            throw OpsFailure(message: "Assertion in step \(stepID) must declare path or select", code: "INVALID_RECIPE")
        }
        let operators = ["exists", "not_exists", "equals", "contains"].filter { assertion[$0] != nil }
        guard operators.count == 1 else {
            throw OpsFailure(message: "Assertion in step \(stepID) must declare exactly one operator", code: "INVALID_RECIPE")
        }
    }
}

private func opsRun(recipe: OpsRecipe, plan: [OpsStepPlan]) throws {
    if (recipe.manifest["mutates"] as? Bool) == true || plan.contains(where: { $0.mutates }) {
        let result = opsResult(
            status: "failure",
            code: "MUTATING_RECIPE_UNSUPPORTED",
            error: "ops run currently supports only read-only recipes; \(recipe.id) declares mutating steps.",
            recipe: recipe,
            dryRun: false,
            steps: plan.map { opsStepResult($0, status: "skipped", durationMs: nil, observed: nil) },
            mutatedResources: [],
            cleanup: ["status": "not_needed", "steps": []]
        )
        opsEmitJSON(result, toStderr: true)
        exit(1)
    }

    let runID = UUID().uuidString.lowercased().split(separator: "-").first.map(String.init) ?? "run"
    let resources = opsResolvedResources(recipe: recipe, runID: runID)
    var stepResults: [[String: Any]] = []

    for step in plan {
        let argv = step.argv.map { opsResolveTemplate($0, runID: runID, resources: resources) }
        let started = Date()
        let process = opsRunProcess(aosExecutablePath(), arguments: step.commandPath + argv, timeoutMs: step.timeoutMs)
        let durationMs = Int(Date().timeIntervalSince(started) * 1000)

        var observed: [String: Any] = [
            "exit_code": Int(process.output.exitCode)
        ]
        if !process.output.stderr.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            observed["stderr"] = process.output.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if process.timedOut {
            let stepResult = opsStepResult(step, status: "timeout", durationMs: durationMs, observed: observed)
            stepResults.append(stepResult)
            opsEmitJSON(opsResult(
                status: "failure",
                code: "TIMEOUT",
                error: "Step \(step.id) timed out after \(step.timeoutMs)ms.",
                recipe: recipe,
                dryRun: false,
                steps: stepResults,
                mutatedResources: [],
                cleanup: ["status": "not_needed", "steps": []]
            ), toStderr: true)
            exit(1)
        }
        if process.output.exitCode != 0 {
            let stepResult = opsStepResult(step, status: "failure", durationMs: durationMs, observed: observed)
            stepResults.append(stepResult)
            opsEmitJSON(opsResult(
                status: "failure",
                code: "COMMAND_FAILED",
                error: "Step \(step.id) exited with code \(process.output.exitCode).",
                recipe: recipe,
                dryRun: false,
                steps: stepResults,
                mutatedResources: [],
                cleanup: ["status": "not_needed", "steps": []]
            ), toStderr: true)
            exit(1)
        }

        let parsed = opsParseJSON(process.output.stdout)
        if let parsed {
            observed["stdout_json"] = parsed
        }
        if !step.assertions.isEmpty {
            guard let parsedObject = parsed else {
                let stepResult = opsStepResult(step, status: "failure", durationMs: durationMs, observed: observed)
                stepResults.append(stepResult)
                opsEmitJSON(opsResult(
                    status: "failure",
                    code: "ASSERTION_FAILED",
                    error: "Step \(step.id) produced non-JSON stdout for assertions.",
                    recipe: recipe,
                    dryRun: false,
                    steps: stepResults,
                    mutatedResources: [],
                    cleanup: ["status": "not_needed", "steps": []]
                ), toStderr: true)
                exit(1)
            }
            if let message = opsFirstAssertionFailure(assertions: step.assertions, root: parsedObject, runID: runID, resources: resources) {
                observed["assertion_failure"] = message
                let stepResult = opsStepResult(step, status: "failure", durationMs: durationMs, observed: observed)
                stepResults.append(stepResult)
                opsEmitJSON(opsResult(
                    status: "failure",
                    code: "ASSERTION_FAILED",
                    error: "Step \(step.id) assertion failed: \(message)",
                    recipe: recipe,
                    dryRun: false,
                    steps: stepResults,
                    mutatedResources: [],
                    cleanup: ["status": "not_needed", "steps": []]
                ), toStderr: true)
                exit(1)
            }
        }

        stepResults.append(opsStepResult(step, status: "success", durationMs: durationMs, observed: observed))
    }

    opsEmitJSON(opsResult(
        status: "success",
        code: "OK",
        error: nil,
        recipe: recipe,
        dryRun: false,
        steps: stepResults,
        mutatedResources: [],
        cleanup: ["status": "not_needed", "steps": []]
    ), toStderr: false)
}

private func opsResolvedResources(recipe: OpsRecipe, runID: String) -> [String: String] {
    guard let raw = recipe.manifest["resources"] as? [String: Any] else { return [:] }
    var resources: [String: String] = [:]
    for (key, value) in raw {
        if let text = value as? String {
            resources[key] = opsResolveTemplate(text, runID: runID, resources: resources)
        }
    }
    return resources
}

private func opsResolveTemplate(_ value: String, runID: String, resources: [String: String]) -> String {
    var out = value.replacingOccurrences(of: "${run_id}", with: runID)
    for (key, resourceValue) in resources {
        out = out.replacingOccurrences(of: "${resources.\(key)}", with: resourceValue)
    }
    return out
}

private func opsFirstAssertionFailure(assertions: [[String: Any]], root: Any, runID: String, resources: [String: String]) -> String? {
    for assertion in assertions {
        let target = opsResolveAssertionTarget(assertion, root: root, runID: runID, resources: resources)
        if let exists = assertion["exists"] as? Bool {
            let found = {
                if case .found = target { return true }
                return false
            }()
            if found != exists { return "exists expected \(exists)" }
            continue
        }
        if let notExists = assertion["not_exists"] as? Bool {
            let found = {
                if case .found = target { return true }
                return false
            }()
            if found == notExists { return "not_exists expected \(notExists)" }
            continue
        }
        guard case .found(let actual) = target else {
            return "target missing"
        }
        if let expected = assertion["equals"] {
            let resolvedExpected = opsResolveJSONTemplates(expected, runID: runID, resources: resources)
            if !opsJSONValuesEqual(actual, resolvedExpected) {
                return "equals expected \(resolvedExpected), got \(actual)"
            }
        } else if let expected = assertion["contains"] {
            let resolvedExpected = opsResolveJSONTemplates(expected, runID: runID, resources: resources)
            guard opsJSONContains(actual, resolvedExpected) else {
                return "contains expected \(resolvedExpected), got \(actual)"
            }
        }
    }
    return nil
}

private func opsResolveAssertionTarget(_ assertion: [String: Any], root: Any, runID: String, resources: [String: String]) -> OpsValueLookupResult {
    if let path = assertion["path"] as? [String] {
        return opsValue(at: path, in: root)
    }
    guard let select = assertion["select"] as? [String: Any],
          let path = select["path"] as? [String],
          let whereClause = select["where"] as? [String: Any] else {
        return .missing
    }
    guard case .found(let arrayValue) = opsValue(at: path, in: root),
          let array = arrayValue as? [[String: Any]] else {
        return .missing
    }
    let matches = array.filter { item in
        for (key, expected) in whereClause {
            let resolved = opsResolveJSONTemplates(expected, runID: runID, resources: resources)
            guard let actual = item[key], opsJSONValuesEqual(actual, resolved) else {
                return false
            }
        }
        return true
    }
    guard matches.count == 1, let match = matches.first else {
        return .missing
    }
    if let field = assertion["field"] as? [String] {
        return opsValue(at: field, in: match)
    }
    return .found(match)
}

private func opsValue(at path: [String], in root: Any) -> OpsValueLookupResult {
    var current: Any = root
    for key in path {
        if let dict = current as? [String: Any], let next = dict[key] {
            current = next
        } else {
            return .missing
        }
    }
    return .found(current)
}

private func opsResolveJSONTemplates(_ value: Any, runID: String, resources: [String: String]) -> Any {
    if let text = value as? String {
        return opsResolveTemplate(text, runID: runID, resources: resources)
    }
    if let array = value as? [Any] {
        return array.map { opsResolveJSONTemplates($0, runID: runID, resources: resources) }
    }
    if let object = value as? [String: Any] {
        return object.mapValues { opsResolveJSONTemplates($0, runID: runID, resources: resources) }
    }
    return value
}

private func opsJSONValuesEqual(_ lhs: Any, _ rhs: Any) -> Bool {
    switch (lhs, rhs) {
    case (let l as String, let r as String): return l == r
    case (let l as Bool, let r as Bool): return l == r
    case (let l as Int, let r as Int): return l == r
    case (let l as Double, let r as Double): return l == r
    case (let l as NSNumber, let r as NSNumber): return l == r
    default:
        let left = try? JSONSerialization.data(withJSONObject: ["v": lhs], options: [.sortedKeys])
        let right = try? JSONSerialization.data(withJSONObject: ["v": rhs], options: [.sortedKeys])
        return left == right
    }
}

private func opsJSONContains(_ container: Any, _ expected: Any) -> Bool {
    if let array = container as? [Any] {
        return array.contains { opsJSONValuesEqual($0, expected) }
    }
    if let text = container as? String, let expectedText = expected as? String {
        return text.contains(expectedText)
    }
    return false
}

private func opsParseJSON(_ text: String) -> Any? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = trimmed.data(using: .utf8), !data.isEmpty else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
}

private func opsRunProcess(_ executable: String, arguments: [String], timeoutMs: Int) -> (output: ProcessOutput, timedOut: Bool) {
    let process = Process()
    let stdout = Pipe()
    let stderr = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.standardOutput = stdout
    process.standardError = stderr

    do {
        try process.run()
    } catch {
        return (ProcessOutput(exitCode: 1, stdout: "", stderr: "\(error)"), false)
    }

    let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
    while process.isRunning && Date() < deadline {
        usleep(10_000)
    }
    let timedOut = process.isRunning
    if timedOut {
        process.terminate()
    }
    process.waitUntilExit()

    let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
    let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
    return (
        ProcessOutput(
            exitCode: timedOut ? 124 : process.terminationStatus,
            stdout: String(data: stdoutData, encoding: .utf8) ?? "",
            stderr: String(data: stderrData, encoding: .utf8) ?? ""
        ),
        timedOut
    )
}

private func opsEmitList(recipes: [OpsRecipe], asJSON: Bool) {
    if asJSON {
        opsEmitJSON([
            "status": "success",
            "recipes": recipes.map { opsRecipeSummary($0) }
        ], toStderr: false)
        return
    }
    for recipe in recipes {
        let summary = recipe.summary.isEmpty ? "" : " — \(recipe.summary)"
        print("\(recipe.id)\(summary)")
    }
}

private func opsEmitExplain(recipe: OpsRecipe, plan: [OpsStepPlan], asJSON: Bool) {
    if asJSON {
        opsEmitJSON([
            "status": "success",
            "recipe": opsRecipeSummary(recipe),
            "mutates": recipe.manifest["mutates"] as? Bool ?? plan.contains(where: { $0.mutates }),
            "steps": plan.map { opsStepPlanJSON($0) }
        ], toStderr: false)
        return
    }
    print("\(recipe.id) v\(recipe.version)")
    if !recipe.summary.isEmpty { print(recipe.summary) }
    for step in plan {
        let mutation = step.mutates ? "mutates" : "read-only"
        print("- \(step.id): \(step.commandPath.joined(separator: " ")) \(step.argv.joined(separator: " ")) [\(mutation)]")
    }
}

private func opsRecipeSummary(_ recipe: OpsRecipe) -> [String: Any] {
    [
        "id": recipe.id,
        "version": recipe.version,
        "summary": recipe.summary,
        "owner": recipe.owner,
        "path": recipe.path,
        "source_kind": recipe.sourceKind
    ]
}

private func opsStepPlanJSON(_ step: OpsStepPlan) -> [String: Any] {
    [
        "id": step.id,
        "command": [
            "path": step.commandPath,
            "form_id": step.formID
        ],
        "argv": step.argv,
        "timeout_ms": step.timeoutMs,
        "mutates": step.mutates,
        "finally": step.finally,
        "supports_delegate_dry_run": step.supportsDelegateDryRun,
        "would_run": true,
        "assertions": step.assertions.count
    ]
}

private func opsStepResult(_ step: OpsStepPlan, status: String, durationMs: Int?, observed: [String: Any]?) -> [String: Any] {
    var out = opsStepPlanJSON(step)
    out["status"] = status
    if let durationMs { out["duration_ms"] = durationMs }
    if let observed { out["observed"] = observed }
    return out
}

private func opsResult(
    status: String,
    code: String,
    error: String?,
    recipe: OpsRecipe,
    dryRun: Bool,
    steps: [[String: Any]],
    mutatedResources: [[String: Any]],
    cleanup: [String: Any]
) -> [String: Any] {
    [
        "status": status,
        "code": code,
        "error": error ?? NSNull(),
        "recipe": [
            "id": recipe.id,
            "version": recipe.version
        ],
        "mode": aosCurrentRuntimeMode().rawValue,
        "dry_run": dryRun,
        "started_at": iso8601Now(),
        "finished_at": iso8601Now(),
        "mutated_resources": mutatedResources,
        "steps": steps,
        "cleanup": cleanup
    ]
}

private func opsEmitJSON(_ payload: [String: Any], toStderr: Bool) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else {
        let fallback = #"{"error":"Failed to serialize ops JSON","code":"INTERNAL"}"#
        let target = toStderr ? FileHandle.standardError : FileHandle.standardOutput
        target.write(Data(fallback.utf8))
        target.write(Data("\n".utf8))
        return
    }
    let target = toStderr ? FileHandle.standardError : FileHandle.standardOutput
    target.write(data)
    target.write(Data("\n".utf8))
}

private func opsExitFailure(message: String, code: String) -> Never {
    let payload: [String: Any] = [
        "status": "failure",
        "code": code,
        "error": message
    ]
    opsEmitJSON(payload, toStderr: true)
    exit(1)
}
