// cursor.swift — One-shot cursor query: what's under the cursor right now

import AppKit
import ApplicationServices
import Foundation

/// aos see cursor — query display, window, and AX element at cursor position.
func cursorCommand() {
    let cursorPt = mouseInCGCoords()

    // -- Which display? --
    let displays = getDisplays()
    let display = displays.first(where: { $0.bounds.contains(cursorPt) }) ?? displays.first(where: { $0.isMain })!

    // -- Window list (on-screen, front-to-back) --
    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

    // -- App lookup for bundle IDs --
    var appLookup: [pid_t: String?] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = app.bundleIdentifier
    }

    // -- Hit-test: find frontmost window containing cursor --
    var matchedWindow: CursorWindow? = nil
    var matchedPID: pid_t? = nil
    for info in windowInfoList {
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        guard rect.contains(cursorPt) else { continue }
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        guard layer == 0 else { continue }
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        guard alpha > 0 else { continue }
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String

        matchedWindow = CursorWindow(
            window_id: windowID,
            title: title,
            app_name: ownerName,
            app_pid: Int(pid),
            bundle_id: appLookup[pid] ?? nil,
            bounds: Bounds(from: rect)
        )
        matchedPID = pid
        break
    }

    // -- AX element at cursor point --
    var matchedElement: CursorElement? = nil
    if let pid = matchedPID, AXIsProcessTrusted() {
        if let hit = axElementAtPoint(pid: pid, point: cursorPt) {
            matchedElement = CursorElement(
                role: hit.role,
                title: hit.title,
                label: hit.label,
                value: hit.value,
                enabled: hit.enabled,
                bounds: hit.bounds.map { Bounds(from: $0) },
                context_path: hit.contextPath
            )
        }
    }

    let response = CursorResponse(
        cursor: CursorPoint(x: cursorPt.x, y: cursorPt.y),
        display: display.ordinal,
        window: matchedWindow,
        element: matchedElement
    )
    print(jsonString(response))
}
