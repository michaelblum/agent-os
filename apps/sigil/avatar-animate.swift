// avatar-animate.swift -- Reusable animation primitives for avatar motion.
//
// Uses DaemonSession from shared/swift/ipc/ for persistent connections
// during animation loops.

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

/// Helper: update avatar position on a persistent session.
/// Uses sendAndReceive (not sendOnly) to drain the daemon's response and
/// prevent socket buffer backlog during sustained 60fps animation loops.
func sendAvatarUpdate(_ session: DaemonSession) {
    session.sendAndReceive([
        "action": "update",
        "id": avatarID,
        "at": [curX, curY, curSize, curSize]
    ])
}

// -- Position animation --
func moveTo(x: Double, y: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Size animation --
func scaleTo(size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic) {
    let ss = curSize
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        let e = easing(t)
        curSize = ss + (size - ss) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Combined move + scale --
func moveAndScale(x: Double, y: Double, size: Double, duration: Double, easing: @escaping EasingFn = easeInOutCubic, mid: UInt64? = nil) {
    let sx = curX, sy = curY, ss = curSize
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    runAnimation(duration: duration) { t in
        if let mid = mid, moveID != mid { return false }
        let e = easing(t)
        curX = sx + (x - sx) * e
        curY = sy + (y - sy) * e
        curSize = ss + (size - ss) * e
        sendAvatarUpdate(session)
        return true
    }
}

// -- Orbit around a rectangle's perimeter --
func orbit(bounds: (x: Double, y: Double, w: Double, h: Double), duration: Double, laps: Int = 1) {
    let perimeter = 2 * (bounds.w + bounds.h)
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
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
        sendAvatarUpdate(session)
        return true
    }
}

// -- Smoothed follow: continuously track a moving target --
func holdPosition(getTarget: @escaping () -> (Double, Double)?, smoothing: Double = 0.15, shouldContinue: @escaping () -> Bool) {
    let session = DaemonSession()
    guard session.connect() else { return }
    defer { session.disconnect() }
    while shouldContinue() {
        if let (tx, ty) = getTarget() {
            curX += (tx - curSize / 2 - curX) * smoothing
            curY += (ty - curSize / 2 - curY) * smoothing
            sendAvatarUpdate(session)
        }
        Thread.sleep(forTimeInterval: 1.0 / 60.0)
    }
}
