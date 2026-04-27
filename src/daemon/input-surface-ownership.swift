import Foundation
import CoreGraphics

struct AOSInputSurfaceRecord: Equatable {
    let id: String
    let nativeFrame: CGRect
    let interactive: Bool
    let suspended: Bool
    let clickThrough: Bool
    let windowLevel: String?
    let windowNumber: Int?

    init(
        id: String,
        nativeFrame: CGRect,
        interactive: Bool,
        suspended: Bool = false,
        clickThrough: Bool = false,
        windowLevel: String? = nil,
        windowNumber: Int? = nil
    ) {
        self.id = id
        self.nativeFrame = nativeFrame
        self.interactive = interactive
        self.suspended = suspended
        self.clickThrough = clickThrough
        self.windowLevel = windowLevel
        self.windowNumber = windowNumber
    }
}

enum AOSInputSurfaceHitDecision: Equatable {
    case none
    case surface(AOSInputSurfaceRecord)
    case ambiguous([AOSInputSurfaceRecord])

    var shouldConsume: Bool {
        if case .surface = self { return true }
        return false
    }
}

func aosInputWindowLevelRank(_ level: String?, interactive: Bool) -> Int {
    let normalized = level?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "-", with: "_")

    switch normalized {
    case "screen_saver":
        return 300
    case "status_bar":
        return 200
    case "floating":
        return 100
    case "automatic", nil:
        return interactive ? 100 : 200
    default:
        return interactive ? 100 : 200
    }
}

func frontmostHittableAOSSurface(
    at point: CGPoint,
    surfaces: [AOSInputSurfaceRecord],
    frontToBackWindowNumbers: [Int] = []
) -> AOSInputSurfaceHitDecision {
    let hittable = surfaces.filter { surface in
        surface.interactive &&
        !surface.suspended &&
        !surface.clickThrough &&
        surface.nativeFrame.width > 0 &&
        surface.nativeFrame.height > 0 &&
        surface.nativeFrame.contains(point)
    }

    guard !hittable.isEmpty else { return .none }
    if hittable.count == 1, let only = hittable.first { return .surface(only) }

    let order = Dictionary(uniqueKeysWithValues: frontToBackWindowNumbers.enumerated().map { ($0.element, $0.offset) })
    let ordered = hittable.sorted { lhs, rhs in
        let lhsOrder = lhs.windowNumber.flatMap { order[$0] }
        let rhsOrder = rhs.windowNumber.flatMap { order[$0] }
        if let lhsOrder, let rhsOrder, lhsOrder != rhsOrder { return lhsOrder < rhsOrder }

        let lhsRank = aosInputWindowLevelRank(lhs.windowLevel, interactive: lhs.interactive)
        let rhsRank = aosInputWindowLevelRank(rhs.windowLevel, interactive: rhs.interactive)
        if lhsRank != rhsRank { return lhsRank > rhsRank }

        return lhs.id < rhs.id
    }

    guard let first = ordered.first else { return .none }
    let tied = ordered.filter { candidate in
        let firstOrder = first.windowNumber.flatMap { order[$0] }
        let candidateOrder = candidate.windowNumber.flatMap { order[$0] }
        let bothHaveKnownOrder = firstOrder != nil && candidateOrder != nil
        let sameKnownOrder = bothHaveKnownOrder && firstOrder == candidateOrder
        let missingKnownOrder = firstOrder == nil || candidateOrder == nil
        let sameLevel = aosInputWindowLevelRank(first.windowLevel, interactive: first.interactive)
            == aosInputWindowLevelRank(candidate.windowLevel, interactive: candidate.interactive)

        return sameKnownOrder || (missingKnownOrder && sameLevel)
    }

    if tied.count > 1 { return .ambiguous(tied) }
    return .surface(first)
}
