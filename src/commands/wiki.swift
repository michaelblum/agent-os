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
    case "create-plugin":
        wikiCreatePluginCommand(args: subArgs)
    case "add":
        wikiAddCommand(args: subArgs)
    case "rm":
        wikiRmCommand(args: subArgs)
    case "list":
        wikiListCommand(args: subArgs)
    case "search":
        wikiSearchCommand(args: subArgs)
    case "show":
        wikiShowCommand(args: subArgs)
    default:
        exitError("Unknown wiki subcommand: \(sub)", code: "UNKNOWN_SUBCOMMAND")
    }
}

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
        let payload: [String: Any] = ["status": "ok", "plugin": name, "path": pluginDir]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) { print(s) }
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
        let payload: [String: Any] = ["status": "ok", "type": typeArg, "name": name, "path": filePath]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) { print(s) }
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
        let payload: [String: Any] = ["status": "ok", "removed": relativePath, "broken_links": incoming.count]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) { print(s) }
    } else {
        print("Removed \(relativePath)")
    }
}

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
                let inferredType: String
                switch dirType {
                case "plugins":  inferredType = "workflow"
                case "entities": inferredType = "entity"
                case "concepts": inferredType = "concept"
                default:         inferredType = dirType
                }
                results.append(WikiIndex.PageRow(
                    path: fullRelative,
                    type: page.frontmatter.type ?? inferredType,
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
