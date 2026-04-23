import Foundation

/// Test-only provider activated additively by AOS_VOICE_TEST_PROVIDERS=mock at
/// process start. Mock voices have lowest providerRank so unbound test sessions
/// allocate them first; the canonical [system, elevenlabs] providers stay live
/// alongside, allowing tests to also exercise NOT_SPEAKABLE paths against the
/// elevenlabs stub without restarting the daemon.
struct MockVoiceProvider: VoiceProvider {
    let name: String
    let providerRank: Int
    let _availability: ProviderAvailability
    private let voices: [VoiceRecord]

    init(name: String = "mock", providerRank: Int = 5, reachable: Bool = true, voices: [VoiceRecord] = MockVoiceProvider.defaultFixture()) {
        self.name = name
        self.providerRank = providerRank
        self._availability = ProviderAvailability(reachable: reachable, reason: reachable ? nil : "test mock unreachable")
        self.voices = voices
    }

    var availability: ProviderAvailability { _availability }
    func enumerate() -> [VoiceRecord] { voices }

    static func defaultFixture() -> [VoiceRecord] {
        let names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
        return names.enumerated().map { (idx, n) in
            VoiceRecord(
                id: VoiceID.make(provider: "mock", providerVoiceID: "mock-\(n.lowercased())"),
                provider: "mock",
                provider_voice_id: "mock-\(n.lowercased())",
                name: n,
                display_name: nil,
                locale: "en-US",
                language: "en",
                region: "US",
                gender: idx % 2 == 0 ? "female" : "male",
                kind: "human",
                quality_tier: idx == 0 ? "premium" : "standard",
                tags: [],
                capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                availability: VoiceAvailability(installed: true, enabled: true, reachable: true),
                metadata: [:]
            )
        }
    }
}
