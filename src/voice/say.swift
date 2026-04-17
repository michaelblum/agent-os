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
        exitError("say requires text. Usage: aos say \"<text>\" [--voice <id>] [--rate <wpm>]",
                  code: "MISSING_ARG")
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
    engine.speakAndWait(text)

    if let tap = tap { CGEvent.tapEnable(tap: tap, enable: false) }
    if let s = tapSource { CFRunLoopRemoveSource(CFRunLoopGetCurrent(), s, .defaultMode) }

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
