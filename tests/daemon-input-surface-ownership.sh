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

func descriptor(_ type: String) -> AOSInputEventDescriptor {
    guard let value = AOSInputEventDescriptor(type: type) else {
        fputs("FAIL: missing descriptor for \(type)\n", stderr)
        exit(1)
    }
    return value
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
let stageGeneration = CanvasLifecycleGeneration(canvasID: "stage", value: 42)
let lowRegion = AOSInputRegionRecord(
    id: "low-region",
    ownerCanvasGeneration: stageGeneration,
    nativeFrame: baseFrame,
    semanticLabel: "Low region",
    priority: 1
)
let highRegion = AOSInputRegionRecord(
    id: "high-region",
    ownerCanvasGeneration: stageGeneration,
    nativeFrame: baseFrame,
    semanticLabel: "High region",
    priority: 10,
    consumePolicy: "captured"
)
registry.register(lowRegion)
registry.register(highRegion)

if let route = registry.route(event: descriptor("left_mouse_down"), point: point) {
    assert(route.region.id == "high-region", "highest-priority region should receive pointer down")
    assert(route.phase == "down", "pointer down should route as down phase")
    assert(route.shouldConsume, "captured policy should consume pointer down")
} else {
    assert(false, "expected region route on pointer down")
}

if let route = registry.route(event: descriptor("left_mouse_dragged"), point: CGPoint(x: 500, y: 500)) {
    assert(route.region.id == "high-region", "captured region should receive drag outside frame")
    assert(route.captured, "drag should be marked captured")
    assert(route.shouldConsume, "captured drag should consume")
} else {
    assert(false, "expected captured drag route")
}

if let route = registry.route(event: descriptor("left_mouse_up"), point: CGPoint(x: 500, y: 500)) {
    assert(route.region.id == "high-region", "captured region should receive up outside frame")
    assert(route.phase == "up", "pointer up should route as up phase")
} else {
    assert(false, "expected captured up route")
}

let neverRegion = AOSInputRegionRecord(
    id: "never-region",
    ownerCanvasGeneration: stageGeneration,
    nativeFrame: CGRect(x: 200, y: 200, width: 20, height: 20),
    consumePolicy: "never"
)
registry.register(neverRegion)
if let route = registry.route(event: descriptor("left_mouse_down"), point: CGPoint(x: 210, y: 210)) {
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
    ownerCanvasGeneration: stageGeneration,
    nativeFrame: baseFrame,
    removeOnOwnerSuspend: false
)
registry.register(retained)
assert(registry.removeOwned(by: "stage", includeSuspendRetained: false).isEmpty, "suspend-retained regions should survive suspend cleanup")
assert(registry.snapshot().map(\.id) == ["retained"], "retained region should remain visible")
assert(registry.removeOwned(by: "stage", includeSuspendRetained: true).map(\.id) == ["retained"], "owner removal should remove retained regions")

let failOpenRegistry = AOSInputRegionRegistry()
failOpenRegistry.register(highRegion)
let canonicalDown = AOSCanonicalInputEvent(type: "left_mouse_down", x: 25, y: 25)!
let delivered = failOpenRegistry.resolveDelivery(
    descriptor: canonicalDown.descriptor,
    event: canonicalDown,
    point: point,
    desktopWorld: point,
    sourceSequence: "daemon:1",
    gestureID: "g-1"
)
if case .deliver(let delivery)? = delivered {
    assert(delivery.consume, "successful region delivery should preserve consume decision")
    assert(delivery.ownerCanvasID == "stage", "delivery should retain the typed owner destination")
    assert(delivery.ownerCanvasGeneration == stageGeneration, "delivery should retain the owner generation")
    assert(delivery.phase == .down, "delivery should retain the typed diagnostic phase")
    assert(delivery.regionID == "high-region", "delivery should retain the typed diagnostic region")
    assert(Set(delivery.payload.keys) == Set(["type", "routed_input"]), "successful delivery should expose only the exact envelope")
} else {
    assert(false, "canonical region input should produce deliver decision")
}
assert(failOpenRegistry.activeCaptureSnapshot() != nil, "delivered pointer down should establish capture")

let failed = failOpenRegistry.resolveDelivery(
    descriptor: descriptor("left_mouse_dragged"),
    event: nil,
    point: CGPoint(x: 500, y: 500),
    desktopWorld: CGPoint(x: 500, y: 500),
    sourceSequence: "daemon:2",
    gestureID: "g-1"
)
if case .failOpen? = failed {
    assert(true, "noncanonical captured input should fail open")
} else {
    assert(false, "noncanonical captured input must not expose a deliver payload")
}
assert(failOpenRegistry.activeCaptureSnapshot() == nil, "fail-open decision must atomically clear active capture")

let cursorReconciler = AOSNativeCursorSuppressionReconciler()
let firstCursorSuppression = cursorReconciler.reconcile(active: true)
assert(firstCursorSuppression.hideNativeCursor == true, "first cursor suppression should hide the process cursor once")
assert(firstCursorSuppression.showNativeCursor == false, "first cursor suppression should not show")
let unchangedCursorSuppression = cursorReconciler.reconcile(active: true)
assert(unchangedCursorSuppression.hideNativeCursor == false, "unchanged cursor suppression should not double-hide")
assert(unchangedCursorSuppression.showNativeCursor == false, "unchanged cursor suppression should not restore")
let displayChangedCursorSuppression = cursorReconciler.reconcile(active: true)
assert(displayChangedCursorSuppression.hideNativeCursor == false, "display change while active should not double-hide")
assert(displayChangedCursorSuppression.showNativeCursor == false, "display change while active should not restore")
let clearedCursorSuppression = cursorReconciler.reconcile(active: false)
assert(clearedCursorSuppression.showNativeCursor == true, "last cursor suppression removal should restore once")
let repeatedCleanup = cursorReconciler.restore()
assert(repeatedCleanup.showNativeCursor == false, "repeated cursor cleanup should be idempotent")

print("PASS daemon input surface ownership and input regions")
SWIFT

swiftc "$ROOT/src/display/canvas-generation.swift" "$ROOT/src/shared/input-event.swift" "$ROOT/src/daemon/input-surface-ownership.swift" "$TMP/main.swift" -o "$TMP/test-input-surface-ownership"
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

let receiptMarker = aosInputReceiptMarker(processID: 42, counter: 7)
let receiptID = aosInputReceiptID(marker: receiptMarker)
assert(receiptID?.hasPrefix("aos-input-") == true, "owned event receipt marker should expose canonical identity")
assert(aosInputReceiptID(marker: 7) == nil, "unowned event source data must not become a receipt identity")
let receiptPointer = inputEventData(
    type: "left_mouse_down",
    x: 25,
    y: 25,
    flags: flags,
    gestureIDOverride: receiptID
)
assert(receiptPointer["gesture_id"] as? String == receiptID, "receipt identity should survive canonical pointer projection")
writeJSON("receipt-pointer", receiptPointer)
let concurrentNaturalMove = inputEventData(type: "mouse_moved", x: 26, y: 26, flags: flags)
assert(concurrentNaturalMove["gesture_id"] as? String != receiptID, "receipt identity must not capture concurrent natural pointer state")

for pointerType in [
    "left_mouse_down",
    "left_mouse_up",
    "left_mouse_dragged",
    "right_mouse_down",
    "right_mouse_up",
    "right_mouse_dragged",
    "middle_mouse_down",
    "middle_mouse_up",
    "middle_mouse_dragged",
    "other_mouse_down",
    "other_mouse_up",
    "other_mouse_dragged",
    "mouse_moved",
] {
    let payload = inputEventData(type: pointerType, x: 25, y: 25, flags: flags)
    assert(payload["input_schema_version"] as? Int == 2, "\(pointerType) daemon payload may claim input v2")
    assert(payload["event_kind"] as? String == "pointer", "\(pointerType) daemon payload is pointer kind")
}

let rawSnapshot = inputEventData(type: "mouse_moved", x: 25, y: 25, flags: flags)
assert(rawSnapshot["input_schema_version"] as? Int == 2, "input_event snapshot mouse move may claim input v2")
writeJSON("raw-snapshot", rawSnapshot)

let unsupportedScroll = inputEventData(type: "scroll_wheel", x: 25, y: 25, flags: flags)
assert(unsupportedScroll["input_schema_version"] == nil, "helper-only scroll without dx/dy must remain legacy-shaped")

let rawScroll = inputEventData(type: "scroll_wheel", x: 25, y: 25, flags: flags, scrollDX: 2, scrollDY: -8)
assert(rawScroll["input_schema_version"] as? Int == 2, "complete scroll events may claim input v2")
writeJSON("raw-scroll", rawScroll)

let rawKey = inputEventData(type: "key_down", keyCode: 36, flags: flags)
assert(rawKey["input_schema_version"] as? Int == 2, "daemon key payload may claim input v2")
assert(rawKey["event_kind"] as? String == "key", "daemon key payload is key kind")
writeJSON("raw-key", rawKey)

let unsupportedCancel = inputEventData(type: "pointer_cancel", flags: flags)
assert(unsupportedCancel["input_schema_version"] == nil, "helper-only cancel without cancel_reason must remain legacy-shaped")

let rawCancel = inputEventData(type: "pointer_cancel", flags: flags, cancelReason: "surface_removed")
assert(rawCancel["input_schema_version"] as? Int == 2, "complete cancel events may claim input v2")
writeJSON("raw-cancel", rawCancel)

let region = AOSInputRegionRecord(
    id: "contract-region",
    ownerCanvasGeneration: CanvasLifecycleGeneration(canvasID: "contract-owner", value: 7),
    nativeFrame: CGRect(x: 0, y: 0, width: 100, height: 100)
)
let ownedPointer = AOSInputRegionRoute(
    region: region,
    phase: "down",
    captured: false,
    captureID: "daemon:1:contract-region",
    shouldConsume: true
)
let desktopWorld = CGPoint(x: 25, y: 25)
let canonicalPointer = AOSCanonicalInputEvent(canonicalData: rawPointer)
assert(canonicalPointer != nil, "raw pointer should hydrate the shared canonical event")

let routedPointerEvent = AOSInputRegionRoutedInput(
    event: canonicalPointer!,
    route: ownedPointer,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:1",
    gestureID: rawPointer["gesture_id"] as? String
)
assert(routedPointerEvent != nil, "complete routed pointer should construct a typed routed-v1 event")
let routedPointer = routedPointerEvent!.jsonObject
assert(routedPointer["routed_schema_version"] as? Int == 1, "complete routed pointer may claim routed v1")
assert(routedPointer["source_event"] as? String == "daemon:1", "typed routed pointer should use bounded string source identity")
assert(routedPointer["coordinate_authority"] as? String == "daemon", "typed routed pointer should own coordinate authority")
assert(routedPointer["source_origin"] as? String == "daemon", "typed routed pointer should own source origin")
let routedPointerEnvelope = aosInputRegionEventEnvelope(routedInput: routedPointerEvent!)
assert(Set(routedPointerEnvelope.keys) == Set(["type", "routed_input"]), "input-region envelope must contain only type and routed_input")
assert(routedPointerEnvelope["type"] as? String == "input_region.event", "input-region envelope type must be canonical")
writeJSON("routed-pointer", routedPointer)

assert(AOSInputRegionRoutedInput(
    event: canonicalPointer!,
    route: ownedPointer,
    desktopWorld: nil,
    sourceSequence: "daemon:1",
    gestureID: "g-missing-point"
) == nil, "missing routed point must fail typed construction")

let capturedWithoutID = AOSInputRegionRoute(
    region: region,
    phase: "drag",
    captured: true,
    captureID: nil,
    shouldConsume: true
)
let canonicalDrag = AOSCanonicalInputEvent(type: "left_mouse_dragged", x: 25, y: 25)
assert(AOSInputRegionRoutedInput(
    event: canonicalDrag!,
    route: capturedWithoutID,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:1",
    gestureID: "g-missing-capture"
) == nil, "captured routed input without capture id must fail typed construction")

let scrollRoute = AOSInputRegionRoute(
    region: region,
    phase: "scroll",
    captured: false,
    captureID: nil,
    shouldConsume: true
)
let canonicalScroll = AOSCanonicalInputEvent(canonicalData: rawScroll)
assert(canonicalScroll != nil, "raw scroll should hydrate the shared canonical event")
let routedScrollEvent = AOSInputRegionRoutedInput(
    event: canonicalScroll!,
    route: scrollRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:3",
    gestureID: rawScroll["gesture_id"] as? String
)
assert(routedScrollEvent != nil, "complete routed scroll should construct a typed routed-v1 event")
let routedScroll = routedScrollEvent!.jsonObject
assert(routedScroll["routed_schema_version"] as? Int == 1, "complete routed scroll may claim routed v1")
assert(routedScroll["source_event"] as? String == "daemon:3", "typed routed scroll should use bounded string source identity")
writeJSON("routed-scroll", routedScroll)

let cancelRoute = AOSInputRegionRoute(
    region: region,
    phase: "cancel",
    captured: true,
    captureID: "daemon:4:contract-region",
    shouldConsume: true
)
let canonicalCancel = AOSCanonicalInputEvent(canonicalData: rawCancel)
assert(canonicalCancel != nil, "raw cancel should hydrate the shared canonical event")
let routedCancelEvent = AOSInputRegionRoutedInput(
    event: canonicalCancel!,
    route: cancelRoute,
    desktopWorld: desktopWorld,
    sourceSequence: "daemon:5",
    gestureID: rawCancel["gesture_id"] as? String
)
assert(routedCancelEvent != nil, "complete routed cancel should construct a typed routed-v1 event")
let routedCancel = routedCancelEvent!.jsonObject
assert(routedCancel["routed_schema_version"] as? Int == 1, "complete routed cancel may claim routed v1")
assert(routedCancel["source_event"] as? String == "daemon:5", "typed routed cancel should use bounded string source identity")
writeJSON("routed-cancel", routedCancel)

print("PASS input event v2 builder and routed payload contract")
SWIFT

cat >"$TMP/json-value.swift" <<'SWIFT'
import Foundation

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null
}
SWIFT

swiftc \
  "$ROOT/src/display/canvas-generation.swift" \
  "$ROOT/src/shared/types.swift" \
  "$ROOT/src/shared/input-event.swift" \
  "$ROOT/src/shared/input-event-receipt.swift" \
  "$TMP/json-value.swift" \
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
