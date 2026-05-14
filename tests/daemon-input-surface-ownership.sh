#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if grep -E "sigil_input_mode|SigilInputState|shouldConsumeSigilInputEvent|isPointOnSigilAvatar|updateSigilCanvasState" "$ROOT/src/daemon/unified.swift" >/dev/null; then
    echo "FAIL: daemon unified.swift must not contain Sigil product input state"
    exit 1
fi
echo "PASS daemon unified.swift has no Sigil product input state"

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation
import CoreGraphics

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

let point = CGPoint(x: 25, y: 25)
let baseFrame = CGRect(x: 0, y: 0, width: 100, height: 100)

let nonInteractive = AOSInputSurfaceRecord(id: "label", nativeFrame: baseFrame, interactive: false)
assert(frontmostHittableAOSSurface(at: point, surfaces: [nonInteractive]).shouldConsume == false, "non-interactive surface must not consume")

let suspended = AOSInputSurfaceRecord(id: "panel", nativeFrame: baseFrame, interactive: true, suspended: true)
assert(frontmostHittableAOSSurface(at: point, surfaces: [suspended]).shouldConsume == false, "suspended surface must not consume")

let clickThrough = AOSInputSurfaceRecord(id: "ghost", nativeFrame: baseFrame, interactive: true, clickThrough: true)
assert(frontmostHittableAOSSurface(at: point, surfaces: [clickThrough]).shouldConsume == false, "click-through surface must not consume")

let low = AOSInputSurfaceRecord(id: "low", nativeFrame: baseFrame, interactive: true, windowLevel: "floating", windowNumber: 11)
let high = AOSInputSurfaceRecord(id: "high", nativeFrame: baseFrame, interactive: true, windowLevel: "screen_saver", windowNumber: 12)
if case .surface(let winner) = frontmostHittableAOSSurface(at: point, surfaces: [low, high]) {
    assert(winner.id == "high", "higher window level should win without window order")
} else {
    assert(false, "expected high-level winner")
}

if case .surface(let winner) = frontmostHittableAOSSurface(at: point, surfaces: [low, high], frontToBackWindowNumbers: [11, 12]) {
    assert(winner.id == "low", "known front-to-back native window order should win over level rank")
} else {
    assert(false, "expected native-order winner")
}

if case .surface(let winner) = frontmostHittableAOSSurface(at: point, surfaces: [low, high], frontToBackWindowNumbers: [11]) {
    assert(winner.id == "high", "higher window level should win when native order is incomplete")
} else {
    assert(false, "expected higher-level winner with incomplete native order")
}

let a = AOSInputSurfaceRecord(id: "a", nativeFrame: baseFrame, interactive: true, windowLevel: "floating")
let b = AOSInputSurfaceRecord(id: "b", nativeFrame: baseFrame, interactive: true, windowLevel: "floating")
if case .ambiguous(let tied) = frontmostHittableAOSSurface(at: point, surfaces: [a, b]) {
    assert(tied.map(\.id).sorted() == ["a", "b"], "ambiguous overlap should report both tied surfaces")
} else {
    assert(false, "same-level overlap without window order must be ambiguous")
}

let known = AOSInputSurfaceRecord(id: "known", nativeFrame: baseFrame, interactive: true, windowLevel: "floating", windowNumber: 99)
let unknown = AOSInputSurfaceRecord(id: "unknown", nativeFrame: baseFrame, interactive: true, windowLevel: "floating")
if case .ambiguous(let tied) = frontmostHittableAOSSurface(at: point, surfaces: [known, unknown], frontToBackWindowNumbers: [99]) {
    assert(tied.map(\.id).sorted() == ["known", "unknown"], "same-level overlap with incomplete window order must stay ambiguous")
} else {
    assert(false, "incomplete same-level native order must be ambiguous")
}

let registry = AOSInputRegionRegistry()
let lowRegion = AOSInputRegionRecord(
    id: "low-region",
    ownerCanvasID: "stage",
    nativeFrame: baseFrame,
    semanticLabel: "Low region",
    priority: 1
)
let highRegion = AOSInputRegionRecord(
    id: "high-region",
    ownerCanvasID: "stage",
    nativeFrame: baseFrame,
    semanticLabel: "High region",
    priority: 10,
    consumePolicy: "captured"
)
registry.register(lowRegion)
registry.register(highRegion)

if let route = registry.route(eventType: "left_mouse_down", point: point) {
    assert(route.region.id == "high-region", "highest-priority region should receive pointer down")
    assert(route.phase == "down", "pointer down should route as down phase")
    assert(route.shouldConsume, "captured policy should consume pointer down")
} else {
    assert(false, "expected region route on pointer down")
}

if let route = registry.route(eventType: "left_mouse_dragged", point: CGPoint(x: 500, y: 500)) {
    assert(route.region.id == "high-region", "captured region should receive drag outside frame")
    assert(route.captured, "drag should be marked captured")
    assert(route.shouldConsume, "captured drag should consume")
} else {
    assert(false, "expected captured drag route")
}

if let route = registry.route(eventType: "left_mouse_up", point: CGPoint(x: 500, y: 500)) {
    assert(route.region.id == "high-region", "captured region should receive up outside frame")
    assert(route.phase == "up", "pointer up should route as up phase")
} else {
    assert(false, "expected captured up route")
}

let neverRegion = AOSInputRegionRecord(
    id: "never-region",
    ownerCanvasID: "stage",
    nativeFrame: CGRect(x: 200, y: 200, width: 20, height: 20),
    consumePolicy: "never"
)
registry.register(neverRegion)
if let route = registry.route(eventType: "left_mouse_down", point: CGPoint(x: 210, y: 210)) {
    assert(route.region.id == "never-region", "never-consume region should still receive events")
    assert(!route.shouldConsume, "never policy must not consume")
} else {
    assert(false, "expected never-consume region route")
}

let removedOnSuspend = registry.removeOwned(by: "stage", includeSuspendRetained: false)
assert(removedOnSuspend.map(\.id).sorted() == ["high-region", "low-region", "never-region"], "owner suspend should remove default regions")
assert(registry.snapshot().isEmpty, "removed regions should disappear from snapshot")

let retained = AOSInputRegionRecord(
    id: "retained",
    ownerCanvasID: "stage",
    nativeFrame: baseFrame,
    removeOnOwnerSuspend: false
)
registry.register(retained)
assert(registry.removeOwned(by: "stage", includeSuspendRetained: false).isEmpty, "suspend-retained regions should survive suspend cleanup")
assert(registry.snapshot().map(\.id) == ["retained"], "retained region should remain visible")
assert(registry.removeOwned(by: "stage", includeSuspendRetained: true).map(\.id) == ["retained"], "owner removal should remove retained regions")

print("PASS daemon input surface ownership and input regions")
SWIFT

swiftc "$ROOT/src/daemon/input-surface-ownership.swift" "$TMP/main.swift" -o "$TMP/test-input-surface-ownership"
"$TMP/test-input-surface-ownership"

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation
import CoreGraphics

func assert(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

func writeJSON(_ name: String, _ payload: [String: Any]) {
    assert(JSONSerialization.isValidJSONObject(payload), "\(name) must be valid JSON")
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    try! data.write(to: URL(fileURLWithPath: "\(CommandLine.arguments[1])/\(name).json"))
}

let flags = [
    "shift": false,
    "ctrl": false,
    "cmd": false,
    "opt": false,
    "fn": false,
    "caps_lock": false,
]

let rawPointer = inputEventData(type: "left_mouse_down", x: 25, y: 25, flags: flags)
assert(rawPointer["input_schema_version"] as? Int == 2, "complete pointer events may claim input v2")
writeJSON("raw-pointer", rawPointer)

let unsupportedScroll = inputEventData(type: "scroll_wheel", x: 25, y: 25, flags: flags)
assert(unsupportedScroll["input_schema_version"] == nil, "scroll without dx/dy must remain legacy-shaped")

let rawScroll = inputEventData(type: "scroll_wheel", x: 25, y: 25, flags: flags, scrollDX: 2, scrollDY: -8)
assert(rawScroll["input_schema_version"] as? Int == 2, "complete scroll events may claim input v2")
writeJSON("raw-scroll", rawScroll)

let unsupportedCancel = inputEventData(type: "pointer_cancel", flags: flags)
assert(unsupportedCancel["input_schema_version"] == nil, "cancel without cancel_reason must remain legacy-shaped")

let rawCancel = inputEventData(type: "pointer_cancel", flags: flags, cancelReason: "surface_removed")
assert(rawCancel["input_schema_version"] as? Int == 2, "complete cancel events may claim input v2")
writeJSON("raw-cancel", rawCancel)

let region = AOSInputRegionRecord(
    id: "contract-region",
    ownerCanvasID: "contract-owner",
    nativeFrame: CGRect(x: 0, y: 0, width: 100, height: 100)
)
let ownedPointer = AOSInputRegionRoute(
    region: region,
    phase: "down",
    captured: false,
    captureID: "daemon:1:contract-region",
    shouldConsume: true
)
let desktopWorld: [String: Any] = ["x": 25.0, "y": 25.0]
let sourceSequence: [String: Any] = ["source": "daemon", "value": 1]

let routedPointer = aosInputRegionRoutedInputPayload(
    event: "left_mouse_down",
    data: rawPointer,
    route: ownedPointer,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:1",
    sourceSequencePayload: sourceSequence,
    gestureID: rawPointer["gesture_id"] as? String
)
assert(routedPointer["routed_schema_version"] as? Int == 1, "complete routed pointer may claim routed v1")
writeJSON("routed-pointer", routedPointer)

let scrollRoute = AOSInputRegionRoute(
    region: region,
    phase: "scroll",
    captured: false,
    captureID: nil,
    shouldConsume: true
)
let routedScrollLegacy = aosInputRegionRoutedInputPayload(
    event: "scroll_wheel",
    data: unsupportedScroll,
    route: scrollRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:2",
    sourceSequencePayload: ["source": "daemon", "value": 2],
    gestureID: "g-2"
)
assert(routedScrollLegacy["routed_schema_version"] == nil, "routed scroll without scroll data must not claim v1")

let routedScroll = aosInputRegionRoutedInputPayload(
    event: "scroll_wheel",
    data: rawScroll,
    route: scrollRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:3",
    sourceSequencePayload: ["source": "daemon", "value": 3],
    gestureID: rawScroll["gesture_id"] as? String
)
assert(routedScroll["routed_schema_version"] as? Int == 1, "complete routed scroll may claim routed v1")
writeJSON("routed-scroll", routedScroll)

let cancelRoute = AOSInputRegionRoute(
    region: region,
    phase: "cancel",
    captured: true,
    captureID: "daemon:4:contract-region",
    shouldConsume: true
)
let routedCancelLegacy = aosInputRegionRoutedInputPayload(
    event: "pointer_cancel",
    data: unsupportedCancel,
    route: cancelRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:4",
    sourceSequencePayload: ["source": "daemon", "value": 4],
    gestureID: "g-4"
)
assert(routedCancelLegacy["routed_schema_version"] == nil, "routed cancel without cancel_reason must not claim v1")

let routedCancel = aosInputRegionRoutedInputPayload(
    event: "pointer_cancel",
    data: rawCancel,
    route: cancelRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:5",
    sourceSequencePayload: ["source": "daemon", "value": 5],
    gestureID: rawCancel["gesture_id"] as? String
)
assert(routedCancel["routed_schema_version"] as? Int == 1, "complete routed cancel may claim routed v1")
writeJSON("routed-cancel", routedCancel)

print("PASS input event v2 builder and routed payload contract")
SWIFT

swiftc \
  "$ROOT/src/shared/types.swift" \
  "$ROOT/src/perceive/models.swift" \
  "$ROOT/src/perceive/events.swift" \
  "$ROOT/src/daemon/input-surface-ownership.swift" \
  "$TMP/main.swift" \
  -o "$TMP/test-input-event-contract"
"$TMP/test-input-event-contract" "$TMP"

python3 - "$ROOT/shared/schemas/input-event-v2.schema.json" "$TMP" <<'PY'
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
validator = Draft202012Validator(schema)
for path in sorted(Path(sys.argv[2]).glob("*.json")):
    instance = json.loads(path.read_text())
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    if errors:
        print(f"FAIL: {path.name} should validate")
        for error in errors[:8]:
            print(error.message)
        sys.exit(1)

print("PASS generated input event v2 payloads validate")
PY
