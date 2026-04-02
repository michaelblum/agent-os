// spatial.swift — Spatial model polling + channel management
//
// Maintains a polled spatial model (displays, windows, focused app) and
// manages channel lifecycle: create, update, remove, refresh.
// Channels are written as JSON files to ~/.config/agent-os/channels/.

import ApplicationServices
import Cocoa
import CoreGraphics
import Foundation

// MARK: - Spatial Model

class SpatialModel {
    /// Active channels keyed by ID — access only under channelsLock
    private var channels: [String: ChannelState] = [:]
    private let channelsLock = NSLock()

    /// Callback when a channel is updated (daemon relays to subscribers)
    var onChannelUpdated: ((String) -> Void)?
    var onWindowMoved: ((Int, ChannelBounds) -> Void)?
    var onFocusChanged: ((Int, String) -> Void)?

    /// Polling timer
    private var pollTimer: DispatchSourceTimer?
    private var lastFocusedPID: pid_t = 0

    var isEmpty: Bool {
        channelsLock.lock()
        defer { channelsLock.unlock() }
        return channels.isEmpty
    }
    var channelCount: Int {
        channelsLock.lock()
        defer { channelsLock.unlock() }
        return channels.count
    }

    // MARK: - Polling

    func startPolling(intervalMs: Int = 1000) {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: .milliseconds(intervalMs))
        timer.setEventHandler { [weak self] in
            self?.poll()
        }
        timer.resume()
        pollTimer = timer
    }

    func stopPolling() {
        pollTimer?.cancel()
        pollTimer = nil
    }

    private func poll() {
        // Take a snapshot of channels under lock, then operate outside lock
        channelsLock.lock()
        let snapshot = channels
        channelsLock.unlock()

        // Check each channel's window bounds for movement
        for (id, state) in snapshot {
            guard let newBounds = windowBoundsForID(state.windowID) else { continue }
            let old = state.lastBounds
            if abs(newBounds.x - old.x) > 0.5 || abs(newBounds.y - old.y) > 0.5 ||
               abs(newBounds.w - old.w) > 0.5 || abs(newBounds.h - old.h) > 0.5 {
                channelsLock.lock()
                channels[id]?.lastBounds = newBounds
                channelsLock.unlock()
                refreshChannel(id: id)
                onWindowMoved?(state.windowID, newBounds)
            }
        }

        // Check focused app change
        if let frontmost = NSWorkspace.shared.frontmostApplication {
            let pid = frontmost.processIdentifier
            if pid != lastFocusedPID {
                lastFocusedPID = pid
                onFocusChanged?(Int(pid), frontmost.localizedName ?? "Unknown")
            }
        }
    }

    // MARK: - Channel CRUD

    func createChannel(id: String, windowID: Int, pid: Int?, subtree: ChannelSubtree?, depth: Int?) -> DaemonResponse {
        // Look up window info
        guard let winInfo = windowInfoForID(windowID) else {
            return .fail("Window \(windowID) not found", code: "WINDOW_NOT_FOUND")
        }

        let resolvedPID = pid ?? winInfo.pid
        let resolvedDepth = depth ?? 3

        let state = ChannelState(
            id: id,
            windowID: windowID,
            pid: resolvedPID,
            app: winInfo.appName,
            bundleID: winInfo.bundleID,
            display: winInfo.display,
            scaleFactor: winInfo.scaleFactor,
            subtree: subtree,
            depth: resolvedDepth,
            lastBounds: winInfo.bounds,
            createdAt: iso8601Now()
        )

        channelsLock.lock()
        channels[id] = state
        channelsLock.unlock()
        refreshChannel(id: id)
        return .ok
    }

    func updateChannel(id: String, subtree: ChannelSubtree?, depth: Int?) -> DaemonResponse {
        channelsLock.lock()
        guard channels[id] != nil else {
            channelsLock.unlock()
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }
        if let s = subtree { channels[id]!.subtree = s }
        if let d = depth { channels[id]!.depth = d }
        channelsLock.unlock()
        refreshChannel(id: id)
        return .ok
    }

    func removeChannel(id: String) -> DaemonResponse {
        channelsLock.lock()
        guard channels.removeValue(forKey: id) != nil else {
            channelsLock.unlock()
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }
        channelsLock.unlock()
        // Delete channel file
        let path = "\(kChannelDirectory)/\(id).json"
        try? FileManager.default.removeItem(atPath: path)
        return .ok
    }

    func listChannels() -> DaemonResponse {
        channelsLock.lock()
        let summaries = channels.values.map { state in
            ChannelSummary(
                id: state.id,
                window_id: state.windowID,
                app: state.app,
                elements_count: state.lastElementCount,
                updated_at: state.lastUpdated
            )
        }.sorted { $0.id < $1.id }
        channelsLock.unlock()

        var resp = DaemonResponse.ok
        resp.channels = summaries
        return resp
    }

    func snapshot() -> DaemonResponse {
        let displays = getDisplays()
        channelsLock.lock()
        let chCount = channels.count
        channelsLock.unlock()

        // Count on-screen windows
        let windowCount: Int
        if let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] {
            windowCount = infoList.count
        } else {
            windowCount = 0
        }

        var resp = DaemonResponse.ok
        resp.snapshot = SnapshotData(
            displays: displays.count,
            windows: windowCount,
            channels: chCount,
            focused_app: NSWorkspace.shared.frontmostApplication?.localizedName
        )
        return resp
    }

    // MARK: - Graph: Display Enumeration

    func enumerateDisplays() -> [DisplayInfo] {
        let displays = getDisplays()
        return displays.map { d in
            DisplayInfo(
                id: Int(d.cgID),
                width: Int(d.bounds.width),
                height: Int(d.bounds.height),
                scale_factor: d.scaleFactor,
                bounds: ChannelBounds(from: d.bounds),
                is_main: d.isMain
            )
        }
    }

    // MARK: - Graph: Window Enumeration

    func enumerateWindows(display: Int?) -> [GraphWindowInfo] {
        let displays = getDisplays()
        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier

        let windowInfoList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

        var results: [GraphWindowInfo] = []

        for info in windowInfoList {
            // Filter: must have bounds
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let x = boundsDict["X"] as? Double,
                  let y = boundsDict["Y"] as? Double,
                  let w = boundsDict["Width"] as? Double,
                  let h = boundsDict["Height"] as? Double else { continue }

            // Filter: skip zero-size
            guard w > 0 && h > 0 else { continue }

            // Filter: layer 0 only (regular windows)
            let layer = info[kCGWindowLayer as String] as? Int ?? -1
            guard layer == 0 else { continue }

            // Filter: skip Window Server
            let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
            guard ownerName != "Window Server" else { continue }

            let windowID = info[kCGWindowNumber as String] as? Int ?? 0
            let pid = info[kCGWindowOwnerPID as String] as? Int ?? 0
            let title = info[kCGWindowName as String] as? String

            // Determine which display this window's center is on
            let centerX = x + w / 2
            let centerY = y + h / 2
            let targetDisplay = displays.first(where: {
                $0.bounds.contains(CGPoint(x: centerX, y: centerY))
            }) ?? displays.first(where: { $0.isMain })!

            // If display filter specified, skip windows not on that display
            if let filterDisplay = display, Int(targetDisplay.cgID) != filterDisplay {
                continue
            }

            let isFrontmost = frontmostPID != nil && pid == Int(frontmostPID!)

            results.append(GraphWindowInfo(
                window_id: windowID,
                pid: pid,
                app: ownerName,
                title: title,
                bounds: ChannelBounds(x: x, y: y, w: w, h: h),
                display: Int(targetDisplay.cgID),
                is_frontmost: isFrontmost
            ))
        }

        return results
    }

    // MARK: - Graph: Deepen Channel

    func deepenChannel(id: String, subtree: ChannelSubtree?, depth: Int?) -> DaemonResponse {
        channelsLock.lock()
        guard var state = channels[id] else {
            channelsLock.unlock()
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }

        if let sub = subtree {
            // Focus deeper into a subtree — update subtree spec and optionally increase depth
            state.subtree = sub
            if let d = depth {
                state.depth = d
            } else {
                // Default: increase depth by 2 when focusing into subtree
                state.depth = state.depth + 2
            }
        } else if let d = depth {
            // Just increase depth (must be >= current)
            guard d >= state.depth else {
                channelsLock.unlock()
                return .fail("Depth \(d) is less than current depth \(state.depth). Use graph-collapse to reduce depth.",
                             code: "INVALID_DEPTH")
            }
            state.depth = d
        } else {
            // No subtree, no depth — default: increase depth by 2
            state.depth = state.depth + 2
        }

        channels[id] = state
        channelsLock.unlock()
        refreshChannel(id: id)

        channelsLock.lock()
        let elCount = channels[id]?.lastElementCount
        channelsLock.unlock()

        var resp = DaemonResponse.ok
        resp.elements_count = elCount
        return resp
    }

    // MARK: - Graph: Collapse Channel

    func collapseChannel(id: String, depth: Int?) -> DaemonResponse {
        channelsLock.lock()
        guard var state = channels[id] else {
            channelsLock.unlock()
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }

        let targetDepth = depth ?? 1

        guard targetDepth < state.depth else {
            channelsLock.unlock()
            return .fail("Target depth \(targetDepth) is not less than current depth \(state.depth). Use graph-deepen to increase depth.",
                         code: "INVALID_DEPTH")
        }

        state.depth = targetDepth

        // Clear subtree focus when collapsing to shallow depth
        if targetDepth <= 1 {
            state.subtree = nil
        }

        channels[id] = state
        channelsLock.unlock()
        refreshChannel(id: id)

        channelsLock.lock()
        let elCount = channels[id]?.lastElementCount
        channelsLock.unlock()

        var resp = DaemonResponse.ok
        resp.elements_count = elCount
        return resp
    }

    // MARK: - Channel Refresh (AX traversal + file write)

    func refreshChannel(id: String) {
        channelsLock.lock()
        guard var state = channels[id] else {
            channelsLock.unlock()
            return
        }
        channelsLock.unlock()

        // Get current window bounds
        guard let bounds = windowBoundsForID(state.windowID) else { return }
        state.lastBounds = bounds

        // Traverse AX tree for channel elements
        let elements = traverseForChannel(
            pid: pid_t(state.pid),
            subtree: state.subtree,
            depth: state.depth,
            windowBounds: bounds,
            scaleFactor: state.scaleFactor
        )

        state.lastElementCount = elements.count
        state.lastUpdated = iso8601Now()

        channelsLock.lock()
        channels[id] = state
        channelsLock.unlock()

        // Build channel file
        let file = ChannelFile(
            channel_id: id,
            created_by: "side-eye",
            created_at: state.createdAt,
            updated_at: state.lastUpdated,
            target: ChannelTarget(
                pid: state.pid,
                app: state.app,
                bundle_id: state.bundleID,
                window_id: state.windowID,
                display: state.display,
                scale_factor: state.scaleFactor
            ),
            focus: ChannelFocus(subtree: state.subtree, depth: state.depth),
            window_bounds: bounds,
            elements: elements
        )

        // Write to disk
        writeChannelFile(file)
        onChannelUpdated?(id)
    }

    // MARK: - AX Traversal for Channel Elements

    private func traverseForChannel(pid: pid_t, subtree: ChannelSubtree?, depth: Int,
                                     windowBounds: ChannelBounds, scaleFactor: Double) -> [ChannelElement] {
        let app = AXUIElementCreateApplication(pid)

        // Find search root (subtree or app root)
        var root = app
        if let sub = subtree {
            if let found = findSubtreeRoot(app: app, subtree: sub) {
                root = found
            }
        }

        var elements: [ChannelElement] = []
        traverseAXForChannel(root, depth: 0, maxDepth: depth,
                              windowBounds: windowBounds, scaleFactor: scaleFactor,
                              results: &elements)
        return elements
    }

    private func findSubtreeRoot(app: AXUIElement, subtree: ChannelSubtree) -> AXUIElement? {
        // BFS to find element matching subtree spec
        var queue: [AXUIElement] = [app]
        while !queue.isEmpty {
            let current = queue.removeFirst()
            let role = chAxString(current, kAXRoleAttribute)
            let title = chAxString(current, kAXTitleAttribute)
            let ident = chAxString(current, "AXIdentifier")

            var match = true
            if let r = subtree.role, r != role { match = false }
            if let t = subtree.title, t != title { match = false }
            if let i = subtree.identifier, i != ident { match = false }

            if match && (subtree.role != nil || subtree.title != nil || subtree.identifier != nil) {
                return current
            }
            queue.append(contentsOf: chAxChildren(current))
        }
        return nil
    }

    private func traverseAXForChannel(_ element: AXUIElement, depth: Int, maxDepth: Int,
                                       windowBounds: ChannelBounds, scaleFactor: Double,
                                       results: inout [ChannelElement]) {
        guard depth <= maxDepth else { return }

        let role = chAxString(element, kAXRoleAttribute) ?? ""

        // Get bounds
        guard let globalBounds = chAxFrame(element) else {
            // No bounds — still recurse children
            for child in chAxChildren(element) {
                traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                      windowBounds: windowBounds, scaleFactor: scaleFactor,
                                      results: &results)
            }
            return
        }

        // Skip zero-size elements
        guard globalBounds.width > 0 && globalBounds.height > 0 else { return }

        // Only emit interactive roles
        if kChannelInteractiveRoles.contains(role) {
            // Compute triple coordinates
            let boundsGlobal = ChannelBounds(from: globalBounds)

            let boundsWindow = ChannelBounds(
                x: Double(globalBounds.origin.x) - windowBounds.x,
                y: Double(globalBounds.origin.y) - windowBounds.y,
                w: Double(globalBounds.width),
                h: Double(globalBounds.height)
            )

            let boundsPixel = ChannelBounds(
                x: boundsWindow.x * scaleFactor,
                y: boundsWindow.y * scaleFactor,
                w: boundsWindow.w * scaleFactor,
                h: boundsWindow.h * scaleFactor
            )

            // Get available actions
            var actionsRef: CFArray?
            let actions: [String]
            if AXUIElementCopyActionNames(element, &actionsRef) == .success,
               let names = actionsRef as? [String] {
                actions = names
            } else {
                actions = []
            }

            let channelEl = ChannelElement(
                role: role,
                title: chAxString(element, kAXTitleAttribute),
                label: chAxString(element, kAXDescriptionAttribute),
                identifier: chAxString(element, "AXIdentifier"),
                value: chAxString(element, kAXValueAttribute),
                enabled: chAxBool(element, kAXEnabledAttribute) ?? true,
                actions: actions,
                bounds_pixel: boundsPixel,
                bounds_window: boundsWindow,
                bounds_global: boundsGlobal
            )
            results.append(channelEl)
        }

        // Recurse children
        for child in chAxChildren(element) {
            traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                  windowBounds: windowBounds, scaleFactor: scaleFactor,
                                  results: &results)
        }
    }

    // MARK: - Window Info Helpers

    private func windowBoundsForID(_ windowID: Int) -> ChannelBounds? {
        guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
              let info = infoList.first,
              let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? Double,
              let y = boundsDict["Y"] as? Double,
              let w = boundsDict["Width"] as? Double,
              let h = boundsDict["Height"] as? Double else { return nil }
        return ChannelBounds(x: x, y: y, w: w, h: h)
    }

    private func windowInfoForID(_ windowID: Int) -> WindowInfo? {
        guard let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowID)) as? [[String: Any]],
              let info = infoList.first else { return nil }

        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? Double,
              let y = boundsDict["Y"] as? Double,
              let w = boundsDict["Width"] as? Double,
              let h = boundsDict["Height"] as? Double else { return nil }

        let pid = info[kCGWindowOwnerPID as String] as? Int ?? 0
        let appName = info[kCGWindowOwnerName as String] as? String ?? "Unknown"

        // Look up bundle ID
        let bundleID: String?
        if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
            bundleID = app.bundleIdentifier
        } else {
            bundleID = nil
        }

        // Determine which display this window is on
        let centerX = x + w / 2
        let centerY = y + h / 2
        let displays = getDisplays()
        var display = 1
        var scaleFactor = 2.0
        for d in displays {
            if d.bounds.contains(CGPoint(x: centerX, y: centerY)) {
                display = d.ordinal
                scaleFactor = d.scaleFactor
                break
            }
        }

        return WindowInfo(
            pid: pid, appName: appName, bundleID: bundleID,
            display: display, scaleFactor: scaleFactor,
            bounds: ChannelBounds(x: x, y: y, w: w, h: h)
        )
    }

    // MARK: - Channel File I/O

    private func writeChannelFile(_ file: ChannelFile) {
        // Ensure directory exists
        try? FileManager.default.createDirectory(atPath: kChannelDirectory,
                                                  withIntermediateDirectories: true)
        let path = "\(kChannelDirectory)/\(file.channel_id).json"
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(file) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

// MARK: - Internal State Types

struct ChannelState {
    let id: String
    let windowID: Int
    let pid: Int
    let app: String
    let bundleID: String?
    let display: Int
    let scaleFactor: Double
    var subtree: ChannelSubtree?
    var depth: Int
    var lastBounds: ChannelBounds
    var lastElementCount: Int = 0
    var lastUpdated: String = ""
    let createdAt: String
}

struct WindowInfo {
    let pid: Int
    let appName: String
    let bundleID: String?
    let display: Int
    let scaleFactor: Double
    let bounds: ChannelBounds
}

// MARK: - AX Helpers (channel-local — main.swift's are private)
//
// These mirror the private axString/axBool/axFrame in main.swift but are
// prefixed with `ch` to avoid collision. They're used only by the spatial
// model's AX traversal.

/// Interactive roles whitelist for channel element emission.
private let kChannelInteractiveRoles: Set<String> = [
    "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
    "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuItem",
    "AXMenuBarItem", "AXLink", "AXSlider", "AXIncrementor",
    "AXColorWell", "AXDisclosureTriangle", "AXTab", "AXStaticText",
    "AXSwitch", "AXToggle", "AXSearchField", "AXSecureTextField",
    "AXScrollArea", "AXTable", "AXOutline", "AXGroup"
]

/// Read a string AX attribute.
func chAxString(_ element: AXUIElement, _ attr: String) -> String? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else { return nil }
    return ref as? String
}

/// Read a boolean AX attribute.
func chAxBool(_ element: AXUIElement, _ attr: String) -> Bool? {
    var ref: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attr as CFString, &ref) == .success else { return nil }
    return ref as? Bool
}

/// Get the global CG bounding rect of an AX element. Returns nil if unavailable.
func chAxFrame(_ element: AXUIElement) -> CGRect? {
    var posRef: AnyObject?
    var sizeRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &posRef) == .success,
          AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success
    else { return nil }

    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posRef as! AXValue, .cgPoint, &point)
    AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

/// Get children of an AX element.
func chAxChildren(_ element: AXUIElement) -> [AXUIElement] {
    var childrenRef: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
          let children = childrenRef as? [AXUIElement] else { return [] }
    return children
}
