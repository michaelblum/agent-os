#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/main.swift" <<'SWIFT'
import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

struct DisplayEntry {
    let id: CGDirectDisplayID
    let ordinal: Int
    let bounds: CGRect
    let isMain: Bool
    let scaleFactor: Double
}

func getDisplays() -> [DisplayEntry] {
    let mainID = CGMainDisplayID()
    return [
        DisplayEntry(
            id: mainID,
            ordinal: 1,
            bounds: CGRect(x: 0, y: 0, width: 1440, height: 900),
            isMain: true,
            scaleFactor: 2
        ),
        DisplayEntry(
            id: mainID &+ 1,
            ordinal: 2,
            bounds: CGRect(
                x: -1200,
                y: -240,
                width: 1200,
                height: 900
            ),
            isMain: false,
            scaleFactor: 1
        ),
    ]
}

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
    if let number = value as? NSNumber { return number.doubleValue }
    if let number = value as? CGFloat { return Double(number) }
    return nil
}

@main
struct AnnotationSelectionNativeTest {
    static func main() {
        require(AOSAnnotationSelectionMode.parse(" RECTANGLE ") == .rectangle, "mode normalization drifted")
        require(AOSAnnotationSelectionMode.parse(" target ") == .target, "target mode normalization drifted")
        require(AOSAnnotationSelectionMode.parse("polygon") == nil, "unsupported mode was accepted")

        let source = (0..<1_000).map { CGPoint(x: $0, y: $0 * 2) }
        let bounded = aosBoundAnnotationPoints(source)
        require(bounded.count == 256, "freehand point cap drifted")
        require(bounded.first == source.first && bounded.last == source.last, "freehand bounds lost endpoints")

        let displayHeight = mainDisplayHeight()
        let point = aosAnnotationGeometry(mode: .point, screenPoints: [CGPoint(x: 20, y: 30)])!
        require(point["kind"] as? String == "point", "point geometry kind drifted")
        require(number(point["x"]) == 20, "point x drifted")
        require(number(point["y"]) == Double(displayHeight - 30), "point y was not converted to desktop top-left space")
        let secondaryPoint = NSPoint(x: -600, y: displayHeight + 120)
        let secondaryCG = screenPointToCG(secondaryPoint)
        require(secondaryCG.x == -600 && secondaryCG.y == -120, "secondary-display point conversion drifted")
        let secondaryRect = CGRect(x: -800, y: -180, width: 240, height: 120)
        require(screenToCG(cgToScreen(secondaryRect)) == secondaryRect, "cross-display rect conversion lost its round trip")

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
        require(aosAnnotationGeometry(mode: .target, screenPoints: [CGPoint(x: 1, y: 1)]) == nil, "target mode produced point geometry")
        runAXSemanticTargetTraversalTests()

        let targetNodes = [
            AOSAnnotationTargetNode(role: "AXApplication", title: nil, label: nil, bounds: CGRect(x: 0, y: 0, width: 900, height: 700)),
            AOSAnnotationTargetNode(role: "AXWindow", title: "Window", label: nil, bounds: CGRect(x: 20, y: 20, width: 700, height: 500)),
            AOSAnnotationTargetNode(role: "AXGroup", title: nil, label: nil, bounds: nil),
            AOSAnnotationTargetNode(role: "AXButton", title: "Commit", label: "Save\u{0007} action", bounds: CGRect(x: 120, y: 80, width: 80, height: 32)),
        ]
        let targets = aosAnnotationTargetCandidates(from: targetNodes)
        require(targets.count == 3, "invalid target bounds were not filtered")
        require(targets.last?.role == "AXButton", "target candidates lost leaf ordering")
        require(targets.last?.ancestorRoles == ["AXApplication", "AXWindow", "AXGroup"], "target ancestry drifted")
        require(targets.last?.label == "Save  action", "target label controls were not sanitized")
        let targetGeometry = aosAnnotationTargetGeometry(targets.last!)
        require(targetGeometry["kind"] as? String == "element", "target geometry kind drifted")
        require(targetGeometry["role"] as? String == "AXButton", "target geometry role drifted")
        require(targetGeometry["ancestor_roles"] as? [String] == ["AXApplication", "AXWindow", "AXGroup"], "target geometry ancestry drifted")
        let changedTargetNodes = [
            AOSAnnotationTargetNode(role: "AXApplication", title: nil, label: nil, bounds: CGRect(x: 0, y: 0, width: 901, height: 701)),
            AOSAnnotationTargetNode(role: "AXWindow", title: "Renamed Window", label: nil, bounds: CGRect(x: 21, y: 22, width: 701, height: 501)),
            AOSAnnotationTargetNode(role: "AXGroup", title: nil, label: nil, bounds: nil),
            AOSAnnotationTargetNode(role: "AXButton", title: "Commit", label: "Save action", bounds: CGRect(x: 121, y: 81, width: 82, height: 34)),
        ]
        let changedTargets = aosAnnotationTargetCandidates(from: changedTargetNodes)
        let sameContext = AOSAnnotationTargetContextIdentity(processID: 42, windowID: 17)
        require(
            aosAnnotationTargetReconciledIndex(
                previousCandidates: targets,
                previousIndex: 1,
                previousContext: sameContext,
                nextCandidates: changedTargets,
                nextContext: sameContext
            ) == 1,
            "target reconciliation discarded the selected ancestor after dynamic evidence changed"
        )
        require(
            aosAnnotationTargetReconciledIndex(
                previousCandidates: targets,
                previousIndex: 1,
                previousContext: sameContext,
                nextCandidates: changedTargets,
                nextContext: AOSAnnotationTargetContextIdentity(processID: 42, windowID: 18)
            ) == changedTargets.count - 1,
            "target reconciliation retained an ancestor across window identity change"
        )

        let deepNodes = (0..<20).map {
            AOSAnnotationTargetNode(
                role: "AX\($0)",
                title: nil,
                label: nil,
                bounds: CGRect(x: $0, y: $0, width: 1, height: 1)
            )
        }
        let boundedTargets = aosAnnotationTargetCandidates(from: deepNodes)
        require(boundedTargets.count == 12, "target candidate depth was not bounded")
        require(boundedTargets.first?.role == "AX0", "bounded target candidates lost root")
        require(boundedTargets.last?.role == "AX19", "bounded target candidates lost leaf")

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
        let publicWindow = aosAnnotationPublicWindowFacts(facts)!
        require(publicWindow["window_id"] as? Int == 17, "public window id drifted")
        require(publicWindow["application"] == nil, "public window leaked nested application facts")

        let deliveryQueue = DispatchQueue(label: "annotation-target-test-delivery")
        let resolverQueue = DispatchQueue(label: "annotation-target-test-resolver")
        let firstStarted = DispatchSemaphore(value: 0)
        let releaseFirst = DispatchSemaphore(value: 0)
        let latestDelivered = DispatchSemaphore(value: 0)
        let counterLock = NSLock()
        var calls = 0
        var active = 0
        var maximumActive = 0
        var delivered: [CGFloat] = []
        let worker = AOSAnnotationTargetResolutionWorker(
            deliveryQueue: deliveryQueue,
            resolverQueue: resolverQueue
        ) { point in
            counterLock.lock()
            calls += 1
            let call = calls
            active += 1
            maximumActive = max(maximumActive, active)
            counterLock.unlock()
            if call == 1 {
                firstStarted.signal()
                _ = releaseFirst.wait(timeout: .now() + 2)
            }
            counterLock.lock()
            active -= 1
            counterLock.unlock()
            return AOSAnnotationTargetResolution(
                candidates: [],
                application: ["pid": Int(point.x)],
                window: nil
            )
        }
        deliveryQueue.sync {
            worker.request(at: CGPoint(x: 1, y: 1)) { _ in
                delivered.append(1)
            }
            for index in 2...1_001 {
                worker.request(at: CGPoint(x: CGFloat(index), y: CGFloat(index))) { _ in
                    delivered.append(CGFloat(index))
                    if index == 1_001 {
                        latestDelivered.signal()
                    }
                }
            }
        }
        require(firstStarted.wait(timeout: .now() + 2) == .success, "target resolver did not start")
        releaseFirst.signal()
        require(latestDelivered.wait(timeout: .now() + 2) == .success, "latest target result was not delivered")
        deliveryQueue.sync {}
        require(delivered == [1_001], "stale target result escaped generation guard")
        require(calls == 2 && maximumActive == 1, "target resolver did not remain single-flight")
        deliveryQueue.sync { worker.close() }

        let closeDeliveryQueue = DispatchQueue(label: "annotation-target-close-delivery")
        let closeResolverQueue = DispatchQueue(label: "annotation-target-close-resolver")
        let closeStarted = DispatchSemaphore(value: 0)
        let releaseClose = DispatchSemaphore(value: 0)
        let closeResolved = DispatchSemaphore(value: 0)
        var deliveredAfterClose = false
        let closingWorker = AOSAnnotationTargetResolutionWorker(
            deliveryQueue: closeDeliveryQueue,
            resolverQueue: closeResolverQueue
        ) { _ in
            closeStarted.signal()
            _ = releaseClose.wait(timeout: .now() + 2)
            closeResolved.signal()
            return nil
        }
        closeDeliveryQueue.sync {
            closingWorker.request(at: CGPoint(x: 3, y: 3)) { _ in
                deliveredAfterClose = true
            }
        }
        require(closeStarted.wait(timeout: .now() + 2) == .success, "close fixture did not start")
        closeDeliveryQueue.sync { closingWorker.close() }
        releaseClose.signal()
        require(closeResolved.wait(timeout: .now() + 2) == .success, "closed target resolver did not finish")
        closeResolverQueue.sync {}
        closeDeliveryQueue.sync {}
        require(!deliveredAfterClose, "closed target resolver delivered stale evidence")

        let sharedResolverQueue = DispatchQueue(label: "annotation-target-shared-resolver")
        let churnDeliveryQueue = DispatchQueue(label: "annotation-target-churn-delivery")
        let churnFirstStarted = DispatchSemaphore(value: 0)
        let churnReleaseFirst = DispatchSemaphore(value: 0)
        let churnFinalDelivered = DispatchSemaphore(value: 0)
        let churnLock = NSLock()
        var churnCalls = 0
        var churnActive = 0
        var churnMaximumActive = 0
        let churnResolver: AOSAnnotationTargetResolutionWorker.Resolver = { point in
            churnLock.lock()
            churnCalls += 1
            let call = churnCalls
            churnActive += 1
            churnMaximumActive = max(churnMaximumActive, churnActive)
            churnLock.unlock()
            if call == 1 {
                churnFirstStarted.signal()
                _ = churnReleaseFirst.wait(timeout: .now() + 2)
            }
            churnLock.lock()
            churnActive -= 1
            churnLock.unlock()
            return AOSAnnotationTargetResolution(
                candidates: [],
                application: ["pid": Int(point.x)],
                window: nil
            )
        }
        let churnFirstWorker = AOSAnnotationTargetResolutionWorker(
            deliveryQueue: churnDeliveryQueue,
            resolverQueue: sharedResolverQueue,
            resolve: churnResolver
        )
        churnDeliveryQueue.sync {
            churnFirstWorker.request(at: CGPoint(x: 1, y: 1)) { _ in
                require(false, "closed first churn worker delivered")
            }
        }
        require(churnFirstStarted.wait(timeout: .now() + 2) == .success, "shared resolver churn did not start")
        churnDeliveryQueue.sync { churnFirstWorker.close() }
        for index in 2...101 {
            autoreleasepool {
                var canceledWorker: AOSAnnotationTargetResolutionWorker? = AOSAnnotationTargetResolutionWorker(
                    deliveryQueue: churnDeliveryQueue,
                    resolverQueue: sharedResolverQueue,
                    resolve: churnResolver
                )
                churnDeliveryQueue.sync {
                    canceledWorker?.request(
                        at: CGPoint(x: CGFloat(index), y: CGFloat(index))
                    ) { _ in
                        require(false, "canceled churn worker delivered")
                    }
                    canceledWorker?.close()
                }
                canceledWorker = nil
            }
        }
        let churnFinalWorker = AOSAnnotationTargetResolutionWorker(
            deliveryQueue: churnDeliveryQueue,
            resolverQueue: sharedResolverQueue,
            resolve: churnResolver
        )
        churnDeliveryQueue.sync {
            churnFinalWorker.request(at: CGPoint(x: 102, y: 102)) { _ in
                churnFinalDelivered.signal()
            }
        }
        churnReleaseFirst.signal()
        require(
            churnFinalDelivered.wait(timeout: .now() + 2) == .success,
            "shared resolver did not admit the next live session"
        )
        sharedResolverQueue.sync {}
        churnDeliveryQueue.sync { churnFinalWorker.close() }
        require(churnCalls == 2, "closed resolver sessions retained queued AX work")
        require(churnMaximumActive == 1, "resolver sessions escaped the daemon-owned serial executor")

        print("annotation selection native contracts passed")
    }
}
SWIFT

swiftc -parse-as-library \
    "$ROOT/src/shared/types.swift" \
    "$ROOT/src/perceive/ax-semantic-target.swift" \
    "$ROOT/src/daemon/annotation-selection.swift" \
    "$ROOT/src/daemon/annotation-target-selection.swift" \
    "$ROOT/tests/lib/annotation-semantic-target-traversal-tests.swift" \
    "$TMP/main.swift" \
    -o "$TMP/annotation-selection-native"
"$TMP/annotation-selection-native"

if grep -q 'AXIsProcessTrusted' "$ROOT/src/daemon/annotation-selection.swift"; then
    echo "FAIL: generic annotation selection must not own target TCC admission" >&2
    exit 1
fi

if [[ "$(grep -c 'AXIsProcessTrusted' "$ROOT/src/daemon/annotation-target-selection.swift")" -ne 1 ]]; then
    echo "FAIL: target selection session must probe Accessibility exactly once at admission" >&2
    exit 1
fi
