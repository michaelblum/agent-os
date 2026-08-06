// targeting.swift — AX element finding with multi-field matching, disambiguation, and subtree scoping

import ApplicationServices
import CoreGraphics
import Foundation

// MARK: - Find Result

enum FindResult {
    case found(AXUIElement)
    case notFound(String)
    case ambiguous(Int, [AXTargetCandidateFact], Bool)
    case incompatible(String, String)
    case invalid(String)
    case timeout
}

enum AXDeadlineCall<Value> {
    case value(Value)
    case timeout
}

enum AXTargetCompatibilityResolution {
    case compatible
    case incompatible(String, String)
    case timeout
}

private let maxResolvedCandidates = 1_024
private let maxReportedCandidateFacts = 8
let maxNativeLocatorDepth = 128
let maxNativeLocatorTimeoutMs = 30_000

func axCallBeforeDeadline<Value>(
    _ element: AXUIElement,
    deadline: Date,
    operation: () -> Value
) -> AXDeadlineCall<Value> {
    let remaining = deadline.timeIntervalSinceNow
    guard remaining > 0 else { return .timeout }
    guard AXUIElementSetMessagingTimeout(element, Float(remaining)) == .success else {
        return .timeout
    }
    let value = operation()
    guard Date() <= deadline else { return .timeout }
    return .value(value)
}

private func axAttributeValueBeforeDeadline(
    _ element: AXUIElement,
    _ attribute: CFString,
    deadline: Date
) -> AXDeadlineCall<AnyObject?> {
    axCallBeforeDeadline(element, deadline: deadline) {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
        return value
    }
}

private func axStringBeforeDeadline(
    _ element: AXUIElement,
    _ attribute: CFString,
    deadline: Date
) -> AXDeadlineCall<String?> {
    switch axAttributeValueBeforeDeadline(element, attribute, deadline: deadline) {
    case .value(let value): return .value(value as? String)
    case .timeout: return .timeout
    }
}

private func axChildrenBeforeDeadline(
    _ element: AXUIElement,
    deadline: Date
) -> AXDeadlineCall<[AXUIElement]> {
    switch axAttributeValueBeforeDeadline(element, kAXChildrenAttribute as CFString, deadline: deadline) {
    case .value(let value): return .value(value as? [AXUIElement] ?? [])
    case .timeout: return .timeout
    }
}

private func axBoundsBeforeDeadline(
    _ element: AXUIElement,
    deadline: Date
) -> AXDeadlineCall<CGRect?> {
    let positionValue: AnyObject?
    switch axAttributeValueBeforeDeadline(element, kAXPositionAttribute as CFString, deadline: deadline) {
    case .value(let value): positionValue = value
    case .timeout: return .timeout
    }
    let sizeValue: AnyObject?
    switch axAttributeValueBeforeDeadline(element, kAXSizeAttribute as CFString, deadline: deadline) {
    case .value(let value): sizeValue = value
    case .timeout: return .timeout
    }
    guard let positionValue, let sizeValue,
          CFGetTypeID(positionValue) == AXValueGetTypeID(),
          CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return .value(nil) }
    var position = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue as! AXValue, .cgPoint, &position),
          AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { return .value(nil) }
    return .value(CGRect(origin: position, size: size))
}

private func axWindowIDBeforeDeadline(
    _ element: AXUIElement,
    deadline: Date
) -> AXDeadlineCall<Int?> {
    axCallBeforeDeadline(element, deadline: deadline) {
        var windowID: CGWindowID = 0
        guard _AXUIElementGetWindow(element, &windowID) == .success, windowID != 0 else { return nil }
        return Int(windowID)
    }
}

private func candidateFact(
    _ element: AXUIElement,
    bounds: CGRect? = nil,
    deadline: Date
) -> AXDeadlineCall<AXTargetCandidateFact> {
    let rect: CGRect?
    if let bounds {
        rect = bounds
    } else {
        switch axBoundsBeforeDeadline(element, deadline: deadline) {
        case .value(let value): rect = value
        case .timeout: return .timeout
        }
    }
    let role: String?
    switch axStringBeforeDeadline(element, kAXRoleAttribute as CFString, deadline: deadline) {
    case .value(let value): role = value
    case .timeout: return .timeout
    }
    let title: String?
    switch axStringBeforeDeadline(element, kAXTitleAttribute as CFString, deadline: deadline) {
    case .value(let value): title = value
    case .timeout: return .timeout
    }
    let label: String?
    switch axStringBeforeDeadline(element, kAXDescriptionAttribute as CFString, deadline: deadline) {
    case .value(let value): label = value
    case .timeout: return .timeout
    }
    let identifier: String?
    switch axStringBeforeDeadline(element, kAXIdentifierAttribute as CFString, deadline: deadline) {
    case .value(let value): identifier = value
    case .timeout: return .timeout
    }
    return .value(AXTargetCandidateFact(
        role: role,
        title: title,
        label: label,
        identifier: identifier,
        bounds: rect.map { BoundsJSON(x: Int($0.origin.x), y: Int($0.origin.y), width: Int($0.width), height: Int($0.height)) }
    ))
}

private func ambiguousResult(
    _ matches: [(element: AXUIElement, bounds: CGRect?)],
    deadline: Date,
    countIsLowerBound: Bool = false
) -> FindResult {
    var facts: [AXTargetCandidateFact] = []
    candidateLoop: for match in matches.prefix(maxReportedCandidateFacts) {
        switch candidateFact(match.element, bounds: match.bounds, deadline: deadline) {
        case .value(let fact): facts.append(fact)
        case .timeout: break candidateLoop
        }
    }
    return .ambiguous(
        matches.count,
        facts,
        countIsLowerBound
    )
}

// MARK: - Public API

/// Find an AX element matching the given query using BFS traversal.
///
/// Traversal respects `query.maxDepth` and `query.timeoutMs`. When `query.subtree`
/// is set the search is scoped only when exactly one element matches the subtree spec.
/// Disambiguation uses `query.index` (N-th match) or `query.near` (closest to point).
func findElement(
    query: ElementQuery,
    resolveActionCompatibility: ((AXUIElement, Date) -> AXTargetCompatibilityResolution)? = nil
) -> FindResult {
    if query.maxDepth < 0 || query.maxDepth > maxNativeLocatorDepth {
        return .invalid("Target Locator depth must be between 0 and \(maxNativeLocatorDepth)")
    }
    if query.timeoutMs <= 0 || query.timeoutMs > maxNativeLocatorTimeoutMs {
        return .invalid("Target Locator timeout must be between 1 and \(maxNativeLocatorTimeoutMs) ms")
    }
    if let index = query.index, index >= maxResolvedCandidates {
        return .invalid("Target Locator index must be less than \(maxResolvedCandidates)")
    }
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
        case .ambiguous(let count, let candidates, let countIsLowerBound):
            return .ambiguous(count, candidates, countIsLowerBound)
        case .incompatible(let message, let code):
            return .incompatible(message, code)
        case .invalid(let message):
            return .invalid(message)
        case .timeout:
            return .timeout
        }
    } else {
        searchRoot = app
    }

    // No field criteria at all — just return the search root (useful for subtree-only targeting)
    let hasAnyCriteria = query.windowID != nil || query.role != nil || query.title != nil || query.label != nil
        || query.identifier != nil || query.value != nil
    if !hasAnyCriteria {
        return .found(searchRoot)
    }

    // BFS traversal collecting matches
    var matches: [(element: AXUIElement, bounds: CGRect?)] = []
    var compatibilityCounter = BoundedActionCompatibleCandidateCounter(limit: maxResolvedCandidates)
    var soleIncompatibility: (message: String, code: String)?
    let needBounds = query.near != nil

    // BFS queue: (element, currentDepth)
    var queue: [(AXUIElement, Int)] = [(searchRoot, 0)]
    var head = 0

    while head < queue.count {
        if Date() > deadline { return .timeout }

        let (current, depth) = queue[head]
        head += 1

        let matchesCurrent: Bool
        switch elementMatches(current, query: query, deadline: deadline) {
        case .value(let value): matchesCurrent = value
        case .timeout: return .timeout
        }
        if matchesCurrent {
            var includeCurrent = true
            if let resolveActionCompatibility {
                let compatibility: AXTargetCompatibilityResolution = resolveActionCompatibility(current, deadline)
                switch compatibility {
                case .compatible:
                    soleIncompatibility = nil
                    if compatibilityCounter.record(isCompatible: true) == .overflow {
                        matches.append((current, nil))
                        return ambiguousResult(matches, deadline: deadline, countIsLowerBound: true)
                    }
                case .incompatible(let message, let code):
                    _ = compatibilityCounter.record(isCompatible: false)
                    if compatibilityCounter.rawCount == 1 {
                        soleIncompatibility = (message, code)
                    } else {
                        soleIncompatibility = nil
                    }
                    includeCurrent = false
                case .timeout:
                    return .timeout
                }
            }
            if includeCurrent {
                let b: CGRect?
                if needBounds {
                    switch axBoundsBeforeDeadline(current, deadline: deadline) {
                    case .value(let value): b = value
                    case .timeout: return .timeout
                    }
                } else {
                    b = nil
                }
                matches.append((current, b))

                if resolveActionCompatibility == nil, matches.count > maxResolvedCandidates {
                    return ambiguousResult(matches, deadline: deadline, countIsLowerBound: true)
                }
                if let index = query.index, matches.count > index {
                    return .found(matches[index].element)
                }
            }
        }

        // Expand children if within depth limit
        if depth < query.maxDepth {
            let children: [AXUIElement]
            switch axChildrenBeforeDeadline(current, deadline: deadline) {
            case .value(let value): children = value
            case .timeout: return .timeout
            }
            for child in children {
                queue.append((child, depth + 1))
            }
        }
    }

    // Disambiguation
    if matches.isEmpty {
        if compatibilityCounter.rawCount == 1, let soleIncompatibility {
            return .incompatible(soleIncompatibility.message, soleIncompatibility.code)
        }
        if compatibilityCounter.rawCount > 0 {
            return .notFound("\(describeQuery(query)) — no action-compatible current match")
        }
        return .notFound(describeQuery(query))
    }

    var nearDistances: [Double?]? = nil
    if let nearPoint = query.near {
        var distances: [Double?] = []
        for match in matches {
            if Date() > deadline { return .timeout }
            let resolvedBounds: CGRect?
            if let bounds = match.bounds {
                resolvedBounds = bounds
            } else {
                switch axBoundsBeforeDeadline(match.element, deadline: deadline) {
                case .value(let value): resolvedBounds = value
                case .timeout: return .timeout
                }
            }
            guard let bounds = resolvedBounds else {
                distances.append(nil)
                continue
            }
            let cx = Double(bounds.midX)
            let cy = Double(bounds.midY)
            let dx = cx - Double(nearPoint.x)
            let dy = cy - Double(nearPoint.y)
            distances.append(dx * dx + dy * dy)
        }
        nearDistances = distances
    }
    switch selectTargetCandidate(count: matches.count, index: query.index, nearDistances: nearDistances) {
    case .selected(let index):
        return .found(matches[index].element)
    case .notFound:
        let idx = query.index ?? -1
        return .notFound("\(describeQuery(query)) — index \(idx) out of range (found \(matches.count) action-compatible match\(matches.count == 1 ? "" : "es"))")
    case .ambiguous:
        return ambiguousResult(matches, deadline: deadline)
    }
}

// MARK: - Subtree Root Finding

/// BFS for the subtree root element matching the given spec. Uses `.exact` matching
/// since subtree specs are identifiers, not user search strings.
private func findSubtreeRoot(app: AXUIElement, spec: SubtreeSpec, deadline: Date, maxDepth: Int) -> FindResult {
    var queue: [(AXUIElement, Int)] = [(app, 0)]
    var head = 0

    var matches: [(element: AXUIElement, bounds: CGRect?)] = []
    while head < queue.count {
        if Date() > deadline { return .timeout }

        let (current, depth) = queue[head]
        head += 1

        let matchesCurrent: Bool
        switch subtreeMatches(current, spec: spec, deadline: deadline) {
        case .value(let value): matchesCurrent = value
        case .timeout: return .timeout
        }
        if matchesCurrent {
            let bounds: CGRect?
            switch axBoundsBeforeDeadline(current, deadline: deadline) {
            case .value(let value): bounds = value
            case .timeout: return .timeout
            }
            matches.append((current, bounds))
            if matches.count > maxResolvedCandidates {
                return ambiguousResult(matches, deadline: deadline, countIsLowerBound: true)
            }
        }

        if depth < maxDepth {
            let children: [AXUIElement]
            switch axChildrenBeforeDeadline(current, deadline: deadline) {
            case .value(let value): children = value
            case .timeout: return .timeout
            }
            for child in children {
                queue.append((child, depth + 1))
            }
        }
    }

    if matches.count == 1 { return .found(matches[0].element) }
    if matches.count > 1 { return ambiguousResult(matches, deadline: deadline) }
    var parts: [String] = []
    if let r = spec.role { parts.append("role=\(r)") }
    if let t = spec.title { parts.append("title=\"\(t)\"") }
    if let i = spec.identifier { parts.append("identifier=\"\(i)\"") }
    return .notFound("Subtree root not found: \(parts.joined(separator: ", "))")
}

/// Check if an element matches a SubtreeSpec (exact matching only).
private func subtreeMatches(
    _ element: AXUIElement,
    spec: SubtreeSpec,
    deadline: Date
) -> AXDeadlineCall<Bool> {
    if let role = spec.role {
        switch axStringBeforeDeadline(element, kAXRoleAttribute as CFString, deadline: deadline) {
        case .value(let value): guard value == role else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let title = spec.title {
        switch axStringBeforeDeadline(element, kAXTitleAttribute as CFString, deadline: deadline) {
        case .value(let value): guard value == title else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let identifier = spec.identifier {
        switch axStringBeforeDeadline(element, kAXIdentifierAttribute as CFString, deadline: deadline) {
        case .value(let value): guard value == identifier else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    return .value(true)
}

// MARK: - Element Matching

/// Test whether a single AX element matches ALL criteria in the query (AND logic).
private func elementMatches(
    _ element: AXUIElement,
    query: ElementQuery,
    deadline: Date
) -> AXDeadlineCall<Bool> {
    let mode = query.matchMode

    if let windowID = query.windowID {
        switch axWindowIDBeforeDeadline(element, deadline: deadline) {
        case .value(let value): guard value == windowID else { return .value(false) }
        case .timeout: return .timeout
        }
    }

    if let role = query.role {
        switch axStringBeforeDeadline(element, kAXRoleAttribute as CFString, deadline: deadline) {
        case .value(let actual):
            guard let actual, stringMatches(actual, pattern: role, mode: mode) else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let title = query.title {
        switch axStringBeforeDeadline(element, kAXTitleAttribute as CFString, deadline: deadline) {
        case .value(let actual):
            guard let actual, stringMatches(actual, pattern: title, mode: mode) else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let label = query.label {
        switch axStringBeforeDeadline(element, kAXDescriptionAttribute as CFString, deadline: deadline) {
        case .value(let actual):
            guard let actual, stringMatches(actual, pattern: label, mode: mode) else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let identifier = query.identifier {
        switch axStringBeforeDeadline(element, kAXIdentifierAttribute as CFString, deadline: deadline) {
        case .value(let actual):
            guard let actual, stringMatches(actual, pattern: identifier, mode: mode) else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    if let value = query.value {
        switch axStringBeforeDeadline(element, kAXValueAttribute as CFString, deadline: deadline) {
        case .value(let actual):
            guard let actual, stringMatches(actual, pattern: value, mode: mode) else { return .value(false) }
        case .timeout: return .timeout
        }
    }
    return .value(true)
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
    if let windowID = query.windowID { parts.append("window=\(windowID)") }
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
