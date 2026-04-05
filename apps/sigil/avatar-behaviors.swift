// avatar-behaviors.swift -- The Choreographer.
//
// Maps channel events to behavior sequences using animation primitives
// from avatar-animate.swift. Each behavior composes:
//   1. sendBehavior() — tell the skin which visual preset to use
//   2. moveTo/scaleTo/orbit/holdPosition — drive canvas position/size
//   3. sendOneShot() — create/remove auxiliary canvases (highlight, caret glow)
//
// Behaviors are fire-and-forget — they execute on background queues and can be
// cancelled via moveID.  No behavior gates the action layer.

import Foundation
#if canImport(AppKit)
import AppKit
#endif

// -- Chat widget geometry (updated by queryChat) --
var chatX: Double = 1000
var chatY: Double = 1250
var chatW: Double = 470
var chatH: Double = 500

let occlusionCheckInterval: Double = 0.25

// -- Query chat widget position from canvas list --
func queryChat() {
    let list = getCanvasList()
    if let pos = parseCanvasPosition(list, chatID) {
        chatX = pos.0; chatY = pos.1; chatW = pos.2; chatH = pos.3
    }
}

// -- Query/sync avatar position from canvas list --
func queryAvatar() {
    let list = getCanvasList()
    if let pos = parseCanvasPosition(list, avatarID) {
        curX = pos.0; curY = pos.1; curSize = pos.2
        FileHandle.standardError.write("Avatar synced: (\(Int(curX)), \(Int(curY)), \(Int(curSize)))\n".data(using: .utf8)!)
    }
}

// -- Hit tests --
func isClickOnAvatar(_ px: Double, _ py: Double) -> Bool {
    // Circular hit-test: click within the avatar's visual radius (center of canvas)
    let cx = curX + curSize / 2, cy = curY + curSize / 2
    let radius = curSize * 0.35  // avatar visual fills ~70% of canvas
    let dist = sqrt(pow(px - cx, 2) + pow(py - cy, 2))
    return dist <= radius
}

func isClickOnChat(_ px: Double, _ py: Double) -> Bool {
    px >= chatX && px < chatX + chatW && py >= chatY && py < chatY + chatH
}

func isAvatarOccludedByChat() -> Bool {
    let cx = curX + curSize / 2, cy = curY + curSize / 2
    return cx >= chatX && cx < chatX + chatW && cy >= chatY && cy < chatY + chatH
}

func doesAvatarOverlapChat() -> Bool {
    curX < chatX + chatW && curX + curSize > chatX
        && curY < chatY + chatH && curY + curSize > chatY
}

// -- Z-ordering --
func ensureChatOnTop()   { bringToFront(chatID) }
func ensureAvatarOnTop() { bringToFront(avatarID) }

// ============================================================================
// MARK: - Behaviors
// ============================================================================

// -- Fast Travel: bullet-speed movement with ghost trail --
func behaviorFastTravel(toX: Double, toY: Double, mid: UInt64) {
    sendBehavior("fast_travel", data: [
        "from": [curX, curY], "to": [toX, toY]
    ])

    let dist = sqrt(pow(toX - curX, 2) + pow(toY - curY, 2))
    let duration = max(0.12, min(0.3, dist / 5000))

    moveTo(x: toX, y: toY, duration: duration, easing: easeOutQuart, mid: mid)

    sendBehavior("standby", data: ["near": [toX, toY]])
}

// -- Follow Click: standard roaming animation to a click position --
func behaviorFollowClick(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    isAnimating = true
    defer { isAnimating = false }

    let tx = clickX - fullSize / 2
    let ty = clickY - fullSize / 2

    // Deferred z-swap: stay on top until we clear the chat footprint
    var hasSwitchedZ = false
    if !doesAvatarOverlapChat() {
        ensureChatOnTop()
        hasSwitchedZ = true
    }

    pushEvent("Follow click \u{2192} (\(Int(clickX)), \(Int(clickY)))", level: "info")

    let sx = curX, sy = curY, ss = curSize
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }

    let duration = 1.2
    let n = Int(animFPS * duration)
    let t0 = Date()
    for i in 0...n {
        guard moveID == mid else { break }
        let t = Double(i) / Double(n)
        let e = easeInOutCubic(t)
        curX = sx + (tx - sx) * e
        curY = sy + (ty - sy) * e
        curSize = ss + (fullSize - ss) * e
        sendAvatarUpdate(session)

        if !hasSwitchedZ && !doesAvatarOverlapChat() {
            ensureChatOnTop()
            hasSwitchedZ = true
        }

        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
    if !hasSwitchedZ { ensureChatOnTop() }
}

// -- Follow Cursor: smoothed tracking while idle --
func behaviorFollowCursor(shouldContinue: @escaping () -> Bool) {
    sendBehavior("idle")
    ensureChatOnTop()

    holdPosition(
        getTarget: { getCursorCG() },
        smoothing: 0.12,
        shouldContinue: shouldContinue
    )
}

// -- Trace: orbit an element's perimeter --
func behaviorTrace(bounds: (x: Double, y: Double, w: Double, h: Double), mid: UInt64) {
    behaviorFastTravel(toX: bounds.x + bounds.w / 2, toY: bounds.y, mid: mid)

    sendBehavior("highlighting", data: [
        "bounds": [bounds.x, bounds.y, bounds.w, bounds.h]
    ])

    orbit(bounds: bounds, duration: 1.5, laps: 1)

    // Highlight overlay at element bounds (auto-removed via TTL)
    let highlightHTML = "<div style='border:2px solid rgba(180,100,255,0.5);border-radius:6px;height:100%;box-shadow:0 0 15px rgba(180,100,255,0.3)'></div>"
    sendOneShot("{\"action\":\"create\",\"id\":\"highlight-trace\",\"at\":[\(bounds.x-4),\(bounds.y-4),\(bounds.w+8),\(bounds.h+8)],\"html\":\"\(highlightHTML)\",\"ttl\":\"5s\"}")

    // Standby nearby
    moveTo(x: bounds.x + bounds.w + 40, y: bounds.y - 20, duration: 0.3, easing: easeOutBack)
    sendBehavior("standby")
}

// -- Possess Cursor: shrink and track the mouse --
func behaviorPossessCursor(_ mid: UInt64) {
    let (cx, cy) = getCursorCG()
    behaviorFastTravel(toX: cx, toY: cy, mid: mid)

    sendBehavior("possess_mouse", data: ["position": [cx, cy]])
    scaleTo(size: 60, duration: 0.2, easing: easeInBack)

    holdPosition(
        getTarget: { getCursorCG() },
        smoothing: 0.5,
        shouldContinue: { avatarState == .possessingCursor }
    )
}

// -- Possess Keyboard: move to input target, show caret glow --
func behaviorPossessKeyboard(target: (x: Double, y: Double, w: Double, h: Double), mid: UInt64) {
    behaviorFastTravel(toX: target.x + target.w / 2, toY: target.y + target.h / 2, mid: mid)

    sendBehavior("possess_keyboard", data: [
        "target": ["bounds": [target.x, target.y, target.w, target.h]]
    ])
    scaleTo(size: 80, duration: 0.2, easing: easeInBack)

    // Caret glow overlay at the input element
    let glowCSS = "border:2px solid rgba(180,100,255,0.6);border-radius:4px;height:100%;box-shadow:0 0 12px rgba(180,100,255,0.4),inset 0 0 8px rgba(180,100,255,0.2);animation:caretPulse 1s infinite"
    let glowHTML = "<div style='\(glowCSS)'></div><style>@keyframes caretPulse{0%,100%{opacity:0.6}50%{opacity:1}}</style>"
    sendOneShot("{\"action\":\"create\",\"id\":\"caret-glow\",\"at\":[\(target.x),\(target.y),\(target.w),\(target.h)],\"html\":\"\(glowHTML)\"}")
}

// -- Release: restore after possession --
func behaviorRelease(from: String) {
    sendBehavior("release", data: ["from": from])

    // Remove auxiliary canvases
    sendOneShot("{\"action\":\"remove\",\"id\":\"caret-glow\"}")
    sendOneShot("{\"action\":\"remove\",\"id\":\"highlight-trace\"}")

    // Restore avatar size
    scaleTo(size: fullSize, duration: 0.3, easing: easeOutBack)
    sendBehavior("idle")
}

// ============================================================================
// MARK: - Dock / Undock (ported from avatar-follower.swift)
// ============================================================================

// -- Dock: 3-phase animation (surge -> fly -> spin-park) + DOM reparenting --
func behaviorDock(_ mid: UInt64) {
    isAnimating = true
    avatarState = .docking
    sendBehavior("parking")
    pushEvent("Dock animation started", level: "warn")
    queryChat()

    let (dotRelX, dotRelY) = queryDotPosition()
    let dotX = chatX + dotRelX - dockedSize / 2
    let dotY = chatY + dotRelY - dockedSize / 2
    let titlebarCenterX = chatX + chatW / 2 - fullSize / 2
    let titlebarCenterY = chatY - fullSize * 0.15

    let sx = curX, sy = curY, ss = curSize

    // Phase 1: Surge (0.35s) — grow, z-swap on top
    ensureAvatarOnTop()
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.015;\"}")

    let session = DaemonSession()
    guard session.connect() else { avatarState = .roaming; isAnimating = false; return }

    let surgeN = Int(animFPS * 0.35)
    var t0 = Date()
    for i in 0...surgeN {
        guard moveID == mid else { session.disconnect(); avatarState = .roaming; isAnimating = false; return }
        let t = Double(i) / Double(surgeN)
        let e = easeOutBack(t)
        let s = ss + (surgeSize - ss) * e
        curX = sx - (s - ss) / 2
        curY = sy - (s - ss) / 2 - 20 * e
        curSize = s
        sendAvatarUpdate(session)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // Phase 2: Fly to titlebar center (0.7s)
    let p2sx = curX, p2sy = curY, p2ss = curSize
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.03;\"}")

    let flyN = Int(animFPS * 0.7)
    t0 = Date()
    for i in 0...flyN {
        guard moveID == mid else { session.disconnect(); avatarState = .roaming; isAnimating = false; return }
        let t = Double(i) / Double(flyN)
        let e = easeInOutCubic(t)
        curX = p2sx + (titlebarCenterX - p2sx) * e
        curY = p2sy + (titlebarCenterY - p2sy) * e
        curSize = p2ss + (fullSize - p2ss) * e
        sendAvatarUpdate(session)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // Phase 3: Spin-shrink to pip (0.5s)
    let p3sx = curX, p3sy = curY, p3ss = curSize
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.12;\"}")

    let parkN = Int(animFPS * 0.5)
    t0 = Date()
    for i in 0...parkN {
        guard moveID == mid else { session.disconnect(); avatarState = .roaming; isAnimating = false; return }
        let t = Double(i) / Double(parkN)
        let e = easeInOutCubic(t)
        curX = p3sx + (dotX - p3sx) * e
        curY = p3sy + (dotY - p3sy) * e
        curSize = p3ss + (dockedSize - p3ss) * e
        sendAvatarUpdate(session)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    session.disconnect()

    // DOM reparenting: activate mini-avatar in chat, remove external canvas
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"avatarDock()\"}")
    sendOneShot("{\"action\":\"remove\",\"id\":\"\(avatarID)\"}")

    isAnimating = false
    avatarState = .docked
    pushEvent("Docked \u{2014} reparented to chat DOM", level: "active")
    pushAvatarState()
    FileHandle.standardError.write("Docked \u{2014} avatar reparented to chat DOM.\n".data(using: .utf8)!)
}

// -- Undock: recreate canvas at pip, expand, fly to target --
func behaviorUndock(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    isAnimating = true
    avatarState = .undocking
    sendBehavior("unparking", data: ["to": [clickX, clickY]])
    pushEvent("Undock \u{2192} (\(Int(clickX)), \(Int(clickY)))", level: "info")
    queryChat()

    // Recreate avatar canvas at the pip position
    let (dotRelX, dotRelY) = queryDotPosition()
    curX = chatX + dotRelX - dockedSize / 2
    curY = chatY + dotRelY - dockedSize / 2
    curSize = dockedSize

    let avatarPath = NSString(string: "~/Documents/GitHub/agent-os/apps/sigil/avatar.html").expandingTildeInPath
    sendOneShot("{\"action\":\"create\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)],\"url\":\"file://\(avatarPath)\"}")
    Thread.sleep(forTimeInterval: 0.4) // let WKWebView initialize

    // Deactivate mini-avatar in chat DOM
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"avatarUndock()\"}")

    // Phase 1: Expand from pip to full size (0.6s)
    let sx = curX, sy = curY
    let expandX = chatX + chatW / 2 - fullSize / 2
    let expandY = chatY - fullSize * 0.3

    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.06; state.bobAmplitude = 0.15;\"}")

    let session = DaemonSession()
    guard session.connect() else { avatarState = .docked; isAnimating = false; return }

    let expandN = Int(animFPS * 0.6)
    let t0 = Date()
    for i in 0...expandN {
        guard moveID == mid else { session.disconnect(); avatarState = .roaming; isAnimating = false; return }
        let t = Double(i) / Double(expandN)
        let e = easeOutBack(t)
        curX = sx + (expandX - sx) * e
        curY = sy + (expandY - sy) * e
        curSize = dockedSize + (fullSize - dockedSize) * e
        sendAvatarUpdate(session)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
    session.disconnect()

    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.008;\"}")

    // Grace period: suppress occlusion for 3s
    occlusionGraceUntil = Date().addingTimeInterval(3.0)

    isAnimating = false
    avatarState = .roaming

    // Phase 2: Fly to click target
    behaviorFollowClick(clickX, clickY, mid)
}

// -- Escape: move out from under chat, then dock --
func behaviorEscapeAndDock(_ mid: UInt64) {
    isAnimating = true
    avatarState = .docking
    queryChat()

    let escX = chatX + chatW / 2 - curSize / 2
    let escY = chatY - curSize - 20
    let sx = curX, sy = curY

    let session = DaemonSession()
    guard session.connect() else { avatarState = .roaming; isAnimating = false; return }

    let escN = Int(animFPS * 0.4)
    let t0 = Date()
    for i in 0...escN {
        guard moveID == mid else { session.disconnect(); avatarState = .roaming; isAnimating = false; return }
        let t = Double(i) / Double(escN)
        let e = easeOutQuart(t)
        curX = sx + (escX - sx) * e
        curY = sy + (escY - sy) * e
        sendAvatarUpdate(session)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
    session.disconnect()

    isAnimating = false
    behaviorDock(mid)
}

// ============================================================================
// MARK: - Background Monitor
// ============================================================================

// Watches for occlusion while roaming — if avatar center is under chat, escape+dock.
func startBackgroundMonitor() {
    DispatchQueue.global(qos: .utility).async {
        while true {
            switch avatarState {
            case .roaming:
                Thread.sleep(forTimeInterval: occlusionCheckInterval)
                guard !isAnimating && Date() > occlusionGraceUntil else { continue }
                queryChat()
                if isAvatarOccludedByChat() {
                    FileHandle.standardError.write("Avatar occluded \u{2014} escaping.\n".data(using: .utf8)!)
                    pushEvent("Occluded by chat \u{2014} escaping", level: "error")
                    moveID &+= 1
                    behaviorEscapeAndDock(moveID)
                }
            case .docked, .docking, .undocking,
                 .possessingCursor, .possessingKeyboard,
                 .transitioning, .idle, .following, .tracing,
                 .followMe, .stellating, .radialMenuOpen, .cursorDecorated:
                Thread.sleep(forTimeInterval: 0.2)
            }
        }
    }
}
