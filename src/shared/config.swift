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
    var hotkeys: HotkeysConfig?
    var see: SeeConfig?

    struct SeeConfig: Codable {
        var canvas_inspector_bundle: CanvasInspectorBundleConfig?
    }

    struct CanvasInspectorBundleConfig: Codable {
        var hotkey: String?
        var include: CanvasInspectorBundleIncludeConfig?
    }

    struct CanvasInspectorBundleIncludeConfig: Codable {
        var capture_image: Bool?
        var capture_metadata: Bool?
        var inspector_state: Bool?
        var display_geometry: Bool?
        var canvas_list: Bool?
        var xray: Bool?
    }

    struct HotkeysConfig: Codable {
        var cancel_speech: UInt16?  // macOS keyCode (default: 53 = ESC)
    }

    struct VoiceConfig: Codable {
        var enabled: Bool
        var announce_actions: Bool
        var voice: String?       // Voice identifier (nil = system default)
        var rate: Float?         // Speech rate in words per minute (nil = default ~180)
        var policies: VoicePoliciesConfig?
        var controls: VoiceControlsConfig?
        var filter: VoiceFilterConfig?
    }

    struct VoiceFilterConfig: Codable {
        var language: String?
        var tiers: [String]?
    }

    struct VoicePoliciesConfig: Codable {
        var final_response: FinalResponsePolicyConfig?
    }

    struct FinalResponsePolicyConfig: Codable {
        var style: String?
        var last_n_chars: Int?
    }

    struct VoiceControlsConfig: Codable {
        var cancel: VoiceKeyControlConfig?
    }

    struct VoiceKeyControlConfig: Codable {
        var key_code: UInt16?
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
        voice: VoiceConfig(
            enabled: false,
            announce_actions: true,
            voice: nil,
            rate: nil,
            policies: VoicePoliciesConfig(
                final_response: FinalResponsePolicyConfig(style: "last_sentence", last_n_chars: 400)
            ),
            controls: VoiceControlsConfig(
                cancel: VoiceKeyControlConfig(key_code: 53)
            ),
            filter: VoiceFilterConfig(language: "en", tiers: ["premium", "enhanced"])
        ),
        perception: PerceptionConfig(default_depth: 1, settle_threshold_ms: 200),
        feedback: FeedbackConfig(visual: true, sound: false),
        content: nil,
        status_item: nil,
        hotkeys: nil,
        see: SeeConfig(
            canvas_inspector_bundle: CanvasInspectorBundleConfig(
                hotkey: "ctrl+opt+c",
                include: CanvasInspectorBundleIncludeConfig(
                    capture_image: true,
                    capture_metadata: true,
                    inspector_state: true,
                    display_geometry: true,
                    canvas_list: true,
                    xray: false
                )
            )
        )
    )
}

let canonicalHotkeyModifierOrder = ["ctrl", "opt", "cmd", "shift", "fn"]

private func canvasInspectorBundleDefaults() -> AosConfig.CanvasInspectorBundleConfig {
    AosConfig.defaults.see?.canvas_inspector_bundle
        ?? AosConfig.CanvasInspectorBundleConfig(
            hotkey: "ctrl+opt+c",
            include: AosConfig.CanvasInspectorBundleIncludeConfig(
                capture_image: true,
                capture_metadata: true,
                inspector_state: true,
                display_geometry: true,
                canvas_list: true,
                xray: false
            )
        )
}

func effectiveVoiceFilter(_ config: AosConfig) -> (language: String, tiers: [String]) {
    let language = (config.voice.filter?.language?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()).flatMap { $0.isEmpty ? nil : $0 } ?? "en"
    let tiers = (config.voice.filter?.tiers?.map { $0.lowercased() }.filter { !$0.isEmpty }).flatMap { $0.isEmpty ? nil : $0 } ?? ["premium", "enhanced"]
    return (language, tiers)
}

func effectiveCanvasInspectorBundleConfig(_ config: AosConfig) -> AosConfig.CanvasInspectorBundleConfig {
    let defaults = canvasInspectorBundleDefaults()
    let configured = config.see?.canvas_inspector_bundle
    let defaultInclude = defaults.include
    let configuredInclude = configured?.include
    return AosConfig.CanvasInspectorBundleConfig(
        hotkey: configured?.hotkey ?? defaults.hotkey,
        include: AosConfig.CanvasInspectorBundleIncludeConfig(
            capture_image: configuredInclude?.capture_image ?? defaultInclude?.capture_image,
            capture_metadata: configuredInclude?.capture_metadata ?? defaultInclude?.capture_metadata,
            inspector_state: configuredInclude?.inspector_state ?? defaultInclude?.inspector_state,
            display_geometry: configuredInclude?.display_geometry ?? defaultInclude?.display_geometry,
            canvas_list: configuredInclude?.canvas_list ?? defaultInclude?.canvas_list,
            xray: configuredInclude?.xray ?? defaultInclude?.xray
        )
    )
}

private func ensureCanvasInspectorBundleConfig(_ config: inout AosConfig) {
    if config.see == nil {
        config.see = AosConfig.SeeConfig(canvas_inspector_bundle: nil)
    }
    if config.see?.canvas_inspector_bundle == nil {
        config.see?.canvas_inspector_bundle = canvasInspectorBundleDefaults()
    }
    if config.see?.canvas_inspector_bundle?.include == nil {
        config.see?.canvas_inspector_bundle?.include = canvasInspectorBundleDefaults().include
    }
}

func normalizeHotkeyCombo(_ value: String) -> String? {
    let trimmed = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
    if trimmed.isEmpty { return nil }
    if ["none", "disabled", "off"].contains(trimmed) { return nil }

    let rawParts = trimmed
        .split(separator: "+")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard !rawParts.isEmpty else { return nil }

    var modifiers = Set<String>()
    var keyName: String? = nil
    for rawPart in rawParts {
        let part: String
        switch rawPart {
        case "control":
            part = "ctrl"
        case "alt", "option":
            part = "opt"
        case "command":
            part = "cmd"
        default:
            part = rawPart
        }

        if canonicalHotkeyModifierOrder.contains(part) {
            modifiers.insert(part)
            continue
        }
        guard keyName == nil else { return nil }
        guard keyCodeMap[part] != nil else { return nil }
        keyName = part
    }

    guard let keyName else { return nil }
    let orderedModifiers = canonicalHotkeyModifierOrder.filter { modifiers.contains($0) }
    return (orderedModifiers + [keyName]).joined(separator: "+")
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

func ensureContentRootConfigured(name: String, path: String) {
    guard !name.isEmpty else { return }
    var config = loadConfig()
    if config.content == nil {
        config.content = AosConfig.ContentConfig(port: 0, roots: [:])
    }
    if config.content?.roots[name] == path { return }
    config.content?.roots[name] = path
    saveConfig(config)
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
    case "voice.policies.final_response.style":
        if config.voice.policies == nil { config.voice.policies = AosConfig.VoicePoliciesConfig(final_response: nil) }
        if config.voice.policies?.final_response == nil {
            config.voice.policies?.final_response = AosConfig.FinalResponsePolicyConfig(style: nil, last_n_chars: nil)
        }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let allowed = ["full", "last_sentence", "last_n_chars"]
        guard allowed.contains(normalized) else {
            exitError("voice.policies.final_response.style must be one of \(allowed.joined(separator: ", "))", code: "INVALID_VALUE")
        }
        config.voice.policies?.final_response?.style = normalized
    case "voice.policies.final_response.last_n_chars":
        if config.voice.policies == nil { config.voice.policies = AosConfig.VoicePoliciesConfig(final_response: nil) }
        if config.voice.policies?.final_response == nil {
            config.voice.policies?.final_response = AosConfig.FinalResponsePolicyConfig(style: nil, last_n_chars: nil)
        }
        if let n = Int(value), n > 0 {
            config.voice.policies?.final_response?.last_n_chars = n
        } else {
            exitError("voice.policies.final_response.last_n_chars must be a positive integer", code: "INVALID_VALUE")
        }
    case "voice.filter.language":
        if config.voice.filter == nil { config.voice.filter = AosConfig.VoiceFilterConfig(language: nil, tiers: nil) }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { exitError("voice.filter.language must be a non-empty language code", code: "INVALID_VALUE") }
        config.voice.filter?.language = normalized
    case "voice.filter.tiers":
        if config.voice.filter == nil { config.voice.filter = AosConfig.VoiceFilterConfig(language: nil, tiers: nil) }
        let parts = value
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else {
            exitError("voice.filter.tiers must be a non-empty comma-separated list (e.g. premium,enhanced)", code: "INVALID_VALUE")
        }
        config.voice.filter?.tiers = parts
    case "voice.controls.cancel.key_code":
        if config.voice.controls == nil { config.voice.controls = AosConfig.VoiceControlsConfig(cancel: nil) }
        if value == "none" || value == "disabled" {
            config.voice.controls?.cancel = AosConfig.VoiceKeyControlConfig(key_code: nil)
        } else if let n = UInt16(value) {
            config.voice.controls?.cancel = AosConfig.VoiceKeyControlConfig(key_code: n)
        } else {
            exitError("voice.controls.cancel.key_code must be a macOS keyCode (integer) or 'none'", code: "INVALID_VALUE")
        }
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
    case "hotkeys.cancel_speech":
        if config.hotkeys == nil { config.hotkeys = AosConfig.HotkeysConfig(cancel_speech: nil) }
        if value == "none" || value == "disabled" {
            config.hotkeys?.cancel_speech = nil
            if config.voice.controls == nil { config.voice.controls = AosConfig.VoiceControlsConfig(cancel: nil) }
            config.voice.controls?.cancel = AosConfig.VoiceKeyControlConfig(key_code: nil)
        } else if let n = UInt16(value) {
            config.hotkeys?.cancel_speech = n
            if config.voice.controls == nil { config.voice.controls = AosConfig.VoiceControlsConfig(cancel: nil) }
            config.voice.controls?.cancel = AosConfig.VoiceKeyControlConfig(key_code: n)
        } else {
            exitError("hotkeys.cancel_speech must be a macOS keyCode (integer) or 'none'", code: "INVALID_VALUE")
        }
    case "see.canvas_inspector_bundle.hotkey":
        ensureCanvasInspectorBundleConfig(&config)
        let normalized = normalizeHotkeyCombo(value)
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            exitError("see.canvas_inspector_bundle.hotkey must be a key combo like 'ctrl+opt+c' or 'none'", code: "INVALID_VALUE")
        }
        if normalized == nil && !["none", "disabled", "off"].contains(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) {
            exitError("see.canvas_inspector_bundle.hotkey must be a supported key combo like 'ctrl+opt+c' or 'none'", code: "INVALID_VALUE")
        }
        config.see?.canvas_inspector_bundle?.hotkey = normalized
    case "see.canvas_inspector_bundle.include.capture_image":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.capture_image = (value == "true" || value == "1")
    case "see.canvas_inspector_bundle.include.capture_metadata":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.capture_metadata = (value == "true" || value == "1")
    case "see.canvas_inspector_bundle.include.inspector_state":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.inspector_state = (value == "true" || value == "1")
    case "see.canvas_inspector_bundle.include.display_geometry":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.display_geometry = (value == "true" || value == "1")
    case "see.canvas_inspector_bundle.include.canvas_list":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.canvas_list = (value == "true" || value == "1")
    case "see.canvas_inspector_bundle.include.xray":
        ensureCanvasInspectorBundleConfig(&config)
        config.see?.canvas_inspector_bundle?.include?.xray = (value == "true" || value == "1")
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
