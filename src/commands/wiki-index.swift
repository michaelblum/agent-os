// wiki-index.swift — SQLite index for the wiki knowledge base

import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

// MARK: - Database Lifecycle

/// SQLite wrapper for the wiki knowledge base. Not thread-safe; use one instance per caller.
class WikiIndex {
    private var db: OpaquePointer?
    let dbPath: String

    init(dbPath: String) {
        self.dbPath = dbPath
    }

    func open() {
        guard sqlite3_open(dbPath, &db) == SQLITE_OK else {
            exitError("Failed to open wiki database at \(dbPath): \(dbError())", code: "WIKI_DB_ERROR")
        }
        exec("PRAGMA journal_mode=WAL")
        exec("PRAGMA foreign_keys=ON")
    }

    func close() {
        if db != nil {
            sqlite3_close(db)
            db = nil
        }
    }

    // MARK: - Schema

    func createTables() {
        exec("""
            CREATE TABLE IF NOT EXISTS pages (
                path        TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT,
                tags        TEXT,
                plugin      TEXT,
                modified_at INTEGER NOT NULL
            )
        """)
        exec("""
            CREATE TABLE IF NOT EXISTS links (
                source_path TEXT NOT NULL,
                target_path TEXT NOT NULL,
                UNIQUE(source_path, target_path)
            )
        """)
        exec("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path)")
        exec("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path)")
        exec("""
            CREATE TABLE IF NOT EXISTS plugins (
                name        TEXT PRIMARY KEY,
                version     TEXT,
                author      TEXT,
                description TEXT,
                triggers    TEXT,
                requires    TEXT,
                modified_at INTEGER NOT NULL
            )
        """)
    }

    func dropTables() {
        exec("DROP TABLE IF EXISTS links")
        exec("DROP TABLE IF EXISTS pages")
        exec("DROP TABLE IF EXISTS plugins")
    }

    // MARK: - Page Operations

    func upsertPage(path: String, type: String, name: String, description: String?, tags: [String], plugin: String?, modifiedAt: Int) {
        let tagsJSON = tags.isEmpty ? nil : (try? JSONSerialization.data(withJSONObject: tags))
            .flatMap { String(data: $0, encoding: .utf8) }

        let sql = """
            INSERT INTO pages (path, type, name, description, tags, plugin, modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                type=excluded.type, name=excluded.name, description=excluded.description,
                tags=excluded.tags, plugin=excluded.plugin, modified_at=excluded.modified_at
        """
        execBind(sql) { stmt in
            sqlite3_bind_text(stmt, 1, path, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, type, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 3, name, -1, SQLITE_TRANSIENT)
            if let d = description {
                sqlite3_bind_text(stmt, 4, d, -1, SQLITE_TRANSIENT)
            } else { sqlite3_bind_null(stmt, 4) }
            if let t = tagsJSON {
                sqlite3_bind_text(stmt, 5, t, -1, SQLITE_TRANSIENT)
            } else { sqlite3_bind_null(stmt, 5) }
            if let p = plugin {
                sqlite3_bind_text(stmt, 6, p, -1, SQLITE_TRANSIENT)
            } else { sqlite3_bind_null(stmt, 6) }
            sqlite3_bind_int64(stmt, 7, Int64(modifiedAt))
        }
    }

    func deletePage(path: String) {
        execBind("DELETE FROM pages WHERE path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, path, -1, SQLITE_TRANSIENT)
        }
        execBind("DELETE FROM links WHERE source_path = ? OR target_path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, path, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, path, -1, SQLITE_TRANSIENT)
        }
    }

    // MARK: - Link Operations

    func upsertLink(source: String, target: String) {
        execBind("INSERT OR IGNORE INTO links (source_path, target_path) VALUES (?, ?)") { stmt in
            sqlite3_bind_text(stmt, 1, source, -1, SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, target, -1, SQLITE_TRANSIENT)
        }
    }

    func deleteLinksFrom(source: String) {
        execBind("DELETE FROM links WHERE source_path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, source, -1, SQLITE_TRANSIENT)
        }
    }

    // MARK: - Plugin Operations

    func upsertPlugin(name: String, version: String?, author: String?, description: String?, triggers: [String], requires: [String], modifiedAt: Int) {
        let triggersJSON = triggers.isEmpty ? nil : (try? JSONSerialization.data(withJSONObject: triggers))
            .flatMap { String(data: $0, encoding: .utf8) }
        let requiresJSON = requires.isEmpty ? nil : (try? JSONSerialization.data(withJSONObject: requires))
            .flatMap { String(data: $0, encoding: .utf8) }

        let sql = """
            INSERT INTO plugins (name, version, author, description, triggers, requires, modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
                version=excluded.version, author=excluded.author, description=excluded.description,
                triggers=excluded.triggers, requires=excluded.requires, modified_at=excluded.modified_at
        """
        execBind(sql) { stmt in
            sqlite3_bind_text(stmt, 1, name, -1, SQLITE_TRANSIENT)
            if let v = version { sqlite3_bind_text(stmt, 2, v, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 2) }
            if let a = author { sqlite3_bind_text(stmt, 3, a, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 3) }
            if let d = description { sqlite3_bind_text(stmt, 4, d, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 4) }
            if let t = triggersJSON { sqlite3_bind_text(stmt, 5, t, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 5) }
            if let r = requiresJSON { sqlite3_bind_text(stmt, 6, r, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 6) }
            sqlite3_bind_int64(stmt, 7, Int64(modifiedAt))
        }
    }

    func deletePlugin(name: String) {
        execBind("DELETE FROM plugins WHERE name = ?") { stmt in
            sqlite3_bind_text(stmt, 1, name, -1, SQLITE_TRANSIENT)
        }
    }

    // MARK: - Queries

    struct PageRow: Encodable {
        let path: String
        let type: String
        let name: String
        let description: String?
        let tags: [String]
        let plugin: String?
        let modified_at: Int
    }

    struct PluginRow: Encodable {
        let name: String
        let version: String?
        let author: String?
        let description: String?
        let triggers: [String]
        let requires: [String]
        let modified_at: Int
    }

    struct LinkRow: Encodable {
        let source_path: String
        let target_path: String
    }

    func listPages(type: String? = nil, plugin: String? = nil) -> [PageRow] {
        var sql = "SELECT path, type, name, description, tags, plugin, modified_at FROM pages"
        var conditions: [String] = []
        if type != nil { conditions.append("type = ?") }
        if plugin != nil { conditions.append("plugin = ?") }
        if !conditions.isEmpty { sql += " WHERE " + conditions.joined(separator: " AND ") }
        sql += " ORDER BY name"
        return queryBind(sql, bind: { stmt in
            var idx: Int32 = 1
            if let t = type {
                sqlite3_bind_text(stmt, idx, t, -1, SQLITE_TRANSIENT)
                idx += 1
            }
            if let p = plugin {
                sqlite3_bind_text(stmt, idx, p, -1, SQLITE_TRANSIENT)
                idx += 1
            }
        }, map: { stmt in
            PageRow(
                path: col(stmt, 0),
                type: col(stmt, 1),
                name: col(stmt, 2),
                description: colOpt(stmt, 3),
                tags: decodeJSONArray(colOpt(stmt, 4)),
                plugin: colOpt(stmt, 5),
                modified_at: Int(sqlite3_column_int64(stmt, 6))
            )
        })
    }

    func linksTo(path: String) -> [LinkRow] {
        queryBind(
            "SELECT source_path, target_path FROM links WHERE target_path = ? ORDER BY source_path",
            bind: { stmt in
                sqlite3_bind_text(stmt, 1, path, -1, SQLITE_TRANSIENT)
            },
            map: { stmt in
                LinkRow(source_path: col(stmt, 0), target_path: col(stmt, 1))
            }
        )
    }

    func linksFrom(path: String) -> [LinkRow] {
        queryBind(
            "SELECT source_path, target_path FROM links WHERE source_path = ? ORDER BY target_path",
            bind: { stmt in
                sqlite3_bind_text(stmt, 1, path, -1, SQLITE_TRANSIENT)
            },
            map: { stmt in
                LinkRow(source_path: col(stmt, 0), target_path: col(stmt, 1))
            }
        )
    }

    func listLinks() -> [LinkRow] {
        query(
            "SELECT source_path, target_path FROM links ORDER BY source_path, target_path"
        ) { stmt in
            LinkRow(source_path: col(stmt, 0), target_path: col(stmt, 1))
        }
    }

    func orphanPages() -> [PageRow] {
        query("""
            SELECT p.path, p.type, p.name, p.description, p.tags, p.plugin, p.modified_at
            FROM pages p
            LEFT JOIN links l ON l.target_path = p.path
            WHERE l.source_path IS NULL
            ORDER BY p.name
        """) { stmt in
            PageRow(
                path: col(stmt, 0), type: col(stmt, 1), name: col(stmt, 2),
                description: colOpt(stmt, 3), tags: decodeJSONArray(colOpt(stmt, 4)),
                plugin: colOpt(stmt, 5), modified_at: Int(sqlite3_column_int64(stmt, 6))
            )
        }
    }

    func searchPages(query q: String, type: String? = nil) -> [PageRow] {
        // Simple LIKE search across name, description
        let pattern = "%\(q)%"
        var sql = """
            SELECT path, type, name, description, tags, plugin, modified_at FROM pages
            WHERE (name LIKE ? OR description LIKE ?)
            """
        if type != nil { sql += " AND type = ?" }
        sql += " ORDER BY CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name"
        return queryBind(sql, bind: { stmt in
            var idx: Int32 = 1
            sqlite3_bind_text(stmt, idx, pattern, -1, SQLITE_TRANSIENT)
            idx += 1
            sqlite3_bind_text(stmt, idx, pattern, -1, SQLITE_TRANSIENT)
            idx += 1
            if let t = type {
                sqlite3_bind_text(stmt, idx, t, -1, SQLITE_TRANSIENT)
                idx += 1
            }
            sqlite3_bind_text(stmt, idx, pattern, -1, SQLITE_TRANSIENT)
            idx += 1
        }, map: { stmt in
            PageRow(
                path: col(stmt, 0), type: col(stmt, 1), name: col(stmt, 2),
                description: colOpt(stmt, 3), tags: decodeJSONArray(colOpt(stmt, 4)),
                plugin: colOpt(stmt, 5), modified_at: Int(sqlite3_column_int64(stmt, 6))
            )
        })
    }

    func listPlugins() -> [PluginRow] {
        query("SELECT name, version, author, description, triggers, requires, modified_at FROM plugins ORDER BY name") { stmt in
            PluginRow(
                name: col(stmt, 0), version: colOpt(stmt, 1), author: colOpt(stmt, 2),
                description: colOpt(stmt, 3), triggers: decodeJSONArray(colOpt(stmt, 4)),
                requires: decodeJSONArray(colOpt(stmt, 5)), modified_at: Int(sqlite3_column_int64(stmt, 6))
            )
        }
    }

    func pageCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM pages") { stmt in Int(sqlite3_column_int64(stmt, 0)) }
        return rows.first ?? 0
    }

    func linkCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM links") { stmt in Int(sqlite3_column_int64(stmt, 0)) }
        return rows.first ?? 0
    }

    func pluginCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM plugins") { stmt in Int(sqlite3_column_int64(stmt, 0)) }
        return rows.first ?? 0
    }

    // MARK: - SQLite Helpers

    private func dbError() -> String {
        if let err = sqlite3_errmsg(db) { return String(cString: err) }
        return "unknown error"
    }

    private func exec(_ sql: String) {
        var errMsg: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &errMsg) != SQLITE_OK {
            let msg = errMsg.map { String(cString: $0) } ?? "unknown error"
            sqlite3_free(errMsg)
            exitError("SQLite error: \(msg)\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
    }

    private func execBind(_ sql: String, bind: (OpaquePointer) -> Void) {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            exitError("SQLite prepare error: \(dbError())\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        bind(stmt!)
        let result = sqlite3_step(stmt)
        if result != SQLITE_DONE && result != SQLITE_ROW {
            let msg = dbError()
            sqlite3_finalize(stmt)
            exitError("SQLite step error: \(msg)\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        sqlite3_finalize(stmt)
    }

    private func query<T>(_ sql: String, map: (OpaquePointer) -> T) -> [T] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            exitError("SQLite query error: \(dbError())\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        var results: [T] = []
        var stepResult = sqlite3_step(stmt)
        while stepResult == SQLITE_ROW {
            results.append(map(stmt!))
            stepResult = sqlite3_step(stmt)
        }
        if stepResult != SQLITE_DONE {
            let msg = dbError()
            sqlite3_finalize(stmt)
            exitError("SQLite step error: \(msg)\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        sqlite3_finalize(stmt)
        return results
    }

    private func queryBind<T>(_ sql: String, bind: (OpaquePointer) -> Void, map: (OpaquePointer) -> T) -> [T] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            exitError("SQLite query error: \(dbError())\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        bind(stmt!)
        var results: [T] = []
        var stepResult = sqlite3_step(stmt)
        while stepResult == SQLITE_ROW {
            results.append(map(stmt!))
            stepResult = sqlite3_step(stmt)
        }
        if stepResult != SQLITE_DONE {
            let msg = dbError()
            sqlite3_finalize(stmt)
            exitError("SQLite step error: \(msg)\nSQL: \(sql)", code: "WIKI_DB_ERROR")
        }
        sqlite3_finalize(stmt)
        return results
    }

    private func col(_ stmt: OpaquePointer?, _ idx: Int32) -> String {
        if let cStr = sqlite3_column_text(stmt, idx) { return String(cString: cStr) }
        return ""
    }

    private func colOpt(_ stmt: OpaquePointer?, _ idx: Int32) -> String? {
        if sqlite3_column_type(stmt, idx) == SQLITE_NULL { return nil }
        if let cStr = sqlite3_column_text(stmt, idx) { return String(cString: cStr) }
        return nil
    }

    private func decodeJSONArray(_ json: String?) -> [String] {
        guard let json = json, let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String] else { return [] }
        return arr
    }
}
