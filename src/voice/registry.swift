import Foundation

enum VoiceID {
    static let prefix = "voice://"

    static func make(provider: String, providerVoiceID: String) -> String {
        precondition(!provider.contains("/"), "provider must not contain '/'")
        precondition(!provider.isEmpty, "provider must not be empty")
        precondition(!providerVoiceID.isEmpty, "providerVoiceID must not be empty")
        return "\(prefix)\(provider)/\(providerVoiceID)"
    }

    static func parse(_ id: String) -> (provider: String, providerVoiceID: String)? {
        guard id.hasPrefix(prefix) else { return nil }
        let body = id.dropFirst(prefix.count)
        guard let slashIdx = body.firstIndex(of: "/") else { return nil }
        let provider = String(body[..<slashIdx])
        let suffix = String(body[body.index(after: slashIdx)...])
        guard !provider.isEmpty, !suffix.isEmpty else { return nil }
        return (provider, suffix)
    }

    static func canonicalize(_ rawID: String) -> String {
        if rawID.hasPrefix(VoiceID.prefix) { return rawID }
        return VoiceID.make(provider: "system", providerVoiceID: rawID)
    }
}

struct VoiceCapabilities: Codable, Equatable {
    var local: Bool
    var streaming: Bool
    var ssml: Bool
    var speak_supported: Bool

    static let unknown = VoiceCapabilities(local: false, streaming: false, ssml: false, speak_supported: false)
}

struct VoiceAvailability: Codable, Equatable {
    var installed: Bool
    var enabled: Bool
    var reachable: Bool

    var allocatable: Bool { installed && enabled && reachable }
}

struct VoiceRecord: Codable, Equatable {
    var id: String
    var provider: String
    var provider_voice_id: String
    var name: String
    var display_name: String?
    var locale: String?
    var language: String?
    var region: String?
    var gender: String
    var kind: String
    var quality_tier: String
    var tags: [String]
    var capabilities: VoiceCapabilities
    var availability: VoiceAvailability
    var metadata: [String: AnyCodableJSON]

    var isAllocatable: Bool { availability.allocatable && capabilities.speak_supported }
}

struct ProviderAvailability: Codable, Equatable {
    var reachable: Bool
    var reason: String?
}

/// JSON-safe value passthrough for VoiceRecord.metadata. Restricts to scalars + arrays + objects.
enum AnyCodableJSON: Codable, Equatable {
    case string(String), int(Int), double(Double), bool(Bool), null
    case array([AnyCodableJSON]), object([String: AnyCodableJSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self) { self = .bool(v); return }
        if let v = try? c.decode(Int.self) { self = .int(v); return }
        if let v = try? c.decode(Double.self) { self = .double(v); return }
        if let v = try? c.decode(String.self) { self = .string(v); return }
        if let v = try? c.decode([AnyCodableJSON].self) { self = .array(v); return }
        if let v = try? c.decode([String: AnyCodableJSON].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "unsupported JSON type")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    var asAny: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let v): return v
        case .int(let v): return v
        case .double(let v): return v
        case .string(let v): return v
        case .array(let v): return v.map { $0.asAny }
        case .object(let v): return v.mapValues { $0.asAny }
        }
    }
}

extension VoiceRecord {
    /// Stable JSON dictionary for envelope payloads.
    func dictionary() -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self),
              let any = try? JSONSerialization.jsonObject(with: data),
              let dict = any as? [String: Any] else { return [:] }
        return dict
    }
}
