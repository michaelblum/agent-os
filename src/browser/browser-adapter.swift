// browser-adapter.swift — Top-level entry point for browser-target calls.

import Foundation

enum BrowserAdapterError: Error {
    case versionCheckFailed(String, code: String)
    case subprocess(String, code: String)
    case invalidTarget(String)
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
    guard r.exit_code == 0 else {
        throw BrowserAdapterError.subprocess("screenshot failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
    }
    return outPath
}

/// Run snapshot, parse markdown, return AXElementJSON[].
/// If `withBounds` is true, follows up with one eval per ref.
func seeCaptureXray(target: BrowserTarget, withBounds: Bool) throws -> [AXElementJSON] {
    try ensureVersion()
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "snapshot", args: [], withTempFilename: true
    ))
    guard r.exit_code == 0, let path = r.filename else {
        throw BrowserAdapterError.subprocess("snapshot failed: \(r.stderr)", code: "PLAYWRIGHT_CLI_FAILED")
    }
    defer { try? FileManager.default.removeItem(atPath: path) }
    let contents = try String(contentsOfFile: path, encoding: .utf8)
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

/// Dispatch `do` verbs on browser targets.
func doVerb(_ verb: String, target: BrowserTarget, extraArgs: [String] = []) throws -> PlaywrightResult {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append(contentsOf: extraArgs)
    return try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: verb, args: args, withTempFilename: false
    ))
}

/// Fetch getBoundingClientRect() for a specific ref. Returns nil on zero-size rect.
func boundsViaEval(session: String, ref: String) throws -> BoundsJSON? {
    let js = "(e) => { const r = e.getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height}); }"
    let r = try runPlaywright(PlaywrightInvocation(
        session: session, verb: "eval", args: [js, ref], withTempFilename: false
    ))
    guard r.exit_code == 0 else { return nil }
    // stdout is a JSON string; parse
    struct Rect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
    guard let data = r.stdout.data(using: .utf8),
          let rect = try? JSONDecoder().decode(Rect.self, from: data) else { return nil }
    if rect.w == 0 && rect.h == 0 { return nil }
    return BoundsJSON(x: Int(rect.x), y: Int(rect.y), width: Int(rect.w), height: Int(rect.h))
}

private var versionChecked = false
private func ensureVersion() throws {
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
