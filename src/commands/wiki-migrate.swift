// wiki-migrate.swift — aos wiki migrate-namespaces subcommand
// Relocates flat entities/concepts/plugins into aos/ namespace. Idempotent.

import Foundation

enum WikiMigrate {
    /// Relocate flat entities/concepts/plugins into aos/. Idempotent.
    /// Creates wiki.pre-namespace-bak/ backup on first run.
    /// Returns true if migration ran, false if already migrated.
    @discardableResult
    static func migrateIfNeeded(wikiRoot: URL) throws -> Bool {
        let fm = FileManager.default
        let aosDir = wikiRoot.appendingPathComponent("aos")
        if fm.fileExists(atPath: aosDir.path) { return false }

        let legacy = ["entities", "concepts", "plugins"]
        let presentLegacy = legacy.filter {
            fm.fileExists(atPath: wikiRoot.appendingPathComponent($0).path)
        }
        guard !presentLegacy.isEmpty else { return false }

        // Backup first
        let backup = wikiRoot.deletingLastPathComponent()
            .appendingPathComponent(wikiRoot.lastPathComponent + ".pre-namespace-bak")
        if !fm.fileExists(atPath: backup.path) {
            try fm.copyItem(at: wikiRoot, to: backup)
        }

        try fm.createDirectory(at: aosDir, withIntermediateDirectories: true)
        for name in presentLegacy {
            let src = wikiRoot.appendingPathComponent(name)
            let dst = aosDir.appendingPathComponent(name)
            try fm.moveItem(at: src, to: dst)
        }
        return true
    }
}

// MARK: - CLI entry point

func wikiMigrateNamespacesCommand(args: [String]) {
    let wikiRootPath: String
    if let idx = args.firstIndex(of: "--wiki-root"), idx + 1 < args.count {
        wikiRootPath = args[idx + 1]
    } else {
        wikiRootPath = aosWikiDir()
    }

    let wikiRoot = URL(fileURLWithPath: (wikiRootPath as NSString).expandingTildeInPath)

    do {
        let migrated = try WikiMigrate.migrateIfNeeded(wikiRoot: wikiRoot)
        if migrated {
            print("Migrated wiki at \(wikiRoot.path) → \(wikiRoot.path)/aos/")
        } else {
            print("Already migrated (aos/ namespace present or no legacy dirs found). No-op.")
        }
    } catch {
        exitError("Migration failed: \(error)", code: "WIKI_MIGRATE_FAILED")
    }
}
