// snapshot-parser.swift — Parse playwright-cli snapshot markdown into AXElementJSON[].
//
// Grammar (representative, not formal):
//   - <role> [ref=<id>]
//   - <role> [state] [ref=<id>]:          (e.g. generic [active] [ref=e1])
//   - <role> "<name>" [ref=<id>]
//   - <role> "<name>" [value="<v>"] [ref=<id>]
//   - <role> "<name>" [disabled] [ref=<id>]
//   - <role> "<name>" [ref=<id>] [cursor=pointer]:
// Indentation (2 spaces or one tab per level) indicates parent-child in the AX tree.
//
// Lines without a [ref=<id>] (e.g. `- /url: "#"`, plain text nodes emitted as
// content under a link) are treated as decoration and skipped. Unknown inline
// markers (`[active]`, `[cursor=pointer]`, future additions) are ignored —
// only `[disabled]`, `[ref=<id>]`, and `[value="..."]` are consulted.

import Foundation

func parseSnapshotMarkdown(_ contents: String) -> [AXElementJSON] {
    var elements: [AXElementJSON] = []
    var stack: [(indent: Int, role: String)] = []

    for rawLine in contents.split(separator: "\n", omittingEmptySubsequences: false) {
        let line = String(rawLine)
        guard let (indent, body) = stripListMarker(line) else { continue }
        guard let parsed = parseLineBody(body) else { continue }

        while let top = stack.last, top.indent >= indent {
            stack.removeLast()
        }
        let contextPath = stack.map { $0.role }

        elements.append(AXElementJSON(
            role: parsed.role,
            title: parsed.title,
            label: nil,
            value: parsed.value,
            enabled: !parsed.disabled,
            context_path: contextPath,
            bounds: nil,
            ref: parsed.ref
        ))
        stack.append((indent: indent, role: parsed.role))
    }
    return elements
}

// Strip leading indentation + "- " list marker. Returns the indent level and
// the remaining body, or nil if the line doesn't match the list-item shape
// (blank line, no leading dash, etc.). Playwright 0.1.x usually emits two
// spaces per level, but observed markdown can include tabs; normalize one tab
// to one level so parent context stays stable across formatter drift.
private func stripListMarker(_ line: String) -> (indent: Int, body: String)? {
    var columns = 0
    var idx = line.startIndex
    while idx < line.endIndex, line[idx] == " " || line[idx] == "\t" {
        columns += (line[idx] == "\t") ? 2 : 1
        idx = line.index(after: idx)
    }
    guard idx < line.endIndex, line[idx] == "-" else { return nil }
    idx = line.index(after: idx)
    while idx < line.endIndex, line[idx] == " " || line[idx] == "\t" {
        idx = line.index(after: idx)
    }
    let body = String(line[idx...])
    guard !body.isEmpty else { return nil }
    return (indent: columns / 2, body: body)
}

private struct LineParts {
    let role: String
    let title: String?
    let value: String?
    let disabled: Bool
    let ref: String?
}

// Parse the line body (post list-marker). Returns nil when the body does not
// describe an AX element we can emit — notably decoration lines like
// `/url: "..."` and any line lacking a [ref=<id>] marker.
private func parseLineBody(_ body: String) -> LineParts? {
    // Trailing `:` signals "has children"; trailing ` : <text>` appears on
    // content-bearing roles like `paragraph [ref=e6]: Welcome`. We only care
    // about fields delimited by brackets or quotes, so strip the trailing
    // colon but leave any inner `: content` alone — the extractors below
    // operate on bracket/quoted substrings and ignore leftover prose.
    var s = body
    if s.hasSuffix(":") { s.removeLast() }

    // Role is the leading word (up to first whitespace or end). If the line
    // has no whitespace, it's a role-only line (no ref, no title) which we
    // reject below since valid AX lines always carry a ref.
    let role: String
    let rest: String
    if let firstWhitespace = s.firstIndex(where: { $0.isWhitespace }) {
        role = String(s[..<firstWhitespace])
        rest = String(s[s.index(after: firstWhitespace)...])
    } else {
        role = s.trimmingCharacters(in: .whitespacesAndNewlines)
        rest = ""
    }
    guard !role.isEmpty else { return nil }

    // Decoration lines (`/url: "#"`, `/placeholder: "..."`) start with `/`
    // — they describe the previous element, not a new one. Skip.
    if role.hasPrefix("/") { return nil }

    let inline = parseInlineFields(rest)

    // Require a ref. Lines without one are either decoration we haven't
    // enumerated or forward-compat additions we shouldn't guess about. The ref
    // must be an actual marker outside the title; names like "literal [ref=e9]"
    // are display text, not element identity.
    guard let ref = inline.markers["ref"], isValidRef(ref) else { return nil }

    return LineParts(
        role: role,
        title: inline.title,
        value: inline.markers["value"],
        disabled: inline.flags.contains("disabled"),
        ref: ref
    )
}

private struct InlineFields {
    let title: String?
    let markers: [String: String]
    let flags: Set<String>
}

// Parse quoted title text and bracket markers outside that title. This avoids
// treating element names such as `"literal [ref=e999]"` as real markers.
private func parseInlineFields(_ s: String) -> InlineFields {
    var title: String?
    var markers: [String: String] = [:]
    var flags = Set<String>()
    var idx = s.startIndex

    while idx < s.endIndex {
        let ch = s[idx]
        if ch == "\"" {
            if let quoted = readQuoted(s, openingQuote: idx) {
                if title == nil { title = quoted.value }
                idx = quoted.next
                continue
            }
        } else if ch == "[" {
            if let close = findClosingBracket(s, openingBracket: idx) {
                let innerStart = s.index(after: idx)
                let inner = String(s[innerStart..<close])
                if let marker = parseBracketMarker(inner) {
                    if let value = marker.value {
                        markers[marker.key] = value
                    } else {
                        flags.insert(marker.key)
                    }
                }
                idx = s.index(after: close)
                continue
            }
        }
        idx = s.index(after: idx)
    }

    return InlineFields(title: title, markers: markers, flags: flags)
}

private func readQuoted(_ s: String, openingQuote: String.Index) -> (value: String, next: String.Index)? {
    var value = ""
    var idx = s.index(after: openingQuote)
    var escaped = false

    while idx < s.endIndex {
        let ch = s[idx]
        if escaped {
            value.append(ch)
            escaped = false
        } else if ch == "\\" {
            escaped = true
        } else if ch == "\"" {
            return (value, s.index(after: idx))
        } else {
            value.append(ch)
        }
        idx = s.index(after: idx)
    }

    return nil
}

private func findClosingBracket(_ s: String, openingBracket: String.Index) -> String.Index? {
    var idx = s.index(after: openingBracket)
    var inQuote = false
    var escaped = false

    while idx < s.endIndex {
        let ch = s[idx]
        if escaped {
            escaped = false
        } else if inQuote {
            if ch == "\\" {
                escaped = true
            } else if ch == "\"" {
                inQuote = false
            }
        } else if ch == "\"" {
            inQuote = true
        } else if ch == "]" {
            return idx
        }
        idx = s.index(after: idx)
    }

    return nil
}

private func parseBracketMarker(_ inner: String) -> (key: String, value: String?)? {
    let trimmed = inner.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    guard let equals = trimmed.firstIndex(of: "=") else {
        return (key: trimmed, value: nil)
    }

    let key = String(trimmed[..<equals]).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty else { return nil }

    let rawStart = trimmed.index(after: equals)
    let rawValue = String(trimmed[rawStart...]).trimmingCharacters(in: .whitespacesAndNewlines)
    if rawValue.hasPrefix("\""),
       let quoted = readQuoted(rawValue, openingQuote: rawValue.startIndex),
       quoted.next == rawValue.endIndex {
        return (key: key, value: quoted.value)
    }
    return (key: key, value: rawValue)
}

private func isValidRef(_ value: String) -> Bool {
    !value.isEmpty && value.unicodeScalars.allSatisfy { scalar in
        switch scalar.value {
        case 48...57, 65...90, 97...122: // 0-9, A-Z, a-z
            return true
        default:
            return scalar == "_" || scalar == "-"
        }
    }
}
