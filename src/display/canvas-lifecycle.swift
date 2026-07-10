import AppKit
import Foundation

struct CanvasLifecycleGeneration: Hashable {
    let canvasID: String
    let value: UInt64
}

final class CanvasLifecycleCompletionTracker {
    private final class Waiter {
        let id = UUID()
        let action: String
        var pendingGenerations: Set<CanvasLifecycleGeneration>
        let completion: (Bool) -> Void
        var timeoutWorkItem: DispatchWorkItem?
        var failed = false

        init(
            action: String,
            pendingGenerations: Set<CanvasLifecycleGeneration>,
            completion: @escaping (Bool) -> Void
        ) {
            self.action = action
            self.pendingGenerations = pendingGenerations
            self.completion = completion
        }
    }

    private var waiters: [UUID: Waiter] = [:]

    var pendingCount: Int { waiters.count }

    @discardableResult
    func await(
        generations: Set<CanvasLifecycleGeneration>,
        action: String,
        timeout: TimeInterval? = nil,
        completion: @escaping (Bool) -> Void
    ) -> UUID? {
        precondition(Thread.isMainThread, "lifecycle completion waits must start on the main thread")
        guard !generations.isEmpty else {
            completion(true)
            return nil
        }

        let waiter = Waiter(
            action: action,
            pendingGenerations: generations,
            completion: completion
        )
        waiters[waiter.id] = waiter

        if let timeout, timeout.isFinite {
            let workItem = DispatchWorkItem { [weak self] in
                guard let self, let pending = self.waiters.removeValue(forKey: waiter.id) else {
                    return
                }
                pending.timeoutWorkItem = nil
                pending.completion(false)
            }
            waiter.timeoutWorkItem = workItem
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: workItem)
        }
        return waiter.id
    }

    func abandon(_ generation: CanvasLifecycleGeneration) {
        precondition(Thread.isMainThread, "lifecycle completion abandonment must run on the main thread")
        resolve(generation, action: nil, success: false)
    }

    func receive(_ generation: CanvasLifecycleGeneration, action: String) {
        precondition(Thread.isMainThread, "lifecycle completion ACK must run on the main thread")
        guard !action.isEmpty else { return }
        resolve(generation, action: action, success: true)
    }

    private func resolve(
        _ generation: CanvasLifecycleGeneration,
        action: String?,
        success: Bool
    ) {
        let waiterIDs: [UUID] = waiters.compactMap { id, waiter -> UUID? in
            guard waiter.pendingGenerations.contains(generation) else { return nil }
            guard action == nil || waiter.action == action else { return nil }
            return id
        }

        for waiterID in waiterIDs {
            guard let waiter = waiters[waiterID] else { continue }
            if !success { waiter.failed = true }
            waiter.pendingGenerations.remove(generation)
            if waiter.pendingGenerations.isEmpty {
                complete(waiterID, success: !waiter.failed)
            }
        }
    }

    private func complete(_ waiterID: UUID, success: Bool) {
        guard let waiter = waiters.removeValue(forKey: waiterID) else { return }
        waiter.timeoutWorkItem?.cancel()
        waiter.timeoutWorkItem = nil
        waiter.completion(success)
    }
}

protocol CanvasNativeRetirable: AnyObject {
    var nativeRetirementID: String { get }
    func quiesceForRetirement()
    func finalizeRetirement()
}

/// Issues generation leases and retains retired native objects until teardown
/// is safe. CanvasManager's registry remains the sole active lifecycle owner.
final class CanvasLifecycleCoordinator {
    private struct PendingRetirement: Hashable {
        let generation: CanvasLifecycleGeneration
        let resourceID: String
    }

    private var nextGeneration: UInt64 = 0
    private var retiring: [PendingRetirement: CanvasNativeRetirable] = [:]

    func issueGeneration(for canvas: CanvasLike) -> CanvasLifecycleGeneration {
        precondition(Thread.isMainThread, "canvas generation issuance must run on the main thread")
        nextGeneration &+= 1
        let generation = CanvasLifecycleGeneration(canvasID: canvas.id, value: nextGeneration)
        canvas.lifecycleGeneration = generation.value
        return generation
    }

    func matches(_ canvas: CanvasLike, generation: CanvasLifecycleGeneration) -> Bool {
        generation.canvasID == canvas.id && generation.value == canvas.lifecycleGeneration
    }

    var pendingFinalizationCount: Int {
        precondition(Thread.isMainThread, "canvas retirement diagnostics must run on the main thread")
        return retiring.count
    }

    var pendingFinalizationIDs: [String] {
        precondition(Thread.isMainThread, "canvas retirement diagnostics must run on the main thread")
        return retiring.keys.map(\.resourceID).sorted()
    }

    func retainUntilNextRunLoop(
        _ canvas: CanvasLike,
        generation: CanvasLifecycleGeneration
    ) {
        precondition(Thread.isMainThread, "canvas retirement retention must run on the main thread")
        precondition(matches(canvas, generation: generation), "invalid canvas retirement generation")
        retireNativeResource(canvas, ownerGeneration: generation)
    }

    func retireNativeResource(
        _ resource: CanvasNativeRetirable,
        ownerGeneration: CanvasLifecycleGeneration
    ) {
        precondition(Thread.isMainThread, "native resource retirement must run on the main thread")
        precondition(ownerGeneration.value > 0, "native resource retirement requires an owned generation")
        let retirement = PendingRetirement(
            generation: ownerGeneration,
            resourceID: resource.nativeRetirementID
        )
        precondition(retiring[retirement] == nil, "native resource is already pending finalization")
        resource.quiesceForRetirement()
        retiring[retirement] = resource
        DispatchQueue.main.async { [self] in
            guard let retained = retiring[retirement] else { return }
            autoreleasepool {
                retained.finalizeRetirement()
            }
            retiring.removeValue(forKey: retirement)
            wakeAppKitAfterRetirement()
        }
    }

    private func wakeAppKitAfterRetirement() {
        // NSApplication.currentEvent can retain a retired window and its
        // tracking graph until AppKit processes another event.
        guard let event = NSEvent.otherEvent(
            with: .applicationDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            subtype: 0,
            data1: 0,
            data2: 0
        ) else { return }
        NSApp.postEvent(event, atStart: false)
    }
}
