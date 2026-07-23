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

var permissionState = InputTapPermissionState()
let permissionSnapshot = InputTapPermissionSnapshot(accessibility: true, listen: true, post: true)
permissionState.publish(
    permissionSnapshot,
    observedAtUptimeNanoseconds: 100,
    validForNanoseconds: 10
)
assert(permissionState.disposition(at: 110) == .authorized, "fresh complete permission snapshot must admit input")
assert(permissionState.disposition(at: 111) == .stale, "expired permission snapshot must fail open without claiming loss")
assert(!permissionState.lossDetected, "snapshot expiry must not latch permission loss")
permissionState.publish(permissionSnapshot, observedAtUptimeNanoseconds: 200)
assert(permissionState.disposition(at: 200) == .authorized, "a positive refresh must restore processing after expiry")
let permissionErrorAt = Date(timeIntervalSince1970: 1_234)
assert(permissionState.latchLoss(at: permissionErrorAt), "first permission loss must latch")
assert(permissionState.disposition(at: 205) == .lost, "latched permission loss must fail open")
assert(permissionState.lastErrorAt == permissionErrorAt, "permission loss must publish synchronized telemetry")
assert(!permissionState.latchLoss(at: Date()), "permission loss teardown must schedule exactly once")
permissionState.publish(permissionSnapshot, observedAtUptimeNanoseconds: 200)
assert(permissionState.disposition(at: 200) == .lost, "permission loss must remain latched until daemon restart")

var timeoutRecovery = InputTapTimeoutRecoveryState()
timeoutRecovery.installed()
let installedGeneration = timeoutRecovery.generation
timeoutRecovery.requireRecovery()
assert(
    !timeoutRecovery.consumeIfCurrent(authorized: false),
    "a negative permission probe must not re-enable a timeout-disabled tap"
)
assert(
    timeoutRecovery.consumeIfCurrent(authorized: true),
    "a positive permission probe must re-enable a timeout-disabled tap"
)
assert(
    !timeoutRecovery.consumeIfCurrent(authorized: true),
    "one timeout recovery request must re-enable at most once"
)
timeoutRecovery.requireRecovery()
timeoutRecovery.invalidate()
assert(timeoutRecovery.generation != installedGeneration, "tap retirement must advance its recovery generation")
assert(
    !timeoutRecovery.consumeIfCurrent(authorized: true),
    "tap retirement must cancel pending timeout recovery"
)

var observedSnapshots: [(InputTapPermissionSnapshot, UInt64)] = []
let monitor = InputTapPermissionMonitor(
    queue: DispatchQueue(label: "input-tap-monitor-test"),
    schedulesTimer: false,
    clock: { 500 },
    resolver: { permissionSnapshot },
    observer: { observedSnapshots.append(($0, $1)) }
)
monitor.start()
assert(monitor.isRunning, "permission monitor must report its active lifecycle")
monitor.probeNow()
assert(observedSnapshots.count == 1, "permission monitor must publish one injected observation")
assert(observedSnapshots.first?.0 == permissionSnapshot, "permission monitor must publish resolver state")
assert(observedSnapshots.first?.1 == 500, "permission monitor must publish the injected monotonic time")
monitor.stop()
monitor.probeNow()
assert(observedSnapshots.count == 1, "stopped permission monitor must not resolve or publish")

let resolverEntered = DispatchSemaphore(value: 0)
let releaseResolver = DispatchSemaphore(value: 0)
let probeFinished = DispatchSemaphore(value: 0)
var canceledObservationCount = 0
let delayedMonitor = InputTapPermissionMonitor(
    queue: DispatchQueue(label: "input-tap-monitor-delay-test"),
    schedulesTimer: false,
    resolver: {
        resolverEntered.signal()
        releaseResolver.wait()
        return permissionSnapshot
    },
    observer: { _, _ in canceledObservationCount += 1 }
)
delayedMonitor.start()
DispatchQueue.global(qos: .utility).async {
    delayedMonitor.probeNow()
    probeFinished.signal()
}
assert(resolverEntered.wait(timeout: .now() + 2) == .success, "delayed resolver must begin")
delayedMonitor.stop()
releaseResolver.signal()
assert(probeFinished.wait(timeout: .now() + 2) == .success, "canceled delayed resolver must unwind")
assert(canceledObservationCount == 0, "canceled in-flight resolver must not publish stale authorization")

let refreshResolverStarted = DispatchSemaphore(value: 0)
let releaseRefreshResolver = DispatchSemaphore(value: 0)
let refreshObserved = DispatchSemaphore(value: 0)
let refreshLock = NSLock()
var refreshResolverCount = 0
let refreshMonitor = InputTapPermissionMonitor(
    queue: DispatchQueue(label: "input-tap-monitor-refresh-test"),
    schedulesTimer: false,
    resolver: {
        refreshLock.lock()
        refreshResolverCount += 1
        refreshLock.unlock()
        refreshResolverStarted.signal()
        releaseRefreshResolver.wait()
        return permissionSnapshot
    },
    observer: { _, _ in refreshObserved.signal() }
)
refreshMonitor.start()
for _ in 0..<1_000 {
    refreshMonitor.requestProbe()
}
assert(
    refreshResolverStarted.wait(timeout: .now() + 2) == .success,
    "stale-event refresh must resolve asynchronously"
)
releaseRefreshResolver.signal()
assert(refreshObserved.wait(timeout: .now() + 2) == .success, "stale-event refresh must publish")
Thread.sleep(forTimeInterval: 0.02)
refreshLock.lock()
assert(refreshResolverCount == 1, "stale-event refresh requests must coalesce")
refreshLock.unlock()
refreshMonitor.stop()

let timerObserved = DispatchSemaphore(value: 0)
let timerLock = NSLock()
var timerResolutionCount = 0
var timerObservationCount = 0
let timerMonitor = InputTapPermissionMonitor(
    queue: DispatchQueue(label: "input-tap-monitor-timer-test"),
    initialDelay: .milliseconds(5),
    interval: .milliseconds(5),
    resolver: {
        timerLock.lock()
        timerResolutionCount += 1
        timerLock.unlock()
        return permissionSnapshot
    },
    observer: { _, _ in
        timerLock.lock()
        timerObservationCount += 1
        timerLock.unlock()
        timerObserved.signal()
    }
)
timerMonitor.start()
assert(timerObserved.wait(timeout: .now() + 2) == .success, "scheduled monitor must publish")
assert(timerObserved.wait(timeout: .now() + 2) == .success, "scheduled monitor must repeat")
timerMonitor.stop()
Thread.sleep(forTimeInterval: 0.03)
timerLock.lock()
let stoppedResolutionCount = timerResolutionCount
let stoppedObservationCount = timerObservationCount
timerLock.unlock()
Thread.sleep(forTimeInterval: 0.03)
timerLock.lock()
assert(timerResolutionCount == stoppedResolutionCount, "stopped timer must not resolve again")
assert(timerObservationCount == stoppedObservationCount, "stopped timer must not publish again")
timerLock.unlock()

let permissionGate = InputTapPermissionGate()
permissionGate.publish(
    permissionSnapshot,
    observedAtUptimeNanoseconds: 1_000,
    validForNanoseconds: 20_000
)
for tick in 1_000..<11_000 {
    assert(permissionGate.disposition(at: UInt64(tick)) == .authorized, "fresh gate reads must remain available")
}
assert(permissionGate.disposition(at: 21_001) == .stale, "expired gate reads must remain stale rather than latched")
assert(!permissionGate.lossDetected, "expired gate reads must not latch permission loss")
timerLock.lock()
assert(
    timerResolutionCount == stoppedResolutionCount,
    "event-path permission reads must not invoke the monitor resolver"
)
timerLock.unlock()

print("PASS input safety hotkeys")
SWIFT

CLANG_MODULE_CACHE_PATH="$TMP/module-cache" \
SWIFT_MODULE_CACHE_PATH="$TMP/module-cache" \
swiftc \
  "$ROOT/src/perceive/input-safety-hotkeys.swift" \
  "$ROOT/src/perceive/input-tap-permission-state.swift" \
  "$ROOT/src/daemon/input-safety-visual-feedback.swift" \
  "$TMP/main.swift" \
  -o "$TMP/test-input-safety-hotkeys"
"$TMP/test-input-safety-hotkeys"

if sed -n '/private func handleTapEvent/,/private func inputSafetyHotkeyEvent/p' "$ROOT/src/perceive/daemon.swift" |
  rg -n 'Process|shell|FileManager|aos log|log push|CanvasRequest|canvasManager|postMessage|sleep|Thread\\.sleep'; then
  echo "FAIL: event tap path must not perform shell, file, canvas, or sleep work" >&2
  exit 1
fi

python3 - "$ROOT/src/perceive/daemon.swift" <<'PY'
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
handle = re.search(r'private func handleTapEvent\(.*?private func inputSafetyHotkeyEvent', source, re.S)
if not handle:
    raise SystemExit("FAIL: could not find handleTapEvent section")
handle_text = handle.group(0)
for required in (
    "inputTapPermissionDisposition()",
    "requestInputTapPermissionRefresh()",
    "failOpenAfterInputTapPermissionLoss()",
    "return false",
):
    if required not in handle_text:
        raise SystemExit("FAIL: event tap path must fail open when TCC/input permissions disappear")
if handle_text.index("inputTapPermissionDisposition()") > handle_text.index("onInputEvent?"):
    raise SystemExit("FAIL: permission-loss guard must run before downstream input consumers")
if "case .stale:" not in handle_text or "case .lost:" not in handle_text:
    raise SystemExit("FAIL: event tap path must distinguish stale permission data from confirmed loss")
if "inputTapTimeoutRecovery.requireRecovery()" not in handle_text:
    raise SystemExit("FAIL: stale timeout recovery must be tracked before requesting a refresh")
if "CGPreflight" in handle_text or "resolveInputTapPermissions()" in handle_text:
    raise SystemExit("FAIL: the event-tap callback must not perform synchronous TCC preflight")
tap_disabled = handle_text.index("type == .tapDisabledByTimeout")
safety = handle_text.index("inputSafetyHotkeyState.classify")
if tap_disabled > safety:
    raise SystemExit("FAIL: tap-disable recovery must run before safety passthrough classification")
if "tapDisabledByUserInput" not in handle_text or "scheduleEventTapRetry()" not in handle_text:
    raise SystemExit("FAIL: user-disabled taps must retire and retry without claiming confirmed TCC loss")

start = re.search(r'private func startEventTap\(.*?private func teardownEventTap', source, re.S)
if not start:
    raise SystemExit("FAIL: could not find startEventTap section")
start_text = start.group(0)
if "guard startupPermissions.available else" not in start_text:
    raise SystemExit("FAIL: could not find input-tap startup permission guard")
if "failurePermissions.available" not in start_text:
    raise SystemExit("FAIL: tap-creation failure must recheck permission state before retry")

teardown = re.search(r'private func teardownEventTap\(.*?private func scheduleEventTapRetry', source, re.S)
if not teardown:
    raise SystemExit("FAIL: could not find teardownEventTap section")
teardown_text = teardown.group(0)
for required in ("CGEvent.tapEnable(tap: tap, enable: false)", "CFMachPortInvalidate(tap)", "eventTap = nil"):
    if required not in teardown_text:
        raise SystemExit("FAIL: input permission loss must disable only the event tap without stopping the daemon")

fail_open = re.search(r'private func failOpenAfterInputTapPermissionLoss\(.*?private func handleTapEvent', source, re.S)
if not fail_open:
    raise SystemExit("FAIL: could not find failOpenAfterInputTapPermissionLoss section")
fail_open_text = fail_open.group(0)
for required in ("cancelEventTapRetry()", "teardownEventTap()"):
    if required not in fail_open_text:
        raise SystemExit("FAIL: input permission loss must clear retries and tear down the event tap")
if "scheduleEventTapRetry()" in fail_open_text:
    raise SystemExit("FAIL: input permission loss must not schedule an event-tap retry loop")

observer = re.search(r'private func startInputTapPermissionMonitor\(.*?private func cancelInputTapPermissionMonitor', source, re.S)
if not observer:
    raise SystemExit("FAIL: could not find input permission monitor section")
observer_text = observer.group(0)
for required in (
    "DispatchQueue.main.async",
    "applyInputTapPermissionObservation(",
    "monitorGeneration: monitorGeneration",
):
    if required not in observer_text:
        raise SystemExit("FAIL: permission observations must enter the generation-bound main lifecycle queue")

apply_observation = re.search(
    r'private func applyInputTapPermissionObservation\(.*?private func failOpenAfterInputTapPermissionLoss',
    source,
    re.S,
)
if not apply_observation:
    raise SystemExit("FAIL: could not find permission observation application")
apply_text = apply_observation.group(0)
for required in (
    "monitorGeneration == inputTapPermissionMonitorGeneration",
    "publishInputTapPermissions(",
    "recoverTimedOutEventTapAfterPermissionRefresh()",
    "failOpenAfterInputTapPermissionLoss()",
):
    if required not in apply_text:
        raise SystemExit("FAIL: permission observation application must serialize recovery and loss")
if apply_text.index("publishInputTapPermissions(") > apply_text.index("recoverTimedOutEventTapAfterPermissionRefresh()"):
    raise SystemExit("FAIL: positive permission state must commit before timeout recovery")

teardown = re.search(r'private func teardownEventTap\(.*?private func scheduleEventTapRetry', source, re.S)
if "inputTapTimeoutRecovery.invalidate()" not in teardown.group(0):
    raise SystemExit("FAIL: event-tap teardown must invalidate pending timeout recovery")

log_failure = re.search(r'private func logEventTapFailure\(.*?private func resolveInputTapPermissions', source, re.S)
if not log_failure:
    raise SystemExit("FAIL: could not find logEventTapFailure section")
if "leaving tap unavailable until daemon restart" not in log_failure.group(0):
    raise SystemExit("FAIL: permission-loss logging must not claim a retry loop is running")
PY

if ! sed -n '/private func activateInputSafetyEmergencyExit/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'canvasManager\.setInputPassthrough\(true\)'; then
  echo "FAIL: input safety escape hatch must enable native canvas input passthrough before exit" >&2
  exit 1
fi

if ! sed -n '/private func activateInputSafetyEmergencyExit/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'perception\.stop\(\)'; then
  echo "FAIL: input safety escape hatch must stop the perception input tap" >&2
  exit 1
fi

if ! sed -n '/private func activateInputSafetyEmergencyExit/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'NSApp\.terminate\(nil\)'; then
  echo "FAIL: input safety escape hatch must terminate the daemon app" >&2
  exit 1
fi

if ! sed -n '/private func activateInputSafetyEmergencyExit/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'Darwin\.exit\(0\)'; then
  echo "FAIL: input safety escape hatch must include a process-exit fallback" >&2
  exit 1
fi

if sed -n '/private func activateInputSafetyEmergencyExit/,/private func handleInputEvent/p' "$ROOT/src/daemon/unified.swift" |
  rg -q 'setInputPassthrough\(false\)|inputSafetyVisualFeedbackPresenter\.trigger'; then
  echo "FAIL: input safety escape hatch must not re-enable capture or create feedback UI before exit" >&2
  exit 1
fi

python3 - "$ROOT/scripts/aos-service.mjs" <<'PY'
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
plist = re.search(r"function plistXML\(paths\).*?function writeServicePlist", source, re.S)
if not plist:
    raise SystemExit("FAIL: could not find aos-service plistXML section")
text = plist.group(0)
if "KeepAlive: false" not in text:
    raise SystemExit("FAIL: AOS launch agent plist must not KeepAlive-respawn the daemon")
if "KeepAlive: true" in text:
    raise SystemExit("FAIL: AOS launch agent plist must not contain KeepAlive: true")
PY

if ! sed -n '/func stop()/,/MARK: - CGEventTap/p' "$ROOT/src/perceive/daemon.swift" |
  rg -q 'teardownEventTap\(\)'; then
  echo "FAIL: PerceptionEngine.stop must tear down the global event tap" >&2
  exit 1
fi
