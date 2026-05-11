// input-safety-hotkeys.swift — Pure input safety shortcut logic.

import CoreGraphics
import Foundation

let aosInputSafetyEscapeKeyCode: Int64 = 53
let aosInputSafetyForceQuitTrigger = "cmd_opt_escape"

struct InputSafetyModifierSnapshot {
    let cmd: Bool
    let opt: Bool

    init(cmd: Bool, opt: Bool) {
        self.cmd = cmd
        self.opt = opt
    }

    init(flags: CGEventFlags) {
        self.cmd = flags.contains(.maskCommand)
        self.opt = flags.contains(.maskAlternate)
    }
}

enum InputSafetyHotkeyEventKind {
    case keyDown
    case keyUp
    case other
}

struct InputSafetyHotkeyEvent {
    let kind: InputSafetyHotkeyEventKind
    let keyCode: Int64?
    let modifiers: InputSafetyModifierSnapshot
}

struct InputSafetyHotkeyDecision {
    let passThrough: Bool
    let triggered: Bool
    let active: Bool
    let deadline: Date?
}

struct InputSafetyHotkeySnapshot {
    let active: Bool
    let until: Date?
    let trigger: String?
    let triggerCount: Int
}

final class InputSafetyHotkeyState {
    private let lock = NSLock()
    private let window: TimeInterval
    private var deadline: Date?
    private var lastTrigger: String?
    private var triggerCount: Int = 0

    init(window: TimeInterval = 12.0) {
        self.window = window
    }

    func classify(_ event: InputSafetyHotkeyEvent, now: Date = Date()) -> InputSafetyHotkeyDecision {
        lock.lock()
        defer { lock.unlock() }

        if isForceQuitChord(event) {
            triggerCount += 1
            lastTrigger = aosInputSafetyForceQuitTrigger
            deadline = now.addingTimeInterval(window)
            return InputSafetyHotkeyDecision(passThrough: true, triggered: true, active: true, deadline: deadline)
        }

        if let deadline, now < deadline {
            return InputSafetyHotkeyDecision(passThrough: true, triggered: false, active: true, deadline: deadline)
        }

        return InputSafetyHotkeyDecision(passThrough: false, triggered: false, active: false, deadline: nil)
    }

    func snapshot(now: Date = Date()) -> InputSafetyHotkeySnapshot {
        lock.lock()
        defer { lock.unlock() }

        let active = deadline.map { now < $0 } ?? false
        return InputSafetyHotkeySnapshot(
            active: active,
            until: deadline,
            trigger: lastTrigger,
            triggerCount: triggerCount
        )
    }
}

func isForceQuitChord(_ event: InputSafetyHotkeyEvent) -> Bool {
    switch event.kind {
    case .keyDown, .keyUp:
        break
    case .other:
        return false
    }
    guard event.keyCode == aosInputSafetyEscapeKeyCode else { return false }
    return event.modifiers.cmd && event.modifiers.opt
}
