import Foundation
import NaturalLanguage

struct SessionVoiceDescriptor: Codable {
    let provider: String
    let id: String
    let name: String
    let locale: String
    let gender: String
    let quality_tier: String
    let available: Bool
    let lease_session_id: String?
    let lease_session_name: String?

    init(
        provider: String,
        id: String,
        name: String,
        locale: String,
        gender: String,
        quality_tier: String,
        available: Bool = true,
        lease_session_id: String? = nil,
        lease_session_name: String? = nil
    ) {
        self.provider = provider
        self.id = id
        self.name = name
        self.locale = locale
        self.gender = gender
        self.quality_tier = quality_tier
        self.available = available
        self.lease_session_id = lease_session_id
        self.lease_session_name = lease_session_name
    }

    init(voiceInfo: SpeechEngine.VoiceInfo, leaseSessionID: String? = nil, leaseSessionName: String? = nil) {
        self.init(
            provider: voiceInfo.provider,
            id: voiceInfo.id,
            name: voiceInfo.name,
            locale: voiceInfo.language,
            gender: voiceInfo.gender,
            quality_tier: voiceInfo.quality_tier,
            available: true,
            lease_session_id: leaseSessionID,
            lease_session_name: leaseSessionName
        )
    }

    func withLease(sessionID: String?, sessionName: String?) -> SessionVoiceDescriptor {
        SessionVoiceDescriptor(
            provider: provider,
            id: id,
            name: name,
            locale: locale,
            gender: gender,
            quality_tier: quality_tier,
            available: available,
            lease_session_id: sessionID,
            lease_session_name: sessionName
        )
    }

    func dictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "provider": provider,
            "id": id,
            "name": name,
            "locale": locale,
            "gender": gender,
            "quality_tier": quality_tier,
            "available": available
        ]
        if let lease_session_id {
            payload["lease_session_id"] = lease_session_id
        }
        if let lease_session_name {
            payload["lease_session_name"] = lease_session_name
        }
        return payload
    }
}

struct VoiceRenderResult {
    let text: String
    let purpose: String?
    let style: String
    let fallback_style: String?

    func dictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "text": text,
            "style": style,
            "characters": text.count
        ]
        if let purpose {
            payload["purpose"] = purpose
        }
        if let fallback_style {
            payload["fallback_style"] = fallback_style
        }
        return payload
    }
}

enum SessionVoiceBank {
    private struct PreferredVoiceMatcher {
        let id: String?
        let name: String?
    }

    private static let preferredVoices = [
        PreferredVoiceMatcher(id: "com.apple.voice.premium.en-US.Zoe", name: "Zoe"),
        PreferredVoiceMatcher(id: "com.apple.voice.premium.en-US.Ava", name: "Ava"),
        PreferredVoiceMatcher(id: "com.apple.ttsbundle.gryphon-neuralAX_Damon_en-US_premium", name: "Voice 3"),
        PreferredVoiceMatcher(id: "com.apple.voice.premium.en-GB.Malcolm", name: "Jamie")
    ]

    static func curatedVoices() -> [SessionVoiceDescriptor] {
        let discovered = SpeechEngine.availableVoices()
        let eligible = discovered.filter { voice in
            let tier = voice.quality_tier
            guard tier == "premium" || tier == "enhanced" else { return false }
            let locale = voice.language.lowercased()
            return locale.hasPrefix("en")
        }

        var ordered: [SpeechEngine.VoiceInfo] = []
        var seen = Set<String>()

        for matcher in preferredVoices {
            if let match = eligible.first(where: { voice in
                if let id = matcher.id, voice.id == id { return true }
                if let name = matcher.name, voice.name == name { return true }
                return false
            }), seen.insert(match.id).inserted {
                ordered.append(match)
            }
        }

        let remaining = eligible
            .filter { !seen.contains($0.id) }
            .sorted { lhs, rhs in
                let lhsQuality = voiceQualityWeight(lhs.quality_tier)
                let rhsQuality = voiceQualityWeight(rhs.quality_tier)
                if lhsQuality != rhsQuality {
                    return lhsQuality > rhsQuality
                }
                if lhs.gender != rhs.gender {
                    return lhs.gender < rhs.gender
                }
                if lhs.language != rhs.language {
                    return lhs.language < rhs.language
                }
                return lhs.name < rhs.name
            }

        ordered.append(contentsOf: remaining)
        return ordered.map { SessionVoiceDescriptor(voiceInfo: $0) }
    }

    static func hasVoice(id: String) -> Bool {
        curatedVoices().contains { $0.id == id }
    }

    static func voice(id: String) -> SessionVoiceDescriptor? {
        curatedVoices().first { $0.id == id }
    }

    private static func voiceQualityWeight(_ quality: String) -> Int {
        switch quality {
        case "premium":
            return 3
        case "enhanced":
            return 2
        default:
            return 1
        }
    }
}

func effectiveSpeechCancelKeyCode(config: AosConfig) -> UInt16? {
    if let controls = config.voice.controls, let cancel = controls.cancel {
        return cancel.key_code
    }
    return config.hotkeys?.cancel_speech ?? 53
}

func renderSpeechText(rawText: String, purpose: String?, config: AosConfig) -> VoiceRenderResult {
    let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return VoiceRenderResult(text: "", purpose: purpose, style: "empty", fallback_style: nil)
    }

    guard purpose == "final_response" else {
        return VoiceRenderResult(text: trimmed, purpose: purpose, style: "full", fallback_style: nil)
    }

    let policy = effectiveFinalResponsePolicy(config)
    switch policy.style {
    case "full":
        return VoiceRenderResult(text: trimmed, purpose: purpose, style: "full", fallback_style: nil)
    case "last_n_chars":
        return VoiceRenderResult(
            text: tailCharacters(trimmed, count: policy.last_n_chars),
            purpose: purpose,
            style: "last_n_chars",
            fallback_style: nil
        )
    default:
        if let sentence = lastSentence(from: trimmed) {
            return VoiceRenderResult(text: sentence, purpose: purpose, style: "last_sentence", fallback_style: nil)
        }
        return VoiceRenderResult(
            text: tailCharacters(trimmed, count: policy.last_n_chars),
            purpose: purpose,
            style: "last_sentence",
            fallback_style: "last_n_chars"
        )
    }
}

private func lastSentence(from text: String) -> String? {
    let tokenizer = NLTokenizer(unit: .sentence)
    tokenizer.string = text

    var last: String?
    tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
        let sentence = text[range].trimmingCharacters(in: .whitespacesAndNewlines)
        if !sentence.isEmpty {
            last = sentence
        }
        return true
    }
    return last
}

private func tailCharacters(_ text: String, count: Int) -> String {
    guard count > 0, text.count > count else { return text }
    return String(text.suffix(count)).trimmingCharacters(in: .whitespacesAndNewlines)
}

private func effectiveFinalResponsePolicy(_ config: AosConfig) -> (style: String, last_n_chars: Int) {
    let configured = config.voice.policies?.final_response
    let style = configured?.style?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "last_sentence"
    let lastNChars = max(1, configured?.last_n_chars ?? 400)
    return (style, lastNChars)
}
