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
