import Foundation

struct KokoroProvider: SpeakableVoiceProvider {
    let name = "kokoro"

    private var fakeRunnerEnabled: Bool {
        ProcessInfo.processInfo.environment["AOS_VOICE_KOKORO_FAKE_RUNNER"] == "1"
    }

    var availability: ProviderAvailability {
        if fakeRunnerEnabled {
            return ProviderAvailability(reachable: true, reason: nil)
        }
        return ProviderAvailability(reachable: false, reason: "kokoro runner/model unavailable")
    }

    func enumerate() -> [VoiceRecord] {
        let reachable = availability.reachable
        return [
            VoiceRecord(
                id: VoiceID.make(provider: name, providerVoiceID: "kokoro-82m-default"),
                provider: name,
                provider_voice_id: "kokoro-82m-default",
                name: "Kokoro 82M Default",
                display_name: "Kokoro 82M",
                locale: "en-US",
                language: "en",
                region: "US",
                gender: "neutral",
                kind: "synthetic",
                quality_tier: "local-model",
                tags: ["local", "model", "kokoro", "unbundled"],
                capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                availability: VoiceAvailability(installed: fakeRunnerEnabled, enabled: true, reachable: reachable),
                metadata: [
                    "model_family": .string("kokoro"),
                    "model_size": .string("82m"),
                    "distribution": .string("weights-not-bundled"),
                    "runner": .string(fakeRunnerEnabled ? "fake" : "missing")
                ]
            )
        ]
    }

    func speak(_ request: VoiceSpeakRequest) throws -> VoiceSpeakResult {
        guard fakeRunnerEnabled else {
            throw VoiceSpeakError(code: "VOICE_PROVIDER_UNAVAILABLE", message: "kokoro runner/model unavailable")
        }
        return VoiceSpeakResult(
            provider: name,
            voiceID: request.voice.id,
            mode: "kokoro-fake-runner",
            audioPerformed: false,
            metadata: [
                "skip_audio": .bool(request.skipAudio),
                "runner": .string("fake")
            ]
        )
    }
}
