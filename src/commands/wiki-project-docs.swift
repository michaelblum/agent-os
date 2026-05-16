// wiki-project-docs.swift — deterministic repo-doc projection into the runtime wiki

import CryptoKit
import Foundation

private let repoDocsProjectionID = "repo_docs_v0"
private let defaultRepoDocsProjectionManifest = "docs/wiki/repo-docs-projection-v0.json"

private struct RepoDocsProjectionManifest: Decodable {
    let projection: String
    let description: String?
    let entries: [RepoDocsProjectionEntry]
}

private struct RepoDocsProjectionEntry: Decodable {
    let source_path: String
    let slug: String
    let type: String
    let name: String
    let description: String
    let tags: [String]
    let concepts: [String]
    let source_type: String
}

private struct RepoDocsProjectionResult: Encodable {
    let status: String
    let manifest: String
    let projection: String
    let dry_run: Bool
    let projected: Int
    let unchanged: Int
    let removed: Int
    let stale: Int
    let indexed: Int
    let errored: Int
    let pages: [String]
    let errors: [String]
}

func wikiProjectDocsCommand(args: [String]) {
    let asJSON = hasFlag(args, "--json")
    let dryRun = hasFlag(args, "--dry-run")
    let manifestArg = getArg(args, "--manifest") ?? defaultRepoDocsProjectionManifest

    let repoRoot = aosCurrentRepoRoot() ?? FileManager.default.currentDirectoryPath
    let manifestPath = absoluteRepoPath(repoRoot: repoRoot, path: manifestArg)
    let wikiRoot = aosWikiDir()

    let result = runRepoDocsProjection(
        repoRoot: repoRoot,
        wikiRoot: wikiRoot,
        manifestPath: manifestPath,
        dryRun: dryRun
    )

    if result.errored > 0 {
        if asJSON {
            print(jsonString(result))
        } else {
            for error in result.errors { fputs("Error: \(error)\n", stderr) }
        }
        exit(1)
    }

    if asJSON {
        print(jsonString(result))
    } else if dryRun {
        print("Repo docs projection dry run: \(result.projected) would update, \(result.unchanged) unchanged, \(result.removed) stale generated page(s) would be removed.")
    } else {
        print("Repo docs projection complete: \(result.projected) projected, \(result.unchanged) unchanged, \(result.removed) stale generated page(s) removed, \(result.indexed) indexed.")
    }
}

private func runRepoDocsProjection(repoRoot: String, wikiRoot: String, manifestPath: String, dryRun: Bool) -> RepoDocsProjectionResult {
    var errors: [String] = []
    guard let manifestData = FileManager.default.contents(atPath: manifestPath) else {
        return projectionError(manifestPath: manifestPath, dryRun: dryRun, message: "Manifest not found at \(manifestPath)")
    }

    let manifest: RepoDocsProjectionManifest
    do {
        manifest = try JSONDecoder().decode(RepoDocsProjectionManifest.self, from: manifestData)
    } catch {
        return projectionError(manifestPath: manifestPath, dryRun: dryRun, message: "Could not parse manifest: \(error.localizedDescription)")
    }

    guard manifest.projection == repoDocsProjectionID else {
        return projectionError(manifestPath: manifestPath, dryRun: dryRun, message: "Unsupported projection '\(manifest.projection)'")
    }

    var slugs = Set<String>()
    var sources = Set<String>()
    for entry in manifest.entries {
        if !isSafeRepoRelativePath(entry.source_path) {
            errors.append("Unsafe source path: \(entry.source_path)")
        }
        if !isSafeWikiSlug(entry.slug) {
            errors.append("Unsafe slug: \(entry.slug)")
        }
        if !slugs.insert(entry.slug).inserted {
            errors.append("Duplicate slug: \(entry.slug)")
        }
        if !sources.insert(entry.source_path).inserted {
            errors.append("Duplicate source path: \(entry.source_path)")
        }
    }
    if !errors.isEmpty {
        return projectionResult(manifestPath: manifestPath, dryRun: dryRun, projected: 0, unchanged: 0, removed: 0, stale: 0, indexed: 0, pages: [], errors: errors)
    }

    let entriesByConcept = Dictionary(grouping: manifest.entries) { entry in
        entry.concepts.map { $0.lowercased() }
    }
    let liveRelativePaths = Set(manifest.entries.map { projectedWikiRelativePath(slug: $0.slug) })
    var projected = 0
    var unchanged = 0
    var pages: [String] = []

    for entry in manifest.entries.sorted(by: { $0.slug < $1.slug }) {
        let sourcePath = absoluteRepoPath(repoRoot: repoRoot, path: entry.source_path)
        guard let sourceContent = try? String(contentsOfFile: sourcePath, encoding: .utf8) else {
            errors.append("Could not read source: \(entry.source_path)")
            continue
        }
        let hash = sha256String(sourceContent)
        let relativePath = projectedWikiRelativePath(slug: entry.slug)
        let targetPath = "\(wikiRoot)/\(relativePath)"
        let content = renderProjectedRepoDocPage(
            entry: entry,
            sourceContent: sourceContent,
            sourceHash: hash,
            relatedEntries: relatedProjectionEntries(for: entry, entriesByConcept: entriesByConcept)
        )
        pages.append(relativePath)

        if let existing = try? String(contentsOfFile: targetPath, encoding: .utf8), existing == content {
            unchanged += 1
            continue
        }

        projected += 1
        if !dryRun {
            do {
                try FileManager.default.createDirectory(
                    atPath: (targetPath as NSString).deletingLastPathComponent,
                    withIntermediateDirectories: true
                )
                try content.write(toFile: targetPath, atomically: true, encoding: .utf8)
            } catch {
                errors.append("Could not write \(relativePath): \(error.localizedDescription)")
            }
        }
    }

    let stalePages = findStaleRepoDocProjectionPages(wikiRoot: wikiRoot, excluding: liveRelativePaths)
    if !dryRun {
        for stale in stalePages {
            try? FileManager.default.removeItem(atPath: "\(wikiRoot)/\(stale)")
            removeWikiEntry(path: stale, wikiRoot: wikiRoot)
        }
    }

    var indexed = 0
    if !dryRun && errors.isEmpty {
        for page in pages {
            reindexWikiEntry(path: page, wikiRoot: wikiRoot)
        }
        indexed = pages.count
    }

    return projectionResult(
        manifestPath: manifestPath,
        dryRun: dryRun,
        projected: projected,
        unchanged: unchanged,
        removed: dryRun ? 0 : stalePages.count,
        stale: stalePages.count,
        indexed: indexed,
        pages: pages,
        errors: errors
    )
}

private func projectionError(manifestPath: String, dryRun: Bool, message: String) -> RepoDocsProjectionResult {
    projectionResult(manifestPath: manifestPath, dryRun: dryRun, projected: 0, unchanged: 0, removed: 0, stale: 0, indexed: 0, pages: [], errors: [message])
}

private func projectionResult(manifestPath: String, dryRun: Bool, projected: Int, unchanged: Int, removed: Int, stale: Int, indexed: Int, pages: [String], errors: [String]) -> RepoDocsProjectionResult {
    RepoDocsProjectionResult(
        status: errors.isEmpty ? "ok" : "error",
        manifest: manifestPath,
        projection: repoDocsProjectionID,
        dry_run: dryRun,
        projected: projected,
        unchanged: unchanged,
        removed: removed,
        stale: stale,
        indexed: indexed,
        errored: errors.count,
        pages: pages.sorted(),
        errors: errors
    )
}

private func renderProjectedRepoDocPage(entry: RepoDocsProjectionEntry, sourceContent: String, sourceHash: String, relatedEntries: [RepoDocsProjectionEntry]) -> String {
    let tags = yamlInlineArray(entry.tags)
    let concepts = yamlInlineArray(entry.concepts)
    let projectedSource = escapeSourceLinksForWikiProjection(sourceContent.trimmingCharacters(in: .newlines))
    let related = relatedEntries
        .filter { $0.slug != entry.slug }
        .sorted { $0.slug < $1.slug }
        .map { "- [\($0.name)](\($0.slug).md)" }
        .joined(separator: "\n")
    let relatedBlock = related.isEmpty ? "- No same-concept projected pages in this manifest." : related

    let projectedSourceFence = markdownCodeFence(for: projectedSource)

    return """
    ---
    type: \(entry.type)
    name: \(yamlScalar(entry.name))
    description: \(yamlScalar(entry.description))
    tags: \(tags)
    generated: true
    projection: \(repoDocsProjectionID)
    source_path: \(entry.source_path)
    source_hash: \(sourceHash)
    source_type: \(entry.source_type)
    concepts: \(concepts)
    ---

    # \(entry.name)

    This runtime wiki page is generated from repo Git docs. Git is canonical; this wiki page is only a deterministic projection for query and orientation.

    ## Canonical Source

    - Source path: `\(entry.source_path)`
    - Source hash: `\(sourceHash)`
    - Source type: `\(entry.source_type)`

    ## Controlled Concepts

    \(entry.concepts.map { "- `\($0)`" }.joined(separator: "\n"))

    ## Projected Source

    \(projectedSourceFence)markdown
    \(projectedSource)
    \(projectedSourceFence)

    ## Related Projected Pages

    \(relatedBlock)
    """
}

private func markdownCodeFence(for content: String) -> String {
    var longestBacktickRun = 0
    var currentRun = 0
    for character in content {
        if character == "`" {
            currentRun += 1
            longestBacktickRun = max(longestBacktickRun, currentRun)
        } else {
            currentRun = 0
        }
    }
    return String(repeating: "`", count: max(3, longestBacktickRun + 1))
}

private func relatedProjectionEntries(for entry: RepoDocsProjectionEntry, entriesByConcept: [[String]: [RepoDocsProjectionEntry]]) -> [RepoDocsProjectionEntry] {
    var related: [String: RepoDocsProjectionEntry] = [:]
    for concept in entry.concepts.map({ $0.lowercased() }) {
        for (concepts, entries) in entriesByConcept where concepts.contains(concept) {
            for relatedEntry in entries {
                related[relatedEntry.slug] = relatedEntry
            }
        }
    }
    return Array(related.values)
}

private func findStaleRepoDocProjectionPages(wikiRoot: String, excluding livePaths: Set<String>) -> [String] {
    let conceptsDir = "\(wikiRoot)/\(wikiNamespacedDir("concepts"))"
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: conceptsDir) else { return [] }
    var stale: [String] = []
    for file in files where file.hasSuffix(".md") {
        let relativePath = "\(wikiNamespacedDir("concepts"))/\(file)"
        if livePaths.contains(relativePath) { continue }
        let fullPath = "\(conceptsDir)/\(file)"
        guard let content = try? String(contentsOfFile: fullPath, encoding: .utf8) else { continue }
        let page = parseWikiPage(content: content)
        if page.frontmatter.raw["generated"] == "true", page.frontmatter.raw["projection"] == repoDocsProjectionID {
            stale.append(relativePath)
        }
    }
    return stale.sorted()
}

private func projectedWikiRelativePath(slug: String) -> String {
    "\(wikiNamespacedDir("concepts"))/\(slug).md"
}

private func absoluteRepoPath(repoRoot: String, path: String) -> String {
    if path.hasPrefix("/") { return path }
    return "\(repoRoot)/\(path)"
}

private func isSafeRepoRelativePath(_ path: String) -> Bool {
    !path.isEmpty && !path.hasPrefix("/") && !path.contains("..") && !path.contains("\\")
}

private func isSafeWikiSlug(_ slug: String) -> Bool {
    guard !slug.isEmpty, !slug.contains("/") else { return false }
    return slug.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil
}

private func sha256String(_ content: String) -> String {
    let digest = SHA256.hash(data: Data(content.utf8))
    return "sha256:" + digest.map { String(format: "%02x", $0) }.joined()
}

private func yamlInlineArray(_ values: [String]) -> String {
    "[" + values.map(yamlScalar).joined(separator: ", ") + "]"
}

private func yamlScalar(_ value: String) -> String {
    let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}

private func escapeSourceLinksForWikiProjection(_ content: String) -> String {
    // The current wiki indexer extracts Markdown links without tracking code
    // fences. Keep source text visible while preventing incidental repo-doc
    // links inside the source block from becoming wiki graph edges.
    content.replacingOccurrences(of: "](", with: "]\\(")
}
