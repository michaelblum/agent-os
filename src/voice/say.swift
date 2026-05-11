// say.swift — aos say: text-to-speech CLI command

import AppKit
import Foundation

/// aos say [options] <text>
/// Options:
///   --voice <id>       Use specific voice (see --list-voices)
///   --voice-slot <n>   Use the nth filtered speakable registry voice (1-based)
///   --language <value> Filter --voice-slot candidates by language
///   --gender <value>   Filter --voice-slot candidates by gender
///   --quality-tier <v> Filter --voice-slot candidates by quality tier (repeatable or comma-separated)
///   --rate <wpm>       Speech rate in words per minute
///   --list-voices      List available voices and exit
///   --wait             Wait for speech to complete before exiting (default: true)
func sayCommand(args: [String]) {
    // Handle --list-voices
    if args.contains("--list-voices") || args.contains("--voices") {
        let store = VoicePolicyStore()
        let registry = VoiceRegistry(policyLoader: { store.load() })
        let records = registry.snapshot().filter { $0.provider == "system" }
        let listed = records.map { rec -> [String: Any] in
            return [
                "provider": rec.provider,
                "id": rec.provider_voice_id,
                "name": rec.name,
                "language": rec.locale ?? rec.language ?? "unknown",
                "gender": rec.gender,
                "quality_tier": rec.quality_tier
            ]
        }
        if let data = try? JSONSerialization.data(withJSONObject: listed, options: [.sortedKeys]),
           let string = String(data: data, encoding: .utf8) {
            print(string)
        }
        return
    }

    // Parse options
    let config = loadConfig()
    var voiceID = config.voice.voice
    var voiceSlot: String?
    var voiceFilter = VoiceFilter()
    var qualityTiers: [String] = []
    var rate = config.voice.rate
    var textParts: [String] = []

    var i = 0
    while i < args.count {
        switch args[i] {
        case "--voice":
            i += 1
            guard i < args.count else {
                exitError("say --voice requires a voice identifier", code: "MISSING_ARG")
            }
            voiceID = args[i]
        case "--voice-slot":
            i += 1
            guard i < args.count else {
                exitError("say --voice-slot requires a 1-based numeric slot", code: "MISSING_ARG")
            }
            voiceSlot = args[i]
        case "--language":
            i += 1
            guard i < args.count else {
                exitError("say --language requires a value", code: "MISSING_ARG")
            }
            voiceFilter.language = args[i]
        case "--gender":
            i += 1
            guard i < args.count else {
                exitError("say --gender requires a value", code: "MISSING_ARG")
            }
            voiceFilter.gender = args[i]
        case "--quality-tier":
            i += 1
            guard i < args.count else {
                exitError("say --quality-tier requires a value", code: "MISSING_ARG")
            }
            qualityTiers.append(contentsOf: parseSayQualityTiers(args[i]))
        case "--rate":
            i += 1
            guard i < args.count else {
                exitError("say --rate requires a numeric WPM value", code: "MISSING_ARG")
            }
            rate = Float(args[i])
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
        exitError("say requires text. Usage: aos say \"<text>\" [--voice <id>] [--voice-slot <n>] [--rate <wpm>]",
                  code: "MISSING_ARG")
    }

    var reportedVoiceID = voiceID ?? SpeechEngine.defaultVoiceID
    if let rawSlot = voiceSlot {
        voiceFilter.quality_tiers = qualityTiers
        let resolved = resolveSayVoiceSlot(rawSlot, matching: voiceFilter)
        voiceID = resolved.engineVoiceID
        reportedVoiceID = resolved.reportedVoiceID
    }

    // Initialize NSApplication (needed for NSSpeechSynthesizer and global event monitor)
    _ = NSApplication.shared

    // Create engine with configured voice
    let engine = SpeechEngine(voice: voiceID)
    if let r = rate { engine.setRate(r) }

    // Hotkey: cancel speech (default: ESC = keyCode 53) via CGEvent tap
    let cancelKey = effectiveSpeechCancelKeyCode(config: config)
    let engineRef = Unmanaged.passUnretained(engine).toOpaque()
    let tap = cancelKey.flatMap { cancelKey in
        CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let eng = Unmanaged<SpeechEngine>.fromOpaque(refcon).takeUnretainedValue()
                let keyCode = UInt16(event.getIntegerValueField(.keyboardEventKeycode))
                if let activeKey = effectiveSpeechCancelKeyCode(config: loadConfig()),
                   keyCode == activeKey {
                    eng.stop()
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: engineRef
        )
    }
    var tapSource: CFRunLoopSource?
    if let tap = tap {
        tapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), tapSource, .defaultMode)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    // Speak and wait
    if ProcessInfo.processInfo.environment["AOS_SAY_TEST_SKIP_SPEECH"] != "1" {
        engine.speakAndWait(text)
    }

    if let tap = tap { CGEvent.tapEnable(tap: tap, enable: false) }
    if let s = tapSource { CFRunLoopRemoveSource(CFRunLoopGetCurrent(), s, .defaultMode) }

    // Output confirmation
    let response: [String: Any] = [
        "status": "success",
        "text": text,
        "voice": reportedVoiceID,
        "characters": text.count
    ]
    if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

private func resolveSayVoiceSlot(_ rawSlot: String, matching filter: VoiceFilter) -> (engineVoiceID: String?, reportedVoiceID: String) {
    guard let slot = Int(rawSlot), slot > 0 else {
        exitError("say --voice-slot must be a positive 1-based integer, got \(rawSlot)", code: "INVALID_VOICE_SLOT")
    }

    let store = VoicePolicyStore()
    let registry = VoiceRegistry(policyLoader: { store.load() })
    let voices = filter.isEmpty ? registry.allocatableSnapshot() : registry.allocatableSnapshot(matching: filter)
    if voices.isEmpty {
        exitError("say --voice-slot \(slot) found no speakable voices after filters\(sayFilterDescription(filter))", code: "VOICE_FILTER_EMPTY")
    }
    guard slot <= voices.count else {
        exitError("say --voice-slot \(slot) is out of range after filters\(sayFilterDescription(filter)); \(voices.count) speakable voice(s) available", code: "INVALID_VOICE_SLOT")
    }

    let record = voices[slot - 1]
    if record.provider == "system" {
        return (record.provider_voice_id, record.id)
    }
    return (record.provider_voice_id, record.id)
}

private func parseSayQualityTiers(_ value: String) -> [String] {
    value.split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
}

private func sayFilterDescription(_ filter: VoiceFilter) -> String {
    var parts: [String] = []
    if let language = filter.language { parts.append("language=\(language)") }
    if let gender = filter.gender { parts.append("gender=\(gender)") }
    if !filter.quality_tiers.isEmpty { parts.append("quality_tier=\(filter.quality_tiers.joined(separator: ","))") }
    if parts.isEmpty { return "" }
    return " (\(parts.joined(separator: ", ")))"
}
