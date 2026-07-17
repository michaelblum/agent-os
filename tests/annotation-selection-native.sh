#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import AppKit
import CoreGraphics
import Darwin
import Foundation

func aosRunOnMainSync(_ operation: () -> Void) {
    if Thread.isMainThread { operation() }
    else { DispatchQueue.main.sync(execute: operation) }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        fputs("FAIL: \(message)\n", stderr)
        exit(1)
    }
}

private func number(_ value: Any?) -> Double? {
    (value as? NSNumber)?.doubleValue
}

@main
struct AnnotationSelectionNativeTest {
    static func main() {
        require(AOSAnnotationSelectionMode.parse(" RECTANGLE ") == .rectangle, "mode normalization drifted")
        require(AOSAnnotationSelectionMode.parse("polygon") == nil, "unsupported mode was accepted")

        let source = (0..<1_000).map { CGPoint(x: $0, y: $0 * 2) }
        let bounded = aosBoundAnnotationPoints(source)
        require(bounded.count == 256, "freehand point cap drifted")
        require(bounded.first == source.first && bounded.last == source.last, "freehand bounds lost endpoints")

        let displayHeight = CGDisplayBounds(CGMainDisplayID()).height
        let point = aosAnnotationGeometry(mode: .point, screenPoints: [CGPoint(x: 20, y: 30)])!
        require(point["kind"] as? String == "point", "point geometry kind drifted")
        require(number(point["x"]) == 20, "point x drifted")
        require(number(point["y"]) == Double(displayHeight - 30), "point y was not converted to desktop top-left space")

        let rectangle = aosAnnotationGeometry(
            mode: .rectangle,
            screenPoints: [CGPoint(x: 300, y: 200), CGPoint(x: 100, y: 500)]
        )!
        require(number(rectangle["x"]) == 100, "rectangle x was not normalized")
        require(number(rectangle["width"]) == 200, "rectangle width drifted")
        require(number(rectangle["height"]) == 300, "rectangle height drifted")

        let freehand = aosAnnotationGeometry(mode: .freehand, screenPoints: source)!
        require((freehand["points"] as? [[String: Any]])?.count == 256, "freehand geometry exceeded point cap")
        require(freehand["bounds"] as? [String: Any] != nil, "freehand bounds are missing")
        require(aosAnnotationGeometry(mode: .point, screenPoints: [CGPoint(x: CGFloat.nan, y: 1)]) == nil, "non-finite geometry was accepted")

        let currentPID = getpid()
        let windowList: [[String: Any]] = [
            [
                kCGWindowOwnerPID as String: NSNumber(value: currentPID),
                kCGWindowLayer as String: NSNumber(value: 0),
                kCGWindowNumber as String: NSNumber(value: 8),
                kCGWindowBounds as String: ["X": 0, "Y": 0, "Width": 500, "Height": 500],
            ],
            [
                kCGWindowOwnerPID as String: NSNumber(value: 4242),
                kCGWindowLayer as String: NSNumber(value: 0),
                kCGWindowNumber as String: NSNumber(value: 17),
                kCGWindowOwnerName as String: "Fixture App",
                kCGWindowName as String: "Fixture Window",
                kCGWindowBounds as String: ["X": 10, "Y": 20, "Width": 300, "Height": 200],
            ],
        ]
        let facts = aosAnnotationWindowFacts(at: CGPoint(x: 20, y: 30), windowList: windowList, excludingPID: currentPID)!
        require(facts["window_id"] as? Int == 17, "window selection did not skip daemon-owned window")
        require(facts["title"] as? String == "Fixture Window", "window title drifted")
        let application = facts["application"] as? [String: Any]
        require(application?["pid"] as? Int == 4242, "application PID drifted")
        require(application?["name"] as? String == "Fixture App", "application name drifted")

        print("annotation selection native contracts passed")
    }
}
SWIFT

swiftc -parse-as-library \
    "$ROOT/src/daemon/annotation-selection.swift" \
    "$TMP/main.swift" \
    -o "$TMP/annotation-selection-native"
"$TMP/annotation-selection-native"
