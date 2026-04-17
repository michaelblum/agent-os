// command-help.swift — Help command, text formatter, JSON output

import Foundation

// MARK: - Registry Access

/// The global registry. Populated in command-registry-data.swift.
var commandRegistry: [CommandDescriptor] = []

func aosInvocationDisplayName() -> String {
    let raw = CommandLine.arguments.first ?? "aos"
    if raw == "aos" {
        return "aos"
    }
    if raw == "./aos" {
        return "./aos"
    }

    let standardized = NSString(string: raw).standardizingPath
    if standardized == "aos" && !raw.contains("/") {
        return "aos"
    }

    let cwdAOS = (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent("aos")
    if standardized == NSString(string: cwdAOS).standardizingPath {
        return "./aos"
    }

    if let repoRoot = aosCurrentRepoRoot() {
        let repoAOS = (repoRoot as NSString).appendingPathComponent("aos")
        if standardized == NSString(string: repoAOS).standardizingPath {
            return "./aos"
        }
    }

    if standardized.hasSuffix("/aos") {
        return standardized
    }

    return raw
}

private func renderInvocationText(_ value: String) -> String {
    let prefix = aosInvocationDisplayName()
    return value.replacingOccurrences(of: "aos ", with: "\(prefix) ")
}

/// Look up a command by path. Exact match first, then tries parent
/// with form filtering for subcommand paths like ["show", "create"].
func findCommand(path: [String]) -> CommandDescriptor? {
    // Exact match
    if let cmd = commandRegistry.first(where: { $0.path == path }) {
        return cmd
    }
    // Subcommand match: find parent, filter forms by subcommand prefix
    guard path.count >= 2 else { return nil }
    let parentPath = Array(path.dropLast())
    let sub = path.last!
    let formPrefix = parentPath.last! + "-" + sub  // e.g. "show-create"
    guard let parent = commandRegistry.first(where: { $0.path == parentPath }) else { return nil }
    let filtered = parent.forms.filter { $0.id.hasPrefix(formPrefix) }
    guard !filtered.isEmpty else { return nil }
    return CommandDescriptor(path: path, summary: parent.summary, forms: filtered)
}

// MARK: - Help Command Entry Point

func helpCommand(args: [String]) {
    let jsonMode = args.contains("--json")
    let pathArgs = args.filter { $0 != "--json" && $0 != "-h" && $0 != "--help" }

    if pathArgs.isEmpty {
        // Full registry
        if jsonMode {
            printFullRegistryJSON()
        } else {
            printFullRegistryText()
        }
    } else {
        // Specific command
        if let cmd = findCommand(path: pathArgs) {
            if jsonMode {
                printCommandJSON(cmd)
            } else {
                printCommandText(cmd)
            }
        } else {
            exitError(
                "Unknown command: \(pathArgs.joined(separator: " ")). Run '\(aosInvocationDisplayName()) help --json' for full registry.",
                code: "UNKNOWN_COMMAND"
            )
        }
    }
}

/// Called from handlers when --help is detected.
///
/// Behavior:
/// - Empty path → full registry (honors `json`)
/// - Path found  → per-command help (honors `json`)
/// - Path not found → `exitError(UNKNOWN_COMMAND)` so bad input cannot
///   masquerade as a successful help dump.
func printCommandHelp(_ path: [String], json: Bool) {
    if path.isEmpty {
        if json {
            printFullRegistryJSON()
        } else {
            printFullRegistryText()
        }
        return
    }
    if let cmd = findCommand(path: path) {
        if json {
            printCommandJSON(cmd)
        } else {
            printCommandText(cmd)
        }
        return
    }
    exitError(
        "Unknown command: \(path.joined(separator: " ")). Run '\(aosInvocationDisplayName()) help --json' for full registry.",
        code: "UNKNOWN_COMMAND")
}

// MARK: - JSON Output

func printFullRegistryJSON() {
    let root: [String: Any] = [
        "name": "aos",
        "version": aosVersion(),
        "commands": commandRegistry.map { $0.toJSON() }
    ]
    if let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

func printCommandJSON(_ cmd: CommandDescriptor) {
    if let data = try? JSONSerialization.data(withJSONObject: cmd.toJSON(), options: [.prettyPrinted, .sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

// MARK: - Text Output

func printFullRegistryText() {
    let prefix = aosInvocationDisplayName()
    var lines: [String] = []
    lines.append("\(prefix) — agent operating system\n")
    lines.append("Usage: \(prefix) <command> [options]\n")
    lines.append("Commands:")

    // Group by top-level verb
    var verbs: [String: [CommandDescriptor]] = [:]
    for cmd in commandRegistry {
        let verb = cmd.path.first ?? "other"
        verbs[verb, default: []].append(cmd)
    }

    let preferredVerbOrder = [
        "status",
        "see",
        "do",
        "show",
        "focus",
        "graph",
        "introspect",
        "wiki",
        "tell",
        "listen",
        "say",
        "voice",
        "config",
        "set",
        "content",
        "serve",
        "service",
        "runtime",
        "permissions",
        "doctor",
        "clean",
        "reset",
        "daemon-snapshot",
        "inspect",
        "log",
    ]
    let orderedVerbs = preferredVerbOrder.filter { verbs[$0] != nil } +
        verbs.keys.filter { !preferredVerbOrder.contains($0) }.sorted()

    for verb in orderedVerbs {
        let cmds = verbs[verb]!
        // Show top-level summary from first entry
        let topLevel = cmds.first { $0.path.count == 1 }
        let summary = topLevel?.summary ?? cmds[0].summary
        let padded = verb.padding(toLength: 20, withPad: " ", startingAt: 0)
        lines.append("  \(padded)\(summary)")

        // Show subcommands if any
        let subs = cmds.filter { $0.path.count > 1 }
        for sub in subs {
            let subName = sub.path.dropFirst().joined(separator: " ")
            let subPad = subName.padding(toLength: 18, withPad: " ", startingAt: 0)
            lines.append("    \(subPad)\(sub.summary)")
        }
    }

    lines.append("\nRun '\(prefix) help <command> [--json]' for details on a specific command.")
    lines.append("Run '\(prefix) help --json' for machine-readable full registry.")
    print(lines.joined(separator: "\n"))
}

func printCommandText(_ cmd: CommandDescriptor) {
    let prefix = aosInvocationDisplayName()
    var lines: [String] = []
    let cmdName = "\(prefix) \(cmd.path.joined(separator: " "))"
    lines.append("\(cmdName) — \(cmd.summary)\n")

    for form in cmd.forms {
        lines.append("  \(renderInvocationText(form.usage))")
        if !form.args.isEmpty {
            lines.append("")
            for arg in form.args {
                let name = arg.token ?? "<\(arg.id)>"
                let req = arg.required ? " (required)" : ""
                let def = arg.defaultValue.map { " [default: \(formatJSONValue($0))]" } ?? ""
                lines.append("    \(name)\t\(arg.summary)\(req)\(def)")
            }
        }
        if let stdin = form.stdin, stdin.supported {
            lines.append("    stdin\t\(stdin.usedWhen) (\(stdin.contentType))")
        }
        // Execution info
        var tags: [String] = []
        if form.execution.readOnly { tags.append("read-only") }
        if form.execution.mutatesState { tags.append("mutates-state") }
        if form.execution.interactive { tags.append("interactive") }
        if form.execution.streaming { tags.append("streaming") }
        if form.execution.autoStartsDaemon { tags.append("auto-starts-daemon") }
        if form.execution.requiresPermissions { tags.append("requires-permissions") }
        if !tags.isEmpty {
            lines.append("    [execution: \(tags.joined(separator: ", "))]")
        }
        lines.append("    [output: \(form.output.defaultMode.rawValue)\(form.output.supportsJsonFlag ? ", supports --json" : "")]")

        if !form.examples.isEmpty {
            lines.append("\n  Examples:")
            for ex in form.examples {
                lines.append("    \(renderInvocationText(ex))")
            }
        }
        lines.append("")
    }
    print(lines.joined(separator: "\n"))
}

func formatJSONValue(_ value: JSONValue) -> String {
    switch value {
    case .string(let s): return s
    case .int(let n): return "\(n)"
    case .float(let f): return "\(f)"
    case .bool(let b): return b ? "true" : "false"
    case .null: return "null"
    }
}

func aosVersion() -> String {
    "0.1.0"
}
