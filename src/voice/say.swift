// say.swift — aos say: text-to-speech CLI command

import AppKit
import Foundation

/// aos say [options] <text>
/// Options:
///   --voice <id>       Use specific voice (see --list-voices)
///   --rate <wpm>       Speech rate in words per minute
///   --list-voices      List available voices and exit
///   --wait             Wait for speech to complete before exiting (default: true)
func sayCommand(args: [String]) {
    // Handle --list-voices
    if args.contains("--list-voices") || args.contains("--voices") {
        let voices = SpeechEngine.availableVoices()
        print(jsonString(voices))
        return
    }

    // Parse options
    let config = loadConfig()
    var voiceID = config.voice.voice
    var rate = config.voice.rate
    var textParts: [String] = []

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--voice":
            i += 1
            if i < args.count { voiceID = args[i] }
        case "--rate":
            i += 1
            if i < args.count { rate = Float(args[i]) }
        default:
            // Not a flag — treat as text
            if !args[i].hasPrefix("--") {
                textParts.append(args[i])
            }
        }
        i += 1
    }

    // Check for stdin if no text args
    var text = textParts.joined(separator: " ")
    if text.isEmpty {
        // Try reading from stdin (non-blocking check)
        if let stdinData = try? FileHandle.standardInput.availableData,
           !stdinData.isEmpty,
           let stdinText = String(data: stdinData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !stdinText.isEmpty {
            text = stdinText
        }
    }

    guard !text.isEmpty else {
        exitError("Usage: aos say [--voice <id>] [--rate <wpm>] <text>", code: "MISSING_TEXT")
    }

    // Initialize NSApplication (needed for NSSpeechSynthesizer)
    _ = NSApplication.shared

    // Create engine with configured voice
    let engine = SpeechEngine(voice: voiceID)
    if let r = rate { engine.setRate(r) }

    // Speak and wait
    engine.speakAndWait(text)

    // Output confirmation
    let response: [String: Any] = [
        "status": "success",
        "text": text,
        "voice": voiceID ?? SpeechEngine.defaultVoiceID,
        "characters": text.count
    ]
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
