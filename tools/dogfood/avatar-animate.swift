// avatar-animate.swift -- Reusable animation primitives for avatar motion.
//
// Generalizes the frame-pump pattern from avatar-follower.swift into composable
// building blocks: runAnimation, moveTo, scaleTo, moveAndScale, orbit, holdPosition.

import Foundation

// -- Shared mutable state (position/size of the avatar canvas) --
var curX: Double = 0, curY: Double = 0, curSize: Double = 300
var moveID: UInt64 = 0

// -- Size constants --
let fullSize: Double   = 300
let surgeSize: Double  = 400
let dockedSize: Double = 40
let animFPS: Double    = 60.0

// -- Generic frame pump --
// Calls `body(t)` for t in [0,1] over `duration` seconds at `fps` frames/sec.
// body returns false to abort early.
func runAnimation(duration: Double, fps: Double = 60, body: @escaping (Double) -> Bool) {
    let n = Int(fps * duration)
    let t0 = Date()
    for i in 0...n {
        let t = Double(i) / Double(n)
        if !body(t) { break }
        let want = Double(i + 1) / fps
        let got = Date().timeIntervalSince(t0)
        if want > got { Thread.sleep(forTimeInterval: want - got) }
    }
}

// -- Position animation --
func moveTo(x: Double, y: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)]}")
        return true
    }
}

// -- Size animation --
func scaleTo(size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic) {
    let ss = curSize
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    runAnimation(duration: duration) { t in
        let e = easing(t)
        curSize = ss + (size - ss) * e
        sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)]}")
        return true
    }
}

// -- Combined move + scale --
func moveAndScale(x: Double, y: Double, size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY, ss = curSize
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        curSize = ss + (size - ss) * e
        sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)]}")
        return true
    }
}

// -- Orbit around a rectangle's perimeter --
func orbit(bounds: (x: Double, y: Double, w: Double, h: Double), duration: Double, laps: Int = 1) {
    let perimeter = 2 * (bounds.w + bounds.h)
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    runAnimation(duration: duration * Double(laps)) { t in
        let p = (t * Double(laps)).truncatingRemainder(dividingBy: 1.0) * perimeter
        var ox: Double, oy: Double
        if p < bounds.w {
            ox = bounds.x + p - curSize / 2; oy = bounds.y - curSize / 2
        } else if p < bounds.w + bounds.h {
            ox = bounds.x + bounds.w - curSize / 2; oy = bounds.y + (p - bounds.w) - curSize / 2
        } else if p < 2 * bounds.w + bounds.h {
            ox = bounds.x + bounds.w - (p - bounds.w - bounds.h) - curSize / 2; oy = bounds.y + bounds.h - curSize / 2
        } else {
            ox = bounds.x - curSize / 2; oy = bounds.y + bounds.h - (p - 2 * bounds.w - bounds.h) - curSize / 2
        }
        curX = ox; curY = oy
        sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(ox),\(oy),\(curSize),\(curSize)]}")
        return true
    }
}

// -- Smoothed follow: continuously track a moving target --
func holdPosition(getTarget: @escaping () -> (Double, Double)?, smoothing: Double = 0.15, shouldContinue: @escaping () -> Bool) {
    let fd = connectSock()
    guard fd >= 0 else { return }
    defer { close(fd) }
    while shouldContinue() {
        if let (tx, ty) = getTarget() {
            curX += (tx - curSize / 2 - curX) * smoothing
            curY += (ty - curSize / 2 - curY) * smoothing
            sendJSON(fd, "{\"action\":\"update\",\"id\":\"\(avatarID)\",\"at\":[\(curX),\(curY),\(curSize),\(curSize)]}")
        }
        Thread.sleep(forTimeInterval: 1.0 / 60.0)
    }
}
