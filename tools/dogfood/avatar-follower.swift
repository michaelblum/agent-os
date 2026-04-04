// avatar-follower.swift — Click-following orchestrator for the avatar overlay.
//
// Adapted from the ball experiment (packages/heads-up/examples/click-follower.swift).
// Key lesson: CGEventTap in .listenOnly mode does NOT block clicks —
// clicks pass through to apps/desktop AND we receive them.
//
// States:
//   .roaming  — avatar follows clicks freely
//   .docking  — multi-phase animation: surge → fly to titlebar → spin-shrink to pip
//   .docked   — avatar is parked as the chat widget's titlebar pip
//   .undocking — reverse: expand → fly out to click position
//
// Build:  swiftc -O -o avatar-follower avatar-follower.swift
// Run:    ./avatar-follower   (after avatar + agent-chat canvases exist)

import Foundation
import CoreGraphics

// -- Configuration --
let socketPath = NSString(string: "~/.config/heads-up/sock").expandingTildeInPath
let avatarID   = "avatar"
let chatID     = "agent-chat"
let fullSize: Double   = 300     // roaming avatar canvas size
let surgeSize: Double  = 400     // "towards camera" surge size
let dockedSize: Double = 40      // parked icon size
let animFPS: Double    = 60.0
let occlusionCheckInterval: Double = 0.25  // seconds between overlap checks

// -- Chat widget position (updated dynamically via queryChat) --
var chatX: Double = 1000
var chatY: Double = 1250
var chatW: Double = 470
var chatH: Double = 500

// -- State --
enum AvatarState { case roaming, docking, docked, undocking }
var state: AvatarState = .roaming
var curX: Double = 700
var curY: Double = 1300
var curSize: Double = 300
var moveID: UInt64 = 0
var eventTap: CFMachPort? = nil
var occlusionGraceUntil: Date = .distantPast  // suppress occlusion checks until this time
var isAnimating: Bool = false  // true while any animation loop is running

// -- Easing --
func easeInOutCubic(_ t: Double) -> Double {
    t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
}
func easeOutBack(_ t: Double) -> Double {
    let c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)
}
func easeInBack(_ t: Double) -> Double {
    let c1 = 1.70158, c3 = c1 + 1
    return c3 * t * t * t - c1 * t * t
}
func easeOutQuart(_ t: Double) -> Double {
    1 - pow(1 - t, 4)
}

// -- Socket helpers --
func connectSock() -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return -1 }
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = socketPath.utf8CString
    let maxLen = MemoryLayout.size(ofValue: addr.sun_path)
    withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
        pathBytes.withUnsafeBufferPointer { src in
            UnsafeMutableRawPointer(ptr).copyMemory(
                from: src.baseAddress!, byteCount: min(pathBytes.count, maxLen))
        }
    }
    let r = withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard r == 0 else { close(fd); return -1 }
    return fd
}

func sendJSON(_ fd: Int32, _ json: String) {
    let line = json + "\n"
    line.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    _ = read(fd, &buf, buf.count)
}

func sendOneShot(_ json: String) {
    let fd = connectSock()
    guard fd >= 0 else { return }
    sendJSON(fd, json)
    close(fd)
}

let telemetryID = "telemetry"

// -- Push telemetry data to the telemetry HUD --
func pushTelemetry(channel: String, data: [String: Any]) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: ["channel": channel, "data": data]),
          let jsonStr = String(data: jsonData, encoding: .utf8) else { return }
    let b64 = Data(jsonStr.utf8).base64EncodedString()
    let escaped = b64.replacingOccurrences(of: "'", with: "\\'")
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(telemetryID)\",\"js\":\"headsup.receive('\(escaped)')\"}")
}

func pushEvent(_ text: String, level: String = "") {
    pushTelemetry(channel: "_event", data: ["text": text, "level": level])
}

func pushAvatarState() {
    let stateStr: String
    switch state {
    case .roaming: stateStr = "roaming"
    case .docking: stateStr = "docking"
    case .docked: stateStr = "docked"
    case .undocking: stateStr = "undocking"
    }
    pushTelemetry(channel: "avatar", data: [
        "state": stateStr,
        "position": "(\(Int(curX)), \(Int(curY)))",
        "size": Int(curSize),
    ])
    pushTelemetry(channel: "chat", data: [
        "position": "(\(Int(chatX)), \(Int(chatY)))",
        "size": "\(Int(chatW))x\(Int(chatH))",
    ])
}

// -- Query canvas position by ID from list response --
func parseCanvasPosition(_ listStr: String, _ canvasID: String) -> (Double, Double, Double, Double)? {
    guard let idRange = listStr.range(of: "\"id\":\"\(canvasID)\"") else { return nil }
    let before = listStr[listStr.startIndex..<idRange.lowerBound]
    guard let atRange = before.range(of: "\"at\":[", options: .backwards) else { return nil }
    let nums = listStr[atRange.upperBound...]
    guard let endBracket = nums.firstIndex(of: "]") else { return nil }
    let parts = String(nums[..<endBracket]).split(separator: ",").compactMap {
        Double($0.trimmingCharacters(in: .whitespaces))
    }
    guard parts.count >= 4 else { return nil }
    return (parts[0], parts[1], parts[2], parts[3])
}

func getCanvasList() -> String {
    let fd = connectSock()
    guard fd >= 0 else { return "" }
    let req = "{\"action\":\"list\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 8192)
    let n = read(fd, &buf, buf.count)
    close(fd)
    guard n > 0 else { return "" }
    return String(bytes: buf[0..<n], encoding: .utf8) ?? ""
}

// -- Query chat widget position --
func queryChat() {
    let list = getCanvasList()
    if let pos = parseCanvasPosition(list, chatID) {
        chatX = pos.0; chatY = pos.1; chatW = pos.2; chatH = pos.3
    }
}

// -- Query avatar position (sync curX/curY/curSize with actual canvas) --
func queryAvatar() {
    let list = getCanvasList()
    if let pos = parseCanvasPosition(list, avatarID) {
        curX = pos.0; curY = pos.1; curSize = pos.2
        FileHandle.standardError.write("Avatar position synced: (\(curX), \(curY), \(curSize))\n".data(using: .utf8)!)
    }
}

// -- Query dot (pip) position from chat DOM --
func queryDotPosition() -> (Double, Double) {
    var dotCX = 25.0, dotCY = 21.5  // fallback
    let fd = connectSock()
    guard fd >= 0 else { return (dotCX, dotCY) }
    let js = "var r=document.getElementById('dot').getBoundingClientRect();r.left+r.width/2+','+(r.top+r.height/2)"
    let req = "{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"\(js)\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 4096)
    let n = read(fd, &buf, buf.count)
    close(fd)
    if n > 0, let str = String(bytes: buf[0..<n], encoding: .utf8) {
        if let rRange = str.range(of: "\"result\":\""),
           let rEnd = str[rRange.upperBound...].firstIndex(of: "\"") {
            let coords = String(str[rRange.upperBound..<rEnd])
            let parts = coords.split(separator: ",")
            if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
                dotCX = x; dotCY = y
            }
        }
    }
    return (dotCX, dotCY)
}

// -- Hit test: is click inside chat widget? --
func isClickOnChat(_ px: Double, _ py: Double) -> Bool {
    return px >= chatX && px < chatX + chatW && py >= chatY && py < chatY + chatH
}

// -- Hit test: is avatar's center occluded by chat widget? --
func isAvatarOccludedByChat() -> Bool {
    let avatarCenterX = curX + curSize / 2
    let avatarCenterY = curY + curSize / 2
    return avatarCenterX >= chatX && avatarCenterX < chatX + chatW
        && avatarCenterY >= chatY && avatarCenterY < chatY + chatH
}

// -- Hit test: does the avatar canvas overlap the chat widget at all? --
func doesAvatarOverlapChat() -> Bool {
    return curX < chatX + chatW && curX + curSize > chatX
        && curY < chatY + chatH && curY + curSize > chatY
}

// -- Animate position + size --
func animateFrame(_ fd: Int32, x: Double, y: Double, size: Double) {
    curX = x; curY = y; curSize = size
    sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(x),\(y),\(size),\(size)]}")
}

// -- Z-ordering helpers --
func bringToFront(_ canvasID: String) {
    sendOneShot("{\"action\":\"to-front\",\"id\":\"\(canvasID)\"}")
}

// Ensure chat is above avatar (normal roaming state)
func ensureChatOnTop() {
    bringToFront(chatID)
}

// Ensure avatar is above chat (docking animation only)
func ensureAvatarOnTop() {
    bringToFront(avatarID)
}

// -- ROAMING: follow click --
func animateToClick(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    isAnimating = true
    defer { isAnimating = false }

    let sx = curX, sy = curY, ss = curSize
    let tx = clickX - fullSize / 2
    let ty = clickY - fullSize / 2
    let duration = 1.2

    // Don't immediately switch z-order — if we're overlapping the chat
    // (e.g., undocking), stay on top until we've cleared it.
    var hasSwitchedZ = false
    if !doesAvatarOverlapChat() {
        ensureChatOnTop()
        hasSwitchedZ = true
    }
    pushEvent("Follow click → (\(Int(clickX)), \(Int(clickY)))", level: "info")

    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }

    let n = Int(animFPS * duration)
    let t0 = Date()
    for i in 0...n {
        guard moveID == mid else { break }
        let t = Double(i) / Double(n)
        let e = easeInOutCubic(t)
        let x = sx + (tx - sx) * e
        let y = sy + (ty - sy) * e
        let s = ss + (fullSize - ss) * e  // restore to full size if coming from undock
        animateFrame(fd, x: x, y: y, size: s)

        // Switch to behind-chat once avatar has cleared the chat footprint
        if !hasSwitchedZ && !doesAvatarOverlapChat() {
            ensureChatOnTop()
            hasSwitchedZ = true
        }

        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // Final safety: ensure chat is on top when animation ends
    if !hasSwitchedZ { ensureChatOnTop() }
}

// -- DOCKING: multi-phase animation --
// Phase 1: Surge — grow towards camera (z-axis feel), z-swap to be ON TOP
// Phase 2: Fly to center-top of titlebar
// Phase 3: Rapid spin + shrink, slide to pip/dot parking spot
func dockAnimation(_ mid: UInt64) {
    isAnimating = true
    state = .docking
    pushEvent("Dock animation started", level: "warn")
    queryChat()

    let (dotRelX, dotRelY) = queryDotPosition()
    // Global CG positions
    let dotX = chatX + dotRelX - dockedSize / 2
    let dotY = chatY + dotRelY - dockedSize / 2
    let titlebarCenterX = chatX + chatW / 2 - fullSize / 2
    let titlebarCenterY = chatY - fullSize * 0.15  // just above titlebar

    let sx = curX, sy = curY, ss = curSize

    // === Phase 1: Surge (grow towards camera) — 0.35s ===
    // Bring avatar ON TOP of chat for the dock animation
    ensureAvatarOnTop()
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.015;\"}")

    let fd = connectSock()
    guard fd >= 0 else { state = .roaming; return }

    let surgeFrames = Int(animFPS * 0.35)
    var t0 = Date()
    for i in 0...surgeFrames {
        guard moveID == mid else { close(fd); state = .roaming; return }
        let t = Double(i) / Double(surgeFrames)
        let e = easeOutBack(t)
        // Grow from current size to surgeSize, stay mostly in place (slight upward drift)
        let s = ss + (surgeSize - ss) * e
        let x = sx - (s - ss) / 2  // center the growth
        let y = sy - (s - ss) / 2 - 20 * e  // slight upward drift
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // === Phase 2: Fly to titlebar center — 0.7s ===
    let p2sx = curX, p2sy = curY, p2ss = curSize
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.03;\"}")

    let flyFrames = Int(animFPS * 0.7)
    t0 = Date()
    for i in 0...flyFrames {
        guard moveID == mid else { close(fd); state = .roaming; return }
        let t = Double(i) / Double(flyFrames)
        let e = easeInOutCubic(t)
        let x = p2sx + (titlebarCenterX - p2sx) * e
        let y = p2sy + (titlebarCenterY - p2sy) * e
        // Shrink slightly during flight (surge → fullSize)
        let s = p2ss + (fullSize - p2ss) * e
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // === Phase 3: Rapid spin + shrink to pip — 0.5s ===
    let p3sx = curX, p3sy = curY, p3ss = curSize
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.12;\"}")

    let parkFrames = Int(animFPS * 0.5)
    t0 = Date()
    for i in 0...parkFrames {
        guard moveID == mid else { close(fd); state = .roaming; return }
        let t = Double(i) / Double(parkFrames)
        let e = easeInOutCubic(t)
        let x = p3sx + (dotX - p3sx) * e
        let y = p3sy + (dotY - p3sy) * e
        let s = p3ss + (dockedSize - p3ss) * e
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    close(fd)

    // Reparent: activate mini-avatar in chat DOM, remove the external avatar canvas
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"avatarDock()\"}")
    sendOneShot("{\"action\":\"remove\",\"id\":\"\(avatarID)\"}")

    isAnimating = false
    state = .docked
    pushEvent("Docked — reparented to chat DOM", level: "active")
    pushAvatarState()
    FileHandle.standardError.write("Docked — avatar reparented to chat DOM.\n".data(using: .utf8)!)
}

// -- UNDOCKING: recreate avatar canvas at pip, expand, fly to click --
func undockAnimation(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    isAnimating = true
    state = .undocking
    pushEvent("Undock → (\(Int(clickX)), \(Int(clickY)))", level: "info")
    queryChat()

    // Recreate avatar canvas at the pip position (where the mini-avatar is)
    let (dotRelX, dotRelY) = queryDotPosition()
    curX = chatX + dotRelX - dockedSize / 2
    curY = chatY + dotRelY - dockedSize / 2
    curSize = dockedSize

    let avatarPath = NSString(string: "~/Documents/GitHub/agent-os/tools/dogfood/avatar.html").expandingTildeInPath
    sendOneShot("{\"action\":\"create\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)],\"url\":\"file://\(avatarPath)\"}")
    Thread.sleep(forTimeInterval: 0.4) // let WKWebView initialize

    // Deactivate mini-avatar in chat DOM
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"avatarUndock()\"}")

    let fd = connectSock()
    guard fd >= 0 else { state = .docked; return }
    defer { close(fd) }

    // Phase 1: Expand from docked size back to full (0.6s)
    let sx = curX, sy = curY
    let expandX = chatX + chatW / 2 - fullSize / 2
    let expandY = chatY - fullSize * 0.3

    // Speed up spin during expansion
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.06; state.bobAmplitude = 0.15;\"}")

    let phase1Frames = Int(animFPS * 0.6)
    let t0 = Date()
    for i in 0...phase1Frames {
        guard moveID == mid else { state = .roaming; return }
        let t = Double(i) / Double(phase1Frames)
        let e = easeOutBack(t)
        let x = sx + (expandX - sx) * e
        let y = sy + (expandY - sy) * e
        let s = dockedSize + (fullSize - dockedSize) * e
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
    close(fd)

    // Normal spin
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.008;\"}")

    // Grace period: suppress occlusion checks for 3s so the avatar can fly away
    // without the monitor immediately re-docking it
    occlusionGraceUntil = Date().addingTimeInterval(3.0)

    // Phase 2: Fly to click target (ensureChatOnTop happens inside animateToClick)
    state = .roaming
    animateToClick(clickX, clickY, mid)
}

// -- Escape animation: avatar moves out from under chat, then docks --
func escapeAndDock(_ mid: UInt64) {
    isAnimating = true
    state = .docking
    queryChat()

    let fd = connectSock()
    guard fd >= 0 else { state = .roaming; return }
    defer { close(fd) }

    // Escape: move to above the chat widget (quick, 0.4s)
    let escX = chatX + chatW / 2 - curSize / 2
    let escY = chatY - curSize - 20  // above the chat widget
    let sx = curX, sy = curY

    let escFrames = Int(animFPS * 0.4)
    let t0 = Date()
    for i in 0...escFrames {
        guard moveID == mid else { close(fd); state = .roaming; return }
        let t = Double(i) / Double(escFrames)
        let e = easeOutQuart(t)
        let x = sx + (escX - sx) * e
        let y = sy + (escY - sy) * e
        animateFrame(fd, x: x, y: y, size: curSize)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
    close(fd)

    // Now dock from the escaped position
    dockAnimation(mid)
}

// -- Background monitor: occlusion check while roaming --
// When docked, the mini-avatar is part of the chat DOM — no tracking needed.
func startBackgroundMonitor() {
    DispatchQueue.global(qos: .utility).async {
        while true {
            switch state {
            case .roaming:
                Thread.sleep(forTimeInterval: occlusionCheckInterval)
                // Skip occlusion check while animating or during grace period
                guard !isAnimating && Date() > occlusionGraceUntil else { continue }
                queryChat()
                if isAvatarOccludedByChat() {
                    FileHandle.standardError.write("Avatar occluded by chat — escaping.\n".data(using: .utf8)!)
                    pushEvent("Occluded by chat — escaping", level: "error")
                    moveID &+= 1
                    let mid = moveID
                    escapeAndDock(mid)
                }
            case .docked, .docking, .undocking:
                Thread.sleep(forTimeInterval: 0.2)  // idle — mini-avatar is in chat DOM
            }
        }
    }
}

// -- Event tap callback --
func tapCB(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
           _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .leftMouseDown {
        let p = event.location
        moveID &+= 1
        let mid = moveID

        switch state {
        case .roaming:
            if isClickOnChat(p.x, p.y) {
                // Click on chat widget → dock the avatar
                DispatchQueue.global(qos: .userInteractive).async { dockAnimation(mid) }
            } else {
                // Normal click → follow
                DispatchQueue.global(qos: .userInteractive).async { animateToClick(p.x, p.y, mid) }
            }
        case .docked:
            if isClickOnChat(p.x, p.y) {
                // Click INSIDE chat while docked → stay parked, do nothing
                break
            } else {
                // Click OUTSIDE chat → undock and fly to click
                DispatchQueue.global(qos: .userInteractive).async { undockAnimation(p.x, p.y, mid) }
            }
        case .docking, .undocking:
            break  // ignore clicks during transitions
        }
    }
    return Unmanaged.passUnretained(event)
}

// -- Main --
let mask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
           | CGEventMask(1 << CGEventType.tapDisabledByTimeout.rawValue)
           | CGEventMask(1 << CGEventType.tapDisabledByUserInput.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: mask,
    callback: tapCB, userInfo: nil
) else {
    FileHandle.standardError.write("Event tap failed. Grant Accessibility permission.\n".data(using: .utf8)!)
    exit(1)
}
eventTap = tap
let src = CFMachPortCreateRunLoopSource(nil, tap, 0)!
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// Sync initial position with actual avatar canvas
queryAvatar()
queryChat()

// Ensure correct z-order on startup: chat above avatar
ensureChatOnTop()

// Start background monitor (occlusion check while roaming)
startBackgroundMonitor()

FileHandle.standardError.write("""
    avatar-follower running.
      Click anywhere       → avatar follows (1.2s ease)
      Click chat widget    → avatar docks (surge → fly → spin-park)
      Click inside chat (docked) → stays parked
      Click outside chat (docked) → undock + fly to click
      Chat covers avatar   → escapes and parks
      Clicks pass through to apps (listen-only tap).
      Ctrl+C to stop.
    \n
    """.data(using: .utf8)!)
CFRunLoopRun()
