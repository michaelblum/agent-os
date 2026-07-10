import Foundation

/// Test-only provider activated additively by AOS_VOICE_TEST_PROVIDERS=mock at
/// process start. The canonical [system, elevenlabs] providers stay live
/// alongside it, allowing tests to also exercise NOT_SPEAKABLE paths against
/// the elevenlabs stub without restarting the daemon.
struct MockVoiceProvider: SpeakableVoiceProvider {
    let name: String
    let _availability: ProviderAvailability
    private let voices: [VoiceRecord]

    init(name: String = "mock", reachable: Bool = true, voices: [VoiceRecord] = MockVoiceProvider.defaultFixture()) {
        self.name = name
        self._availability = ProviderAvailability(reachable: reachable, reason: reachable ? nil : "test mock unreachable")
        self.voices = voices
    }

    var availability: ProviderAvailability { _availability }
    func enumerate() -> [VoiceRecord] {
        voices.map { voice in
            var record = voice
            record.availability.reachable = availability.reachable
            return record
        }
    }

    func speak(_ request: VoiceSpeakRequest) throws -> VoiceSpeakResult {
        guard availability.reachable else {
            throw VoiceSpeakError(code: "VOICE_PROVIDER_UNAVAILABLE", message: availability.reason ?? "mock provider unavailable")
        }
        if let logPath = ProcessInfo.processInfo.environment["AOS_VOICE_MOCK_SPEAK_LOG"],
           !logPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try appendSpeakLog(path: logPath, request: request)
        }
        return VoiceSpeakResult(
            provider: name,
            voiceID: request.voice.id,
            mode: "mock",
            audioPerformed: false,
            metadata: [
                "skip_audio": .bool(request.skipAudio)
            ]
        )
    }

    private func appendSpeakLog(path: String, request: VoiceSpeakRequest) throws {
        var payload: [String: Any] = [
            "provider": name,
            "voice": request.voice.id,
            "text": request.text,
            "skip_audio": request.skipAudio
        ]
        if let rate = request.rate {
            payload["rate"] = rate
        }
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        guard let line = String(data: data, encoding: .utf8) else {
            throw VoiceSpeakError(code: "VOICE_PROVIDER_ERROR", message: "mock speak log encoding failed")
        }
        let url = URL(fileURLWithPath: path)
        let parent = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        if let lineData = "\(line)\n".data(using: .utf8) {
            try handle.write(contentsOf: lineData)
        }
    }

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
                quality_tier: idx == 0 ? "premium" : (idx == 1 ? "enhanced" : "standard"),
                tags: idx == 4 ? ["novelty"] : (idx % 2 == 0 ? ["calm"] : ["bright"]),
                capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                availability: VoiceAvailability(installed: true, enabled: true, reachable: true),
                metadata: [:]
            )
        }
    }
}
