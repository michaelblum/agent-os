// click-follower.swift — Orchestration demo for heads-up serve mode
//
// Monitors global mouse clicks via CGEventTap (listen-only, requires Accessibility).
// Moves a heads-up canvas to wherever the user clicks, with eased animation.
// Click the ball to park it in the display corner. Click it again to unpark.
//
// This is a "molecule" — a higher-order function composed from atomic tools:
//   - side-eye: display topology (hardcoded here, should be queried)
//   - heads-up: canvas create/update (via Unix socket)
//   - CGEventTap: global input monitoring
//
// Build:  swiftc -O -o click-follower click-follower.swift
// Run:    ./click-follower   (after heads-up canvas "ball" exists)
//
// Lessons from development:
//   - Canvas positions use CG coordinates (top-left origin, Y-down)
//   - "Displays have separate Spaces" (macOS default) prevents windows from
//     spanning displays AND remaps coordinates on cross-display moves
//   - Moving a canvas across display boundaries may cause position jumps;
//     for reliable cross-display animation, use one canvas per display
//     with viewport slicing (see multi-display-ball.py)
//   - Clicking bare desktop triggers "reveal desktop" which hides windows;
//     use .statusBar level + .stationary collection behavior to survive this
//   - CGEventTap in .listenOnly mode doesn't block or modify events

import Foundation
import CoreGraphics

// -- Display geometry (from side-eye list) --
// TODO: Query dynamically via `side-eye list` instead of hardcoding
struct Display {
    let x, y, w, h: Double
    var parkX: Double { x + w - 180 }   // 20px from right edge
    var parkY: Double { y + 50 }         // 50px from top (clears menu bar)
    func contains(_ px: Double, _ py: Double) -> Bool {
        px >= x && px < x + w && py >= y && py < y + h
    }
}

let displays = [
    Display(x: -1920, y: 171, w: 1920, h: 1200),  // Left (HP E241i)
    Display(x: 0,     y: 0,   w: 1512, h: 982),    // Mid (Built-in Retina)
    Display(x: 1512,  y: 82,  w: 1920, h: 1080),   // Right (HDMI)
]

// -- Configuration --
let socketPath = NSString(string: "~/.config/heads-up/sock").expandingTildeInPath
let canvasID   = "ball"
let canvasSize: Double = 160
let ballRadius: Double = 45   // click hit area (slightly larger than visual 30px)
let animDuration: Double = 1.5
let animFPS: Double = 60.0

// -- State --
var curX: Double = 2412       // current canvas CG x (must match initial --at)
var curY: Double = 562        // current canvas CG y
var moveID: UInt64 = 0        // animation cancellation token
var parked = false

// -- Easing --
func easeInOutCubic(_ t: Double) -> Double {
    t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
}

// -- Unix socket helpers --
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
    var buf = [UInt8](repeating: 0, count: 512)
    _ = read(fd, &buf, buf.count)
}

// -- Animation --
func animateTo(_ tx: Double, _ ty: Double, _ mid: UInt64) {
    let sx = curX, sy = curY
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    let n = Int(animFPS * animDuration)
    let t0 = Date()
    for i in 0...n {
        guard moveID == mid else { break }
        let t = Double(i) / Double(n)
        let e = easeInOutCubic(t)
        let x = sx + (tx - sx) * e
        let y = sy + (ty - sy) * e
        curX = x; curY = y
        sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(canvasID)\",\"at\":[\(x),\(y),\(canvasSize),\(canvasSize)]}")
        let want = Double(i + 1) / animFPS
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
}

// -- Hit testing --
func isClickOnBall(_ cx: Double, _ cy: Double) -> Bool {
    let dx = cx - (curX + canvasSize / 2)
    let dy = cy - (curY + canvasSize / 2)
    return (dx * dx + dy * dy) <= ballRadius * ballRadius
}

func displayContaining(_ x: Double, _ y: Double) -> Display {
    return displays.first { $0.contains(x, y) } ?? displays[1]
}

// -- Event tap callback --
func tapCB(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
           _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .leftMouseDown {
        let p = event.location

        if isClickOnBall(p.x, p.y) {
            if parked {
                parked = false
                FileHandle.standardError.write("Unparked.\n".data(using: .utf8)!)
            } else {
                parked = true
                let disp = displayContaining(curX + canvasSize/2, curY + canvasSize/2)
                moveID &+= 1
                let mid = moveID
                DispatchQueue.global(qos: .userInteractive).async {
                    animateTo(disp.parkX, disp.parkY, mid)
                }
            }
        } else if !parked {
            moveID &+= 1
            let mid = moveID
            let tx = p.x - canvasSize/2, ty = p.y - canvasSize/2
            DispatchQueue.global(qos: .userInteractive).async { animateTo(tx, ty, mid) }
        }
    }
    return Unmanaged.passUnretained(event)
}

// -- Main --
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.leftMouseDown.rawValue),
    callback: tapCB, userInfo: nil
) else {
    FileHandle.standardError.write("Event tap failed. Grant Accessibility permission.\n".data(using: .utf8)!)
    exit(1)
}
let src = CFMachPortCreateRunLoopSource(nil, tap, 0)!
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("""
    click-follower running.
      Click anywhere  → ball follows (1.5s ease-in-out-cubic)
      Click on ball   → parks to display corner
      Click parked    → unparks
      Ctrl+C to stop.
    \n
    """.data(using: .utf8)!)
CFRunLoopRun()
