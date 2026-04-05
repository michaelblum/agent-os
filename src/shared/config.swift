// config.swift — AOS configuration file: read, write, watch

import Foundation

let kAosConfigPath: String = {
    NSString(string: "~/.config/aos/config.json").expandingTildeInPath
}()

struct AosConfig: Codable {
    var voice: VoiceConfig
    var perception: PerceptionConfig
    var feedback: FeedbackConfig

    struct VoiceConfig: Codable {
        var enabled: Bool
        var announce_actions: Bool
        var voice: String?       // Voice identifier (nil = system default)
        var rate: Float?         // Speech rate in words per minute (nil = default ~180)
    }

    struct PerceptionConfig: Codable {
        var default_depth: Int
        var settle_threshold_ms: Int
    }

    struct FeedbackConfig: Codable {
        var visual: Bool
        var sound: Bool
    }

    static let defaults = AosConfig(
        voice: VoiceConfig(enabled: false, announce_actions: true, voice: nil, rate: nil),
        perception: PerceptionConfig(default_depth: 1, settle_threshold_ms: 200),
        feedback: FeedbackConfig(visual: true, sound: false)
    )
}

/// Load config from disk, falling back to defaults if missing or invalid.
func loadConfig() -> AosConfig {
    guard let data = FileManager.default.contents(atPath: kAosConfigPath),
          let config = try? JSONDecoder().decode(AosConfig.self, from: data) else {
        return .defaults
    }
    return config
}

/// Save config to disk. Creates parent directory if needed.
func saveConfig(_ config: AosConfig) {
    let dir = (kAosConfigPath as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(config) else { return }
    try? data.write(to: URL(fileURLWithPath: kAosConfigPath))
}

/// Set a dotted key path in config. E.g. "voice.enabled" = "true"
func setConfigValue(key: String, value: String) {
    var config = loadConfig()
    switch key {
    case "voice.enabled":
        config.voice.enabled = (value == "true" || value == "1")
    case "voice.announce_actions":
        config.voice.announce_actions = (value == "true" || value == "1")
    case "voice.voice":
        config.voice.voice = value == "default" ? nil : value
    case "voice.rate":
        if let n = Float(value), n > 0 { config.voice.rate = n }
        else { exitError("rate must be a positive number", code: "INVALID_VALUE") }
    case "perception.default_depth":
        if let n = Int(value), (0...3).contains(n) { config.perception.default_depth = n }
        else { exitError("depth must be 0-3", code: "INVALID_VALUE") }
    case "perception.settle_threshold_ms":
        if let n = Int(value), n > 0 { config.perception.settle_threshold_ms = n }
        else { exitError("settle_threshold_ms must be positive", code: "INVALID_VALUE") }
    case "feedback.visual":
        config.feedback.visual = (value == "true" || value == "1")
    case "feedback.sound":
        config.feedback.sound = (value == "true" || value == "1")
    default:
        exitError("Unknown config key: \(key). Valid: voice.enabled, voice.announce_actions, voice.voice, voice.rate, perception.default_depth, perception.settle_threshold_ms, feedback.visual, feedback.sound", code: "UNKNOWN_KEY")
    }
    saveConfig(config)
    print(jsonString(config))
}
