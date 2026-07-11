import Foundation

private enum TestFailure: Error, CustomStringConvertible {
    case assertion(String)

    var description: String {
        switch self {
        case .assertion(let message):
            return message
        }
    }
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() {
        throw TestFailure.assertion(message)
    }
}

private func proveTerminalSequence(
    name: String,
    marker: Int64,
    terminalType: UInt32,
    nonterminalTypes: [UInt32]
) throws {
    let tracker = AOSInputTerminalReceiptTracker()
    tracker.begin(marker: marker, eventType: terminalType)

    for eventType in nonterminalTypes {
        tracker.observe(marker: marker, eventType: eventType)
    }
    try require(!tracker.consume(marker: marker, eventType: terminalType), "\(name): nonterminal event satisfied receipt")

    tracker.observe(marker: marker, eventType: terminalType)
    try require(
        tracker.waitAndConsume(marker: marker, eventType: terminalType, timeout: 0),
        "\(name): terminal event was not consumed"
    )
    try require(!tracker.consume(marker: marker, eventType: terminalType), "\(name): terminal receipt was retained")
}

@main
struct NativeActionInputDeliveryProof {
    static func main() throws {
        try proveTerminalSequence(name: "click", marker: 101, terminalType: 2, nonterminalTypes: [1])
        try proveTerminalSequence(name: "drag", marker: 102, terminalType: 2, nonterminalTypes: [1, 6, 6])
        try proveTerminalSequence(name: "key", marker: 103, terminalType: 11, nonterminalTypes: [10])
        try proveTerminalSequence(name: "type", marker: 104, terminalType: 11, nonterminalTypes: [10, 10])

        let dragBoundaryTracker = AOSInputTerminalReceiptTracker()
        dragBoundaryTracker.begin(marker: 105, eventType: 1)
        dragBoundaryTracker.observe(marker: 105, eventType: 1)
        try require(
            dragBoundaryTracker.waitAndConsume(marker: 105, eventType: 1, timeout: 0),
            "drag boundaries: down was not acknowledged"
        )
        dragBoundaryTracker.begin(marker: 105, eventType: 2)
        dragBoundaryTracker.observe(marker: 105, eventType: 6)
        dragBoundaryTracker.observe(marker: 105, eventType: 2)
        try require(
            dragBoundaryTracker.waitAndConsume(marker: 105, eventType: 2, timeout: 0),
            "drag boundaries: up was not acknowledged"
        )

        let timeoutTracker = AOSInputTerminalReceiptTracker()
        timeoutTracker.begin(marker: 201, eventType: 2)
        timeoutTracker.observe(marker: 201, eventType: 1)
        try require(
            !timeoutTracker.waitAndConsume(marker: 201, eventType: 2, timeout: 0),
            "timeout: nonterminal event satisfied receipt"
        )
        timeoutTracker.clearAll()
        timeoutTracker.observe(marker: 201, eventType: 2)
        try require(!timeoutTracker.consume(marker: 201, eventType: 2), "timeout: teardown retained expectation")

        let replacementTracker = AOSInputTerminalReceiptTracker()
        replacementTracker.begin(marker: 301, eventType: 2)
        replacementTracker.begin(marker: 302, eventType: 11)
        replacementTracker.observe(marker: 301, eventType: 2)
        try require(!replacementTracker.consume(marker: 301, eventType: 2), "replacement: superseded receipt remained consumable")
        replacementTracker.observe(marker: 302, eventType: 11)
        try require(replacementTracker.consume(marker: 302, eventType: 11), "replacement: current receipt was not consumed")

        let modifierDown = AOSModifierDeliveryTransition(before: [], after: ["shift"])
        try require(modifierDown.provisionalState == ["shift"], "modifier down: provisional state missing modifier")
        try require(modifierDown.uncertainState == ["shift"], "modifier down: uncertain modifier escaped cleanup ownership")

        let modifierUp = AOSModifierDeliveryTransition(before: ["shift", "cmd"], after: ["cmd"])
        try require(modifierUp.provisionalState == ["cmd"], "modifier up: provisional state retained released modifier")
        try require(modifierUp.uncertainState == ["shift", "cmd"], "modifier up: uncertain modifier escaped cleanup ownership")

        var failedReleaseCount = 0
        func simulateDragRelease(success: Bool) {
            var obligation = AOSPointerReleaseObligation(point: CGPoint(x: 10, y: 20))
            defer {
                if obligation.isPending {
                    failedReleaseCount += 1
                }
            }
            obligation.advance(to: CGPoint(x: 30, y: 40))
            if success {
                obligation.fulfill()
            }
        }
        simulateDragRelease(success: false)
        try require(failedReleaseCount == 1, "drag release: failed transaction did not retain one release obligation")
        simulateDragRelease(success: true)
        try require(failedReleaseCount == 1, "drag release: successful transaction retained its release obligation")

        print("PASS: terminal receipts and modifier uncertainty remain transaction-owned")
    }
}
