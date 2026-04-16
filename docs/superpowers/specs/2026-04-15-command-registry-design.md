# Command Registry: Agent-First CLI Introspection

**Date:** 2026-04-15
**Status:** Draft
**Goal:** Let an agent choose a valid command form, know whether it's safe to run, know how to supply input, and know what kind of output to expect.

## Problem

`aos` is a CLI designed for agents. But agents can't discover the CLI without:
- Reading 280 lines of static docs (CLAUDE.md)
- Failing with `--help` and parsing error messages
- Guessing argument shapes for polymorphic commands

This is the opposite of agent-first design.

## Solution: Discovery-Oriented Command Contract

A static command registry that exposes structured metadata via `aos help [command-path...] [--json]`. Not a CLI framework — an introspection layer.

### What v1 Is

An agent introspection surface. Agents can:
- Discover all commands and valid invocation forms
- Determine execution safety (read-only, mutating, permissions-gated)
- Know input channels (args, stdin)
- Know output shape (json, text, ndjson stream)

### What v1 Is Not

- Not a CLI framework or argument parser
- Not a validation engine — constraints are metadata, not enforced by the registry
- Not "single source of truth" — until the registry participates in validation, drift risk exists
- Not "no guess-and-fail" — covers the common cases, not every composite string format

## Data Model

```swift
struct CommandDescriptor {
    let path: [String]              // e.g. ["show", "create"]
    let summary: String
    let forms: [InvocationForm]
}

struct InvocationForm {
    let id: String                  // e.g. "tell-message", "tell-who"
    let usage: String               // human-readable usage string
    let args: [ArgDescriptor]
    let stdin: StdinDescriptor?
    let constraints: ConstraintSet?
    let execution: ExecutionMeta
    let output: OutputMeta
    let examples: [String]
}

struct ArgDescriptor {
    let id: String                  // stable identifier
    let kind: ArgKind               // .positional or .flag
    let token: String?              // flag token, e.g. "--out" (nil for positional)
    let summary: String
    let valueType: ValueType        // .string, .int, .bool, .float, .json, .enum([EnumValue])
    let required: Bool
    let defaultValue: JSONValue?     // typed default (see JSONValue enum below)
    let variadic: Bool              // can appear multiple times or accept multiple values
    let discovery: [DiscoverySource]? // where valid values come from (multiple sources OK)
}

/// Type-safe JSON values for defaults and other metadata.
/// Avoids `Any` — serialization and validation are clean.
enum JSONValue {
    case string(String)
    case int(Int)
    case float(Double)
    case bool(Bool)
    case null
}

/// Where an arg's valid values come from. Supports static values,
/// runtime discovery commands, and mixed sources.
enum DiscoverySource {
    case staticValues([String])                   // known at build time, e.g. ["human"]
    case command(path: [String], formId: String)   // registry reference, e.g. path: ["tell"], formId: "tell-who"
}

enum ArgKind { case positional, flag }

enum ValueType {
    case string, int, bool, float, json
    case enumeration([EnumValue])
}

struct EnumValue {
    let value: String
    let summary: String             // semantic context for when to use this value
}

struct StdinDescriptor {
    let supported: Bool
    let usedWhen: String            // e.g. "no text and no --json"
    let contentType: String         // e.g. "text", "ndjson", "html"
}

/// Constraint IDs reference `ArgDescriptor.id` values.
/// The reserved ID `"stdin"` refers to stdin input (modeled in StdinDescriptor).
/// This allows constraints to express relationships between args and stdin
/// without collapsing stdin into the args array.
struct ConstraintSet {
    let requires: [[String]]?       // arg groups where all must be present
    let conflicts: [[String]]?      // arg pairs that can't coexist
    let oneOf: [[String]]?          // exactly one from group required
    let implies: [String: [String]]? // arg presence implies others
}

struct ExecutionMeta {
    let readOnly: Bool
    let mutatesState: Bool
    let interactive: Bool           // blocks waiting for user input
    let streaming: Bool             // long-running output stream
    let autoStartsDaemon: Bool
    let requiresPermissions: Bool   // AX/screen recording gated
    let supportsDryRun: Bool
}

struct OutputMeta {
    let defaultMode: OutputMode     // output format without flags
    let streaming: Bool
    let supportsJsonFlag: Bool      // command has --json for structured output
    let errorMode: String           // "json_stderr" (all commands use this)
}

enum OutputMode { case json, text, ndjson, none }
```

## CLI Interface

| Command | Output | Use case |
|---------|--------|----------|
| `aos help` | Full text help | Human browsing |
| `aos help --json` | Full command tree as JSON | Agent introspection — call once per session |
| `aos help <command-path...>` | Text help for one command | Quick lookup (e.g. `aos help show create`) |
| `aos help <command-path...> --json` | JSON for one command | Agent drilling (e.g. `aos help show create --json`) |
| `aos <command-path...> --help` | Same as `aos help <command-path...>` | Muscle memory (e.g. `aos show create --help`) |

## JSON Output Shape

```json
{
  "name": "aos",
  "version": "0.1.0",
  "commands": [
    {
      "path": ["tell"],
      "summary": "Send or register coordination messages",
      "forms": [
        {
          "id": "tell-message",
          "usage": "aos tell <audience> [--json <payload>] [--from <name>] [<text> | stdin]",
          "args": [
            {
              "id": "audience",
              "kind": "positional",
              "summary": "Target: human, channel name, or session name",
              "value_type": "string",
              "required": true,
              "discovery": [
                { "static": ["human"] },
                { "command": { "path": ["listen"], "form_id": "listen-channels" } },
                { "command": { "path": ["tell"], "form_id": "tell-who" } }
              ]
            },
            {
              "id": "json",
              "kind": "flag",
              "token": "--json",
              "summary": "Send structured JSON payload instead of text",
              "value_type": "json"
            },
            {
              "id": "from",
              "kind": "flag",
              "token": "--from",
              "summary": "Identify sender name",
              "value_type": "string"
            },
            {
              "id": "text",
              "kind": "positional",
              "summary": "Message text (alternative to stdin or --json)",
              "value_type": "string",
              "variadic": true
            }
          ],
          "stdin": {
            "supported": true,
            "used_when": "no text and no --json",
            "content_type": "text"
          },
          "constraints": {
            "one_of": [["text", "stdin", "json"]]
          },
          "execution": {
            "read_only": false,
            "mutates_state": true,
            "interactive": false,
            "streaming": false,
            "auto_starts_daemon": true,
            "requires_permissions": false,
            "supports_dry_run": false
          },
          "output": {
            "default_mode": "json",
            "streaming": false,
            "supports_json_flag": false,
            "error_mode": "json_stderr"
          },
          "examples": [
            "aos tell human \"Found the bug\"",
            "aos tell handoff \"task complete\" --from my-session",
            "echo 'status update' | aos tell handoff"
          ]
        },
        {
          "id": "tell-register",
          "usage": "aos tell --register <name> [--role <role>] [--harness <harness>]",
          "args": [
            {
              "id": "register",
              "kind": "flag",
              "token": "--register",
              "summary": "Register session presence with this name",
              "value_type": "string",
              "required": true
            },
            {
              "id": "role",
              "kind": "flag",
              "token": "--role",
              "summary": "Session role",
              "value_type": { "enum": [
                { "value": "worker", "summary": "Default worker session" },
                { "value": "coordinator", "summary": "Orchestrating session" },
                { "value": "observer", "summary": "Read-only monitoring session" }
              ]},
              "default_value": "worker"
            },
            {
              "id": "harness",
              "kind": "flag",
              "token": "--harness",
              "summary": "Agent harness identifier",
              "value_type": "string",
              "default_value": "unknown"
            }
          ],
          "execution": {
            "read_only": false,
            "mutates_state": true,
            "interactive": false,
            "streaming": false,
            "auto_starts_daemon": true,
            "requires_permissions": false,
            "supports_dry_run": false
          },
          "output": {
            "default_mode": "json",
            "streaming": false,
            "supports_json_flag": false,
            "error_mode": "json_stderr"
          },
          "examples": [
            "aos tell --register my-session",
            "aos tell --register builder --role worker --harness claude-code"
          ]
        },
        {
          "id": "tell-who",
          "usage": "aos tell --who",
          "args": [
            {
              "id": "who",
              "kind": "flag",
              "token": "--who",
              "summary": "List online sessions",
              "value_type": "bool",
              "required": true
            }
          ],
          "execution": {
            "read_only": true,
            "mutates_state": false,
            "interactive": false,
            "streaming": false,
            "auto_starts_daemon": true,
            "requires_permissions": false,
            "supports_dry_run": false
          },
          "output": {
            "default_mode": "json",
            "streaming": false,
            "supports_json_flag": false,
            "error_mode": "json_stderr"
          },
          "examples": ["aos tell --who"]
        }
      ]
    }
  ]
}
```

## File Layout

```
src/shared/
  command-registry.swift       # CommandDescriptor, InvocationForm, ArgDescriptor, etc.
  command-registry-data.swift  # Static registry: all commands defined here
  command-help.swift           # Text formatter, JSON serializer, help command handler
```

## Integration

### `--help` Interception

Each handler resolves the subcommand first, then checks for `--help`. This ensures
`aos show create --help` resolves to `["show", "create"]`, not `["show"]`:

```swift
func handleShow(args: [String]) {
    guard let sub = args.first else {
        // No subcommand — show help for parent
        printCommandHelp(["show"], json: args.contains("--json"))
        exit(0)
    }

    // Resolve subcommand, then check for --help
    let subArgs = Array(args.dropFirst())
    if subArgs.contains("--help") || subArgs.contains("-h") {
        printCommandHelp(["show", sub], json: subArgs.contains("--json"))
        exit(0)
    }

    switch sub {
    case "--help", "-h":
        printCommandHelp(["show"], json: args.contains("--json"))
        exit(0)
    // ... existing routing
    }
}
```

For leaf commands (no subcommands), check `--help` before any arg parsing:

```swift
func resetCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["reset"], json: args.contains("--json"))
        exit(0)
    }
    // existing logic
}
```

### `help` Command

New top-level command in main.swift:

```swift
case "help":
    helpCommand(args: Array(args.dropFirst()))
```

### Replacing `printUsage()`

`printUsage()` walks the registry and formats text output. The 200-line string literal goes away. `--help` at the top level still works.

## Wire Format

The JSON output from `aos help --json` uses these conventions:

- **Keys:** `snake_case` (e.g. `value_type`, `default_mode`, `auto_starts_daemon`)
- **Enums:** serialized as lowercase strings (e.g. `"positional"`, `"flag"`, `"json"`, `"text"`)
- **Typed defaults:** `default_value` carries the native JSON type — `"worker"` (string), `50` (int), `true` (bool), not everything-as-string. Swift model uses `JSONValue` enum, not `Any`
- **Nested types:** inline objects, not `$ref`-style indirection
- **Enum value types:** `value_type` is either a string (`"string"`, `"int"`, `"bool"`, `"float"`, `"json"`) or an object `{"enum": [{"value": "...", "summary": "..."}]}` for enumerated values
- **Discovery sources:** array of `{"static": [...]}` and/or `{"command": {"path": [...], "form_id": "..."}}` entries. Supports mixed-provenance values (e.g. audience = static "human" + dynamic channels + dynamic sessions)
- **Constraint reserved IDs:** `"stdin"` is a reserved constraint ID referencing `StdinDescriptor`, documented in-schema
- **Nulls:** omitted fields mean "not applicable" (e.g. no `stdin` key if stdin not supported), not `null`

Swift model uses `camelCase` internally; the JSON serializer translates to `snake_case` on output.

## Scope

### In v1

- `CommandDescriptor` / `InvocationForm` / `ArgDescriptor` types
- Static registry covering all commands (~15 top-level, ~40 with subcommands)
- `aos help [command-path...] [--json]` command
- `--help` interception in each handler
- Execution metadata on every form
- Output metadata on every form
- Stdin metadata where applicable
- Simple constraints (requires, conflicts, one_of, implies)
- Discovery pointers for runtime values (channels, voices, zones)
- Replace `printUsage()` with registry-driven formatter

### Out of v1

- Registry-driven parsing/validation (commands still parse their own args)
- Shell completions from registry
- MCP schema export
- Exhaustive grammar for composite string formats (x,y,w,h etc.)
- Output schema (full JSON Schema for response shapes)

### v2 Candidates

- Registry participates in validation → becomes actual source of truth
- MCP-compatible tool schema export (`aos describe --mcp`)
- Output JSON schemas for machine parsing
- Shell completion generation

## Acceptance Criteria

1. Agent can choose the right form for `tell`, `listen`, `set`, `show render`, and `show create` without probing
2. Agent can determine which commands are safe to run unattended (read-only, no permissions needed)
3. Agent can determine when stdin is a valid input channel
4. Agent can determine whether output is parseable JSON, plain text, or a stream
5. `aos help --json` returns complete command tree — one call gives full introspection
6. `aos help <command-path...> --json` returns forms for a specific command (e.g. `aos help show create --json`)
7. `aos <command-path...> --help` works for every command (e.g. `aos show create --help`)
8. All `exitError("Usage: ...")` strings replaced with registry-driven messages

## Design Attribution

This design was refined through cross-agent review:
- **Gemini** identified: positional/flag distinction, argument constraints, output contracts, enum descriptions
- **Codex** identified: invocation forms (the key structural insight), execution safety metadata, dynamic value discovery, stdin channels, drift risk honesty
- Design synthesis and scoping by the authoring session
