// avatar-follower.swift — Click-following orchestrator for the avatar overlay.
//
// Adapted from the ball experiment (packages/heads-up/examples/click-follower.swift).
// Key lesson: CGEventTap in .listenOnly mode does NOT block clicks —
// clicks pass through to apps/desktop AND we receive them.
//
// States:
//   .roaming  — avatar follows clicks freely
//   .docking  — multi-phase animation: fly → settle → spin-down → park
//   .docked   — avatar is parked as the chat widget's icon
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
let dockedSize: Double = 40      // parked icon size
let animFPS: Double    = 60.0

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

// -- Query chat widget position --
func queryChat() {
    let fd = connectSock()
    guard fd >= 0 else { return }
    let req = "{\"action\":\"list\"}\n"
    req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }
    var buf = [UInt8](repeating: 0, count: 8192)
    let n = read(fd, &buf, buf.count)
    close(fd)
    guard n > 0 else { return }
    let str = String(bytes: buf[0..<n], encoding: .utf8) ?? ""
    // Parse: the list response has "at" BEFORE "id" for each canvas entry.
    // Format: {"at":[x,y,w,h],"id":"agent-chat",...}
    // Find "agent-chat" and look BACKWARDS for the preceding "at".
    if let idRange = str.range(of: "\"id\":\"agent-chat\"") {
        let before = str[str.startIndex..<idRange.lowerBound]
        if let atRange = before.range(of: "\"at\":[", options: .backwards) {
            let nums = str[atRange.upperBound...]
            if let endBracket = nums.firstIndex(of: "]") {
                let coordStr = String(nums[..<endBracket])
                let parts = coordStr.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
                if parts.count >= 4 {
                    chatX = parts[0]; chatY = parts[1]; chatW = parts[2]; chatH = parts[3]
                    FileHandle.standardError.write("Chat position: (\(chatX), \(chatY), \(chatW), \(chatH))\n".data(using: .utf8)!)
                }
            }
        }
    }
}

// -- Hit test: is click inside chat widget? --
func isClickOnChat(_ px: Double, _ py: Double) -> Bool {
    // Account for the 16px inset of the card within the canvas
    return px >= chatX && px < chatX + chatW && py >= chatY && py < chatY + chatH
}

// -- Animate position + size --
func animateFrame(_ fd: Int32, x: Double, y: Double, size: Double) {
    curX = x; curY = y; curSize = size
    sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(x),\(y),\(size),\(size)]}")
}

func timedLoop(_ fd: Int32, frames: Int, duration: Double, _ body: (Double) -> Void) {
    let t0 = Date()
    for i in 0...frames {
        guard moveID == moveID else { break } // placeholder for cancellation
        let t = Double(i) / Double(frames)
        body(t)
        let want = Double(i + 1) / (Double(frames) / duration)
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
}

// -- ROAMING: follow click --
func animateToClick(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    let sx = curX, sy = curY, ss = curSize
    let tx = clickX - fullSize / 2
    let ty = clickY - fullSize / 2
    let duration = 1.2

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
        let s = ss + (fullSize - ss) * e  // restore to full size if undocking
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
}

// -- DOCKING: multi-phase animation --
func dockAnimation(_ mid: UInt64) {
    state = .docking
    queryChat()  // get latest chat position

    let fd = connectSock()
    guard fd >= 0 else { state = .roaming; return }
    defer { close(fd) }

    let sx = curX, sy = curY, ss = curSize

    // Speed up spin during dock
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.06;\"}")
    // Query dot position from chat DOM — the dot element's center in viewport coords.
    // Viewport coords = canvas CG coords on scale=1 displays.
    var dotCX = 25.0, dotCY = 21.5  // fallback (measured)
    let evalFD = connectSock()
    if evalFD >= 0 {
        let js = "var r=document.getElementById('dot').getBoundingClientRect();r.left+r.width/2+','+( r.top+r.height/2)"
        let evalReq = "{\"action\":\"eval\",\"id\":\"\(chatID)\",\"js\":\"\(js)\"}\n"
        evalReq.withCString { ptr in _ = write(evalFD, ptr, strlen(ptr)) }
        var evalBuf = [UInt8](repeating: 0, count: 4096)
        let evalN = read(evalFD, &evalBuf, evalBuf.count)
        close(evalFD)
        if evalN > 0, let evalStr = String(bytes: evalBuf[0..<evalN], encoding: .utf8) {
            // Response: {"status":"success","result":"25,21.5"}
            if let rRange = evalStr.range(of: "\"result\":\""),
               let rEnd = evalStr[rRange.upperBound...].firstIndex(of: "\"") {
                let coords = String(evalStr[rRange.upperBound..<rEnd])
                let parts = coords.split(separator: ",")
                if parts.count == 2, let x = Double(parts[0]), let y = Double(parts[1]) {
                    dotCX = x; dotCY = y
                    FileHandle.standardError.write("Dot position: (\(dotCX), \(dotCY))\n".data(using: .utf8)!)
                }
            }
        }
    }
    // Global CG target: canvas origin + dot viewport offset, centered for docked size
    let iconX = chatX + dotCX - dockedSize / 2
    let iconY = chatY + dotCY - dockedSize / 2
    FileHandle.standardError.write("Dock target: (\(iconX), \(iconY)) from chat(\(chatX),\(chatY)) + dot(\(dotCX),\(dotCY))\n".data(using: .utf8)!)
    // Single smooth animation: fly + shrink to dot (1.5s)
    let dockFrames = Int(animFPS * 1.5)

    let t0 = Date()
    for i in 0...dockFrames {
        guard moveID == mid else { state = .roaming; return }
        let t = Double(i) / Double(dockFrames)
        let e = easeInOutCubic(t)
        let x = sx + (iconX - sx) * e
        let y = sy + (iconY - sy) * e
        let s = ss + (dockedSize - ss) * e
        animateFrame(fd, x: x, y: y, size: s)
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }

    // Slow spin back down, reduce bob for docked state
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.005; state.bobAmplitude = 0.03;\"}")

    state = .docked
    FileHandle.standardError.write("Docked as icon.\n".data(using: .utf8)!)
}

// -- UNDOCKING: expand from icon and fly to click --
func undockAnimation(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    state = .undocking

    let fd = connectSock()
    guard fd >= 0 else { state = .docked; return }
    defer { close(fd) }

    // Phase 1: Expand from docked size back to full (0.6s)
    let sx = curX, sy = curY
    let expandX = chatX + chatW / 2 - fullSize / 2
    let expandY = chatY - fullSize * 0.3
    let phase1Frames = Int(animFPS * 0.6)

    // Speed up spin during expansion
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.06; state.bobAmplitude = 0.15;\"}")

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

    // Slow spin back to normal
    sendOneShot("{\"action\":\"eval\",\"id\":\"\(avatarID)\",\"js\":\"state.idleSpinSpeed = 0.008;\"}")

    // Phase 2: Fly to click target (reuse roaming animation)
    state = .roaming
    animateToClick(clickX, clickY, mid)
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
            // Any click while docked → undock and fly to click
            DispatchQueue.global(qos: .userInteractive).async { undockAnimation(p.x, p.y, mid) }
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
FileHandle.standardError.write("""
    avatar-follower running.
      Click anywhere    → avatar follows (1.2s ease)
      Click chat widget → avatar docks as icon (3-phase animation)
      Click while docked → undock + fly to click
      Clicks pass through to apps (listen-only tap).
      Ctrl+C to stop.
    \n
    """.data(using: .utf8)!)
CFRunLoopRun()
