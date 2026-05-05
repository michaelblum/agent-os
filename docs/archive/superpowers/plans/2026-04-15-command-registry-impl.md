# Command Registry Implementation Plan

> **Status note:** The command registry is now shipped. Treat this file as an implementation log. The live source of truth is `src/shared/command-registry-data.swift`, and the most drift-prone surfaces are the coordination forms (`tell` / `listen`) that now prefer canonical `session_id` routing.

## Current Shipped Snapshot

- `aos help` and per-command `--help` are wired through the static registry.
- `tell` supports `--session-id`, `--register --session-id/--name`, `--unregister`, `--from`, and stdin fallback.
- `listen` supports either `<channel>` or `--session-id`.
- `listen --follow` streams channel/direct inbox updates and currently uses `--since` rather than an initial `--limit` backfill.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a command registry and `aos help` command so agents can introspect all CLI commands, their invocation forms, execution safety, and output contracts via structured JSON.

**Architecture:** Static Swift registry of `CommandDescriptor` structs, each containing `InvocationForm`s with typed args, execution metadata, output metadata, and constraints. A `help` command serializes the registry to JSON or formatted text. Each existing handler gets `--help` interception that delegates to the registry.

**Tech Stack:** Swift 5.9+, macOS 14+, Foundation JSONSerialization

**Spec:** `docs/superpowers/specs/2026-04-15-command-registry-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/command-registry.swift` | Type definitions: `CommandDescriptor`, `InvocationForm`, `ArgDescriptor`, `JSONValue`, `DiscoverySource`, etc. Plus JSON serialization. |
| `src/shared/command-registry-data.swift` | Static registry data: all ~55 command forms defined here. |
| `src/shared/command-help.swift` | `helpCommand()` entry point, text formatter, JSON output, `printCommandHelp()` for `--help` delegation. |
| `src/main.swift` | Add `help` case to main switch. Add `--help` interception to all handlers. Replace `printUsage()` with registry-driven output. |

---

### Task 1: Registry Types and JSON Serialization

**Files:**
- Create: `src/shared/command-registry.swift`

This task defines all the types from the spec and their JSON serialization. No registry data yet — just the schema.

- [ ] **Step 1: Write the type definitions**

Create `src/shared/command-registry.swift`:

```swift
// command-registry.swift — Command registry types and JSON serialization

import Foundation

// MARK: - Registry Types

struct CommandDescriptor {
    let path: [String]
    let summary: String
    let forms: [InvocationForm]
}

struct InvocationForm {
    let id: String
    let usage: String
    let args: [ArgDescriptor]
    let stdin: StdinDescriptor?
    let constraints: ConstraintSet?
    let execution: ExecutionMeta
    let output: OutputMeta
    let examples: [String]
}

struct ArgDescriptor {
    let id: String
    let kind: ArgKind
    let token: String?
    let summary: String
    let valueType: ValueType
    let required: Bool
    let defaultValue: JSONValue?
    let variadic: Bool
    let discovery: [DiscoverySource]?
}

enum ArgKind: String { case positional, flag }

enum ValueType {
    case string, int, bool, float, json
    case enumeration([EnumValue])
}

struct EnumValue {
    let value: String
    let summary: String
}

enum JSONValue {
    case string(String)
    case int(Int)
    case float(Double)
    case bool(Bool)
    case null
}

enum DiscoverySource {
    case staticValues([String])
    case command(path: [String], formId: String)
}

struct StdinDescriptor {
    let supported: Bool
    let usedWhen: String
    let contentType: String
}

struct ConstraintSet {
    let requires: [[String]]?
    let conflicts: [[String]]?
    let oneOf: [[String]]?
    let implies: [String: [String]]?
}

struct ExecutionMeta {
    let readOnly: Bool
    let mutatesState: Bool
    let interactive: Bool
    let streaming: Bool
    let autoStartsDaemon: Bool
    let requiresPermissions: Bool
    let supportsDryRun: Bool
}

struct OutputMeta {
    let defaultMode: OutputMode
    let streaming: Bool
    let supportsJsonFlag: Bool
    let errorMode: String
}

enum OutputMode: String { case json, text, ndjson, none }

// MARK: - JSON Serialization

extension CommandDescriptor {
    func toJSON() -> [String: Any] {
        var dict: [String: Any] = [
            "path": path,
            "summary": summary,
            "forms": forms.map { $0.toJSON() }
        ]
        return dict
    }
}

extension InvocationForm {
    func toJSON() -> [String: Any] {
        var dict: [String: Any] = [
            "id": id,
            "usage": usage,
            "args": args.map { $0.toJSON() },
            "execution": execution.toJSON(),
            "output": output.toJSON()
        ]
        if !examples.isEmpty { dict["examples"] = examples }
        if let s = stdin { dict["stdin"] = s.toJSON() }
        if let c = constraints { dict["constraints"] = c.toJSON() }
        return dict
    }
}

extension ArgDescriptor {
    func toJSON() -> [String: Any] {
        var dict: [String: Any] = [
            "id": id,
            "kind": kind.rawValue,
            "summary": summary,
            "value_type": valueType.toJSON(),
            "required": required
        ]
        if let t = token { dict["token"] = t }
        if let d = defaultValue { dict["default_value"] = d.toJSON() }
        if variadic { dict["variadic"] = true }
        if let disc = discovery, !disc.isEmpty {
            dict["discovery"] = disc.map { $0.toJSON() }
        }
        return dict
    }
}

extension ValueType {
    func toJSON() -> Any {
        switch self {
        case .string: return "string"
        case .int: return "int"
        case .bool: return "bool"
        case .float: return "float"
        case .json: return "json"
        case .enumeration(let values):
            return ["enum": values.map { ["value": $0.value, "summary": $0.summary] }]
        }
    }
}

extension JSONValue {
    func toJSON() -> Any {
        switch self {
        case .string(let s): return s
        case .int(let n): return n
        case .float(let f): return f
        case .bool(let b): return b
        case .null: return NSNull()
        }
    }
}

extension DiscoverySource {
    func toJSON() -> [String: Any] {
        switch self {
        case .staticValues(let values):
            return ["static": values]
        case .command(let path, let formId):
            return ["command": ["path": path, "form_id": formId]]
        }
    }
}

extension StdinDescriptor {
    func toJSON() -> [String: Any] {
        return [
            "supported": supported,
            "used_when": usedWhen,
            "content_type": contentType
        ]
    }
}

extension ConstraintSet {
    func toJSON() -> [String: Any] {
        var dict: [String: Any] = [:]
        if let r = requires { dict["requires"] = r }
        if let c = conflicts { dict["conflicts"] = c }
        if let o = oneOf { dict["one_of"] = o }
        if let i = implies { dict["implies"] = i }
        return dict
    }
}

extension ExecutionMeta {
    func toJSON() -> [String: Any] {
        return [
            "read_only": readOnly,
            "mutates_state": mutatesState,
            "interactive": interactive,
            "streaming": streaming,
            "auto_starts_daemon": autoStartsDaemon,
            "requires_permissions": requiresPermissions,
            "supports_dry_run": supportsDryRun
        ]
    }
}

extension OutputMeta {
    func toJSON() -> [String: Any] {
        return [
            "default_mode": defaultMode.rawValue,
            "streaming": streaming,
            "supports_json_flag": supportsJsonFlag,
            "error_mode": errorMode
        ]
    }
}
```

- [ ] **Step 2: Build to verify types compile**

Run: `bash build.sh`
Expected: Build succeeds (no consumers yet, just type definitions)

- [ ] **Step 3: Commit**

```bash
git add src/shared/command-registry.swift
git commit -m "feat(registry): add command registry types and JSON serialization"
```

---

### Task 2: Help Command and Text Formatter

**Files:**
- Create: `src/shared/command-help.swift`

This task adds the help command logic, text formatter for human output, and the `printCommandHelp()` function that `--help` interception delegates to.

- [ ] **Step 1: Write the help command and formatters**

Create `src/shared/command-help.swift`:

```swift
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
```

- [ ] **Step 2: Build to verify it compiles**

Run: `bash build.sh`
Expected: Build succeeds (commandRegistry is empty, no callers yet)

- [ ] **Step 3: Commit**

```bash
git add src/shared/command-help.swift
git commit -m "feat(registry): add help command, text formatter, and JSON output"
```

---

### Task 3: Registry Data — Core Verbs (see, show, do)

**Files:**
- Create: `src/shared/command-registry-data.swift`

This is the largest task. Defines the static registry for the three big command families. The data was audited from actual source code.

Note: convenience helpers reduce boilerplate for common patterns (read-only JSON output, permissions-gated, etc.).

- [ ] **Step 1: Write registry data with convenience helpers and core verb entries**

Create `src/shared/command-registry-data.swift`:

```swift
// command-registry-data.swift — Static command registry data

import Foundation

// MARK: - Convenience Builders

/// Shorthand for common execution profiles
func execReadOnly(daemon: Bool = false, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: true, mutatesState: false, interactive: false, streaming: false,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

func execMutating(daemon: Bool = false, permissions: Bool = false, dryRun: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: false, mutatesState: true, interactive: false, streaming: false,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: dryRun)
}

func execStreaming(daemon: Bool = true, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: true, mutatesState: false, interactive: false, streaming: true,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

func execInteractive(daemon: Bool = true, permissions: Bool = false) -> ExecutionMeta {
    ExecutionMeta(readOnly: false, mutatesState: false, interactive: true, streaming: true,
                  autoStartsDaemon: daemon, requiresPermissions: permissions, supportsDryRun: false)
}

/// Shorthand for common output profiles
let outJSON = OutputMeta(defaultMode: .json, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outJSONFlag = OutputMeta(defaultMode: .text, streaming: false, supportsJsonFlag: true, errorMode: "json_stderr")
let outText = OutputMeta(defaultMode: .text, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outNDJSON = OutputMeta(defaultMode: .ndjson, streaming: true, supportsJsonFlag: false, errorMode: "json_stderr")
let outNone = OutputMeta(defaultMode: .none, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")
let outFile = OutputMeta(defaultMode: .none, streaming: false, supportsJsonFlag: false, errorMode: "json_stderr")

/// Shorthand for a simple flag arg
func flag(_ id: String, _ token: String, _ summary: String, type: ValueType = .string, required: Bool = false, default defaultVal: JSONValue? = nil) -> ArgDescriptor {
    ArgDescriptor(id: id, kind: .flag, token: token, summary: summary, valueType: type,
                  required: required, defaultValue: defaultVal, variadic: false, discovery: nil)
}

/// Shorthand for a positional arg
func pos(_ id: String, _ summary: String, type: ValueType = .string, required: Bool = true, variadic: Bool = false, discovery: [DiscoverySource]? = nil) -> ArgDescriptor {
    ArgDescriptor(id: id, kind: .positional, token: nil, summary: summary, valueType: type,
                  required: required, defaultValue: nil, variadic: variadic, discovery: discovery)
}

// MARK: - Registry Population

func buildCommandRegistry() -> [CommandDescriptor] {
    var reg: [CommandDescriptor] = []

    // ── see ───────────────────────────────────────────────
    let captureTargets: [DiscoverySource] = [
        .staticValues(["main", "external", "user_active", "selfie", "mouse", "all"]),
        .command(path: ["see", "zone"], formId: "zone-list")
    ]

    reg.append(CommandDescriptor(path: ["see"], summary: "Perception — query what's on screen", forms: [
        InvocationForm(id: "see-cursor", usage: "aos see cursor",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see cursor"]),
        InvocationForm(id: "see-capture", usage: "aos see capture <target> [options]",
            args: [
                pos("target", "Capture target", discovery: captureTargets),
                flag("out", "--out", "Output file path", default: .string("./screenshot.png")),
                flag("base64", "--base64", "Output base64 instead of file", type: .bool),
                flag("format", "--format", "Image format",
                     type: .enumeration([
                        EnumValue(value: "png", summary: "Lossless PNG (default)"),
                        EnumValue(value: "jpg", summary: "Lossy JPEG"),
                        EnumValue(value: "heic", summary: "HEIC format")
                     ]), default: .string("png")),
                flag("quality", "--quality", "Image quality",
                     type: .enumeration([
                        EnumValue(value: "high", summary: "Full resolution (default)"),
                        EnumValue(value: "med", summary: "Medium resolution"),
                        EnumValue(value: "low", summary: "Low resolution")
                     ]), default: .string("high")),
                flag("window", "--window", "Capture window only", type: .bool),
                flag("crop", "--crop", "Crop spec: x,y,w,h or named region (top-half, etc.)"),
                flag("grid", "--grid", "Grid overlay (e.g. 4x3)"),
                flag("xray", "--xray", "AX element traversal overlay", type: .bool),
                flag("label", "--label", "Badge annotations (implies --xray)", type: .bool),
                flag("show-cursor", "--show-cursor", "Include cursor in capture", type: .bool),
                flag("highlight-cursor", "--highlight-cursor", "Highlight cursor position", type: .bool),
                flag("radius", "--radius", "Radius for mouse target capture", type: .int),
                flag("delay", "--delay", "Delay before capture in seconds", type: .float),
                flag("clipboard", "--clipboard", "Also copy to clipboard", type: .bool),
                flag("draw-rect", "--draw-rect", "Draw rectangle overlay: x,y,w,h color"),
                flag("interactive", "--interactive", "Native selection rectangle", type: .bool),
                flag("wait-for-click", "--wait-for-click", "Wait for click then capture", type: .bool)
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: [["base64", "out"]], oneOf: nil, implies: ["label": ["xray"]]),
            execution: execReadOnly(permissions: true),
            output: outFile,
            examples: [
                "aos see capture main --out /tmp/screen.png",
                "aos see main --base64 --format jpg",
                "aos see capture user_active --window --xray",
                "aos see mouse --radius 200"
            ]),
        InvocationForm(id: "see-observe", usage: "aos see observe [--depth N] [--rate mode]",
            args: [
                flag("depth", "--depth", "AX traversal depth 0-3", type: .int, default: .int(1)),
                flag("rate", "--rate", "Stream rate",
                     type: .enumeration([
                        EnumValue(value: "continuous", summary: "Continuous updates"),
                        EnumValue(value: "on-change", summary: "Only on change"),
                        EnumValue(value: "on-settle", summary: "After cursor settles")
                     ]))
            ],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos see observe --depth 2"]),
        InvocationForm(id: "see-list", usage: "aos see list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see list"]),
        InvocationForm(id: "see-selection", usage: "aos see selection",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(permissions: true),
            output: outJSON,
            examples: ["aos see selection"])
    ]))

    // ── see zone ─────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["see", "zone"], summary: "Manage named capture zones", forms: [
        InvocationForm(id: "zone-save", usage: "aos see zone save <name> [--target <display>] <x,y,w,h>",
            args: [
                pos("name", "Zone name"),
                flag("target", "--target", "Target display"),
                pos("bounds", "Zone bounds as x,y,w,h")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos see zone save header --target main 0,0,1920,100"]),
        InvocationForm(id: "zone-define", usage: "aos see zone define <name> [--target <display>]",
            args: [
                pos("name", "Zone name"),
                flag("target", "--target", "Target display")
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: false, permissions: true),
            output: outJSON,
            examples: ["aos see zone define header"]),
        InvocationForm(id: "zone-list", usage: "aos see zone list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos see zone list"]),
        InvocationForm(id: "zone-delete", usage: "aos see zone delete <name>",
            args: [pos("name", "Zone name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos see zone delete header"])
    ]))

    // ── show ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["show"], summary: "Display — manage overlays and render", forms: [
        InvocationForm(id: "show-create", usage: "aos show create --id <name> [positioning] [content] [options]",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("at", "--at", "Position as x,y,w,h"),
                flag("html", "--html", "Inline HTML content"),
                flag("file", "--file", "HTML file path"),
                flag("url", "--url", "URL to load (supports aos:// scheme)"),
                flag("interactive", "--interactive", "Allow mouse interaction", type: .bool),
                flag("focus", "--focus", "Focus the canvas", type: .bool),
                flag("ttl", "--ttl", "Time to live (e.g. 5s, 10m, none)"),
                flag("scope", "--scope", "Canvas scope",
                     type: .enumeration([
                        EnumValue(value: "connection", summary: "Removed when client disconnects"),
                        EnumValue(value: "global", summary: "Persists after disconnect")
                     ]), default: .string("connection")),
                flag("auto-project", "--auto-project", "Auto-projection mode",
                     type: .enumeration([
                        EnumValue(value: "none", summary: "No projection"),
                        EnumValue(value: "cursor", summary: "Follow cursor"),
                        EnumValue(value: "window", summary: "Follow window")
                     ])),
                flag("track", "--track", "Track target",
                     type: .enumeration([
                        EnumValue(value: "union", summary: "Track display union bounds")
                     ])),
                flag("anchor-window", "--anchor-window", "Anchor to window ID"),
                flag("anchor-channel", "--anchor-channel", "Anchor to focus channel ID"),
                flag("offset", "--offset", "Offset from anchor as x,y,w,h")
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: [["at", "track"], ["html", "file", "url"]], oneOf: nil, implies: nil),
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: [
                "aos show create --id ball --at 100,100,200,200 --html \"<div>hello</div>\"",
                "aos show create --id avatar --url aos://sigil/renderer/index.html --track union"
            ]),
        InvocationForm(id: "show-update", usage: "aos show update --id <name> [options]",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("at", "--at", "New position as x,y,w,h"),
                flag("html", "--html", "New HTML content"),
                flag("file", "--file", "New HTML file path"),
                flag("url", "--url", "New URL"),
                flag("focus", "--focus", "Focus the canvas", type: .bool),
                flag("ttl", "--ttl", "New TTL"),
                flag("auto-project", "--auto-project", "New projection mode"),
                flag("track", "--track", "New track target"),
                flag("anchor-window", "--anchor-window", "New anchor window"),
                flag("offset", "--offset", "New offset")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show update --id ball --at 200,200,200,200"]),
        InvocationForm(id: "show-remove", usage: "aos show remove --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show remove --id ball"]),
        InvocationForm(id: "show-remove-all", usage: "aos show remove-all",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show remove-all"]),
        InvocationForm(id: "show-list", usage: "aos show list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos show list"]),
        InvocationForm(id: "show-render", usage: "aos show render [--html <html>] [--width N] [--height N] [--out path]",
            args: [
                flag("html", "--html", "HTML to render"),
                flag("width", "--width", "Image width in pixels", type: .int, default: .int(800)),
                flag("height", "--height", "Image height in pixels", type: .int, default: .int(600)),
                flag("out", "--out", "Output file path", default: .string("./render.png"))
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no --html provided", contentType: "html"),
            constraints: nil,
            execution: execReadOnly(),
            output: outFile,
            examples: ["aos show render --html \"<h1>Hi</h1>\" --out /tmp/test.png"]),
        InvocationForm(id: "show-eval", usage: "aos show eval --id <name> --script <javascript>",
            args: [
                flag("id", "--id", "Canvas identifier", required: true),
                flag("script", "--script", "JavaScript to execute", required: true)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos show eval --id avatar --script \"document.title\""]),
        InvocationForm(id: "show-listen", usage: "aos show listen",
            args: [],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["aos show listen"]),
        InvocationForm(id: "show-ping", usage: "aos show ping",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos show ping"]),
        InvocationForm(id: "show-exists", usage: "aos show exists --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show exists --id avatar --json"]),
        InvocationForm(id: "show-get", usage: "aos show get --id <name>",
            args: [flag("id", "--id", "Canvas identifier", required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos show get --id avatar --json"])
    ]))

    // ── do ────────────────────────────────────────────────
    let permAction = execMutating(permissions: true)

    reg.append(CommandDescriptor(path: ["do"], summary: "Action — execute mouse, keyboard, AX actions", forms: [
        InvocationForm(id: "do-click", usage: "aos do click <x,y> [--right] [--double] [--dwell N]",
            args: [
                pos("coords", "Click coordinates as x,y"),
                flag("right", "--right", "Right-click", type: .bool),
                flag("double", "--double", "Double-click", type: .bool),
                flag("dwell", "--dwell", "Dwell time in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do click 500,300", "aos do click 500,300 --right"]),
        InvocationForm(id: "do-hover", usage: "aos do hover <x,y>",
            args: [pos("coords", "Target coordinates as x,y")],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do hover 500,300"]),
        InvocationForm(id: "do-drag", usage: "aos do drag <x1,y1> <x2,y2> [--speed N]",
            args: [
                pos("from", "Start coordinates as x,y"),
                pos("to", "End coordinates as x,y"),
                flag("speed", "--speed", "Drag speed in pixels/sec", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do drag 100,100 500,500"]),
        InvocationForm(id: "do-scroll", usage: "aos do scroll <x,y> [--dx N] [--dy N]",
            args: [
                pos("coords", "Scroll position as x,y"),
                flag("dx", "--dx", "Horizontal scroll amount", type: .int),
                flag("dy", "--dy", "Vertical scroll amount", type: .int)
            ],
            stdin: nil,
            constraints: ConstraintSet(requires: nil, conflicts: nil, oneOf: [["dx", "dy"]], implies: nil),
            execution: permAction,
            output: outJSON,
            examples: ["aos do scroll 500,300 --dy -3"]),
        InvocationForm(id: "do-type", usage: "aos do type <text> [--delay ms] [--variance N]",
            args: [
                pos("text", "Text to type", variadic: true),
                flag("delay", "--delay", "Inter-key delay in ms", type: .int),
                flag("variance", "--variance", "Delay variance for natural cadence", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do type \"hello world\""]),
        InvocationForm(id: "do-key", usage: "aos do key <combo>",
            args: [pos("combo", "Key combination (e.g. cmd+s, ctrl+shift+tab)")],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do key \"cmd+s\"", "aos do key \"ctrl+shift+tab\""]),
        InvocationForm(id: "do-press", usage: "aos do press --pid <pid> --role <role> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do press --pid 1234 --role AXButton --title Save"]),
        InvocationForm(id: "do-set-value", usage: "aos do set-value --pid <pid> --role <role> --value <value> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("value", "--value", "Value to set", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do set-value --pid 1234 --role AXTextField --value \"hello\""]),
        InvocationForm(id: "do-focus", usage: "aos do focus --pid <pid> --role <role> [filters]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("role", "--role", "AX role to match", required: true),
                flag("title", "--title", "Filter by title"),
                flag("label", "--label", "Filter by label"),
                flag("identifier", "--identifier", "Filter by identifier"),
                flag("index", "--index", "Match by index", type: .int),
                flag("near", "--near", "Prefer element near x,y"),
                flag("match", "--match", "Regex match on value"),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("timeout", "--timeout", "Timeout in ms", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do focus --pid 1234 --role AXTextField"]),
        InvocationForm(id: "do-raise", usage: "aos do raise --pid <pid> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do raise --pid 1234"]),
        InvocationForm(id: "do-move", usage: "aos do move --pid <pid> --to <x,y> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("to", "--to", "Target position as x,y", required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do move --pid 1234 --to 100,100"]),
        InvocationForm(id: "do-resize", usage: "aos do resize --pid <pid> --to <w,h> [--window id]",
            args: [
                flag("pid", "--pid", "Process ID", type: .int, required: true),
                flag("to", "--to", "Target size as w,h", required: true),
                flag("window", "--window", "Window ID", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do resize --pid 1234 --to 800,600"]),
        InvocationForm(id: "do-tell", usage: "aos do tell <app> <script>",
            args: [
                pos("app", "Application name"),
                pos("script", "AppleScript body", variadic: true)
            ],
            stdin: nil, constraints: nil,
            execution: permAction,
            output: outJSON,
            examples: ["aos do tell \"Finder\" \"open POSIX file \\\"/tmp\\\"\""]),
        InvocationForm(id: "do-session", usage: "aos do session [--profile name]",
            args: [
                flag("profile", "--profile", "Behavior profile name", default: .string("natural"))
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos do session", "aos do session --profile precise"]),
        InvocationForm(id: "do-profiles", usage: "aos do profiles [name]",
            args: [
                pos("name", "Profile name to show details", required: false)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos do profiles", "aos do profiles natural"])
    ]))

    // ── continued in Task 4 ──
    return reg
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `bash build.sh`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/shared/command-registry-data.swift
git commit -m "feat(registry): add registry data for see, show, do commands"
```

---

### Task 4: Registry Data — Communication, Config, and System Commands

**Files:**
- Modify: `src/shared/command-registry-data.swift`

Add remaining commands to `buildCommandRegistry()`: say, tell, listen, set, focus, graph, daemon-snapshot, serve, content, service, runtime, doctor, reset, clean, permissions, inspect, log, wiki.

- [ ] **Step 1: Add communication verbs (say, tell, listen)**

Append inside `buildCommandRegistry()`, before the `return reg` line:

```swift
    // ── say ───────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["say"], summary: "Voice — speak text aloud (sugar for tell human)", forms: [
        InvocationForm(id: "say-text", usage: "aos say [--voice id] [--rate wpm] <text>",
            args: [
                flag("voice", "--voice", "Voice identifier", discovery: [.command(path: ["say"], formId: "say-list-voices")]),
                flag("rate", "--rate", "Speech rate in WPM", type: .int),
                pos("text", "Text to speak", required: false, variadic: true)
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no text args provided", contentType: "text"),
            constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos say \"Hello, I'm your agent\"", "echo 'status' | aos say"]),
        InvocationForm(id: "say-list-voices", usage: "aos say --list-voices",
            args: [flag("list-voices", "--list-voices", "List available system voices", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos say --list-voices"])
    ]))

    // ── tell ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["tell"], summary: "Communication — send to human, channel, or session", forms: [
        InvocationForm(id: "tell-message", usage: "aos tell <audience>|--session-id <id> [--json <payload>] [--from <name>] [<text> | stdin]",
            args: [
                pos("audience", "Target: human, channel name, or canonical session id", discovery: [
                    .staticValues(["human"]),
                    .command(path: ["listen"], formId: "listen-channels"),
                    .command(path: ["tell"], formId: "tell-who")
                ]),
                flag("session-id", "--session-id", "Directly target a canonical session id"),
                flag("json", "--json", "Structured JSON payload", type: .json),
                flag("from", "--from", "Sender name"),
                pos("text", "Message text", required: false, variadic: true)
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "no text and no --json", contentType: "text"),
            constraints: ConstraintSet(requires: nil, conflicts: nil, oneOf: [["text", "stdin", "json"]], implies: nil),
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: [
                "aos tell human \"Found the bug\"",
                "aos tell --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c \"status update\"",
                "aos tell handoff \"task complete\" --from my-session",
                "echo 'update' | aos tell handoff"
            ]),
        InvocationForm(id: "tell-register", usage: "aos tell --register [<legacy-name>] [--session-id <id>] [--name <name>] [--role <role>] [--harness <harness>]",
            args: [
                flag("register", "--register", "Register session presence", required: true),
                flag("session-id", "--session-id", "Canonical session id (preferred)"),
                flag("name", "--name", "Human-readable display name"),
                flag("role", "--role", "Session role",
                     type: .enumeration([
                        EnumValue(value: "worker", summary: "Default worker session"),
                        EnumValue(value: "coordinator", summary: "Orchestrating session"),
                        EnumValue(value: "observer", summary: "Read-only monitoring session")
                     ]), default: .string("worker")),
                flag("harness", "--harness", "Agent harness identifier", default: .string("unknown"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos tell --register --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --name canvas-runtime", "aos tell --register builder --role worker --harness claude-code"]),
        InvocationForm(id: "tell-unregister", usage: "aos tell --unregister [<legacy-name>] [--session-id <id>]",
            args: [
                flag("unregister", "--unregister", "Remove session presence", required: true),
                flag("session-id", "--session-id", "Canonical session id (preferred)")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos tell --unregister --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c", "aos tell --unregister my-session"]),
        InvocationForm(id: "tell-who", usage: "aos tell --who",
            args: [flag("who", "--who", "List online sessions", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos tell --who"])
    ]))

    // ── listen ────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["listen"], summary: "Communication — receive from channels", forms: [
        InvocationForm(id: "listen-read", usage: "aos listen <channel>|--session-id <id> [--since id] [--limit N]",
            args: [
                pos("channel", "Channel to read from", discovery: [.command(path: ["listen"], formId: "listen-channels")]),
                flag("session-id", "--session-id", "Read direct messages for a canonical session id"),
                flag("since", "--since", "Read messages after this ID"),
                flag("limit", "--limit", "Max messages to return", type: .int, default: .int(50))
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos listen handoff", "aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c", "aos listen handoff --limit 10"]),
        InvocationForm(id: "listen-follow", usage: "aos listen <channel>|--session-id <id> --follow [--since id]",
            args: [
                pos("channel", "Channel to follow"),
                flag("session-id", "--session-id", "Follow direct messages for a canonical session id"),
                flag("follow", "--follow", "Stream messages in real-time", type: .bool, required: true),
                flag("since", "--since", "Start after this message ID")
            ],
            stdin: nil, constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["aos listen handoff --follow", "aos listen --session-id 019d97cc-2f15-7951-b0bd-3a271d7fb97c --follow"]),
        InvocationForm(id: "listen-channels", usage: "aos listen --channels",
            args: [flag("channels", "--channels", "List known channels", type: .bool, required: true)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos listen --channels"])
    ]))
```

- [ ] **Step 2: Add config and infrastructure commands (set, focus, graph, daemon-snapshot, serve, content)**

Continue appending inside `buildCommandRegistry()`:

```swift
    // ── set ───────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["set"], summary: "Configure autonomic settings", forms: [
        InvocationForm(id: "set-value", usage: "aos set <key> <value>",
            args: [
                pos("key", "Config key (e.g. voice.enabled, perception.default_depth)"),
                pos("value", "New value")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSON,
            examples: ["aos set voice.enabled true", "aos set perception.default_depth 2"]),
        InvocationForm(id: "set-dump", usage: "aos set",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos set"])
    ]))

    // ── focus ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["focus"], summary: "Focus channels — track window AX trees", forms: [
        InvocationForm(id: "focus-create", usage: "aos focus create --id <name> --window <wid> [options]",
            args: [
                flag("id", "--id", "Channel name", required: true),
                flag("window", "--window", "Window ID to track", type: .int, required: true),
                flag("pid", "--pid", "Process ID", type: .int),
                flag("depth", "--depth", "AX traversal depth", type: .int),
                flag("subtree-role", "--subtree-role", "Filter by AX role"),
                flag("subtree-title", "--subtree-title", "Filter by title"),
                flag("subtree-identifier", "--subtree-identifier", "Filter by identifier")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus create --id work --window 1234 --depth 2"]),
        InvocationForm(id: "focus-update", usage: "aos focus update --id <name> [options]",
            args: [
                flag("id", "--id", "Channel name", required: true),
                flag("depth", "--depth", "New traversal depth", type: .int),
                flag("subtree-role", "--subtree-role", "New role filter"),
                flag("subtree-title", "--subtree-title", "New title filter"),
                flag("subtree-identifier", "--subtree-identifier", "New identifier filter")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus update --id work --depth 3"]),
        InvocationForm(id: "focus-list", usage: "aos focus list",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos focus list"]),
        InvocationForm(id: "focus-remove", usage: "aos focus remove --id <name>",
            args: [flag("id", "--id", "Channel name", required: true)],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos focus remove --id work"])
    ]))

    // ── graph ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["graph"], summary: "Graph navigation — display/window/depth control", forms: [
        InvocationForm(id: "graph-displays", usage: "aos graph displays",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos graph displays"]),
        InvocationForm(id: "graph-windows", usage: "aos graph windows [--display N]",
            args: [flag("display", "--display", "Display index", type: .int)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos graph windows"]),
        InvocationForm(id: "graph-deepen", usage: "aos graph deepen --id <id> [options]",
            args: [
                flag("id", "--id", "Node ID to expand", required: true),
                flag("depth", "--depth", "Depth increment", type: .int),
                flag("subtree-role", "--subtree-role", "Filter by role"),
                flag("subtree-title", "--subtree-title", "Filter by title"),
                flag("subtree-identifier", "--subtree-identifier", "Filter by identifier")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos graph deepen --id node-1 --depth 2"]),
        InvocationForm(id: "graph-collapse", usage: "aos graph collapse --id <id> [--depth N]",
            args: [
                flag("id", "--id", "Node ID to collapse", required: true),
                flag("depth", "--depth", "Depth decrement", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos graph collapse --id node-1"])
    ]))

    // ── daemon-snapshot ───────────────────────────────────
    reg.append(CommandDescriptor(path: ["daemon-snapshot"], summary: "Daemon state snapshot", forms: [
        InvocationForm(id: "daemon-snapshot", usage: "aos daemon-snapshot",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSON,
            examples: ["aos daemon-snapshot"])
    ]))

    // ── serve ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["serve"], summary: "Start the unified daemon", forms: [
        InvocationForm(id: "serve", usage: "aos serve [--idle-timeout duration]",
            args: [flag("idle-timeout", "--idle-timeout", "Idle timeout (e.g. 5m, none)", default: .string("5m"))],
            stdin: nil, constraints: nil,
            execution: ExecutionMeta(readOnly: false, mutatesState: true, interactive: false, streaming: true,
                                     autoStartsDaemon: false, requiresPermissions: false, supportsDryRun: false),
            output: outNone,
            examples: ["aos serve", "aos serve --idle-timeout none"])
    ]))

    // ── content ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["content"], summary: "Content server management", forms: [
        InvocationForm(id: "content-status", usage: "aos content status [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(daemon: true),
            output: outJSONFlag,
            examples: ["aos content status", "aos content status --json"])
    ]))
```

- [ ] **Step 3: Add system commands (service, runtime, doctor, reset, clean, permissions)**

Continue appending:

```swift
    // ── service ───────────────────────────────────────────
    let serviceMode = flag("mode", "--mode", "Runtime mode",
        type: .enumeration([
            EnumValue(value: "repo", summary: "Development repo mode"),
            EnumValue(value: "installed", summary: "Installed AOS.app mode")
        ]))

    reg.append(CommandDescriptor(path: ["service"], summary: "Manage the daemon as a launchd service", forms: [
        InvocationForm(id: "service-install", usage: "aos service install [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service install", "aos service install --mode repo --json"]),
        InvocationForm(id: "service-start", usage: "aos service start [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service start"]),
        InvocationForm(id: "service-stop", usage: "aos service stop [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service stop"]),
        InvocationForm(id: "service-restart", usage: "aos service restart [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos service restart"]),
        InvocationForm(id: "service-status", usage: "aos service status [--mode repo|installed] [--json]",
            args: [serviceMode],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos service status --json"]),
        InvocationForm(id: "service-logs", usage: "aos service logs [--mode repo|installed] [--tail N]",
            args: [
                serviceMode,
                flag("tail", "--tail", "Number of lines to show", type: .int)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outText,
            examples: ["aos service logs --tail 50"])
    ]))

    // ── runtime ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["runtime"], summary: "Package/sign/install the stable AOS.app runtime", forms: [
        InvocationForm(id: "runtime-install", usage: "aos runtime install [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos runtime install"]),
        InvocationForm(id: "runtime-status", usage: "aos runtime status [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos runtime status --json"]),
        InvocationForm(id: "runtime-path", usage: "aos runtime path [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos runtime path"]),
        InvocationForm(id: "runtime-sign", usage: "aos runtime sign",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outText,
            examples: ["aos runtime sign"]),
        InvocationForm(id: "runtime-display-union", usage: "aos runtime display-union",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outText,
            examples: ["aos runtime display-union"])
    ]))

    // ── doctor ────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["doctor"], summary: "Runtime and permission health checks", forms: [
        InvocationForm(id: "doctor", usage: "aos doctor [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos doctor --json"])
    ]))

    // ── reset ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["reset"], summary: "Deterministic cleanup for repo/installed runtime state", forms: [
        InvocationForm(id: "reset", usage: "aos reset [--mode current|repo|installed|all] [--json]",
            args: [
                flag("mode", "--mode", "Cleanup scope",
                     type: .enumeration([
                        EnumValue(value: "current", summary: "Current runtime mode only"),
                        EnumValue(value: "repo", summary: "Repo mode state"),
                        EnumValue(value: "installed", summary: "Installed mode state"),
                        EnumValue(value: "all", summary: "All modes")
                     ]), default: .string("current"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos reset", "aos reset --mode all --json"])
    ]))

    // ── clean ─────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["clean"], summary: "Session-boundary cleanup (stale daemons, orphaned canvases)", forms: [
        InvocationForm(id: "clean", usage: "aos clean [--dry-run] [--json]",
            args: [flag("dry-run", "--dry-run", "Show what would be cleaned without doing it", type: .bool)],
            stdin: nil, constraints: nil,
            execution: execMutating(dryRun: true),
            output: outJSONFlag,
            examples: ["aos clean", "aos clean --dry-run --json"])
    ]))

    // ── permissions ───────────────────────────────────────
    reg.append(CommandDescriptor(path: ["permissions"], summary: "Permission preflight and one-time onboarding", forms: [
        InvocationForm(id: "permissions-check", usage: "aos permissions check [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos permissions check --json"]),
        InvocationForm(id: "permissions-preflight", usage: "aos permissions preflight [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSON,
            examples: ["aos permissions preflight --json"]),
        InvocationForm(id: "permissions-setup", usage: "aos permissions setup [--once] [--json]",
            args: [flag("once", "--once", "Run only if not already completed", type: .bool)],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: false),
            output: outJSONFlag,
            examples: ["aos permissions setup --once"])
    ]))
```

- [ ] **Step 4: Add tool commands (inspect, log) and wiki**

Continue appending:

```swift
    // ── inspect ───────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["inspect"], summary: "Live AX element inspector overlay", forms: [
        InvocationForm(id: "inspect", usage: "aos inspect [--at x,y,w,h] [--size w,h]",
            args: [
                flag("at", "--at", "Inspector position as x,y,w,h"),
                flag("size", "--size", "Inspector size as w,h")
            ],
            stdin: nil, constraints: nil,
            execution: execInteractive(daemon: true, permissions: true),
            output: outNDJSON,
            examples: ["aos inspect", "aos inspect --at 0,0,400,300"])
    ]))

    // ── log ───────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["log"], summary: "Display log console panel", forms: [
        InvocationForm(id: "log-stream", usage: "echo lines | aos log [--at x,y,w,h] [--level level]",
            args: [
                flag("at", "--at", "Log panel position as x,y,w,h"),
                flag("level", "--level", "Log level filter",
                     type: .enumeration([
                        EnumValue(value: "debug", summary: "All messages"),
                        EnumValue(value: "info", summary: "Info and above"),
                        EnumValue(value: "warn", summary: "Warnings and errors"),
                        EnumValue(value: "error", summary: "Errors only")
                     ]))
            ],
            stdin: StdinDescriptor(supported: true, usedWhen: "streaming mode (default)", contentType: "text"),
            constraints: nil,
            execution: execStreaming(daemon: true),
            output: outNDJSON,
            examples: ["echo 'hello' | aos log", "tail -f /var/log/app.log | aos log"]),
        InvocationForm(id: "log-push", usage: "aos log push <message> [--level level]",
            args: [
                pos("message", "Log message", variadic: true),
                flag("level", "--level", "Log level",
                     type: .enumeration([
                        EnumValue(value: "debug", summary: "Debug level"),
                        EnumValue(value: "info", summary: "Info level (default)"),
                        EnumValue(value: "warn", summary: "Warning level"),
                        EnumValue(value: "error", summary: "Error level")
                     ]), default: .string("info"))
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos log push \"test message\"", "aos log push \"error occurred\" --level error"]),
        InvocationForm(id: "log-clear", usage: "aos log clear",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(daemon: true),
            output: outJSON,
            examples: ["aos log clear"])
    ]))

    // ── wiki ──────────────────────────────────────────────
    reg.append(CommandDescriptor(path: ["wiki"], summary: "Knowledge base — browse, search, invoke workflow plugins", forms: [
        InvocationForm(id: "wiki-create-plugin", usage: "aos wiki create-plugin <name> [--json]",
            args: [pos("name", "Plugin name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki create-plugin my-flow"]),
        InvocationForm(id: "wiki-add", usage: "aos wiki add <type> <name> [--json]",
            args: [
                pos("type", "Page type",
                    type: .enumeration([
                        EnumValue(value: "entity", summary: "Entity page (thing in the system)"),
                        EnumValue(value: "concept", summary: "Concept page (idea or pattern)")
                    ])),
                pos("name", "Page name")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki add entity gateway"]),
        InvocationForm(id: "wiki-rm", usage: "aos wiki rm <path> [--json]",
            args: [pos("path", "Page path or name")],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki rm gateway"]),
        InvocationForm(id: "wiki-list", usage: "aos wiki list [--type type] [--plugin name] [--links-to path] [--links-from path] [--orphans] [--json]",
            args: [
                flag("type", "--type", "Filter by page type"),
                flag("plugin", "--plugin", "Filter by plugin"),
                flag("links-to", "--links-to", "Pages linking to this path"),
                flag("links-from", "--links-from", "Pages linked from this path"),
                flag("orphans", "--orphans", "Show orphaned pages", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki list", "aos wiki list --type workflow --json"]),
        InvocationForm(id: "wiki-search", usage: "aos wiki search <query> [--type type] [--json]",
            args: [
                pos("query", "Search query", variadic: true),
                flag("type", "--type", "Filter by page type")
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki search \"IPC protocol\""]),
        InvocationForm(id: "wiki-show", usage: "aos wiki show <name> [--raw] [--json]",
            args: [
                pos("name", "Page path or name"),
                flag("raw", "--raw", "Show raw markdown", type: .bool)
            ],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki show gateway --json"]),
        InvocationForm(id: "wiki-link", usage: "aos wiki link <from> <to> [--json]",
            args: [
                pos("from", "Source page path"),
                pos("to", "Target page path")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki link gateway daemon"]),
        InvocationForm(id: "wiki-invoke", usage: "aos wiki invoke <plugin> [--json]",
            args: [pos("plugin", "Plugin name to invoke")],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki invoke self-check"]),
        InvocationForm(id: "wiki-reindex", usage: "aos wiki reindex [--json]",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki reindex"]),
        InvocationForm(id: "wiki-lint", usage: "aos wiki lint [--fix] [--json]",
            args: [flag("fix", "--fix", "Auto-fix issues", type: .bool)],
            stdin: nil, constraints: nil,
            execution: execReadOnly(),
            output: outJSONFlag,
            examples: ["aos wiki lint", "aos wiki lint --fix --json"]),
        InvocationForm(id: "wiki-seed", usage: "aos wiki seed [--force] [--namespace ns] [--file name:path ...] [--json]",
            args: [
                flag("force", "--force", "Overwrite existing pages", type: .bool),
                flag("namespace", "--namespace", "Target namespace"),
                flag("file", "--file", "File mappings (name:path)", variadic: true),
                flag("from", "--from", "Source directory path")
            ],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki seed", "aos wiki seed --force --namespace sigil"]),
        InvocationForm(id: "wiki-migrate-namespaces", usage: "aos wiki migrate-namespaces",
            args: [],
            stdin: nil, constraints: nil,
            execution: execMutating(),
            output: outJSONFlag,
            examples: ["aos wiki migrate-namespaces"])
    ]))
```

- [ ] **Step 5: Build to verify all registry data compiles**

Run: `bash build.sh`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/shared/command-registry-data.swift
git commit -m "feat(registry): add registry data for all commands (~55 forms)"
```

---

### Task 5: Wire Help Command into main.swift

**Files:**
- Modify: `src/main.swift`

Add `help` command to main switch, wire `--help` interception into all handlers, initialize the registry, and replace `printUsage()`.

- [ ] **Step 1: Add registry initialization and help command to main switch**

In `src/main.swift`, add registry init at the top of `main()` and `help` case to the switch:

After `guard let command = args.first else {` block (line ~11), add:

```swift
        // Initialize command registry
        commandRegistry = buildCommandRegistry()
```

Change the no-args guard to use registry:

```swift
        guard let command = args.first else {
            commandRegistry = buildCommandRegistry()
            printFullRegistryText()
            exit(0)
        }
```

Add `help` case before `default:` in the main switch:

```swift
        case "help":
            helpCommand(args: Array(args.dropFirst()))
```

Change existing `--help` case:

```swift
        case "--help", "-h", "help":
            helpCommand(args: [])
```

- [ ] **Step 2: Add --help interception to handleSee**

Replace the `--help` case inside `handleSee` and add interception:

```swift
func handleSee(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["see"], json: false)
        exit(0)
    }
    switch sub {
    case "--help", "-h":
        printCommandHelp(["see"], json: args.contains("--json"))
        exit(0)
    case "cursor":
        ensureInteractivePreflight(command: "aos see cursor")
        cursorCommand()
    case "observe":
        ensureInteractivePreflight(command: "aos see observe")
        observeCommand(args: Array(args.dropFirst()))
    case "capture":
        let subArgs = Array(args.dropFirst())
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["see"], json: subArgs.contains("--json"))
            exit(0)
        }
        ensureInteractivePreflight(command: "aos see capture")
        runCaptureAsync(args: subArgs)
    case "list":
        ensureInteractivePreflight(command: "aos see list")
        seeListCommand()
    case "selection":
        ensureInteractivePreflight(command: "aos see selection")
        selectionCommand()
    case "zone":
        let subArgs = Array(args.dropFirst())
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["see", "zone"], json: subArgs.contains("--json"))
            exit(0)
        }
        zoneCommand(args: subArgs)
    default:
        ensureInteractivePreflight(command: "aos see \(sub)")
        runCaptureAsync(args: args)
    }
}
```

- [ ] **Step 3: Add --help interception to handleShow**

Replace `handleShow`:

```swift
func handleShow(args: [String]) {
    _ = NSApplication.shared

    guard let sub = args.first else {
        printCommandHelp(["show"], json: false)
        exit(0)
    }

    let subArgs = Array(args.dropFirst())

    switch sub {
    case "--help", "-h":
        printCommandHelp(["show"], json: args.contains("--json"))
        exit(0)
    default:
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["show"], json: subArgs.contains("--json"))
            exit(0)
        }
    }

    switch sub {
    case "render":   renderCommand(args: subArgs)
    case "create":   createCommand(args: subArgs)
    case "update":   updateCommand(args: subArgs)
    case "remove":   removeCommand(args: subArgs)
    case "remove-all": removeAllCommand(args: subArgs)
    case "list":     listCommand(args: subArgs)
    case "eval":     evalCommand(args: subArgs)
    case "listen":   listenCommand(args: subArgs)
    case "ping":     pingCommand(args: subArgs)
    case "exists":   showExistsCommand(args: subArgs)
    case "get":      showGetCommand(args: subArgs)
    case "to-front": toFrontCommand(args: subArgs)
    case "post":     postCommand(args: subArgs)
    default:
        exitError("Unknown show subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
```

- [ ] **Step 4: Add --help interception to handleDo**

Replace `handleDo`:

```swift
func handleDo(args: [String]) {
    guard let sub = args.first else {
        printCommandHelp(["do"], json: false)
        exit(0)
    }

    let subArgs = Array(args.dropFirst())

    switch sub {
    case "--help", "-h":
        printCommandHelp(["do"], json: args.contains("--json"))
        exit(0)
    default:
        if subArgs.contains("--help") || subArgs.contains("-h") {
            printCommandHelp(["do"], json: subArgs.contains("--json"))
            exit(0)
        }
    }

    switch sub {
    case "click":
        ensureInteractivePreflight(command: "aos do click")
        cliClick(args: subArgs)
    case "hover":
        ensureInteractivePreflight(command: "aos do hover")
        cliHover(args: subArgs)
    case "drag":
        ensureInteractivePreflight(command: "aos do drag")
        cliDrag(args: subArgs)
    case "scroll":
        ensureInteractivePreflight(command: "aos do scroll")
        cliScroll(args: subArgs)
    case "type":
        ensureInteractivePreflight(command: "aos do type")
        cliType(args: subArgs)
    case "key":
        ensureInteractivePreflight(command: "aos do key")
        cliKey(args: subArgs)
    case "press":
        ensureInteractivePreflight(command: "aos do press")
        cliPress(args: subArgs)
    case "set-value":
        ensureInteractivePreflight(command: "aos do set-value")
        cliSetValue(args: subArgs)
    case "focus":
        ensureInteractivePreflight(command: "aos do focus")
        cliFocusElement(args: subArgs)
    case "raise":
        ensureInteractivePreflight(command: "aos do raise")
        cliRaise(args: subArgs)
    case "move":
        ensureInteractivePreflight(command: "aos do move")
        cliMove(args: subArgs)
    case "resize":
        ensureInteractivePreflight(command: "aos do resize")
        cliResize(args: subArgs)
    case "tell":
        ensureInteractivePreflight(command: "aos do tell")
        cliTell(args: subArgs)
    case "session":
        ensureInteractivePreflight(command: "aos do session")
        runSession(profileName: getArg(subArgs, "--profile") ?? "natural")
    case "profiles":
        if let name = subArgs.first, name != "list" {
            profilesShowCommand(name: name)
        } else {
            profilesListCommand()
        }
    default:
        exitError("Unknown do subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}
```

- [ ] **Step 5: Add --help interception to leaf command handlers**

Add `--help` checks to each leaf handler. For handlers in `src/commands/`, add at the top of each function:

For `handleSay` in main.swift:
```swift
func handleSay(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["say"], json: args.contains("--json"))
        exit(0)
    }
    sayCommand(args: args)
}
```

For `handleTell`:
```swift
func handleTell(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["tell"], json: args.contains("--json"))
        exit(0)
    }
    tellCommand(args: args)
}
```

For `handleListen`:
```swift
func handleListen(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["listen"], json: args.contains("--json"))
        exit(0)
    }
    listenCommand_coord(args: args)
}
```

For `handleSet`:
```swift
func handleSet(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["set"], json: args.contains("--json"))
        exit(0)
    }
    setCommand(args: args)
}
```

For the inline `focus` block, replace the guard:
```swift
        case "focus":
            let focusArgs = Array(args.dropFirst())
            if focusArgs.contains("--help") || focusArgs.contains("-h") {
                printCommandHelp(["focus"], json: focusArgs.contains("--json"))
                exit(0)
            }
            guard focusArgs.count >= 1 else {
                printCommandHelp(["focus"], json: false)
                exit(0)
            }
            switch focusArgs[0] {
            case "create":  focusCreateCommand(args: Array(focusArgs.dropFirst()))
            case "update":  focusUpdateCommand(args: Array(focusArgs.dropFirst()))
            case "list":    focusListCommand()
            case "remove":  focusRemoveCommand(args: Array(focusArgs.dropFirst()))
            default: exitError("Unknown focus subcommand: \(focusArgs[0])", code: "UNKNOWN_COMMAND")
            }
```

For the inline `graph` block:
```swift
        case "graph":
            let graphArgs = Array(args.dropFirst())
            if graphArgs.contains("--help") || graphArgs.contains("-h") {
                printCommandHelp(["graph"], json: graphArgs.contains("--json"))
                exit(0)
            }
            guard graphArgs.count >= 1 else {
                printCommandHelp(["graph"], json: false)
                exit(0)
            }
            switch graphArgs[0] {
            case "displays":  graphDisplaysCommand()
            case "windows":   graphWindowsCommand(args: Array(graphArgs.dropFirst()))
            case "deepen":    graphDeepenCommand(args: Array(graphArgs.dropFirst()))
            case "collapse":  graphCollapseCommand(args: Array(graphArgs.dropFirst()))
            default: exitError("Unknown graph subcommand: \(graphArgs[0])", code: "UNKNOWN_COMMAND")
            }
```

For `content`:
```swift
        case "content":
            let contentArgs = Array(args.dropFirst())
            if contentArgs.contains("--help") || contentArgs.contains("-h") {
                printCommandHelp(["content"], json: contentArgs.contains("--json"))
                exit(0)
            }
            guard contentArgs.count > 0 else { exitError("Usage: aos content status [--json]", code: "MISSING_SUBCOMMAND") }
            switch contentArgs[0] {
            case "status":
                runContentStatus(Array(contentArgs.dropFirst()))
            default:
                exitError("Unknown content command: \(contentArgs[0])", code: "UNKNOWN_COMMAND")
            }
```

For commands routed to `src/commands/` files, add `--help` check at the top of each command function. These files are:
- `src/commands/service.swift` → `serviceCommand(args:)`
- `src/commands/runtime.swift` → `runtimeCommand(args:)`
- `src/commands/reset.swift` → `resetCommand(args:)`
- `src/commands/clean.swift` → `cleanCommand(args:)`
- `src/commands/operator.swift` → `doctorCommand(args:)` (and `permissionsCommand`)
- `src/commands/inspect.swift` → `inspectCommand(args:)`
- `src/commands/log.swift` → `logCommand(args:)`
- `src/commands/wiki.swift` → `wikiCommand(args:)`

For each, add at the top of the function:

```swift
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["<command-name>"], json: args.contains("--json"))
        exit(0)
    }
```

Replace `<command-name>` with: `service`, `runtime`, `reset`, `clean`, `doctor`, `permissions`, `inspect`, `log`, `wiki` respectively.

- [ ] **Step 6: Delete the old printUsage() function**

Remove the `printUsage()` function from main.swift (lines 91-291 approximately). The registry-driven `printFullRegistryText()` replaces it.

- [ ] **Step 7: Build and test**

Run: `bash build.sh`
Expected: Build succeeds

Run: `./aos help --json | head -20`
Expected: JSON output with `name`, `version`, `commands` array

Run: `./aos help tell --json`
Expected: JSON with 3 forms: tell-message, tell-register, tell-who

Run: `./aos tell --help`
Expected: Text help for tell command

Run: `./aos show create --help`
Expected: Text help for show command (resolves to show, shows create form)

Run: `./aos help`
Expected: Text listing of all commands

Run: `./aos --help`
Expected: Same as `aos help`

- [ ] **Step 8: Commit**

```bash
git add src/main.swift src/commands/service.swift src/commands/runtime.swift src/commands/reset.swift src/commands/clean.swift src/commands/operator.swift src/commands/inspect.swift src/commands/log.swift src/commands/wiki.swift
git commit -m "feat(registry): wire help command and --help interception into all handlers"
```

---

### Task 6: Verify Acceptance Criteria

**Files:**
- None (verification only)

Run through each acceptance criterion from the spec.

- [ ] **Step 1: Agent can choose right form for polymorphic commands**

```bash
./aos help tell --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([f['id'] for f in d['forms']])"
```
Expected: `['tell-message', 'tell-register', 'tell-who']`

```bash
./aos help listen --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([f['id'] for f in d['forms']])"
```
Expected: `['listen-read', 'listen-follow', 'listen-channels']`

```bash
./aos help set --json | python3 -c "import sys,json; d=json.load(sys.stdin); print([f['id'] for f in d['forms']])"
```
Expected: `['set-value', 'set-dump']`

- [ ] **Step 2: Agent can determine execution safety**

```bash
./aos help --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
safe = []
for cmd in d['commands']:
    for form in cmd['forms']:
        ex = form['execution']
        if ex['read_only'] and not ex['requires_permissions']:
            safe.append(form['id'])
print('Safe commands:', safe[:10], '...')
"
```
Expected: List includes tell-who, listen-read, listen-channels, set-dump, show-list, show-ping, etc.

- [ ] **Step 3: Agent can determine stdin support**

```bash
./aos help --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
for cmd in d['commands']:
    for form in cmd['forms']:
        if 'stdin' in form:
            print(f\"{form['id']}: {form['stdin']['used_when']}\")
"
```
Expected: tell-message, say-text, show-render, log-stream

- [ ] **Step 4: Agent can determine output format**

```bash
./aos help --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
for cmd in d['commands']:
    for form in cmd['forms']:
        mode = form['output']['default_mode']
        flag = form['output'].get('supports_json_flag', False)
        if mode != 'json' or flag:
            print(f\"{form['id']}: {mode}\" + (' (+--json)' if flag else ''))
"
```
Expected: Shows text-default commands (service-*, runtime-*) with +--json flag, streaming commands as ndjson

- [ ] **Step 5: Full registry via single call**

```bash
./aos help --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
forms = sum(len(cmd['forms']) for cmd in d['commands'])
print(f\"{len(d['commands'])} commands, {forms} forms\")
"
```
Expected: ~20 commands, ~55 forms

- [ ] **Step 6: Per-command JSON**

```bash
./aos help show --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['forms']), 'forms')"
```
Expected: 12 forms

- [ ] **Step 7: --help works everywhere**

```bash
./aos see --help 2>&1 | head -1
./aos do --help 2>&1 | head -1
./aos show --help 2>&1 | head -1
./aos wiki --help 2>&1 | head -1
./aos service --help 2>&1 | head -1
./aos clean --help 2>&1 | head -1
```
Expected: Each prints help text (not an error)

- [ ] **Step 8: Commit final state**

If any fixes were needed during verification:

```bash
git add -A
git commit -m "fix(registry): address issues found during acceptance verification"
```
