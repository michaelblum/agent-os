# Sigil Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `aos wiki` CLI subcommands that manage a user-owned, interlinked markdown knowledge base with executable workflow plugins, stored at `~/.config/aos/{mode}/wiki/` with a SQLite index.

**Architecture:** Files are canonical — markdown pages with YAML frontmatter organized into `plugins/`, `entities/`, and `concepts/` directories. A SQLite index (`wiki.db`) is a materialized view for fast queries. All operations are `aos wiki` subcommands. Plugins follow the Claude Code/Cowork SKILL.md format for compatibility.

**Tech Stack:** Swift (macOS system SDK), SQLite3 (system library via `import SQLite3`), markdown with YAML-like frontmatter (custom parser — no external YAML dependency).

**Spec:** `docs/superpowers/specs/2026-04-09-sigil-wiki-design.md`

---

### Task 1: Build System + SQLite Smoke Test

**Files:**
- Modify: `build.sh:10`
- Create: `src/commands/wiki.swift`

This task verifies that SQLite3 links and imports correctly, and wires `aos wiki` into the command router.

- [ ] **Step 1: Add `-lsqlite3` to build.sh**

```bash
# In build.sh, change line 10 from:
swiftc -parse-as-library -O -o aos $SOURCES $SHARED_IPC
# to:
swiftc -parse-as-library -O -o aos -lsqlite3 $SOURCES $SHARED_IPC
```

- [ ] **Step 2: Create minimal wiki command router**

Create `src/commands/wiki.swift`:

```swift
// wiki.swift — aos wiki subcommands: knowledge base + workflow plugins

import Foundation
import SQLite3

// MARK: - Path Helpers

func aosWikiDir(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/wiki"
}

func aosWikiDbPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosWikiDir(for: mode))/wiki.db"
}

// MARK: - Command Router

func wikiCommand(args: [String]) {
    guard let sub = args.first else {
        exitError("Usage: aos wiki <create-plugin|add|rm|link|list|search|show|invoke|reindex|lint|seed>", code: "MISSING_SUBCOMMAND")
    }
    let subArgs = Array(args.dropFirst())
    switch sub {
    case "reindex":
        wikiReindexCommand(args: subArgs)
    default:
        exitError("Unknown wiki subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

// MARK: - Placeholder: reindex

func wikiReindexCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let wikiDir = aosWikiDir()

    // Verify SQLite3 works
    var db: OpaquePointer?
    let dbPath = aosWikiDbPath()

    // Ensure wiki directory exists
    try? FileManager.default.createDirectory(atPath: wikiDir, withIntermediateDirectories: true)

    guard sqlite3_open(dbPath, &db) == SQLITE_OK else {
        exitError("Failed to open wiki database at \(dbPath)", code: "WIKI_DB_ERROR")
    }
    sqlite3_close(db)

    if asJSON {
        print(jsonString(["status": "ok", "wiki_dir": wikiDir, "db": dbPath]))
    } else {
        print("Wiki database OK at \(dbPath)")
    }
}
```

- [ ] **Step 3: Wire wiki into main.swift command router**

Add to the switch in `main.swift`, before the `default` case:

```swift
        case "wiki":
            wikiCommand(args: Array(args.dropFirst()))
```

Add to `printUsage()` — in the Commands section:

```
      wiki <subcommand>  Knowledge base — browse, search, invoke workflow plugins
```

- [ ] **Step 4: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki reindex --json`
Expected: JSON output with `"status": "ok"` and paths to wiki dir and db.

Run: `ls ~/.config/aos/repo/wiki/`
Expected: `wiki.db` exists.

- [ ] **Step 5: Commit**

```bash
git add build.sh src/commands/wiki.swift src/main.swift
git commit -m "feat(wiki): wire aos wiki command with SQLite3 integration"
```

---

### Task 2: Frontmatter Parser

**Files:**
- Create: `src/commands/wiki-frontmatter.swift`

The wiki needs to parse YAML-like frontmatter from markdown files. This is a minimal parser for the subset we use — not a full YAML parser.

- [ ] **Step 1: Create the frontmatter parser**

Create `src/commands/wiki-frontmatter.swift`:

```swift
// wiki-frontmatter.swift — Parse YAML-like frontmatter from markdown files

import Foundation

struct WikiFrontmatter {
    let type: String?           // "workflow", "entity", "concept"
    let name: String?
    let description: String?
    let tags: [String]
    let version: String?
    let author: String?
    let triggers: [String]
    let requires: [String]
    let plugin: String?         // set by indexer, not parsed from file
    let raw: [String: String]   // all key-value pairs as strings
}

struct WikiPage {
    let frontmatter: WikiFrontmatter
    let body: String            // markdown body after frontmatter
    let rawContent: String      // full file content including frontmatter
}

/// Parse a markdown file with optional YAML frontmatter delimited by `---`.
/// Returns the frontmatter fields and the body separately.
func parseWikiPage(content: String) -> WikiPage {
    let lines = content.components(separatedBy: "\n")

    // Must start with ---
    guard lines.first?.trimmingCharacters(in: .whitespaces) == "---" else {
        return WikiPage(
            frontmatter: WikiFrontmatter(type: nil, name: nil, description: nil, tags: [], version: nil, author: nil, triggers: [], requires: [], plugin: nil, raw: [:]),
            body: content,
            rawContent: content
        )
    }

    // Find closing ---
    var closingIndex: Int?
    for i in 1..<lines.count {
        if lines[i].trimmingCharacters(in: .whitespaces) == "---" {
            closingIndex = i
            break
        }
    }

    guard let endIdx = closingIndex else {
        return WikiPage(
            frontmatter: WikiFrontmatter(type: nil, name: nil, description: nil, tags: [], version: nil, author: nil, triggers: [], requires: [], plugin: nil, raw: [:]),
            body: content,
            rawContent: content
        )
    }

    // Parse frontmatter lines (between the two ---)
    let fmLines = Array(lines[1..<endIdx])
    var raw: [String: String] = [:]
    var currentKey: String?
    var currentValue: String = ""

    for line in fmLines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }

        // Check if this is a continuation line (starts with whitespace, for multi-line description)
        if line.first?.isWhitespace == true, let key = currentKey {
            currentValue += " " + trimmed
            raw[key] = currentValue
            continue
        }

        // key: value
        if let colonRange = trimmed.range(of: ":") {
            let key = String(trimmed[trimmed.startIndex..<colonRange.lowerBound]).trimmingCharacters(in: .whitespaces)
            let value = String(trimmed[colonRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            // Strip surrounding quotes
            let cleaned = value.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            raw[key] = cleaned
            currentKey = key
            currentValue = cleaned
        }
    }

    // Extract typed fields
    let fm = WikiFrontmatter(
        type: raw["type"],
        name: raw["name"],
        description: raw["description"],
        tags: parseYAMLArray(raw["tags"]),
        version: raw["version"],
        author: raw["author"],
        triggers: parseYAMLArray(raw["triggers"]),
        requires: parseYAMLArray(raw["requires"]),
        plugin: nil,
        raw: raw
    )

    // Body is everything after the closing ---
    let bodyLines = Array(lines[(endIdx + 1)...])
    let body = bodyLines.joined(separator: "\n").trimmingCharacters(in: .newlines)

    return WikiPage(frontmatter: fm, body: body, rawContent: content)
}

/// Parse a YAML-style inline array: [item1, item2, item3]
func parseYAMLArray(_ value: String?) -> [String] {
    guard let value = value, !value.isEmpty else { return [] }
    let trimmed = value.trimmingCharacters(in: .whitespaces)
    guard trimmed.hasPrefix("["), trimmed.hasSuffix("]") else {
        // Single value, not an array
        return trimmed.isEmpty ? [] : [trimmed]
    }
    let inner = String(trimmed.dropFirst().dropLast())
    return inner.components(separatedBy: ",")
        .map { $0.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'")) }
        .filter { !$0.isEmpty }
}

/// Parse a multi-line YAML description (handles `>` block scalar indicator)
/// Strips the `>` prefix if present and joins continuation lines.
private func cleanDescription(_ raw: String) -> String {
    var s = raw
    if s.hasPrefix(">") {
        s = String(s.dropFirst()).trimmingCharacters(in: .whitespaces)
    }
    return s
}
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/wiki-frontmatter.swift
git commit -m "feat(wiki): add frontmatter parser for wiki markdown pages"
```

---

### Task 3: SQLite Index — Schema + Core Operations

**Files:**
- Create: `src/commands/wiki-index.swift`

> **Note (post-review):** The snippet below was updated after code review. The canonical form is the committed file at `src/commands/wiki-index.swift`. The review pass added: parameterized read-path queries via a new `queryBind<T>` helper (SQL injection / quote-break fix), `Int64`/`sqlite3_bind_int64` for `modified_at` (2038 trap fix), step-error handling in `query<T>`, a file-scope `SQLITE_TRANSIENT` constant, `ORDER BY` on `linksTo`/`linksFrom`, and `idx_links_source` / `idx_links_target` indices. Public method signatures on `WikiIndex` did not change, so Tasks 4-12 are unaffected.

- [ ] **Step 1: Create the SQLite index module**

Create `src/commands/wiki-index.swift`:

```swift
// wiki-index.swift — SQLite index for the wiki knowledge base

import Foundation
import SQLite3

// MARK: - Database Lifecycle

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
            sqlite3_bind_text(stmt, 1, path, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_text(stmt, 2, type, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_text(stmt, 3, name, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            if let d = description {
                sqlite3_bind_text(stmt, 4, d, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            } else { sqlite3_bind_null(stmt, 4) }
            if let t = tagsJSON {
                sqlite3_bind_text(stmt, 5, t, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            } else { sqlite3_bind_null(stmt, 5) }
            if let p = plugin {
                sqlite3_bind_text(stmt, 6, p, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            } else { sqlite3_bind_null(stmt, 6) }
            sqlite3_bind_int(stmt, 7, Int32(modifiedAt))
        }
    }

    func deletePage(path: String) {
        execBind("DELETE FROM pages WHERE path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, path, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
        execBind("DELETE FROM links WHERE source_path = ? OR target_path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, path, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_text(stmt, 2, path, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
    }

    // MARK: - Link Operations

    func upsertLink(source: String, target: String) {
        execBind("INSERT OR IGNORE INTO links (source_path, target_path) VALUES (?, ?)") { stmt in
            sqlite3_bind_text(stmt, 1, source, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            sqlite3_bind_text(stmt, 2, target, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        }
    }

    func deleteLinksFrom(source: String) {
        execBind("DELETE FROM links WHERE source_path = ?") { stmt in
            sqlite3_bind_text(stmt, 1, source, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
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
            sqlite3_bind_text(stmt, 1, name, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            if let v = version { sqlite3_bind_text(stmt, 2, v, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(stmt, 2) }
            if let a = author { sqlite3_bind_text(stmt, 3, a, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(stmt, 3) }
            if let d = description { sqlite3_bind_text(stmt, 4, d, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(stmt, 4) }
            if let t = triggersJSON { sqlite3_bind_text(stmt, 5, t, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(stmt, 5) }
            if let r = requiresJSON { sqlite3_bind_text(stmt, 6, r, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) } else { sqlite3_bind_null(stmt, 6) }
            sqlite3_bind_int(stmt, 7, Int32(modifiedAt))
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
        if let t = type { conditions.append("type = '\(t)'") }
        if let p = plugin { conditions.append("plugin = '\(p)'") }
        if !conditions.isEmpty { sql += " WHERE " + conditions.joined(separator: " AND ") }
        sql += " ORDER BY name"
        return query(sql) { stmt in
            PageRow(
                path: col(stmt, 0),
                type: col(stmt, 1),
                name: col(stmt, 2),
                description: colOpt(stmt, 3),
                tags: decodeJSONArray(colOpt(stmt, 4)),
                plugin: colOpt(stmt, 5),
                modified_at: Int(sqlite3_column_int(stmt, 6))
            )
        }
    }

    func linksTo(path: String) -> [LinkRow] {
        query("SELECT source_path, target_path FROM links WHERE target_path = '\(path)'") { stmt in
            LinkRow(source_path: col(stmt, 0), target_path: col(stmt, 1))
        }
    }

    func linksFrom(path: String) -> [LinkRow] {
        query("SELECT source_path, target_path FROM links WHERE source_path = '\(path)'") { stmt in
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
                plugin: colOpt(stmt, 5), modified_at: Int(sqlite3_column_int(stmt, 6))
            )
        }
    }

    func searchPages(query q: String, type: String? = nil) -> [PageRow] {
        // Simple LIKE search across name, description
        let pattern = "%\(q)%"
        var sql = """
            SELECT path, type, name, description, tags, plugin, modified_at FROM pages
            WHERE (name LIKE '\(pattern)' OR description LIKE '\(pattern)')
        """
        if let t = type { sql += " AND type = '\(t)'" }
        sql += " ORDER BY CASE WHEN name LIKE '\(pattern)' THEN 0 ELSE 1 END, name"
        return query(sql) { stmt in
            PageRow(
                path: col(stmt, 0), type: col(stmt, 1), name: col(stmt, 2),
                description: colOpt(stmt, 3), tags: decodeJSONArray(colOpt(stmt, 4)),
                plugin: colOpt(stmt, 5), modified_at: Int(sqlite3_column_int(stmt, 6))
            )
        }
    }

    func listPlugins() -> [PluginRow] {
        query("SELECT name, version, author, description, triggers, requires, modified_at FROM plugins ORDER BY name") { stmt in
            PluginRow(
                name: col(stmt, 0), version: colOpt(stmt, 1), author: colOpt(stmt, 2),
                description: colOpt(stmt, 3), triggers: decodeJSONArray(colOpt(stmt, 4)),
                requires: decodeJSONArray(colOpt(stmt, 5)), modified_at: Int(sqlite3_column_int(stmt, 6))
            )
        }
    }

    func pageCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM pages") { stmt in Int(sqlite3_column_int(stmt, 0)) }
        return rows.first ?? 0
    }

    func linkCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM links") { stmt in Int(sqlite3_column_int(stmt, 0)) }
        return rows.first ?? 0
    }

    func pluginCount() -> Int {
        let rows: [Int] = query("SELECT COUNT(*) FROM plugins") { stmt in Int(sqlite3_column_int(stmt, 0)) }
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
            return
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
            return []
        }
        var results: [T] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            results.append(map(stmt!))
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
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/wiki-index.swift
git commit -m "feat(wiki): SQLite index with pages, links, plugins tables"
```

---

### Task 4: Reindex Command — Full Filesystem Scan

**Files:**
- Modify: `src/commands/wiki.swift`

Replace the placeholder `wikiReindexCommand` with a real implementation that scans the wiki directory, parses frontmatter, extracts markdown links, and populates the index.

- [ ] **Step 1: Implement reindex**

Replace the `wikiReindexCommand` function in `src/commands/wiki.swift` with:

```swift
// MARK: - Reindex

func wikiReindexCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let wikiDir = aosWikiDir()

    // Ensure directory structure exists
    for sub in ["plugins", "entities", "concepts"] {
        try? FileManager.default.createDirectory(
            atPath: "\(wikiDir)/\(sub)",
            withIntermediateDirectories: true
        )
    }

    let index = WikiIndex(dbPath: aosWikiDbPath())
    index.open()
    index.dropTables()
    index.createTables()

    let fm = FileManager.default
    var pageCount = 0
    var linkCount = 0
    var pluginCount = 0

    // Scan plugins/
    let pluginsDir = "\(wikiDir)/plugins"
    if let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsDir) {
        for pluginName in pluginDirs {
            let pluginPath = "\(pluginsDir)/\(pluginName)"
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else { continue }

            let skillPath = "\(pluginPath)/SKILL.md"
            guard let skillContent = try? String(contentsOfFile: skillPath, encoding: .utf8) else { continue }

            let page = parseWikiPage(content: skillContent)
            let relativePath = "plugins/\(pluginName)/SKILL.md"
            let mtime = fileModTime(skillPath)

            // Index the plugin itself
            index.upsertPlugin(
                name: pluginName,
                version: page.frontmatter.version,
                author: page.frontmatter.author,
                description: page.frontmatter.description,
                triggers: page.frontmatter.triggers,
                requires: page.frontmatter.requires,
                modifiedAt: mtime
            )
            pluginCount += 1

            // Index SKILL.md as a workflow page
            index.upsertPage(
                path: relativePath,
                type: "workflow",
                name: page.frontmatter.name ?? pluginName,
                description: page.frontmatter.description,
                tags: page.frontmatter.tags,
                plugin: pluginName,
                modifiedAt: mtime
            )
            pageCount += 1

            // Extract and index links
            let links = extractMarkdownLinks(from: page.body, relativeTo: "plugins/\(pluginName)")
            for target in links {
                index.upsertLink(source: relativePath, target: target)
                linkCount += 1
            }

            // Scan references/ within the plugin
            let refsDir = "\(pluginPath)/references"
            if let refFiles = try? fm.contentsOfDirectory(atPath: refsDir) {
                for refFile in refFiles where refFile.hasSuffix(".md") {
                    let refPath = "\(refsDir)/\(refFile)"
                    guard let refContent = try? String(contentsOfFile: refPath, encoding: .utf8) else { continue }
                    let refPage = parseWikiPage(content: refContent)
                    let refRelPath = "plugins/\(pluginName)/references/\(refFile)"
                    let refMtime = fileModTime(refPath)

                    index.upsertPage(
                        path: refRelPath,
                        type: refPage.frontmatter.type ?? "concept",
                        name: refPage.frontmatter.name ?? refFile.replacingOccurrences(of: ".md", with: ""),
                        description: refPage.frontmatter.description,
                        tags: refPage.frontmatter.tags,
                        plugin: pluginName,
                        modifiedAt: refMtime
                    )
                    pageCount += 1

                    let refLinks = extractMarkdownLinks(from: refPage.body, relativeTo: "plugins/\(pluginName)/references")
                    for target in refLinks {
                        index.upsertLink(source: refRelPath, target: target)
                        linkCount += 1
                    }
                }
            }
        }
    }

    // Scan entities/ and concepts/
    for dirType in ["entities", "concepts"] {
        let typeDir = "\(wikiDir)/\(dirType)"
        guard let files = try? fm.contentsOfDirectory(atPath: typeDir) else { continue }
        for file in files where file.hasSuffix(".md") {
            let filePath = "\(typeDir)/\(file)"
            guard let content = try? String(contentsOfFile: filePath, encoding: .utf8) else { continue }
            let page = parseWikiPage(content: content)
            let relativePath = "\(dirType)/\(file)"
            let mtime = fileModTime(filePath)
            let inferredType = dirType == "entities" ? "entity" : "concept"

            index.upsertPage(
                path: relativePath,
                type: page.frontmatter.type ?? inferredType,
                name: page.frontmatter.name ?? file.replacingOccurrences(of: ".md", with: ""),
                description: page.frontmatter.description,
                tags: page.frontmatter.tags,
                plugin: nil,
                modifiedAt: mtime
            )
            pageCount += 1

            let links = extractMarkdownLinks(from: page.body, relativeTo: dirType)
            for target in links {
                index.upsertLink(source: relativePath, target: target)
                linkCount += 1
            }
        }
    }

    index.close()

    if asJSON {
        let result: [String: Any] = [
            "status": "ok",
            "pages": pageCount,
            "links": linkCount,
            "plugins": pluginCount
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) { print(s) }
    } else {
        print("Reindexed: \(pageCount) pages, \(linkCount) links, \(pluginCount) plugins")
    }
}

// MARK: - Helpers

/// Extract markdown links like [text](../path/to/file.md) and return resolved relative paths.
func extractMarkdownLinks(from body: String, relativeTo dir: String) -> [String] {
    var results: [String] = []
    // Match [text](path) where path ends in .md
    let pattern = "\\[([^\\]]+)\\]\\(([^)]+\\.md)\\)"
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return results }
    let nsBody = body as NSString
    let matches = regex.matches(in: body, range: NSRange(location: 0, length: nsBody.length))
    for match in matches {
        let pathRange = match.range(at: 2)
        let linkPath = nsBody.substring(with: pathRange)
        // Skip external URLs
        if linkPath.hasPrefix("http://") || linkPath.hasPrefix("https://") { continue }
        // Resolve relative path
        let resolved = resolveRelativePath(linkPath, from: dir)
        results.append(resolved)
    }
    return results
}

/// Resolve a relative path like "../concepts/ipc-protocol.md" from a base directory
func resolveRelativePath(_ link: String, from baseDir: String) -> String {
    let baseParts = baseDir.components(separatedBy: "/")
    let linkParts = link.components(separatedBy: "/")
    var result = baseParts
    for part in linkParts {
        if part == ".." {
            if !result.isEmpty { result.removeLast() }
        } else if part != "." {
            result.append(part)
        }
    }
    return result.joined(separator: "/")
}

/// Get file modification time as unix epoch
func fileModTime(_ path: String) -> Int {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let date = attrs[.modificationDate] as? Date else { return 0 }
    return Int(date.timeIntervalSince1970)
}
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki reindex --json`
Expected: `{"links":0,"pages":0,"plugins":0,"status":"ok"}` (empty wiki)

- [ ] **Step 3: Commit**

```bash
git add src/commands/wiki.swift
git commit -m "feat(wiki): implement reindex — full filesystem scan with link extraction"
```

---

### Task 5: create-plugin, add, rm Commands

**Files:**
- Modify: `src/commands/wiki.swift`

- [ ] **Step 1: Add template helpers and scaffold commands**

Add to `src/commands/wiki.swift`, in the command router switch:

```swift
    case "create-plugin":
        wikiCreatePluginCommand(args: subArgs)
    case "add":
        wikiAddCommand(args: subArgs)
    case "rm":
        wikiRmCommand(args: subArgs)
```

Then add the implementations:

```swift
// MARK: - Create Plugin

func wikiCreatePluginCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    guard let name = args.first(where: { !$0.hasPrefix("-") }) else {
        exitError("Usage: aos wiki create-plugin <name> [--json]", code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    let pluginDir = "\(wikiDir)/plugins/\(name)"
    let skillPath = "\(pluginDir)/SKILL.md"

    if FileManager.default.fileExists(atPath: skillPath) {
        exitError("Plugin '\(name)' already exists at \(pluginDir)", code: "WIKI_PLUGIN_EXISTS")
    }

    // Create directory structure
    try? FileManager.default.createDirectory(atPath: "\(pluginDir)/references", withIntermediateDirectories: true)

    // Write SKILL.md template
    let template = """
    ---
    name: \(name)
    description: >
      Describe when this plugin should be used. Include trigger phrases
      and contexts where it should activate.
    version: "0.1.0"
    author: ""
    tags: []
    triggers: []
    requires: []
    ---

    # \(name.replacingOccurrences(of: "-", with: " ").capitalized)

    ## Purpose

    Describe what this workflow does and why.

    ## Steps

    1. First step
    2. Second step

    ## Related

    """
    try? template.write(toFile: skillPath, atomically: true, encoding: .utf8)

    // Update index
    let index = openWikiIndex()
    let page = parseWikiPage(content: template)
    let relativePath = "plugins/\(name)/SKILL.md"
    index.upsertPage(
        path: relativePath, type: "workflow", name: name,
        description: page.frontmatter.description, tags: [],
        plugin: name, modifiedAt: Int(Date().timeIntervalSince1970)
    )
    index.upsertPlugin(
        name: name, version: "0.1.0", author: nil, description: page.frontmatter.description,
        triggers: [], requires: [], modifiedAt: Int(Date().timeIntervalSince1970)
    )
    index.close()

    if asJSON {
        print(jsonString(["status": "ok", "plugin": name, "path": pluginDir]))
    } else {
        print("Created plugin '\(name)' at \(pluginDir)")
        print("Edit: \(skillPath)")
    }
}

// MARK: - Add Page

func wikiAddCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let nonFlags = args.filter { !$0.hasPrefix("-") }
    guard nonFlags.count >= 2 else {
        exitError("Usage: aos wiki add <entity|concept> <name> [--json]", code: "MISSING_ARG")
    }
    let typeArg = nonFlags[0]
    let name = nonFlags[1]

    guard typeArg == "entity" || typeArg == "concept" else {
        exitError("Type must be 'entity' or 'concept', got '\(typeArg)'", code: "WIKI_INVALID_TYPE")
    }

    let wikiDir = aosWikiDir()
    let dirName = typeArg == "entity" ? "entities" : "concepts"
    let filePath = "\(wikiDir)/\(dirName)/\(name).md"

    if FileManager.default.fileExists(atPath: filePath) {
        exitError("Page '\(name)' already exists at \(filePath)", code: "WIKI_PAGE_EXISTS")
    }

    try? FileManager.default.createDirectory(
        atPath: "\(wikiDir)/\(dirName)", withIntermediateDirectories: true
    )

    let displayName = name.replacingOccurrences(of: "-", with: " ").capitalized
    let template = """
    ---
    type: \(typeArg)
    name: \(displayName)
    description: ""
    tags: []
    ---

    # \(displayName)

    ## Overview

    ## Related

    """
    try? template.write(toFile: filePath, atomically: true, encoding: .utf8)

    // Update index
    let index = openWikiIndex()
    let relativePath = "\(dirName)/\(name).md"
    index.upsertPage(
        path: relativePath, type: typeArg, name: displayName,
        description: nil, tags: [], plugin: nil,
        modifiedAt: Int(Date().timeIntervalSince1970)
    )
    index.close()

    if asJSON {
        print(jsonString(["status": "ok", "type": typeArg, "name": name, "path": filePath]))
    } else {
        print("Created \(typeArg) '\(name)' at \(filePath)")
    }
}

// MARK: - Remove Page

func wikiRmCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    guard let pathArg = args.first(where: { !$0.hasPrefix("-") }) else {
        exitError("Usage: aos wiki rm <relative-path-or-name> [--json]", code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    let fullPath: String
    let relativePath: String

    // Resolve: could be a relative path or a bare name
    if pathArg.contains("/") {
        relativePath = pathArg
        fullPath = "\(wikiDir)/\(pathArg)"
    } else {
        // Search for it
        let candidates = ["entities/\(pathArg).md", "concepts/\(pathArg).md"]
        if let found = candidates.first(where: { FileManager.default.fileExists(atPath: "\(wikiDir)/\($0)") }) {
            relativePath = found
            fullPath = "\(wikiDir)/\(found)"
        } else {
            exitError("Page '\(pathArg)' not found", code: "WIKI_NOT_FOUND")
        }
    }

    guard FileManager.default.fileExists(atPath: fullPath) else {
        exitError("File not found: \(fullPath)", code: "WIKI_NOT_FOUND")
    }

    // Check for incoming links
    let index = openWikiIndex()
    let incoming = index.linksTo(path: relativePath)
    if !incoming.isEmpty && !asJSON {
        print("Warning: \(incoming.count) page(s) link to this page:")
        for link in incoming { print("  \(link.source_path)") }
    }

    try? FileManager.default.removeItem(atPath: fullPath)
    index.deletePage(path: relativePath)
    index.close()

    if asJSON {
        print(jsonString(["status": "ok", "removed": relativePath, "broken_links": incoming.count]))
    } else {
        print("Removed \(relativePath)")
    }
}

// MARK: - Index Helper

/// Open the wiki index, creating tables if needed
func openWikiIndex() -> WikiIndex {
    let wikiDir = aosWikiDir()
    try? FileManager.default.createDirectory(atPath: wikiDir, withIntermediateDirectories: true)
    let index = WikiIndex(dbPath: aosWikiDbPath())
    index.open()
    index.createTables()
    return index
}
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki create-plugin test-workflow --json`
Expected: JSON with `"status": "ok"` and plugin path.

Run: `./aos wiki add entity test-entity --json`
Expected: JSON with `"status": "ok"`.

Run: `./aos wiki reindex --json`
Expected: Pages count > 0.

Run: `./aos wiki rm test-entity --json`
Expected: JSON with `"status": "ok"`.

Clean up: `rm -rf ~/.config/aos/repo/wiki/plugins/test-workflow`

- [ ] **Step 3: Commit**

```bash
git add src/commands/wiki.swift
git commit -m "feat(wiki): add create-plugin, add, rm commands"
```

---

### Task 6: list, search, show Commands

**Files:**
- Modify: `src/commands/wiki.swift`

- [ ] **Step 1: Add to command router**

Add cases to the switch in `wikiCommand`:

```swift
    case "list":
        wikiListCommand(args: subArgs)
    case "search":
        wikiSearchCommand(args: subArgs)
    case "show":
        wikiShowCommand(args: subArgs)
```

- [ ] **Step 2: Implement list command**

```swift
// MARK: - List

func wikiListCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let typeFilter = getArg(args, "--type")
    let pluginFilter = getArg(args, "--plugin")
    let linksTo = getArg(args, "--links-to")
    let linksFrom = getArg(args, "--links-from")
    let orphans = hasFlag(args, "--orphans")

    let index = openWikiIndex()

    if orphans {
        let pages = index.orphanPages()
        index.close()
        if asJSON {
            print(jsonString(pages))
        } else {
            if pages.isEmpty { print("No orphan pages."); return }
            for p in pages { print("\(p.type.padding(toLength: 10, withPad: " ", startingAt: 0)) \(p.path)  — \(p.name)") }
        }
        return
    }

    if let target = linksTo {
        let links = index.linksTo(path: target)
        index.close()
        if asJSON {
            print(jsonString(links))
        } else {
            if links.isEmpty { print("No pages link to \(target)."); return }
            for l in links { print("  \(l.source_path)") }
        }
        return
    }

    if let source = linksFrom {
        let links = index.linksFrom(path: source)
        index.close()
        if asJSON {
            print(jsonString(links))
        } else {
            if links.isEmpty { print("No outgoing links from \(source)."); return }
            for l in links { print("  \(l.target_path)") }
        }
        return
    }

    let pages = index.listPages(type: typeFilter, plugin: pluginFilter)
    index.close()

    if asJSON {
        print(jsonString(pages))
    } else {
        if pages.isEmpty { print("Wiki is empty. Run 'aos wiki seed' to get started."); return }
        for p in pages {
            let desc = p.description.map { " — \($0.prefix(60))" } ?? ""
            print("\(p.type.padding(toLength: 10, withPad: " ", startingAt: 0)) \(p.path)\(desc)")
        }
    }
}
```

- [ ] **Step 3: Implement search command**

```swift
// MARK: - Search

func wikiSearchCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let typeFilter = getArg(args, "--type")
    let nonFlags = args.filter { !$0.hasPrefix("-") && $0 != getArg(args, "--type") }

    guard let query = nonFlags.first else {
        exitError("Usage: aos wiki search <query> [--type <type>] [--json]", code: "MISSING_ARG")
    }

    let index = openWikiIndex()
    var results = index.searchPages(query: query, type: typeFilter)

    // Also search file content for matches not caught by index
    let wikiDir = aosWikiDir()
    let indexPaths = Set(results.map { $0.path })
    let contentMatches = searchFileContent(wikiDir: wikiDir, query: query, excluding: indexPaths)
    results.append(contentsOf: contentMatches)

    index.close()

    if asJSON {
        print(jsonString(results))
    } else {
        if results.isEmpty { print("No results for '\(query)'."); return }
        for r in results {
            let desc = r.description.map { " — \($0.prefix(60))" } ?? ""
            print("\(r.type.padding(toLength: 10, withPad: " ", startingAt: 0)) \(r.path)\(desc)")
        }
    }
}

/// Search file content for a query string, returning pages not already in index results
func searchFileContent(wikiDir: String, query: String, excluding: Set<String>) -> [WikiIndex.PageRow] {
    var results: [WikiIndex.PageRow] = []
    let fm = FileManager.default
    let lowerQuery = query.lowercased()

    for dirType in ["plugins", "entities", "concepts"] {
        let dirPath = "\(wikiDir)/\(dirType)"
        guard let enumerator = fm.enumerator(atPath: dirPath) else { continue }
        while let relativePath = enumerator.nextObject() as? String {
            guard relativePath.hasSuffix(".md") else { continue }
            let fullRelative = "\(dirType)/\(relativePath)"
            guard !excluding.contains(fullRelative) else { continue }
            let fullPath = "\(dirPath)/\(relativePath)"
            guard let content = try? String(contentsOfFile: fullPath, encoding: .utf8) else { continue }
            if content.lowercased().contains(lowerQuery) {
                let page = parseWikiPage(content: content)
                results.append(WikiIndex.PageRow(
                    path: fullRelative,
                    type: page.frontmatter.type ?? dirType.dropLast().description,
                    name: page.frontmatter.name ?? relativePath.replacingOccurrences(of: ".md", with: ""),
                    description: page.frontmatter.description,
                    tags: page.frontmatter.tags,
                    plugin: nil,
                    modified_at: fileModTime(fullPath)
                ))
            }
        }
    }
    return results
}
```

- [ ] **Step 4: Implement show command**

```swift
// MARK: - Show

struct WikiShowResponse: Encodable {
    let path: String
    let frontmatter: [String: String]
    let body: String
    let raw: String
}

func wikiShowCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let rawMode = hasFlag(args, "--raw")
    guard let pathArg = args.first(where: { !$0.hasPrefix("-") }) else {
        exitError("Usage: aos wiki show <path-or-name> [--raw] [--json]", code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    let fullPath: String
    let relativePath: String

    if pathArg.contains("/") || pathArg.contains(".md") {
        relativePath = pathArg
        fullPath = "\(wikiDir)/\(pathArg)"
    } else {
        // Search by name across all directories
        let candidates = [
            "entities/\(pathArg).md",
            "concepts/\(pathArg).md",
            "plugins/\(pathArg)/SKILL.md"
        ]
        if let found = candidates.first(where: { FileManager.default.fileExists(atPath: "\(wikiDir)/\($0)") }) {
            relativePath = found
            fullPath = "\(wikiDir)/\(found)"
        } else {
            exitError("Page '\(pathArg)' not found. Try 'aos wiki list' to see available pages.", code: "WIKI_NOT_FOUND")
        }
    }

    guard let content = try? String(contentsOfFile: fullPath, encoding: .utf8) else {
        exitError("Could not read \(fullPath)", code: "WIKI_READ_ERROR")
    }

    if rawMode {
        print(content)
        return
    }

    let page = parseWikiPage(content: content)

    if asJSON {
        let response = WikiShowResponse(
            path: relativePath,
            frontmatter: page.frontmatter.raw,
            body: page.body,
            raw: content
        )
        print(jsonString(response))
    } else {
        // Print formatted: metadata header then body
        if let name = page.frontmatter.name { print("# \(name)") }
        if let type = page.frontmatter.type { print("Type: \(type)") }
        if let desc = page.frontmatter.description { print("Description: \(desc)") }
        if !page.frontmatter.tags.isEmpty { print("Tags: \(page.frontmatter.tags.joined(separator: ", "))") }
        print("---")
        print(page.body)
    }
}
```

- [ ] **Step 5: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki create-plugin demo && ./aos wiki reindex && ./aos wiki list --json`
Expected: JSON array with the demo plugin's SKILL.md entry.

Run: `./aos wiki show demo --json`
Expected: JSON with frontmatter, body, raw fields.

Run: `./aos wiki search demo`
Expected: Shows the demo plugin in results.

Clean up: `rm -rf ~/.config/aos/repo/wiki/plugins/demo`

- [ ] **Step 6: Commit**

```bash
git add src/commands/wiki.swift
git commit -m "feat(wiki): add list, search, show commands with --json support"
```

---

### Task 7: link + lint Commands

**Files:**
- Modify: `src/commands/wiki.swift`

- [ ] **Step 1: Add to command router**

```swift
    case "link":
        wikiLinkCommand(args: subArgs)
    case "lint":
        wikiLintCommand(args: subArgs)
```

- [ ] **Step 2: Implement link command**

```swift
// MARK: - Link

func wikiLinkCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let nonFlags = args.filter { !$0.hasPrefix("-") }
    guard nonFlags.count >= 2 else {
        exitError("Usage: aos wiki link <from-path> <to-path> [--json]", code: "MISSING_ARG")
    }
    let fromPath = nonFlags[0]
    let toPath = nonFlags[1]

    let wikiDir = aosWikiDir()

    // Resolve from path
    let fromFull = resolveWikiPath(wikiDir: wikiDir, arg: fromPath)
    guard let fromFull = fromFull else {
        exitError("Source page '\(fromPath)' not found", code: "WIKI_NOT_FOUND")
    }

    // Resolve to path
    let toFull = resolveWikiPath(wikiDir: wikiDir, arg: toPath)
    guard let toFull = toFull else {
        exitError("Target page '\(toPath)' not found", code: "WIKI_NOT_FOUND")
    }

    // Add link to index
    let index = openWikiIndex()
    index.upsertLink(source: fromFull.relative, target: toFull.relative)
    index.close()

    // Append to Related section in source file
    let relativeLink = makeRelativeLink(from: fromFull.relative, to: toFull.relative)
    if var content = try? String(contentsOfFile: fromFull.absolute, encoding: .utf8) {
        let toPage = parseWikiPage(content: (try? String(contentsOfFile: toFull.absolute, encoding: .utf8)) ?? "")
        let linkName = toPage.frontmatter.name ?? toPath
        let linkLine = "- [\(linkName)](\(relativeLink))"

        if content.contains("## Related") {
            content = content.replacingOccurrences(of: "## Related\n", with: "## Related\n\(linkLine)\n")
        } else {
            content += "\n## Related\n\(linkLine)\n"
        }
        try? content.write(toFile: fromFull.absolute, atomically: true, encoding: .utf8)
    }

    if asJSON {
        print(jsonString(["status": "ok", "from": fromFull.relative, "to": toFull.relative]))
    } else {
        print("Linked \(fromFull.relative) → \(toFull.relative)")
    }
}

struct ResolvedPath {
    let relative: String
    let absolute: String
}

func resolveWikiPath(wikiDir: String, arg: String) -> ResolvedPath? {
    if arg.contains("/") || arg.contains(".md") {
        let abs = "\(wikiDir)/\(arg)"
        if FileManager.default.fileExists(atPath: abs) { return ResolvedPath(relative: arg, absolute: abs) }
        return nil
    }
    let candidates = [
        ("entities/\(arg).md", "\(wikiDir)/entities/\(arg).md"),
        ("concepts/\(arg).md", "\(wikiDir)/concepts/\(arg).md"),
        ("plugins/\(arg)/SKILL.md", "\(wikiDir)/plugins/\(arg)/SKILL.md")
    ]
    for (rel, abs) in candidates {
        if FileManager.default.fileExists(atPath: abs) { return ResolvedPath(relative: rel, absolute: abs) }
    }
    return nil
}

/// Compute a relative path from one wiki page to another
func makeRelativeLink(from: String, to: String) -> String {
    let fromParts = from.components(separatedBy: "/").dropLast() // directory of source
    let toParts = to.components(separatedBy: "/")

    // Find common prefix length
    var common = 0
    for i in 0..<min(fromParts.count, toParts.count) {
        if Array(fromParts)[i] == toParts[i] { common += 1 } else { break }
    }

    let ups = Array(repeating: "..", count: fromParts.count - common)
    let downs = Array(toParts[common...])
    return (ups + downs).joined(separator: "/")
}
```

- [ ] **Step 3: Implement lint command**

```swift
// MARK: - Lint

struct LintIssue: Encodable {
    let severity: String  // "error", "warning"
    let category: String  // "broken_link", "orphan", "missing_frontmatter", "malformed_plugin", "index_drift"
    let path: String
    let message: String
}

func wikiLintCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let fix = hasFlag(args, "--fix")
    let wikiDir = aosWikiDir()
    var issues: [LintIssue] = []

    // If --fix, reindex first
    if fix {
        wikiReindexCommand(args: ["--json"])
    }

    let index = openWikiIndex()
    let allPages = index.listPages()
    let allPagePaths = Set(allPages.map { $0.path })

    // 1. Broken links: links pointing to paths that don't exist
    for page in allPages {
        let outgoing = index.linksFrom(path: page.path)
        for link in outgoing {
            if !allPagePaths.contains(link.target_path) {
                // Also check if file exists on disk but just not indexed
                let diskPath = "\(wikiDir)/\(link.target_path)"
                if !FileManager.default.fileExists(atPath: diskPath) {
                    issues.append(LintIssue(
                        severity: "error", category: "broken_link",
                        path: page.path, message: "Links to '\(link.target_path)' which does not exist"
                    ))
                }
            }
        }
    }

    // 2. Orphan pages
    let orphans = index.orphanPages()
    for page in orphans {
        // SKILL.md pages are entry points, not orphans
        if page.path.hasSuffix("SKILL.md") { continue }
        issues.append(LintIssue(
            severity: "warning", category: "orphan",
            path: page.path, message: "No incoming links (orphan page)"
        ))
    }

    // 3. Missing frontmatter
    for page in allPages {
        if page.name.isEmpty {
            issues.append(LintIssue(
                severity: "error", category: "missing_frontmatter",
                path: page.path, message: "Missing 'name' in frontmatter"
            ))
        }
    }

    // 4. Malformed plugins
    let plugins = index.listPlugins()
    for plugin in plugins {
        let skillPath = "\(wikiDir)/plugins/\(plugin.name)/SKILL.md"
        if !FileManager.default.fileExists(atPath: skillPath) {
            issues.append(LintIssue(
                severity: "error", category: "malformed_plugin",
                path: "plugins/\(plugin.name)", message: "Plugin directory exists but SKILL.md is missing"
            ))
        }
        if plugin.description == nil || plugin.description?.isEmpty == true {
            issues.append(LintIssue(
                severity: "warning", category: "malformed_plugin",
                path: "plugins/\(plugin.name)/SKILL.md", message: "Plugin has no description (will not trigger reliably)"
            ))
        }
    }

    // 5. Index drift: files on disk not in the index
    let fm = FileManager.default
    for dirType in ["entities", "concepts"] {
        let dirPath = "\(wikiDir)/\(dirType)"
        guard let files = try? fm.contentsOfDirectory(atPath: dirPath) else { continue }
        for file in files where file.hasSuffix(".md") {
            let relative = "\(dirType)/\(file)"
            if !allPagePaths.contains(relative) {
                issues.append(LintIssue(
                    severity: "warning", category: "index_drift",
                    path: relative, message: "File exists on disk but not in index (run 'aos wiki reindex')"
                ))
            }
        }
    }

    index.close()

    // Fix: remove broken link entries from index
    if fix {
        let brokenLinks = issues.filter { $0.category == "broken_link" }
        if !brokenLinks.isEmpty {
            let idx = openWikiIndex()
            // Reindex already handled this via dropTables + rebuild
            idx.close()
        }
    }

    if asJSON {
        print(jsonString(issues))
    } else {
        if issues.isEmpty {
            print("Wiki is clean. No issues found.")
        } else {
            let errors = issues.filter { $0.severity == "error" }
            let warnings = issues.filter { $0.severity == "warning" }
            for issue in issues {
                let icon = issue.severity == "error" ? "ERROR" : "WARN "
                print("\(icon)  [\(issue.category)] \(issue.path): \(issue.message)")
            }
            print("\n\(errors.count) error(s), \(warnings.count) warning(s)")
        }
    }
}
```

- [ ] **Step 4: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki lint --json`
Expected: JSON array (possibly empty or with warnings for existing state).

- [ ] **Step 5: Commit**

```bash
git add src/commands/wiki.swift
git commit -m "feat(wiki): add link and lint commands"
```

---

### Task 8: invoke Command

**Files:**
- Modify: `src/commands/wiki.swift`

- [ ] **Step 1: Add to command router**

```swift
    case "invoke":
        wikiInvokeCommand(args: subArgs)
```

- [ ] **Step 2: Implement invoke**

```swift
// MARK: - Invoke

func wikiInvokeCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    guard let name = args.first(where: { !$0.hasPrefix("-") }) else {
        exitError("Usage: aos wiki invoke <plugin-name> [--json]", code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    let pluginDir = "\(wikiDir)/plugins/\(name)"
    let skillPath = "\(pluginDir)/SKILL.md"

    guard let skillContent = try? String(contentsOfFile: skillPath, encoding: .utf8) else {
        exitError("Plugin '\(name)' not found at \(pluginDir)", code: "WIKI_NOT_FOUND")
    }

    var bundle = skillContent

    // Bundle references
    let refsDir = "\(pluginDir)/references"
    if let refFiles = try? FileManager.default.contentsOfDirectory(atPath: refsDir)?.sorted() ?? [] {
        for refFile in refFiles where refFile.hasSuffix(".md") {
            let refPath = "\(refsDir)/\(refFile)"
            if let refContent = try? String(contentsOfFile: refPath, encoding: .utf8) {
                bundle += "\n\n--- BEGIN reference: \(refFile) ---\n\n"
                bundle += refContent
                bundle += "\n\n--- END reference: \(refFile) ---"
            }
        }
    }

    // Bundle scripts (show content so agent knows what's available)
    let scriptsDir = "\(pluginDir)/scripts"
    if let scriptFiles = try? FileManager.default.contentsOfDirectory(atPath: scriptsDir)?.sorted() ?? [] {
        for scriptFile in scriptFiles {
            let scriptPath = "\(scriptsDir)/\(scriptFile)"
            if let scriptContent = try? String(contentsOfFile: scriptPath, encoding: .utf8) {
                bundle += "\n\n--- BEGIN script: \(scriptFile) ---\n\n"
                bundle += scriptContent
                bundle += "\n\n--- END script: \(scriptFile) ---"
            }
        }
    }

    if asJSON {
        let response: [String: String] = [
            "plugin": name,
            "bundle": bundle
        ]
        print(jsonString(response))
    } else {
        print(bundle)
    }
}
```

- [ ] **Step 3: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki create-plugin test-invoke && ./aos wiki invoke test-invoke`
Expected: Prints the SKILL.md template content.

Clean up: `rm -rf ~/.config/aos/repo/wiki/plugins/test-invoke`

- [ ] **Step 4: Commit**

```bash
git add src/commands/wiki.swift
git commit -m "feat(wiki): add invoke command — bundles plugin into prompt payload"
```

---

### Task 9: seed Command + Starter Pack

**Files:**
- Modify: `src/commands/wiki.swift`
- Create: `wiki-seed/entities/gateway.md`
- Create: `wiki-seed/entities/sigil.md`
- Create: `wiki-seed/entities/canvas-system.md`
- Create: `wiki-seed/entities/daemon.md`
- Create: `wiki-seed/entities/studio.md`
- Create: `wiki-seed/concepts/ipc-protocol.md`
- Create: `wiki-seed/concepts/daemon-lifecycle.md`
- Create: `wiki-seed/concepts/content-server.md`
- Create: `wiki-seed/concepts/runtime-modes.md`
- Create: `wiki-seed/plugins/self-check/SKILL.md`

- [ ] **Step 1: Add seed to command router**

```swift
    case "seed":
        wikiSeedCommand(args: subArgs)
```

- [ ] **Step 2: Implement seed command**

```swift
// MARK: - Seed

func wikiSeedCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let force = hasFlag(args, "--force")
    let fromPath = getArg(args, "--from")

    let wikiDir = aosWikiDir()

    // Check if wiki already has content
    let fm = FileManager.default
    let hasContent = ["plugins", "entities", "concepts"].contains { dir in
        let dirPath = "\(wikiDir)/\(dir)"
        return (try? fm.contentsOfDirectory(atPath: dirPath))?.contains(where: { $0.hasSuffix(".md") || !$0.hasPrefix(".") }) ?? false
    }

    if hasContent && !force {
        if asJSON {
            print(jsonString(["status": "skipped", "reason": "Wiki already has content. Use --force to overwrite."]))
        } else {
            print("Wiki already has content. Use --force to seed anyway.")
        }
        return
    }

    // Determine source directory
    let sourceDir: String
    if let from = fromPath {
        sourceDir = from
    } else if let repoRoot = aosCurrentRepoRoot() {
        sourceDir = "\(repoRoot)/wiki-seed"
    } else {
        exitError("No seed source found. Use --from <path> or run from the repo.", code: "WIKI_SEED_NOT_FOUND")
    }

    guard fm.fileExists(atPath: sourceDir) else {
        exitError("Seed directory not found at \(sourceDir)", code: "WIKI_SEED_NOT_FOUND")
    }

    // Copy seed files without overwriting existing
    var copied = 0
    for subDir in ["plugins", "entities", "concepts"] {
        let srcDir = "\(sourceDir)/\(subDir)"
        let dstDir = "\(wikiDir)/\(subDir)"
        guard let enumerator = fm.enumerator(atPath: srcDir) else { continue }
        while let relativePath = enumerator.nextObject() as? String {
            let srcPath = "\(srcDir)/\(relativePath)"
            let dstPath = "\(dstDir)/\(relativePath)"

            var isDir: ObjCBool = false
            fm.fileExists(atPath: srcPath, isDirectory: &isDir)

            if isDir.boolValue {
                try? fm.createDirectory(atPath: dstPath, withIntermediateDirectories: true)
            } else {
                if !force && fm.fileExists(atPath: dstPath) { continue }
                let dstParent = (dstPath as NSString).deletingLastPathComponent
                try? fm.createDirectory(atPath: dstParent, withIntermediateDirectories: true)
                try? fm.copyItem(atPath: srcPath, toPath: dstPath)
                copied += 1
            }
        }
    }

    // Reindex after seeding
    wikiReindexCommand(args: asJSON ? ["--json"] : [])

    if asJSON {
        print(jsonString(["status": "ok", "files_copied": copied]))
    } else {
        print("Seeded \(copied) files. Wiki is ready.")
    }
}
```

- [ ] **Step 3: Create seed entity pages**

Create `wiki-seed/entities/gateway.md`:

```markdown
---
type: entity
name: Gateway
description: MCP server for typed script execution and cross-harness coordination
tags: [infrastructure, mcp, tools]
---

# Gateway

The gateway is an MCP (Model Context Protocol) server that provides typed tool access to the agent-os runtime. It exposes coordination tools (session management, state, messaging) and execution tools (OS script running, script registry).

## Location

`packages/gateway/` in the agent-os repo. Runs as a Node.js process, typically started via MCP configuration in `.mcp.json`.

## Tools

### Coordination
- `register_session` — register a named session with metadata
- `set_state` / `get_state` — per-session key-value state
- `post_message` / `read_stream` — cross-session messaging
- `who_is_online` — list active sessions

### Execution
- `run_os_script` — execute TypeScript scripts with SDK access
- `save_script` / `list_scripts` — persistent script registry
- `discover_capabilities` — runtime capability detection

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Daemon](./daemon.md)
```

Create `wiki-seed/entities/sigil.md`:

```markdown
---
type: entity
name: Sigil
description: Avatar presence system — the visual face of agent-os
tags: [display, avatar, presence]
---

# Sigil

Sigil is the avatar presence system for agent-os. It renders a Three.js celestial animation on full-screen transparent canvases, tracks cursor position across displays, and provides visual feedback for agent activity.

## Components

- **avatar-sub** — Swift binary, Sigil's entry point. Manages state machine, IPC, and animation loop.
- **renderer/** — Three.js live renderer (bundled single HTML for WKWebView compatibility)
- **studio/** — Customization UI for avatar appearance and behavior
- **chat/** — Chat surface for agent conversations (in development)

## Architecture

Sigil runs as a separate process from the daemon. It connects via Unix socket IPC, receives cursor position and event updates, and sends scene-position commands to its canvases.

## Related
- [Canvas System](./canvas-system.md)
- [Daemon](./daemon.md)
- [Studio](./studio.md)
```

Create `wiki-seed/entities/canvas-system.md`:

```markdown
---
type: entity
name: Canvas System
description: Daemon-managed transparent overlay windows for HTML content
tags: [display, canvas, overlay]
---

# Canvas System

Canvases are transparent NSWindow overlays managed by the aos daemon. Each canvas loads HTML content via WKWebView and communicates bidirectionally with the daemon through JavaScript evaluation.

## Operations

- `create` — create a canvas with ID, position, and URL
- `update` — modify canvas content, position, or style
- `remove` — destroy a canvas
- `eval` — run JavaScript in a canvas context
- `list` — enumerate active canvases

## Canvas Types

- **Interactive** (`.floating` level) — receive clicks. Used for studio, chat, inspector.
- **Overlay** (`.statusBar` level) — click-through. Used for display overlays, annotations.

## Content Loading

Canvases load content from the daemon's content server via `aos://` URLs, which resolve to `http://127.0.0.1:PORT/...`. This allows multi-file web apps (ES modules, CSS) without bundling.

## Related
- [Content Server](../concepts/content-server.md)
- [Daemon](./daemon.md)
- [Sigil](./sigil.md)
```

Create `wiki-seed/entities/daemon.md`:

```markdown
---
type: entity
name: Daemon
description: Unified aos daemon — socket server, canvas manager, autonomic behaviors
tags: [infrastructure, daemon, service]
---

# Daemon

The aos daemon (`aos serve`) is the central process that manages canvases, routes IPC messages, runs the content server, and provides autonomic behaviors (voice, visual feedback).

## Communication

Unix socket at `~/.config/aos/{mode}/sock`. Messages are newline-delimited JSON (ndjson) using the daemon event envelope format.

## Responsibilities

- Canvas lifecycle (create, update, remove, eval)
- Content server (HTTP file serving for WKWebView)
- IPC routing between connected clients
- Autonomic voice announcements
- Configuration watching and live reload

## Service Management

The daemon can run as a launchd service:
```
aos service install --mode repo
aos service start
aos service status --json
```

## Related
- [IPC Protocol](../concepts/ipc-protocol.md)
- [Canvas System](./canvas-system.md)
- [Daemon Lifecycle](../concepts/daemon-lifecycle.md)
- [Runtime Modes](../concepts/runtime-modes.md)
```

Create `wiki-seed/entities/studio.md`:

```markdown
---
type: entity
name: Studio
description: Sigil customization UI — avatar appearance, surfaces, settings
tags: [display, ui, configuration]
---

# Studio

Studio is Sigil's customization interface, rendered as an interactive canvas. It provides controls for avatar appearance, companion surface management, and settings.

## Panels

- **Avatar** — visual appearance controls, animation parameters
- **Surfaces** — launch companion canvases (chat, inspector)
- **Settings** — voice, visual feedback toggles

## Runtime

Studio runs as a WKWebView canvas loaded via the content server. It communicates with the daemon through IPC — sends config changes, receives state updates.

## Location

`apps/sigil/studio/` — HTML, CSS, JavaScript files served by the content server.

## Related
- [Sigil](./sigil.md)
- [Canvas System](./canvas-system.md)
```

- [ ] **Step 4: Create seed concept pages**

Create `wiki-seed/concepts/ipc-protocol.md`:

```markdown
---
type: concept
name: IPC Protocol
description: Newline-delimited JSON messaging over Unix socket between daemon and clients
tags: [protocol, ipc, messaging]
---

# IPC Protocol

All communication between the aos daemon and its clients (CLI commands, Sigil, gateway) uses newline-delimited JSON (ndjson) over a Unix socket.

## Envelope Format

```json
{"v":1,"service":"display","event":"canvas_created","ts":1712345678,"data":{...},"ref":"optional-correlation-id"}
```

| Field | Description |
|-------|-------------|
| v | Protocol version (always 1) |
| service | Originating subsystem |
| event | Event type (snake_case) |
| ts | Unix timestamp |
| data | Event payload |
| ref | Optional correlation ID for request/response |

## Request/Response

CLI commands use a request/response pattern: send a command, receive a response with the same `ref`. The `DaemonSession` class handles this via `sendAndReceive()`.

## Streaming

Long-lived connections (Sigil, observe) receive continuous events. The daemon broadcasts relevant events to all connected clients.

## Related
- [Daemon](../entities/daemon.md)
- [Gateway](../entities/gateway.md)
```

Create `wiki-seed/concepts/daemon-lifecycle.md`:

```markdown
---
type: concept
name: Daemon Lifecycle
description: How the aos daemon starts, runs, and stops across runtime modes
tags: [daemon, lifecycle, service]
---

# Daemon Lifecycle

## Startup

1. Parse config from `~/.config/aos/{mode}/config.json`
2. Create Unix socket at `~/.config/aos/{mode}/sock`
3. Start content server (HTTP) on an OS-assigned port
4. Start configuration file watcher for live reload
5. Begin accepting client connections

## Connection Handling

Each client gets an independent ndjson stream. Canvas operations, eval calls, and queries are routed through the daemon's central state.

## Shutdown

- `aos service stop` — sends SIGTERM via launchctl
- `aos reset` — stops service, removes socket, cleans state directory
- The daemon cleans up canvases and closes connections on exit

## Auto-Start

CLI commands that need the daemon (canvas operations, eval, listen) attempt to auto-start it via `DaemonSession.connect()`, which launches `aos serve` as a background process if no socket exists.

## Related
- [Daemon](../entities/daemon.md)
- [Runtime Modes](./runtime-modes.md)
```

Create `wiki-seed/concepts/content-server.md`:

```markdown
---
type: concept
name: Content Server
description: Local HTTP server for serving HTML assets to WKWebView canvases
tags: [infrastructure, http, content]
---

# Content Server

The daemon runs a local HTTP file server that serves HTML, CSS, and JavaScript files to WKWebView canvases. This eliminates the need to bundle multi-file web apps into single HTML files.

## URL Scheme

Canvases use `aos://` URLs which the daemon rewrites to `http://127.0.0.1:PORT/...` at canvas creation time.

Example: `aos://sigil/studio/index.html` resolves to the studio interface.

## Configuration

Content roots map URL prefixes to filesystem directories:

```bash
aos set content.roots.sigil apps/sigil
```

## Why

WKWebView in file:// mode blocks ES module imports and cross-origin CSS. The HTTP server bypasses these restrictions while keeping everything local.

## Related
- [Canvas System](../entities/canvas-system.md)
- [Daemon](../entities/daemon.md)
```

Create `wiki-seed/concepts/runtime-modes.md`:

```markdown
---
type: concept
name: Runtime Modes
description: Repo vs installed mode — separate state directories prevent cross-contamination
tags: [infrastructure, runtime, configuration]
---

# Runtime Modes

AOS has two explicit runtime modes that determine where state is stored and which binaries are used.

## Modes

| Mode | Binary | State Dir | When |
|------|--------|-----------|------|
| repo | `./aos` | `~/.config/aos/repo/` | Building/testing from source |
| installed | `~/Applications/AOS.app/.../aos` | `~/.config/aos/installed/` | Packaged runtime |

## Detection

Automatic: if the executable path contains `.app/Contents/MacOS/`, it's installed mode. Otherwise, repo mode. Can be overridden via `AOS_RUNTIME_MODE` environment variable.

## Isolation

Each mode gets its own socket, config, logs, and launchd labels. This prevents development builds from interfering with the installed runtime.

## Related
- [Daemon](../entities/daemon.md)
- [Daemon Lifecycle](./daemon-lifecycle.md)
```

- [ ] **Step 5: Create seed example plugin**

Create `wiki-seed/plugins/self-check/SKILL.md`:

```markdown
---
name: self-check
description: >
  Run a health check on the aos runtime. Use when the user asks
  to check system status, verify the runtime is healthy, diagnose
  issues, or troubleshoot aos problems.
version: "1.0.0"
author: agent-os
tags: [diagnostics, health, runtime]
triggers: ["check system health", "is aos working", "diagnose issues", "run health check"]
requires: [aos-daemon]
---

# Self-Check — Runtime Health Verification

Run a comprehensive health check of the aos runtime and report status.

## Steps

1. Run `aos doctor --json` and parse the output
2. Check each section:
   - **Permissions**: accessibility and screen recording granted?
   - **Daemon**: running? Socket exists?
   - **Service**: launch agent installed and loaded?
3. If issues found, suggest specific fix commands
4. Report summary to the user

## Decision Tree

- If permissions missing → suggest `aos permissions setup --once`
- If daemon not running → suggest `aos service start`
- If service not installed → suggest `aos service install --mode repo`
- If everything healthy → confirm all systems operational

## Related
- [Daemon](../../entities/daemon.md)
- [Runtime Modes](../../concepts/runtime-modes.md)
```

- [ ] **Step 6: Build and verify**

Run: `bash build.sh`
Expected: Compiles without errors.

Run: `./aos wiki seed --json`
Expected: JSON with `"status": "ok"` and files_copied count > 0.

Run: `./aos wiki reindex --json`
Expected: Pages, links, and plugins counts all > 0.

Run: `./aos wiki list`
Expected: Lists all seeded entities, concepts, and the self-check workflow.

Run: `./aos wiki show gateway`
Expected: Formatted output of the gateway entity page.

Run: `./aos wiki invoke self-check`
Expected: Prints the self-check SKILL.md content.

Run: `./aos wiki lint`
Expected: Clean or only minor warnings.

- [ ] **Step 7: Commit**

```bash
git add src/commands/wiki.swift wiki-seed/
git commit -m "feat(wiki): add seed command with starter pack — 9 entities/concepts + self-check plugin"
```

---

### Task 10: Integration Test Script

**Files:**
- Create: `tests/wiki-integration.sh`

- [ ] **Step 1: Write the integration test**

Create `tests/wiki-integration.sh`:

```bash
#!/bin/bash
set -euo pipefail

# wiki-integration.sh — end-to-end test of aos wiki commands
# Requires: ./aos built, no existing wiki (or will be reset)

AOS="./aos"
WIKI_DIR=$(${AOS} wiki reindex --json 2>/dev/null | grep -o '"wiki_dir":"[^"]*"' | cut -d'"' -f4 || echo "$HOME/.config/aos/repo/wiki")
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "=== aos wiki integration tests ==="
echo "Wiki dir: $WIKI_DIR"

# Clean slate
rm -rf "$WIKI_DIR"

# Test: reindex on empty wiki
echo ""
echo "--- reindex (empty) ---"
OUTPUT=$($AOS wiki reindex --json)
echo "$OUTPUT" | grep -q '"pages" : 0' && pass "reindex empty" || fail "reindex empty"

# Test: seed
echo ""
echo "--- seed ---"
OUTPUT=$($AOS wiki seed --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "seed" || fail "seed"

# Test: reindex after seed
echo ""
echo "--- reindex (after seed) ---"
OUTPUT=$($AOS wiki reindex --json)
PAGES=$(echo "$OUTPUT" | grep -o '"pages" : [0-9]*' | grep -o '[0-9]*')
[ "$PAGES" -gt 0 ] && pass "reindex found $PAGES pages" || fail "reindex found 0 pages"

# Test: list
echo ""
echo "--- list ---"
OUTPUT=$($AOS wiki list --json)
echo "$OUTPUT" | grep -q "gateway" && pass "list contains gateway" || fail "list missing gateway"

# Test: list --type
OUTPUT=$($AOS wiki list --type workflow --json)
echo "$OUTPUT" | grep -q "self-check" && pass "list --type workflow" || fail "list --type workflow"

# Test: show
echo ""
echo "--- show ---"
OUTPUT=$($AOS wiki show gateway --json)
echo "$OUTPUT" | grep -q '"name" : "Gateway"' && pass "show gateway" || fail "show gateway"

# Test: show --raw
OUTPUT=$($AOS wiki show gateway --raw)
echo "$OUTPUT" | grep -q "^---" && pass "show --raw has frontmatter" || fail "show --raw"

# Test: search
echo ""
echo "--- search ---"
OUTPUT=$($AOS wiki search "MCP server" --json)
echo "$OUTPUT" | grep -q "gateway" && pass "search finds gateway" || fail "search"

# Test: create-plugin
echo ""
echo "--- create-plugin ---"
OUTPUT=$($AOS wiki create-plugin test-workflow --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "create-plugin" || fail "create-plugin"

# Test: add entity
OUTPUT=$($AOS wiki add entity test-entity --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "add entity" || fail "add entity"

# Test: link
echo ""
echo "--- link ---"
OUTPUT=$($AOS wiki link test-entity gateway --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "link" || fail "link"

# Test: list --links-to
OUTPUT=$($AOS wiki list --links-to entities/gateway.md --json)
echo "$OUTPUT" | grep -q "test-entity" && pass "list --links-to" || fail "list --links-to"

# Test: invoke
echo ""
echo "--- invoke ---"
OUTPUT=$($AOS wiki invoke self-check)
echo "$OUTPUT" | grep -q "Self-Check" && pass "invoke self-check" || fail "invoke self-check"

# Test: lint
echo ""
echo "--- lint ---"
OUTPUT=$($AOS wiki lint --json)
# Should run without error
[ $? -eq 0 ] && pass "lint runs" || fail "lint runs"

# Test: rm
echo ""
echo "--- rm ---"
OUTPUT=$($AOS wiki rm test-entity --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "rm" || fail "rm"

# Cleanup test plugin
rm -rf "$WIKI_DIR/plugins/test-workflow"
$AOS wiki reindex > /dev/null 2>&1

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
```

- [ ] **Step 2: Run the test**

Run: `bash build.sh && bash tests/wiki-integration.sh`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/wiki-integration.sh
git commit -m "test(wiki): add integration test script covering all wiki commands"
```

---

### Task 11: "Customize with Agent" Skill

**Files:**
- Create: `wiki-seed/plugins/customize-with-agent/SKILL.md`
- Create: `wiki-seed/plugins/customize-with-agent/references/skill-writing-guide.md`

This is the agent skill for creating and editing wiki plugins. Derived from Anthropic's skill-creator (`docs/reference/anthropic-skill-creator.md`), adapted for the wiki environment.

- [ ] **Step 1: Write the skill**

Create `wiki-seed/plugins/customize-with-agent/SKILL.md`:

```markdown
---
name: customize-with-agent
description: >
  Create new wiki plugins or edit existing ones through guided conversation.
  Use when the user asks to create a plugin, build a workflow, make a new
  skill, automate a task, or says "customize with agent". Also use when
  the user wants to turn a conversation or process into a reusable workflow.
version: "1.0.0"
author: agent-os
tags: [meta, authoring, plugin-creation]
triggers: ["create a plugin", "build a workflow", "make a skill", "customize with agent", "turn this into a plugin"]
requires: []
---

# Customize with Agent — Plugin Creator

Create new wiki plugins or improve existing ones through collaborative dialogue.

## Overview

A plugin is a reusable workflow stored in the wiki. It consists of:
- `SKILL.md` — instructions the agent follows when the plugin is invoked
- `references/` — supporting knowledge documents loaded on demand
- `scripts/` — optional executable code for deterministic tasks
- `assets/` — optional templates, icons, or other files

Your job is to help the user define what the plugin should do, then create it using wiki tools.

## Process

### 1. Capture Intent

Understand what the user wants to automate or codify. Ask:

1. What should this plugin enable an agent to do?
2. When should it trigger? (what user phrases or contexts)
3. What's the expected output?
4. Are there existing tools, commands, or APIs it should use?

If the current conversation already contains a workflow the user wants to capture, extract answers from context first. The user may need to fill gaps.

### 2. Interview for Details

Ask one question at a time about:
- Edge cases and error handling
- Input/output formats
- Dependencies (does it need the daemon running? gateway? specific tools?)
- Success criteria — how do you know it worked?

### 3. Create the Plugin

Use wiki tools to scaffold:

```bash
aos wiki create-plugin <name>
```

Then write the SKILL.md and any reference files. Follow these guidelines:

**SKILL.md structure:**
- Frontmatter with name, description (assertive — include trigger phrases), version, tags
- Clear purpose statement
- Step-by-step instructions
- Decision trees for branching logic
- Related links to wiki pages

**Writing principles:**
- Explain the *why* behind instructions, not just the *what*
- Keep SKILL.md under 500 lines — move domain knowledge to `references/`
- Use concrete examples over abstract descriptions
- If all test runs would write a similar helper script, bundle it in `scripts/`

**Description field:**
The description is the primary trigger mechanism. Make it clear and explicit:
- Include what the skill does AND specific contexts for activation
- List natural language phrases that should trigger it
- Err on the side of over-matching — undertriggering is worse

### 4. Test

Offer to test the plugin:
> "Want me to try running this plugin to see how it works?"

If yes, invoke it: `aos wiki invoke <name>` — read the output and follow the instructions as if you were a fresh agent receiving them. Note any confusion, missing context, or unclear steps.

### 5. Iterate

Based on testing or user feedback:
- Revise SKILL.md for clarity
- Add missing reference files
- Improve the description for better triggering
- Update the index: `aos wiki reindex`

### 6. Finalize

After the user approves:
- Verify with `aos wiki lint` — fix any issues
- Confirm the plugin appears in `aos wiki list --type workflow`
- Tell the user how to invoke it: from chat compose menu or by asking the agent

## Editing Existing Plugins

If the user wants to modify an existing plugin:

1. Read it: `aos wiki show <name> --raw`
2. Understand what needs to change
3. Edit the files directly
4. Reindex: `aos wiki reindex`
5. Test the changes

## Reference

See [Skill Writing Guide](references/skill-writing-guide.md) for detailed authoring conventions.
```

- [ ] **Step 2: Write the reference guide**

Create `wiki-seed/plugins/customize-with-agent/references/skill-writing-guide.md`:

```markdown
---
type: concept
name: Skill Writing Guide
description: Conventions and best practices for writing wiki plugin SKILL.md files
tags: [meta, authoring, conventions]
---

# Skill Writing Guide

## Anatomy of a Plugin

```
plugin-name/
├── SKILL.md          # Required: frontmatter + instructions
├── references/       # Optional: domain knowledge loaded on demand
├── scripts/          # Optional: executable code
└── assets/           # Optional: templates, icons, files
```

## SKILL.md Frontmatter

Required fields:
- `name` — plugin identifier (kebab-case)
- `description` — when to trigger, what it does (be highly specific)

Optional fields:
- `version` — semver string
- `author` — who created this
- `tags` — categorization keywords
- `triggers` — natural language phrases that should activate this plugin
- `requires` — runtime dependencies (e.g., gateway, aos-daemon)

## Progressive Disclosure

1. **Metadata** (~100 words) — name + description, always in agent context
2. **SKILL.md body** (<500 lines) — loaded when plugin triggers
3. **References** (unlimited) — loaded on demand when the agent needs deeper context

Keep SKILL.md focused on the workflow. Move domain knowledge, schemas, and frameworks to `references/`.

## Writing Style

- Use imperative form: "Run the build" not "You should run the build"
- Explain *why* things matter, not just *what* to do
- Prefer concrete examples over abstract descriptions
- Use decision trees for branching logic
- Include exact commands with expected output where applicable

## Description as Trigger

The description field determines whether an agent invokes the plugin. Write it to over-match rather than under-match:

**Weak:** "Audit competitor employer brands"
**Strong:** "Run employer brand competitor audits using the KILOS framework. Use when the user asks to research competitors, audit employer brands, analyze careers sites, do a KILOS audit, or build a competitor analysis. Trigger whenever a user provides a client name and a list of companies to research."

## Cross-Linking

Link to wiki entity and concept pages from your SKILL.md and references:
```markdown
See [Gateway](../../entities/gateway.md) for tool documentation.
```

This connects the plugin to the broader knowledge graph and helps agents find relevant context during execution.

## Common Patterns

**Mode detection:** If a plugin operates differently based on input, use a mode table at the top:
```markdown
| Mode | When |
|------|------|
| Plan | User provides requirements, no artifacts yet |
| Execute | User provides plan + data |
| Resume | Partial output, continue from last point |
```

**Decision trees:** For branching logic, use explicit if/then:
```markdown
- If build fails → check [Build Troubleshooting](references/build-troubleshooting.md)
- If tests pass → proceed to deployment step
```

**Reference loading:** Tell the agent when to read references:
```markdown
For the full KILOS framework details, read `references/kilos-framework.md` before beginning analysis.
```
```

- [ ] **Step 3: Build and verify seed includes new plugin**

Run: `rm -rf ~/.config/aos/repo/wiki && bash build.sh && ./aos wiki seed && ./aos wiki list`
Expected: Lists the `customize-with-agent` and `self-check` plugins along with all entity/concept pages.

Run: `./aos wiki invoke customize-with-agent | head -20`
Expected: Shows the SKILL.md content starting with the frontmatter.

- [ ] **Step 4: Commit**

```bash
git add wiki-seed/plugins/customize-with-agent/
git commit -m "feat(wiki): add 'Customize with Agent' plugin — guided plugin creation skill"
```

---

### Task 12: Final Wiring + Usage Help

**Files:**
- Modify: `src/main.swift` (update printUsage)

- [ ] **Step 1: Add wiki section to printUsage**

Add to the usage string in `printUsage()`, after the Tools section:

```
    Wiki (aos wiki):
      create-plugin <name>   Scaffold a new workflow plugin
      add <type> <name>      Create an entity or concept page
      rm <path>              Remove a page (warns about broken links)
      link <from> <to>       Add a cross-reference between pages
      list                   List pages (--type, --plugin, --links-to, --links-from, --orphans)
      search <query>         Search pages (--type filter)
      show <name>            Display a page (--raw for markdown, --json for structured)
      invoke <plugin>        Bundle a plugin into a prompt payload
      reindex                Rebuild the index from filesystem
      lint                   Check for broken links, orphans, missing frontmatter
      seed                   Populate wiki with starter content
```

Also add wiki examples:

```
      aos wiki seed                     # Populate with starter content
      aos wiki list                     # List all wiki pages
      aos wiki list --type workflow     # List workflow plugins
      aos wiki show gateway --json      # View a page as JSON
      aos wiki search "IPC protocol"    # Search the wiki
      aos wiki create-plugin my-flow    # Create a new plugin
      aos wiki invoke self-check        # Bundle a plugin for chat injection
      aos wiki lint                     # Check wiki health
```

- [ ] **Step 2: Build and verify**

Run: `bash build.sh && ./aos --help`
Expected: Wiki section appears in help output.

- [ ] **Step 3: Run full integration test**

Run: `bash tests/wiki-integration.sh`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.swift
git commit -m "feat(wiki): add wiki section to aos --help"
```

---

## Summary

| Task | What it delivers | Files |
|------|-----------------|-------|
| 1 | SQLite link + command router | build.sh, wiki.swift, main.swift |
| 2 | Frontmatter parser | wiki-frontmatter.swift |
| 3 | SQLite index class | wiki-index.swift |
| 4 | reindex (filesystem scan) | wiki.swift |
| 5 | create-plugin, add, rm | wiki.swift |
| 6 | list, search, show | wiki.swift |
| 7 | link, lint | wiki.swift |
| 8 | invoke | wiki.swift |
| 9 | seed + starter pack (10 pages) | wiki.swift, wiki-seed/ |
| 10 | Integration tests | tests/wiki-integration.sh |
| 11 | "Customize with Agent" skill | wiki-seed/plugins/customize-with-agent/ |
| 12 | Help text + final verification | main.swift |

12 tasks, ~12 commits. Each task is independently buildable and testable. The wiki is fully functional after Task 10, with the agent skill and polish added in Tasks 11-12.
