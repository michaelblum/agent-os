import AppKit
import Foundation

struct SystemVoiceProvider: VoiceProvider {
    let name = "system"
    var availability: ProviderAvailability { ProviderAvailability(reachable: true, reason: nil) }

    func enumerate() -> [VoiceRecord] {
        let load: () -> [VoiceRecord] = {
            _ = NSApplication.shared
            return NSSpeechSynthesizer.availableVoices.compactMap { voiceName -> VoiceRecord? in
                let attrs = NSSpeechSynthesizer.attributes(forVoice: voiceName)
                guard let displayName = attrs[.name] as? String else { return nil }
                let suffix = voiceName.rawValue
                let locale = attrs[.localeIdentifier] as? String
                let genderRaw = attrs[.gender] as? String ?? ""
                let gender: String
                switch genderRaw {
                case "VoiceGenderFemale": gender = "female"
                case "VoiceGenderMale": gender = "male"
                default: gender = "unknown"
                }
                let (lang, region) = Self.splitLocale(locale)
                let tier = Self.qualityTier(forVoiceID: suffix)
                let classification = Self.classification(forVoiceID: suffix)
                return VoiceRecord(
                    id: VoiceID.make(provider: "system", providerVoiceID: suffix),
                    provider: "system",
                    provider_voice_id: suffix,
                    name: displayName,
                    display_name: nil,
                    locale: locale,
                    language: lang,
                    region: region,
                    gender: gender,
                    kind: classification.kind,
                    quality_tier: tier,
                    tags: classification.tags,
                    capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                    availability: VoiceAvailability(installed: true, enabled: true, reachable: true),
                    metadata: [:]
                )
            }
        }
        if Thread.isMainThread { return load() }
        var out: [VoiceRecord] = []
        DispatchQueue.main.sync { out = load() }
        return out
    }

    static func splitLocale(_ locale: String?) -> (language: String?, region: String?) {
        guard let locale, !locale.isEmpty else { return (nil, nil) }
        let parts = locale.replacingOccurrences(of: "_", with: "-").split(separator: "-")
        let lang = parts.first.map(String.init)
        let region = parts.count >= 2 ? String(parts[1]) : nil
        return (lang, region)
    }

    static func qualityTier(forVoiceID voiceID: String) -> String {
        let lower = voiceID.lowercased()
        if lower.contains(".premium.") || lower.contains("_premium") { return "premium" }
        if lower.contains(".enhanced.") || lower.contains("_enhanced") { return "enhanced" }
        return "standard"
    }

    static func classification(forVoiceID voiceID: String) -> (kind: String, tags: [String]) {
        let lower = voiceID.lowercased()
        if lower.contains("speech.synthesis.voice") {
            return ("novelty", ["novelty"])
        }
        if lower.contains(".eloquence.") {
            return ("synthetic", ["synthetic", "legacy"])
        }
        return ("human", [])
    }
}
