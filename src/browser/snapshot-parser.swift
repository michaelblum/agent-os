// snapshot-parser.swift — Parse playwright-cli snapshot markdown into AXElementJSON[].
//
// Grammar (representative, not formal):
//   - <role> [ref=<id>]
//   - <role> [state] [ref=<id>]:          (e.g. generic [active] [ref=e1])
//   - <role> "<name>" [ref=<id>]
//   - <role> "<name>" [value="<v>"] [ref=<id>]
//   - <role> "<name>" [disabled] [ref=<id>]
//   - <role> "<name>" [ref=<id>] [cursor=pointer]:
// Indentation (2 spaces per level) indicates parent-child in the AX tree.
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

// Strip leading spaces + "- " list marker. Returns the 2-space indent level
// and the remaining body, or nil if the line doesn't match the list-item
// shape (blank line, no leading dash, etc.).
private func stripListMarker(_ line: String) -> (indent: Int, body: String)? {
    var spaceCount = 0
    var idx = line.startIndex
    while idx < line.endIndex, line[idx] == " " {
        spaceCount += 1
        idx = line.index(after: idx)
    }
    guard idx < line.endIndex, line[idx] == "-" else { return nil }
    idx = line.index(after: idx)
    while idx < line.endIndex, line[idx] == " " {
        idx = line.index(after: idx)
    }
    let body = String(line[idx...])
    guard !body.isEmpty else { return nil }
    return (indent: spaceCount / 2, body: body)
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
    if let firstSpace = s.firstIndex(where: { $0 == " " }) {
        role = String(s[..<firstSpace])
        rest = String(s[s.index(after: firstSpace)...])
    } else {
        role = s.trimmingCharacters(in: .whitespaces)
        rest = ""
    }
    guard !role.isEmpty else { return nil }

    // Decoration lines (`/url: "#"`, `/placeholder: "..."`) start with `/`
    // — they describe the previous element, not a new one. Skip.
    if role.hasPrefix("/") { return nil }

    // Require a ref. Lines without one are either decoration we haven't
    // enumerated or forward-compat additions we shouldn't guess about.
    guard let ref = extractBracketValue(rest, key: "ref") else { return nil }

    let title = extractQuoted(rest)
    let value = extractBracketQuoted(rest, key: "value")
    let disabled = rest.contains("[disabled]")

    return LineParts(role: role, title: title, value: value, disabled: disabled, ref: ref)
}

// First double-quoted substring in `s`, excluding the quotes. Used for the
// element title. Assumes no escaped quotes — playwright-cli 0.1.x does not
// appear to escape; tighten if needed later.
private func extractQuoted(_ s: String) -> String? {
    guard let startQ = s.firstIndex(of: "\"") else { return nil }
    let after = s.index(after: startQ)
    guard let endQ = s[after...].firstIndex(of: "\"") else { return nil }
    return String(s[after..<endQ])
}

// Extract [<key>=<id>] where <id> matches [A-Za-z0-9_-]+. Used for ref.
private func extractBracketValue(_ s: String, key: String) -> String? {
    let pattern = "\\[\(key)=([A-Za-z0-9_\\-]+)\\]"
    guard let range = s.range(of: pattern, options: .regularExpression) else { return nil }
    let match = String(s[range])
    let inner = match.dropFirst("[\(key)=".count).dropLast() // drop trailing ]
    return String(inner)
}

// Extract [<key>="<quoted>"] where <quoted> may contain any non-quote chars.
// Used for value. Regex requires the closing `"]` literal, hence dropLast(2).
private func extractBracketQuoted(_ s: String, key: String) -> String? {
    let pattern = "\\[\(key)=\"([^\"]*)\"\\]"
    guard let range = s.range(of: pattern, options: .regularExpression) else { return nil }
    let match = String(s[range])
    let inner = match.dropFirst("[\(key)=\"".count).dropLast(2) // drop trailing "]
    return String(inner)
}
