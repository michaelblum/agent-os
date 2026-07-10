import Foundation

protocol VoiceProvider {
    var name: String { get }
    var availability: ProviderAvailability { get }
    func enumerate() -> [VoiceRecord]
}

struct VoiceSpeakRequest {
    let text: String
    let voice: VoiceRecord
    let rate: Float?
    let skipAudio: Bool
}

struct VoiceSpeakResult {
    let provider: String
    let voiceID: String
    let mode: String
    let audioPerformed: Bool
    let metadata: [String: AnyCodableJSON]

    func dictionary() -> [String: Any] {
        return [
            "provider": provider,
            "voice_id": voiceID,
            "mode": mode,
            "audio_performed": audioPerformed,
            "metadata": metadata.mapValues { $0.asAny }
        ]
    }
}

struct VoiceSpeakError: Error {
    let code: String
    let message: String
}

protocol SpeakableVoiceProvider: VoiceProvider {
    func speak(_ request: VoiceSpeakRequest) throws -> VoiceSpeakResult
}
