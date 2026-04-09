// spatial.swift — Spatial model polling + channel management
//
// Maintains a polled spatial model (displays, windows, focused app) and
// manages channel lifecycle: create, update, remove, refresh.
// Channels are written as JSON files to ~/.config/agent-os/channels/.
//
// Uses shared AX helpers from ax.swift and channel types from
// display/channel.swift.

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
    private var pollTick: Int = 0

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
        pollTick += 1
        let forceRefresh = (pollTick % 3 == 0) // Full AX refresh every 3 ticks (~3s at 1Hz)

        // Take a snapshot of channels under lock, then operate outside lock
        channelsLock.lock()
        let snapshot = channels
        channelsLock.unlock()

        // Check each channel's window bounds for movement
        for (id, state) in snapshot {
            guard let winInfo = windowInfoForID(state.windowID) else { continue }
            let newBounds = winInfo.bounds
            let old = state.lastBounds
            let windowMoved = abs(newBounds.x - old.x) > 0.5 || abs(newBounds.y - old.y) > 0.5 ||
                              abs(newBounds.w - old.w) > 0.5 || abs(newBounds.h - old.h) > 0.5

            if windowMoved {
                channelsLock.lock()
                channels[id]?.lastBounds = newBounds
                channelsLock.unlock()
                refreshChannel(id: id)
                onWindowMoved?(state.windowID, newBounds)
            } else if forceRefresh {
                // Periodic full refresh to catch UI content changes
                refreshChannel(id: id)
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

    func createChannel(id: String, windowID: Int, pid: Int?, subtree: ChannelSubtree?, depth: Int?) -> SpatialResponse {
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

    func updateChannel(id: String, subtree: ChannelSubtree?, depth: Int?) -> SpatialResponse {
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

    func removeChannel(id: String) -> SpatialResponse {
        channelsLock.lock()
        guard channels.removeValue(forKey: id) != nil else {
            channelsLock.unlock()
            return .fail("Channel '\(id)' not found", code: "CHANNEL_NOT_FOUND")
        }
        channelsLock.unlock()
        // Delete channel file
        let path = "\(kDisplayChannelDirectory)/\(id).json"
        try? FileManager.default.removeItem(atPath: path)
        return .ok
    }

    func listChannels() -> SpatialResponse {
        channelsLock.lock()
        let summaries = channels.values.map { state in
            SpatialChannelSummary(
                id: state.id,
                window_id: state.windowID,
                app: state.app,
                elements_count: state.lastElementCount,
                updated_at: state.lastUpdated
            )
        }.sorted { $0.id < $1.id }
        channelsLock.unlock()

        var resp = SpatialResponse.ok
        resp.channels = summaries
        return resp
    }

    func snapshot() -> SpatialResponse {
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

        var resp = SpatialResponse.ok
        resp.snapshot = SpatialSnapshotData(
            displays: displays.count,
            windows: windowCount,
            channels: chCount,
            focused_app: NSWorkspace.shared.frontmostApplication?.localizedName
        )
        return resp
    }

    // MARK: - Graph: Display Enumeration

    func enumerateDisplays() -> [SpatialDisplayInfo] {
        let displays = getDisplays()
        return displays.map { d in
            SpatialDisplayInfo(
                id: d.ordinal,
                cgID: Int(d.id),
                width: Int(d.bounds.width),
                height: Int(d.bounds.height),
                scale_factor: d.scaleFactor,
                bounds: ChannelBounds(from: d.bounds),
                is_main: d.isMain
            )
        }
    }

    // MARK: - Graph: Window Enumeration

    func enumerateWindows(display: Int?) -> [SpatialWindowInfo] {
        let displays = getDisplays()
        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier

        let windowInfoList = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

        var results: [SpatialWindowInfo] = []

        for info in windowInfoList {
            // Use shared visibility filter
            guard isVisibleWindow(info) else { continue }

            // Must have bounds
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let x = boundsDict["X"] as? Double,
                  let y = boundsDict["Y"] as? Double,
                  let w = boundsDict["Width"] as? Double,
                  let h = boundsDict["Height"] as? Double else { continue }

            // Skip zero-size
            guard w > 0 && h > 0 else { continue }

            let windowID = info[kCGWindowNumber as String] as? Int ?? 0
            let pid = info[kCGWindowOwnerPID as String] as? Int ?? 0
            let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
            let title = info[kCGWindowName as String] as? String

            // Determine which display this window's center is on
            let centerX = x + w / 2
            let centerY = y + h / 2
            let targetDisplay = displays.first(where: {
                $0.bounds.contains(CGPoint(x: centerX, y: centerY))
            }) ?? displays.first(where: { $0.isMain })!

            // If display filter specified, skip windows not on that display (by ordinal)
            if let filterDisplay = display, targetDisplay.ordinal != filterDisplay {
                continue
            }

            let isFrontmost = frontmostPID != nil && pid == Int(frontmostPID!)

            results.append(SpatialWindowInfo(
                window_id: windowID,
                pid: pid,
                app: ownerName,
                title: title,
                bounds: ChannelBounds(x: x, y: y, w: w, h: h),
                display: targetDisplay.ordinal,
                is_frontmost: isFrontmost
            ))
        }

        return results
    }

    // MARK: - Graph: Deepen Channel

    func deepenChannel(id: String, subtree: ChannelSubtree?, depth: Int?) -> SpatialResponse {
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

        var resp = SpatialResponse.ok
        resp.elements_count = elCount
        return resp
    }

    // MARK: - Graph: Collapse Channel

    func collapseChannel(id: String, depth: Int?) -> SpatialResponse {
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

        var resp = SpatialResponse.ok
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
        guard let winInfo = windowInfoForID(state.windowID) else { return }
        let bounds = winInfo.bounds
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

        // Build channel file using ChannelData from display/channel.swift
        let file = ChannelData(
            channel_id: id,
            created_by: "aos",
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
            let role = axString(current, kAXRoleAttribute)
            let title = axString(current, kAXTitleAttribute)
            let ident = axString(current, "AXIdentifier")

            var match = true
            if let r = subtree.role, r != role { match = false }
            if let t = subtree.title, t != title { match = false }
            if let i = subtree.identifier, i != ident { match = false }

            if match && (subtree.role != nil || subtree.title != nil || subtree.identifier != nil) {
                return current
            }
            queue.append(contentsOf: axChildren(current))
        }
        return nil
    }

    private func traverseAXForChannel(_ element: AXUIElement, depth: Int, maxDepth: Int,
                                       windowBounds: ChannelBounds, scaleFactor: Double,
                                       results: inout [ChannelElement]) {
        guard depth <= maxDepth else { return }

        let role = axString(element, kAXRoleAttribute) ?? ""

        // Get bounds
        guard let globalBounds = axBounds(element) else {
            // No bounds — still recurse children
            for child in axChildren(element) {
                traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                      windowBounds: windowBounds, scaleFactor: scaleFactor,
                                      results: &results)
            }
            return
        }

        // Skip zero-size elements
        guard globalBounds.width > 0 && globalBounds.height > 0 else { return }

        // Only emit whitelisted roles
        if xrayWhitelistRoles.contains(role) {
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
                title: axString(element, kAXTitleAttribute),
                label: axString(element, kAXDescriptionAttribute),
                identifier: axString(element, "AXIdentifier"),
                value: axString(element, kAXValueAttribute),
                enabled: axBool(element, kAXEnabledAttribute) ?? true,
                actions: actions,
                bounds_pixel: boundsPixel,
                bounds_window: boundsWindow,
                bounds_global: boundsGlobal
            )
            results.append(channelEl)
        }

        // Recurse children
        for child in axChildren(element) {
            traverseAXForChannel(child, depth: depth + 1, maxDepth: maxDepth,
                                  windowBounds: windowBounds, scaleFactor: scaleFactor,
                                  results: &results)
        }
    }

    // MARK: - Window Info Helpers

    private func windowInfoForID(_ windowID: Int) -> SpatialWindowEntry? {
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

        return SpatialWindowEntry(
            pid: pid, appName: appName, bundleID: bundleID,
            display: display, scaleFactor: scaleFactor,
            bounds: ChannelBounds(x: x, y: y, w: w, h: h)
        )
    }

    // MARK: - Channel File I/O

    private func writeChannelFile(_ file: ChannelData) {
        // Ensure directory exists
        try? FileManager.default.createDirectory(atPath: kDisplayChannelDirectory,
                                                  withIntermediateDirectories: true)
        let path = "\(kDisplayChannelDirectory)/\(file.channel_id).json"
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(file) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    // MARK: - Daemon Action Dispatch

    /// Route an incoming daemon action to the appropriate spatial model method.
    /// Returns a dictionary suitable for sendResponseJSON(). Uses dictionary I/O
    /// for the unified daemon.
    func handleAction(_ action: String, json: [String: Any]) -> [String: Any] {
        switch action {
        case "focus-create":
            guard let id = json["id"] as? String else {
                return ["error": "id required", "code": "MISSING_ARG"]
            }
            guard let wid = json["window_id"] as? Int else {
                return ["error": "window_id required", "code": "MISSING_ARG"]
            }
            let pid = json["pid"] as? Int
            let subtree = parseSubtreeFromJSON(json["subtree"])
            let depth = json["depth"] as? Int
            return spatialResponseToDict(createChannel(id: id, windowID: wid, pid: pid,
                                                        subtree: subtree, depth: depth))

        case "focus-update":
            guard let id = json["id"] as? String else {
                return ["error": "id required", "code": "MISSING_ARG"]
            }
            let subtree = parseSubtreeFromJSON(json["subtree"])
            let depth = json["depth"] as? Int
            return spatialResponseToDict(updateChannel(id: id, subtree: subtree, depth: depth))

        case "focus-remove":
            guard let id = json["id"] as? String else {
                return ["error": "id required", "code": "MISSING_ARG"]
            }
            return spatialResponseToDict(removeChannel(id: id))

        case "focus-list":
            return spatialResponseToDict(listChannels())

        case "snapshot":
            return spatialResponseToDict(snapshot())

        case "graph-displays":
            let displays = enumerateDisplays()
            var resp = SpatialResponse.ok
            resp.displays = displays
            return spatialResponseToDict(resp)

        case "graph-windows":
            let display = json["display"] as? Int
            let windows = enumerateWindows(display: display)
            var resp = SpatialResponse.ok
            resp.windows = windows
            return spatialResponseToDict(resp)

        case "graph-deepen":
            guard let id = json["id"] as? String else {
                return ["error": "id required", "code": "MISSING_ARG"]
            }
            let subtree = parseSubtreeFromJSON(json["subtree"])
            let depth = json["depth"] as? Int
            return spatialResponseToDict(deepenChannel(id: id, subtree: subtree, depth: depth))

        case "graph-collapse":
            guard let id = json["id"] as? String else {
                return ["error": "id required", "code": "MISSING_ARG"]
            }
            let depth = json["depth"] as? Int
            return spatialResponseToDict(collapseChannel(id: id, depth: depth))

        default:
            return ["error": "Unknown spatial action: \(action)", "code": "UNKNOWN_ACTION"]
        }
    }

    /// Parse a ChannelSubtree from a JSON dictionary (or nil).
    private func parseSubtreeFromJSON(_ value: Any?) -> ChannelSubtree? {
        guard let dict = value as? [String: Any] else { return nil }
        let role = dict["role"] as? String
        let title = dict["title"] as? String
        let identifier = dict["identifier"] as? String
        guard role != nil || title != nil || identifier != nil else { return nil }
        return ChannelSubtree(role: role, title: title, identifier: identifier)
    }

    /// Convert a SpatialResponse (Codable) into a [String: Any] dictionary
    /// for the unified daemon's sendResponseJSON.
    private func spatialResponseToDict(_ resp: SpatialResponse) -> [String: Any] {
        guard let data = resp.toData(),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return resp.error != nil
                ? ["error": resp.error ?? "Unknown", "code": resp.code ?? "INTERNAL"]
                : ["status": "ok"]
        }
        return dict
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

/// Internal window info result from windowInfoForID.
struct SpatialWindowEntry {
    let pid: Int
    let appName: String
    let bundleID: String?
    let display: Int
    let scaleFactor: Double
    let bounds: ChannelBounds
}

// MARK: - Spatial Model Response Types
//
// Response types used by SpatialModel's CRUD and graph methods.
// Wired into the unified daemon via handleAction().

struct SpatialResponse: Codable {
    var status: String?
    var error: String?
    var code: String?
    var channels: [SpatialChannelSummary]?
    var snapshot: SpatialSnapshotData?
    var displays: [SpatialDisplayInfo]?
    var windows: [SpatialWindowInfo]?
    var elements_count: Int?

    static let ok = SpatialResponse(status: "ok")

    static func fail(_ message: String, code: String) -> SpatialResponse {
        SpatialResponse(error: message, code: code)
    }

    func toData() -> Data? {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try? enc.encode(self)
    }
}

struct SpatialChannelSummary: Codable {
    let id: String
    let window_id: Int
    let app: String
    let elements_count: Int
    let updated_at: String
}

struct SpatialSnapshotData: Codable {
    let displays: Int
    let windows: Int
    let channels: Int
    let focused_app: String?
}

struct SpatialDisplayInfo: Codable {
    let id: Int                    // ordinal (1, 2, 3) — matches channel target.display
    let cgID: Int                  // raw CGDirectDisplayID
    let width: Int
    let height: Int
    let scale_factor: Double
    let bounds: ChannelBounds
    let is_main: Bool
}

struct SpatialWindowInfo: Codable {
    let window_id: Int
    let pid: Int
    let app: String
    let title: String?
    let bounds: ChannelBounds
    let display: Int
    let is_frontmost: Bool
}
