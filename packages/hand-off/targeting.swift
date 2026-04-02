// targeting.swift — AX element finding with multi-field matching, disambiguation, and subtree scoping

import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Find Result

enum FindResult {
    case found(AXUIElement)
    case notFound(String)
    case timeout
}

// MARK: - Public API

/// Find an AX element matching the given query using BFS traversal.
///
/// Traversal respects `query.maxDepth` and `query.timeoutMs`. When `query.subtree`
/// is set the search is scoped to the first element matching the subtree spec.
/// Disambiguation uses `query.index` (N-th match) or `query.near` (closest to point).
func findElement(query: ElementQuery) -> FindResult {
    let deadline = Date().addingTimeInterval(Double(query.timeoutMs) / 1000.0)

    guard query.pid != 0 else {
        return .notFound("No pid specified — \(describeQuery(query))")
    }

    let app = AXUIElementCreateApplication(query.pid)

    // Determine the root of the search: either a subtree root or the app itself.
    let searchRoot: AXUIElement
    if let spec = query.subtree {
        let subtreeResult = findSubtreeRoot(app: app, spec: spec, deadline: deadline, maxDepth: query.maxDepth)
        switch subtreeResult {
        case .found(let root):
            searchRoot = root
        case .notFound(let msg):
            return .notFound(msg)
        case .timeout:
            return .timeout
        }
    } else {
        searchRoot = app
    }

    // No field criteria at all — just return the search root (useful for subtree-only targeting)
    let hasAnyCriteria = query.role != nil || query.title != nil || query.label != nil
        || query.identifier != nil || query.value != nil
    if !hasAnyCriteria {
        return .found(searchRoot)
    }

    // BFS traversal collecting matches
    var matches: [(element: AXUIElement, bounds: CGRect?)] = []
    let needBounds = query.near != nil

    // BFS queue: (element, currentDepth)
    var queue: [(AXUIElement, Int)] = [(searchRoot, 0)]
    var head = 0

    while head < queue.count {
        if Date() > deadline { return .timeout }

        let (current, depth) = queue[head]
        head += 1

        if elementMatches(current, query: query) {
            let b = needBounds ? axBounds(current) : nil
            matches.append((current, b))

            // Fast path: if we need the first match and don't need near disambiguation, return early
            if query.near == nil && query.index == nil {
                return .found(current)
            }
            // If we only need index N and we have enough matches, return early
            if let idx = query.index, idx >= 0, matches.count > idx, query.near == nil {
                return .found(matches[idx].element)
            }
        }

        // Expand children if within depth limit
        if depth < query.maxDepth {
            let children = axChildren(current)
            for child in children {
                queue.append((child, depth + 1))
            }
        }
    }

    // Disambiguation
    if matches.isEmpty {
        return .notFound(describeQuery(query))
    }

    // Near-point disambiguation: return the match whose center is closest to the point
    if let nearPoint = query.near {
        var bestElement = matches[0].element
        var bestDist = Double.greatestFiniteMagnitude

        for m in matches {
            guard let bounds = m.bounds ?? axBounds(m.element) else { continue }
            let cx = Double(bounds.midX)
            let cy = Double(bounds.midY)
            let dx = cx - Double(nearPoint.x)
            let dy = cy - Double(nearPoint.y)
            let dist = dx * dx + dy * dy // no need for sqrt — comparing relative distances
            if dist < bestDist {
                bestDist = dist
                bestElement = m.element
            }
        }
        return .found(bestElement)
    }

    // Index disambiguation
    if let idx = query.index {
        if idx >= 0 && idx < matches.count {
            return .found(matches[idx].element)
        }
        return .notFound("\(describeQuery(query)) — index \(idx) out of range (found \(matches.count) match\(matches.count == 1 ? "" : "es"))")
    }

    // Fallback: first match (shouldn't reach here due to fast-path above, but defensive)
    return .found(matches[0].element)
}

// MARK: - Subtree Root Finding

/// BFS for the subtree root element matching the given spec. Uses `.exact` matching
/// since subtree specs are identifiers, not user search strings.
private func findSubtreeRoot(app: AXUIElement, spec: SubtreeSpec, deadline: Date, maxDepth: Int) -> FindResult {
    var queue: [(AXUIElement, Int)] = [(app, 0)]
    var head = 0

    while head < queue.count {
        if Date() > deadline { return .timeout }

        let (current, depth) = queue[head]
        head += 1

        if subtreeMatches(current, spec: spec) {
            return .found(current)
        }

        if depth < maxDepth {
            let children = axChildren(current)
            for child in children {
                queue.append((child, depth + 1))
            }
        }
    }

    var parts: [String] = []
    if let r = spec.role { parts.append("role=\(r)") }
    if let t = spec.title { parts.append("title=\"\(t)\"") }
    if let i = spec.identifier { parts.append("identifier=\"\(i)\"") }
    return .notFound("Subtree root not found: \(parts.joined(separator: ", "))")
}

/// Check if an element matches a SubtreeSpec (exact matching only).
private func subtreeMatches(_ element: AXUIElement, spec: SubtreeSpec) -> Bool {
    if let role = spec.role {
        guard axString(element, kAXRoleAttribute as String) == role else { return false }
    }
    if let title = spec.title {
        guard axString(element, kAXTitleAttribute as String) == title else { return false }
    }
    if let identifier = spec.identifier {
        guard axString(element, kAXIdentifierAttribute as String) == identifier else { return false }
    }
    return true
}

// MARK: - Element Matching

/// Test whether a single AX element matches ALL criteria in the query (AND logic).
private func elementMatches(_ element: AXUIElement, query: ElementQuery) -> Bool {
    let mode = query.matchMode

    if let role = query.role {
        guard let actual = axString(element, kAXRoleAttribute as String),
              stringMatches(actual, pattern: role, mode: mode) else { return false }
    }
    if let title = query.title {
        guard let actual = axString(element, kAXTitleAttribute as String),
              stringMatches(actual, pattern: title, mode: mode) else { return false }
    }
    if let label = query.label {
        guard let actual = axString(element, kAXDescriptionAttribute as String),
              stringMatches(actual, pattern: label, mode: mode) else { return false }
    }
    if let identifier = query.identifier {
        guard let actual = axString(element, kAXIdentifierAttribute as String),
              stringMatches(actual, pattern: identifier, mode: mode) else { return false }
    }
    if let value = query.value {
        guard let actual = axString(element, kAXValueAttribute as String),
              stringMatches(actual, pattern: value, mode: mode) else { return false }
    }
    return true
}

// MARK: - String Matching

/// Match a string against a pattern using the specified mode.
/// - `.exact`: case-sensitive equality
/// - `.contains`: case-insensitive substring match
/// - `.regex`: full Swift regex match (pattern must match the entire string)
private func stringMatches(_ actual: String, pattern: String, mode: MatchMode) -> Bool {
    switch mode {
    case .exact:
        return actual == pattern
    case .contains:
        return actual.localizedCaseInsensitiveContains(pattern)
    case .regex:
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return false
        }
        let range = NSRange(actual.startIndex..., in: actual)
        guard let match = regex.firstMatch(in: actual, options: [], range: range) else {
            return false
        }
        // Full-string match: the matched range must cover the entire string
        return match.range.location == 0 && match.range.length == range.length
    }
}

// MARK: - Query Description

/// Build a human-readable description of what the query is searching for.
private func describeQuery(_ query: ElementQuery) -> String {
    var parts: [String] = ["pid=\(query.pid)"]
    if let r = query.role { parts.append("role=\(r)") }
    if let t = query.title { parts.append("title=\"\(t)\"") }
    if let l = query.label { parts.append("label=\"\(l)\"") }
    if let i = query.identifier { parts.append("identifier=\"\(i)\"") }
    if let v = query.value { parts.append("value=\"\(v)\"") }
    if let idx = query.index { parts.append("index=\(idx)") }
    if let near = query.near { parts.append("near=(\(Int(near.x)),\(Int(near.y)))") }
    if query.matchMode != .exact { parts.append("match=\(query.matchMode.rawValue)") }
    if let sub = query.subtree {
        var subParts: [String] = []
        if let r = sub.role { subParts.append("role=\(r)") }
        if let t = sub.title { subParts.append("title=\"\(t)\"") }
        if let i = sub.identifier { subParts.append("identifier=\"\(i)\"") }
        parts.append("subtree={\(subParts.joined(separator: ", "))}")
    }
    return "Element not found: \(parts.joined(separator: ", "))"
}
