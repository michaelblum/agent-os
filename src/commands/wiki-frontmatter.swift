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
