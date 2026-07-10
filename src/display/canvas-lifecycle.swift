import Foundation

enum CanvasOwnershipPhase: String {
    case creating
    case active
    case warmSuspended = "warm_suspended"
    case retiring
    case removed
}

struct CanvasLifecycleGeneration: Hashable {
    let canvasID: String
    let value: UInt64
}

/// Owns canvas identity across asynchronous AppKit and WebKit callbacks.
/// CanvasManager remains the active lookup owner; this coordinator retains
/// retiring native objects until teardown is safe on the next main-loop turn.
final class CanvasLifecycleCoordinator {
    private struct Record {
        let generation: CanvasLifecycleGeneration
        let objectID: ObjectIdentifier
        var phase: CanvasOwnershipPhase
    }

    private var nextGeneration: UInt64 = 0
    private var current: [String: Record] = [:]
    private var retiring: [CanvasLifecycleGeneration: CanvasLike] = [:]

    func registerCreating(_ canvas: CanvasLike) -> CanvasLifecycleGeneration {
        precondition(Thread.isMainThread, "canvas lifecycle registration must run on the main thread")
        precondition(current[canvas.id] == nil, "canvas lifecycle generation already exists for \(canvas.id)")

        nextGeneration &+= 1
        let generation = CanvasLifecycleGeneration(canvasID: canvas.id, value: nextGeneration)
        canvas.lifecycleGeneration = generation.value
        canvas.lifecycleState = CanvasOwnershipPhase.creating.rawValue
        current[canvas.id] = Record(
            generation: generation,
            objectID: ObjectIdentifier(canvas),
            phase: .creating
        )
        return generation
    }

    func activate(
        _ canvas: CanvasLike,
        generation: CanvasLifecycleGeneration,
        suspended: Bool
    ) {
        precondition(Thread.isMainThread, "canvas lifecycle activation must run on the main thread")
        guard var record = matchingRecord(for: canvas, generation: generation),
              record.phase == .creating else {
            preconditionFailure("invalid canvas lifecycle activation for \(canvas.id)")
        }

        record.phase = suspended ? .warmSuspended : .active
        current[canvas.id] = record
        canvas.lifecycleState = record.phase.rawValue
    }

    func isCurrent(_ canvas: CanvasLike, generation: CanvasLifecycleGeneration) -> Bool {
        precondition(Thread.isMainThread, "canvas lifecycle lookup must run on the main thread")
        guard let record = matchingRecord(for: canvas, generation: generation) else { return false }
        return record.phase == .creating || record.phase == .active || record.phase == .warmSuspended
    }

    @discardableResult
    func retire(_ canvas: CanvasLike, generation: CanvasLifecycleGeneration) -> Bool {
        precondition(Thread.isMainThread, "canvas lifecycle retirement must run on the main thread")
        guard var record = matchingRecord(for: canvas, generation: generation),
              record.phase != .retiring,
              record.phase != .removed else {
            return false
        }

        record.phase = .retiring
        current[canvas.id] = record
        canvas.lifecycleState = CanvasOwnershipPhase.retiring.rawValue
        canvas.quiesceForRetirement()

        record.phase = .removed
        current.removeValue(forKey: canvas.id)
        canvas.lifecycleState = CanvasOwnershipPhase.removed.rawValue
        retiring[generation] = canvas

        DispatchQueue.main.async { [self] in
            guard let retained = retiring.removeValue(forKey: generation) else { return }
            retained.finalizeRetirement()
        }
        return true
    }

    private func matchingRecord(
        for canvas: CanvasLike,
        generation: CanvasLifecycleGeneration
    ) -> Record? {
        guard generation.canvasID == canvas.id,
              generation.value == canvas.lifecycleGeneration,
              let record = current[canvas.id],
              record.generation == generation,
              record.objectID == ObjectIdentifier(canvas) else {
            return nil
        }
        return record
    }
}
