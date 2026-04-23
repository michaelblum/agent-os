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
