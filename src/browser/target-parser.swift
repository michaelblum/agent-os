// target-parser.swift — Parse browser:<session>[/<ref>] target strings.
//
// Grammar:
//     browser:                     -> session resolved from PLAYWRIGHT_CLI_SESSION env
//     browser:<session>            -> page target
//     browser:<session>/<ref>      -> element target
//
// Session names match /[A-Za-z0-9_-]+/. Refs match /[A-Za-z0-9]+/ (playwright
// refs like "e21"). No tab or frame segments in v1.

import Foundation

struct BrowserTarget: Encodable, Equatable {
    let session: String
    let ref: String?

    // Explicit encode(to:) so the `ref` key is always emitted (as null when
    // nil). Default Encodable synthesis uses encodeIfPresent for Optionals,
    // which omits the key — downstream consumers prefer a stable shape.
    enum CodingKeys: String, CodingKey {
        case session
        case ref
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(session, forKey: .session)
        try container.encode(ref, forKey: .ref)
    }
}

enum BrowserTargetError: Error {
    case invalid(String)
    case missingSession
}

func parseBrowserTarget(_ input: String, env: [String: String] = ProcessInfo.processInfo.environment) throws -> BrowserTarget {
    guard input.hasPrefix("browser:") else {
        throw BrowserTargetError.invalid("target must start with 'browser:'")
    }
    let remainder = String(input.dropFirst("browser:".count))

    // Bare "browser:" — resolve from env
    if remainder.isEmpty {
        guard let session = env["PLAYWRIGHT_CLI_SESSION"], !session.isEmpty else {
            throw BrowserTargetError.missingSession
        }
        try validateSession(session)
        return BrowserTarget(session: session, ref: nil)
    }

    // Reject "browser://..." (common typo pattern)
    if remainder.hasPrefix("/") {
        throw BrowserTargetError.invalid("unexpected '/' after 'browser:'")
    }

    let parts = remainder.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    switch parts.count {
    case 1:
        let session = parts[0]
        try validateSession(session)
        return BrowserTarget(session: session, ref: nil)
    case 2:
        let session = parts[0], ref = parts[1]
        try validateSession(session)
        try validateRef(ref)
        return BrowserTarget(session: session, ref: ref)
    default:
        throw BrowserTargetError.invalid("too many '/' segments; v1 supports only browser:<session>[/<ref>]")
    }
}

private let sessionAllowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
private let refAllowed = CharacterSet.alphanumerics

private func validateSession(_ s: String) throws {
    guard !s.isEmpty else { throw BrowserTargetError.invalid("empty session name") }
    guard s.rangeOfCharacter(from: sessionAllowed.inverted) == nil else {
        throw BrowserTargetError.invalid("session name must match [A-Za-z0-9_-]+")
    }
}

private func validateRef(_ r: String) throws {
    guard !r.isEmpty else { throw BrowserTargetError.invalid("empty ref") }
    guard r.rangeOfCharacter(from: refAllowed.inverted) == nil else {
        throw BrowserTargetError.invalid("ref must match [A-Za-z0-9]+")
    }
}
