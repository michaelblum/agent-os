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
    /// Called before generic input routing so an active voice lease can consume
    /// only its registered key chord without publishing unrelated key events.
    var onVoiceHotkeyInput: ((AOSVoiceHotkeyInput) -> Bool)?
    var onInputSafetyHotkeyTriggered: ((Date) -> Void)?

    // Cursor state
    private var lastCursorPoint: CGPoint = .zero
    private var lastWindowID: Int = 0
    private var lastAppPID: pid_t = 0
    private var lastAppName: String = ""
    private var lastElementSignature: String = ""
    private var cursorIdleTimer: DispatchSourceTimer?
    private var lastMoveTime: Date = Date()

    // App lookup cache
    private var appLookup: [pid_t: (name: String, bundleID: String?)] = [:]
    private var _appRefreshTimer: DispatchSourceTimer?
    private var eventTap: CFMachPort?
    private var eventTapSource: CFRunLoopSource?
    private var eventTapRetryTimer: DispatchSourceTimer?
    private var eventTapStartAttempts: Int = 0
    private let inputTapPermissionGate = InputTapPermissionGate()
    private let inputTapPermissionMonitorQueue = DispatchQueue(
        label: "io.agent-os.input-tap-permission-monitor",
        qos: .utility
    )
    private var inputTapPermissionMonitor: InputTapPermissionMonitor?
    private var inputTapPermissionMonitorGeneration: UInt64 = 0
    private var inputTapTimeoutRecovery = InputTapTimeoutRecoveryState()
    private let inputSafetyHotkeyState = InputSafetyHotkeyState()

    var inputTapStatus: String {
        if eventTap != nil { return "active" }
        if eventTapRetryTimer != nil { return "retrying" }
        return "unavailable"
    }

    var inputTapAttempts: Int {
        eventTapStartAttempts
    }

    var inputTapLastErrorAt: Date? {
        inputTapPermissionGate.lastErrorAt
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

    var inputSafetyHotkeySnapshot: InputSafetyHotkeySnapshot {
        inputSafetyHotkeyState.snapshot()
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

    func stop() {
        cancelInputTapPermissionMonitor()
        cancelEventTapRetry()
        teardownEventTap()
        cursorIdleTimer?.cancel()
        cursorIdleTimer = nil
        _appRefreshTimer?.cancel()
        _appRefreshTimer = nil
    }

    // MARK: - CGEventTap (Depth 0)

    private func startEventTap() {
        if eventTap != nil { return }
        if inputTapPermissionLossDetected() {
            cancelEventTapRetry()
            return
        }
        eventTapStartAttempts += 1

        let startupPermissions = resolveInputTapPermissions()
        publishInputTapPermissions(
            startupPermissions,
            observedAtUptimeNanoseconds: DispatchTime.now().uptimeNanoseconds
        )
        guard startupPermissions.available else {
            logEventTapFailure(startupPermissions)
            failOpenAfterInputTapPermissionLoss()
            return
        }

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
            .scrollWheel,
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
            let failurePermissions = resolveInputTapPermissions()
            publishInputTapPermissions(
                failurePermissions,
                observedAtUptimeNanoseconds: DispatchTime.now().uptimeNanoseconds
            )
            logEventTapFailure(failurePermissions)
            if failurePermissions.available {
                scheduleEventTapRetry()
            } else {
                failOpenAfterInputTapPermissionLoss()
            }
            return
        }

        cancelEventTapRetry()
        inputTapTimeoutRecovery.installed()
        eventTap = tap
        let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        eventTapSource = runLoopSource
        CGEvent.tapEnable(tap: tap, enable: true)
        startInputTapPermissionMonitor()
        if eventTapStartAttempts > 1 {
            fputs("PerceptionEngine: global input tap recovered on retry #\(eventTapStartAttempts - 1)\n", stderr)
        }
    }

    private func teardownEventTap() {
        inputTapTimeoutRecovery.invalidate()
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            CFMachPortInvalidate(tap)
        }
        if let source = eventTapSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        eventTapSource = nil
        eventTap = nil
    }

    private func scheduleEventTapRetry() {
        if inputTapPermissionLossDetected() {
            cancelEventTapRetry()
            return
        }
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

    private func logEventTapFailure(_ permissions: InputTapPermissionSnapshot) {
        inputTapPermissionGate.recordError(at: Date())
        let next = permissions.available
            ? "retrying on main run loop"
            : "leaving tap unavailable until daemon restart"
        fputs(
            "Warning: CGEventTap failed — input tap unavailable (AX=\(permissions.accessibility) listen=\(permissions.listen) post=\(permissions.post)); \(next)\n",
            stderr
        )
    }

    private func resolveInputTapPermissions() -> InputTapPermissionSnapshot {
        let accessibility = AXIsProcessTrusted()
        if #available(macOS 10.15, *) {
            return InputTapPermissionSnapshot(
                accessibility: accessibility,
                listen: CGPreflightListenEventAccess(),
                post: CGPreflightPostEventAccess()
            )
        }
        return InputTapPermissionSnapshot(
            accessibility: accessibility,
            listen: true,
            post: true
        )
    }

    private func publishInputTapPermissions(
        _ snapshot: InputTapPermissionSnapshot,
        observedAtUptimeNanoseconds: UInt64
    ) {
        inputTapPermissionGate.publish(
            snapshot,
            observedAtUptimeNanoseconds: observedAtUptimeNanoseconds
        )
    }

    private func inputTapPermissionLossDetected() -> Bool {
        inputTapPermissionGate.lossDetected
    }

    private func startInputTapPermissionMonitor() {
        guard inputTapPermissionMonitor == nil else { return }
        inputTapPermissionMonitorGeneration &+= 1
        let monitorGeneration = inputTapPermissionMonitorGeneration
        let monitor = InputTapPermissionMonitor(
            queue: inputTapPermissionMonitorQueue,
            resolver: { [weak self] in
                self?.resolveInputTapPermissions() ?? .unavailable
            },
            observer: { [weak self] snapshot, observedAt in
                DispatchQueue.main.async { [weak self] in
                    self?.applyInputTapPermissionObservation(
                        snapshot,
                        observedAtUptimeNanoseconds: observedAt,
                        monitorGeneration: monitorGeneration
                    )
                }
            }
        )
        inputTapPermissionMonitor = monitor
        monitor.start()
    }

    private func cancelInputTapPermissionMonitor() {
        inputTapPermissionMonitorGeneration &+= 1
        inputTapPermissionMonitor?.stop()
        inputTapPermissionMonitor = nil
    }

    private func applyInputTapPermissionObservation(
        _ snapshot: InputTapPermissionSnapshot,
        observedAtUptimeNanoseconds: UInt64,
        monitorGeneration: UInt64
    ) {
        guard monitorGeneration == inputTapPermissionMonitorGeneration,
              inputTapPermissionMonitor != nil,
              !inputTapPermissionLossDetected() else { return }
        if snapshot.available {
            publishInputTapPermissions(
                snapshot,
                observedAtUptimeNanoseconds: observedAtUptimeNanoseconds
            )
            recoverTimedOutEventTapAfterPermissionRefresh()
        } else {
            failOpenAfterInputTapPermissionLoss()
        }
    }

    private func failOpenAfterInputTapPermissionLoss() {
        let firstDetection = inputTapPermissionGate.latchLoss(at: Date())
        guard firstDetection else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.cancelInputTapPermissionMonitor()
            self.cancelEventTapRetry()
            self.teardownEventTap()
        }
    }

    private func inputTapPermissionDisposition() -> InputTapPermissionDisposition {
        inputTapPermissionGate.disposition(
            at: DispatchTime.now().uptimeNanoseconds
        )
    }

    private func requestInputTapPermissionRefresh() {
        inputTapPermissionMonitor?.requestProbe()
    }

    private func recoverTimedOutEventTapAfterPermissionRefresh() {
        let authorized = inputTapPermissionDisposition() == .authorized
        guard inputTapTimeoutRecovery.consumeIfCurrent(authorized: authorized),
              let eventTap else { return }
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    private func handleTapEvent(_ event: CGEvent) -> Bool {
        let type = event.type

        if type == .tapDisabledByUserInput {
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.cancelInputTapPermissionMonitor()
                self.teardownEventTap()
                self.scheduleEventTapRetry()
            }
            return false
        }

        if type == .tapDisabledByTimeout {
            switch inputTapPermissionDisposition() {
            case .authorized:
                if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            case .stale:
                inputTapTimeoutRecovery.requireRecovery()
                requestInputTapPermissionRefresh()
            case .lost:
                failOpenAfterInputTapPermissionLoss()
            }
            return false
        }

        switch inputTapPermissionDisposition() {
        case .authorized:
            break
        case .stale:
            requestInputTapPermissionRefresh()
            return false
        case .lost:
            failOpenAfterInputTapPermissionLoss()
            return false
        }

        let safetyDecision = inputSafetyHotkeyState.classify(inputSafetyHotkeyEvent(for: type, event: event))
        if safetyDecision.passThrough {
            if safetyDecision.triggered, let deadline = safetyDecision.deadline {
                DispatchQueue.main.async { [weak self] in
                    self?.onInputSafetyHotkeyTriggered?(deadline)
                }
            }
            return false
        }

        if type == .keyDown || type == .keyUp {
            let voiceInput = AOSVoiceHotkeyInput(
                kind: type == .keyDown ? .keyDown : .keyUp,
                keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                modifiers: voiceModifierSnapshot(from: event.flags),
                isRepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0
            )
            if onVoiceHotkeyInput?(voiceInput) == true {
                return true
            }
        }

        if type == .mouseMoved ||
            type == .leftMouseDragged ||
            type == .rightMouseDragged ||
            type == .otherMouseDragged {
            handleMouseEvent(event)
        } else if type == .leftMouseDown ||
            type == .leftMouseUp ||
            type == .rightMouseDown ||
            type == .rightMouseUp ||
            type == .otherMouseDown ||
            type == .otherMouseUp {
            refreshCursorTargetForInputEvent(event)
        }

        guard let eventName = inputEventName(for: type) else { return false }
        let data = inputEventPayload(for: type, event: event, eventName: eventName)
        return onInputEvent?(eventName, data) ?? false
    }

    private func inputSafetyHotkeyEvent(for type: CGEventType, event: CGEvent) -> InputSafetyHotkeyEvent {
        let kind: InputSafetyHotkeyEventKind
        switch type {
        case .keyDown:
            kind = .keyDown
        case .keyUp:
            kind = .keyUp
        default:
            kind = .other
        }

        let keyCode: Int64?
        switch kind {
        case .keyDown, .keyUp:
            keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        case .other:
            keyCode = nil
        }

        return InputSafetyHotkeyEvent(
            kind: kind,
            keyCode: keyCode,
            modifiers: InputSafetyModifierSnapshot(flags: event.flags)
        )
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
        case .scrollWheel:
            return "scroll_wheel"
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
        let receiptID = aosInputReceiptID(event: event)
        switch type {
        case .keyDown, .keyUp:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            return inputEventData(type: eventName, keyCode: keyCode, flags: flags)
        case .scrollWheel:
            let point = event.location
            let dx = Double(event.getIntegerValueField(.scrollWheelEventDeltaAxis2))
            let dy = Double(event.getIntegerValueField(.scrollWheelEventDeltaAxis1))
            return inputEventData(type: eventName, x: point.x, y: point.y, flags: flags, scrollDX: dx, scrollDY: dy, gestureIDOverride: receiptID)
        default:
            let point = event.location
            return inputEventData(type: eventName, x: point.x, y: point.y, flags: flags, gestureIDOverride: receiptID)
        }
    }

    /// Map `CGEventFlags` to the shared modifier dict used in every
    /// `input_event` payload.
    private func modifierFlags(from flags: CGEventFlags) -> [String: Bool] {
        return [
            "shift": flags.contains(.maskShift),
            "ctrl": flags.contains(.maskControl),
            "cmd": flags.contains(.maskCommand),
            "opt": flags.contains(.maskAlternate),
            "fn": flags.contains(.maskSecondaryFn),
            "caps_lock": flags.contains(.maskAlphaShift),
        ]
    }

    private func voiceModifierSnapshot(from flags: CGEventFlags) -> AOSVoiceModifierSnapshot {
        AOSVoiceModifierSnapshot(
            control: flags.contains(.maskControl),
            option: flags.contains(.maskAlternate),
            command: flags.contains(.maskCommand),
            shift: flags.contains(.maskShift)
        )
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

    private func refreshCursorTargetForInputEvent(_ event: CGEvent) {
        let point = event.location
        lastCursorPoint = point
        lastMoveTime = Date()
        guard attention.hasSubscribers else { return }
        if attention.maxDepth >= 1 {
            checkWindowAndAppChange(at: point)
        }
        if attention.maxDepth >= 2 {
            queryAXElementAtCursor(point)
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

    private func browserContextRectNumber(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let s = value as? String { return Double(s) }
        return nil
    }

    private func browserContextWindowBounds(_ context: [String: Any]?) -> Bounds? {
        guard let rect = context?["window_bounds"] as? [String: Any] else { return nil }
        let x = browserContextRectNumber(rect["x"])
        let y = browserContextRectNumber(rect["y"])
        let width = browserContextRectNumber(rect["width"])
        let height = browserContextRectNumber(rect["height"])
        guard let x, let y, let width, let height, width > 0, height > 0 else { return nil }
        return Bounds(x: x, y: y, width: width, height: height)
    }

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
                lastElementSignature = ""
                let bundleID = appLookup[pid]?.bundleID
                let browserContext = axBrowserContext(pid: pid, appName: ownerName, bundleID: bundleID, point: point)
                var data = windowEnteredData(
                    window_id: windowID, app: ownerName, pid: Int(pid),
                    bundle_id: bundleID, bounds: browserContextWindowBounds(browserContext) ?? Bounds(from: rect))
                if let browserContext {
                    data["browser_context"] = browserContext
                }
                onEvent?("window_entered", data)
            }

            if pid != lastAppPID {
                lastAppPID = pid
                lastAppName = ownerName
                lastElementSignature = ""
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
            let signature = axElementTelemetrySignature(hit)
            if signature != lastElementSignature {
                lastElementSignature = signature
                var data = elementFocusedData(
                    role: hit.role, title: hit.title, label: hit.label, value: hit.value,
                    bounds: hit.bounds.map { Bounds(from: $0) },
                    action_names: hit.actionNames,
                    settable_attributes: hit.settableAttributeNames,
                    ancestor_chain: axAncestorPayloads(hit.ancestorChain))
                if let app = appLookup[lastAppPID],
                   let browserContext = axBrowserContext(pid: lastAppPID, appName: app.name, bundleID: app.bundleID, point: point) {
                    data["browser_context"] = browserContext
                }
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

func axElementTelemetrySignature(_ hit: AXHitResult) -> String {
    let bounds = hit.bounds.map { rect in
        [
            Int(rect.origin.x.rounded()),
            Int(rect.origin.y.rounded()),
            Int(rect.size.width.rounded()),
            Int(rect.size.height.rounded()),
        ].map(String.init).joined(separator: ",")
    } ?? ""
    return [
        hit.role,
        hit.title ?? "",
        hit.label ?? "",
        hit.value ?? "",
        bounds,
        hit.actionNames.joined(separator: "\u{1f}"),
        hit.settableAttributeNames.joined(separator: "\u{1f}"),
        hit.ancestorChain.map { item in
            [
                item.role,
                item.title ?? "",
                item.label ?? "",
                item.value ?? "",
                item.bounds.map { rect in
                    [
                        Int(rect.origin.x.rounded()),
                        Int(rect.origin.y.rounded()),
                        Int(rect.size.width.rounded()),
                        Int(rect.size.height.rounded()),
                    ].map(String.init).joined(separator: ",")
                } ?? "",
            ].joined(separator: "\u{1f}")
        }.joined(separator: "\u{1d}"),
    ].joined(separator: "\u{1e}")
}
