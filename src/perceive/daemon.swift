// daemon.swift — PerceptionEngine: CGEventTap + cursor monitor + AX queries
//
// This is the perception module's core logic, extracted from the daemon.
// It does NOT own a socket — events are emitted via the onEvent callback.
// The UnifiedDaemon hooks into onEvent to broadcast to subscribers.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

class PerceptionEngine {
    let config: AosConfig
    let attention = AttentionEnvelope()

    /// Called when a perception event should be broadcast.
    /// Parameters: (event name, data dictionary)
    var onEvent: ((String, [String: Any]) -> Void)?
    /// Called for raw input events captured by the daemon's event tap.
    /// Returns true when the event should be consumed.
    var onInputEvent: ((String, [String: Any]) -> Bool)?

    // Cursor state
    private var lastCursorPoint: CGPoint = .zero
    private var lastWindowID: Int = 0
    private var lastAppPID: pid_t = 0
    private var lastAppName: String = ""
    private var lastElementRole: String = ""
    private var lastElementTitle: String = ""
    private var cursorIdleTimer: DispatchSourceTimer?
    private var lastMoveTime: Date = Date()

    // App lookup cache
    private var appLookup: [pid_t: (name: String, bundleID: String?)] = [:]
    private var _appRefreshTimer: DispatchSourceTimer?
    private var eventTap: CFMachPort?
    private var eventTapRetryTimer: DispatchSourceTimer?
    private var eventTapStartAttempts: Int = 0
    private var lastEventTapErrorAt: Date?

    var inputTapStatus: String {
        if eventTap != nil { return "active" }
        if eventTapRetryTimer != nil { return "retrying" }
        return "unavailable"
    }

    var inputTapAttempts: Int {
        eventTapStartAttempts
    }

    var inputTapLastErrorAt: Date? {
        lastEventTapErrorAt
    }

    var inputTapListenAccess: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightListenEventAccess()
        }
        return true
    }

    var inputTapPostAccess: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightPostEventAccess()
        }
        return true
    }

    var daemonAccessibilityGranted: Bool {
        AXIsProcessTrusted()
    }

    init(config: AosConfig) {
        self.config = config
    }

    // MARK: - Start / Stop

    func start() {
        startEventTap()
        startSettleTimer()
        startAppLookupRefresh()
    }

    // MARK: - CGEventTap (Depth 0)

    private func startEventTap() {
        if eventTap != nil { return }
        eventTapStartAttempts += 1

        let eventTypes: [CGEventType] = [
            .mouseMoved,
            .leftMouseDown,
            .leftMouseUp,
            .leftMouseDragged,
            .rightMouseDown,
            .rightMouseUp,
            .rightMouseDragged,
            .otherMouseDown,
            .otherMouseUp,
            .otherMouseDragged,
            .keyDown,
            .keyUp,
            .tapDisabledByTimeout,
            .tapDisabledByUserInput,
        ]
        let eventMask = eventTypes.reduce(CGEventMask(0)) { mask, type in
            mask | CGEventMask(1 << type.rawValue)
        }

        let refcon = Unmanaged.passUnretained(self).toOpaque()

        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: eventMask,
            callback: { _, _, event, refcon -> Unmanaged<CGEvent>? in
                guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
                let engine = Unmanaged<PerceptionEngine>.fromOpaque(refcon).takeUnretainedValue()
                let shouldConsume = engine.handleTapEvent(event)
                if shouldConsume {
                    return nil
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: refcon
        ) else {
            logEventTapFailure()
            scheduleEventTapRetry()
            return
        }

        cancelEventTapRetry()
        eventTap = tap
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        if eventTapStartAttempts > 1 {
            fputs("PerceptionEngine: global input tap recovered on retry #\(eventTapStartAttempts - 1)\n", stderr)
        }
    }

    private func scheduleEventTapRetry() {
        if eventTapRetryTimer != nil { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .seconds(1), repeating: .seconds(2))
        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.startEventTap()
            if self.eventTap != nil {
                self.cancelEventTapRetry()
            }
        }
        timer.resume()
        eventTapRetryTimer = timer
    }

    private func cancelEventTapRetry() {
        eventTapRetryTimer?.cancel()
        eventTapRetryTimer = nil
    }

    private func logEventTapFailure() {
        lastEventTapErrorAt = Date()
        let ax = AXIsProcessTrusted()
        if #available(macOS 10.15, *) {
            let listen = CGPreflightListenEventAccess()
            let post = CGPreflightPostEventAccess()
            fputs(
                "Warning: CGEventTap failed — input tap unavailable (AX=\(ax) listen=\(listen) post=\(post)); retrying on main run loop\n",
                stderr
            )
        } else {
            fputs(
                "Warning: CGEventTap failed — input tap unavailable (AX=\(ax)); retrying on main run loop\n",
                stderr
            )
        }
    }

    private func handleTapEvent(_ event: CGEvent) -> Bool {
        let type = event.type

        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            return false
        }

        if type == .mouseMoved ||
            type == .leftMouseDragged ||
            type == .rightMouseDragged ||
            type == .otherMouseDragged {
            handleMouseEvent(event)
        }

        guard let eventName = inputEventName(for: type) else { return false }
        let data = inputEventPayload(for: type, event: event, eventName: eventName)
        return onInputEvent?(eventName, data) ?? false
    }

    private func inputEventName(for type: CGEventType) -> String? {
        switch type {
        case .leftMouseDown:
            return "left_mouse_down"
        case .leftMouseUp:
            return "left_mouse_up"
        case .leftMouseDragged:
            return "left_mouse_dragged"
        case .mouseMoved:
            return "mouse_moved"
        case .rightMouseDown:
            return "right_mouse_down"
        case .rightMouseUp:
            return "right_mouse_up"
        case .rightMouseDragged:
            return "right_mouse_dragged"
        case .otherMouseDown:
            return "other_mouse_down"
        case .otherMouseUp:
            return "other_mouse_up"
        case .otherMouseDragged:
            return "other_mouse_dragged"
        case .keyDown:
            return "key_down"
        case .keyUp:
            return "key_up"
        default:
            return nil
        }
    }

    private func inputEventPayload(for type: CGEventType, event: CGEvent, eventName: String) -> [String: Any] {
        let flags = modifierFlags(from: event.flags)
        switch type {
        case .keyDown, .keyUp:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            return inputEventData(type: eventName, keyCode: keyCode, flags: flags)
        default:
            let point = event.location
            return inputEventData(type: eventName, x: point.x, y: point.y, flags: flags)
        }
    }

    /// Map `CGEventFlags` to the shared {shift, ctrl, cmd, opt, fn} dict used
    /// in every `input_event` payload. `.maskAlphaShift` (capslock) is ignored
    /// intentionally.
    private func modifierFlags(from flags: CGEventFlags) -> [String: Bool] {
        return [
            "shift": flags.contains(.maskShift),
            "ctrl": flags.contains(.maskControl),
            "cmd": flags.contains(.maskCommand),
            "opt": flags.contains(.maskAlternate),
            "fn": flags.contains(.maskSecondaryFn),
        ]
    }

    private func handleMouseEvent(_ event: CGEvent) {
        let point = event.location
        let now = Date()

        let dt = now.timeIntervalSince(lastMoveTime)
        let dx = point.x - lastCursorPoint.x
        let dy = point.y - lastCursorPoint.y
        let dist = sqrt(dx * dx + dy * dy)
        let velocity = dt > 0 ? dist / dt : 0

        lastCursorPoint = point
        lastMoveTime = now

        cursorIdleTimer?.cancel()
        startSettleTimer()

        guard attention.hasSubscribers else { return }

        if attention.wantsContinuousCursor || attention.wantsOnChange {
            let displays = getDisplays()
            let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
                ?? displays.first(where: { $0.isMain })?.ordinal ?? 1
            let data = cursorMovedData(x: point.x, y: point.y, display: displayOrdinal, velocity: velocity)
            onEvent?("cursor_moved", data)
        }

        if attention.maxDepth >= 1 && attention.wantsOnChange {
            checkWindowAndAppChange(at: point)
        }
    }

    // MARK: - Settle Timer (Depth 2)

    private func startSettleTimer() {
        let threshold = config.perception.settle_threshold_ms
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
        timer.schedule(deadline: .now() + .milliseconds(threshold))
        timer.setEventHandler { [weak self] in
            self?.onCursorSettled()
        }
        timer.resume()
        cursorIdleTimer = timer
    }

    private func onCursorSettled() {
        guard attention.hasSubscribers else { return }
        let point = lastCursorPoint
        let displays = getDisplays()
        let displayOrdinal = displays.first(where: { $0.bounds.contains(point) })?.ordinal
            ?? displays.first(where: { $0.isMain })?.ordinal ?? 1

        if attention.wantsOnSettle {
            let idleMs = Int(Date().timeIntervalSince(lastMoveTime) * 1000)
            let data = cursorSettledData(x: point.x, y: point.y, display: displayOrdinal, idle_ms: idleMs)
            onEvent?("cursor_settled", data)
        }

        if attention.maxDepth >= 1 {
            checkWindowAndAppChange(at: point)
        }

        if attention.maxDepth >= 2 {
            queryAXElementAtCursor(point)
        }
    }

    // MARK: - Depth 1: Window/App Detection

    private func checkWindowAndAppChange(at point: CGPoint) {
        let windowInfoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []

        for info in windowInfoList {
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let rect = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) else { continue }
            guard rect.contains(point) else { continue }
            let layer = info[kCGWindowLayer as String] as? Int ?? 0
            guard layer == 0 else { continue }
            let alpha = info[kCGWindowAlpha as String] as? Double ?? 1.0
            guard alpha > 0 else { continue }
            let ownerName = info[kCGWindowOwnerName as String] as? String ?? ""
            guard ownerName != "Window Server" else { continue }

            let windowID = info[kCGWindowNumber as String] as? Int ?? 0
            let pid = info[kCGWindowOwnerPID as String] as? pid_t ?? 0

            if windowID != lastWindowID {
                lastWindowID = windowID
                let bundleID = appLookup[pid]?.bundleID
                let data = windowEnteredData(
                    window_id: windowID, app: ownerName, pid: Int(pid),
                    bundle_id: bundleID, bounds: Bounds(from: rect))
                onEvent?("window_entered", data)
            }

            if pid != lastAppPID {
                lastAppPID = pid
                lastAppName = ownerName
                let bundleID = appLookup[pid]?.bundleID
                let data = appEnteredData(app: ownerName, pid: Int(pid), bundle_id: bundleID)
                onEvent?("app_entered", data)
            }

            break
        }
    }

    // MARK: - Depth 2: AX Element Query

    private func queryAXElementAtCursor(_ point: CGPoint) {
        guard AXIsProcessTrusted() else { return }
        guard lastAppPID > 0 else { return }

        if let hit = axElementAtPoint(pid: lastAppPID, point: point) {
            let newRole = hit.role
            let newTitle = hit.title ?? ""
            if newRole != lastElementRole || newTitle != lastElementTitle {
                lastElementRole = newRole
                lastElementTitle = newTitle
                let data = elementFocusedData(
                    role: hit.role, title: hit.title, label: hit.label, value: hit.value,
                    bounds: hit.bounds.map { Bounds(from: $0) },
                    context_path: hit.contextPath)
                onEvent?("element_focused", data)
            }
        }
    }

    // MARK: - App Lookup Refresh

    private func startAppLookupRefresh() {
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: 5.0)
        timer.setEventHandler { [weak self] in
            self?.refreshAppLookup()
        }
        timer.resume()
        _appRefreshTimer = timer
    }

    private func refreshAppLookup() {
        var lookup: [pid_t: (name: String, bundleID: String?)] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            lookup[app.processIdentifier] = (name: app.localizedName ?? "unknown", bundleID: app.bundleIdentifier)
        }
        appLookup = lookup
    }
}
