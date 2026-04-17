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

let aosWikiPlatformNamespace = "aos"

func wikiNamespacedDir(_ dirType: String) -> String {
    "\(aosWikiPlatformNamespace)/\(dirType)"
}

func wikiCandidateDirs(for dirType: String, wikiDir: String) -> [String] {
    let fm = FileManager.default
    return [wikiNamespacedDir(dirType), dirType].filter { relativeDir in
        var isDir: ObjCBool = false
        let absoluteDir = "\(wikiDir)/\(relativeDir)"
        return fm.fileExists(atPath: absoluteDir, isDirectory: &isDir) && isDir.boolValue
    }
}

func wikiBareNameCandidates(_ arg: String) -> [String] {
    [
        "\(wikiNamespacedDir("entities"))/\(arg).md",
        "\(wikiNamespacedDir("concepts"))/\(arg).md",
        "\(wikiNamespacedDir("plugins"))/\(arg)/SKILL.md",
        "entities/\(arg).md",
        "concepts/\(arg).md",
        "plugins/\(arg)/SKILL.md"
    ]
}

// MARK: - Command Router

func wikiCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        printCommandHelp(["wiki"], json: args.contains("--json"))
        exit(0)
    }
    guard let sub = args.first else {
        exitError("wiki requires a subcommand. Usage: aos wiki <list|show|graph|add|rm|link|search|seed|reindex|lint|invoke|create-plugin|migrate-namespaces> ...",
                  code: "MISSING_SUBCOMMAND")
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
    case "graph":
        wikiGraphCommand(args: subArgs)
    case "link":
        wikiLinkCommand(args: subArgs)
    case "lint":
        wikiLintCommand(args: subArgs)
    case "invoke":
        wikiInvokeCommand(args: subArgs)
    case "seed":
        wikiSeedCommand(args: subArgs)
    case "migrate-namespaces":
        wikiMigrateNamespacesCommand(args: subArgs)
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
            atPath: "\(wikiDir)/\(wikiNamespacedDir(sub))",
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
    var indexedPlugins = Set<String>()
    for pluginsRelativeDir in wikiCandidateDirs(for: "plugins", wikiDir: wikiDir) {
        let pluginsDir = "\(wikiDir)/\(pluginsRelativeDir)"
        if let pluginDirs = try? fm.contentsOfDirectory(atPath: pluginsDir) {
            for pluginName in pluginDirs.sorted() where !pluginName.hasPrefix(".") {
                guard indexedPlugins.insert(pluginName).inserted else { continue }
                let pluginPath = "\(pluginsDir)/\(pluginName)"
                var isDir: ObjCBool = false
                guard fm.fileExists(atPath: pluginPath, isDirectory: &isDir), isDir.boolValue else { continue }

                let skillPath = "\(pluginPath)/SKILL.md"
                guard let skillContent = try? String(contentsOfFile: skillPath, encoding: .utf8) else { continue }

                let page = parseWikiPage(content: skillContent)
                let relativePath = "\(pluginsRelativeDir)/\(pluginName)/SKILL.md"
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
                let links = extractMarkdownLinks(from: page.body, relativeTo: "\(pluginsRelativeDir)/\(pluginName)")
                for target in links {
                    index.upsertLink(source: relativePath, target: target)
                    linkCount += 1
                }

                // Scan references/ within the plugin
                let refsDir = "\(pluginPath)/references"
                if let refFiles = try? fm.contentsOfDirectory(atPath: refsDir) {
                    for refFile in refFiles.sorted() where refFile.hasSuffix(".md") {
                        let refPath = "\(refsDir)/\(refFile)"
                        guard let refContent = try? String(contentsOfFile: refPath, encoding: .utf8) else { continue }
                        let refPage = parseWikiPage(content: refContent)
                        let refRelPath = "\(pluginsRelativeDir)/\(pluginName)/references/\(refFile)"
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

                        let refLinks = extractMarkdownLinks(from: refPage.body, relativeTo: "\(pluginsRelativeDir)/\(pluginName)/references")
                        for target in refLinks {
                            index.upsertLink(source: refRelPath, target: target)
                            linkCount += 1
                        }
                    }
                }
            }
        }
    }

    // Scan entities/ and concepts/
    for dirType in ["entities", "concepts"] {
        var indexedFiles = Set<String>()
        for typeRelativeDir in wikiCandidateDirs(for: dirType, wikiDir: wikiDir) {
            let typeDir = "\(wikiDir)/\(typeRelativeDir)"
            guard let files = try? fm.contentsOfDirectory(atPath: typeDir) else { continue }
            for file in files.sorted() where file.hasSuffix(".md") && !file.hasPrefix(".") {
                guard indexedFiles.insert(file).inserted else { continue }
                let filePath = "\(typeDir)/\(file)"
                guard let content = try? String(contentsOfFile: filePath, encoding: .utf8) else { continue }
                let page = parseWikiPage(content: content)
                let relativePath = "\(typeRelativeDir)/\(file)"
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

                let links = extractMarkdownLinks(from: page.body, relativeTo: typeRelativeDir)
                for target in links {
                    index.upsertLink(source: relativePath, target: target)
                    linkCount += 1
                }
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
        exitError("wiki create-plugin requires a name. Usage: aos wiki create-plugin <name>",
                  code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    let pluginDir = "\(wikiDir)/\(wikiNamespacedDir("plugins"))/\(name)"
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

    let relativePath = "\(wikiNamespacedDir("plugins"))/\(name)/SKILL.md"
    reindexWikiEntry(path: relativePath)

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
        exitError("wiki add requires <entity|concept> <name>. Usage: aos wiki add <entity|concept> <name> [--description <d>]",
                  code: "MISSING_ARG")
    }
    let typeArg = nonFlags[0]
    let name = nonFlags[1]

    guard typeArg == "entity" || typeArg == "concept" else {
        exitError("Type must be 'entity' or 'concept', got '\(typeArg)'", code: "WIKI_INVALID_TYPE")
    }

    let wikiDir = aosWikiDir()
    let dirName = wikiNamespacedDir(typeArg == "entity" ? "entities" : "concepts")
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

    let relativePath = "\(dirName)/\(name).md"
    reindexWikiEntry(path: relativePath)

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
        exitError("wiki rm requires a path. Usage: aos wiki rm <path>",
                  code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    guard let resolved = resolveWikiPath(wikiDir: wikiDir, arg: pathArg) else {
        exitError("Page '\(pathArg)' not found", code: "WIKI_NOT_FOUND")
    }
    let relativePath = resolved.relative
    let fullPath = resolved.absolute

    // Check for incoming links
    let index = openWikiIndex()
    let incoming = index.linksTo(path: relativePath)
    index.close()
    if !incoming.isEmpty && !asJSON {
        print("Warning: \(incoming.count) page(s) link to this page:")
        for link in incoming { print("  \(link.source_path)") }
    }

    try? FileManager.default.removeItem(atPath: fullPath)
    removeWikiEntry(path: relativePath)

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
        exitError("wiki search requires a query. Usage: aos wiki search <query> [--type <t>] [--json]",
                  code: "MISSING_ARG")
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

    var seen = Set<String>()
    for dirType in ["plugins", "entities", "concepts"] {
        for relativeDir in wikiCandidateDirs(for: dirType, wikiDir: wikiDir) {
            let dirPath = "\(wikiDir)/\(relativeDir)"
            guard let enumerator = fm.enumerator(atPath: dirPath) else { continue }
            while let relativePath = enumerator.nextObject() as? String {
                guard relativePath.hasSuffix(".md") else { continue }
                let fullRelative = "\(relativeDir)/\(relativePath)"
                guard !excluding.contains(fullRelative), seen.insert(fullRelative).inserted else { continue }
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
        exitError("wiki show requires a path. Usage: aos wiki show <path> [--raw] [--json]",
                  code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    guard let resolved = resolveWikiPath(wikiDir: wikiDir, arg: pathArg) else {
        exitError("Page '\(pathArg)' not found. Try 'aos wiki list' to see available pages.", code: "WIKI_NOT_FOUND")
    }
    let relativePath = resolved.relative
    let fullPath = resolved.absolute

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

// MARK: - Link

func wikiLinkCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let nonFlags = args.filter { !$0.hasPrefix("-") }
    guard nonFlags.count >= 2 else {
        exitError("wiki link requires <from> and <to>. Usage: aos wiki link <from> <to>",
                  code: "MISSING_ARG")
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

    // Append to Related section in source file
    let relativeLink = makeRelativeLink(from: fromFull.relative, to: toFull.relative)
    guard var content = try? String(contentsOfFile: fromFull.absolute, encoding: .utf8) else {
        exitError("Could not read \(fromFull.absolute)", code: "WIKI_READ_ERROR")
    }
    let toPage = parseWikiPage(content: (try? String(contentsOfFile: toFull.absolute, encoding: .utf8)) ?? "")
    let linkName = toPage.frontmatter.name ?? toPath
    let linkLine = "- [\(linkName)](\(relativeLink))"

    if content.contains("## Related") {
        content = content.replacingOccurrences(of: "## Related\n", with: "## Related\n\(linkLine)\n")
    } else {
        content += "\n## Related\n\(linkLine)\n"
    }
    do {
        try content.write(toFile: fromFull.absolute, atomically: true, encoding: .utf8)
    } catch {
        exitError("Could not write \(fromFull.absolute): \(error.localizedDescription)", code: "WIKI_WRITE_ERROR")
    }
    reindexWikiEntry(path: fromFull.relative)

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

func resolveWikiPluginSkillPath(wikiDir: String, name: String) -> ResolvedPath? {
    for relativePath in [
        "\(wikiNamespacedDir("plugins"))/\(name)/SKILL.md",
        "plugins/\(name)/SKILL.md"
    ] {
        let absolutePath = "\(wikiDir)/\(relativePath)"
        if FileManager.default.fileExists(atPath: absolutePath) {
            return ResolvedPath(relative: relativePath, absolute: absolutePath)
        }
    }
    return nil
}

func resolveWikiPath(wikiDir: String, arg: String) -> ResolvedPath? {
    if arg.contains("/") || arg.contains(".md") {
        let abs = "\(wikiDir)/\(arg)"
        if FileManager.default.fileExists(atPath: abs) { return ResolvedPath(relative: arg, absolute: abs) }
        return nil
    }
    for relativePath in wikiBareNameCandidates(arg) {
        let absolutePath = "\(wikiDir)/\(relativePath)"
        if FileManager.default.fileExists(atPath: absolutePath) {
            return ResolvedPath(relative: relativePath, absolute: absolutePath)
        }
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
        let resolvedSkill = resolveWikiPluginSkillPath(wikiDir: wikiDir, name: plugin.name)
        if resolvedSkill == nil {
            issues.append(LintIssue(
                severity: "error", category: "malformed_plugin",
                path: "\(wikiNamespacedDir("plugins"))/\(plugin.name)", message: "Plugin directory exists but SKILL.md is missing"
            ))
        }
        if plugin.description == nil || plugin.description?.isEmpty == true {
            issues.append(LintIssue(
                severity: "warning", category: "malformed_plugin",
                path: resolvedSkill?.relative ?? "\(wikiNamespacedDir("plugins"))/\(plugin.name)/SKILL.md",
                message: "Plugin has no description (will not trigger reliably)"
            ))
        }
    }

    // 5. Index drift: files on disk not in the index
    let fm = FileManager.default
    for dirType in ["entities", "concepts"] {
        for relativeDir in wikiCandidateDirs(for: dirType, wikiDir: wikiDir) {
            let dirPath = "\(wikiDir)/\(relativeDir)"
            guard let files = try? fm.contentsOfDirectory(atPath: dirPath) else { continue }
            for file in files where file.hasSuffix(".md") && !file.hasPrefix(".") {
                let relative = "\(relativeDir)/\(file)"
                if !allPagePaths.contains(relative) {
                    issues.append(LintIssue(
                        severity: "warning", category: "index_drift",
                        path: relative, message: "File exists on disk but not in index (run 'aos wiki reindex')"
                    ))
                }
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

// MARK: - Invoke

func wikiInvokeCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    guard let name = args.first(where: { !$0.hasPrefix("-") }) else {
        exitError("wiki invoke requires a plugin name. Usage: aos wiki invoke <name>",
                  code: "MISSING_ARG")
    }

    let wikiDir = aosWikiDir()
    guard let resolvedPlugin = resolveWikiPluginSkillPath(wikiDir: wikiDir, name: name) else {
        exitError("Plugin '\(name)' not found", code: "WIKI_NOT_FOUND")
    }
    let pluginDir = (resolvedPlugin.absolute as NSString).deletingLastPathComponent
    let skillPath = resolvedPlugin.absolute

    guard let skillContent = try? String(contentsOfFile: skillPath, encoding: .utf8) else {
        exitError("Plugin '\(name)' not found at \(pluginDir)", code: "WIKI_NOT_FOUND")
    }

    var bundle = skillContent

    // Bundle references
    let refsDir = "\(pluginDir)/references"
    let refFiles = ((try? FileManager.default.contentsOfDirectory(atPath: refsDir))?.sorted()) ?? []
    for refFile in refFiles where refFile.hasSuffix(".md") {
        let refPath = "\(refsDir)/\(refFile)"
        if let refContent = try? String(contentsOfFile: refPath, encoding: .utf8) {
            bundle += "\n\n--- BEGIN reference: \(refFile) ---\n\n"
            bundle += refContent
            bundle += "\n\n--- END reference: \(refFile) ---"
        }
    }

    // Bundle scripts (show content so agent knows what's available)
    let scriptsDir = "\(pluginDir)/scripts"
    let scriptFiles = ((try? FileManager.default.contentsOfDirectory(atPath: scriptsDir))?.sorted()) ?? []
    for scriptFile in scriptFiles {
        let scriptPath = "\(scriptsDir)/\(scriptFile)"
        if let scriptContent = try? String(contentsOfFile: scriptPath, encoding: .utf8) {
            bundle += "\n\n--- BEGIN script: \(scriptFile) ---\n\n"
            bundle += scriptContent
            bundle += "\n\n--- END script: \(scriptFile) ---"
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

// MARK: - Seed

func wikiSeedCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let force = hasFlag(args, "--force")
    let fromPath = getArg(args, "--from")

    let wikiDir = aosWikiDir()

    // Per-file seed mode: --namespace <ns> [--file <rel>:<absolutePath> ...]
    if let ns = getArg(args, "--namespace") {
        // Collect all --file <rel>:<absolutePath> pairs (may repeat)
        var filePairs: [(String, URL)] = []
        var i = 0
        while i < args.count {
            if args[i] == "--file", i + 1 < args.count {
                let pair = args[i + 1]
                if let colonIdx = pair.firstIndex(of: ":") {
                    let rel = String(pair[pair.startIndex..<colonIdx])
                    let src = String(pair[pair.index(after: colonIdx)...])
                    filePairs.append((rel, URL(fileURLWithPath: src)))
                } else {
                    fputs("Error: --file value must be <rel>:<absolutePath>\n", stderr)
                    exit(1)
                }
                i += 2
            } else {
                i += 1
            }
        }
        do {
            let written = try WikiSeed.seedIfAbsent(
                wikiRoot: URL(fileURLWithPath: wikiDir),
                namespace: ns,
                files: filePairs
            )
            if asJSON {
                let result: [String: Any] = ["status": "ok", "written": written]
                if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
                   let s = String(data: data, encoding: .utf8) { print(s) }
            } else {
                print("Seeded \(written) file(s) into \(ns).")
            }
        } catch {
            fputs("Error seeding wiki: \(error)\n", stderr)
            exit(1)
        }
        return
    }

    // Check if wiki already has content
    let fm = FileManager.default
    let hasContent = ["plugins", "entities", "concepts"].contains { dirType in
        wikiCandidateDirs(for: dirType, wikiDir: wikiDir).contains { relativeDir in
            let dirPath = "\(wikiDir)/\(relativeDir)"
            return (try? fm.contentsOfDirectory(atPath: dirPath))?.contains(where: { !$0.hasPrefix(".") }) ?? false
        }
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
        let dstDir = "\(wikiDir)/\(wikiNamespacedDir(subDir))"
        guard let enumerator = fm.enumerator(atPath: srcDir) else { continue }
        while let relativePath = enumerator.nextObject() as? String {
            let srcPath = "\(srcDir)/\(relativePath)"
            let dstPath = "\(dstDir)/\(relativePath)"

            var isDir: ObjCBool = false
            fm.fileExists(atPath: srcPath, isDirectory: &isDir)

            if isDir.boolValue {
                try? fm.createDirectory(atPath: dstPath, withIntermediateDirectories: true)
            } else {
                if fm.fileExists(atPath: dstPath) {
                    if !force { continue }
                    try? fm.removeItem(atPath: dstPath)
                }
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
        let result: [String: Any] = [
            "status": "ok",
            "files_copied": copied
        ]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]),
           let s = String(data: data, encoding: .utf8) { print(s) }
    } else {
        print("Seeded \(copied) files. Wiki is ready.")
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
