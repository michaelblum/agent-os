// window-resolver.swift — Resolve a playwright-cli session to its CGWindowID.
//
// `focus create --target browser://...` stores a `browser_window_id` on the
// session registry record so `show create --anchor-browser` can attach an
// overlay to the right macOS window. Without a concrete window id, the
// anchor-resolver rejects the session as BROWSER_NOT_LOCAL.
//
// Strategy: ask the page for its window geometry via playwright-cli eval
// (window.screenX/Y/outerWidth/outerHeight), then find the matching window
// in CGWindowListCopyWindowInfo, filtered to the Chromium family.
//
// Test hook: set AOS_TEST_BROWSER_WINDOW_ID=<int> to inject a deterministic
// id without a real Chrome window. Production never sets this; the real
// code path is exercised by the opt-in smoke test.

import Cocoa
import CoreGraphics
import Foundation

// Keep this union tight. Drivers we don't recognize stay nil rather than
// producing a wrong match.
private let kChromiumOwnerNames: Set<String> = [
    "Google Chrome",
    "Google Chrome Beta",
    "Google Chrome Dev",
    "Google Chrome Canary",
    "Chromium",
    "Microsoft Edge",
    "Microsoft Edge Beta",
    "Microsoft Edge Dev",
    "Microsoft Edge Canary",
    "Brave Browser",
    "Brave Browser Beta",
    "Brave Browser Nightly",
    "Arc",
    "Vivaldi"
]

// Tolerance when matching window.screenX/Y/outerWidth/outerHeight against
// CGWindowBounds. Chrome and macOS both report in logical points on
// Retina, so a small pixel drift (rounding, title-bar artifacts) is all
// we need to absorb.
private let kBrowserWindowMatchToleranceLCS: Double = 4

func resolveBrowserWindowID(session: String) -> Int? {
    if let injected = injectedTestWindowID() {
        return injected
    }
    guard let geometry = queryBrowserWindowGeometry(session: session) else {
        return nil
    }
    return matchCGWindowID(geometry)
}

private func injectedTestWindowID() -> Int? {
    let env = ProcessInfo.processInfo.environment
    guard let raw = env["AOS_TEST_BROWSER_WINDOW_ID"],
          let parsed = Int(raw) else { return nil }
    return parsed
}

private struct BrowserWindowGeometry {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

private func queryBrowserWindowGeometry(session: String) -> BrowserWindowGeometry? {
    let js = "(() => ({x:window.screenX, y:window.screenY, w:window.outerWidth, h:window.outerHeight}))"
    guard let r = try? runPlaywright(PlaywrightInvocation(
        session: session, verb: "eval", args: [js], withTempFilename: false
    )) else { return nil }
    if r.exit_code != 0 { return nil }
    if detectPlaywrightErrorMarker(r.stdout) != nil { return nil }
    guard let body = try? parsePlaywrightResultBody(r.stdout) else { return nil }
    struct Geom: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
    guard let g = try? JSONDecoder().decode(Geom.self, from: body),
          g.w > 0, g.h > 0 else { return nil }
    return BrowserWindowGeometry(x: g.x, y: g.y, w: g.w, h: g.h)
}

private func matchCGWindowID(_ geom: BrowserWindowGeometry) -> Int? {
    guard let list = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
    ) as? [[String: Any]] else {
        return nil
    }
    for info in list {
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard kChromiumOwnerNames.contains(ownerName) else { continue }
        guard let bounds = info[kCGWindowBounds as String] as? [String: Any],
              let x = bounds["X"] as? Double,
              let y = bounds["Y"] as? Double,
              let w = bounds["Width"] as? Double,
              let h = bounds["Height"] as? Double else { continue }
        let tol = kBrowserWindowMatchToleranceLCS
        if abs(x - geom.x) <= tol,
           abs(y - geom.y) <= tol,
           abs(w - geom.w) <= tol,
           abs(h - geom.h) <= tol,
           let wid = info[kCGWindowNumber as String] as? Int {
            return wid
        }
    }
    return nil
}
