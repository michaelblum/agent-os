#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-scene-event.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import Foundation

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

let valid: [String: Any] = [
    "contract": "aos.scene.event.v1",
    "schemaVersion": 1,
    "type": "gesture",
    "sequence": 1,
    "stageId": "desktop-world/main",
    "ownerId": "example.consumer",
    "resourceId": "companion/main",
    "affordanceId": "body-hit",
    "interactionId": "body-drag",
    "gesture": [
        "id": "gesture-1", "kind": "drag", "phase": "update",
        "pointerSessionId": "capture-1", "cancellationReason": NSNull(),
    ],
    "coordinates": [
        "origin": ["x": 100.0, "y": 200.0], "previous": ["x": 110.0, "y": 210.0],
        "current": ["x": 120.0, "y": 220.0], "desktopWorld": ["x": 120.0, "y": 220.0],
        "native": NSNull(), "delta": ["x": 10.0, "y": 10.0], "totalDelta": ["x": 20.0, "y": 20.0],
    ],
    "topology": ["displays": [["displayId": 1, "index": 0, "bounds": [0.0, 0.0, 1440.0, 900.0]]]],
    "response": ["kind": "aim_commit", "objectId": "body", "origin": ["x": 100.0, "y": 200.0], "pointer": ["x": 120.0, "y": 220.0], "position": [120.0, 220.0, 0.0], "angle": 0.7, "distance": 28.0, "route": "line", "applied": true, "revision": 2],
    "at": 100.0,
]

require(aosCanonicalSceneEvent(valid) != nil, "valid scene event was rejected")
var radial = valid
radial["gesture"] = ["id": "gesture-menu", "kind": "tap", "phase": "end", "pointerSessionId": "capture-menu", "cancellationReason": NSNull()]
radial["response"] = [
    "kind": "radial_menu", "action": "open", "menuId": "companion-menu",
    "origin": ["x": 100.0, "y": 200.0],
    "items": [
        ["id": "inspect", "color": "#9b7cff", "disabled": false],
        ["id": "annotate", "color": "#53f5d7", "disabled": false],
    ],
    "radius": 108.0, "startAngle": -90.0, "spreadDegrees": 120.0, "closeOnSelect": true,
    "style": ["activeColor": "#ffffff", "fillColor": "#201b2f", "itemRadius": 20.0, "opacity": 0.94],
    "applied": true, "revision": 2,
]
require(aosCanonicalSceneEvent(radial) != nil, "valid radial-menu event was rejected")
var radialSelect = radial
radialSelect["response"] = ["kind": "radial_menu", "action": "select", "menuId": "companion-menu", "itemId": "annotate", "selectionIndex": 1, "applied": true, "revision": 3]
require(aosCanonicalSceneEvent(radialSelect) != nil, "valid radial-menu selection was rejected")
var radialCancel = radial
radialCancel["gesture"] = ["id": "gesture-menu", "kind": "tap", "phase": "cancel", "pointerSessionId": NSNull(), "cancellationReason": "escape"]
radialCancel["response"] = ["kind": "radial_menu", "action": "cancel", "menuId": "companion-menu", "applied": true, "revision": 3]
require(aosCanonicalSceneEvent(radialCancel) != nil, "valid radial-menu cancellation was rejected")
var radialLeak = radial
radialLeak["response"] = ["kind": "radial_menu", "action": "select", "menuId": "companion-menu", "itemId": "annotate", "selectionIndex": 1, "command": "private"]
require(aosCanonicalSceneEvent(radialLeak) == nil, "radial-menu product command was accepted")
var radialCancelLeak = radialCancel
radialCancelLeak["response"] = ["kind": "radial_menu", "action": "cancel", "menuId": "companion-menu", "items": [["id": "inspect", "color": "#9b7cff", "disabled": false]]]
require(aosCanonicalSceneEvent(radialCancelLeak) == nil, "radial-menu cancellation accepted open-state fields")
var leaked = valid
leaked["prompt"] = "private product content"
require(aosCanonicalSceneEvent(leaked) == nil, "unknown top-level product content was accepted")
var badResponse = valid
badResponse["response"] = ["kind": "aim_commit", "objectId": "body", "origin": NSNull(), "pointer": NSNull(), "position": [0.0, 0.0, 0.0], "angle": 0.0, "distance": 0.0, "route": "line", "spokenText": "private"]
require(aosCanonicalSceneEvent(badResponse) == nil, "unknown nested response content was accepted")
var badCancel = valid
badCancel["gesture"] = ["id": "gesture-1", "kind": "drag", "phase": "cancel", "pointerSessionId": "capture-1", "cancellationReason": "product_reason"]
require(aosCanonicalSceneEvent(badCancel) == nil, "unregistered cancellation reason was accepted")
print("PASS daemon scene event projection")
SWIFT

CLANG_MODULE_CACHE_PATH="$TMP/cache" SWIFT_MODULECACHE_PATH="$TMP/cache" \
    swiftc "$ROOT/src/daemon/scene-event.swift" "$TMP/main.swift" -o "$TMP/test"
"$TMP/test"
