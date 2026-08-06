import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

@main
struct Harness {
    static func main() {
        expect(sessionTargetStateErrorCode(nil) == nil, "native session request without state")
        expect(
            sessionTargetStateErrorCode("see_stale") == "TARGET_STATE_UNSUPPORTED",
            "native session rejects state before dispatch"
        )
        expect(selectTargetCandidate(count: 0) == .notFound, "zero matches")
        expect(selectTargetCandidate(count: 1) == .selected(0), "one match")
        expect(selectTargetCandidate(count: 2) == .ambiguous, "multiple AX or canvas Locator matches")
        expect(selectTargetCandidate(count: 3, index: 1) == .selected(1), "explicit index")
        expect(selectTargetCandidate(count: 2, index: 4) == .notFound, "index out of range")
        expect(selectTargetCandidate(count: 3, nearDistances: [9, 1, 4]) == .selected(1), "unique closest")
        expect(selectTargetCandidate(count: 3, nearDistances: [1, 1, 4]) == .ambiguous, "closest tie")
        expect(selectTargetCandidate(count: 2, nearDistances: [1, nil]) == .ambiguous, "missing bounds")
        expect(
            selectTargetCandidate(count: 2, actionCompatible: [false, true]) == .selected(1),
            "one action-compatible match among two query matches"
        )
        expect(
            selectTargetCandidate(count: 2, actionCompatible: [false, false]) == .notFound,
            "zero action-compatible matches"
        )
        expect(
            selectTargetCandidate(count: 3, actionCompatible: [true, false, true]) == .ambiguous,
            "multiple action-compatible matches"
        )
        var incompatibleOverflow = BoundedActionCompatibleCandidateCounter(limit: 1_024)
        for _ in 0..<1_025 {
            expect(
                incompatibleOverflow.record(isCompatible: false) == .excluded,
                "incompatible candidates do not consume the compatible bound"
            )
        }
        expect(incompatibleOverflow.rawCount == 1_025, "raw incompatible count remains mechanical")
        expect(incompatibleOverflow.compatibleCount == 0, "zero compatible candidates remain missing")

        var lateCompatible = BoundedActionCompatibleCandidateCounter(limit: 1_024)
        for _ in 0..<1_024 { _ = lateCompatible.record(isCompatible: false) }
        expect(
            lateCompatible.record(isCompatible: true) == .included,
            "one late compatible candidate remains selectable"
        )
        expect(lateCompatible.compatibleCount == 1, "compatible bound is applied after filtering")

        var compatibleOverflow = BoundedActionCompatibleCandidateCounter(limit: 1_024)
        for _ in 0..<1_024 { _ = compatibleOverflow.record(isCompatible: true) }
        expect(
            compatibleOverflow.record(isCompatible: true) == .overflow,
            "compatible candidates retain the bounded ambiguity cap"
        )
        print("targeting selection harness: ok")
    }
}
