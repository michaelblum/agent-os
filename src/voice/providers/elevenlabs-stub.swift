import Foundation

struct ElevenLabsStubProvider: VoiceProvider {
    let name = "elevenlabs"
    let providerRank = 20
    var availability: ProviderAvailability {
        if ProcessInfo.processInfo.environment["AOS_VOICE_TEST_ELEVENLABS_UNREACHABLE"] == "1" {
            return ProviderAvailability(reachable: false, reason: "test override")
        }
        return ProviderAvailability(reachable: true, reason: nil)
    }

    func enumerate() -> [VoiceRecord] {
        let reachable = availability.reachable
        let voices: [(String, String, String, String, String)] = [
            // (provider_voice_id, display_name, gender, kind, cost_class)
            ("21m00Tcm4TlvDq8ikWAM", "Rachel", "female", "human", "standard"),
            ("AZnzlk1XvdvUeBnXmlld", "Domi", "female", "human", "standard"),
            ("ErXwobaYiN019PkySvjV", "Antoni", "male", "human", "standard"),
            ("MF3mGyEYCl7XYWbV9V6O", "Elli", "female", "human", "standard"),
            ("VR6AewLTigWG4xSOukaG", "Arnold", "neutral", "character", "premium")
        ]
        return voices.map { (suffix, name, gender, kind, costClass) in
            VoiceRecord(
                id: VoiceID.make(provider: "elevenlabs", providerVoiceID: suffix),
                provider: "elevenlabs",
                provider_voice_id: suffix,
                name: name,
                display_name: nil,
                locale: "en-US",
                language: "en",
                region: "US",
                gender: gender,
                kind: kind,
                quality_tier: "standard",
                tags: [],
                capabilities: VoiceCapabilities(local: false, streaming: true, ssml: false, speak_supported: false),
                availability: VoiceAvailability(installed: true, enabled: true, reachable: reachable),
                metadata: ["cost_class": .string(costClass)]
            )
        }
    }
}
