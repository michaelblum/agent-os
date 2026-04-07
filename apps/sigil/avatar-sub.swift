// avatar-sub.swift -- Effect subscriber for the agent presence system.
//
// Connects to heads-up via `listen`, subscribes to channel events, and
// dispatches to behaviors in avatar-behaviors.swift. Also handles
// click-following via daemon-delivered runtime input events.
//
// This is NOT a daemon — it's a persistent client of the heads-up daemon.
//
// Build:  bash build-avatar.sh
// Run:    ./build/avatar-sub   (after heads-up daemon is running)

import Foundation
import CoreGraphics

// ============================================================================
// MARK: - State
// ============================================================================

enum AvatarState {
    case idle, roaming, following, tracing
    case followMe  // user clicked avatar — subsequent clicks move it
    case stellating  // mouseDown on avatar, holding — waiting for click vs drag
    case radialMenuOpen  // drag detected, fan-out menu active
    case cursorDecorated  // shape following cursor after selection
    case possessingCursor, possessingKeyboard
    case docking, docked, undocking, transitioning
}

extension AvatarState {
    var runtimeInputMode: String {
        switch self {
        case .idle:
            return "idle"
        case .roaming:
            return "roaming"
        case .followMe:
            return "followMe"
        case .stellating:
            return "stellating"
        case .radialMenuOpen:
            return "radialMenuOpen"
        case .cursorDecorated:
            return "cursorDecorated"
        default:
            return "passive"
        }
    }
}

var avatarState: AvatarState = .idle {
    didSet {
        let previousMode = oldValue.runtimeInputMode
        let currentMode = avatarState.runtimeInputMode
        guard previousMode != currentMode else { return }
        setSigilRuntimeInputMode(currentMode)
    }
}
var isAnimating: Bool = false
var occlusionGraceUntil: Date = .distantPast

// -- Click-vs-drag detection --
var mouseDownPoint: CGPoint? = nil
var mouseDownOnAvatar: Bool = false
var radialMenuActive: Bool = false
var cursorDecorationActive: Bool = false
let dragThreshold: CGFloat = 5.0  // enough pixels for a reliable drag direction
var pressHoldTimer: DispatchWorkItem? = nil

// -- Radial menu config --
var radialMenuConfig: [[String: Any]] = []
var expandedCanvasRect: (x: Double, y: Double, w: Double, h: Double)? = nil
var originalCanvasRect: (x: Double, y: Double, w: Double, h: Double)? = nil
var avatarHitTargetActive: Bool = false
var avatarHitTargetFrame: (x: Double, y: Double, w: Double, h: Double)? = nil

// -- Generation token for cancellation --
var interactionGeneration: UInt64 = 0

// -- Coalescing IPC worker --
// The tap callback only writes latest position into these atomics.
// A background timer sends the actual IPC at a capped rate.
var pendingCursorDecorPos: (x: Double, y: Double)? = nil
var pendingRadialTrackPos: (x: Double, y: Double)? = nil
var coalescingWorkerSession: DaemonSession? = nil  // persistent session for high-freq updates
let coalescingLock = NSLock()
var coalescingTimer: DispatchSourceTimer? = nil  // retained globally to prevent dealloc

func startCoalescingWorker() {
    // 30 Hz timer on a background queue — sends coalesced position updates
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInteractive))
    coalescingTimer = timer  // retain
    timer.schedule(deadline: .now(), repeating: .milliseconds(33))
    timer.setEventHandler {
        coalescingLock.lock()
        let decorPos = pendingCursorDecorPos
        let trackPos = pendingRadialTrackPos
        pendingCursorDecorPos = nil
        pendingRadialTrackPos = nil
        coalescingLock.unlock()

        guard decorPos != nil || trackPos != nil else { return }

        // Ensure persistent session
        if coalescingWorkerSession == nil || !coalescingWorkerSession!.isConnected {
            let session = DaemonSession()
            if session.connect() {
                coalescingWorkerSession = session
            }
        }
        guard let session = coalescingWorkerSession, session.isConnected else { return }

        if let pos = decorPos {
            session.sendOnly(["action": "update", "id": "cursor-decor", "at": [pos.x, pos.y, 40, 40]])
        }
        if let pos = trackPos, let expanded = expandedCanvasRect {
            let canvasRelX = pos.x - expanded.x
            let canvasRelY = pos.y - expanded.y
            let msg = "{\"type\":\"radial_track\",\"x\":\(canvasRelX),\"y\":\(canvasRelY)}"
            let b64 = Data(msg.utf8).base64EncodedString()
            session.sendOnly(["action": "eval", "id": avatarID, "js": "headsup.receive('\(b64)')"])
        }
        session.drainResponses()
    }
    timer.resume()
}

func closeCoalescingSocket() {
    coalescingLock.lock()
    coalescingWorkerSession?.disconnect()
    coalescingWorkerSession = nil
    pendingCursorDecorPos = nil
    pendingRadialTrackPos = nil
    coalescingLock.unlock()
}

// ============================================================================
// MARK: - Channel Event Handling
// ============================================================================

/// Dispatch a channel event from the heads-up pub/sub.
/// The "actions" channel carries before/after events from agent_helpers.sh.
func handleChannelEvent(channel: String, data: [String: Any]) {
    guard channel == "actions" else { return }
    guard let eventType = data["type"] as? String else { return }

    moveID &+= 1
    let mid = moveID

    switch eventType {
    case "before":
        guard let action = data["action"] as? String else { return }
        switch action {
        case "type":
            if let target = data["target"] as? [String: Any],
               let bounds = target["bounds"] as? [Double], bounds.count >= 4 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .possessingKeyboard
                    behaviorPossessKeyboard(
                        target: (bounds[0], bounds[1], bounds[2], bounds[3]),
                        mid: mid
                    )
                }
            }
        case "click":
            DispatchQueue.global(qos: .userInteractive).async {
                avatarState = .possessingCursor
                behaviorPossessCursor(mid)
            }
        case "trace":
            if let target = data["target"] as? [String: Any],
               let bounds = target["bounds"] as? [Double], bounds.count >= 4 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .tracing
                    behaviorTrace(
                        bounds: (bounds[0], bounds[1], bounds[2], bounds[3]),
                        mid: mid
                    )
                    avatarState = .roaming
                }
            }
        case "fast_travel":
            if let to = data["to"] as? [Double], to.count >= 2 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .transitioning
                    behaviorFastTravel(toX: to[0], toY: to[1], mid: mid)
                    avatarState = .roaming
                }
            }
        default:
            break
        }

    case "after":
        guard let action = data["action"] as? String else { return }
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorRelease(from: action == "type" ? "keyboard" : "mouse")
            avatarState = .roaming
        }

    case "dock":
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorDock(mid)
        }

    case "undock":
        let (cx, cy) = getCursorCG()
        let toX = (data["to"] as? [Double])?[safe: 0] ?? cx
        let toY = (data["to"] as? [Double])?[safe: 1] ?? cy
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorUndock(toX, toY, mid)
        }

    default:
        break
    }
}

// ============================================================================
// MARK: - Avatar Event Handling (from JS postMessage)
// ============================================================================

/// Handle events emitted by avatar.html via postMessage → subscriber relay.
/// These arrive as {"type":"event","id":"avatar","payload":{...}} on the subscriber connection.
func handleAvatarEvent(payload: [String: Any]) {
    guard let eventType = payload["type"] as? String else { return }

    // emit() in avatar.html wraps data as {type, payload}, so the actual data
    // is nested under payload["payload"]. Extract the inner payload.
    let inner = payload["payload"] as? [String: Any] ?? [:]

    switch eventType {
    case "local_input":
        let inputType = inner["type"] as? String ?? ""
        let point = avatarPointFromCanvasPayload(inner)
        let keyCode = payloadInt64(inner["keyCode"]) ?? payloadInt64(inner["key_code"])
        handleRuntimeInputEvent(type: inputType, point: point, keyCode: keyCode)

    case "selection_complete":
        // JS animation finished — restore canvas + create cursor decoration
        let gen = (inner["generation"] as? Int).map(UInt64.init) ?? 0

        // Stale check: if a newer interaction started, abandon this completion
        guard gen == interactionGeneration, avatarState == .radialMenuOpen else {
            fputs("TAP: selection_complete ignored (stale gen=\(gen) vs \(interactionGeneration), state=\(avatarState))\n", stderr)
            return
        }

        let selectedItem = inner["item"] as? [String: Any]
        let decorGeo = (selectedItem?["geometry"] as? String) ?? "icosahedron"
        let decorColor = (selectedItem?["color"] as? String) ?? "#ffffff"
        let decorName = (selectedItem?["name"] as? String) ?? "item"
        fputs("TAP: selection_complete — \(decorName) (gen=\(gen))\n", stderr)

        // Leave radial-menu mode immediately so the timeout closure and event
        // tap stop treating input as menu-captured while cleanup runs.
        radialMenuActive = false
        avatarState = .transitioning

        // Restore canvas to original size
        if let orig = originalCanvasRect {
            sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
            curX = orig.x; curY = orig.y; curSize = orig.w
        }
        expandedCanvasRect = nil
        originalCanvasRect = nil
        syncAvatarHitTarget()

        // Generation check again after IPC
        guard gen == interactionGeneration else { return }

        // Create cursor decoration canvas
        let decorPath = sigilRepoPath("packages/toolkit/components/cursor-decor.html")
        let (cx, cy) = getCursorCG()
        let decorURL = URL(fileURLWithPath: decorPath).absoluteString
        sendOneShot("{\"action\":\"create\",\"id\":\"cursor-decor\",\"at\":[\(cx + 15),\(cy - 25),40,40],\"url\":\"\(decorURL)\",\"interactive\":false}")
        Thread.sleep(forTimeInterval: 0.2)  // WKWebView init — minimal, unavoidable

        guard gen == interactionGeneration else { return }

        // Configure the decoration shape
        let configMsg: [String: Any] = ["type": "configure", "geometry": decorGeo, "color": decorColor]
        if let jsonData = try? JSONSerialization.data(withJSONObject: configMsg),
           let jsonStr = String(data: jsonData, encoding: .utf8) {
            let b64 = Data(jsonStr.utf8).base64EncodedString()
            sendOneShot("{\"action\":\"eval\",\"id\":\"cursor-decor\",\"js\":\"headsup.receive('\(b64)')\"}")
        }

        guard gen == interactionGeneration else { return }

        cursorDecorationActive = true
        avatarState = .cursorDecorated
        sendBehavior("idle")
        pushEvent("Selected: \(decorName)", level: "info")

    case "menu_closed":
        // JS closed the menu (no selection or ESC)
        let gen = (inner["generation"] as? Int).map(UInt64.init) ?? 0
        guard gen == interactionGeneration, avatarState == .radialMenuOpen else { return }

        fputs("TAP: menu_closed (gen=\(gen))\n", stderr)
        radialMenuActive = false
        avatarState = .transitioning

        if let orig = originalCanvasRect {
            sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
            curX = orig.x; curY = orig.y; curSize = orig.w
        }
        expandedCanvasRect = nil
        originalCanvasRect = nil
        syncAvatarHitTarget()
        avatarState = .idle
        sendBehavior("idle")

    default:
        break
    }
}

func handleChatCanvasEvent(payload: [String: Any]) {
    guard let eventType = payload["type"] as? String else { return }

    switch eventType {
    case "avatar_toggle":
        moveID &+= 1
        let mid = moveID
        queryChat()

        switch avatarState {
        case .docked:
            let targetX = max(chatX - fullSize * 0.75, 40)
            let targetY = max(chatY - fullSize * 0.10, 40)
            DispatchQueue.global(qos: .userInteractive).async {
                behaviorUndock(targetX, targetY, mid)
            }
        case .idle, .roaming, .followMe, .cursorDecorated:
            DispatchQueue.global(qos: .userInteractive).async {
                behaviorDock(mid)
            }
        default:
            break
        }

    default:
        break
    }
}

// ============================================================================
// MARK: - Runtime Input Bridge
// ============================================================================

// (Press-and-hold now uses pressHoldTimer DispatchWorkItem in the state section above)

func logTap(_ msg: String) {
    fputs("TAP: \(msg)\n", stderr)
}

/// Send a stellate message to the avatar skin
func evalStellate(target: Double, freezeIdle: Bool) {
    let msg: [String: Any] = ["type": "stellate", "target": target, "freezeIdle": freezeIdle]
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"headsup.receive('\(b64)')\"}")
}

/// Send a radial menu message to the avatar skin
func evalRadialMsg(_ msg: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"headsup.receive('\(b64)')\"}")
}

/// Expand the avatar canvas to fit the radial menu arc, returns the new canvas rect
func expandCanvasForMenu() -> (x: Double, y: Double, w: Double, h: Double) {
    let padding: Double = 200  // extra space for menu items beyond avatar
    let newSize = fullSize + padding * 2
    let centerX = curX + curSize / 2
    let centerY = curY + curSize / 2
    let newX = centerX - newSize / 2
    let newY = centerY - newSize / 2
    return (newX, newY, newSize, newSize)
}

func payloadInt64(_ value: Any?) -> Int64? {
    if let number = value as? NSNumber {
        return number.int64Value
    }
    if let value = value as? Int {
        return Int64(value)
    }
    if let value = value as? Int64 {
        return value
    }
    return nil
}

func avatarPointFromCanvasPayload(_ payload: [String: Any]) -> CGPoint? {
    guard let frame = avatarHitTargetFrame,
          let x = payload["x"] as? Double,
          let y = payload["y"] as? Double else {
        return nil
    }
    return CGPoint(x: frame.x + x, y: frame.y + y)
}

func compactAvatarHitTargetFrame() -> (x: Double, y: Double, w: Double, h: Double)? {
    guard curSize > 0 else { return nil }
    return (
        x: curX,
        y: curY,
        w: curSize,
        h: curSize
    )
}

func desiredAvatarHitTargetFrame() -> (x: Double, y: Double, w: Double, h: Double)? {
    if let expandedCanvasRect {
        return expandedCanvasRect
    }
    return compactAvatarHitTargetFrame()
}

func sameHitTargetFrame(_ lhs: (x: Double, y: Double, w: Double, h: Double)?,
                        _ rhs: (x: Double, y: Double, w: Double, h: Double)?) -> Bool {
    guard let lhs, let rhs else { return lhs == nil && rhs == nil }
    let epsilon = 0.5
    return abs(lhs.x - rhs.x) < epsilon &&
        abs(lhs.y - rhs.y) < epsilon &&
        abs(lhs.w - rhs.w) < epsilon &&
        abs(lhs.h - rhs.h) < epsilon
}

func syncAvatarHitTarget() {
    guard avatarState != .docked, let frame = desiredAvatarHitTargetFrame() else {
        removeAvatarHitTarget()
        return
    }

    guard !sameHitTargetFrame(avatarHitTargetFrame, frame) || !avatarHitTargetActive else {
        return
    }

    let payload: [String: Any] = [
        "action": avatarHitTargetActive ? "update" : "create",
        "id": avatarHitTargetID,
        "at": [frame.x, frame.y, frame.w, frame.h],
        "url": sigilFileURL("apps/sigil/avatar-hit-target.html"),
        "interactive": true
    ]
    _ = daemonOneShot(payload)
    avatarHitTargetActive = true
    avatarHitTargetFrame = frame
}

func removeAvatarHitTarget() {
    guard avatarHitTargetActive else {
        avatarHitTargetFrame = nil
        return
    }
    _ = daemonOneShot(["action": "remove", "id": avatarHitTargetID])
    avatarHitTargetActive = false
    avatarHitTargetFrame = nil
}

func handleRuntimeInputEvent(type: String, point: CGPoint? = nil, keyCode: Int64? = nil) {
    if type == "key_down" {
        if keyCode == 53 {  // Escape
            if avatarState == .radialMenuOpen || avatarState == .stellating {
                logTap("ESC → cancel radial menu")
                pressHoldTimer?.cancel()
                pressHoldTimer = nil
                closeCoalescingSocket()
                DispatchQueue.global(qos: .userInteractive).async {
                    evalRadialMsg(["type": "radial_close"])
                    evalStellate(target: 0, freezeIdle: false)
                    if let orig = originalCanvasRect {
                        sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
                        curX = orig.x; curY = orig.y; curSize = orig.w
                    }
                    expandedCanvasRect = nil
                    originalCanvasRect = nil
                    avatarState = .idle
                    sendBehavior("idle")
                }
            } else if avatarState == .cursorDecorated {
                logTap("ESC → clear cursor decoration")
                cursorDecorationActive = false
                DispatchQueue.global(qos: .userInteractive).async {
                    sendOneShot("{\"action\":\"remove\",\"id\":\"cursor-decor\"}")
                    avatarState = .idle
                }
            }
        }
        return
    }

    if type == "mouse_moved" {
        if cursorDecorationActive, let point {
            coalescingLock.lock()
            pendingCursorDecorPos = (point.x + 15, point.y - 25)
            coalescingLock.unlock()
        }
        return
    }

    if type == "right_mouse_down", let point {
        let onAvatar = isClickOnAvatar(point.x, point.y)
        logTap("RIGHT click (\(Int(point.x)),\(Int(point.y))) onAvatar=\(onAvatar)")
        if onAvatar {
            DispatchQueue.global(qos: .userInteractive).async {
                sendBehavior("thinking")
                pushEvent("Right-click (stub)", level: "info")
            }
        }
        return
    }

    if type == "left_mouse_dragged", let point {
        guard avatarState == .stellating || avatarState == .radialMenuOpen else { return }

        if avatarState == .stellating, let downPt = mouseDownPoint {
            let dist = sqrt(pow(point.x - downPt.x, 2) + pow(point.y - downPt.y, 2))
            if dist > dragThreshold {
                pressHoldTimer?.cancel()
                pressHoldTimer = nil

                avatarState = .radialMenuOpen
                radialMenuActive = true

                let avatarCX = curX + curSize / 2
                let avatarCY = curY + curSize / 2
                let angle = atan2(-(point.y - avatarCY), point.x - avatarCX)
                logTap("→ DRAG detected (dist=\(String(format: "%.1f", dist))px, angle=\(String(format: "%.1f", angle * 180 / .pi))°) → RADIAL MENU")

                pushTelemetry(channel: "radial", data: [
                    "state": "OPEN",
                    "mouseDown": "(\(Int(downPt.x)),\(Int(downPt.y)))",
                    "mouseCur": "(\(Int(point.x)),\(Int(point.y)))",
                    "avatarCenter": "(\(Int(curX + curSize/2)),\(Int(curY + curSize/2)))",
                    "angleDeg": String(format: "%.1f", angle * 180 / .pi),
                    "dist": String(format: "%.1f", dist)
                ])

                originalCanvasRect = (curX, curY, curSize, curSize)
                let expanded = expandCanvasForMenu()
                expandedCanvasRect = expanded

                DispatchQueue.global(qos: .userInteractive).async {
                    sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(expanded.x),\(expanded.y),\(expanded.w),\(expanded.h)]}")
                    let offsetX = (curX + curSize / 2) - expanded.x
                    let offsetY = (curY + curSize / 2) - expanded.y
                    evalRadialMsg([
                        "type": "radial_open",
                        "angle": angle,
                        "items": radialMenuConfig,
                        "canvasSize": [expanded.w, expanded.h],
                        "avatarOffset": [offsetX, offsetY]
                    ])
                }
            }
        } else if avatarState == .radialMenuOpen {
            coalescingLock.lock()
            pendingRadialTrackPos = (Double(point.x), Double(point.y))
            coalescingLock.unlock()

            let trackAngle = atan2(-(point.y - (curY + curSize/2)), point.x - (curX + curSize/2))
            pushTelemetry(channel: "radial", data: [
                "state": "TRACKING",
                "mouse": "(\(Int(point.x)),\(Int(point.y)))",
                "beamAngle": String(format: "%.1f°", trackAngle * 180 / .pi)
            ])
        }
        return
    }

    if type == "left_mouse_up" {
        switch avatarState {
        case .stellating:
            pressHoldTimer?.cancel()
            pressHoldTimer = nil
            logTap("LEFT UP in STELLATING → click (toggle follow-me)")
            DispatchQueue.global(qos: .userInteractive).async {
                evalStellate(target: 0, freezeIdle: false)
            }

            if mouseDownOnAvatar {
                avatarState = .followMe
                logTap("→ FOLLOW-ME mode")
                DispatchQueue.global(qos: .userInteractive).async {
                    sendBehavior("look_at_me")
                    pushEvent("Follow-me mode", level: "info")
                }
            } else {
                avatarState = .idle
                logTap("→ EXIT follow-me, IDLE")
                DispatchQueue.global(qos: .userInteractive).async {
                    sendBehavior("idle")
                    pushEvent("Idle", level: "info")
                }
            }

        case .radialMenuOpen:
            guard let point else { break }
            logTap("LEFT UP in RADIAL MENU at (\(Int(point.x)),\(Int(point.y))) expanded=\(expandedCanvasRect.map { "(\(Int($0.x)),\(Int($0.y)),\(Int($0.w)),\(Int($0.h)))" } ?? "nil")")
            radialMenuActive = false
            closeCoalescingSocket()

            interactionGeneration &+= 1
            let gen = interactionGeneration

            if let expanded = expandedCanvasRect {
                let canvasRelX = Double(point.x) - expanded.x
                let canvasRelY = Double(point.y) - expanded.y
                logTap("  canvasRel=(\(Int(canvasRelX)),\(Int(canvasRelY))) gen=\(gen)")
                DispatchQueue.global(qos: .userInteractive).async {
                    evalRadialMsg([
                        "type": "radial_select_at",
                        "x": canvasRelX,
                        "y": canvasRelY,
                        "generation": gen
                    ])
                }

                DispatchQueue.global(qos: .userInteractive).asyncAfter(deadline: .now() + 1.0) {
                    guard gen == interactionGeneration, avatarState == .radialMenuOpen else { return }
                    fputs("TAP: radial menu timeout — force closing (gen=\(gen))\n", stderr)
                    radialMenuActive = false
                    avatarState = .transitioning
                    evalRadialMsg(["type": "radial_close"])
                    evalStellate(target: 0, freezeIdle: false)
                    if let orig = originalCanvasRect {
                        sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
                        curX = orig.x; curY = orig.y; curSize = orig.w
                    }
                    expandedCanvasRect = nil
                    originalCanvasRect = nil
                    syncAvatarHitTarget()
                    avatarState = .idle
                    sendBehavior("idle")
                }
            } else {
                logTap("  no expanded canvas — closing")
                avatarState = .idle
                DispatchQueue.global(qos: .userInteractive).async {
                    evalRadialMsg(["type": "radial_close"])
                    sendBehavior("idle")
                }
            }

        default:
            break
        }

        mouseDownPoint = nil
        mouseDownOnAvatar = false
        return
    }

    if type == "left_mouse_down", let point {
        let onAvatar = isClickOnAvatar(point.x, point.y)
        moveID &+= 1
        let mid = moveID

        logTap("LEFT click (\(Int(point.x)),\(Int(point.y))) onAvatar=\(onAvatar) state=\(avatarState) avatar=(\(Int(curX)),\(Int(curY)),\(Int(curSize)))")

        switch avatarState {
        case .idle, .roaming:
            if onAvatar {
                mouseDownPoint = point
                mouseDownOnAvatar = true
                avatarState = .stellating
                logTap("→ STELLATING (waiting for click/drag)")

                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }

                let timer = DispatchWorkItem {
                    guard avatarState == .stellating else { return }
                    fputs("TAP: PRESS-AND-HOLD triggered\n", stderr)
                    DispatchQueue.global(qos: .userInteractive).async {
                        sendBehavior("look_at_me")
                        pushEvent("Press-and-hold", level: "info")
                    }
                }
                pressHoldTimer = timer
                DispatchQueue.global(qos: .userInteractive).asyncAfter(deadline: .now() + 0.5, execute: timer)

            } else if isClickOnChat(point.x, point.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorDock(mid) }
            }

        case .followMe:
            if onAvatar {
                mouseDownPoint = point
                mouseDownOnAvatar = false
                avatarState = .stellating
                logTap("→ STELLATING (from followMe)")
                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }
            } else {
                logTap("→ fast-travel to (\(Int(point.x)),\(Int(point.y)))")
                DispatchQueue.global(qos: .userInteractive).async {
                    behaviorFastTravel(toX: point.x - curSize / 2, toY: point.y - curSize / 2, mid: mid)
                }
            }

        case .cursorDecorated:
            logTap("→ clearing cursor decoration")
            cursorDecorationActive = false
            sendOneShot("{\"action\":\"remove\",\"id\":\"cursor-decor\"}")
            avatarState = .idle

            if onAvatar {
                mouseDownPoint = point
                mouseDownOnAvatar = true
                avatarState = .stellating
                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }
            }

        case .docked:
            if !isClickOnChat(point.x, point.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorUndock(point.x, point.y, mid) }
            }

        case .stellating, .radialMenuOpen:
            break

        case .docking, .undocking, .transitioning:
            break
        case .possessingCursor, .possessingKeyboard, .following, .tracing:
            break
        }
    }
}

// ============================================================================
// MARK: - Subscriber Connection
// ============================================================================

/// Reset all interaction state to clean idle. Called on daemon disconnect.
func resetInteractionState() {
    avatarState = .idle
    pressHoldTimer?.cancel()
    pressHoldTimer = nil
    mouseDownOnAvatar = false
    radialMenuActive = false
    cursorDecorationActive = false
    pendingRadialTrackPos = nil
    pendingCursorDecorPos = nil
    interactionGeneration &+= 1  // invalidate any in-flight interactions
    // Zero out avatar geometry — prevents stale hit-testing
    curX = 0; curY = 0; curSize = 0
    avatarHitTargetActive = false
    avatarHitTargetFrame = nil
    // Close coalescing worker socket (will be re-opened if needed)
    closeCoalescingSocket()
    fputs("avatar-sub: interaction state reset.\n", stderr)
}

var subscriberStream: DaemonEventStream? = nil

func startSubscriber() {
    let stream = DaemonEventStream(subscribeMessage: ["action": "subscribe", "events": ["input_event"]])
    subscriberStream = stream  // retain

    stream.onConnected = { _ in
        // Ensure avatar canvas exists (creates if missing after daemon restart).
        // Also hydrates curX/curY/curSize for hit-testing.
        ensureAvatarCanvas()
        setSigilRuntimeInputMode(avatarState.runtimeInputMode)
        fputs("avatar-sub: connected to daemon.\n", stderr)
    }

    stream.onReconnect = {
        fputs("avatar-sub: reconnected, resyncing state.\n", stderr)
    }

    stream.onDisconnect = {
        resetInteractionState()
    }

    stream.onMessage = { json in
        // All daemon broadcasts use the envelope schema: {v:1, service, event, ts, data}
        guard let envelope = decodeEnvelope(json) else { return }

        switch envelope.event {
        case "input_event":
            let data = envelope.data
            let point: CGPoint?
            if let x = data["x"] as? Double, let y = data["y"] as? Double {
                point = CGPoint(x: x, y: y)
            } else {
                point = nil
            }
            let keyCode = data["key_code"] as? Int64
            if let type = data["type"] as? String {
                DispatchQueue.global(qos: .userInteractive).async {
                    handleRuntimeInputEvent(type: type, point: point, keyCode: keyCode)
                }
            }

        // Channel events (relayed posts from agent_helpers.sh)
        case "channel_post":
            if let channel = envelope.data["channel"] as? String,
               let payload = envelope.data["payload"] as? [String: Any] {
                handleChannelEvent(channel: channel, data: payload)
            }

        // Canvas JS events (postMessage relay from avatar.html)
        case "canvas_message":
            if let id = envelope.data["id"] as? String,
               let payload = envelope.data["payload"] as? [String: Any] {
                DispatchQueue.global(qos: .userInteractive).async {
                    switch id {
                    case avatarID, avatarHitTargetID:
                        handleAvatarEvent(payload: payload)
                    case chatID:
                        handleChatCanvasEvent(payload: payload)
                    default:
                        break
                    }
                }
            }

        // Canvas lifecycle events — resync avatar position
        case "canvas_lifecycle":
            if let canvasID = envelope.data["canvas_id"] as? String {
                let action = envelope.data["action"] as? String ?? ""
                if canvasID == avatarID {
                    if action == "created" || action == "updated",
                       let at = envelope.data["at"] as? [Double], at.count >= 3 {
                        curX = at[0]; curY = at[1]; curSize = at[2]
                        syncAvatarHitTarget()
                        fputs("avatar-sub: avatar \(action) at (\(Int(curX)), \(Int(curY)), \(Int(curSize)))\n", stderr)
                    } else if action == "removed" {
                        curX = 0; curY = 0; curSize = 0
                        removeAvatarHitTarget()
                        fputs("avatar-sub: avatar removed, zeroed position.\n", stderr)
                    }
                } else if canvasID == avatarHitTargetID, action == "removed" {
                    avatarHitTargetActive = false
                    avatarHitTargetFrame = nil
                }
            }

        default:
            break
        }
    }

    stream.start()
}

// ============================================================================
// MARK: - Safe Array Subscript
// ============================================================================

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// ============================================================================
// MARK: - Entry Point
// ============================================================================

/// Create full-screen avatar canvases — one per display.
/// Each canvas covers an entire display. The avatar moves in Three.js scene space
/// rather than by repositioning the window.
func createAvatarCanvases() {
    let displays = getAllDisplaysCG()
    let liveURL = sigilFileURL("apps/sigil/celestial/live/index.html")

    for display in displays {
        let canvasID = avatarCanvasID(display.id)
        let payload: [String: Any] = [
            "action": "create",
            "id": canvasID,
            "at": [display.x, display.y, display.w, display.h],
            "url": liveURL,
            "interactive": false
        ]
        _ = daemonOneShot(payload)
    }

    // Wait for WKWebViews to initialize
    Thread.sleep(forTimeInterval: 0.5)

    // Send config to all canvases
    if let config = loadAvatarConfig() {
        for display in displays {
            sendToCanvas(display.id, ["type": "config", "data": config])
        }
    }

    // Hide all except primary
    for display in displays where display.id != 0 {
        sendToCanvas(display.id, ["type": "hide"])
    }
    activeDisplayIndex = 0

    // Set initial position to cursor location
    let (cx, cy) = getCursorCG()
    curX = cx; curY = cy
    let session = DaemonSession()
    if session.connect() {
        sendScenePosition(session, x: curX, y: curY)
        session.disconnect()
    }

    fputs("avatar-sub: created \(displays.count) full-screen canvas(es).\n", stderr)
}

/// Ensure the avatar canvas exists. Queries first; only creates if missing.
/// Called on every daemon connect (first and reconnect) so the avatar
/// reappears after a daemon restart without duplicating an existing canvas.
func ensureAvatarCanvas() {
    if queryAvatar() {
        syncAvatarHitTarget()
        return
    }

    createAvatarCanvases()
    _ = queryAvatar()
    syncAvatarHitTarget()
    fputs("avatar-sub: recreated avatar canvas.\n", stderr)
}

/// Load radial menu config from JSON file
func loadRadialMenuConfig() {
    let path = sigilRepoPath("apps/sigil/radial-menu-config.json")
    guard let data = FileManager.default.contents(atPath: path),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let items = json["items"] as? [[String: Any]] else {
        fputs("radial-menu-config.json not found or invalid — radial menu disabled.\n", stderr)
        return
    }
    radialMenuConfig = items
    fputs("Loaded \(items.count) radial menu items.\n", stderr)
}

@main
struct AvatarSub {
    static func main() {
        fputs("\(aosIdentityLogLine(program: "avatar-sub"))\n", stderr)

        // Load radial menu config
        loadRadialMenuConfig()

        // Create full-screen avatar canvases (one per display)
        createAvatarCanvases()
        queryChat()
        ensureChatOnTop()

        // Start subsystems
        startBackgroundMonitor()    // occlusion detection (from avatar-behaviors.swift)
        startSubscriber()           // heads-up channel events
        startCoalescingWorker()     // 30Hz position update worker (cursor-decor, radial tracking)
        setSigilRuntimeInputMode(avatarState.runtimeInputMode)

        FileHandle.standardError.write("""
            avatar-sub running.
              Click avatar           \u{2192} toggle follow-me mode
              Drag from avatar       \u{2192} radial menu (fan-out)
              Right-click avatar     \u{2192} (stub)
              Press-and-hold avatar  \u{2192} (stub)
              Click chat widget      \u{2192} avatar docks
              Channel events         \u{2192} possess cursor/keyboard, trace, fast-travel
              Ctrl+C to stop.
            \n
            """.data(using: .utf8)!)

        // Keep main thread alive
        let keepAlive = CFRunLoopTimerCreateWithHandler(nil, CFAbsoluteTimeGetCurrent() + 86400, 86400, 0, 0) { _ in }
        CFRunLoopAddTimer(CFRunLoopGetCurrent(), keepAlive, .commonModes)
        CFRunLoopRun()
    }
}
