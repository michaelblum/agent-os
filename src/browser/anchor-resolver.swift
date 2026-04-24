// anchor-resolver.swift — Static browser:<s>/<ref> → (CGWindowID, offset).
// Used by `aos show create --anchor-browser=<target>` (Task 14).

import Foundation

struct BrowserAnchor: Encodable {
    let anchor_window: Int
    let offset: [Int]   // [x, y, w, h] in LCS
}

enum AnchorResolveError: Error {
    case notFound(String)
    case headless
    case notLocal(String)
    case evalFailed(String)
}

func resolveBrowserAnchor(target: BrowserTarget) throws -> BrowserAnchor {
    guard let record = try findRegistryRecord(id: target.session) else {
        throw AnchorResolveError.notFound(target.session)
    }
    guard let winID = record.browser_window_id else {
        if record.headless == true {
            throw AnchorResolveError.headless
        }
        throw AnchorResolveError.notLocal(
            "browser session has no local window (remote CDP or unmatched)"
        )
    }
    guard let ref = target.ref else {
        // Whole-window anchor — overlay covers the full content area.
        return BrowserAnchor(anchor_window: winID, offset: [0, 0, 0, 0])
    }
    // Fetch viewport rect via one eval subprocess call.
    guard let b = try boundsViaEval(session: target.session, ref: ref) else {
        throw AnchorResolveError.evalFailed(
            "bounds query returned nil or zero-sized rect for ref \(ref)"
        )
    }
    // v1 implementation: viewport coords + winID. Chrome content-view inset
    // calibration is deferred — when Chrome exposes the content area as the
    // tracked CGWindowID, the viewport origin aligns to the window origin.
    return BrowserAnchor(
        anchor_window: winID,
        offset: [b.x, b.y, b.width, b.height]
    )
}
