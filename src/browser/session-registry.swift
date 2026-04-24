// session-registry.swift — CLI-local registry of browser focus channels.
//
// Backing file: <aosStateDir>/browser/sessions.json (mode-scoped via
// runtime-paths). Each entry represents one playwright-cli session mapped
// to one aos focus channel.

import Foundation

struct BrowserSessionRecord: Codable, Equatable {
    let id: String                 // focus channel id + playwright-cli -s= name
    let mode: String               // "attach" | "launched"
    let attach_kind: String?       // "extension" | "cdp" | null (launched only)
    let headless: Bool?            // launched only; null for attach
    let browser_window_id: Int?    // CGWindowID when local+visible, else null
    let active_url: String?        // last-known active tab URL
    let updated_at: String         // ISO8601
}

enum SessionRegistryError: Error {
    case readError(String)
    case writeError(String)
    case duplicateID(String)
    case notFound(String)
}

func browserRegistryPath() -> String {
    // Uses the shared aosStateDir() so env-var semantics (AOS_STATE_ROOT,
    // AOS_RUNTIME_MODE, executable-path mode inference, ~ expansion) stay
    // in one place.
    let dir = "\(aosStateDir())/browser"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    return "\(dir)/sessions.json"
}

func readRegistry() throws -> [BrowserSessionRecord] {
    let path = browserRegistryPath()
    guard FileManager.default.fileExists(atPath: path) else { return [] }
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        if data.isEmpty { return [] }
        return try JSONDecoder().decode([BrowserSessionRecord].self, from: data)
    } catch {
        throw SessionRegistryError.readError("\(error)")
    }
}

func writeRegistry(_ records: [BrowserSessionRecord]) throws {
    let path = browserRegistryPath()
    let enc = JSONEncoder()
    enc.outputFormatting = [.sortedKeys, .prettyPrinted]
    do {
        let data = try enc.encode(records)
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        throw SessionRegistryError.writeError("\(error)")
    }
}

func addRegistryRecord(_ r: BrowserSessionRecord) throws {
    var all = try readRegistry()
    if all.contains(where: { $0.id == r.id }) {
        throw SessionRegistryError.duplicateID(r.id)
    }
    all.append(r)
    try writeRegistry(all)
}

func removeRegistryRecord(id: String) throws {
    var all = try readRegistry()
    guard all.contains(where: { $0.id == id }) else {
        throw SessionRegistryError.notFound(id)
    }
    all.removeAll { $0.id == id }
    try writeRegistry(all)
}

func findRegistryRecord(id: String) throws -> BrowserSessionRecord? {
    return try readRegistry().first { $0.id == id }
}

func isoNow() -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: Date())
}
