// wiki-graph.swift — graph projection helpers for aos wiki and in-canvas consumers

import Foundation

struct WikiGraphNode: Encodable {
    let id: String
    let path: String
    let type: String
    let name: String
    let description: String?
    let tags: [String]
    let plugin: String?
    let modified_at: Int
}

struct WikiGraphLink: Encodable {
    let source: String
    let target: String
}

struct WikiGraphControls: Encodable {
    let enabled: Bool
    let collapsed: Bool
}

struct WikiGraphFeatures: Encodable {
    let search: Bool
    let types: Bool
    let tags: Bool
    let scope: Bool
    let depth: Bool
    let labels: Bool
    let isolated: Bool
    let neighbors: Bool
    let path: Bool
    let freeze: Bool
    let focus: Bool
    let fit: Bool
    let reset: Bool
    let legend: Bool
}

struct WikiGraphDefaults: Encodable {
    let mode: String
    let depth: Int
    let labelMode: String
    let showIsolated: Bool
    let highlightNeighbors: Bool
    let frozen: Bool
    let activeTypes: [String]
    let activeTags: [String]
    let searchQuery: String
    let tagMatchMode: String
}

struct WikiGraphLimits: Encodable {
    let minDepth: Int
    let maxDepth: Int
}

struct WikiGraphViewConfig: Encodable {
    let controls: WikiGraphControls
    let features: WikiGraphFeatures
    let defaults: WikiGraphDefaults
    let limits: WikiGraphLimits

    static let `default` = WikiGraphViewConfig(
        controls: WikiGraphControls(enabled: true, collapsed: false),
        features: WikiGraphFeatures(
            search: true,
            types: true,
            tags: true,
            scope: true,
            depth: true,
            labels: true,
            isolated: true,
            neighbors: true,
            path: true,
            freeze: true,
            focus: true,
            fit: true,
            reset: true,
            legend: true
        ),
        defaults: WikiGraphDefaults(
            mode: "global",
            depth: 2,
            labelMode: "selection",
            showIsolated: true,
            highlightNeighbors: true,
            frozen: false,
            activeTypes: [],
            activeTags: [],
            searchQuery: "",
            tagMatchMode: "any"
        ),
        limits: WikiGraphLimits(minDepth: 1, maxDepth: 4)
    )
}

struct WikiGraphConfig: Encodable {
    let graphView: WikiGraphViewConfig

    static let `default` = WikiGraphConfig(graphView: .default)
}

struct WikiGraphSnapshot: Encodable {
    let nodes: [WikiGraphNode]
    let links: [WikiGraphLink]
    let raw: [String: String]
    let config: WikiGraphConfig
}

private struct WikiPathContext {
    let pluginName: String?
    let inferredType: String
    let isSkill: Bool
}

func wikiDbPath(forWikiRoot wikiRoot: String) -> String {
    "\(wikiRoot)/wiki.db"
}

func openWikiIndex(wikiRoot: String) -> WikiIndex {
    try? FileManager.default.createDirectory(atPath: wikiRoot, withIntermediateDirectories: true)
    let index = WikiIndex(dbPath: wikiDbPath(forWikiRoot: wikiRoot))
    index.open()
    index.createTables()
    return index
}

func wikiGraphCommand(args: [String]) {
    let includeRaw = hasFlag(args, "--raw")
    let snapshot = buildWikiGraphSnapshot(wikiRoot: aosWikiDir(), includeRaw: includeRaw)
    print(jsonString(snapshot))
}

func buildWikiGraphSnapshot(wikiRoot: String, includeRaw: Bool) -> WikiGraphSnapshot {
    let index = openWikiIndex(wikiRoot: wikiRoot)
    let pages = index.listPages()
    let links = index.listLinks()
    index.close()

    let nodes = pages.map { page in
        WikiGraphNode(
            id: page.path,
            path: page.path,
            type: page.type,
            name: page.name,
            description: page.description,
            tags: page.tags,
            plugin: page.plugin,
            modified_at: page.modified_at
        )
    }

    var raw: [String: String] = [:]
    if includeRaw {
        for page in pages {
            let fullPath = "\(wikiRoot)/\(page.path)"
            if let content = try? String(contentsOfFile: fullPath, encoding: .utf8) {
                raw[page.path] = content
            }
        }
    }

    return WikiGraphSnapshot(
        nodes: nodes,
        links: links.map { WikiGraphLink(source: $0.source_path, target: $0.target_path) },
        raw: raw,
        config: .default
    )
}

func wikiGraphJSONData(wikiRoot: String, includeRaw: Bool, pretty: Bool = false) throws -> Data {
    let snapshot = buildWikiGraphSnapshot(wikiRoot: wikiRoot, includeRaw: includeRaw)
    let encoder = JSONEncoder()
    if pretty {
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    } else {
        encoder.outputFormatting = [.sortedKeys]
    }
    return try encoder.encode(snapshot)
}

func reindexWikiEntry(path relativePath: String, wikiRoot: String = aosWikiDir()) {
    guard relativePath.hasSuffix(".md") else { return }
    let fullPath = "\(wikiRoot)/\(relativePath)"
    guard FileManager.default.fileExists(atPath: fullPath),
          let content = try? String(contentsOfFile: fullPath, encoding: .utf8) else { return }

    let page = parseWikiPage(content: content)
    let context = wikiPathContext(for: relativePath, frontmatter: page.frontmatter)
    let fallbackName = wikiFallbackName(for: relativePath, pluginName: context.pluginName, isSkill: context.isSkill)
    let name = page.frontmatter.name ?? fallbackName
    let tags = page.frontmatter.tags
    let modifiedAt = fileModTime(fullPath)
    let baseDir = wikiRelativeDirectory(for: relativePath)
    let links = Array(Set(extractMarkdownLinks(from: page.body, relativeTo: baseDir))).sorted()

    let index = openWikiIndex(wikiRoot: wikiRoot)
    index.upsertPage(
        path: relativePath,
        type: page.frontmatter.type ?? context.inferredType,
        name: name,
        description: page.frontmatter.description,
        tags: tags,
        plugin: context.pluginName,
        modifiedAt: modifiedAt
    )
    index.deleteLinksFrom(source: relativePath)
    for target in links {
        index.upsertLink(source: relativePath, target: target)
    }
    if context.isSkill, let pluginName = context.pluginName {
        index.upsertPlugin(
            name: pluginName,
            version: page.frontmatter.version,
            author: page.frontmatter.author,
            description: page.frontmatter.description,
            triggers: page.frontmatter.triggers,
            requires: page.frontmatter.requires,
            modifiedAt: modifiedAt
        )
    }
    index.close()
}

func removeWikiEntry(path relativePath: String, wikiRoot: String = aosWikiDir()) {
    let index = openWikiIndex(wikiRoot: wikiRoot)
    let context = wikiPathContext(for: relativePath, frontmatter: nil)
    if context.isSkill, let pluginName = context.pluginName {
        index.deletePlugin(name: pluginName)
    }
    index.deletePage(path: relativePath)
    index.close()
}

private func wikiPathContext(for relativePath: String, frontmatter: WikiFrontmatter?) -> WikiPathContext {
    let segments = relativePath.split(separator: "/").map(String.init)
    if let pluginStart = wikiPluginSegmentStart(segments: segments), segments.count > pluginStart + 1 {
        let pluginName = segments[pluginStart]
        let remainder = Array(segments.dropFirst(pluginStart + 1))
        if remainder == ["SKILL.md"] {
            return WikiPathContext(pluginName: pluginName, inferredType: "workflow", isSkill: true)
        }
        if remainder.first == "references" {
            return WikiPathContext(pluginName: pluginName, inferredType: frontmatter?.type ?? "concept", isSkill: false)
        }
        return WikiPathContext(pluginName: pluginName, inferredType: frontmatter?.type ?? "concept", isSkill: false)
    }

    if wikiEntitySegmentStart(segments: segments) != nil {
        return WikiPathContext(pluginName: nil, inferredType: "entity", isSkill: false)
    }
    if wikiConceptSegmentStart(segments: segments) != nil {
        return WikiPathContext(pluginName: nil, inferredType: "concept", isSkill: false)
    }
    return WikiPathContext(pluginName: nil, inferredType: frontmatter?.type ?? "concept", isSkill: false)
}

private func wikiPluginSegmentStart(segments: [String]) -> Int? {
    if segments.count >= 3, segments[0] == aosWikiPlatformNamespace, segments[1] == "plugins" {
        return 2
    }
    if segments.count >= 2, segments[0] == "plugins" {
        return 1
    }
    return nil
}

private func wikiEntitySegmentStart(segments: [String]) -> Int? {
    if segments.count >= 2, segments[0] == aosWikiPlatformNamespace, segments[1] == "entities" {
        return 2
    }
    if !segments.isEmpty, segments[0] == "entities" {
        return 1
    }
    return nil
}

private func wikiConceptSegmentStart(segments: [String]) -> Int? {
    if segments.count >= 2, segments[0] == aosWikiPlatformNamespace, segments[1] == "concepts" {
        return 2
    }
    if !segments.isEmpty, segments[0] == "concepts" {
        return 1
    }
    return nil
}

private func wikiFallbackName(for relativePath: String, pluginName: String?, isSkill: Bool) -> String {
    if isSkill, let pluginName = pluginName { return pluginName }
    let fileName = (relativePath as NSString).lastPathComponent
    return fileName.replacingOccurrences(of: ".md", with: "")
}

private func wikiRelativeDirectory(for relativePath: String) -> String {
    let dir = (relativePath as NSString).deletingLastPathComponent
    return dir == "." ? "" : dir
}
