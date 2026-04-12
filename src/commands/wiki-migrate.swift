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

        let legacy = ["entities", "concepts", "plugins"]
        let presentLegacy = legacy.filter {
            fm.fileExists(atPath: wikiRoot.appendingPathComponent($0).path)
        }

        // True no-op: no legacy dirs at top level. aos/ may or may not exist —
        // either way there's nothing to move. If aos/ is present with legacy
        // dirs still alongside it, we fall through and finish the migration.
        guard !presentLegacy.isEmpty else { return false }

        // Backup first — skip if a prior (possibly interrupted) run already created one.
        let backup = wikiRoot.deletingLastPathComponent()
            .appendingPathComponent(wikiRoot.lastPathComponent + ".pre-namespace-bak")
        if !fm.fileExists(atPath: backup.path) {
            try fm.copyItem(at: wikiRoot, to: backup)
        }

        // Ensure aos/ exists (may already exist from a partial prior run).
        if !fm.fileExists(atPath: aosDir.path) {
            try fm.createDirectory(at: aosDir, withIntermediateDirectories: true)
        }

        for name in presentLegacy {
            let src = wikiRoot.appendingPathComponent(name)
            let dst = aosDir.appendingPathComponent(name)
            // Defensive: if aos/<name> already exists, skip rather than clobber.
            // presentLegacy filtered on top-level existence, so this only trips
            // in the rare both-exist state — leave it for manual resolution.
            if fm.fileExists(atPath: dst.path) { continue }
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
