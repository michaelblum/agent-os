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

struct VoiceFilter {
    var provider: String?
    var gender: String?
    var locale: String?
    var language: String?
    var region: String?
    var kind: String?
    var quality_tier: String?
    var tags: [String] = []

    var isEmpty: Bool {
        provider == nil
            && gender == nil
            && locale == nil
            && language == nil
            && region == nil
            && kind == nil
            && quality_tier == nil
            && tags.isEmpty
    }
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

struct ProviderInfo: Codable {
    let name: String
    let availability: ProviderAvailability
    let voice_count: Int
    let enabled: Bool

    func dictionary() -> [String: Any] {
        return [
            "name": name,
            "availability": [
                "reachable": availability.reachable,
                "reason": availability.reason as Any
            ].compactMapValues { ($0 is NSNull) ? nil : $0 },
            "voice_count": voice_count,
            "enabled": enabled
        ]
    }
}

final class VoiceRegistry {
    private let providers: [VoiceProvider]
    private let policyLoader: () -> VoicePolicy?

    init(providers: [VoiceProvider]? = nil, policyLoader: @escaping () -> VoicePolicy?) {
        self.providers = providers ?? VoiceRegistry.defaultProviders()
        self.policyLoader = policyLoader
    }

    static func defaultProviders() -> [VoiceProvider] {
        var providers: [VoiceProvider] = [SystemVoiceProvider(), ElevenLabsStubProvider()]
        let env = ProcessInfo.processInfo.environment["AOS_VOICE_TEST_PROVIDERS"]
        if env == "mock" {
            providers.append(MockVoiceProvider(name: "mock"))
        }
        return providers
    }

    func providersInfo() -> [ProviderInfo] {
        let policy = policyLoader()
        return providers.map { p in
            let voices = p.enumerate()
            let enabled = policy?.providers[p.name]?.enabled ?? true
            return ProviderInfo(
                name: p.name,
                availability: p.availability,
                voice_count: voices.count,
                enabled: enabled
            )
        }.sorted { lhs, rhs in
            if lhs.name != rhs.name {
                return lhs.name < rhs.name
            }
            return lhs.voice_count < rhs.voice_count
        }
    }

    func snapshot() -> [VoiceRecord] {
        let policy = policyLoader()
        let disabledURIs = Set(policy?.voices.disabled ?? [])

        var combined: [VoiceRecord] = []
        for p in providers {
            let providerEnabled = policy?.providers[p.name]?.enabled ?? true
            for var rec in p.enumerate() {
                if !providerEnabled || disabledURIs.contains(rec.id) {
                    rec.availability.enabled = false
                }
                combined.append(rec)
            }
        }

        return combined.sorted { lhs, rhs in
            if lhs.provider != rhs.provider {
                return lhs.provider < rhs.provider
            }
            if lhs.name != rhs.name {
                return lhs.name < rhs.name
            }
            return lhs.provider_voice_id < rhs.provider_voice_id
        }
    }

    func lookup(_ uri: String) -> VoiceRecord? {
        let canonical = VoiceID.canonicalize(uri)
        return snapshot().first { $0.id == canonical }
    }

    func contains(_ uri: String) -> Bool { lookup(uri) != nil }

    func refresh() -> [VoiceRecord] { snapshot() }

    func allocatableSnapshot() -> [VoiceRecord] {
        snapshot().filter { $0.isAllocatable }
    }

    func snapshot(matching filter: VoiceFilter) -> [VoiceRecord] {
        snapshot().filter { record in
            matches(record: record, filter: filter)
        }
    }

    func allocatableSnapshot(matching filter: VoiceFilter) -> [VoiceRecord] {
        snapshot(matching: filter).filter { $0.isAllocatable }
    }

    private func matches(record: VoiceRecord, filter: VoiceFilter) -> Bool {
        if let provider = filter.provider, record.provider.caseInsensitiveCompare(provider) != .orderedSame {
            return false
        }
        if let gender = filter.gender, record.gender.caseInsensitiveCompare(gender) != .orderedSame {
            return false
        }
        if let locale = filter.locale, (record.locale ?? "").caseInsensitiveCompare(locale) != .orderedSame {
            return false
        }
        if let language = filter.language, (record.language ?? "").caseInsensitiveCompare(language) != .orderedSame {
            return false
        }
        if let region = filter.region, (record.region ?? "").caseInsensitiveCompare(region) != .orderedSame {
            return false
        }
        if let kind = filter.kind, record.kind.caseInsensitiveCompare(kind) != .orderedSame {
            return false
        }
        if let qualityTier = filter.quality_tier, record.quality_tier.caseInsensitiveCompare(qualityTier) != .orderedSame {
            return false
        }
        if !filter.tags.isEmpty {
            let availableTags = Set(record.tags.map { $0.lowercased() })
            for tag in filter.tags.map({ $0.lowercased() }) {
                if !availableTags.contains(tag) {
                    return false
                }
            }
        }
        return true
    }
}
