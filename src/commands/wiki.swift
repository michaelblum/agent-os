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
