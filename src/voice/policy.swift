import Foundation

struct VoicePolicy: Codable, Equatable {
    struct ProviderEntry: Codable, Equatable { var enabled: Bool }
    struct VoicesSection: Codable, Equatable {
        var disabled: [String]
        init(disabled: [String] = []) {
            self.disabled = disabled
        }
    }
    var schema_version: Int = 1
    var providers: [String: ProviderEntry] = [:]
    var voices: VoicesSection = VoicesSection()
    var session_preferences: [String: String] = [:]
    var voice_cursor: Int?

    static let empty = VoicePolicy()
}

final class VoicePolicyStore {
    private let path: String
    private let lock = NSLock()
    private var cached: VoicePolicy?

    init(path: String = aosVoicePolicyPath()) {
        self.path = path
    }

    var filePath: String { path }

    func load() -> VoicePolicy {
        lock.lock(); defer { lock.unlock() }
        if let cached { return cached }
        guard let data = FileManager.default.contents(atPath: path) else {
            let empty = VoicePolicy.empty
            cached = empty; return empty
        }
        let stripped = stripJSONComments(data)
        let policy = (try? JSONDecoder().decode(VoicePolicy.self, from: stripped)) ?? VoicePolicy.empty
        cached = policy
        return policy
    }

    func reload() -> VoicePolicy {
        lock.lock(); cached = nil; lock.unlock()
        return load()
    }

    func save(_ policy: VoicePolicy) {
        lock.lock(); defer { lock.unlock() }
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(policy) else { return }
        let tmp = path + ".tmp"
        do {
            try data.write(to: URL(fileURLWithPath: tmp), options: .atomic)
            if FileManager.default.fileExists(atPath: path) {
                try? FileManager.default.removeItem(atPath: path)
            }
            try FileManager.default.moveItem(atPath: tmp, toPath: path)
        } catch {
            fputs("voice/policy.json save failed: \(error)\n", stderr)
        }
        cached = policy
    }

    func setPreferred(sessionID: String, voiceURI: String) {
        var p = load()
        p.session_preferences[sessionID] = voiceURI
        save(p)
    }

    func clearPreferred(sessionID: String) {
        var p = load()
        p.session_preferences.removeValue(forKey: sessionID)
        save(p)
    }

    func preferred(sessionID: String) -> String? {
        load().session_preferences[sessionID]
    }

    /// Returns the cursor value BEFORE advancement. Callers use the returned value
    /// modulo the current filtered voice count; next invocation gets cursor+1.
    func advanceCursor() -> Int {
        var p = load()
        let cur = p.voice_cursor ?? 0
        p.voice_cursor = cur &+ 1
        save(p)
        return cur
    }

    private func stripJSONComments(_ data: Data) -> Data {
        guard let text = String(data: data, encoding: .utf8) else { return data }
        var out = ""
        out.reserveCapacity(text.count)
        var inString = false
        var i = text.startIndex
        while i < text.endIndex {
            let ch = text[i]
            if inString {
                out.append(ch)
                if ch == "\\", text.index(after: i) < text.endIndex { out.append(text[text.index(after: i)]); i = text.index(i, offsetBy: 2); continue }
                if ch == "\"" { inString = false }
                i = text.index(after: i); continue
            }
            if ch == "\"" { inString = true; out.append(ch); i = text.index(after: i); continue }
            if ch == "/", text.index(after: i) < text.endIndex, text[text.index(after: i)] == "/" {
                while i < text.endIndex && text[i] != "\n" { i = text.index(after: i) }
                continue
            }
            out.append(ch)
            i = text.index(after: i)
        }
        return out.data(using: .utf8) ?? data
    }
}
