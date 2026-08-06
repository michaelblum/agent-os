import Foundation

enum TargetCandidateSelection: Equatable {
    case selected(Int)
    case notFound
    case ambiguous
}

enum BoundedTargetCandidateAdmission: Equatable {
    case excluded
    case included
    case overflow
}

struct BoundedActionCompatibleCandidateCounter {
    let limit: Int
    private(set) var rawCount = 0
    private(set) var compatibleCount = 0

    mutating func record(isCompatible: Bool) -> BoundedTargetCandidateAdmission {
        rawCount += 1
        guard isCompatible else { return .excluded }
        compatibleCount += 1
        return compatibleCount > limit ? .overflow : .included
    }
}

/// The native NDJSON session has no Observation Ref backend. Any supplied
/// state id would therefore attach unvalidated observation provenance to a
/// coordinate, native AX, or non-target action and must fail before dispatch.
func sessionTargetStateErrorCode(_ stateID: String?) -> String? {
    stateID == nil ? nil : "TARGET_STATE_UNSUPPORTED"
}

/// Pure exact-one selection used by native AX Locator resolution.
/// `index` is an explicit BFS-order disambiguator. `nearDistances` must contain
/// one finite squared distance per candidate; missing distances and minimum
/// ties are ambiguous because neither permits a unique closest claim. An
/// optional compatibility mask performs exact-one selection over the eligible
/// candidates when no explicit disambiguator is supplied.
func selectTargetCandidate(
    count: Int,
    index: Int? = nil,
    nearDistances: [Double?]? = nil,
    actionCompatible: [Bool]? = nil
) -> TargetCandidateSelection {
    guard count > 0 else { return .notFound }
    if let index {
        return index >= 0 && index < count ? .selected(index) : .notFound
    }
    if let nearDistances {
        guard nearDistances.count == count else { return .ambiguous }
        var bestIndex: Int? = nil
        var bestDistance = Double.greatestFiniteMagnitude
        var tied = false
        for (candidateIndex, distance) in nearDistances.enumerated() {
            guard let distance, distance.isFinite else { return .ambiguous }
            if distance < bestDistance {
                bestDistance = distance
                bestIndex = candidateIndex
                tied = false
            } else if distance == bestDistance {
                tied = true
            }
        }
        guard let bestIndex, !tied else { return .ambiguous }
        return .selected(bestIndex)
    }
    if let actionCompatible {
        guard actionCompatible.count == count else { return .ambiguous }
        let compatibleIndexes = actionCompatible.indices.filter { actionCompatible[$0] }
        guard !compatibleIndexes.isEmpty else { return .notFound }
        return compatibleIndexes.count == 1 ? .selected(compatibleIndexes[0]) : .ambiguous
    }
    return count == 1 ? .selected(0) : .ambiguous
}
