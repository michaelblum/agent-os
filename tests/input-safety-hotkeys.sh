#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import CoreGraphics
import Foundation

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

let now = Date(timeIntervalSince1970: 1_000)
let cmdOptEscapeDown = InputSafetyHotkeyEvent(
    kind: .keyDown,
    keyCode: aosInputSafetyEscapeKeyCode,
    modifiers: InputSafetyModifierSnapshot(cmd: true, opt: true)
)
let cmdOptEscapeUp = InputSafetyHotkeyEvent(
    kind: .keyUp,
    keyCode: aosInputSafetyEscapeKeyCode,
    modifiers: InputSafetyModifierSnapshot(cmd: true, opt: true)
)
let cmdEscape = InputSafetyHotkeyEvent(
    kind: .keyDown,
    keyCode: aosInputSafetyEscapeKeyCode,
    modifiers: InputSafetyModifierSnapshot(cmd: true, opt: false)
)
let optEscape = InputSafetyHotkeyEvent(
    kind: .keyDown,
    keyCode: aosInputSafetyEscapeKeyCode,
    modifiers: InputSafetyModifierSnapshot(cmd: false, opt: true)
)
let ordinaryKey = InputSafetyHotkeyEvent(
    kind: .keyDown,
    keyCode: 0,
    modifiers: InputSafetyModifierSnapshot(cmd: false, opt: false)
)
let ordinaryMouse = InputSafetyHotkeyEvent(
    kind: .other,
    keyCode: nil,
    modifiers: InputSafetyModifierSnapshot(cmd: false, opt: false)
)

assert(isForceQuitChord(cmdOptEscapeDown), "Option+Command+Escape keyDown must be an input safety trigger")
assert(isForceQuitChord(cmdOptEscapeUp), "Option+Command+Escape keyUp must be an input safety trigger")
assert(!isForceQuitChord(cmdEscape), "Command+Escape without Option must not be an input safety trigger")
assert(!isForceQuitChord(optEscape), "Option+Escape without Command must not be an input safety trigger")
assert(!isForceQuitChord(ordinaryMouse), "non-key events must not be input safety triggers")

let state = InputSafetyHotkeyState(window: 12)
let initial = state.classify(cmdOptEscapeDown, now: now)
assert(initial.passThrough, "trigger keyDown must pass through")
assert(initial.triggered, "trigger keyDown must be reported as triggered")
assert(initial.active, "trigger keyDown must activate input safety passthrough")

let keyUpState = InputSafetyHotkeyState(window: 12)
let keyUpInitial = keyUpState.classify(cmdOptEscapeUp, now: now)
assert(keyUpInitial.passThrough, "trigger keyUp must pass through")
assert(keyUpInitial.triggered, "trigger keyUp must be reported as triggered")
assert(keyUpInitial.active, "trigger keyUp must activate input safety passthrough")

let mouseDuringSafetyWindow = state.classify(ordinaryMouse, now: now.addingTimeInterval(2))
assert(mouseDuringSafetyWindow.passThrough, "ordinary mouse events during input safety passthrough must pass through")
assert(!mouseDuringSafetyWindow.triggered, "ordinary mouse events during input safety passthrough must not retrigger")
assert(mouseDuringSafetyWindow.active, "ordinary mouse events during input safety passthrough must report active")

let keyDuringSafetyWindow = state.classify(ordinaryKey, now: now.addingTimeInterval(3))
let downstreamWouldConsume = true
let consumedAfterSafetyBypass = keyDuringSafetyWindow.passThrough ? false : downstreamWouldConsume
assert(keyDuringSafetyWindow.passThrough, "ordinary key events during input safety passthrough must pass through")
assert(!consumedAfterSafetyBypass, "downstream consume decisions must be ignored during input safety passthrough")

let firstDeadline = state.snapshot(now: now.addingTimeInterval(3)).until
let repeated = state.classify(cmdOptEscapeUp, now: now.addingTimeInterval(5))
assert(repeated.passThrough && repeated.triggered && repeated.active, "repeated trigger keyUp must pass through and extend input safety passthrough")
let secondSnapshot = state.snapshot(now: now.addingTimeInterval(5))
assert(secondSnapshot.trigger == aosInputSafetyForceQuitTrigger, "input safety trigger name must be recorded")
assert(secondSnapshot.triggerCount == 2, "input safety trigger count must increment on repeated trigger")
assert(secondSnapshot.until! > firstDeadline!, "repeated trigger must extend deadline")

let expired = state.classify(ordinaryKey, now: now.addingTimeInterval(30))
assert(!expired.passThrough, "ordinary key after input safety deadline must no longer force passthrough")
assert(!expired.active, "ordinary key after input safety deadline must not report active")

final class FakeVisualRuntime: InputSafetyVisualFeedbackRuntime {
    var exists: Bool
    var createSucceeds: Bool
    var createCount = 0
    var resumeCount = 0
    var frontCount = 0
    var removeCount = 0
    var countdowns: [(remaining: Int, active: Bool)] = []

    init(exists: Bool, createSucceeds: Bool = true) {
        self.exists = exists
        self.createSucceeds = createSucceeds
    }

    func logConsoleExists() -> Bool { exists }
    func createLogConsole() -> Bool {
        createCount += 1
        if createSucceeds { exists = true }
        return createSucceeds
    }
    func resumeLogConsole() { resumeCount += 1 }
    func bringLogConsoleForward() { frontCount += 1 }
    func sendCountdown(remaining: Int, deadline: Date, active: Bool) {
        countdowns.append((remaining: remaining, active: active))
    }
    func removeLogConsole() {
        removeCount += 1
        exists = false
    }
}

let existingRuntime = FakeVisualRuntime(exists: true)
let existingPresenter = InputSafetyVisualFeedbackPresenter(runtime: existingRuntime)
existingPresenter.trigger(deadline: now.addingTimeInterval(12), now: now)
assert(existingRuntime.createCount == 0, "existing __log__ must be reused without creating a duplicate")
assert(existingRuntime.resumeCount == 1, "existing __log__ must be resumed")
assert(existingRuntime.frontCount == 1, "existing __log__ must be brought forward")
assert(existingRuntime.countdowns.last?.remaining == 12, "existing __log__ must receive the initial countdown")
existingPresenter.tick(now: now.addingTimeInterval(13))
assert(existingRuntime.removeCount == 0, "pre-existing __log__ must not be removed after countdown")
assert(existingPresenter.snapshot().cleanupComplete == false, "pre-existing __log__ cleanup must not be reported complete")

let missingRuntime = FakeVisualRuntime(exists: false)
let missingPresenter = InputSafetyVisualFeedbackPresenter(runtime: missingRuntime)
missingPresenter.trigger(deadline: now.addingTimeInterval(12), now: now)
assert(missingRuntime.createCount == 1, "missing __log__ must be created for countdown feedback")
assert(missingPresenter.snapshot().createdLogConsole, "presenter must record daemon-created __log__")
missingPresenter.tick(now: now.addingTimeInterval(13))
assert(missingRuntime.removeCount == 1, "daemon-created __log__ must be removed after countdown")
assert(missingPresenter.snapshot().cleanupComplete, "daemon-created __log__ cleanup must be reported complete")

let repeatedRuntime = FakeVisualRuntime(exists: false)
let repeatedPresenter = InputSafetyVisualFeedbackPresenter(runtime: repeatedRuntime)
repeatedPresenter.trigger(deadline: now.addingTimeInterval(12), now: now)
repeatedPresenter.trigger(deadline: now.addingTimeInterval(20), now: now)
let repeatedSnapshot = repeatedPresenter.snapshot()
assert(repeatedRuntime.createCount == 1, "repeated triggers must not create duplicate log consoles")
assert(repeatedSnapshot.active, "repeated trigger must keep visual feedback active")
assert(repeatedSnapshot.lastDisplayedRemaining == 20, "repeated trigger must restart countdown from the extended deadline")
repeatedPresenter.tick(now: now.addingTimeInterval(21))
assert(repeatedRuntime.removeCount == 1, "repeated countdown must still have one cleanup")

let failingRuntime = FakeVisualRuntime(exists: false, createSucceeds: false)
let failingPresenter = InputSafetyVisualFeedbackPresenter(runtime: failingRuntime)
failingPresenter.trigger(deadline: now.addingTimeInterval(12), now: now)
assert(failingRuntime.createCount == 1, "visual feedback should attempt log console creation")
assert(failingRuntime.countdowns.last?.remaining == 12, "visual feedback should still attempt countdown delivery after create failure")
failingPresenter.tick(now: now.addingTimeInterval(13))
let classificationAfterVisualFailure = InputSafetyHotkeyState(window: 12).classify(cmdOptEscapeDown, now: now)
assert(classificationAfterVisualFailure.passThrough, "visual feedback failure must not change passthrough classification")

print("PASS input safety hotkeys")
SWIFT

swiftc "$ROOT/src/perceive/input-safety-hotkeys.swift" "$ROOT/src/daemon/input-safety-visual-feedback.swift" "$TMP/main.swift" -o "$TMP/test-input-safety-hotkeys"
"$TMP/test-input-safety-hotkeys"

if sed -n '/private func handleTapEvent/,/private func inputSafetyHotkeyEvent/p' "$ROOT/src/perceive/daemon.swift" |
  rg -n 'Process|shell|FileManager|aos log|log push|CanvasRequest|canvasManager|postMessage|sleep|Thread\\.sleep'; then
  echo "FAIL: event tap path must not perform shell, file, canvas, or sleep work" >&2
  exit 1
fi

if ! sed -n '/private func activateInputSafetyPassthrough/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'canvasManager\.setInputPassthrough\(true\)'; then
  echo "FAIL: input safety trigger must enable native canvas input passthrough" >&2
  exit 1
fi

if ! sed -n '/private func activateInputSafetyPassthrough/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'canvasManager\.setInputPassthrough\(false\)'; then
  echo "FAIL: input safety trigger must restore native canvas input passthrough" >&2
  exit 1
fi
