// avatar-sub.swift -- Effect subscriber for the agent presence system.
//
// Connects to heads-up via `listen`, subscribes to channel events, and
// dispatches to behaviors in avatar-behaviors.swift.  Also handles
// click-following via CGEventTap (ported from avatar-follower.swift).
//
// This is NOT a daemon — it's a persistent client of the heads-up daemon.
//
// Build:  bash build-avatar.sh
// Run:    ./avatar-sub   (after heads-up daemon is running)

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

var avatarState: AvatarState = .idle
var isAnimating: Bool = false
var occlusionGraceUntil: Date = .distantPast
var eventTap: CFMachPort? = nil

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
            // Build radial_track message inline to avoid JSONSerialization overhead
            let msg = "{\"type\":\"radial_track\",\"x\":\(canvasRelX),\"y\":\(canvasRelY)}"
            let b64 = Data(msg.utf8).base64EncodedString()
            session.sendOnly(["action": "eval", "id": avatarID, "js": "headsup.receive('\(b64)')"])
        }
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

        // Restore canvas to original size
        if let orig = originalCanvasRect {
            sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
            curX = orig.x; curY = orig.y; curSize = orig.w
        }
        expandedCanvasRect = nil
        originalCanvasRect = nil

        // Generation check again after IPC
        guard gen == interactionGeneration else { return }

        // Create cursor decoration canvas
        let decorPath = NSString(string: "~/Documents/GitHub/agent-os/packages/toolkit/components/cursor-decor.html").expandingTildeInPath
        let (cx, cy) = getCursorCG()
        sendOneShot("{\"action\":\"create\",\"id\":\"cursor-decor\",\"at\":[\(cx + 15),\(cy - 25),40,40],\"url\":\"file://\(decorPath)\"}")
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

        if let orig = originalCanvasRect {
            sendOneShot("{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(orig.x),\(orig.y),\(orig.w),\(orig.h)]}")
            curX = orig.x; curY = orig.y; curSize = orig.w
        }
        expandedCanvasRect = nil
        originalCanvasRect = nil
        avatarState = .idle
        sendBehavior("idle")

    default:
        break
    }
}

// ============================================================================
// MARK: - CGEventTap (Click Following)
// ============================================================================

// (Press-and-hold now uses pressHoldTimer DispatchWorkItem in the state section above)

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

/// Event tap callback — handles click-vs-drag, radial menu, follow-me, dock/undock.
func tapCB(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
           _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }

    func log(_ msg: String) {
        fputs("TAP: \(msg)\n", stderr)
    }

    // -- ESC key: cancel radial menu or cursor decoration --
    if type == .keyDown {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if keyCode == 53 {  // 53 = Escape
            if avatarState == .radialMenuOpen || avatarState == .stellating {
                log("ESC → cancel radial menu")
                pressHoldTimer?.cancel()
                pressHoldTimer = nil
                closeCoalescingSocket()
                let gen = interactionGeneration
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
                log("ESC → clear cursor decoration")
                cursorDecorationActive = false
                DispatchQueue.global(qos: .userInteractive).async {
                    sendOneShot("{\"action\":\"remove\",\"id\":\"cursor-decor\"}")
                    avatarState = .idle
                }
            }
        }
        return Unmanaged.passUnretained(event)
    }

    // -- Right click on avatar: stub (future: context menu / radial menu) --
    if type == .rightMouseDown {
        let p = event.location
        let onAvatar = isClickOnAvatar(p.x, p.y)
        log("RIGHT click (\(Int(p.x)),\(Int(p.y))) onAvatar=\(onAvatar)")
        if onAvatar {
            DispatchQueue.global(qos: .userInteractive).async {
                sendBehavior("thinking")
                pushEvent("Right-click (stub)", level: "info")
            }
        }
        return Unmanaged.passUnretained(event)
    }

    // -- Mouse dragged: detect drag from stellating state, track radial menu --
    if type == .leftMouseDragged {
        let p = event.location

        // Consume all drags during avatar interaction
        if avatarState == .stellating || avatarState == .radialMenuOpen {
            // Fall through to handling below, but we'll return nil at the end
        } else {
            return Unmanaged.passUnretained(event)
        }

        if avatarState == .stellating, let downPt = mouseDownPoint {
            let dist = sqrt(pow(p.x - downPt.x, 2) + pow(p.y - downPt.y, 2))
            if dist > dragThreshold {
                // Cancel press-and-hold timer
                pressHoldTimer?.cancel()
                pressHoldTimer = nil

                avatarState = .radialMenuOpen
                radialMenuActive = true

                // Compute drag angle from avatar center to current mouse position.
                // Must use the same reference frame as trackRadialMenu (avatarCenter→mouse)
                // so the beam aligns with the items on open.
                let avatarCX = curX + curSize / 2
                let avatarCY = curY + curSize / 2
                // CG coords: Y down. Scene coords: Y up. Negate Y for angle.
                let angle = atan2(-(p.y - avatarCY), p.x - avatarCX)
                log("→ DRAG detected (dist=\(String(format: "%.1f", dist))px, angle=\(String(format: "%.1f", angle * 180 / .pi))°) → RADIAL MENU")

                // Push debug telemetry
                pushTelemetry(channel: "radial", data: [
                    "state": "OPEN",
                    "mouseDown": "(\(Int(downPt.x)),\(Int(downPt.y)))",
                    "mouseCur": "(\(Int(p.x)),\(Int(p.y)))",
                    "avatarCenter": "(\(Int(curX + curSize/2)),\(Int(curY + curSize/2)))",
                    "angleDeg": String(format: "%.1f", angle * 180 / .pi),
                    "dist": String(format: "%.1f", dist)
                ])

                // Save original canvas rect and expand
                originalCanvasRect = (curX, curY, curSize, curSize)
                let expanded = expandCanvasForMenu()
                expandedCanvasRect = expanded

                // Canvas expand + menu open dispatched off tap thread
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
            // Coalesce drag tracking — worker sends at 30Hz
            coalescingLock.lock()
            pendingRadialTrackPos = (Double(p.x), Double(p.y))
            coalescingLock.unlock()

            // Push tracking telemetry (low frequency — only on drag events)
            let trackAngle = atan2(-(p.y - (curY + curSize/2)), p.x - (curX + curSize/2))
            pushTelemetry(channel: "radial", data: [
                "state": "TRACKING",
                "mouse": "(\(Int(p.x)),\(Int(p.y)))",
                "beamAngle": String(format: "%.1f°", trackAngle * 180 / .pi)
            ])
        }

        return nil  // consume — don't pass drag to apps below
    }

    // -- Mouse moved: coalesce cursor decoration updates --
    if type == .mouseMoved {
        if cursorDecorationActive {
            let p = event.location
            coalescingLock.lock()
            pendingCursorDecorPos = (p.x + 15, p.y - 25)
            coalescingLock.unlock()
        }
        return Unmanaged.passUnretained(event)
    }

    // -- Left mouse up --
    if type == .leftMouseUp {
        switch avatarState {
        case .stellating:
            // Mouse up without drag → this is a click (≤2px)
            pressHoldTimer?.cancel()
            pressHoldTimer = nil
            log("LEFT UP in STELLATING → click (toggle follow-me)")
            // Revert stellation
            DispatchQueue.global(qos: .userInteractive).async {
                evalStellate(target: 0, freezeIdle: false)
            }

            // mouseDownOnAvatar == true means we came from idle/roaming → enter followMe
            // mouseDownOnAvatar == false means we came from followMe → return to idle
            if mouseDownOnAvatar {
                avatarState = .followMe
                log("→ FOLLOW-ME mode")
                DispatchQueue.global(qos: .userInteractive).async {
                    sendBehavior("look_at_me")
                    pushEvent("Follow-me mode", level: "info")
                }
            } else {
                avatarState = .idle
                log("→ EXIT follow-me, IDLE")
                DispatchQueue.global(qos: .userInteractive).async {
                    sendBehavior("idle")
                    pushEvent("Idle", level: "info")
                }
            }

        case .radialMenuOpen:
            let p = event.location
            log("LEFT UP in RADIAL MENU at (\(Int(p.x)),\(Int(p.y))) expanded=\(expandedCanvasRect.map { "(\(Int($0.x)),\(Int($0.y)),\(Int($0.w)),\(Int($0.h)))" } ?? "nil")")
            radialMenuActive = false
            closeCoalescingSocket()

            // Stamp this interaction so completion handler can check for staleness
            interactionGeneration &+= 1
            let gen = interactionGeneration

            // Send atomic select-at with final mouse position — JS resolves
            // highlight from these coords and either selects or closes.
            // Completion comes back as a subscriber event (selection_complete or
            // menu_closed), handled in handleAvatarEvent().
            if let expanded = expandedCanvasRect {
                let canvasRelX = Double(p.x) - expanded.x
                let canvasRelY = Double(p.y) - expanded.y
                log("  canvasRel=(\(Int(canvasRelX)),\(Int(canvasRelY))) gen=\(gen)")
                DispatchQueue.global(qos: .userInteractive).async {
                    evalRadialMsg([
                        "type": "radial_select_at",
                        "x": canvasRelX,
                        "y": canvasRelY,
                        "generation": gen
                    ])
                }
            } else {
                // No expanded canvas — shouldn't happen, but recover gracefully
                log("  no expanded canvas — closing")
                avatarState = .idle
                DispatchQueue.global(qos: .userInteractive).async {
                    evalRadialMsg(["type": "radial_close"])
                    sendBehavior("idle")
                }
            }

        default:
            // Not in an avatar interaction — pass through
            return Unmanaged.passUnretained(event)
        }

        mouseDownPoint = nil
        mouseDownOnAvatar = false
        return nil  // consume — was stellating or radialMenu mouseUp
    }

    // -- Left mouse down --
    if type == .leftMouseDown {
        let p = event.location
        let onAvatar = isClickOnAvatar(p.x, p.y)
        moveID &+= 1
        let mid = moveID

        log("LEFT click (\(Int(p.x)),\(Int(p.y))) onAvatar=\(onAvatar) state=\(avatarState) avatar=(\(Int(curX)),\(Int(curY)),\(Int(curSize)))")

        switch avatarState {
        case .idle, .roaming:
            if onAvatar {
                // Enter stellating state — wait to see if it's a click or drag
                mouseDownPoint = p
                mouseDownOnAvatar = true
                avatarState = .stellating
                log("→ STELLATING (waiting for click/drag)")

                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }

                // Press-and-hold timer (0.5s)
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

                return nil  // consume — don't pass to apps below

            } else if isClickOnChat(p.x, p.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorDock(mid) }
            }

        case .followMe:
            if onAvatar {
                // Enter stellating from follow-me — on release will toggle back to idle
                mouseDownPoint = p
                mouseDownOnAvatar = false  // flag: came from followMe
                avatarState = .stellating
                log("→ STELLATING (from followMe)")
                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }
                return nil  // consume
            } else {
                log("→ fast-travel to (\(Int(p.x)),\(Int(p.y)))")
                DispatchQueue.global(qos: .userInteractive).async {
                    behaviorFastTravel(toX: p.x - curSize / 2, toY: p.y - curSize / 2, mid: mid)
                }
            }

        case .cursorDecorated:
            // Any click clears cursor decoration
            log("→ clearing cursor decoration")
            cursorDecorationActive = false
            sendOneShot("{\"action\":\"remove\",\"id\":\"cursor-decor\"}")
            avatarState = .idle

            // If clicked on avatar, also enter stellating
            if onAvatar {
                mouseDownPoint = p
                mouseDownOnAvatar = true
                avatarState = .stellating
                DispatchQueue.global(qos: .userInteractive).async {
                    evalStellate(target: 0.5, freezeIdle: true)
                }
                return nil  // consume
            }

        case .docked:
            if !isClickOnChat(p.x, p.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorUndock(p.x, p.y, mid) }
            }

        case .stellating, .radialMenuOpen:
            break  // already handling

        case .docking, .undocking, .transitioning:
            break  // ignore clicks during transitions
        case .possessingCursor, .possessingKeyboard, .following, .tracing:
            break  // ignore clicks during agent-driven behaviors
        }
    }
    return Unmanaged.passUnretained(event)
}

func startEventTap() {
    let mask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
               | CGEventMask(1 << CGEventType.leftMouseUp.rawValue)
               | CGEventMask(1 << CGEventType.leftMouseDragged.rawValue)
               | CGEventMask(1 << CGEventType.mouseMoved.rawValue)
               | CGEventMask(1 << CGEventType.rightMouseDown.rawValue)
               | CGEventMask(1 << CGEventType.keyDown.rawValue)
               | CGEventMask(1 << CGEventType.tapDisabledByTimeout.rawValue)
               | CGEventMask(1 << CGEventType.tapDisabledByUserInput.rawValue)

    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
        eventsOfInterest: mask,
        callback: tapCB, userInfo: nil
    ) else {
        fputs("EVENT TAP FAILED — grant Accessibility permission to this binary.\n", stderr)
        return  // subscriber + channel events still work without click-follow
    }
    eventTap = tap
    fputs("EVENT TAP OK — click-follow active.\n", stderr)
    let src = CFMachPortCreateRunLoopSource(nil, tap, 0)!
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
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
    // Close coalescing worker socket (will be re-opened if needed)
    closeCoalescingSocket()
    fputs("avatar-sub: interaction state reset.\n", stderr)
}

var subscriberStream: DaemonEventStream? = nil

func startSubscriber() {
    let stream = DaemonEventStream()
    subscriberStream = stream  // retain

    stream.onReconnect = {
        queryAvatar()
        fputs("avatar-sub: connected to daemon.\n", stderr)
    }

    stream.onDisconnect = {
        resetInteractionState()
    }

    stream.onMessage = { json in
        guard let type = json["type"] as? String else { return }

        // Channel events
        if type == "channel",
           let channel = json["channel"] as? String,
           let data = json["data"] as? [String: Any] {
            handleChannelEvent(channel: channel, data: data)
        }

        // Avatar canvas JS events (from postMessage relay)
        if type == "event",
           let id = json["id"] as? String, id == avatarID,
           let payload = json["payload"] as? [String: Any] {
            DispatchQueue.global(qos: .userInteractive).async {
                handleAvatarEvent(payload: payload)
            }
        }

        // Canvas lifecycle events — resync avatar position
        if type == "event",
           let id = json["id"] as? String, id == "__lifecycle__",
           let payload = json["payload"] as? [String: Any],
           let lifecycleType = payload["type"] as? String, lifecycleType == "canvas_lifecycle",
           let canvasID = payload["id"] as? String, canvasID == avatarID {

            let action = payload["action"] as? String ?? ""
            if action == "created" || action == "updated",
               let at = payload["at"] as? [Double], at.count >= 3 {
                curX = at[0]; curY = at[1]; curSize = at[2]
                fputs("avatar-sub: avatar \(action) at (\(Int(curX)), \(Int(curY)), \(Int(curSize)))\n", stderr)
            } else if action == "removed" {
                curX = 0; curY = 0; curSize = 0
                fputs("avatar-sub: avatar removed, zeroed position.\n", stderr)
            }
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

/// Load radial menu config from JSON file
func loadRadialMenuConfig() {
    let path = NSString(string: "~/Documents/GitHub/agent-os/apps/sigil/radial-menu-config.json").expandingTildeInPath
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
        // Load radial menu config
        loadRadialMenuConfig()

        // Auto-create avatar canvas if it doesn't exist
        let path = NSString(string: "~/Documents/GitHub/agent-os/apps/sigil/avatar.html").expandingTildeInPath
        sendOneShot("{\"action\":\"create\",\"id\":\"\(avatarID)\",\"at\":[200,200,\(fullSize),\(fullSize)],\"url\":\"file://\(path)\"}")
        Thread.sleep(forTimeInterval: 0.5)

        // Sync position with actual canvas
        queryAvatar()
        queryChat()
        ensureChatOnTop()

        // Start subsystems
        startBackgroundMonitor()    // occlusion detection (from avatar-behaviors.swift)
        startSubscriber()           // heads-up channel events
        startCoalescingWorker()     // 30Hz position update worker (cursor-decor, radial tracking)
        startEventTap()             // click following (non-fatal if it fails)

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
