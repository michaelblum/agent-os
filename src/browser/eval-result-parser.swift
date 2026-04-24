// eval-result-parser.swift — Parse real playwright-cli stdout envelopes.
//
// @playwright/cli wraps eval / action output in markdown sections:
//
//   ### Result
//   <value>
//
//   ### Error
//   <message>
//
// Real CLI exits 0 even on `### Error` in some paths (e.g. blocked URLs).
// The orchestrator layer in browser-adapter.swift must treat `### Error` as
// a subprocess failure regardless of exit code.
//
// The value under `### Result` is whatever the page function returned, already
// serialized by playwright-cli. Callers decode it as JSON.

import Foundation

enum EvalResultError: Error {
    case errorMarker(String)    // playwright-cli emitted `### Error\n<msg>`
    case noResultSection        // malformed/absent `### Result`
}

/// Extract a playwright-cli `### Result\n<value>` body as UTF-8 bytes.
/// Throws errorMarker when `### Error` is present. Ignores surrounding
/// whitespace.
func parsePlaywrightResultBody(_ stdout: String) throws -> Data {
    if let errMsg = detectPlaywrightErrorMarker(stdout) {
        throw EvalResultError.errorMarker(errMsg)
    }
    let trimmed = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let range = trimmed.range(of: "### Result") else {
        // Some verbs (click, hover, fill) print bare "fake ..." or action
        // echoes with no envelope. Treat the whole body as the value.
        if let data = trimmed.data(using: .utf8) { return data }
        throw EvalResultError.noResultSection
    }
    let afterHeader = trimmed[range.upperBound...]
        .trimmingCharacters(in: .whitespacesAndNewlines)
    // Stop before the next `### <section>` marker if there is one.
    let body: String
    if let next = afterHeader.range(of: "\n### ") {
        body = String(afterHeader[..<next.lowerBound])
    } else {
        body = afterHeader
    }
    guard let data = body.data(using: .utf8) else {
        throw EvalResultError.noResultSection
    }
    return data
}

/// If stdout contains an `### Error` marker, return the error message line(s).
/// Returns nil when no error marker is present.
func detectPlaywrightErrorMarker(_ stdout: String) -> String? {
    guard let range = stdout.range(of: "### Error") else { return nil }
    let after = stdout[range.upperBound...]
        .trimmingCharacters(in: .whitespacesAndNewlines)
    // Stop before a subsequent `### <section>` marker.
    let body: String
    if let next = after.range(of: "\n### ") {
        body = String(after[..<next.lowerBound])
    } else {
        body = after
    }
    return body.trimmingCharacters(in: .whitespacesAndNewlines)
}
