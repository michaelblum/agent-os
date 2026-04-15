// config.swift — AOS configuration file: read, write, watch

import Foundation

let kAosConfigPath: String = {
    aosConfigPath()
}()

struct AosConfig: Codable {
    var voice: VoiceConfig
    var perception: PerceptionConfig
    var feedback: FeedbackConfig
    var content: ContentConfig?         // content server port and document roots
    var status_item: StatusItemConfig?

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

    struct ContentConfig: Codable {
        var port: Int
        var roots: [String: String]  // prefix -> directory path
    }

    struct StatusItemConfig: Codable {
        var enabled: Bool
        var toggle_id: String
        var toggle_url: String
        var toggle_at: [Double]
        var toggle_track: String?
        var icon: String
    }

    static let defaults = AosConfig(
        voice: VoiceConfig(enabled: false, announce_actions: true, voice: nil, rate: nil),
        perception: PerceptionConfig(default_depth: 1, settle_threshold_ms: 200),
        feedback: FeedbackConfig(visual: true, sound: false),
        content: nil,
        status_item: nil
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
    case "content.port":
        if config.content == nil { config.content = AosConfig.ContentConfig(port: 0, roots: [:]) }
        if let n = Int(value), n >= 0 { config.content?.port = n }
        else { exitError("content.port must be a non-negative integer", code: "INVALID_VALUE") }
    case _ where key.hasPrefix("content.roots."):
        if config.content == nil { config.content = AosConfig.ContentConfig(port: 0, roots: [:]) }
        let rootName = String(key.dropFirst("content.roots.".count))
        guard !rootName.isEmpty else { exitError("content.roots requires a name", code: "INVALID_VALUE") }
        config.content?.roots[rootName] = value
    case "status_item.enabled":
        if config.status_item == nil {
            config.status_item = AosConfig.StatusItemConfig(
                enabled: false, toggle_id: "avatar", toggle_url: "",
                toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
            )
        }
        config.status_item?.enabled = (value == "true" || value == "1")
    case "status_item.toggle_id":
        if config.status_item == nil {
            config.status_item = AosConfig.StatusItemConfig(
                enabled: false, toggle_id: "avatar", toggle_url: "",
                toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
            )
        }
        config.status_item?.toggle_id = value
    case "status_item.toggle_url":
        if config.status_item == nil {
            config.status_item = AosConfig.StatusItemConfig(
                enabled: false, toggle_id: "avatar", toggle_url: "",
                toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
            )
        }
        config.status_item?.toggle_url = value
    case "status_item.toggle_track":
        if config.status_item == nil {
            config.status_item = AosConfig.StatusItemConfig(
                enabled: false, toggle_id: "avatar", toggle_url: "",
                toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
            )
        }
        config.status_item?.toggle_track = value == "none" ? nil : value
    case "status_item.icon":
        if config.status_item == nil {
            config.status_item = AosConfig.StatusItemConfig(
                enabled: false, toggle_id: "avatar", toggle_url: "",
                toggle_at: [200, 200, 300, 300], toggle_track: nil, icon: "hexagon"
            )
        }
        config.status_item?.icon = value
    default:
        exitError("Unknown config key: \(key)", code: "UNKNOWN_KEY")
    }
    saveConfig(config)
    print(jsonString(config))
}

// MARK: - Config File Watcher

/// Watches the config file for changes and calls the handler on each change.
class ConfigWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private let path: String
    var onChange: ((AosConfig) -> Void)?

    init(path: String = kAosConfigPath) {
        self.path = path
    }

    func start() {
        // Ensure the file exists (create with defaults if not)
        if !FileManager.default.fileExists(atPath: path) {
            saveConfig(.defaults)
        }

        fd = open(path, O_EVTONLY)
        guard fd >= 0 else {
            fputs("Warning: cannot watch config file at \(path)\n", stderr)
            return
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete],
            queue: DispatchQueue.global(qos: .utility)
        )

        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Brief delay to let the write finish
            usleep(50_000) // 50ms
            let config = loadConfig()
            self.onChange?(config)
        }

        source.setCancelHandler { [weak self] in
            guard let self = self else { return }
            if self.fd >= 0 { close(self.fd); self.fd = -1 }
        }

        source.resume()
        self.source = source
    }

    func stop() {
        source?.cancel()
        source = nil
    }
}
