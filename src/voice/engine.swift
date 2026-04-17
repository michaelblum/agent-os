// engine.swift — SpeechEngine: TTS wrapper around NSSpeechSynthesizer

import AppKit
import Foundation

class SpeechEngine: NSObject, NSSpeechSynthesizerDelegate {
    private var synth: NSSpeechSynthesizer
    private var completion: (() -> Void)?
    private let lock = NSLock()

    /// Initialize with optional voice identifier (e.g., "com.apple.voice.compact.en-US.Samantha").
    /// Pass nil for system default voice.
    init(voice: String? = nil) {
        if let voiceID = voice {
            let voiceName = NSSpeechSynthesizer.VoiceName(rawValue: voiceID)
            self.synth = NSSpeechSynthesizer(voice: voiceName) ?? NSSpeechSynthesizer()
        } else {
            self.synth = NSSpeechSynthesizer()
        }
        super.init()
        self.synth.delegate = self
    }

    /// Set speech rate (words per minute). Default is ~180-200.
    func setRate(_ rate: Float) {
        synth.rate = rate
    }

    /// Speak text asynchronously. Calls completion when done.
    func speak(_ text: String, completion: (() -> Void)? = nil) {
        lock.lock()
        self.completion = completion
        lock.unlock()
        synth.startSpeaking(text)
    }

    /// Speak text and block until finished. Runs a brief run loop to process delegate callbacks.
    func speakAndWait(_ text: String) {
        var done = false
        speak(text) { done = true }
        // Pump the run loop until speech completes
        while !done {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
    }

    /// Stop any in-progress speech immediately.
    func stop() {
        synth.stopSpeaking()
    }

    /// Whether the engine is currently speaking.
    var isSpeaking: Bool {
        synth.isSpeaking
    }

    /// Change voice on the fly.
    func setVoice(_ voiceID: String) {
        synth.setVoice(NSSpeechSynthesizer.VoiceName(rawValue: voiceID))
    }

    // MARK: - NSSpeechSynthesizerDelegate

    func speechSynthesizer(_ sender: NSSpeechSynthesizer, didFinishSpeaking finishedSpeaking: Bool) {
        lock.lock()
        let cb = completion
        completion = nil
        lock.unlock()
        cb?()
    }

    // MARK: - Voice Discovery

    struct VoiceInfo: Encodable {
        let provider: String
        let id: String
        let name: String
        let language: String
        let gender: String
        let quality_tier: String
    }

    /// List all available voices on this system.
    static func availableVoices() -> [VoiceInfo] {
        let load: () -> [VoiceInfo] = {
            _ = NSApplication.shared
            return NSSpeechSynthesizer.availableVoices.compactMap { voiceName in
                let attrs = NSSpeechSynthesizer.attributes(forVoice: voiceName)
                guard let name = attrs[.name] as? String else { return nil }
                let lang = attrs[.localeIdentifier] as? String ?? "unknown"
                let gender = attrs[.gender] as? String ?? "unknown"
                let voiceID = voiceName.rawValue
                return VoiceInfo(
                    provider: "system",
                    id: voiceID,
                    name: name,
                    language: lang,
                    gender: gender == "VoiceGenderMale" ? "male" : gender == "VoiceGenderFemale" ? "female" : "neutral",
                    quality_tier: qualityTier(forVoiceID: voiceID)
                )
            }
        }
        if Thread.isMainThread {
            return load()
        }

        var voices: [VoiceInfo] = []
        DispatchQueue.main.sync {
            voices = load()
        }
        return voices
    }

    static func availableVoice(id: String) -> VoiceInfo? {
        availableVoices().first { $0.id == id }
    }

    /// Get the default voice identifier.
    static var defaultVoiceID: String {
        NSSpeechSynthesizer.defaultVoice.rawValue
    }

    static func qualityTier(forVoiceID voiceID: String) -> String {
        let lower = voiceID.lowercased()
        if lower.contains(".premium.") || lower.contains("_premium") {
            return "premium"
        }
        if lower.contains(".enhanced.") || lower.contains("_enhanced") {
            return "enhanced"
        }
        return "standard"
    }
}
