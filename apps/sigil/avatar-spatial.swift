// avatar-spatial.swift -- Cursor and element position resolution.
//
// Provides helpers for getting the current mouse position (in CG coordinates)
// and resolving accessibility element positions via xray_target.py.

import Foundation
#if canImport(AppKit)
import AppKit
#endif

// -- Current cursor position in CoreGraphics coordinates (top-left origin) --
func getCursorCG() -> (Double, Double) {
    let loc = NSEvent.mouseLocation
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return (loc.x, primaryHeight - loc.y)
}

// -- Resolve an accessibility element's bounds via xray_target.py --
// Returns (x, y, w, h) in global CG coordinates, or nil if not found.
func resolveElement(role: String?, title: String?, pid: Int? = nil) -> (x: Double, y: Double, w: Double, h: Double)? {
    let scriptPath = sigilRepoPath("tools/dogfood/xray_target.py")
    var args = ["python3", scriptPath, "--no-image"]
    if let role = role { args += ["--role", role] }
    if let title = title { args += ["--title", title] }
    if let pid = pid { args += ["--pid", String(pid)] }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    proc.arguments = args
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = FileHandle.nullDevice
    do { try proc.run() } catch { return nil }
    proc.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let target = json["target"] as? [String: Any],
          let bounds = target["global_bounds"] as? [String: Double] else { return nil }
    return (bounds["x"] ?? 0, bounds["y"] ?? 0, bounds["w"] ?? 0, bounds["h"] ?? 0)
}

// -- All display frames in CG coordinates (top-left origin, Y-down) --
func getAllDisplaysCG() -> [(id: Int, x: Double, y: Double, w: Double, h: Double)] {
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    return NSScreen.screens.enumerated().map { (i, screen) in
        let f = screen.frame
        return (
            id: i,
            x: f.origin.x,
            y: primaryHeight - f.origin.y - f.height,
            w: f.width,
            h: f.height
        )
    }
}

// -- Which display contains a CG point? Returns display index or 0 (primary) --
func displayIndexForPoint(_ x: Double, _ y: Double) -> Int {
    let displays = getAllDisplaysCG()
    for d in displays {
        if x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h {
            return d.id
        }
    }
    return 0
}
