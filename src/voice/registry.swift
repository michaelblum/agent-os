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

struct ProviderInfo: Codable {
    let name: String
    let rank: Int
    let availability: ProviderAvailability
    let voice_count: Int
    let enabled: Bool

    func dictionary() -> [String: Any] {
        return [
            "name": name,
            "rank": rank,
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
            providers.append(MockVoiceProvider(name: "mock", providerRank: 5))
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
                rank: p.providerRank,
                availability: p.availability,
                voice_count: voices.count,
                enabled: enabled
            )
        }.sorted { $0.rank < $1.rank }
    }

    func snapshot() -> [VoiceRecord] {
        let policy = policyLoader()
        let disabledURIs = Set(policy?.voices.disabled ?? [])
        let promoteOrder: [String: Int] = {
            var out: [String: Int] = [:]
            for (idx, uri) in (policy?.voices.promote ?? []).enumerated() { out[uri] = idx }
            return out
        }()

        var combined: [(record: VoiceRecord, providerRank: Int)] = []
        for p in providers {
            let providerEnabled = policy?.providers[p.name]?.enabled ?? true
            for var rec in p.enumerate() {
                if !providerEnabled || disabledURIs.contains(rec.id) {
                    rec.availability.enabled = false
                }
                combined.append((rec, p.providerRank))
            }
        }

        return combined.sorted { lhs, rhs in
            let lp = promoteOrder[lhs.record.id]
            let rp = promoteOrder[rhs.record.id]
            switch (lp, rp) {
            case let (l?, r?): if l != r { return l < r }
            case (_?, nil): return true
            case (nil, _?): return false
            default: break
            }
            if lhs.providerRank != rhs.providerRank { return lhs.providerRank < rhs.providerRank }
            let lq = qualityWeight(lhs.record.quality_tier)
            let rq = qualityWeight(rhs.record.quality_tier)
            if lq != rq { return lq > rq }
            return lhs.record.name < rhs.record.name
        }.map { $0.record }
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

    private func qualityWeight(_ tier: String) -> Int {
        switch tier {
        case "premium": return 3
        case "enhanced": return 2
        case "standard": return 1
        default: return 0
        }
    }
}

// TEMP stub — replaced in Task 9 by full type in src/voice/policy.swift.
// Keep registry compilable until policy.swift lands.
struct VoicePolicy {
    struct ProviderEntry { var enabled: Bool }
    struct VoicesSection { var disabled: [String]; var promote: [String] }
    var providers: [String: ProviderEntry] = [:]
    var voices: VoicesSection = VoicesSection(disabled: [], promote: [])
    var session_preferences: [String: String] = [:]
}
