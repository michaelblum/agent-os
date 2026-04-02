import Cocoa

// MARK: - Window Enumeration (shared between list command and daemon)

/// Result of enumerating all on-screen windows and building the spatial model.
struct WindowEnumerationResult {
    let displays: [STDisplay]
    let apps: [STApp]
    let focusedWindowID: Int?
    let focusedApp: STFocusedApp?
}

/// Internal representation of a window before assignment to a display.
private struct RawWindow {
    let windowID: Int
    let title: String?
    let pid: pid_t
    let appName: String
    let bundleID: String?
    let bounds: CGRect
    let layer: Int
    let alpha: Double
    let isOnScreen: Bool
}

/// Enumerates all on-screen windows and builds STDisplay/STApp/focused info.
///
/// This is the core spatial model builder, extracted so it can be called from
/// both `listCommand()` and the daemon's spatial polling loop.
///
/// - Parameter displays: The display entries from `getDisplays()`.
/// - Returns: A `WindowEnumerationResult` containing displays (with windows assigned),
///            apps, focused window ID, and focused app info.
@available(macOS 14.0, *)
func enumerateWindows(displays: [DisplayEntry]) -> WindowEnumerationResult {

    // -- NSScreen map for display enrichment (UUID, label, visible_bounds) --
    var screenMap: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
            screenMap[n] = screen
        }
    }

    // -- Running apps lookup: pid → (name, bundleId, isHidden) --
    var appLookup: [pid_t: (name: String, bundleId: String?, isHidden: Bool)] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
        appLookup[app.processIdentifier] = (
            name: app.localizedName ?? "Unknown",
            bundleId: app.bundleIdentifier,
            isHidden: app.isHidden
        )
    }

    // -- Focused app + window --
    let frontApp = NSWorkspace.shared.frontmostApplication
    let focusedWinID = getFocusedWindowID()

    let focusedApp: STFocusedApp? = frontApp.map {
        STFocusedApp(pid: Int($0.processIdentifier), name: $0.localizedName ?? "Unknown", bundle_id: $0.bundleIdentifier)
    }

    // -- Window enumeration + filtering --
    let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

    var rawWindows: [RawWindow] = []
    for info in windowInfoList {
        // Filter: must be on screen
        guard let isOnScreen = info[kCGWindowIsOnscreen as String] as? Bool, isOnScreen else { continue }
        // Filter: must have bounds
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
        // Filter: skip zero-size
        guard rect.width > 0 && rect.height > 0 else { continue }
        // Filter: skip Window Server
        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
        guard ownerName != "Window Server" else { continue }

        let windowID = info[kCGWindowNumber as String] as? Int ?? 0
        let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0
        let title = info[kCGWindowName as String] as? String
        let layer = info[kCGWindowLayer as String] as? Int ?? 0
        let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
        let bundleID = appLookup[pid]?.bundleId

        rawWindows.append(RawWindow(
            windowID: windowID, title: title, pid: pid, appName: ownerName,
            bundleID: bundleID, bounds: rect, layer: layer, alpha: alpha, isOnScreen: isOnScreen
        ))
    }

    // -- Assign windows to displays by center hit-test --
    // Key: display cgID → [STWindow] (preserving CGWindowList front-to-back order)
    var windowsByDisplay: [CGDirectDisplayID: [STWindow]] = [:]
    for d in displays { windowsByDisplay[d.cgID] = [] }

    for raw in rawWindows {
        let center = CGPoint(x: raw.bounds.midX, y: raw.bounds.midY)
        let targetDisplay = displays.first(where: { $0.bounds.contains(center) }) ?? displays.first(where: { $0.isMain })!

        let stWindow = STWindow(
            window_id: raw.windowID,
            title: raw.title,
            app_pid: Int(raw.pid),
            app_name: raw.appName,
            bundle_id: raw.bundleID,
            bounds: STBounds(x: raw.bounds.origin.x, y: raw.bounds.origin.y,
                             width: raw.bounds.width, height: raw.bounds.height),
            is_focused: focusedWinID != nil && raw.windowID == Int(focusedWinID!),
            is_on_screen: raw.isOnScreen,
            layer: raw.layer,
            alpha: raw.alpha
        )
        windowsByDisplay[targetDisplay.cgID, default: []].append(stWindow)
    }

    // -- Build STDisplay array --
    let stDisplays: [STDisplay] = displays.map { d in
        // Display UUID (CGDisplayCreateUUIDFromDisplayID returns Unmanaged<CFUUID>?)
        let uuid: String? = {
            guard let unmanaged = CGDisplayCreateUUIDFromDisplayID(d.cgID) else { return nil }
            let cfUUID = unmanaged.takeRetainedValue()
            return CFUUIDCreateString(nil, cfUUID) as String
        }()

        // Label from NSScreen
        let label: String = screenMap[d.cgID]?.localizedName ?? "Display \(d.ordinal)"

        // Visible bounds (flip AppKit bottom-left → CG top-left)
        let visibleBounds: STBounds = {
            guard let screen = screenMap[d.cgID] else {
                return STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                                width: d.bounds.width, height: d.bounds.height)
            }
            let sf = screen.frame
            let vf = screen.visibleFrame
            let localX = vf.origin.x - sf.origin.x
            let localY = sf.height - (vf.origin.y - sf.origin.y) - vf.height
            return STBounds(
                x: d.bounds.origin.x + localX,
                y: d.bounds.origin.y + localY,
                width: vf.width,
                height: vf.height
            )
        }()

        return STDisplay(
            display_id: Int(d.cgID),
            display_uuid: uuid,
            ordinal: d.ordinal,
            label: label,
            is_main: d.isMain,
            bounds: STBounds(x: d.bounds.origin.x, y: d.bounds.origin.y,
                             width: d.bounds.width, height: d.bounds.height),
            visible_bounds: visibleBounds,
            scale_factor: d.scaleFactor,
            rotation: d.rotation,
            windows: windowsByDisplay[d.cgID] ?? []
        )
    }

    // -- Build apps[] index --
    var appWindows: [pid_t: [Int]] = [:]  // pid → [windowIDs]
    var appNames: [pid_t: (name: String, bundleId: String?)] = [:]
    for raw in rawWindows {
        appWindows[raw.pid, default: []].append(raw.windowID)
        if appNames[raw.pid] == nil {
            appNames[raw.pid] = (name: raw.appName, bundleId: raw.bundleID)
        }
    }

    let activePID = frontApp?.processIdentifier ?? -1
    let stApps: [STApp] = appWindows.keys.sorted(by: {
        (appNames[$0]?.name ?? "") < (appNames[$1]?.name ?? "")
    }).map { pid in
        STApp(
            pid: Int(pid),
            name: appNames[pid]?.name ?? "Unknown",
            bundle_id: appNames[pid]?.bundleId,
            is_active: pid == activePID,
            is_hidden: appLookup[pid]?.isHidden ?? false,
            window_ids: appWindows[pid] ?? []
        )
    }

    return WindowEnumerationResult(
        displays: stDisplays,
        apps: stApps,
        focusedWindowID: focusedWinID.map { Int($0) },
        focusedApp: focusedApp
    )
}
