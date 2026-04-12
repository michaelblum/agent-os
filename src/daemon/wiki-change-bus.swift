// wiki-change-bus.swift — Wiki change event bus (Task 4)

import Foundation

/// Change operation type for wiki file events.
enum WikiChangeOp: String {
    case created
    case updated
    case deleted
}

/// Bus for emitting wiki_page_changed events to daemon subscribers.
/// Call WikiChangeBus.shared.daemon = self during daemon startup to activate.
final class WikiChangeBus {
    static let shared = WikiChangeBus()
    private init() {}

    /// Set by UnifiedDaemon.start() so emit() can broadcast events.
    weak var daemon: UnifiedDaemon?

    func emit(path: String, op: WikiChangeOp) {
        guard let daemon = daemon else { return }

        var type: String? = nil
        if op != .deleted {
            let full = URL(fileURLWithPath: aosStateDir())
                .appendingPathComponent("wiki")
                .appendingPathComponent(path)
            type = WikiFrontmatter.readType(at: full)
        }

        var payload: [String: Any] = ["path": path, "op": op.rawValue]
        if let t = type { payload["type"] = t }
        daemon.broadcastEvent(service: "wiki", event: "wiki_page_changed", data: payload)
    }
}

extension WikiFrontmatter {
    /// Read just the `type:` field from a wiki page's frontmatter.
    /// Returns nil if the file doesn't exist, can't be read, or has no type field.
    static func readType(at url: URL) -> String? {
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return parseWikiPage(content: content).frontmatter.type
    }
}

/// Static hooks for updating the wiki index from the write API.
/// Task 5 will replace these stubs with real WikiIndex instance calls
/// routed through the daemon's index manager.
enum WikiIndexHooks {
    static func reindex(path: String) {
        // no-op stub — Task 5 wires in daemon-held WikiIndex instance
    }

    static func remove(path: String) {
        // no-op stub — Task 5 wires in daemon-held WikiIndex instance
    }
}
