#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

print("PASS daemon input surface ownership")
SWIFT

swiftc "$ROOT/src/daemon/input-surface-ownership.swift" "$TMP/main.swift" -o "$TMP/test-input-surface-ownership"
"$TMP/test-input-surface-ownership"
