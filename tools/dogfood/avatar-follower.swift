// avatar-follower.swift — Click-following orchestrator for the avatar overlay.
//
// Adapted from the ball experiment (packages/heads-up/examples/click-follower.swift).
// Key lesson: CGEventTap in .listenOnly mode does NOT block clicks —
// clicks pass through to apps/desktop AND we receive them.
//
// Build:  swiftc -O -o avatar-follower avatar-follower.swift
// Run:    ./avatar-follower   (after avatar canvas exists)

import Foundation
import CoreGraphics

// -- Configuration --
let socketPath = NSString(string: "~/.config/heads-up/sock").expandingTildeInPath
let canvasID   = "avatar"
let canvasSize: Double = 300
let animDuration: Double = 1.2
let animFPS: Double = 60.0

// -- State --
var curX: Double = 700
var curY: Double = 1300
var moveID: UInt64 = 0

// -- Easing (same as ball experiment) --
func easeInOutCubic(_ t: Double) -> Double {
    t < 0.5 ? 4*t*t*t : 1 - pow(-2*t+2, 3)/2
}

// -- Unix socket helpers (from ball experiment) --
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

// -- Animation (from ball experiment, adapted for avatar) --
func animateTo(_ clickX: Double, _ clickY: Double, _ mid: UInt64) {
    let sx = curX, sy = curY
    // Center the canvas on the click point
    let tx = clickX - canvasSize / 2
    let ty = clickY - canvasSize / 2

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

// -- Event tap callback --
var eventTap: CFMachPort? = nil

func tapCB(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
           _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    // macOS disables the tap after certain UI events (page reloads, etc.)
    // Re-enable it immediately when that happens.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
            FileHandle.standardError.write("Event tap re-enabled.\n".data(using: .utf8)!)
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .leftMouseDown {
        let p = event.location
        moveID &+= 1
        let mid = moveID
        DispatchQueue.global(qos: .userInteractive).async {
            animateTo(p.x, p.y, mid)
        }
    }
    return Unmanaged.passUnretained(event)
}

// -- Main --
// Listen for clicks AND tap-disabled events so we can re-enable
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
eventTap = tap  // Store for re-enable in callback
let src = CFMachPortCreateRunLoopSource(nil, tap, 0)!
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
FileHandle.standardError.write("""
    avatar-follower running.
      Click anywhere → avatar follows (1.2s ease-in-out-cubic)
      Clicks pass through to apps (listen-only tap).
      Ctrl+C to stop.
    \n
    """.data(using: .utf8)!)
CFRunLoopRun()
