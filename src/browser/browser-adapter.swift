// browser-adapter.swift — Top-level entry point for browser-target calls.

import Foundation

enum BrowserAdapterError: Error {
    case versionCheckFailed(String, code: String)
    case subprocess(String, code: String)
    case invalidTarget(String)    // forward-declared for Tasks 8-12 verb dispatchers
    case notLocalBrowser(String)  // used by anchor-resolver
}

/// Screenshot the whole active tab (no ref) or a single element.
/// Returns the PNG file path on success.
func seeCaptureScreenshot(target: BrowserTarget, outPath: String) throws -> String {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append("--filename=\(outPath)")
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "screenshot", args: args, withTempFilename: false
    ))
    try requireSuccess(r, action: "screenshot")
    return outPath
}

/// Run snapshot, parse markdown, return AXElementJSON[].
/// If `withBounds` is true, follows up with one eval per ref.
func seeCaptureXray(target: BrowserTarget, withBounds: Bool) throws -> [AXElementJSON] {
    try ensureVersion()
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "snapshot", args: [], withTempFilename: true
    ))
    try requireSuccess(r, action: "snapshot")
    guard let path = r.filename else {
        throw BrowserAdapterError.subprocess("snapshot produced no filename", code: "PLAYWRIGHT_CLI_FAILED")
    }
    defer { try? FileManager.default.removeItem(atPath: path) }
    let contents = try readSnapshotMarkdown(atPath: path)
    var elements = parseSnapshotMarkdown(contents)
    if withBounds {
        elements = try elements.map { el in
            guard let ref = el.ref else { return el }
            guard let b = try boundsViaEval(session: target.session, ref: ref) else { return el }
            return AXElementJSON(
                role: el.role, title: el.title, label: el.label, value: el.value,
                enabled: el.enabled, context_path: el.context_path,
                bounds: b, ref: el.ref
            )
        }
    }
    return elements
}

func readSnapshotMarkdown(atPath path: String) throws -> String {
    do {
        return try String(contentsOfFile: path, encoding: .utf8)
    } catch {
        throw BrowserAdapterError.subprocess(
            "cannot read snapshot markdown \(path): \(error)",
            code: "SNAPSHOT_READ_FAILED"
        )
    }
}

/// Dispatch `do` verbs on browser targets. Returns the raw PlaywrightResult;
/// per-verb callers in Tasks 8-12 decide whether a non-zero exit is an error
/// and shape the user-facing message (`see*` helpers above wrap non-zero into
/// BrowserAdapterError.subprocess because they must resolve to a value).
func doVerb(_ verb: String, target: BrowserTarget, extraArgs: [String] = []) throws -> PlaywrightResult {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append(contentsOf: extraArgs)
    return try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: verb, args: args, withTempFilename: false
    ))
}

/// Fetch getBoundingClientRect() for a specific ref. Returns nil on zero-size
/// rect or any probe failure. The JS returns an object directly (not
/// JSON.stringify'd) so playwright-cli's `### Result` envelope contains bare
/// JSON we decode with parsePlaywrightResultBody.
func boundsViaEval(session: String, ref: String) throws -> BoundsJSON? {
    let js = "(e) => { const r = e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; }"
    let r = try runPlaywright(PlaywrightInvocation(
        session: session, verb: "eval", args: [js, ref], withTempFilename: false
    ))
    if r.exit_code != 0 { return nil }
    // Treat a "### Error" marker as probe failure (eval against a detached ref,
    // CSP violations, etc.) — return nil rather than throwing, so the caller's
    // best-effort per-ref loop can skip missing bounds.
    if detectPlaywrightErrorMarker(r.stdout) != nil { return nil }
    guard let data = try? parsePlaywrightResultBody(r.stdout) else { return nil }
    struct Rect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
    guard let rect = try? JSONDecoder().decode(Rect.self, from: data) else { return nil }
    if rect.w == 0 && rect.h == 0 { return nil }
    return BoundsJSON(x: Int(rect.x), y: Int(rect.y), width: Int(rect.w), height: Int(rect.h))
}

/// Throw BrowserAdapterError.subprocess when a PlaywrightResult indicates
/// failure via either non-zero exit code or a `### Error` marker in stdout
/// (which real playwright-cli sometimes emits at exit 0). Use at every
/// orchestrator entry point that needs success-or-fail semantics.
func requireSuccess(_ r: PlaywrightResult, action: String) throws {
    if r.exit_code != 0 {
        let msg = r.stderr.isEmpty ? r.stdout : r.stderr
        throw BrowserAdapterError.subprocess(
            "\(action) failed (exit \(r.exit_code)): \(msg)",
            code: "PLAYWRIGHT_CLI_FAILED"
        )
    }
    if let err = detectPlaywrightErrorMarker(r.stdout) {
        throw BrowserAdapterError.subprocess(
            "\(action) failed: \(err)",
            code: "PLAYWRIGHT_CLI_FAILED"
        )
    }
}

// One probe per CLI invocation. Each ./aos call is a fresh process, so the
// memoization never carries stale state across invocations.
private var versionChecked = false
func ensureVersion() throws {
    if versionChecked { return }
    do {
        _ = try probePlaywrightVersion()
        versionChecked = true
    } catch PlaywrightVersionError.notFound {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli not found. Install: npm install -g @playwright/cli@\(kMinPlaywrightCLIVersion)",
            code: "PLAYWRIGHT_CLI_NOT_FOUND")
    } catch PlaywrightVersionError.tooOld(let found, let min) {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli \(found) below minimum \(min). Upgrade: npm install -g @playwright/cli@latest",
            code: "PLAYWRIGHT_CLI_TOO_OLD")
    } catch {
        throw BrowserAdapterError.versionCheckFailed("version probe error: \(error)", code: "PLAYWRIGHT_CLI_PROBE_FAILED")
    }
}
