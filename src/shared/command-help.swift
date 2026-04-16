// command-help.swift — Help command, text formatter, JSON output

import Foundation

// MARK: - Registry Access

/// The global registry. Populated in command-registry-data.swift.
var commandRegistry: [CommandDescriptor] = []

/// Look up a command by path. Returns nil if not found.
func findCommand(path: [String]) -> CommandDescriptor? {
    commandRegistry.first { $0.path == path }
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
            exitError("Unknown command: \(pathArgs.joined(separator: " ")). Run 'aos help --json' for full registry.", code: "UNKNOWN_COMMAND")
        }
    }
}

/// Called from handlers when --help is detected.
func printCommandHelp(_ path: [String], json: Bool) {
    if let cmd = findCommand(path: path) {
        if json {
            printCommandJSON(cmd)
        } else {
            printCommandText(cmd)
        }
    } else {
        // Fallback: show parent if exact path not found
        let parent = Array(path.dropLast())
        if !parent.isEmpty, let cmd = findCommand(path: parent) {
            if json {
                printCommandJSON(cmd)
            } else {
                printCommandText(cmd)
            }
        } else {
            printFullRegistryText()
        }
    }
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
    var lines: [String] = []
    lines.append("aos — agent operating system\n")
    lines.append("Usage: aos <command> [options]\n")
    lines.append("Commands:")

    // Group by top-level verb
    var verbs: [String: [CommandDescriptor]] = [:]
    for cmd in commandRegistry {
        let verb = cmd.path.first ?? "other"
        verbs[verb, default: []].append(cmd)
    }

    for verb in verbs.keys.sorted() {
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

    lines.append("\nRun 'aos help <command> [--json]' for details on a specific command.")
    lines.append("Run 'aos help --json' for machine-readable full registry.")
    print(lines.joined(separator: "\n"))
}

func printCommandText(_ cmd: CommandDescriptor) {
    var lines: [String] = []
    let cmdName = "aos \(cmd.path.joined(separator: " "))"
    lines.append("\(cmdName) — \(cmd.summary)\n")

    for form in cmd.forms {
        lines.append("  \(form.usage)")
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
                lines.append("    \(ex)")
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
