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
