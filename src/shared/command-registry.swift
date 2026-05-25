// command-registry.swift — Command registry types and JSON serialization

import Foundation

// MARK: - Registry Types

struct CommandDescriptor: Decodable {
    let path: [String]
    let summary: String
    let forms: [InvocationForm]
}

struct InvocationForm: Decodable {
    let id: String
    let usage: String
    let args: [ArgDescriptor]
    let stdin: StdinDescriptor?
    let constraints: ConstraintSet?
    let execution: ExecutionMeta
    let output: OutputMeta
    let examples: [String]
}

struct ArgDescriptor: Decodable {
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

enum ArgKind: String, Decodable { case positional, flag }

enum ValueType {
    case string, int, bool, float, json
    case enumeration([EnumValue])
}

struct EnumValue: Decodable {
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

struct StdinDescriptor: Decodable {
    let supported: Bool
    let usedWhen: String
    let contentType: String
}

struct ConstraintSet: Decodable {
    let requires: [[String]]?
    let conflicts: [[String]]?
    let oneOf: [[String]]?
    let implies: [String: [String]]?
}

struct ExecutionMeta: Decodable {
    let readOnly: Bool
    let mutatesState: Bool
    let interactive: Bool
    let streaming: Bool
    let autoStartsDaemon: Bool
    let requiresPermissions: Bool
    let supportsDryRun: Bool
}

struct OutputMeta: Decodable {
    let defaultMode: OutputMode
    let streaming: Bool
    let supportsJsonFlag: Bool
    let errorMode: String
}

enum OutputMode: String, Decodable { case json, text, ndjson, none }

private struct CommandRegistryManifest: Decodable {
    let commands: [CommandDescriptor]
}

private enum CommandRegistryCodingKeys: String, CodingKey {
    case path
    case summary
    case forms
    case id
    case usage
    case args
    case stdin
    case constraints
    case execution
    case output
    case examples
    case kind
    case token
    case valueType = "value_type"
    case required
    case defaultValue = "default_value"
    case variadic
    case discovery
    case usedWhen = "used_when"
    case contentType = "content_type"
    case requires
    case conflicts
    case oneOf = "one_of"
    case implies
    case readOnly = "read_only"
    case mutatesState = "mutates_state"
    case interactive
    case streaming
    case autoStartsDaemon = "auto_starts_daemon"
    case requiresPermissions = "requires_permissions"
    case supportsDryRun = "supports_dry_run"
    case defaultMode = "default_mode"
    case supportsJsonFlag = "supports_json_flag"
    case errorMode = "error_mode"
    case supported
}

private struct EnumValueWrapper: Decodable {
    let `enum`: [EnumValue]
}

private struct CommandDiscoveryWrapper: Decodable {
    let path: [String]
    let formId: String

    enum CodingKeys: String, CodingKey {
        case path
        case formId = "form_id"
    }
}

private struct DiscoverySourceWrapper: Decodable {
    let `static`: [String]?
    let command: CommandDiscoveryWrapper?
}

func buildCommandRegistry() -> [CommandDescriptor] {
    if let registry = loadExternalCommandRegistry() {
        return registry
    }
    return buildCompiledCommandRegistry()
}

private func loadExternalCommandRegistry() -> [CommandDescriptor]? {
    let env = ProcessInfo.processInfo.environment
    let candidates = [
        env["AOS_COMMAND_REGISTRY"],
        (aosCurrentRepoRoot().map { ($0 as NSString).appendingPathComponent("manifests/commands/aos-commands.json") }),
        (Bundle.main.resourcePath.map { ($0 as NSString).appendingPathComponent("manifests/commands/aos-commands.json") }),
    ].compactMap { $0 }

    for path in candidates {
        guard FileManager.default.fileExists(atPath: path),
              let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else {
            continue
        }
        do {
            return try JSONDecoder().decode(CommandRegistryManifest.self, from: data).commands
        } catch {
            exitError("Invalid command registry manifest \(path): \(error)", code: "INVALID_COMMAND_REGISTRY")
        }
    }
    return nil
}

extension CommandDescriptor {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        path = try container.decode([String].self, forKey: .path)
        summary = try container.decode(String.self, forKey: .summary)
        forms = try container.decode([InvocationForm].self, forKey: .forms)
    }
}

extension InvocationForm {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        usage = try container.decode(String.self, forKey: .usage)
        args = try container.decode([ArgDescriptor].self, forKey: .args)
        stdin = try container.decodeIfPresent(StdinDescriptor.self, forKey: .stdin)
        constraints = try container.decodeIfPresent(ConstraintSet.self, forKey: .constraints)
        execution = try container.decode(ExecutionMeta.self, forKey: .execution)
        output = try container.decode(OutputMeta.self, forKey: .output)
        examples = try container.decodeIfPresent([String].self, forKey: .examples) ?? []
    }
}

extension ArgDescriptor {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(ArgKind.self, forKey: .kind)
        token = try container.decodeIfPresent(String.self, forKey: .token)
        summary = try container.decode(String.self, forKey: .summary)
        valueType = try container.decode(ValueType.self, forKey: .valueType)
        required = try container.decode(Bool.self, forKey: .required)
        defaultValue = try container.decodeIfPresent(JSONValue.self, forKey: .defaultValue)
        variadic = try container.decodeIfPresent(Bool.self, forKey: .variadic) ?? false
        discovery = try container.decodeIfPresent([DiscoverySource].self, forKey: .discovery)
    }
}

extension ValueType: Decodable {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let raw = try? container.decode(String.self) {
            switch raw {
            case "string": self = .string
            case "int": self = .int
            case "bool": self = .bool
            case "float": self = .float
            case "json": self = .json
            default:
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unknown value_type \(raw)")
            }
            return
        }
        let wrapped = try container.decode(EnumValueWrapper.self)
        self = .enumeration(wrapped.enum)
    }
}

extension JSONValue: Decodable {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .float(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }
}

extension DiscoverySource: Decodable {
    init(from decoder: Decoder) throws {
        let wrapper = try DiscoverySourceWrapper(from: decoder)
        if let values = wrapper.static {
            self = .staticValues(values)
            return
        }
        if let command = wrapper.command {
            self = .command(path: command.path, formId: command.formId)
            return
        }
        let container = try decoder.singleValueContainer()
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Expected static or command discovery source")
    }
}

extension StdinDescriptor {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        supported = try container.decode(Bool.self, forKey: .supported)
        usedWhen = try container.decode(String.self, forKey: .usedWhen)
        contentType = try container.decode(String.self, forKey: .contentType)
    }
}

extension ConstraintSet {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        requires = try container.decodeIfPresent([[String]].self, forKey: .requires)
        conflicts = try container.decodeIfPresent([[String]].self, forKey: .conflicts)
        oneOf = try container.decodeIfPresent([[String]].self, forKey: .oneOf)
        implies = try container.decodeIfPresent([String: [String]].self, forKey: .implies)
    }
}

extension ExecutionMeta {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        readOnly = try container.decode(Bool.self, forKey: .readOnly)
        mutatesState = try container.decode(Bool.self, forKey: .mutatesState)
        interactive = try container.decode(Bool.self, forKey: .interactive)
        streaming = try container.decode(Bool.self, forKey: .streaming)
        autoStartsDaemon = try container.decode(Bool.self, forKey: .autoStartsDaemon)
        requiresPermissions = try container.decode(Bool.self, forKey: .requiresPermissions)
        supportsDryRun = try container.decode(Bool.self, forKey: .supportsDryRun)
    }
}

extension OutputMeta {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CommandRegistryCodingKeys.self)
        defaultMode = try container.decode(OutputMode.self, forKey: .defaultMode)
        streaming = try container.decode(Bool.self, forKey: .streaming)
        supportsJsonFlag = try container.decode(Bool.self, forKey: .supportsJsonFlag)
        errorMode = try container.decode(String.self, forKey: .errorMode)
    }
}

// MARK: - JSON Serialization

extension CommandDescriptor {
    func toJSON() -> [String: Any] {
        return [
            "path": path,
            "summary": summary,
            "forms": forms.map { $0.toJSON() }
        ]
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
